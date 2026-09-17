/**
 * Aging and the rebuilt Dashboard.
 *
 * The first test is the bug that started this: a comment on a card must not
 * make a job that has sat in one phase for three weeks look brand new. The old
 * dashboard read time since last activity, so it did exactly that.
 */
"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const BOARD_ID = "6939928cc816d7f7d1d2d7ba";   // Office Operations, per config.js
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const OPEN = [];
after(() => OPEN.forEach((d) => { try { d.window.close(); } catch (e) { /* gone */ } }));

const DAY = 86400000;
const iso = (d) => new Date(Date.now() + d * DAY).toISOString();

/**
 * Cut-down board config in the real shape: ordered stages with allowances, the
 * four Install lists sharing one phase, ReWork as an exception, two terminals.
 */
const BOARD = {
  stages: [
    { listId: "CAD", name: "CAD", order: 6, slaDays: 2, isWorkPhase: true },
    { listId: "PRINT", name: "Print CAD", order: 7, slaDays: 1, isWorkPhase: true },
    { listId: "ASM", name: "Assemble CNC", order: 8, slaDays: 3, isWorkPhase: true },
    { listId: "BLAST", name: "Sandblast / Powder Coat", order: 9, slaDays: 3, isWorkPhase: true },
    { listId: "REWORK", name: "ReWork", order: 10, slaDays: 1, isException: true, isWorkPhase: true },
    { listId: "INS1", name: "Install", phase: "Install", region: "North", order: 11, slaDays: 1, isWorkPhase: true },
    { listId: "INS2", name: "Install", phase: "Install", region: "South", order: 11, slaDays: 1, isWorkPhase: true },
    { listId: "BILL", name: "Billing", order: 12, slaDays: 3 },
    { listId: "DONE", name: "Job Closed / Done", order: 14, slaDays: null, isTerminal: "won" }
  ]
};

function card(id, list, opts = {}) {
  return {
    id,
    name: opts.name || ("Job " + id),
    idList: list,
    due: opts.due === undefined ? null : opts.due,
    dueComplete: !!opts.dueComplete,
    // Deliberately recent on every fixture: if anything still reads this field
    // for age, the tests below will catch it.
    dateLastActivity: iso(-0.01),
    shortUrl: "https://trello.com/c/" + id,
    pos: 100,
    economics: opts.economics || null,
    phaseWork: opts.work || null
  };
}

/** A Trello action of the kind that records a move into a list. */
const moved = (cardId, listId, daysAgo) => ({
  type: "updateCard", date: iso(-daysAgo),
  data: { card: { id: cardId }, listAfter: { id: listId } }
});
const created = (cardId, listId, daysAgo) => ({
  type: "createCard", date: iso(-daysAgo),
  data: { card: { id: cardId }, list: { id: listId } }
});

