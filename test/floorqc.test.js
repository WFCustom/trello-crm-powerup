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

test("a station picks its list by name, explicit choice first", async () => {
  const t = fakeT({
    "board/qcTemplates": {
      "Powder booth": [{ text: "Film thickness checked", spec: "2-4 mil" }],
      "Sandblast / Powder Coat": [{ text: "Something else entirely" }]
    }
  });
  const r = await QC.checklistFor(t, {
    id: "f2", table: "Powder booth", station: "Spray · powder coat",
    phase: "Sandblast / Powder Coat", checklist: "Powder booth"
  });
  assert.equal(r.name, "Powder booth");
  assert.deepEqual(r.items.map((i) => i.text), ["Film thickness checked"]);
  assert.equal(r.items[0].spec, "2-4 mil");
});

test("a list named after the station is picked up without any setup", async () => {
  // This is the point of matching by name: make "Powder booth" in the Roster
  // and the powder booth finds it, no config change.
  const t = fakeT({ "board/qcTemplates": { "Powder booth": [{ text: "Film thickness" }] } });
  const r = await QC.checklistFor(t, {
    id: "f2", table: "Powder booth", station: "Spray · powder coat",
    phase: "Sandblast / Powder Coat"
  });
  assert.equal(r.name, "Powder booth");
});

test("two stations on one phase can work different lists", async () => {
  const t = fakeT({
    "board/qcTemplates": {
      "Blast booth": [{ text: "Blast to near-white" }],
      "Powder booth": [{ text: "Film thickness checked" }]
    }
  });
  const blast = await QC.checklistFor(t, { id: "f1", table: "Blast booth", phase: "SPC" });
  const powder = await QC.checklistFor(t, { id: "f2", table: "Powder booth", phase: "SPC" });
  assert.notDeepEqual(blast.items.map((i) => i.text), powder.items.map((i) => i.text));
});

test("falling back to the phase's list, then to the shipped draft", async () => {
  const byPhase = fakeT({ "board/qcTemplates": { "Assemble CNC": ["Check the thing"] } });
  const r1 = await QC.checklistFor(byPhase, { id: "s3", table: "Station #3", phase: "Assemble CNC" });
  assert.equal(r1.name, "Assemble CNC");
  assert.deepEqual(r1.items.map((i) => i.text), ["Check the thing"]);

  // A station with no checklist has no gate, so the shipped draft matters.
  const bare = fakeT();
  const r2 = await QC.checklistFor(bare, { id: "s1", table: "Station #1", phase: "Assemble Legacy" });
  assert.equal(r2.source, "draft");
  assert.ok(r2.items.length >= 5);
  assert.ok(r2.items.some((i) => i.spec), "and the tolerances came with it");
});

test("a list saved before tolerances existed still reads", async () => {
  // Old entries are plain strings. Nobody should have to migrate anything.
  const t = fakeT({ "board/qcTemplates": { "Assemble CNC": ["Plain string item"] } });
  const lib = await QC.getLibrary(t);
  assert.deepEqual(lib["Assemble CNC"], [{ text: "Plain string item", spec: "" }]);
});

test("the library can be added to, renamed and deleted", async () => {
  const t = fakeT();
  await QC.saveLibraryEntry(t, "Powder booth", [{ text: "Film thickness", spec: "2-4 mil" }]);
  assert.deepEqual(await QC.libraryNames(t), ["Powder booth"]);

  await QC.renameLibraryEntry(t, "Powder booth", "Powder line");
  assert.deepEqual(await QC.libraryNames(t), ["Powder line"]);

  await QC.deleteLibraryEntry(t, "Powder line");
  assert.deepEqual(await QC.libraryNames(t), []);
});

test("a checklist cannot be saved without a name", async () => {
  const t = fakeT();
  await assert.rejects(() => QC.saveLibraryEntry(t, "   ", []), /needs a name/);
});

