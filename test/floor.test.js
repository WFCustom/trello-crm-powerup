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

function boot({ role = "worker", cards = [], saved = null } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="boardName"></div><div id="meName"></div><div id="meInitials"></div>
       <nav id="tabbar"></nav><main id="view"></main>
     </body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true }
  );
  const win = dom.window;
  const store = saved ? { wfStations: saved } : {};
  const written = [];

  win.eval(read("config.js"));
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
    })
  };
  win.WFRoster = { getRoster: () => Promise.resolve({ managers: [], phaseSpecialists: {} }) };
  win.WFPricing = { getBoardAudit: () => Promise.resolve([]) };
  win.Chart = function () {};

  // The Floor writes now, so it needs the state machine and the checklists.
  win.eval(read("lib/phase.js"));
  win.eval(read("lib/qc.js"));
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

  const t = {
    get: (scope, vis, key, dflt) =>
      Promise.resolve(store[key] === undefined ? dflt : store[key]),
    set: (scope, vis, key, value) => {
      written.push([key, value]); store[key] = value; return Promise.resolve();
    }
  };

  const ctx = {
    t,
    board: { id: "OPS", name: "Office Operations", members: [KEV, SCOTT] },
    member: KEV,
    boardCfg: BOARD,
    roster: { managers: [], phaseSpecialists: {} },
    role,
    isManager: role === "manager",
    cards: () => Promise.resolve(cards),
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
  assert.deepEqual(d.map((s) => s.table), [
    "Station #1", "Station #2", "Station #3", "Station #4", "CAP rail bench",
    "Blast booth", "Powder booth", "Cure oven", "Wet paint"
  ]);

  // THE BUG THIS TEST EXISTS FOR. The first cut gave each welding bench a
  // different phase, so only Station #1 ever had a queue. Four welding benches
  // do the same work and therefore pull the same list.
  const welding = d.filter((s) => s.type === "weld");
  assert.equal(welding.length, 4);
  assert.ok(welding.every((s) => s.phase === "Assemble Legacy"),
    "every welding bench pulls the same list");

  assert.equal(d.find((s) => s.table === "CAP rail bench").phase, "Assemble CAP");
  assert.equal(d.find((s) => s.table === "Blast booth").phase, "Sandblast / Powder Coat");
  // Wet paint has no matching list, so it is left unset rather than pointed
  // somewhere plausible -- a guess dressed as a fact.
  assert.equal(d.find((s) => s.table === "Wet paint").phase, "");
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
  assert.equal(grown.stations.length, 9, "the others survive");

  const pruned = T.merge({ stations: [], visible: [], removed: ["s4"] });
  assert.equal(pruned.stations.length, 8);
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
  assert.equal($(node, ".wf-fl-gear").length, 1, "station setup gear");
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
  assert.deepEqual(names, ["Blast booth", "Powder booth", "Cure oven", "Wet paint"]);
});

test("saving stations writes config and nothing else", async () => {
  const env = boot({ role: "manager", saved: ONE_STATION, cards: [] });
  const node = await render(env, 1280);
  $(node, ".wf-fl-gear")[0]
    .dispatchEvent(new env.win.Event("click"));
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

test("a card with no picture drops the frame rather than leaving a grey box", async () => {
  const env = boot({
    role: "worker",
    saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true })]
  });
  env.win.WFRest.getCardDetail = () => Promise.resolve({ id: "B", attachments: [] });
  const node = await render(env, 1280);
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
  // Tapping a queued job on a BUSY station now asks before switching, rather
  // than opening the card -- that is the mock's switch dialog.
  assert.match(textOf(env.win.document.body), /Pause .* and start/);
  assert.ok(!col.classList.contains("is-card"));
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

/* ============================================================ the switch */

test("tapping a queued job on an open station starts it; on a busy one it asks", async () => {
  const openEnv = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("Q", "LA", { pos: 10 })]
  });
  let node = await render(openEnv, 1280);
  assert.match(textOf(node), /Tap a job to start/);

  const busyEnv = boot({
    role: "worker", saved: ONE_STATION,
    cards: [job("B", "LA", { claimed: KEV, running: true, pct: 65 }), job("Q", "LA", { pos: 10 })]
  });
  node = await render(busyEnv, 1280);
  assert.match(textOf(node), /Tap a job to switch/);

  $(node, "button.wf-fl-t")[0].dispatchEvent(new busyEnv.win.Event("click"));
  const body = textOf(busyEnv.win.document.body);
  assert.match(body, /Pause .* and start/);
  // The percentage has to be in the question: silently pausing somebody's work
  // is the kind of surprise that makes a shop stop trusting a screen.
  assert.match(body, /65%/);
  assert.equal(busyEnv.written.length, 0, "nothing happens until they answer");
});
