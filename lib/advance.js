/**
 * Route-aware auto-advance.
 *
 * approveAndAdvance() in lib/phase.js decides where a card goes by asking
 * WFStage.getNextStage(boardId, listId) -- the next column in a flat order.
 * That's why a plain railing leaving Print CAD was being pushed into CNC.
 *
 * This wraps approveAndAdvance rather than editing lib/phase.js. That file is
 * the tested state machine everything else depends on, and a wrapper is a
 * change that can be read, reasoned about and removed in one piece. Folding it
 * into phase.js is a tidy-up for later, not a behaviour change.
 *
 * How it works: before approving, we look up the card's Job Type, work out the
 * right destination from that type's route, and pin getNextStage to return it
 * for this one card. The original approveAndAdvance then does everything it
 * always did -- logs the phase, posts the audit comment, moves the card.
 */
(function (global) {
  "use strict";

  if (!global.WFPhase || !global.WFStage || !global.WFJobType) return;
  if (global.WFPhase.__routeAware) return;          // never wrap twice

  /* Wraps `advance`, NOT `approveAndAdvance`.
   *
   * advance() is the single place a phase is retired and a card is moved;
   * approveAndAdvance now just checks the approval flag and delegates to it. So
   * wrapping advance catches every route into the move -- manager approval, a
   * signed QC checklist, a self-check -- where wrapping approveAndAdvance would
   * have caught only the first, and the QC path would have silently gone back
   * to the flat column order. That is the same class of bug this file exists to
   * fix, so it is worth being explicit about. */
  var origApprove = global.WFPhase.advance;
  var origNextStage = global.WFStage.getNextStage;

  /**
   * Stage names in board order, used to rejoin a route after a manual drag.
   *
   * Every mapped stage counts, not just the work phases. nextPhase() locates
   * the card's current stage in this list and looks forward for the next step
   * its route contains; a stage missing from the list scores -1 and sends the
   * job back to the START of its route. When only work phases were listed,
   * that made every office stage look like the beginning of the job -- correct
   * for Intake, but it meant approving a card parked in Billing marched it back
   * to CAD. Including the office stages puts Billing after Install, where it
   * belongs, and the answer becomes "nothing left to do".
   *
   * nextPhase() can only ever return a name the route already contains, so
   * widening this list cannot introduce a new destination.
   */
  function shopOrder(boardId) {
    var cfg = global.WFStage.getBoardConfig(boardId);
    if (!cfg) return [];
    return (cfg.stages || [])
      .slice()
      .sort(function (a, b) { return a.order - b.order; })
      .map(function (s) { return s.name; });
  }

  /* Delegates to WFStage so the isPrimaryTarget tie-break is applied. Taking
     the first name match here sent every job to "Next week" Install rather
     than Install Central, because all four Install lists share one name. */
  function stageByName(boardId, name) {
    if (global.WFStage.getStageByName) {
      return global.WFStage.getStageByName(boardId, name);
    }
    // Older cached lib/stage.js: keep the tie-break rather than inherit the bug.
    var cfg = global.WFStage.getBoardConfig(boardId);
    if (!cfg || !name) return null;
    var m = (cfg.stages || []).filter(function (s) { return s.name === name; });
    if (!m.length) return null;
    return m.filter(function (s) { return s.isPrimaryTarget; })[0] || m[0];
  }

  /**
   * The Job Type recorded on this card, or null if the field isn't set.
   *
   * THIS WAS BROKEN AND THE FAILURE WAS SILENT. It used to ask
   * `getNamedCustomFieldValues`, which returns exactly three keys --
   * jobValue, jobCost, leadReceivedAt (lib/trello-rest.js) -- and never a job
   * type. So the lookup always missed, every card read as "no type set", and
   * every card took the default legacy route. CNC and CAP work was quietly
   * routed down the wrong path with nothing anywhere reporting a problem.
   *
   * `getCardFieldsDisplay` is the right call: it resolves EVERY custom field on
   * the card to its display string, including list-type fields resolved against
   * the board's own option labels -- which is what a dropdown like Job Type is.
   *
   * Returning null on failure is deliberate and unchanged: an unreadable type
   * falls back to the default route rather than stalling the card. The bug was
   * never the fallback, it was that the fallback was the only path.
   */
  function readJobType(t, cardMeta) {
    if (!global.WFRest || !global.WFRest.getCardFieldsDisplay) return Promise.resolve(null);
    var wanted = String(global.WFJobType.FIELD_NAME).trim().toLowerCase();
    return global.WFRest
      .getCardFieldsDisplay(t, cardMeta.idBoard, cardMeta.id)
      .then(function (fields) {
        var hit = (fields || []).filter(function (f) {
          return String(f && f.name || "").trim().toLowerCase() === wanted;
        })[0];
        return hit ? hit.display : null;
      })
      .catch(function () { return null; });
  }

  function targetStage(t, cardMeta) {
    return readJobType(t, cardMeta).then(function (jobType) {
      var cfg = global.WFStage.getBoardConfig(cardMeta.idBoard);
      var here = cfg && (cfg.stages || []).filter(function (s) {
        return s.listId === cardMeta.idList;
      })[0];
      if (!here) return undefined;   // unmapped list: leave the original behaviour alone

      var name = global.WFJobType.nextPhase(
        { jobType: jobType }, here.name, shopOrder(cardMeta.idBoard)
      );
      if (!name) return null;        // end of this job's route: don't move it on
      return stageByName(cardMeta.idBoard, name);
    }).catch(function () { return undefined; });
  }

  global.WFPhase.advance = function (t, cardMeta, by, opts) {
    return targetStage(t, cardMeta).then(function (target) {
      if (target === undefined) return origApprove(t, cardMeta, by, opts);

      var pinned = false;
      global.WFStage.getNextStage = function (boardId, listId) {
        if (!pinned && boardId === cardMeta.idBoard && listId === cardMeta.idList) {
          pinned = true;
          return target;     // null is meaningful: end of route, stay put
        }
        return origNextStage.apply(this, arguments);
      };

      function restore() { global.WFStage.getNextStage = origNextStage; }
      return origApprove(t, cardMeta, by, opts).then(
        function (r) { restore(); return r; },
        function (e) { restore(); throw e; }
      );
    });
  };

  global.WFPhase.__routeAware = true;
  global.WFPhase.__targetStage = targetStage;   // exposed for testing
})(window);
