/**
 * The dashboard, against the real files.
 *
 * The assertion this file exists for: no number on this page is a dead end.
 * The old dashboard could tell a manager that four jobs wouldn't make their
 * date and offered no way to ask which four except leaving for Trello and
 * losing the page. Every count here is a button, and the job behind it opens
 * the card in the same overlay.
 *
 * The second thing it holds: the drill-down is ONE overlay with two modes, not
 * two stacked dialogs. Stacking would give a manager two Escape presses and two
 * things to close on a screen they read between other tasks.
 */
"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const OPEN = [];
after(() => OPEN.forEach((d) => { try { d.window.close(); } catch (e) { /* gone */ } }));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const DAY = 86400000;
const iso = (d) => new Date(Date.now() + d * DAY).toISOString();

/** The real board id -- WFStage.isExcluded filters every card off an unmapped
 *  board, which silently empties the page if a fixture invents one. */
const BOARD_ID = "6939928cc816d7f7d1d2d7ba";

const BOARD = {
  stages: [
    { listId: "LA", name: "Assemble CNC", order: 8, slaDays: 3, isWorkPhase: true },
    { listId: "LS", name: "Sandblast / Powder Coat", order: 9, slaDays: 3, isWorkPhase: true },
    { listId: "LX", name: "Billing", order: 12, slaDays: 3, isTerminal: false }
  ]
};

const KEV = { username: "kevinmoss", fullName: "Kevin Moss" };

function card(id, list, opts = {}) {
  return {
    id,
    name: opts.name || ("#" + id + " — job " + id),
    idList: list,
    pos: 100,
    due: opts.due === undefined ? iso(30) : opts.due,
    dueComplete: !!opts.dueComplete,
    dateLastActivity: iso(-1),
    shortUrl: "https://trello.com/c/" + id,
    idBoard: BOARD_ID,
    economics: opts.economics || null,
    phaseWork: opts.claimed
      ? { listId: list, claimedBy: KEV,
          segments: [{ start: iso(-0.1) }], percentComplete: 40 }
      : null
  };
}

function boot({ role = "manager", cards = [], moves = {} } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="boardName"></div><div id="meName"></div><div id="meInitials"></div>
       <nav id="tabbar"></nav><main id="view"></main>
     </body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true }
  );
  const win = dom.window;

  win.eval(read("config.js"));
  win.eval(read("lib/board-extras.js"));
  win.eval(read("lib/stage.js"));

  const detailCalls = [];
  win.WFRest = {
    request: () => Promise.resolve([]),
    write: () => Promise.resolve({}),
    getCardFieldsDisplay: () => Promise.resolve([
      { name: "Style", display: "RG-4 picket" },
      { name: "$Value", display: "42500" }
    ]),
    getCardDetail: (t, id) => {
      detailCalls.push(id);
      return Promise.resolve({
        id, idBoard: BOARD_ID, name: "#" + id + " — job " + id,
        desc: "Ranch entry gate.", due: iso(3), shortUrl: "https://trello.com/c/" + id,
        board: { name: "Office Operations" }, list: { name: "Assemble CNC" },
        labels: [{ id: "l1", name: "GATE", color: "green" }],
        members: [{ id: "m1", fullName: "Kevin Moss", initials: "KM" }],
        attachments: [], checklists: [], actions: []
      });
    },
    postComment: () => Promise.resolve({}),
    updateCard: () => Promise.resolve({}),
    setCheckItem: () => Promise.resolve({}),
    invalidateCard: () => {}
  };
  win.WFRoster = { getRoster: () => Promise.resolve({ managers: [], phaseSpecialists: {} }) };
  win.WFPricing = { getBoardAudit: () => Promise.resolve([]) };
  win.Chart = function () {};

  win.eval(read("lib/phase.js"));
  win.eval(read("lib/aging.js"));
  win.eval(read("lib/cardview.js"));
  win.eval(read("popups/ops.js"));
  win.eval(read("popups/cardpanel.js"));

  // No REST history in the fixture: WFAging.loadMoves catches and returns an
  // empty index, so every card reads as "in stage at least the window".
  win.WFAging.loadMoves = () => Promise.resolve(
    Object.assign({ byCard: {}, windowDays: 90, truncated: false, ok: true }, moves));

  let def = null;
  const realTab = win.WFOps.tab;
  win.WFOps.tab = (d) => { def = d; return realTab(d); };
  win.eval(read("popups/tabs/dashboard.js"));

  const ctx = {
    t: { get: () => Promise.resolve(null), set: () => Promise.resolve() },
    board: { id: BOARD_ID, name: "Office Operations", members: [KEV] },
    member: KEV,
    boardCfg: BOARD,
    roster: { managers: [], phaseSpecialists: {} },
    role,
    isManager: role === "manager",
    cards: () => Promise.resolve(cards),
    reload: () => Promise.resolve(),
    goTo: () => {}
  };

  OPEN.push(dom);
  return { win, dom, def, ctx, detailCalls };
}

