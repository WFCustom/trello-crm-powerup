/**
 * Live board reconciliation -- does config.js still match Trello?
 *
 * Every other test in this folder is offline and checks config.js against
 * itself. This one checks it against reality, which is where the real drift
 * happens: someone renames or deletes a column on the board and the Power-Up
 * keeps pointing at an id that no longer resolves. Nothing errors. Cards just
 * quietly stop being counted.
 *
 * Opt-in, because it needs credentials and the network:
 *
 *   TRELLO_KEY=<app key> TRELLO_TOKEN=<token> npm run test:live
 *
 * The app key is the public one already in config.js. The token is personal --
 * generate one at https://trello.com/power-ups/admin and keep it out of the
 * repo. Without both set, every test here is skipped rather than failed, so a
 * plain `npm test` stays offline and deterministic.
 *
 * Read-only: it lists lists. It never writes to a board.
 */
"use strict";

const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./harness.js");

const KEY = process.env.TRELLO_KEY || (h.load(["config.js"]).WF_CONFIG || {}).appKey;
const TOKEN = process.env.TRELLO_TOKEN;
const SKIP = TOKEN ? false : "set TRELLO_TOKEN to run the live board checks";

const win = h.load(["config.js"]);
const CFG = win.WF_CONFIG;

/**
 * Lists that exist on the board but are deliberately left out of config.js
 * altogether, rather than added to excludedLists.
 *
 * Prefer excludedLists in config.js -- that is the documented place to say "on
 * the board, not part of the flow", and it records the reason next to the id.
 * This escape hatch exists only so a brand new column cannot fail the build
 * before anyone has decided what it is. Anything left sitting here is a
 * decision nobody has made yet, so keep it empty.
 */
const KNOWN_UNMAPPED = new Set([]);

const liveLists = {};   // boardId -> Map(listId -> name)

before(async () => {
  if (SKIP) return;
  for (const boardId of Object.keys(CFG.boards)) {
    const url = "https://api.trello.com/1/boards/" + boardId +
      "/lists?fields=id,name&filter=open&key=" + KEY + "&token=" + TOKEN;
    const res = await fetch(url);
    assert.ok(res.ok, "Trello returned " + res.status + " for board " + boardId +
      " -- check TRELLO_KEY/TRELLO_TOKEN and that the token can see this board");
    const lists = await res.json();
    liveLists[boardId] = new Map(lists.map((l) => [l.id, l.name]));
  }
});

describe("config.js against the live boards", { skip: SKIP }, () => {
  test("every board in config.js still exists and has lists", () => {
    for (const boardId of Object.keys(CFG.boards)) {
      const live = liveLists[boardId];
      assert.ok(live && live.size > 0,
        CFG.boards[boardId].name + " (" + boardId + ") returned no lists");
    }
  });

  test("every mapped stage points at a list that still exists", () => {
    const missing = [];
    for (const [boardId, b] of Object.entries(CFG.boards)) {
      for (const s of b.stages || []) {
        if (!liveLists[boardId].has(s.listId)) {
          missing.push(b.name + ": \"" + s.name + "\" -> " + s.listId);
        }
      }
    }
    assert.deepEqual(missing, [],
      "these stages point at lists that are gone from Trello, so cards can never " +
      "be routed to them:\n  " + missing.join("\n  "));
  });

  test("every live list is either mapped or deliberately excluded", () => {
    const orphans = [];
    for (const [boardId, b] of Object.entries(CFG.boards)) {
      const mapped = new Set((b.stages || []).map((s) => s.listId));
      const excluded = new Set(b.excludedLists || []);
      for (const [id, name] of liveLists[boardId]) {
        if (mapped.has(id) || excluded.has(id) || KNOWN_UNMAPPED.has(id)) continue;
        orphans.push(b.name + ": \"" + name + "\" (" + id + ")");
      }
    }
    assert.deepEqual(orphans, [],
      "these lists exist on the board but the Power-Up ignores them -- cards in " +
      "them accrue no stage timing and appear nowhere. Add each to excludedLists " +
      "if that is intended, or map it as a stage:\n  " + orphans.join("\n  "));
  });

  test("excludedLists has no entries for lists that are gone", () => {
    const dead = [];
    for (const [boardId, b] of Object.entries(CFG.boards)) {
      for (const id of b.excludedLists || []) {
        if (!liveLists[boardId].has(id)) dead.push(b.name + ": " + id);
      }
    }
    // Harmless at runtime -- excluding a list that does not exist does nothing
    // -- but it is dead config that makes the next person doubt the rest.
    assert.deepEqual(dead, [], "dead excludedLists entries:\n  " + dead.join("\n  "));
  });

  test("the four Install lists are all still there and all still one phase", () => {
    const { id: boardId, cfg: board } = h.productionBoard(win);
    const installs = board.stages.filter((s) => s.phase === "Install");
    assert.equal(installs.length, 4);
    for (const s of installs) {
      assert.ok(liveLists[boardId].has(s.listId),
        "Install column " + s.region + " (" + s.listId + ") is gone from the board");
    }
  });

  test("every phase named in a job type route resolves to a live list", () => {
    const full = h.load();
    const { id: boardId, cfg: board } = h.productionBoard(full);
    for (const t of full.WFJobType.all().filter((x) => !x.splitsInto)) {
      for (const phase of t.route) {
        const stage = full.WFStage.getStageByName(boardId, phase);
        assert.ok(stage, t.key + " routes through \"" + phase + "\", which config.js does not map");
        assert.ok(liveLists[boardId].has(stage.listId),
          t.key + " routes through \"" + phase + "\" -> " + stage.listId + ", which is gone from Trello");
      }
      assert.ok(board);
    }
  });
});
