/**
 * WFSandbox -- run the whole Power-Up for real, against real data, without a
 * single change reaching the Trello board.
 *
 * WHY THIS AND NOT A TEST FIXTURE
 *
 * The flows worth rehearsing are the ones that move work: start a job, slide it
 * to 60%, fail a QC item, sign off, watch the card land in the next phase and
 * appear in the next station's queue. Every one of those is a chain of writes,
 * and a chain is exactly what a fixture can't prove -- you can unit-test each
 * link and still have the sequence come apart on a real board with real cards
 * in real lists. The only faithful rehearsal is the real code path over the
 * real data. So that is what this gives you: the real code path, with the last
 * inch to Trello cut.
 *
 * HOW IT WORKS
 *
 * Two chokepoints, and everything in this repo goes through one of them:
 *
 *   t.get / t.set / t.remove     Trello plugin storage. WFPhase, WFQC, WFTables
 *                                and every tab read and write through it.
 *   WFRest.moveCard, postComment, updateCard, setCheckItem, setCustomField,
 *   addMemberToCard              the REST calls that change a card.
 *
 * Wrapping both means WFPhase and WFQC need no sandbox awareness at all. They
 * carry on calling exactly what they always called; the wrapper decides where
 * it lands. Code that doesn't know it is being sandboxed is code that behaves
 * the same sandboxed as it does live, which is the entire point.
 *
 * READS MUST SEE THE WRITES
 *
 * A sandbox that swallowed writes and then served stale reads would be worse
 * than useless -- you would press Start, and the screen would say the job is
 * not started. So every intercepted write also lands in an in-memory overlay,
 * and every read checks the overlay before falling through to Trello. The
 * effect is a private copy-on-write layer over the board: you see your own
 * changes, nobody else sees anything.
 *
 * `decorate()` does the same job for the card list, which arrives over REST
 * rather than through t.get and so can't be intercepted the same way.
 *
 * NOTHING PERSISTS
 *
 * The overlay and the log are plain variables. No localStorage, no plugin key,
 * no cleanup step that could fail and leave a board half-pretending. Close the
 * window and the session is gone -- which is the behaviour that makes it safe
 * to hand to somebody and say "go and break it".
 */
