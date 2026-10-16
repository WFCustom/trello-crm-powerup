/**
 * Route-aware auto-advance.
 *
 * lib/advance.js works by monkey-patching WFPhase.advance. Nothing
 * imports it and nothing calls it by name, so if a refactor renames or reorders
 * the function it wraps, the patch simply stops being applied -- no error, no
 * failing import, just every job quietly walking the flat board order again and
 * CNC-only work being pushed through Print CAD. That failure is invisible from
 * the outside, which is exactly why it is worth a test.
 *
 * What is held here: the wrapper is installed, it routes by the card's job
 * type, a card whose type cannot be read still moves rather than stalling, and
 * the temporary pin it puts on WFStage.getNextStage is always handed back.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { load, LOAD_ORDER, productionBoard, plain } = require("./harness");

const win = load();
const bare = load(LOAD_ORDER.filter((f) => f !== "lib/advance.js"));

const ORIGINAL_NEXT_STAGE = win.WFStage.getNextStage;

const { id: BOARD, cfg: BOARD_CFG } = productionBoard(win);

/** The list a phase name resolves to, read out of config.js rather than typed. */
function listFor(name) {
  const matches = (BOARD_CFG.stages || []).filter((s) => s.name === name);
  if (!matches.length) throw new Error("config.js has no stage named " + name);
  return (matches.filter((s) => s.isPrimaryTarget)[0] || matches[0]).listId;
}

/** EVERY list a phase name resolves to. Install is four columns, one phase. */
function listsFor(name) {
  const matches = (BOARD_CFG.stages || []).filter((s) => s.name === name);
  if (!matches.length) throw new Error("config.js has no stage named " + name);
  return matches.map((s) => s.listId);
}

const CAD = listFor("CAD");
const PRINT_CAD = listFor("Print CAD");
const ASSEMBLE_CNC = listFor("Assemble CNC");
const INSTALL = listFor("Install");
const INSTALL_LISTS = listsFor("Install");
const BILLING = listFor("Billing");
const OUTSTANDING = listFor("Outstanding Invoices");

const MANAGER = { id: "m1", username: "craigjacaway", fullName: "Craig Jacaway" };
const WORKER = { id: "w1", username: "mike", fullName: "Mike" };

function card(listId) {
  return { id: "c1", idList: listId, idBoard: BOARD };
}

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

/** A card sitting in `listId` with a finished phase awaiting approval. */
function awaitingApproval(listId) {
  return fakeT({
    "c1/phaseWork": {
      listId: listId,
      claimedBy: WORKER,
      segments: [],
      pendingApproval: true,
      completedAt: new Date().toISOString()
    }
  });
}

/** Collects the list ids the card is moved to, instead of calling Trello. */
function captureMoves(w, opts) {
  const moves = [];
  w.WFRest.moveCard = (t, cardId, listId) => {
    if (opts && opts.fail) return Promise.reject(new Error("move failed"));
    moves.push(listId);
    return Promise.resolve({});
  };
  w.WFRest.postComment = () => Promise.resolve({});
  return moves;
}

/**
 * What the card's "Job Type" custom field reads as.
 *
 * Shaped like getCardFieldsDisplay's real output -- a flat list of every custom
 * field resolved to its display string. It used to stub getNamedCustomFieldValues,
 * which returns only jobValue/jobCost/leadReceivedAt and therefore could never
 * carry a job type: the stub was the only reason routing appeared to work.
 */
function jobTypeReads(value) {
  win.WFRest.getCardFieldsDisplay = () => Promise.resolve([
    { name: "Style", display: "RG-4 picket" },
    { name: "Job Type", display: value }
  ]);
}

/* ========================================================= the patch is on */

test("the route-aware wrapper is installed over WFPhase.approveAndAdvance", () => {
  // If this flag is gone, the wrapper never ran -- most likely because the
  // function it patches was renamed or moved.
  assert.equal(win.WFPhase.__routeAware, true);
  assert.equal(typeof win.WFPhase.__targetStage, "function");

  // And the flag really does come from lib/advance.js, not from phase.js.
  assert.equal(bare.WFPhase.__routeAware, undefined);
});

