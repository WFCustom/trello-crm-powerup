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

  var origApprove = global.WFPhase.approveAndAdvance;
  var origNextStage = global.WFStage.getNextStage;

  /** Phase names in board order, used to rejoin a route after a manual drag. */
  function shopOrder(boardId) {
    var cfg = global.WFStage.getBoardConfig(boardId);
    if (!cfg) return [];
    return (cfg.stages || [])
      .filter(function (s) { return s.isWorkPhase; })
      .sort(function (a, b) { return a.order - b.order; })
      .map(function (s) { return s.name; });
  }

  function stageByName(boardId, name) {
    var cfg = global.WFStage.getBoardConfig(boardId);
    if (!cfg || !name) return null;
    return (cfg.stages || []).filter(function (s) { return s.name === name; })[0] || null;
  }

  /** The Job Type recorded on this card, or null if the field isn't set. */
  function readJobType(t, cardMeta) {
    if (!global.WFRest || !global.WFRest.getNamedCustomFieldValues) return Promise.resolve(null);
    return global.WFRest
      .getNamedCustomFieldValues(t, cardMeta.idBoard, cardMeta.id)
      .then(function (vals) {
        if (!vals) return null;
        var key = Object.keys(vals).filter(function (k) {
          return String(k).trim().toLowerCase() === global.WFJobType.FIELD_NAME.toLowerCase();
        })[0];
        return key ? vals[key] : null;
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

  global.WFPhase.approveAndAdvance = function (t, cardMeta, manager) {
    return targetStage(t, cardMeta).then(function (target) {
      if (target === undefined) return origApprove(t, cardMeta, manager);

      var pinned = false;
      global.WFStage.getNextStage = function (boardId, listId) {
        if (!pinned && boardId === cardMeta.idBoard && listId === cardMeta.idList) {
          pinned = true;
          return target;     // null is meaningful: end of route, stay put
        }
        return origNextStage.apply(this, arguments);
      };

      function restore() { global.WFStage.getNextStage = origNextStage; }
      return origApprove(t, cardMeta, manager).then(
        function (r) { restore(); return r; },
        function (e) { restore(); throw e; }
      );
    });
  };

  global.WFPhase.__routeAware = true;
  global.WFPhase.__targetStage = targetStage;   // exposed for testing
})(window);
