/**
 * EOS -- the data layer and the tab, exercised against the real source files.
 *
 * The render half runs the actual tab inside jsdom with WFRest stubbed, so the
 * assertions are about what a person would see rather than about what the code
 * intended. That is the only way to catch the class of bug that has bitten this
 * project before: a null handed to appendChild, a role filter that reads the
 * wrong field, a section that throws only when its record is empty.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { after } = require("node:test");

/* EVERY WINDOW GETS CLOSED, LIKE THE OTHER FOUR JSDOM SUITES.
 *
 * boot() is called around thirty times here with pretendToBeVisual, and none of
 * them was ever closed. It does not hang today only because neither the EOS tab
 * nor the shell registers a timer -- the moment either grows one (the Floor tab
 * already has a 30s interval), `node --test` stops exiting and the failure
 * looks like a test that never finishes rather than a window that was left
 * open. Until then it is just thirty leaked DOMs per run. */
const OPEN = [];
after(() => { OPEN.forEach((w) => { try { w.close(); } catch (e) { /* already gone */ } }); });

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* ------------------------------------------------------------------ fixtures */

const LISTS = [
  { id: "L1", name: "Inbox — new from the shop" },
  { id: "L2", name: "Leadership Team — Level 10" },
  { id: "L3", name: "V/TO — long term" },
  { id: "L4", name: "Dept · Shop Floor" },
  { id: "L5", name: "Dept · CAD and Engineering" },
  { id: "L6", name: "Dept · Office and Sales" },
  { id: "L7", name: "Dept · Install" },
  { id: "L8", name: "Solved" }
];

const LABELS = [
  { id: "B1", name: "Issue", color: "red" },
  { id: "B2", name: "Idea", color: "green" },
  { id: "B3", name: "Obstacle", color: "orange" }
];

const MEMBERS = [
  { id: "M1", fullName: "Dale Jacaway", username: "dalejacaway" },
  { id: "M2", fullName: "Kevin Moss", username: "kevinmoss" }
];

const DAY = 86400000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();

/** A Trello-shaped id whose first 8 hex chars encode a creation time. */
function idAt(daysAgo) {
  const secs = Math.floor((Date.now() - daysAgo * DAY) / 1000);
  return secs.toString(16).padStart(8, "0") + "aaaaaaaaaaaaaaaa";
}

const CARDS = [
  { id: idAt(2), name: "Powder booth filters clog by Thursday",
    desc: "**What's the issue?**\nThey load up fast.", idList: "L1", idLabels: ["B1"],
    idMembers: [], pos: 100, badges: { comments: 0 }, dateLastActivity: iso(-1) },
  { id: idAt(9), name: "Second install crew by spring",
    desc: "", idList: "L2", idLabels: ["B2"], idMembers: ["M1"], pos: 50,
    badges: { comments: 3 }, dateLastActivity: iso(-2), due: iso(10) },
  { id: idAt(40), name: "Nobody owns the quoting handoff",
    desc: "", idList: "L2", idLabels: ["B1"], idMembers: [], pos: 200,
    badges: { comments: 0 }, dateLastActivity: iso(-30) },
  { id: idAt(120), name: "Ten-year target has no number in it",
    desc: "", idList: "L3", idLabels: ["B1"], idMembers: ["M1"], pos: 10,
    badges: { comments: 1 }, dateLastActivity: iso(-4) },
  { id: idAt(5), name: "Blast media runs out mid-job",
    desc: "", idList: "L4", idLabels: ["B3"], idMembers: ["M2"], pos: 100,
    badges: { comments: 0 }, dateLastActivity: iso(-1), due: iso(-3) },
  { id: idAt(30), name: "CAD revisions not numbered",
    desc: "", idList: "L5", idLabels: ["B1"], idMembers: [], pos: 100,
    badges: { comments: 0 }, dateLastActivity: iso(-1) },
  { id: idAt(60), name: "Shop radio was too loud",
    desc: "", idList: "L8", idLabels: ["B1"], idMembers: ["M2"], pos: 100,
    badges: { comments: 2 }, dateLastActivity: iso(-20), dueComplete: true }
];

/* --------------------------------------------------------------- environment */

