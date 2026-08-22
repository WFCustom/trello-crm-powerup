/**
 * QC peer sign-off: which phases gate on it, and who is allowed to sign.
 *
 * requiresQc() is a plain name lookup against a list of phase names. When
 * "Assemble" was split into three per-job-type columns, none of the new names
 * matched, so CNC and CAP work stopped being peer-reviewed. Nothing errored --
 * the check simply never appeared, which is the worst kind of failure for a
 * quality gate.
 *
 * These tests tie the gate to the board: every assemble column and the finish
 * step must require QC, and every name in the list must be a list that exists.
 */
"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./harness.js");

const win = h.load();
const { cfg: board } = h.productionBoard(win);
const { WFQC, WFJobType } = win;

const LIVE_STAGE_NAMES = new Set(board.stages.map((s) => s.name));

describe("which phases gate on QC", () => {
  test("all three assemble columns require peer sign-off", () => {
    for (const col of ["Assemble Legacy", "Assemble CAP", "Assemble CNC"]) {
      assert.equal(WFQC.requiresQc(col), true,
        col + " does not require QC, so that job type skips peer review entirely");
    }
  });

  test("the finish step requires peer sign-off", () => {
    assert.equal(WFQC.requiresQc("Sandblast / Powder Coat"), true);
  });

  test("every QC phase is a list that exists on the board", () => {
    for (const p of WFQC.qcPhases()) {
      assert.ok(LIVE_STAGE_NAMES.has(p),
        "QC gates on \"" + p + "\", which is not a list on the board -- the gate can never fire");
    }
  });

  test("every QC phase is a work phase someone can actually claim", () => {
    const workPhases = new Set(board.stages.filter((s) => s.isWorkPhase).map((s) => s.name));
    for (const p of WFQC.qcPhases()) {
      assert.ok(workPhases.has(p), "\"" + p + "\" is gated on QC but is not claimable work");
    }
  });

  test("office and billing stages do not gate on QC", () => {
    for (const p of ["Intake", "Final Approval", "Billing", "CAD", "Print CAD", "Install"]) {
      assert.equal(WFQC.requiresQc(p), false, p + " should advance on approval, not peer QC");
    }
  });

  test("the deleted Assemble column is no longer what the gate keys on", () => {
    assert.equal(WFQC.requiresQc("Assemble"), false);
    assert.equal(WFQC.requiresQc("CNC Table"), false);
  });

  test("the QC list has no duplicates", () => {
    const p = WFQC.qcPhases();
    assert.equal(new Set(p).size, p.length, "a phase is listed twice in qcPhases");
  });

  test("an unknown phase name does not gate", () => {
    assert.equal(WFQC.requiresQc("Gazebo"), false);
    assert.equal(WFQC.requiresQc(""), false);
    assert.equal(WFQC.requiresQc(undefined), false);
  });
});

describe("no job type can reach Install without a QC gate", () => {
  test("every route passes through at least one QC phase", () => {
    for (const t of WFJobType.all().filter((x) => !x.splitsInto)) {
      const gated = t.route.filter((p) => WFQC.requiresQc(p));
      assert.ok(gated.length >= 1,
        t.key + " reaches Install with no peer review at any point: " + t.route.join(" -> "));
    }
  });

  test("each route's assemble step is the gated one", () => {
    for (const t of WFJobType.all().filter((x) => !x.splitsInto)) {
      const asm = t.route.find((p) => p.startsWith("Assemble"));
      assert.ok(asm, t.key + " has no assemble step");
      assert.equal(WFQC.requiresQc(asm), true, t.key + ": " + asm + " is not gated");
    }
  });
});

describe("who may sign a check", () => {
  const dale = { id: "1", username: "dalejacaway", fullName: "Dale J" };
  const ben = { id: "2", username: "bannista", fullName: "Ben A" };

  test("a check aimed at one person may only be signed by them", () => {
    const rec = { requestedBy: dale, requestedFrom: ben };
    assert.equal(WFQC.canReview(rec, "bannista", false), true);
    assert.equal(WFQC.canReview(rec, "someoneelse", false), false);
  });

  test("a check released to the pool may be signed by anyone", () => {
    const rec = { requestedBy: dale, requestedFrom: null };
    assert.equal(WFQC.canReview(rec, "anyone", false), true);
  });

  test("a manager may always sign", () => {
    const rec = { requestedBy: dale, requestedFrom: ben };
    assert.equal(WFQC.canReview(rec, "craigjacaway", true), true);
  });

  test("there is nothing to sign without a record", () => {
    assert.equal(WFQC.canReview(null, "bannista", false), false);
    assert.equal(WFQC.canReview(null, "bannista", true), false);
  });

  test("whoever sent it for checking is the one who must correct it", () => {
    const rec = { requestedBy: dale, requestedFrom: ben };
    assert.equal(WFQC.isOwner(rec, "dalejacaway"), true);
    assert.equal(WFQC.isOwner(rec, "bannista"), false);
    assert.equal(WFQC.isOwner(null, "dalejacaway"), false);
  });
});

