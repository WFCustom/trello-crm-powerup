/**
 * The card rendition -- what it shows, and to whom.
 *
 * The assertion this file exists for is the money rule: a worker looking at a
 * job card must not see its value, its cost or its margin. Everything else is
 * ordinary coverage; that one is a standing instruction from the owner and the
 * kind of thing a refactor breaks without anybody noticing, because the card
 * still renders perfectly well with an extra field on it.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { load } = require("./harness");

const win = load();
const V = win.WFCardView;

/* ------------------------------------------------------------- the money rule */

test("field names containing money words are financial", () => {
  ["Value", "$Value", "Job Cost", "Margin %", "Quoted Price", "Total",
   "Invoice #", "Deposit taken", "Shop rate", "Markup"].forEach((n) => {
    assert.equal(V.isMoneyField(n), true, n + " should be money");
  });
});

test("ordinary job fields are not financial", () => {
  ["Style", "Powder Color", "Customer", "Drawing #", "Gate width",
   "Install region", "Finish"].forEach((n) => {
    assert.equal(V.isMoneyField(n), false, n + " should not be money");
  });
});

test("matching is case-insensitive and matches inside a longer name", () => {
  assert.equal(V.isMoneyField("ESTIMATED COST TO BUILD"), true);
  assert.equal(V.isMoneyField("customer price agreed"), true);
});

test("managers and office see money; workers do not", () => {
  assert.equal(V.canSeeMoney("manager"), true);
  assert.equal(V.canSeeMoney("office"), true);
  assert.equal(V.canSeeMoney("worker"), false);
  // An unknown role is treated as the shop, not as a manager. Failing closed is
  // the only safe direction for this particular switch.
  assert.equal(V.canSeeMoney(undefined), false);
  assert.equal(V.canSeeMoney("visitor"), false);
});

test("visibleFields strips financial fields for a worker and keeps the rest", () => {
  const fields = [
    { name: "Style", display: "RG-4 picket" },
    { name: "$Value", display: "42500" },
    { name: "Powder Color", display: "Matte black" },
    { name: "Margin", display: "31%" }
  ];
  const shop = V.visibleFields(fields, "worker");
  assert.deepEqual(shop.map((f) => f.name), ["Style", "Powder Color"]);

  const boss = V.visibleFields(fields, "manager");
  assert.equal(boss.length, 4);
});

test("visibleFields copies rather than mutating the caller's array", () => {
  const fields = [{ name: "Style", display: "x" }];
  const out = V.visibleFields(fields, "manager");
  out.push({ name: "extra", display: "y" });
  assert.equal(fields.length, 1);
});

test("edit rights: the shop can tick and comment, not reschedule", () => {
  const w = V.editRights("worker");
  assert.equal(w.checkItems, true);
  assert.equal(w.comment, true);
  assert.equal(w.title, false);
  assert.equal(w.due, false);
  assert.equal(w.description, false);

  const m = V.editRights("manager");
  assert.equal(m.title, true);
  assert.equal(m.due, true);
  assert.equal(m.description, true);
});

/* ------------------------------------------------------------------ the cover */

test("a set cover wins over any attachment", () => {
  const card = {
    cover: { scaled: [{ url: "small.png", width: 100 }, { url: "big.png", width: 600 }] },
    attachments: [{ url: "other.jpg", mimeType: "image/jpeg" }]
  };
  assert.equal(V.coverFrom(card), "big.png");
});

test("with no cover set, the first image attachment is used", () => {
  const card = {
    attachments: [
      { url: "spec.pdf", mimeType: "application/pdf" },
      { url: "drawing.png", mimeType: "image/png" }
    ]
  };
  assert.equal(V.coverFrom(card), "drawing.png");
});

test("a card with no images has no cover rather than a broken one", () => {
  assert.equal(V.coverFrom({ attachments: [{ url: "a.dwg" }] }), null);
  assert.equal(V.coverFrom({}), null);
  assert.equal(V.coverFrom(null), null);
});

test("images are recognised by extension when the mime type is missing", () => {
  assert.equal(V.isImage({ url: "https://x/y/photo.JPG" }), true);
  assert.equal(V.isImage({ url: "https://x/y/plan.pdf" }), false);
});

/* ------------------------------------------------------------- attachment kinds */

test("only PDFs, images and 3D links claim to preview inline", () => {
  assert.equal(V.attachmentKind({ url: "a.png", mimeType: "image/png" }).inline, "image");
  assert.equal(V.attachmentKind({ url: "a.pdf" }).inline, "frame");
  assert.equal(V.attachmentKind({ url: "https://a360.autodesk.com/shares/x" }).inline, "frame");
  // A solid model cannot be shown, and says so rather than framing a download.
  assert.equal(V.attachmentKind({ url: "part.step", name: "part.step" }).inline, null);
  assert.equal(V.attachmentKind({ url: "gate.dwg", name: "gate.dwg" }).inline, null);
});

