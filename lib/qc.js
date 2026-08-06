/**
 * WFQC -- peer quality check between finishing a phase and it moving on.
 *
 * A welder finishing a shop phase either names someone to check their work or
 * releases it to the pool for any qualified peer to pick up. The peer's
 * sign-off IS the approval for shop phases -- there is no second manager gate,
 * which in a five-person shop would just be friction. (A card-level
 * "needs shop manager approval" tag is the planned override; see NEEDS_MANAGER.)
 *
 * Deliberately kept out of lib/phase.js. The phase state machine is the tested
 * spine of this Power-Up, so QC rides alongside it in its own card key and then
 * hands off to the existing, proven approveAndAdvance / reject calls. Passing QC
 * is therefore exactly an approval -- it writes the same phaseLog entry and
 * posts the same audit comment -- with the peer recorded as who approved it.
 */
(function (global) {
  "use strict";

  var KEY = "qcRequest";

  /** Card label that forces a manager sign-off even after QC passes. */
  var NEEDS_MANAGER = "needs shop manager approval";

  function nowIso() { return new Date().toISOString(); }

  function person(p) {
    if (!p) return null;
    return { id: p.id || null, username: p.username || null, fullName: p.fullName || p.username || null };
  }

  function getRequest(t, cardId) {
    return t.get(cardId, "shared", KEY, null);
  }

  /**
   * Ask for a check. reviewer === null means "release to the pool".
   */
  function request(t, cardMeta, requester, reviewer) {
    var req = {
      requestedBy: person(requester),
      requestedFrom: person(reviewer),      // null => pool
      requestedAt: nowIso(),
      listId: cardMeta.idList               // the phase being checked
    };
    return t.set(cardMeta.id, "shared", KEY, req).then(function () { return req; });
  }

  function clear(t, cardMeta) {
    return t.set(cardMeta.id, "shared", KEY, null);
  }

  /** A request still belonging to the card's current phase, else null. */
  function activeRequest(card) {
    var r = card && card.qcRequest;
    if (!r) return null;
    if (r.listId && card.idList && r.listId !== card.idList) return null;
    return r;
  }

  /** Can this person action the check? Named reviewer, or anyone if pooled. */
  function canReview(req, username) {
    if (!req) return false;
    if (!req.requestedFrom) return true;                       // pool
    return req.requestedFrom.username === username;
  }

  /** Don't ask someone to check their own work. */
  function isSelfCheck(req, username) {
    return !!(req && req.requestedBy && req.requestedBy.username === username);
  }

  function needsManagerAfterQc(card) {
    return (card.labels || []).some(function (l) {
      return String(l.name || "").trim().toLowerCase() === NEEDS_MANAGER;
    });
  }

  /**
   * Peer signs it off. This performs the real approval, so the card advances
   * and phaseLog records the peer as approvedBy -- which is accurate, they are
   * the one who approved it.
   */
  function pass(t, cardMeta, reviewer) {
    return clear(t, cardMeta).then(function () {
      return WFPhase.approveAndAdvance(t, cardMeta, reviewer);
    });
  }

  /** Peer sends it back to the person who did the work. */
  function fail(t, cardMeta, reviewer, reason) {
    return clear(t, cardMeta).then(function () {
      return WFPhase.reject(t, cardMeta, reviewer, reason || "Did not pass QC");
    });
  }

  global.WFQC = {
    KEY: KEY,
    NEEDS_MANAGER: NEEDS_MANAGER,
    getRequest: getRequest,
    request: request,
    clear: clear,
    activeRequest: activeRequest,
    canReview: canReview,
    isSelfCheck: isSelfCheck,
    needsManagerAfterQc: needsManagerAfterQc,
    pass: pass,
    fail: fail
  };
})(window);
