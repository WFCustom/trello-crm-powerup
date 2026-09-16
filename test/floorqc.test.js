/**
 * The QC gate that replaced manager approval.
 *
 * The assertion this file exists for: a job CANNOT pass to the next phase
 * without a worked checklist, a typed signature and a named signer. That is now
 * the only thing standing between the bench and the next list -- there is no
 * manager queue behind it to catch anything. So the conditions have to hold
 * exactly, and a weakening of any one of them is a silent hole in the process,
 * not a UI regression.
 *
 * The second thing held here: the checklist is keyed by STATION, not phase. The
 * blast booth, the powder booth and the cure oven all sit on one phase and
 * check entirely different things; keying by phase would quietly give all three
 * the same list.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { load } = require("./harness");

const win = load();
const QC = win.WFQC;

const KEV = { id: "1", username: "kevinmoss", fullName: "Kevin Moss" };
const SCOTT = { id: "2", username: "scottv", fullName: "Scott VanWorkom" };

const ITEMS = [
  { text: "Frame is square", spec: "Diagonals within 1/8″" },
  { text: "All welds complete", spec: "Check the back side" }
];

const allChecked = { 0: true, 1: true };

function fakeT(seed) {
  const store = Object.assign({}, seed || {});
  const writes = [];
  return {
    writes, store,
    get: (scope, vis, key, dflt) => {
      const v = store[scope + "/" + key];
      return Promise.resolve(v === undefined ? dflt : v);
    },
    set: (scope, vis, key, value) => {
      writes.push([scope, key, value]);
      store[scope + "/" + key] = value;
      return Promise.resolve();
    },
    remove: (scope, vis, key) => {
      writes.push([scope, key, null]);
      delete store[scope + "/" + key];
      return Promise.resolve();
    }
  };
}

/* ====================================================== the gate conditions */

test("every item checked, a real signature and a named signer -- all three", () => {
  assert.equal(QC.canSignOff(ITEMS, allChecked, "Kevin Moss", SCOTT), true);

  // One line left unticked. A partially worked list signed off is worse than
  // no list, because it carries a claim nobody made.
  assert.equal(QC.canSignOff(ITEMS, { 0: true }, "Kevin Moss", SCOTT), false);

  // A signature box somebody can dismiss with a keystroke stops being a
  // signature, so two characters is not enough.
  assert.equal(QC.canSignOff(ITEMS, allChecked, "K", SCOTT), false);
  assert.equal(QC.canSignOff(ITEMS, allChecked, "  ", SCOTT), false);

  // "Who said this was good" is the entire value of the record.
  assert.equal(QC.canSignOff(ITEMS, allChecked, "Kevin Moss", null), false);
});

test("an empty checklist cannot be signed", () => {
  // Otherwise a station nobody set up becomes a station with no gate at all --
  // the exact opposite of what an unconfigured station should mean.
  assert.equal(QC.canSignOff([], {}, "Kevin Moss", SCOTT), false);
  assert.equal(QC.canSignOff(null, {}, "Kevin Moss", SCOTT), false);
});

test("the hint names what is actually in the way, and counts it", () => {
  assert.match(QC.signHint(ITEMS, {}, "", null), /2 items remaining/);
  assert.match(QC.signHint(ITEMS, { 0: true }, "", null), /1 item remaining/);
  assert.match(QC.signHint(ITEMS, allChecked, "", null), /Type your name/);
  assert.match(QC.signHint(ITEMS, allChecked, "Kevin Moss", null), /Choose who signed off/);
  assert.match(QC.signHint([], {}, "", null), /No checklist set up/);
});

/* ======================================================== station checklists */

test("a station's own list wins over the phase's", async () => {
  const t = fakeT({
    "board/wfQcChecklists": { f1: [{ text: "Blast to near-white", spec: "SSPC SP10" }] },
    "board/qcTemplates": { "Sandblast / Powder Coat": ["Something else entirely"] }
  });
  const items = await QC.getStationChecklist(t, "f1", "Sandblast / Powder Coat");
  assert.deepEqual(items.map((i) => i.text), ["Blast to near-white"]);
  assert.equal(items[0].spec, "SSPC SP10");
});

test("two stations on one phase get different lists", async () => {
  // This is the whole reason for keying by station.
  const t = fakeT({
    "board/wfQcChecklists": {
      f1: [{ text: "Blast to near-white" }],
      f2: [{ text: "Film thickness checked" }]
    }
  });
  const blast = await QC.getStationChecklist(t, "f1", "Sandblast / Powder Coat");
  const powder = await QC.getStationChecklist(t, "f2", "Sandblast / Powder Coat");
  assert.notDeepEqual(blast.map((i) => i.text), powder.map((i) => i.text));
});

test("a station nobody has set up falls back to the phase's saved list", async () => {
  const t = fakeT({ "board/qcTemplates": { "Assemble CNC": ["Check the thing"] } });
  const items = await QC.getStationChecklist(t, "s3", "Assemble CNC");
  assert.deepEqual(items.map((i) => i.text), ["Check the thing"]);
});

