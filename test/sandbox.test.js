/**
 * Test mode -- the real code path with the last inch to Trello cut.
 *
 * The assertion this file exists for: NOTHING reaches Trello, and yet the
 * screen behaves exactly as if everything did. Both halves matter equally. A
 * sandbox that leaks one write is worse than no sandbox, because somebody will
 * rehearse a whole shift on the belief that it can't. A sandbox that swallows
 * writes and then serves stale reads is useless, because you press Start and
 * the screen says the job isn't started.
 *
 * The other thing held here: leaving throws the session away. An overlay that
 * survived the exit would mean a board that keeps pretending after the banner
 * comes down, which is the one failure nobody would think to check for.
 */
"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { load } = require("./harness");

const win = load();
const S = win.WFSandbox;

/** A `t` that records everything, standing in for Trello plugin storage. */
function fakeT(seed) {
  const store = Object.assign({}, seed || {});
  const writes = [];
  return {
    writes,
    store,
    get: (scope, vis, key, dflt) => {
      const v = store[scope + "/" + key];
      return Promise.resolve(v === undefined ? dflt : v);
    },
    set: (scope, vis, key, value) => {
      writes.push([scope, key, value]);
      store[scope + "/" + key] = value;
      return Promise.resolve();
    },
    remove: (scope, vis, key) => {
      writes.push([scope, key, null]);
      delete store[scope + "/" + key];
      return Promise.resolve();
    },
    member: () => Promise.resolve({ id: "m1" })
  };
}

beforeEach(() => S.disable());
afterEach(() => S.disable());

/* ================================================== nothing reaches Trello */

test("off, the wrapper is a pass-through and writes land for real", async () => {
  const t = fakeT();
  const w = S.wrap(t);
  await w.set("card1", "shared", "phaseWork", { pct: 10 });
  assert.equal(t.writes.length, 1);
  assert.deepEqual(await w.get("card1", "shared", "phaseWork", null), { pct: 10 });
});

test("on, not one write reaches the real t", async () => {
  const t = fakeT();
  const w = S.wrap(t);
  S.enable();

  await w.set("card1", "shared", "phaseWork", { pct: 60 });
  await w.set("board", "shared", "wfStations", { stations: [] });
  await w.remove("card1", "shared", "qcRecord");

  assert.equal(t.writes.length, 0, "Trello was never touched");
  assert.equal(S.count(), 4, "three writes plus the session marker");
});

test("on, a read sees this session's own writes", async () => {
  // The failure this guards against: press Start, screen says not started.
  const t = fakeT({ "card1/phaseWork": { pct: 0 } });
  const w = S.wrap(t);
  S.enable();

  await w.set("card1", "shared", "phaseWork", { pct: 60 });
  assert.deepEqual(await w.get("card1", "shared", "phaseWork", null), { pct: 60 });
});

test("a read falls through to Trello for anything this session hasn't touched", async () => {
  const t = fakeT({ "card9/phaseWork": { pct: 25 } });
  const w = S.wrap(t);
  S.enable();
  await w.set("card1", "shared", "phaseWork", { pct: 60 });
  assert.deepEqual(await w.get("card9", "shared", "phaseWork", null), { pct: 25 });
});

test("a removed key reads as the default, not as its old value", async () => {
  const t = fakeT({ "card1/qcRecord": { status: "passed" } });
  const w = S.wrap(t);
  S.enable();
  await w.remove("card1", "shared", "qcRecord");
  assert.equal(await w.get("card1", "shared", "qcRecord", null), null);
});

test("methods that aren't storage keep working", async () => {
  // A sandbox that quietly broke t.member() would send somebody hunting for a
  // bug that isn't there.
  const t = fakeT();
  const w = S.wrap(t);
  S.enable();
  assert.deepEqual(await w.member(), { id: "m1" });
});

test("wrapping twice returns the same wrapper, not a wrapper of a wrapper", () => {
  const t = fakeT();
  const w = S.wrap(t);
  assert.equal(S.wrap(w), w);
});

/* ======================================================== the REST wrapper */

test("on, REST writes are recorded instead of sent", async () => {
  const calls = [];
  win.WFRest.moveCard = (t, id, list) => { calls.push(["move", id, list]); return Promise.resolve({}); };
  win.WFRest.postComment = (t, id, text) => { calls.push(["comment", id, text]); return Promise.resolve({}); };

  S.enable();
  await win.WFRest.moveCard({}, "card1", "listB");
  await win.WFRest.postComment({}, "card1", "done");
  assert.equal(calls.length, 0, "no REST call was made");

  const words = S.entries().map((e) => e.summary).join(" | ");
  assert.match(words, /Would move card/);
  assert.match(words, /Would post a comment/);
});

test("a sandboxed move still answers with the new list", async () => {
  // The caller often reads idList off the result; returning nothing would make
  // a success that went nowhere look like a failure.
  S.enable();
  const out = await win.WFRest.moveCard({}, "card1", "listB");
  assert.equal(out.idList, "listB");
});

