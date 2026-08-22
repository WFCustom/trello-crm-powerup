/**
 * Job type routes.
 *
 * A route is the ordered list of phases a job passes through, and auto-advance
 * walks it literally: a phase absent from the route is never routed to, and a
 * phase named in a route but absent from the board is a dead end that fails
 * silently at runtime. That is what broke CNC-only jobs -- they routed through
 * a "CNC Table" column that had been deleted from Trello, so approving the CAD
 * step had nowhere to send the card.
 *
 * So the load-bearing test here is the boring one: every phase named in every
 * route must resolve to a list that config.js actually maps.
 */
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./harness.js");

const win = h.load();
const { id: BOARD, cfg: board } = h.productionBoard(win);
const { WFJobType, WFStage } = win;

const STAGE_NAMES = new Set(board.stages.map((s) => s.name));
const routed = WFJobType.all().filter((t) => !t.splitsInto);
const combos = WFJobType.all().filter((t) => t.splitsInto);

describe("the set of job types", () => {
  test("keys are unique and non-empty", () => {
    const keys = WFJobType.all().map((t) => t.key);
    assert.ok(keys.length >= 4, "expected at least four job types");
    assert.equal(new Set(keys).size, keys.length, "duplicate job type key");
    for (const k of keys) assert.match(k, /^[a-z][a-z0-9_]*$/, "odd key: " + k);
  });

  test("every type has a label and a note for the dropdown", () => {
    for (const t of WFJobType.all()) {
      assert.ok(t.label && t.label.trim(), t.key + " has no label");
      assert.ok(t.note && t.note.trim(), t.key + " has no note");
    }
  });

  test("the default type exists and has a route", () => {
    const d = WFJobType.byKey(WFJobType.DEFAULT_KEY);
    assert.ok(d, "DEFAULT_KEY " + WFJobType.DEFAULT_KEY + " is not a real type");
    assert.ok(Array.isArray(d.route) && d.route.length, "the default type must have a route");
  });

  test("a type has either a route or a split, never both and never neither", () => {
    for (const t of WFJobType.all()) {
      const hasRoute = Array.isArray(t.route) && t.route.length > 0;
      const hasSplit = Array.isArray(t.splitsInto) && t.splitsInto.length > 0;
      assert.ok(hasRoute !== hasSplit,
        t.key + ": route=" + hasRoute + " splitsInto=" + hasSplit + " -- exactly one is required");
    }
  });

  test("byKey returns null for something that is not a type", () => {
    assert.equal(WFJobType.byKey("cnc_table"), null);
  });
});

describe("every route step exists on the board", () => {
  test("no route names a list that config.js does not map", () => {
    for (const t of routed) {
      for (const phase of t.route) {
        assert.ok(STAGE_NAMES.has(phase),
          t.key + " routes through \"" + phase + "\", which is not a mapped list. " +
          "Auto-advance would have nowhere to send the card.");
      }
    }
  });

  test("every route step resolves to a real list id", () => {
    for (const t of routed) {
      for (const phase of t.route) {
        const stage = WFStage.getStageByName(BOARD, phase);
        assert.ok(stage && stage.listId, t.key + ": " + phase + " resolves to no list");
      }
    }
  });

  test("optional steps exist on the board too", () => {
    for (const t of routed) {
      for (const phase of t.optional || []) {
        assert.ok(STAGE_NAMES.has(phase), t.key + " marks unknown phase \"" + phase + "\" optional");
        assert.ok(!t.route.includes(phase), t.key + ": " + phase + " is both routed and optional");
      }
    }
  });

  test("no route mentions a list that was deleted from the board", () => {
    const dead = ["CNC Table", "CNC Table/cap rail", "Assemble"];
    for (const t of routed) {
      for (const phase of t.route.concat(t.optional || [])) {
        assert.ok(!dead.includes(phase), t.key + " still routes through the deleted list " + phase);
      }
    }
  });

  test("a route never repeats a phase", () => {
    for (const t of routed) {
      assert.equal(new Set(t.route).size, t.route.length, t.key + " visits a phase twice");
    }
  });

  test("routes run in board order", () => {
    const orderOf = (name) => WFStage.getStageByName(BOARD, name).order;
    for (const t of routed) {
      const orders = t.route.map(orderOf);
      for (let i = 1; i < orders.length; i++) {
        assert.ok(orders[i] >= orders[i - 1],
          t.key + " goes backwards: " + t.route[i - 1] + " then " + t.route[i]);
      }
    }
  });

  test("every route starts before CAD and ends at Install", () => {
    for (const t of routed) {
      assert.equal(t.route[t.route.length - 1], "Install", t.key + " does not end at Install");
      assert.ok(t.route.includes("CAD"), t.key + " skips CAD");
    }
  });
});

