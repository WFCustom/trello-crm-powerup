/* Dashboard -- "Where the shop stands today".

   REBUILT AROUND A DIFFERENT QUESTION. The old version measured "days waiting"
   as time since any activity on the card, which a single comment reset to zero,
   and compared it to the phase's fixed allowance while ignoring the card's own
   due date. So it couldn't tell a job that is three days into a three-day phase
   and not due for a month from one that ships Friday. Now it reads real
   time-in-stage from Trello's move history and asks the question a manager
   actually has: will this job make its date? Every row shows the subtraction.

   Rows open a peek panel rather than throwing you into another tab, and the
   peek reads the board's custom fields live -- so job value and cost come off
   the card, not out of a guess.

   Wired to WFAging, WFStage, WFPricing, WFRest. */
(function () {
  "use strict";
  var O = WFOps;

  /* ------------------------------------------------------------- the rollup */

  /**
   * One pass over the cards producing everything on the page.
   *
   * Occupancy, the forecast mix and the attention list all come from the same
   * `WFAging.rows` so they can never disagree with each other -- which is a
   * thing the old dashboard did, because the meter and the list applied
   * different rules to the same cards.
   */
  function summarize(ctx, cards, moves) {
    var cfg = ctx.boardCfg;
    var out = {
      rows: [], byStage: [], inShop: 0, pendingApproval: 0, running: 0,
      minutesToday: 0, value: 0, cost: 0, priced: 0,
      forecast: null, unknownAge: 0
    };
    if (!cfg) return out;

    var rows = WFAging.rows(cfg, moves, cards.filter(function (c) {
      return !WFStage.isExcluded(ctx.board.id, c.idList);
    }));
    out.rows = rows;

    var byStage = {};
    rows.forEach(function (r) {
      var stage = r.stage;
      var key = stage.order + ":" + (stage.phase || stage.name);
      if (!byStage[key]) {
        byStage[key] = {
          order: stage.order, name: stage.phase || stage.name,
          count: 0, hot: false, oldest: 0
        };
      }
      var g = byStage[key];
      g.count++;
      g.oldest = Math.max(g.oldest, r.forecast.inStage.days || 0);
      if (r.forecast.verdict === "late" || r.forecast.verdict === "at-risk") g.hot = true;

      if (stage.isWorkPhase) out.inShop++;
      if (!r.forecast.inStage.known) out.unknownAge++;

      var work = O.activeWork(r.card);
      if (work) {
        if (work.pendingApproval) out.pendingApproval++;
        if (WFPhase.isRunning(work)) {
          out.running++;
          out.minutesToday += WFPhase.totalMinutes(work) || 0;
        }
      }

      var econ = r.card.economics;
      if (econ && econ.value) {
        out.priced++;
        out.value += Number(econ.value) || 0;
        out.cost += Number(econ.cost) || 0;
      }
    });

    out.byStage = Object.keys(byStage).map(function (k) { return byStage[k]; })
      .sort(function (a, b) { return a.order - b.order; });
    out.forecast = WFAging.summary(rows);
    return out;
  }

  /* --------------------------------------------------------------- fragments */

  /** Jobs per phase, with the longest-sitting job in each as the subtitle. */
  function bars(stages) {
    var max = Math.max.apply(null, stages.map(function (x) { return x.count; }).concat([1]));
    return O.el("div.wf-bars", null, stages.map(function (x) {
      return O.el("div.wf-bar-row" + (x.hot ? ".is-hot" : ""), null,
        O.el("span.wf-bar-label", {
          text: x.name,
          title: x.name + " — oldest has been here " + WFAging.phrase(x.oldest)
        }),
        O.el("span.wf-bar-track", null,
          O.el("span.wf-bar-fill", { style: "width:" + Math.round((x.count / max) * 100) + "%" })),
        O.el("span.wf-bar-n", { text: String(x.count) }));
    }));
  }

  /**
   * The meter, now measuring whether work will land rather than whether a
   * phase has run long. "No date set" is deliberately a visible slice: a job
   * with no due date can't be forecast at all, and that is a data problem worth
   * seeing rather than hiding in the on-track bucket.
   */
  function meter(f) {
    var total = f.total || 1;
    var seg = function (n, color) {
      return O.el("div", { style: "width:" + (n / total) * 100 + "%;background:" + color });
    };
    var legend = [
      ["On track", f.onTrack, "#1f4e79"],
      ["Cutting it fine", f.tight, "#d98324"],
      ["Won't make it", f.atRisk, "#c8471c"],
      ["Past its date", f.late, "#8f2f0f"],
      ["No date set", f.noDate, "#e6ecf2"]
    ];
    return O.frag(
      O.el("div.wf-meter", null,
        seg(f.onTrack, "#1f4e79"), seg(f.tight, "#d98324"),
        seg(f.atRisk, "#c8471c"), seg(f.late, "#8f2f0f"),
        seg(f.noDate, "#e6ecf2")),
      O.el("div.wf-legend", null, legend.map(function (r) {
        return O.el("div.wf-legend-row", null,
          O.el("span.wf-dot", { style: "background:" + r[2] }),
          document.createTextNode(r[0]),
          O.el("span.wf-legend-n", { text: r[1] + (r[1] === 1 ? " job" : " jobs") }));
      })));
  }

  /**
   * One row in "Needs a look".
   *
   * Shows both clocks side by side because they mean different things: how long
   * this phase has had the job (a process signal) and whether the job will land
   * (a customer signal). The whole row is a button -- the old version made you
   * hunt for a small link.
   */
  function attentionRow(ctx, r) {
    var f = r.forecast;
    var work = O.activeWork(r.card);
    var who = work && work.claimedBy ? O.displayName(work.claimedBy) : "nobody yet";

    var meta = O.el("div.wf-jobsub", {
      text: WFAging.stagePhrase(f.inStage) + " in " + (r.stage.phase || r.stage.name) +
            " · " + who
    });

    var overrun = r.overrun === null ? null
      : O.tag(r.overrun >= 1
          ? Math.round(r.overrun * 10) / 10 + "× its allowance"
          : "inside its allowance",
        WFAging.overrunTone(r.overrun));

    var row = O.el("button.wf-row", {
      type: "button",
      style: "grid-template-columns:1.7fr 150px 150px auto;width:100%;text-align:left;" +
             "font:inherit;color:inherit;background:none;border:0;cursor:pointer",
      onClick: function () { openPeek(ctx, r); }
    },
      O.el("div", null,
        O.el("div.wf-job", { text: r.card.name }),
        meta),
      O.el("div", { style: "font-size:13px;color:var(--wf-muted)",
                    text: WFAging.explain(f) }),
      O.el("div", null, O.tag(WFAging.verdictText(f.verdict), WFAging.verdictTone(f.verdict))),
      O.el("div.wf-actions", null, overrun));
    return row;
  }

  /* ------------------------------------------------------------------- peek */

  /**
   * The card, without leaving the dashboard.
   *
   * Custom fields are read live here. That is worth saying plainly: the Trello
   * connector used from chat can't see custom fields yet, but the Power-Up has
   * always been able to -- so job value and cost come off the card itself
   * rather than waiting on anybody's roadmap.
   */
  function openPeek(ctx, r) {
    var f = r.forecast;
    var card = r.card;
    var work = O.activeWork(card);

    var facts = O.el("div", { style: "display:grid;gap:9px" });
    var line = function (k, v, tone) {
      return O.el("div", { style: "display:flex;gap:10px;align-items:baseline" },
        O.el("div", {
          text: k,
          style: "min-width:132px;font-size:11px;letter-spacing:.07em;" +
                 "text-transform:uppercase;color:var(--wf-muted);font-weight:700"
        }),
        typeof v === "string"
          ? O.el("div", { text: v, style: "font-size:14px" + (tone ? ";color:" + tone : "") })
          : v);
    };

    facts.appendChild(line("Phase", r.stage.phase || r.stage.name));
    facts.appendChild(line("In this phase",
      WFAging.stagePhrase(f.inStage) +
      (f.inStage.known ? "" : " — moved before the last " + WFAging.WINDOW_DAYS + " days")));
    facts.appendChild(line("Due", card.due
      ? new Date(card.due).toLocaleDateString(undefined,
          { weekday: "short", month: "short", day: "numeric" })
      : "no date on the card"));
    facts.appendChild(line("Verdict",
      O.el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" },
        O.tag(WFAging.verdictText(f.verdict), WFAging.verdictTone(f.verdict)),
        O.el("span", { text: WFAging.explain(f), style: "font-size:13px;color:var(--wf-muted)" }))));
    facts.appendChild(line("Who has it",
      work && work.claimedBy ? O.displayName(work.claimedBy) : "nobody yet"));
    if (work) {
      facts.appendChild(line("Logged here", O.hours(WFPhase.totalMinutes(work) || 0) +
        " · " + (WFPhase.percentComplete(work) || 0) + "% done"));
    }

    var fields = O.el("div", { style: "margin-top:4px" },
      O.el("div.loading", { text: "Reading the card's fields…" }));

    var body = O.el("div", null, facts,
      O.el("div", { style: "height:1px;background:var(--wf-line);margin:16px 0" }),
      fields);

    WFRest.getCardFieldsDisplay(ctx.t, ctx.board.id, card.id).then(function (list) {
      fields.innerHTML = "";
      if (!list || !list.length) {
        fields.appendChild(O.el("div.muted", { style: "font-size:13px",
          text: "No custom fields filled in on this card." }));
        return;
      }
      var grid = O.el("div", { style: "display:grid;gap:8px" });
      list.forEach(function (x) { grid.appendChild(line(x.name, x.display)); });
      fields.appendChild(grid);
    }).catch(function (e) {
      fields.innerHTML = "";
      fields.appendChild(O.el("div.muted", { style: "font-size:13px",
        text: "Couldn't read the custom fields: " + ((e && e.message) || e) }));
    });

    O.dialog({
      title: card.name,
      note: "Everything the board knows about this job.",
      content: body,
      buttons: [{
        label: "Open in Trello", primary: true,
        onClick: function () { O.openCard(card); }
      }, {
        label: "Show the work board", quiet: true,
        onClick: function () { ctx.goTo("workboard"); }
      }]
    });
  }

  /* --------------------------------------------------------- price hygiene */

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
        O.el("div", null, O.tag(o.value == null ? "unusable" : "off-rule",
          o.value == null ? "late" : "warn")),
        O.el("div.wf-actions", null,
          O.btn("Fix it", { onClick: function () { O.openCard({ id: o.id, shortUrl: o.url }); } })));
    })));
    if (offRule.length > 8) {
      panel.appendChild(O.el("div.muted", { style: "padding-top:10px",
        text: "+ " + (offRule.length - 8) + " more" }));
    }
    return panel;
  }

  /* -------------------------------------------------------------------- tab */

  O.tab({
    id: "dashboard",
    label: "Dashboard",
    roles: ["manager"],   // carries margin figures
    render: function (ctx) {
      return Promise.all([
        ctx.cards(),
        // One call for the whole board's list moves -- see lib/aging.js for why
        // this isn't done per card.
        WFAging.loadMoves(ctx.t, ctx.board.id),
        // Same cached fetch ops.js already made -- no extra REST call.
        WFPricing.getBoardAudit(ctx.t, ctx.board.id).catch(function () { return []; })
      ]).then(function (loaded) {
        var cards = loaded[0], moves = loaded[1], offRule = loaded[2] || [];
        if (!ctx.boardCfg) {
          return O.empty("This board isn't mapped in config.js yet — add it to WF_CONFIG.boards to switch the dashboard on.");
        }

        var s = summarize(ctx, cards, moves);
        var f = s.forecast;
        var margin = s.value - s.cost;
        var marginPct = s.value ? Math.round((margin / s.value) * 100) : null;
        var today = new Date().toLocaleDateString(undefined,
          { weekday: "long", month: "long", day: "numeric" });

        var head = O.el("div.wf-pagehead", null,
          O.el("div.wf-h1", { text: "Where the shop stands today" }),
          O.el("div.wf-sub", { text: today + " · " + cards.length + " jobs open" }),
          O.btn("Refresh", { quiet: true, busyText: "Refreshing…", onClick: ctx.reload }));
        head.lastChild.classList.add("wf-spacer");

        var stats = O.el("div.wf-stats", null,
          O.stat("In the shop", s.inShop, "jobs being worked right now"),
          O.stat("Won't make it", f.late + f.atRisk,
            f.late + " already past, " + f.atRisk + " heading that way",
            f.late + f.atRisk > 0),
          O.stat("Waiting on you", s.pendingApproval, "phases need your sign-off"),
          O.stat("Margin on open work",
            marginPct == null ? "—" : marginPct + "%",
            O.moneyShort(s.value) + " booked · " + s.priced + " priced"));

        var occupancy = O.panel("Where the work is sitting", "jobs per phase");
        occupancy.body(bars(s.byStage));

        var health = O.panel("Will it land?", "against each card's own due date");
        health.style.display = "flex";
        health.style.flexDirection = "column";
        health.body(meter(f),
          O.el("div.wf-callout", null,
            O.el("div.wf-callout-k", { text: "On the floor right now" }),
            O.el("div.wf-callout-v", {
              text: s.running + " running · " + O.hours(s.minutesToday) + " logged"
            })));

        var worst = f.worstFirst.filter(function (r) {
          var v = r.forecast.verdict;
          return v === "late" || v === "at-risk" || v === "tight";
        });

        var list = O.panel("Needs a look", "worst first — tap a row for the whole picture",
          O.btn("Open work board", { primary: true,
            onClick: function () { ctx.goTo("workboard"); } }));
        list.body(worst.length
          ? O.el("div.wf-list", null, worst.slice(0, 8).map(function (r) {
              return attentionRow(ctx, r);
            }))
          : O.el("div.muted", { style: "padding:14px 2px",
              text: "Nothing is heading for a missed date right now." }));
        if (worst.length > 8) {
          list.appendChild(O.el("div.muted", { style: "padding-top:10px",
            text: "+ " + (worst.length - 8) + " more" }));
        }

        var notes = [];
        if (moves && moves.ok === false) {
          notes.push("Couldn't read the board's move history, so times in phase " +
            "aren't available this load.");
        } else if (moves && moves.truncated) {
          notes.push("The board's move history hit Trello's limit, so a few older " +
            "jobs may read as \"" + WFAging.WINDOW_DAYS + "+ days\" when they moved more recently.");
        }
        if (s.unknownAge) {
          notes.push(s.unknownAge + (s.unknownAge === 1 ? " job has" : " jobs have") +
            " been in the same phase longer than " + WFAging.WINDOW_DAYS +
            " days, so their age shows as a floor rather than exact.");
        }
        if (f.noDate) {
          notes.push(f.noDate + (f.noDate === 1 ? " job has" : " jobs have") +
            " no due date, so nothing can be forecast for " +
            (f.noDate === 1 ? "it" : "them") + ".");
        }

        return O.el("div", null, head, stats,
          O.el("div.wf-panels.split", null, occupancy, health), list,
          notes.length
            ? O.el("div.muted", { style: "margin-top:14px;font-size:12.5px;line-height:1.6",
                text: notes.join("  ") })
            : null,
          offRule.length ? priceCleanup(ctx, offRule) : null);
      });
    }
  });
})();