(function (global) {
  "use strict";

  /** Deliberately module-level and in-memory. See the note above. */
  var on = false;
  var overlay = {};        // scope -> key -> { value } or { removed: true }
  var log = [];            // newest last
  var seq = 0;

  /** WFRest methods that change something. Read calls are left alone. */
  var REST_WRITES = [
    "moveCard", "postComment", "addMemberToCard",
    "updateCard", "setCheckItem", "setCustomField", "write"
  ];
  var restOriginals = null;

  function active() { return on; }

  /* ------------------------------------------------------------- the overlay */

  function slot(scope) {
    if (!overlay[scope]) overlay[scope] = {};
    return overlay[scope];
  }

  /** What the sandbox believes is stored, or undefined if it has no opinion. */
  function peek(scope, key) {
    var s = overlay[scope];
    if (!s) return undefined;
    var hit = s[key];
    if (!hit) return undefined;
    return hit.removed ? null : hit.value;
  }

  function has(scope, key) {
    return !!(overlay[scope] && overlay[scope][key]);
  }

  /* ----------------------------------------------------------------- the log */

  /**
   * Record one intercepted write in words a person can check.
   *
   * The summary is written for somebody reading the log afterwards to decide
   * whether the run was right -- "Moved #2418 to Sandblast / Powder Coat", not
   * "PUT /cards/abc123/idList". The raw detail is kept alongside for when the
   * plain sentence isn't enough.
   */
  function record(kind, summary, detail) {
    log.push({
      n: ++seq,
      at: new Date().toISOString(),
      kind: kind,
      summary: summary,
      detail: detail === undefined ? null : detail
    });
    return log[log.length - 1];
  }

  function entries() { return log.slice(); }
  function count() { return log.length; }

  /* ------------------------------------------------------------ wrapping `t` */

  /**
   * A stand-in for Trello's `t` that reads through and writes nowhere.
   *
   * Every other method is forwarded untouched, so anything the SDK offers that
   * isn't storage -- member(), board(), modal(), alert() -- keeps working. A
   * sandbox that quietly broke t.member() would send people hunting for a bug
   * that isn't there.
   */
  function wrap(realT) {
    if (!realT) return realT;
    if (realT.__wfSandbox) return realT;

    var shim = Object.create(realT);
    shim.__wfSandbox = true;
    shim.__real = realT;

    shim.get = function (scope, vis, key, dflt) {
      if (on && has(scope, key)) {
        var v = peek(scope, key);
        return Promise.resolve(v === null || v === undefined ? dflt : v);
      }
      return realT.get(scope, vis, key, dflt);
    };

    shim.set = function (scope, vis, key, value) {
      if (!on) return realT.set(scope, vis, key, value);
      slot(scope)[key] = { value: value };
      record("data", describeSet(scope, key, value), { scope: scope, key: key, value: value });
      return Promise.resolve();
    };

    shim.remove = function (scope, vis, key) {
      if (!on) return realT.remove(scope, vis, key);
      slot(scope)[key] = { removed: true };
      record("data", "Cleared " + key + " on " + shortId(scope),
        { scope: scope, key: key, removed: true });
      return Promise.resolve();
    };

    return shim;
  }

  function shortId(scope) {
    if (scope === "board") return "the board";
    if (scope === "member") return "your profile";
    if (scope === "organization") return "the workspace";
    return "card " + String(scope).slice(-6);
  }

  /**
   * Turn a storage write into a sentence.
   *
   * These three keys carry essentially all the meaning on this board, so they
   * get read properly rather than dumped as JSON.
   */
  function describeSet(scope, key, value) {
    if (key === "phaseWork") {
      if (!value) return "Cleared the phase work on " + shortId(scope);
      if (value.completedAt) return "Marked the phase complete on " + shortId(scope);
      var who = value.claimedBy && value.claimedBy.fullName;
      var running = value.segments && value.segments.length &&
        !value.segments[value.segments.length - 1].end;
      var bits = [];
      if (who) bits.push(who);
      bits.push(running ? "running" : "stopped");
      if (typeof value.percentComplete === "number") bits.push(value.percentComplete + "%");
      if (value.tableId) bits.push("at " + value.tableId);
      return "Phase work on " + shortId(scope) + " — " + bits.join(", ");
    }
    if (key === "qcRecord") {
      if (!value) return "Cleared the QC record on " + shortId(scope);
      if (value.status === "passed") {
        return "QC signed off on " + shortId(scope) +
          (value.signedBy && value.signedBy.fullName ? " by " + value.signedBy.fullName : "");
      }
      return "QC record on " + shortId(scope) + " — " + (value.status || "updated");
    }
    if (key === "phaseLog") {
      return "Logged a finished phase on " + shortId(scope);
    }
    if (key === "wfStations") return "Saved the station setup";
    if (key === "wfQcChecklists") return "Saved a QC checklist";
    return "Saved " + key + " on " + shortId(scope);
  }

  /* ------------------------------------------------------- wrapping WFRest */

  /**
   * Swap the REST write methods for recorders while the sandbox is on.
   *
   * Patching the shared object rather than handing callers a different one is
   * deliberate: WFPhase reaches for `global.WFRest` directly, and there is no
   * seam to pass a substitute through. Originals are kept and put back on the
   * way out, so turning the sandbox off genuinely restores the real thing.
   */
  function installRest() {
    var R = global.WFRest;
    if (!R || restOriginals) return;
    restOriginals = {};
    REST_WRITES.forEach(function (name) {
      if (typeof R[name] !== "function") return;
      restOriginals[name] = R[name];
      R[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        record("trello", describeRest(name, args), { call: name, args: redact(args) });
        return Promise.resolve(restFake(name, args));
      };
    });
  }

  function removeRest() {
    var R = global.WFRest;
    if (!R || !restOriginals) return;
    Object.keys(restOriginals).forEach(function (name) { R[name] = restOriginals[name]; });
    restOriginals = null;
  }

  /**
   * What an intercepted REST write hands back.
   *
   * A card move is the one that matters: the caller often reads idList off the
   * result, and returning nothing would make the next step look like a failure
   * rather than a success that went nowhere.
   */
  function restFake(name, args) {
    if (name === "moveCard") return { id: args[1], idList: args[2] };
    if (name === "updateCard") return Object.assign({ id: args[1] }, args[2] || {});
    return { ok: true, sandboxed: true };
  }

  function describeRest(name, args) {
    switch (name) {
      case "moveCard":
        return "Would move card " + String(args[1]).slice(-6) + " to another list";
      case "postComment":
        return "Would post a comment: " + String(args[2] || "").slice(0, 90);
      case "addMemberToCard":
        return "Would add a member to card " + String(args[1]).slice(-6);
      case "updateCard":
        return "Would change " + Object.keys(args[2] || {}).join(", ") +
               " on card " + String(args[1]).slice(-6);
      case "setCheckItem":
        return "Would tick a checklist item on card " + String(args[1]).slice(-6);
      case "setCustomField":
        return "Would set a custom field on card " + String(args[1]).slice(-6);
      default:
        return "Would call Trello: " + name;
    }
  }

  /** `t` is the first argument everywhere and is full of SDK internals. */
  function redact(args) {
    return args.slice(1).map(function (a) {
      if (a && typeof a === "object") {
        try { return JSON.parse(JSON.stringify(a)); } catch (e) { return "[object]"; }
      }
      return a;
    });
  }

  /* ---------------------------------------------------- the card list overlay */

  /**
   * Apply the overlay to cards fetched over REST.
   *
   * getBoardCardsFull merges plugin data server-side, so those cards arrive
   * with whatever Trello has -- not with what this session has done. Without
   * this, starting a job would log correctly and then vanish on the next
   * repaint, which is precisely the kind of half-working that makes people
   * distrust a test mode.
   *
   * Returns new objects; the caller's array is never mutated, because the same
   * cards are cached and shared across tabs.
   */
  function decorate(cards) {
    if (!on || !cards) return cards;
    return cards.map(function (card) {
      var s = overlay[card.id];
      // A sandboxed move has to show up as the card actually being in the new
      // list, or the next station's queue can't pick it up -- and a move is a
      // REST call, so it leaves nothing in the storage overlay to find it by.
      var moved = movedTo(card.id);
      if (!s && !moved) return card;

      var out = Object.assign({}, card);
      Object.keys(s || {}).forEach(function (key) {
        out[key] = s[key].removed ? null : s[key].value;
      });
      if (moved) out.idList = moved;
      return out;
    });
  }

  /** The last list a card was moved to during this session, if any. */
  function movedTo(cardId) {
    var dest = null;
    log.forEach(function (e) {
      if (e.kind !== "trello" || !e.detail || e.detail.call !== "moveCard") return;
      if (e.detail.args[0] !== cardId) return;
      dest = e.detail.args[1];
    });
    return dest;
  }

  /* ------------------------------------------------------------- on and off */

  function enable() {
    if (on) return;
    on = true;
    installRest();
    record("session", "Sandbox on — nothing from here reaches Trello.");
  }

  /**
   * Leave the sandbox, throwing the session away.
   *
   * Clearing the overlay is what makes the exit honest: the next read goes to
   * Trello and gets the truth, so the screen snaps back to what the board
   * actually says. Anything that looked different was never real.
   */
  function disable() {
    if (!on) return;
    removeRest();
    on = false;
    overlay = {};
    log = [];
    seq = 0;
  }

  /** Throw away the changes but stay in the sandbox -- "start the run again". */
  function reset() {
    overlay = {};
    log = [];
    seq = 0;
    if (on) record("session", "Sandbox reset — back to what the board really says.");
  }

  global.WFSandbox = {
    active: active,
    enable: enable,
    disable: disable,
    reset: reset,
    wrap: wrap,
    decorate: decorate,
    entries: entries,
    count: count,
    movedTo: movedTo,
    // exposed for tests
    describeSet: describeSet,
    describeRest: describeRest,
    peek: peek
  };
})(window);
