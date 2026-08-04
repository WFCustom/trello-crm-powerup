/**
 * WFPricing -- job value read from the board's "$Value" custom field.
 *
 * House rule: a price is a number, or a range of two numbers. Nothing else.
 *   OK      1200        $4,500       2692.00
 *   OK      $3500-$4000     $3,313 - $3,615     1200 to 1500
 *   NOT OK  "$20,000+"      "2100 ish ask craig"
 *           "$3597 reduce price to $2200 ask Dale"
 *
 * A range means the customer hasn't picked a style yet, so the low end is what
 * gets booked -- the conservative figure.
 *
 * Trello has no currency field type (only text, number, date, checkbox, list),
 * so "$Value" is free text and the rule can't be enforced at entry. Instead
 * anything off-rule is still parsed best-effort -- so a stray note never blanks
 * out a dashboard -- but is flagged via getBoardAudit() for cleanup.
 */
(function (global) {
  "use strict";

  var CACHE_TTL_MS = 2 * 60 * 1000;   // matches lib/trello-rest.js
  var MIN_BARE_NUMBER = 100;          // guards against "2 gates" style counts
  var cache = {};

  var NUM = "\\$?\\s*\\d[\\d,]*(?:\\.\\d+)?";
  var RE_SINGLE = new RegExp("^" + NUM + "$");
  var RE_RANGE = new RegExp("^" + NUM + "\\s*(?:-|\u2013|\u2014|to)\\s*" + NUM + "$", "i");

  function numbersMatching(s, re) {
    var out = [], m;
    while ((m = re.exec(s)) !== null) {
      var n = Number(String(m[1]).replace(/,/g, ""));
      if (isFinite(n) && n > 0) out.push(n);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out;
  }

  /** Best-effort: free text -> single number, or null if nothing usable. */
  function parseMoney(raw) {
    if (raw == null) return null;
    if (typeof raw === "number") return isFinite(raw) && raw > 0 ? raw : null;
    var s = String(raw).trim();
    if (!s) return null;

    // Prefer explicitly-money figures. Only fall back to bare numbers when the
    // field has no "$" at all, and then ignore small ones so an incidental
    // count can never be mistaken for the price.
    var pool = numbersMatching(s, /\$\s*([\d,]+(?:\.\d+)?)/g);
    if (!pool.length) {
      pool = numbersMatching(s, /(?:^|[^\d.,$])([\d,]+(?:\.\d+)?)/g)
        .filter(function (n) { return n >= MIN_BARE_NUMBER; });
    }
    if (!pool.length) return null;
    return Math.min.apply(null, pool);
  }

  /**
   * Judge a raw field value against the house rule.
   * -> { state: "empty" | "ok" | "offRule", value, kind, raw }
   * `value` is populated even when off-rule, so display still works.
   */
  function classify(raw) {
    if (raw == null || String(raw).trim() === "") {
      return { state: "empty", value: null, raw: "" };
    }
    var s = String(raw).trim();
    if (RE_SINGLE.test(s)) return { state: "ok", kind: "single", value: parseMoney(s), raw: s };
    if (RE_RANGE.test(s)) return { state: "ok", kind: "range", value: parseMoney(s), raw: s };
    return { state: "offRule", kind: "text", value: parseMoney(s), raw: s };
  }

  function fieldName() {
    var cfg = global.WF_CONFIG && global.WF_CONFIG.customFieldNames;
    return (cfg && cfg.jobValue) || "$Value";
  }

  /**
   * One pass over the board, cached for the same 2 minutes as the REST layer.
   * -> { values: { cardId: number }, offRule: [ {id, name, url, raw, value} ] }
   */
  function fetchBoard(t, boardId, opts) {
    var filter = (opts && opts.filter) || "open";
    var key = boardId + ":" + filter;
    var hit = cache[key];
    if (hit && (Date.now() - hit.at) < CACHE_TTL_MS) return hit.p;

    var wanted = fieldName();
    var p = Promise.all([
      WFRest.getBoardCustomFields(t, boardId),
      WFRest.request(t, "/boards/" + boardId + "/cards", {
        fields: "id,name,shortUrl",
        customFieldItems: "true",
        filter: filter,
        limit: "1000"
      })
    ]).then(function (r) {
      var fields = r[0] || [];
      var cards = r[1] || [];
      var out = { values: {}, offRule: [] };
      var field = fields.filter(function (f) { return f.name === wanted; })[0];
      if (!field) return out;   // field renamed or missing -> quietly no pricing
      cards.forEach(function (c) {
        (c.customFieldItems || []).forEach(function (item) {
          if (item.idCustomField !== field.id) return;
          var v = item.value || {};
          var verdict = classify(v.text != null ? v.text : v.number);
          if (verdict.value != null) out.values[c.id] = verdict.value;
          if (verdict.state === "offRule") {
            out.offRule.push({
              id: c.id, name: c.name, url: c.shortUrl,
              raw: verdict.raw, value: verdict.value
            });
          }
        });
      });
      return out;
    });

    cache[key] = { at: Date.now(), p: p };
    p.catch(function () { delete cache[key]; });   // don't cache a failure
    return p;
  }

  function getBoardValues(t, boardId, opts) {
    return fetchBoard(t, boardId, opts).then(function (r) { return r.values; });
  }

  /** Cards whose $Value isn't a plain number or range, for cleanup. */
  function getBoardAudit(t, boardId, opts) {
    return fetchBoard(t, boardId, opts).then(function (r) { return r.offRule; });
  }

  function invalidate(boardId) {
    Object.keys(cache).forEach(function (k) {
      if (!boardId || k.indexOf(boardId + ":") === 0) delete cache[k];
    });
  }

  global.WFPricing = {
    parseMoney: parseMoney,
    classify: classify,
    getBoardValues: getBoardValues,
    getBoardAudit: getBoardAudit,
    invalidate: invalidate,
    fieldName: fieldName,
    RULE_TEXT: "A price must be a number (1200, $4,500) or a range ($3500-$4000)."
  };
})(window);