test("with nothing saved anywhere, an Assemble station still gets a real list", async () => {
  // A station with no checklist has no gate, so the shipped draft matters.
  const t = fakeT();
  const items = await QC.getStationChecklist(t, "s1", "Assemble Legacy");
  assert.ok(items.length >= 5, "the shipped Assemble draft");
  assert.ok(items.every((i) => i.text), "every line has text");
  assert.ok(items.some((i) => i.spec), "and the tolerances came with them");
});

test("all three Assemble routes start from the same bench list", () => {
  const legacy = QC.defaultStationItems("Assemble Legacy");
  const cnc = QC.defaultStationItems("Assemble CNC");
  const cap = QC.defaultStationItems("Assemble CAP");
  assert.deepEqual(legacy.map((i) => i.text), cnc.map((i) => i.text));
  assert.deepEqual(legacy.map((i) => i.text), cap.map((i) => i.text));
});

test("a deliberately emptied station list is respected, not refilled", async () => {
  const t = fakeT({ "board/wfQcChecklists": { s1: [] } });
  const items = await QC.getStationChecklist(t, "s1", "Assemble Legacy");
  assert.deepEqual(items, [], "an empty list is a choice, not a missing one");
});

test("saving accepts plain strings and item objects alike", async () => {
  const t = fakeT();
  await QC.saveStationChecklist(t, "s1", [
    "Just text",
    { text: "With a spec", spec: "±1/8″" },
    { text: "" }
  ]);
  const saved = t.store["board/wfQcChecklists"].s1;
  assert.equal(saved.length, 2, "the blank line is dropped");
  assert.deepEqual(saved[0], { text: "Just text", spec: "" });
  assert.deepEqual(saved[1], { text: "With a spec", spec: "±1/8″" });
});

/* ============================================================ the sign-off */

test("signing off refuses outright when the conditions aren't met", async () => {
  const t = fakeT();
  await assert.rejects(
    () => QC.signOffAndPass(t, { id: "c1", idList: "LA", idBoard: "B" }, {
      stationId: "s1", phase: "Assemble Legacy",
      items: ITEMS, checked: { 0: true }, signature: "Kevin Moss", signedBy: SCOTT
    }),
    /Check every item/);
  assert.equal(t.writes.length, 0, "and writes nothing on the way out");
});

test("the record names the signer separately from the typed name", async () => {
  // A welder signing their own work puts themselves in both; a peer check has
  // two different names, and that difference is the fact worth keeping.
  const t = fakeT({ "c1/phaseWork": { listId: "LA", claimedBy: KEV, segments: [] } });
  win.WFRest.moveCard = () => Promise.resolve({});
  win.WFRest.postComment = () => Promise.resolve({});

  const out = await QC.signOffAndPass(t, { id: "c1", idList: "LA", idBoard: "B" }, {
    stationId: "s1", phase: "Assemble Legacy",
    items: ITEMS, checked: allChecked,
    signature: "Kevin Moss", signedBy: SCOTT, worker: KEV
  });

  assert.equal(out.rec.signature, "Kevin Moss");
  assert.equal(out.rec.signedBy.fullName, "Scott VanWorkom");
  assert.equal(out.rec.status, "passed");
  assert.equal(out.rec.stationId, "s1");
  assert.ok(out.rec.signedAt, "and when");
});

test("the signed record keeps the tolerances, not just the ticks", async () => {
  const t = fakeT({ "c1/phaseWork": { listId: "LA", claimedBy: KEV, segments: [] } });
  win.WFRest.moveCard = () => Promise.resolve({});
  win.WFRest.postComment = () => Promise.resolve({});

  const out = await QC.signOffAndPass(t, { id: "c1", idList: "LA", idBoard: "B" }, {
    stationId: "s1", phase: "Assemble Legacy",
    items: ITEMS, checked: allChecked,
    signature: "Kevin Moss", signedBy: SCOTT, worker: KEV
  });
  // Editing the station's list later must not rewrite what was attested to.
  assert.equal(out.rec.rounds[0].items[0].spec, "Diagonals within 1/8″");
  assert.ok(out.rec.rounds[0].items.every((i) => i.result === "pass"));
});

test("a signed record is found on the card, and only for its own list", () => {
  const rec = { status: "passed", signedAt: "2026-09-15T10:00:00Z", listId: "LA" };
  assert.ok(QC.floorSignOff({ idList: "LA", qcRecord: rec }));
  // The card has moved on; a signature from the previous phase means nothing
  // here, and treating it as valid would let a job through two phases on one
  // check.
  assert.equal(QC.floorSignOff({ idList: "LS", qcRecord: rec }), null);
  assert.equal(QC.floorSignOff({ idList: "LA", qcRecord: null }), null);
});

test("an unsigned or in-progress record does not count as a pass", () => {
  assert.equal(QC.floorSignOff({
    idList: "LA", qcRecord: { status: "awaiting_check", listId: "LA" }
  }), null);
  assert.equal(QC.floorSignOff({
    idList: "LA", qcRecord: { status: "passed", listId: "LA" }   // no signedAt
  }), null);
});