describe("the individual routes", () => {
  test("CNC-only cuts and builds in Assemble CNC, with no separate cutting stage", () => {
    const r = WFJobType.byKey("cnc_only").route;
    assert.deepEqual(h.plain(r), ["CAD", "Assemble CNC", "Install"]);
    assert.deepEqual(h.plain(WFJobType.byKey("cnc_only").optional), ["Sandblast / Powder Coat"]);
  });

  test("CAP railing skips the finish step entirely -- aluminium takes no powder coat", () => {
    const cap = WFJobType.byKey("cap_only");
    assert.ok(!cap.route.includes("Sandblast / Powder Coat"), "CAP should not be powder coated");
    assert.ok(!(cap.optional || []).includes("Sandblast / Powder Coat"),
      "CAP finish is not optional, it never happens");
  });

  test("the packet-first routes wait for Final Approval before CAD", () => {
    for (const key of ["legacy", "custom"]) {
      const r = WFJobType.byKey(key).route;
      assert.ok(r.includes("Final Approval"), key + " skips Final Approval");
      assert.ok(r.indexOf("Final Approval") < r.indexOf("CAD"),
        key + " draws before the customer has signed off");
      assert.ok(r.indexOf("Make Job Packet") < r.indexOf("Final Approval"),
        key + " asks for approval before the packet exists");
    }
  });

  test("each assemble column is used by exactly one route", () => {
    for (const col of ["Assemble Legacy", "Assemble CAP", "Assemble CNC"]) {
      const users = routed.filter((t) => t.route.includes(col));
      assert.ok(users.length >= 1, col + " is on no route at all");
      for (const t of users) {
        const others = ["Assemble Legacy", "Assemble CAP", "Assemble CNC"].filter((c) => c !== col);
        for (const o of others) {
          assert.ok(!t.route.includes(o),
            t.key + " routes through both " + col + " and " + o);
        }
      }
    }
  });
});

describe("combination jobs split rather than route", () => {
  test("every half named in splitsInto is a real type with a route", () => {
    for (const t of combos) {
      for (const half of t.splitsInto) {
        const x = WFJobType.byKey(half);
        assert.ok(x, t.key + " splits into unknown type " + half);
        assert.ok(Array.isArray(x.route) && x.route.length,
          t.key + " splits into " + half + ", which has no route of its own");
      }
    }
  });

  test("needsSplit reports the halves for a combo and nothing for a plain job", () => {
    assert.deepEqual(h.plain(WFJobType.needsSplit({ jobType: "CNC + legacy railing" })),
      ["legacy", "cnc_only"]);
    assert.equal(WFJobType.needsSplit({ jobType: "CNC only" }), null);
  });

  test("an unsplit combo still follows its first half rather than stalling", () => {
    const r = WFJobType.routeFor({ jobType: "Legacy + CAP" });
    assert.deepEqual(h.plain(r), h.plain(WFJobType.byKey("legacy").route));
  });
});

describe("reading the job type off a card", () => {
  test("exact dropdown labels match", () => {
    for (const t of WFJobType.all()) {
      assert.equal(WFJobType.fromLabel(t.label).key, t.key, "label did not round-trip: " + t.label);
    }
  });

  test("matching tolerates case and surrounding whitespace", () => {
    assert.equal(WFJobType.fromLabel("  cnc ONLY  ").key, "cnc_only");
  });

  test("renamed options still land on the right type", () => {
    assert.equal(WFJobType.fromLabel("CNC").key, "cnc_only");
    assert.equal(WFJobType.fromLabel("CAP").key, "cap_only");
    assert.equal(WFJobType.fromLabel("Railing").key, "legacy");
    assert.equal(WFJobType.fromLabel("CNC and legacy railing").key, "legacy_cnc");
    assert.equal(WFJobType.fromLabel("CAP + legacy").key, "legacy_cap");
    assert.equal(WFJobType.fromLabel("Other fabrication").key, "custom");
    assert.equal(WFJobType.fromLabel("Custom bits").key, "custom");
  });

  test("a label matching no keyword at all returns null, not a guess", () => {
    // forCard() turns this into the default type. fromLabel itself stays honest
    // so callers can tell "not set" from "set to legacy".
    assert.equal(WFJobType.fromLabel("Something else"), null);
    assert.equal(WFJobType.fromLabel("Gazebo"), null);
  });

  test("an empty or unrecognised field falls back to the default type", () => {
    assert.equal(WFJobType.fromLabel(""), null);
    assert.equal(WFJobType.forCard({}).key, WFJobType.DEFAULT_KEY);
    assert.equal(WFJobType.forCard({ jobType: "" }).key, WFJobType.DEFAULT_KEY);
    assert.equal(WFJobType.forCard(null).key, WFJobType.DEFAULT_KEY);
  });

  test("isOnRoute answers for the card, not the board", () => {
    const cnc = { jobType: "CNC only" };
    assert.equal(WFJobType.isOnRoute(cnc, "Assemble CNC"), true);
    assert.equal(WFJobType.isOnRoute(cnc, "Assemble Legacy"), false);
    assert.equal(WFJobType.isOnRoute(cnc, "Make Job Packet"), false);
  });
});

