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
  /* Anchored to getBoardCardsFull's own body, not to the file.
   * getCardDetail also asks for idBoard, so a file-wide match would still pass
   * with the line this test exists to protect deleted. */
  const source = code("lib/trello-rest.js");
  const start = source.indexOf("getBoardCardsFull");
  assert.ok(start > -1, "getBoardCardsFull still exists");
  const body = source.slice(start, source.indexOf("\n  }\n", start));

  assert.match(body, /fields:\s*"[^"]*\bidBoard\b/,
    "idBoard is requested from Trello");
  assert.match(body, /\bidBoard:\s*c\.idBoard\b/,
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

  /* Asserted on ASSIGNMENTS in the raw source rather than on the word in
   * stripped source. Comments in this file discuss both names by design -- that
   * is what stops the bug coming back -- and a stripper clever enough to tell a
   * comment from a regex literal is more machinery than the assertion is worth.
   * `.qcRequest =` appears in no comment and would appear in the bug. */
  const ops = read("popups/ops.js");
  assert.ok(!/\.qcRequest\s*=/.test(ops),
    "nothing assigns to qcRequest -- no reader exists for it anywhere in the repo");
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
    // The <script src> list only. These files explain themselves at length and
    // name every one of these paths in prose first, so a raw indexOf over the
    // file measures the order of the COMMENTARY, not the order of the tags.
    const srcs = (read(file).match(/<script\s+src="([^"]+)"/g) || [])
      .map((m) => m.replace(/^<script\s+src="|"$/g, ""));
    const at = (dep) => srcs.findIndex((s) => s.indexOf(dep) > -1);

    ["lib/board-extras.js", "lib/jobtype.js", "lib/advance.js", "lib/phase.js"]
      .forEach((dep) => {
        assert.ok(at(dep) > -1, file + " loads " + dep);
      });
    // advance.js wraps what phase.js defines, so it has to come after it.
    assert.ok(at("lib/advance.js") > at("lib/phase.js"),
      file + " loads advance.js after phase.js, or the wrapper wraps nothing");
    assert.ok(at("lib/board-extras.js") > at("config.js"),
      file + " loads board-extras.js after config.js, or there is no map to extend");
  });
});

test("every locally served asset carries a version token", () => {
  /* A Power-Up runs in an iframe that caches hard, so an unversioned asset can
   * serve a months-old copy through any number of hard refreshes with nothing to
   * show for it. card-back.html was the last live work surface outside the
   * scheme and was loading lib/phase.js and config.js unversioned. */
  const builds = {};
  ["index.html", "popups/card-back.html", "popups/ops.html"].forEach((file) => {
    const html = read(file);
    const locals = (html.match(/(?:src|href)="((?:\.|\/)[^"]+)"/g) || [])
      .map((m) => m.replace(/^(?:src|href)="|"$/g, ""));
    assert.ok(locals.length, file + " serves at least one local asset");
    locals.forEach((url) => {
      assert.match(url, /\?v=/, file + " serves " + url + " without a version token");
      builds[url.split("?v=")[1]] = true;
    });
  });

  /* ops.html emits ~30 script tags from an array via document.write, so they
   * never appear as a literal src="…" and the sweep above cannot see them. The
   * thing that versions them is the concatenation; assert on that directly,
   * or the whole ops window can silently drop out of the scheme. */
  const ops = read("popups/ops.html");
  assert.match(ops, /window\.WF_BUILD\s*=\s*"([^"]+)"/);
  assert.match(ops, /"\?v="\s*\+\s*window\.WF_BUILD/,
    "ops.html still appends WF_BUILD to every script it writes");

  // And one build number across all three files, or a deploy updates some of
  // the cache and not the rest -- which is worse than updating none of it.
  assert.equal(Object.keys(builds).length, 1,
    "index.html, card-back.html and ops.html are on the same build: " +
    Object.keys(builds).join(", "));
  assert.equal(Object.keys(builds)[0], ops.match(/window\.WF_BUILD\s*=\s*"([^"]+)"/)[1],
    "the tokens on the static tags match the one the scripts are written with");
});