/**
 * Load config, the libs, ops.js and the EOS tab into one jsdom window, with
 * WFRest and the Trello `t` handle replaced by recording stubs.
 */
function boot({ role = "manager", records = {}, cards = CARDS, labels = LABELS } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="boardName"></div><div id="meName"></div><div id="meInitials"></div>
       <nav id="tabbar"></nav><main id="view"></main>
     </body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true }
  );
  const win = dom.window;
  OPEN.push(win);

  const calls = [];
  const store = Object.assign({}, records);

  win.eval(read("config.js"));
  win.eval(read("lib/board-extras.js"));
  win.eval(read("lib/stage.js"));

  // Stubbed before the EOS files load, so they bind to these.
  win.WFRest = {
    request(t, pathname, params) {
      calls.push(["GET", pathname, params]);
      if (/\/lists$/.test(pathname)) return Promise.resolve(LISTS);
      if (/\/cards$/.test(pathname)) return Promise.resolve(cards);
      if (/\/labels$/.test(pathname)) return Promise.resolve(labels);
      if (/\/members$/.test(pathname)) return Promise.resolve(MEMBERS);
      if (/\/actions$/.test(pathname)) return Promise.resolve([]);
      return Promise.resolve([]);
    },
    write(t, method, pathname, params) {
      calls.push([method, pathname, params]);
      return Promise.resolve({ ok: true });
    }
  };
  win.WFSOP = { load: () => Promise.resolve({ sops: [] }) };
  win.WFRoster = { getRoster: () => Promise.resolve({ managers: [], phaseSpecialists: {} }) };
  win.WFPricing = { getBoardAudit: () => Promise.resolve([]) };
  win.Chart = function () {};

  win.eval(read("lib/eos.js"));
  win.eval(read("popups/ops.js"));

  // WFOps keeps its tab registry private, so capture the def as it registers.
  let def = null;
  const realTab = win.WFOps.tab;
  win.WFOps.tab = (d) => { def = d; return realTab(d); };
  win.eval(read("popups/tabs/eos.js"));

  const t = {
    get: (scope, vis, key, dflt) =>
      Promise.resolve(store[key] === undefined ? dflt : store[key]),
    set: (scope, vis, key, value) => { store[key] = value; return Promise.resolve(); }
  };

  const ctx = {
    t,
    board: { id: "OPS", name: "Office Operations", members: MEMBERS },
    member: { id: "M1", fullName: "Dale Jacaway", username: "dalejacaway" },
    boardCfg: null,
    roster: { managers: ["dalejacaway"], phaseSpecialists: { CAD: ["dalejacaway"], Install: [] } },
    role,
    isManager: role === "manager",
    cards: () => Promise.resolve([]),
    reload: () => Promise.resolve(),
    syncCard: () => Promise.resolve(),
    goTo: (id) => { ctx.wentTo = id; }
  };

  return { win, dom, def, ctx, calls, store, E: win.WFEOS };
}

const textOf = (node) => (node.textContent || "").replace(/\s+/g, " ").trim();

function render(env) {
  return Promise.resolve(env.def.render(env.ctx)).then((node) => {
    env.win.document.getElementById("view").appendChild(node);
    return node;
  });
}

const $ = (node, sel) => Array.from(node.querySelectorAll(sel));

/* ================================================================== the layer */

test("lists are classified by name, so the board stays editable in Trello", () => {
  const { E } = boot();
  assert.equal(E.kindOf("Inbox — new from the shop"), "inbox");
  assert.equal(E.kindOf("Leadership Team — Level 10"), "leadership");
  assert.equal(E.kindOf("V/TO — long term"), "vto");
  assert.equal(E.kindOf("Dept · Shop Floor"), "department");
  assert.equal(E.kindOf("Solved"), "solved");
  // Renaming shouldn't reclassify.
  assert.equal(E.kindOf("Solved / Closed"), "solved");
  assert.equal(E.kindOf("L10 list"), "leadership");
  // A list added in Trello that matches nothing is a department, not an error.
  assert.equal(E.kindOf("Powder Coat"), "department");
});

