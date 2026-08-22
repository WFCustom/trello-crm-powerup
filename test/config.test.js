/**
 * Structural integrity of config.js.
 *
 * config.js is the one file anyone is expected to edit after deployment, and
 * it is edited by hand against a live Trello board. Almost every outage this
 * project has had came from that file drifting out of step with the board:
 * a list deleted in Trello but still mapped here, a list id pasted twice, a
 * phase named in one module and spelled differently in another.
 *
 * These tests check the things that can be checked without the network. The
 * "does this list still exist in Trello" question needs the API and lives in
 * board.live.test.js.
 */
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./harness.js");

const win = h.load(["config.js"]);
const CFG = win.WF_CONFIG;

/* Lists deleted from the boards. Naming one of these in code means routing a
   card somewhere Trello will reject, which fails silently at runtime. */
const DELETED_LIST_NAMES = [
  "CNC Table",
  "CNC Table/cap rail",
  "Assemble",              // split into three per-job-type columns
  "Bead Laid - WON",       // renamed to Bid Won / Awaiting Site Prep
  "Converted / Go Measure",
  "OTP Bid/Measure",
  "Out of Scope"
];

describe("config.js top level", () => {
  test("exposes an appKey and at least one manager", () => {
    assert.match(CFG.appKey, /^[a-f0-9]{32}$/, "appKey should be a 32-char Trello app key");
    assert.ok(Array.isArray(CFG.managers) && CFG.managers.length > 0, "managers must not be empty");
  });

  test("manager usernames are lowercase with no @ or spaces", () => {
    for (const m of CFG.managers) {
      assert.equal(m, m.toLowerCase(), `manager "${m}" should be a lowercase Trello username`);
      assert.doesNotMatch(m, /[@\s]/, `manager "${m}" looks like a full name or email, not a username`);
    }
  });

  test("thresholds are ordered fractions", () => {
    const t = CFG.thresholds;
    assert.ok(t.amberAt > 0 && t.amberAt < t.redAt, "amberAt must be below redAt");
  });

  test("declares exactly one production and one sales board", () => {
    const types = Object.values(CFG.boards).map((b) => b.type);
    assert.equal(types.filter((x) => x === "production").length, 1);
    assert.equal(types.filter((x) => x === "sales").length, 1);
  });
});

describe("stage mappings", () => {
  const stages = h.allStages(win);

  test("every stage has a listId, a name and an order", () => {
    for (const s of stages) {
      assert.match(s.listId, /^[a-f0-9]{24}$/, `bad listId on "${s.name}" (${s.boardName})`);
      assert.ok(s.name && s.name.trim(), `stage ${s.listId} has no name`);
      assert.equal(typeof s.order, "number", `stage "${s.name}" has no numeric order`);
    }
  });

  test("no list id is mapped twice", () => {
    const seen = new Map();
    for (const s of stages) {
      const prev = seen.get(s.listId);
      assert.equal(prev, undefined,
        `listId ${s.listId} is mapped to both "${prev}" and "${s.name}"`);
      seen.set(s.listId, s.name);
    }
  });

  test("no list is both mapped as a stage and excluded", () => {
    for (const [boardId, b] of Object.entries(CFG.boards)) {
      const mapped = new Set((b.stages || []).map((s) => s.listId));
      for (const ex of b.excludedLists || []) {
        assert.ok(!mapped.has(ex),
          `${b.name}: list ${ex} is in excludedLists but also mapped as a stage`);
      }
      assert.equal(new Set(b.excludedLists || []).size, (b.excludedLists || []).length,
        `${b.name}: excludedLists contains a duplicate`);
      assert.ok(boardId);
    }
  });

  test("no stage is named after a list that was deleted from the board", () => {
    for (const s of stages) {
      assert.ok(!DELETED_LIST_NAMES.includes(s.name),
        `"${s.name}" (${s.boardName}) no longer exists in Trello`);
    }
  });

  test("slaDays is a positive number or explicitly null", () => {
    for (const s of stages) {
      if (s.slaDays === null || s.slaDays === undefined) continue;
      assert.ok(s.slaDays > 0, `"${s.name}" has slaDays ${s.slaDays}`);
    }
  });

  test("terminal stages carry no SLA and no work", () => {
    for (const s of stages.filter((x) => x.isTerminal)) {
      assert.ok(["won", "lost"].includes(s.isTerminal),
        `"${s.name}" has isTerminal "${s.isTerminal}"`);
      assert.equal(s.slaDays, null, `terminal stage "${s.name}" should have slaDays null`);
      assert.ok(!s.isWorkPhase, `terminal stage "${s.name}" should not be a work phase`);
    }
  });

  test("a handoff stage says where it hands off to", () => {
    for (const s of stages.filter((x) => x.isHandoff)) {
      assert.ok(s.handoffTo && s.handoffTo.trim(), `"${s.name}" is a handoff with no handoffTo`);
    }
  });
});

describe("phaseSpecialists", () => {
  test("every phase named is a real work phase on some board", () => {
    const workPhaseNames = new Set(
      h.allStages(win).filter((s) => s.isWorkPhase).map((s) => s.name)
    );
    for (const phase of Object.keys(CFG.phaseSpecialists || {})) {
      assert.ok(workPhaseNames.has(phase),
        `phaseSpecialists names "${phase}", which is not a work phase in any board`);
    }
  });

  test("every specialist is a lowercase username", () => {
    for (const [phase, people] of Object.entries(CFG.phaseSpecialists || {})) {
      assert.ok(Array.isArray(people) && people.length, `${phase} has no specialists listed`);
      for (const p of people) {
        assert.equal(p, p.toLowerCase(), `specialist "${p}" on ${phase} is not lowercase`);
      }
    }
  });
});

describe("custom fields", () => {
  test("each custom field has a non-empty display name", () => {
    for (const [k, v] of Object.entries(CFG.customFieldNames || {})) {
      assert.ok(v && v.trim(), `customFieldNames.${k} is empty`);
    }
  });
});