const textOf = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const $ = (n, sel) => Array.from(n.querySelectorAll(sel));
const tick = () => new Promise((r) => setTimeout(r, 0));

function render(env) {
  return Promise.resolve(env.def.render(env.ctx)).then((node) => {
    env.win.document.getElementById("view").appendChild(node);
    return node;
  });
}

/** Two past their date, one comfortably on track. */
const MIXED = [
  card("A", "LA", { due: iso(-5), name: "#2407 Kimball Shop — mezzanine stair" }),
  card("B", "LA", { due: iso(-2), name: "#2418 Harmon Ranch — 42' entry gate" }),
  card("C", "LA", { due: iso(60), name: "#2440 Bear Hollow — pergola frame", claimed: true })
];

/* ====================================================== every count is a button */

test("the meter's legend rows are buttons, one per verdict", async () => {
  const env = boot({ cards: MIXED });
  const node = await render(env);

  const rows = $(node, ".wf-legend-row");
  assert.equal(rows.length, 5);
  rows.forEach((r) => assert.equal(r.tagName, "BUTTON"));

  const live = rows.filter((r) => !r.disabled);
  assert.ok(live.length >= 1, "at least one bucket has jobs behind it");
  // A bucket with nothing in it is disabled rather than opening an empty list.
  const dead = rows.filter((r) => r.disabled);
  dead.forEach((r) => assert.match(textOf(r), /0 jobs/));
});

test("clicking a legend row lists exactly the jobs in that bucket", async () => {
  const env = boot({ cards: MIXED });
  const node = await render(env);

  const past = $(node, ".wf-legend-row").find((r) => /Past its date/.test(textOf(r)));
  assert.ok(past && !past.disabled);
  past.dispatchEvent(new env.win.Event("click"));

  const sheet = env.win.document.querySelector(".wf-cp-sheet");
  assert.ok(sheet, "the drill-down opened");
  const t = textOf(sheet);
  assert.match(t, /Kimball Shop/);
  assert.match(t, /Harmon Ranch/);
  assert.ok(!/Bear Hollow/.test(t), "the on-track job is not in the late bucket");
  assert.match(t, /2 jobs/);
});

