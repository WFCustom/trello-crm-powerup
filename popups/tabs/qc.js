/* Quality check -- peer sign-off between finishing a phase and it moving on.
   Visible to everyone: a welder needs to see what's been asked of them, and the
   pool is open to whoever's free. Passing here IS the approval for shop phases,
   so the card advances and phaseLog records the peer who signed it off. */
(function () {
  "use strict";
  var O = WFOps;

  function meta(ctx, card) { return { id: card.id, idList: card.idList, idBoard: ctx.board.id }; }

  function stageOf(ctx, card) {
    if (!ctx.boardCfg) return null;
    return ctx.boardCfg.stages.filter(function (s) { return s.listId === card.idList; })[0] || null;
  }

  function waitedFor(req) {
    if (!req || !req.requestedAt) return "";
    var days = (Date.now() - new Date(req.requestedAt).getTime()) / 86400000;
    return "waiting " + O.elapsedPhrase(days);
  }

  function reviewCard(ctx, card, stage, req, mine) {
    var w = O.activeWork(card) || {};
    var did = O.displayName(req.requestedBy);
    var selfCheck = WFQC.isSelfCheck(req, ctx.member.username);
    var alsoNeedsManager = WFQC.needsManagerAfterQc(card);

    var actions = O.el("div.wf-actions");
    if (selfCheck) {
      actions.appendChild(O.el("span.wf-card-s", { text: "Your own work — someone else checks this" }));
    } else {
      actions.appendChild(O.btn("Look at the card", {
        quiet: true, small: true, onClick: function () { O.openCard(card); }
      }));
      actions.appendChild(O.btn("Send it back", {
        busyText: "Sending back…",
        onClick: function () {
          var why = window.prompt("What needs fixing? " + did + " will see this on the card.") || "";
          return WFQC.fail(ctx.t, meta(ctx, card), ctx.member, why)
            .then(function () { return ctx.syncCard(card.id); });
        }
      }));
      actions.appendChild(O.btn(alsoNeedsManager ? "Pass QC (manager still to sign)" : "Passed — move it on", {
        primary: true, busyText: "Signing off…",
        onClick: function () {
          return WFQC.pass(ctx.t, meta(ctx, card), ctx.member)
            .then(function () { return ctx.syncCard(card.id); });
        }
      }));
    }

    return O.el("div.wf-card.is-review", { style: "grid-template-columns:1.6fr 1fr auto" },
      O.el("div", null,
        O.el("div.wf-card-t", { text: card.name }),
        O.el("div.wf-card-s", {
          text: (stage ? stage.name : "—") + " · " + did + " · " +
                O.hours(WFPhase.totalMinutes(w)) + " · " + waitedFor(req)
        })),
      O.el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" },
        mine ? O.tag("Asked of you", "warn") : O.tag("Open to anyone", "quiet"),
        alsoNeedsManager ? O.tag("manager sign-off too", "late") : null),
      actions);
  }

  O.tab({
    id: "qc",
    label: "Quality check",
    badgeCount: function (ctx) { return ctx.__qcCount || 0; },
    render: function (ctx) {
      return ctx.cards().then(function (cards) {
        var mine = [], pool = [], sent = [];

        cards.forEach(function (card) {
          var req = WFQC.activeRequest(card);
          if (!req) return;
          var row = [card, stageOf(ctx, card), req];
          if (WFQC.isSelfCheck(req, ctx.member.username)) sent.push(row);
          else if (req.requestedFrom && req.requestedFrom.username === ctx.member.username) mine.push(row);
          else if (!req.requestedFrom) pool.push(row);
        });

        ctx.__qcCount = mine.length + pool.length;

        var out = O.el("div", null,
          O.el("div.wf-pagehead", null,
            O.el("div.wf-h1", { text: "Quality check" }),
            O.el("div.wf-sub", {
              text: ctx.__qcCount
                ? ctx.__qcCount + (ctx.__qcCount === 1 ? " job needs" : " jobs need") + " a set of eyes"
                : "Nothing waiting on a check"
            })));

        function section(title, rows, isMine, emptyText) {
          out.appendChild(O.el("div.wf-group-h", null,
            O.el("div.wf-group-t", { text: title }),
            O.el("span.wf-group-n", { text: String(rows.length) })));
          out.appendChild(rows.length
            ? O.el("div.wf-cards", null, rows.map(function (r) {
                return reviewCard(ctx, r[0], r[1], r[2], isMine);
              }))
            : O.empty(emptyText));
        }

        section("Asked of you", mine, true, "Nobody has asked you to check anything.");
        section("Up for grabs", pool, false, "Nothing in the QC pool.");
        if (sent.length) {
          out.appendChild(O.el("div.wf-group-h", null,
            O.el("div.wf-group-t", { text: "Your work, out for checking" }),
            O.el("span.wf-group-n", { text: String(sent.length) })));
          out.appendChild(O.el("div.wf-cards", null, sent.map(function (r) {
            var req = r[2];
            return O.el("div.wf-card.is-review", { style: "grid-template-columns:1.6fr 1fr auto" },
              O.el("div", null,
                O.el("div.wf-card-t", { text: r[0].name }),
                O.el("div.wf-card-s", {
                  text: (r[1] ? r[1].name : "—") + " · " + waitedFor(req)
                })),
              O.el("div", null, O.tag(req.requestedFrom
                ? "with " + O.firstName(req.requestedFrom) : "in the pool", "quiet")),
              O.el("div.wf-actions", null, O.btn("Open", {
                small: true, quiet: true, onClick: function () { O.openCard(r[0]); }
              })));
          })));
        }

        return out;
      });
    }
  });
})();
