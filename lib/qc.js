/**
 * WFQC -- peer quality check, with a per-phase checklist and a signed
 * correction round-trip.
 *
 * WHY IT'S SHAPED LIKE THIS
 *
 * The point isn't the checkbox, it's the record of who attested to what. So:
 *
 *  - The checker works a checklist and signs. If they miss something, the
 *    record shows they passed it -- that's on the checker.
 *  - Anything failed goes back naming the specific items. The person fixing it
 *    writes what they did *per item* and signs. If they don't fix it, the
 *    record shows what they claimed -- that's on them.
 *  - The re-check covers only the items it was sent back for. The checker
 *    already worked the full list once; making them redo it would blur whose
 *    responsibility a miss was.
 *  - Rounds accumulate. Round 1 fail, correction, round 2 pass all stay on the
 *    card, which is what makes it evidence rather than a tick.
 *
 * The template is copied onto the card when a check starts. Editing the
 * template later must not make an already-signed check look incomplete.
 *
 * Kept out of lib/phase.js on purpose: that state machine is the tested spine.
 * Passing here calls the existing approveAndAdvance, so a pass writes the same
 * phaseLog entry and audit comment, with the peer recorded as approver.
 */
(function (global) {
  "use strict";

  var KEY = "qcRecord";              // per-card
  var TEMPLATE_KEY = "qcTemplates";  // per-board
  var STATION_KEY = "wfQcChecklists"; // per-board, keyed by STATION id

  /** Card label that still forces a manager signature after QC passes. */
  var NEEDS_MANAGER = "needs shop manager approval";

  /* Phases that stop for a PEER check before advancing. Everything else
     advances on approval as before. Override with WF_CONFIG.qcPhases.

     "Assemble" was one column when this was written and is now three, one per
     job type -- listing all three keeps every assemble route covered instead of
     silently exempting CNC and CAP work from QC. */
  var DEFAULT_QC_PHASES = [
    "Assemble Legacy", "Assemble CAP", "Assemble CNC", "Sandblast / Powder Coat"
  ];

  /**
   * Phases where the person doing the work signs their OWN checklist, with no
   * peer involved.
   *
   * CAD is the case this exists for. A peer check there isn't worth much -- only
   * two people draw, so the "peer" is just the other one of them. What is worth
   * something is the drafter not forgetting anything before the drawing reaches
   * the shop, and that's a checklist, not a review.
   *
   * A failed self-check is NOT a rejection. Nothing goes to ReWork, nobody is
   * blamed, and the job doesn't move: an unticked line simply means the phase
   * isn't finished. That's the whole difference from the peer path, which does
   * bounce work back with a named fault.
   */
  var DEFAULT_SELF_CHECK_PHASES = ["CAD"];

  /**
   * Starting checklists, used only for a phase that has never been saved.
   *
   * These are a draft to edit in the Roster tab, not policy. The moment a
   * manager saves over one the saved version wins permanently -- including a
   * deliberately emptied list, which is why the fallback tests for a missing
   * key rather than for a falsy value.
   */
  var DEFAULT_TEMPLATES = {
    "CAD": [
      "Dimensions match the final measure sheet",
      "Job type flagged: legacy, CNC, CAP railing, or a combination",
      "Material and section/gauge specified",
      "Finish specified -- powder coat colour, or raw",
      "Fixings and mounting detail shown",
      "Cut list and part quantities agree with the drawing",
      "Site constraints noted: access, obstructions, slope",
      "Revision number on the sheet matches what the customer approved"
    ]
  };

  /**
   * Starting checklists for the shop floor, carrying the tolerance with the
   * line. Taken from the approved station mock.
   *
   * These are spec'd where the phase templates above are not, because a station
   * screen is read at arm's length by somebody with a grinder in their hand.
   * "All welds complete" is a line anybody can tick in good conscience; "no
   * missed joints; check the back side and inside corners" is the one that
   * actually catches the joint nobody looked at.
   *
   * Every one of these is a draft to edit per station in the Stations dialog,
   * not policy. Once a station is saved its own list wins permanently.
   */
  var DEFAULT_STATION_ITEMS = {
    "Assemble": [
      { text: "Dimensions match shop drawing", spec: "Overall and opening sizes within ±1/8″" },
      { text: "Frame is square", spec: "Diagonals within 1/8″ of each other" },
      { text: "All welds complete", spec: "No missed joints; check back side and inside corners" },
      { text: "Spatter and slag removed", spec: "Wire-wheel every weld before grinding" },
      { text: "Exposed welds ground smooth", spec: "Customer-facing surfaces only; leave structural welds full" },
      { text: "Edges and corners deburred", spec: "Run a glove along every edge" },
      { text: "Hardware fit-up verified", spec: "Hinges, latches and operator mounts dry-fit and swing checked" },
      { text: "Infill spacing meets code", spec: "4″ sphere rule; 42″ guard height where applicable" },
      { text: "Job number tagged on every piece", spec: "Stamped or paint-penned on a hidden face" },
      { text: "Photos posted to the card", spec: "Front, back and one detail shot" }
    ]
  };

  /**
   * The shipped draft for a phase, as spec'd items.
   *
   * "Assemble CNC" and "Assemble CAP" are the same bench work as "Assemble
   * Legacy" with a different front end, so all three start from the Assemble
   * list rather than from nothing.
   */
  function defaultStationItems(phaseName) {
    var key = /^assemble/i.test(String(phaseName || "")) ? "Assemble" : phaseName;
    var d = DEFAULT_STATION_ITEMS[key];
    return Array.isArray(d) ? d.map(normItem) : null;
  }

  var STATUS = {
    CHECK: "awaiting_check",
    CORRECTION: "awaiting_correction",
    VERIFY: "awaiting_verify",
    // A self-check with lines still unticked: not moved, not rejected, not done.
    SELF_TODO: "self_todo"
  };

  function nowIso() { return new Date().toISOString(); }

  function person(p) {
    if (!p) return null;
    return { id: p.id || null, username: p.username || null,
             fullName: p.fullName || p.username || null };
  }

  function qcPhases() {
    var c = global.WF_CONFIG && global.WF_CONFIG.qcPhases;
    return Array.isArray(c) && c.length ? c : DEFAULT_QC_PHASES;
  }

  function requiresQc(phaseName) {
    return qcPhases().indexOf(phaseName) !== -1;
  }

  function selfCheckPhases() {
    var c = global.WF_CONFIG && global.WF_CONFIG.selfCheckPhases;
    return Array.isArray(c) && c.length ? c : DEFAULT_SELF_CHECK_PHASES;
  }

  function requiresSelfCheck(phaseName) {
    return selfCheckPhases().indexOf(phaseName) !== -1;
  }

  /** Either kind of check -- what the Roster tab needs a checklist editor for. */
  function needsChecklist(phaseName) {
    return requiresQc(phaseName) || requiresSelfCheck(phaseName);
  }

  function defaultTemplate(phaseName) {
    var d = DEFAULT_TEMPLATES[phaseName];
    return Array.isArray(d) ? d.slice() : [];
  }

  /* ------------------------------------------------------------- templates */

  function getTemplates(t) {
    return t.get("board", "shared", TEMPLATE_KEY, null).then(function (v) {
      return (v && typeof v === "object") ? v : {};
    });
  }

  function getTemplate(t, phaseName) {
    return getTemplates(t).then(function (all) {
      var items = all[phaseName];
      // A saved empty list is a deliberate choice and is respected; only a phase
      // that has never been saved falls back to the shipped draft.
      return Array.isArray(items) ? items.slice() : defaultTemplate(phaseName);
    });
  }

  /* ------------------------------------------------- station checklists (floor) */

  /**
   * The checklist a STATION works, which is not the same thing as the phase's.
   *
   * The blast booth, the powder booth and the cure oven all sit on one phase,
   * and they check completely different things. Keying by phase would have made
   * those three share a list, so the floor keys by station id instead -- the
   * decision was taken deliberately, because it is a one-line change now and a
   * data migration later.
   *
   * Items carry a `spec` -- the tolerance or the how, shown in small type under
   * the line. "Frame is square" is an instruction nobody can fail honestly;
   * "diagonals within 1/8 inch of each other" is one they can.
   */
  function getStationChecklists(t) {
    return t.get("board", "shared", STATION_KEY, null).then(function (v) {
      return (v && typeof v === "object") ? v : {};
    });
  }

  /**
   * One station's list.
   *
   * Falls back through: the station's own saved list, then the phase template
   * turned into spec-less items, then the shipped draft for that phase. A
   * station nobody has set up still gets something to work rather than an empty
   * screen and a blocked Complete button.
   */
  /**
   * The items for a station. Takes a station object; the old (id, phase) call
   * is still accepted so nothing that predates the library breaks.
   */
  function getStationChecklist(t, station, phaseName) {
    var s = (station && typeof station === "object")
      ? station
      : { id: station, phase: phaseName };
    return checklistFor(t, s).then(function (r) { return r.items; });
  }

  function normItem(x) {
    if (typeof x === "string") return { text: x, spec: "" };
    return { text: String((x && x.text) || ""), spec: String((x && x.spec) || "") };
  }

  function saveStationChecklist(t, stationId, items) {
    return getStationChecklists(t).then(function (all) {
      all[stationId] = (items || []).map(normItem)
        .filter(function (i) { return i.text; });
      return t.set("board", "shared", STATION_KEY, all).then(function () { return all; });
    });
  }

  /* ------------------------------------------------------------ the sign-off */

  /**
   * Whether a signature may be taken yet.
   *
   * All three conditions come straight from the approved mock, and each one is
   * doing work. Every item checked, because a partially worked list signed off
   * is worse than no list. A typed name longer than two characters, because a
   * signature box people can dismiss with a keystroke stops being a signature.
   * A chosen signer, because "who said this was good" is the entire value of
   * the record -- and it is a separate field from the typed name on purpose, so
   * a welder can type their own name while naming the peer who actually looked.
   */
  function canSignOff(items, checked, signature, signedBy, failed) {
    if (!items || !items.length) return false;
    // A failed line is not a signable line. Nothing may be signed while
    // somebody has said out loud that something is wrong.
    if (countFailed(failed)) return false;
    for (var i = 0; i < items.length; i++) if (!checked[i]) return false;
    if (String(signature || "").trim().length <= 2) return false;
    return !!signedBy;
  }

  function countFailed(failed) {
    return Object.keys(failed || {}).filter(function (k) { return failed[k]; }).length;
  }

  /** The words under the Sign button: what is still in the way, counted. */
  function signHint(items, checked, signature, signedBy, failed) {
    var total = (items || []).length;
    if (!total) return "No checklist set up for this station yet.";
    var bad = countFailed(failed);
    if (bad) {
      return bad + (bad === 1 ? " item is marked wrong. " : " items are marked wrong. ") +
             "Say what's wrong with each, then record the fault — the job stays here.";
    }
    var done = 0;
    for (var i = 0; i < total; i++) if (checked[i]) done++;
    if (done < total) {
      var left = total - done;
      return "Check every item, then sign. " + left +
             (left === 1 ? " item remaining." : " items remaining.");
    }
    if (String(signature || "").trim().length <= 2) return "All items checked. Type your name to sign.";
    if (!signedBy) return "All items checked. Choose who signed off, then pass.";
    return "All items checked. Sign, pick who signed off, then pass.";
  }

  /* ==================================================== faults
   *
   * WHAT A FAULT IS, AND WHY IT IS NOT A NEW KIND OF THING
   *
   * Until now the checklist could only record that work was good. Every line
   * was tick or not-yet, `canSignOff` demanded all ticks, so somebody looking
   * at a twisted frame had two options: walk away, or tick it anyway. A gate
   * with no way to say no teaches people to say yes, and then the signatures
   * stop meaning anything — which costs more than the gate was ever worth.
   *
   * So a line has three states now, and the difference between the last two is
   * the whole point:
   *
   *   unticked   nobody has got to it yet
   *   pass       looked at it, it's right
   *   fail       looked at it, it's wrong — and here is what's wrong
   *
   * A fault is a failed line plus what somebody wrote about it. It is stored on
   * the round it was found in, because that is where it happened: round 1
   * failed with a note, the fix is recorded against that same fault, round 2
   * passes and is signed. Read back, the record tells the story in order.
   *
   * WHERE THIS DELIBERATELY DOES NOT GO
   *
   * The earlier plan was a board key per month — `wfFaults:2026-09`. That is
   * now clearly wrong: board keys share one 4,096-character budget with the
   * roster, the permissions, the stations and the checklist library, and twenty
   * faults a month would exhaust it on their own. Faults belong to a job, the
   * job is a card, and the card has its own budget. Nothing new is stored at
   * board level at all.
   *
   * WHAT THE JOB DOES: NOTHING
   *
   * It stays exactly where it is, on the bench, with the person who can fix it.
   * It does not bounce to ReWork and it does not leave the station. Moving it
   * would hand somebody else a job with a fault attached and no context, and it
   * would take the work away from the one person holding the information about
   * what went wrong.
   */

  /**
   * Record a round in which something failed. Signs nothing, moves nothing.
   *
   * `items` is what the UI collected: [{text, spec, result, note}], where
   * result is "pass" or "fail" and a failed line carries the note saying what
   * is wrong. Refuses a round with no failures, because that is a sign-off and
   * belongs in signOff where the signature rules apply.
   */
  function recordFaults(t, cardMeta, opts) {
    opts = opts || {};
    var items = opts.items || [];
    var worker = opts.worker;
    var failed = items.filter(function (i) { return i.result === "fail"; });
    if (!failed.length) {
      return Promise.reject(new Error(
        "Nothing is marked wrong. Tick everything and sign it off instead."));
    }
    var missing = failed.filter(function (i) { return !String(i.note || "").trim(); });
    if (missing.length) {
      return Promise.reject(new Error(
        "Say what's wrong with " + (missing.length === 1 ? "the failed item" :
        "each of the " + missing.length + " failed items") +
        ". A fault nobody described teaches nobody anything."));
    }

    var now = nowIso();
    return getRecord(t, cardMeta.id).then(function (existing) {
      var prior = carryOver(existing, cardMeta);
      var rec = prior || {
        listId: cardMeta.idList,
        phase: opts.phase || "",
        requestedBy: person(worker),
        requestedAt: now,
        rounds: []
      };
      rec.mode = "floor";
      rec.phase = rec.phase || opts.phase || "";
      rec.stationId = opts.stationId || rec.stationId || null;
      rec.listName = opts.listName || rec.listName || null;
      rec.status = STATUS.CORRECTION;
      rec.rounds = rec.rounds || [];
      if (!rec.template || !rec.template.length) {
        rec.template = items.map(function (i) { return normItem(i); });
      }
      // A round that found a fault is not a signature, so the record must stop
      // claiming to hold one. Same rule as a self-check landing on a signed
      // record: the record's top level describes where things stand NOW.
      delete rec.signature;
      delete rec.signedAt;
      delete rec.signedBy;
      delete rec.passedBy;
      delete rec.passedAt;

      var round = packRound(items, prior && prior.template);
      round.n = rec.rounds.length + 1;
      round.mode = "floor";
      // The one field that says "somebody deliberately raised this". isFaultRound
      // reads it, and nothing else in this file writes it -- which is what keeps
      // an unfinished self-check from reading as seven faults.
      round.foundBy = person(worker);
      round.checkedBy = person(worker);
      round.checkedAt = now;
      rec.rounds.push(round);

      return put(t, cardMeta, rec).then(function () {
        return { rec: rec, round: round, faults: openFaults({ idList: cardMeta.idList, qcRecord: rec }) };
      });
    });
  }

  /**
   * Faults on the latest round that nobody has written a fix for yet.
   *
   * Only the latest round, deliberately. An earlier round's fault was either
   * fixed (it carries a fix) or superseded by a later check that looked again;
   * either way it is history, and history is not a to-do list. What is open is
   * what the most recent look found.
   */
  /**
   * "FAIL" DOES NOT MEAN THE SAME THING IN EVERY ROUND, AND THIS IS THE TEST.
   *
   * popups/checklist.js stores every UNTICKED line of a self-check as
   * `result: "fail"`, on purpose and documented: there, an unticked line means
   * "the phase isn't finished", nothing moves and nobody is blamed. The peer
   * path does the same for lines a checker skipped.
   *
   * That collides head-on with the distinction this whole feature rests on --
   * unticked means nobody got to it, failed means somebody looked and it is
   * wrong. Without this test, a drafter who ticks one line of the eight-line CAD
   * list and goes home produces SEVEN open faults: the Records stat reads
   * "7 jobs waiting on an answer", the station paints its QC icon red, Complete
   * becomes "! 7 faults", and the checklist is replaced by a screen demanding
   * "what did you do about it?" for lines nobody said were wrong -- with no way
   * out except typing answers to non-faults.
   *
   * `foundBy` is written by recordFaults and by nothing else in this file, and
   * recordFaults refuses a failure with no note. So a round carrying it is a
   * round where somebody deliberately said something was wrong and described
   * it. That is the only kind of round that can hold a fault.
   */
  function isFaultRound(round) {
    return !!(round && round.foundBy);
  }

  function faultsOnRound(rec, round) {
    if (!isFaultRound(round)) return [];
    var fixes = round.fixes || {};
    return roundItems(rec, round).map(function (item) {
      var i = item.index;
      return { index: i, text: item.text, spec: item.spec, note: item.note,
               fix: fixes[i] || fixes[String(i)] || null, result: item.result };
    }).filter(function (f) { return f.result === "fail"; });
  }

  function openFaults(card) {
    var rec = activeRecord(card);
    return faultsOnRound(rec, currentRound(rec))
      .filter(function (f) { return !f.fix; });
  }

  function hasOpenFaults(card) { return openFaults(card).length > 0; }

  /**
   * Write what was done about a fault.
   *
   * Against the fault, not as a free-floating note, so "twisted 3mm across the
   * diagonal" and "reheated and re-clamped, re-measured at 1/16" stay joined
   * for whoever reads this in a year. One without the other is half a lesson.
   */
  function resolveFault(t, cardMeta, index, what, who) {
    var text = String(what || "").trim();
    if (!text) return Promise.reject(new Error("Say what was done about it."));
    return getRecord(t, cardMeta.id).then(function (rec) {
      var round = currentRound(carryOver(rec, cardMeta));
      if (!round) throw new Error("There is no open check on this job.");
      round.fixes = round.fixes || {};
      round.fixes[index] = { what: text, by: person(who), at: nowIso() };
      // Every fault answered means the job is workable again -- but it is NOT
      // passed. Somebody still has to work the list and sign it, which is the
      // second look the fault earned.
      var stillOpen = faultsOnRound(rec, round).filter(function (f) { return !f.fix; });
      if (!stillOpen.length) rec.status = STATUS.CHECK;
      return put(t, cardMeta, rec).then(function () { return rec; });
    });
  }

  /**
   * Sign the check and pass the job on, in one action.
   *
   * THIS REPLACES MANAGER APPROVAL. The old path was complete -> pendingApproval
   * -> a manager finds it in a queue -> approveAndAdvance. That queue was where
   * work went to wait, and waiting on somebody's inbox is not quality control --
   * it is a delay that feels like one. A signed checklist naming who checked it
   * is a better record than an approval click, and it happens at the bench while
   * the job is still in front of the person who can fix it.
   *
   * approveAndAdvance is still called underneath because it does the right
   * things -- writes the phase log, clears phaseWork, moves the card, comments.
   * The signer is passed as the approver, so the audit trail names the person
   * who actually looked at the work rather than whoever happened to be a manager.
   */
  /**
   * Sign the check. That is ALL this does.
   *
   * Signing and passing are two decisions and they were wrongly fused in the
   * first cut: signing the checklist immediately shipped the job, so the
   * "are you sure you want to send this to Sandblast" question in the mock
   * never appeared, and there was no moment between attesting to the work and
   * letting go of it. They are separated now -- sign here, pass in `passSigned`
   * -- which also means somebody can work the checklist at the bench and hand
   * the job on later without re-checking anything.
   */
  function signOff(t, cardMeta, opts) {
    opts = opts || {};
    var items = opts.items || [];
    var signer = opts.signedBy;
    var worker = opts.worker || signer;

    // opts.failed passes through so this stays a real backstop. The UI gate
    // already refuses to reach here with a line marked wrong, but a guard that
    // silently stopped covering the newest way to be wrong is not a guard.
    // Absent means nothing failed, so every existing caller behaves as before.
    if (!canSignOff(items, opts.checked || {}, opts.signature, signer, opts.failed)) {
      return Promise.reject(new Error(
        "Check every item, type your name and choose who signed off. " +
        "Anything marked wrong has to be recorded as a fault first."));
    }

    var now = nowIso();
    var rec = {
      listId: cardMeta.idList,
      phase: opts.phase || "",
      stationId: opts.stationId || null,
      listName: opts.listName || null,
      mode: "floor",
      status: "passed",
      // Filled in below from anything already recorded for this phase.
      rounds: [],
      // Whether the list was ticked in one go. Kept because "how carefully was
      // this checked" is a question worth being able to answer later, and the
      // only honest time to capture it is now.
      checkedAll: !!opts.checkedAll,
      // {text, spec}, not bare text. The tolerance is the part that makes a
      // line failable -- "frame is square" is a line anyone can tick in good
      // conscience, "diagonals within 1/8 inch" is one they can fail -- so it
      // has to survive into the record, and it is stored once here rather than
      // on every round.
      template: items.map(function (i) { return normItem(i); }),
      requestedBy: person(worker),
      requestedFrom: person(signer),
      requestedAt: now,
      signature: String(opts.signature || "").trim(),
      signedBy: person(signer),
      signedAt: now,
      passedBy: person(signer),
      passedAt: now
    };

    // Anything already recorded for THIS phase is kept and this sign-off is
    // appended as the next round. Signing at the bench after a self-check --
    // or after a failed round that was corrected -- must add to the record,
    // not replace it.
    return getRecord(t, cardMeta.id).then(function (existing) {
      var prior = carryOver(existing, cardMeta);
      var rounds = (prior && prior.rounds) ? prior.rounds.slice() : [];
      if (prior) {
        rec.requestedBy = prior.requestedBy || rec.requestedBy;
        rec.requestedAt = prior.requestedAt || rec.requestedAt;
        if (prior.faults) rec.faults = prior.faults;
        /* THE PRIOR TEMPLATE WINS, AND THE ROUNDS IT ALREADY OWNS ARE WHY.
         *
         * rec.template was built above from the list being signed NOW, and the
         * rounds carried over from `prior` were worked against `prior.template`
         * -- by POSITION, which is the whole basis of the slim shape, and so
         * are their `fixes`. Replacing the record's template re-points every
         * one of them at different lines: a manager who edits the list between
         * a fault round and this sign-off makes round 1 report the wrong line
         * failing, with the wrong answer attached to it, and nothing throws.
         *
         * So the record keeps the template its existing rounds are indexed
         * against, exactly as recordFaults, submitCheck and submitSelfCheck all
         * do, and THIS round pins its own copy instead -- which is precisely
         * what the packRound call below is already asking for by comparing
         * against prior.template. Without this line that comparison pinned the
         * one round that did not need it and left the ones that did unpinned.
         */
        if (prior.template && prior.template.length) rec.template = prior.template;
      }
      // Verdicts by position against the record's template -- see the note
      // above roundItems. The six explicit nulls are gone too: they described
      // the peer correction round-trip, cost ~90 characters on every round, and
      // every reader already treats a missing field as absent.
      var round = packRound(items.map(function (i) {
        return { text: i.text, spec: i.spec, result: "pass", note: "" };
      }), prior && prior.template);
      round.n = rounds.length + 1;
      // The round carries its own mode and signature. Rounds accumulate and the
      // record-level fields only ever describe the LATEST one, so without this
      // a reader looking back at round 2 of 3 has no way to know who signed it
      // or how. WFRecords reads both of these off the round.
      round.mode = "floor";
      round.checkedBy = person(signer);
      round.checkedAt = now;
      round.signature = String(opts.signature || "").trim();
      round.signedBy = person(signer);
      rounds.push(round);
      rec.rounds = rounds;
      return put(t, cardMeta, rec);
    }).then(function () { return rec; });
  }

  /**
   * Pass a signed job to the next phase.
   *
   * Refuses on an unsigned card rather than trusting the caller, because this
   * is the last gate between the bench and the next list and there is no
   * manager queue behind it to catch a mistake. The UI should never get here
   * unsigned; if it does, that is a bug worth failing loudly for.
   *
   * silent: the job is not waiting for anybody, and approveAndAdvance writes
   * the comment that is actually true a moment later.
   */
  function passSigned(t, cardMeta, card) {
    var rec = floorSignOff(card || cardMeta);
    if (!rec) return Promise.reject(new Error("This job hasn't passed QC yet."));
    var signer = rec.signedBy || rec.passedBy;
    // advance(), not approveAndAdvance(): there is no approval here and there
    // is nobody waiting to give one. The signed checklist IS the gate, and the
    // comment says "Passed QC by <the person who signed>" rather than claiming
    // a manager approved something no manager saw.
    return WFPhase.complete(t, cardMeta, { silent: true })
      .then(function () {
        return WFPhase.advance(t, cardMeta, person(signer), { verb: "Passed QC" });
      })
      .then(function (res) { return { rec: rec, movedTo: res && res.movedTo }; });
  }

  /** Kept for callers that genuinely want both in one step. */
  function signOffAndPass(t, cardMeta, opts) {
    return signOff(t, cardMeta, opts).then(function (rec) {
      var card = Object.assign({}, cardMeta, { qcRecord: rec });
      return passSigned(t, cardMeta, card);
    });
  }

  /**
   * A floor sign-off already on this card for this list, or null.
   *
   * Asks activeRecord for the floor mode explicitly. It used to filter on
   * `signedAt` being present, which only incidentally excluded the other two
   * kinds because they happened not to write that field — a field-presence
   * test standing in for a question about what kind of thing this is. Naming
   * the mode says what is actually meant and survives another writer adding a
   * timestamp.
   */
  function floorSignOff(card) {
    var r = activeRecord(card, "floor");
    if (!r || r.status !== "passed" || !r.signedAt) return null;
    return r;
  }

  /* ---------------------------------------------------------- the library */

  /**
   * Every checklist on the board, by name, as spec'd items.
   *
   * ONE STORE, NOT TWO. The floor briefly kept its own per-station lists in a
   * separate key while the Roster kept per-phase ones, which meant two places
   * to edit the same thing and no way to tell which a station was actually
   * using. A checklist is now a named entry in one library; a station points at
   * one by name. Managers make new ones in the Roster without anybody writing
   * code, which was the whole complaint.
   *
   * Entries saved before items carried tolerances are plain strings, so every
   * read normalises. Nobody has to migrate anything.
   */
  function getLibrary(t) {
    return getTemplates(t).then(function (all) {
      var out = {};
      Object.keys(all || {}).forEach(function (name) {
        out[name] = (Array.isArray(all[name]) ? all[name] : []).map(normItem);
      });
      return out;
    });
  }

  function libraryNames(t) {
    return getLibrary(t).then(function (lib) { return Object.keys(lib).sort(); });
  }

  function saveLibraryEntry(t, name, items) {
    var key = String(name || "").trim();
    if (!key) return Promise.reject(new Error("A checklist needs a name."));
    return getTemplates(t).then(function (all) {
      all[key] = (items || []).map(normItem)
        .filter(function (i) { return i.text; });
      /* THE WHOLE LIBRARY IS ONE KEY, AND IT SHARES THE BOARD'S BUDGET.
       *
       * Every named checklist on the board lives in this object, alongside the
       * roster, the permissions and the station setup in the same 4096
       * characters. A ten-item list with tolerances is ~1,150 characters, and
       * the design asks for one list per station -- so about five lists is the
       * real ceiling, against nine shipped stations. A manager building the
       * sixth would have had it silently not save. */
      return saveLibrary(t, all);
    });
  }

  function saveLibrary(t, all) {
    // global.WFStore, not a bare reference: this file is "use strict", so a
    // bare name that has not been defined throws a ReferenceError nothing can
    // catch, rather than reading as undefined. Every other lib here goes
    // through `global` for the same reason.
    return global.WFStore.set(t, "board", TEMPLATE_KEY, all, {
      label: "this checklist"
    }).then(function () { return all; });
  }

  function deleteLibraryEntry(t, name) {
    return getTemplates(t).then(function (all) {
      delete all[name];
      return saveLibrary(t, all);
    });
  }

  function renameLibraryEntry(t, from, to) {
    var key = String(to || "").trim();
    if (!key) return Promise.reject(new Error("A checklist needs a name."));
    return getTemplates(t).then(function (all) {
      if (!(from in all)) return all;
      all[key] = all[from];
      if (key !== from) delete all[from];
      return saveLibrary(t, all);
    });
  }

  /**
   * Which library entry a station should be working, by name.
   *
   * Explicit choice first, then the two matches a manager would expect anyway:
   * a list named after the phase the station pulls from, or one named after the
   * kind of station it is. Matching by name is what lets somebody make a
   * checklist called "Powder booth" in the Roster and have the powder booth
   * pick it up without touching the station's setup.
   */
  function checklistNameFor(station, names) {
    if (!station) return null;
    var have = {};
    (names || []).forEach(function (n) { have[n.toLowerCase()] = n; });

    var wanted = String(station.checklist || "").trim();
    if (wanted && have[wanted.toLowerCase()]) return have[wanted.toLowerCase()];

    var phase = String(station.phase || "").trim();
    if (phase && have[phase.toLowerCase()]) return have[phase.toLowerCase()];

    var kind = String(station.station || "").trim();
    if (kind && have[kind.toLowerCase()]) return have[kind.toLowerCase()];

    var table = String(station.table || "").trim();
    if (table && have[table.toLowerCase()]) return have[table.toLowerCase()];

    return null;
  }

  /**
   * The list a station works, resolved through the library.
   *
   * Accepts a station object. The legacy per-station key is still READ so a
   * board that saved one before the library existed keeps its list, but nothing
   * writes there any more.
   */
  function checklistFor(t, station) {
    return Promise.all([getLibrary(t), t.get("board", "shared", STATION_KEY, null)])
      .then(function (r) {
        var lib = r[0], legacy = (r[1] && typeof r[1] === "object") ? r[1] : {};
        var name = checklistNameFor(station, Object.keys(lib));
        if (name) return { name: name, items: lib[name].slice(), source: "library" };

        var own = station && legacy[station.id];
        if (Array.isArray(own)) {
          return { name: (station.table || station.id), items: own.map(normItem), source: "legacy" };
        }
        var shipped = defaultStationItems(station && station.phase);
        if (shipped) return { name: null, items: shipped, source: "draft" };
        return { name: null, items: defaultTemplate(station && station.phase).map(normItem),
                 source: "draft" };
      });
  }

  /** Managers only, enforced by the UI. Affects future checks, never past ones. */
  function saveTemplate(t, phaseName, items) {
    return saveLibraryEntry(t, phaseName, items);
  }

  /* ---------------------------------------------------------------- record */

  function getRecord(t, cardId) {
    return t.get(cardId, "shared", KEY, null);
  }

  /**
   * Write the record, having checked there is room on the card first.
   *
   * This was a bare t.set. A card in Assemble carries phaseWork, phaseLog,
   * economics and handoffLog in the SAME 4096-character budget as this record,
   * so "is the record small enough" was never the question -- and the answer
   * the bare write gave was a rejected promise the welder saw as "That didn't
   * go through", with the worked checklist gone and no way to know why.
   */
  function put(t, cardMeta, rec) {
    return global.WFStore.set(t, cardMeta.id, KEY, rec, {
      label: "this quality check"
    }).then(function () { return rec; });
  }

  function clear(t, cardMeta) {
    return t.set(cardMeta.id, "shared", KEY, null);
  }

  /**
   * HOW THIS RECORD WAS PRODUCED. Three ways, and they are not interchangeable.
   *
   *   "floor"  signed at the bench off the station's checklist, with a named
   *            signer who may or may not be the person who did the work
   *   "self"   the person who did the work ticked their own list
   *   "peer"   handed to a named checker to look at later (retired; see
   *            popups/tabs/myjobs.js — kept so old records still read)
   *
   * Older records carry no `mode` at all, so it is inferred from fields only
   * that path ever wrote. Guessing is acceptable here and nowhere else: the
   * alternative is a record from last month reading as an unknown kind and
   * dropping out of Records entirely.
   */
  function modeOf(rec) {
    if (!rec) return null;
    if (rec.mode) return rec.mode;
    if (rec.signedAt) return "floor";
    if (rec.status === STATUS.CHECK || rec.requestedFrom) return "peer";
    return "self";
  }

  /**
   * A record still belonging to the card's current phase, else null.
   *
   * `mode` narrows it: a caller asking "has this been signed at the bench"
   * must not be handed a self-check, and vice versa. Without that this
   * discriminated on listId alone, so the two sign-off paths were
   * indistinguishable — and since each wrote the record WHOLE, the second one
   * to run silently erased the first, taking its rounds, its signature and its
   * signer with it.
   */
  function activeRecord(card, mode) {
    var r = card && card.qcRecord;
    if (!r) return null;
    if (r.listId && card.idList && r.listId !== card.idList) return null;
    if (mode && modeOf(r) !== mode) return null;
    return r;
  }

  /**
   * Start or continue the record for this card's current phase.
   *
   * ONE RECORD PER CARD PER PHASE, AND IT ACCUMULATES. Every writer used to
   * build a fresh object and `put` it, which is correct for the first check of
   * a phase and destructive for every one after: a bench sign-off wiped a
   * self-check's rounds, a self-check wiped a bench signature. Rounds are the
   * whole evidentiary value of this record — round 1 failed, here is what was
   * done, round 2 passed — so losing them loses the point.
   *
   * A record belonging to an EARLIER list is genuinely finished business and is
   * replaced: the card has moved on and this is a different phase's check.
   */
  function carryOver(existing, cardMeta) {
    if (!existing || existing.listId !== cardMeta.idList) return null;
    return existing;
  }

  function currentRound(rec) {
    if (!rec || !rec.rounds || !rec.rounds.length) return null;
    return rec.rounds[rec.rounds.length - 1];
  }

  /* ============================================ what a round stores, and why
   *
   * A round used to carry the FULL TEXT and tolerance of every checklist line:
   *
   *   items: [{ text: "All welds complete",
   *             spec: "No missed joints; check back side and inside corners",
   *             result: "pass", note: "" }, ...]
   *
   * On the shipped ten-item Assemble list that is about 1,540 characters per
   * round, and the record already carries the same text once in `template`. So
   * a card was storing the checklist twice on round one, three times on round
   * two, and the second round alone put the record at ~4,080 of the card's
   * 4,096-character budget -- which that card also shares with phaseWork,
   * phaseLog and economics. Round three could not be written. A failed check,
   * a correction and a re-check is three rounds, which is the ordinary path
   * this model is built around and the exact thing the fault path produces.
   *
   * So the text lives once on the record, and a round stores only what is
   * specific to that round: the verdicts, by position, and any notes.
   *
   *   results: ["pass", "pass", "fail", ...]     ~7 characters each
   *   notes:   { 2: "twisted 3mm across" }       only where somebody wrote one
   *
   * That is roughly 300 characters a round instead of 1,540. Five rounds now
   * costs less than one used to.
   *
   * READING IS SHAPE-AGNOSTIC. Every record already on the board has the old
   * shape, and rewriting them would be a migration that could fail halfway.
   * `roundItems` hydrates either, so nothing else in the codebase has to know
   * which shape it is looking at -- and a record written last month still
   * reads, forever, with no migration ever run.
   */

  /**
   * The lines of a round, as {text, spec, result, note}, from either shape.
   *
   * Old rounds carry their own `items`. New ones carry `results` by position
   * against the record's `template`. A template entry may be a bare string
   * (older records) or {text, spec}.
   */
  function roundItems(rec, round) {
    if (!round) return [];

    /* `index` is on both shapes, because a fault's fix is stored against its
     * POSITION in the round -- that is how the slim shape works -- so anything
     * pairing a failure with its answer needs the position, and recovering it
     * by searching for matching text would break the moment two checklist lines
     * read alike. An old round gets it from its own array order, which is the
     * same number the fix would have been filed under. */
    if (round.items && round.items.length) {
      return round.items.map(function (i, n) {
        return {
          index: n, text: i.text, spec: i.spec || "",
          result: i.result, note: i.note || ""
        };
      });
    }

    /* A ROUND'S OWN TEMPLATE WINS, WHERE IT HAS ONE.
     *
     * Verdicts are stored by POSITION against a template, which is only safe
     * while the template stops still. A manager using "Edit this list" between
     * a fault round and the sign-off would re-point round 1's results -- and
     * its fixes, which are keyed the same way -- at different lines, so the
     * record would calmly report the wrong thing failing and the wrong answer
     * to it. Nothing would throw.
     *
     * A round therefore carries its own copy WHEN, and only when, the list it
     * was worked against differs from the record's. That is rare, so the cost
     * is rare too; the alternatives are storing it on every round (which is
     * the duplication the slim shape exists to remove) or letting a signed
     * record quietly change meaning.
     */
    var tpl = (round.tpl && round.tpl.length) ? round.tpl
      : ((rec && rec.template) || []);
    var notes = round.notes || {};
    return (round.results || []).map(function (result, i) {
      var t0 = tpl[i];
      var text = typeof t0 === "string" ? t0 : ((t0 && t0.text) || "");
      var spec = (t0 && typeof t0 === "object" && t0.spec) || "";
      return {
        index: i,
        text: text,
        spec: spec,
        result: result,
        note: notes[i] || notes[String(i)] || ""
      };
    });
  }

  /** The template as {text, spec} pairs, from either shape. */
  function templateItems(rec) {
    return ((rec && rec.template) || []).map(function (i) {
      return typeof i === "string" ? { text: i, spec: "" } : normItem(i);
    });
  }

  /**
   * Pack verdicts into the slim shape.
   *
   * `items` is what the UI collected: [{text, spec, result, note}].
   * Notes are kept only where one was actually typed -- an object full of
   * empty strings is most of the saving thrown away.
   */
  function packRound(items, recTemplate) {
    var results = [];
    var notes = {};
    (items || []).forEach(function (i, n) {
      results.push(i.result === "fail" ? "fail" : "pass");
      var note = String(i.note || "").trim();
      if (note) notes[n] = note;
    });
    var out = { results: results };
    if (Object.keys(notes).length) out.notes = notes;
    // Pin the list this round was worked against, but only when it differs from
    // the record's -- see the note in roundItems. Compared on the text, because
    // a re-worded tolerance changes what a tick meant just as much as a
    // re-ordered list does.
    if (recTemplate && differs(items, recTemplate)) {
      out.tpl = (items || []).map(function (i) { return normItem(i); });
    }
    return out;
  }

  function differs(items, tpl) {
    if (!tpl || tpl.length !== (items || []).length) return true;
    for (var i = 0; i < items.length; i++) {
      var a = normItem(items[i]);
      var b = typeof tpl[i] === "string" ? { text: tpl[i], spec: "" } : normItem(tpl[i]);
      if (a.text !== b.text || (a.spec || "") !== (b.spec || "")) return true;
    }
    return false;
  }

  /**
   * Raise a check. reviewer === null releases it to the pool.
   * The template is snapshotted here so later edits can't rewrite history.
   */
  function request(t, cardMeta, phaseName, requester, reviewer) {
    return getTemplate(t, phaseName).then(function (items) {
      return put(t, cardMeta, {
        listId: cardMeta.idList,
        phase: phaseName,
        // Declared rather than inferred. modeOf can work it out from the older
        // records on the board, but a writer that names its own mode is the
        // only reason that inference stays a fallback instead of a rule.
        mode: "peer",
        status: STATUS.CHECK,
        requestedBy: person(requester),
        requestedFrom: person(reviewer),
        requestedAt: nowIso(),
        template: items,
        rounds: []
      });
    });
  }

  /**
   * Named reviewer only, or anyone when pooled.
   * A manager can always step in -- someone has to be able to unstick a job
   * when the named checker is off sick, and that override is itself recorded
   * because the signature carries whoever actually did it.
   */
  function canReview(rec, username, isManager) {
    if (!rec) return false;
    if (isManager) return true;
    if (!rec.requestedFrom) return true;
    return rec.requestedFrom.username === username;
  }

  /** Whoever sent it for checking is the one who has to correct it. */
  function isOwner(rec, username) {
    return !!(rec && rec.requestedBy && rec.requestedBy.username === username);
  }

  /**
   * `rec` is optional and second so every existing caller keeps working.
   *
   * A round written in the old shape carries its own items and answers without
   * it. A round in the slim shape needs the record's template to know what line
   * 3 was called, so callers that have the record should pass it — without it a
   * failed line comes back with an empty name, which is worse than useless in a
   * message that says "did not pass QC: ".
   */
  function failedItems(round, rec) {
    return roundItems(rec, round).filter(function (i) { return i.result === "fail"; });
  }

  /**
   * Checker signs their pass of the list.
   * results: [{ text, result: "pass"|"fail"|"na", note }]
   * All pass -> the phase actually advances. Any fail -> back for correction.
   */
  function submitCheck(t, cardMeta, checker, results) {
    return getRecord(t, cardMeta.id).then(function (rec) {
      if (!rec) throw new Error("No quality check is open on this job.");
      rec.rounds = rec.rounds || [];
      // Same slim shape as the other two writers -- see the note above
      // roundItems. This path has a template already (request() snapshots it
      // when the check is raised), so the verdicts have something to index.
      if (!rec.template || !rec.template.length) {
        rec.template = (results || []).map(function (r) {
          return { text: r.text, spec: r.spec || "" };
        });
      }
      var round = packRound(results);
      round.n = rec.rounds.length + 1;
      round.mode = "peer";
      round.checkedBy = person(checker);
      round.checkedAt = nowIso();
      rec.rounds.push(round);

      if (!failedItems(round, rec).length) {
        rec.status = "passed";
        rec.passedBy = person(checker);
        rec.passedAt = nowIso();
        return put(t, cardMeta, rec).then(function () {
          return WFPhase.approveAndAdvance(t, cardMeta, checker);
        }).then(function () { return { passed: true, rec: rec }; });
      }

      rec.status = STATUS.CORRECTION;
      return put(t, cardMeta, rec).then(function () {
        return WFPhase.reject(t, cardMeta, checker,
          "Did not pass QC: " +
          failedItems(round, rec).map(function (i) { return i.text; }).join("; "));
      }).then(function () { return { passed: false, rec: rec }; });
    });
  }

  /**
   * Self-check: the person who did the work ticks their own list and signs.
   *
   * Everything ticked -> the phase completes and advances, with them recorded as
   * the approver. Anything left unticked -> the record is saved so the list
   * survives a page reload, and the job stays exactly where it is, still theirs.
   * Deliberately never calls WFPhase.reject: there is no peer, so there is
   * nobody to reject it to, and "unfinished" is not the same as "wrong".
   *
   * results: [{ text, result: "pass"|"fail", note }]
   */
  /**
   * `signer` is who PUTS THEIR NAME TO IT, and it is not always the worker.
   *
   * On a peer-checked phase the person who built the job works the list at the
   * bench and somebody else vouches for it -- that second name is the entire
   * value of a peer check, and the old signature dropped it because there was
   * only ever one person in the call. It defaults to the worker, so a self-check
   * behaves exactly as it did.
   *
   * Both names are recorded: `checkedBy` is who ticked, `passedBy` is who
   * vouched. When they differ, the record says so on its own without anybody
   * having to remember the policy that produced it.
   */
  function submitSelfCheck(t, cardMeta, phaseName, worker, results, signer) {
    var vouches = signer || worker;
    return getTemplate(t, phaseName).then(function (tpl) {
      return getRecord(t, cardMeta.id).then(function (existing) {
        /* CONTINUE ANY RECORD FOR THIS PHASE, NOT ONLY A SELF ONE.
         *
         * This required `existing.mode === "self"` before, so a self-check
         * following a bench sign-off on the same phase built a fresh object and
         * `put` it — erasing the signature, the signer and every round. The
         * mode test was doing the job of "is this the same phase", which is
         * what listId already answers.
         *
         * The record's mode becomes the mode of the LATEST round, because that
         * is what the last person to put their name on it actually did.
         */
        var prior = carryOver(existing, cardMeta);
        var rec = prior || {
          listId: cardMeta.idList,
          phase: phaseName,
          requestedBy: person(worker),
          requestedFrom: person(vouches),
          requestedAt: nowIso(),
          template: tpl,
          rounds: []
        };
        rec.mode = "self";
        rec.phase = rec.phase || phaseName;
        rec.template = rec.template || tpl;
        rec.rounds = rec.rounds || [];

        /* THE RECORD-LEVEL SIGNATURE DESCRIBES THE LATEST ROUND, SO IT GOES.
         *
         * Carrying the record over keeps the rounds, which is the whole point.
         * But it was also keeping `signature`, `signedAt` and `signedBy` from an
         * earlier BENCH sign-off while stamping `mode: "self"` over the top --
         * a record that claimed to be a self-check and carried somebody else's
         * signature. floorSignOff asks for mode "floor", so a genuinely signed
         * job would have come back unsigned: Complete loses its tick, the
         * checklist reopens, and passSigned refuses a card that was signed.
         *
         * Nothing is lost. The bench round is still in `rounds` with its own
         * mode, signature and signer on it. What is cleared is only the claim
         * about where the record stands NOW -- and a re-check that has just
         * found something is not a passing signature. */
        delete rec.signature;
        delete rec.signedAt;
        delete rec.signedBy;
        delete rec.passedBy;
        delete rec.passedAt;

        // The template has to be on the record before the round can reference
        // it by position. A carried-over record already has one; a fresh one
        // takes it from the phase's saved list, and where the caller worked a
        // list the record has never seen, theirs wins.
        if (!rec.template || !rec.template.length) {
          rec.template = (results || []).map(function (r) {
            return { text: r.text, spec: r.spec || "" };
          });
        }
        var round = packRound(results);
        round.n = rec.rounds.length + 1;
        round.mode = "self";
        round.checkedBy = person(worker);
        round.checkedAt = nowIso();
        round.signedBy = person(vouches);
        rec.rounds.push(round);

        var outstanding = failedItems(round, rec);
        if (outstanding.length) {
          rec.status = STATUS.SELF_TODO;
          return put(t, cardMeta, rec).then(function () {
            return { passed: false, outstanding: outstanding, rec: rec };
          });
        }

        rec.status = "passed";
        rec.passedBy = person(vouches);
        rec.passedAt = nowIso();
        // complete() first so the phase is in the state approveAndAdvance
        // expects -- the peer path gets there via WFPhase.complete at hand-off
        // time, and a self-check has no separate hand-off.
        //
        // silent: true because the comment complete() would otherwise post says
        // "awaiting manager approval", and the very next line advances the card.
        // Nobody is awaiting anything; a comment that is wrong for a second is a
        // comment somebody screenshots.
        return put(t, cardMeta, rec)
          .then(function () { return WFPhase.complete(t, cardMeta, { silent: true }); })
          .then(function () { return WFPhase.approveAndAdvance(t, cardMeta, vouches); })
          .then(function () { return { passed: true, rec: rec }; });
      });
    });
  }

  /**
   * The person who did the work says what they did about each failed item and
   * signs. Goes back to the checker to verify those items only.
   * corrections: [{ text, whatIDid }]
   */
  function submitCorrections(t, cardMeta, worker, corrections) {
    return getRecord(t, cardMeta.id).then(function (rec) {
      var round = currentRound(rec);
      if (!rec || !round) throw new Error("No quality check is open on this job.");
      round.corrections = (corrections || []).map(function (c) {
        return { text: c.text, whatIDid: String(c.whatIDid || "").trim() };
      });
      round.correctedBy = person(worker);
      round.correctedAt = nowIso();
      rec.status = STATUS.VERIFY;
      return put(t, cardMeta, rec).then(function () { return rec; });
    });
  }

  /**
   * Checker verifies ONLY the items it was sent back for and signs.
   * verify: [{ text, ok, note }]
   * All ok -> advances. Any not ok -> a fresh round, back for correction.
   */
  function submitVerify(t, cardMeta, checker, verify) {
    return getRecord(t, cardMeta.id).then(function (rec) {
      var round = currentRound(rec);
      if (!rec || !round) throw new Error("No quality check is open on this job.");
      round.verify = (verify || []).map(function (v) {
        return { text: v.text, ok: !!v.ok, note: String(v.note || "").trim() };
      });
      round.verifiedBy = person(checker);
      round.verifiedAt = nowIso();

      var stillBad = round.verify.filter(function (v) { return !v.ok; });
      if (!stillBad.length) {
        rec.status = "passed";
        rec.passedBy = person(checker);
        rec.passedAt = nowIso();
        return put(t, cardMeta, rec).then(function () {
          return WFPhase.approveAndAdvance(t, cardMeta, checker);
        }).then(function () { return { passed: true, rec: rec }; });
      }

      // Still not right: open another round carrying the outstanding items.
      rec.rounds.push({
        n: rec.rounds.length + 1,
        checkedBy: person(checker),
        checkedAt: nowIso(),
        items: stillBad.map(function (v) {
          return { text: v.text, result: "fail", note: v.note };
        }),
        corrections: null, correctedBy: null, correctedAt: null,
        verifiedBy: null, verifiedAt: null, verify: null
      });
      rec.status = STATUS.CORRECTION;
      return put(t, cardMeta, rec).then(function () {
        return WFPhase.reject(t, cardMeta, checker,
          "Still not right after correction: " + stillBad.map(function (v) { return v.text; }).join("; "));
      }).then(function () { return { passed: false, rec: rec }; });
    });
  }

  /** Any record on the card, current phase or not -- for history views. */
  function anyRecord(card) {
    return (card && card.qcRecord) || null;
  }

  /** Flatten a record into readable lines, newest round last. */
  function summarize(rec) {
    var out = [];
    ((rec && rec.rounds) || []).forEach(function (rd) {
      roundItems(rec, rd).forEach(function (i) {
        if (i.result === "fail") {
          out.push({ round: rd.n, who: rd.checkedBy, at: rd.checkedAt,
                     what: "failed “" + i.text + "”", note: i.note });
        }
      });
      (rd.corrections || []).forEach(function (c) {
        out.push({ round: rd.n, who: rd.correctedBy, at: rd.correctedAt,
                   what: "fixed “" + c.text + "”", note: c.whatIDid });
      });
      (rd.verify || []).forEach(function (v) {
        out.push({ round: rd.n, who: rd.verifiedBy, at: rd.verifiedAt,
                   what: (v.ok ? "confirmed " : "rejected ") + "“" + v.text + "”",
                   note: v.note });
      });
    });
    return out;
  }

  function needsManagerAfterQc(card) {
    return (card.labels || []).some(function (l) {
      return String(l.name || "").trim().toLowerCase() === NEEDS_MANAGER;
    });
  }

  global.WFQC = {
    KEY: KEY, TEMPLATE_KEY: TEMPLATE_KEY, STATION_KEY: STATION_KEY, STATUS: STATUS,
    getStationChecklists: getStationChecklists,
    getStationChecklist: getStationChecklist,
    saveStationChecklist: saveStationChecklist,
    getLibrary: getLibrary, libraryNames: libraryNames,
    saveLibraryEntry: saveLibraryEntry, deleteLibraryEntry: deleteLibraryEntry,
    renameLibraryEntry: renameLibraryEntry,
    checklistNameFor: checklistNameFor, checklistFor: checklistFor,
    normItem: normItem,
    canSignOff: canSignOff, signHint: signHint, defaultStationItems: defaultStationItems,
    signOff: signOff, passSigned: passSigned,
    signOffAndPass: signOffAndPass, floorSignOff: floorSignOff,
    NEEDS_MANAGER: NEEDS_MANAGER,
    qcPhases: qcPhases, requiresQc: requiresQc,
    selfCheckPhases: selfCheckPhases, requiresSelfCheck: requiresSelfCheck,
    needsChecklist: needsChecklist, defaultTemplate: defaultTemplate,
    submitSelfCheck: submitSelfCheck,
    getTemplates: getTemplates, getTemplate: getTemplate, saveTemplate: saveTemplate,
    getRecord: getRecord, clear: clear, activeRecord: activeRecord,
    modeOf: modeOf,
    currentRound: currentRound, failedItems: failedItems,
    roundItems: roundItems, templateItems: templateItems, packRound: packRound,
    recordFaults: recordFaults, resolveFault: resolveFault,
    openFaults: openFaults, faultsOnRound: faultsOnRound, hasOpenFaults: hasOpenFaults,
    isFaultRound: isFaultRound,
    request: request, canReview: canReview, isOwner: isOwner,
    anyRecord: anyRecord, summarize: summarize,
    submitCheck: submitCheck, submitCorrections: submitCorrections, submitVerify: submitVerify,
    needsManagerAfterQc: needsManagerAfterQc
  };
})(window);
