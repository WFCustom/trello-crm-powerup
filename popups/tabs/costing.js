/* Job costing -- what each job actually cost, and what rework is costing us.
   Labor comes from logged phase time x hourly rate (no hand entry). ReWork is
   held out as its own cost line so its effect on margin is visible.
   Wired to WFCosting + WFRest.getLiveRatesCardDesc + WFMetrics.parseRatesCardDesc. */
(function () {
  "use strict";
  var O = WFOps;

  /* Rate precedence, least to most authoritative: config.js seed, then rates
     typed into the Roster, then a live QuickBooks sync. Typing over a synced
     rate would only be overwritten on the next run, so QuickBooks wins. */
  function loadRates(ctx) {
    var merged = {};
    var seed = (window.WF_CONFIG && window.WF_CONFIG.hourlyRates) || {};
    Object.keys(seed).forEach(function (k) { merged[k] = seed[k]; });
    var fromRoster = (ctx.roster && ctx.roster.rates) || {};
    Object.keys(fromRoster).forEach(function (k) { merged[k] = fromRoster[k]; });

    return WFRest.getLiveRatesCardDesc(ctx.t).then(function (desc) {
      var live = WFMetrics.parseRatesCardDesc(desc) || {};
      Object.keys(live).forEach(function (k) { merged[k] = live[k]; });
      return merged;
    }).catch(function () { return merged; });
  }

  function pct(n) { return n == null ? "—" : (Math.round(n * 10) / 10) + "%"; }

  var timeframe = "all";   // survives tab switches within a session

  function timeframeBar(ctx) {
    var row = O.el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px" });
    WFCosting.TIMEFRAMES.forEach(function (tf) {
      var on = tf.key === timeframe;
      var b = O.btn(tf.label, {
        small: true, primary: on, quiet: !on,
        onClick: function () { timeframe = tf.key; return ctx.reload(); }
      });
      row.appendChild(b);
    });
    row.appendChild(O.el("div.wf-card-s", { style: "margin-left:auto;align-self:center",
      text: "measured from when the job entered CAD" }));
    return row;
  }

  /* A pie needs a visible canvas before Chart.js can size it, so build after
     the node is in the document. */
  function pie(title, slices) {
    var total = slices.reduce(function (a, s) { return a + s.value; }, 0);
    var panel = O.panel(title, total ? O.money(total) + " total" : "nothing to show yet");
    if (!total) return panel.body(O.el("div.muted", { text: "No figures entered for this period." }));
    var box = O.el("div.chart-box", { style: "height:240px" });
    var canvas = O.el("canvas");
    box.appendChild(canvas);
    panel.body(box);
    setTimeout(function () {
      if (!canvas.isConnected || typeof Chart === "undefined") return;
      new Chart(canvas.getContext("2d"), {
        type: "doughnut",
        data: {
          labels: slices.map(function (s) { return s.label; }),
          datasets: [{ data: slices.map(function (s) { return Math.round(s.value); }),
                       backgroundColor: slices.map(function (s) { return s.color; }),
                       borderWidth: 0 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: "58%",
          plugins: { legend: { position: "right", labels: { boxWidth: 12, font: { size: 12 } } } }
        }
      });
    }, 0);
    return panel;
  }

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

  /* Type real costs against a job and watch the margin move. Saved to the
     card, so it follows the job rather than living in a spreadsheet. */
  function openActuals(ctx, row) {
    function field(label, val) {
      var i = O.el("input", { type: "number", min: "0", step: "1", value: val ? String(val) : "" });
      return { label: label, input: i,
        node: O.el("div", { style: "margin-bottom:12px" }, O.el("label", { text: label }), i) };
    }
    var mats = field("Materials ($)", row.materials);
    var cons = field("Consumables ($)", row.consumables);
    var other = field("Other ($)", row.otherCost);
    var live = O.el("div.wf-callout", { style: "margin-top:4px" },
      O.el("div.wf-callout-k", { text: "Margin as you type" }),
      O.el("div.wf-callout-v", { text: "—" }));

    function recalc() {
      var entered = (Number(mats.input.value) || 0) + (Number(cons.input.value) || 0) +
                    (Number(other.input.value) || 0);
      var cost = row.productionCost + row.overhead + row.rework.cost + entered;
      var m = row.price - cost;
      live.lastChild.textContent = row.price
        ? O.money(m) + "  (" + pct((m / row.price) * 100) + ")"
        : "set a price first";
    }
    [mats, cons, other].forEach(function (f) { f.input.addEventListener("input", recalc); });
    recalc();

    O.dialog({
      title: "Actual costs",
      note: row.name + " · " + O.money(row.price) + " booked · labour " +
            O.money(row.productionCost + row.rework.cost) + " from logged time",
      content: O.el("div", null, mats.node, cons.node, other.node, live),
      buttons: [{
        label: "Save", primary: true, busyText: "Saving…",
        onClick: function () {
          return ctx.t.get(row.id, "shared", "economics", null).then(function (econ) {
            econ = econ || {};
            econ.actuals = {
              materials: Number(mats.input.value) || 0,
              consumables: Number(cons.input.value) || 0,
              other: Number(other.input.value) || 0
            };
            return ctx.t.set(row.id, "shared", "economics", econ);
          }).then(function () { return ctx.reload(); });
        }
      }]
    });
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
        O.el("td", null, O.el("div", { style: "display:flex;gap:6px;justify-content:flex-end" },
          O.btn("Costs", {
            small: true,
            onClick: function () { openActuals(ctx, r); }
          }),
          O.btn("Open", {
            small: true, quiet: true,
            onClick: function () { O.openCard({ id: r.id, shortUrl: r.url }); }
          })))));
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
        var allCards = loaded[0], rates = loaded[1];
        var cards = allCards.filter(function (c) {
          return WFCosting.withinTimeframe(c, timeframe);
        });
        var rows = WFCosting.buildJobRows(cards, ctx.boardCfg, rates);
        if (!rows.length) {
          return O.empty("Nothing to cost yet. Jobs need a price in $Value, or logged phase time.");
        }
        var t = WFCosting.rollup(rows);
        var origins = WFCosting.reworkOrigins(cards);

        var head = O.el("div.wf-pagehead", null,
          O.el("div.wf-h1", { text: "Job costing" }),
          O.el("div.wf-sub", {
            text: t.pricedJobs + " priced of " + t.jobs + " jobs · " +
                  (WFCosting.TIMEFRAMES.filter(function (x) { return x.key === timeframe; })[0] || {}).label +
                  " · labour from logged time"
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

        var costPie = pie("Where the money goes", [
          { label: "Labour", value: t.productionCost, color: "#1f4e79" },
          { label: "Materials", value: t.materials, color: "#4d7ba6" },
          { label: "Consumables", value: t.consumables, color: "#7ea3c4" },
          { label: "Overhead", value: t.overhead, color: "#d98324" },
          { label: "Other", value: t.otherCost, color: "#8b97a3" },
          { label: "Rework", value: t.reworkCost, color: "#c8471c" }
        ].filter(function (s2) { return s2.value > 0; }));

        var revPie = pie("Revenue by category",
          Object.keys(t.byCategory).map(function (n, i) {
            return { label: n, value: t.byCategory[n].allocated,
                     color: ["#1f4e79", "#b07d2b", "#7a5ea8", "#1f6f4a"][i % 4] };
          }).filter(function (s2) { return s2.value > 0; }));

        return O.el("div", null, head, timeframeBar(ctx), stats,
          O.el("div.wf-panels.halves", null, costPie, revPie),
          O.el("div.wf-panels.split", null, reworkPanel(t, origins), categoryPanel(t)),
          jobTable(ctx, rows), caveat);
      });
    }
  });
})();
