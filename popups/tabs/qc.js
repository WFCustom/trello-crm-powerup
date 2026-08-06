/* Quality check -- work the checklist, sign it, and close the correction loop.
   Everyone sees this tab: a welder needs to know what's been asked of them and
   what's come back to them. Passing here advances the phase. */
(function () {
  "use strict";
  var O = WFOps;
  var S = WFQC.STATUS;

  function meta(ctx, card) { return { id: card.id, idList: card.idList, idBoard: ctx.board.id }; }
  function stageOf(ctx, card) { return O.phaseForCard(ctx.boardCfg, card); }

  function waited(iso) {
    if (!iso) return "";
    return "waiting " + O.elapsedPhrase((Date.now() - new Date(iso).getTime()) / 86400000);
  }

  /* ------------------------------------------------ the checker's checklist */

  function openCheck(ctx, card, stage, rec) {
    var items = (rec.template || []).slice();
    if (!items.length) {
      items = ["Work is complete and correct"];   // no template set yet
    }
    var rows = [];
    var body = O.el("div");

    items.forEach(function (text) {
      var note = O.el("input", { type: "text", placeholder: "What did you find? (needed if it fails)" });
      var sel = O.el("select", { style: "width:110px" },
        O.el("option", { value: "pass", text: "Pass" }),
        O.el("option", { value: "fail", text: "Fail" }),
        O.el("option", { value: "na", text: "N/A" }));
      note.style.display = "none";
      sel.addEventListener("change", function () {
        note.style.display = sel.value === "fail" ? "" : "none";
      });
      rows.push({ text: text, sel: sel, note: note });
      body.appendChild(O.el("div", { style: "padding:12px 0;border-bottom:1px solid var(--wf-band)" },
        O.el("div", { style: "display:flex;align-items:center;gap:12px" },
          O.el("div", { style: "flex:1;font-size:14px", text: text }), sel),
        note));
    });

    O.dialog({
      title: "Quality check",
      note: card.name + (stage ? " · " + stage.name : "") +
            " · work by " + O.displayName(rec.requestedBy),
      content: O.el("div", null, body,
        O.el("div.hint", { style: "margin-top:14px",
          text: "Everything passing sends the job on. Anything failing goes back to " +
                O.firstName(rec.requestedBy) + " with your notes." })),
      buttons: [{
        label: "Sign off my check", primary: true, busyText: "Signing…",
        onClick: function () {
          var results = rows.map(function (r) {
            return { text: r.text, result: r.sel.value, note: r.note.value };
          });
          var missing = results.filter(function (r) { return r.result === "fail" && !r.note.trim(); });
          if (missing.length) {
            window.alert("Say what's wrong with: " + missing.map(function (m) { return m.text; }).join(", "));
            return Promise.reject(new Error("note required"));
          }
          return WFQC.submitCheck(ctx.t, meta(ctx, card), ctx.member, results)
            .then(function () { return ctx.syncCard(card.id); });
        }
      }]
    });
  }

  /* ------------------------------------------- the welder's correction form */

  function openCorrection(ctx, card, stage, rec) {
    var round = WFQC.currentRound(rec);
    var failed = WFQC.failedItems(round);
    var rows = [];
    var body = O.el("div");

    failed.forEach(function (item) {
      var inp = O.el("input", { type: "text", placeholder: "What did you do about it?" });
      rows.push({ text: item.text, inp: inp });
      body.appendChild(O.el("div", { style: "padding:12px 0;border-bottom:1px solid var(--wf-band)" },
        O.el("div", { style: "font-size:14px;font-weight:600", text: item.text }),
        item.note ? O.el("div.wf-card-s", { style: "margin-bottom:8px",
          text: O.firstName(round.checkedBy) + " said: " + item.note }) : null,
        inp));
    });

    O.dialog({
      title: "What did you fix?",
      note: card.name + " · sent back by " + O.displayName(round.checkedBy),
      content: O.el("div", null, body,
        O.el("div.hint", { style: "margin-top:14px",
          text: "This goes on the record with your name against it, and " +
                O.firstName(round.checkedBy) + " re-checks only these items." })),
      buttons: [{
        label: "Sign off my corrections", primary: true, busyText: "Signing…",
        onClick: function () {
          var corrections = rows.map(function (r) { return { text: r.text, whatIDid: r.inp.value }; });
          var blank = corrections.filter(function (c) { return !c.whatIDid.trim(); });
          if (blank.length) {
            window.alert("Say what you did about: " + blank.map(function (b) { return b.text; }).join(", "));
            return Promise.reject(new Error("note required"));
          }
          return WFQC.submitCorrections(ctx.t, meta(ctx, card), ctx.member, corrections)
            .then(function () { return ctx.syncCard(card.id); });
        }
      }]
    });
  }

  /* --------------------------------- the checker verifies ONLY what failed */

  function openVerify(ctx, card, stage, rec) {
    var round = WFQC.currentRound(rec);
    var rows = [];
    var body = O.el("div");

    (round.corrections || []).forEach(function (c) {
      var sel = O.el("select", { style: "width:150px" },
        O.el("option", { value: "yes", text: "Fixed" }),
        O.el("option", { value: "no", text: "Still not right" }));
      var note = O.el("input", { type: "text", placeholder: "What's still wrong?" });
      note.style.display = "none";
      sel.addEventListener("change", function () {
        note.style.display = sel.value === "no" ? "" : "none";
      });
      rows.push({ text: c.text, sel: sel, note: note });
      body.appendChild(O.el("div", { style: "padding:12px 0;border-bottom:1px solid var(--wf-band)" },
        O.el("div", { style: "display:flex;align-items:center;gap:12px" },
          O.el("div", { style: "flex:1" },
            O.el("div", { style: "font-size:14px;font-weight:600", text: c.text }),
            O.el("div.wf-card-s", { text: O.firstName(round.correctedBy) + " did: " + c.whatIDid })),
          sel),
        note));
    });

    O.dialog({
      title: "Did the fix hold?",
      note: card.name + " · corrected by " + O.displayName(round.correctedBy),
      content: O.el("div", null, body,
        O.el("div.hint", { style: "margin-top:14px",
          text: "Only the items you sent back are re-checked. All fixed sends the job on." })),
      buttons: [{
        label: "Sign off the re-check", primary: true, busyText: "Signing…",
        onClick: function () {
          var verify = rows.map(function (r) {
            return { text: r.text, ok: r.sel.value === "yes", note: r.note.value };
          });
          var blank = verify.filter(function (v) { return !v.ok && !v.note.trim(); });
          if (blank.length) {
            window.alert("Say what's still wrong with: " + blank.map(function (b) { return b.text; }).join(", "));
            return Promise.reject(new Error("note required"));
          }
          return WFQC.submitVerify(ctx.t, meta(ctx, card), ctx.member, verify)
            .then(function () { return ctx.syncCard(card.id); });
        }
      }]
    });
  }

  /* ------------------------------------------------------------- rendering */

  function history(rec) {
    if (!rec.rounds || !rec.rounds.length) return null;
    var wrap = O.el("div", { style: "margin-top:10px" });
    rec.rounds.forEach(function (rd) {
      var lines = [];
      (rd.items || []).filter(function (i) { return i.result === "fail"; })
        .forEach(function (i) {
          lines.push(O.firstName(rd.checkedBy) + " failed “" + i.text + "”" + (i.note ? " — " + i.note : ""));
        });
      (rd.corrections || []).forEach(function (c) {
        lines.push(O.firstName(rd.correctedBy) + " fixed it — " + c.whatIDid);
      });
      (rd.verify || []).forEach(function (v) {
        lines.push(O.firstName(rd.verifiedBy) + (v.ok ? " confirmed it held" : " found it still wrong — " + v.note));
      });
      if (!lines.length) return;
      wrap.appendChild(O.el("div", { style: "margin-top:6px" },
        O.el("div.wf-card-s", { style: "font-weight:600", text: "Round " + rd.n }),
        O.el("div", null, lines.map(function (l) {
          return O.el("div.wf-card-s", { text: "· " + l });
        }))));
    });
    return wrap.childNodes.length ? wrap : null;
  }

  function row(ctx, card, stage, rec, kind) {
    var buttons = O.el("div.wf-actions");
    buttons.appendChild(O.btn("Open card", { quiet: true, small: true,
      onClick: function () { O.openCard(card); } }));

    if (kind === "check") {
      buttons.appendChild(O.btn("Work the checklist", { primary: true,
        onClick: function () { openCheck(ctx, card, stage, rec); } }));
    } else if (kind === "correct") {
      buttons.appendChild(O.btn("Say what you fixed", { primary: true,
        onClick: function () { openCorrection(ctx, card, stage, rec); } }));
    } else if (kind === "verify") {
      buttons.appendChild(O.btn("Re-check it", { primary: true,
        onClick: function () { openVerify(ctx, card, stage, rec); } }));
    }

    var tags = O.el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" });
    if (kind === "check") tags.appendChild(O.tag(rec.requestedFrom ? "Asked of you" : "Open to anyone", rec.requestedFrom ? "warn" : "quiet"));
    if (kind === "correct") tags.appendChild(O.tag("Sent back to you", "late"));
    if (kind === "verify") tags.appendChild(O.tag("Ready to re-check", "warn"));
    if (WFQC.needsManagerAfterQc(card)) tags.appendChild(O.tag("manager sign-off too", "late"));

    return O.el("div.wf-card.is-review", { style: "grid-template-columns:1.6fr 1fr auto" },
      O.el("div", null,
        O.el("div.wf-card-t", { text: card.name }),
        O.el("div.wf-card-s", {
          text: (stage ? stage.name : "—") + " · " + O.displayName(rec.requestedBy) +
                " · " + waited(rec.requestedAt)
        }),
        history(rec)),
      tags, buttons);
  }

  O.tab({
    id: "qc",
    label: "Quality check",
    badgeCount: function (ctx) { return ctx.__qcCount || 0; },
    render: function (ctx) {
      return ctx.cards().then(function (cards) {
        var me = ctx.member.username;
        var toCheck = [], toCorrect = [], toVerify = [], watching = [];

        cards.forEach(function (card) {
          var rec = WFQC.activeRecord(card);
          if (!rec || rec.status === "passed") return;
          var stage = stageOf(ctx, card);
          var owner = WFQC.isOwner(rec, me);
          var reviewer = WFQC.canReview(rec, me) && !owner;

          if (rec.status === S.CHECK && reviewer) toCheck.push([card, stage, rec, "check"]);
          else if (rec.status === S.CORRECTION && owner) toCorrect.push([card, stage, rec, "correct"]);
          else if (rec.status === S.VERIFY && reviewer) toVerify.push([card, stage, rec, "verify"]);
          else watching.push([card, stage, rec, null]);
        });

        ctx.__qcCount = toCheck.length + toCorrect.length + toVerify.length;

        var out = O.el("div", null,
          O.el("div.wf-pagehead", null,
            O.el("div.wf-h1", { text: "Quality check" }),
            O.el("div.wf-sub", {
              text: ctx.__qcCount ? ctx.__qcCount + " waiting on you" : "Nothing waiting on you"
            })));

        function section(title, rows, emptyText) {
          if (!rows.length && !emptyText) return;
          out.appendChild(O.el("div.wf-group-h", null,
            O.el("div.wf-group-t", { text: title }),
            O.el("span.wf-group-n", { text: String(rows.length) })));
          out.appendChild(rows.length
            ? O.el("div.wf-cards", null, rows.map(function (r) { return row(ctx, r[0], r[1], r[2], r[3]); }))
            : O.empty(emptyText));
        }

        section("Check these", toCheck, "Nothing needs checking by you.");
        section("Sent back to you", toCorrect, "Nothing has come back to you.");
        section("Re-check after correction", toVerify, null);
        section("Everything else in QC", watching, null);

        return out;
      });
    }
  });
})();