test("attachment kinds carry a short readable tag", () => {
  assert.equal(V.attachmentKind({ url: "gate.dwg", name: "gate.dwg" }).tag, "CAD");
  assert.equal(V.attachmentKind({ url: "part.f3d", name: "part.f3d" }).tag, "Model");
  assert.equal(V.attachmentKind({ url: "a.pdf" }).tag, "PDF");
});

/* --------------------------------------------------------------- checklists */

test("checklist progress totals every list on the card, not just the first", () => {
  const card = {
    checklists: [
      { id: "1", name: "Fit-up", checkItems: [
        { id: "a", name: "x", state: "complete" },
        { id: "b", name: "y", state: "incomplete" }] },
      { id: "2", name: "Weld", checkItems: [
        { id: "c", name: "z", state: "complete" },
        { id: "d", name: "w", state: "complete" }] }
    ]
  };
  const p = V.checklistProgress(card);
  assert.equal(p.done, 3);
  assert.equal(p.total, 4);
  assert.equal(p.pct, 75);
});

test("a card with no checklist reports no percentage rather than zero", () => {
  // Zero would draw an empty bar and read as "nothing done", which is a
  // different claim from "nobody made a checklist".
  assert.equal(V.checklistProgress({}).pct, null);
  assert.equal(V.checklistProgress({ checklists: [] }).total, 0);
});

test("checklists come back in board order with items flattened", () => {
  const card = {
    checklists: [
      { id: "2", name: "Second", pos: 20, checkItems: [
        { id: "c", name: "later", pos: 2, state: "incomplete" },
        { id: "b", name: "earlier", pos: 1, state: "complete" }] },
      { id: "1", name: "First", pos: 10, checkItems: [] }
    ]
  };
  const out = V.checklists(card);
  assert.deepEqual(out.map((l) => l.name), ["First", "Second"]);
  assert.deepEqual(out[1].items.map((i) => i.name), ["earlier", "later"]);
  assert.equal(out[1].done, 1);
  assert.equal(out[1].total, 2);
});

/* ------------------------------------------------------------------ comments */

test("only comment actions become comments, newest order preserved", () => {
  const card = {
    actions: [
      { id: "1", type: "commentCard", date: "2026-09-01T10:00:00Z",
        memberCreator: { fullName: "Mike Larsen", initials: "ML" },
        data: { text: "Gate is short 2 inches" } },
      { id: "2", type: "updateCard", date: "2026-09-01T09:00:00Z", data: {} }
    ]
  };
  const out = V.comments(card);
  assert.equal(out.length, 1);
  assert.equal(out[0].who, "Mike Larsen");
  assert.equal(out[0].initials, "ML");
  assert.equal(out[0].text, "Gate is short 2 inches");
});

test("a commenter with no initials on file still gets initials", () => {
  const out = V.comments({
    actions: [{ id: "1", type: "commentCard", date: new Date().toISOString(),
      memberCreator: { fullName: "Scott VanWorkom" }, data: { text: "ok" } }]
  });
  assert.equal(out[0].initials, "SV");
});

/* ------------------------------------------------------------------- due date */

test("due state separates late, done and never-set", () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  const soon = new Date(Date.now() + 86400000).toISOString();

  assert.equal(V.dueState({ due: past }).late, true);
  assert.equal(V.dueState({ due: soon }).late, false);
  // A completed card is not late even when its date has gone by.
  assert.equal(V.dueState({ due: past, dueComplete: true }).late, false);
  assert.equal(V.dueState({ due: past, dueComplete: true }).done, true);

  const none = V.dueState({});
  assert.equal(none.none, true);
  assert.equal(none.late, false);
  assert.match(none.text, /no due date/i);
});

/* -------------------------------------------------------------------- labels */

test("unnamed labels are dropped, named ones get a colour", () => {
  const card = { labels: [
    { id: "1", name: "GATE", color: "green" },
    { id: "2", name: "", color: "red" },
    { id: "3", name: "POWDER", color: "orange" }
  ] };
  const out = V.labels(card);
  assert.deepEqual(out.map((l) => l.name), ["GATE", "POWDER"]);
  assert.equal(out[0].hex, "#61bd4f");
});

test("a label with an unknown colour still gets something paintable", () => {
  assert.ok(/^#/.test(V.labelHex("chartreuse")));
  assert.ok(/^#/.test(V.labelHex(null)));
});

/* ---------------------------------------------------------------- breadcrumb */

test("breadcrumb reads board then list, and skips what is missing", () => {
  assert.equal(
    V.breadcrumb({ board: { name: "Office Operations" }, list: { name: "Assemble CNC" } }),
    "Office Operations › Assemble CNC");
  assert.equal(V.breadcrumb({ list: { name: "Billing" } }), "Billing");
  assert.equal(V.breadcrumb({}), "");
});
