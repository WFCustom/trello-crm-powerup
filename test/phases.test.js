/**
 * Phase grouping: the four Install columns must read as one phase.
 *
 * The board has four Install lists -- Next week, North, Central, South -- which
 * are one phase of work: one crew, one time allowance, one QC checklist. Two
 * separate pieces of code have to agree about that, and historically they did
 * not:
 *
 *   popups/ops.js  groups lists into phases by NAME, stripping any
 *                  parenthetical. It never reads the `phase` field.
 *   lib/advance.js resolves a route step to a list by NAME.
 *
 * When the Install columns were renamed to North/Central/South, ops.js started
 * seeing four distinct names and the dashboard grew four Install phases, while
 * advance.js could no longer find a list called "Install" at all, so cards
 * stopped advancing to Install entirely. Both symptoms had one cause: the names
 * stopped matching.
 *
 * The fix is that all four lists are named "Install" and the board's own label
 * lives in `region`. These tests pin that down from both directions.
 */
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./harness.js");

const win = h.load();
const { id: BOARD, cfg: board } = h.productionBoard(win);
const { WFOps, WFStage } = win;

describe("ops.js phaseKey", () => {
  test("strips a parenthetical qualifier", () => {
    assert.equal(WFOps.phaseKey("Install (Tuesday)"), "Install");
    assert.equal(WFOps.phaseKey("Install"), "Install");
  });

  test("leaves slashes and multi-word names alone", () => {
    assert.equal(WFOps.phaseKey("Sandblast / Powder Coat"), "Sandblast / Powder Coat");
    assert.equal(WFOps.phaseKey("Print CAD"), "Print CAD");
  });

  test("tolerates null", () => {
    assert.equal(WFOps.phaseKey(null), "");
  });
});

describe("Install is a single phase", () => {
  const phases = WFOps.workPhases(board);
  const installs = phases.filter((p) => p.name === "Install");

  test("exactly one work phase is called Install", () => {
    const detail = installs.map((p) => p.name + " [" + p.listIds.length + " lists]").join(", ");
    assert.equal(installs.length, 1, "expected 1 Install phase, got " + installs.length + ": " + detail);
  });

  test("it carries all four Install lists", () => {
    const mapped = board.stages.filter((s) => s.phase === "Install");
    assert.equal(mapped.length, 4, "config should map four lists to the Install phase");
    assert.equal(installs[0].listIds.length, 4);
    assert.deepEqual(
      h.plain(installs[0].listIds).sort(),
      h.plain(mapped.map((s) => s.listId)).sort()
    );
  });

  test("no phase name leaks a region label", () => {
    for (const p of phases) {
      for (const region of ["North", "South", "Central", "Next week"]) {
        assert.ok(!p.name.includes(region),
          'phase "' + p.name + '" has the region baked into its name; regions belong in the region field');
      }
    }
  });

  test("every Install list still records its region", () => {
    const lists = board.stages.filter((x) => x.phase === "Install");
    for (const s of lists) {
      assert.ok(s.region && s.region.trim(),
        "Install list " + s.listId + " has no region, so the board label is lost");
    }
    const regions = lists.map((s) => s.region);
    assert.equal(new Set(regions).size, regions.length, "two Install lists claim the same region");
  });

  test("a card in any Install list reports the same phase", () => {
    const ids = board.stages.filter((s) => s.phase === "Install").map((s) => s.listId);
    const seen = ids.map((idList) => WFOps.phaseForCard(board, { idList }));
    for (const p of seen) {
      assert.ok(p, "a card in an Install list resolved to no phase at all");
      assert.equal(p.name, "Install");
    }
    assert.equal(new Set(seen.map((p) => p.order)).size, 1, "Install lists disagree about order");
  });
});