test("the wrapper sits on advance, so every route into a move gets routing", async () => {
  /* WHY THIS MATTERS MORE THAN IT LOOKS.
   *
   * advance() is now the single place a phase is retired and a card moved;
   * approveAndAdvance just checks the approval flag and delegates to it. If the
   * wrapper were still attached to approveAndAdvance, the QC path -- which
   * calls advance directly, because there is no approval in it -- would quietly
   * fall back to the flat column order and send plain railings into CNC.
   *
   * That is the exact bug lib/advance.js exists to prevent, reintroduced by the
   * migration that was meant to be safe. So it is asserted against advance
   * itself rather than only through its caller.
   */
  jobTypeReads("CNC only");
  const moves = captureMoves(win);
  await win.WFPhase.advance(awaitingApproval(CAD), card(CAD), MANAGER, { verb: "Passed QC" });
  assert.deepStrictEqual(moves, [ASSEMBLE_CNC]);
});

/* ============================================================== it routes */

test("a CNC job leaving CAD goes to Assemble CNC, not to the next column", async () => {
  jobTypeReads("CNC only");
  const moves = captureMoves(win);
  await win.WFPhase.approveAndAdvance(awaitingApproval(CAD), card(CAD), MANAGER);
  assert.deepStrictEqual(moves, [ASSEMBLE_CNC]);

  // The same card without the wrapper: the flat board order sends it to the
  // next column instead, which is the behaviour advance.js exists to override.
  const bareMoves = captureMoves(bare);
  await bare.WFPhase.approveAndAdvance(awaitingApproval(CAD), card(CAD), MANAGER);
  assert.deepStrictEqual(bareMoves, [PRINT_CAD]);
});

test("a card whose job type cannot be read still advances rather than stalling", async () => {
  // The field is missing from the card: an unlabelled job keeps the full
  // legacy route, so from CAD it goes on to Print CAD.
  win.WFRest.getCardFieldsDisplay = () =>
    Promise.resolve([{ name: "Style", display: "RG-4 picket" }]);
  const moves = captureMoves(win);
  await win.WFPhase.approveAndAdvance(awaitingApproval(CAD), card(CAD), MANAGER);
  assert.deepStrictEqual(moves, [PRINT_CAD]);

  // And the same when the lookup itself fails -- a dead REST call must not
  // leave the job parked.
  win.WFRest.getCardFieldsDisplay = () => Promise.reject(new Error("no network"));
  const afterFailure = captureMoves(win);
  await win.WFPhase.approveAndAdvance(awaitingApproval(CAD), card(CAD), MANAGER);
  assert.deepStrictEqual(afterFailure, [PRINT_CAD]);
});

test("the job type is read from a source that can actually carry it", async () => {
  /* THE REGRESSION THIS EXISTS FOR.
   *
   * For a long time advance.js asked getNamedCustomFieldValues for "Job Type".
   * That function returns exactly three keys -- jobValue, jobCost,
   * leadReceivedAt -- and never a job type, so the lookup always missed, every
   * card read as untyped, and every card took the default legacy route. CNC and
   * CAP work routed down the wrong path on a live board for weeks, and nothing
   * anywhere reported a problem, because falling back to a valid route looks
   * exactly like working.
   *
   * So this asserts the SHAPE of the dependency, not just an outcome: whatever
   * advance.js reads must be capable of returning a field called "Job Type".
   */
  const shaped = win.WFRest.getNamedCustomFieldValues
    ? await win.WFRest.getNamedCustomFieldValues({}, "B", "c1").catch(() => ({}))
    : {};
  assert.ok(!("Job Type" in shaped),
    "getNamedCustomFieldValues still cannot carry a job type — reading it from there is the bug");

  // And prove the type genuinely changes the destination: if routing were still
  // hard-stuck on legacy, these two would land in the same place.
  jobTypeReads("CNC only");
  const cnc = captureMoves(win);
  await win.WFPhase.approveAndAdvance(awaitingApproval(CAD), card(CAD), MANAGER);

  jobTypeReads("Legacy railing");
  const legacy = captureMoves(win);
  await win.WFPhase.approveAndAdvance(awaitingApproval(CAD), card(CAD), MANAGER);

  assert.notDeepStrictEqual(cnc, legacy,
    "two different job types must not route to the same next phase");
});