function boot({ cards = [], actions = [], fields = [], audit = [] } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="boardName"></div><div id="meName"></div><div id="meInitials"></div>
       <nav id="tabbar"></nav><main id="view"></main>
     </body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true }
  );
  const win = dom.window;
  const calls = [];

  win.eval(read("config.js"));
  // Every plugin-data write goes through WFStore. Nothing this suite drives
  // writes today, but the card panel it loads shares its code with screens
  // that do, and a missing WFStore is a ReferenceError nothing catches --
  // loaded in the position ops.html gives it, so the two stay in step.
  win.eval(read("lib/store.js"));
  win.eval(read("lib/board-extras.js"));
  win.eval(read("lib/stage.js"));

  win.WFRest = {
    request(t, pathname, params) {
      calls.push([pathname, params]);
      if (/\/actions$/.test(pathname)) return Promise.resolve(actions);
      return Promise.resolve([]);
    },
    write: () => Promise.resolve({}),
    getCardFieldsDisplay: () => Promise.resolve(fields),
    getCardDetail: (t, id) => Promise.resolve({
      id, idBoard: BOARD_ID, name: "Late job", desc: "", due: iso(-3),
      shortUrl: "https://trello.com/c/" + id,
      board: { name: "Office Operations" }, list: { name: "Assemble CNC" },
      labels: [], members: [], attachments: [], checklists: [], actions: []
    }),
    postComment: () => Promise.resolve({}),
    updateCard: () => Promise.resolve({}),
    setCheckItem: () => Promise.resolve({}),
    invalidateCard: () => {}
  };
  win.WFPricing = {
    RULE_TEXT: "a number or a range",
    fieldName: () => "$Value",
    getBoardAudit: () => Promise.resolve(audit)
  };
  win.WFRoster = { getRoster: () => Promise.resolve({ managers: [], phaseSpecialists: {} }) };
  win.Chart = function () {};

  win.eval(read("lib/phase.js"));
  win.eval(read("lib/aging.js"));
  win.eval(read("lib/cardview.js"));
  win.eval(read("lib/permissions.js"));
  win.eval(read("popups/ops.js"));
  win.eval(read("popups/cardpanel.js"));

  let def = null;
  const realTab = win.WFOps.tab;
  win.WFOps.tab = (d) => { if (d.id === "dashboard") def = d; return realTab(d); };
  win.eval(read("popups/tabs/dashboard.js"));

  const ctx = {
    t: { get: (s, v, k, d) => Promise.resolve(d), set: () => Promise.resolve() },
    // The real board id: WFStage.isExcluded treats an unmapped board as
    // entirely excluded, so a made-up id would filter every card away.
    board: { id: BOARD_ID, name: "Office Operations", members: [] },
    member: { username: "boss", fullName: "The Boss" },
    boardCfg: BOARD,
    roster: { managers: ["boss"], phaseSpecialists: {} },
    role: "manager",
    isManager: true,
    cards: () => Promise.resolve(cards),
    reload: () => Promise.resolve(),
    syncCard: () => Promise.resolve(),
    goTo: (id) => { ctx.wentTo = id; }
  };

  OPEN.push(dom);
  return { win, dom, def, ctx, calls, A: win.WFAging };
}

const textOf = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const $ = (n, sel) => Array.from(n.querySelectorAll(sel));

function render(env) {
  return Promise.resolve(env.def.render(env.ctx)).then((node) => {
    env.win.document.getElementById("view").appendChild(node);
    return node;
  });
}

/* ========================================================== the actual bug */

test("a comment does not reset how long a job has been in its phase", async () => {
  const env = boot({
    cards: [card("A", "BLAST")],
    actions: [moved("A", "BLAST", 21)]
  });
  const moves = await env.A.loadMoves(env.ctx.t, BOARD_ID);
  const t = env.A.timeInStage(moves, card("A", "BLAST"));

  // dateLastActivity on the fixture is seconds old; the answer must be 21 days.
  assert.ok(t.days > 20.9 && t.days < 21.1, "21 days, got " + t.days);
  assert.equal(t.known, true);
  assert.equal(t.atLeast, false);
  assert.equal(env.A.stagePhrase(t), "21 days");
});

test("the most recent arrival wins, so a job that bounced and came back is young", async () => {
  const env = boot({
    cards: [card("A", "ASM")],
    actions: [
      moved("A", "ASM", 30),      // first time through
      moved("A", "REWORK", 12),   // bounced
      moved("A", "ASM", 2)        // came back two days ago
    ]
  });
  const moves = await env.A.loadMoves(env.ctx.t, BOARD_ID);
  const t = env.A.timeInStage(moves, card("A", "ASM"));
  assert.ok(t.days > 1.9 && t.days < 2.1, "2 days since it came back, got " + t.days);
});

test("a card that never moved dates from when it was made", async () => {
  const env = boot({ cards: [card("A", "CAD")], actions: [created("A", "CAD", 5)] });
  const moves = await env.A.loadMoves(env.ctx.t, BOARD_ID);
  assert.ok(env.A.timeInStage(moves, card("A", "CAD")).days > 4.9);
});

