/**
 * Job value, read out of a free-text custom field.
 *
 * Trello has no currency type, so the price column is whatever somebody typed:
 * "$20,000+", "2100 ish ask craig", a range with no style picked yet. Two rules
 * are load-bearing here and neither is obvious from the call site.
 *
 * A range books the LOW end -- every dashboard figure downstream is built on
 * that choice, and quietly flipping it to the high end would inflate the
 * pipeline without anything looking wrong.
 *
 * And a note in the field must never blank a card out: off-rule text is still
 * parsed best-effort and reported separately for cleanup. A parser that returned
 * null on anything untidy would make the dashboard read low and say nothing.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { load, plain } = require("./harness");

const win = load();
const P = win.WFPricing;

const t = {};   // the REST layer is stubbed per test; `t` is only passed through

/* ================================================================ parsing */

test("a plain price is read however it is punctuated", () => {
  assert.equal(P.parseMoney("1200"), 1200);
  assert.equal(P.parseMoney("$4,500"), 4500);
  assert.equal(P.parseMoney("2692.00"), 2692);
  assert.equal(P.parseMoney(1500), 1500);
});

test("a range books the low end, because the customer has not picked yet", () => {
  assert.equal(P.parseMoney("$3500-$4000"), 3500);
  assert.equal(P.parseMoney("$3,313 - $3,615"), 3313);
  assert.equal(P.parseMoney("1200 to 1500"), 1200);
});

test("a price with a note attached still yields a figure", () => {
  // Blanking these would take real money off the dashboard for a typo.
  assert.equal(P.parseMoney("$20,000+"), 20000);
  assert.equal(P.parseMoney("$3597 reduce price to $2200 ask Dale"), 2200);
});

test("a small bare number is a count, not a price", () => {
  // "2 gates" in the value column must never be booked as $2.
  assert.equal(P.parseMoney("2 gates"), null);
  assert.equal(P.parseMoney("42"), null);
});

test("nothing usable yields null rather than a zero", () => {
  // A zero is a real price and would be averaged in; null is "we don't know".
  assert.equal(P.parseMoney(""), null);
  assert.equal(P.parseMoney(null), null);
  assert.equal(P.parseMoney(undefined), null);
  assert.equal(P.parseMoney("ask craig"), null);
  assert.equal(P.parseMoney(0), null);
});

/* ============================================================== classifying */

test("an empty field is 'empty', not a violation somebody has to clean up", () => {
  ["", "   ", null, undefined].forEach((raw) => {
    const v = P.classify(raw);
    assert.equal(v.state, "empty");
    assert.equal(v.value, null);
  });
});

test("a number and a range both satisfy the house rule, and say which they are", () => {
  assert.equal(P.classify("$4,500").state, "ok");
  assert.equal(P.classify("$4,500").kind, "single");
  assert.equal(P.classify("$3500-$4000").kind, "range");
  assert.equal(P.classify("1200 to 1500").kind, "range");
  assert.equal(P.classify("$3500-$4000").value, 3500);
});

test("off-rule text is flagged and still carries its figure", () => {
  const v = P.classify("$3597 reduce price to $2200 ask Dale");
  assert.equal(v.state, "offRule");
  assert.equal(v.value, 2200);
  assert.equal(v.raw, "$3597 reduce price to $2200 ask Dale", "the original is kept for the audit");
});

test("the field name comes from config, not from a string baked into pricing", () => {
  assert.equal(P.fieldName(), win.WF_CONFIG.customFieldNames.jobValue);
});

/* ========================================================= one pass per board */

function stubBoard(cards) {
  win.WFRest.getBoardCustomFields = () => Promise.resolve([{ id: "f1", name: P.fieldName() }]);
  win.WFRest.request = () => Promise.resolve(cards);
}

function cardWith(id, text) {
  return {
    id: id, name: "Job " + id, shortUrl: "http://example.invalid/" + id,
    customFieldItems: [{ idCustomField: "f1", value: { text: text } }]
  };
}

test("a board read gives values for every card and a separate list to clean up", async () => {
  stubBoard([cardWith("c1", "$4,500"), cardWith("c2", "$20,000+")]);

  assert.deepStrictEqual(plain(await P.getBoardValues(t, "board-mixed")),
    { c1: 4500, c2: 20000 }, "the off-rule card still has a value");

  const audit = plain(await P.getBoardAudit(t, "board-mixed"));
  assert.deepStrictEqual(audit.map((x) => x.id), ["c2"]);
  assert.equal(audit[0].raw, "$20,000+");
});

test("a renamed or missing field means no pricing, not an exception", async () => {
  win.WFRest.getBoardCustomFields = () => Promise.resolve([{ id: "f9", name: "Something Else" }]);
  win.WFRest.request = () => Promise.resolve([cardWith("c1", "$4,500")]);
  assert.deepStrictEqual(plain(await P.getBoardValues(t, "board-renamed")), {});
});

test("a board is read once and then cached until it is invalidated", async () => {
  // The cache is what stops every tab re-reading a 1000-card board; an
  // invalidate that doesn't clear it makes an edited price look unsaved.
  stubBoard([cardWith("c1", "$1,000")]);
  assert.deepStrictEqual(plain(await P.getBoardValues(t, "board-cached")), { c1: 1000 });

  stubBoard([cardWith("c1", "$2,000")]);
  assert.deepStrictEqual(plain(await P.getBoardValues(t, "board-cached")), { c1: 1000 },
    "still the cached answer");

  P.invalidate("board-cached");
  assert.deepStrictEqual(plain(await P.getBoardValues(t, "board-cached")), { c1: 2000 });
});

test("invalidating one board leaves the others cached", async () => {
  stubBoard([cardWith("c1", "$1,000")]);
  await P.getBoardValues(t, "board-keep");
  await P.getBoardValues(t, "board-drop");

  stubBoard([cardWith("c1", "$2,000")]);
  P.invalidate("board-drop");
  assert.deepStrictEqual(plain(await P.getBoardValues(t, "board-keep")), { c1: 1000 });
  assert.deepStrictEqual(plain(await P.getBoardValues(t, "board-drop")), { c1: 2000 });
});
