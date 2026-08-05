/**
 * Roster helpers -- adaptive, board-pluginData-backed store for managers and
 * per-phase specialists. Falls back to the hardcoded config.js lists until a
 * board saves its own roster for the first time, so nothing breaks for boards
 * that never touch the new Team Roster UI.
 */
(function (global) {
  /*
   * Board plugin data is addressed by the literal scope string "board", not by
   * the board's id. Passing board.id here meant every save resolved without
   * ever landing: /boards/{id}/pluginData held no roster record at all, so
   * adding a manager or a phase specialist silently did nothing.
   */
  const KEY = "wfRoster";

  function defaultsFromConfig() {
    const cfg = global.WF_CONFIG || {};
    return {
      managers: Array.isArray(cfg.managers) ? cfg.managers.slice() : [],
      // Office/admin accounts. They own the paperwork steps (intake, job
      // packets, Print CAD, billing) -- done/not-done work with no timer and no
      // shop labor cost -- and are not managers.
      office: Array.isArray(cfg.office) ? cfg.office.slice() : [],
      phaseSpecialists: cfg.phaseSpecialists
        ? JSON.parse(JSON.stringify(cfg.phaseSpecialists))
        : {}
    };
  }

  async function getRoster(t) {
    const stored = await t.get("board", "shared", KEY, null);
    const base = defaultsFromConfig();
    if (!stored) return base;
    return {
      managers: Array.isArray(stored.managers) ? stored.managers.slice() : base.managers,
      office: Array.isArray(stored.office) ? stored.office.slice() : base.office,
      phaseSpecialists:
        stored.phaseSpecialists && typeof stored.phaseSpecialists === "object"
          ? JSON.parse(JSON.stringify(stored.phaseSpecialists))
          : base.phaseSpecialists
    };
  }

  async function saveRoster(t, roster) {
    await t.set("board", "shared", KEY, roster);
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

  async function addOffice(t, username) {
    const roster = await getRoster(t);
    username = (username || "").trim();
    if (!username) return roster;
    if (roster.office.indexOf(username) === -1) roster.office.push(username);
    return saveRoster(t, roster);
  }

  async function removeOffice(t, username) {
    const roster = await getRoster(t);
    roster.office = roster.office.filter((m) => m !== username);
    return saveRoster(t, roster);
  }

  /**
   * One role per person, most privileged wins. Everyone not listed is a worker,
   * which is the safe default: workers see their own queue and nothing
   * financial.
   */
  function roleOf(roster, username) {
    if (!roster || !username) return "worker";
    if ((roster.managers || []).indexOf(username) !== -1) return "manager";
    if ((roster.office || []).indexOf(username) !== -1) return "office";
    return "worker";
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
    addOffice,
    removeOffice,
    roleOf,
    addSpecialist,
    removeSpecialist,
    isManagerAsync
  };
})(window);
