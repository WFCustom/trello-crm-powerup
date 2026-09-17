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
