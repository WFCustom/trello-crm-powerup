/**
 * Regressions that shipped silently.
 *
 * Every test in this file stands for a bug that reached the shop and reported
 * nothing while it was wrong. That is the pattern worth guarding: a wrong field
 * name, a field fetched and dropped, a guard flag that ate clicks, a queue entry
 * promoted to "now building". None of them threw, none of them logged, and each
 * one cost an afternoon to find by staring at a screenshot.
 *
 * So these assertions are deliberately about the SHAPE of a contract between two
 * files rather than about behaviour one file can satisfy on its own -- that is
 * where all of them hid.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./harness");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const win = load();
const T = win.WFTables;

/**
 * Source with comments removed.
 *
 * Several assertions here are "no file still does X", and this repo comments
 * heavily -- including quoting the exact call that was removed, which is the
 * most useful thing a comment can do and the most confusing thing a regex can
 * find. Stripping first means a test can say "nothing CALLS this" without
 * forbidding anyone from writing about it.
 */
function code(p) {
  return read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ============================================================ the card fetch */

test("getBoardCardsFull hands back idBoard, not just asks Trello for it", () => {
  /* THE BUG. `idBoard` was added to the `fields` string and left out of the
   * object the function returns, so it arrived from Trello and was dropped on
   * the floor. Every card from here is passed to WFPhase as cardMeta, and every
   * stage lookup keys on (board, list): with idBoard undefined, getStageForList
   * and getNextStage both answer null, so Complete does not move the card and
   * the job-type router bails before it starts. Neither failure says anything.
   *
   * Asserting on the returned object rather than on the request is the whole
   * point -- the request was already right. */
  const source = code("lib/trello-rest.js");
  assert.match(source, /fields:\s*"[^"]*\bidBoard\b/,
    "idBoard is requested from Trello");
  assert.match(source, /\bidBoard:\s*c\.idBoard\b/,
    "and idBoard is carried into the object callers actually receive");
});

/* ====================================================== what is on the bench */

/** Phase work as WFTables.setStation writes it for a card that had none. */
function queuedOnly(list, station, queuePos) {
  return { listId: list, claimedBy: null, segments: [], tableId: station, queuePos: queuePos };
}

function claimedWork(list, station, who, opts) {
  opts = opts || {};
  const segs = opts.running
    ? [{ start: new Date(Date.now() - 3600000).toISOString(), end: null }]
    : opts.worked
      ? [{ start: new Date(Date.now() - 7200000).toISOString(),
           end: new Date(Date.now() - (opts.endedMinutesAgo || 60) * 60000).toISOString() }]
      : [];
  return {
    listId: list, claimedBy: who, segments: segs,
    tableId: station, queuePos: opts.queuePos, percentComplete: opts.pct || 0
  };
}

const BOARD = {
  stages: [{ listId: "LA", name: "Assemble Legacy", order: 8, isWorkPhase: true }]
};
const STATION = { id: "s1", area: "shop", table: "Station #1", station: "Welding",
                  welder: "kevinmoss", phase: "Assemble Legacy" };
const KEV = { username: "kevinmoss", fullName: "Kevin Moss" };

const card = (id, work, pos) => ({
  id, name: "#" + id + " job", idList: "LA", pos: pos === undefined ? 100 : pos,
  due: null, phaseWork: work || null
});

test("a job merely queued on a station never takes the bench slot", () => {
  /* THE BUG, AND THE ONE THE USER SAW. Reordering a queue or moving a job to
   * another bench writes a stub phaseWork -- tableId and queuePos, no claim, no
   * segments -- which is the right record of "this is queued here". The bench
   * picker took the first card carrying the tableId, so that stub won the "Now
   * building" slot. Having no claim, it rendered with no Start button; having
   * won the slot, it pushed the real work out of the queue. The station showed a
   * job that could not be started, above a queue missing the job that could.
   *
   * The stub is deliberately FIRST in the array, so array order cannot be what
   * saves this. */
  const cards = [
    card("QUEUED", queuedOnly("LA", "s1", 0), 10),
    card("REAL", claimedWork("LA", "s1", KEV, { worked: true, queuePos: 1 }), 20)
  ];
  const st = T.stationState(BOARD, cards, STATION);

  assert.equal(st.job.id, "REAL", "the bench shows work somebody has engaged with");
  assert.ok(st.queue.some((c) => c.id === "QUEUED"),
    "and the queued stub stays in the queue, where it can be tapped to start");
});

test("a station with nothing but queued stubs reads as open, not as busy", () => {
  // The other half of the same rule. Better to say "Open · assign a job" than to
  // show a job with no controls on it.
  const cards = [card("Q1", queuedOnly("LA", "s1", 0))];
  const st = T.stationState(BOARD, cards, STATION);
  assert.equal(st.job, null);
  assert.equal(st.status, "open");
  assert.equal(st.queue.length, 1, "the job is still queued here, just not started");
});

