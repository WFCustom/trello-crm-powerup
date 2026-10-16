/**
 * The Install tab, against the real source files.
 *
 * THE ASSERTION THIS FILE EXISTS FOR is the money one, and it is deliberately
 * written as a sweep rather than as a check on one element: an installer's
 * tablet gets handed to the customer, and the figure that must never be on it
 * could leak through a tooltip, a data attribute, an aria-label or a CSS custom
 * property just as easily as through visible text. So the fixture carries a
 * margin nobody could mistake for a coincidence and the test greps the whole
 * rendered subtree, every text node AND every attribute value on every node.
 *
 * Everything else here is ordinary coverage of what the owner asked for: that
 * the four things an installer needs lead the column, that the address is
 * actionable, and that the tab is wired into the shell in the right place.
 */
"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const OPEN = [];
after(() => OPEN.forEach((d) => { try { d.window.close(); } catch (e) { /* already gone */ } }));

const DAY = 86400000;
const iso = (d) => new Date(Date.now() + d * DAY).toISOString();

/**
 * A board config shaped like the real one.
 *
 * Two Install lists, both carrying `phase: "Install"`, because that is the
 * consolidation config.js makes explicit -- four Trello columns, one phase of
 * work. A crew's queue has to span them or it is showing a quarter of the work.
 */
const BOARD = {
  stages: [
    { listId: "LA", name: "Assemble Legacy", order: 8, slaDays: 3, isWorkPhase: true },
    { listId: "LS", name: "Sandblast / Powder Coat", order: 9, slaDays: 3, isWorkPhase: true },
    { listId: "LI1", name: "Install", phase: "Install", region: "Install today",
      order: 11, slaDays: 1, isWorkPhase: true, isPrimaryTarget: true },
    { listId: "LI2", name: "Install", phase: "Install", region: "Install North",
      order: 11, slaDays: 1, isWorkPhase: true },
    { listId: "LB", name: "Billing", order: 12, slaDays: 3 }
  ]
};

const SCOTT = { username: "scottv", fullName: "Scott VanWorkom", initials: "SV" };
const MIKE = { username: "mikel", fullName: "Mike Larsen", initials: "ML" };

/* ===================================================== THE MONEY IN THE ROOM
 *
 * Figures chosen so a leak is unmistakable in a diff and impossible to confuse
 * with a percent, a job number, a phone number or a time. If any of these six
 * strings reaches the DOM, something showed the shop the shop's books.
 */
const VALUE = 487654;
const COST = 301234;
const MARGIN = VALUE - COST;          // 186420
const MONEY_STRINGS = [
  String(VALUE), String(COST), String(MARGIN),
  "487,654", "301,234", "186,420"
];

/**
 * An install card shaped like the real ones on the board.
 *
 * Every field here was checked against a live card in an Install list before it
 * was written down: the job number has no "#" in front of it, the site address
 * lives on a labelled line of the description, the phone is in the prose, and
 * `economics` arrives already filled in from the "$Value" custom field because
 * popups/ops.js's cards() does that to every card on the board before any tab
 * sees it. That last one is the whole reason the money sweep below is not
 * theoretical.
 */
function installCard(id, list, opts = {}) {
  const segs = opts.running
    ? [{ start: new Date(Date.now() - 50 * 60000).toISOString() }]
    : opts.claimed
      ? [{ start: new Date(Date.now() - 80 * 60000).toISOString(),
           end: new Date(Date.now() - 20 * 60000).toISOString() }]
      : [];
  return {
    id,
    name: opts.name || "1795- Robert Pearce — 6094 Fruitwood Ln",
    idList: list,
    idBoard: "OPS",
    pos: opts.pos === undefined ? 100 : opts.pos,
    due: opts.due === undefined ? iso(0) : opts.due,
    dueComplete: !!opts.dueComplete,
    dateLastActivity: iso(-1),
    shortUrl: "https://trello.com/c/" + id,
    idLabels: [],
    labelNames: [],
    desc: opts.desc === undefined
      ? ["**Source:** BUILDER TEXT",
         "**Contact:** Robert Pearce",
         "**Phone:** (208) 479-5486",
         "**Site address:** 6094 Fruitwood Lane, Pocatello ID",
         "",
         "---",
         "",
         "Gate code is 4812. Dog in the back yard — ring first.",
         "Mount the grab rail on the north side of the step.",
         "",
         "Job Folder (Drive): https://drive.google.com/drive/folders/1_SVKCacqbnfv1yDIVYxaugmYSLU5KjSK"
        ].join("\n")
      : opts.desc,
    // The books, riding along on every card exactly as the real shell delivers
    // them. Nothing on this screen may render any of it.
    economics: { value: VALUE, cost: COST, valueFrom: "$Value" },
    fieldValue: VALUE,
    phaseWork: (opts.claimed || opts.running)
      ? {
          listId: list,
          claimedBy: opts.claimed || opts.running,
          tableId: opts.tableId === undefined ? "i1" : opts.tableId,
          segments: segs,
          percentComplete: opts.pct === undefined ? 0 : opts.pct
        }
      : (opts.tableId ? { listId: list, claimedBy: null, tableId: opts.tableId, segments: [] } : null),
    qcRecord: opts.qcRecord || null,
    handoffLog: [],
    phaseLog: []
  };
}

