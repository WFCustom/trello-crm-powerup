/**
 * Records -- time, quality, safety, training.
 *
 * Two assertions here are promises rather than behaviour, and both are the kind
 * a refactor breaks without anyone noticing: a half-finished phase must never
 * be counted as a build time, and an anonymous safety report must not carry the
 * reporter's name.
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
after(() => OPEN.forEach((d) => { try { d.window.close(); } catch (e) { /* gone */ } }));

const DAY = 86400000;
const iso = (d) => new Date(Date.now() + d * DAY).toISOString();

const KEV = { username: "kevinmoss", fullName: "Kevin Moss" };
const SCOTT = { username: "scottv", fullName: "Scott VanWorkom" };
const BOSS = { username: "boss", fullName: "The Boss" };

/** A job card carrying a finished-phase log and optionally a QC record. */
function card(id, opts = {}) {
  return {
    id,
    name: opts.name || ("#" + id + " — job " + id),
    idList: opts.list || "ASM",
    economics: opts.value ? { value: opts.value, cost: opts.cost || 0 } : null,
    phaseLog: opts.log || [],
    phaseWork: opts.work || null,
    qcRecord: opts.qc || null
  };
}

const logEntry = (phase, who, minutes, daysAgo) => ({
  listId: "L", listName: phase, claimedBy: who,
  durationMinutes: minutes, completedAt: iso(-daysAgo), approvedBy: BOSS
});

function boot({ cards = [], safety = null, training = [], role = "manager" } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="boardName"></div><div id="meName"></div><div id="meInitials"></div>
       <nav id="tabbar"></nav><main id="view"></main>
     </body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true }
  );
  const win = dom.window;
  const store = { wfTraining: training };
  const writes = [];

  const SAFETY = safety || { lists: [], cards: [], labels: [], members: [] };

  win.eval(read("config.js"));
  win.eval(read("lib/board-extras.js"));
  win.eval(read("lib/stage.js"));

  win.WFRest = {
    request(t, pathname) {
      if (/\/lists$/.test(pathname)) return Promise.resolve(SAFETY.lists);
      if (/\/cards$/.test(pathname)) return Promise.resolve(SAFETY.cards);
      if (/\/labels$/.test(pathname)) return Promise.resolve(SAFETY.labels);
      if (/\/members$/.test(pathname)) return Promise.resolve(SAFETY.members);
      return Promise.resolve([]);
    },
    write(t, method, pathname, params) {
      writes.push([method, pathname, params]);
      return Promise.resolve({ ok: true });
    }
  };
  win.WFRoster = { getRoster: () => Promise.resolve({ managers: [], phaseSpecialists: {} }) };
  win.WFPricing = { getBoardAudit: () => Promise.resolve([]) };
  win.Chart = function () {};

  win.eval(read("lib/records.js"));
  win.eval(read("popups/ops.js"));

  let def = null;
  const realTab = win.WFOps.tab;
  win.WFOps.tab = (d) => { if (d.id === "records") def = d; return realTab(d); };
  win.eval(read("popups/tabs/records.js"));

  const t = {
    get: (s, v, k, d) => Promise.resolve(store[k] === undefined ? d : store[k]),
    set: (s, v, k, val) => { store[k] = val; writes.push(["SET", k, val]); return Promise.resolve(); }
  };

  const ctx = {
    t,
    board: { id: "OPS", name: "Office Operations", members: [KEV, SCOTT, BOSS] },
    member: KEV,
    boardCfg: { stages: [] },
    roster: { managers: ["boss"], phaseSpecialists: {} },
    role,
    isManager: role === "manager",
    cards: () => Promise.resolve(cards),
    reload: () => Promise.resolve(),
    syncCard: () => Promise.resolve(),
    goTo: () => {}
  };

  OPEN.push(dom);
  return { win, dom, def, ctx, store, writes, R: win.WFRecords };
}

