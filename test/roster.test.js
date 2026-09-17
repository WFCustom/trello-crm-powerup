/**
 * The team roster.
 *
 * Two things this file exists to hold. First, the roster is addressed by the
 * literal scope "board" -- the comment at the top of lib/roster.js records that
 * passing the board's id instead made every save resolve successfully while
 * landing nowhere, so adding a manager appeared to work and did nothing. A
 * silent write is the worst kind, and only an assertion on the scope catches it.
 *
 * Second, a board that has never opened the roster UI must still know who its
 * managers are, because roleOf() decides who sees money. Losing the config.js
 * fallback would demote everyone to worker.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { load, plain } = require("./harness");

const win = load();
const R = win.WFRoster;
const CFG = win.WF_CONFIG;

/**
 * A `t` that speaks every shape the real Trello API does.
 *
 * The roster goes through WFStore now, and WFStore uses two forms this mock
 * previously did not know: a KEYLESS get, because the 4096-character limit is
 * per scope/visibility pair and only the whole blob can be measured, and an
 * OBJECT passed to set so several keys land in one call. Understanding only
 * get(scope, vis, key, dflt) stored the patch under the key "undefined", which
 * is exactly the silent write this file exists to catch -- `writes` still
 * records one entry per key, so the scope assertion below is unchanged.
 */
function fakeT(seed) {
  const store = Object.assign({}, seed || {});
  const writes = [];
  const scopeOf = (scope) => {
    const all = {};
    Object.keys(store).forEach((k) => {
      const cut = k.indexOf("/");
      if (k.slice(0, cut) === scope) all[k.slice(cut + 1)] = store[k];
    });
    return all;
  };
  return {
    writes, store,
    get: (scope, vis, key, dflt) => {
      if (key === undefined) return Promise.resolve(scopeOf(scope));
      const v = store[scope + "/" + key];
      return Promise.resolve(v === undefined ? dflt : v);
    },
    set: (scope, vis, key, value) => {
      const patch = (key && typeof key === "object") ? key : { [key]: value };
      Object.keys(patch).forEach((k) => {
        writes.push([scope, k, patch[k]]);
        store[scope + "/" + k] = patch[k];
      });
      return Promise.resolve();
    },
    remove: (scope, vis, key) => {
      [].concat(key).forEach((k) => {
        writes.push([scope, k, null]);
        delete store[scope + "/" + k];
      });
      return Promise.resolve();
    }
  };
}

/* ======================================================== the config fallback */

test("a board that has never saved a roster still knows its managers", async () => {
  const r = await R.getRoster(fakeT());
  assert.deepStrictEqual(plain(r.managers), plain(CFG.managers));
  assert.deepStrictEqual(plain(r.phaseSpecialists), plain(CFG.phaseSpecialists));
});

test("a stored roster overrides config one field at a time", async () => {
  // Boards saved before a field existed must not lose the rest of the roster.
  const t = fakeT({ "board/wfRoster": { managers: ["solo"] } });
  const r = await R.getRoster(t);
  assert.deepStrictEqual(plain(r.managers), ["solo"]);
  assert.deepStrictEqual(plain(r.phaseSpecialists), plain(CFG.phaseSpecialists),
    "the fields the save didn't carry fall back to config.js");
});

test("the roster handed out is a copy, so editing it cannot corrupt config.js", async () => {
  const before = plain(CFG.managers);
  const r = await R.getRoster(fakeT());
  r.managers.push("intruder");
  r.phaseSpecialists["CAD"] = ["intruder"];
  assert.deepStrictEqual(plain(CFG.managers), before);
  assert.deepStrictEqual(plain((await R.getRoster(fakeT())).managers), before);
});

/* ============================================================ where it saves */

test("the roster is written under the board scope, not under a board id", async () => {
  // The bug this guards: any other scope string resolves happily and stores
  // nothing retrievable, so the change appears to save and is gone next load.
  const t = fakeT();
  await R.addManager(t, "newboss");
  assert.equal(t.writes.length, 1);
  assert.deepStrictEqual(plain(t.writes[0].slice(0, 2)), ["board", "wfRoster"]);
  assert.ok((await R.getRoster(t)).managers.indexOf("newboss") !== -1,
    "and it reads back from the same place");
});