test("the only surface that loads lib/qc.js also loads lib/steps.js", () => {
  /* THE SPLIT-PHASE GUARDS FAIL OPEN WITHOUT IT, AND ONE OF THEM FAILS SILENTLY.
   *
   * submitSelfCheck refuses a split phase behind `global.WFSteps && ...` -- a
   * short-circuit, so with steps.js absent the test reads false and My jobs
   * walks a finishing job straight past the powder booth again, with nothing
   * anywhere reporting a problem. passSigned reads the same global for the
   * hand-off decision. popups/tabs/floor.js names WFSteps BARE, which at least
   * throws, but a guard whose correctness depends on a script tag somebody
   * else maintains needs the script tag asserted. */
  const ops = read("popups/ops.html");
  const qcSurfaces = ["index.html", "popups/card-back.html", "popups/ops.html"]
    .filter((f) => read(f).includes("lib/qc.js"));
  assert.deepEqual(qcSurfaces, ["popups/ops.html"],
    "if another surface starts loading lib/qc.js it needs lib/steps.js too");
  assert.ok(ops.includes("lib/steps.js"),
    "ops.html loads lib/steps.js, so isSplit() is a real guard rather than a " +
    "short-circuit that is always false");
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

  /* And the three in lib/qc.js each pair it with something that un-strands the
   * card. Two advance (passSigned's last-step branch, submitSelfCheck). The
   * third is the blast-booth hand-off, which deliberately does NOT move the
   * card -- there is nowhere to move to -- so what has to be true of it is the
   * other half of the rule: it REMOVES phaseWork. Left in place, complete()'s
   * completedAt makes WFPhase.isFinished true, the job drops off the station
   * and lands in "Waiting on a manager" with no manager coming: the exact
   * stranding this test is named for, arriving by a new route. */
  const qc = code("lib/qc.js");
  assert.equal((qc.match(/WFPhase\.complete\s*\(/g) || []).length, 3);
  assert.ok(/WFPhase\.advance\s*\(/.test(qc) && /approveAndAdvance\s*\(/.test(qc),
    "lib/qc.js is where complete() is allowed, because it moves the card after");
  assert.match(qc, /t\.remove\s*\(\s*cardMeta\.id\s*,\s*"shared"\s*,\s*"phaseWork"\s*\)/,
    "and the hand-off that does not move the card clears the phase work instead");
});

/* ============================================== the 4096-character ceiling */

test("the limit is measured per scope, not per key", () => {
  /* Trello's docs: "The size limit on the resulting stringified object is 4096
   * characters PER SCOPE/VISIBILITY PAIR." Both earlier size checks in this
   * codebase measured one key and passed while the scope around them was over
   * — and lib/eos.js split its records across five keys specifically to dodge
   * the cap, which bought nothing.
   *
   * This is the assertion that stops that idea coming back. */
  const S = win.WFStore;
  const scope = { a: "x".repeat(2000), b: "y".repeat(2000) };
  const size = S.measure(scope);
  assert.ok(size.chars > 4000, "the whole scope counts, not the larger key");
  assert.ok(size.full, "and 2000 + 2000 is over, even though neither key is");
  assert.equal(S.measure({ a: "x".repeat(100) }).full, false);
});

test("a refusal names the biggest thing, not just a number", async () => {
  /* An error that only reports a number gets screenshotted and sent to me. The
   * only useful refusal says what to delete. */
  const store = { board: { qcTemplates: "x".repeat(3000), wfRoster: "y".repeat(900) } };
  const t = {
    get: (scope, vis, key) => Promise.resolve(
      key === undefined ? store[scope] : store[scope][key]),
    set: () => Promise.resolve()
  };
  await assert.rejects(
    () => win.WFStore.set(t, "board", "wfStations", "z".repeat(500),
      { label: "the station setup" }),
    (e) => {
      assert.equal(e.code, "WF_STORE_FULL");
      assert.match(e.message, /the station setup/);
      assert.match(e.message, /qcTemplates/, "names the largest thing stored");
      assert.match(e.message, /Nothing was changed/);
      return true;
    });
});

test("making room is never refused, however full the scope is", async () => {
  // The escape hatch a full scope depends on. If remove could be blocked by
  // fullness there would be no way back from a full board at all.
  const removed = [];
  const t = {
    get: () => Promise.resolve({}),
    set: () => Promise.resolve(),
    remove: (scope, vis, keys) => { removed.push(keys); return Promise.resolve(); }
  };
  await win.WFStore.remove(t, "board", ["eosRocks"]);
  assert.deepEqual(removed[0], ["eosRocks"]);
});

test("a write that fits goes through and reports the room left", async () => {
  const writes = [];
  const t = {
    get: () => Promise.resolve({ wfRoster: "y".repeat(200) }),
    set: (scope, vis, patch) => { writes.push([scope, vis, patch]); return Promise.resolve(); }
  };
  const size = await win.WFStore.set(t, "board", "wfStations", { a: 1 },
    { label: "the station setup" });
  assert.equal(writes.length, 1);
  // The object form, not four arguments: Trello's docs say several keys in one
  // call is the only safe way, because separate calls clobber one another.
  assert.deepEqual(writes[0][2], { wfStations: { a: 1 } });
  assert.ok(size.free > 0);
});

test("the sandbox understands every call shape WFStore uses", async () => {
  /* The shim only spoke the four-argument form. WFStore measures with a
   * two-argument get and writes with an object — under the old shim the patch
   * object would have been stored AS A KEY, so test mode would have recorded
   * garbage and shown the operator a rehearsal unrelated to the live path. A
   * sandbox whose fidelity depends on which overload you picked is worse than
   * none, because people trust it. */
  const w = load();
  const real = {
    get: (scope, vis, key, dflt) => Promise.resolve(
      key === undefined ? { existing: 1 } : dflt),
    set: () => Promise.reject(new Error("the sandbox must not write")),
    remove: () => Promise.reject(new Error("the sandbox must not write"))
  };
  w.WFSandbox.enable();
  const t = w.WFSandbox.wrap(real);

  await t.set("board", "shared", { wfStations: { a: 1 }, wfRoster: { b: 2 } });
  const all = await t.get("board", "shared");
  assert.equal(all.existing, 1, "reads fall through to the real board");
  assert.deepEqual(all.wfStations, { a: 1 }, "and see this session's writes");
  assert.deepEqual(all.wfRoster, { b: 2 });

  await t.remove("board", "shared", ["wfStations"]);
  const after = await t.get("board", "shared");
  assert.ok(!("wfStations" in after), "a removal is visible to the next read");
  w.WFSandbox.disable();
});

/* ------------------------------------------------ the QC record's real size */

test("a QC round stores verdicts, not another copy of the checklist", async () => {
  /* THE ONE THAT WAS FAILING IN PRODUCTION. Every round carried the full text
   * and tolerance of all ten checklist lines — text the record already holds
   * once in `template`. Round two put the record at ~4,080 of a budget the
   * card also shares with phaseWork and phaseLog; round three could not be
   * written at all. A failed check, a correction and a re-check is three
   * rounds, which is the ordinary path the fault path produces. */
  // A genuine Assemble phase, because that is the checklist being pulled. The
  // first work phase on the board is "Make Job Packet", so taking the default
  // signed off a phase this test never mentions.
  const env = benchEnv({ stage: "Assemble Legacy" });
  const QC = env.w.WFQC;
  const peer = { id: "p", username: "kevinmoss", fullName: "Kevin Moss" };

  // The shipped Assemble list: ten lines, with real tolerances. No fallback --
  // a checklistFor that started rejecting, or handing back a toy list, is the
  // kind of break this test is here to notice rather than paper over.
  const items = (await QC.checklistFor(env.t, { phase: "Assemble Legacy" })).items;
  assert.ok(items.length >= 8, "using a realistically long list, not a toy one");
  const checked = {};
  items.forEach((_, i) => { checked[i] = true; });

  for (let r = 0; r < 3; r++) {
    await QC.signOff(env.t, env.meta, {
      phase: env.stage.name, items, checked,
      signature: "Kevin Moss", signedBy: peer, worker: env.worker
    });
  }

  const rec = env.store["c1/qcRecord"];
  assert.equal(rec.rounds.length, 3, "three rounds actually wrote");

  const perRound = JSON.stringify(rec.rounds[0]).length;
  assert.ok(perRound < 500,
    "a round is verdicts and a signature, not a second copy of the list (was " +
    perRound + " characters)");
  const total = JSON.stringify(rec).length;
  assert.ok(total < win.WFStore.MARGIN,
    "and three rounds still fit inside the card's budget (" + total + ")");
});

test("a round written in the old shape still reads, forever", () => {
  /* Every record already on the board carries `items` per round. Rewriting them
   * would be a migration that could fail halfway on a live shop floor. Reading
   * is shape-agnostic instead, so nothing ever has to be migrated. */
  const QC = win.WFQC;
  const old = {
    template: ["ignored"],
    rounds: [{ n: 1, items: [{ text: "Frame is square", spec: "1/8\"", result: "fail", note: "twisted" }] }]
  };
  const hydrated = QC.roundItems(old, old.rounds[0]);
  assert.equal(hydrated[0].text, "Frame is square");
  assert.equal(hydrated[0].result, "fail");
  assert.equal(hydrated[0].note, "twisted");
  assert.equal(QC.failedItems(old.rounds[0], old).length, 1);

  const slim = {
    template: [{ text: "Frame is square", spec: "diagonals within 1/8\"" },
               { text: "All welds complete", spec: "" }],
    rounds: [{ n: 1, results: ["fail", "pass"], notes: { 0: "twisted 3mm" } }]
  };
  const both = QC.roundItems(slim, slim.rounds[0]);
  assert.equal(both.length, 2);
  assert.equal(both[0].text, "Frame is square", "text comes from the template");
  assert.equal(both[0].spec, "diagonals within 1/8\"", "and so does the tolerance");
  assert.equal(both[0].note, "twisted 3mm");
  assert.equal(both[1].result, "pass");
  assert.equal(both[1].note, "", "no note where nobody wrote one");
  assert.equal(QC.failedItems(slim.rounds[0], slim)[0].text, "Frame is square",
    "a failed line is still nameable, which is what the QC comment prints");
});

test("notes are stored only where somebody wrote one", () => {
  // An object full of empty strings is most of the saving thrown away.
  const packed = win.WFQC.packRound([
    { text: "a", result: "pass", note: "" },
    { text: "b", result: "fail", note: "  " },
    { text: "c", result: "fail", note: "porosity along the toe" }
  ]);
  assert.deepEqual(packed.results, ["pass", "fail", "fail"]);
  assert.deepEqual(packed.notes, { 2: "porosity along the toe" });
});

/* ========================================================= retiring approvals */

/** A window with REST stubbed for writes, plus a card carrying open phase work. */
function benchEnv(opts) {
  opts = opts || {};
  const w = load();
  const moved = [];
  const comments = [];
  w.WFRest = Object.assign({}, w.WFRest, {
    moveCard: (t, id, list) => { moved.push(list); return Promise.resolve({}); },
    postComment: (t, id, text) => { comments.push(text); return Promise.resolve({}); },
    addMemberToCard: () => Promise.resolve({})
  });
  const store = {};
  /* Speaks every shape the real API does, because WFStore uses more than one:
   * a two-argument get to measure a whole scope, and an object to set several
   * keys at once. A mock that only understood the four-argument form would make
   * the guard look like it works while measuring an empty scope. */
  const t = {
    get: (scope, vis, key, dflt) => {
      if (key === undefined) {
        const all = {};
        Object.keys(store).forEach((k) => {
          const [s, ...rest] = k.split("/");
          if (s === scope) all[rest.join("/")] = store[k];
        });
        return Promise.resolve(all);
      }
      const v = store[scope + "/" + key];
      return Promise.resolve(v === undefined ? dflt : v);
    },
    set: (scope, vis, key, value) => {
      if (key && typeof key === "object" && value === undefined) {
        Object.keys(key).forEach((k) => { store[scope + "/" + k] = key[k]; });
        return Promise.resolve();
      }
      store[scope + "/" + key] = value;
      return Promise.resolve();
    },
    remove: (scope, vis, key) => {
      [].concat(key).forEach((k) => { delete store[scope + "/" + k]; });
      return Promise.resolve();
    }
  };
  const boardId = Object.keys(w.WF_CONFIG.boards)[0];
  const cfg = w.WF_CONFIG.boards[boardId];
  const work = (cfg.stages || []).filter((s) => s.isWorkPhase);
  /* WHICH PHASE THE BENCH IS ON. Most tests here do not care and take the
   * first work phase, which is "Make Job Packet". A test whose assertions name
   * a phase -- pulling the Assemble checklist, say -- has to ask for that
   * phase by name, or it quietly signs off a different one and reads as
   * covering ground it never touched. */
  const stage = opts.stage
    ? work.find((s) => s.name === opts.stage)
    : work[0];
  if (!stage) throw new Error("no work phase named '" + opts.stage + "' in config.js");
  const meta = { id: "c1", idList: stage.listId, idBoard: boardId };
  const worker = { id: "w", username: "mike", fullName: "Mike Ross" };

  store["c1/phaseWork"] = {
    listId: stage.listId,
    claimedBy: worker,
    segments: [{ start: new Date(Date.now() - 3600000).toISOString(), end: null }],
    percentComplete: opts.pct || 40
  };
  return { w, t, store, meta, stage, worker, moved, comments };
}

/* ============================== two benches behind one Trello column */

const S = win.WFSteps;
const FINISH = "Sandblast / Powder Coat";

test("the blast booth and the powder booth do not share one queue", () => {
  /* THE BUG THIS EXISTS FOR. Both benches pull the same Trello list, because
   * that is the only list there is. Without a step filter every job appeared in
   * both queues at once and neither bench could tell which were its own. */
  const cfg = { stages: [{ listId: "LS", name: FINISH, order: 9, isWorkPhase: true }] };
  const mk = (id, labels) => ({
    id, name: "#" + id + " job", idList: "LS", pos: 100, due: null,
    phaseWork: null, labelNames: labels || []
  });
  const blastBooth = { id: "f1", area: "finishing", table: "Blast booth",
                       type: "blast", phase: FINISH };
  const powderBooth = { id: "f2", area: "finishing", table: "Powder booth",
                        type: "powder", phase: FINISH };

  const cards = [mk("RAW"), mk("DONE", ["Blasted"])];

  const blast = T.stationState(cfg, cards, blastBooth);
  const powder = T.stationState(cfg, cards, powderBooth);

  assert.deepEqual(blast.queue.map((c) => c.id), ["RAW"],
    "an unblasted job is the blast booth's");
  assert.deepEqual(powder.queue.map((c) => c.id), ["DONE"],
    "and a blasted one is the powder booth's — same column, different bench");
});

test("a card nobody attached labelNames to is at the FIRST step, not at none", () => {
  /* THE ASYMMETRY THIS GUARDS. `labelNames` is a joined field: card.idLabels
   * carries ids, the names live on the board, and exactly one file does the
   * join -- popups/ops.js, in cards(). Every other caller of stationState hands
   * over raw cards: the live-board smoke test, any tab that builds a fixture,
   * and every test in this repo written before the split existed.
   *
   * A missing join must therefore fail towards the FIRST step, which is where
   * unstarted work actually is. Failing the other way -- treating "no labels
   * known" as "belongs to no step" -- would empty both finishing queues at once
   * and report nothing: the blast booth would show "Open · assign a job" with
   * eleven jobs sitting in the column behind it.
   *
   * ops.js already degrades this way on purpose (a failed getBoardLabels falls
   * back to []), so this is the assertion that keeps that fallback meaningful. */
  const cfg = { stages: [{ listId: "LS", name: FINISH, order: 9, isWorkPhase: true }] };
  // No labelNames property at all -- not an empty array, absent.
  const bare = { id: "RAW", name: "#RAW job", idList: "LS", pos: 100, due: null,
                 phaseWork: null };
  assert.ok(!("labelNames" in bare), "the fixture really is missing the field");

  const blast = T.stationState(cfg, [bare],
    { id: "f1", area: "finishing", table: "Blast booth", type: "blast", phase: FINISH });
  const powder = T.stationState(cfg, [bare],
    { id: "f2", area: "finishing", table: "Powder booth", type: "powder", phase: FINISH });

  assert.deepEqual(blast.queue.map((c) => c.id), ["RAW"],
    "an unjoined card lands in the blast booth, which is where unblasted work is");
  assert.deepEqual(powder.queue.map((c) => c.id), [],
    "and not in both booths at once, which is the bug the split exists to fix");

  // The same rule stated at the layer that decides it, so a reader does not
  // have to infer it from a queue.
  assert.equal(S.stepFor(FINISH, undefined).step.id, "blast");
  assert.equal(S.stepFor(FINISH, null).step.id, "blast");
  assert.equal(S.namesOn({}, undefined).length, 0,
    "a card with no idLabels joins to no names rather than throwing");
});

test("a phase with no steps is untouched by any of this", () => {
  // Every welding bench, and every other phase on the board. The split must be
  // invisible to them or it is a change to the whole shop, not to one bay.
  const cfg = { stages: [{ listId: "LA", name: "Assemble Legacy", order: 8, isWorkPhase: true }] };
  const cards = [{ id: "A", name: "#A", idList: "LA", pos: 1, phaseWork: null, labelNames: ["Blasted"] }];
  const st = T.stationState(cfg, cards, STATION);
  assert.equal(st.queue.length, 1,
    "an unrelated label does not remove a job from a welding queue");
  assert.equal(S.stepsFor("Assemble Legacy").length, 0);
});

test("a job's step is read off its labels, and the last step needs none", () => {
  /* N steps need N-1 labels: finishing the last one moves the card, so its
   * position inside the column stops being a question. Blast then powder needs
   * exactly one label. */
  assert.equal(S.stepFor(FINISH, []).step.id, "blast");
  assert.equal(S.stepFor(FINISH, []).last, false);
  assert.equal(S.stepFor(FINISH, ["Blasted"]).step.id, "powder");
  assert.equal(S.stepFor(FINISH, ["Blasted"]).last, true);
  assert.equal(S.stepFor(FINISH, ["blasted"]).step.id, "powder",
    "matched case-insensitively, because a person may have made the label by hand");
  assert.deepEqual(S.labelNames(), ["Blasted"],
    "one step, one label — the powder step carries none");
  assert.equal(S.stepFor("Assemble Legacy", []), null);
});

test("finishing blast hands the job over without moving the card", async () => {
  /* The whole point. Advancing here would carry the job out of finishing
   * altogether, past the powder coat nobody had done. */
  const env = benchEnv({ stage: FINISH });
  const QC = env.w.WFQC;
  const peer = { id: "p", username: "kevinmoss", fullName: "Kevin Moss" };
  const labels = [];
  env.w.WFRest = Object.assign({}, env.w.WFRest, {
    getBoardLabels: () => Promise.resolve([]),
    createLabel: (t, b, name) => Promise.resolve({ id: "lbl1", name: name }),
    addLabelToCard: (t, cardId, id) => { labels.push(id); return Promise.resolve({}); },
    removeLabelFromCard: () => Promise.resolve({}),
    moveCard: (t, id, list) => { env.moved.push(list); return Promise.resolve({}); },
    postComment: () => Promise.resolve({})
  });

  await QC.signOff(env.t, env.meta, {
    phase: FINISH, items: [{ text: "Profile fully stripped", spec: "" }],
    checked: { 0: true }, signature: "Kevin Moss", signedBy: peer, worker: env.worker
  });

  const res = await QC.passSigned(env.t, env.meta,
    { idList: env.meta.idList, qcRecord: env.store["c1/qcRecord"] },
    { phase: FINISH, stationType: "blast" });

  assert.equal(env.moved.length, 0, "the card did not move — there is nowhere to move to");
  assert.equal(res.movedTo, null);
  assert.equal(res.handedTo.id, "powder", "it belongs to the powder booth now");
  assert.deepEqual(labels, ["lbl1"], "and the board shows it, via the label");
  assert.equal(env.store["c1/phaseWork"], undefined,
    "the blast booth's phase work is closed out");

  /* AND THE HOURS ARE LOGGED, WHICH THIS TEST USED TO ASSERT THE OPPOSITE OF.
   *
   * The original reasoning was that one entry per step would double-count the
   * phase. It does not: removing phaseWork DESTROYS the blast booth's segments,
   * and the powder booth then starts its own, so the single entry advance()
   * would eventually write covers powder alone. Every hour of blasting the shop
   * has ever done was missing from timeEntries and from costing. Each step logs
   * its own; two entries for one phase is right, because two people worked it. */
  const log = env.store["c1/phaseLog"];
  assert.equal(log.length, 1, "the blast booth's hours are on the card, not gone");
  assert.equal(log[0].listName, FINISH,
    "logged under the PHASE, so lib/costing.js buckets it into Sand & Powder " +
    "rather than filing 'Sandblast' as Unassigned");
  assert.equal(log[0].step, "Sandblast", "with the bench named alongside");
  assert.equal(log[0].durationMinutes, 60, "the real minutes, not zero");
  assert.ok(log[0].completedAt, "complete() ran first, so the entry is closed out");
  assert.equal(log[0].approvedBy.username, "kevinmoss", "credited to whoever signed");
});

test("both benches' hours survive, and the phase log names which bench did which", async () => {
  /* FIX 2, END TO END. Blast signs off and hands over; powder starts fresh,
   * signs off and ships the card. Two entries, one phase, two benches. */
  const env = benchEnv({ stage: FINISH });
  const QC = env.w.WFQC;
  const blastGuy = { id: "b", username: "kevinmoss", fullName: "Kevin Moss" };
  const powderGuy = { id: "d", username: "dsmith", fullName: "Dave Smith" };
  env.w.WFRest = Object.assign({}, env.w.WFRest, {
    getBoardLabels: () => Promise.resolve([{ id: "lbl1", name: "Blasted" }]),
    createLabel: () => Promise.resolve({ id: "lbl1", name: "Blasted" }),
    addLabelToCard: () => Promise.resolve({}),
    removeLabelFromCard: () => Promise.resolve({}),
    moveCard: (t, id, list) => { env.moved.push(list); return Promise.resolve({}); },
    postComment: () => Promise.resolve({})
  });

  // ---- the blast booth
  await QC.signOff(env.t, env.meta, {
    phase: FINISH, stepId: "blast", items: [{ text: "Profile fully stripped", spec: "" }],
    checked: { 0: true }, signature: "Kevin Moss", signedBy: blastGuy, worker: env.worker
  });
  await QC.passSigned(env.t, env.meta,
    { id: "c1", idList: env.meta.idList, qcRecord: env.store["c1/qcRecord"] },
    { phase: FINISH, stepId: "blast" });
  assert.equal(env.moved.length, 0, "the card has not left finishing");

  // ---- the powder booth, on its own clock. The blast booth's segments are
  // gone with its phaseWork, which is exactly why the entry above had to exist.
  env.store["c1/phaseWork"] = {
    listId: env.meta.idList,
    claimedBy: powderGuy,
    segments: [{ start: new Date(Date.now() - 1800000).toISOString(), end: null }],
    percentComplete: 90
  };
  await QC.signOff(env.t, env.meta, {
    phase: FINISH, stepId: "powder", items: [{ text: "Coverage even", spec: "" }],
    checked: { 0: true }, signature: "Dave Smith", signedBy: powderGuy, worker: powderGuy
  });
  await QC.passSigned(env.t, env.meta,
    { id: "c1", idList: env.meta.idList, idLabels: ["lbl1"],
      qcRecord: env.store["c1/qcRecord"] },
    { phase: FINISH, stepId: "powder", boardLabels: [{ id: "lbl1", name: "Blasted" }] });
  assert.equal(env.moved.length, 1, "the last step is the real hand-off");

  const log = env.store["c1/phaseLog"];
  assert.equal(log.length, 2, "two entries, because two people worked this phase");
  assert.deepEqual(log.map((e) => e.listName), [FINISH, FINISH],
    "both filed under the phase, so costing buckets them together");
  assert.deepEqual(log.map((e) => e.step), ["Sandblast", "Powder coat"],
    "and each says which bench");
  assert.deepEqual(log.map((e) => e.durationMinutes), [60, 30]);

  // The archive is the point of all of it.
  const entries = env.w.WFRecords.timeEntries([
    { id: "c1", name: "#1234 Handrail", phaseLog: log }
  ]);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.minutes).sort((a, b) => a - b), [30, 60],
    "both sets of minutes reach the records tab");
  assert.deepEqual(entries.map((e) => e.phase), [FINISH, FINISH]);
  assert.deepEqual(entries.map((e) => e.who).sort(), ["Dave Smith", "Mike Ross"]);

  // And costing does not choke on the extra `step` field, nor file either
  // entry as Unassigned -- which is exactly what would happen if the entries
  // had been logged under the STEP name instead of the phase name.
  const rows = env.w.WFCosting.buildJobRows([{
    id: "c1", name: "#1234 Handrail", idList: env.meta.idList,
    phaseLog: log, economics: { value: 10000 }
  }], null, {});
  const job = rows[0];
  assert.equal(job.unassigned.hours, 0,
    "neither entry lands in Unassigned — the phase name is what costing buckets on");
  assert.equal(job.allocation["Sand & Powder"].hours, 1.5,
    "both benches roll into Sand & Powder: 60 + 30 minutes");
  assert.equal(job.allocation["Sand & Powder"].entries === undefined, true,
    "the extra `step` field is simply ignored, not tripped over");
  assert.equal(Math.round(job.productionHours * 60), 90,
    "and all 90 minutes are counted once each, not double-counted");
});

test("the step's entry survives the trimming path, and says what it cost", async () => {
  /* appendLog trims from the FRONT until the write fits, and must never drop
   * the entry it was just called to record -- which on this path is the only
   * copy of the blast booth's hours in existence, because passSigned deletes
   * phaseWork a moment later. */
  const env = benchEnv({ stage: FINISH });
  const QC = env.w.WFQC;
  const peer = { id: "p", username: "kevinmoss", fullName: "Kevin Moss" };
  env.w.WFRest = Object.assign({}, env.w.WFRest, {
    getBoardLabels: () => Promise.resolve([]),
    createLabel: (t, b, name) => Promise.resolve({ id: "lbl1", name: name }),
    addLabelToCard: () => Promise.resolve({}),
    moveCard: () => Promise.resolve({}),
    postComment: () => Promise.resolve({})
  });

  await QC.signOff(env.t, env.meta, {
    phase: FINISH, stepId: "blast", items: [{ text: "Profile fully stripped", spec: "" }],
    checked: { 0: true }, signature: "Kevin Moss", signedBy: peer, worker: env.worker
  });

  // A well-travelled job: enough history that the card scope is already over
  // budget, so the trim loop has to run. Written after the sign-off because a
  // full card refuses the qcRecord write too, which is a different test.
  env.store["c1/phaseLog"] = Array.from({ length: 40 }, (_, i) => ({
    listId: "L" + i, listName: "ReWork",
    claimedBy: { id: "w", username: "mike", fullName: "Mike Ross" },
    durationMinutes: 10 + i, completedAt: "2026-01-0" + ((i % 9) + 1) + "T00:00:00.000Z",
    approvedBy: { id: "p", username: "kevinmoss", fullName: "Kevin Moss" },
    approvedAt: "2026-01-0" + ((i % 9) + 1) + "T00:00:00.000Z"
  }));

  await QC.passSigned(env.t, env.meta,
    { id: "c1", idList: env.meta.idList, qcRecord: env.store["c1/qcRecord"] },
    { phase: FINISH, stepId: "blast" });

  const log = env.store["c1/phaseLog"];
  assert.ok(log.length < 41, "it really did have to trim to fit");
  const last = log[log.length - 1];
  assert.equal(last.step, "Sandblast", "and the entry it was called to write is still there");
  assert.equal(last.listName, FINISH);
  assert.equal(last.durationMinutes, 60);
  assert.ok(last.trimmed > 0,
    "carrying a count of what was dropped, so the archive can say the history " +
    "is shorter than the truth rather than pretending it is complete");
});

test("a signature belongs to a bench, not to a list", async () => {
  /* FIX 1. The blast booth's sign-off must not answer for the powder booth,
   * which shares its Trello column and therefore its qcRecord key. */
  const env = benchEnv({ stage: FINISH });
  const QC = env.w.WFQC;
  const peer = { id: "p", username: "kevinmoss", fullName: "Kevin Moss" };

  await QC.signOff(env.t, env.meta, {
    phase: FINISH, stepId: "blast", items: [{ text: "Profile fully stripped", spec: "" }],
    checked: { 0: true }, signature: "Kevin Moss", signedBy: peer, worker: env.worker
  });
  const card = { id: "c1", idList: env.meta.idList, qcRecord: env.store["c1/qcRecord"] };

  assert.equal(QC.floorSignOff(card, "powder"), null,
    "the powder booth does not inherit the blast booth's signature");
  assert.ok(QC.floorSignOff(card, "blast"), "and the blast booth still sees its own");
  assert.equal(QC.floorSignOff(card, "blast").stepId, "blast");
  assert.equal(card.qcRecord.rounds[0].stepId, "blast",
    "stamped on the round too, so a record carrying both benches says which is which");

  /* AND A CALLER THAT DOES NOT KNOW ABOUT BENCHES STILL SEES THE RECORD.
   *
   * lib/records.js, the archive and every undivided phase ask this question
   * with no step. If a stamped record stopped answering it, finishing QC would
   * vanish from the archive entirely -- the fix would have traded one silent
   * data loss for another. */
  assert.ok(QC.floorSignOff(card),
    "asked with no step, a stamped record still answers");
  assert.equal(QC.floorSignOff(card).stepId, "blast",
    "and hands back the stamp, so a reader can still tell which bench");
});

test("an undivided phase signs off with no step on either side", async () => {
  // Both absent is the normal case for every phase except finishing, and the
  // stepId rules must be invisible to it.
  const env = benchEnv();
  const QC = env.w.WFQC;
  const peer = { id: "p", username: "kevinmoss", fullName: "Kevin Moss" };
  await QC.signOff(env.t, env.meta, {
    phase: env.stage.name, items: [{ text: "Packet complete", spec: "" }],
    checked: { 0: true }, signature: "Kevin Moss", signedBy: peer, worker: env.worker
  });
  const card = { id: "c1", idList: env.meta.idList, qcRecord: env.store["c1/qcRecord"] };
  assert.equal(card.qcRecord.stepId, null);
  assert.ok(QC.floorSignOff(card), "no step asked for, none recorded, matches");
  assert.equal(QC.floorSignOff(card, "blast"), null,
    "but a bench that asks by name is not answered by an unstamped record — " +
    "fail closed, because the alternative is shipping powder nobody checked");
});

test("my jobs cannot walk a finishing job past the powder booth", async () => {
  /* FIX 3. submitSelfCheck arrives with a phase name and nothing else: no
   * station, so no way to tell blast from powder. Advancing regardless is the
   * original bug on a second surface. */
  const env = benchEnv({ stage: FINISH });
  const QC = env.w.WFQC;
  await assert.rejects(
    () => QC.submitSelfCheck(env.t, env.meta, FINISH, env.worker,
      [{ text: "Coverage even", spec: "", result: "pass", note: "" }]),
    /more than one bench|Floor tab/,
    "it refuses and says where to go, rather than guessing which booth you are at");
  assert.equal(env.moved.length, 0, "and the card stays in finishing");

  // An undivided phase is untouched by the rule.
  const ok = benchEnv();
  ok.w.WFRest = Object.assign({}, ok.w.WFRest, {
    moveCard: (t, id, list) => { ok.moved.push(list); return Promise.resolve({}); },
    postComment: () => Promise.resolve({})
  });
  const res = await ok.w.WFQC.submitSelfCheck(ok.t, ok.meta, ok.stage.name, ok.worker,
    [{ text: "Packet complete", spec: "", result: "pass", note: "" }]);
  assert.equal(res.passed, true);
  assert.equal(ok.moved.length, 1, "a one-bench phase still self-checks and advances");
});

test("finishing powder does move the card, and takes the label off", async () => {
  const env = benchEnv({ stage: FINISH });
  const QC = env.w.WFQC;
  const peer = { id: "p", username: "kevinmoss", fullName: "Kevin Moss" };
  const dropped = [];
  env.w.WFRest = Object.assign({}, env.w.WFRest, {
    getBoardLabels: () => Promise.resolve([{ id: "lbl1", name: "Blasted" }]),
    createLabel: () => Promise.resolve({ id: "lbl1", name: "Blasted" }),
    addLabelToCard: () => Promise.resolve({}),
    removeLabelFromCard: (t, cardId, id) => { dropped.push(id); return Promise.resolve({}); },
    moveCard: (t, id, list) => { env.moved.push(list); return Promise.resolve({}); },
    postComment: () => Promise.resolve({})
  });

  await QC.signOff(env.t, env.meta, {
    phase: FINISH, items: [{ text: "Coverage even", spec: "" }],
    checked: { 0: true }, signature: "Kevin Moss", signedBy: peer, worker: env.worker
  });

  const card = { id: "c1", idList: env.meta.idList, idLabels: ["lbl1"],
                 qcRecord: env.store["c1/qcRecord"] };
  await QC.passSigned(env.t, env.meta, card, {
    phase: FINISH, stationType: "powder",
    boardLabels: [{ id: "lbl1", name: "Blasted" }]
  });

  assert.equal(env.moved.length, 1, "the last step is a real hand-off");
  assert.deepEqual(dropped, ["lbl1"],
    "and the step label comes off, so a job coming back for rework does not " +
    "land straight in the powder queue unblasted");
});

test("the phantom stations are gone and cannot walk back in", () => {
  /* The cure oven and the wet paint bay were both invented in the defaults and
   * neither exists in the shop. Deleting them from DEFAULTS is not enough:
   * merge() reads any saved station it does not recognise as one the shop added
   * itself, so a board that saved a config while they were shipping would get
   * them back on every load, staffed by nobody, taking a column on the TV. */
  const d = T.defaults().map(T.hydrate);
  const finishing = d.filter((s) => s.area === "finishing");
  assert.deepEqual(finishing.map((s) => s.table), ["Blast booth", "Powder booth"]);
  assert.ok(!T.typeOf("cure"), "the cure type is gone");
  assert.ok(!T.typeOf("wet"), "and so is wet paint");

  const merged = T.merge({
    stations: [{ id: "f3", table: "Cure oven", type: "cure" },
               { id: "f4", table: "Wet paint", type: "wet" },
               { id: "x1", area: "shop", table: "Fifth bench", type: "weld" }],
    visible: ["f3", "f4", "x1"]
  });
  assert.ok(!merged.stations.some((s) => s.id === "f3"));
  assert.ok(!merged.stations.some((s) => s.id === "f4"));
  assert.ok(merged.stations.some((s) => s.id === "x1"),
    "a station the shop really did add is still kept");
});

test("getBoardCardsFull hands back idLabels", () => {
  /* Exactly the idBoard bug again: a field asked for and then dropped from the
   * projection. Without it every card reads as unlabelled, so every job looks
   * unblasted and the powder booth's queue is permanently empty. */
  const source = code("lib/trello-rest.js");
  const start = source.indexOf("getBoardCardsFull");
  const body = source.slice(start, source.indexOf("\n  }\n", start));
  assert.match(body, /fields:\s*"[^"]*\bidLabels\b/, "asked for");
  assert.match(body, /\bidLabels:\s*c\.idLabels\b/, "and carried into the result");
});