const textOf = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const $ = (n, sel) => Array.from(n.querySelectorAll(sel));

function render(env) {
  return Promise.resolve(env.def.render(env.ctx)).then((node) => {
    env.win.document.getElementById("view").appendChild(node);
    return node;
  });
}

/* ================================================================== time */

test("a finished phase becomes an entry; an unfinished one never does", () => {
  const { R } = boot();
  const cards = [
    card("A", { log: [logEntry("CAD", KEV, 120, 3)], value: 12000 }),
    // Running right now: two hours on the clock, but not a build time yet.
    card("B", {
      work: { listId: "ASM", claimedBy: SCOTT,
              segments: [{ start: new Date(Date.now() - 120 * 60000).toISOString() }] }
    })
  ];
  const done = R.timeEntries(cards);
  assert.equal(done.length, 1, "only the approved phase counts");
  assert.equal(done[0].minutes, 120);
  assert.equal(done[0].hours, 2);
  assert.equal(done[0].who, "Kevin Moss");
  assert.equal(done[0].value, 12000);

  const open = R.openEntries(cards);
  assert.equal(open.length, 1);
  assert.equal(open[0].ongoing, true);
  assert.ok(!done.some((e) => e.ongoing), "the two lists never mix");
});

test("a zero or nonsense duration is dropped rather than skewing the totals", () => {
  const { R } = boot();
  const entries = R.timeEntries([card("A", {
    log: [logEntry("CAD", KEV, 0, 1), logEntry("CAD", KEV, -5, 1),
          logEntry("CAD", KEV, NaN, 1), logEntry("CAD", KEV, 60, 1)]
  })]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].minutes, 60);
});

test("the ratios stay blank until there are enough priced jobs", () => {
  const { R } = boot();
  const few = R.timeSummary(R.timeEntries([
    card("A", { log: [logEntry("CAD", KEV, 600, 2)], value: 10000 }),
    card("B", { log: [logEntry("CAD", KEV, 600, 2)], value: 10000 })
  ]));
  assert.equal(few.enough, false);
  assert.equal(few.hoursPerThousand, null, "two jobs is not a standard");
  assert.equal(few.revenuePerHour, null);
  assert.equal(few.jobsPriced, 2);

  // Five priced jobs at 10 hours per $10k = 1 hour per $1,000.
  const many = R.timeSummary(R.timeEntries(
    ["A", "B", "C", "D", "E"].map((id) =>
      card(id, { log: [logEntry("CAD", KEV, 600, 2)], value: 10000 }))));
  assert.equal(many.enough, true);
  assert.equal(many.hoursPerThousand, 1);
  assert.equal(many.revenuePerHour, 1000);
});

test("the ratios are medians, so one nightmare job can't move them", () => {
  const { R } = boot();
  const normal = ["A", "B", "C", "D"].map((id) =>
    card(id, { log: [logEntry("CAD", KEV, 600, 2)], value: 10000 }));   // 1 h/$1k
  const disaster = card("E", { log: [logEntry("CAD", KEV, 6000, 2)], value: 10000 }); // 10
  const s = R.timeSummary(R.timeEntries(normal.concat([disaster])));
  assert.equal(s.hoursPerThousand, 1, "the median ignores the outlier; a mean would say 2.8");
});

test("unpriced jobs count toward hours but not toward the ratios", () => {
  const { R } = boot();
  const s = R.timeSummary(R.timeEntries(
    ["A", "B", "C", "D", "E"].map((id) =>
      card(id, { log: [logEntry("CAD", KEV, 600, 2)], value: 10000 }))
      .concat([card("F", { log: [logEntry("CAD", KEV, 6000, 2)] })])));
  assert.equal(s.jobsPriced, 5);
  assert.equal(s.hoursPerThousand, 1);
  assert.equal(Math.round(s.hours), 150, "the unpriced job's hours still count");
});