test("leaving puts the real REST methods back", async () => {
  const calls = [];
  const real = (t, id, list) => { calls.push([id, list]); return Promise.resolve({}); };
  win.WFRest.moveCard = real;

  S.enable();
  await win.WFRest.moveCard({}, "card1", "listB");
  assert.equal(calls.length, 0);

  S.disable();
  assert.equal(win.WFRest.moveCard, real, "the original function, not a copy");
  await win.WFRest.moveCard({}, "card2", "listC");
  assert.equal(calls.length, 1);
});

/* ================================================== the card-list overlay */

test("cards fetched over REST are patched with what this session did", async () => {
  const t = fakeT();
  const w = S.wrap(t);
  S.enable();
  await w.set("c1", "shared", "phaseWork", { listId: "LA", percentComplete: 60 });

  const cards = [{ id: "c1", idList: "LA", phaseWork: { listId: "LA", percentComplete: 0 } },
                 { id: "c2", idList: "LA", phaseWork: null }];
  const out = S.decorate(cards);
  assert.equal(out[0].phaseWork.percentComplete, 60);
  assert.equal(out[1].phaseWork, null, "a card this session never touched is unchanged");
});

test("decorate never mutates the caller's cards", async () => {
  const t = fakeT();
  const w = S.wrap(t);
  S.enable();
  await w.set("c1", "shared", "phaseWork", { percentComplete: 60 });

  const cards = [{ id: "c1", idList: "LA", phaseWork: { percentComplete: 0 } }];
  S.decorate(cards);
  // The same array is cached and shared between tabs; mutating it would leak
  // the session into places that never asked for it.
  assert.equal(cards[0].phaseWork.percentComplete, 0);
});

test("a sandboxed move shows the card as actually being in the new list", () => {
  // Without this the next station's queue can't pick the job up, and the
  // hand-off -- the single most important thing to rehearse -- can't be tested.
  S.enable();
  return win.WFRest.moveCard({}, "c1", "LS").then(() => {
    const out = S.decorate([{ id: "c1", idList: "LA" }]);
    assert.equal(out[0].idList, "LS");
  });
});

test("off, decorate hands the cards straight back", () => {
  const cards = [{ id: "c1", idList: "LA" }];
  assert.equal(S.decorate(cards), cards);
});

/* ============================================================ the log */

test("the log says what happened in words, not in JSON", async () => {
  const t = fakeT();
  const w = S.wrap(t);
  S.enable();

  await w.set("cardabc123", "shared", "phaseWork", {
    claimedBy: { fullName: "Kevin Moss" },
    segments: [{ start: "2026-09-15T10:00:00Z" }],
    percentComplete: 40
  });
  const line = S.entries()[S.entries().length - 1].summary;
  assert.match(line, /Kevin Moss/);
  assert.match(line, /running/);
  assert.match(line, /40%/);
});

test("a QC sign-off reads as a sign-off, naming who signed", () => {
  const line = S.describeSet("card1", "qcRecord", {
    status: "passed", signedBy: { fullName: "Scott VanWorkom" }
  });
  assert.match(line, /QC signed off/);
  assert.match(line, /Scott VanWorkom/);
});

test("clearing phase work reads as clearing, not as saving nothing", () => {
  assert.match(S.describeSet("card1", "phaseWork", null), /Cleared/);
});

/* ======================================================= leaving and reset */

test("leaving throws the session away", async () => {
  const t = fakeT({ "card1/phaseWork": { pct: 0 } });
  const w = S.wrap(t);
  S.enable();
  await w.set("card1", "shared", "phaseWork", { pct: 99 });
  assert.deepEqual(await w.get("card1", "shared", "phaseWork", null), { pct: 99 });

  S.disable();
  // The next read goes to Trello and gets the truth. Anything that looked
  // different was never real.
  assert.deepEqual(await w.get("card1", "shared", "phaseWork", null), { pct: 0 });
  assert.equal(S.count(), 0, "the log goes with it");
});

test("reset clears the run but stays in test mode", async () => {
  const t = fakeT({ "card1/phaseWork": { pct: 0 } });
  const w = S.wrap(t);
  S.enable();
  await w.set("card1", "shared", "phaseWork", { pct: 99 });

  S.reset();
  assert.equal(S.active(), true, "still sandboxed");
  assert.deepEqual(await w.get("card1", "shared", "phaseWork", null), { pct: 0 });
  await w.set("card1", "shared", "phaseWork", { pct: 5 });
  assert.equal(t.writes.length, 0, "and still not writing to Trello");
});

test("enabling twice doesn't double-wrap the REST methods", async () => {
  const calls = [];
  const real = () => { calls.push(1); return Promise.resolve({}); };
  win.WFRest.moveCard = real;
  S.enable();
  S.enable();
  S.disable();
  assert.equal(win.WFRest.moveCard, real, "restored cleanly after a double enable");
});
