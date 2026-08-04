/**
 * WFPricing -- job value read from the board's "$Value" custom field.
 *
 * That field is free text and the real board uses it loosely, so this module
 * owns exactly two jobs: turning a messy string into one number, and fetching
 * the whole board's worth of them in a single REST call.
 *
 * Observed formats on Office Operations (401 cards, 106 filled):
 *   "$4500"                              -> 4500
 *   "13420"                              -> 13420
 *   "$5,500"                             -> 5500
 *   "2692.00"                            -> 2692
 *   "$3500-$4000"                        -> 3500
 *   "$3,313 - $3,615"                    -> 3313
 *   "$18,000-$20,000"                    -> 18000
 *   "$20,000+"                           -> 20000
 *   "2100 ish ask craig"                 -> 2100
 *   "$2000 ish"                          -> 2000
 *   "$1,900 railing only -$2,300 w/gate" -> 1900
 *
 * A range means the customer hasn't picked a style yet, so we book the low end
 * -- the conservative figure. Same reason "+" resolves to its floor.
 */
(function (global) {
  "use strict";

  var CACHE_TTL_MS = 2 * 60 * 1000;   // matches lib/trello-rest.js
  var MIN_BARE_NUMBER = 100;          // guards against "2 gates" style counts
  var cache = {};

  function numbersMatching(s, re) {
    var out = [], m;
    while ((m = re.exec(s)) !== null) {
      var n = Number(String(m[1]).replace(/,/g, ""));
      if (isFinite(n) && n > 0) out.push(n);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out;
  }

  /** Free-text money field -> single number, or null if there's nothing usable. */
  function parseMoney(raw) {
    if (raw == null) return null;
    if (typeof raw === "number") return isFinite(raw) && raw > 0 ? raw : null;
    var s = String(raw).trim();
    if (!s) return null;

    // Prefer explicitly-money figures. Only fall back to bare numbers when the
    // field has no "$" at all, and then ignore small ones so an incidental
    // count can never be mistaken for the price.
    var dollar = numbersMatching(s, /\$\s*([\d,]+(?:\.\d+)?)/g);
    var pool = dollar;
    if (!pool.length) {
      pool = numbersMatching(s, /(?:^|[^\d.,$])([\d,]+(?:\.\d+)?)/g)
        .filter(function (n) { return n >= MIN_BARE_NUMBER; });
    }
    if (!pool.length) return null;
    return Math.min.apply(null, pool);
  }

  function fieldName() {
    var cfg = global.WF_CONFIG && global.WF_CONFIG.customFieldNames;
    return (cfg && cfg.jobValue) || "$Value";
  }

  /**
   * One pass over the board -> { cardId: number }.
   * Cached for the same 2 minutes as the rest of the REST layer.
   */
  function getBoardValues(t, boardId, opts) {
    var filter = (opts && opts.filter) || "open";
    var key = boardId + ":" + filter;
    var hit = cache[key];
    if (hit && (Date.now() - hit.at) < CACHE_TTL_MS) return hit.p;

    var wanted = fieldName();
    var p = Promise.all([
      WFRest.getBoardCustomFields(t, boardId),
      WFRest.request(t, "/boards/" + boardId + "/cards", {
        fields: "id",
        customFieldItems: "true",
        filter: filter,
        limit: "1000"
      })
    ]).then(function (r) {
      var fields = r[0] || [];
      var cards = r[1] || [];
      var out = {};
      var field = fields.filter(function (f) { return f.name === wanted; })[0];
      if (!field) return out;   // field renamed or missing -> quietly no pricing
      cards.forEach(function (c) {
        (c.customFieldItems || []).forEach(function (item) {
          if (item.idCustomField !== field.id) return;
          var v = item.value || {};
          var n = parseMoney(v.text != null ? v.text : v.number);
          if (n != null) out[c.id] = n;
        });
      });
      return out;
    });

    cache[key] = { at: Date.now(), p: p };
    p.catch(function () { delete cache[key]; });   // don't cache a failure
    return p;
  }

  function invalidate(boardId) {
    Object.keys(cache).forEach(function (k) {
      if (!boardId || k.indexOf(boardId + ":") === 0) delete cache[k];
    });
  }

  global.WFPricing = {
    parseMoney: parseMoney,
    getBoardValues: getBoardValues,
    invalidate: invalidate,
    fieldName: fieldName
  };
})(window);