test("totals group by person and by phase", () => {
  const { R } = boot();
  const s = R.timeSummary(R.timeEntries([
    card("A", { log: [logEntry("CAD", KEV, 60, 1), logEntry("Assemble CNC", SCOTT, 120, 1)] }),
    card("B", { log: [logEntry("CAD", KEV, 30, 1)] })
  ]));
  assert.equal(s.byPerson["Kevin Moss"].minutes, 90);
  assert.equal(s.byPerson["Scott VanWorkom"].minutes, 120);
  assert.equal(s.byPhase["CAD"].count, 2);
  assert.equal(Math.round(s.hours * 10) / 10, 3.5);
  assert.deepEqual(R.sortedGroups(s.byPhase).map((g) => g.key),
    ["Assemble CNC", "CAD"], "biggest first");
});

test("the period filter uses the completion date and drops ongoing work", () => {
  const { R } = boot();
  const entries = R.timeEntries([
    card("A", { log: [logEntry("CAD", KEV, 60, 5), logEntry("CAD", KEV, 60, 200)] })
  ]);
  assert.equal(R.since(entries, 30).length, 1);
  assert.equal(R.since(entries, 365).length, 2);
  assert.equal(R.since(entries, 0).length, 2, "0 means everything");
  assert.equal(R.since([{ at: null }], 30).length, 0, "no date, no match");
});

test("the CSV carries the value alongside the hours, and quotes what it must", () => {
  const { R } = boot();
  const csv = R.toCSV(R.timeEntries([
    card("A", { name: 'Job "A", with a comma', log: [logEntry("CAD", KEV, 600, 2)], value: 10000 })
  ]).concat([{ ongoing: true, job: "nope", minutes: 5, hours: 0.1 }]));
  const lines = csv.split("\n");
  assert.match(lines[0], /^Job,Job number,Phase,Who,Approved by,Minutes,Hours,Completed,Job value,Hours per \$1,000$/
    .source.replace(/\\/g, "") ? /Job,Job number,Phase/ : /Job/);
  assert.equal(lines.length, 2, "the ongoing entry is left out");
  assert.match(lines[1], /"Job ""A"", with a comma"/, "quotes and commas escaped");
  assert.match(lines[1], /,10000,1$/, "value then hours per $1,000");
});

/* =============================================================== quality */

test("every QC round is archived, with what failed", () => {
  const { R } = boot();
  const entries = R.qcEntries([card("A", {
    name: "Rail run", qc: {
      phase: "Assemble CNC",
      rounds: [
        { n: 1, checkedBy: SCOTT, checkedAt: iso(-3),
          items: [{ text: "Welds ground smooth", result: "pass" },
                  { text: "Dimensions match", result: "fail", note: "12mm out" }],
          corrections: [{ text: "Dimensions match", whatIDid: "recut", correctedBy: KEV }] },
        { n: 2, checkedBy: SCOTT, checkedAt: iso(-2),
          items: [{ text: "Welds ground smooth", result: "pass" },
                  { text: "Dimensions match", result: "pass" }],
          signature: "S VanWorkom", signedBy: SCOTT }
      ]
    }
  })]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].round, 2, "newest first");
  assert.equal(entries[0].passed, true);
  assert.equal(entries[1].passed, false);
  assert.deepEqual(entries[1].failed.map((f) => f.text), ["Dimensions match"]);
  assert.equal(entries[1].corrections[0].what, "recut");
  assert.equal(entries[0].signature, "S VanWorkom");
});

