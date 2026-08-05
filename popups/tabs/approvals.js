/* Approvals -- manager sign-off queue. Fully wired to
   WFPhase.approveAndAdvance / WFPhase.reject, same behaviour as the old
   popups/approvals.js, in the ops-window skin. */
(function () {
  "use strict";
  var O = WFOps;

  function meta(ctx, card) { return { id: card.id, idList: card.idList, idBoard: ctx.board.id }; }

  function nextStageName(ctx, card) {
    var next = WFStage.getNextStage(ctx.board.id, card.idList);
    return next ? next.name : null;
  }

  function pendingCard(ctx, x) {
    var card = x.card, w = O.activeWork(card) || {};
    var next = nextStageName(ctx, card);
    var mins = WFPhase.totalMinutes(w);
    var sla = x.stage && x.stage.slaDays ? x.stage.slaDays * 1440 : null;
    var pace = sla ? (mins <= sla * 0.85 ? ["ahead of pace", "go"]
                    : mins <= sla * 1.15 ? ["about on pace", "quiet"]
                    : ["over the allowance", "warn"]) : null;

    return O.el("div.wf-card.is-review", { style: "grid-template-columns:1.7fr 1fr auto" },
      O.el("div", null,
        O.el("div.wf-card-t", { text: card.name }),
        O.el("div.wf-card-s", {
          text: (x.stage ? x.stage.name : "—") + " · " + O.displayName(w.claimedBy) +
                " · " + O.hours(mins) + (next ? " · next up: " + next : "")
        })),
      O.el("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap" },
        pace ? O.tag(pace[0], pace[1]) : null,
        O.btn("Look at the card", { quiet: true, small: true, onClick: function () { O.openCard(card); } })),
      O.el("div.wf-actions", null,
        O.btn("Send back", {
          busyText: "Sending…",
          onClick: function () {
            var why = window.prompt("What needs fixing? (optional)") || "";
            return WFPhase.reject(ctx.t, meta(ctx, card), ctx.member, why)
              .then(function () { return ctx.syncCard(card.id); });
          }
        }),
        O.btn(next ? "Approve → " + next : "Approve", {
          primary: true, busyText: "Approving…",
          onClick: function () {
            // Approving moves the card, and the SDK can't tell us the new list,
            // so hand syncCard the destination we already computed.
            var target = WFStage.getNextStage(ctx.board.id, card.idList);
            return WFPhase.approveAndAdvance(ctx.t, meta(ctx, card), ctx.member)
              .then(function () {
                return ctx.syncCard(card.id, target ? { idList: target.listId } : null);
              });
          }
        })));
  }

  function unclaimedCard(ctx, x) {
    return O.el("div.wf-card.is-open", { style: "grid-template-columns:1.7fr 1fr auto" },
      O.el("div", null,
        O.el("div.wf-card-t", { text: x.card.name }),
        O.el("div.wf-card-s", {
          text: x.stage.name + " · sitting " + O.elapsedPhrase(WFStage.daysSince(x.card.dateLastActivity))
        })),
      O.el("div", null, O.tag("Nobody yet", "quiet")),
      O.el("div.wf-actions", null,
        O.btn("Assign on the work board", {
          onClick: function () { ctx.goTo("workboard"); }
        })));
  }

  O.tab({
    id: "approvals",
    label: "Approvals",
    roles: ["manager"],
    badgeCount: function () { return badge; },
    render: function (ctx) {
      return ctx.cards().then(function (cards) {
        var cfg = ctx.boardCfg;
        var withStage = cards.map(function (c) {
          return { card: c, stage: cfg ? cfg.stages.filter(function (s) { return s.listId === c.idList; })[0] : null };
        });

        var pending = withStage.filter(function (x) {
          var w = O.activeWork(x.card);
          return w && w.pendingApproval;
        });
        var unclaimed = withStage.filter(function (x) {
          var w = O.activeWork(x.card);
          return x.stage && x.stage.isWorkPhase && (!w || !w.claimedBy);
        });
        badge = pending.length;

        var recent = [];
        cards.forEach(function (c) {
          (c.phaseLog || []).forEach(function (e) {
            if (e.approvedAt) recent.push({ job: c.name, entry: e });
          });
        });
        recent.sort(function (a, b) { return new Date(b.entry.approvedAt) - new Date(a.entry.approvedAt); });

        var out = O.el("div", null,
          O.el("div.wf-pagehead", null,
            O.el("div.wf-h1", { text: pending.length ? pending.length + " waiting on your sign-off" : "Nothing waiting on you" }),
            O.el("div.wf-sub", { text: "Approving moves the job to the next phase. Sending back restarts the timer with your note on the card." })));

        if (pending.length) {
          out.appendChild(O.el("div.wf-cards", null, pending.map(function (x) { return pendingCard(ctx, x); })));
        } else {
          out.appendChild(O.empty("The queue is clear. Completed phases will show up here for approval."));
        }

        out.appendChild(O.el("div.wf-group-h", { style: "margin-top:28px" },
          O.el("div.wf-group-t", { text: "Nobody's picked these up" }),
          O.el("span.wf-group-n", { text: unclaimed.length + (unclaimed.length === 1 ? " job" : " jobs") })));
        out.appendChild(unclaimed.length
          ? O.el("div.wf-cards", null, unclaimed.slice(0, 8).map(function (x) { return unclaimedCard(ctx, x); }))
          : O.empty("Every work phase has someone on it."));

        var log = O.panel("Recently approved", "last ten sign-offs");
        var table = O.el("table", { html:
          "<thead><tr><th>Job</th><th>Phase</th><th>Finished by</th><th class='num'>Time</th><th>Approved by</th></tr></thead>" });
        var body = O.el("tbody");
        (recent.length ? recent.slice(0, 10) : []).forEach(function (r) {
          body.appendChild(O.el("tr", { html:
            "<td>" + O.esc(r.job) + "</td>" +
            "<td>" + O.esc(r.entry.listName) + "</td>" +
            "<td>" + O.esc(r.entry.claimedBy && r.entry.claimedBy.fullName) + "</td>" +
            "<td class='num'>" + O.hours(r.entry.durationMinutes) + "</td>" +
            "<td>" + O.esc((r.entry.approvedBy && r.entry.approvedBy.fullName) || "—") + "</td>" }));
        });
        if (!recent.length) body.innerHTML = '<tr><td colspan="5" class="muted">No approvals logged yet.</td></tr>';
        table.appendChild(body);
        log.body(table);
        out.appendChild(log);

        return out;
      });
    }
  });

  var badge = 0;
})();
