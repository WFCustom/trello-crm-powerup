/**
 * Who sees what.
 *
 * Two assertions this file exists for, and they pull against each other:
 *
 *   the owner can genuinely change anything, including taking a grant away
 *   from one person without disturbing their preset;
 *
 *   and no sequence of changes can lock everybody out of the screen that makes
 *   changes. A permissions editor that can brick itself is worse than no
 *   editor, because the way out is a developer.
 *
 * Everything else here is ordinary coverage.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { load } = require("./harness");

const win = load();
const P = win.WFPerms;

/* ================================================== presets are a starting point */

test("the shipped presets grant what their names imply", () => {
  const cfg = P.defaults();

  // A worker signs their OWN check. A gate only the boss can open is the
  // approval queue again wearing a different hat.
  assert.equal(P.scopeFor(cfg, "nobody", "qc.sign"), "own");

  cfg.people.kev = { preset: "shop_manager", caps: {} };
  assert.equal(P.scopeFor(cfg, "kev", "qc.sign"), "area");
  assert.equal(P.can(cfg, "kev", "stations.manage"), true);

  cfg.people.dale = { preset: "leadership", caps: {} };
  assert.equal(P.scopeFor(cfg, "dale", "see.margins"), "all");
});

test("shop and office managers do not see company margins", () => {
  // They run their areas on time and quality. Company profitability is a
  // leadership question, and overall financials stay off other screens.
  const cfg = P.defaults();
  cfg.people.kev = { preset: "shop_manager", caps: {} };
  cfg.people.pat = { preset: "office_manager", caps: {} };
  assert.equal(P.can(cfg, "kev", "see.margins"), false);
  assert.equal(P.can(cfg, "pat", "see.margins"), false);
  assert.equal(P.can(cfg, "kev", "see.rates"), false);
});

test("an unknown person is treated as crew, not as a manager", () => {
  // Failing closed is the only safe direction for a permission.
  const cfg = P.defaults();
  assert.equal(P.can(cfg, "stranger", "see.costing"), false);
  assert.equal(P.can(cfg, "stranger", "permissions.manage"), false);
});

/* ============================================== a preset is not a cage */

test("one person can be given more than their preset without moving them", () => {
  const cfg = P.defaults();
  cfg.people.kev = { preset: "shop_manager", caps: { "see.margins": "all" } };
  assert.equal(P.scopeFor(cfg, "kev", "see.margins"), "all");
  // And nobody else moved.
  cfg.people.sam = { preset: "shop_manager", caps: {} };
  assert.equal(P.can(cfg, "sam", "see.margins"), false);
});

test("'none' takes a grant away that the preset gave", () => {
  // This is how you say "a shop manager, but not this one thing".
  const cfg = P.defaults();
  cfg.people.kev = { preset: "shop_manager", caps: { "see.costing": "none" } };
  assert.equal(P.can(cfg, "kev", "see.costing"), false);
  assert.equal(P.can(cfg, "kev", "qc.sign"), true, "the rest of the preset is intact");
});

test("a removal survives a save and reload", () => {
  // Stripping "none" on the way through would let the preset's grant come back
  // on the next load -- quietly re-opening something somebody closed.
  const cfg = P.defaults();
  cfg.people.kev = { preset: "shop_manager", caps: { "see.costing": "none" } };
  const back = P.merge(JSON.parse(JSON.stringify(cfg)));
  assert.equal(P.can(back, "kev", "see.costing"), false);
});

test("customised people are flagged so the editor can say so", () => {
  const cfg = P.defaults();
  cfg.people.kev = { preset: "shop_manager", caps: {} };
  cfg.people.sam = { preset: "shop_manager", caps: { "see.margins": "all" } };
  assert.equal(P.isCustomised(cfg, "kev"), false);
  assert.equal(P.isCustomised(cfg, "sam"), true);
});

/* ==================================================== scope, not just capability */

test("scope decides whose records, which is what separates the two managers", () => {
  const cfg = P.defaults();
  cfg.people.kev = { preset: "shop_manager", caps: {}, area: "shop" };
  cfg.people.pat = { preset: "shop_manager", caps: {}, area: "office" };

  const shopJob = { username: "mike", area: "shop" };
  assert.equal(P.allows(cfg, "kev", "see.timers", shopJob), true);
  // Same capability, same preset -- different area, different answer. Without
  // scope you could only express this by giving them different capabilities.
  assert.equal(P.allows(cfg, "pat", "see.timers", shopJob), false);
});

test("'own' reaches only yourself", () => {
  const cfg = P.defaults();
  cfg.people.mike = { preset: "worker", caps: {} };
  assert.equal(P.allows(cfg, "mike", "see.timers", { username: "mike" }), true);
  assert.equal(P.allows(cfg, "mike", "see.timers", { username: "kev" }), false);
});

test("'crew' reaches your crew and yourself, and no further", () => {
  const cfg = P.defaults();
  cfg.people.kev = { preset: "shop_manager", caps: { "see.timers": "crew" }, crew: "welding" };
  assert.equal(P.allows(cfg, "kev", "see.timers", { username: "mike", crew: "welding" }), true);
  assert.equal(P.allows(cfg, "kev", "see.timers", { username: "pat", crew: "finishing" }), false);
  assert.equal(P.allows(cfg, "kev", "see.timers", { username: "kev" }), true);
});