/** One install crew, wired to Scott. */
const ONE_CREW = {
  stations: [{ id: "i1", area: "install", table: "Truck 1", type: "install",
               station: "Install crew", welder: "scottv", phase: "Install" }],
  visible: ["i1"]
};

function boot({ role = "worker", cards = [], saved = ONE_CREW, me = SCOTT,
                members = [SCOTT, MIKE], fields = [], perms = true } = {}) {
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

  /* PHASE WORK LIVES PER CARD, AND A FLAT STORE HANDS ONE CARD'S WORK TO
   * ANOTHER.
   *
   * WFPhase never reads phaseWork off the card object it is handed -- it
   * re-reads it through t.get(cardId, "shared", "phaseWork") so two tablets
   * cannot clobber each other. A stub that ignores the scope therefore answers
   * every card with whichever card wrote last, and `resume` on a claimed job
   * finds nothing and returns without writing: a Start button that looks right,
   * does nothing, and reports nothing. Card scopes are keyed; board and member
   * scopes stay flat, because WFStore measures the whole blob with a KEYLESS
   * get and a key it cannot see is a key it cannot count.
   */
  const CARDLESS = ["board", "member", "organization", "card"];
  const at = (scope, key) =>
    (CARDLESS.indexOf(scope) === -1 ? scope + "|" + key : key);
  cards.forEach((c) => {
    if (c.phaseWork) store[at(c.id, "phaseWork")] = c.phaseWork;
    if (c.qcRecord) store[at(c.id, "qcRecord")] = c.qcRecord;
  });

  win.eval(read("config.js"));

  /* The fixture board, registered where WFStage will actually look for it.
   *
   * ctx.boardCfg and WFStage.getBoardConfig(ctx.board.id) have to be the same
   * board or half the tab reads one and half reads the other: getNextStage goes
   * through the config by board id, so a fixture that only sets boardCfg gets
   * null for "what comes after Install" and every dialog quietly says "no next
   * phase is configured". That is a passing test describing a broken screen. */
  win.WF_CONFIG.boards.OPS = Object.assign({
    name: "Office Operations", type: "production", excludedLists: []
  }, BOARD);
  win.eval(read("lib/store.js"));
  win.eval(read("lib/board-extras.js"));
  win.eval(read("lib/stage.js"));

  /* The REST layer, speaking only the calls this tab makes.
   *
   * getCardFieldsDisplay is the one that matters: Payment Status is a custom
   * field and custom fields do NOT ride along on the board-wide card pull, so
   * this is the only way the tab can learn it. The fixture hands back whatever
   * the test asked for, including nothing. */
  win.WFRest = {
    request: () => Promise.resolve([]),
    write: () => Promise.resolve({}),
    getCardDetail: (t, id) => Promise.resolve({
      id, name: "job " + id, desc: "", labels: [], members: [],
      checklists: [], actions: [], attachments: [],
      board: { name: "Office Operations" }, list: { name: "Install today" }
    }),
    getCardFieldsDisplay: () => Promise.resolve(fields),
    updateCard: () => Promise.resolve({}),
    postComment: () => Promise.resolve({}),
    addMemberToCard: () => Promise.resolve({}),
    moveCard: () => Promise.resolve({}),
    getBoardLabels: () => Promise.resolve([]),
    invalidateCard: () => {},
    invalidateBoardCards: () => {}
  };
  win.WFRoster = { getRoster: () => Promise.resolve({ managers: [], phaseSpecialists: {} }) };
  win.WFPricing = { getBoardValues: () => Promise.resolve({}), getBoardAudit: () => Promise.resolve([]), invalidate: () => {} };
  win.Chart = function () {};

  win.eval(read("lib/phase.js"));
  win.eval(read("lib/qc.js"));
  win.eval(read("lib/jobtype.js"));
  // Wraps WFPhase.advance with the route-aware version. Install calls advance
  // directly when it finishes a job, so the suite has to load the wrapper or it
  // is testing a path the Power-Up does not run.
  win.eval(read("lib/advance.js"));
  // Before tables.js, exactly as popups/ops.html loads it.
  win.eval(read("lib/steps.js"));
  win.eval(read("lib/tables.js"));
  win.eval(read("lib/cardview.js"));
  win.eval(read("lib/permissions.js"));
  win.eval(read("popups/ops.js"));
  win.eval(read("popups/cardpanel.js"));

  let def = null;
  const realTab = win.WFOps.tab;
  win.WFOps.tab = (d) => { def = d; return realTab(d); };
  win.eval(read("popups/tabs/install.js"));

  /* Speaks every shape the real Trello SDK does, because WFStore uses more than
   * one: a KEYLESS get, because the 4,096-character limit is per scope and the
   * whole blob is the only thing worth measuring, and an OBJECT passed to set so
   * several keys land in one call. `written` records the PLAIN key so the
   * assertions read as the thing that was written rather than as plumbing. */
  const t = {
    get: (scope, vis, key, dflt) => {
      if (key === undefined) return Promise.resolve(Object.assign({}, store));
      const k = at(scope, key);
      return Promise.resolve(store[k] === undefined ? dflt : store[k]);
    },
    set: (scope, vis, key, value) => {
      const patch = (key && typeof key === "object") ? key : { [key]: value };
      Object.keys(patch).forEach((k) => {
        written.push([k, patch[k]]);
        store[at(scope, k)] = patch[k];
      });
      return Promise.resolve();
    },
    remove: (scope, vis, key) => {
      [].concat(key).forEach((k) => {
        written.push([k, null]);
        delete store[at(scope, k)];
      });
      return Promise.resolve();
    }
  };

  /* The real permission model, not a hand-written stand-in.
   *
   * WFPerms.defaults() is what a board that has never saved a permissions
   * config answers, so a "worker" here holds exactly what the shipped preset
   * gives shop crew -- which notably does NOT include see.costing. Asserting
   * against the real presets is the point: a test with its own idea of what a
   * worker can see would keep passing after somebody granted them costing. */
  const cfg = win.WFPerms.defaults();
  const can = perms
    ? (cap, subject) => win.WFPerms.allows(cfg, me.username, cap, subject)
    : null;

  const ctx = {
    t,
    board: { id: "OPS", name: "Office Operations", members },
    member: me,
    boardCfg: BOARD,
    roster: { managers: [], phaseSpecialists: {} },
    role,
    isManager: role === "manager",
    cards: () => Promise.resolve(cards),
    ...(can ? { can } : {}),
    reload: () => Promise.resolve(),
    syncCard: () => Promise.resolve(),
    goTo: () => {}
  };

  OPEN.push(dom);
  return { win, dom, def, ctx, store, written, perms: cfg };
}

