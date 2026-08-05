/* Dashboard -- "Where the shop stands today".
   Wired: stage occupancy, SLA health, pending approvals, economics rollup,
   needs-a-look list. All from WFRest.getBoardCardsFull + WFStage. */
(function () {
  "use strict";
  var O = WFOps;

  function summarize(ctx, cards) {
    var cfg = ctx.boardCfg;
    var s = {
      stages: [], inShop: 0, late: 0, pendingApproval: 0,
      sla: { green: 0, amber: 0, red: 0, none: 0 },
      value: 0, cost: 0, priced: 0,
      running: 0, minutesToday: 0,
      attention: []
    };
    if (!cfg) return s;

    var byStage = {};
    cards.forEach(function (card) {
      if (WFStage.isExcluded(ctx.board.id, card.idList)) return;
      var stage = cfg.stages.filter(function (x) { return x.listId === card.idList; })[0];
      if (!stage) return;

      var k = stage.order + ":" + stage.name;
      if (!byStage[k]) byStage[k] = { order: stage.order, name: stage.name, count: 0, hot: false };
      byStage[k].count++;

      var days = WFStage.daysSince(card.dateLastActivity);
      var color = WFStage.colorForElapsed(stage, days) || "none";
      s.sla[color]++;
      if (stage.isWorkPhase) s.inShop++;
      if (color === "red") { s.late++; byStage[k].hot = true; }

      var work = card.phaseWork;
      if (work) {
        if (work.pendingApproval) s.pendingApproval++;
        if (WFPhase.isRunning(work)) { s.running++; s.minutesToday += WFPhase.totalMinutes(work) || 0; }
      }

      var econ = card.economics;
      if (econ && econ.value) {
        s.priced++;
        s.value += Number(econ.value) || 0;
        s.cost += Number(econ.cost) || 0;
      }

      var thin = econ && econ.value
        ? ((econ.value - (econ.cost || 0)) / econ.value) * 100 : null;
      if (color === "red" || color === "amber" || (thin !== null && thin < 10)) {
        s.attention.push({
          card: card, stage: stage, days: days, color: color, marginPct: thin,
          reason: color === "red" ? "late" : (thin !== null && thin < 10 ? "thin" : "close")
        });
      }
    });

    s.stages = Object.keys(byStage).map(function (k) { return byStage[k]; })
      .sort(function (a, b) { return a.order - b.order; });
    s.attention.sort(function (a, b) { return b.days - a.days; });
    return s;
  }

  function bars(stages) {
    var max = Math.max.apply(null, stages.map(function (x) { return x.count; }).concat([1]));
    return O.el("div.wf-bars", null, stages.map(function (x) {
      return O.el("div.wf-bar-row" + (x.hot ? ".is-hot" : ""), null,
        O.el("span.wf-bar-label", { text: x.name }),
        O.el("span.wf-bar-track", null,
          O.el("span.wf-bar-fill", { style: "width:" + Math.round((x.count / max) * 100) + "%" })),
        O.el("span.wf-bar-n", { text: String(x.count) }));
    }));
  }

  function meter(sla) {
    var total = sla.green + sla.amber + sla.red + sla.none || 1;
    var seg = function (n, color) {
      return O.el("div", { style: "width:" + (n / total) * 100 + "%;background:" + color });
    };
    var legend = [
      ["On track", sla.green, "var(--wf-steel)"],
      ["Getting close", sla.amber, "var(--wf-amber)"],
      ["Late", sla.red, "var(--wf-ember)"],
      ["No target set", sla.none, "var(--wf-band)"]
    ];
    return O.frag(
      O.el("div.wf-meter", null,
        seg(sla.green, "#1f4e79"), seg(sla.amber, "#d98324"),
        seg(sla.red, "#c8471c"), seg(sla.none, "#e6ecf2")),
      O.el("div.wf-legend", null, legend.map(function (r) {
        return O.el("div.wf-legend-row", null,
          O.el("span.wf-dot", { style: "background:" + r[2] }),
          document.createTextNode(r[0]),
          O.el("span.wf-legend-n", { text: r[1] + (r[1] === 1 ? " job" : " jobs") }));
      })));
  }

  function attentionRow(ctx, a) {
    var who = a.card.phaseWork && a.card.phaseWork.claimedBy
      ? O.displayName(a.card.phaseWork.claimedBy) : "nobody yet";
    var sub = a.reason === "thin" && a.marginPct != null
      ? "margin " + Math.round(a.marginPct * 10) / 10 + "%"
      : who;
    var badge = a.reason === "late"
      ? O.tag(O.elapsedPhrase(a.days) + " late", "late")
      : a.reason === "thin" ? O.tag("thin margin", "late") : O.tag("getting close", "warn");
    var unclaimed = !(a.card.phaseWork && a.card.phaseWork.claimedBy);

    var row = O.el("div.wf-row", { style: "grid-template-columns:1.6fr 150px 130px auto" },
      O.el("div", null,
        O.el("div.wf-job", { text: a.card.name }),
        O.el("div.wf-jobsub", { text: sub })),
      O.el("div", { style: "font-size:14px;color:var(--wf-muted)", text: a.stage.name }),
      O.el("div", null, badge),
      O.el("div.wf-actions", null,
        O.btn(unclaimed ? "Assign" : "Open job", {
          onClick: function () {
            if (unclaimed) ctx.goTo("workboard"); else O.openCard(a.card);
          }
        })));
    return row;
  }

  /* House rule: a price is a number or a range of two numbers. Trello has no
     currency field type, so "$Value" is free text and the rule can't be
     enforced at entry -- surface what breaks it instead. Off-rule values are
     still counted (best-effort number) so the figures above stay usable. */
  function priceCleanup(ctx, offRule) {
    var panel = O.panel(
      "Prices needing cleanup",
      offRule.length + (offRule.length === 1 ? " job" : " jobs") + " · " + WFPricing.RULE_TEXT
    );
    panel.body(O.el("div.wf-list", null, offRule.slice(0, 8).map(function (o) {
      return O.el("div.wf-row", { style: "grid-template-columns:1.4fr 1.3fr 130px auto" },
        O.el("div", null,
          O.el("div.wf-job", { text: o.name }),
          O.el("div.wf-jobsub", { text: WFPricing.fieldName() + ": " + o.raw })),
        O.el("div", { style: "font-size:13px;color:var(--wf-muted)",
          text: o.value == null ? "no number found" : "counting it as " + O.money(o.value) }),
        O.el("div", null, O.tag(o.value == null ? "unusable" : "off-rule", o.value == null ? "late" : "warn")),
        O.el("div.wf-actions", null,
          O.btn("Fix it", { onClick: function () { O.openCard({ id: o.id, shortUrl: o.url }); } })));
    })));
    if (offRule.length > 8) {
      panel.appendChild(O.el("div.muted", { style: "padding-top:10px",
        text: "+ " + (offRule.length - 8) + " more" }));
    }
    return panel;
  }

  O.tab({
    id: "dashboard",
    label: "Dashboard",
    managerOnly: true,
    render: function (ctx) {
      return Promise.all([
        ctx.cards(),
        // Same cached fetch ops.js already made -- no extra REST call.
        WFPricing.getBoardAudit(ctx.t, ctx.board.id).catch(function () { return []; })
      ]).then(function (loaded) {
        var cards = loaded[0], offRule = loaded[1] || [];
        if (!ctx.boardCfg) {
          return O.empty("This board isn't mapped in config.js yet — add it to WF_CONFIG.boards to switch the dashboard on.");
        }
        var s = summarize(ctx, cards);
        var margin = s.value - s.cost;
        var marginPct = s.value ? Math.round((margin / s.value) * 100) : null;
        var today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

        var head = O.el("div.wf-pagehead", null,
          O.el("div.wf-h1", { text: "Where the shop stands today" }),
          O.el("div.wf-sub", { text: today + " · " + cards.length + " jobs open" }),
          O.btn("Refresh", { quiet: true, busyText: "Refreshing…", onClick: ctx.reload }));
        head.lastChild.classList.add("wf-spacer");

        var stats = O.el("div.wf-stats", null,
          O.stat("In the shop", s.inShop, "jobs being worked right now"),
          O.stat("Running late", s.late, "past the time we allow", s.late > 0),
          O.stat("Waiting on you", s.pendingApproval, "phases need your sign-off"),
          O.stat("Margin on open work",
            marginPct == null ? "—" : marginPct + "%",
            O.moneyShort(s.value) + " booked · " + s.priced + " priced"));

        var occupancy = O.panel("Where the work is sitting", "jobs per phase");
        occupancy.body(bars(s.stages));

        var health = O.panel("On time?");
        health.style.display = "flex";
        health.style.flexDirection = "column";
        health.body(meter(s.sla),
          O.el("div.wf-callout", null,
            O.el("div.wf-callout-k", { text: "On the floor right now" }),
            O.el("div.wf-callout-v", {
              text: s.running + " running · " + O.hours(s.minutesToday) + " logged"
            })));

        var list = O.panel("Needs a look", "longest waiting first",
          O.btn("Open work board", { primary: true, onClick: function () { ctx.goTo("workboard"); } }));
        list.body(s.attention.length
          ? O.el("div.wf-list", null, s.attention.slice(0, 6).map(function (a) {
              return attentionRow(ctx, a);
            }))
          : O.el("div.muted", { style: "padding:14px 2px", text: "Nothing is over its time allowance right now." }));

        return O.el("div", null, head, stats,
          O.el("div.wf-panels.split", null, occupancy, health), list,
          offRule.length ? priceCleanup(ctx, offRule) : null);
      });
    }
  });
})();