test("an empty list is a real choice and is kept", async () => {
  // Created empty on purpose -- a list seeded with somebody else's items is one
  // people delete line by line before they can use it.
  const t = fakeT();
  await QC.saveLibraryEntry(t, "Powder booth", []);
  const r = await QC.checklistFor(t, { id: "f2", table: "Powder booth", phase: "SPC" });
  assert.equal(r.name, "Powder booth");
  assert.deepEqual(r.items, []);
});

test("a per-station list saved before the library existed still works", async () => {
  // Read, never written to again. A board that saved one keeps its list.
  const t = fakeT({ "board/wfQcChecklists": { f1: [{ text: "Legacy line" }] } });
  const r = await QC.checklistFor(t, { id: "f1", table: "Blast booth", phase: "SPC" });
  assert.equal(r.source, "legacy");
  assert.deepEqual(r.items.map((i) => i.text), ["Legacy line"]);
});

test("all three Assemble routes start from the same bench list", () => {
  const legacy = QC.defaultStationItems("Assemble Legacy");
  const cnc = QC.defaultStationItems("Assemble CNC");
  const cap = QC.defaultStationItems("Assemble CAP");
  assert.deepEqual(legacy.map((i) => i.text), cnc.map((i) => i.text));
  assert.deepEqual(legacy.map((i) => i.text), cap.map((i) => i.text));
});

test("saving accepts plain strings and item objects alike", async () => {
  const t = fakeT();
  await QC.saveLibraryEntry(t, "Welding", [
    "Just text",
    { text: "With a spec", spec: "±1/8″" },
    { text: "" }
  ]);
  const saved = t.store["board/qcTemplates"]["Welding"];
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

test("signing signs, and does NOT ship the job", async () => {
  // These were fused in the first cut, which meant the mock's "are you sure
  // you're sending this to Sandblast?" question could never appear -- there was
  // no moment between attesting to the work and letting go of it.
  const t = fakeT({ "c1/phaseWork": { listId: "LA", claimedBy: KEV, segments: [] } });
  let moved = 0;
  win.WFRest.moveCard = () => { moved++; return Promise.resolve({}); };
  win.WFRest.postComment = () => Promise.resolve({});

  const rec = await QC.signOff(t, { id: "c1", idList: "LA", idBoard: "B" }, {
    stationId: "s1", phase: "Assemble Legacy",
    items: ITEMS, checked: allChecked,
    signature: "Kevin Moss", signedBy: SCOTT, worker: KEV
  });

  assert.equal(rec.status, "passed", "the check itself passed");
  assert.equal(moved, 0, "but the card has not moved anywhere");
  assert.ok(!t.store["c1/phaseWork"].completedAt, "and the phase is still open");
});

test("passing refuses on a card nobody signed", async () => {
  // This is the last gate between the bench and the next list, and there is no
  // manager queue behind it to catch a mistake.
  const t = fakeT();
  await assert.rejects(
    () => QC.passSigned(t, { id: "c1", idList: "LA", idBoard: "B" }, { idList: "LA" }),
    /hasn't passed QC/);
});

test("passing a signed card moves it and credits the signer", async () => {
  const t = fakeT({ "c1/phaseWork": { listId: "LA", claimedBy: KEV, segments: [] } });
  const comments = [];
  win.WFRest.moveCard = () => Promise.resolve({});
  win.WFRest.postComment = (x, id, text) => { comments.push(text); return Promise.resolve({}); };

  const card = {
    idList: "LA",
    qcRecord: {
      listId: "LA", status: "passed", signedAt: new Date().toISOString(),
      signature: "Kevin Moss", signedBy: SCOTT
    }
  };
  await QC.passSigned(t, { id: "c1", idList: "LA", idBoard: "B" }, card);

  // The audit trail names whoever actually looked at the work.
  assert.ok(comments.some((c) => /Scott VanWorkom/.test(c)));
  // And never claims the job is waiting on a manager, because it isn't.
  assert.ok(!comments.some((c) => /awaiting manager approval/i.test(c)));
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