test("beyond the window the answer is a floor, and says so", async () => {
  const env = boot({ cards: [card("A", "BILL")], actions: [] });
  const moves = await env.A.loadMoves(env.ctx.t, BOARD_ID);
  const t = env.A.timeInStage(moves, card("A", "BILL"));
  assert.equal(t.known, false);
  assert.equal(t.atLeast, true);
  assert.equal(t.days, env.A.WINDOW_DAYS);
  assert.equal(env.A.stagePhrase(t), env.A.WINDOW_DAYS + "+ days");
  assert.notEqual(env.A.stagePhrase(t), "90 days", "a floor must not read as a measurement");
});

test("the move history is asked for once, for the whole board, with a window", async () => {
  const env = boot({ cards: [card("A", "CAD"), card("B", "ASM"), card("C", "BLAST")] });
  await render(env);
  const actionCalls = env.calls.filter((c) => /\/actions$/.test(c[0]));
  assert.equal(actionCalls.length, 1, "one call, not one per card");
  assert.equal(actionCalls[0][0], "/boards/" + BOARD_ID + "/actions");
  assert.match(actionCalls[0][1].filter, /updateCard:idList/);
  assert.ok(actionCalls[0][1].since, "bounded by a window");
  assert.equal(actionCalls[0][1].limit, env.A.ACTION_LIMIT);
});

/* ============================================================ the forecast */

test("remaining work sums the phases ahead, counting Install once and skipping ReWork", () => {
  const { A } = boot();
  // From Assemble CNC: 3 + blast 3 + install 1 + billing 3 = 10. ReWork and the
  // terminal are excluded; the four Install lists count as one phase.
  assert.equal(A.remainingDays(BOARD, card("A", "ASM")), 10);
  assert.equal(A.remainingDays(BOARD, card("A", "BILL")), 3, "last real phase");
  // Standing in ReWork, its own allowance does count -- the job is there now.
  assert.equal(A.remainingDays(BOARD, card("A", "REWORK")), 5);
  assert.equal(A.remainingDays(BOARD, card("A", "NOPE")), null, "unmapped list");
});

test("the verdict is work-left against time-left, not phase allowance alone", () => {
  const { A } = boot();
  const moves = { byCard: {}, windowDays: 90 };

  // Ten days of work ahead from Assemble CNC.
  assert.equal(A.forecast(BOARD, moves, card("A", "ASM", { due: iso(30) })).verdict, "on-track");
  assert.equal(A.forecast(BOARD, moves, card("A", "ASM", { due: iso(11) })).verdict, "tight");
  assert.equal(A.forecast(BOARD, moves, card("A", "ASM", { due: iso(4) })).verdict, "at-risk");
  assert.equal(A.forecast(BOARD, moves, card("A", "ASM", { due: iso(-2) })).verdict, "late");
  assert.equal(A.forecast(BOARD, moves, card("A", "ASM")).verdict, "no-date");
  assert.equal(
    A.forecast(BOARD, moves, card("A", "ASM", { due: iso(-9), dueComplete: true })).verdict,
    "done", "complete is not late");
  assert.equal(A.forecast(BOARD, moves, card("A", "NOPE", { due: iso(5) })).verdict, "unmapped");

  // Same phase, same age, different date -- the thing the old number couldn't do.
  const soon = A.forecast(BOARD, moves, card("A", "ASM", { due: iso(3) }));
  const later = A.forecast(BOARD, moves, card("B", "ASM", { due: iso(60) }));
  assert.notEqual(soon.verdict, later.verdict);
});