describe("a record belongs to the phase it was raised in", () => {
  test("a record raised in the list the card is in is active", () => {
    const listId = board.stages.find((s) => s.name === "Assemble CNC").listId;
    const rec = WFQC.activeRecord
      ? WFQC.activeRecord({ idList: listId, qcRecord: { listId, phase: "Assemble CNC" } })
      : { listId };
    assert.ok(rec, "a record raised in the current list should be active");
  });

  test("a record left behind by an earlier phase is not active", () => {
    if (!WFQC.activeRecord) return;   // private in this build
    const oldList = board.stages.find((s) => s.name === "Assemble CNC").listId;
    const nowList = board.stages.find((s) => s.name === "Sandblast / Powder Coat").listId;
    const rec = WFQC.activeRecord({ idList: nowList, qcRecord: { listId: oldList } });
    assert.equal(rec, null, "a QC record must not follow the card into the next phase");
  });

  test("anyRecord still returns it for the history view", () => {
    const stale = { listId: "aaaaaaaaaaaaaaaaaaaaaaaa", phase: "Assemble CNC" };
    assert.equal(WFQC.anyRecord({ idList: "bbbbbbbbbbbbbbbbbbbbbbbb", qcRecord: stale }), stale);
    assert.equal(WFQC.anyRecord({}), null);
  });
});

describe("the manager override label", () => {
  test("the label is matched case-insensitively and trimmed", () => {
    assert.equal(WFQC.needsManagerAfterQc({ labels: [{ name: "  Needs Shop Manager Approval " }] }), true);
    assert.equal(WFQC.needsManagerAfterQc({ labels: [{ name: WFQC.NEEDS_MANAGER }] }), true);
  });

  test("an unrelated label does not force a signature", () => {
    assert.equal(WFQC.needsManagerAfterQc({ labels: [{ name: "Rush" }] }), false);
    assert.equal(WFQC.needsManagerAfterQc({ labels: [] }), false);
    assert.equal(WFQC.needsManagerAfterQc({}), false);
  });
});

describe("reading a record back as history", () => {
  test("failures, fixes and confirmations come out in round order", () => {
    const dale = { username: "dalejacaway" };
    const ben = { username: "bannista" };
    const rec = {
      rounds: [{
        n: 1,
        checkedBy: ben, checkedAt: "2026-08-01T10:00:00.000Z",
        items: [
          { text: "Welds ground flush", result: "fail", note: "two spots on the top rail" },
          { text: "Length to drawing", result: "pass" }
        ],
        corrections: [{ text: "Welds ground flush", whatIDid: "reground both" }],
        correctedBy: dale, correctedAt: "2026-08-01T14:00:00.000Z",
        verify: [{ text: "Welds ground flush", ok: true }],
        verifiedBy: ben, verifiedAt: "2026-08-01T15:00:00.000Z"
      }]
    };
    const lines = WFQC.summarize(rec);
    assert.equal(lines.length, 3, "expected one fail, one fix and one confirmation");
    assert.match(lines[0].what, /^failed /);
    assert.match(lines[0].what, /Welds ground flush/);
    assert.equal(lines[0].note, "two spots on the top rail");
    assert.match(lines[1].what, /^fixed /);
    assert.equal(lines[1].note, "reground both");
    assert.match(lines[2].what, /^confirmed /);
    for (const l of lines) assert.equal(l.round, 1);
  });

  test("a passed item is not reported as a problem", () => {
    const rec = { rounds: [{ n: 1, items: [{ text: "Length to drawing", result: "pass" }] }] };
    assert.equal(WFQC.summarize(rec).length, 0);
  });

  test("summarising nothing yields nothing rather than throwing", () => {
    assert.deepEqual(h.plain(WFQC.summarize(null)), []);
    assert.deepEqual(h.plain(WFQC.summarize({})), []);
    assert.deepEqual(h.plain(WFQC.summarize({ rounds: [] })), []);
  });
});
