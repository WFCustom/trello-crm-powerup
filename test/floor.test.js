/**
 * The shop floor -- station derivation and the Floor tab, against the real files.
 *
 * The assertion this file exists for is "a worker never sees a running timer".
 * Everything else here is ordinary coverage; that one is a promise made to the
 * shop, and it is the kind of promise a refactor breaks silently.
 */
"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

const OPEN = [];
after(() => OPEN.forEach((d) => { try { d.window.close(); } catch (e) { /* already gone */ } }));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const DAY = 86400000;
const iso = (d) => new Date(Date.now() + d * DAY).toISOString();

/** A board config shaped like the real one, cut down to the phases we need. */
const BOARD = {
  stages: [
    { listId: "LA", name: "Assemble Legacy", order: 8, slaDays: 3, isWorkPhase: true },
    { listId: "LB", name: "Assemble CAP", order: 8, slaDays: 3, isWorkPhase: true },
    { listId: "LC", name: "Assemble CNC", order: 8, slaDays: 3, isWorkPhase: true },
    { listId: "LS", name: "Sandblast / Powder Coat", order: 9, slaDays: 3, isWorkPhase: true },
    { listId: "LI1", name: "Install", phase: "Install", region: "North", order: 11, slaDays: 1, isWorkPhase: true },
    { listId: "LI2", name: "Install", phase: "Install", region: "South", order: 11, slaDays: 1, isWorkPhase: true },
    { listId: "LX", name: "Billing", order: 12, slaDays: 3 }
  ]
};

const KEV = { username: "kevinmoss", fullName: "Kevin Moss" };
const SCOTT = { username: "scottv", fullName: "Scott VanWorkom" };

/** A card with phase work already claimed and optionally running. */
function job(id, list, opts = {}) {
  const segs = opts.running
    ? [{ start: new Date(Date.now() - 90 * 60000).toISOString() }]
    : opts.claimed
      ? [{ start: new Date(Date.now() - 120 * 60000).toISOString(),
           end: new Date(Date.now() - 30 * 60000).toISOString() }]
      : [];
  return {
    id,
    name: opts.name || ("#" + id + " — job " + id),
    idList: list,
    pos: opts.pos === undefined ? 100 : opts.pos,
    due: opts.due || null,
    dueComplete: !!opts.dueComplete,
    dateLastActivity: iso(-1),
    shortUrl: "https://trello.com/c/" + id,
    phaseWork: opts.claimed || opts.running
      ? {
          listId: list,
          claimedBy: opts.claimed || opts.running,
          segments: segs,
          percentComplete: opts.pct === undefined ? 0 : opts.pct,
          pendingApproval: !!opts.pendingApproval
        }
      : null
  };
}

