/* Team performance -- WFMetrics rollups by person, by job, by type of work.
   Rates come from the QuickBooks-synced rates card when it exists, otherwise
   the config.js fallbacks, exactly as popups/performance.js did. */
(function () {
  "use strict";
  var O = WFOps;
  var state = { range: "all", cards: null, rates: {}, syncedAt: null };

  function sinceFor(range) {
    if (range === "all") return null;
    var d = new Date();
    d.setDate(d.getDate() - Number(range));
    return d;
  }

  function paceTag(ratio) {
    if (ratio == null) return O.tag("no target", "quiet");
    if (ratio <= 0.85) return O.tag("ahead of pace", "go");
    if (ratio <= 1.15) return O.tag("on pace", "quiet");
    return O.tag("behind pace", "warn");
  }

  function marginTag(pct) {
    if (pct == null) return O.tag("not priced", "quiet");
    if (pct < 15) return O.tag(pct + "%", "late");
    if (pct < 30) return O.tag(pct + "%", "warn");
    return O.tag(pct + "%", "go");
  }

  function personCard(p) {
    return O.el("div.wf-card", { style: "grid-template-columns:1.4fr repeat(4,1fr) auto" },
      O.el("div", { style: "display:flex;align-items:center;gap:12px" },
        O.el("div.wf-avatar", { style: "background:var(--wf-steel-2)", text: O.initials(p.fullName) }),
        O.el("div", null,
          O.el("div.wf-card-t", { text: p.fullName }),
          O.el("div.wf-card-s", { text: p.projectCount + (p.projectCount === 1 ? " job" : " jobs") + " · " + p.phasesCompleted + " phases" }))),
      O.el("div", null,
        O.el("div.wf-card-s", { text: "Hours" }),
        O.el("div.wf-card-t", { text: p.hours + "h" })),
      O.el("div", null,
        O.el("div.wf-card-s", { text: "Speed" }),
        paceTag(p.avgEfficiency)),
      O.el("div", null,
        O.el("div.wf-card-s", { text: "Revenue share" }),
        O.el("div.wf-card-t", { text: O.money(p.attributedMargin) })),
      O.el("div", null,
        O.el("div.wf-card-s", { text: "Net contribution" }),
        O.el("div.wf-card-t", {
          text: p.netContribution != null ? O.money(p.netContribution) : "—",
          style: p.netContribution != null && p.netContribution < 0 ? "color:var(--wf-ember)" : ""
        })),
      O.el("div.wf-actions", null,
        O.el("div.wf-card-s", { text: p.laborCost != null ? O.money(p.laborCost) + " labor" : "no rate on file" })));
  }

  function build(ctx) {
    var since = sinceFor(state.range);
    var projects = WFMetrics.buildProjectRollup(state.cards, ctx.boardCfg);
    var byType = WFMetrics.groupProjectsByType(projects)
      .sort(function (a, b) { return (b.marginPct || 0) - (a.marginPct || 0); });
    var people = WFMetrics.buildPersonRollup(state.cards, ctx.board.id, since, state.rates);
    var priced = projects.filter(function (p) { return p.value != null; });

    var totalValue = priced.reduce(function (s, p) { return s + (p.value || 0); }, 0);
    var totalCost = priced.reduce(function (s, p) { return s + (p.cost || 0); }, 0);
    var blended = totalValue ? Math.round(((totalValue - totalCost) / totalValue) * 100) : null;
    var totalHours = people.reduce(function (s, p) { return s + (p.hours || 0); }, 0);

    var picker = O.el("select", { style: "width:auto;min-width:160px" },
      O.el("option", { value: "all", text: "All-time" }),
      O.el("option", { value: "90", text: "Last 90 days" }),
      O.el("option", { value: "30", text: "Last 30 days" }));
    picker.value = state.range;
    picker.addEventListener("change", function () {
      state.range = picker.value;
      WFOps.goTo("performance");
    });

    var head = O.el("div.wf-pagehead", null,
      O.el("div.wf-h1", { text: "How the team is doing" }),
      O.el("div.wf-sub", {
        text: Object.keys(state.rates).length
          ? Object.keys(state.rates).length + " rates from QuickBooks" +
            (state.syncedAt ? " · synced " + state.syncedAt : "")
          : "No QuickBooks rates synced — falling back to config.js"
      }),
      picker);
    picker.classList.add("wf-spacer");

    var stats = O.el("div.wf-stats", null,
      O.stat("People logging work", people.length, "in this range"),
      O.stat("Hours logged", Math.round(totalHours) + "h", "approved phase work"),
      O.stat("Blended margin", blended == null ? "—" : blended + "%", O.moneyShort(totalValue) + " of priced work"),
      O.stat("Jobs priced", priced.length + " / " + projects.length, "value and cost entered"));

    var peoplePanel = O.panel("By person", state.range === "all" ? "all-time" : "last " + state.range + " days");
    peoplePanel.body(people.length
      ? O.el("div.wf-cards", { style: "margin:0" }, people.map(personCard))
      : O.el("div.muted", { style: "padding:12px 2px", text: "No approved phase work logged in this range." }));

    var typePanel = O.panel("By type of work", "best margin first");
    var typeTable = O.el("table", { html:
      "<thead><tr><th>Type</th><th class='num'>Jobs</th><th class='num'>Value</th><th class='num'>Cost</th><th>Margin</th></tr></thead>" });
    var tbody = O.el("tbody");
    byType.forEach(function (b) {
      var tr = O.el("tr", { html:
        "<td>" + O.esc(b.type) + "</td><td class='num'>" + b.count + "</td><td class='num'>" +
        O.money(b.sumValue) + "</td><td class='num'>" + O.money(b.sumCost) + "</td><td></td>" });
      tr.lastElementChild.appendChild(marginTag(b.marginPct));
      tbody.appendChild(tr);
    });
    if (!byType.length) tbody.innerHTML = '<tr><td colspan="5" class="muted">Nothing priced yet.</td></tr>';
    typeTable.appendChild(tbody);
    typePanel.body(typeTable);

    var jobPanel = O.panel("Jobs to watch", "thinnest margin first");
    var jobTable = O.el("table", { html:
      "<thead><tr><th>Job</th><th>Type</th><th>Status</th><th class='num'>Value</th><th class='num'>Cost</th><th>Margin</th><th class='num'>Hours</th></tr></thead>" });
    var jbody = O.el("tbody");
    priced.slice().sort(function (a, b) { return (a.marginPct || 0) - (b.marginPct || 0); })
      .slice(0, 12).forEach(function (p) {
        var tr = O.el("tr", { html:
          "<td>" + O.esc(p.name) + "</td><td>" + O.esc(p.type) + "</td><td>" + O.esc(p.status) +
          "</td><td class='num'>" + O.money(p.value) + "</td><td class='num'>" + O.money(p.cost) +
          "</td><td></td><td class='num'>" + Math.round(p.totalMinutes / 6) / 10 + "h</td>" });
        tr.children[5].appendChild(marginTag(p.marginPct));
        jbody.appendChild(tr);
      });
    if (!priced.length) jbody.innerHTML = '<tr><td colspan="7" class="muted">No jobs with value and cost entered yet.</td></tr>';
    jobTable.appendChild(jbody);
    jobPanel.body(jobTable);

    var note = O.el("p.muted", { text:
      "Revenue share splits each job's margin by each person's share of the logged hours on it — an estimate, not accounting. " +
      "Net contribution only appears where an hourly rate is on file." });

    return O.el("div", null, head, stats, peoplePanel,
      O.el("div.wf-panels.halves", null, typePanel, jobPanel), note);
  }

  O.tab({
    id: "performance",
    label: "Performance",
    managerOnly: true,
    render: function (ctx) {
      return Promise.all([
        ctx.cards({ filter: "all" }),
        WFRest.getLiveRatesCardDesc(ctx.t).catch(function () { return null; })
      ]).then(function (r) {
        state.cards = r[0];
        state.rates = r[1] ? WFMetrics.parseRatesCardDesc(r[1]) : {};
        var m = r[1] && r[1].match(/Last synced:\s*(.+)/);
        state.syncedAt = m ? m[1].trim() : null;
        return build(ctx);
      });
    }
  });
})();
