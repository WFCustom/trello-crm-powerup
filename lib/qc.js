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

  /** Managers only, enforced by the UI. Affects future checks, never past ones. */
  function saveTemplate(t, phaseName, items) {
    return getTemplates(t).then(function (all) {
      all[phaseName] = (items || [])
        .map(function (s) { return String(s || "").trim(); })
        .filter(Boolean);
      return t.set("board", "shared", TEMPLATE_KEY, all).then(function () { return all; });
    });
  }

  /* ---------------------------------------------------------------- record */

  function getRecord(t, cardId) {
    return t.get(cardId, "shared", KEY, null);
  }

  function put(t, cardMeta, rec) {
    return t.set(cardMeta.id, "shared", KEY, rec).then(function () { return rec; });
  }

  function clear(t, cardMeta) {
    return t.set(cardMeta.id, "shared", KEY, null);
  }

  /** A record still belonging to the card's current phase, else null. */
  function activeRecord(card) {
    var r = card && card.qcRecord;
    if (!r) return null;
    if (r.listId && card.idList && r.listId !== card.idList) return null;
    return r;
  }

  function currentRound(rec) {
    if (!rec || !rec.rounds || !rec.rounds.length) return null;
    return rec.rounds[rec.rounds.length - 1];
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

  function failedItems(round) {
    return ((round && round.items) || []).filter(function (i) { return i.result === "fail"; });
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
      var round = {
        n: rec.rounds.length + 1,
        checkedBy: person(checker),
        checkedAt: nowIso(),
        items: (results || []).map(function (r) {
          return { text: r.text, result: r.result, note: String(r.note || "").trim() };
        }),
        corrections: null, correctedBy: null, correctedAt: null,
        verifiedBy: null, verifiedAt: null, verify: null
      };
      rec.rounds.push(round);

      if (!failedItems(round).length) {
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
          "Did not pass QC: " + failedItems(round).map(function (i) { return i.text; }).join("; "));
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
  function submitSelfCheck(t, cardMeta, phaseName, worker, results) {
    return getTemplate(t, phaseName).then(function (tpl) {
      return getRecord(t, cardMeta.id).then(function (existing) {
        var rec = (existing && existing.listId === cardMeta.idList &&
                   existing.mode === "self")
          ? existing
          : {
              listId: cardMeta.idList,
              phase: phaseName,
              mode: "self",
              requestedBy: person(worker),
              requestedFrom: person(worker),
              requestedAt: nowIso(),
              template: tpl,
              rounds: []
            };
        rec.rounds = rec.rounds || [];
        var round = {
          n: rec.rounds.length + 1,
          checkedBy: person(worker),
          checkedAt: nowIso(),
          items: (results || []).map(function (r) {
            return { text: r.text, result: r.result, note: String(r.note || "").trim() };
          }),
          corrections: null, correctedBy: null, correctedAt: null,
          verifiedBy: null, verifiedAt: null, verify: null
        };
        rec.rounds.push(round);

        var outstanding = failedItems(round);
        if (outstanding.length) {
          rec.status = STATUS.SELF_TODO;
          return put(t, cardMeta, rec).then(function () {
            return { passed: false, outstanding: outstanding, rec: rec };
          });
        }

        rec.status = "passed";
        rec.passedBy = person(worker);
        rec.passedAt = nowIso();
        // complete() first so the phase is in the state approveAndAdvance
        // expects -- the peer path gets there via WFPhase.complete at hand-off
        // time, and a self-check has no separate hand-off.
        return put(t, cardMeta, rec)
          .then(function () { return WFPhase.complete(t, cardMeta); })
          .then(function () { return WFPhase.approveAndAdvance(t, cardMeta, worker); })
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
      (rd.items || []).forEach(function (i) {
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
    KEY: KEY, TEMPLATE_KEY: TEMPLATE_KEY, STATUS: STATUS,
    NEEDS_MANAGER: NEEDS_MANAGER,
    qcPhases: qcPhases, requiresQc: requiresQc,
    selfCheckPhases: selfCheckPhases, requiresSelfCheck: requiresSelfCheck,
    needsChecklist: needsChecklist, defaultTemplate: defaultTemplate,
    submitSelfCheck: submitSelfCheck,
    getTemplates: getTemplates, getTemplate: getTemplate, saveTemplate: saveTemplate,
    getRecord: getRecord, clear: clear, activeRecord: activeRecord,
    currentRound: currentRound, failedItems: failedItems,
    request: request, canReview: canReview, isOwner: isOwner,
    anyRecord: anyRecord, summarize: summarize,
    submitCheck: submitCheck, submitCorrections: submitCorrections, submitVerify: submitVerify,
    needsManagerAfterQc: needsManagerAfterQc
  };
})(window);
