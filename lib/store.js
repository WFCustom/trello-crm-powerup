/**
 * WFStore -- every write to Trello plugin data goes through here.
 *
 * WHAT THE LIMIT ACTUALLY IS, BECAUSE WE GOT THIS WRONG TWICE
 *
 * Trello's docs are explicit: "The size limit on the resulting stringified
 * object is 4096 characters PER SCOPE/VISIBILITY PAIR."
 *
 *   https://developer.atlassian.com/cloud/trello/power-ups/client-library/
 *     getting-and-setting-data/
 *
 * Per pair, not per key. Every key at board/shared shares one 4096-character
 * budget; every key on one card at card/shared shares another. Under the hood
 * it is a single JSON blob and t.set writes a key inside it.
 *
 * Both earlier size checks in this codebase measured ONE key and passed at
 * 3,800 while the scope around them sat well over the ceiling. lib/eos.js goes
 * further and splits the EOS records across five keys with a comment saying the
 * split exists to dodge the cap -- it buys nothing at all. That is the specific
 * mistake this file exists to make impossible: the only measurement that means
 * anything is of the whole scope, with the pending change applied.
 *
 * WHAT GOES IN PLUGIN DATA AT ALL
 *
 * 4096 characters is about one page of text. It is sized for annotation --
 * pointers and small live state -- and Trello returns it inline whenever the
 * board loads, which is why it is small and why it will stay small.
 *
 * So: live working state belongs here (what is on the bench right now, station
 * setup, the roster, who may do what). Records of what happened do not. A
 * finished phase, a signed check, a fault: those are history, they only ever
 * grow, and they go to durable storage. Anything that grows without bound and
 * lives here is a countdown.
 *
 * TWO MORE THINGS FROM THE SAME PAGE, NEITHER ABOUT SIZE
 *
 *   "Board and workspace admins that disable Power-Ups from their board(s) may
 *    choose to clear the board-level storage for that Power-Up as a part of the
 *    disable action. This action clears all board-scoped and card-scoped
 *    Power-Up data that has a visibility of shared."
 *
 * One admin action can erase everything stored here. That is the strongest
 * argument against keeping records in plugin data, stronger than the size cap:
 * a cap warns you, this does not.
 *
 *   "Shared storage operations are not atomic. If two set operations happen at
 *    the same time on two different keys they can override one another."
 *
 * Four stations writing to the board scope will collide eventually. Trello's
 * own advice is to pass several keys in ONE set call rather than several calls,
 * which is what setMany below is for.
 */
