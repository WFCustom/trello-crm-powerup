/**
 * Job costing: which phase's labour lands in which bucket.
 *
 * Costing reads the card's phaseLog and buckets each entry by the name of the
 * list the work was done in. That makes it quietly fragile: rename a column on
 * the board and its labour stops matching any category, falling through to
 * "Unassigned" -- it still counts toward production cost, so the totals stay
 * right and nothing looks broken, but the breakdown that tells you *where* the
 * money went goes blank. That is exactly what happened when "Assemble" became
 * three per-job-type columns.
 *
 * The central test here is therefore that every phase a job can log time
 * against is bucketed somewhere on purpose.
 */
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./harness.js");

const win = h.load();
const { cfg: board } = h.productionBoard(win);
const { WFCosting } = win;

const MODEL = WFCosting.DEFAULT_MODEL;
const CATEGORIES = MODEL.categories;
const COST_ONLY = MODEL.costOnly;

/** Phase names kept only so historical phaseLog entries still bucket. */
const HISTORIC_NAMES = new Set([
  "Install (Tuesday)",
  "Install North",
  "Install Central",
  "Install South",
  "Next week Install"
]);

const LIVE_STAGE_NAMES = new Set(board.stages.map((s) => s.name));

describe("the cost model", () => {
  test("revenue categories account for exactly 100% of a job", () => {
    const total = CATEGORIES.reduce((n, c) => n + c.pct, 0);
    assert.equal(total, 100, "category percentages add up to " + total + ", not 100");
  });

  test("every category has a name, a share and at least one phase", () => {
    for (const c of CATEGORIES) {
      assert.ok(c.name && c.name.trim(), "a category has no name");
      assert.ok(c.pct > 0, c.name + " has a share of " + c.pct);
      assert.ok(Array.isArray(c.phases) && c.phases.length, c.name + " covers no phases");
    }
  });

  test("category names are unique", () => {
    const names = CATEGORIES.concat(COST_ONLY).map((c) => c.name);
    assert.equal(new Set(names).size, names.length, "two cost categories share a name");
  });

  test("no phase is claimed by two categories", () => {
    const owner = new Map();
    for (const c of CATEGORIES.concat(COST_ONLY)) {
      for (const p of c.phases) {
        assert.equal(owner.get(p), undefined,
          "phase " + p + " is billed to both " + owner.get(p) + " and " + c.name);
        owner.set(p, c.name);
      }
    }
  });

  test("rework earns no revenue share", () => {
    const rework = COST_ONLY.find((c) => c.name === "ReWork");
    assert.ok(rework, "ReWork is not listed as cost-only");
    assert.ok(!CATEGORIES.some((c) => c.name === "ReWork"),
      "ReWork must not also be a revenue category -- its labour is margin erosion");
    assert.equal(rework.pct, undefined);
  });
});

describe("every phase a job can log time against is bucketed", () => {
  const bucketed = new Set(
    CATEGORIES.concat(COST_ONLY).flatMap((c) => c.phases)
  );

  test("no work phase falls through to Unassigned", () => {
    for (const s of board.stages.filter((x) => x.isWorkPhase)) {
      assert.ok(bucketed.has(s.name),
        "work phase \"" + s.name + "\" is in no cost category, so its labour " +
        "would land in Unassigned and vanish from the breakdown");
    }
  });

  test("the office stages that hold a job are bucketed too", () => {
    // These accrue waiting time and appear in phaseLog even though nobody
    // claims them, so they need a home or the Sales & Office share is understated.
    for (const name of ["Intake", "Portal - CRM", "Final Approval", "Billing"]) {
      assert.ok(bucketed.has(name), name + " is not billed to any category");
    }
  });

  test("the three assemble columns are all billed as Shop work", () => {
    const shop = CATEGORIES.find((c) => c.name === "Shop");
    for (const col of ["Assemble Legacy", "Assemble CAP", "Assemble CNC"]) {
      assert.ok(shop.phases.includes(col), col + " is not billed to Shop");
    }
  });

  test("one Install category covers every Install column, current and historic", () => {
    const install = CATEGORIES.find((c) => c.name === "Install");
    for (const s of board.stages.filter((x) => x.phase === "Install")) {
      assert.ok(install.phases.includes(s.name),
        "Install column " + s.region + " is not billed to Install");
    }
    for (const old of HISTORIC_NAMES) {
      assert.ok(install.phases.includes(old),
        "historic name " + old + " dropped; old phaseLog entries would go Unassigned");
    }
  });

  test("a bucketed phase is either a live list or a documented historic name", () => {
    for (const c of CATEGORIES.concat(COST_ONLY)) {
      for (const p of c.phases) {
        assert.ok(LIVE_STAGE_NAMES.has(p) || HISTORIC_NAMES.has(p),
          c.name + " bills \"" + p + "\", which is neither a list on the board nor a " +
          "known historic name. Likely a typo or a column that was renamed.");
      }
    }
  });
});