test("a department list shows its short name", () => {
  const { E } = boot();
  assert.equal(E.shortName("Dept · Shop Floor"), "Shop Floor");
  assert.equal(E.shortName("Department: Install"), "Install");
  assert.equal(E.shortName("Solved"), "Solved");
  assert.equal(E.shortName(""), "");
});

test("workers cannot see the Leadership or V/TO lists; managers see everything", () => {
  const { E } = boot();
  for (const kind of ["inbox", "department", "solved"]) {
    assert.equal(E.canSeeList("worker", kind), true, kind + " should be open");
    assert.equal(E.canSeeList("office", kind), true);
  }
  assert.equal(E.canSeeList("worker", "leadership"), false);
  assert.equal(E.canSeeList("worker", "vto"), false);
  assert.equal(E.canSeeList("office", "leadership"), false);
  assert.equal(E.canSeeList("manager", "leadership"), true);
  assert.equal(E.canSeeList("manager", "vto"), true);
});

test("the scorecard is the only component a worker can't open", () => {
  const { E } = boot();
  for (const id of ["vision", "people", "issues", "process", "traction"]) {
    assert.equal(E.canSeeComponent("worker", id), true, id);
  }
  assert.equal(E.canSeeComponent("worker", "data"), false);
  assert.equal(E.canSeeComponent("manager", "data"), true);
  assert.equal(E.canEdit("worker"), false);
  assert.equal(E.canEdit("office"), false);
  assert.equal(E.canEdit("manager"), true);
});

test("when an issue was filed comes out of the card id", () => {
  const { E } = boot();
  const d = E.filedAt(idAt(10));
  assert.ok(d && typeof d.getTime === "function", "a Date came back");
  const days = (Date.now() - d.getTime()) / DAY;
  assert.ok(days > 9.9 && days < 10.1, "about ten days, got " + days);
  assert.equal(E.filedAt("not-an-id"), null);
  assert.equal(E.filedAt(null), null);
});

test("health names the four ways an issue goes wrong", () => {
  const { E } = boot();
  assert.equal(E.health({ kind: "department", due: iso(-2), updatedAt: iso(-1) }).state, "overdue");
  assert.equal(E.health({ kind: "department", due: iso(1), updatedAt: iso(-1) }).state, "due");
  assert.equal(E.health({ kind: "department", updatedAt: iso(-40), owner: {} }).state, "stale");
  assert.equal(E.health({ kind: "department", updatedAt: iso(-1) }).state, "unowned");
  assert.equal(E.health({ kind: "department", updatedAt: iso(-1), owner: {} }).state, "ok");
  // An issue in the inbox has no owner by definition; that isn't a problem yet.
  assert.equal(E.health({ kind: "inbox", updatedAt: iso(-1) }).state, "ok");
  assert.equal(E.health({ kind: "solved" }).state, "solved");
});

test("the board is mapped into issues, ranked by position", () => {
  const { E } = boot();
  const data = E.buildBoard(LISTS, CARDS, LABELS, MEMBERS);
  assert.equal(data.issues.length, 7);
  assert.equal(data.lists.length, 8);

  const l2 = data.lists.find((l) => l.id === "L2");
  assert.equal(l2.count, 2);
  assert.equal(l2.kind, "leadership");

  const ranked = E.inList(data, "L2").map((i) => i.name);
  assert.deepEqual(ranked, [
    "Second install crew by spring",       // pos 50
    "Nobody owns the quoting handoff"      // pos 200
  ]);

  const first = data.issues.find((i) => i.name === "Second install crew by spring");
  assert.equal(first.type, "Idea");
  assert.equal(first.owner.fullName, "Dale Jacaway");
  assert.equal(first.listShort, "Leadership Team — Level 10");
  assert.equal(first.comments, 3);

  const unlabelled = E.buildBoard(LISTS, [{ id: idAt(1), name: "x", idList: "L1", idLabels: [] }],
    LABELS, MEMBERS);
  assert.equal(unlabelled.issues[0].type, "Issue", "no label means Issue");
});

