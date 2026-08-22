/**
 * Loads the Power-Up's browser files under Node so they can be unit-tested.
 *
 * Every file in this project is written for a browser: config.js assigns
 * `window.WF_CONFIG`, and each lib module is an IIFE ending `})(window)` that
 * hangs its exports off that same object. Rather than restructure working
 * production code to suit a test runner, the harness supplies a `window`.
 *
 * Each file is evaluated in a fresh V8 context whose global object doubles as
 * `window`, so `window.WFStage = ...` and a bare `WFStage` reference are the
 * same thing -- which is precisely how they behave when the browser loads them
 * as separate <script> tags.
 *
 * Load order matters and is not inferred: lib/stage.js captures WF_CONFIG in a
 * const at load time, so config.js must come first. LOAD_ORDER mirrors the
 * <script> order in popups/ops.html; keep the two in step.
 */
"use strict";

const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

/** The script order popups/ops.html uses, minus the CDN and Trello SDK tags. */
const LOAD_ORDER = [
  "config.js",
  "lib/board-extras.js",
  "lib/stage.js",
  "lib/trello-rest.js",
  "lib/phase.js",
  "lib/metrics.js",
  "lib/roster.js",
  "lib/pricing.js",
  "lib/costing.js",
  "lib/qc.js",
  "lib/jobtype.js",
  "lib/advance.js",
  "lib/sop.js",
  "popups/ops.js"
];

/**
 * Evaluate the given files (defaults to the full ops.html set) and return the
 * shared window object.
 */
function load(files = LOAD_ORDER) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;

  // Enough of a DOM that module top-level code doesn't throw on load. None of
  // the assertions here touch the DOM -- the tests exercise pure functions --
  // so these are deliberately inert rather than a real implementation.
  sandbox.document = {
    readyState: "complete",
    addEventListener() {},
    createElement: () => ({
      style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {}, setAttribute() {}, addEventListener() {}, children: []
    }),
    createDocumentFragment: () => ({ appendChild() {} }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  sandbox.location = { href: "https://wfcustom.github.io/trello-crm-powerup/popups/ops.html", search: "" };
  sandbox.localStorage = {
    _v: {},
    getItem(k) { return Object.hasOwn(this._v, k) ? this._v[k] : null; },
    setItem(k, v) { this._v[k] = String(v); },
    removeItem(k) { delete this._v[k]; }
  };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.fetch = () => Promise.reject(new Error("network disabled in tests"));

  const ctx = vm.createContext(sandbox);
  for (const rel of files) {
    const file = path.join(ROOT, rel);
    const code = fs.readFileSync(file, "utf8");
    try {
      vm.runInContext(code, ctx, { filename: rel });
    } catch (err) {
      throw new Error(`failed loading ${rel}: ${err.message}`);
    }
  }
  return sandbox;
}

/** Board ids, read back out of the config so tests never hard-code them. */
function boardIds(win) {
  return Object.keys(win.WF_CONFIG.boards);
}

/** The single production board's config, by type rather than by id. */
function productionBoard(win) {
  const boards = win.WF_CONFIG.boards;
  const id = Object.keys(boards).find((b) => boards[b].type === "production");
  if (!id) throw new Error("no board of type 'production' in config.js");
  return { id, cfg: boards[id] };
}

function salesBoard(win) {
  const boards = win.WF_CONFIG.boards;
  const id = Object.keys(boards).find((b) => boards[b].type === "sales");
  if (!id) throw new Error("no board of type 'sales' in config.js");
  return { id, cfg: boards[id] };
}

/** Every stage across every board, tagged with the board it came from. */
function allStages(win) {
  const out = [];
  for (const [boardId, b] of Object.entries(win.WF_CONFIG.boards)) {
    for (const s of b.stages || []) out.push({ ...s, boardId, boardName: b.name });
  }
  return out;
}

/** Read the raw text of a repo file, for tests that assert on source. */
function source(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Re-create a value using this realm's intrinsics.
 *
 * A vm context is a separate JavaScript realm with its own Array, Object and
 * Date, so an array built inside the Power-Up has a different Array.prototype
 * from one built here in a test file -- and assert.deepStrictEqual compares
 * prototypes. It reports two identical-looking arrays as unequal and prints a
 * diff showing no differences at all, which costs a thoroughly confusing hour.
 * Pass either side of a deep comparison through plain() to sidestep it.
 */
function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

module.exports = {
  load, LOAD_ORDER, ROOT,
  boardIds, productionBoard, salesBoard, allStages,
  source, plain
};