/* ================================================== adding and removing people */

test("adding the same manager twice does not list them twice", async () => {
  const t = fakeT({ "board/wfRoster": { managers: [] } });
  await R.addManager(t, "kev");
  const r = await R.addManager(t, "kev");
  assert.deepStrictEqual(plain(r.managers), ["kev"]);
});

test("a blank name is ignored instead of being saved", async () => {
  const t = fakeT({ "board/wfRoster": { managers: [] } });
  await R.addManager(t, "   ");
  await R.addOffice(t, "");
  assert.equal(t.writes.length, 0, "nothing was written at all");
});

test("removing someone leaves everyone else in place", async () => {
  const t = fakeT({ "board/wfRoster": { managers: ["kev", "pat"], office: ["ann"] } });
  const r = await R.removeManager(t, "kev");
  assert.deepStrictEqual(plain(r.managers), ["pat"]);
  assert.deepStrictEqual(plain(r.office), ["ann"]);

  const r2 = await R.removeOffice(t, "ann");
  assert.deepStrictEqual(plain(r2.office), []);
});

test("asking whether someone is a manager reads the roster, not the caller's word", async () => {
  const t = fakeT({ "board/wfRoster": { managers: ["kev"] } });
  assert.equal(await R.isManagerAsync(t, "kev"), true);
  assert.equal(await R.isManagerAsync(t, "stranger"), false);
});

/* ========================================================== one role per person */

test("a person listed in both places is a manager, and a stranger is a worker", () => {
  // Most privileged wins, and unlisted means worker -- the safe default, since
  // worker sees nothing financial.
  const roster = { managers: ["kev"], office: ["kev", "ann"] };
  assert.equal(R.roleOf(roster, "kev"), "manager");
  assert.equal(R.roleOf(roster, "ann"), "office");
  assert.equal(R.roleOf(roster, "mike"), "worker");
  assert.equal(R.roleOf(null, "kev"), "worker");
  assert.equal(R.roleOf(roster, undefined), "worker");
});

/* ================================================================= hourly rates */

test("a rate is kept only while it is a real positive number", async () => {
  // Without a rate labour costs zero and every margin reads 100%, so a junk
  // value has to be dropped rather than stored as NaN.
  const t = fakeT({ "board/wfRoster": { rates: {} } });
  let r = await R.setRate(t, "mike", 45);
  assert.equal(r.rates.mike, 45);

  r = await R.setRate(t, "mike", 0);
  assert.equal(r.rates.mike, undefined);

  r = await R.setRate(t, "mike", 32);
  r = await R.setRate(t, "mike", "not a number");
  assert.equal(r.rates.mike, undefined);
});

test("a rate arriving as a string is stored as a number", async () => {
  const t = fakeT({ "board/wfRoster": { rates: {} } });
  const r = await R.setRate(t, "mike", "28.50");
  assert.strictEqual(r.rates.mike, 28.5);
});

/* ============================================================ phase specialists */

test("a phase with no specialists yet gets its list created on first add", async () => {
  const t = fakeT({ "board/wfRoster": { phaseSpecialists: {} } });
  await R.addSpecialist(t, "Assemble CAP", "kev");
  const r = await R.addSpecialist(t, "Assemble CAP", "kev");
  assert.deepStrictEqual(plain(r.phaseSpecialists["Assemble CAP"]), ["kev"]);
});

test("removing a specialist touches only that phase", async () => {
  const t = fakeT({
    "board/wfRoster": { phaseSpecialists: { CAD: ["kev", "ann"], "Print CAD": ["kev"] } }
  });
  const r = await R.removeSpecialist(t, "CAD", "kev");
  assert.deepStrictEqual(plain(r.phaseSpecialists.CAD), ["ann"]);
  assert.deepStrictEqual(plain(r.phaseSpecialists["Print CAD"]), ["kev"]);
});

test("removing from a phase nobody is assigned to is a no-op, not an error", async () => {
  const t = fakeT({ "board/wfRoster": { phaseSpecialists: {} } });
  const r = await R.removeSpecialist(t, "Install", "kev");
  assert.equal(r.phaseSpecialists.Install, undefined);
});