test("the explanation shows the subtraction", () => {
  const { A } = boot();
  const moves = { byCard: {}, windowDays: 90 };
  const f = A.forecast(BOARD, moves, card("A", "ASM", { due: iso(4) }));
  assert.match(A.explain(f), /10 days of work left/);
  assert.match(A.explain(f), /until it's due/);
  assert.match(A.explain(A.forecast(BOARD, moves, card("A", "ASM", { due: iso(-3) }))),
    /due 3 days ago/);
  assert.match(A.explain(A.forecast(BOARD, moves, card("A", "ASM"))), /no due date/);
});

test("phase overrun is tracked separately from the due-date verdict", () => {
  const { A } = boot();
  const stage = BOARD.stages.find((s) => s.listId === "ASM");   // 3 days
  assert.equal(A.stageOverrun(stage, { days: 1.5 }), 0.5);
  assert.equal(A.overrunTone(A.stageOverrun(stage, { days: 1.5 })), "go");
  assert.equal(A.overrunTone(A.stageOverrun(stage, { days: 4 })), "warn");
  assert.equal(A.overrunTone(A.stageOverrun(stage, { days: 7 })), "late");
  assert.equal(A.stageOverrun({ slaDays: null }, { days: 9 }), null);
});

test("worst first, not oldest first", () => {
  const { A } = boot();
  const moves = { byCard: {}, windowDays: 90 };
  const rows = A.rows(BOARD, moves, [
    card("old-but-fine", "ASM", { due: iso(90) }),
    card("late", "ASM", { due: iso(-1) }),
    card("risky", "ASM", { due: iso(2) }),
    card("tight", "ASM", { due: iso(11) })
  ]);
  const order = A.summary(rows).worstFirst.map((r) => r.card.id);
  assert.deepEqual(order, ["late", "risky", "tight", "old-but-fine"]);
});

test("terminal lists are left out of the rollup entirely", () => {
  const { A } = boot();
  const rows = A.rows(BOARD, { byCard: {}, windowDays: 90 }, [
    card("a", "ASM", { due: iso(5) }),
    card("z", "DONE", { due: iso(-40) })
  ]);
  assert.deepEqual(rows.map((r) => r.card.id), ["a"], "a closed job is not late");
});

test("a truncated or failed history is reported, not hidden", async () => {
  const many = Array.from({ length: 1000 }, (_, i) => moved("c" + i, "ASM", 1));
  const env = boot({ cards: [card("A", "ASM")], actions: many });
  const moves = await env.A.loadMoves(env.ctx.t, BOARD_ID);
  assert.equal(moves.truncated, true);
  assert.equal(moves.ok, true);

  const broken = boot({ cards: [] });
  broken.win.WFRest.request = () => Promise.reject(new Error("nope"));
  const m2 = await broken.A.loadMoves(broken.ctx.t, BOARD_ID);
  assert.equal(m2.ok, false);
  assert.deepEqual(m2.byCard, {});
});

/* ========================================================== the rendered tab */

test("the dashboard shows real time in phase, never days-since-activity", async () => {
  const env = boot({
    cards: [card("A", "BLAST", { due: iso(1), name: "Cedar Hills fence run A" })],
    actions: [moved("A", "BLAST", 21)]
  });
  const node = await render(env);
  const txt = textOf(node);
  assert.match(txt, /21 days in Sandblast \/ Powder Coat/);
  assert.ok(!/just now/.test(txt), "the recent comment must not show as the age");
});

test("the meter measures whether work will land, not whether a phase ran long", async () => {
  const env = boot({
    cards: [
      card("ok", "ASM", { due: iso(60) }),
      card("tight", "ASM", { due: iso(11) }),
      card("risk", "ASM", { due: iso(3) }),
      card("late", "ASM", { due: iso(-4) }),
      card("nodate", "ASM")
    ],
    actions: []
  });
  const node = await render(env);
  const legend = $(node, ".wf-legend-row").map(textOf);
  assert.ok(legend.some((l) => /On track\s*1 job/.test(l)));
  assert.ok(legend.some((l) => /Cutting it fine\s*1 job/.test(l)));
  assert.ok(legend.some((l) => /Won't make it\s*1 job/.test(l)));
  assert.ok(legend.some((l) => /Past its date\s*1 job/.test(l)));
  assert.ok(legend.some((l) => /No date set\s*1 job/.test(l)),
    "a job with no date is a visible gap, not quietly on track");
  assert.match(textOf(node), /Will it land\?/);
});

test("Needs a look lists only jobs heading for a miss, worst first, with the sums", async () => {
  const env = boot({
    cards: [
      card("fine", "ASM", { due: iso(60), name: "Fine job" }),
      card("late", "ASM", { due: iso(-3), name: "Late job" }),
      card("risk", "ASM", { due: iso(2), name: "Risky job" })
    ],
    actions: [moved("late", "ASM", 9), moved("risk", "ASM", 1)]
  });
  const node = await render(env);
  const rows = $(node, "button.wf-row").map(textOf);
  assert.equal(rows.length, 2, "the healthy job is not on the list");
  assert.match(rows[0], /Late job/);
  assert.match(rows[0], /past its date/);
  assert.match(rows[1], /Risky job/);
  assert.match(rows[1], /10 days of work left/);
  assert.ok(!rows.join(" ").includes("Fine job"));
});

test("nothing heading for a miss says so plainly", async () => {
  const env = boot({ cards: [card("ok", "ASM", { due: iso(60) })], actions: [] });
  assert.match(textOf(await render(env)), /Nothing is heading for a missed date/);
});

test("a row is a button and opens the card itself, not a summary of it", async () => {
  const env = boot({
    cards: [card("late", "ASM", { due: iso(-3), name: "Late job",
                                  economics: { value: 12000, cost: 8000 } })],
    actions: [moved("late", "ASM", 6)],
    fields: [{ name: "Job Value (QB)", display: "12000" },
             { name: "Job Cost (QB)", display: "8000" }]
  });
  const node = await render(env);
  const row = $(node, "button.wf-row")[0];
  assert.ok(row, "the whole row is clickable");
  row.dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const doc = env.win.document;
  const sheet = doc.querySelector(".wf-cp-sheet");
  assert.ok(sheet, "the card panel opened over the dashboard");
  const t = textOf(sheet);
  assert.match(t, /Late job/);
  // The verdict travels with the card, so the reason the row was on the list
  // is still on screen once the card is open.
  assert.match(t, /past its date/);
  // Custom fields are read live off the card -- the chat-side connector can't
  // see them, the Power-Up always could.
  assert.match(t, /Job Value \(QB\)/);
  assert.match(t, /12000/);
  assert.ok($(sheet, "a").some((a) => /Trello/.test(textOf(a))),
    "Trello is still one click away, just no longer the only way out");
});

test("the card panel copes with a card that has no custom fields filled in", async () => {
  const env = boot({
    cards: [card("late", "ASM", { due: iso(-3) })],
    actions: [], fields: []
  });
  const node = await render(env);
  $(node, "button.wf-row")[0].dispatchEvent(new env.win.Event("click"));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.match(textOf(env.win.document.body), /No card fields filled in/);
});

test("the caveats are stated rather than papered over", async () => {
  const env = boot({
    cards: [card("old", "BILL", { due: iso(5) }), card("nodate", "ASM")],
    actions: []
  });
  const txt = textOf(await render(env));
  assert.match(txt, /longer than 90 days/, "floors are disclosed");
  assert.match(txt, /no due date, so nothing can be forecast/);
});

test("the headline counts jobs that will miss, not jobs over a phase allowance", async () => {
  const env = boot({
    cards: [
      card("late", "ASM", { due: iso(-2) }),
      card("risk", "ASM", { due: iso(1) }),
      card("slowbutfine", "ASM", { due: iso(90) })
    ],
    // The healthy job has been in its phase four times its allowance -- the old
    // dashboard would have called it the problem. It isn't one.
    actions: [moved("slowbutfine", "ASM", 12)]
  });
  const node = await render(env);
  const stat = $(node, ".wf-stat").find((s) => /Won't make it/.test(textOf(s)));
  assert.match(textOf(stat), /2/);
  assert.match(textOf(stat), /1 already past, 1 heading that way/);
});