describe("phase grouping in general", () => {
  const phases = WFOps.workPhases(board);

  test("phase names are unique", () => {
    const names = phases.map((p) => p.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.equal(new Set(names).size, names.length, "duplicate phase names: " + dupes.join(", "));
  });

  test("phases come out in board order", () => {
    const orders = h.plain(phases.map((p) => p.order));
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  });

  test("the three assemble columns stay three distinct phases", () => {
    // One phase per job type, not one phase spread over three lists, so unlike
    // Install these must NOT be merged.
    for (const name of ["Assemble Legacy", "Assemble CAP", "Assemble CNC"]) {
      assert.equal(phases.filter((p) => p.name === name).length, 1, name + " missing or merged");
    }
  });

  test("every list in a phase belongs to that phase and nothing else", () => {
    const owner = new Map();
    for (const p of phases) {
      for (const id of p.listIds) {
        assert.equal(owner.get(id), undefined,
          "list " + id + " is claimed by both " + owner.get(id) + " and " + p.name);
        owner.set(id, p.name);
      }
    }
  });

  test("Final Approval accrues waiting time but is not claimable work", () => {
    const fa = board.stages.find((s) => s.name === "Final Approval");
    assert.ok(fa, "Final Approval is not mapped");
    assert.ok(!fa.isWorkPhase, "Final Approval must not be a work phase -- nobody claims it");
    assert.ok(fa.slaDays > 0, "Final Approval needs an SLA so the wait shows up in stage timing");
    assert.equal(phases.filter((p) => p.name === "Final Approval").length, 0);
  });

  test("ReWork is an exception branch, not forward progress", () => {
    const rw = phases.find((p) => p.name === "ReWork");
    assert.ok(rw && rw.isException, "ReWork should be flagged isException");
  });
});

describe("resolving a phase name back to a list", () => {
  test("Install resolves to the primary target, not whichever is listed first", () => {
    const target = WFStage.getStageByName(BOARD, "Install");
    assert.ok(target, "no list found for the phase name Install");
    assert.equal(target.isPrimaryTarget, true,
      "name lookup for Install returned the " + target.region + " column; " +
      "auto-advance would send every job there instead of the primary target");
    assert.equal(target.region, "Central");
  });

  test("wherever several lists share a name, exactly one is the primary target", () => {
    const byName = new Map();
    for (const s of board.stages) {
      if (!byName.has(s.name)) byName.set(s.name, []);
      byName.get(s.name).push(s);
    }
    for (const [name, group] of byName) {
      if (group.length < 2) continue;
      const primary = group.filter((s) => s.isPrimaryTarget);
      assert.equal(primary.length, 1,
        name + " spans " + group.length + " lists but " + primary.length + " are flagged isPrimaryTarget");
    }
  });

  test("an unambiguous name resolves to its one list", () => {
    const cad = WFStage.getStageByName(BOARD, "CAD");
    assert.equal(cad.name, "CAD");
    assert.equal(cad.listId, board.stages.find((s) => s.name === "CAD").listId);
  });

  test("a deleted or missing name resolves to null rather than throwing", () => {
    assert.equal(WFStage.getStageByName(BOARD, "CNC Table"), null);
    assert.equal(WFStage.getStageByName(BOARD, null), null);
  });
});

describe("advancing by order still prefers the primary target", () => {
  test("approving Sandblast sends the card to Install Central", () => {
    const finish = board.stages.find((s) => s.name === "Sandblast / Powder Coat");
    const next = WFStage.getNextStage(BOARD, finish.listId);
    assert.equal(next.name, "Install");
    assert.equal(next.region, "Central", "forward progress should land on the primary Install");
  });

  test("ReWork is never an automatic next step", () => {
    for (const s of board.stages) {
      const next = WFStage.getNextStage(BOARD, s.listId);
      if (next) assert.notEqual(next.name, "ReWork", s.name + " auto-advances into ReWork");
    }
  });

  test("the terminal stage has nowhere to advance to", () => {
    const done = board.stages.find((s) => s.isTerminal === "won");
    const next = WFStage.getNextStage(BOARD, done.listId);
    assert.ok(next === null || next.isTerminal, "Job Closed / Done should not advance onward");
  });
});
