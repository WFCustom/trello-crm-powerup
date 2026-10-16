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

/**
 * `preset` is opt-in, and that is not laziness.
 *
 * Handing every fixture a `ctx.can` would silently move the whole suite off
 * the role fallback in `allowed()` and onto the capability model -- a change
 * in what is under test, made by a default. The tests that are ABOUT
 * permissions name a preset; the rest keep asking the question they were
 * written to ask.
 */
function boot({ cards = [], safety = null, training = [], role = "manager",
                preset = null, as = null, people = null } = {}) {
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
  // Every plugin-data write goes through WFStore, so it has to be here before
  // anything that writes loads -- lib/records.js calls it by name and would
  // throw a ReferenceError nothing catches. Same position ops.html gives it.
  win.eval(read("lib/store.js"));
  win.eval(read("lib/board-extras.js"));
  win.eval(read("lib/stage.js"));
  /* lib/phase.js, for the same reason lib/qc.js is here: records.js asks it for
   * the elapsed-time sum.
   *
   * `minutesOf` delegates to WFPhase.elapsedMs and falls back to a private copy
   * when there is no WFPhase -- and without this line there was none, so this
   * whole suite ran on the FALLBACK while every surface that ships (ops.html,
   * which is the only one loading records.js at all) runs the delegation. A
   * suite testing the branch production never takes is the harness's own stated
   * failure mode; see the header of test/harness.js. ops.html loads phase.js
   * before qc.js and records.js, so this does too. */
  win.eval(read("lib/phase.js"));
  /* lib/records.js reads QC rounds THROUGH WFQC -- roundItems to hydrate either
   * round shape, modeOf, isFaultRound -- and guards every call so the module
   * still loads without it. Those guards made this fixture pass while silently
   * testing a different code path from the one that ships: without WFQC an
   * old-shape round is read straight off rd.items, which carries no `index`,
   * so every fault lost the fix filed against its position and the archive's
   * "what was done about it" column read empty. ops.html loads lib/qc.js before
   * lib/records.js, always; so does this. */
  win.eval(read("lib/qc.js"));

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
  /* popups/tabs/records.js asks WFPerms whether a scope outranks another when
   * it decides who may see a running clock. ops.html loads this one tag before
   * ops.js, so this does too -- without it the tab throws on a leadership
   * render and nothing else in the suite would have noticed. */
  win.eval(read("lib/permissions.js"));
  win.eval(read("popups/ops.js"));

  let def = null;
  const realTab = win.WFOps.tab;
  win.WFOps.tab = (d) => { if (d.id === "records") def = d; return realTab(d); };
  win.eval(read("popups/tabs/records.js"));

  /* Speaks every shape the real Trello API does, because WFStore uses more
   * than one: a KEYLESS get, because the 4096-character limit is per
   * scope/visibility pair and the whole blob is the only thing worth
   * measuring, and an OBJECT passed to set so several keys land in one call.
   * Knowing only the four-argument form measured an empty scope and wrote the
   * patch under the key "undefined". The store stays flat -- these fixtures
   * only ever touch the board scope -- and `writes` still gets one SET per
   * key, so the assertions that count writes are unchanged. */
  const t = {
    get: (s, v, k, d) => {
      if (k === undefined) return Promise.resolve(Object.assign({}, store));
      return Promise.resolve(store[k] === undefined ? d : store[k]);
    },
    set: (s, v, k, val) => {
      const patch = (k && typeof k === "object") ? k : { [k]: val };
      Object.keys(patch).forEach((key) => {
        store[key] = patch[key]; writes.push(["SET", key, patch[key]]);
      });
      return Promise.resolve();
    },
    remove: (s, v, k) => {
      [].concat(k).forEach((key) => { delete store[key]; writes.push(["REMOVE", key, null]); });
      return Promise.resolve();
    }
  };

  const me = as || KEV;
  const ctx = {
    t,
    board: { id: "OPS", name: "Office Operations", members: [KEV, SCOTT, BOSS, me] },
    member: me,
    boardCfg: { stages: [] },
    roster: { managers: ["boss"], phaseSpecialists: {} },
    role,
    isManager: role === "manager",
    cards: () => Promise.resolve(cards),
    reload: () => Promise.resolve(),
    syncCard: () => Promise.resolve(),
    goTo: () => {}
  };

  /* The two functions ops.js hangs on ctx, built the way ops.js builds them --
   * through WFPerms against a real config -- rather than stubbed to a boolean.
   * A stub would let a test pass with the gate asking a question the shipped
   * permission model does not answer. KEV is named against the preset; he is
   * not in WF_CONFIG.managers, so no lockout floor overrides it.
   *
   * `as` swaps who is looking, which is how the WF_CONFIG.managers floor gets
   * tested at all. `people` writes the permission config's people map
   * verbatim, including the empty one -- "this board has no preset for this
   * member" is a state the gate has to answer, and it cannot be reached by
   * naming a preset. Either of them builds `can` and `scopeFor`, because
   * ops.js hangs those two together and never one without the other. */
  if (preset || people) {
    const perms = win.WFPerms.defaults();
    if (preset) perms.people[me.username] = { preset, caps: {} };
    if (people) Object.keys(people).forEach((u) => { perms.people[u] = people[u]; });
    ctx.perms = perms;
    ctx.can = (cap, subject) => win.WFPerms.allows(perms, me.username, cap, subject);
    ctx.scopeFor = (cap) => win.WFPerms.scopeFor(perms, me.username, cap);
  }

  OPEN.push(dom);
  return { win, dom, def, ctx, store, writes, R: win.WFRecords };
}

/**
 * Replace the window's interval functions with a ledger, so "did anything
 * survive" is a question with an exact answer.
 *
 * A real timer would make the teardown test a sleep-and-hope, and the tab's
 * ticker self-cancels on its NEXT tick rather than on the teardown itself --
 * which is the behaviour worth pinning, and is unobservable without being able
 * to fire that tick on demand.
 */
