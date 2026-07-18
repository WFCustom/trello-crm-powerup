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
  async function getPhaseWork(t) {/**
 * Shared phase-flow logic: claim/accept/decline -> start/pause -> complete ->
 * manager approval -> auto-advance to next stage. Used by connector.js (card
 * buttons, if/when they render) and by popups/myjobs.js (the fullscreen "My
 * Jobs" dashboard), which is the primary, always-working surface for this --
 * see README for why.
 *
 * IMPORTANT: every function here takes a card ID (string), not a Trello card
 * object, and calls t.get()/t.set()/t.remove() with that ID as the scope
 * instead of the literal string "card". Per Trello's docs
 * (client-library/getting-and-setting-data), "you can set data on a card from
 * any context by calling t.set with its ID" -- this is what lets My Jobs
 * claim/start/pause/complete ANY card directly from one board-level modal,
 * without needing that card open in an iframe of its own. The literal-"card"
 * scope only works when Trello considers a card "in scope" (i.e. you're
 * already inside that card's own capability/iframe) -- using the ID instead
 * is a strict superset that works everywhere, including from inside the
 * card's own context, so connector.js uses it too for consistency.
 *
 * Storage (per card, scope = that card's ID, visibility = "shared"):
 *   phaseWork = {
 *     listId, claimedBy, assignedBy,
 *     segments: [{start,end}],       // start/stop timer log
 *     pendingApproval, completedAt,
 *     percentComplete                // 0-100, settable any time
 *   }
 *   phaseLog = [ { listId, listName, claimedBy, durationMinutes, completedAt, approvedBy, approvedAt }, ... ]
 */
(function (global) {
  async function getPhaseWork(t, cardId) {
    return (await t.get(cardId, "shared", "phaseWork", null)) || null;
  }

  // Returns phaseWork only if it belongs to the card's CURRENT list -- once a
  // card is approved and moved, any leftover phaseWork is stale and ignored.
  // cardMeta needs at least { id, idList }.
  async function getActivePhaseWork(t, cardMeta) {
    const work = await getPhaseWork(t, cardMeta.id);
    if (work && work.listId === cardMeta.idList) return work;
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

  function percentComplete(work) {
    if (!work || typeof work.percentComplete !== "number") return 0;
    return Math.max(0, Math.min(100, work.percentComplete));
  }

  async function setPercentComplete(t, cardMeta, percent) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work) return null;
    work.percentComplete = Math.max(0, Math.min(100, Math.round(percent)));
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    return work;
  }

  // Manager assigns a specific worker to this phase without starting the
  // timer -- distinct from Trello's native card-member picker, so it doesn't
  // get mixed up with unrelated "who's watching this card" assignments.
  // The worker still taps Accept (or Start) when they actually begin.
  async function assign(t, cardMeta, manager, worker) {
    const work = {
      listId: cardMeta.idList,
      claimedBy: { id: worker.id, username: worker.username, fullName: worker.fullName },
      assignedBy: { id: manager.id, username: manager.username, fullName: manager.fullName },
      segments: [],
      pendingApproval: false,
      completedAt: null,
      percentComplete: 0
    };
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    try { await global.WFRest.addMemberToCard(t, cardMeta.id, worker.id); } catch (e) { /* non-fatal */ }
    try {
      await global.WFRest.postComment(t, cardMeta.id, manager.fullName + " assigned this phase to " + worker.fullName + ".");
    } catch (e) { /* non-fatal */ }
    return work;
  }

  // Worker declines a manager assignment -- clears it back to unclaimed so
  // anyone else (or a manager) can reassign. Distinct from Undo, which is for
  // a worker's OWN mis-tap on Complete.
  async function declineAssignment(t, cardMeta, worker, reason) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work) return null;
    try {
      await global.WFRest.postComment(
        t, cardMeta.id,
        worker.fullName + " declined this assignment" + (reason ? (": " + reason) : ".")
      );
    } catch (e) { /* non-fatal */ }
    await t.remove(cardMeta.id, "shared", "phaseWork");
    return null;
  }

  async function claimAndStart(t, cardMeta, member) {
    const work = {
      listId: cardMeta.idList,
      claimedBy: { id: member.id, username: member.username, fullName: member.fullName },
      segments: [{ start: new Date().toISOString(), end: null }],
      pendingApproval: false,
      completedAt: null,
      percentComplete: 0
    };
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    try { await global.WFRest.addMemberToCard(t, cardMeta.id, member.id); } catch (e) { /* non-fatal */ }
    return work;
  }

  // Worker accepts a manager assignment and starts the timer -- same effect
  // as "Start", named separately so the UI can offer Accept/Decline together.
  async function acceptAssignment(t, cardMeta) {
    return resume(t, cardMeta);
  }

  async function pause(t, cardMeta) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work || !isRunning(work)) return work;
    work.segments[work.segments.length - 1].end = new Date().toISOString();
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    return work;
  }

  async function resume(t, cardMeta) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work || isRunning(work)) return work;
    work.segments.push({ start: new Date().toISOString(), end: null });
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    return work;
  }

  async function complete(t, cardMeta) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work) return null;
    if (isRunning(work)) work.segments[work.segments.length - 1].end = new Date().toISOString();
    work.pendingApproval = true;
    work.completedAt = new Date().toISOString();
    work.percentComplete = 100;
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    try {
      await global.WFRest.postComment(
        t, cardMeta.id,
        "Marked complete by " + work.claimedBy.fullName + " after " + totalMinutes(work) + " min -- awaiting manager approval."
      );
    } catch (e) { /* non-fatal, comment is a nice-to-have audit trail */ }
    return work;
  }

  // Mis-tap recovery: reopen a card that was marked complete, resuming the timer.
  async function undoComplete(t, cardMeta) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work || !work.pendingApproval) return work;
    work.pendingApproval = false;
    work.completedAt = null;
    work.segments.push({ start: new Date().toISOString(), end: null });
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    return work;
  }

  // Manager action: log the finished phase, clear the working state, and
  // move the card to the next configured stage (if any). cardMeta needs
  // { id, idList, idBoard }.
  async function approveAndAdvance(t, cardMeta, manager) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work || !work.pendingApproval) throw new Error("Nothing awaiting approval on this card.");

    const stage = global.WFStage.getStageForList(cardMeta.idBoard, cardMeta.idList);
    const logEntry = {
      listId: cardMeta.idList,
      listName: stage ? stage.name : cardMeta.idList,
      claimedBy: work.claimedBy,
      durationMinutes: totalMinutes(work),
      completedAt: work.completedAt,
      approvedBy: { id: manager.id, username: manager.username, fullName: manager.fullName },
      approvedAt: new Date().toISOString()
    };

    const log = (await t.get(cardMeta.id, "shared", "phaseLog", [])) || [];
    const updatedLog = log.concat([logEntry]).slice(-30);
    await t.set(cardMeta.id, "shared", "phaseLog", updatedLog);
    await t.remove(cardMeta.id, "shared", "phaseWork");

    const next = global.WFStage.getNextStage(cardMeta.idBoard, cardMeta.idList);
    if (next) {
      await global.WFRest.moveCard(t, cardMeta.id, next.listId);
      await global.WFRest.postComment(
        t, cardMeta.id,
        "Approved by " + manager.fullName + " (" + logEntry.listName + ", " + logEntry.durationMinutes +
        " min by " + work.claimedBy.fullName + "). Moved to " + next.name + "."
      );
    } else {
      await global.WFRest.postComment(
        t, cardMeta.id,
        "Approved by " + manager.fullName + " (" + logEntry.listName + ", " + logEntry.durationMinutes +
        " min by " + work.claimedBy.fullName + "). No next stage configured -- card left in place."
      );
    }
    return { logEntry, movedTo: next };
  }

  // Manager reject: clear pendingApproval without advancing, e.g. QC failed.
  async function reject(t, cardMeta, manager, reason) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work) return null;
    work.pendingApproval = false;
    work.completedAt = null;
    work.segments.push({ start: new Date().toISOString(), end: null });
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    try {
      await global.WFRest.postComment(
        t, cardMeta.id,
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
    percentComplete,
    setPercentComplete,
    assign,
    declineAssignment,
    claimAndStart,
    acceptAssignment,
    pause,
    resume,
    complete,
    undoComplete,
    approveAndAdvance,
    reject
  };
})(window);

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