test("the repeat-offender list is what the archive is for", () => {
  const { R } = boot();
  const fail = (text) => ({
    n: 1, checkedBy: SCOTT, checkedAt: iso(-1),
    items: [{ text, result: "fail" }]
  });
  const s = R.qcSummary(R.qcEntries([
    card("A", { qc: { phase: "CAD", rounds: [fail("Revision number on the sheet")] } }),
    card("B", { qc: { phase: "CAD", rounds: [fail("Revision number on the sheet")] } }),
    card("C", { qc: { phase: "CAD", rounds: [fail("Revision number on the sheet")] } }),
    card("D", { qc: { phase: "CAD", rounds: [fail("Cut list agrees")] } })
  ]));
  assert.equal(s.rounds, 4);
  assert.equal(s.failed, 4);
  assert.equal(s.passRate, 0);
  assert.equal(s.topFailures[0].text, "Revision number on the sheet");
  assert.equal(s.topFailures[0].n, 3);
});

test("a card with no QC record contributes nothing", () => {
  const { R } = boot();
  assert.deepEqual(R.qcEntries([card("A"), card("B", { qc: { rounds: [] } })]), []);
});

/* ================================================================ safety */

test("lists map to a status by name, so the board stays renameable", () => {
  const { R } = boot();
  assert.equal(R.safetyStatusOf("Just reported"), "new");
  assert.equal(R.safetyStatusOf("Being dealt with"), "working");
  assert.equal(R.safetyStatusOf("Closed"), "closed");
  assert.equal(R.safetyStatusOf("Closed / resolved"), "closed");
  assert.equal(R.safetyStatusOf("Waiting on parts"), "working", "anything else is in progress");
});

test("AN ANONYMOUS REPORT CARRIES NO NAME", async () => {
  const env = boot({
    safety: {
      lists: [{ id: "L1", name: "Just reported" }],
      cards: [], labels: [{ id: "B1", name: "Near miss" }], members: []
    }
  });
  const data = env.R.buildSafety(
    [{ id: "L1", name: "Just reported" }], [], [{ id: "B1", name: "Near miss" }], []);

  await env.R.fileSafety(env.ctx.t, data, {
    name: "Nearly walked into the forklift",
    kind: "Near miss",
    answers: { what: "It reversed with no beeper.", where: "By the blast booth" },
    anonymous: true,
    filer: KEV
  });

  const post = env.writes.find((w) => w[0] === "POST" && w[1] === "/cards");
  assert.ok(post, "a card was created");
  assert.ok(!/Kevin/.test(post[2].desc), "no name anywhere: " + post[2].desc);
  assert.ok(!/kevinmoss/.test(post[2].desc));
  assert.match(post[2].desc, /anonymously/);
  assert.match(post[2].desc, /It reversed with no beeper\./, "the report itself survives");
  assert.equal(post[2].idList, "L1");
  assert.equal(post[2].idLabels, "B1");
});

test("a named report says who filed it", () => {
  const { R } = boot();
  const desc = R.composeSafetyDesc({ what: "Guard missing" }, KEV);
  assert.match(desc, /by Kevin Moss/);
  assert.ok(!/anonymously/.test(desc));
});

test("days since an injury is null when there has never been one", () => {
  const { R } = boot();
  const none = R.safetySummary([{ kind: "Near miss", at: new Date(), status: "new" }]);
  assert.equal(none.daysSinceInjury, null, "0 would read as 'somebody got hurt today'");
  assert.equal(none.open, 1);
  assert.equal(none.byKind["Near miss"], 1);

  const hurt = R.safetySummary([
    { kind: "Injury", at: new Date(Date.now() - 40 * DAY), status: "closed" },
    { kind: "Injury", at: new Date(Date.now() - 200 * DAY), status: "closed" }
  ]);
  assert.equal(Math.round(hurt.daysSinceInjury), 40, "the most recent one");
  assert.equal(hurt.open, 0);
});