function trapTimers(win) {
  const live = new Map();
  let seq = 0;
  win.setInterval = (fn, ms) => { live.set(++seq, { fn, ms }); return seq; };
  win.clearInterval = (id) => { live.delete(id); };
  return {
    get count() { return live.size; },
    get only() {
      if (live.size !== 1) throw new Error("expected one interval, found " + live.size);
      return live.values().next().value;
    },
    fire() { Array.from(live.values()).forEach((e) => e.fn()); }
  };
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

/* ========================================= a phase two people worked on
 *
 * phase.js stamps the outgoing worker onto their own segments at a handover and
 * writes minutesByPerson onto the log entry as `byPerson`. Everything below is
 * what the archive has to do with that, and the cases it must not break. */

/** A finished phase that changed hands, as phase.js writes it. */
const sharedEntry = (phase, finisher, split, daysAgo) => ({
  listId: "L", listName: phase, claimedBy: finisher,
  durationMinutes: Object.keys(split).reduce((n, k) => n + split[k], 0),
  byPerson: split, completedAt: iso(-daysAgo), approvedBy: BOSS
});

test("a phase two people worked gives a row each, with the right minutes", () => {
  const { R } = boot();
  /* The second card is not decoration: a split is keyed by USERNAME, and the
   * only place a username can be turned back into a name is the claimedBy and
   * approvedBy objects on the cards in hand. Kevin claiming something else in
   * the same set is what lets the archive print "Kevin Moss" -- see the
   * username/display-name test below for what rides on that. */
  const entries = R.timeEntries([
    card("A", { log: [sharedEntry("CAD", SCOTT, { kevinmoss: 90, scottv: 30 }, 1)] }),
    card("B", { log: [logEntry("Assemble CNC", KEV, 15, 1)] })
  ]).filter((e) => e.cardId === "A");

  assert.equal(entries.length, 2, "one row per pair of hands");
  const by = {};
  entries.forEach((e) => { by[e.who] = e; });
  assert.deepEqual(Object.keys(by).sort(), ["Kevin Moss", "Scott VanWorkom"]);
  assert.equal(by["Kevin Moss"].minutes, 90,
    "the hour and a half Kevin put in is Kevin's, not the finisher's");
  assert.equal(by["Scott VanWorkom"].minutes, 30);
  assert.ok(entries.every((e) => e.shared === true), "and both say so");
  assert.equal(entries[0].phase, "CAD");
});

test("the parts of a split sum to the phase's durationMinutes", () => {
  const { R } = boot();
  const log = [sharedEntry("CAD", SCOTT, { kevinmoss: 90, scottv: 30 }, 1)];
  const entries = R.timeEntries([card("A", { log })]);
  assert.equal(entries.length, 2, "there are parts to sum in the first place");
  assert.equal(entries.reduce((n, e) => n + e.minutes, 0), log[0].durationMinutes,
    "no hours invented, none lost -- the phase total is still the phase total");
});

test("a solo phase stays one row and names the one person", () => {
  const { R } = boot();
  const entries = R.timeEntries([card("A", { log: [logEntry("CAD", KEV, 120, 1)] })]);
  assert.equal(entries.length, 1, "nothing to split");
  assert.equal(entries[0].who, "Kevin Moss");
  assert.equal(entries[0].minutes, 120);
  assert.equal(entries[0].shared, undefined,
    "and no flag, because there is nothing shared about it");
});

/* THE BUG THAT WOULD HAVE EATEN THE FIX.
 *
 * byPerson is keyed by USERNAME -- all takeOver can afford to store. Every
 * other row sets `who` from nameOf(claimedBy), a DISPLAY NAME. timeSummary
 * groups on `who`. So a raw username in the split branch put the same welder in
 * the report twice, as "kevinmoss" and as "Kevin Moss", with his hours divided
 * between them: the split would have hidden a person's real total while
 * appearing to fix the attribution. */
test("a username from a split and a display name from a solo phase are ONE person",
  () => {
    const { R } = boot();
    const s = R.timeSummary(R.timeEntries([
      card("A", { log: [sharedEntry("CAD", SCOTT, { kevinmoss: 90, scottv: 30 }, 1)] }),
      card("B", { log: [logEntry("Assemble CNC", KEV, 60, 1)] })
    ]));

    assert.equal(s.byPerson.kevinmoss, undefined,
      "nobody appears in a report under their login");
    assert.equal(s.byPerson["Kevin Moss"].minutes, 150,
      "90 shared plus 60 solo, on one line, under one name");
    assert.equal(s.byPerson["Scott VanWorkom"].minutes, 30);
    assert.equal(Object.keys(s.byPerson).length, 2, "two people worked, two rows");
  });

test("a username nobody is named against anywhere still groups, as itself", () => {
  const { R } = boot();
  const s = R.timeSummary(R.timeEntries([
    card("A", { log: [sharedEntry("CAD", SCOTT, { ghost: 60, scottv: 30 }, 1)] }),
    card("B", { log: [sharedEntry("CAD", SCOTT, { ghost: 20, scottv: 10 }, 1)] })
  ]));
  assert.equal(s.byPerson.ghost.minutes, 80,
    "a readable last resort beats dropping the hours or inventing a name");
});

test("the job's value is not multiplied by the number of people on a phase", () => {
  const { R } = boot();
  /* bump() ASSIGNS value per job rather than summing it, so repeating the
   * value on every split row is already harmless -- but hoursPerThousand and
   * revenuePerHour both divide by it, so this is pinned rather than assumed. */
  const ids = ["A", "B", "C", "D", "E"];
  const solo = R.timeSummary(R.timeEntries(ids.map((id) =>
    card(id, { log: [logEntry("CAD", KEV, 600, 2)], value: 10000 }))));
  const split = R.timeSummary(R.timeEntries(ids.map((id) =>
    card(id, {
      log: [sharedEntry("CAD", SCOTT, { kevinmoss: 300, scottv: 300 }, 2)],
      value: 10000
    }))));

  assert.equal(solo.hoursPerThousand, 1);
  assert.equal(solo.revenuePerHour, 1000);
  assert.equal(Math.round(split.hours), Math.round(solo.hours),
    "the same 50 hours, however many people put them in");
  assert.equal(split.jobsPriced, 5, "five jobs, not ten");
  assert.equal(split.byJob["#A — job A"].value, 10000,
    "the job is worth what it is worth, once");
  assert.equal(split.hoursPerThousand, solo.hoursPerThousand,
    "so the estimating number does not halve when two people share a bench");
  assert.equal(split.revenuePerHour, solo.revenuePerHour);
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
  /* The header, spelled out. What stood here was a ternary on a non-empty
   * string -- always truthy, so it only ever asserted /Job,Job number,Phase/
   * and a column could have been added, renamed or dropped without a word.
   * "Hours per $1,000" holds a comma, so the writer must quote it. */
  assert.equal(lines[0],
    'Job,Job number,Phase,Who,Approved by,Minutes,Hours,Completed,Job value,' +
    '"Hours per $1,000",Shared phase');
  assert.equal(lines.length, 2, "the ongoing entry is left out");
  assert.match(lines[1], /"Job ""A"", with a comma"/, "quotes and commas escaped");
  assert.match(lines[1], /,10000,1,$/,
    "value, then hours per $1,000, then an empty Shared phase -- it was solo");
});

/* ==================================== the export of a phase two people worked
 *
 * This file is the raw material for the shop's standard build time, and nobody
 * re-derives a figure out of a spreadsheet -- they SUM the column and believe
 * it. Everything below pins a number somebody would otherwise believe wrongly. */

/** The rows of one shared phase, in the order toCSV sees them. */
const csvRows = (csv) => csv.split("\n").slice(1).map((l) => l.split(","));

test("the job value is written once per shared phase, so the column sums true", () => {
  const { R } = boot();
  const csv = R.toCSV(R.timeEntries([
    card("A", { log: [sharedEntry("CAD", SCOTT, { kevinmoss: 90, scottv: 30 }, 1)],
                value: 9361 })
  ]));
  const rows = csvRows(csv);
  assert.equal(rows.length, 2, "two people, two rows -- the hours are theirs");
  const values = rows.map((r) => r[8]);
  assert.deepEqual(values.filter((v) => v !== ""), ["9361"],
    "the job is worth what it is worth, once");
  assert.equal(values.reduce((n, v) => n + (Number(v) || 0), 0), 9361,
    "SUM(Job value) is the job's value, not twice it");
});

test("the ratio on a shared phase's first row is the phase's, not one share", () => {
  const { R } = boot();
  /* Ten hours on a $10,000 job is 1.0 hours per $1,000 however the ten hours
   * were divided. Computed from the person's share it would read 0.75 -- a
   * quarter under, silently, on the one number this export exists to make. */
  const shared = csvRows(R.toCSV(R.timeEntries([
    card("A", { log: [sharedEntry("CAD", SCOTT, { kevinmoss: 450, scottv: 150 }, 1)],
                value: 10000 })
  ])));
  const solo = csvRows(R.toCSV(R.timeEntries([
    card("A", { log: [logEntry("CAD", KEV, 600, 1)], value: 10000 })
  ])));

  assert.equal(solo[0][9], "1", "the solo-equivalent figure");
  assert.equal(shared[0][9], solo[0][9],
    "a bench shared does not make the job take a quarter less per $1,000");
  assert.equal(shared[1][9], "", "and it is not printed twice either");
});

test('"Shared phase" says yes on a split row and nothing on a solo one', () => {
  const { R } = boot();
  const rows = csvRows(R.toCSV(R.timeEntries([
    card("A", { log: [sharedEntry("CAD", SCOTT, { kevinmoss: 90, scottv: 30 }, 1)] }),
    card("B", { log: [logEntry("Assemble CNC", KEV, 60, 2)] })
  ])));
  const flagByJob = {};
  rows.forEach((r) => { (flagByJob[r[0]] = flagByJob[r[0]] || []).push(r[10]); });
  assert.deepEqual(flagByJob["#A — job A"], ["yes", "yes"],
    "both halves are parts rather than wholes, and both say so");
  assert.deepEqual(flagByJob["#B — job B"], [""],
    "nothing shared about a phase one person did");
});

test("a shared phase is ONE finished phase in the per-phase table", () => {
  const { R } = boot();
  const s = R.timeSummary(R.timeEntries([
    card("A", { log: [sharedEntry("CAD", SCOTT, { kevinmoss: 90, scottv: 30 }, 1)] }),
    card("B", { log: [logEntry("CAD", KEV, 60, 2)] })
  ]));
  assert.equal(s.byPhase["CAD"].count, 2, "two CAD phases, not three rows");
  assert.equal(s.byPhase["CAD"].minutes, 180, "and every minute still counted");
  assert.equal(s.byJob["#A — job A"].count, 1, "one phase of job A was finished");
  assert.equal(s.byPerson["Kevin Moss"].count, 2,
    "byPerson still counts rows -- two people genuinely are two people's work");
});

test("s.phases is the distinct phase count, and s.entries stays the row count", () => {
  const { R } = boot();
  const s = R.timeSummary(R.timeEntries([
    card("A", { log: [sharedEntry("CAD", SCOTT, { kevinmoss: 90, scottv: 30 }, 1),
                      logEntry("Assemble CNC", KEV, 60, 2)] }),
    card("B", { log: [logEntry("CAD", KEV, 30, 3)] })
  ]));
  assert.equal(s.phases, 3, "three phases were finished");
  assert.equal(s.entries, 4, "across four rows -- the headline must not use this");
});

/* THE TWO BENCHES BEHIND ONE COLUMN.
 *
 * Blast and powder share the Trello list and both log under the PHASE name, so
 * cardId|phase is one string for two separate pieces of work -- see
 * lib/steps.js. The timestamp is a tie-breaker, not an identity. */
test("blast and powder are two phases even when nothing but the step differs", () => {
  const { R } = boot();
  const at = iso(-1);
  const stepped = (step) => ({
    listId: "L", listName: "Sandblast / Powder Coat", step: step,
    claimedBy: KEV, durationMinutes: 60, completedAt: at, approvedBy: BOSS
  });
  const cards = [card("A", { log: [stepped("blast"), stepped("powder")], value: 10000 })];

  const s = R.timeSummary(R.timeEntries(cards));
  assert.equal(s.phases, 2, "two benches finished two pieces of work");
  assert.equal(s.byPhase["Sandblast / Powder Coat"].count, 2);

  const rows = csvRows(R.toCSV(R.timeEntries(cards)));
  assert.deepEqual(rows.map((r) => r[8]).filter((v) => v !== ""), ["10000", "10000"],
    "each is its own phase, so each carries the value -- see phaseKey");
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
  /* The refusal now comes from WFStore, which measures the whole board scope
   * rather than this one key, and it carries a code as well as a sentence.
   * Assert on the code, because that is what callers branch on, and on the
   * opening words, because a refusal nobody can read is the failure this test
   * was written about. Not on the character count in the message: that moves
   * every time anything else on the board is saved. */
  await assert.rejects(() => env.R.saveTraining(env.ctx.t, big), (e) => {
    assert.equal(e.code, "WF_STORE_FULL");
    assert.match(e.message, /isn't room/i);
    assert.match(e.message, /training records/, "and names what it could not save");
    assert.match(e.message, /Nothing was changed/, "and says the save did not half-happen");
    return true;
  });
  assert.equal(env.store.wfTraining.length, 0, "and nothing was written");
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

test("a worker gets Time, Safety and Training; a manager gets all four", async () => {
  /* REWRITTEN WITH THE GATE MOVE. This read ["Safety", "Training"] and said
   * "hours and names aren't theirs to browse", which was the right sentence
   * about the wrong unit: Time is two things, and only the archive half is
   * hours and names. The live mirror is state and percent, the same thing the
   * shop floor is shown at the bench. The `roles: ["manager", "office"]` list
   * that produced the old answer has gone from the Time section for exactly
   * that reason; what a worker must still not reach is asserted below, per
   * half rather than per section. */
  const wkr = boot({ role: "worker" });
  const wnode = await render(wkr);
  const wrail = $(wnode, ".wf-rec-r").map(textOf);
  assert.deepEqual(wrail, ["Time", "Safety", "Training"],
    "the live mirror is his; Quality is not, and he holds no safety.view " +
    "grant to lose because this ctx predates grants");

  const mgr = boot({ role: "manager" });
  const mnode = await render(mgr);
  const mrail = $(mnode, ".wf-rec-r").map((b) => textOf(b).replace(/\d+$/, ""));
  assert.deepEqual(mrail, ["Time", "Quality", "Safety", "Training"]);
});

test("a worker opening Safety can file, and can file anonymously", async () => {
  /* RENAMED AND RE-NAVIGATED, not re-scoped. "Landing on" was literal: with
   * Time closed to a worker, Safety was the first section in his rail and the
   * render put him there. Time is open to him now and sorts first, so he
   * lands on the live mirror and reaches Safety by tapping it -- which is
   * what the rail is for. Nothing about who may file has changed, and that is
   * what this test is about. */
  const env = boot({
    role: "worker",
    safety: { lists: [{ id: "L1", name: "Just reported" }], cards: [],
              labels: [{ id: "B1", name: "Near miss" }, { id: "B2", name: "Injury" },
                       { id: "B3", name: "Hazard" }, { id: "B4", name: "PPE request" }],
              members: [] }
  });
  const node = await render(env);
  assert.match(textOf(node), /Safety/, "the pill is in his rail");
  $(node, ".wf-rec-r").find((b) => /^Safety\b/.test(textOf(b).trim()))
    .dispatchEvent(new env.win.Event("click"));

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

/* THE HEADLINE AND THE HOURS UNDER IT HAVE TO BE ABOUT THE SAME THING.
 *
 * "N finished phases" sat under a correct hours figure and read `s.entries` --
 * a ROW count, one per pair of hands. A two-person CAD job reported as two
 * phases, next to the right number of hours, is the shape of wrongness nobody
 * checks. Both the stat and the export dialog are pinned here. */
test('"finished phases" counts phases, in the headline and in the export', async () => {
  const env = boot({
    cards: [
      card("A", { log: [sharedEntry("CAD", SCOTT, { kevinmoss: 90, scottv: 30 }, 1)] }),
      card("B", { log: [logEntry("CAD", KEV, 60, 2)] }),
      card("C", { log: [logEntry("Assemble CNC", KEV, 60, 2)] })
    ]
  });
  const node = await render(env);
  assert.match(textOf(node), /3 finished phases/,
    "three phases across four rows -- the row count would say 4");
  assert.doesNotMatch(textOf(node), /4 finished phases/);

  $(node, "button").find((b) => textOf(b) === "Export")
    .dispatchEvent(new env.win.Event("click"));
  assert.match(textOf(env.win.document.body), /3 finished phases/,
    "the dialog counts what the export is about, not its lines");
});

test("running work is shown but kept out of the totals", async () => {
  const env = boot({
    cards: [
      card("A", { log: [logEntry("CAD", KEV, 60, 2)] }),
      card("B", { name: "Half done", work: { listId: "ASM", claimedBy: SCOTT,
        segments: [{ start: new Date(Date.now() - 180 * 60000).toISOString() }] } })
    ]
  });
  const node = await render(env);
  assert.match(textOf(node), /Live work/);
  assert.match(textOf($(node, ".wf-rec-live")[0]), /Half done/);
  assert.match(textOf(node), /1 hours logged|Hours logged/);
  // One hour signed off, three on a bench. The archive counts the one.
  assert.match(textOf(node), /1 finished phases|1 finished phase/);
});

/* ==================================================== the live work mirror
 *
 * The owner asked for two trackers side by side: what the benches are doing
 * this second, and what has been finished and signed off. The second one
 * existed; the first was a three-column table called "Running right now" that
 * listed completed phases as though somebody were still on them, showed an
 * elapsed figure to every manager, and never mentioned progress at all.
 */

const minsAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

/** A phase with the clock running: one open segment, ninety minutes in. */
const RUNNING = { listId: "ASM", claimedBy: SCOTT, percentComplete: 40,
                  segments: [{ start: minsAgo(90), end: null }] };

/** The same phase stopped for lunch: every segment closed, one hour on it. */
const PAUSED = { listId: "ASM", claimedBy: KEV, percentComplete: 70,
                 segments: [{ start: minsAgo(120), end: minsAgo(60) }] };

/** Finished, but the card has not moved on yet -- complete() wrote both. */
const SETTLED = { listId: "ASM", claimedBy: KEV, percentComplete: 100,
                  completedAt: minsAgo(5),
                  segments: [{ start: minsAgo(50), end: minsAgo(5) }] };

const liveRows = (node) => $(node, ".wf-rec-live");

test("a live row says running or paused, from the same fact the bench does", () => {
  const { R } = boot();
  const rows = R.openEntries([
    card("A", { name: "Running job", work: RUNNING }),
    card("B", { name: "Paused job", work: PAUSED })
  ]);

  const run = rows.find((e) => e.job === "Running job");
  const hold = rows.find((e) => e.job === "Paused job");

  assert.equal(run.running, true, "an open final segment is what running means");
  assert.equal(run.paused, false);
  assert.equal(run.percent, 40);

  assert.equal(hold.running, false, "every segment closed -- nobody is on it");
  assert.equal(hold.paused, true);
  assert.equal(hold.percent, 70);

  assert.ok(rows.every((e) => e.ongoing && !e.finished),
    "neither is finished, so neither may reach the archive's totals");
});

/* ================= the slider slides itself: completion already writes 100
 *
 * The ask was "when a project has been completed the slider should slide to
 * 100% for that phase", and the data was already right: complete() sets
 * percentComplete = 100 itself, and it is the ONLY writer of completedAt in
 * the repo -- qc.js' three finishing paths all go through it. So nothing had
 * to learn to do this; what was missing was anywhere in Records that showed a
 * percent at all. This is the test that proves the end-to-end rather than a
 * fix that would have been redundant.
 */
test("completing a phase slides it to 100 without anyone touching the slider", async () => {
  const env = boot();
  const work = { listId: "ASM", claimedBy: KEV, percentComplete: 35,
                 segments: [{ start: minsAgo(45), end: null }] };
  env.store["C1/phaseWork"] = work;

  // The real thing, through the real API shape: scope is the card id.
  const t = {
    get: (scope, vis, key, dflt) => Promise.resolve(
      env.store[scope + "/" + key] === undefined ? dflt : env.store[scope + "/" + key]),
    set: (scope, vis, key, val) => { env.store[scope + "/" + key] = val; return Promise.resolve(); }
  };
  // `silent` because the comment is the only thing complete() needs the
  // network for, and this is a test about the record, not the audit trail.
  const after = await env.win.WFPhase.complete(t, { id: "C1", idList: "ASM" }, { silent: true });
  assert.equal(after.percentComplete, 100, "complete() moves the slider itself");
  assert.ok(after.completedAt, "and stamps the fact everything else reads");

  const row = env.R.openEntries([card("C1", { name: "Welded gate", work: after })])[0];
  assert.equal(row.finished, true);
  assert.equal(row.percent, 100, "and Records reads 100 off it");
});

test("a phase finished under the retired approval model still reads 100", () => {
  /* `pendingApproval` is a read-only bridge for cards completed before the
   * checklist model -- isFinished still honours it, and those were parked at
   * whatever percent the bench had reached. "Complete" beside "65%" is the
   * contradiction that makes people stop believing a screen. */
  const { R } = boot();
  const legacy = { listId: "ASM", claimedBy: KEV, percentComplete: 65,
                   pendingApproval: true,
                   segments: [{ start: minsAgo(100), end: minsAgo(10) }] };
  const row = R.openEntries([card("L", { name: "Old job", work: legacy })])[0];
  assert.equal(row.finished, true);
  assert.equal(row.percent, 100);
  assert.equal(row.paused, false, "finished is not paused -- nobody is coming back to it");
});

test("the two trackers are separate: a running job, a paused one, a finished one",
  async () => {
    const env = boot({
      cards: [
        card("A", { name: "Running job", work: RUNNING }),
        card("B", { name: "Paused job", work: PAUSED }),
        card("C", { name: "Settled job", work: SETTLED }),
        card("D", { name: "Signed off job", log: [logEntry("CAD", KEV, 120, 2)] })
      ]
    });
    const node = await render(env);
    const rows = liveRows(node);

    const live = rows.filter((r) => !r.classList.contains("is-done"));
    assert.equal(live.length, 2, "two jobs are being worked; the finished one is not");

    const run = live.find((r) => /Running job/.test(textOf(r)));
    const hold = live.find((r) => /Paused job/.test(textOf(r)));

    assert.match(textOf(run), /Running/, "the word");
    assert.ok(run.classList.contains("is-run"), "and a state the eye can pick out");
    assert.match(textOf(run), /40%/, "percent is shown on a running job");

    assert.match(textOf(hold), /Paused/);
    assert.ok(hold.classList.contains("is-pause"));
    assert.doesNotMatch(textOf(hold), /Running/, "a paused job must never read as running");
    assert.match(textOf(hold), /70%/, "percent is shown on a paused one too");

    /* The finished phase sits on the completed side, at 100, and nowhere in
     * the live list. It is not in the totals either -- it has no phaseLog
     * entry yet -- which is why it is shown without an hours figure. */
    const settled = rows.find((r) => /Settled job/.test(textOf(r)));
    assert.ok(settled.classList.contains("is-done"));
    assert.match(textOf(settled), /Complete/);
    assert.match(textOf(settled), /100%/);
    assert.ok(!live.includes(settled), "a completed phase is not live work");
    assert.match(textOf(node), /Finished, waiting to move on/);

    // And the headline separation the owner asked for, in the two titles.
    assert.match(textOf(node), /Live work/);
    assert.match(textOf(node), /Completed work/);
  });

test("the completed total is the signed-off hours, and only those", async () => {
  const env = boot({
    cards: [
      // 120 + 90 + 30 = 240 minutes signed off = 4 hours.
      card("A", { name: "One", log: [logEntry("CAD", KEV, 120, 2)] }),
      card("B", { name: "Two", log: [logEntry("Assemble", SCOTT, 90, 3)] }),
      card("C", { name: "Three", log: [logEntry("Paint", KEV, 30, 4)] }),
      // Three more hours on benches right now, and forty-five minutes finished
      // but not yet logged. Neither is signed-off work; neither may be added.
      card("D", { name: "Running job", work: RUNNING }),
      card("E", { name: "Settled job", work: SETTLED })
    ]
  });
  const node = await render(env);
  const total = $(node, ".wf-stat").find((s) => /Hours logged/.test(textOf(s)));

  // The value element, not the squashed text of the tile: "4" and "3 finished
  // phases" sit in two children and read as "43" concatenated.
  assert.equal(textOf(total.querySelector(".wf-stat-v")), "4",
    "four signed-off hours -- not the five and a half that are on the board");
  assert.equal(textOf(total.querySelector(".wf-stat-n")), "3 finished phases");
});

/* ======================================= THE CLOCK IS LEADERSHIP'S, OR NOBODY'S
 *
 * lib/tables.js' elapsedMinutes sets out why the shop floor never sees a
 * running clock: a timer ticking at a welder turns an honest record of how
 * long things take into something he is being judged by, and the moment that
 * happens the timings stop being honest and the whole dataset is worthless.
 *
 * A live mirror in Records is exactly the shape of thing that becomes the back
 * door around that, so these are the tests that matter most on this feature.
 * They are written as a search of the WHOLE rendered output rather than a
 * check on the element the clock is supposed to be in -- a number that leaked
 * would leak somewhere nobody thought to look, which is the definition of the
 * bug.
 */

/* Three ways a duration can print on this tab. O.clock gives "1:30:00",
 * O.hours gives "2h 00m" or, under the hour, "45m". The archive's own figures
 * are decimal hours ("4", "7.5") and the word "hours", which match none of
 * these -- that separation is what lets this be a whole-document search. */
const CLOCK_FACE = /\b\d{1,3}:\d{2}(:\d{2})?\b/;
const H_AND_M = /\b\d{1,3}h\s*\d{1,2}m\b/;
const BARE_MINS = /\b\d{1,3}\s*m\b/;

const CLOCK_CARDS = [
  card("A", { name: "Running job", work: RUNNING }),
  card("B", { name: "Paused job", work: PAUSED }),
  card("C", { name: "Settled job", work: SETTLED }),
  card("D", { name: "Signed off job", log: [logEntry("CAD", KEV, 120, 2)] })
];

test("leadership gets the live clock", async () => {
  const env = boot({ cards: CLOCK_CARDS, preset: "leadership" });
  const node = await render(env);

  const clocks = $(node, ".wf-rec-clock");
  assert.equal(clocks.length, 2, "one per live row, and none on the finished one");
  assert.match(textOf(clocks[0]), /^\d{1,3}:\d{2}:\d{2}$/, "h:mm:ss, so a second shows");
  assert.match(textOf(clocks[0]), /^1:30:0\d$/, "ninety minutes on the running job");
  assert.match(textOf(clocks[1]), /^1:00:00$/, "and an hour on the paused one, stopped");
  assert.ok(clocks.every((c) => c.getAttribute("data-card")),
    "each clock names its card so the ticker can re-read the work");
  assert.match(textOf(node), /on these jobs so far: 2h 30m/,
    "and the live total -- ninety minutes running plus sixty paused");
});

/* `worker` IS in this list again, and that is the whole point of the gate
 * move. While Time carried `minScope: "area"` a worker could not open the
 * section at all, so running the clock search against him would have been the
 * vacuous pass this test's own header warns about -- a green tick proving only
 * that a hidden tab shows no clock. He now reaches the live mirror, which
 * makes him the most interesting row in this table rather than an absent one.
 *
 * The expected row count differs because `.wf-rec-live` is used by two panels:
 * the live mirror, and the settling list ("Finished, waiting to move on")
 * which lives inside `doneTracker` and is therefore archive-side. A worker
 * sees the two live rows and not the settled one. */
[["worker", "stands at the bench", 2],
 ["shop_manager", "runs the floor", 3],
 ["office_manager", "runs the office", 3]]
 .forEach(([preset, who, rows]) => {
  test("a " + preset + " (" + who + ") gets no clock ANYWHERE on this tab", async () => {
    const env = boot({ cards: CLOCK_CARDS, preset });
    const node = await render(env);
    const txt = textOf(node);

    // First: they are looking at the live mirror at all. A test that passed
    // because the section was hidden would prove nothing about the clock.
    assert.match(txt, /Live work/, "they can see the tracker");
    assert.equal(liveRows(node).length, rows, "and every row on it");
    assert.match(txt, /Running/);
    assert.match(txt, /Paused/);
    assert.match(txt, /40%/, "state and percent are theirs");
    assert.match(txt, /70%/);

    assert.equal($(node, ".wf-rec-clock").length, 0, "no clock element");

    /* AND NO TIME ANYWHERE ELSE IN THE OUTPUT. The leaks worth catching are
     * the ones somewhere other than the element the gate guards: a panel
     * subtitle, a total in a header, a title attribute. */
    assert.doesNotMatch(txt, CLOCK_FACE, "a clock face leaked into: " + txt);
    assert.doesNotMatch(txt, H_AND_M, "an elapsed figure leaked into: " + txt);
    assert.doesNotMatch(txt, BARE_MINS, "a minutes figure leaked into: " + txt);

    // textContent misses attributes, and a tooltip is still the number.
    const attrs = $(node, "*").map((n) => Array.from(n.attributes || [])
      .map((a) => a.value).join(" ")).join(" ");
    assert.doesNotMatch(attrs, CLOCK_FACE, "a clock face leaked into an attribute");
    assert.doesNotMatch(attrs, H_AND_M, "an elapsed figure leaked into an attribute");

    // And nothing was left ticking to put one there a second later.
    assert.doesNotMatch(textOf(env.win.document.body), CLOCK_FACE,
      "nor anywhere else in the document");
  });
});

/* ================================================= nothing is left ticking
 *
 * Every earlier ticking view in this project leaked, and the Floor's timer
 * comment says so in as many words. There is no teardown hook on O.tab: ops.js
 * empties #view and renders the next tab, so a tab learns it has gone only by
 * finding its host detached. These pin both halves -- one interval per paint,
 * and that interval removing itself once the host is gone.
 */

test("the live clock runs on one interval, and only while the tab is on screen",
  async () => {
    const env = boot({ cards: CLOCK_CARDS, preset: "leadership" });
    const timers = trapTimers(env.win);

    const node = await render(env);
    assert.equal(timers.count, 1, "one interval for the whole tab");
    assert.equal(timers.only.ms, 1000, "ticking every second, because it reads h:mm:ss");

    // A tick while the tab is up moves the running clock and leaves the
    // paused one alone -- which is the state showing itself.
    const [run, hold] = $(node, ".wf-rec-clock");
    hold.textContent = "tampered";
    timers.fire();
    assert.match(textOf(run), /^1:30:0\d$/, "the running clock was rewritten");
    assert.match(textOf(hold), /^1:00:00$/, "and so was the paused one, to the same number");

    /* TEARDOWN, exactly as ops.js does it: the view is emptied and the host
     * stops being connected. Nobody tells the tab. */
    env.win.document.getElementById("view").innerHTML = "";
    assert.equal(node.isConnected, false, "the host is detached, as on a tab switch");

    timers.fire();
    assert.equal(timers.count, 0, "and the next tick cleared the interval rather than firing on");
  });

test("re-rendering the tab replaces the interval instead of stacking another",
  async () => {
    const env = boot({ cards: CLOCK_CARDS, preset: "leadership" });
    const timers = trapTimers(env.win);

    await render(env);
    const first = timers.only;
    await render(env);
    assert.equal(timers.count, 1, "still one -- a second paint must not add a second clock");
    assert.notStrictEqual(timers.only, first, "and it is the new one, not the orphan");
  });

test("with nothing live, no interval is started at all", async () => {
  const env = boot({
    cards: [card("D", { name: "Signed off job", log: [logEntry("CAD", KEV, 120, 2)] })],
    preset: "leadership"
  });
  const timers = trapTimers(env.win);
  await render(env);
  assert.equal(timers.count, 0, "an empty archive screen has nothing to tick");
});

/* ================================================== WHO SEES WHICH SECTION
 *
 * The gate is a permission change, so it is tested the way a permission change
 * has to be: the exact set of sections each shipped preset renders, asserted
 * as a whole list rather than one membership at a time. A test that only
 * checks what IS there cannot catch a section that should have gone and
 * didn't.
 *
 * THE RAIL IS NO LONGER THE WHOLE ANSWER, and that is the change. Time holds
 * two things with two audiences -- the live mirror (state word, percent, and
 * for leadership a clock) and the archive (everybody's hours, the two ratios,
 * the CSV export) -- so "may he open Time" and "may he read the archive" are
 * two questions and get two assertions. They were briefly one: `minScope:
 * "area"` on the Time section closed the archive by closing the section,
 * which also took the live mirror off a welder's screen and left his Records
 * tab reading, in its entirety, "Training".
 *
 * The rule still being pinned underneath: `ctx.can` is true at ANY scope above
 * none, and every preset including `worker` holds see.timers at "own", so a
 * bare capability check must not be what stands between a welder and by-person
 * hours for the whole shop. Reading other people's numbers starts at "area" --
 * it is just enforced one level down now, in `maySeeArchive`.
 */

const railLabels = (node) => $(node, ".wf-rec-r").map(textOf).map((t) => t.trim());

async function sectionsFor(opts) {
  const env = boot(Object.assign({ cards: [] }, opts));
  const node = await render(env);
  return { env, node, labels: railLabels(node) };
}

/**
 * The three independent yes/nos inside Time, read off a real render.
 *
 * Deliberately three booleans rather than one: the whole bug being fixed was
 * a single switch standing in for three answers. `export` is counted with the
 * archive because a Download CSV button is the quietest way the archive
 * leaks -- a present-but-inert one is still a leak, so this looks for the
 * button's existence and not for whether it is enabled.
 */
async function timeFor(opts) {
  const env = boot(Object.assign({ cards: CLOCK_CARDS.concat([
    card("E", { name: "Slider only", work: IDLE }) ]) }, opts));
  const node = await render(env);
  const labels = railLabels(node);
  if (!labels.includes("Time")) {
    return { env, node, labels, section: false,
             mirror: false, archive: false, clock: false, exportBtn: false };
  }
  // Click it rather than trusting the default landing section: which section
  // opens first is module state that survives between renders in this file.
  $(node, ".wf-rec-r").find((b) => /^Time\b/.test(textOf(b).trim()))
    .dispatchEvent(new env.win.Event("click"));
  const txt = textOf(node);
  return {
    env, node, labels, section: true,
    mirror: /Live work/.test(txt) && $(node, ".wf-rec-live").length > 0,
    archive: /Completed work/.test(txt),
    clock: $(node, ".wf-rec-clock").length > 0,
    exportBtn: $(node, "button").some((b) => /Export/.test(textOf(b)))
  };
}

const shows = (r) => [r.mirror, r.archive, r.clock].map((b) => (b ? "yes" : "no")).join("/");

/* sections, then mirror / archive / clock. The three are written out per row
 * rather than derived from each other on purpose: a table that computed
 * "archive = not worker" would agree with the code by construction. */
const PRESET_MATRIX = [
  // A worker holds see.timers at "own" -- enough for the mirror of what the
  // benches are doing, which is what he is shown at his bench anyway. "own"
  // has never meant he may read everyone's hours.
  ["worker", ["Time", "Training"], "yes/no/no"],
  // "area" is the archive bar. Neither manager tier holds "all", so neither
  // gets a clock: the clock is the one thing that stays leadership-only.
  ["shop_manager", ["Time", "Quality", "Safety", "Training"], "yes/yes/no"],
  ["office_manager", ["Time", "Quality", "Safety", "Training"], "yes/yes/no"],
  ["leadership", ["Time", "Quality", "Safety", "Training"], "yes/yes/yes"]
];

PRESET_MATRIX.forEach(([preset, expected, inside]) => {
  test("the " + preset + " preset renders exactly " + expected.join(" + "), async () => {
    const { labels } = await sectionsFor({ preset });
    assert.deepStrictEqual(labels, expected,
      "the rail is the access surface of this tab -- a section missing " +
      "from it cannot be opened, and one present in it can");
  });

  test("inside Time, " + preset + " gets mirror/archive/clock = " + inside, async () => {
    const r = await timeFor({ preset });
    assert.equal(r.section, true, "fixture: " + preset + " can open Time at all");
    assert.equal(shows(r), inside,
      "three questions, three answers -- one switch standing in for all " +
      "three is the bug this gate was moved to fix");
    assert.equal(r.exportBtn, r.archive,
      "the Export button appears with the archive and never without it");
  });
});

test("a per-person override moves the archive without moving the section", async () => {
  /* REWRITTEN. This asserted rail labels alone, which is no longer where the
   * override lands: Time is open to a worker either way now, so a test
   * watching only the rail would have gone on passing while `see.timers:
   * "area"` stopped doing anything at all. What the override moves is the
   * archive, so that is what is read.
   *
   * The override is the reason scope is read rather than role: "a shop crew
   * member, but this one reads the time archive" has to be sayable without
   * making him a manager, and "a shop manager, but not this one thing" has to
   * be sayable the other way. */
  const up = await timeFor({
    people: { [KEV.username]: { preset: "worker", caps: { "see.timers": "area" } } } });
  assert.deepStrictEqual(up.labels, ["Time", "Training"],
    "Quality, still at own, stays shut -- it is a straight section gate");
  assert.equal(shows(up), "yes/yes/no",
    "lifted to area the archive opens; area is not all, so no clock");
  assert.equal(up.exportBtn, true, "and the export comes with it");

  const crew = await timeFor({
    people: { [KEV.username]: { preset: "worker", caps: { "see.timers": "crew" } } } });
  assert.deepStrictEqual(crew.labels, ["Time", "Training"],
    "crew still opens the section -- any scope above none does");
  assert.equal(shows(crew), "yes/no/no",
    "but crew is below area, and the step between them is the whole point");
  assert.equal(crew.exportBtn, false, "no archive, therefore no export");

  const down = await timeFor({
    people: { [KEV.username]: { preset: "shop_manager", caps: { "see.timers": "none" } } } });
  assert.deepStrictEqual(down.labels, ["Quality", "Safety", "Training"],
    "'none' on a person removes a grant the preset gave -- and 'none' is the " +
    "one scope that closes the section as well as the archive");
  assert.equal(down.section, false, "so there is no Time tab to open");
});

test("the four names in WF_CONFIG.managers still reach Time, the archive and the clock",
  async () => {
    /* The lockout floor: WFPerms.isFloor hands these people everything(), and
     * it is deliberately not editable from the UI. A permission change that
     * locked the owner out of his own archive would be found on a Monday
     * morning, not in a test run, so it is found here. Extended past the rail
     * with the gate move: the floor has to carry the inside of Time too, and
     * a rail-only assertion would have passed with the archive gone. */
    const named = boot().win.WF_CONFIG.managers;
    assert.ok(named.length === 4, "fixture: config.js still names four");

    for (const username of named) {
      // No people entry at all for them -- the floor is what must carry it.
      const as = { username, fullName: username };
      const { labels } = await sectionsFor({ as, people: {} });
      assert.deepStrictEqual(labels, ["Time", "Quality", "Safety", "Training"],
        username + " is named in WF_CONFIG.managers and must hold everything");

      const r = await timeFor({ as, people: {} });
      assert.equal(shows(r), "yes/yes/yes",
        username + " holds everything() -- see.timers at 'all', so all three");
    }
  });

/* ------------------------------------------- the two fallbacks, adversarially
 *
 * FAILS CLOSED IS THE REQUIREMENT. Every path out of `allowed()` that cannot
 * evaluate a scope has to refuse, because the one weaker answer lying around
 * -- `ctx.can` -- is true at "own", which is exactly the grant minScope was
 * added to turn down. A fallback that reaches for it is not degraded, it is
 * inverted.
 */

test("a missing WFPerms refuses the archive and the clock, and does not take the tab down",
  async () => {
    /* REWRITTEN, AND IT FOUND A BUG. This asserted ["Safety", "Training"] --
     * the whole of Time refused -- which was the OLD policy: `minScope` on the
     * section, `allowed()` unable to compare scopes, section gone. With Time
     * open the assertion had to move to the archive, and moving it exposed
     * what the section gate had been hiding: `maySeeClock` dereferenced
     * `WFPerms` with no `typeof` probe, and was unreachable without it only
     * because `allowed()` had already refused the section. Opening Time made
     * it run on every render, so this fixture threw a ReferenceError that
     * `refresh()`'s catch turned into "Couldn't load the records" for the
     * entire tab -- for a shop manager, over a script tag that failed to
     * load. The guard is in `maySeeClock` now; this is the test for it. */
    const env = boot({ cards: CLOCK_CARDS, preset: "shop_manager" });
    /* Rebind first: boot's closures call win.WFPerms by name, so deleting it
     * would break the ctx rather than the thing under test. The ctx keeps a
     * working scope model; the TAB loses the library it compares scopes with,
     * which is the real shape of a load-order or CDN failure. */
    const P = env.win.WFPerms;
    env.ctx.can = (cap) => P.allows(env.ctx.perms, KEV.username, cap);
    env.ctx.scopeFor = (cap) => P.scopeFor(env.ctx.perms, KEV.username, cap);
    delete env.win.WFPerms;
    assert.equal(typeof env.win.WFPerms, "undefined", "fixture: the library is gone");

    const node = await render(env);
    const txt = textOf(node);
    assert.doesNotMatch(txt, /Couldn't load the records/,
      "THE TAB STILL RENDERS. A ReferenceError here is swallowed by " +
      "refresh()'s catch and comes out as a load failure, which is the " +
      "least debuggable shape this bug could take");

    assert.deepStrictEqual(railLabels(node), ["Time", "Safety", "Training"],
      "Time opens on ctx.can, which needs no scope comparison; Quality " +
      "carries minScope and is refused because one cannot be made");
    assert.match(txt, /Live work/, "and the mirror inside it renders");
    assert.doesNotMatch(txt, /Completed work/,
      "a shop manager genuinely holds see.timers at area -- but with nothing " +
      "to compare scopes WITH, the archive answer must be no, not ctx.can's yes");
    assert.equal($(node, ".wf-rec-clock").length, 0, "and no clock either");
    assert.ok(!$(node, "button").some((b) => /Export/.test(textOf(b))),
      "nor the export that comes with the archive");
  });

test("a scopeFor that answers undefined is refused, not ranked", async () => {
  /* REWRITTEN: expected ["Safety", "Training"], which was the old policy's
   * way of saying "refused". The refusal is now inside Time rather than
   * instead of it. Leadership is the fixture precisely because the strongest
   * preset must still be turned down when the scope cannot be read. */
  const env = boot({ cards: CLOCK_CARDS, preset: "leadership" });
  env.ctx.scopeFor = () => undefined;        // an unknown capability, or a stub
  const node = await render(env);
  const txt = textOf(node);

  assert.deepStrictEqual(railLabels(node), ["Time", "Safety", "Training"],
    "Quality's minScope has nothing to rank, so Quality goes");
  assert.match(txt, /Live work/, "Time opens on ctx.can, which is still honest");
  assert.doesNotMatch(txt, /Completed work/,
    "scopeRank(undefined) is 0 and 0 is below area -- leadership itself is " +
    "refused the archive, which is what fails-closed means");
  assert.equal($(node, ".wf-rec-clock").length, 0,
    "and below all, so refused the clock too");
});

test("a board with no preset for this member gets the worker answer, not a free pass",
  async () => {
    /* REWRITTEN from ["Training"]. The free pass being guarded against was
     * never the section, it was the archive: `effective()` falls back to the
     * worker preset, worker holds see.timers at "own", and "own" is below
     * area. The section opening is the correct new answer; the archive
     * staying shut is the assertion that was always the point. */
    const empty = await timeFor({ people: {} });
    assert.deepStrictEqual(empty.labels, ["Time", "Training"],
      "effective() falls back to the worker preset, which holds see.timers");
    assert.equal(shows(empty), "yes/no/no",
      "and worker is below area, so the archive stays shut");

    const ghost = await timeFor({
      people: { [KEV.username]: { preset: "no_such_preset", caps: {} } } });
    assert.deepStrictEqual(ghost.labels, ["Time", "Training"],
      "and a preset id that no longer exists falls the same way");
    assert.equal(shows(ghost), "yes/no/no");
  });

test("a context from before the scope model answers on its role list, archive included",
  async () => {
    /* No `can`, no `scopeFor` -- the shape ops.js built before permissions.js
     * existed, and the shape every non-permission fixture in this file still
     * uses.
     *
     * REWRITTEN IN TWO PLACES, both of them the old policy written down:
     *
     * `role: "worker"` expected ["Safety", "Training"], because the Time
     * SECTIONS entry carried `roles: ["manager", "office"]` -- the pre-scope
     * spelling of "no Time for a welder". That list has gone with the
     * minScope. Leaving it would have meant a legacy ctx hiding the live
     * mirror while a capability ctx showed it: the same question answered
     * differently depending on which side of the permissions release you
     * were on.
     *
     * The archive assertions are new. `maySeeArchive` keeps a role list of
     * its own for a ctx with no scopeFor, and it deliberately does NOT
     * hard-refuse the way `maySeeClock` does -- refusing would hide the
     * archive from the very managers the legacy model always let in. That is
     * the branch least covered by anything else, so it is asserted from both
     * sides here. */
    const mgr = await timeFor({ role: "manager" });
    assert.deepStrictEqual(mgr.labels, ["Time", "Quality", "Safety", "Training"],
      "Quality's roles list still admits a manager");
    assert.equal(shows(mgr), "yes/yes/no",
      "maySeeArchive's legacy branch lets a manager in; maySeeClock " +
      "hard-refuses a ctx with no scopeFor, so there is still no clock");

    const office = await timeFor({ role: "office" });
    assert.deepStrictEqual(office.labels, ["Time", "Quality", "Safety", "Training"]);
    assert.equal(shows(office), "yes/yes/no", "and the other legacy role the same");

    const hand = await timeFor({ role: "worker" });
    assert.deepStrictEqual(hand.labels, ["Time", "Safety", "Training"],
      "Time has no roles list any more, so a legacy worker reaches the " +
      "mirror; Quality still has one and still turns him down");
    assert.equal(shows(hand), "yes/no/no",
      "the mirror, and neither the archive nor the clock");
    assert.equal(hand.exportBtn, false, "and no export");
  });

/* ====================================== the worker, and the clock he must not see
 *
 * REWRITTEN, AND IT IS A DIFFERENT TEST NOW. It used to read "a worker gets no
 * Time section at all", which was true under `minScope: "area"` and made the
 * duration search vacuous -- it proved that a hidden section prints no
 * numbers. He reaches the live mirror now, with running, paused and idle rows
 * on the screen, so the search finally runs over output that COULD have
 * carried a duration and must not.
 *
 * Three things, and all three have to hold at once: he sees the mirror, he
 * sees no clock, he sees no archive. The archive half is checked by name --
 * by-person table, either ratio, and the Export button -- because the export
 * is the quietest way this leaks, and a disabled-but-present button would
 * still be a leak.
 */
test("a worker reaches the live mirror, and no duration or archive figure with it",
  async () => {
    const env = boot({ cards: CLOCK_CARDS.concat([
      card("E", { name: "Slider only", work: IDLE }) ]), preset: "worker" });
    const node = await render(env);

    assert.deepStrictEqual(railLabels(node), ["Time", "Training"],
      "Time is his; Quality is a straight section gate at area and is not, " +
      "and worker holds no safety.view either");

    /* THE MIRROR IS REALLY THERE, in all three live states. Without this the
     * rest of the test is the vacuous pass the old version was. */
    const rows = $(node, ".wf-rec-live");
    assert.equal(rows.length, 3, "running, paused and idle -- and not the settled one");
    const txt = textOf(node);
    assert.match(txt, /Running/, "the running row");
    assert.match(txt, /Paused/, "the paused one");
    assert.match(txt, /Not started/, "and the slider-only one");
    assert.match(txt, /40%/, "state and percent are his");
    assert.match(txt, /70%/);
    assert.match(txt, /35%/);

    /* NO CLOCK, BY ANY ROUTE. */
    assert.equal($(node, ".wf-rec-clock").length, 0, "no clock element");
    assert.doesNotMatch(txt, CLOCK_FACE, "a clock face leaked into: " + txt);
    assert.doesNotMatch(txt, H_AND_M, "an elapsed figure leaked into: " + txt);
    assert.doesNotMatch(txt, BARE_MINS, "a minutes figure leaked into: " + txt);
    assert.doesNotMatch(txt, /on these jobs so far/,
      "including the live tracker's own total, which is made of clocks");

    // textContent misses attributes, and a tooltip is still the number.
    const attrs = $(node, "*").map((n) => Array.from(n.attributes || [])
      .map((a) => a.value).join(" ")).join(" ");
    assert.doesNotMatch(attrs, CLOCK_FACE, "a clock face leaked into an attribute");
    assert.doesNotMatch(attrs, H_AND_M, "an elapsed figure leaked into an attribute");
    assert.doesNotMatch(textOf(env.win.document.body), CLOCK_FACE,
      "nor anywhere else in the document");

    /* NO ARCHIVE, BY NAME. Each of these is a separate way the same half of
     * the section could come back, and "Completed work" going missing while
     * one of them survived is exactly the regression worth catching. */
    assert.doesNotMatch(txt, /Completed work/, "no archive heading");
    assert.doesNotMatch(txt, /By person/, "NO BY-PERSON TABLE -- other people's hours");
    assert.doesNotMatch(txt, /By phase/, "nor the by-phase split of them");
    assert.doesNotMatch(txt, /Hours logged/, "nor the total");
    assert.doesNotMatch(txt, /Hours per \$1,000/, "NO RATIO");
    assert.doesNotMatch(txt, /Revenue per hour/, "nor the other one");
    assert.equal($(node, ".wf-rec-t").length, 0, "no archive table of any kind");
    assert.equal($(node, ".wf-stat").length, 0, "and no stats block");
    assert.doesNotMatch(txt, /Finished, waiting to move on/,
      "the settling list is archive-side too -- it names who finished what");

    /* THE EXPORT, LOUDEST OF ALL. Existence, not enabled-ness: a greyed-out
     * Download CSV is still a door with the archive behind it. */
    assert.ok(!$(node, "button").some((b) => /Export/.test(textOf(b))),
      "NO EXPORT BUTTON -- the quietest way the archive leaks");
    assert.doesNotMatch(txt, /Export/, "not as a word anywhere on the tab either");
    assert.equal($(node, "select").length, 0,
      "and no period picker, which only exists to narrow the archive");
  });

/* ============================================ the third live state: not started
 *
 * A phase put on a bench and pushed along the percent slider has no segments,
 * therefore no minutes. The old single guard dropped it; it is in the mirror
 * now, and it is neither running nor paused. Calling it paused would tell a
 * manager somebody walked away from work nobody has begun.
 */

/** Assigned and slid along, never clocked: no segments at all. */
const IDLE = { listId: "ASM", claimedBy: SCOTT, percentComplete: 35, segments: [] };

/** Segments, but both ends on the same instant -- a mis-tap, zero elapsed. */
const ZERO_ELAPSED = { listId: "ASM", claimedBy: KEV, percentComplete: 20,
                       segments: [{ start: minsAgo(30), end: minsAgo(30) }] };

test("a percent-only phase reaches the mirror, and is not called paused", () => {
  const { R } = boot();
  const row = R.openEntries([card("I", { name: "Slider only", work: IDLE })])[0];
  assert.ok(row, "THE BUG CHANGE 2 FIXED: `if (!mins)` dropped this row entirely");
  assert.equal(row.minutes, 0, "no segments, so no minutes -- that is the point");
  assert.equal(row.percent, 35, "and the progress that got it here");
  assert.equal(row.running, false);
  assert.equal(row.finished, false);
  assert.equal(row.paused, false,
    "PAUSED MEANS STOPPED. No segments means nobody ever started it.");
});

test("an empty assignment is still not worth a row", () => {
  const { R } = boot();
  const rows = R.openEntries([card("N", { name: "Nothing on it",
    work: { listId: "ASM", claimedBy: SCOTT, percentComplete: 0, segments: [] } })]);
  assert.equal(rows.length, 0, "zero clock AND zero progress is an empty row");
});

test("segments with zero elapsed are paused, because somebody did start it", () => {
  const { R } = boot();
  const row = R.openEntries([card("Z", { name: "Mis-tap", work: ZERO_ELAPSED })])[0];
  assert.ok(row, "the percent carries it past the guard");
  assert.equal(row.minutes, 0);
  assert.equal(row.paused, true,
    "a closed segment is a clock that was started and stopped -- paused is " +
    "the honest word even when it measured nothing");
  assert.equal(row.running, false);
});

/* ---------------------------------------------- the NaN guard, every falsy shape
 *
 * The old guard was `if (!mins) return`, which dropped NaN, 0, -0, null,
 * undefined and "" together. Splitting it in two MUST NOT weaken the NaN half:
 * "NaN" beside a welder's name is worse than no row at all, and the case the
 * old guard handled by accident -- NaN arriving next to a truthy percent --
 * is now the one the new guard has to handle on purpose.
 *
 * `minutesOf` is Math.round(elapsedMs/60000), so these drive the six shapes in
 * through the one input that can produce them: what elapsedMs hands back.
 */
const FALSY_ELAPSED = [
  ["NaN", NaN, NaN],
  ["0", 0, 0],
  ["-0", -0, -0],
  ["null", null, 0],
  ["undefined", undefined, NaN],
  ['""', "", 0],
  ["a string that is not a number", "abc", NaN]
];

FALSY_ELAPSED.forEach(([label, raw, mins]) => {
  const unreadable = Number.isNaN(mins);

  test("elapsedMs of " + label + " with no progress: no row, as before", () => {
    const env = boot();
    env.win.WFPhase.elapsedMs = () => raw;
    const rows = env.R.openEntries([card("G", { name: "Guarded",
      work: { listId: "ASM", claimedBy: KEV, percentComplete: 0, segments: [] } })]);
    assert.equal(rows.length, 0,
      "the old `if (!mins)` dropped this and the new pair must too");
  });

  test("elapsedMs of " + label + " beside 80% progress: " +
       (unreadable ? "still dropped" : "now shown"), () => {
    const env = boot();
    env.win.WFPhase.elapsedMs = () => raw;
    const rows = env.R.openEntries([card("G", { name: "Guarded",
      work: { listId: "ASM", claimedBy: KEV, percentComplete: 80, segments: [] } })]);

    if (unreadable) {
      assert.equal(rows.length, 0,
        "AN UNREADABLE CLOCK IS ABSOLUTE. The percent must not buy a row " +
        "whose minutes would print as NaN -- this is the case the old single " +
        "guard caught by accident and this one has to catch on purpose.");
    } else {
      assert.equal(rows.length, 1, "a measured zero with progress on it is real work");
      assert.equal(rows[0].minutes, 0);
      assert.ok(!Number.isNaN(rows[0].minutes), "and it is a number, not NaN");
      assert.equal(rows[0].hours, 0);
    }
  });
});

test("NaN cannot reach the screen by any route on this tab", async () => {
  const env = boot({
    cards: [
      card("A", { name: "Running job", work: RUNNING }),
      card("B", { name: "Unreadable clock", work: {
        listId: "ASM", claimedBy: KEV, percentComplete: 55,
        segments: [{ start: "not a date", end: null }] } }),
      card("C", { name: "Unreadable and finished", work: {
        listId: "ASM", claimedBy: KEV, percentComplete: 90, completedAt: minsAgo(2),
        segments: [{ start: "not a date", end: "also not a date" }] } })
    ],
    preset: "leadership"
  });
  assert.ok(Number.isNaN(env.win.WFPhase.elapsedMs(
    { segments: [{ start: "not a date", end: null }] })),
    "fixture: an unreadable segment really is unmeasurable, not a quiet zero");

  // Trapped BEFORE the first paint, so the tick below is the tab's own.
  const timers = trapTimers(env.win);
  const node = await render(env);

  const txt = textOf(node);
  assert.doesNotMatch(txt, /NaN/, "NaN rendered into: " + txt);
  assert.doesNotMatch(txt, /Unreadable/, "and the rows carrying it were dropped whole");

  const attrs = $(node, "*").map((n) => Array.from(n.attributes || [])
    .map((a) => a.value).join(" ")).join(" ");
  assert.doesNotMatch(attrs, /NaN/, "NaN rendered into an attribute");

  // And the ticker cannot put one there a second later either.
  assert.equal(timers.count, 1, "fixture: the running job started the clock");
  timers.fire();
  assert.doesNotMatch(textOf(env.win.document.body), /NaN/,
    "nor after a tick -- startClock's isFinite check is the second belt");
});

/* ========================================== the live state machine, exhaustively
 *
 * Four states reach the screen -- run, pause, idle, done -- and a fifth
 * outcome, no row at all. Every reachable combination of running / finished /
 * segments-present / percent renders EXACTLY ONE of them. Two would be a
 * contradiction on the one strip of this tab read at a glance; none would be
 * work that vanished.
 */
const STATE_CASES = [
  { name: "running, 40%", work: RUNNING, kind: "run", word: "Running", pct: "40%" },
  { name: "running at 0% -- started, nothing to show for it yet",
    work: { listId: "ASM", claimedBy: SCOTT, percentComplete: 0,
            segments: [{ start: minsAgo(20), end: null }] },
    kind: "run", word: "Running", pct: "0%" },
  { name: "paused, 70%", work: PAUSED, kind: "pause", word: "Paused", pct: "70%" },
  { name: "paused at 0% -- an hour on it and nobody moved the slider",
    work: { listId: "ASM", claimedBy: KEV, percentComplete: 0,
            segments: [{ start: minsAgo(120), end: minsAgo(60) }] },
    kind: "pause", word: "Paused", pct: "0%" },
  { name: "segments but zero elapsed, 20%", work: ZERO_ELAPSED,
    kind: "pause", word: "Paused", pct: "20%" },
  { name: "no segments, 35%", work: IDLE, kind: "idle", word: "Not started", pct: "35%" },
  { name: "idle at 100% -- slid all the way without a clock",
    work: { listId: "ASM", claimedBy: SCOTT, percentComplete: 100, segments: [] },
    kind: "idle", word: "Not started", pct: "100%" },
  { name: "finished, settled at 100%", work: SETTLED,
    kind: "done", word: "Complete", pct: "100%" },
  { name: "finished at 40% under the retired approval model",
    work: { listId: "ASM", claimedBy: KEV, percentComplete: 40, pendingApproval: true,
            segments: [{ start: minsAgo(100), end: minsAgo(10) }] },
    kind: "done", word: "Complete", pct: "100%" },
  { name: "finished with a segment still open -- finished wins over running",
    work: { listId: "ASM", claimedBy: KEV, percentComplete: 100, completedAt: minsAgo(1),
            segments: [{ start: minsAgo(30), end: null }] },
    kind: "done", word: "Complete", pct: "100%" }
];

const KINDS = ["run", "pause", "idle", "done"];
const WORDS = { run: "Running", pause: "Paused", idle: "Not started", done: "Complete" };

STATE_CASES.forEach((c) => {
  test("live state: " + c.name + " renders " + c.kind + " and only " + c.kind,
    async () => {
      const env = boot({ cards: [card("S", { name: "The job", work: c.work })] });
      const node = await render(env);
      const rows = $(node, ".wf-rec-live");
      assert.equal(rows.length, 1, "exactly one row -- work that renders nothing is lost");

      const row = rows[0];
      const got = KINDS.filter((k) => row.classList.contains("is-" + k));
      assert.deepStrictEqual(got, [c.kind],
        "exactly one state class, and the right one");
      assert.match(textOf(row), new RegExp(c.word),
        "and the word, because colour alone is one bad monitor from no cue");
      KINDS.filter((k) => k !== c.kind).forEach((k) => {
        assert.doesNotMatch(textOf(row), new RegExp("\\b" + WORDS[k] + "\\b"),
          "a " + c.kind + " row must never also read " + WORDS[k]);
      });
      assert.match(textOf(row), new RegExp(c.pct),
        "and the percent it is actually at");
    });
});

test("nothing on the clock and nothing on the slider renders no row at all", async () => {
  const env = boot({ cards: [card("S", { name: "Empty assignment",
    work: { listId: "ASM", claimedBy: SCOTT, percentComplete: 0, segments: [] } })] });
  const node = await render(env);
  assert.equal($(node, ".wf-rec-live").length, 0);
  assert.match(textOf(node), /No bench has anything open right now/,
    "the empty state, not a blank panel");
});

test("the live panel's subtitle counts three states, not two", async () => {
  /* The arithmetic was `rows.length - running` paused, which was true while
   * every row had a clock on it. An idle row has none, so that counted it as
   * paused -- a heading saying somebody walked away from a job whose own row,
   * two inches below, reads "Not started". */
  const env = boot({ cards: [
    card("A", { name: "Running job", work: RUNNING }),
    card("B", { name: "Paused job", work: PAUSED }),
    card("I", { name: "Slider only", work: IDLE })
  ] });
  const node = await render(env);
  assert.match(textOf(node), /1 running · 1 paused · 1 not started/,
    "three rows, three states, and the subtitle says so");
  assert.doesNotMatch(textOf(node), /2 paused/,
    "the idle row must not be filed under paused");
});

/* ============================ a widened live list must not widen a total
 *
 * CHANGE 2 lets a zero-minute row into `openEntries`. `openEntries` is a
 * public function returning a public list, and `timeSummary` is a public
 * function that accepts one -- so the only thing keeping the two apart is
 * that the tab does not compose them. That is worth asserting rather than
 * remembering.
 */
test("the tab summarises finished entries only, and nothing else", () => {
  const src = read("popups/tabs/records.js");
  const calls = src.match(/WFRecords\.timeSummary\([^)]*\)/g) || [];
  assert.deepStrictEqual(calls,
    ["WFRecords.timeSummary(entries)", "WFRecords.timeSummary(entries)"],
    "two call sites -- the stats block and the export dialog's phase count -- " +
    "and both are handed the local named `entries`");
  assert.deepStrictEqual(src.match(/openExport\([^)]*\)/g),
    ["openExport(entries)", "openExport(entries)"],
    "and the export itself is handed the same list, never `open`");
  assert.match(src, /var all = WFRecords\.timeEntries\(state\.cards\);/,
    "which comes from timeEntries -- the signed-off archive");
  assert.match(src, /var entries = WFRecords\.since\(all, state\.days\);/,
    "narrowed by period, and never joined to `open`");
  assert.match(src, /var open = WFRecords\.openEntries\(state\.cards\);/,
    "open entries are a separate local that feeds the two trackers only");
});

test("a zero-minute live row moves no figure on the completed side", async () => {
  const signed = [
    card("A", { name: "One", log: [logEntry("CAD", KEV, 120, 2)], value: 12000 }),
    card("B", { name: "Two", log: [logEntry("Assemble", SCOTT, 90, 3)], value: 9000 })
  ];
  const plainEnv = boot({ cards: signed });
  const withIdle = boot({ cards: signed.concat([
    card("I", { name: "Slider only", work: IDLE, value: 40000 }) ]) });

  const a = await render(plainEnv);
  const b = await render(withIdle);
  const stats = (n) => $(n, ".wf-stat").map((s) =>
    textOf(s.querySelector(".wf-stat-v")) + "|" + textOf(s.querySelector(".wf-stat-n")));

  assert.deepStrictEqual(stats(b), stats(a),
    "hours logged, finished phases, jobs touched and both ratios are identical");
  assert.match(textOf(b), /Not started/, "fixture: the idle row really is on the screen");
  assert.doesNotMatch(stats(b).join(" "), /40000/, "and its job value reached no total");
});

test("what WOULD break if someone composed open entries into the summary", () => {
  /* Named rather than guarded, because the library permits the composition and
   * a future caller may want it. The totals survive -- adding zero minutes
   * changes no sum, and both ratios skip a job with no hours. The COUNTS do
   * not: a not-started row would be counted as a finished phase under a
   * correct hours figure, which is the combination most likely to be believed.
   * The export is the one half that is safe by construction. */
  const { R } = boot();
  const cards = [
    card("A", { name: "One", log: [logEntry("CAD", KEV, 120, 2)], value: 12000 }),
    card("I", { name: "Slider only", work: IDLE, value: 40000 })
  ];
  const finished = R.timeEntries(cards);
  const open = R.openEntries(cards);
  assert.equal(open.length, 1, "fixture: the idle row exists to be composed");

  const clean = R.timeSummary(finished, { minJobs: 1 });
  const mixed = R.timeSummary(finished.concat(open), { minJobs: 1 });

  assert.equal(mixed.minutes, clean.minutes, "no total moves -- zero adds nothing");
  assert.equal(mixed.hoursPerThousand, clean.hoursPerThousand,
    "and no ratio moves -- `!j.value || !j.hours` skips an hourless job");
  assert.equal(mixed.phases, clean.phases + 1,
    "THE HAZARD: the phase count rises. The tab prints this as 'N finished " +
    "phases', so a job nobody has started would be counted as one finished.");
  assert.equal(mixed.entries, clean.entries + 1);
  assert.ok(mixed.byJob["Slider only"], "and it opens a job bucket at zero hours");

  assert.ok(!/Slider only/.test(R.toCSV(finished.concat(open))),
    "the export is immune by construction -- toCSV filters `!e.ongoing`");
});

/* ======================= the clock stays withheld from the new state as well
 *
 * A new row type is a new place for a number to appear. This is the existing
 * whole-document search, re-run against a board that has an idle row on it.
 */
test("an idle row leaks no duration to a shop manager, markup or attributes",
  async () => {
    const env = boot({
      cards: CLOCK_CARDS.concat([card("E", { name: "Slider only", work: IDLE })]),
      preset: "shop_manager"
    });
    const node = await render(env);
    const txt = textOf(node);

    assert.match(txt, /Live work/, "he is looking at the mirror");
    assert.equal(liveRows(node).length, 4, "running, paused, idle and the settled one");
    assert.match(txt, /Not started/, "the new state is on the screen");
    assert.match(txt, /35%/, "with its progress, which is not withheld");

    assert.equal($(node, ".wf-rec-clock").length, 0, "no clock element");
    assert.doesNotMatch(txt, CLOCK_FACE, "a clock face leaked into: " + txt);
    assert.doesNotMatch(txt, H_AND_M, "an elapsed figure leaked into: " + txt);
    assert.doesNotMatch(txt, BARE_MINS, "a minutes figure leaked into: " + txt);

    const attrs = $(node, "*").map((n) => Array.from(n.attributes || [])
      .map((a) => a.value).join(" ")).join(" ");
    assert.doesNotMatch(attrs, CLOCK_FACE, "a clock face leaked into an attribute");
    assert.doesNotMatch(attrs, H_AND_M, "an elapsed figure leaked into an attribute");
    assert.doesNotMatch(attrs, BARE_MINS, "a minutes figure leaked into an attribute");
    assert.doesNotMatch(textOf(env.win.document.body), CLOCK_FACE,
      "nor anywhere else in the document");
  });

test("leadership gets a clock on the idle row too, reading zero", async () => {
  const env = boot({ cards: [card("I", { name: "Slider only", work: IDLE })],
                     preset: "leadership" });
  const node = await render(env);
  const clocks = $(node, ".wf-rec-clock");
  assert.equal(clocks.length, 1, "the gate is about the reader, not the row");
  assert.equal(textOf(clocks[0]), "0:00:00",
    "and it reads a measured zero, not a blank and not NaN");
});


test("empty sections explain what would fill them", async () => {
  const env = boot({ cards: [] });
  const node = await render(env);
  assert.match(textOf(node), /No finished phases recorded/);

  $(node, ".wf-rec-r").find((b) => /Quality/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));
  assert.match(textOf(env.win.document.getElementById("view")), /No quality checks recorded/);
});

test("the Quality header says how many checks are still in progress", async () => {
  /* The pass rate is over the rounds somebody judged, "Checks" counts every
   * round recorded. Side by side and unexplained those two read as a
   * contradiction -- 2 checks, 100% passed, nothing sent back -- so the count
   * says how many of them nobody has finished. */
  const env = boot({
    cards: [
      card("A", { qc: { phase: "CAD", rounds: [
        { n: 1, mode: "self", checkedBy: KEV, checkedAt: iso(-1),
          items: [{ text: "Revision number is current", result: "pass" },
                  { text: "Material called out", result: "fail" }] }
      ] } }),
      card("B", { qc: { phase: "CAD", rounds: [
        { n: 1, mode: "floor", checkedBy: SCOTT, checkedAt: iso(-1),
          items: [{ text: "Revision number is current", result: "pass" }] }
      ] } })
    ]
  });
  const node = await render(env);
  $(node, ".wf-rec-r").find((b) => /Quality/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));
  const txt = textOf(env.win.document.getElementById("view"));
  assert.match(txt, /1 still in progress/);
  assert.match(txt, /100%/, "and the rate is over the finished one only");
});

test("Recent checks calls an unfinished check in progress, not a failed round", async () => {
  /* ONE SCREEN MUST NOT CONTRADICT ITSELF. The summary above sets unfinished
   * self-checks aside; this list was still painting the same round red as
   * "round 1 failed" and naming the lines nobody had got to yet as though a
   * checker had rejected them. A panel saying a check was set aside sitting
   * above a panel calling it a failure is how people stop trusting a screen. */
  const env = boot({
    cards: [
      card("A", { name: "Half-ticked job", qc: { phase: "CAD", rounds: [
        { n: 1, mode: "self", checkedBy: KEV, checkedAt: iso(-1),
          items: [{ text: "Revision number is current", result: "pass" },
                  { text: "Material called out", result: "fail" },
                  { text: "Dimensions match the measure sheet", result: "fail" }] }
      ] } }),
      card("B", { name: "Really failed job", qc: { phase: "Assemble Legacy", rounds: [
        { n: 2, mode: "floor", checkedBy: SCOTT, checkedAt: iso(-2),
          foundBy: SCOTT,
          fixes: { 0: { what: "reheated and re-clamped", by: KEV, at: iso(-2) } },
          items: [{ text: "Frame is square", result: "fail", note: "twisted 3mm" }] }
      ] } })
    ]
  });
  const node = await render(env);
  $(node, ".wf-rec-r").find((b) => /Quality/.test(textOf(b)))
    .dispatchEvent(new env.win.Event("click"));
  const view = env.win.document.getElementById("view");
  const row = $(view, ".wf-row").find((r) => /Half-ticked job/.test(textOf(r)));
  assert.ok(row, "the unfinished check is still listed — set aside is not hidden");

  const tag = row.querySelector(".wf-tag");
  assert.equal(textOf(tag), "in progress",
    "an unfinished self-check is labelled as in progress");
  assert.ok(tag.classList.contains("wf-tag-quiet"),
    "and in the neutral style, not the red one a failure gets");
  assert.doesNotMatch(textOf(row), /failed/,
    "nothing on the row calls it a failed round");
  assert.match(textOf(row), /1 of 3 lines ticked so far/,
    "the detail column counts progress instead of listing unticked lines as faults");
  assert.doesNotMatch(textOf(row), /Material called out/,
    "and does not name a line nobody has got to yet");

  // The genuine failure is untouched, and now carries its answer inline.
  const bad = $(view, ".wf-row").find((r) => /Really failed job/.test(textOf(r)));
  assert.match(textOf(bad), /round 2 failed/, "a real failure still reads as one");
  assert.ok(bad.querySelector(".wf-tag-late"), "and is still styled as one");
  assert.match(textOf(bad), /Frame is square → reheated and re-clamped/,
    "with what was done about it beside it, which is the point of keeping faults");
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
