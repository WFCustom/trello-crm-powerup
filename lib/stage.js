/**
 * Stage helpers — pure functions, no Trello API calls, so they're easy to
 * unit-test and reuse across badges/popups/dashboard.
 */
(function (global) {
  const CFG = global.WF_CONFIG;

  function getBoardConfig(boardId) {
    return (CFG && CFG.boards && CFG.boards[boardId]) || null;
  }

  // Returns the stage descriptor for a given list, or null if the list is
  // excluded/unknown on that board.
  function getStageForList(boardId, listId) {
    const board = getBoardConfig(boardId);
    if (!board) return null;
    const stage = board.stages.find((s) => s.listId === listId);
    return stage || null;
  }

  function isExcluded(boardId, listId) {
    const board = getBoardConfig(boardId);
    if (!board) return true;
    return board.excludedLists.indexOf(listId) !== -1;
  }

  function daysSince(isoDate) {
    if (!isoDate) return null;
    const ms = Date.now() - new Date(isoDate).getTime();
    return ms / (1000 * 60 * 60 * 24);
  }

  function formatDuration(days) {
    if (days === null || days === undefined || isNaN(days)) return "—";
    if (days < 1) {
      const hrs = Math.max(1, Math.round(days * 24));
      return hrs + "h";
    }
    return Math.round(days * 10) / 10 + "d";
  }

  // 'green' | 'amber' | 'red' | null (null = no SLA defined for this stage)
  function colorForElapsed(stage, daysElapsed) {
    if (!stage || stage.slaDays === null || stage.slaDays === undefined) return null;
    if (daysElapsed === null) return null;
    const frac = daysElapsed / stage.slaDays;
    const t = CFG.thresholds;
    if (frac >= t.redAt) return "red";
    if (frac >= t.amberAt) return "amber";
    return "green";
  }

  // Trello badge color names (limited palette) mapped from our semantic colors
  const TRELLO_BADGE_COLOR = { green: "green", amber: "yellow", red: "red" };


  // Given the list a card is currently in, find the next stage to advance to
  // when a manager approves a completed phase. Picks the lowest order greater
  // than the current stage's order; if several stages share that order
  // (e.g. this board's four separate "Install" lists), prefers the one
  // flagged isPrimaryTarget, else just the first one listed.
  function getNextStage(boardId, currentListId) {
    const board = getBoardConfig(boardId);
    if (!board) return null;
    const current = board.stages.find((s) => s.listId === currentListId);
    if (!current) return null;

    // Exception branches (e.g. ReWork) sit at a real order number but
    // shouldn't be the automatic "next" target from normal forward progress
    // -- a card only lands there if someone deliberately moves it.
    const candidates = board.stages.filter((s) => s.order > current.order && !s.isException);
    if (!candidates.length) return null;
    const minOrder = Math.min(...candidates.map((s) => s.order));
    const atMinOrder = candidates.filter((s) => s.order === minOrder);
    return atMinOrder.find((s) => s.isPrimaryTarget) || atMinOrder[0];
  }

  function isManager(username) {
    const managers = (CFG && CFG.managers) || [];
    return managers.indexOf(username) !== -1;
  }

  global.WFStage = {
    getBoardConfig,
    getStageForList,
    isExcluded,
    daysSince,
    formatDuration,
    colorForElapsed,
    TRELLO_BADGE_COLOR,
    getNextStage,
    isManager
  };
})(window);