(function (global) {
  "use strict";

  /** Trello's hard ceiling. Exceeding it rejects with a named error. */
  var LIMIT = 4096;

  /**
   * Where we refuse, short of the ceiling.
   *
   * The gap is not superstition. A refusal has to leave room for the write that
   * CLEARS space -- removing a row, archiving a month -- and for a read-modify
   * -write that arrives a moment later from another screen. Refusing at exactly
   * 4096 would occasionally leave a scope that cannot be written to at all,
   * including by the thing trying to empty it.
   */
  var MARGIN = 3800;

  /** Above this, the UI says something before the user is blocked. */
  var WARN_AT = 0.7;

  function str(v) {
    try { return JSON.stringify(v === undefined ? null : v); }
    catch (e) { return ""; }
  }

  /**
   * Everything currently stored at a scope/visibility, as a plain object.
   *
   * t.get with no key returns the whole blob -- documented, and the only way to
   * measure what actually counts against the limit.
   */
  function readAll(t, scope, visibility) {
    return Promise.resolve()
      .then(function () { return t.get(scope, visibility || "shared"); })
      .then(function (all) {
        return (all && typeof all === "object") ? all : {};
      })
      .catch(function () { return {}; });
  }

  /**
   * How full a scope is, and which keys are responsible.
   *
   * `byKey` is the part that matters when somebody has to act on this: "the
   * scope is 94% full" is an alarm, "qcRecord is 3,100 of it" is an
   * instruction. Sorted biggest first for the same reason.
   */
  function usage(t, scope, visibility) {
    return readAll(t, scope, visibility).then(function (all) {
      return measure(all);
    });
  }

  function measure(all) {
    var total = str(all).length;
    var byKey = Object.keys(all || {}).map(function (k) {
      // The key name and its punctuation count too -- "qcRecord":<value>,
      return { key: k, chars: str(all[k]).length + k.length + 4 };
    }).sort(function (a, b) { return b.chars - a.chars; });

    return {
      chars: total,
      limit: LIMIT,
      margin: MARGIN,
      pct: Math.min(100, Math.round((total / MARGIN) * 100)),
      free: Math.max(0, MARGIN - total),
      warn: total >= MARGIN * WARN_AT,
      full: total > MARGIN,
      byKey: byKey
    };
  }

  /**
   * What a scope WOULD measure if this change landed.
   *
   * Measuring the value on its own is the mistake both earlier checks made. A
   * 500-character record is fine or fatal entirely depending on what else is
   * already in that scope, and the caller has no way to know which.
   */
  function projected(all, patch) {
    var next = {};
    Object.keys(all || {}).forEach(function (k) { next[k] = all[k]; });
    Object.keys(patch || {}).forEach(function (k) {
      if (patch[k] === undefined) delete next[k];
      else next[k] = patch[k];
    });
    return measure(next);
  }

  /**
   * A refusal somebody can act on.
   *
   * Names the scope, what is in it, and the single biggest thing in it -- so
   * the message says what to delete rather than that something is wrong. An
   * error that only reports a number gets screenshotted and sent to me.
   */
  function tooBigError(label, size) {
    var worst = size.byKey[0];
    var msg = "There isn't room to save " + (label || "this") + ". " +
      "Trello allows " + LIMIT + " characters here and this would need " +
      size.chars + ".";
    if (worst) {
      msg += " The largest thing stored is " + worst.key + " at " +
        worst.chars + " characters.";
    }
    msg += " Nothing was changed.";
    var e = new Error(msg);
    e.code = "WF_STORE_FULL";
    e.size = size;
    return e;
  }

  /**
   * Write one key, having checked the whole scope first.
   *
   * `label` is what the user calls this thing -- "the station setup", "this
   * checklist" -- and goes straight into the refusal. Callers that pass nothing
   * get a vaguer message, which is worse, so pass one.
   */
  function set(t, scope, key, value, opts) {
    // A missing key would write a literal "undefined" key into the scope and
    // quietly consume budget forever. Refuse rather than store nonsense.
    if (!key || typeof key !== "string") {
      return Promise.reject(new Error("WFStore.set needs a key name."));
    }
    var patch = {};
    patch[key] = value;
    return setMany(t, scope, patch, opts);
  }

  /**
   * Write several keys in ONE call.
   *
   * Trello's docs again: "If a Power-Up needs to set multiple keys
   * concurrently, the safest thing to do is to pass an object containing the
   * multiple key/value pairs." Two separate set calls read-modify-write the
   * same blob and the second silently discards the first.
   */
  function setMany(t, scope, patch, opts) {
    opts = opts || {};
    var visibility = opts.visibility || "shared";
    return readAll(t, scope, visibility).then(function (all) {
      var size = projected(all, patch);
      if (size.full && !opts.force) throw tooBigError(opts.label, size);
      return Promise.resolve(t.set(scope, visibility, patch))
        .then(function () { return size; });
    });
  }

  /**
   * Remove keys, and report the room it freed.
   *
   * Never guarded: making space must always be possible, including when the
   * scope is already over. This is the escape hatch a full scope depends on.
   */
  function remove(t, scope, keys, opts) {
    opts = opts || {};
    var visibility = opts.visibility || "shared";
    var list = [].concat(keys);
    return Promise.resolve(t.remove(scope, visibility, list))
      .then(function () { return usage(t, scope, visibility); });
  }

  /**
   * Is there room for this, without writing anything?
   *
   * For a screen that wants to warn before somebody fills in a long form, or
   * to grey out an Add button honestly rather than accepting the input and
   * refusing it at the end.
   */
  function roomFor(t, scope, key, value, opts) {
    opts = opts || {};
    var patch = {};
    patch[key] = value;
    return readAll(t, scope, opts.visibility || "shared").then(function (all) {
      return projected(all, patch);
    });
  }

  /** Plain words for a gauge. Kept here so every screen says the same thing. */
  function describe(size) {
    if (!size) return "";
    if (size.full) return "Full — nothing more will save until something is removed.";
    if (size.warn) {
      return Math.round(size.pct) + "% full — " + size.free +
             " characters left. Worth archiving soon.";
    }
    return Math.round(size.pct) + "% full — " + size.free + " characters left.";
  }

  global.WFStore = {
    LIMIT: LIMIT,
    MARGIN: MARGIN,
    WARN_AT: WARN_AT,
    readAll: readAll,
    usage: usage,
    measure: measure,
    projected: projected,
    set: set,
    setMany: setMany,
    remove: remove,
    roomFor: roomFor,
    describe: describe
  };
})(window);