test("stopping a job does not flip the bench back to the one it replaced", () => {
  /* Pausing A to start B parks A at the FRONT of this station's queue
   * (queuePos -1) with B on the clock. Both carry the tableId. Order the bench
   * by queuePos and pressing Stop on B makes A reappear -- the job the welder
   * deliberately stepped away from, returning because they stopped. Nothing
   * running means the bench shows whatever was touched last. */
  const A = claimedWork("LA", "s1", KEV, { worked: true, endedMinutesAgo: 90, queuePos: -1 });
  const B = claimedWork("LA", "s1", KEV, { worked: true, endedMinutesAgo: 1, queuePos: 0 });
  const st = T.stationState(BOARD, [card("A", A, 10), card("B", B, 20)], STATION);
  assert.equal(st.job.id, "B", "the job just stopped is still the job on the bench");
});

test("running always outranks paused, whatever the queue order says", () => {
  const A = claimedWork("LA", "s1", KEV, { worked: true, endedMinutesAgo: 1, queuePos: -1 });
  const B = claimedWork("LA", "s1", KEV, { running: true, queuePos: 5 });
  const st = T.stationState(BOARD, [card("A", A, 10), card("B", B, 20)], STATION);
  assert.equal(st.job.id, "B", "the station shows what is on the clock");
});

test("lastTouched answers zero for work nobody has ever started", () => {
  assert.equal(T.lastTouched(null), 0);
  assert.equal(T.lastTouched({ segments: [] }), 0);
  assert.ok(T.lastTouched({ segments: [{ start: "2026-09-16T10:00:00.000Z" }] }) > 0,
    "an open segment counts from its start");
});

/* ================================================= station config that sticks */

test("a station's hand-picked checklist survives a reload", () => {
  /* merge() rebuilds each shipped station from an explicit field list, and
   * `checklist` was not in it. A manager pointed the Blast booth at a list, saw
   * it take effect, and found it reset on the next load -- silently falling back
   * to matching by name, which hands all three finishing booths the same list
   * because they share one phase. That is exactly what per-station checklists
   * exist to prevent. */
  const merged = T.merge({
    stations: [{ id: "f1", checklist: "Blast prep" }],
    visible: ["f1"]
  });
  const f1 = merged.stations.find((s) => s.id === "f1");
  assert.equal(f1.checklist, "Blast prep");
});

/* =========================================================== the QC key name */

test("the SDK overlay writes the QC record under the name every reader uses", () => {
  /* THE BUG. popups/ops.js fetched the authoritative SDK copy of WFQC.KEY and
   * assigned it to `c.qcRequest`. Nothing in the repo reads that name -- every
   * consumer reads `card.qcRecord` -- so the fresh value went into a dead
   * property and the lagging REST copy survived. A welder signed the checklist,
   * the write succeeded, and the repaint showed the job as unsigned: Complete
   * bounced them straight back into the list they had just signed.
   *
   * This is a contract between two files, so it is asserted as one. */
  assert.equal(win.WFQC.KEY, "qcRecord");

  const ops = code("popups/ops.js");
  assert.ok(!/\bqcRequest\b/.test(ops),
    "nothing writes qcRequest -- no reader exists for it anywhere in the repo");
  // The bulk overlay and syncCard each land one. Both must exist: fixing one
  // and not the other leaves every action after the first still reading stale.
  assert.equal((ops.match(/\.qcRecord\s*=/g) || []).length, 2,
    "both the bulk overlay and syncCard assign to qcRecord");
});

/* ================================================ what the card surfaces load */

test("index.html loads everything a card surface needs to move a card", () => {
  /* THE BUG. index.html loaded a SHORTER list than popups/ops.html, and two
   * omissions mattered:
   *
   *   board-extras.js adds the three Assemble lists at runtime, so without it
   *   the connector's WFStage has never heard of the lists where all the welding
   *   happens -- getNextStage answers null and the card does not move;
   *
   *   jobtype.js + advance.js install the route-aware WFPhase.advance wrapper,
   *   so without them every card advanced from a card surface routes as legacy.
   *
   * The test harness loads board-extras, so the whole suite saw a board the
   * connector did not have. That is why this is asserted against the HTML. */
  ["index.html", "popups/card-back.html"].forEach((file) => {
    const html = read(file);
    ["lib/board-extras.js", "lib/jobtype.js", "lib/advance.js", "lib/phase.js"]
      .forEach((dep) => {
        assert.ok(html.includes(dep), file + " loads " + dep);
      });
    // advance.js wraps what phase.js defines, so it has to come after it.
    assert.ok(html.indexOf("lib/advance.js") > html.indexOf("lib/phase.js"),
      file + " loads advance.js after phase.js, or the wrapper wraps nothing");
    assert.ok(html.indexOf("lib/board-extras.js") > html.indexOf("config.js"),
      file + " loads board-extras.js after config.js, or there is no map to extend");
  });
});

