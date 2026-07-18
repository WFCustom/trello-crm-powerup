/**
 * Shared phase-flow logic: claim -> start/pause -> complete -> manager
 * approval -> auto-advance to next stage. Used by connector.js (card
 * buttons), popups/myjobs.js, and popups/approvals.js so the state machine
 * only lives in one place.
 *
 * Storage: card-scoped "shared" Power-Up data (visible to all board members,
 * no external database):
 *   phaseWork  = { listId, claimedBy, segments: [{start,end}], pendingApproval, completedAt }
 *   phaseLog   = [ { listId, listName, claimedBy, durationMinutes, completedAt, approvedBy, approvedAt }, ... ]
 */
(function (global) {
  async function getPhaseWork(t) {
    return (await t.get("card", "shared", "phaseWork", null)) || null;
  }

  // Returns phaseWork only if it belongs to the card's CURRENT list -- once a
  // card is approved and moved, any leftover phaseWork is stale and ignored.
  async function getActivePhaseWork(t, card) {
    const work = await getPhaseWork(t);
    if (work && work.listId === card.idList) return work;
    return null;
  }

  function totalMinutes(work) {
    if (!work || !work.segments) return 0;
    let ms = 0;
    work.segments.forEach((seg) => {
      const end = seg.end ? new Date(seg.end) : new Date();
      ms += end - new Date(seg.start);
    });
    return Math.round(ms / 60000);
  }

  function isRunning(work) {
    if (!work || !work.segments || !work.segments.length) return false;
    const last = work.segments[work.segments.length - 1];
    return !last.end;
  }

  // Manager assigns a specific worker to this phase without starting the
  // timer -- distinct from Trello's native card-member picker, so it doesn't
  // get mixed up with unrelated "who's watching this card" assignments.
  // The worker still taps Start when they actually begin.
  async function assign(t, card, manager, worker) {
    const work = {
      listId: card.idList,
      claimedBy: { id: worker.id, username: worker.username, fullName: worker.fullName },
      assignedBy: { id: manager.id, username: manager.username, fullName: manager.fullName },
      segments: [],
      pendingApproval: false,
      completedAt: null
    };
    await t.set("card", "shared", "phaseWork", work);
    try { await global.WFRest.addMemberToCard(t, card.id, worker.id); } catch (e) { /* non-fatal */ }
    try {
      await global.WFRest.postComment(t, card.id, manager.fullName + " assigned this phase to " + worker.fullName + ".");
    } catch (e) { /* non-fatal */ }
    return work;
  }

  async function claimAndStart(t, card, member) {
    const work = {
      listId: card.idList,
      claimedBy: { id: member.id, username: member.username, fullName: member.fullName },
      segments: [{ start: new Date().toISOString(), end: null }],
      pendingApproval: false,
      completedAt: null
    };
    await t.set("card", "shared", "phaseWork", work);
    try { await global.WFRest.addMemberToCard(t, card.id, member.id); } catch (e) { /* non-fatal */ }
    return work;
  }

  async function pause(t, card) {
    const work = await getActivePhaseWork(t, card);
    if (!work || !isRunning(work)) return work;
    work.segments[work.segments.length - 1].end = new Date().toISOString();
    await t.set("card", "shared", "phaseWork", work);
    return work;
  }

  async function resume(t, card) {
    const work = await getActivePhaseWork(t, card);
    if (!work || isRunning(work)) return work;
    work.segments.push({ start: new Date().toISOString(), end: null });
    await t.set("card", "shared", "phaseWork", work);
    return work;
  }

  async function complete(t, card) {
    const work = await getActivePhaseWork(t, card);
    if (!work) return null;
    if (isRunning(work)) work.segments[work.segments.length - 1].end = new Date().toISOString();
    work.pendingApproval = true;
    work.completedAt = new Date().toISOString();
    await t.set("card", "shared", "phaseWork", work);
    try {
      await global.WFRest.postComment(
        t, card.id,
        "Marked complete by " + work.claimedBy.fullName + " after " + totalMinutes(work) + " min -- awaiting manager approval."
      );
    } catch (e) { /* non-fatal, comment is a nice-to-have audit trail */ }
    return work;
  }

  // Mis-tap recovery: reopen a card that was marked complete, resuming the timer.
  async function undoComplete(t, card) {
    const work = await getActivePhaseWork(t, card);
    if (!work || !work.pendingApproval) return work;
    work.pendingApproval = false;
    work.completedAt = null;
    work.segments.push({ start: new Date().toISOString(), end: null });
    await t.set("card", "shared", "phaseWork", work);
    return work;
  }

  // Manager action: log the finished phase, clear the working state, and
  // move the card to the next configured stage (if any).
  async function approveAndAdvance(t, card, manager) {
    const work = await getActivePhaseWork(t, card);
    if (!work || !work.pendingApproval) throw new Error("Nothing awaiting approval on this card.");

    const stage = global.WFStage.getStageForList(card.idBoard, card.idList);
    const logEntry = {
      listId: card.idList,
      listName: stage ? stage.name : card.idList,
      claimedBy: work.claimedBy,
      durationMinutes: totalMinutes(work),
      completedAt: work.completedAt,
      approvedBy: { id: manager.id, username: manager.username, fullName: manager.fullName },
      approvedAt: new Date().toISOString()
    };

    const log = (await t.get("card", "shared", "phaseLog", [])) || [];
    const updatedLog = log.concat([logEntry]).slice(-30);
    await t.set("card", "shared", "phaseLog", updatedLog);
    await t.remove("card", "shared", "phaseWork");

    const next = global.WFStage.getNextStage(card.idBoard, card.idList);
    if (next) {
      await global.WFRest.moveCard(t, card.id, next.listId);
      await global.WFRest.postComment(
        t, card.id,
        "Approved by " + manager.fullName + " (" + logEntry.listName + ", " + logEntry.durationMinutes +
        " min by " + work.claimedBy.fullName + "). Moved to " + next.name + "."
      );
    } else {
      await global.WFRest.postComment(
        t, card.id,
        "Approved by " + manager.fullName + " (" + logEntry.listName + ", " + logEntry.durationMinutes +
        " min by " + work.claimedBy.fullName + "). No next stage configured -- card left in place."
      );
    }
    return { logEntry, movedTo: next };
  }

  // Manager reject: clear pendingApproval without advancing, e.g. QC failed.
  async function reject(t, card, manager, reason) {
    const work = await getActivePhaseWork(t, card);
    if (!work) return null;
    work.pendingApproval = false;
    work.completedAt = null;
    work.segments.push({ start: new Date().toISOString(), end: null });
    await t.set("card", "shared", "phaseWork", work);
    try {
      await global.WFRest.postComment(
        t, card.id,
        "Sent back by " + manager.fullName + (reason ? (": " + reason) : " (no reason given).") + " Timer resumed."
      );
    } catch (e) { /* non-fatal */ }
    return work;
  }

  global.WFPhase = {
    getPhaseWork,
    getActivePhaseWork,
    totalMinutes,
    isRunning,
    assign,
    claimAndStart,
    pause,
    resume,
    complete,
    undoComplete,
    approveAndAdvance,
    reject
  };
})(window);