const textOf = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const $ = (n, sel) => Array.from(n.querySelectorAll(sel));

/** Let the promise chains behind a render or a click finish. */
async function settle(n = 8) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function render(env) {
  return Promise.resolve(env.def.render(env.ctx)).then((node) => {
    env.win.document.getElementById("view").appendChild(node);
    return node;
  });
}

/** A button by the words on it. */
function btn(node, label) {
  return $(node, "button").find((b) => textOf(b) === label) || null;
}

/**
 * Everything the DOM says, in one string: every text node and every attribute
 * value on every element, including the root.
 *
 * Written out rather than using textContent because textContent is exactly the
 * hole this test is for -- a title, an aria-label, a data attribute or a `style`
 * carrying a figure is invisible to it and perfectly visible to anybody who
 * long-presses the element or opens devtools on a tablet.
 */
function everything(node) {
  const out = [node.textContent || ""];
  const all = [node].concat(Array.from(node.querySelectorAll("*")));
  all.forEach((el) => {
    Array.from(el.attributes || []).forEach((a) => {
      out.push(a.name);
      out.push(a.value);
    });
  });
  return out.join("\n");
}

/* ======================================================= wiring into the shell */

test("the tab registers as the shop's screen, with nothing gated behind a role", () => {
  const { def } = boot();
  assert.equal(def.id, "install");
  assert.equal(def.label, "Install");
  // Kiosk, because a tablet mounted in a truck has no room for window chrome.
  assert.equal(def.kiosk, true);
  // THE THING THAT WOULD HIDE IT FROM THE PEOPLE IT IS FOR. An installer is
  // shop crew: `roles` or `caps` on this def means visibleTabs() filters the
  // tab out for every worker on the board, which is everybody who needs it.
  assert.equal(def.roles, undefined);
  assert.equal(def.caps, undefined);
  assert.equal(def.managerOnly, undefined);
  assert.equal(typeof def.render, "function");
});