test("the 'Won't make it' stat tile opens the same list", async () => {
  const env = boot({ cards: MIXED });
  const node = await render(env);

  const tile = $(node, ".wf-stat").find((s) => /Won't make it/.test(textOf(s)));
  assert.ok(tile, "the tile is on the page");
  assert.equal(tile.getAttribute("role"), "button");
  tile.dispatchEvent(new env.win.Event("click"));

  const sheet = env.win.document.querySelector(".wf-cp-sheet");
  assert.ok(sheet);
  assert.match(textOf(sheet), /Kimball Shop/);
});

test("a stat tile with nothing behind it is left alone, not made a dead button", async () => {
  const env = boot({ cards: [card("C", "LA", { due: iso(60) })] });
  const node = await render(env);
  const tile = $(node, ".wf-stat").find((s) => /Won't make it/.test(textOf(s)));
  assert.equal(tile.getAttribute("role"), null);
});

/* ============================================== list -> card -> back to the list */

test("picking a job swaps the list for the card, in the same overlay", async () => {
  const env = boot({ cards: MIXED });
  const node = await render(env);

  $(node, ".wf-legend-row").find((r) => /Past its date/.test(textOf(r)))
    .dispatchEvent(new env.win.Event("click"));

  const doc = env.win.document;
  assert.equal($(doc, ".wf-cp-sheet").length, 1);

  const rows = $(doc, ".wf-cp-sheet .wf-cp-file");
  assert.equal(rows.length, 2);
  rows[0].dispatchEvent(new env.win.Event("click"));
  await tick();

  // Still one overlay -- the card replaced the list rather than stacking on it.
  assert.equal($(doc, ".wf-cp-sheet").length, 1, "no second dialog");
  assert.equal(env.detailCalls.length, 1, "the card was actually fetched");
  assert.match(textOf(doc.querySelector(".wf-cp-sheet")), /Office Operations › Assemble CNC/);
});

test("Back returns to the list you came from", async () => {
  const env = boot({ cards: MIXED });
  const node = await render(env);
  const doc = env.win.document;

  $(node, ".wf-legend-row").find((r) => /Past its date/.test(textOf(r)))
    .dispatchEvent(new env.win.Event("click"));
  $(doc, ".wf-cp-sheet .wf-cp-file")[0].dispatchEvent(new env.win.Event("click"));
  await tick();

  const back = $(doc, ".wf-cp-sheet .wf-cp-x")[0];
  assert.match(back.textContent, /Back/);
  back.dispatchEvent(new env.win.Event("click"));

  assert.equal($(doc, ".wf-cp-sheet").length, 1, "still open");
  assert.equal($(doc, ".wf-cp-sheet .wf-cp-file").length, 2, "back on the list");
});

test("a row in 'Needs a look' goes straight to the card, skipping the list", async () => {
  const env = boot({ cards: MIXED });
  const node = await render(env);

  const rows = $(node, "button.wf-row");
  assert.ok(rows.length >= 1);
  rows[0].dispatchEvent(new env.win.Event("click"));
  await tick();

  const sheet = env.win.document.querySelector(".wf-cp-sheet");
  assert.ok(sheet);
  // The row already said why the job is here; an intermediate summary would be
  // a click that told the reader nothing.
  assert.equal($(sheet, ".wf-cp-file").length, 0, "no list in between");
  assert.equal(env.detailCalls.length, 1);
});

/* ============================================================ the money rule */

test("the card panel hides financial fields from the shop and says how many", async () => {
  const env = boot({ role: "worker", cards: MIXED });
  // The dashboard tab is manager-only, so drive the panel directly -- this is
  // the same panel the Floor tab puts in front of a welder.
  const host = env.win.document.getElementById("view");
  host.appendChild(env.win.WFCardPanel.inline(
    Object.assign({}, env.ctx, { role: "worker" }), { id: "A" }, {}));
  await tick();
  await tick();

  const t = textOf(host);
  assert.match(t, /RG-4 picket/, "the style is shop information");
  assert.ok(!/42500/.test(t), "the job value is not");
  assert.match(t, /1 field is costing information/);
});

test("a manager sees the same card with the money on it", async () => {
  const env = boot({ cards: MIXED });
  const host = env.win.document.getElementById("view");
  host.appendChild(env.win.WFCardPanel.inline(env.ctx, { id: "A" }, {}));
  await tick();
  await tick();

  const t = textOf(host);
  assert.match(t, /42500/);
  assert.ok(!/costing information/.test(t));
});

test("the shop gets no editable title or due date; a manager does", async () => {
  const env = boot({ cards: MIXED });
  const host = env.win.document.getElementById("view");

  host.appendChild(env.win.WFCardPanel.inline(
    Object.assign({}, env.ctx, { role: "worker" }), { id: "A" }, {}));
  await tick(); await tick();
  assert.equal($(host, '.wf-cp-title[contenteditable="true"]').length, 0);
  assert.equal($(host, 'input[type="datetime-local"]').length, 0);

  host.textContent = "";
  host.appendChild(env.win.WFCardPanel.inline(env.ctx, { id: "A" }, {}));
  await tick(); await tick();
  assert.equal($(host, '.wf-cp-title[contenteditable="true"]').length, 1);
  assert.equal($(host, 'input[type="datetime-local"]').length, 1);
});

test("a card that won't load says so and still offers Trello", async () => {
  const env = boot({ cards: MIXED });
  env.win.WFRest.getCardDetail = () => Promise.reject(new Error("network down"));
  const host = env.win.document.getElementById("view");
  host.appendChild(env.win.WFCardPanel.inline(
    env.ctx, { id: "A", shortUrl: "https://trello.com/c/A" }, {}));
  await tick(); await tick();

  const t = textOf(host);
  assert.match(t, /network down/);
  assert.match(t, /Trello/);
});