describe("walking a route with nextPhase", () => {
  // Mirrors shopOrder() in lib/advance.js: every mapped stage in board order,
  // office stages included. Keep the two in step.
  const shopOrder = board.stages
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => s.name);

  test("each step leads to the next", () => {
    for (const t of routed) {
      for (let i = 0; i < t.route.length - 1; i++) {
        assert.equal(
          WFJobType.nextPhase({ jobType: t.label }, t.route[i], shopOrder),
          t.route[i + 1],
          t.key + ": " + t.route[i] + " should lead to " + t.route[i + 1]
        );
      }
    }
  });

  test("the last step ends the route rather than looping", () => {
    for (const t of routed) {
      assert.equal(WFJobType.nextPhase({ jobType: t.label }, "Install", shopOrder), null,
        t.key + " does not stop at Install");
    }
  });

  test("a CNC job dragged into Assemble Legacy rejoins its own route", () => {
    // Off-route is not an error -- someone hand-drags cards. The job resumes at
    // the first phase its own route contains at or after where it landed, so a
    // CNC job parked in the wrong assemble column is sent to the right one
    // rather than stalling or skipping ahead to Install.
    const next = WFJobType.nextPhase({ jobType: "CNC only" }, "Assemble Legacy", shopOrder);
    assert.equal(next, "Assemble CNC");
  });

  test("a job dragged past its remaining route ends rather than going backwards", () => {
    // CAP has no finish step, so from Sandblast the only thing left is Install.
    assert.equal(WFJobType.nextPhase({ jobType: "CAP railing only" }, "Sandblast / Powder Coat", shopOrder),
      "Install");
    assert.equal(WFJobType.nextPhase({ jobType: "CAP railing only" }, "Billing", shopOrder), null);
  });

  test("a card in an unknown phase starts at the top of its route", () => {
    assert.equal(WFJobType.nextPhase({ jobType: "CNC only" }, "Somewhere Else", shopOrder), "CAD");
    assert.equal(WFJobType.nextPhase({ jobType: "CNC only" }, "CAD", null), "Assemble CNC");
  });

  test("Final Approval hands off to CAD even though it is not a work phase", () => {
    assert.equal(WFJobType.nextPhase({ jobType: "Legacy fabrication" }, "Final Approval", shopOrder),
      "CAD");
  });

  test("a CNC job waiting in Final Approval still starts at CAD", () => {
    // Final Approval is not on the CNC route, so this exercises the rejoin
    // path: the first CNC route step at or after Final Approval is CAD.
    assert.equal(WFJobType.nextPhase({ jobType: "CNC only" }, "Final Approval", shopOrder), "CAD");
  });

  test("an office stage before the shop sends the job to the start of its route", () => {
    for (const t of routed) {
      assert.equal(WFJobType.nextPhase({ jobType: t.label }, "Intake", shopOrder), t.route[0],
        t.key + " does not begin at " + t.route[0] + " when it comes out of Intake");
    }
  });

  test("an office stage after Install has nothing left to advance to", () => {
    // The bug this pins down: with only work phases in shopOrder, Billing
    // scored -1 and every job in it was marched back to the start of its route.
    for (const t of routed) {
      for (const late of ["Billing", "Outstanding Invoices", "Job Closed / Done"]) {
        assert.equal(WFJobType.nextPhase({ jobType: t.label }, late, shopOrder), null,
          t.key + " in " + late + " would be sent to " +
          WFJobType.nextPhase({ jobType: t.label }, late, shopOrder));
      }
    }
  });
});
