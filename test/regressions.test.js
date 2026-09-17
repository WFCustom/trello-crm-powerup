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
