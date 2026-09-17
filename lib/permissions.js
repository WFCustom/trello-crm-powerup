/**
 * WFPerms -- who sees what, decided by you rather than by me.
 *
 * WHY THIS REPLACES HARD-CODED ROLES
 *
 * Until now the answer to "may this person see costing" was scattered across
 * the code: `canSeeMoney` in the card panel, `roles: ["manager"]` on a tab,
 * `isManager` on the Floor, a `managers` array in config.js. Four places, four
 * slightly different answers, and every change needed a release. The owner has
 * to be able to decide this at the bench, on a Tuesday, without me.
 *
 * TWO DIMENSIONS, NOT ONE
 *
 * A capability list alone can't tell a shop manager from an office manager.
 * Both should see time logs; what differs is WHOSE. So every grant is a
 * capability plus a scope:
 *
 *   capability   what you may do        see.costing, qc.sign, edit.due
 *   scope        whose records          own | crew | area | all
 *
 * Without the second dimension you end up giving two managers different
 * capabilities to express a difference that was never about capability, and the
 * first person who does a bit of both breaks the model.
 *
 * PRESETS, NOT CASTES
 *
 * A preset is a starting point, not a cage. Somebody is "shop manager" and
 * therefore gets that bundle, and then any single grant can be overridden for
 * them alone -- because real shops have the person who runs the floor but also
 * does the ordering, and a system that can't say so gets worked around.
 *
 * THE LOCKOUT INVARIANT
 *
 * A permissions screen that can remove the permission to reach the permissions
 * screen is a screen that bricks the board. Two guards, and they are not
 * optional: `permissions.manage` can never be taken from the last preset that
 * holds it, and the `managers` list in config.js is a floor underneath
 * everything -- those people always hold everything, so a bad save is always
 * recoverable without a developer.
 *
 * WHAT THIS IS NOT
 *
 * It is not security. This runs in the browser, as the person using it; it
 * decides what they are shown, not what they could extract with devtools.
 * Trello's own board permissions are the only real enforcement. That matches
 * the standing instruction -- relevant info at each stage, not airtight -- but
 * a permissions screen LOOKS like security, so it is written down here rather
 * than assumed.
 */