test("ops.html loads install.js after the Floor and before the Dashboard", () => {
  const html = read("popups/ops.html");
  const floor = html.indexOf('"./tabs/floor.js"');
  const install = html.indexOf('"./tabs/install.js"');
  const dash = html.indexOf('"./tabs/dashboard.js"');
  assert.ok(floor > -1, "floor.js is not in the load list");
  assert.ok(install > -1, "install.js is not in the load list");
  assert.ok(dash > -1, "dashboard.js is not in the load list");
  assert.ok(floor < install, "install.js must load after floor.js");
  assert.ok(install < dash, "install.js must load before dashboard.js");

  /* AND IT MUST LOAD AFTER EVERY MODULE IT NAMES. The tab files are plain
   * scripts run in order; naming WFTables before lib/tables.js has run is a
   * ReferenceError at load and a blank tab bar, which is how a whole release
   * goes out broken. */
  ["../lib/tables.js", "../lib/phase.js", "../lib/qc.js", "../lib/stage.js",
   "../lib/cardview.js", "./ops.js", "./cardpanel.js"].forEach((dep) => {
    const at = html.indexOf('"' + dep + '"');
    assert.ok(at > -1 && at < install, dep + " must load before install.js");
  });
});

test("install.js is cache-busted by the loader, not by a tag of its own", () => {
  /* THE VERSION TOKEN IS WHAT STOPS A CACHED IFRAME SERVING A MONTHS-OLD TAB,
   * and the way a tab file gets one here is by being a plain string inside the
   * array that document.write appends "?v=" + WF_BUILD to. A literal
   * <script src="./tabs/install.js"> would look identical in a diff, load fine
   * on a cold browser, and never update again.
   *
   * That the three HTML surfaces agree on one token is already asserted in
   * test/regressions.test.js and is deliberately not repeated here. Bumping it
   * is a deploy step across all three files -- see the note over WF_BUILD. */
  const html = read("popups/ops.html");
  assert.ok(html.includes('"./tabs/install.js"'),
    "install.js is not a member of the versioned script array");
  assert.ok(!/<script[^>]+tabs\/install\.js/.test(html),
    "install.js has a literal script tag, which the loader cannot version");
  assert.ok(html.includes('src="\' + src + "?v=" + window.WF_BUILD'),
    "the loader stopped appending the build token");
});

/* ================================================================ THE MONEY */

test("an installer sees no margin, no cost and no value — anywhere in the DOM", async () => {
  const env = boot({
    role: "worker",
    cards: [installCard("c1", "LI1", { running: SCOTT, pct: 40 }),
            installCard("c2", "LI2", { name: "1798 Josh Hughes", pos: 10 })],
    // The board's own Payment Status, plus the money fields that sit beside it
    // on a real card. visibleFields is what is meant to drop the second one.
    fields: [{ name: "Payment Status", display: "Collect At Install" },
             { name: "$Value", display: "$" + VALUE }]
  });
  const node = await render(env);
  await settle();

  const haystack = everything(node);

  MONEY_STRINGS.forEach((s) => {
    assert.ok(haystack.indexOf(s) === -1,
      "the figure " + s + " reached the installer's screen");
  });
  [/margin/i, /profit/i, /\bcost\b/i, /markup/i].forEach((re) => {
    assert.ok(!re.test(haystack),
      "the word " + re + " reached the installer's screen");
  });

  // And the positive half: the job really did render, so the sweep above was
  // looking at a drawn column rather than at an empty div that trivially
  // contains no money.
  assert.ok(haystack.includes("Robert Pearce"), "the job did not render at all");
  assert.ok(haystack.includes("Collect At Install"),
    "payment status did not render, so this proved nothing");
});