/* ==================================================================== faults */

/** A card shaped the way the Floor and Records read one. */
function cardWith(rec, meta) {
  return { id: "c1", name: "#2412 Handrail", idList: meta.idList, qcRecord: rec };
}

test("a failed line cannot be signed off, however carefully the rest was checked", () => {
  /* THE GATE THE WHOLE FEATURE TURNS ON. Before this a line was tick or
   * not-yet, and canSignOff demanded all ticks — so somebody looking at a
   * twisted frame had two options: walk away, or tick it anyway. A gate with no
   * way to say no teaches people to say yes. */
  const QC = win.WFQC;
  const items = [{ text: "Frame is square" }, { text: "Welds complete" }];
  const signer = { username: "kevinmoss", fullName: "Kevin Moss" };

  assert.equal(QC.canSignOff(items, { 0: true, 1: true }, "Kevin Moss", signer), true,
    "a clean list still signs");
  assert.equal(
    QC.canSignOff(items, { 0: true, 1: true }, "Kevin Moss", signer, { 0: true }), false,
    "one failed line stops it, even with everything ticked and signed");
  assert.match(QC.signHint(items, { 0: true, 1: true }, "Kevin Moss", signer, { 0: true }),
    /marked wrong/i, "and the hint says what is actually in the way");
});

test("recording a fault keeps the job where it is and says what is wrong", async () => {
  /* The user's choice, in their words: fail an item, the job stays put, the
   * fault is recorded with a comment. Nothing advances and nothing moves — the
   * job stays with the person who can fix it. */
  const env = benchEnv({ stage: "Assemble Legacy" });
  const QC = env.w.WFQC;

  const res = await QC.recordFaults(env.t, env.meta, {
    phase: env.stage.name,
    items: [
      { text: "Frame is square", spec: "diagonals within 1/8\"",
        result: "fail", note: "twisted 3mm across the diagonal" },
      { text: "All welds complete", result: "pass", note: "" }
    ],
    worker: env.worker
  });

  assert.equal(res.faults.length, 1);
  assert.equal(res.faults[0].note, "twisted 3mm across the diagonal");
  assert.equal(env.moved.length, 0, "the card did not move");
  assert.ok(env.store["c1/phaseWork"], "and the phase is still open on the bench");

  const rec = env.store["c1/qcRecord"];
  assert.equal(rec.rounds.length, 1);
  assert.ok(!rec.signature, "a round that found a fault is not a signature");
  assert.equal(QC.floorSignOff(cardWith(rec, env.meta)), null);
});