test("listsFor and search both respect who's asking", () => {
  const { E } = boot();
  const data = E.buildBoard(LISTS, CARDS, LABELS, MEMBERS);
  assert.equal(E.listsFor(data, "manager").length, 8);
  assert.equal(E.listsFor(data, "worker").length, 6);
  assert.ok(!E.listsFor(data, "worker").some((l) => l.kind === "leadership"));

  assert.equal(E.search(data.issues, "").length, 7);
  assert.equal(E.search(data.issues, "blast").length, 1);
  assert.equal(E.search(data.issues, "install crew spring").length, 1, "every term must match");
  assert.equal(E.search(data.issues, "install unicorn").length, 0);
  assert.equal(E.search(data.issues, "Kevin").length, 2, "searches the owner too");
});

test("filing always lands in the inbox, with the answers in order", async () => {
  const env = boot();
  const { E } = env;
  const data = E.buildBoard(LISTS, CARDS, LABELS, MEMBERS);

  await E.fileIssue(env.ctx.t, data, {
    name: "Chop saw blade dull",
    type: "Obstacle",
    answers: { what: "It's binding.", impact: "Two hours Tuesday.", idea: "" },
    filer: { fullName: "Kevin Moss" }
  });

  const post = env.calls.find((c) => c[0] === "POST" && c[1] === "/cards");
  assert.ok(post, "a card was created");
  assert.equal(post[2].idList, "L1", "the inbox, not a department");
  assert.equal(post[2].idLabels, "B3", "labelled Obstacle");
  assert.match(post[2].desc, /What's the issue\?/);
  assert.match(post[2].desc, /It's binding\./);
  assert.match(post[2].desc, /Two hours Tuesday\./);
  assert.ok(!/What would you do about it/.test(post[2].desc), "a blank answer is omitted");
  assert.match(post[2].desc, /Filed by Kevin Moss/);

  await assert.rejects(() => E.fileIssue(env.ctx.t, data, { name: "  " }), /headline/i);
});

test("solving comments first, then moves -- never the other way round", async () => {
  const env = boot();
  const { E } = env;
  const data = E.buildBoard(LISTS, CARDS, LABELS, MEMBERS);

  await E.solve(env.ctx.t, data, "C9", "Bought a bigger filter.");
  const order = env.calls.filter((c) => c[0] !== "GET").map((c) => c[1]);
  assert.deepEqual(order, ["/cards/C9/actions/comments", "/cards/C9"]);
  const move = env.calls.find((c) => c[1] === "/cards/C9");
  assert.equal(move[2].idList, "L8");
  assert.equal(move[2].dueComplete, true);

  const noSolved = E.buildBoard(LISTS.slice(0, 7), CARDS, LABELS, MEMBERS);
  await assert.rejects(() => E.solve(env.ctx.t, noSolved, "C9", "x"), /Solved/);
});

test("a record too big for Trello is refused with a readable message", async () => {
  const env = boot();
  const big = Array.from({ length: 400 }, (_, i) => ({ id: "r" + i, title: "x".repeat(20) }));
  await assert.rejects(() => env.E.saveRecord(env.ctx.t, "rocks", big), /too much/i);
  await env.E.saveRecord(env.ctx.t, "rocks", [{ id: "r1", title: "fine" }]);
  assert.equal(env.store.eosRocks.length, 1);
});

test("a record saved in an older shape falls back to blank rather than rendering nonsense", async () => {
  const env = boot({ records: { eosRocks: { notAnArray: true }, eosVto: "garbage{" } });
  assert.deepEqual(await env.E.getRecord(env.ctx.t, "rocks"), []);
  assert.deepEqual((await env.E.getRecord(env.ctx.t, "vto")).coreValues, []);
  const json = await env.E.getRecord(env.ctx.t, "seats");
  assert.deepEqual(json, [], "an unset record is blank, not null");
});

test("ISO week keys are stable whichever day the number is entered", () => {
  const { E } = boot();
  // 2026-09-14 is a Monday; the Sunday that ends its week is 2026-09-20.
  const mon = E.weekKey(new Date("2026-09-14T09:00:00Z"));
  const sun = E.weekKey(new Date("2026-09-20T23:00:00Z"));
  assert.equal(mon, sun);
  assert.match(mon, /^2026-W\d\d$/);
  // The next Monday is a different week.
  assert.notEqual(mon, E.weekKey(new Date("2026-09-21T09:00:00Z")));
  // 2027-01-01 is a Friday, so it belongs to the last ISO week of 2026.
  assert.equal(E.weekKey(new Date("2027-01-01T12:00:00Z")), "2026-W53");
});

test("thirteen weeks, oldest first, ending with this one", () => {
  const { E } = boot();
  const w = E.recentWeeks(13);
  assert.equal(w.length, 13);
  assert.equal(w[12], E.weekKey());
  assert.equal(new Set(w).size, 13, "no repeats");
});

test("goal direction is declared per measurable, not assumed", () => {
  const { E } = boot();
  const up = { goal: "12", direction: "up" };
  const down = { goal: "4", direction: "down" };
  assert.equal(E.onGoal(up, "14"), true);
  assert.equal(E.onGoal(up, "11"), false);
  assert.equal(E.onGoal(down, "3"), true);
  assert.equal(E.onGoal(down, "9"), false);
  assert.equal(E.onGoal(up, ""), null, "a blank week isn't a miss");
  assert.equal(E.onGoal({ goal: "" }, "3"), null, "no goal means no verdict");
});

test("old weeks are trimmed so the record can't creep up on the size limit", () => {
  const { E } = boot();
  const old = E.weekKey(new Date(Date.now() - 400 * DAY));
  const now = E.weekKey();
  const rows = [{ id: "m1", measurable: "x", weeks: { [old]: "1", [now]: "2" } }];
  const trimmed = E.trimWeeks(rows, 26);
  assert.deepEqual(Object.keys(trimmed[0].weeks), [now]);
  assert.deepEqual(Object.keys(rows[0].weeks).sort(), [old, now].sort(), "input untouched");
});

test("rocks report done, off track and progress", () => {
  const { E } = boot();
  const q = E.quarterOf(new Date("2026-09-14"));
  assert.equal(q, "Q3 2026");
  const rocks = [
    { id: "a", quarter: q, done: true },
    { id: "b", quarter: q, onTrack: false },
    { id: "c", quarter: q },
    { id: "d", quarter: "Q1 2026" }
  ];
  assert.equal(E.rocksFor(rocks, q).length, 3);
  assert.equal(E.rockState(rocks[0]), "done");
  assert.equal(E.rockState(rocks[1]), "off");
  assert.equal(E.rockState(rocks[2]), "on");
  const p = E.rockProgress(E.rocksFor(rocks, q));
  assert.deepEqual(p, { done: 1, total: 3, pct: 33 });
  assert.deepEqual(E.rockProgress([]), { done: 0, total: 0, pct: 0 });
});

test("seats can be suggested from the roster, and gaps are visible", () => {
  const { E } = boot();
  const seats = E.suggestSeats({ phaseSpecialists: { CAD: ["dale"], Install: [], Sandblast: ["kev", "scott"] } });
  assert.deepEqual(seats.map((s) => s.seat), ["CAD", "Sandblast"], "an empty phase isn't a seat");
  assert.equal(seats[1].who, "kev, scott");
  assert.equal(E.seatGaps(seats).length, 0);
  assert.equal(E.seatGaps([{ seat: "Foreman", who: "" }, { seat: "x", who: "a" }]).length, 1);
});

test("process health counts what's actually written up", () => {
  const { E } = boot();
  assert.deepEqual(E.processHealth([{ sopId: "s1" }, { sopId: null }, { sopId: "s2" }]),
    { total: 3, documented: 2, pct: 67 });
  assert.deepEqual(E.processHealth([]), { total: 0, documented: 0, pct: 0 });
});

test("missing kind labels are created once, and existing ones left alone", async () => {
  const env = boot();
  const out = await env.E.ensureLabels(env.ctx.t, [{ id: "B1", name: "Issue" }]);
  const made = env.calls.filter((c) => c[1] === "/labels").map((c) => c[2].name);
  assert.deepEqual(made.sort(), ["Idea", "Obstacle"]);
  assert.equal(out.length, 3);

  const env2 = boot();
  await env2.E.ensureLabels(env2.ctx.t, LABELS);
  assert.equal(env2.calls.filter((c) => c[1] === "/labels").length, 0, "nothing to do");
});

/* =================================================================== the tab */

test("the tab registers as EOS and badges the inbox", async () => {
  const env = boot();
  assert.equal(env.def.id, "eos");
  assert.equal(env.def.label, "EOS");
  assert.equal(env.def.roles, undefined, "everyone gets the tab");
  await render(env);
  assert.equal(env.def.badgeCount(env.ctx), 1, "one issue sitting in the inbox");
});

test("a manager gets all six components; a worker gets five", async () => {
  const mgr = boot({ role: "manager" });
  const node = await render(mgr);
  const rails = $(node, ".wf-eos-r").map((b) => textOf(b.querySelector(".wf-eos-r-t")));
  assert.deepEqual(rails, ["Vision", "People", "Data", "Issues", "Process", "Traction"]);

  const wkr = boot({ role: "worker" });
  const wnode = await render(wkr);
  const wrails = $(wnode, ".wf-eos-r").map((b) => textOf(b.querySelector(".wf-eos-r-t")));
  assert.deepEqual(wrails, ["Vision", "People", "Issues", "Process", "Traction"]);
  assert.ok(!wrails.includes("Data"), "the scorecard carries money");
});

test("the hero counts open issues, the inbox, rocks and what's been solved", async () => {
  const env = boot({ records: { eosRocks: [
    { id: "a", quarter: env0Quarter(), done: true },
    { id: "b", quarter: env0Quarter() }
  ] } });
  const node = await render(env);
  const stats = $(node, ".wf-eos-hs").map((s) => [
    textOf(s.querySelector(".wf-eos-hs-k")), textOf(s.querySelector(".wf-eos-hs-v"))
  ]);
  assert.deepEqual(stats, [
    ["open issues", "6"],       // seven cards, one of them solved
    ["in the inbox", "1"],
    ["rocks on track", "1/2"],
    ["solved", "1"]
  ]);
});

/** The quarter the fixtures should file rocks under -- always "now". */
function env0Quarter() {
  const d = new Date();
  return "Q" + (Math.floor(d.getMonth() / 3) + 1) + " " + d.getFullYear();
}

test("Issues opens first, and a worker never sees a leadership issue", async () => {
  const mgr = boot({ role: "manager" });
  const mnode = await render(mgr);
  const mtitles = $(mnode, ".wf-eos-i-t").map(textOf);
  assert.ok(mtitles.includes("Second install crew by spring"));
  assert.ok(mtitles.includes("Ten-year target has no number in it"));
  assert.ok(!mtitles.includes("Shop radio was too loud"), "solved issues are off the open view");

  const wkr = boot({ role: "worker" });
  const wnode = await render(wkr);
  const wtitles = $(wnode, ".wf-eos-i-t").map(textOf);
  assert.ok(!wtitles.includes("Second install crew by spring"), "leadership list is private");
  assert.ok(!wtitles.includes("Ten-year target has no number in it"), "V/TO is private");
  assert.ok(wtitles.includes("Blast media runs out mid-job"), "their own shop issues show");
  assert.ok(wtitles.includes("Powder booth filters clog by Thursday"));

  const wpills = $(wnode, ".wf-eos-p").map(textOf);
  assert.ok(!wpills.some((p) => /Leadership/.test(p)));
  assert.ok(wpills.some((p) => /Shop Floor/.test(p)));
});

test("picking a list filters to it and numbers the ranks", async () => {
  const env = boot();
  const node = await render(env);
  const pill = $(node, ".wf-eos-p").find((p) => /Leadership/.test(textOf(p)));
  pill.dispatchEvent(new env.win.Event("click"));

  const view = env.win.document.getElementById("view");
  const titles = $(view, ".wf-eos-i-t").map(textOf);
  assert.deepEqual(titles, [
    "Second install crew by spring",
    "Nobody owns the quoting handoff"
  ]);
  const ranks = $(view, ".wf-eos-i-r").map(textOf);
  assert.deepEqual(ranks, ["1", "2"], "rank is the priority");
  assert.ok($(view, ".wf-eos-i.is-top").length === 2, "the top three are marked");
});

test("everyone gets the intake form, and it asks three questions", async () => {
  const env = boot({ role: "worker" });
  const node = await render(env);
  const file = $(node, "button").find((b) => /File an issue or idea/.test(textOf(b)));
  assert.ok(file, "a worker can file");
  file.dispatchEvent(new env.win.Event("click"));

  const doc = env.win.document;
  const labels = $(doc, ".wf-eos-f label").map(textOf);
  assert.ok(labels.includes("Headline"));
  assert.ok(labels.includes("What's the issue?"));
  assert.ok(labels.some((l) => /costing us/.test(l)));
  assert.ok(labels.some((l) => /What would you do about it/.test(l)));
  assert.equal($(doc, ".wf-eos-seg button").length, 3, "Issue / Idea / Obstacle");
});

test("opening an issue shows the intake answers as headings, not asterisks", async () => {
  const env = boot();
  const node = await render(env);
  const row = $(node, ".wf-eos-i").find((r) => /Powder booth/.test(textOf(r)));
  row.dispatchEvent(new env.win.Event("click"));

  const view = env.win.document.getElementById("view");
  const prose = view.querySelector(".wf-eos-prose");
  assert.ok(prose, "the description rendered");
  assert.equal(textOf(prose.querySelector("b")), "What's the issue?");
  assert.ok(!/\*\*/.test(textOf(prose)), "no raw markdown");
  assert.match(textOf(view), /They load up fast/);
  assert.ok($(view, "button").some((b) => /Solved/.test(textOf(b))), "a manager can solve it");
});

test("a worker reading an issue is offered a note, not a verdict", async () => {
  const env = boot({ role: "worker" });
  const node = await render(env);
  const row = $(node, ".wf-eos-i").find((r) => /Blast media/.test(textOf(r)));
  row.dispatchEvent(new env.win.Event("click"));

  const view = env.win.document.getElementById("view");
  const labels = $(view, "button").map(textOf);
  assert.ok(labels.some((l) => /Add a note/.test(l)));
  assert.ok(!labels.some((l) => /^Solved$/.test(l)));
  assert.ok(!labels.some((l) => /Owner and date/.test(l)));
  assert.ok(!labels.some((l) => /^Move$/.test(l)));
});

test("the scorecard draws thirteen weeks and scores each cell", async () => {
  const week = (n) => {
    const d = new Date(Date.now() - n * 7 * DAY);
    d.setHours(0, 0, 0, 0);
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day + 3);
    const ft = new Date(d.getFullYear(), 0, 4);
    ft.setDate(ft.getDate() - ((ft.getDay() + 6) % 7) + 3);
    const w = 1 + Math.round((d - ft) / (7 * DAY));
    return d.getFullYear() + "-W" + String(w).padStart(2, "0");
  };
  const env = boot({ records: { eosScorecard: [
    { id: "m1", measurable: "Quotes sent", owner: "Tallen", goal: "12", direction: "up",
      weeks: { [week(0)]: "14", [week(1)]: "9" } },
    { id: "m2", measurable: "Rework hours", owner: "Mike", goal: "4", direction: "down",
      weeks: { [week(0)]: "2" } }
  ] } });

  const node = await render(env);
  $(node, ".wf-eos-r").find((b) => /Data/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));

  const view = env.win.document.getElementById("view");
  assert.equal($(view, ".wf-eos-sc thead th").length, 15, "measurable + goal + 13 weeks");
  assert.equal($(view, ".wf-eos-sc tbody tr").length, 2);
  assert.equal($(view, ".wf-eos-hit").length, 2, "14 beats 12, and 2 is under 4");
  assert.equal($(view, ".wf-eos-miss").length, 1, "9 misses 12");
  assert.match(textOf(view), /lower is better/);
  assert.ok($(view, "button").some((b) => /Save the numbers/.test(textOf(b))));
});

