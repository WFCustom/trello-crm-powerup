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

  /* Only these phases gate on QC for now. Everything else advances on approval
     as before. Override with WF_CONFIG.qcPhases. */
  var DEFAULT_QC_PHASES = ["Assemble", "Sandblast / Powder Coat"];

  var STATUS = {
    CHECK: "awaiting_check",
    CORRECTION: "awaiting_correction",
    VERIFY: "awaiting_verify"
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

  /* ------------------------------------------------------------- templates */

  function getTemplates(t) {
    return t.get("board", "shared", TEMPLATE_KEY, null).then(function (v) {
      return (v && typeof v === "object") ? v : {};
    });
  }

  function getTemplate(t, phaseName) {
    return getTemplates(t).then(function (all) {
      var items = all[phaseName];
      return Array.isArray(items) ? items.slice() : [];
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
                     what: "failed \u201c" + i.text + "\u201d", note: i.note });
        }
      });
      (rd.corrections || []).forEach(function (c) {
        out.push({ round: rd.n, who: rd.correctedBy, at: rd.correctedAt,
                   what: "fixed \u201c" + c.text + "\u201d", note: c.whatIDid });
      });
      (rd.verify || []).forEach(function (v) {
        out.push({ round: rd.n, who: rd.verifiedBy, at: rd.verifiedAt,
                   what: (v.ok ? "confirmed " : "rejected ") + "\u201c" + v.text + "\u201d",
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
    getTemplates: getTemplates, getTemplate: getTemplate, saveTemplate: saveTemplate,
    getRecord: getRecord, clear: clear, activeRecord: activeRecord,
    currentRound: currentRound, failedItems: failedItems,
    request: request, canReview: canReview, isOwner: isOwner,
    anyRecord: anyRecord, summarize: summarize,
    submitCheck: submitCheck, submitCorrections: submitCorrections, submitVerify: submitVerify,
    needsManagerAfterQc: needsManagerAfterQc
  };
})(window);