test("reports read back newest first with their kind and status", () => {
  const { R } = boot();
  const id = (daysAgo) =>
    Math.floor((Date.now() - daysAgo * DAY) / 1000).toString(16).padStart(8, "0") + "0".repeat(16);
  const data = R.buildSafety(
    [{ id: "L1", name: "Just reported" }, { id: "L3", name: "Closed" }],
    [{ id: id(1), name: "New one", idList: "L1", idLabels: ["B2"] },
     { id: id(9), name: "Old one", idList: "L3", idLabels: ["B1"] }],
    [{ id: "B1", name: "Near miss" }, { id: "B2", name: "Injury" }],
    []);
  assert.deepEqual(data.reports.map((r) => r.name), ["New one", "Old one"]);
  assert.equal(data.reports[0].kind, "Injury");
  assert.equal(data.reports[0].status, "new");
  assert.equal(data.reports[1].status, "closed");
  assert.equal(data.lists[0].count, 1);
});

test("missing kind labels are created once", async () => {
  const env = boot();
  await env.R.ensureLabels(env.ctx.t, [{ id: "B1", name: "Near miss" }]);
  const made = env.writes.filter((w) => w[1] === "/labels").map((w) => w[2].name);
  assert.deepEqual(made.sort(), ["Hazard", "Injury", "PPE request"]);
});

/* ============================================================== training */

test("training gives sixty days of warning, which is what rebooking takes", () => {
  const { R } = boot();
  assert.equal(R.trainingStatus({ expiresAt: iso(-5) }).state, "expired");
  assert.equal(R.trainingStatus({ expiresAt: iso(30) }).state, "expiring");
  assert.equal(R.trainingStatus({ expiresAt: iso(59) }).state, "expiring");
  assert.equal(R.trainingStatus({ expiresAt: iso(200) }).state, "current");
  assert.equal(R.trainingStatus({}).state, "none");
});

test("a training record too big for Trello is refused with a readable message", async () => {
  const env = boot();
  const big = Array.from({ length: 300 }, (_, i) => ({ id: "t" + i, person: "x".repeat(30) }));
  await assert.rejects(() => env.R.saveTraining(env.ctx.t, big), /too much/i);
  await env.R.saveTraining(env.ctx.t, [{ id: "t1", person: "Kevin" }]);
  assert.equal(env.store.wfTraining.length, 1);
});

/* ============================================================== the tab */

test("the tab registers as Records and is open to everyone", () => {
  const env = boot();
  assert.equal(env.def.id, "records");
  assert.equal(env.def.label, "Records");
  assert.equal(env.def.roles, undefined);
});

test("a worker gets Safety and Training; a manager gets all four", async () => {
  const wkr = boot({ role: "worker" });
  const wnode = await render(wkr);
  const wrail = $(wnode, ".wf-rec-r").map(textOf);
  assert.deepEqual(wrail, ["Safety", "Training"], "hours and names aren't theirs to browse");

  const mgr = boot({ role: "manager" });
  const mnode = await render(mgr);
  const mrail = $(mnode, ".wf-rec-r").map((b) => textOf(b).replace(/\d+$/, ""));
  assert.deepEqual(mrail, ["Time", "Quality", "Safety", "Training"]);
});

test("a worker landing on Safety can file, and can file anonymously", async () => {
  const env = boot({
    role: "worker",
    safety: { lists: [{ id: "L1", name: "Just reported" }], cards: [],
              labels: [{ id: "B1", name: "Near miss" }, { id: "B2", name: "Injury" },
                       { id: "B3", name: "Hazard" }, { id: "B4", name: "PPE request" }],
              members: [] }
  });
  const node = await render(env);
  assert.match(textOf(node), /Safety/);

  const btn = $(node, "button").find((b) => /Report something/.test(textOf(b)));
  assert.ok(btn, "a worker can report");
  btn.dispatchEvent(new env.win.Event("click"));

  const doc = env.win.document;
  const labels = $(doc, ".wf-rec-f label").map(textOf);
  assert.ok(labels.includes("What happened?"));
  assert.ok(labels.some((l) => /Where, and when/.test(l)));
  assert.equal($(doc, 'input[type="checkbox"]').length, 1, "the leave-my-name-off box");
  assert.match(textOf(doc.body), /Leave my name off it/);
});