test("every empty section says what it's for instead of showing nothing", async () => {
  const env = boot();
  await render(env);
  const view = env.win.document.getElementById("view");

  for (const [comp, phrase] of [
    ["Vision", /Not written down yet|hire, fire/i],
    ["People", /No seats yet/i],
    ["Data", /No measurables yet/i],
    ["Process", /No core processes listed yet/i],
    ["Traction", /No rocks set for/i]
  ]) {
    $(view, ".wf-eos-r").find((b) => textOf(b.querySelector(".wf-eos-r-t")) === comp)
      .dispatchEvent(new env.win.Event("click"));
    assert.match(textOf(env.win.document.getElementById("view")), phrase, comp);
  }
});

test("a worker sees the vision and the rocks but gets no edit buttons", async () => {
  const q = env0Quarter();
  const env = boot({ role: "worker", records: {
    eosVto: { coreValues: ["Do it once", "Say the hard thing"], purpose: "Build things that last",
              niche: "", tenYear: "", uniques: [], provenProcess: "", guarantee: "",
              threeYear: {}, oneYear: {} },
    eosRocks: [{ id: "a", title: "Second install crew hired", owner: "Dale", quarter: q, pct: 40 }]
  } });
  const node = await render(env);

  $(node, ".wf-eos-r").find((b) => /Vision/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));
  let view = env.win.document.getElementById("view");
  assert.match(textOf(view), /Do it once/);
  assert.match(textOf(view), /Build things that last/);
  assert.ok(!$(view, "button").some((b) => textOf(b) === "Edit"), "read-only for the shop");
  assert.ok(!$(view, "button").some((b) => /Edit the V\/TO/.test(textOf(b))));

  $(view, ".wf-eos-r").find((b) => /Traction/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));
  view = env.win.document.getElementById("view");
  assert.match(textOf(view), /Second install crew hired/);
  assert.match(textOf(view), /40% there/);
  assert.ok(!$(view, "button").some((b) => /Mark it done/.test(textOf(b))));
});

