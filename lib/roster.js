/**
 * Roster helpers -- adaptive, board-pluginData-backed store for managers and
 * per-phase specialists. Falls back to the hardcoded config.js lists until a
 * board saves its own roster for the first time, so nothing breaks for boards
 * that never touch the new Team Roster UI.
 */
(function (global) {
  const KEY = "wfRoster";

  function defaultsFromConfig() {
    const cfg = global.WF_CONFIG || {};
    return {
      managers: Array.isArray(cfg.managers) ? cfg.managers.slice() : [],
      phaseSpecialists: cfg.phaseSpecialists
        ? JSON.parse(JSON.stringify(cfg.phaseSpecialists))
        : {}
    };
  }

  async function getRoster(t) {
    const board = await t.board("id");
    const stored = await t.get(board.id, "shared", KEY, null);
    const base = defaultsFromConfig();
    if (!stored) return base;
    return {
      managers: Array.isArray(stored.managers) ? stored.managers.slice() : base.managers,
      phaseSpecialists:
        stored.phaseSpecialists && typeof stored.phaseSpecialists === "object"
          ? JSON.parse(JSON.stringify(stored.phaseSpecialists))
          : base.phaseSpecialists
    };
  }

  async function saveRoster(t, roster) {
    const board = await t.board("id");
    await t.set(board.id, "shared", KEY, roster);
    return roster;
  }

  async function addManager(t, username) {
    const roster = await getRoster(t);
    username = (username || "").trim();
    if (!username) return roster;
    if (roster.managers.indexOf(username) === -1) roster.managers.push(username);
    return saveRoster(t, roster);
  }

  async function removeManager(t, username) {
    const roster = await getRoster(t);
    roster.managers = roster.managers.filter((m) => m !== username);
    return saveRoster(t, roster);
  }

  async function addSpecialist(t, phaseName, username) {
    const roster = await getRoster(t);
    username = (username || "").trim();
    if (!username || !phaseName) return roster;
    if (!Array.isArray(roster.phaseSpecialists[phaseName])) {
      roster.phaseSpecialists[phaseName] = [];
    }
    if (roster.phaseSpecialists[phaseName].indexOf(username) === -1) {
      roster.phaseSpecialists[phaseName].push(username);
    }
    return saveRoster(t, roster);
  }

  async function removeSpecialist(t, phaseName, username) {
    const roster = await getRoster(t);
    if (Array.isArray(roster.phaseSpecialists[phaseName])) {
      roster.phaseSpecialists[phaseName] = roster.phaseSpecialists[phaseName].filter(
        (m) => m !== username
      );
    }
    return saveRoster(t, roster);
  }

  async function isManagerAsync(t, username) {
    const roster = await getRoster(t);
    return roster.managers.indexOf(username) !== -1;
  }

  global.WFRoster = {
    getRoster,
    saveRoster,
    addManager,
    removeManager,
    addSpecialist,
    removeSpecialist,
    isManagerAsync
  };
})(window);