test("the time view refuses to show a ratio it can't stand behind", async () => {
  const env = boot({
    cards: [card("A", { log: [logEntry("CAD", KEV, 600, 2)], value: 10000 }),
            card("B", { log: [logEntry("CAD", KEV, 600, 2)], value: 10000 })]
  });
  const node = await render(env);
  const txt = textOf(node);
  assert.match(txt, /Hours per \$1,000/);
  assert.match(txt, /needs 5 priced jobs, have 2/);
  assert.match(txt, /worse than no standard/);
});

test("with enough data the ratios appear and the export is offered", async () => {
  const env = boot({
    cards: ["A", "B", "C", "D", "E"].map((id) =>
      card(id, { log: [logEntry("CAD", KEV, 600, 2)], value: 10000 }))
  });
  const node = await render(env);
  const txt = textOf(node);
  assert.match(txt, /50 hours logged|Hours logged/);
  assert.ok(!/needs 5 priced jobs/.test(txt));
  assert.ok($(node, "button").some((b) => textOf(b) === "Export"));

  $(node, "button").find((b) => textOf(b) === "Export")
    .dispatchEvent(new env.win.Event("click"));
  const box = env.win.document.querySelector(".wf-rec-csv");
  assert.ok(box, "the CSV is shown, not just downloaded");
  assert.match(box.value, /Job,Job number,Phase/);
});

test("running work is shown but kept out of the totals", async () => {
  const env = boot({
    cards: [
      card("A", { log: [logEntry("CAD", KEV, 60, 2)] }),
      card("B", { name: "Half done", work: { listId: "ASM", claimedBy: SCOTT,
        segments: [{ start: new Date(Date.now() - 180 * 60000).toISOString() }] } })
    ]
  });
  const txt = textOf(await render(env));
  assert.match(txt, /Running right now/);
  assert.match(txt, /Half done/);
  assert.match(txt, /isn't a build time/);
});

test("empty sections explain what would fill them", async () => {
  const env = boot({ cards: [] });
  const node = await render(env);
  assert.match(textOf(node), /No finished phases recorded/);

  $(node, ".wf-rec-r").find((b) => /Quality/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));
  assert.match(textOf(env.win.document.getElementById("view")), /No quality checks recorded/);
});

test("training lists expired first and a manager can edit", async () => {
  const env = boot({
    role: "manager",
    training: [
      { id: "t1", person: "Kevin Moss", topic: "Forklift", expiresAt: iso(400) },
      { id: "t2", person: "Scott VanWorkom", topic: "First aid", expiresAt: iso(-10) },
      { id: "t3", person: "Kevin Moss", topic: "Hot work", expiresAt: iso(20) }
    ]
  });
  const node = await render(env);
  $(node, ".wf-rec-r").find((b) => /Training/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));

  const view = env.win.document.getElementById("view");
  const rows = $(view, ".wf-row").map(textOf);
  assert.match(rows[0], /First aid/, "expired first");
  assert.match(rows[0], /expired 10 days ago/);
  assert.match(rows[1], /Hot work/);
  assert.match(rows[1], /expires in 20 days/);
  assert.match(rows[2], /Forklift/);
  assert.match(rows[2], /current/);
  assert.ok($(view, "button").some((b) => textOf(b) === "Add a record"));
});

test("a worker sees training but cannot edit it", async () => {
  const env = boot({
    role: "worker",
    training: [{ id: "t1", person: "Kevin Moss", topic: "Forklift", expiresAt: iso(-3) }]
  });
  const node = await render(env);
  $(node, ".wf-rec-r").find((b) => /Training/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));
  const view = env.win.document.getElementById("view");
  assert.match(textOf(view), /Forklift/);
  assert.ok(!$(view, "button").some((b) => textOf(b) === "Add a record"));
  assert.ok(!$(view, "button").some((b) => textOf(b) === "Edit"));
});