test("a manager can edit each of the five records", async () => {
  const q = env0Quarter();
  const env = boot({ records: {
    eosSeats: [{ id: "s1", seat: "Shop Foreman", who: "", roles: ["Runs the floor"] }],
    eosProcesses: [{ id: "p1", name: "Measure and quote", owner: "Tallen", steps: ["Site visit"], sopId: null }],
    eosRocks: [{ id: "a", title: "Rock", owner: "Dale", quarter: q, pct: 10 }]
  } });
  const node = await render(env);

  $(node, ".wf-eos-r").find((b) => /People/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));
  let view = env.win.document.getElementById("view");
  assert.match(textOf(view), /Nobody in this seat/, "a vacant seat is visible, not hidden");
  assert.match(textOf(view), /1 seat has nobody in it/);
  assert.ok($(view, "button").some((b) => /Add a seat/.test(textOf(b))));

  $(view, ".wf-eos-r").find((b) => /Process/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));
  view = env.win.document.getElementById("view");
  assert.match(textOf(view), /Measure and quote/);
  assert.match(textOf(view), /not documented/);
  assert.match(textOf(view), /0 of 1 are written up/);
});

test("saving a seat writes the record and repaints", async () => {
  const env = boot();
  const node = await render(env);
  $(node, ".wf-eos-r").find((b) => /People/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));

  const doc = env.win.document;
  $(doc, "button").find((b) => /Add a seat/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));

  const inputs = $(doc, ".wf-eos-f input");
  inputs[0].value = "Integrator";
  inputs[1].value = "Tallen Bannister";
  $(doc, ".wf-eos-f textarea")[0].value = "Runs the leadership team\nRemoves obstacles";

  const save = $(doc, "button").find((b) => textOf(b) === "Save");
  save.dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(env.store.eosSeats.length, 1);
  assert.equal(env.store.eosSeats[0].seat, "Integrator");
  assert.equal(env.store.eosSeats[0].who, "Tallen Bannister");
  assert.deepEqual(env.store.eosSeats[0].roles, ["Runs the leadership team", "Removes obstacles"]);
  assert.match(textOf(doc.getElementById("view")), /Integrator/);
});

test("the tab keeps your place when you leave and come back", async () => {
  const env = boot();
  const node = await render(env);
  $(node, ".wf-eos-r").find((b) => /Traction/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));

  // Re-render the way ops.js does when the tab is reselected.
  env.win.document.getElementById("view").innerHTML = "";
  const again = await render(env);
  assert.match(textOf(again), /No rocks set for/, "still on Traction");
  assert.equal(env.calls.filter((c) => /\/cards$/.test(c[1])).length, 1,
    "and it didn't refetch the board");
});