(function (global) {
  "use strict";

  var KEY = "wfPermissions";

  /* ------------------------------------------------------------- the scopes */

  /**
   * Whose records a grant reaches. Ordered weakest to strongest so a comparison
   * is an index, not a lookup table nobody maintains.
   */
  var SCOPES = ["none", "own", "crew", "area", "all"];

  function scopeRank(s) {
    var i = SCOPES.indexOf(s);
    return i < 0 ? 0 : i;
  }

  function atLeast(granted, needed) {
    return scopeRank(granted) >= scopeRank(needed);
  }

  /* -------------------------------------------------------- the capabilities */

  /**
   * Everything a person can be granted, grouped for the editor.
   *
   * `scoped: false` means the capability is all-or-nothing -- there is no
   * sensible "manage stations, but only your own", and offering the dropdown
   * anyway would invite somebody to set it and wonder why nothing changed.
   */
  var CAPS = [
    { id: "see.costing", group: "Money", scoped: true,
      label: "See job value and cost",
      note: "The costing fields on a card, and the money columns in Records." },
    { id: "see.margins", group: "Money", scoped: false,
      label: "See margins and company totals",
      note: "The Dashboard's margin panel and any board-wide profitability." },
    { id: "see.rates", group: "Money", scoped: true,
      label: "See hourly pay rates",
      note: "What people are paid. Owner and manager pay is never shown to anyone." },

    { id: "see.timers", group: "Time", scoped: true,
      label: "See time logged, by person",
      note: "Who spent how long on what. The shop floor never shows a running clock to a worker." },
    { id: "records.export", group: "Time", scoped: true,
      label: "Export records to CSV", note: "" },

    { id: "qc.sign", group: "Quality", scoped: true,
      label: "Sign off a quality check", note: "" },
    { id: "qc.edit", group: "Quality", scoped: false,
      label: "Create and edit checklists",
      note: "The shared library in the Roster. Edits never change an already-signed check." },

    { id: "job.start", group: "The work", scoped: true,
      label: "Start and stop work on a job", note: "" },
    { id: "job.assign", group: "The work", scoped: true,
      label: "Put jobs on a station", note: "" },
    { id: "edit.due", group: "The work", scoped: true,
      label: "Move a due date",
      note: "A promise somebody else is planning around." },
    { id: "edit.card", group: "The work", scoped: true,
      label: "Rename a job or edit its description", note: "" },

    { id: "safety.view", group: "People", scoped: true,
      label: "Read safety reports",
      note: "Anyone can file one, including anonymously. This is who can read them." },
    { id: "people.manage", group: "People", scoped: true,
      label: "Manage the roster", note: "" },

    { id: "stations.manage", group: "Setup", scoped: false,
      label: "Set up stations", note: "" },
    { id: "board.sandbox", group: "Setup", scoped: false,
      label: "Use test mode",
      note: "Run the real flows without anything reaching Trello." },
    { id: "permissions.manage", group: "Setup", scoped: false,
      label: "Change these permissions",
      note: "Cannot be removed from the last preset that holds it." }
  ];

  function caps() { return CAPS.map(function (c) { return Object.assign({}, c); }); }

  function capById(id) {
    return CAPS.filter(function (c) { return c.id === id; })[0] || null;
  }

  function groups() {
    var seen = {}, out = [];
    CAPS.forEach(function (c) {
      if (seen[c.group]) return;
      seen[c.group] = true;
      out.push(c.group);
    });
    return out;
  }

  /* ---------------------------------------------------------- the presets */

  /**
   * The starting bundles.
   *
   * These are a first draft for the owner to edit, not policy. Two choices in
   * them are worth stating because they are easy to reverse by accident:
   *
   *   a worker can sign a quality check for their OWN work. The model we agreed
   *   is that a checklist replaces manager approval, and a gate only the boss
   *   can open is the approval queue again wearing a different hat.
   *
   *   shop and office managers do NOT see margins. They run their areas on time
   *   and quality; company profitability is a leadership question, and the
   *   standing instruction is to keep overall financials off other screens.
   */
  var DEFAULTS = {
    worker: {
      label: "Shop crew",
      note: "Does the work, signs their own checks.",
      caps: {
        "qc.sign": "own",
        "job.start": "own",
        "see.timers": "own"
      }
    },
    shop_manager: {
      label: "Shop manager",
      note: "Runs the floor and the crew on it.",
      caps: {
        "qc.sign": "area", "qc.edit": "all",
        "job.start": "area", "job.assign": "area",
        "edit.due": "area", "edit.card": "area",
        "see.timers": "area", "see.costing": "area",
        "safety.view": "area", "people.manage": "crew",
        "stations.manage": "all", "board.sandbox": "all",
        "records.export": "area"
      }
    },
    office_manager: {
      label: "Office manager",
      note: "Runs quoting, scheduling and the office side.",
      caps: {
        "qc.sign": "area", "qc.edit": "all",
        "edit.due": "all", "edit.card": "all",
        "job.assign": "area",
        "see.timers": "area", "see.costing": "all",
        "safety.view": "area", "people.manage": "crew",
        "board.sandbox": "all", "records.export": "all"
      }
    },
    leadership: {
      label: "Leadership",
      note: "Sees everything, including money and every time log.",
      caps: everything()
    }
  };

  /** Every capability at its strongest scope. */
  function everything() {
    var out = {};
    CAPS.forEach(function (c) { out[c.id] = "all"; });
    return out;
  }

  function defaults() {
    return { presets: JSON.parse(JSON.stringify(DEFAULTS)), people: {} };
  }

  /* ------------------------------------------------------------ persistence */

  function load(t) {
    return t.get("board", "shared", KEY, null)
      .then(function (saved) { return merge(saved); })
      .catch(function () { return merge(null); });
  }

  /**
   * A saved config over the shipped one.
   *
   * Presets are merged by id so a capability added in a later release appears
   * on boards that saved months ago -- but a preset the owner edited keeps
   * exactly the grants they set, including grants they deliberately removed.
   * That means a new capability arrives ungranted rather than silently switched
   * on for everyone, which is the safe direction for a permission.
   */
  function merge(saved) {
    var out = defaults();
    if (!saved || typeof saved !== "object") return out;

    Object.keys(saved.presets || {}).forEach(function (id) {
      var s = saved.presets[id];
      if (!s || typeof s !== "object") return;
      var base = out.presets[id] || { label: id, note: "", caps: {} };
      out.presets[id] = {
        label: s.label || base.label,
        note: s.note !== undefined ? s.note : base.note,
        caps: cleanCaps(s.caps)
      };
    });

    Object.keys(saved.people || {}).forEach(function (u) {
      var p = saved.people[u];
      if (!p || typeof p !== "object") return;
      out.people[u] = {
        preset: p.preset || "worker",
        caps: cleanCaps(p.caps)
      };
    });

    return guard(out);
  }

  /**
   * Drop grants for capabilities that no longer exist, and bad scope names.
   *
   * "none" is KEPT, because on a person it is not the absence of a grant -- it
   * is the presence of a removal. Stripping it here would let the preset's
   * grant come back on the next load, which is the kind of bug that quietly
   * re-opens something somebody deliberately closed.
   */
  function cleanCaps(caps) {
    var out = {};
    Object.keys(caps || {}).forEach(function (id) {
      if (!capById(id)) return;
      var s = caps[id];
      if (SCOPES.indexOf(s) === -1) return;
      out[id] = s;
    });
    return out;
  }

  /**
   * The lockout guard.
   *
   * If a save would leave nobody able to reach this screen, leadership gets it
   * back. Silently, and on read as well as write -- a board that somehow ends
   * up in that state must heal on the next load rather than needing a developer.
   */
  function guard(cfg) {
    var holders = Object.keys(cfg.presets).filter(function (id) {
      return cfg.presets[id].caps["permissions.manage"];
    });
    if (!holders.length) {
      if (!cfg.presets.leadership) {
        cfg.presets.leadership = JSON.parse(JSON.stringify(DEFAULTS.leadership));
      }
      cfg.presets.leadership.caps["permissions.manage"] = "all";
    }
    return cfg;
  }

  function save(t, cfg) {
    var safe = guard({
      presets: cfg.presets || {},
      people: cfg.people || {}
    });
    return global.WFStore.set(t, "board", KEY, safe, { label: "these permissions" })
      .then(function () { return safe; });
  }

  /* ------------------------------------------------------------- the lookup */

  /**
   * One person's effective grants: their preset, with their own overrides on
   * top. An override of "none" removes a grant the preset gave, which is the
   * only way to say "a shop manager, but not this one thing".
   */
  function effective(cfg, username) {
    if (isFloor(username)) return everything();

    var person = (cfg && cfg.people && cfg.people[username]) || null;
    var presetId = (person && person.preset) || "worker";
    var preset = (cfg && cfg.presets && cfg.presets[presetId]) || DEFAULTS.worker;

    var out = Object.assign({}, preset.caps || {});
    var own = (person && person.caps) || {};
    Object.keys(own).forEach(function (id) {
      var s = own[id];
      // "none" is how you say "a shop manager, but not this one thing" -- it
      // has to remove a grant the preset gave, not merely fail to add one.
      if (s === "none" || !s) delete out[id];
      else out[id] = s;
    });
    return out;
  }

  /**
   * The people named in config.js always hold everything.
   *
   * This is the floor that makes a misconfiguration recoverable. It is
   * deliberately NOT editable from the UI -- the whole point is that it cannot
   * be switched off by the screen it protects.
   */
  function isFloor(username) {
    var list = (global.WF_CONFIG && global.WF_CONFIG.managers) || [];
    return list.indexOf(username) !== -1;
  }

  /** The scope this person holds for a capability, or "none". */
  function scopeFor(cfg, username, capId) {
    var eff = effective(cfg, username);
    return eff[capId] || "none";
  }

  /** Do they hold this capability at all? */
  function can(cfg, username, capId) {
    return scopeFor(cfg, username, capId) !== "none";
  }

  /**
   * Do they hold it over THIS record?
   *
   * `subject` describes whose thing it is: { username, crew, area }. A missing
   * subject means the question is about the capability in general, not about a
   * particular person's record, so scope doesn't narrow it.
   */
  function allows(cfg, username, capId, subject) {
    var scope = scopeFor(cfg, username, capId);
    if (scope === "none") return false;
    if (scope === "all") return true;
    if (!subject) return true;

    var me = (cfg && cfg.people && cfg.people[username]) || {};
    if (scope === "own") return subject.username === username;
    if (scope === "crew") {
      return subject.username === username ||
             (!!me.crew && subject.crew === me.crew);
    }
    if (scope === "area") {
      return subject.username === username ||
             (!!me.area && subject.area === me.area) ||
             (!!me.crew && subject.crew === me.crew);
    }
    return false;
  }

  /** Presets in a stable order for the editor: the shipped four, then any added. */
  function presetIds(cfg) {
    var known = ["worker", "shop_manager", "office_manager", "leadership"];
    var all = Object.keys((cfg && cfg.presets) || {});
    var extra = all.filter(function (id) { return known.indexOf(id) === -1; }).sort();
    return known.filter(function (id) { return all.indexOf(id) !== -1; }).concat(extra);
  }

  function presetOf(cfg, username) {
    var p = (cfg && cfg.people && cfg.people[username]) || null;
    return (p && p.preset) || "worker";
  }

  /** True when this person has had a grant changed away from their preset. */
  function isCustomised(cfg, username) {
    var p = (cfg && cfg.people && cfg.people[username]) || null;
    return !!(p && p.caps && Object.keys(p.caps).length);
  }

  global.WFPerms = {
    KEY: KEY,
    SCOPES: SCOPES,
    CAPS: CAPS,
    caps: caps, capById: capById, groups: groups,
    scopeRank: scopeRank, atLeast: atLeast,
    defaults: defaults, everything: everything,
    load: load, save: save, merge: merge, guard: guard,
    effective: effective, scopeFor: scopeFor,
    can: can, allows: allows, isFloor: isFloor,
    presetIds: presetIds, presetOf: presetOf, isCustomised: isCustomised
  };
})(window);