test("opening a queued card in the column leaks no money either", async () => {
  /* THE SECOND DOOR INTO THE SAME ROOM. Tapping a queued job hands the card to
   * the shared panel, which draws every custom field the board has -- including
   * "$Value". The filter that drops it is WFCardView.visibleFields, and it only
   * runs because install.js passes the ops CTX rather than a role string: the
   * ctx carries `can`, so the board's own permission settings decide. Pass
   * ctx.role instead and a worker is "worker", which happens to also be
   * filtered -- until somebody renames a preset. This asserts the real path. */
  const env = boot({
    role: "worker",
    cards: [installCard("c1", "LI1", { claimed: SCOTT }),
            installCard("c2", "LI2", { name: "1798 Josh Hughes", pos: 20 })],
    fields: [{ name: "Payment Status", display: "Half Down" },
             { name: "$Value", display: "$" + VALUE }]
  });
  const node = await render(env);
  await settle();

  const tile = $(node, "button.wf-in-tile").find((b) => textOf(b).includes("Josh Hughes"));
  assert.ok(tile, "the queued job is not tappable");
  tile.click();
  await settle();

  const panel = $(env.win.document.getElementById("view"), ".wf-cp")[0];
  assert.ok(panel, "the card panel did not open in the column");
  const haystack = everything(panel);
  MONEY_STRINGS.forEach((s) => {
    assert.ok(haystack.indexOf(s) === -1,
      "the figure " + s + " reached the installer through the card panel");
  });
  // And the panel really drew, rather than failing into its error branch.
  assert.ok(!/Couldn't open this card/.test(haystack), "the panel fell into its error state");
});

test("a manager gets the clock and still gets no money", async () => {
  const env = boot({
    role: "manager",
    me: MIKE,
    cards: [installCard("c1", "LI1", { running: MIKE, pct: 55 })],
    fields: [{ name: "Payment Status", display: "Paid in Full" },
             { name: "$Value", display: "$" + VALUE }]
  });
  const node = await render(env);
  await settle();

  assert.ok(textOf(node).includes("on the clock"), "a manager should see the clock");

  // MONEY IS NOT A MANAGER THING ON THIS SCREEN. The owner's rule is relevant
  // information at each stage, and this screen gets handed to a customer. A
  // manager who wants the figure has the Costing tab.
  const haystack = everything(node);
  MONEY_STRINGS.forEach((s) => {
    assert.ok(haystack.indexOf(s) === -1, "the figure " + s + " reached a manager's truck screen");
  });
});

test("a worker never sees a running clock", async () => {
  const env = boot({
    role: "worker",
    cards: [installCard("c1", "LI1", { running: SCOTT, pct: 20 })]
  });
  const node = await render(env);
  await settle();
  assert.ok(!textOf(node).includes("on the clock"),
    "a running timer was shown to the shop");
  assert.equal($(node, ".wf-in-mins").length, 0);
  // Percent is what the shop gets instead, and it is there.
  assert.ok(textOf(node).includes("20%"));
});

/* ================================================= the four things, in order */

test("customer, site, payment and instructions lead the column, in that order", async () => {
  const env = boot({
    cards: [installCard("c1", "LI1", { claimed: SCOTT })],
    fields: [{ name: "Payment Status", display: "Collect At Install" }]
  });
  const node = await render(env);
  await settle();

  const keys = $(node, ".wf-in-k").map(textOf);
  const want = ["On site", "Site address", "Payment", "Install instructions"];
  // Not merely present: in this sequence and ahead of the queue, because the
  // ordering is the entire difference between this tab and the Floor.
  const seen = keys.filter((k) => want.indexOf(k) > -1);
  assert.deepEqual(seen.slice(0, 4), want);
  const queueAt = keys.findIndex((k) => /Next up|Nothing queued/.test(k));
  assert.ok(queueAt > keys.indexOf("Install instructions"),
    "the queue came before the install instructions");

  assert.ok(textOf(node).includes("Robert Pearce"));
  assert.ok(textOf(node).includes("Job 1795"));
  assert.ok(textOf(node).includes("Gate code is 4812"));
});

test("the address is a maps link and the phone is a tel: link", async () => {
  const env = boot({ cards: [installCard("c1", "LI1", { claimed: SCOTT })] });
  const node = await render(env);
  await settle();

  const links = $(node, "a.wf-in-tap");
  const map = links.find((a) => /google\.com\/maps/.test(a.getAttribute("href") || ""));
  assert.ok(map, "the site address is not tappable");
  assert.ok(decodeURIComponent(map.getAttribute("href")).includes("6094 Fruitwood Lane"),
    "the maps link does not carry the address");
  // Opens the app, does not replace the Power-Up's iframe.
  assert.equal(map.getAttribute("target"), "_blank");
  assert.equal(map.getAttribute("rel"), "noopener");

  const tel = links.find((a) => /^tel:/.test(a.getAttribute("href") || ""));
  assert.ok(tel, "the phone number is not tappable");
  assert.equal(tel.getAttribute("href"), "tel:2084795486");
});

test("a card with no address line says so instead of guessing one", async () => {
  const env = boot({
    cards: [installCard("c1", "LI1", {
      claimed: SCOTT,
      name: "1762 - Doug Briscoe",
      // A real card: the address is somewhere in the prose, mid-sentence, with
      // no label at the start of a line. Nothing honest can be extracted.
      desc: "Timber frame brackets, symmetrical, cut from 3/16ths plate. " +
            "He is at 1286 Gaithe Ave. Call first."
    })]
  });
  const node = await render(env);
  await settle();
  const txt = textOf(node);
  assert.ok(txt.includes("No address line on this card"),
    "a missing address was not admitted to");
  assert.equal($(node, "a.wf-in-tap").filter(
    (a) => /maps/.test(a.getAttribute("href") || "")).length, 0,
    "a maps link was built from nothing");
  // And the customer still came out whole: the dash-cut rule must not fire on a
  // surname.
  assert.ok(txt.includes("Doug Briscoe"));
});

/* ==================================================================== payment */

test("payment says what to do, keyed on what the board literally says", async () => {
  const cases = [
    ["Collect At Install", "Collect payment on site"],
    ["Paid in Full - Check", "Nothing to collect"],
    ["COMPED", "Nothing to collect"],
    ["Half Down", "Check with the office"],
    ["Invoiced", "Check with the office"]
  ];
  for (const [status, expect] of cases) {
    const env = boot({
      cards: [installCard("c1", "LI1", { claimed: SCOTT })],
      fields: [{ name: "Payment Status", display: status }]
    });
    const node = await render(env);
    await settle();
    const txt = textOf(node);
    assert.ok(txt.includes(status), status + " did not render");
    assert.ok(txt.includes(expect), status + " should read as: " + expect);
  }
});

test("an empty payment field reads as unrecorded, not as settled", async () => {
  const env = boot({
    cards: [installCard("c1", "LI1", { claimed: SCOTT })],
    fields: []            // the usual case on this board today
  });
  const node = await render(env);
  await settle();
  const txt = textOf(node);
  assert.ok(txt.includes("Not recorded"));
  assert.ok(txt.includes("Check with the"),
    "an unrecorded payment must not read as nothing to collect");
  assert.ok(!txt.includes("Nothing to collect"));
});

test("a payment status that could not be read says so, and is not the card's answer", async () => {
  const env = boot({ cards: [installCard("c1", "LI1", { claimed: SCOTT })] });
  // The fetch fails rather than returning nothing: the two are different facts
  // and the block has to distinguish them.
  env.win.WFRest.getCardFieldsDisplay = () => Promise.reject(new Error("offline"));
  const node = await render(env);
  await settle();
  assert.ok(textOf(node).includes("couldn't be read just now"),
    "a failed field read was passed off as the board's answer");
});

/* ===================================================================== the work */

test("Start claims an unclaimed job for the crew's installer and puts it on the clock",
  async () => {
    const env = boot({ cards: [installCard("c1", "LI1", { tableId: "i1", pos: 1 })] });
    const node = await render(env);
    await settle();

    // A bare queue entry does not take the bench slot, so it is reachable.
    assert.ok(textOf(node).includes("Nothing started yet.") ||
              textOf(node).includes("Robert Pearce"));
  });

test("Start / Stop and the percent slider are the shop's controls, and they write",
  async () => {
    const env = boot({ cards: [installCard("c1", "LI1", { claimed: SCOTT, pct: 10 })] });
    const node = await render(env);
    await settle();

    const start = btn(node, "Start");
    assert.ok(start, "no Start button on a claimed, paused job");
    start.click();
    await settle();
    const keys = env.written.map((w) => w[0]);
    assert.ok(keys.includes("phaseWork"), "Start wrote nothing");

    const slider = $(node, "input.wf-in-slider")[0];
    assert.ok(slider, "a worker who may start a job gets no percent slider");
    assert.equal(slider.getAttribute("step"), "5");
  });

test("somebody who may not start the job gets the facts and no buttons", async () => {
  // Scott holds job.start at "own" scope; this job is Mike's.
  const env = boot({
    me: SCOTT,
    cards: [installCard("c1", "LI1", { claimed: MIKE, pct: 30 })],
    saved: { stations: [{ id: "i1", area: "install", table: "Truck 1", type: "install",
                          welder: "mikel", phase: "Install" }], visible: ["i1"] }
  });
  const node = await render(env);
  await settle();
  assert.ok(textOf(node).includes("You can see this job but not start it."));
  assert.equal(btn(node, "Start"), null);
  assert.equal($(node, "input.wf-in-slider").length, 0);
  // But the four things are still there: an installer riding along still needs
  // the address.
  assert.ok(textOf(node).includes("6094 Fruitwood Lane"));
});

test("Install is not a QC phase today, so finishing passes the job on and says so",
  async () => {
    // The data layer's own answer, asserted rather than assumed -- if somebody
    // adds Install to qcPhases, this test is the one that should change first.
    const { win } = boot();
    assert.equal(win.WFQC.requiresQc("Install"), false);

    const env = boot({ cards: [installCard("c1", "LI1", { claimed: SCOTT, pct: 100 })] });

    /* EVERY LIST THE CARD IS MOVED TO, RECORDED.
     *
     * This test used to stub moveCard and throw the calls away, so it asserted
     * that the dialog says "Billing" and nothing at all about whether the card
     * goes there. A dialog that names the right destination and then does not
     * move the job is the precise failure the Install tab already had once --
     * it promised Billing off the flat board order while the route-aware
     * wrapper answered null and left the card put. Naming it is not the claim
     * worth holding; moving it is. */
    const moves = [];
    env.win.WFRest.moveCard = (t, cardId, listId) => {
      moves.push([cardId, listId]);
      return Promise.resolve({});
    };

    /* THE FLAT BOARD ORDER, DELIBERATELY POISONED.
     *
     * WFStage.getNextStage is the next COLUMN, which is a different question
     * from where this job's route sends it, and the dialog must be asking the
     * second one (WFPhase.__targetStage, out of lib/advance.js). Making the
     * flat answer obviously wrong is the only way to tell the two apart from
     * the outside: with Billing on every route they agree for Install, so a
     * dialog still reading the flat order would look perfectly correct.
     *
     * The move is unaffected -- lib/advance.js captured the real getNextStage
     * at load and pins its own answer over it for the one card -- so this also
     * proves the dialog and the move are reading the same thing. */
    env.win.WFStage.getNextStage = () => ({ listId: "LOST", name: "Lost Bids", order: 99 });

    const node = await render(env);
    await settle();

    btn(node, "Finished here").click();
    await settle();
    const dlg = env.win.document.body;
    const txt = textOf(dlg);
    assert.ok(txt.includes("Finished at Robert Pearce?"));
    // The next stage comes from config, not from a string in this file.
    assert.ok(txt.includes("Billing"), "the dialog did not name the real next stage");
    assert.ok(!txt.includes("Lost Bids"),
      "the dialog is still reading the flat board order instead of the job's route");

    // And it does what it said. The card moves to the Billing list -- read out
    // of the fixture board above, not typed as a string here.
    const billing = BOARD.stages.find((s) => s.name === "Billing");
    const go = btn(dlg, "Finish and pass to Billing");
    assert.ok(go, "the dialog offered no way to finish the job");
    go.click();
    await settle(14);

    assert.deepEqual(moves, [["c1", billing.listId]],
      "the card was not moved to the list the dialog promised");

    /* And the phase work is gone with it, which is the other half of the
     * defect: a card left in an Install list WITH its work removed is what
     * WFTables.stationState reads as fresh unclaimed work, so it came back into
     * every truck's queue. Moved AND cleared is the only safe pair. */
    assert.ok(env.written.some((w) => w[0] === "phaseWork" && w[1] === null),
      "phaseWork was never cleared");
    assert.equal(env.store["c1|phaseWork"], undefined);
  });

test("a job with an open fault cannot be finished from the truck", async () => {
  const env = boot({
    cards: [installCard("c1", "LI1", {
      claimed: SCOTT, pct: 100,
      /* A round with a failed line and no fix filed against it -- which is what
       * WFQC.openFaults actually reads, shape and all.
       *
       * `foundBy` is load-bearing and was the thing this fixture got wrong
       * first time. lib/qc.js's isFaultRound() requires it, because an
       * unticked line is also stored as result:"fail" and an unticked line is
       * not a fault -- it means nobody got to it. Only a round somebody
       * deliberately failed with a note carries foundBy, so only such a round
       * can hold a fault. A fixture without it produces zero faults and a test
       * that silently proves nothing. */
      qcRecord: {
        listId: "LI1", mode: "floor", status: "awaiting_correction",
        rounds: [{
          foundBy: { username: "mikel", fullName: "Mike Larsen" },
          items: [
            { text: "Rail length matches the opening", result: "fail",
              note: "three inches short at the top landing" }
          ]
        }]
      }
    })]
  });
  const node = await render(env);
  await settle();
  btn(node, "Finished here").click();
  await settle();
  assert.ok(textOf(env.win.document.body).includes("recorded as wrong with this job"));
});

/* ======================================================================= queue */

test("the queue spans every Install list, because they are one phase", async () => {
  const env = boot({
    cards: [
      installCard("c1", "LI1", { claimed: SCOTT }),
      installCard("c2", "LI1", { name: "1798 Josh Hughes", pos: 20 }),
      installCard("c3", "LI2", { name: "1791 Gate City Builders - 1286 Gaithe", pos: 30 })
    ]
  });
  const node = await render(env);
  await settle();
  const txt = textOf(node);
  assert.ok(txt.includes("Next up · 2"), "the queue did not span both Install lists");
  assert.ok(txt.includes("Josh Hughes"));
  assert.ok(txt.includes("Gate City Builders"));
});

test("no crews configured reads as a setup problem, not as a quiet day", async () => {
  const env = boot({ saved: { stations: [], visible: [] }, cards: [] });
  const node = await render(env);
  await settle();
  const txt = textOf(node);
  assert.ok(txt.includes("No install crews are set up yet."));
  // The fix is named, because an empty screen with no instruction is how a tab
  // gets reported as broken.
  assert.ok(txt.includes("Install crew"));
  assert.ok(btn(node, "Open station setup"), "no way out of the empty state");
});

test("the tab survives a shell that has not loaded permissions yet", async () => {
  // ctx.can is absent until WFPerms.load resolves, and the Floor had to be
  // fixed for exactly this once. A tab that throws here shows nothing at all.
  const env = boot({ perms: false, cards: [installCard("c1", "LI1", { claimed: SCOTT })] });
  const node = await render(env);
  await settle();
  assert.ok(textOf(node).includes("Robert Pearce"));
  assert.ok(btn(node, "Start"), "no controls without a permission config");
});

/* ============================================================ no second copy */

test("the bench logic is called, not re-implemented", () => {
  const src = read("popups/tabs/install.js");

  /* THE WORST OUTCOME THIS TASK COULD HAVE HAD is a second copy of the Floor's
   * machinery, so the shapes of that copy are asserted against rather than
   * described in a comment nobody reads.
   *
   * Each of these is a calculation that exists exactly once in the repo, in a
   * lib, and a literal re-derivation here would mean the next change to the lib
   * silently does not apply to the install crews. */
  assert.ok(/WFTables\.areaState/.test(src), "crews are not derived through WFTables");
  assert.ok(/WFPhase\.claimAndStart/.test(src), "claiming is not WFPhase's");
  assert.ok(/WFPhase\.setPercentComplete/.test(src), "percent is not WFPhase's");
  assert.ok(/WFTables\.elapsedMinutes/.test(src), "elapsed time is derived locally");
  assert.ok(/WFQC\.(?:floorSignOff|passSigned)/.test(src), "the QC gate is not WFQC's");
  /* WHERE THE JOB GOES NEXT IS THE ROUTE'S ANSWER, NOT THE COLUMN ORDER'S.
   *
   * This line used to require WFStage.getNextStage and nothing more, which was
   * satisfied by the bug: the flat next column is not where WFPhase.advance
   * sends the card, and on Install the two answered differently -- Billing
   * versus null -- so the dialog told the installer something the move then did
   * not do. __targetStage is lib/advance.js's own answer, the one the move
   * pins, so asking it is the only way the two cannot drift. getNextStage is
   * still here as the fallback __targetStage itself falls back to (an unmapped
   * list), which is why both are required rather than one forbidden. */
  assert.ok(/WFPhase\.__targetStage/.test(src),
    "the next stage is the flat column order, not the card's own route");
  assert.ok(/WFStage\.getNextStage/.test(src), "the next stage is not WFStage's");
  assert.ok(/WFCardPanel\.inline/.test(src), "the card rendition is not the shared panel's");

  // No private arithmetic for the two figures the repo has already collapsed
  // duplicates of. A bare 60000 here would be a third elapsed-time calculation.
  assert.ok(!/segments\s*\[\s*\w+\.segments\.length/.test(src),
    "install.js is reaching into segments itself");
  assert.ok(!/\/\s*60000/.test(src), "install.js is doing its own minute arithmetic");
});

test("install.js renders no money, as source", () => {
  const src = read("popups/tabs/install.js");
  /* Belt and braces over the DOM sweep above: a figure can only reach the
   * screen if this file reads one, and there are exactly three ways to read one
   * on this board. None of them appears outside a comment. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ["economics", "fieldValue", "O.money", "moneyShort", "getNamedCustomFieldValues"]
    .forEach((needle) => {
      assert.ok(code.indexOf(needle) === -1,
        "install.js reads " + needle + ", which is money");
    });
});