test("a card in a list the board config does not map falls through to the original approve", async () => {
  // Unmapped list -> no opinion about routing -> the untouched approveAndAdvance
  // runs, and here it refuses because the phase was never finished.
  //
  // The message changed with the approvals teardown: the gate used to read
  // `pendingApproval` and say "Nothing awaiting approval", which described a
  // manager step that no longer exists. It now asks WFPhase.isFinished.
  jobTypeReads("CNC only");
  captureMoves(win);
  await assert.rejects(
    () => win.WFPhase.approveAndAdvance(fakeT(), card("not-a-list-on-this-board"), MANAGER),
    /has not been finished/
  );
});

/* THE OLD VERSION OF THIS TEST ASSERTED THE BUG, NOT THE RULE.
 *
 * It read "a CAP job at the end of its route is not pushed anywhere" and put
 * the card in INSTALL -- i.e. it asserted that Install was the end of the CAP
 * route and that a finished install therefore moved nowhere. That terminus is
 * the defect: `advance` logged the hours, removed phaseWork, commented "No next
 * stage configured -- card left in place", and left the card in an Install
 * column where, with no phase work on it, WFTables.stationState read it as
 * fresh unclaimed work and handed it back to every truck's queue.
 *
 * The rule the test was reaching for is real and is kept: the END of a route
 * moves nothing. The end is now Billing, which is where config.js has always
 * said Install leads (order 12, straight after Install's 11).
 */
test("a CAP job at the end of its route is not pushed anywhere", async () => {
  jobTypeReads("CAP railing only");

  // Billing is the last phase on the CAP route. "Nothing left to do" has to mean
  // the card stays put, not that it falls back to the next column -- which here
  // would be Outstanding Invoices, work the office picks up by hand.
  const target = await win.WFPhase.__targetStage(fakeT(), card(BILLING));
  assert.equal(target, null);

  const moves = captureMoves(win);
  await win.WFPhase.approveAndAdvance(awaitingApproval(BILLING), card(BILLING), MANAGER);
  assert.deepStrictEqual(moves, []);
  assert.ok(!moves.includes(OUTSTANDING),
    "a card in Billing was auto-advanced into Outstanding Invoices");
});

/* ======================================== install reaches Billing, every route
 *
 * CHANGE THIS AT YOUR PERIL: this is a routing assertion about a live board, so
 * it is made against the real config.js (via productionBoard) and against the
 * actual WFRest.moveCard call, not against a non-null targetStage. A target
 * that resolves and a card that moves are different claims, and only the second
 * one is what the shop sees.
 */

const ROUTED = [
  { label: "Legacy fabrication", key: "legacy" },
  { label: "CNC only", key: "cnc_only" },
  { label: "CAP railing only", key: "cap_only" },
  { label: "Other custom fabrication", key: "custom" }
];

test("a card completed in ANY Install list moves to Billing, on ANY job-type route", async () => {
  // Four Trello columns consolidated into one phase by config.js, so all four
  // have to route. The old table ended at Install and none of them did.
  assert.equal(INSTALL_LISTS.length, 4, "config.js no longer has four Install lists");

  for (const list of INSTALL_LISTS) {
    for (const type of ROUTED) {
      jobTypeReads(type.label);

      const target = await win.WFPhase.__targetStage(fakeT(), card(list));
      assert.ok(target, type.key + " in " + list + ": no target stage at all");
      assert.strictEqual(target.listId, BILLING,
        type.key + " in " + list + " targets " + target.name + ", not Billing");

      const moves = captureMoves(win);
      await win.WFPhase.advance(awaitingApproval(list), card(list), MANAGER,
        { verb: "Installed" });
      assert.deepStrictEqual(moves, [BILLING],
        type.key + " in " + list + " did not actually move the card to Billing");
    }
  }
});

