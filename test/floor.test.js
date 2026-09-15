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
  win.WFRest = { request: () => Promise.resolve([]), write: () => Promise.resolve({}) };
  win.WFRoster = { getRoster: () => Promise.resolve({ managers: [], phaseSpecialists: {} }) };
  win.WFPricing = { getBoardAudit: () => Promise.resolve([]) };
  win.Chart = function () {};

  win.eval(read("lib/tables.js"));
  win.eval(read("popups/ops.js"));

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

test("the defaults name the stations the mock named, and invent no phase", () => {
  const { T } = boot();
  const d = T.defaults();
  const names = d.map((s) => s.table);
  assert.deepEqual(names, [
    "Station #1", "Station #2", "Station #3", "Station #4",
    "Blast booth", "Powder booth", "Cure oven", "Wet paint"
  ]);
  // The laser bay and wet paint have no matching list on this board, so they
  // are left unset rather than pointed somewhere plausible.
  assert.equal(d.find((s) => s.table === "Station #4").phase, "");
  assert.equal(d.find((s) => s.table === "Wet paint").phase, "");
  assert.equal(d.find((s) => s.table === "Blast booth").phase, "Sandblast / Powder Coat");
  // Nobody is rostered by default.
  assert.ok(d.every((s) => s.welder === ""));
});

test("a saved config is merged over the defaults, so a new station can't vanish", () => {
  const { T } = boot();
  const merged = T.merge({
    stations: [{ id: "s1", table: "Big table", welder: "kevinmoss", phase: "Assemble CNC" }],
    visible: ["s1"]
  });
  assert.equal(merged.stations.length, 8, "the other seven survive");
  const s1 = merged.stations.find((s) => s.id === "s1");
  assert.equal(s1.table, "Big table");
  assert.equal(s1.phase, "Assemble CNC");
  assert.equal(s1.station, "Welding", "fields the save didn't mention keep their default");
  assert.deepEqual(merged.visible, ["s1"]);

  // A station id nobody knows about is dropped from visible rather than
  // rendering as a blank column.
  assert.deepEqual(T.merge({ visible: ["ghost"] }).visible.length, 8);
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
  assert.match(columns, /40% complete/);
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
  assert.ok($(node, "button").some((b) => textOf(b) === "Stations"));
});

test("a worker gets no summary strip and no station setup", async () => {
  const env = boot({ role: "worker", saved: ONE_STATION, cards: [] });
  const node = await render(env, 1280);
  assert.equal($(node, ".wf-fl-sum").length, 0);
  assert.ok(!$(node, "button").some((b) => textOf(b) === "Stations"));
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
  assert.match(textOf(node), /No active job/);

  const empty = boot({ role: "worker", saved: ONE_STATION, cards: [] });
  const n2 = await render(empty, 1280);
  assert.match(textOf(n2), /Nothing waiting in Assemble Legacy/);
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
  $(node, "button").find((b) => textOf(b) === "Stations")
    .dispatchEvent(new env.win.Event("click"));

  const doc = env.win.document;
  const selects = $(doc, "select");
  assert.ok(selects.length >= 2, "a phase picker and a person picker");

  $(doc, "button").find((b) => textOf(b) === "Save")
    .dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(env.written.length, 1, "one write");
  assert.equal(env.written[0][0], "wfStations", "and it's configuration");
  assert.ok(Array.isArray(env.written[0][1].stations));
});