test("a fault nobody described is refused", async () => {
  // The note is the entire reason faults are collected. A tally of anonymous
  // failures teaches nobody anything, which makes gathering it busywork.
  const env = benchEnv({ stage: "Assemble Legacy" });
  await assert.rejects(
    () => env.w.WFQC.recordFaults(env.t, env.meta, {
      items: [{ text: "Frame is square", result: "fail", note: "  " }],
      worker: env.worker
    }),
    /what's wrong/i);
  assert.equal(env.store["c1/qcRecord"], undefined, "and nothing was written");
});

test("a round with nothing wrong is not a fault report", async () => {
  const env = benchEnv({ stage: "Assemble Legacy" });
  await assert.rejects(
    () => env.w.WFQC.recordFaults(env.t, env.meta, {
      items: [{ text: "Frame is square", result: "pass", note: "" }],
      worker: env.worker
    }),
    /sign it off instead/i);
});

test("the fix is stored against the fault, not loose beside it", async () => {
  /* "Twisted 3mm across the diagonal" and "reheated and re-clamped, re-measured
   * at 1/16" are one fact split in two. Either half alone teaches nothing a
   * year later, which is the only reason any of this is collected. */
  const env = benchEnv({ stage: "Assemble Legacy" });
  const QC = env.w.WFQC;
  const fixer = { id: "f", username: "scottv", fullName: "Scott VanWorkom" };

  await QC.recordFaults(env.t, env.meta, {
    phase: env.stage.name,
    items: [
      { text: "Frame is square", result: "fail", note: "twisted 3mm" },
      { text: "All welds complete", result: "fail", note: "porosity at the toe" }
    ],
    worker: env.worker
  });

  assert.equal(QC.openFaults(cardWith(env.store["c1/qcRecord"], env.meta)).length, 2);
  /* THE STATUS IS HALF THE FEATURE AND NOTHING WAS ASSERTING IT.
   *
   * awaiting_correction is what every other reader of this record keys on to
   * know the job is not passable, and it was possible to delete the line that
   * sets it with the whole fault suite still green. */
  assert.equal(env.store["c1/qcRecord"].status, "awaiting_correction",
    "recording a fault parks the record, it does not pass or reject it");

  await QC.resolveFault(env.t, env.meta, 0, "reheated and re-clamped, now 1/16", fixer);
  let rec = env.store["c1/qcRecord"];
  assert.equal(QC.openFaults(cardWith(rec, env.meta)).length, 1,
    "one answered, one still open");
  assert.equal(rec.status, "awaiting_correction",
    "one fault answered out of two is still a job waiting on an answer");
  assert.equal(rec.rounds[0].fixes[0].what, "reheated and re-clamped, now 1/16");
  assert.equal(rec.rounds[0].fixes[0].by.username, "scottv",
    "and who answered it, which is not always who found it");

  await QC.resolveFault(env.t, env.meta, 1, "ground out and re-run", fixer);
  rec = env.store["c1/qcRecord"];
  assert.equal(QC.openFaults(cardWith(rec, env.meta)).length, 0);
  assert.equal(QC.hasOpenFaults(cardWith(rec, env.meta)), false);
  assert.equal(rec.status, "awaiting_check",
    "the last answer puts the job back in front of the checklist, not past it");
  // Answered is not passed. The job still has to be worked and signed, which
  // is the second look the fault earned.
  assert.equal(QC.floorSignOff(cardWith(rec, env.meta)), null,
    "answering a fault does not sign the job off");
});

test("an answer is required, and an empty one changes nothing", async () => {
  const env = benchEnv({ stage: "Assemble Legacy" });
  const QC = env.w.WFQC;
  await QC.recordFaults(env.t, env.meta, {
    items: [{ text: "Frame is square", result: "fail", note: "twisted" }],
    worker: env.worker
  });
  await assert.rejects(
    () => QC.resolveFault(env.t, env.meta, 0, "   ", env.worker),
    /what was done/i);
  assert.equal(QC.openFaults(cardWith(env.store["c1/qcRecord"], env.meta)).length, 1);
});

test("only the latest round's faults are open; earlier ones are history", async () => {
  /* An earlier round's fault was either answered or superseded by a later look.
   * Either way it is history, and history is not a to-do list — otherwise every
   * job that ever failed anything would show as needing attention forever. */
  const env = benchEnv({ stage: "Assemble Legacy" });
  const QC = env.w.WFQC;
  const peer = { id: "p", username: "kevinmoss", fullName: "Kevin Moss" };

  await QC.recordFaults(env.t, env.meta, {
    items: [{ text: "Frame is square", result: "fail", note: "twisted" }],
    worker: env.worker
  });
  await QC.resolveFault(env.t, env.meta, 0, "re-clamped", env.worker);
  await QC.signOff(env.t, env.meta, {
    phase: env.stage.name,
    items: [{ text: "Frame is square", spec: "" }],
    checked: { 0: true }, signature: "Kevin Moss", signedBy: peer, worker: env.worker
  });

  const rec = env.store["c1/qcRecord"];
  assert.equal(rec.rounds.length, 2, "the failed round and the passing one both survive");
  assert.equal(rec.rounds[0].results[0], "fail", "round one still says what happened");
  assert.equal(rec.rounds[0].fixes[0].what, "re-clamped");
  assert.equal(QC.openFaults(cardWith(rec, env.meta)).length, 0);
  assert.ok(QC.floorSignOff(cardWith(rec, env.meta)), "and the job can pass now");

  /* THE CASE THE TITLE ACTUALLY CLAIMS, WHICH NOTHING ABOVE TESTS.
   *
   * Every fault above was ANSWERED before the next round was written, so
   * openFaults reads zero whether it looks at the last round or at all of them
   * -- an implementation that scanned every round would sail through the whole
   * test and its name. What distinguishes them is an UNANSWERED fault on an
   * earlier round, superseded by a later look that passed. Built by hand
   * because the bench path deliberately will not produce one: the Floor refuses
   * to show a checklist while a fault is open, so getting here means the record
   * came from another surface, which is exactly when a reader needs the rule.
   *
   * Round 2 passed. Round 1's complaint is history, and history is not a
   * to-do list -- otherwise every job that ever failed anything shows as
   * needing attention forever. */
  const superseded = {
    listId: env.meta.idList, phase: env.stage.name, mode: "floor", status: "passed",
    template: [{ text: "Frame is square", spec: "" }],
    rounds: [
      { n: 1, results: ["fail"], notes: { 0: "twisted" },
        // Somebody raised this one deliberately, which is what foundBy records
        // and what separates it from an unticked line of an unfinished list.
        foundBy: { id: "m", username: "mike", fullName: "Mike Ross" },
        checkedAt: new Date().toISOString() },
      { n: 2, results: ["pass"], checkedAt: new Date().toISOString() }
    ]
  };
  assert.equal(QC.openFaults(cardWith(superseded, env.meta)).length, 0,
    "an unanswered fault on an earlier round is history, not an open fault");
  assert.equal(QC.hasOpenFaults(cardWith(superseded, env.meta)), false);
  // And the same record read the other way round: the fault IS open while the
  // round that found it is still the most recent thing anybody did.
  assert.equal(
    QC.openFaults(cardWith(
      Object.assign({}, superseded, { rounds: superseded.rounds.slice(0, 1) }),
      env.meta)).length,
    1, "while it is the latest round, it is very much open");
});

test("Records pairs every fault with what was done, and names the worst phase", () => {
  /* The whole point of collecting faults. A tally says "dimensions match the
   * measure sheet, 11 times" — which reports a problem and explains nothing.
   * What people wrote when they fixed it is the lesson. */
  const R = win.WFRecords;
  /* `minsAgo` is not decoration. These all used to stamp `new Date()` as they
   * were built, and qcEntries sorts newest first — so whenever the last fixture
   * crossed a millisecond boundary ahead of the first two, the unanswered fault
   * sorted to the top and the three assertions below failed. About two runs in
   * a thousand, which is the worst kind of failing test: the code was fine and
   * the next run was green. Explicit, spaced timestamps pin the order. */
  const mk = (phase, note, fix, minsAgo) => ({
    id: "c" + Math.random(), name: "#1 job", idList: "LA",
    qcRecord: {
      listId: "LA", phase: phase, mode: "floor",
      template: [{ text: "Dimensions match the measure sheet", spec: "" }],
      rounds: [Object.assign(
        { n: 1, results: ["fail"], notes: { 0: note }, checkedBy: { fullName: "Mike" },
          foundBy: { fullName: "Mike" },
          checkedAt: new Date(Date.now() - minsAgo * 60000).toISOString() },
        fix ? { fixes: { 0: { what: fix, by: { fullName: "Scott" },
                              at: new Date().toISOString() } } } : {})]
    }
  });

  const entries = R.qcEntries([
    mk("Assemble Legacy", "3mm long", "re-cut to the sheet", 1),
    mk("Assemble Legacy", "5mm short", "re-cut to the sheet", 2),
    mk("Sandblast / Powder Coat", "wrong sheet used", null, 3)
  ]);

  assert.equal(entries[0].failed[0].fixed, true);
  assert.equal(entries[0].failed[0].fix, "re-cut to the sheet");
  assert.equal(entries[0].failed[0].fixedBy, "Scott");

  const s = R.qcSummary(entries);
  assert.equal(s.openFaults, 1, "the unanswered one is still open");
  const top = s.topFailures[0];
  assert.equal(top.text, "Dimensions match the measure sheet");
  assert.equal(top.n, 3);
  assert.equal(top.worstPhase, "Assemble Legacy",
    "a line failing at one bench is a bench problem, not a wording problem");
  assert.ok(top.fixes.includes("re-cut to the sheet"),
    "the answers are kept, not just the count");
  assert.ok(top.notes.includes("3mm long"));
});

test("an unfinished self-check is not a pile of faults", async () => {
  /* THE ONE THAT WOULD HAVE SHIPPED. popups/checklist.js stores every UNTICKED
   * line of a self-check as result "fail" — deliberately, and documented: there
   * it means "the phase isn't finished", nothing moves and nobody is blamed.
   *
   * That collides head-on with the distinction this whole feature rests on.
   * Without a test for the difference, a drafter who ticks one line of the
   * eight-line CAD list and goes home produces SEVEN open faults: Records reads
   * "7 jobs waiting on an answer", the station goes red, Complete becomes
   * "! 7 faults", and the checklist is replaced by a screen demanding what was
   * done about lines nobody said were wrong — with no way out but answering
   * them. It fires on the ordinary "not finished yet" state, not an edge case. */
  const env = benchEnv({ stage: "CAD" });
  const QC = env.w.WFQC;

  await QC.submitSelfCheck(env.t, env.meta, env.stage.name, env.worker, [
    { text: "Dimensions match the measure sheet", result: "pass", note: "" },
    { text: "Revision number is current", result: "fail", note: "" },
    { text: "Material called out", result: "fail", note: "" }
  ]);

  const rec = env.store["c1/qcRecord"];
  assert.equal(rec.rounds[0].results.filter((r) => r === "fail").length, 2,
    "the round really does store them as failures — that is the trap");
  assert.equal(QC.isFaultRound(rec.rounds[0]), false,
    "but it is not a fault round: nobody raised anything");
  assert.equal(QC.openFaults(cardWith(rec, env.meta)).length, 0,
    "so the shop floor sees no faults");

  const s = env.w.WFRecords.qcSummary(
    env.w.WFRecords.qcEntries([cardWith(rec, env.meta)]));
  assert.equal(s.openFaults, 0, "and Records does not count them either");
});

test("only a DECLARED self-check is set aside; an unmarked old round still counts", () => {
  /* THE OTHER HALF OF THE SAME TRAP, AND IT CUTS THE OPPOSITE WAY.
   *
   * Setting unfinished self-checks aside is right. Deciding which rounds those
   * ARE by asking WFQC.modeOf is not: modeOf falls back to "self" for any
   * record with no mode, no signature and no peer markers — which is every
   * record written before the mode field existed. Those came off the peer path,
   * where a checker looked at a line and failed it deliberately. Reading them
   * as "unfinished" would quietly drop real history out of the pass rate, the
   * per-phase table and the repeat-offender list: the archive would get
   * cleaner-looking by forgetting things, and nothing would report it.
   *
   * So `unfinished` tests rd.mode — the round's OWN stamp — not the inferred
   * one. Every current writer stamps it, so "unknown" safely means "count it".
   */
  const R = win.WFRecords;
  const LINE = "Dimensions match the measure sheet";
  const at = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
  const mk = (id, rec) => ({ id, name: "#" + id + " job", idList: "LA", qcRecord: rec });
  const tpl = [{ text: LINE, spec: "" }, { text: "Revision number is current", spec: "" }];

  // 1. A round that SAYS it is a self-check. Its failures are unticked lines.
  const declaredSelf = mk("self", {
    listId: "LA", phase: "CAD", mode: "self", template: tpl,
    rounds: [{ n: 1, mode: "self", results: ["pass", "fail"], checkedAt: at(1) }]
  });

  // 2. A round from before the mode field: nothing on the round, and nothing on
  //    the record for modeOf to go on either, so modeOf guesses "self".
  const legacy = mk("legacy", {
    listId: "LA", phase: "CAD", template: tpl,
    rounds: [{ n: 1, results: ["pass", "fail"], checkedAt: at(2) }]
  });
  assert.equal(win.WFQC.modeOf(legacy.qcRecord), "self",
    "the premise: modeOf really does guess 'self' here — that is the trap");

  // 3. A peer round. Its failures are judgements a checker made on purpose.
  const peer = mk("peer", {
    listId: "LA", phase: "CAD", mode: "peer", template: tpl,
    rounds: [{ n: 1, mode: "peer", results: ["pass", "fail"], checkedAt: at(3) }]
  });

  const entries = R.qcEntries([declaredSelf, legacy, peer]);
  const by = (id) => entries.find((e) => e.cardId === id);

  assert.equal(by("self").unfinished, true,
    "a declared self-check carrying failures is work in progress");

  assert.equal(by("legacy").mode, "self",
    "the inferred mode is still reported — it is only not used to set it aside");
  assert.equal(by("legacy").unfinished, false,
    "but an unmarked old round is NOT assumed unfinished: it came off the peer path");
  assert.equal(by("legacy").passed, false, "it counts, and it counts as a failure");

  assert.equal(by("peer").unfinished, false, "a peer round's failures are judgements");

  const s = R.qcSummary(entries);
  assert.equal(s.rounds, 3);
  assert.equal(s.unfinished, 1, "exactly one round is set aside, not two");
  assert.equal(s.failed, 2, "the old round and the peer round both count as failures");
  assert.equal(s.passed, 0);
  assert.equal(s.passRate, 0, "over the two judged rounds, not all three");
  assert.equal(s.byPhase.CAD.rounds, 2, "and the per-phase table sees both of them");
  assert.equal((s.topFailures.find((f) => f.text === LINE) || {}).n, undefined,
    "the passing line is not in the failure table");
  const worst = s.topFailures.find((f) => f.text === "Revision number is current");
  assert.equal(worst && worst.n, 2,
    "the repeat-offender list keeps the real history it would otherwise forget");
});

test("only a round somebody raised can hold a fault", async () => {
  // The discriminator, asserted directly. foundBy is written by recordFaults
  // and by nothing else, and recordFaults refuses a failure with no note — so
  // a round carrying it is a round where somebody looked and described it.
  const env = benchEnv({ stage: "Assemble Legacy" });
  const QC = env.w.WFQC;
  await QC.recordFaults(env.t, env.meta, {
    items: [{ text: "Frame is square", result: "fail", note: "twisted" }],
    worker: env.worker
  });
  const round = env.store["c1/qcRecord"].rounds[0];
  assert.ok(round.foundBy, "recordFaults stamps who raised it");
  assert.equal(QC.isFaultRound(round), true);
  assert.equal(QC.isFaultRound({ results: ["fail"] }), false,
    "a bare failed result is not a fault");
});

test("a round pins its own checklist when the list has changed under it", async () => {
  /* Verdicts are stored by POSITION against a template. A manager editing the
   * list between a fault round and the sign-off would re-point round 1's
   * results — and its fixes, keyed the same way — at different lines, so the
   * record would calmly report the wrong thing failing and the wrong answer to
   * it. Nothing would throw. */
  const QC = win.WFQC;
  const original = [{ text: "Frame is square", spec: "1/8\"" },
                    { text: "Welds complete", spec: "" }];

  const same = QC.packRound(
    original.map((i) => Object.assign({ result: "pass", note: "" }, i)), original);
  assert.ok(!same.tpl, "an unchanged list is not copied onto the round");

  const changed = QC.packRound(
    [{ text: "Welds complete", spec: "", result: "fail", note: "porosity" }],
    original);
  assert.ok(changed.tpl, "a different list is pinned to the round that used it");

  const rec = { template: original, rounds: [changed] };
  const items = QC.roundItems(rec, changed);
  assert.equal(items[0].text, "Welds complete",
    "and reading the round gives the line actually worked, not the record's");
  assert.equal(items[0].note, "porosity");
});

test("editing the list between a fault and the sign-off cannot re-point the fault", async () => {
  /* THE HALF THE PINNING FIX MISSED. packRound pinning a round's own template
   * is only half the guard: signOff also REPLACED the record's template with
   * the list being signed, while carrying the earlier rounds over untouched.
   * Those rounds store verdicts by POSITION, and their fixes are keyed the same
   * way, so a manager using "Edit this list" between a fault round and the
   * sign-off silently re-pointed round 1 at different lines — the record then
   * reported the wrong line failing, with somebody else's answer attached to
   * it, and nothing threw. Read by a trainer a year later it is worse than no
   * record at all, because it reads as a real one. */
  const env = benchEnv({ stage: "Assemble Legacy" });
  const QC = env.w.WFQC;
  const peer = { id: "p", username: "kevinmoss", fullName: "Kevin Moss" };

  await QC.recordFaults(env.t, env.meta, {
    phase: env.stage.name,
    items: [{ text: "Frame is square", spec: "1/8\"", result: "fail", note: "twisted 3mm" },
            { text: "Welds complete", spec: "", result: "pass", note: "" }],
    worker: env.worker
  });
  await QC.resolveFault(env.t, env.meta, 0, "re-clamped and re-measured", env.worker);

  // The manager edits the list — a line inserted ABOVE the one that failed, so
  // every position below it shifts by one.
  const edited = [{ text: "Powder coat thickness", spec: "60-80um" },
                  { text: "Frame is square", spec: "1/8\"" },
                  { text: "Welds complete", spec: "" }];
  await QC.signOff(env.t, env.meta, {
    phase: env.stage.name, items: edited, checked: { 0: true, 1: true, 2: true },
    signature: "Kevin Moss", signedBy: peer, worker: env.worker
  });

  const rec = env.store["c1/qcRecord"];
  assert.equal(rec.rounds.length, 2);

  const round1 = QC.roundItems(rec, rec.rounds[0]);
  const failed = round1.filter((i) => i.result === "fail");
  assert.equal(failed.length, 1);
  assert.equal(failed[0].text, "Frame is square",
    "round one still names the line somebody actually failed");
  assert.equal(failed[0].note, "twisted 3mm");
  assert.equal(QC.faultsOnRound(rec, rec.rounds[0])[0].fix.what,
    "re-clamped and re-measured",
    "and the answer is still attached to the fault it answers");

  // The round worked against the NEW list is the one that carries a copy of it.
  assert.ok(!rec.rounds[0].tpl, "the round the record's template still fits is not copied");
  assert.ok(rec.rounds[1].tpl, "the round worked against the edited list pins it");
  assert.equal(QC.roundItems(rec, rec.rounds[1])[0].text, "Powder coat thickness");

  // And only one of the two lists is stored twice, not both.
  assert.ok(JSON.stringify(rec).length < win.WFStore.MARGIN,
    "pinning one round is not an excuse to store the checklist on every round");
});

test("an unfinished self-check does not drag the pass rate down with it", () => {
  /* The same confusion one layer up from the Floor. An unticked self-check line
   * is stored as "fail", so the archive scored a drafter who ticked one line of
   * eight and went home as a FAILED round: the pass rate fell toward zero and
   * "what fails most" filled with lines nobody had said were wrong. A training
   * table built from people not having finished yet is worse than no table. */
  const R = win.WFRecords;
  const selfInProgress = {
    id: "c1", name: "#1 job", idList: "LA",
    qcRecord: {
      listId: "LA", phase: "CAD", mode: "self", status: "self_todo",
      template: [{ text: "Revision number is current", spec: "" },
                 { text: "Material called out", spec: "" }],
      rounds: [{ n: 1, mode: "self", results: ["pass", "fail"],
                 checkedBy: { fullName: "Mike" }, checkedAt: new Date().toISOString() }]
    }
  };
  const realFault = {
    id: "c2", name: "#2 job", idList: "LA",
    qcRecord: {
      listId: "LA", phase: "Assemble Legacy", mode: "floor",
      template: [{ text: "Frame is square", spec: "" }],
      rounds: [{ n: 1, mode: "floor", results: ["fail"], notes: { 0: "twisted" },
                 foundBy: { fullName: "Mike" }, checkedBy: { fullName: "Mike" },
                 checkedAt: new Date().toISOString() }]
    }
  };

  /* A round that actually passed, so the pass rate is a number the denominator
   * can move. Without one, every arrangement of these fixtures reads 0% and
   * the assertion below would hold whichever denominator the code used. */
  const cleanPass = {
    id: "c3", name: "#3 job", idList: "LA",
    qcRecord: {
      listId: "LA", phase: "Assemble Legacy", mode: "floor",
      template: [{ text: "Frame is square", spec: "" }],
      rounds: [{ n: 1, mode: "floor", results: ["pass"],
                 checkedBy: { fullName: "Mike" }, checkedAt: new Date().toISOString() }]
    }
  };

  const entries = R.qcEntries([selfInProgress, realFault, cleanPass]);
  assert.equal(entries.filter((e) => e.unfinished).length, 1,
    "the self-check in progress is marked unfinished");

  const s = R.qcSummary(entries);
  assert.equal(s.rounds, 3, "every round is still archived, unfinished included");
  assert.equal(s.unfinished, 1);
  assert.equal(s.failed, 1, "only the real fault counts as a failed round");
  assert.equal(s.passed, 1);
  /* 50, not 33. The denominator is the rounds somebody actually judged --
   * one passed, one failed. Dividing by every round would put the unfinished
   * check back into the figure through the bottom of the fraction after
   * taking it out of the top. */
  assert.equal(s.passRate, 50,
    "and the rate is over judged rounds, not over every round");
  assert.equal(s.topFailures.length, 1,
    "the unticked line is not training material");
  assert.equal(s.topFailures[0].text, "Frame is square");
  assert.equal(s.openFaults, 1,
    "but an open fault is a fact about right now and still counts");
});

test("an open fault is counted before the unfinished round is set aside", () => {
  /* TWO GUARDS THAT ONLY WORK IN THIS ORDER. qcSummary drops an unfinished
   * check before it judges anything — but an open fault is a fact about right
   * now rather than a judgement about quality, so it is added first and the
   * early return comes after.
   *
   * Written against qcSummary directly, which is unusual here and deliberate:
   * qcEntries can never hand it a round that is both, because `unfinished` and
   * `openFaults` both hinge on isFaultRound and one is always zero when the
   * other is set. That makes the ordering inside qcSummary invisible through
   * qcEntries — moving the `+=` below the return passes every other test in
   * the repo — and qcSummary is exported and summing a list somebody else
   * built is exactly what it promises to do. */
  const R = win.WFRecords;
  const entry = (over) => Object.assign({
    unfinished: false, phase: "CAD", passed: false, items: 3,
    failed: [], openFaults: 0
  }, over);

  const s = R.qcSummary([
    entry({ unfinished: true, openFaults: 2 }),
    entry({ passed: true })
  ]);
  assert.equal(s.openFaults, 2,
    "the open faults are counted, not dropped with the round carrying them");
  assert.equal(s.unfinished, 1);
  assert.equal(s.passed, 1);
  assert.equal(s.failed, 0, "an unfinished round is still not a failure");
  assert.equal(s.passRate, 100);
});

test("a fault raised on top of an unfinished self-check reads sanely", () => {
  /* Both states on one record, which is the ordinary way it happens: a drafter
   * half-ticks their list and someone at the bench raises a real fault on the
   * same job before it is finished. The self round is work in progress, the
   * raised round is a judgement, and each counts once as exactly one thing. */
  const R = win.WFRecords;
  const at = new Date().toISOString();
  const both = {
    id: "c1", name: "#1 job", idList: "LA",
    qcRecord: {
      listId: "LA", phase: "CAD", mode: "floor",
      template: [{ text: "Revision number is current", spec: "" },
                 { text: "Material called out", spec: "" }],
      rounds: [
        { n: 1, mode: "self", results: ["pass", "fail"],
          checkedBy: { fullName: "Mike" }, checkedAt: at },
        { n: 2, mode: "floor", results: ["fail", "pass"],
          notes: { 0: "drawn to rev B" },
          foundBy: { fullName: "Scott" }, checkedBy: { fullName: "Scott" },
          checkedAt: at }
      ]
    }
  };

  const entries = R.qcEntries([both]);
  assert.equal(entries.length, 2);
  const s = R.qcSummary(entries);
  assert.equal(s.rounds, 2);
  assert.equal(s.unfinished, 1, "the half-ticked self round, once");
  assert.equal(s.failed, 1, "the raised fault, once");
  assert.equal(s.openFaults, 1, "and its unanswered line is open right now");
  assert.equal(s.topFailures.length, 1,
    "only the line somebody said was wrong is training material");
  assert.equal(s.topFailures[0].text, "Revision number is current");
});

test("faults are stored on the card, not in a board key", () => {
  /* The earlier plan was a board key per month, wfFaults:YYYY-MM. Board keys
   * share one 4,096-character budget with the roster, permissions, stations and
   * the checklist library — twenty faults a month would exhaust it alone.
   * Faults belong to a job, a job is a card, and a card has its own budget. */
  const qc = code("lib/qc.js");
  assert.ok(!/wfFaults/.test(qc),
    "no monthly board bucket — faults live on the round that found them");
  assert.ok(/round\.fixes/.test(qc),
    "the fix is stored on the round, beside the fault it answers");
});

test("finishing a phase no longer parks it for an approval nobody gives", async () => {
  /* THE FLAG WAS THE STRANDING MECHANISM. complete() set pendingApproval, which
   * took the card off the shop floor (isFinished counts it) and put it in a
   * queue whose only two screens are retired. Nothing was coming. completedAt
   * carries "this is finished" on its own and reads the same everywhere. */
  const env = benchEnv();
  await env.w.WFPhase.complete(env.t, env.meta, { silent: true });

  const work = env.store["c1/phaseWork"];
  assert.ok(work.completedAt, "the fact is recorded");
  assert.ok(!work.pendingApproval, "the approval flag is not written any more");
  assert.equal(work.percentComplete, 100);
  assert.ok(env.w.WFPhase.isFinished(work), "and every reader still sees it as finished");
});

test("a card stranded under the old model still reads as finished", () => {
  // The read-only bridge. Delete this clause only when the board has no cards
  // left carrying the flag -- until then removing it hides them completely.
  const P = win.WFPhase;
  assert.equal(P.isFinished({ pendingApproval: true }), true);
  assert.equal(P.isFinished({ completedAt: "2026-09-01T00:00:00.000Z" }), true);
  assert.equal(P.isFinished({ segments: [] }), false);
  assert.equal(P.isFinished(null), false);
  // The shop floor must give the same answer as the state machine, always.
  assert.equal(win.WFTables.isFinished({ pendingApproval: true }), true);
  assert.equal(win.WFTables.isFinished({ completedAt: "x" }), true);
  assert.equal(win.WFTables.isFinished({}), false);
});

test("only lib/qc.js finishes a phase, and the card surfaces no longer can", () => {
  /* connector.js and popups/card-back.js each had a Complete button calling
   * WFPhase.complete() and stopping. Those two were the last paths that could
   * strand a job, and neither offers a checklist, so neither can legitimately
   * finish a phase. */
  ["connector.js", "popups/card-back.js", "popups/tabs/myjobs.js",
   "popups/tabs/workboard.js", "popups/checklist.js"].forEach((file) => {
    assert.equal((code(file).match(/WFPhase\.complete\s*\(/g) || []).length, 0,
      file + " must not finish a phase -- only lib/qc.js does, and it advances");
  });
  // And nothing outside phase.js/qc.js decides "finished" by reading the flag.
  ["popups/ops.js", "popups/tabs/dashboard.js", "popups/tabs/myjobs.js",
   "popups/tabs/workboard.js", "popups/tabs/floor.js", "lib/tables.js",
   "connector.js", "popups/card-back.js"].forEach((file) => {
    assert.ok(!/\bpendingApproval\b/.test(code(file)),
      file + " asks WFPhase.isFinished instead of reading pendingApproval");
  });
});

/* ================================================== one QC record per phase */

test("signing at the bench after a self-check adds a round, it does not erase one", async () => {
  /* THE COLLISION. Both paths wrote the record WHOLE to one key, and
   * activeRecord discriminated on listId alone -- so whichever ran second
   * silently destroyed the first, taking its rounds, its signature and its
   * signer. The fault path hangs off these rounds, so this had to be fixed
   * before any of it could be built on. */
  const env = benchEnv();
  const QC = env.w.WFQC;
  const peer = { id: "p", username: "kevinmoss", fullName: "Kevin Moss" };

  await QC.submitSelfCheck(env.t, env.meta, env.stage.name, env.worker,
    [{ text: "Work is complete and correct", result: "fail", note: "seam needs grinding" }]);

  const afterSelf = env.store["c1/qcRecord"];
  assert.equal(afterSelf.rounds.length, 1);
  assert.equal(QC.modeOf(afterSelf), "self");

  const items = [{ text: "Frame is square", spec: "diagonals within 1/8\"" }];
  await QC.signOff(env.t, env.meta, {
    phase: env.stage.name, items: items, checked: { 0: true },
    signature: "Kevin Moss", signedBy: peer, worker: env.worker
  });

  const after = env.store["c1/qcRecord"];
  assert.equal(after.rounds.length, 2, "the self-check's round survived");
  // A round stores verdicts by position and notes by index now, not a second
  // copy of the lines; roundItems hydrates that back against rec.template and
  // is the supported way to read one. The fact asserted is the same fact.
  assert.equal(QC.roundItems(after, after.rounds[0])[0].note, "seam needs grinding",
    "including what was written on it");
  assert.equal(after.rounds[1].checkedBy.username, "kevinmoss");
  assert.equal(QC.modeOf(after), "floor");
});

test("a self-check is never mistaken for a bench sign-off", async () => {
  /* floorSignOff used to filter on `signedAt` being present, which excluded the
   * other kinds only by accident. Complete reads this to decide whether a job
   * may pass; getting it wrong either blocks a signed job or ships an unsigned
   * one. */
  const env = benchEnv();
  const QC = env.w.WFQC;
  await QC.submitSelfCheck(env.t, env.meta, env.stage.name, env.worker,
    [{ text: "Work is complete and correct", result: "fail", note: "" }]);

  const card = { idList: env.meta.idList, qcRecord: env.store["c1/qcRecord"] };
  assert.equal(QC.floorSignOff(card), null, "a self-check is not a bench sign-off");
  assert.ok(QC.activeRecord(card, "self"), "but it is findable as what it is");
  assert.equal(QC.activeRecord(card, "floor"), null);
});

test("a re-check clears the old signature instead of wearing it", async () => {
  /* Carrying a record over keeps its rounds -- that is the fix -- but it was
   * also keeping `signature`, `signedAt` and `signedBy` from an earlier BENCH
   * sign-off while stamping mode "self" over the top. The result was a record
   * claiming to be a self-check while carrying somebody else's signature, and
   * because floorSignOff asks for mode "floor", a genuinely signed job came
   * back unsigned: Complete lost its tick and passSigned refused the card.
   *
   * The signature belongs to the round, and the record only ever describes the
   * latest one. */
  const env = benchEnv();
  const QC = env.w.WFQC;
  const peer = { id: "p", username: "kevinmoss", fullName: "Kevin Moss" };

  await QC.signOff(env.t, env.meta, {
    phase: env.stage.name,
    items: [{ text: "Frame is square", spec: "within 1/8\"" }],
    checked: { 0: true }, signature: "Kevin Moss", signedBy: peer, worker: env.worker
  });
  const signed = env.store["c1/qcRecord"];
  assert.ok(QC.floorSignOff({ idList: env.meta.idList, qcRecord: signed }));
  assert.equal(signed.rounds[0].signature, "Kevin Moss",
    "the round carries its own signature, so looking back at it still works");

  // Somebody re-checks the same phase and finds something.
  await QC.submitSelfCheck(env.t, env.meta, env.stage.name, env.worker,
    [{ text: "Frame is square", result: "fail", note: "twisted 3mm" }]);

  const after = env.store["c1/qcRecord"];
  assert.equal(after.rounds.length, 2, "both rounds are on the record");
  assert.equal(after.rounds[0].signature, "Kevin Moss", "the bench round is intact");
  assert.ok(!after.signature, "but the record no longer claims to be signed");
  assert.ok(!after.signedAt);
  assert.equal(QC.floorSignOff({ idList: env.meta.idList, qcRecord: after }), null,
    "and a job somebody just failed cannot pass as signed");
});

test("the signed stamp reads the round that was signed, not the first one", () => {
  /* popups/tabs/floor.js drew rounds[0] under a green "QC passed" header with
   * every line forced to a tick. Once rounds accumulate, rounds[0] is usually
   * NOT the signed one -- so a failed line from an earlier round rendered as
   * passed. The record would be right and the screen would be lying about it. */
  const src = code("popups/tabs/floor.js");
  assert.ok(!/rec\.rounds\[0\]/.test(src),
    "the stamp must not index the first round");
  assert.ok(/rounds\[rec\.rounds\.length\s*-\s*1\]/.test(src),
    "it reads the latest round");
  assert.ok(/i\.result\s*!==\s*"fail"/.test(src),
    "and draws each line as what it says it is, not always as a pass");
});

test("a record belonging to an earlier phase is replaced, not accumulated", async () => {
  // Rounds accumulate within a phase. Across phases they must not: the card has
  // moved on and this is a different check, so carrying the old rounds forward
  // would make the new phase look already inspected.
  const env = benchEnv();
  const QC = env.w.WFQC;
  env.store["c1/qcRecord"] = {
    listId: "some-other-list", phase: "Earlier", mode: "floor", status: "passed",
    rounds: [{ n: 1 }, { n: 2 }]
  };
  await QC.submitSelfCheck(env.t, env.meta, env.stage.name, env.worker,
    [{ text: "Work is complete and correct", result: "fail", note: "" }]);
  assert.equal(env.store["c1/qcRecord"].rounds.length, 1);
  assert.equal(env.store["c1/qcRecord"].listId, env.meta.idList);
});

test("a peer-checked phase records who vouched, not just who ticked", async () => {
  /* The peer distinction used to live in a queue that nothing services any
   * more. It survives as the second name on the record, which is the only part
   * of a peer check that was ever worth anything. */
  // benchEnv's `t` already speaks the keyless get and the object set that
  // WFStore needs; the hand-rolled one that used to sit here did not, so this
  // test measured an empty scope and stored the patch under "undefined".
  const env = benchEnv();
  const peer = { id: "p", username: "kevinmoss", fullName: "Kevin Moss" };

  await env.w.WFQC.submitSelfCheck(env.t, env.meta, env.stage.name, env.worker,
    [{ text: "Work is complete and correct", result: "pass", note: "" }], peer);

  const rec = env.store["c1/qcRecord"];
  assert.equal(rec.status, "passed");
  assert.equal(rec.rounds[0].checkedBy.username, "mike", "who ticked the list");
  assert.equal(rec.passedBy.username, "kevinmoss", "who vouched for it");
  assert.equal(env.store["c1/phaseWork"], undefined,
    "the phase is closed, not left waiting");
});

/* ======================================================= handing a job over
 *
 * A welder who gets ahead pulling the next job off another bench is the shop
 * organising itself, and it does not wait for a manager. What it must not be
 * is quiet: without a record the numbers lie in both directions at once -- the
 * person handing over looks slow for work they passed on, the person taking it
 * looks fast for work they inherited.
 */

const TAKER = { id: "k", username: "kevinmoss", fullName: "Kevin Moss" };

test("taking a job over moves the claim, stops the clock and says so on the card",
  async () => {
    const { w, t, store, meta, worker, comments } = benchEnv({ pct: 40 });

    const work = await w.WFPhase.takeOver(t, meta, TAKER, { reason: "Mike is on the truck" });

    assert.equal(work.claimedBy.username, "kevinmoss", "the job is Kevin's now");
    assert.equal(store["c1/phaseWork"].claimedBy.username, "kevinmoss",
      "and it is written, not merely returned");

    // The live half: the station can say "taken from Mike at 40%" rather than
    // leaving the next person wondering why the bar is not at zero.
    assert.ok(work.takenFrom, "the handover is recorded on the work");
    assert.equal(work.takenFrom.username, "mike");
    assert.equal(work.takenFrom.fullName, "Mike Ross");
    assert.equal(work.takenFrom.pct, 40);
    assert.ok(work.takenFrom.at, "and when");

    // The clock stops for the person handing over. Without this their timer
    // keeps running against somebody else's hands on the job.
    assert.ok(work.segments.every((s) => s.end),
      "no segment is left open across the handover");

    // The permanent half: native to the card, readable without the Power-Up.
    const said = comments.join(" | ");
    assert.match(said, /Kevin Moss took this over from Mike Ross at 40%/);
    assert.match(said, /Mike is on the truck/, "the reason is kept when one is given");
    assert.equal(worker.username, "mike", "(fixture sanity: Mike had it)");
  });

test("taking over a job you already have changes nothing and says nothing",
  async () => {
    const { w, t, store, meta, worker, comments } = benchEnv();
    const same = { id: "w", username: worker.username, fullName: worker.fullName };
    const before = JSON.stringify(store["c1/phaseWork"]);

    const work = await w.WFPhase.takeOver(t, meta, same);

    assert.ok(!work.takenFrom, "you cannot take a job from yourself");
    assert.equal(JSON.stringify(store["c1/phaseWork"]), before, "nothing was written");
    assert.deepEqual(comments, [], "and nobody was told about a non-event");
  });

test("there is nothing to take on a job with no open work", async () => {
  const { w, t, meta } = benchEnv();
  // A different card, so the store has no phaseWork for it at all.
  const bare = Object.assign({}, meta, { id: "nope" });
  await assert.rejects(() => w.WFPhase.takeOver(t, bare, TAKER),
    /no open work/i, "taking un-started work would invent a phase nobody opened");
});

/* THE ACCOUNTING QUESTION, NOW DECIDED.
 *
 * takeOver closes the running segment and the Floor then calls resume(), which
 * pushes a new one onto the SAME segment list. totalMinutes sums the lot, which
 * is the right answer to "how long did this phase take" -- it is what costing
 * and the hours-per-$1,000 figure want, and it does NOT change here.
 *
 * What was missing was the other question, "how long did each person spend",
 * and the old behaviour answered it with the first question's number attached
 * to whoever happened to finish. The decision taken was option (b): keep one
 * segment list and one total, and stamp the outgoing worker onto their own
 * segments as the claim moves, so minutesByPerson can split it afterwards.
 *
 * These are the tests that decision has to keep passing.
 */
test("after a handover the phase total is still both people's minutes",
  async () => {
    const { w, t, meta } = benchEnv();
    const first = w.WFPhase.totalMinutes(await w.WFPhase.getActivePhaseWork(t, meta));
    assert.ok(first >= 59, "the fixture has about an hour on it already");

    await w.WFPhase.takeOver(t, meta, TAKER);
    await w.WFPhase.resume(t, meta);
    const after = w.WFPhase.totalMinutes(await w.WFPhase.getActivePhaseWork(t, meta));

    assert.ok(after >= first,
      "how long the PHASE took is unchanged -- costing still reads one figure");
  });

test("but the minutes now split by person, and the parts sum to the total",
  async () => {
    const { w, t, meta, worker } = benchEnv();
    await w.WFPhase.takeOver(t, meta, TAKER);
    await w.WFPhase.resume(t, meta);

    const work = await w.WFPhase.getActivePhaseWork(t, meta);
    const split = w.WFPhase.minutesByPerson(work);

    assert.deepEqual(Object.keys(split).sort(), ["kevinmoss", "mike"],
      "both pairs of hands are named, not just the one holding it now");
    assert.ok(split[worker.username] >= 59,
      "the hour Mike put in stays Mike's (" + split[worker.username] + " min)");
    assert.ok(split[TAKER.username] < 5,
      "and Kevin has only just picked it up");

    const sum = Object.keys(split).reduce((n, k) => n + split[k], 0);
    assert.equal(sum, w.WFPhase.totalMinutes(work),
      "the parts sum to the phase total -- no hours invented, none lost");
    assert.equal(w.WFPhase.changedHands(work), true);
  });

test("a job that never changes hands reads correctly with no `by` stored at all",
  async () => {
    const { w, t, meta, store, worker } = benchEnv();
    const work = await w.WFPhase.getActivePhaseWork(t, meta);

    assert.ok(work.segments.every((s) => s.by === undefined),
      "an ordinary job pays nothing for a question it does not raise");
    assert.deepEqual(w.WFPhase.minutesByPerson(work),
      { [worker.username]: w.WFPhase.totalMinutes(work) },
      "unstamped means `whoever holds the claim`, which is the whole trick");
    assert.equal(w.WFPhase.changedHands(work), false,
      "and no byPerson map is worth writing for one name");

    assert.ok(!/"by"/.test(JSON.stringify(store["c1/phaseWork"])),
      "nothing extra reached the card");
  });

test("minutesByPerson counts a RUNNING segment up to now, exactly as totalMinutes does",
  async () => {
    const { w, t, meta, worker } = benchEnv();
    const work = await w.WFPhase.getActivePhaseWork(t, meta);
    assert.equal(w.WFPhase.isRunning(work), true, "the fixture's clock is live");

    const split = w.WFPhase.minutesByPerson(work);
    assert.ok(isFinite(split[worker.username]),
      "an open segment has no `end`; new Date(undefined) would make this NaN");
    assert.equal(split[worker.username], w.WFPhase.totalMinutes(work),
      "a live clock reads the same either way");
  });

/* TWO HANDOVERS, WHICH IS WHERE A STAMP-AS-YOU-GO SCHEME USUALLY LOSES SOMEBODY.
 *
 * takeOver stamps only the segments that have no `by` yet. If it stamped them
 * all, the second handover would relabel Mike's hour with Kevin's name and the
 * first worker would vanish from a job he started -- the original bug, just one
 * handover later and much harder to notice. This is the test that says it does
 * not. */
test("after TWO handovers the first worker's hour is still the first worker's",
  async () => {
    const SECOND = { id: "k", username: "kevinmoss", fullName: "Kevin Moss" };
    const THIRD = { id: "s", username: "scottv", fullName: "Scott VanWorkom" };
    const { w, t, meta, worker } = benchEnv();

    await w.WFPhase.takeOver(t, meta, SECOND);
    await w.WFPhase.resume(t, meta);
    // Kevin works for a measurable while before handing on again.
    let work = await w.WFPhase.getActivePhaseWork(t, meta);
    const live = work.segments[work.segments.length - 1];
    live.start = new Date(Date.now() - 1800000).toISOString();   // 30 min
    await t.set(meta.id, "shared", "phaseWork", work);

    await w.WFPhase.takeOver(t, meta, THIRD);
    await w.WFPhase.resume(t, meta);

    work = await w.WFPhase.getActivePhaseWork(t, meta);
    const split = w.WFPhase.minutesByPerson(work);

    assert.deepEqual(Object.keys(split).sort(), ["kevinmoss", "mike", "scottv"],
      "three people worked it and three people are named");
    assert.ok(split.mike >= 59,
      "Mike's hour did not get re-stamped with Kevin's name (" + split.mike + ")");
    assert.ok(split.kevinmoss >= 29 && split.kevinmoss <= 31,
      "Kevin is credited with his half hour and no more (" + split.kevinmoss + ")");
    assert.ok(split.scottv < 5, "Scott has barely started");
    assert.equal(
      Object.keys(split).reduce((n, k) => n + split[k], 0),
      w.WFPhase.totalMinutes(work), "and the three parts still sum to the total");
  });

/* WHAT THE SPLIT COSTS THE CARD.
 *
 * phaseWork, phaseLog and qcRecord share one 4,096-character budget, and
 * appendLog already trims the log to fit -- so anything added here is paid for
 * in dropped history. `by` is a username on each segment, which is why the
 * stamp happens at the handover and not on every push. */
test("the handover stamp costs a username per segment, and nothing when it never happens",
  async () => {
    const { w, t, meta, store } = benchEnv();
    const before = JSON.stringify(store["c1/phaseWork"]).length;

    await w.WFPhase.takeOver(t, meta, TAKER);
    await w.WFPhase.resume(t, meta);
    const after = JSON.stringify(store["c1/phaseWork"]).length;

    const work = await w.WFPhase.getActivePhaseWork(t, meta);
    const stamped = work.segments.filter((s) => s.by).length;
    const perSegment = ('"by":"' + TAKER.username + '",').length;   // ~17

    assert.equal(stamped, 1, "only the outgoing worker's segments carry a name");
    assert.ok(after - before < 200,
      "a handover costs tens of characters, not hundreds (" + (after - before) + ")");
    assert.ok(stamped * perSegment < w.WFStore.LIMIT / 10,
      "even a job paused ten times and handed on stays far inside the budget");

    /* And the figure that actually lands on the card for good: the log entry,
     * which carries the byPerson map the archive reads. */
    await w.WFPhase.complete(t, meta, { silent: true });
    const entry = await w.WFPhase.logPhase(t, meta, { by: TAKER });
    assert.ok(entry.byPerson, "a phase that changed hands records the split");
    assert.ok(JSON.stringify(entry.byPerson).length < 120,
      "two names and two numbers (" + JSON.stringify(entry.byPerson) + ")");
    assert.ok(JSON.stringify(store["c1/phaseLog"]).length < w.WFStore.MARGIN,
      "and the log still fits what the card can hold");
  });

/* ===================================================== giving a job back
 *
 * Claiming used to be a one-way door. The reported case is the plainest one
 * there is -- "Scott claimed it, no time was logged" -- and it is the one the
 * code has to get right first, because it is a mis-tap and a mis-tap should
 * leave nothing behind.
 */

const GIVER = { id: "s", username: "scottv", fullName: "Scott VanWorkom" };

/** benchEnv, with the clock set to a chosen number of minutes ago. */
function releaseEnv(minutesAgo, extra) {
  const env = benchEnv();
  const seg = minutesAgo === null
    ? []
    : [{ start: new Date(Date.now() - minutesAgo * 60000).toISOString(), end: null }];
  env.store["c1/phaseWork"] = Object.assign({
    listId: env.stage.listId,
    claimedBy: env.worker,
    assignedBy: null,
    tableId: "s1",
    queuePos: 2,
    segments: seg,
    percentComplete: 0
  }, extra || {});
  return env;
}

test("a claim nobody worked is removed outright, and the card is told nothing",
  async () => {
    // The reported case: claimed seconds ago, so the clock IS running and the
    // elapsed time still rounds to zero minutes.
    const { w, t, store, meta, comments } = releaseEnv(0.02);
    const live = store["c1/phaseWork"];
    assert.equal(w.WFPhase.isRunning(live), true, "fixture: the segment is open");
    assert.equal(w.WFPhase.totalMinutes(live), 0, "fixture: nothing has accrued yet");

    const out = await w.WFPhase.release(t, meta, GIVER);

    assert.deepEqual(out, { cleared: true, minutes: 0 });
    assert.equal(store["c1/phaseWork"], undefined,
      "the phase work is gone, not left as a claimless husk");
    assert.deepEqual(comments, [],
      "a mis-tap must not outlive itself as a comment on the card");
  });

test("removing phase work with a segment still open leaves nothing dangling",
  async () => {
    const { w, t, store, meta } = releaseEnv(0.02);
    await w.WFPhase.release(t, meta, GIVER);

    // Nothing in the card's scope still refers to that work -- the open
    // segment went with the record that held it.
    const all = await t.get("c1", "shared");
    assert.equal(all.phaseWork, undefined);
    assert.ok(!Object.keys(store).some((k) => k === "c1/phaseWork"));

    // And the next person starting it begins from zero rather than resuming
    // somebody else's open clock.
    const fresh = await w.WFPhase.claimAndStart(t, meta, GIVER);
    assert.equal(fresh.segments.length, 1);
    assert.equal(w.WFPhase.totalMinutes(fresh), 0);
  });

test("a worked claim keeps its hours, stamps them, and the card says how many",
  async () => {
    const { w, t, store, meta, worker, comments } =
      releaseEnv(90, { assignedBy: { username: "boss" }, takenFrom: { username: "kev" } });

    const out = await w.WFPhase.release(t, meta, GIVER, { reason: "wrong bench" });

    assert.equal(out.cleared, false);
    assert.ok(out.minutes >= 89 && out.minutes <= 91, "the minutes come back");

    const work = store["c1/phaseWork"];
    assert.ok(work, "the work stays -- somebody really did build this");
    assert.equal(work.claimedBy, null, "but nobody holds it");
    assert.equal(work.assignedBy, null);
    assert.equal(work.tableId, null, "and it is off the bench");
    assert.equal(work.queuePos, null);
    assert.equal("takenFrom" in work, false, "a stale handover note goes with the claim");

    assert.equal(work.segments.length, 1);
    assert.ok(work.segments[0].end, "the running segment was closed");
    assert.equal(work.segments[0].by, worker.username,
      "the hour stays Mike's -- unstamped would mean 'whoever holds the claim', and nobody does");
    assert.deepEqual(w.WFPhase.minutesByPerson(work), { [worker.username]: out.minutes });

    const said = comments.join(" | ");
    assert.match(said, /Scott VanWorkom put this back as unclaimed/);
    assert.match(said, /was Mike Ross/, "who had it");
    assert.match(said, new RegExp(out.minutes + " min already logged stays"));
    assert.match(said, /wrong bench/, "and the reason, when one is given");
  });

test("release on a card with no open work answers null and writes nothing",
  async () => {
    const { w, t, store, meta, comments } = releaseEnv(90);
    const bare = Object.assign({}, meta, { id: "nope" });
    const before = JSON.stringify(store);

    assert.equal(await w.WFPhase.release(t, bare, GIVER), null);
    assert.equal(JSON.stringify(store), before, "nothing was written or removed");
    assert.deepEqual(comments, []);
  });

test("phase work left over from an earlier list is not something you can give back",
  async () => {
    const { w, t, store, meta, comments } = releaseEnv(90);
    store["c1/phaseWork"].listId = "some-other-list";
    assert.equal(await w.WFPhase.release(t, meta, GIVER), null,
      "stale work belongs to a phase this card has already left");
    assert.ok(store["c1/phaseWork"], "and it is not quietly destroyed either");
    assert.deepEqual(comments, []);
  });

/* AFTER THE RELEASE, WHERE DOES THE JOB GO?
 *
 * `release` nulls tableId, which takes the job off the bench. If nothing then
 * picked it up as loose work in the phase it would simply disappear from the
 * Floor -- the job would be "given back" to nobody, which is worse than not
 * being able to give it back at all. */
test("a released job comes back in the station queue, both ways round", async () => {
  const PHASE = "Assemble Legacy";
  const cfg = { stages: [{ listId: "LA", name: PHASE, order: 8, isWorkPhase: true }] };
  const bench = { id: "s1", area: "shop", table: "Station #1", station: "Welding",
                  welder: "kevinmoss", phase: PHASE, type: "weld" };
  const card = (phaseWork) => ({
    id: "R", name: "#R job", idList: "LA", pos: 100, due: null, labelNames: [],
    phaseWork: phaseWork
  });

  // (a) the mis-tap: phase work removed outright.
  const gone = T.stationState(cfg, [card(null)], bench);
  assert.equal(gone.job, null, "the bench is clear");
  assert.deepEqual(gone.queue.map((c) => c.id), ["R"],
    "and the job is back in the queue, not vanished");

  // (b) the worked release: phase work survives with no claim and no bench.
  const kept = T.stationState(cfg, [card({
    listId: "LA", claimedBy: null, assignedBy: null, tableId: null, queuePos: null,
    segments: [{ start: new Date(Date.now() - 5400000).toISOString(),
                 end: new Date().toISOString(), by: "mike" }],
    percentComplete: 60
  })], bench);
  assert.equal(kept.job, null, "still off the bench");
  assert.deepEqual(kept.queue.map((c) => c.id), ["R"],
    "loose work in the phase is offered to the station again");
  assert.equal(kept.status, "open");
  // And the hours are still on it for whoever picks it up.
  assert.ok(T.elapsedMinutes(kept.queue[0].phaseWork) >= 89);
});

/* ============================ picking a given-back job up again
 *
 * `release` goes to some trouble to keep the hours on a job somebody really
 * worked, and for a while that trouble bought nothing: `claimAndStart` wrote a
 * brand-new phaseWork object on the very next claim and the segments, the
 * percent and the names on them all went in the bin. The careful half of
 * `release` was decoration.
 *
 * So the pair below is the contract, and it only reads as a contract when both
 * halves are asserted together: release preserves, and the next claim ADOPTS
 * what was preserved.
 */

/** The two work phases a "it must not leak between phases" test needs. */
function twoWorkPhases(w) {
  const boardId = Object.keys(w.WF_CONFIG.boards)[0];
  const stages = (w.WF_CONFIG.boards[boardId].stages || [])
    .filter((s) => s.isWorkPhase);
  const weld = stages[0];
  const paint = stages.find((s) => s.listId !== weld.listId);
  if (!paint) throw new Error("config.js needs two distinct work phases");
  return { boardId, weld, paint };
}

test("a job given back after real work keeps that work when the next person claims it",
  async () => {
    /* THE WHOLE POINT, END TO END. Worker A claims, works ninety minutes,
     * drags the slider to 60%, gives the job back. Worker B picks it up.
     * Before the adoption fix B's claim read 0 minutes and 0%, and A's ninety
     * minutes were not recoverable from anywhere. */
    const { w, t, store, meta, worker } = releaseEnv(90, { percentComplete: 60 });
    const A = worker;                     // Mike Ross, who built it
    const B = TAKER;                      // Kevin Moss, who picks it up

    const given = await w.WFPhase.release(t, meta, A);
    assert.equal(given.cleared, false, "fixture: this is the worked path, not the mis-tap");

    const claimed = await w.WFPhase.claimAndStart(t, meta, B);

    assert.equal(claimed.claimedBy.username, B.username, "B holds it now");
    assert.ok(w.WFPhase.totalMinutes(claimed) >= 89,
      "A's ninety minutes are still on the job (" + w.WFPhase.totalMinutes(claimed) + ")");
    assert.equal(claimed.percentComplete, 60,
      "and the job is still 60% built -- the percent is a fact about the job");

    assert.equal(claimed.segments.length, 2, "A's segment plus B's new one");
    assert.equal(claimed.segments[0].by, A.username,
      "A's hour is stamped A's, or it would read as B's the moment B holds the claim");
    assert.ok(claimed.segments[0].end, "and it is closed, not still running");
    assert.equal(claimed.segments[1].end, null, "B's segment is the open one");
    assert.equal(claimed.segments[1].by, undefined,
      "B's own segment needs no stamp -- unstamped means whoever holds the claim");

    const split = w.WFPhase.minutesByPerson(claimed);
    assert.ok(split[A.username] >= 89 && split[A.username] <= 91,
      "the ninety minutes are credited to A (" + split[A.username] + ")");
    assert.ok((split[B.username] || 0) <= 1,
      "and B, who has just pressed the button, is credited with none of them");

    assert.equal(store["c1/phaseWork"].segments.length, 2,
      "and it is written to the card, not merely returned");
  });

test("a mis-tap by the person who picked it up cannot destroy the hours they inherited",
  async () => {
    /* The nastiest version of the old bug, one step along: B claims an adopted
     * job, realises straight away it is not theirs, and gives it back. The
     * no-trace path keys on elapsed time -- which now includes A's ninety
     * minutes, so it correctly refuses to treat this as a mis-tap. */
    const { w, t, store, meta, worker } = releaseEnv(90, { percentComplete: 60 });
    await w.WFPhase.release(t, meta, worker);
    await w.WFPhase.claimAndStart(t, meta, TAKER);

    const out = await w.WFPhase.release(t, meta, TAKER);

    assert.equal(out.cleared, false, "there is far too much on this job to erase it");
    assert.ok(store["c1/phaseWork"], "the record survives B's second thoughts");
    assert.ok(w.WFPhase.totalMinutes(store["c1/phaseWork"]) >= 89,
      "with A's hours intact");
    assert.equal(
      w.WFPhase.minutesByPerson(store["c1/phaseWork"])[TAKER.username] || 0, 0,
      "and nothing wrongly credited to B");
  });

/* ===================================================== phase leakage
 *
 * ADOPTION IS ONLY SAFE BECAUSE OF ONE `===`.
 *
 * `claimAndStart` now continues whatever phaseWork is on the card, and the
 * ONLY thing stopping it continuing the PREVIOUS phase's hours is
 * getActivePhaseWork's `work.listId === cardMeta.idList` check. Two hundred
 * minutes of welding arriving as the paint booth's opening figure would be
 * worse than the bug this change fixed: wrong numbers that look right.
 *
 * advance() does remove phaseWork on the way out, so in the ordinary case
 * there is nothing left to leak. But advance deliberately moves the card
 * BEFORE removing the work (see its comment) precisely so a failed remove is
 * survivable -- and what makes it survivable is this check. It is belt and
 * braces, and the braces are the listId.
 */

test("hours logged in one phase do not follow the card into the next one", async () => {
  const env = benchEnv();
  const { boardId, weld, paint } = twoWorkPhases(env.w);
  const w = env.w, t = env.t, store = env.store;

  // 200 minutes of welding, finished and still sitting on the card -- the
  // shape left behind when advance() moved the card but its remove did not
  // land, which is the failure advance's ordering is designed to survive.
  store["c1/phaseWork"] = {
    listId: weld.listId,
    claimedBy: { id: "w", username: "mike", fullName: "Mike Ross" },
    segments: [{ start: new Date(Date.now() - 200 * 60000).toISOString(),
                 end: new Date().toISOString() }],
    percentComplete: 95,
    checklist: { 0: true, 1: true }
  };
  const inWeld = { id: "c1", idList: weld.listId, idBoard: boardId };
  const inPaint = { id: "c1", idList: paint.listId, idBoard: boardId };

  assert.equal(w.WFPhase.totalMinutes(await w.WFPhase.getActivePhaseWork(t, inWeld)), 200,
    "fixture: 200 minutes really are on the card");
  assert.equal(await w.WFPhase.getActivePhaseWork(t, inPaint), null,
    "the guard itself: work from another list is not active work here");

  const painted = await w.WFPhase.claimAndStart(t, inPaint, TAKER);

  assert.equal(painted.listId, paint.listId, "the new record belongs to the new phase");
  assert.equal(painted.segments.length, 1, "one segment, just opened");
  assert.equal(w.WFPhase.totalMinutes(painted), 0,
    "the paint booth starts at zero, not at 200");
  assert.equal(painted.percentComplete, 0, "and at 0%, not at 95%");
  assert.equal(painted.checklist, undefined,
    "and without the welder's ticked lines");
  assert.deepEqual(w.WFPhase.minutesByPerson(painted), { [TAKER.username]: 0 },
    "nobody is credited with welding they did in another column");
});

test("advance clears the phase work it just logged, so the next phase has nothing to adopt",
  async () => {
    /* Belt, to the listId check's braces. If this ever stops being true the
     * listId check becomes the only thing between two phases' hours, which is
     * a single `===` carrying the whole weight. */
    const env = benchEnv();
    await env.w.WFPhase.complete(env.t, env.meta, { silent: true });
    assert.ok(env.store["c1/phaseWork"], "fixture: there is work to clear");

    await env.w.WFPhase.advance(env.t, env.meta, GIVER);

    assert.equal(env.store["c1/phaseWork"], undefined,
      "advance removes phaseWork on the way out");
    assert.ok(env.store["c1/phaseLog"], "having first written it down");
  });

/* ===================================================== finished work
 *
 * Adoption must not resurrect a job somebody already finished: a completed
 * phase that gets claimed again should not quietly reopen with its old
 * segments running. The `!isFinished(prior)` guard is what refuses it.
 *
 * The question that guard raises is whether it broke Reopen. It did not --
 * Reopen is undoComplete, a different function that mutates the record in
 * place -- and these two tests exist to keep it that way, because a Reopen
 * that silently started from zero would lose a whole phase's hours and say
 * nothing about it.
 */

test("Reopen keeps every minute -- it goes through undoComplete, not through a re-claim",
  async () => {
    const { w, t, store, meta, worker } = benchEnv();      // one hour, running
    await w.WFPhase.complete(t, meta, { silent: true });
    const finished = store["c1/phaseWork"];
    assert.equal(w.WFPhase.isFinished(finished), true, "fixture: it is finished");
    const minutesBefore = w.WFPhase.totalMinutes(finished);
    assert.ok(minutesBefore >= 59, "fixture: with an hour on it");

    const reopened = await w.WFPhase.undoComplete(t, meta);

    assert.equal(reopened.completedAt, null, "it is open again");
    assert.equal(w.WFPhase.isFinished(reopened), false);
    assert.ok(w.WFPhase.totalMinutes(reopened) >= minutesBefore,
      "and the hour it took is still there (" + w.WFPhase.totalMinutes(reopened) + ")");
    assert.equal(reopened.claimedBy.username, worker.username,
      "still the same person's job");
    assert.equal(w.WFPhase.isRunning(reopened), true, "with the clock running again");
  });

test("the surfaces that offer Reopen call undoComplete, and never claimAndStart",
  () => {
    /* The guard is only safe while this is true. If a screen ever wires Reopen
     * to Claim & Start, `!isFinished` turns it into "start again from zero"
     * and the phase's hours go without a word. */
    ["popups/card-back.js", "popups/tabs/workboard.js", "popups/tabs/myjobs.js"]
      .forEach((f) => {
        const src = code(f);
        const i = src.indexOf("Reopen");
        assert.ok(i > -1, f + " still offers Reopen");
        const near = src.slice(i, i + 400);
        assert.match(near, /undoComplete/, f + ": Reopen reopens the record it has");
        assert.doesNotMatch(near, /claimAndStart/,
          f + ": Reopen must not go through the claim path, which starts from zero");
      });
  });

test("claiming a FINISHED phase starts a new one rather than resurrecting the old",
  async () => {
    /* Not reachable from the Floor -- lib/tables.js drops finished work before
     * the bench controls render -- but it is what the guard does, and the
     * behaviour it replaces (adopting a completed record) would reopen a job
     * nobody meant to reopen. Written down so the trade-off is deliberate. */
    const { w, t, meta } = benchEnv();
    await w.WFPhase.complete(t, meta, { silent: true });
    const stale = await w.WFPhase.getActivePhaseWork(t, meta);
    stale.claimedBy = null;                 // the only shape that offers Claim
    await t.set(meta.id, "shared", "phaseWork", stale);

    const fresh = await w.WFPhase.claimAndStart(t, meta, TAKER);

    assert.equal(fresh.segments.length, 1, "a clean record, not the finished one continued");
    assert.equal(fresh.completedAt, null, "and not still marked finished");
    assert.equal(w.WFPhase.totalMinutes(fresh), 0);
  });

/* ============================== three pairs of hands, two ways round
 *
 * takeOver stamps the outgoing worker's segments; release stamps them too; and
 * claimAndStart now stamps any it inherits unstamped. Three writers to one
 * field is exactly where a segment ends up with the wrong name on it, so both
 * routes through a three-person job are walked here.
 */

test("a job taken over, given back and re-claimed credits each person once", async () => {
  const A = { id: "w", username: "mike", fullName: "Mike Ross" };       // benchEnv's
  const B = { id: "k", username: "kevinmoss", fullName: "Kevin Moss" };
  const C = { id: "s", username: "scottv", fullName: "Scott VanWorkom" };
  const { w, t, meta } = benchEnv();                      // A, one hour, running

  await w.WFPhase.takeOver(t, meta, B);                   // A -> B
  await w.WFPhase.resume(t, meta);
  let work = await w.WFPhase.getActivePhaseWork(t, meta);
  work.segments[work.segments.length - 1].start =
    new Date(Date.now() - 1800000).toISOString();         // B works 30 min
  await t.set(meta.id, "shared", "phaseWork", work);

  await w.WFPhase.release(t, meta, B);                    // B gives it back
  await w.WFPhase.claimAndStart(t, meta, C);              // C picks it up

  work = await w.WFPhase.getActivePhaseWork(t, meta);
  assert.equal(work.segments.length, 3, "an hour, a half hour, and C just started");
  assert.equal(work.segments[0].by, A.username, "A's hour is A's");
  assert.equal(work.segments[1].by, B.username, "B's half hour is B's");
  assert.equal(work.segments[2].by, undefined,
    "C's open segment is unstamped, which means 'whoever holds the claim' -- C");
  assert.equal(work.claimedBy.username, C.username);

  const split = w.WFPhase.minutesByPerson(work);
  assert.deepEqual(Object.keys(split).sort(), [B.username, A.username, C.username].sort());
  assert.ok(split[A.username] >= 59 && split[A.username] <= 61, "A: " + split[A.username]);
  assert.ok(split[B.username] >= 29 && split[B.username] <= 31, "B: " + split[B.username]);
  assert.ok(split[C.username] <= 1, "C has barely started: " + split[C.username]);
  assert.equal(Object.keys(split).reduce((n, k) => n + split[k], 0),
    w.WFPhase.totalMinutes(work), "and the three parts sum to the whole");
});

test("a job given back twice credits each person once, with nobody's segment reassigned",
  async () => {
    // The same chain with no handover in it at all: release is the only thing
    // stamping, and claimAndStart must leave what it finds alone.
    const A = { id: "w", username: "mike", fullName: "Mike Ross" };
    const B = { id: "k", username: "kevinmoss", fullName: "Kevin Moss" };
    const C = { id: "s", username: "scottv", fullName: "Scott VanWorkom" };
    const { w, t, meta } = releaseEnv(60);                 // A, one hour, running

    await w.WFPhase.release(t, meta, A);
    await w.WFPhase.claimAndStart(t, meta, B);
    let work = await w.WFPhase.getActivePhaseWork(t, meta);
    work.segments[work.segments.length - 1].start =
      new Date(Date.now() - 1800000).toISOString();        // B works 30 min
    await t.set(meta.id, "shared", "phaseWork", work);
    await w.WFPhase.release(t, meta, B);
    await w.WFPhase.claimAndStart(t, meta, C);

    work = await w.WFPhase.getActivePhaseWork(t, meta);
    assert.deepEqual(work.segments.map((s) => s.by),
      [A.username, B.username, undefined],
      "one name per segment, in the order the three of them held it");

    const split = w.WFPhase.minutesByPerson(work);
    assert.ok(split[A.username] >= 59 && split[A.username] <= 61, "A: " + split[A.username]);
    assert.ok(split[B.username] >= 29 && split[B.username] <= 31, "B: " + split[B.username]);
    assert.ok(split[C.username] <= 1, "C: " + split[C.username]);
  });

/* =============== the force-close, and why it must stay unreachable
 *
 * claimAndStart closes an inherited still-open segment at its own `start`,
 * i.e. at ZERO duration. That is right for a segment abandoned by a crash or a
 * hard refresh -- which would otherwise tick upward forever, since
 * totalMinutes counts an open segment up to now -- and it is data loss for
 * anything else. The safety of it rests entirely on nothing that normally
 * precedes a claim leaving an open segment behind.
 */

test("release and takeOver both close the running segment, so the force-close never sees it",
  async () => {
    const givenBack = releaseEnv(90);
    await givenBack.w.WFPhase.release(givenBack.t, givenBack.meta, givenBack.worker);
    const afterRelease = givenBack.store["c1/phaseWork"];
    assert.ok(afterRelease.segments.every((s) => s.end),
      "release leaves nothing open for claimAndStart to find");

    const handedOn = benchEnv();
    await handedOn.w.WFPhase.takeOver(handedOn.t, handedOn.meta, TAKER);
    assert.ok(handedOn.store["c1/phaseWork"].segments.every((s) => s.end),
      "takeOver leaves nothing open either");

    // And therefore the ninety minutes survive the next claim intact: if the
    // force-close had fired, segment 0 would be end === start and read zero.
    const picked = await givenBack.w.WFPhase.claimAndStart(
      givenBack.t, givenBack.meta, TAKER);
    const seg = picked.segments[0];
    assert.ok(new Date(seg.end) - new Date(seg.start) >= 89 * 60000,
      "the inherited segment kept its real duration");
  });

test("the force-close only fires on a segment nothing else closed, and costs that segment",
  async () => {
    /* Reached only by hand-built or crash-abandoned data: every ordinary route
     * out of a claim (release, takeOver, pause, complete) closes the running
     * segment first. When it does fire it zeroes the abandoned stretch, which
     * is the deliberate trade -- an unbounded clock is worse than a lost one --
     * and it is asserted here so the cost is visible rather than discovered. */
    const { w, t, meta, store } = benchEnv();
    const abandoned = store["c1/phaseWork"];
    abandoned.claimedBy = null;                    // nobody holds it...
    assert.equal(w.WFPhase.isRunning(abandoned), true, "...but the clock is still going");
    await t.set(meta.id, "shared", "phaseWork", abandoned);

    const picked = await w.WFPhase.claimAndStart(t, meta, TAKER);

    assert.equal(picked.segments.length, 2);
    assert.equal(picked.segments[0].end, picked.segments[0].start,
      "the orphaned segment is closed where it started, not left running");
    assert.equal(w.WFPhase.totalMinutes(picked), 0,
      "so the clock cannot run away -- at the price of the abandoned stretch");
  });

/* ======================= a mis-tap is measured in seconds, not in minutes
 *
 * totalMinutes rounds, so a claim given back after 31 seconds came back as 1 --
 * truthy -- and got the full ceremony: phase work left on the card and a
 * comment announcing that a minute of imaginary work survives. The question
 * the no-trace path is asking is "did anybody actually do anything", and the
 * answer has to be read off the clock in milliseconds.
 */

test("a claim given back after half a minute leaves no trace, rounding notwithstanding",
  async () => {
    const { w, t, store, meta, comments } = releaseEnv(31 / 60);     // 31 seconds
    assert.equal(w.WFPhase.totalMinutes(store["c1/phaseWork"]), 1,
      "fixture: this is exactly the case rounding gets wrong");

    const out = await w.WFPhase.release(t, meta, GIVER);

    assert.deepEqual(out, { cleared: true, minutes: 0 });
    assert.equal(store["c1/phaseWork"], undefined, "the mis-tap left nothing behind");
    assert.deepEqual(comments, [],
      "and the card was not told about a minute nobody worked");
  });

test("a dragged slider makes it a real release even with no time on the clock",
  async () => {
    /* Somebody who opens a job, drags the bar to a quarter and puts it straight
     * back has done work the clock cannot see. Clearing the record would throw
     * that away.
     *
     * THIS TEST USED TO ALSO ASSERT A `phaseWork.checklist` CARRY, AND THAT
     * FIELD DOES NOT EXIST. Nothing in the repo ever writes it -- the shop's
     * ticks live in Trello's own checklists (lib/cardview.js reads
     * card.checklists) and in the QC record's rounds (lib/qc.js); the only
     * `checklist` on phase-adjacent storage is a STATION's chosen checklist
     * NAME in lib/tables.js. The old half of this test hand-built a field no
     * writer produces and then proved release protected it, which is coverage
     * of a fiction: it would have passed whatever release did to real data.
     * Deleted with the carry it was guarding. */
    const pct = releaseEnv(0.02, { percentComplete: 25 });
    const outPct = await pct.w.WFPhase.release(pct.t, pct.meta, GIVER);
    assert.equal(outPct.cleared, false, "a percent on the bar is work");
    assert.ok(pct.store["c1/phaseWork"], "so the record stays");

    // Nought minutes, so the comment must not say "0 min already logged".
    const said = pct.comments.join(" | ");
    assert.match(said, /Progress so far stays on the job/);
    assert.doesNotMatch(said, /0 min/,
      "a release with no clock time must not announce zero minutes of logged work");
  });

/* ============ the percent-only round trip, from assignment back to the bench
 *
 * THE DEFECT. `claimAndStart`'s adoption test read `(prior.segments||[]).length`
 * and nothing else. A manager's assignment writes `segments: []`, and the
 * percent slider moves on any phase work whether or not a clock is running --
 * so a job assigned, dragged to a quarter and put back was PRESERVED by
 * `release` (which has always counted a percent as work), promised in writing
 * on the card that the progress stays, and then silently zeroed by the next
 * person to claim it. Two halves of one feature disagreeing about what "work"
 * means, with the card's own comment as the written record of the lie.
 *
 * Walked end to end through the real entry points rather than hand-built
 * state, because the bug lived in the seam between them.
 */

test("a manager's assignment dragged to 25% keeps its 25% through release and re-claim",
  async () => {
    const MANAGER = { id: "m", username: "boss", fullName: "The Boss" };
    const { w, t, store, meta, comments } = benchEnv();
    delete store["c1/phaseWork"];          // a card with nothing on it yet

    // 1. The manager assigns it. No clock -- that is the whole point of assign.
    await w.WFPhase.assign(t, meta, MANAGER, GIVER);
    assert.deepEqual(store["c1/phaseWork"].segments, [],
      "fixture: an assignment starts with no segments at all");

    // 2. The welder drags the bar to a quarter without ever pressing Start.
    await w.WFPhase.setPercentComplete(t, meta, 25);
    const beforeRelease = store["c1/phaseWork"];
    assert.equal(beforeRelease.percentComplete, 25);
    assert.equal(w.WFPhase.totalMinutes(beforeRelease), 0, "and the clock never ran");
    assert.equal(w.WFPhase.leavesNoTrace(beforeRelease), false,
      "a quarter of a job is work, however little time is on it");

    // 3. They give it back.
    const out = await w.WFPhase.release(t, meta, GIVER);
    assert.equal(out.cleared, false, "there is something here worth keeping");
    assert.ok(store["c1/phaseWork"], "so the record survives the release");
    assert.equal(store["c1/phaseWork"].percentComplete, 25);
    assert.equal(store["c1/phaseWork"].claimedBy, null, "but nobody holds it");
    assert.match(comments.join(" | "), /Progress so far stays on the job/,
      "and the card is told so in writing -- which is the promise under test");

    // 4. Somebody else picks it up. THIS read 0 before the fix.
    const next = await w.WFPhase.claimAndStart(t, meta, TAKER);
    assert.equal(next.percentComplete, 25,
      "the next claim continues the quarter rather than binning it");
    assert.equal(w.WFPhase.percentComplete(next), 25);
    assert.equal(next.claimedBy.username, TAKER.username);
    assert.equal(next.segments.length, 1, "and starts their own clock, only theirs");
    assert.equal(w.WFPhase.totalMinutes(next), 0);

    // And it is really on the card, not just in the returned object.
    assert.equal(store["c1/phaseWork"].percentComplete, 25);
  });

test("a released claim with neither a percent nor a clock is still binned outright",
  async () => {
    /* The other side of the same test: widening the adoption rule must not turn
     * every mis-tap into a permanent record. An assignment nobody touched has
     * `segments: []` AND `percentComplete: 0`, and that is nothing. */
    const MANAGER = { id: "m", username: "boss", fullName: "The Boss" };
    const { w, t, store, meta } = benchEnv();
    delete store["c1/phaseWork"];

    await w.WFPhase.assign(t, meta, MANAGER, GIVER);
    const out = await w.WFPhase.release(t, meta, GIVER);

    assert.deepEqual(out, { cleared: true, minutes: 0 });
    assert.equal(store["c1/phaseWork"], undefined, "nothing was left behind");
  });

/* ===================== leavesNoTrace, at every edge somebody can actually hit
 *
 * ONE DEFINITION MEANS ONE PLACE TO GET IT WRONG. `release` and the Floor's
 * confirm dialog both ask this and nothing else, so every lie it can tell is
 * told twice -- once to the welder and once to the card.
 */

test("leavesNoTrace: nothing to erase", () => {
  const L = win.WFPhase.leavesNoTrace;
  assert.equal(L(null), true, "no work at all erases cleanly");
  assert.equal(L(undefined), true);
  assert.equal(L({}), true, "and so does an empty object");
  assert.equal(L({ segments: [] }), true, "empty segments are not work");
  assert.equal(L({ segments: [], percentComplete: 0 }), true,
    "a percent of ZERO is falsy and must not block erasure -- assign() writes it");
  assert.equal(L({ percentComplete: 0 }), true, "with no segments key at all");
  assert.equal(L({ segments: null, percentComplete: 0 }), true, "or a null one");
});

test("leavesNoTrace: anything anybody did is a trace", () => {
  const L = win.WFPhase.leavesNoTrace;
  const ago = (ms) => new Date(Date.now() - ms).toISOString();

  assert.equal(L({ segments: [], percentComplete: 1 }), false,
    "one percent is still somebody's work");
  assert.equal(L({ segments: [], percentComplete: 25 }), false);
  assert.equal(L({ segments: [], percentComplete: 100, completedAt: ago(0) }), false,
    "a FINISHED job is never erased by giving it back");
  assert.equal(
    L({ percentComplete: 0, segments: [{ start: ago(5400000), end: ago(0) }] }), false,
    "ninety minutes on the clock");
  assert.equal(
    L({ percentComplete: 0, segments: [{ start: ago(5400000), end: null }] }), false,
    "and ninety minutes STILL RUNNING is measured to now, not treated as zero");
});

test("leavesNoTrace: the threshold is sixty seconds, measured in milliseconds", () => {
  const L = win.WFPhase.leavesNoTrace;
  const span = (ms) => ({
    percentComplete: 0,
    segments: [{ start: "2020-01-01T00:00:00.000Z",
                 end: new Date(Date.parse("2020-01-01T00:00:00.000Z") + ms).toISOString() }]
  });
  assert.equal(L(span(10000)), true, "ten seconds is a mis-tap");
  assert.equal(L(span(31000)), true,
    "and so is 31 seconds -- totalMinutes ROUNDS THAT TO 1, which is the bug");
  assert.equal(win.WFPhase.totalMinutes(span(31000)), 1,
    "fixture: proving the rounding this predicate has to ignore");
  assert.equal(L(span(59999)), true, "just under the line");
  assert.equal(L(span(60000)), false, "exactly a minute is on the job");
  assert.equal(L(span(60001)), false);

  // Split across two segments, because the sum is what matters, not any one.
  assert.equal(L({ percentComplete: 0, segments: [
    { start: "2020-01-01T00:00:00.000Z", end: "2020-01-01T00:00:40.000Z" },
    { start: "2020-01-01T00:01:00.000Z", end: "2020-01-01T00:01:40.000Z" }
  ] }), false, "two forty-second stretches are eighty seconds of work");
});

test("leavesNoTrace: a malformed segment fails towards KEEPING the record", () => {
  /* An unparseable date makes the arithmetic NaN, and `NaN < 60000` is false,
   * so the answer is "there is a trace" and the work is kept. That is the right
   * way round -- refusing to delete data we cannot measure -- and it is
   * asserted so a later "tidy-up" of the comparison cannot silently invert it
   * into deleting every record it fails to parse.
   *
   * It is not free: `release` returns `minutes: NaN` for these, and the card
   * comment falls back to "Progress so far stays" because NaN is falsy. Ugly,
   * but nothing is lost and the dialog says the same thing. */
  const L = win.WFPhase.leavesNoTrace;
  assert.equal(L({ percentComplete: 0, segments: [{ start: "not a date", end: null }] }), false);
  assert.equal(L({ percentComplete: 0, segments: [{ start: "not a date",
    end: "2020-01-01T00:00:00.000Z" }] }), false);
  assert.equal(L({ percentComplete: 0, segments: [{ end: "2020-01-01T00:00:00.000Z" }] }), false,
    "a segment with no start at all");
  assert.equal(L({ percentComplete: 0, segments: [
    { start: "2020-01-01T00:00:00.000Z", end: "garbage" }] }), false,
    "and an unparseable end");
});

/* ============== a tablet with a bad clock must not delete somebody's day
 *
 * THE DEFECT, AND IT WAS A DATA-LOSS ONE. Shop tablets do not keep good time.
 * One running two hours fast writes a `start` two hours in the future; read
 * back on a machine whose clock is right, that segment measures NEGATIVE.
 * Unclamped, the negative cancelled the real hours either side of it, so a job
 * with ninety minutes on it totalled under a minute, `leavesNoTrace` said yes,
 * and giving the job back DELETED THE RECORD -- silently, and with the confirm
 * dialog agreeing the whole way, because the dialog asks the same question.
 *
 * `elapsedMs` now floors each segment at zero. A stretch that claims to run
 * backwards is not evidence that nobody worked; it is evidence of a bad clock.
 * Count it as nothing and KEEP the record.
 *
 * These are written against the arithmetic AND against `release`, because the
 * unit answer being right is not the thing that was lost -- the record was.
 */

const MIN = 60000;

/** The sum exactly as it was written before the clamp, kept for A/B proof. */
function unclampedMs(work) {
  if (!work || !work.segments) return 0;
  let ms = 0;
  work.segments.forEach((seg) => {
    const end = seg.end ? new Date(seg.end) : new Date();
    ms += end - new Date(seg.start);
  });
  return ms;
}

/**
 * Ninety real minutes in two closed segments, plus one open segment the fast
 * tablet stamped two hours into the future.
 *
 * Unclamped this sums to MINUS thirty minutes. That is the shape that deleted
 * a record, so it is the shape the tests use.
 */
function skewedWork(extra) {
  const base = Date.now() - 5 * 3600000;
  return Object.assign({
    percentComplete: 0,
    segments: [
      { start: new Date(base).toISOString(),
        end: new Date(base + 60 * MIN).toISOString() },           // 60 min
      { start: new Date(base + 90 * MIN).toISOString(),
        end: new Date(base + 120 * MIN).toISOString() },          // 30 min
      { start: new Date(Date.now() + 2 * 3600000).toISOString(),  // the bad clock
        end: null }
    ]
  }, extra || {});
}

test("SKEW: a future `start` can no longer cancel out ninety real minutes", () => {
  const P = win.WFPhase;
  const work = skewedWork();

  // The fixture is the bug. Prove it before asserting it is fixed, or this
  // test would still pass against a clock that was never skewed.
  assert.ok(unclampedMs(work) < MIN,
    "fixture: unclamped, this job measures under a minute (" +
    unclampedMs(work) + "ms) -- that is what deleted records");
  assert.ok(unclampedMs(work) < 0, "fixture: and it is in fact negative");

  assert.ok(P.elapsedMs(work) >= 90 * MIN,
    "the ninety real minutes survive the bad segment (" + P.elapsedMs(work) + "ms)");
  assert.equal(P.elapsedMs(work), 90 * MIN,
    "the backwards segment counts as nothing, not as negative time");
  assert.equal(P.totalMinutes(work), 90);
  assert.equal(P.reportedMinutes(work), 90);
  assert.equal(P.leavesNoTrace(work), false,
    "THE DEFECT: this said true, and `release` then binned the lot");
});

test("SKEW: giving back a job a fast tablet touched KEEPS the record", async () => {
  const { w, t, store, meta, worker, comments } = releaseEnv(null);
  store["c1/phaseWork"] = Object.assign(store["c1/phaseWork"], skewedWork());

  assert.equal(w.WFPhase.leavesNoTrace(store["c1/phaseWork"]), false,
    "fixture: the predicate the write path asks");

  const out = await w.WFPhase.release(t, meta, GIVER);

  assert.equal(out.cleared, false, "THE DEFECT: this cleared, and the day went with it");
  assert.ok(store["c1/phaseWork"], "the record is still on the card");
  assert.ok(w.WFPhase.totalMinutes(store["c1/phaseWork"]) >= 90,
    "with the ninety minutes still on it (" +
    w.WFPhase.totalMinutes(store["c1/phaseWork"]) + ")");
  assert.equal(out.minutes, 90, "and the card is told about real minutes only");
  assert.equal(comments.length, 1, "real work changing hands is said out loud");
  assert.match(comments[0], /90 min already logged stays on the job/);
  assert.equal(store["c1/phaseWork"].segments[0].by, worker.username,
    "and the hours are stamped before the claim goes");
});

test("SKEW, the mirrors: every way a segment can run backwards", () => {
  const P = win.WFPhase;
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();

  // (a) end BEFORE start -- the plainest backwards segment there is.
  const backwards = { percentComplete: 0,
    segments: [{ start: iso(now - 1 * 3600000), end: iso(now - 2 * 3600000) }] };
  assert.equal(unclampedMs(backwards), -3600000, "fixture: minus an hour");
  assert.equal(P.elapsedMs(backwards), 0, "clamped to nothing, never to negative");
  assert.equal(P.totalMinutes(backwards), 0);
  assert.equal(P.leavesNoTrace(backwards), true,
    "and with nothing else on the job there is genuinely nothing to keep");

  // (b) end before start, alongside real work -- the dangerous one, because
  //     here the clamp is the difference between keeping and deleting.
  const mixed = { percentComplete: 0, segments: [
    { start: iso(now - 3 * 3600000), end: iso(now - 2 * 3600000) },   // a real hour
    { start: iso(now - 1 * 3600000), end: iso(now - 2 * 3600000) }    // minus an hour
  ] };
  assert.equal(unclampedMs(mixed), 0, "fixture: unclamped the two cancel exactly");
  assert.equal(P.elapsedMs(mixed), 3600000, "the real hour is not cancelled by a bad one");
  assert.equal(P.leavesNoTrace(mixed), false, "so the record stays");

  // (c) a single CLOSED segment wholly in the future. It runs forwards, so it
  //     is an hour of work by a tablet that is simply wrong about when --
  //     the clamp is a no-op and the hour counts. Deleting it would be the
  //     worse error of the two.
  const future = { percentComplete: 0,
    segments: [{ start: iso(now + 2 * 3600000), end: iso(now + 3 * 3600000) }] };
  assert.equal(P.elapsedMs(future), 3600000, "an hour is an hour, whenever it is stamped");
  assert.equal(unclampedMs(future), P.elapsedMs(future), "and the clamp changed nothing");
  assert.equal(P.leavesNoTrace(future), false, "so it is kept");

  // (d) a single OPEN segment wholly in the future, with nothing else. Clamped
  //     this is zero, so the job does read as untouched -- which it is. Pinned
  //     so the honest-looking answer here is not mistaken for the (b) case.
  const futureOpen = { percentComplete: 0,
    segments: [{ start: iso(now + 2 * 3600000), end: null }] };
  assert.ok(unclampedMs(futureOpen) < -7000000, "fixture: roughly minus two hours");
  assert.equal(P.elapsedMs(futureOpen), 0);
  assert.equal(P.leavesNoTrace(futureOpen), true,
    "nothing else on the job and no measurable time: there is nothing to erase");

  // (e) and the same thing WITH a percent is still kept, because the slider is
  //     work the clock cannot see.
  assert.equal(P.leavesNoTrace({ percentComplete: 25,
    segments: [{ start: iso(now + 2 * 3600000), end: null }] }), false);
});

/* ============ the clamp must not move a single honest number
 *
 * `totalMinutes` feeds costing, the phaseLog and the Records tab. A clamp that
 * quietly re-rounded ordinary data would be a worse bug than the one it fixes
 * and would not announce itself anywhere. So: on well-formed segments the new
 * arithmetic must be IDENTICAL to the old, not merely close.
 */
test("CLAMP IS A NO-OP on every well-formed shape", () => {
  const P = win.WFPhase;
  const t0 = Date.parse("2020-06-01T07:00:00.000Z");
  const iso = (ms) => new Date(ms).toISOString();
  const span = (ms) => ({ start: iso(t0), end: iso(t0 + ms) });

  // Every boundary the rounding can turn on, plus a few ordinary shifts.
  const durations = [0, 1, 499, 500, 501, 999, 1000, 29999, 30000, 30001,
                     31000, 59999, 60000, 60001, 89999, 90000, 90001,
                     150000, 5400000, 8 * 3600000, 24 * 3600000];

  durations.forEach((ms) => {
    const work = { percentComplete: 0, segments: [span(ms)] };
    assert.equal(P.elapsedMs(work), unclampedMs(work),
      "elapsedMs moved at " + ms + "ms");
    assert.equal(P.totalMinutes(work), Math.round(unclampedMs(work) / 60000),
      "totalMinutes moved at " + ms + "ms");
  });

  // Multi-segment, including the back-to-back and gapped shapes pause/resume
  // actually produce, and a job that changed hands.
  const shapes = [
    [[0, 45 * MIN], [45 * MIN, 50 * MIN]],                    // back to back
    [[0, 25 * MIN], [90 * MIN, 140 * MIN]],                   // with a gap
    [[0, 1], [10, 11], [20, 21]],                             // three millisecond taps
    [[0, 29999], [60 * MIN, 60 * MIN + 30001]],               // rounds either way
    [[0, 7 * 3600000], [8 * 3600000, 15 * 3600000]]           // two long shifts
  ];
  shapes.forEach((segs, i) => {
    const work = { percentComplete: 0, segments: segs.map(
      ([a, b]) => ({ start: iso(t0 + a), end: iso(t0 + b), by: "mike" })) };
    assert.equal(P.elapsedMs(work), unclampedMs(work), "elapsedMs moved on shape " + i);
    assert.equal(P.totalMinutes(work), Math.round(unclampedMs(work) / 60000),
      "totalMinutes moved on shape " + i);
    assert.equal(P.totalMinutes(work), T.elapsedMinutes(work),
      "and WFTables.elapsedMinutes, which is NOT clamped, still agrees on shape " + i);
  });

  // The empty and absent cases, which costing hits constantly.
  [null, undefined, {}, { segments: [] }, { segments: null }].forEach((work, i) => {
    assert.equal(P.elapsedMs(work), 0, "empty shape " + i);
    assert.equal(P.totalMinutes(work), 0, "empty shape " + i);
  });

  /* A RUNNING segment cannot be compared byte-for-byte: both functions call
   * `new Date()` themselves, a moment apart. One millisecond of tolerance is
   * the measurement, not the clamp. */
  const running = { percentComplete: 0,
    segments: [{ start: new Date(Date.now() - 95 * MIN).toISOString(), end: null }] };
  assert.ok(Math.abs(P.elapsedMs(running) - unclampedMs(running)) <= 2,
    "a running segment is untouched by the clamp");
  assert.equal(P.totalMinutes(running), 95);
});

test("the clamp did not move what gets WRITTEN DOWN either", async () => {
  /* totalMinutes is not just displayed -- it is frozen into phaseLog, which is
   * what costing.js and the Records tab read forever after. */
  const { w, t, meta, store } = releaseEnv(137);
  const entry = await w.WFPhase.logPhase(t, meta, { by: GIVER, listName: "Weld" });
  assert.equal(entry.durationMinutes, 137,
    "the logged duration is the honest one, to the minute");
  assert.equal(entry.durationMinutes,
    Math.round(unclampedMs(store["c1/phaseWork"]) / 60000),
    "byte-identical to the pre-clamp arithmetic");
});

/* ================================ reportedMinutes is for SAYING, not costing
 *
 * `totalMinutes` rounds, which is right for costing a phase and wrong for
 * printing: a job kept because the slider is at 25%, with 31 seconds on the
 * clock, announced "1 min already logged stays on the job" about a minute
 * nobody worked. `reportedMinutes` is zero under the line and the rounded
 * total above it, and ONLY the card comment and the Floor dialog use it.
 */
test("reportedMinutes: silent under a minute, honest above it", () => {
  const P = win.WFPhase;
  const t0 = Date.parse("2020-06-01T07:00:00.000Z");
  const span = (ms) => ({ percentComplete: 0, segments: [{
    start: new Date(t0).toISOString(), end: new Date(t0 + ms).toISOString() }] });

  assert.equal(P.reportedMinutes(span(0)), 0);
  assert.equal(P.reportedMinutes(span(31000)), 0,
    "THE POINT: totalMinutes says 1 here, and 1 is a lie to print");
  assert.equal(P.totalMinutes(span(31000)), 1,
    "fixture: the rounding reportedMinutes exists to refuse");
  assert.equal(P.reportedMinutes(span(59999)), 0, "just under the line");
  assert.equal(P.reportedMinutes(span(60000)), 1, "exactly a minute is worth saying");
  assert.equal(P.reportedMinutes(span(89999)), 1);
  assert.equal(P.reportedMinutes(span(90000)), 2, "and it rounds like totalMinutes above the line");
  assert.equal(P.reportedMinutes(span(5400000)), 90);
  assert.equal(P.reportedMinutes(null), 0);

  // Above the line the two must never diverge -- costing and the comment
  // disagreeing about a real job is its own bug.
  [60000, 61000, 150000, 5400000, 8 * 3600000].forEach((ms) => {
    assert.equal(P.reportedMinutes(span(ms)), P.totalMinutes(span(ms)),
      "they must agree on real time (" + ms + "ms)");
  });
});

test("a job kept for its percent with 31 seconds on it is told about no minutes",
  async () => {
    /* The exact sentence this was built to stop: "1 min already logged stays
     * on the job", on a job where nobody worked a minute. */
    const { w, t, meta, store, comments } = releaseEnv(31 / 60, { percentComplete: 25 });
    assert.equal(w.WFPhase.totalMinutes(store["c1/phaseWork"]), 1,
      "fixture: the rounding that produced the sentence");
    assert.equal(w.WFPhase.leavesNoTrace(store["c1/phaseWork"]), false,
      "fixture: the percent keeps it, so a comment does get written");

    const out = await w.WFPhase.release(t, meta, GIVER);

    assert.equal(out.cleared, false, "the quarter of a job stays");
    assert.equal(out.minutes, 0, "and no minute is claimed for it");
    assert.equal(comments.length, 1);
    assert.doesNotMatch(comments[0], /min already logged/,
      "THE DEFECT: the card announced a minute nobody worked");
    assert.match(comments[0], /Progress so far stays on the job/);
  });

/* ===================================== NaN: which way does each one fail?
 *
 * `Math.max(0, NaN)` is NaN, so the clamp does NOT launder an unparseable
 * date -- and that is deliberate. Everything downstream has to fail towards
 * KEEPING the record, never towards deleting one we cannot measure. Each
 * answer is pinned below with the direction it fails in, so a later tidy-up
 * cannot invert one of them quietly.
 */
test("NaN: an unmeasurable segment fails towards keeping, in all four answers", () => {
  const P = win.WFPhase;
  const bad = { percentComplete: 0, segments: [{ start: "not a date", end: null }] };

  assert.ok(Number.isNaN(P.elapsedMs(bad)),
    "the clamp does not turn an unmeasurable segment into a measured zero -- " +
    "Math.max(0, NaN) is NaN, and a laundered 0 would read as 'nobody worked'");
  assert.ok(Number.isNaN(P.totalMinutes(bad)), "so the total is NaN");
  assert.ok(Number.isNaN(P.reportedMinutes(bad)),
    "and so is the reported figure: `NaN < 60000` is false, so it takes the " +
    "rounding branch");

  // The direction each one fails in. These are the assertions that matter.
  assert.equal(P.leavesNoTrace(bad), false,
    "KEEP: `NaN < 60000` is false, so an unreadable clock is never grounds to delete");
  assert.ok(!P.reportedMinutes(bad),
    "SILENT: NaN is falsy, so the comment falls back to 'Progress so far stays' " +
    "rather than printing 'NaN min already logged'");
  assert.ok(!P.totalMinutes(bad),
    "and NaN is falsy everywhere `totalMinutes` is used as a truth test, so no " +
    "caller prints it either -- it is still NaN in any caller that does arithmetic");

  // Every malformed shape, same direction.
  [{ start: "not a date", end: "2020-01-01T00:00:00.000Z" },
   { end: "2020-01-01T00:00:00.000Z" },
   { start: "2020-01-01T00:00:00.000Z", end: "garbage" },
   { start: null, end: null }].forEach((seg, i) => {
    const w2 = { percentComplete: 0, segments: [seg] };
    assert.equal(P.leavesNoTrace(w2), false, "malformed shape " + i + " must be kept");
  });

  // Real hours plus one unreadable segment: still kept. This is the case where
  // failing the other way would cost a day.
  const mixed = { percentComplete: 0, segments: [
    { start: new Date(Date.now() - 90 * MIN).toISOString(), end: new Date().toISOString() },
    { start: "not a date", end: null }
  ] };
  assert.equal(P.leavesNoTrace(mixed), false,
    "ninety real minutes are not erased by one segment we cannot parse");
});

test("NaN: `release` keeps the record and says nothing about minutes", async () => {
  const { w, t, meta, store, comments } = releaseEnv(null);
  store["c1/phaseWork"].segments = [{ start: "not a date", end: null }];

  const out = await w.WFPhase.release(t, meta, GIVER);

  assert.equal(out.cleared, false, "KEEP -- we could not measure it, so we do not bin it");
  assert.ok(store["c1/phaseWork"], "the record is still there");
  assert.ok(Number.isNaN(out.minutes),
    "`minutes` is NaN, and that is pinned rather than fixed: the ONE caller " +
    "(floor.js confirmRelease, via doWrite) discards the return value, so " +
    "nothing persists it. A caller that starts reading it must handle this.");
  assert.equal(comments.length, 1);
  assert.doesNotMatch(comments[0], /NaN/, "the card must never be shown the word NaN");
  assert.match(comments[0], /Progress so far stays on the job/);
});