/* ================================ and it does not come back into a truck's queue
 *
 * The move is the cause; this is the symptom the move exists to kill. A
 * finished install used to keep sitting in an Install list with its phaseWork
 * removed, and lib/tables.js's stationState has no idea a job is finished once
 * the work record is gone -- a card in the station's phase with no claim lands
 * in the `loose` bucket, which is the queue. So a completed job reappeared as
 * unclaimed work on EVERY truck, because all four Install lists are one phase.
 */
test("a finished install does not reappear in any truck's queue", async () => {
  const T = win.WFTables;
  const truck = { id: "i1", area: "install", table: "Truck 1", type: "install",
                  station: "Install crew", welder: "scottv", phase: "Install" };
  const other = Object.assign({}, truck, { id: "i2", table: "Truck 2", welder: "mikel" });

  /** The card as it is the instant after advance(): phaseWork removed. */
  const finished = (listId) => ({
    id: "c1", name: "1795 Robert Pearce", idList: listId, idBoard: BOARD,
    pos: 100, due: null, labelNames: [], phaseWork: null
  });

  // THE BUG, reproduced: left in an Install list it is queued work again, on
  // both trucks at once. If this ever stops being true the test below is
  // proving nothing.
  // plain(): the station state is built inside the vm realm, so its arrays have
  // a different Array.prototype from one written here -- see harness.plain().
  for (const list of INSTALL_LISTS) {
    const stranded = finished(list);
    for (const station of [truck, other]) {
      assert.deepStrictEqual(
        plain(T.stationState(BOARD_CFG, [stranded], station).queue.map((c) => c.id)),
        ["c1"],
        "fixture check: a finished card left in " + list + " should look queued");
    }
  }

  // THE FIX: it is in Billing, which is not a work phase and is not any
  // station's phase, so no truck can see it at all.
  const moved = finished(BILLING);
  for (const station of [truck, other]) {
    const st = T.stationState(BOARD_CFG, [moved], station);
    assert.deepStrictEqual(plain(st.queue), [], station.table + " still queues a billed job");
    assert.equal(st.job, null, station.table + " still has a billed job on the bench");
  }
  assert.equal(T.phaseOf(BOARD_CFG, moved), "Billing");
});

/* ============================== Billing is where the office picks it up by hand
 *
 * Billing carries no isWorkPhase in config.js, so nothing claims it, nothing
 * times it and no station pulls it. The one thing that could still move it is
 * an auto-advance, and it must not: Outstanding Invoices (order 13) is the
 * office's own column and a shop tablet has no business sending a job there.
 */
test("nothing auto-advances a card out of Billing", async () => {
  const T = win.WFTables;
  const billing = (BOARD_CFG.stages || []).filter((s) => s.listId === BILLING)[0];
  assert.ok(!billing.isWorkPhase, "Billing became a work phase");
  assert.ok(T.phaseOptions(BOARD_CFG).indexOf("Billing") === -1,
    "Billing is offered as a station's queue, so the shop would pull invoicing");

  for (const type of ROUTED) {
    jobTypeReads(type.label);
    assert.equal(await win.WFPhase.__targetStage(fakeT(), card(BILLING)), null,
      type.key + " has somewhere to go from Billing");

    const moves = captureMoves(win);
    await win.WFPhase.advance(awaitingApproval(BILLING), card(BILLING), MANAGER,
      { verb: "Billed" });
    assert.deepStrictEqual(moves, [],
      type.key + " moved a card out of Billing to " + moves[0]);
  }
});

/* ================================================= the pin is always undone */

test("the temporary pin on getNextStage is handed back, including when the move fails", async () => {
  // The wrapper swaps out a shared function for the duration of one approve.
  // Leaving it swapped would mis-route every other card on the board.
  jobTypeReads("CNC only");

  captureMoves(win);
  await win.WFPhase.approveAndAdvance(awaitingApproval(CAD), card(CAD), MANAGER);
  assert.equal(win.WFStage.getNextStage, ORIGINAL_NEXT_STAGE, "restored after a success");

  captureMoves(win, { fail: true });
  await assert.rejects(
    () => win.WFPhase.approveAndAdvance(awaitingApproval(CAD), card(CAD), MANAGER),
    /move failed/
  );
  assert.equal(win.WFStage.getNextStage, ORIGINAL_NEXT_STAGE, "and after a failure");
});