test("'all' ignores the subject entirely", () => {
  const cfg = P.defaults();
  cfg.people.dale = { preset: "leadership", caps: {} };
  assert.equal(P.allows(cfg, "dale", "see.timers", { username: "anyone", area: "mars" }), true);
});

test("asking about a capability in general isn't narrowed by scope", () => {
  // "Should this tab exist for them" is a different question from "may they
  // see this person's record", and scope only answers the second.
  const cfg = P.defaults();
  cfg.people.kev = { preset: "shop_manager", caps: {}, area: "shop" };
  assert.equal(P.allows(cfg, "kev", "see.timers", null), true);
});

/* ============================================================ the lockout guard */

test("the last holder of permissions.manage cannot be removed", () => {
  const cfg = P.defaults();
  Object.keys(cfg.presets).forEach((id) => { delete cfg.presets[id].caps["permissions.manage"]; });

  const safe = P.guard(cfg);
  const holders = Object.keys(safe.presets)
    .filter((id) => safe.presets[id].caps["permissions.manage"]);
  assert.ok(holders.length >= 1, "somebody can always reach the screen");
  assert.ok(holders.indexOf("leadership") !== -1);
});

test("a board saved in a locked-out state heals on read", () => {
  // It must not need a developer to get back in.
  const broken = { presets: { worker: { label: "Crew", caps: {} } }, people: {} };
  const healed = P.merge(broken);
  assert.equal(healed.presets.leadership.caps["permissions.manage"], "all");
});

test("the config.js managers list is a floor nothing can remove", () => {
  // The whole point is that it cannot be switched off by the screen it protects.
  const cfg = P.defaults();
  const owner = (win.WF_CONFIG.managers || [])[0];
  assert.ok(owner, "config.js still names at least one manager");

  cfg.people[owner] = { preset: "worker", caps: { "permissions.manage": "none" } };
  assert.equal(P.can(cfg, owner, "permissions.manage"), true);
  assert.equal(P.can(cfg, owner, "see.margins"), true);
  assert.equal(P.isFloor(owner), true);
});

/* ============================================================ merging saves */

test("an edited preset keeps exactly the grants the owner set", () => {
  const saved = {
    presets: { shop_manager: { label: "Floor boss", caps: { "qc.sign": "all" } } },
    people: {}
  };
  const cfg = P.merge(saved);
  assert.equal(cfg.presets.shop_manager.label, "Floor boss");
  assert.deepEqual(Object.keys(cfg.presets.shop_manager.caps), ["qc.sign"],
    "grants they removed stay removed");
  // Presets they never touched keep their defaults.
  assert.equal(cfg.presets.worker.caps["qc.sign"], "own");
});

test("a capability added in a later release arrives ungranted", () => {
  // Safe direction: a new permission must not switch itself on for everyone.
  const saved = { presets: { shop_manager: { caps: { "qc.sign": "all" } } }, people: {} };
  const cfg = P.merge(saved);
  assert.equal(cfg.presets.shop_manager.caps["see.rates"], undefined);
});

test("grants for capabilities that no longer exist are dropped", () => {
  const cfg = P.merge({
    presets: { worker: { caps: { "qc.sign": "own", "see.unicorns": "all" } } },
    people: {}
  });
  assert.equal(cfg.presets.worker.caps["see.unicorns"], undefined);
  assert.equal(cfg.presets.worker.caps["qc.sign"], "own");
});

test("a nonsense scope is ignored rather than trusted", () => {
  const cfg = P.merge({
    presets: { worker: { caps: { "qc.sign": "everything", "job.start": "own" } } },
    people: {}
  });
  assert.equal(cfg.presets.worker.caps["qc.sign"], undefined);
  assert.equal(cfg.presets.worker.caps["job.start"], "own");
});

test("garbage in place of a saved config falls back to the defaults", () => {
  ["", null, 7, "nope"].forEach((bad) => {
    const cfg = P.merge(bad);
    assert.equal(cfg.presets.worker.caps["qc.sign"], "own");
  });
});

/* ================================================================= the editor */

test("presets list in a stable order, with any added ones after", () => {
  const cfg = P.defaults();
  cfg.presets.night_shift = { label: "Night shift", caps: {} };
  assert.deepEqual(P.presetIds(cfg), [
    "worker", "shop_manager", "office_manager", "leadership", "night_shift"
  ]);
});

test("capabilities are grouped for the screen, and say what they mean", () => {
  const all = P.caps();
  assert.ok(all.length >= 12);
  assert.ok(all.every((c) => c.id && c.label && c.group));
  assert.ok(P.groups().indexOf("Money") !== -1);
  // Setup capabilities are all-or-nothing -- there is no sensible "manage
  // stations, but only your own", and the dropdown would just confuse.
  assert.equal(P.capById("stations.manage").scoped, false);
  assert.equal(P.capById("see.costing").scoped, true);
});

test("scopes compare by strength", () => {
  assert.equal(P.atLeast("all", "own"), true);
  assert.equal(P.atLeast("own", "area"), false);
  assert.equal(P.atLeast("none", "own"), false);
});