function boot({ role = "worker", cards = [], saved = null, url = null,
                me = KEV, members = [KEV, SCOTT], can = null } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="boardName"></div><div id="meName"></div><div id="meInitials"></div>
       <nav id="tabbar"></nav><main id="view"></main>
     </body></html>`,
    /* A url, when a test needs one. jsdom defaults to about:blank, which is an
       opaque origin -- location.search is "" and localStorage THROWS rather
       than returning null. Both are exactly the conditions readPin() has to
       survive, so the default is left alone and only the pin tests opt in. */
    Object.assign({ runScripts: "outside-only", pretendToBeVisual: true },
      url ? { url } : {})
  );
  const win = dom.window;
  const store = saved ? { wfStations: saved } : {};
  const written = [];

  win.eval(read("config.js"));
  // Every plugin-data write goes through WFStore, and the Floor writes: it has
  // to be here before lib/qc.js and lib/tables.js, which call it by name and
  // would throw a ReferenceError nothing catches. Same position ops.html uses.
  win.eval(read("lib/store.js"));
  win.eval(read("lib/board-extras.js"));
  win.eval(read("lib/stage.js"));
  // getCardDetail is what the cover image rides on. Returning a card with an
  // image attachment exercises the real WFCardView.coverFrom path rather than
  // only the "no cover" branch.
  win.WFRest = {
    request: () => Promise.resolve([]),
    write: () => Promise.resolve({}),
    getCardDetail: (t, id) => Promise.resolve({
      id, name: "job " + id,
      attachments: [{ url: "https://x/drawing.png", mimeType: "image/png" }]
    }),
    /* The panel's body asks for custom fields the moment it draws. Without
       this the call threw, the whole panel fell into its "couldn't open this
       card" branch, and every panel assertion in this file was being made
       against the error state rather than against the card. */
    getCardFieldsDisplay: () => Promise.resolve([]),
    updateCard: () => Promise.resolve({}),
    postComment: () => Promise.resolve({}),
    addMemberToCard: () => Promise.resolve({}),
    invalidateCard: () => {}
  };
  win.WFRoster = { getRoster: () => Promise.resolve({ managers: [], phaseSpecialists: {} }) };
  win.WFPricing = { getBoardAudit: () => Promise.resolve([]) };
  win.Chart = function () {};

  // The Floor writes now, so it needs the state machine and the checklists.
  win.eval(read("lib/phase.js"));
  win.eval(read("lib/qc.js"));
  /* BEFORE tables.js, exactly as popups/ops.html loads it.
   *
   * This fixture was missing it, and the omission was invisible until the
   * blast/powder split landed: lib/tables.js asks for it through `global.` and
   * fails open, so the station queues looked right, while popups/tabs/floor.js
   * names it BARE -- so confirmComplete threw a ReferenceError the moment a
   * signed job's Complete was pressed, and the dialog simply never appeared.
   * A tab file loaded here without every script ops.html gives it is a suite
   * testing a configuration nobody runs. */
  win.eval(read("lib/steps.js"));
  win.eval(read("lib/tables.js"));
  win.eval(read("lib/cardview.js"));
  // ops.js reads permissions at startup and on reload, so the module has to be
  // present even though these fixtures drive render() directly.
  win.eval(read("lib/permissions.js"));
  win.eval(read("popups/ops.js"));
  win.eval(read("popups/cardpanel.js"));

  let def = null;
  const realTab = win.WFOps.tab;
  win.WFOps.tab = (d) => { def = d; return realTab(d); };
  win.eval(read("popups/tabs/floor.js"));

  /* Speaks every shape the real Trello API does, because WFStore uses more
   * than one: a KEYLESS get, because the 4096-character limit is per
   * scope/visibility pair and the whole blob is the only thing worth
   * measuring, and an OBJECT passed to set so several keys land in one call.
   * Knowing only the four-argument form measured an empty scope and wrote the
   * patch under the key "undefined".
   *
   * The store is flat and always has been -- it ignores scope, so a keyless
   * get hands back board and card keys together. That over-counts, which can
   * only make the size guard stricter here, never more permissive. `written`
   * still records one entry per key, so every count below is unchanged. */
  const t = {
    get: (scope, vis, key, dflt) => {
      if (key === undefined) return Promise.resolve(Object.assign({}, store));
      return Promise.resolve(store[key] === undefined ? dflt : store[key]);
    },
    set: (scope, vis, key, value) => {
      const patch = (key && typeof key === "object") ? key : { [key]: value };
      Object.keys(patch).forEach((k) => {
        written.push([k, patch[k]]); store[k] = patch[k];
      });
      return Promise.resolve();
    },
    remove: (scope, vis, key) => {
      [].concat(key).forEach((k) => { written.push([k, null]); delete store[k]; });
      return Promise.resolve();
    }
  };

  const ctx = {
    t,
    board: { id: "OPS", name: "Office Operations", members: members },
    member: me,
    boardCfg: BOARD,
    roster: { managers: [], phaseSpecialists: {} },
    role,
    isManager: role === "manager",
    cards: () => Promise.resolve(cards),
    // Absent unless a test asks for it, because the real shell only supplies
    // it once permissions have loaded and the Floor has to survive both.
    ...(can ? { can } : {}),
    reload: () => Promise.resolve(),
    syncCard: () => Promise.resolve(),
    goTo: () => {}
  };

  // The tab runs a 30s interval for the clock. jsdom timers keep node's event
  // loop alive, so every window this suite opens is closed once it has finished
  // -- otherwise the run hangs instead of exiting.
  OPEN.push(dom);
  return { win, dom, def, ctx, store, written, T: win.WFTables };
}

const textOf = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const $ = (n, sel) => Array.from(n.querySelectorAll(sel));

/**
 * Let the promise chains behind a click finish.
 *
 * The card panel paints its body and its footer only once getCardDetail
 * resolves, and a write runs fn -> reload -> refreshData -> paint. One tick is
 * not enough for either, and a test that asserts too early reads as a missing
 * button rather than as a missing await.
 */
async function settle(env, n = 6) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

/** The button the card panel's footer carries -- the only thing that starts a clock. */
const footBtn = (col) => $(col, ".wf-cp-foot .wf-btn")[0];

/** A round navy button in the top bar, by what it says it does. */
function gear(node, title) {
  const g = $(node, ".wf-fl-gear").find((b) => b.getAttribute("title") === title);
  assert.ok(g, "no gear titled " + JSON.stringify(title));
  return g;
}

function render(env, width) {
  if (width) Object.defineProperty(env.win, "innerWidth", { value: width, configurable: true });
  return Promise.resolve(env.def.render(env.ctx)).then((node) => {
    env.win.document.getElementById("view").appendChild(node);
    return node;
  });
}

/** Station config with one welding station wired to Kevin. */
const ONE_STATION = {
  stations: [{ id: "s1", area: "shop", table: "Station #1", station: "Welding",
               welder: "kevinmoss", phase: "Assemble Legacy" }],
  visible: ["s1"]
};

/* ============================================================== the layer */

test("the defaults describe the shop, not the board", () => {
  const { T } = boot();
  const d = T.defaults().map(T.hydrate);
  /* Seven, not nine. The cure oven and the wet paint bay were invented in the
   * defaults and neither exists in the shop -- the oven is time the powder
   * operator owns rather than a bench anybody stands at, and there is no wet
   * paint bay at all. A station nobody works at still takes a column on the
   * shop TV and still asks to be staffed, so they are gone rather than hidden.
   * test/regressions.test.js holds the other half: that a saved config naming
   * them cannot put them back. */
  assert.deepEqual(d.map((s) => s.table), [
    "Station #1", "Station #2", "Station #3", "Station #4", "CAP rail bench",
    "Blast booth", "Powder booth"
  ]);

  // THE BUG THIS TEST EXISTS FOR. The first cut gave each welding bench a
  // different phase, so only Station #1 ever had a queue. Four welding benches
  // do the same work and therefore pull the same list.
  const welding = d.filter((s) => s.type === "weld");
  assert.equal(welding.length, 4);
  assert.ok(welding.every((s) => s.phase === "Assemble Legacy"),
    "every welding bench pulls the same list");

  assert.equal(d.find((s) => s.table === "CAP rail bench").phase, "Assemble CAP");
  /* BOTH finishing benches pull the SAME list, because there is only one
   * column. Which of the two owns a given job is decided by a Trello label --
   * see lib/steps.js -- not by the card being in a different place. */
  assert.equal(d.find((s) => s.table === "Blast booth").phase, "Sandblast / Powder Coat");
  assert.equal(d.find((s) => s.table === "Powder booth").phase, "Sandblast / Powder Coat");
  // The laser bay still has no matching list, so its type is left unset rather
  // than pointed somewhere plausible -- a guess dressed as a fact.
  assert.equal(T.phaseForType("laser"), "");
  // Nobody is rostered by default.
  assert.ok(d.every((s) => s.welder === ""));
});

test("a station's kind decides where its queue comes from", () => {
  const { T } = boot();
  assert.equal(T.phaseForType("weld"), "Assemble Legacy");
  assert.equal(T.phaseForType("cnc"), "Assemble CNC");
  assert.equal(T.phaseForType("cap"), "Assemble CAP");
  assert.equal(T.phaseForType("laser"), "", "no list corresponds to it");
  assert.equal(T.phaseForType("nonsense"), "");
});

test("a saved config from before station kinds existed still works", () => {
  const { T } = boot();
  // Old configs carry `station` and `phase` but no `type`. A board that saved
  // one last month must not come back with every bench set to "Something else".
  const merged = T.merge({
    stations: [{ id: "s1", table: "Big table", station: "Welding",
                 welder: "kevinmoss", phase: "Assemble CNC" }],
    visible: ["s1"]
  });
  const s1 = merged.stations.find((s) => s.id === "s1");
  assert.equal(s1.type, "weld", "inferred back out of what it did say");
  assert.equal(s1.table, "Big table");
  assert.equal(s1.phase, "Assemble CNC", "an explicit override still wins");
});

test("a new shipped station appears, and a deleted one stays deleted", () => {
  const { T } = boot();
  // These two rules pull in opposite directions and both matter.
  const grown = T.merge({ stations: [{ id: "s1", table: "Big table" }], visible: ["s1"] });
  assert.equal(grown.stations.length, 7, "the others survive");

  const pruned = T.merge({ stations: [], visible: [], removed: ["s4"] });
  assert.equal(pruned.stations.length, 6);
  assert.ok(!pruned.stations.some((s) => s.id === "s4"),
    "a station somebody deleted does not walk back in on the next load");
  assert.deepEqual(pruned.removed, ["s4"]);
});

test("a station this shop added itself survives a merge", () => {
  const { T } = boot();
  const merged = T.merge({
    stations: [{ id: "x1", area: "shop", table: "Fifth bench", type: "weld", welder: "" }],
    visible: ["x1"]
  });
  const mine = merged.stations.find((s) => s.id === "x1");
  assert.ok(mine, "kept");
  assert.equal(mine.phase, "Assemble Legacy", "and hydrated from its kind");
});

test("adding a station never collides with an id already in use", () => {
  const { T } = boot();
  const cfg = T.merge(null);
  const a = T.newStation(cfg, "shop", "weld");
  cfg.stations.push(a);
  const b = T.newStation(cfg, "shop", "cnc");
  assert.notEqual(a.id, b.id);
  assert.equal(a.phase, "Assemble Legacy");
  assert.equal(b.phase, "Assemble CNC");
});

test("phase options come from the board's work phases, de-duplicated", () => {
  const { T } = boot();
  const p = T.phaseOptions(BOARD);
  assert.deepEqual(p, [
    "Assemble Legacy", "Assemble CAP", "Assemble CNC",
    "Sandblast / Powder Coat", "Install"
  ]);
  assert.ok(!p.includes("Billing"), "not a work phase");
  assert.equal(p.filter((x) => x === "Install").length, 1, "four Install lists, one phase");
});

test("a station shows the job its person claimed, and queues the rest in board order", () => {
  const { T } = boot();
  const cards = [
    job("A", "LA", { pos: 300 }),
    job("B", "LA", { claimed: KEV, running: true, pct: 40 }),
    job("C", "LA", { pos: 100 }),
    job("D", "LA", { pos: 200 }),
    job("E", "LB"),                       // different phase
    job("F", "LA", { claimed: SCOTT })    // somebody else's
  ];
  const st = T.stationState(BOARD, cards, ONE_STATION.stations[0]);
  assert.equal(st.job.id, "B");
  assert.equal(st.status, "running");
  assert.deepEqual(st.queue.map((c) => c.id), ["C", "D", "A"], "sorted by pos");
  assert.ok(!st.queue.some((c) => c.id === "F"), "claimed by someone else isn't queued");
  assert.ok(!st.queue.some((c) => c.id === "E"), "another phase isn't queued");
});

test("status: behind beats running, and an unstaffed station is Open with its queue", () => {
  const { T } = boot();
  const s = ONE_STATION.stations[0];

  const late = T.stationState(BOARD, [
    job("B", "LA", { claimed: KEV, running: true, due: iso(-2) })
  ], s);
  assert.equal(late.status, "behind", "a job past its date is the thing to act on");

  const paused = T.stationState(BOARD, [job("B", "LA", { claimed: KEV })], s);
  assert.equal(paused.status, "paused");

  const open = T.stationState(BOARD, [job("C", "LA")], s);
  assert.equal(open.status, "open");
  assert.equal(open.queue.length, 1);

  const nobody = T.stationState(BOARD, [job("C", "LA")],
    Object.assign({}, s, { welder: "" }));
  assert.equal(nobody.status, "open");
  assert.match(nobody.note, /Nobody assigned/);
  assert.equal(nobody.queue.length, 1, "the phase queue still shows");

  const unset = T.stationState(BOARD, [job("C", "LA")],
    Object.assign({}, s, { phase: "" }));
  assert.equal(unset.status, "unset");
  assert.match(unset.note, /No phase set/);
  assert.equal(unset.queue.length, 0);
});

test("a finished job leaves the station whether or not approvals still exist", () => {
  /* THE REGRESSION THIS EXISTS FOR.
   *
   * The station queues used to read `pendingApproval` at four separate points
   * to mean "finished, hide it". That quietly made the shop floor depend on the
   * approval model: the moment approvals are retired and that flag stops being
   * written, finished jobs never leave a bench, every station fills with work
   * nobody can clear, and nothing anywhere reports a problem.
   *
   * Both spellings of "done" must clear the station, so the floor keeps working
   * during the migration and after it.
   */
  const { T } = boot();
  const s = ONE_STATION.stations[0];

  const oldWay = job("B", "LA", { claimed: KEV, running: true, pendingApproval: true });
  assert.equal(T.stationState(BOARD, [oldWay], s).job, null, "pendingApproval clears it");

  const newWay = job("C", "LA", { claimed: KEV, running: true });
  newWay.phaseWork.completedAt = new Date().toISOString();
  assert.equal(T.stationState(BOARD, [newWay], s).job, null, "completedAt clears it too");

  // And a job that is genuinely still being worked stays put.
  const live = job("D", "LA", { claimed: KEV, running: true });
  assert.equal(T.stationState(BOARD, [live], s).job.id, "D");

  // The predicate is asked once rather than spelled out at each call site --
  // four copies of this rule is how it came to be forgotten in the first place.
  assert.equal(T.isFinished({ completedAt: "2026-09-16T00:00:00Z" }), true);
  assert.equal(T.isFinished({ pendingApproval: true }), true);
  assert.equal(T.isFinished({ claimedBy: KEV, segments: [] }), false);
  assert.equal(T.isFinished(null), false);
});

test("a finished job is not offered to the assign view either", () => {
  const { T } = boot();
  const done = job("B", "LA", { claimed: KEV });
  done.phaseWork.completedAt = new Date().toISOString();
  done.phaseWork.tableId = null;
  const pool = T.unassignedInPhase(BOARD, [done], "Assemble Legacy");
  assert.equal(pool.length, 0, "finished work is not unassigned work");
});

test("after a switch the station shows what is running, not what was paused", () => {
  /* THE BUG THIS EXISTS FOR.
   *
   * Pausing A and starting B leaves BOTH cards carrying this station's
   * tableId -- A parked at the front of the queue, B on the clock. Taking the
   * first match meant the station often kept showing A, so switching looked
   * like it had silently failed and people tapped it again.
   */
  const { T } = boot();
  const s = ONE_STATION.stations[0];

  const paused = job("A", "LA", { claimed: KEV, pct: 65 });
  paused.phaseWork.tableId = "s1";
  paused.phaseWork.queuePos = -1;

  const running = job("B", "LA", { claimed: KEV, running: true });
  running.phaseWork.tableId = "s1";

  // Paused one first in the array, so order cannot be what saves this.
  const st = T.stationState(BOARD, [paused, running], s);
  assert.equal(st.job.id, "B", "the job on the clock owns the station");
  assert.ok(st.queue.some((c) => c.id === "A"), "the paused one is back in the queue");

  // And with nothing running, the paused job keeps the slot rather than the
  // station going Open with work sitting on it.
  const idle = T.stationState(BOARD, [paused], s);
  assert.equal(idle.job.id, "A");
});

test("work left over from an earlier phase is ignored", () => {
  const { T } = boot();
  const stale = job("B", "LA", { claimed: KEV, running: true });
  stale.phaseWork.listId = "LB";   // claimed in a list the card has since left
  const st = T.stationState(BOARD, [stale], ONE_STATION.stations[0]);
  assert.equal(st.job, null, "stale work doesn't put a job on the station");
  assert.deepEqual(st.queue.map((c) => c.id), ["B"], "it's waiting, not running");
});

test("a job waiting on sign-off has left the station", () => {
  const { T } = boot();
  const st = T.stationState(BOARD, [
    job("B", "LA", { claimed: KEV, pendingApproval: true })
  ], ONE_STATION.stations[0]);
  assert.equal(st.job, null);
  assert.equal(st.status, "open");
});

test("columns fit the screen, never more than there are stations", () => {
  const { T } = boot();
  assert.equal(T.columnsFor(390, 4), 1, "phone");
  assert.equal(T.columnsFor(820, 4), 2, "iPad");
  assert.equal(T.columnsFor(1280, 4), 3, "laptop");
  assert.equal(T.columnsFor(1920, 4), 4, "shop TV");
  assert.equal(T.columnsFor(1920, 2), 2, "two stations never render as four");
  assert.equal(T.columnsFor(1920, 0), 0);
  assert.ok(T.scaleFor(4).compact && !T.scaleFor(1).compact);
  assert.ok(T.scaleFor(1).job > T.scaleFor(4).job, "type shrinks as columns multiply");
});

test("elapsed counts the open segment; due dates decide late", () => {
  const { T } = boot();
  const running = job("B", "LA", { claimed: KEV, running: true }).phaseWork;
  const mins = T.elapsedMinutes(running);
  assert.ok(mins >= 89 && mins <= 91, "about ninety minutes, got " + mins);
  assert.equal(T.clockText(90), "1:30");
  assert.equal(T.clockText(5), "0:05");
  assert.equal(T.elapsedMinutes(null), 0);

  assert.equal(T.isLate({ due: iso(-1) }), true);
  assert.equal(T.isLate({ due: iso(1) }), false);
  assert.equal(T.isLate({ due: iso(-1), dueComplete: true }), false, "done isn't late");
  assert.equal(T.isLate({ due: null }), false, "no date is not late");
});

test("the summary counts stations, not people", () => {
  const { T } = boot();
  const s = T.summary([
    { status: "running", queue: [1, 2] },
    { status: "behind", queue: [] },
    { status: "paused", queue: [3] },
    { status: "open", queue: [] },
    { status: "unset", queue: [9, 9, 9] }
  ]);
  assert.equal(s.total, 4, "an unset station isn't capacity");
  assert.equal(s.queued, 3, "and its queue doesn't count");
  assert.equal(s.utilisation, 50, "running + behind over total");
});

/* ================================================================= the tab */

test("the tab registers as Floor and is open to everyone", () => {
  const env = boot();
  assert.equal(env.def.id, "floor");
  assert.equal(env.def.label, "Floor");
  assert.equal(env.def.roles, undefined, "the shop's screen first");
});

test("A WORKER NEVER SEES A RUNNING TIMER", async () => {
  const env = boot({
    role: "worker",
    saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true, pct: 40 })]
  });
  const node = await render(env, 1280);
  const txt = textOf(node);

  assert.equal($(node, ".wf-fl-elapsed").length, 0, "no elapsed chip");
  assert.ok(!/on the clock/i.test(txt));
  // No h:mm anywhere in the station column. The top bar's wall clock is time
  // of day and lives outside it, so the check is scoped to the columns.
  const columns = $(node, ".wf-fl-col").map(textOf).join(" ");
  assert.ok(!/\d+:\d\d/.test(columns), "no duration rendered: " + columns);
  assert.ok(!/hours?\b|\bmins?\b|elapsed/i.test(columns));

  // What they do get.
  assert.match(columns, /In progress/);
  assert.match(columns, /40%\s*running/);
  assert.match(columns, /Station #1/);
});

test("a manager gets the clock, the summary strip and station setup", async () => {
  const env = boot({
    role: "manager",
    saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true, pct: 40 })]
  });
  const node = await render(env, 1280);

  const chips = $(node, ".wf-fl-elapsed");
  assert.equal(chips.length, 1);
  assert.match(textOf(chips[0]), /on the clock\s*1:\d\d/);
  assert.equal(chips[0].getAttribute("data-card"), "B");

  assert.equal($(node, ".wf-fl-sum").length, 1, "summary strip");
  // Station setup is a gear now, not a text button wedged beside Refresh --
  // it was the first thing a manager needs and it looked like a filter.
  //
  // TWO of them since the bench pin landed, and they are told apart by title
  // rather than by position: this used to assert a count of one and index [0],
  // so adding the pin button beside it both failed here and silently re-aimed
  // the station-setup test at the wrong dialog.
  const gears = $(node, ".wf-fl-gear");
  assert.equal(gears.length, 2, "pin and station setup");
  assert.deepEqual(gears.map((g) => g.getAttribute("title")),
    ["Pin this tablet to one station", "Station setup"]);
});

test("a worker gets no summary strip and no station setup", async () => {
  const env = boot({ role: "worker", saved: ONE_STATION, cards: [] });
  const node = await render(env, 1280);
  assert.equal($(node, ".wf-fl-sum").length, 0);
  assert.equal($(node, ".wf-fl-gear").length, 0, "no station setup for the shop");
});

test("the grid lays out to the screen it's on", async () => {
  const wide = boot({ role: "worker", cards: [] });
  const w = await render(wide, 1920);
  assert.equal(w.querySelector(".wf-fl-grid").style.gridTemplateColumns,
    "repeat(4,minmax(0,1fr))", "shop TV shows all four");

  const phone = boot({ role: "worker", cards: [] });
  const p = await render(phone, 390);
  assert.equal(p.querySelector(".wf-fl-grid").style.gridTemplateColumns,
    "repeat(1,minmax(0,1fr))", "phone shows one");
});

test("the job number leads when the card has one, the name when it doesn't", async () => {
  const env = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true, name: "#2412 — Cedar Hills fence run A" })]
  });
  const node = await render(env, 1280);
  assert.equal(textOf(node.querySelector(".wf-fl-num")), "#2412");
  assert.match(textOf(node.querySelector(".wf-fl-job")), /Cedar Hills fence run A/);

  const plain = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true, name: "Cedar Hills fence run A" })]
  });
  const n2 = await render(plain, 1280);
  assert.equal(textOf(n2.querySelector(".wf-fl-num")), "Cedar Hills fence run A");
  assert.equal(n2.querySelector(".wf-fl-job"), null, "no invented number line");
});

test("a late queued job is called out; an empty queue says what it's waiting on", async () => {
  const env = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("C", "LA", { pos: 10, due: iso(-3), name: "Overdue rail" })]
  });
  const node = await render(env, 1280);
  const tile = node.querySelector(".wf-fl-t");
  assert.ok(tile.classList.contains("is-late"));
  assert.match(textOf(tile), /was due/);
  assert.match(textOf(node), /Open/);
  assert.match(textOf(node), /Assign a job to this station/);

  const empty = boot({ role: "worker", saved: ONE_STATION, cards: [] });
  const n2 = await render(empty, 1280);
  assert.match(textOf(n2), /Nothing waiting in Assemble Legacy/);
});

test("Next up shows exactly two, side by side, with the rest behind a link", async () => {
  // Two, not three, and never a scrolling stack: this answers "what am I
  // building after this one". A third tile only shrinks the two that matter,
  // and anything past that is the Full queue's job.
  const env = boot({
    role: "worker",
    saved: ONE_STATION,
    cards: [
      job("A", "LA", { pos: 10, name: "#2431 Cedar Hills HOA — fence run B" }),
      job("B", "LA", { pos: 20, name: "#2455 Alpine Fab — trailer deck" }),
      job("C", "LA", { pos: 30, name: "#2470 Lehi Storage — cantilever" }),
      job("D", "LA", { pos: 40, name: "#2488 Nielsen — deck rail" })
    ]
  });
  const node = await render(env, 1280);

  const tiles = $(node, ".wf-fl-q button.wf-fl-t");
  assert.equal(tiles.length, 2);
  assert.match(textOf(tiles[0]), /#2431/);
  assert.match(textOf(tiles[1]), /#2455/);

  // The job number leads and the position stays small -- the number is what a
  // welder recognises from across the shop.
  assert.equal($(tiles[0], ".wf-fl-t-num")[0].textContent, "#2431");
  assert.equal($(tiles[0], ".wf-fl-t-p")[0].textContent, "01");
  assert.ok(!/#2431/.test($(tiles[0], ".wf-fl-t-n")[0].textContent),
    "the number is not repeated in the title");

  assert.match(textOf(node), /\+ 2 more waiting/);
});

test("a queued job with no number in its name still reads", async () => {
  const env = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("A", "LA", { pos: 10, name: "Overdue rail" })]
  });
  const node = await render(env, 1280);
  const tile = $(node, ".wf-fl-q button.wf-fl-t")[0];
  // Nothing worth reading on the top line, so the name takes the headline
  // rather than being demoted under an empty one.
  assert.equal($(tile, ".wf-fl-t-num").length, 0);
  assert.match($(tile, ".wf-fl-t-n")[0].textContent, /Overdue rail/);
});

test("a station with no phase says so instead of rendering an empty column", async () => {
  const env = boot({
    role: "worker",
    saved: { stations: [{ id: "s4", area: "shop", table: "Station #4",
                          station: "Laser bay", welder: "", phase: "" }],
             visible: ["s4"] },
    cards: [job("C", "LA")]
  });
  const node = await render(env, 1280);
  assert.match(textOf(node), /Not set up/);
  assert.match(textOf(node), /No phase set/);
});

test("switching areas keeps you there, and the finishing bay reads its own stations", async () => {
  const env = boot({
    role: "worker",
    cards: [job("S", "LS", { claimed: KEV, running: true })]
  });
  const node = await render(env, 1920);
  assert.match(textOf(node.querySelector(".wf-fl-area")), /Main shop/);

  const fin = $(node, ".wf-fl-tab").find((b) => /Finishing bay/.test(textOf(b)));
  fin.dispatchEvent(new env.win.Event("click"));

  const view = env.win.document.getElementById("view");
  assert.match(textOf(view.querySelector(".wf-fl-area")), /Finishing bay/);
  const names = $(view, ".wf-fl-name").map(textOf);
  // Two benches, not four: the finishing bay is blast then powder, and both of
  // them pull the one "Sandblast / Powder Coat" column.
  assert.deepEqual(names, ["Blast booth", "Powder booth"]);
});

test("saving stations writes config and nothing else", async () => {
  const env = boot({ role: "manager", saved: ONE_STATION, cards: [] });
  const node = await render(env, 1280);
  gear(node, "Station setup").dispatchEvent(new env.win.Event("click"));
  // The dialog waits for the checklist library before it paints, so that a
  // dropdown doesn't fill in after somebody has already looked at it.
  await new Promise((r) => setTimeout(r, 0));

  const doc = env.win.document;
  const selects = $(doc, "select");
  assert.ok(selects.length >= 4, "kind, phase, person, screen");

  $(doc, "button").find((b) => textOf(b) === "Save")
    .dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(env.written.some((w) => w[0] === "wfStations"), "the station config");
  // Saving also persists each station's QC checklist, which is edited in the
  // same dialog -- one trip for the manager, several small writes underneath.
  assert.ok(env.written.every((w) => w[0] === "wfStations" || w[0] === "wfQcChecklists"),
    "nothing but configuration is written");
  assert.equal(env.written[0][0], "wfStations", "and it's configuration");
  assert.ok(Array.isArray(env.written[0][1].stations));
});

/* ================================================= the card, inside the column */

test("a running job shows the three icon buttons, with the card one live", async () => {
  const env = boot({
    role: "worker",
    saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true, pct: 40 })]
  });
  const node = await render(env, 1280);

  const icons = $(node, ".wf-fl-ic");
  assert.equal(icons.length, 3, "assign, QC, card");
  icons.forEach((b) => assert.equal(b.disabled, false, "all three are live"));
  assert.match(icons[0].getAttribute("title"), /assign/i);
  assert.match(icons[1].getAttribute("title"), /QC/i);
  assert.match(icons[2].getAttribute("title"), /card/i);
});

test("an idle station draws no icon row", async () => {
  const env = boot({ role: "worker", saved: ONE_STATION, cards: [] });
  const node = await render(env, 1280);
  assert.equal($(node, ".wf-fl-ic").length, 0);
});

test("each column can be found again by station id", async () => {
  const env = boot({
    role: "worker",
    saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  const node = await render(env, 1280);
  // Without this hook, opening a card would have to repaint the whole floor.
  assert.equal($(node, '[data-station="s1"]').length, 1);
});

test("the cover is the card's image, never cropped", async () => {
  const env = boot({
    role: "worker",
    saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  const node = await render(env, 1280);
  await new Promise((r) => setTimeout(r, 0));

  const img = $(node, ".wf-fl-cover img");
  assert.equal(img.length, 1);
  assert.equal(img[0].getAttribute("src"), "https://x/drawing.png");
  // The station itself is drawn whether or not the picture ever arrives -- the
  // two tests below are the ones that hold that line.
  assert.match(textOf(node), /Station #1/);
});

test("a card with no picture never draws a frame at all", async () => {
  /* Not "removes it afterwards" -- never draws it. The old version appended an
   * empty grey frame immediately and deleted it when no cover came back, so a
   * card without one flashed a box and then collapsed, on every repaint. That
   * flicker is what looked like the preview disappearing. */
  const env = boot({
    role: "worker",
    saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  env.win.WFRest.getCardDetail = () => Promise.resolve({ id: "B", attachments: [] });
  const node = await render(env, 1280);

  // Before the fetch resolves, and after: no frame either way.
  assert.equal($(node, ".wf-fl-cover").length, 0, "nothing drawn up front");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal($(node, ".wf-fl-cover").length, 0);
});

test("a station still draws when the card can't be read at all", async () => {
  const env = boot({
    role: "worker",
    saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true, pct: 40 })]
  });
  // The shape a stripped-down or broken WFRest takes: the method isn't there.
  delete env.win.WFRest.getCardDetail;
  const node = await render(env, 1280);
  await new Promise((r) => setTimeout(r, 0));
  assert.match(textOf(node), /Station #1/);
  assert.match(textOf(node), /40%/);
  assert.equal($(node, ".wf-fl-cover").length, 0);
});

test("the card view takes over the column and the X gives it back", async () => {
  const env = boot({
    role: "worker",
    saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true, pct: 40 })]
  });
  const node = await render(env, 1280);
  let col = $(node, '[data-station="s1"]')[0];

  $(node, ".wf-fl-ic")[2].dispatchEvent(new env.win.Event("click"));
  // The column is replaced, not mutated, so re-find it.
  col = $(node, '[data-station="s1"]')[0];
  assert.ok(col.classList.contains("is-card"));
  assert.equal($(col, ".wf-cp").length, 1, "the card panel is in the column");
  assert.ok(!/40% complete/.test(textOf(col)), "the station view is put away");

  // The mockup's rule: the X returns to Station without leaving the column.
  $(col, ".wf-cp-x")[0].dispatchEvent(new env.win.Event("click"));
  col = $(node, '[data-station="s1"]')[0];
  assert.ok(!col.classList.contains("is-card"));
  assert.match(textOf(col), /40%/);
  assert.match(textOf(col), /Station #1/);
});

test("a queued job opens its own card in the same column", async () => {
  const env = boot({
    role: "worker",
    saved: ONE_STATION,
    cards: [
      job("B", "LA", { claimed: KEV, running: true }),
      job("Q", "LA", { pos: 10, name: "#2444 Provo Canyon — handrail run" })
    ]
  });
  const node = await render(env, 1280);
  const tiles = $(node, "button.wf-fl-t");
  assert.equal(tiles.length, 1, "the queue tile is a button now");

  tiles[0].dispatchEvent(new env.win.Event("click"));
  const col = $(node, '[data-station="s1"]')[0];
  /* Tapping a queued job OPENS it -- on a busy station as much as on an open
   * one. It used to ask "pause this and start that?", which is a question
   * about starting work put to somebody who has only tapped to read. */
  assert.ok(col.classList.contains("is-card"), "the card panel took the column");
  assert.equal($(col, ".wf-cp").length, 1);
  assert.ok(!/Pause .* and start/.test(textOf(env.win.document.body)),
    "no dialog: looking is not a decision");
  assert.equal(env.written.length, 0, "and nothing was written");
});

/* ========================================== one view at a time, in the column */

test("opening a view replaces the station and the X gives it back", async () => {
  const env = boot({
    role: "worker",
    saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true, pct: 40 })]
  });
  const node = await render(env, 1280);

  // QC is the second icon.
  $(node, ".wf-fl-ic")[1].dispatchEvent(new env.win.Event("click"));
  let col = $(node, '[data-station="s1"]')[0];
  assert.match(textOf(col), /QC checklist/);
  assert.ok(!/Now building/.test(textOf(col)), "the station view is put away, not pushed down");

  $(col, ".wf-fl-vx")[0].dispatchEvent(new env.win.Event("click"));
  col = $(node, '[data-station="s1"]')[0];
  assert.match(textOf(col), /Now building/);
  assert.ok(!/QC checklist/.test(textOf(col)));
});

test("only one view is ever open in a column", async () => {
  const env = boot({
    role: "worker",
    saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  const node = await render(env, 1280);

  $(node, ".wf-fl-ic")[0].dispatchEvent(new env.win.Event("click"));   // assign
  let col = $(node, '[data-station="s1"]')[0];
  assert.match(textOf(col), /Assign to/);

  $(node, '[data-station="s1"]');
  // There is no arrangement in which two of these should be on screen at once.
  assert.equal($(col, ".wf-fl-vh-t").length, 1);
});

test("one column's view doesn't disturb its neighbour", async () => {
  const env = boot({
    role: "worker",
    saved: {
      stations: [
        { id: "s1", area: "shop", table: "Station #1", station: "Welding", welder: "kevinmoss", phase: "Assemble Legacy" },
        { id: "s2", area: "shop", table: "Station #2", station: "Welding", welder: "scottv", phase: "Assemble CAP" }
      ],
      visible: ["s1", "s2"]
    },
    cards: [
      job("B", "LA", { claimed: KEV, running: true }),
      job("C", "LB", { claimed: SCOTT, running: true })
    ]
  });
  const node = await render(env, 1280);

  $($(node, '[data-station="s1"]')[0], ".wf-fl-ic")[1]
    .dispatchEvent(new env.win.Event("click"));

  assert.match(textOf($(node, '[data-station="s1"]')[0]), /QC checklist/);
  assert.match(textOf($(node, '[data-station="s2"]')[0]), /Now building/);
});

/* ================================================ start, stop, percent, gate */

test("the percent slider is there for a claimed job and absent otherwise", async () => {
  const claimed = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true, pct: 40 })]
  });
  assert.equal($(await render(claimed, 1280), ".wf-fl-slider").length, 1);

  const open = boot({ role: "worker", saved: ONE_STATION, cards: [job("C", "LA")] });
  assert.equal($(await render(open, 1280), ".wf-fl-slider").length, 0);
});

test("Start and Stop read the job's real state", async () => {
  const running = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  assert.match(textOf(await render(running, 1280), ), /Stop/);

  const paused = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV })]
  });
  assert.match(textOf(await render(paused, 1280)), /Start/);
});

test("Complete is an outline button until QC is signed, solid after", async () => {
  const unsigned = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  let node = await render(unsigned, 1280);
  let done = $(node, ".wf-fl-done")[0];
  assert.ok(!done.classList.contains("is-on"), "not signed, not green");

  const card = job("B", "LA", { claimed: KEV, running: true });
  card.qcRecord = {
    listId: "LA", status: "passed", signedAt: new Date().toISOString(),
    signature: "Kevin Moss", signedBy: KEV
  };
  const signed = boot({ role: "worker", saved: ONE_STATION, cards: [card] });
  node = await render(signed, 1280);
  done = $(node, ".wf-fl-done")[0];
  assert.ok(done.classList.contains("is-on"), "signed, green");
  assert.equal($(node, ".wf-fl-ic")[1].className.indexOf("is-passed") > -1, true,
    "and the QC icon says so from across the shop");
});

test("Complete on an unsigned job opens the checklist rather than refusing", async () => {
  // The forced checklist IS the gate. Refusing would teach the shop to avoid
  // the button; opening it teaches them what the button needs.
  const env = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  const node = await render(env, 1280);
  $(node, ".wf-fl-done")[0].dispatchEvent(new env.win.Event("click"));

  const col = $(node, '[data-station="s1"]')[0];
  assert.match(textOf(col), /QC checklist/);
  assert.equal(env.written.length, 0, "and nothing was written");
});

test("the checklist carries its tolerances and starts unticked", async () => {
  const env = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  const node = await render(env, 1280);
  $(node, ".wf-fl-ic")[1].dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));

  const col = $(node, '[data-station="s1"]')[0];
  const rows = $(col, ".wf-fl-ck");
  assert.ok(rows.length >= 5, "the shipped Assemble draft");
  assert.ok(rows.every((r) => !r.classList.contains("is-on")), "nothing pre-ticked");
  assert.ok($(col, ".wf-fl-ck-s").length >= 1, "tolerances under the lines");
  assert.match(textOf(col), /items remaining/);
});

test("check all ticks the lot, and clear all puts it back", async () => {
  const env = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  const node = await render(env, 1280);
  $(node, ".wf-fl-ic")[1].dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));

  let col = $(node, '[data-station="s1"]')[0];
  const total = $(col, ".wf-fl-ck").length;
  assert.ok(total >= 5);

  // Somebody who has built the same gate four hundred times shouldn't have to
  // tap ten boxes they already know the answer to.
  $(col, ".wf-fl-allrow button")[0].dispatchEvent(new env.win.Event("click"));
  col = $(node, '[data-station="s1"]')[0];
  assert.equal($(col, ".wf-fl-ck.is-on").length, total, "all ticked");
  assert.match(textOf(col), new RegExp(total + " of " + total + " checked"));

  // And an accidental tap isn't ten taps to undo.
  const clear = $(col, ".wf-fl-allrow button")[0];
  assert.match(textOf(clear), /Clear all/);
  clear.dispatchEvent(new env.win.Event("click"));
  col = $(node, '[data-station="s1"]')[0];
  assert.equal($(col, ".wf-fl-ck.is-on").length, 0);
});

/* ===================================================== the fault path, on screen
 *
 * The whole third state lived in lib/qc.js coverage and nothing rendered it.
 * Every assertion below is about the screen a welder is actually looking at:
 * the box cycles to a third state, that state demands a sentence, and nothing
 * can be signed while it is showing. A fault path whose UI silently stops
 * offering the fail state is a fault path that does not exist, and the library
 * tests would all still be green.
 */

test("a checklist box cycles to failed, and a failed line demands a sentence", async () => {
  const env = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  const node = await render(env, 1280);
  $(node, ".wf-fl-ic")[1].dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));

  const click = (el) => el.dispatchEvent(new env.win.Event("click"));
  const col = () => $(node, '[data-station="s1"]')[0];

  // untouched -> pass
  click($(col(), ".wf-fl-ck .wf-fl-box")[0]);
  assert.equal($(col(), ".wf-fl-ck.is-on").length, 1, "first tap passes the line");
  assert.equal($(col(), ".wf-fl-ck.is-bad").length, 0);

  // pass -> fail. THE STATE THE FEATURE EXISTS FOR.
  click($(col(), ".wf-fl-ck .wf-fl-box")[0]);
  assert.equal($(col(), ".wf-fl-ck.is-bad").length, 1, "second tap marks it wrong");
  assert.equal($(col(), ".wf-fl-ck.is-on").length, 0, "and it is no longer a pass");

  const note = $(col(), ".wf-fl-ck.is-bad input.wf-fl-input")[0];
  assert.ok(note, "failing a line opens a box asking what is wrong");
  assert.match(note.placeholder, /what's wrong/i);

  // A fault nobody described teaches nobody anything, so it cannot be recorded.
  const btn = () => $(col(), "[data-fault-btn]")[0];
  assert.ok(btn(), "the way out appears as soon as a line is failed");
  assert.equal(btn().disabled, true, "but not until the fault has been described");

  note.value = "twisted 3mm across the diagonal";
  note.dispatchEvent(new env.win.Event("input"));
  assert.equal(btn().disabled, false, "described, so it can be recorded");
  assert.equal(env.written.length, 0, "and none of this wrote anything yet");

  // fail -> untouched, and the question goes away with it.
  click($(col(), ".wf-fl-ck .wf-fl-box")[0]);
  assert.equal($(col(), ".wf-fl-ck.is-bad").length, 0, "third tap clears it");
  assert.equal($(col(), ".wf-fl-ck.is-on").length, 0);
  assert.equal($(col(), "[data-fault-btn]").length, 0);
});

test("nothing signs while a line is marked wrong, however complete the rest is", async () => {
  /* THE GATE, ISOLATED SO IT CAN ONLY PASS FOR ITS OWN REASON.
   *
   * Asserting "the sign button is disabled" on a half-worked list proves
   * nothing -- it was disabled before the fault path existed, because not every
   * line was ticked. So this drives the checklist into the one state where the
   * failed map is the ONLY thing left in the way: every box ticked (Check all
   * ticks the failed line too), a name typed, a signer chosen. Delete the
   * countFailed guard in canSignOff and this is the test that notices. */
  const env = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  const node = await render(env, 1280);
  $(node, ".wf-fl-ic")[1].dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));

  const col = () => $(node, '[data-station="s1"]')[0];
  const click = (el) => el.dispatchEvent(new env.win.Event("click"));

  click($(col(), ".wf-fl-ck .wf-fl-box")[0]);   // pass
  click($(col(), ".wf-fl-ck .wf-fl-box")[0]);   // fail
  assert.equal($(col(), ".wf-fl-ck.is-bad").length, 1);

  click($(col(), ".wf-fl-allrow button")[0]);   // "Check all"
  assert.equal($(col(), ".wf-fl-ck.is-bad").length, 1,
    "a bulk tick does not quietly un-say that something is wrong");

  const sig = $(col(), ".wf-fl-panel input.wf-fl-input")[0];
  sig.value = "Kevin Moss";
  sig.dispatchEvent(new env.win.Event("input"));
  const who = $(col(), ".wf-fl-sel")[0];
  who.value = "kevinmoss";
  who.dispatchEvent(new env.win.Event("change"));

  const signBtn = $(col(), ".wf-fl-panel button.wf-fl-done")[0];
  assert.equal(signBtn.disabled, true,
    "everything ticked and signed, and it still will not go: a line is wrong");
  assert.match(textOf(col()), /marked wrong/i, "and the hint says that is why");
  assert.equal(env.written.length, 0);
});

test("recording the fault writes the note against the round and moves nothing", async () => {
  const env = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  const node = await render(env, 1280);
  $(node, ".wf-fl-ic")[1].dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));

  const col = () => $(node, '[data-station="s1"]')[0];
  const click = (el) => el.dispatchEvent(new env.win.Event("click"));
  // Re-queried between taps: each tap repaints the column, so the node from
  // before the repaint is detached and clicking it again replays the OLD state.
  click($(col(), ".wf-fl-ck .wf-fl-box")[0]);
  click($(col(), ".wf-fl-ck .wf-fl-box")[0]);

  const note = $(col(), ".wf-fl-ck.is-bad input.wf-fl-input")[0];
  note.value = "twisted 3mm across the diagonal";
  note.dispatchEvent(new env.win.Event("input"));
  click($(col(), "[data-fault-btn]")[0]);
  await new Promise((r) => setTimeout(r, 0));

  const rec = env.store.qcRecord;
  assert.ok(rec, "the fault landed on the card");
  assert.equal(rec.status, "awaiting_correction");
  assert.equal(rec.rounds[0].results[0], "fail");
  assert.equal(rec.rounds[0].notes[0], "twisted 3mm across the diagonal");
  assert.ok(!rec.signature, "a round that found a fault is not a signature");
  assert.ok(rec.rounds[0].results.slice(1).every((r) => r === "pass"),
    "and every other line went in as it was left");
});

test("an open fault takes over the station: no blank checklist, no Complete", async () => {
  /* A job with something wrong recorded against it must not be offered a fresh
   * list to tick -- that is how a fault gets quietly checked over the top of.
   * And Complete has to take you to what is in the way rather than refuse. */
  const card = job("B", "LA", { claimed: KEV, running: true });
  card.qcRecord = {
    listId: "LA", phase: "Assemble Legacy", mode: "floor", status: "awaiting_correction",
    template: [{ text: "Frame is square", spec: "diagonals within 1/8\"" }],
    // foundBy is what separates a fault somebody raised from an unticked
    // self-check line, which is also stored as "fail". Without it this round
    // is not a fault round and the station is right to show a clean list.
    rounds: [{ n: 1, results: ["fail"], notes: { 0: "twisted 3mm across the diagonal" },
               foundBy: { id: "k", username: "kevinmoss", fullName: "Kevin Moss" },
               checkedAt: new Date().toISOString() }]
  };
  const env = boot({ role: "worker", saved: ONE_STATION, cards: [card] });
  const node = await render(env, 1280);
  let col = $(node, '[data-station="s1"]')[0];

  // Visible from ten feet away, before the screen is even opened.
  assert.equal($(col, ".wf-fl-ic.is-bad").length, 1, "the QC icon goes red");
  const done = $(col, "button.wf-fl-done")[0];
  assert.match(textOf(done), /! 1 fault/, "Complete becomes the fault count");
  assert.ok(done.classList.contains("is-bad"));

  // And pressing it opens the fault rather than completing anything.
  done.dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));
  col = $(node, '[data-station="s1"]')[0];
  assert.match(textOf(col), /1 fault is open on this job/);
  assert.match(textOf(col), /twisted 3mm across the diagonal/, "with what was wrong");
  assert.equal($(col, ".wf-fl-ck .wf-fl-box").length, 0,
    "and no blank checklist to tick over the top of it");
  assert.ok($(col, 'input[placeholder="What did you do about it?"]')[0],
    "the only thing on offer is an answer");
  assert.equal(env.written.length, 0, "nothing was written by looking");
});

test("only a manager gets the edit-this-list control", async () => {
  const mk = (role) => boot({
    role, saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });

  for (const [role, expected] of [["worker", 1], ["manager", 2]]) {
    const env = mk(role);
    const node = await render(env, 1280);
    $(node, ".wf-fl-ic")[1].dispatchEvent(new env.win.Event("click"));
    await new Promise((r) => setTimeout(r, 0));
    const col = $(node, '[data-station="s1"]')[0];
    assert.equal($(col, ".wf-fl-allrow button").length, expected,
      role + " sees the right controls");
  }
});

test("the view names which checklist it is working", async () => {
  // A station picking up the wrong list by name-match is the one failure of the
  // library a person spots instantly and the code never can.
  const env = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  const node = await render(env, 1280);
  $(node, ".wf-fl-ic")[1].dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));
  assert.match(textOf($(node, '[data-station="s1"]')[0]), /checklist|shipped draft/i);
});

test("a job already signed shows the stamp instead of the checklist", async () => {
  const card = job("B", "LA", { claimed: KEV, running: true });
  card.qcRecord = {
    listId: "LA", status: "passed", signedAt: new Date().toISOString(),
    signature: "Kevin Moss", signedBy: SCOTT,
    rounds: [{ items: [{ text: "Frame is square", spec: "Diagonals within 1/8″" }] }]
  };
  const env = boot({ role: "worker", saved: ONE_STATION, cards: [card] });
  const node = await render(env, 1280);
  $(node, ".wf-fl-ic")[1].dispatchEvent(new env.win.Event("click"));

  const col = $(node, '[data-station="s1"]')[0];
  assert.match(textOf(col), /QC passed/);
  assert.match(textOf(col), /Scott VanWorkom/, "who actually looked at it");
});

/* ------------------------------------ a signature belongs to a bench, not a list
 *
 * qcRecord is keyed per card per LIST and the two finishing booths share one.
 * Asking the bare question got the powder booth the BLAST booth's signature:
 * it skipped its own checklist and offered to pass the job on, showing
 * somebody else's name as the checker. Powder coat could ship with no powder
 * QC at all and the record would look immaculate. Every read of a sign-off on
 * this screen goes through signedHere(), which resolves the station's step
 * first -- these two tests are what keeps that true.
 */
const BOOTHS = {
  stations: [
    { id: "f1", area: "finishing", table: "Blast booth", type: "blast",
      welder: "kevinmoss", phase: "Sandblast / Powder Coat" },
    { id: "f2", area: "finishing", table: "Powder booth", type: "powder",
      welder: "scottv", phase: "Sandblast / Powder Coat" }
  ],
  visible: ["f1", "f2"]
};

/** Render, then switch to the Finishing bay screen the way a person would. */
async function finishing(env) {
  const node = await render(env, 1280);
  $(node, ".wf-fl-tab")
    .find((b) => /finishing/i.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));
  return node;
}

test("the powder booth does not inherit the blast booth's sign-off", async () => {
  // Blasted, so the job is the powder booth's now, and carrying the blast
  // booth's signed record -- same card, same list, same qcRecord key.
  const card = job("B", "LS", { claimed: SCOTT, running: true });
  card.labelNames = ["Blasted"];
  card.qcRecord = {
    listId: "LS", status: "passed", mode: "floor", stepId: "blast",
    signedAt: new Date().toISOString(),
    signature: "Kevin Moss", signedBy: KEV,
    rounds: [{ stepId: "blast", items: [{ text: "Profile fully stripped", spec: "" }] }]
  };
  const env = boot({ role: "worker", saved: BOOTHS, cards: [card] });
  const node = await finishing(env);

  const col = $(node, '[data-station="f2"]')[0];
  assert.ok(col, "the powder booth has the job, because it is blasted");
  $(col, ".wf-fl-ic")[1].dispatchEvent(new env.win.Event("click"));

  const text = textOf($(node, '[data-station="f2"]')[0]);
  assert.doesNotMatch(text, /QC passed/,
    "the powder booth sees no signature, because nobody has checked the powder");
  assert.doesNotMatch(text, /Kevin Moss/,
    "and certainly not the blast booth's name presented as its own checker");
  assert.match(text, /checklist|shipped draft/i, "it gets its own list to work");
});

test("the blast booth still sees the signature it took", async () => {
  // Unblasted, so the job is still the blast booth's, and the record is its own.
  const card = job("B", "LS", { claimed: KEV, running: true });
  card.labelNames = [];
  card.qcRecord = {
    listId: "LS", status: "passed", mode: "floor", stepId: "blast",
    signedAt: new Date().toISOString(),
    signature: "Kevin Moss", signedBy: SCOTT,
    rounds: [{ stepId: "blast", items: [{ text: "Profile fully stripped", spec: "" }] }]
  };
  const env = boot({ role: "worker", saved: BOOTHS, cards: [card] });
  const node = await finishing(env);

  const col = $(node, '[data-station="f1"]')[0];
  $(col, ".wf-fl-ic")[1].dispatchEvent(new env.win.Event("click"));

  const text = textOf($(node, '[data-station="f1"]')[0]);
  assert.match(text, /QC passed/, "its own bench's signature still answers");
  assert.match(text, /Scott VanWorkom/, "naming who actually looked at it");
});

test("every sign-off read on the Floor goes through signedHere", () => {
  /* The five call sites were `WFQC.floorSignOff(st.job)` -- the bare question,
   * with no bench in it. A sixth added later that asks the bare question again
   * puts the bug straight back, and it would look like a passing suite. */
  const src = read("popups/tabs/floor.js");
  assert.match(src, /function signedHere\s*\(st\)/, "the helper exists");
  const bare = src.match(/WFQC\.floorSignOff\s*\(/g) || [];
  assert.equal(bare.length, 1,
    "exactly one call to floorSignOff in this file, and it is the one inside " +
    "signedHere that resolves the station's step first");
  assert.match(src, /stepForStation\(st\.phase,\s*st\.station\.type\)/,
    "and it resolves the step from the station it is standing at");
});

/* ================================================================== assign */

test("Complete on a signed job asks before it ships, naming where it goes", async () => {
  const card = job("B", "LA", { claimed: KEV, running: true });
  card.qcRecord = {
    listId: "LA", status: "passed", signedAt: new Date().toISOString(),
    signature: "Kevin Moss", signedBy: SCOTT
  };
  const env = boot({ role: "worker", saved: ONE_STATION, cards: [card] });
  const node = await render(env, 1280);

  $(node, ".wf-fl-done")[0].dispatchEvent(new env.win.Event("click"));

  const body = textOf(env.win.document.body);
  assert.match(body, /Mark .* complete\?/);
  assert.match(body, /Scott VanWorkom/, "who signed it");
  assert.equal(env.written.length, 0, "and nothing moves until they answer");
});

test("the icons are drawn, not typed", async () => {
  // A glyph is at the mercy of whichever font the TV falls back to -- "⇲" read
  // as an arrow into a corner, not as a person.
  const env = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  const node = await render(env, 1280);
  const icons = $(node, ".wf-fl-ic");
  assert.equal(icons.length, 3);
  icons.forEach((b) => assert.equal(b.querySelectorAll("svg").length, 1, "an svg, not a character"));
  // The assign icon is a head and shoulders.
  assert.ok($(icons[0], "path").length >= 3, "person plus a plus");
});

/* ============================================================== the due date */

test("whoever schedules can move a due date from the station; a welder cannot", async () => {
  const late = job("B", "LA", { claimed: KEV, running: true, due: iso(-3) });

  const boss = boot({ role: "manager", saved: ONE_STATION, cards: [late] });
  let node = await render(boss, 1280);
  const btn = $(node, ".wf-fl-due")[0];
  assert.ok(btn, "a late job can be rescheduled from the floor");
  assert.ok(btn.classList.contains("is-late"));

  // A due date is a promise somebody else is planning around. A welder can see
  // it has gone red and say so; they can't quietly buy themselves a week.
  const hand = boot({ role: "worker", saved: ONE_STATION, cards: [late] });
  node = await render(hand, 1280);
  assert.equal($(node, ".wf-fl-due").length, 0);
  assert.match(textOf(node), /was due/);
});

test("the reschedule dialog pushes from today, not from the date it missed", async () => {
  const env = boot({
    role: "manager", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true, due: iso(-30) })]
  });
  const node = await render(env, 1280);
  $(node, ".wf-fl-due")[0].dispatchEvent(new env.win.Event("click"));

  const doc = env.win.document;
  assert.match(textOf(doc.body), /Past due/);
  const quick = $(doc, "button").find((b) => textOf(b) === "+1 week");
  assert.ok(quick, "the realistic answer is usually a few days");
  quick.dispatchEvent(new env.win.Event("click"));

  const picker = $(doc, 'input[type="datetime-local"]')[0];
  // A month past due, +1 week must land next week -- not three weeks ago.
  assert.ok(new Date(picker.value).getTime() > Date.now(), "in the future");
});

/* ================================================================== assign */

test("assign offers the phase's unstationed jobs, not somebody else's queue", async () => {
  const mine = job("Q", "LA", { pos: 10, name: "#2444 free job" });
  const theirs = job("R", "LA", { pos: 20, name: "#2455 on another bench" });
  theirs.phaseWork = { listId: "LA", claimedBy: null, segments: [], tableId: "s9" };

  const env = boot({ role: "worker", saved: ONE_STATION, cards: [mine, theirs] });
  const node = await render(env, 1280);
  $(node, ".wf-fl-assign")[0].dispatchEvent(new env.win.Event("click"));

  const col = $(node, '[data-station="s1"]')[0];
  assert.match(textOf(col), /#2444 free job/);
  assert.ok(!/on another bench/.test(textOf(col)),
    "taking a job off someone else's bench without telling them is not assigning");
});

/* =========================================== looking is free, taking is not
 *
 * THE TRAP THESE EXIST FOR. A tap on a queue tile used to call requestStart:
 * on an open bench it started the clock on the spot, on a busy one it offered
 * to pause the job in the welder's hands. Either way a welder reading the
 * queue to decide what to pick up was making a decision about time by looking.
 * A tap now opens the job and writes nothing; the footer button is the only
 * thing on this screen that starts a clock.
 */

test("tapping a queued job opens a preview and writes nothing", async () => {
  const env = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("Q", "LA", { pos: 10 })]
  });
  const claims = spyClaims(env);
  const node = await render(env, 1280);
  assert.match(textOf(node), /Tap a job to look at it/, "the hint invites reading");

  $(node, "button.wf-fl-t")[0].dispatchEvent(new env.win.Event("click"));
  const col = $(node, '[data-station="s1"]')[0];
  assert.ok(col.classList.contains("is-card"), "the job opened");
  assert.match(textOf(col), /Before you start/);
  assert.equal(env.written.length, 0, "looking records nothing");
  assert.equal(claims.length, 0, "and claims nobody");
  assert.equal(textOf(env.win.document.body).match(/Pause .* and start/), null,
    "and asks nothing");
});

test("the preview's own button is what starts the job", async () => {
  const env = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("Q", "LA", { pos: 10 })]
  });
  const claims = spyClaims(env);
  const node = await render(env, 1280);
  $(node, "button.wf-fl-t")[0].dispatchEvent(new env.win.Event("click"));
  await settle(env);

  const btn = footBtn($(node, '[data-station="s1"]')[0]);
  assert.ok(btn, "the preview carries a button");
  assert.match(textOf(btn), /Start this job/);

  btn.dispatchEvent(new env.win.Event("click"));
  await settle(env);
  assert.equal(claims.length, 1, "THAT starts the clock");
  assert.equal(claims[0].card, "Q");
});

test("on a busy bench the preview's button says what it will put down, and asks", async () => {
  const busyEnv = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true, pct: 65 }), job("Q", "LA", { pos: 10 })]
  });
  const node = await render(busyEnv, 1280);

  $(node, "button.wf-fl-t")[0].dispatchEvent(new busyEnv.win.Event("click"));
  assert.equal(busyEnv.written.length, 0, "the tap alone still writes nothing");
  await settle(busyEnv);

  const btn = footBtn($(node, '[data-station="s1"]')[0]);
  assert.match(textOf(btn), /Put down .* and start this/);

  btn.dispatchEvent(new busyEnv.win.Event("click"));
  const body = textOf(busyEnv.win.document.body);
  assert.match(body, /Pause .* and start/);
  // The percentage has to be in the question: silently pausing somebody's work
  // is the kind of surprise that makes a shop stop trusting a screen.
  assert.match(body, /65%/);
  assert.equal(busyEnv.written.length, 0, "nothing happens until they answer");

  /* AND SAYING NO LEAVES THEM AT THEIR BENCH. The preview is torn down when
   * the button is pressed, so the column behind the dialog has to be the
   * station again -- not the assign list, which is what a half-cleared preview
   * fell through to. */
  const col = $(node, '[data-station="s1"]')[0];
  assert.ok(!/Assign to/.test(textOf(col)),
    "changing your mind must not land you in the assign list");
  assert.match(textOf(col), /Station #1/);
});


/* ====================================================== one tablet, one bench
 *
 * The shop is putting a cheap iPad at every bench, running this through
 * Trello's mobile web client. A tablet bolted to Station #2 that shows four
 * columns is a tablet somebody taps the wrong column on with a glove.
 */

/** Two benches, so "one column" means something. */
const TWO_STATIONS = {
  stations: [
    { id: "s1", area: "shop", table: "Station #1", station: "Welding",
      welder: "kevinmoss", phase: "Assemble Legacy" },
    { id: "s2", area: "shop", table: "Station #2", station: "Welding",
      welder: "scottv", phase: "Assemble Legacy" }
  ],
  visible: ["s1", "s2"]
};

const PAGE = "https://wfcustom.github.io/trello-crm-powerup/popups/ops.html";

test("a pinned tablet shows its own bench and nothing else", async () => {
  const env = boot({
    role: "worker", saved: TWO_STATIONS, url: PAGE + "?station=s2",
    cards: [job("B", "LA", { claimed: SCOTT, running: true, pct: 40 })]
  });
  const node = await render(env, 1280);

  // One column, and it is the right one.
  const cols = $(node, ".wf-fl-col");
  assert.equal(cols.length, 1, "one bench, not the shop");
  assert.equal(cols[0].getAttribute("data-station"), "s2");

  // And none of the furniture that only makes sense on a shared screen.
  assert.equal($(node, ".wf-fl-tabs").length, 0, "no area tabs");
  assert.equal($(node, ".wf-fl-sum").length, 0, "no summary strip");
  // The bar names the bench and whoever is rostered to it, so the tablet can
  // be identified from across the shop without opening anything.
  const bar = $(node, ".wf-fl-top")[0];
  assert.match(textOf(bar), /Station #2/);
  assert.match(textOf(bar), /Signed in as scottv/);
  // A single column is laid out as one, whatever the screen is.
  assert.equal(node.querySelector(".wf-fl-grid").style.gridTemplateColumns,
    "minmax(0,1fr)");
});

test("the ?station= form of the pin is read, hash as well as query", async () => {
  // The query string is what a home-screen shortcut carries.
  let env = boot({ role: "worker", saved: TWO_STATIONS,
                   url: PAGE + "?station=s1", cards: [] });
  let node = await render(env, 1280);
  assert.equal($(node, ".wf-fl-col").length, 1);
  assert.equal($(node, ".wf-fl-col")[0].getAttribute("data-station"), "s1");

  // Trello's own iframe URLs carry their arguments after the #, so the hash is
  // searched too -- a pin that only worked in the query string would work on
  // the bare page and silently stop working inside the Power-Up.
  env = boot({ role: "worker", saved: TWO_STATIONS,
               url: PAGE + "#station=s2", cards: [] });
  node = await render(env, 1280);
  assert.equal($(node, ".wf-fl-col")[0].getAttribute("data-station"), "s2");
});

test("a pin naming a bench that no longer exists falls back to the whole shop",
  async () => {
    /* A deleted station must not brick the tablet that was bolted to it, and
       the person standing at that bench is a welder -- the only way back off a
       pin is a manager-only button, so if this fell through to an empty screen
       they would need somebody with a login to come and fix it. */
    const env = boot({
      role: "worker", saved: TWO_STATIONS, url: PAGE + "?station=s9",
      cards: []
    });
    const node = await render(env, 1280);

    assert.equal($(node, ".wf-fl-tabs").length, 1, "the normal view, with its tabs");
    assert.equal($(node, ".wf-fl-col").length, 2, "every station, not none");
    assert.ok(!/Nobody rostered to this bench/.test(textOf(node)),
      "and not the pinned bar with nothing in it");
  });

test("a manager can pin this tablet, and un-pin it again", async () => {
  const env = boot({ role: "manager", saved: TWO_STATIONS, cards: [] });
  const node = await render(env, 1280);
  assert.equal($(node, ".wf-fl-col").length, 2, "not pinned yet");

  gear(node, "Pin this tablet to one station")
    .dispatchEvent(new env.win.Event("click"));
  const doc = env.win.document;
  const sel = $(doc, "select")[0];
  /* Every bench in the config is offered, plus the "not pinned" default --
     including ones this area's grid is not currently showing. Deliberate: a
     manager pinning a tablet is standing at the bench it is bolted to, and
     "the station you want is not in this list because of a screen filter" is
     not an answer anybody can act on. */
  const options = $(sel, "option").map((o) => o.value);
  assert.equal(options[0], "", "not pinned, first");
  assert.ok(options.includes("s1") && options.includes("s2"));
  assert.equal(new Set(options).size, options.length, "no bench listed twice");
  // The permanent link is shown, because it is the only form of the pin that
  // survives a browser clearing its storage.
  sel.value = "s2";
  sel.dispatchEvent(new env.win.Event("change"));
  assert.match(textOf(doc.body), /\?station=s2/);

  $(doc, "button").find((b) => textOf(b) === "Pin it")
    .dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal($(node, ".wf-fl-col").length, 1, "pinned to one bench");
  assert.equal(env.store.wfFloorStation, "s2", "and it survives a reload");

  // Back out again, which is the only reason this device is ever usable for
  // anything else.
  gear(node, "Show every station").dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal($(node, ".wf-fl-col").length, 2);
  assert.equal(env.store.wfFloorStation, undefined, "the pin is gone, not just hidden");
});

test("a pin saved against the member, with no URL and no storage, still pins",
  async () => {
    /* The third place the pin can live. about:blank is an opaque origin, so
       jsdom's localStorage THROWS here exactly as Safari's does inside a
       cross-site iframe -- which is the case this copy exists for. */
    const env = boot({ role: "worker", saved: TWO_STATIONS, cards: [] });
    env.store.wfFloorStation = "s1";
    const node = await render(env, 1280);
    assert.equal($(node, ".wf-fl-col").length, 1);
    assert.equal($(node, ".wf-fl-col")[0].getAttribute("data-station"), "s1");
  });

test("the floor still draws when member-scoped plugin data cannot be read",
  async () => {
    // Trello hands back a rejection for a scope it will not give us; the floor
    // is not allowed to care, because the pin is a convenience and the shop
    // screen is not.
    const env = boot({ role: "worker", saved: TWO_STATIONS, cards: [] });
    const real = env.ctx.t.get;
    env.ctx.t.get = (scope, vis, key, dflt) =>
      scope === "member" ? Promise.reject(new Error("nope"))
                         : real(scope, vis, key, dflt);
    const node = await render(env, 1280);
    assert.equal($(node, ".wf-fl-col").length, 2, "the shop floor, unpinned");
    assert.ok(!/Couldn't read the shop floor/.test(textOf(node)));
  });

/* ============================================= whose name goes on the work
 *
 * A bench tablet is a shared device. Whoever happens to be signed in to it is
 * not the answer to "who built this" -- the person rostered to that bench is.
 */

/** A job sitting on a bench that nobody has claimed: touched, but unowned. */
function unclaimedOnBench(id, station) {
  const c = job(id, "LA", { pos: 10 });
  c.phaseWork = {
    listId: "LA", claimedBy: null, tableId: station,
    segments: [{ start: new Date(Date.now() - 20 * 60000).toISOString(),
                 end: new Date(Date.now() - 5 * 60000).toISOString() }],
    percentComplete: 0
  };
  return c;
}

/** Record who every claim is made for, instead of letting it hit the store. */
function spyClaims(env) {
  const claims = [];
  env.win.WFPhase.claimAndStart = (t, card, member) => {
    claims.push({ card: card.id, member });
    return Promise.resolve({});
  };
  return claims;
}

test("Start claims the job for the bench's welder, not for the tablet's account",
  async () => {
    // Scott is signed in to the tablet bolted to Station #1. Kevin works it.
    const env = boot({
      role: "worker", saved: TWO_STATIONS, me: SCOTT,
      cards: [unclaimedOnBench("B", "s1")]
    });
    const claims = spyClaims(env);
    const node = await render(env, 1280);

    const col = $(node, '[data-station="s1"]')[0];
    $(col, ".wf-fl-btn").find((b) => /Start/.test(textOf(b)))
      .dispatchEvent(new env.win.Event("click"));
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(claims.length, 1);
    assert.equal(claims[0].member.username, "kevinmoss",
      "the rostered welder, not whoever is signed in");
    // And it is the board's own member record, so the claim carries an id that
    // Trello will accept rather than a name scraped off the roster.
    assert.equal(claims[0].member, KEV);
  });

test("a job started from the queue preview claims for the bench's welder too", async () => {
  // Scott is signed in to the tablet bolted to Station #1. Kevin works it.
  const env = boot({
    role: "worker", saved: TWO_STATIONS, me: SCOTT,
    cards: [job("Q", "LA", { pos: 10 })]
  });
  const claims = spyClaims(env);
  const node = await render(env, 1280);

  const col = $(node, '[data-station="s1"]')[0];
  $(col, "button.wf-fl-t")[0].dispatchEvent(new env.win.Event("click"));
  await settle(env);
  assert.equal(claims.length, 0, "the tap itself claims nobody");

  footBtn($(node, '[data-station="s1"]')[0]).dispatchEvent(new env.win.Event("click"));
  await settle(env);

  assert.equal(claims.length, 1, "the preview's button claims as well as Start does");
  assert.equal(claims[0].member.username, "kevinmoss",
    "the rostered welder, not whoever is signed in");
});

test("an unstaffed bench claims for whoever is standing at it", async () => {
  // Nobody rostered. Refusing would leave a welder at a bench with a job on it
  // and no way to begin; an imprecise name beats a job nobody can start.
  const empty = {
    stations: [{ id: "s1", area: "shop", table: "Station #1", station: "Welding",
                 welder: "", phase: "Assemble Legacy" }],
    visible: ["s1"]
  };
  const env = boot({ role: "worker", saved: empty, me: SCOTT,
                     cards: [unclaimedOnBench("B", "s1")] });
  const claims = spyClaims(env);
  const node = await render(env, 1280);

  $(node, ".wf-fl-btn").find((b) => /Start/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(claims.length, 1);
  assert.equal(claims[0].member, SCOTT, "the signed-in member");
});

test("a roster naming somebody who has left the board falls back, never to a stub",
  async () => {
    /* The failure this guards: a welder who left is still typed into the
       station config, so the lookup finds nothing. Claiming for a name rather
       than a member would write {id:undefined, username:undefined} onto the
       card -- a claim nobody can be held to and nothing can resolve. */
    const gone = {
      stations: [{ id: "s1", area: "shop", table: "Station #1", station: "Welding",
                   welder: "someonewholeft", phase: "Assemble Legacy" }],
      visible: ["s1"]
    };
    const env = boot({ role: "worker", saved: gone, me: SCOTT,
                       cards: [unclaimedOnBench("B", "s1")] });
    const claims = spyClaims(env);
    const node = await render(env, 1280);

    $(node, ".wf-fl-btn").find((b) => /Start/.test(textOf(b)))
      .dispatchEvent(new env.win.Event("click"));
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(claims.length, 1);
    assert.equal(claims[0].member, SCOTT);
    assert.ok(claims[0].member.username, "a real member, not a name-shaped object");
  });

/* ======================================== un-pinning has to outlive a Refresh
 *
 * writePin can clear localStorage and it can clear the member-private copy, but
 * it cannot clear a query string -- and ?station=s2 is the form we actively
 * recommend, because a home-screen shortcut carries it. So the manager who
 * tapped ⤢ to get the shop back, then tapped Refresh (the single most likely
 * next tap, and the one right beside it), watched the tablet silently re-pin
 * itself out of its own bookmark.
 *
 * The sentinel is three-valued on purpose: null is "haven't looked yet", a
 * string is a bench, and FALSE is "un-pinned, deliberately, this session".
 * Both halves below are intended behaviour and both are asserted, because
 * fixing either one by itself would be a regression in the other.
 */

test("un-pinning survives a Refresh, even when the pin came from the URL",
  async () => {
    const env = boot({ role: "manager", saved: TWO_STATIONS,
                       url: PAGE + "?station=s2", cards: [] });
    const node = await render(env, 1280);
    assert.equal($(node, ".wf-fl-col").length, 1, "the bookmark pinned it");

    gear(node, "Show every station").dispatchEvent(new env.win.Event("click"));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal($(node, ".wf-fl-col").length, 2, "un-pinned: the whole shop");

    // The tap that used to undo it.
    const refreshBtn = $(node, "button").find((b) => textOf(b) === "Refresh");
    assert.ok(refreshBtn, "the shared top bar carries Refresh");
    refreshBtn.dispatchEvent(new env.win.Event("click"));
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));

    assert.equal($(node, ".wf-fl-col").length, 2,
      "STILL every station -- the bookmark does not re-pin it mid-session");
    assert.equal($(node, ".wf-fl-tabs").length, 1, "and the area tabs are still there");
    assert.ok(!/Nobody rostered to this bench/.test(textOf(node)));
  });

test("but a fresh boot at the same bookmark pins again -- the URL is authoritative",
  async () => {
    /* The complementary half, and it is NOT the bug. A bench tablet that
       forgets its bench after a power cut is worse than one a manager has to
       un-pin twice: the un-pin is session-scoped, the bookmark is forever. */
    const first = boot({ role: "manager", saved: TWO_STATIONS,
                         url: PAGE + "?station=s2", cards: [] });
    const a = await render(first, 1280);
    gear(a, "Show every station").dispatchEvent(new first.win.Event("click"));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal($(a, ".wf-fl-col").length, 2, "un-pinned in that session");

    // A reload: a brand new page at the same URL, so a brand new module state.
    const second = boot({ role: "manager", saved: TWO_STATIONS,
                          url: PAGE + "?station=s2", cards: [] });
    const b = await render(second, 1280);
    assert.equal($(b, ".wf-fl-col").length, 1, "pinned again, from the bookmark");
    assert.equal($(b, ".wf-fl-col")[0].getAttribute("data-station"), "s2");
  });

test("the floor still draws when t.get THROWS for the member scope", async () => {
  /* Not a rejected promise -- a SYNCHRONOUS throw, which is what a `t` that
     does not implement member scope at all actually does. Thrown from inside
     the Promise.all array literal it escapes before the array is built, so
     neither the .catch on the member read nor the one on the end of the chain
     exists yet to see it: the whole Floor tab died, with no error panel and no
     Try again, because a tablet could not remember which bench it was. */
  const env = boot({ role: "worker", saved: TWO_STATIONS, cards: [] });
  const real = env.ctx.t.get;
  env.ctx.t.get = (scope, vis, key, dflt) => {
    if (scope === "member") throw new Error("this t has no member scope");
    return real(scope, vis, key, dflt);
  };

  const node = await render(env, 1280);
  assert.equal($(node, ".wf-fl-col").length, 2, "the shop floor, unpinned");
  assert.ok(!/Couldn't read the shop floor/.test(textOf(node)),
    "and not the error panel either");
});

/* ================================= the worker and the signer are two people
 *
 * `worker` is who did the work: on a tablet bolted to Station #2 that is
 * whoever is standing at Station #2, not whoever the device happens to be
 * signed in as. `signedBy` is who vouched for it, and it is chosen by hand
 * from the dropdown with NO default -- the two being different people is the
 * entire point of a peer check, and a "helpful" default would quietly turn
 * every sign-off into a self-check that reads like a peer one.
 */

test("QC records the bench as the worker and the dropdown as the signer",
  async () => {
    // Signed in as Scott, standing at Kevin's bench: the three candidate names
    // are all different, so each assertion can only pass for its own reason.
    const env = boot({
      role: "worker", saved: ONE_STATION, me: SCOTT, members: [KEV, SCOTT],
      cards: [job("B", "LA", { claimed: KEV, running: true })]
    });
    const node = await render(env, 1280);
    $(node, ".wf-fl-ic")[1].dispatchEvent(new env.win.Event("click"));
    await new Promise((r) => setTimeout(r, 0));

    const col = () => $(node, '[data-station="s1"]')[0];
    const click = (el) => el.dispatchEvent(new env.win.Event("click"));
    const signBtn = () => $(col(), ".wf-fl-panel button.wf-fl-done")[0];

    click($(col(), ".wf-fl-allrow button")[0]);          // Check all
    const sig = $(col(), ".wf-fl-panel input.wf-fl-input")[0];
    sig.value = "Scott VanWorkom";
    sig.dispatchEvent(new env.win.Event("input"));

    /* THE TEST THAT FAILS IF SOMEBODY LATER DEFAULTS THE SIGNER.
       Every line ticked and a name typed: the signer is the only thing left in
       the way, and it has to stay in the way until a human picks one. */
    assert.equal($(col(), ".wf-fl-panel .wf-fl-sel")[0].value, "",
      "the signer dropdown starts on nobody -- not the bench welder, not the device");
    assert.equal(signBtn().disabled, true, "and it will not sign without one");
    assert.match(textOf(col()), /who signed off/i, "the hint says that is why");
    assert.equal(env.written.length, 0, "nothing written on a list with no signer");

    const who = $(col(), ".wf-fl-panel .wf-fl-sel")[0];
    who.value = "scottv";
    who.dispatchEvent(new env.win.Event("change"));
    assert.equal(signBtn().disabled, false, "chosen by hand, so now it can go");

    click(signBtn());
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));

    const rec = env.store.qcRecord;
    assert.ok(rec, "the sign-off landed");
    assert.equal(rec.status, "passed");
    // Who vouched for it: the dropdown, untouched by FIX 4.
    assert.equal(rec.signedBy.username, "scottv");
    assert.equal(rec.rounds[rec.rounds.length - 1].signedBy.username, "scottv",
      "and the round carries the same signer");
    // Who did it: the BENCH's welder, not the account the tablet is signed in
    // as -- which here is the signer, so a regression to ctx.member collapses
    // the two names into one and this fails.
    assert.equal(rec.requestedBy.username, "kevinmoss",
      "the work is attributed to the bench, not to the device");
    assert.notEqual(rec.requestedBy.username, rec.signedBy.username,
      "a peer check is two people; the moment it is one, it is a self-check");
  });

test("a recorded fault is attributed to the bench too, not to the device",
  async () => {
    // recordFaults and signOff are separate functions and FIX 4 touched both.
    // Asserting only the sign-off path would leave half of it uncovered.
    const env = boot({
      role: "worker", saved: ONE_STATION, me: SCOTT, members: [KEV, SCOTT],
      cards: [job("B", "LA", { claimed: KEV, running: true })]
    });
    const node = await render(env, 1280);
    $(node, ".wf-fl-ic")[1].dispatchEvent(new env.win.Event("click"));
    await new Promise((r) => setTimeout(r, 0));

    const col = () => $(node, '[data-station="s1"]')[0];
    const click = (el) => el.dispatchEvent(new env.win.Event("click"));
    click($(col(), ".wf-fl-ck .wf-fl-box")[0]);   // pass
    click($(col(), ".wf-fl-ck .wf-fl-box")[0]);   // fail

    const note = $(col(), ".wf-fl-ck.is-bad input.wf-fl-input")[0];
    note.value = "twisted 3mm across the diagonal";
    note.dispatchEvent(new env.win.Event("input"));
    click($(col(), "[data-fault-btn]")[0]);
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));

    const rec = env.store.qcRecord;
    assert.ok(rec, "the fault landed on the card");
    assert.equal(rec.requestedBy.username, "kevinmoss",
      "whoever found it was standing at the bench, whatever the tablet is signed in as");
  });

/* ======================================================== the whole shop
 *
 * A tablet pinned to one bench showed that bench's queue and nothing else, so
 * a welder who got ahead could see no work to pull: the Full queue is this
 * bench's, and the assign list only ever offers jobs on NO bench. Getting
 * ahead meant standing still until somebody told you what was next.
 */

/** A job sitting on a named bench, optionally part-way through somebody's day. */
function onBench(id, station, opts = {}) {
  const c = job(id, "LA", { pos: opts.pos === undefined ? 10 : opts.pos, name: opts.name });
  c.phaseWork = {
    listId: "LA",
    claimedBy: opts.by || null,
    tableId: station,
    segments: opts.started
      ? [{ start: new Date(Date.now() - 45 * 60000).toISOString(), end: null }]
      : [],
    percentComplete: opts.pct || 0
  };
  return c;
}

/** Open the shop view on a column and hand back a live reader for it. */
async function openShop(env, node, stationId = "s1") {
  const col = () => $(node, '[data-station="' + stationId + '"]')[0];
  $(col(), ".wf-fl-link").find((b) => /Whole shop/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));
  await settle(env, 2);
  return col;
}

test("the shop view groups by bench, this bench first, and names the others", async () => {
  const env = boot({
    role: "worker", saved: TWO_STATIONS, me: KEV,
    cards: [
      onBench("HERE", "s1", { name: "#2401 waiting on my bench" }),
      onBench("THERE", "s2", { name: "#2402 on Scott's bench", by: SCOTT,
                               started: true, pct: 30 }),
      job("LOOSE", "LA", { pos: 30, name: "#2403 on no bench" })
    ]
  });
  const node = await render(env, 1280);
  const col = await openShop(env, node);
  const text = textOf(col());

  assert.match(text, /The whole shop/, "the header says where you are");
  assert.match(text, /#2402 on Scott's bench/,
    "another bench's work is visible -- that is the whole point");
  assert.match(text, /Station #2/, "and it is attributed to that bench by name");
  assert.match(text, /On no bench yet/);
  assert.match(text, /30% done/, "with how far along it is, before anybody taps");

  // This bench first: most of the time the answer is already here.
  assert.ok(text.indexOf("Waiting here") < text.indexOf("Station #2"),
    "your own bench leads");
  assert.ok(text.indexOf("Station #2") < text.indexOf("On no bench yet"),
    "and an unowned pile is last");
  assert.equal(env.written.length, 0, "looking at the shop writes nothing");
});

test("the shop view offers the link on an empty bench, which is when it is needed",
  async () => {
    const env = boot({ role: "worker", saved: TWO_STATIONS, cards: [] });
    const node = await render(env, 1280);
    const col = $(node, '[data-station="s1"]')[0];
    assert.ok($(col, ".wf-fl-link").some((b) => /Whole shop/.test(textOf(b))),
      "an empty bench is exactly when somebody needs somewhere to look");
  });

test("Bring it here moves an unstarted job onto this bench", async () => {
  const env = boot({
    role: "worker", saved: TWO_STATIONS, me: KEV,
    cards: [onBench("THERE", "s2", { name: "#2402 nobody has started" })]
  });
  const moves = [];
  env.win.WFTables.setStation = (t, card, stationId, pos) => {
    moves.push({ card: card.id, stationId, pos });
    return Promise.resolve({});
  };
  const node = await render(env, 1280);
  const col = await openShop(env, node);

  const take = $(col(), ".wf-fl-btn").find((b) => /Bring it here/.test(textOf(b)));
  assert.ok(take, "an unstarted job is brought over, not taken off anybody");
  assert.ok(!take.disabled);

  take.dispatchEvent(new env.win.Event("click"));
  await settle(env);
  assert.deepEqual(moves.map((m) => [m.card, m.stationId]), [["THERE", "s1"]]);
  assert.equal($(env.win.document.body, ".wf-panel-t")
    .filter((n) => /Take .* from/.test(textOf(n))).length, 0,
    "unclaimed work moves with no dialog -- there is nobody to ask");
});

/* CLAIMED BUT NEVER STARTED IS STILL SOMEBODY'S JOB.
 *
 * No time moves with it, so nothing is lost -- but it was given to a person,
 * and pulling it onto another bench without a word means they go looking for
 * their next job and find it gone. Between the two existing cases (unclaimed:
 * take it; started: confirm, with a percentage) this one used to fall silently
 * into the first. */
test("Bring it here asks first when the job is claimed, and names who has it",
  async () => {
    const env = boot({
      role: "worker", saved: TWO_STATIONS, me: KEV,
      cards: [onBench("THERE", "s2",
        { name: "#2402 Scott's, not started", by: SCOTT })]
    });
    const moves = [];
    env.win.WFTables.setStation = (t, card, stationId, pos) => {
      moves.push({ card: card.id, stationId, pos });
      return Promise.resolve({});
    };
    const node = await render(env, 1280);
    const col = await openShop(env, node);

    const take = $(col(), ".wf-fl-btn").find((b) => /Bring it here/.test(textOf(b)));
    assert.ok(take, "nothing has been worked, so it is still a Bring, not a Take");
    assert.ok(!take.disabled, "and it needs no permission -- no hours are at stake");

    take.dispatchEvent(new env.win.Event("click"));
    await settle(env, 2);
    const body = textOf(env.win.document.body);
    assert.match(body, /from Scott/, "it names whose bench it is coming off");
    assert.match(body, /has not started it/,
      "and says why this is cheaper than taking live work");
    assert.equal(moves.length, 0, "nothing moves until they answer");
    assert.equal(env.written.length, 0);

    // Declining has to leave the job exactly where it was.
    const leave = $(env.win.document.body, ".wf-btn")
      .find((b) => /Leave it with Scott/.test(textOf(b)));
    assert.ok(leave, "backing out is offered in the shop's own words");
    leave.dispatchEvent(new env.win.Event("click"));
    await settle(env);

    assert.equal(moves.length, 0, "declining writes nothing at all");
    assert.equal(env.written.length, 0);
    assert.ok(!/has not started it/.test(textOf(env.win.document.body)),
      "and the dialog is gone");
  });

test("saying yes to a claimed-but-unstarted job moves it, once", async () => {
  const env = boot({
    role: "worker", saved: TWO_STATIONS, me: KEV,
    cards: [onBench("THERE", "s2", { name: "#2402 Scott's, not started", by: SCOTT })]
  });
  const moves = [];
  env.win.WFTables.setStation = (t, card, stationId, pos) => {
    moves.push({ card: card.id, stationId, pos });
    return Promise.resolve({});
  };
  const node = await render(env, 1280);
  const col = await openShop(env, node);

  $(col(), ".wf-fl-btn").find((b) => /Bring it here/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));
  await settle(env, 2);

  const go = $(env.win.document.body, ".wf-btn")
    .filter((b) => /^Bring it here$/.test(textOf(b).trim()))
    .pop();
  assert.ok(go, "the confirm repeats the verb, so nobody has to re-read the row");
  go.dispatchEvent(new env.win.Event("click"));
  await settle(env);

  assert.deepEqual(moves.map((m) => [m.card, m.stationId]), [["THERE", "s1"]]);
});

test("a job somebody is part-way through offers to be TAKEN, and says whose it is",
  async () => {
    const env = boot({
      role: "worker", saved: TWO_STATIONS, me: KEV,
      cards: [onBench("THERE", "s2", { by: SCOTT, started: true, pct: 30 })]
    });
    const node = await render(env, 1280);
    const col = await openShop(env, node);

    const take = $(col(), ".wf-fl-btn").find((b) => /Take it on/.test(textOf(b)));
    assert.ok(take, "taking live work is a different act and reads as one");
    assert.match(textOf(col()), /Scott VanWorkom/);

    take.dispatchEvent(new env.win.Event("click"));
    const body = textOf(env.win.document.body);
    assert.match(body, /Take .* from Scott/, "it asks first, naming whose job it is");
    assert.match(body, /30%/, "and how far along they are");
    assert.equal(env.written.length, 0, "nothing moves until they answer");
  });

test("without job.assign, taking live work off somebody is refused, not hidden",
  async () => {
    const env = boot({
      role: "worker", saved: TWO_STATIONS, me: KEV,
      can: () => false,
      cards: [
        onBench("THERE", "s2", { by: SCOTT, started: true, pct: 30 }),
        job("LOOSE", "LA", { pos: 30, name: "#2403 on no bench" })
      ]
    });
    const node = await render(env, 1280);
    const col = await openShop(env, node);

    const take = $(col(), ".wf-fl-btn").find((b) => /Take it on/.test(textOf(b)));
    assert.ok(take.disabled, "somebody else's half-done job is not yours to take");
    assert.match(take.getAttribute("title") || "", /part-way through/);

    /* BUT THE LOOKING IS NEVER GATED, and unclaimed work is still free to
     * pull. A shop floor that cannot see its own queue is the problem this
     * screen exists to fix. */
    assert.match(textOf(col()), /#2403 on no bench/);
    const free = $(col(), ".wf-fl-btn").find((b) => /Bring it here/.test(textOf(b)));
    assert.ok(free && !free.disabled, "unclaimed work needs no permission");
  });

test("the shop view leaves out finished work and the job already on this bench",
  async () => {
    const done = onBench("DONE", "s2", { name: "#2410 finished", by: SCOTT, pct: 100 });
    done.phaseWork.completedAt = new Date().toISOString();
    const env = boot({
      role: "worker", saved: TWO_STATIONS, me: KEV,
      cards: [
        job("B", "LA", { claimed: KEV, running: true, name: "#2400 in my hands" }),
        done
      ]
    });
    const node = await render(env, 1280);
    const col = await openShop(env, node);
    const text = textOf(col());
    assert.ok(!/#2410 finished/.test(text), "work that is done is not work to pull");
    assert.ok(!/#2400 in my hands/.test(text), "nor is the job already on this bench");
  });

test("looking at a shop job and backing out returns to the shop list, not the bench",
  async () => {
    const env = boot({
      role: "worker", saved: TWO_STATIONS, me: KEV,
      cards: [onBench("THERE", "s2", { name: "#2402 somewhere else" })]
    });
    const node = await render(env, 1280);
    const col = await openShop(env, node);

    $(col(), ".wf-fl-link").find((b) => /Look at it/.test(textOf(b)))
      .dispatchEvent(new env.win.Event("click"));
    await settle(env);
    assert.ok(col().classList.contains("is-card"), "it opened");

    $(col(), ".wf-cp-x")[0].dispatchEvent(new env.win.Event("click"));
    await settle(env, 2);
    assert.match(textOf(col()), /The whole shop/,
      "a list you were reading is a place, and the × gives it back");
  });

/* ============================ the two previews are not the same preview
 *
 * One panel serves both, and which one you are in is inferred from whether
 * previewCta names the card on screen. The two maps behind that -- previewing
 * and previewCta -- have to move together, because getting it wrong puts a
 * button that STARTS A CLOCK on the assign list, whose entire premise is that
 * putting a job on a bench is not the same as working on it.
 */
test("a preview opened from the assign list carries no start button", async () => {
  const env = boot({
    role: "worker", saved: ONE_STATION, me: KEV,
    cards: [job("Q", "LA", { pos: 10, name: "#2444 unassigned" })]
  });
  const node = await render(env, 1280);
  const col = () => $(node, '[data-station="s1"]')[0];

  // Look at it from the queue first, so previewCta knows this exact card.
  $(col(), "button.wf-fl-t")[0].dispatchEvent(new env.win.Event("click"));
  await settle(env);
  assert.ok(footBtn(col()), "the queue preview does commit");
  $(col(), ".wf-cp-x")[0].dispatchEvent(new env.win.Event("click"));
  await settle(env, 2);

  // Now the same card, from the assign list.
  $(col(), ".wf-fl-assign")[0].dispatchEvent(new env.win.Event("click"));
  await settle(env, 2);
  $(col(), ".wf-fl-link").find((b) => /Preview/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));
  await settle(env);

  assert.ok(col().classList.contains("is-card"), "it opened");
  assert.equal(footBtn(col()), undefined,
    "assigning is a scheduling decision; starting is not on this screen");
  assert.ok(!/Before you start/.test(textOf(col())), "nor does it read like one");

  // And the way out is the list you came from, not the bench.
  $(col(), ".wf-cp-x")[0].dispatchEvent(new env.win.Event("click"));
  await settle(env, 2);
  assert.match(textOf(col()), /Assign to/);
});

test("the shop view keeps the blast booth's work out of the powder booth's list",
  async () => {
    /* TWO BENCHES BEHIND ONE TRELLO COLUMN. Both booths pull "Sandblast /
     * Powder Coat" because that is the only list there is, and which of the
     * two owns a job is decided by a label. A shop list that ignores the split
     * offers the powder operator jobs that have not been blasted yet -- work
     * they cannot do, in a list whose whole purpose is "what can I pull next".
     */
    const raw = job("RAW", "LS", { pos: 10, name: "#2500 not blasted yet" });
    const blasted = job("BLASTED", "LS", { pos: 20, name: "#2501 ready for powder" });
    blasted.labelNames = ["Blasted"];

    const env = boot({ role: "worker", saved: BOOTHS, cards: [raw, blasted] });
    const node = await finishing(env);

    const blast = await openShop(env, node, "f1");
    assert.match(textOf(blast()), /#2500 not blasted yet/);
    assert.ok(!/#2501 ready for powder/.test(textOf(blast())),
      "the blast booth is not offered work that is already blasted");

    const powder = await openShop(env, node, "f2");
    assert.match(textOf(powder()), /#2501 ready for powder/);
    assert.ok(!/#2500 not blasted yet/.test(textOf(powder())),
      "and the powder booth is not offered work nobody has blasted");
  });
