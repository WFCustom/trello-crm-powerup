/* Job costing -- what each job actually cost, and what rework is costing us.
   Labor comes from logged phase time x hourly rate (no hand entry). ReWork is
   held out as its own cost line so its effect on margin is visible.
   Wired to WFCosting + WFRest.getLiveRatesCardDesc + WFMetrics.parseRatesCardDesc. */
(function () {
  "use strict";
  var O = WFOps;

  function loadRates(ctx) {
    var manual = (window.WF_CONFIG && window.WF_CONFIG.hourlyRates) || {};
    return WFRest.getLiveRatesCardDesc(ctx.t).then(function (desc) {
      var live = WFMetrics.parseRatesCardDesc(desc) || {};
      var merged = {};
      Object.keys(manual).forEach(function (k) { merged[k] = manual[k]; });
      Object.keys(live).forEach(function (k) { merged[k] = live[k]; });   // live wins
      return merged;
    }).catch(function () { return manual; });
  }

  function pct(n) { return n == null ? "—" : (Math.round(n * 10) / 10) + "%"; }

  function reworkPanel(t, origins) {
    var lost = t.marginPointsLostToRework;
    var panel = O.panel("What rework is costing you",
      t.jobsWithRework + " of " + t.jobs + " jobs came back");

    panel.body(O.el("div.wf-callout", { style: "margin:0 0 18px" },
      O.el("div.wf-callout-k", { text: "Margin given up to rework" }),
      O.el("div.wf-callout-v", {
        text: lost == null ? "—" : pct(lost) + " of revenue  ·  " + O.money(t.reworkCost)
      }),
      O.el("div.wf-callout-k", {
        text: t.marginPct == null ? ""
          : "Running " + pct(t.marginPct) + " margin — would be " + pct(t.marginPctNoRework) + " without it"
      })));

    if (!origins.length) {
      panel.appendChild(O.el("div.muted", { text: "No rework logged yet." }));
      return panel;
    }

    var max = Math.max.apply(null, origins.map(function (o) { return o.hours; }).concat([1]));
    panel.appendChild(O.el("div", null,
      O.el("div.wf-panel-t", { style: "font-size:14px;margin-bottom:10px", text: "Where it came back from" }),
      O.el("div.wf-bars", null, origins.map(function (o) {
        return O.el("div.wf-bar-row.is-hot", null,
          O.el("span.wf-bar-label", { text: o.phase }),
          O.el("span.wf-bar-track", null,
            O.el("span.wf-bar-fill", { style: "width:" + Math.round((o.hours / max) * 100) + "%" })),
          O.el("span.wf-bar-n", { text: O.hours(o.hours * 60) }));
      }))));
    return panel;
  }

  function categoryPanel(t) {
    var panel = O.panel("Where the money goes", "revenue allocated vs labor actually spent");
    var names = Object.keys(t.byCategory);
    if (!names.length) return panel.body(O.el("div.muted", { text: "No categories configured." }));

    var table = O.el("table", null,
      O.el("thead", null, O.el("tr", null,
        O.el("th", { text: "Category" }),
        O.el("th.num", { text: "Allocated" }),
        O.el("th.num", { text: "Labor spent" }),
        O.el("th.num", { text: "Hours" }),
        O.el("th.num", { text: "Left over" }))));
    var body = O.el("tbody");
    names.forEach(function (n) {
      var c = t.byCategory[n];
      var left = c.allocated - c.cost;
      body.appendChild(O.el("tr", null,
        O.el("td", { text: n }),
        O.el("td.num", { text: O.money(c.allocated) }),
        O.el("td.num", { text: O.money(c.cost) }),
        O.el("td.num", { text: O.hours(c.hours * 60) }),
        O.el("td.num", {
          style: left < 0 ? "color:var(--wf-ember);font-weight:600" : "",
          text: O.money(left)
        })));
    });
    // ReWork earns nothing, so it can only ever show as a loss -- shown apart.
    body.appendChild(O.el("tr", null,
      O.el("td", null, O.el("span", { text: "ReWork " }), O.tag("no revenue share", "late")),
      O.el("td.num", { text: "—" }),
      O.el("td.num", { style: "color:var(--wf-ember);font-weight:600", text: O.money(t.reworkCost) }),
      O.el("td.num", { text: O.hours(t.reworkHours * 60) }),
      O.el("td.num", { style: "color:var(--wf-ember);font-weight:600", text: O.money(-t.reworkCost) })));
    table.appendChild(body);
    return panel.body(table);
  }

  function jobTable(ctx, rows) {
    var priced = rows.filter(function (r) { return r.priced; })
      .sort(function (a, b) { return (a.marginPct == null ? 999 : a.marginPct) - (b.marginPct == null ? 999 : b.marginPct); });

    var panel = O.panel("Job by job", "worst margin first");
    if (!priced.length) {
      return panel.body(O.el("div.muted", { text: "No priced jobs yet — fill in $Value on a card." }));
    }

    var table = O.el("table", null,
      O.el("thead", null, O.el("tr", null,
        O.el("th", { text: "Job" }),
        O.el("th.num", { text: "Price" }),
        O.el("th.num", { text: "Labor" }),
        O.el("th.num", { text: "Rework" }),
        O.el("th.num", { text: "Margin" }),
        O.el("th.num", { text: "If no rework" }),
        O.el("th", { text: "" }))));
    var body = O.el("tbody");
    priced.slice(0, 60).forEach(function (r) {
      var hurt = r.rework.cost > 0;
      body.appendChild(O.el("tr", null,
        O.el("td", null,
          O.el("div", { style: "font-weight:600", text: r.name }),
          r.unpricedHours ? O.el("div.wf-jobsub", {
            text: O.hours(r.unpricedHours * 60) + " logged by someone with no rate set"
          }) : null),
        O.el("td.num", { text: O.money(r.price) }),
        O.el("td.num", { text: O.money(r.productionCost + r.overhead + r.enteredCost) }),
        O.el("td.num", {
          style: hurt ? "color:var(--wf-ember);font-weight:600" : "color:var(--wf-faint)",
          text: hurt ? O.money(r.rework.cost) : "—"
        }),
        O.el("td.num", {
          style: (r.marginPct != null && r.marginPct < 10) ? "color:var(--wf-ember);font-weight:600" : "",
          text: pct(r.marginPct)
        }),
        O.el("td.num", {
          style: hurt ? "color:var(--wf-ink-go)" : "color:var(--wf-faint)",
          text: hurt ? pct(r.marginPctNoRework) : "—"
        }),
        O.el("td", null, O.btn("Open", {
          small: true, quiet: true,
          onClick: function () { O.openCard({ id: r.id, shortUrl: r.url }); }
        }))));
    });
    table.appendChild(body);
    panel.body(table);
    if (priced.length > 60) {
      panel.appendChild(O.el("div.muted", { style: "padding-top:10px",
        text: "showing 60 of " + priced.length + " priced jobs" }));
    }
    return panel;
  }

  O.tab({
    id: "costing",
    label: "Job costing",
    roles: ["manager"],   // financials -- never shown to workers or office
    render: function (ctx) {
      // filter:'all' so finished and archived jobs count -- costing is a
      // look-back question, not a "what's open" one.
      return Promise.all([ctx.cards({ filter: "all" }), loadRates(ctx)]).then(function (loaded) {
        var cards = loaded[0], rates = loaded[1];
        var rows = WFCosting.buildJobRows(cards, ctx.boardCfg, rates);
        if (!rows.length) {
          return O.empty("Nothing to cost yet. Jobs need a price in $Value, or logged phase time.");
        }
        var t = WFCosting.rollup(rows);
        var origins = WFCosting.reworkOrigins(cards);

        var head = O.el("div.wf-pagehead", null,
          O.el("div.wf-h1", { text: "Job costing" }),
          O.el("div.wf-sub", {
            text: t.pricedJobs + " priced of " + t.jobs + " jobs · labor from logged time"
          }),
          O.btn("Refresh", { quiet: true, busyText: "Refreshing…", onClick: ctx.reload }));
        head.lastChild.classList.add("wf-spacer");

        var stats = O.el("div.wf-stats", null,
          O.stat("Booked", O.moneyShort(t.revenue), t.pricedJobs + " priced jobs"),
          O.stat("Margin", pct(t.marginPct), O.money(t.margin) + " after all costs"),
          O.stat("Without rework", pct(t.marginPctNoRework),
            t.marginPointsLostToRework == null ? "" : pct(t.marginPointsLostToRework) + " given up"),
          O.stat("Rework cost", O.moneyShort(t.reworkCost),
            O.hours(t.reworkHours * 60) + " across " + t.jobsWithRework + " jobs",
            t.reworkCost > 0));

        var notes = [];
        if (t.unpricedHours > 0.05) {
          notes.push(O.hours(t.unpricedHours * 60) + " of logged time has no hourly rate behind it, so labor cost is understated. Fill in the rates card or config.js hourlyRates.");
        }
        if (!t.enteredCost) {
          notes.push("Materials and consumables aren't included yet — those still come from Job Economics on each card, or a QuickBooks sync later.");
        }
        var caveat = notes.length
          ? O.el("div.wf-empty", { style: "margin-top:20px" },
              O.el("div", { style: "font-weight:600;margin-bottom:6px", text: "Worth knowing" }),
              O.el("div.muted", { text: notes.join(" ") }))
          : null;

        return O.el("div", null, head, stats,
          O.el("div.wf-panels.split", null, reworkPanel(t, origins), categoryPanel(t)),
          jobTable(ctx, rows), caveat);
      });
    }
  });
})();