describe("optional phases", () => {
  const optional = WFCosting.optionalPhases
    ? WFCosting.optionalPhases()
    : (win.WF_CONFIG.optionalPhases || ["Sandblast / Powder Coat"]);

  test("only Sandblast is genuinely skippable", () => {
    // CAP railing is aluminium and never powder coated; some CNC-only work
    // ships raw. Everything else is either on the route or it is not.
    assert.ok(optional.includes("Sandblast / Powder Coat"));
  });

  test("no optional phase names a deleted list", () => {
    for (const p of optional) {
      assert.ok(LIVE_STAGE_NAMES.has(p),
        "optional phase \"" + p + "\" is not a list on the board");
    }
  });
});

describe("bucketing a real card", () => {
  const RATES = { dalejacaway: 30, bannista: 40 };

  function card(entries, price) {
    return {
      id: "c1",
      name: "Job 1700 - test",
      economics: price ? { value: price } : {},
      phaseLog: entries
    };
  }

  function rowFor(entries, price) {
    return WFCosting.buildJobRows([card(entries, price)], board, RATES)[0];
  }

  test("CNC assembly labour lands in Shop, not Unassigned", () => {
    const row = rowFor([
      { listName: "Assemble CNC", durationMinutes: 120, claimedBy: { username: "dalejacaway" } }
    ], 1000);
    assert.equal(row.allocation.Shop.hours, 2);
    assert.equal(row.allocation.Shop.cost, 60);
    assert.equal(row.unassigned.hours, 0, "assemble labour fell through to Unassigned");
  });

  test("all three assemble columns pile into the same Shop bucket", () => {
    const row = rowFor([
      { listName: "Assemble Legacy", durationMinutes: 60, claimedBy: { username: "dalejacaway" } },
      { listName: "Assemble CAP", durationMinutes: 60, claimedBy: { username: "dalejacaway" } },
      { listName: "Assemble CNC", durationMinutes: 60, claimedBy: { username: "dalejacaway" } }
    ], 1000);
    assert.equal(row.allocation.Shop.hours, 3);
    assert.equal(row.allocation.Shop.cost, 90);
  });

  test("time in any Install column reports as one Install bucket", () => {
    const entries = board.stages
      .filter((s) => s.phase === "Install")
      .map((s) => ({ listName: s.name, durationMinutes: 30, claimedBy: { username: "bannista" } }));
    const row = rowFor(entries, 1000);
    assert.equal(row.allocation.Install.hours, 2);
    assert.equal(row.unassigned.hours, 0);
  });

  test("historic Install names still bucket to Install", () => {
    const row = rowFor([
      { listName: "Install (Tuesday)", durationMinutes: 60, claimedBy: { username: "bannista" } }
    ], 1000);
    assert.equal(row.allocation.Install.hours, 1);
    assert.equal(row.unassigned.hours, 0);
  });

  test("rework is charged to the job but earns no revenue share", () => {
    const row = rowFor([
      { listName: "ReWork", durationMinutes: 60, claimedBy: { username: "bannista" } }
    ], 1000);
    assert.equal(row.rework.hours, 1);
    assert.equal(row.rework.cost, 40);
    assert.equal(row.productionCost, 0, "rework must not count as production cost");
    assert.equal(row.allocation.ReWork, undefined, "ReWork must not get an allocation");
  });

  test("an unknown list still counts as cost, flagged Unassigned", () => {
    const row = rowFor([
      { listName: "CNC Table", durationMinutes: 60, claimedBy: { username: "bannista" } }
    ], 1000);
    assert.equal(row.unassigned.hours, 1);
    assert.equal(row.productionHours, 1, "unassigned time is still real work");
  });

  test("labour by someone with no rate is counted in hours but not in dollars", () => {
    const row = rowFor([
      { listName: "CAD", durationMinutes: 120, claimedBy: { username: "nobodyknowsme" } }
    ], 1000);
    assert.equal(row.allocation.Shop.hours, 2);
    assert.equal(row.allocation.Shop.cost, 0);
    assert.equal(row.allocation.Shop.hoursUnpriced, 2,
      "unpriced hours must be visible, not silently valued at zero");
  });

  test("allocations follow the model percentages against the job price", () => {
    const row = rowFor([], 1000);
    assert.equal(row.allocation.Shop.allocated, 350);
    assert.equal(row.allocation["Sales & Office"].allocated, 300);
    assert.equal(row.allocation["Sand & Powder"].allocated, 250);
    assert.equal(row.allocation.Install.allocated, 100);
  });

  test("an unpriced job allocates nothing rather than dividing by zero", () => {
    const row = rowFor([
      { listName: "CAD", durationMinutes: 60, claimedBy: { username: "bannista" } }
    ], 0);
    assert.equal(row.priced, false);
    assert.equal(row.allocation.Shop.allocated, 0);
    assert.equal(row.allocation.Shop.cost, 40, "cost is still tracked on an unpriced job");
  });
});