test("every locally served asset carries a version token", () => {
  /* A Power-Up runs in an iframe that caches hard, so an unversioned asset can
   * serve a months-old copy through any number of hard refreshes with nothing to
   * show for it. card-back.html was the last live work surface outside the
   * scheme and was loading lib/phase.js and config.js unversioned. */
  ["index.html", "popups/card-back.html", "popups/ops.html"].forEach((file) => {
    const html = read(file);
    const locals = (html.match(/(?:src|href)="((?:\.|\/)[^"]+)"/g) || [])
      .map((m) => m.replace(/^(?:src|href)="|"$/g, ""));
    locals.forEach((url) => {
      assert.match(url, /\?v=/, file + " serves " + url + " without a version token");
    });
  });
});

/* ============================================ finishing a phase always works */

test("nothing finishes a phase by calling complete() and stopping there", () => {
  /* complete() sets pendingApproval and moves nothing. The only screens that
   * ever cleared that flag from a queue were the Approvals and Quality check
   * tabs, both retired -- so a caller that stops at complete() now strands the
   * card: off the shop floor (isFinished reads the flag), into "Waiting on a
   * manager", and no manager coming.
   *
   * The ops-window tabs are the ones a worker uses all day, so they are the ones
   * held here. connector.js and popups/card-back.js still render their own
   * Approve & Advance, so they are not yet stranding anything. */
  ["popups/tabs/myjobs.js", "popups/tabs/workboard.js", "popups/checklist.js"]
    .forEach((file) => {
      const calls = (code(file).match(/WFPhase\.complete\s*\(/g) || []).length;
      assert.equal(calls, 0,
        file + " must finish a phase through WFChecklist or WFQC, which advance it");
    });

  // And the two that DO call it pair it with an advance in the same chain.
  const qc = code("lib/qc.js");
  assert.equal((qc.match(/WFPhase\.complete\s*\(/g) || []).length, 2);
  assert.ok(/WFPhase\.advance\s*\(/.test(qc) && /approveAndAdvance\s*\(/.test(qc),
    "lib/qc.js is where complete() is allowed, because it moves the card after");
});

test("a peer-checked phase records who vouched, not just who ticked", async () => {
  /* The peer distinction used to live in a queue that nothing services any
   * more. It survives as the second name on the record, which is the only part
   * of a peer check that was ever worth anything. */
  const w = load();
  const store = {};
  const moved = [];
  w.WFRest = Object.assign({}, w.WFRest, {
    moveCard: (t, id, list) => { moved.push(list); return Promise.resolve({}); },
    postComment: () => Promise.resolve({}),
    addMemberToCard: () => Promise.resolve({})
  });
  const t = {
    get: (scope, vis, key, dflt) => {
      const v = store[scope + "/" + key];
      return Promise.resolve(v === undefined ? dflt : v);
    },
    set: (scope, vis, key, value) => {
      store[scope + "/" + key] = value; return Promise.resolve();
    },
    remove: (scope, vis, key) => { delete store[scope + "/" + key]; return Promise.resolve(); }
  };

  const worker = { id: "w", username: "mike", fullName: "Mike Ross" };
  const peer = { id: "p", username: "kevinmoss", fullName: "Kevin Moss" };
  const cfg = w.WF_CONFIG.boards[Object.keys(w.WF_CONFIG.boards)[0]];
  const stage = (cfg.stages || []).filter((s) => s.isWorkPhase)[0];
  const meta = { id: "c1", idList: stage.listId, idBoard: Object.keys(w.WF_CONFIG.boards)[0] };

  store["c1/phaseWork"] = {
    listId: stage.listId, claimedBy: worker,
    segments: [{ start: new Date(Date.now() - 3600000).toISOString(), end: null }]
  };

  await w.WFQC.submitSelfCheck(t, meta, stage.name, worker,
    [{ text: "Work is complete and correct", result: "pass", note: "" }], peer);

  const rec = store["c1/qcRecord"];
  assert.equal(rec.status, "passed");
  assert.equal(rec.rounds[0].checkedBy.username, "mike", "who ticked the list");
  assert.equal(rec.passedBy.username, "kevinmoss", "who vouched for it");
  assert.equal(store["c1/phaseWork"], undefined, "the phase is closed, not left waiting");
});
