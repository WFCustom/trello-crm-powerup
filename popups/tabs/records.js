/* Records -- what happened. Time worked, quality checks, safety, training.

   One tab with a rail rather than four tabs, because the tab bar is already
   long and these four are the same kind of thing: history you come to with a
   question, not a surface you watch. See lib/records.js for where each one is
   stored and why.

   Read-only, with two exceptions that write nowhere near a job card: filing a
   safety report (a card on the WF Safety board) and editing training records
   (Power-Up board data). Wired to WFRecords. */
(function () {
  "use strict";
  var O = WFOps;

  /**
   * A small sheet of its own. Deliberately thin: this tab leans on the existing
   * ops skin (panels, stats, rows, tags) and only adds the rail and a couple of
   * table rules, rather than carrying a second design language the way the
   * Floor tab has to for a screen read across a room.
   */
  (function injectStyles() {
    if (document.getElementById("wf-rec-styles")) return;
    var css = [
      ".wf-rec-rail{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:18px}",
      ".wf-rec-r{cursor:pointer;font:inherit;font-size:13px;font-weight:600;padding:8px 16px;",
      "border-radius:999px;border:1px solid var(--wf-line);background:#fff;color:var(--wf-muted)}",
      ".wf-rec-r:hover{border-color:var(--wf-steel-2);color:var(--wf-steel)}",
      ".wf-rec-r.is-on{background:var(--wf-navy);border-color:var(--wf-navy);color:#fff}",
      ".wf-rec-r em{font-style:normal;opacity:.6;margin-left:6px;font-weight:600}",
      ".wf-rec-r.is-on em{opacity:.8}",
      ".wf-rec-t{width:100%;border-collapse:collapse;font-size:13.5px}",
      ".wf-rec-t th{text-align:left;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;",
      "color:var(--wf-muted);font-weight:700;padding:8px 10px;border-bottom:1px solid var(--wf-line)}",
      ".wf-rec-t td{padding:9px 10px;border-bottom:1px solid var(--wf-band)}",
      ".wf-rec-t td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}",
      ".wf-rec-t tr:last-child td{border-bottom:0}",
      ".wf-rec-bar{height:6px;border-radius:999px;background:var(--wf-band);overflow:hidden;",
      "min-width:60px}",
      ".wf-rec-bar i{display:block;height:100%;background:var(--wf-steel-2)}",
      ".wf-rec-note{background:var(--wf-band);border-radius:12px;padding:12px 14px;",
      "font-size:13px;line-height:1.55;color:var(--wf-muted)}",
      ".wf-rec-csv{width:100%;min-height:220px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;",
      "font-size:11.5px;line-height:1.45;padding:10px;border:1px solid var(--wf-line);",
      "border-radius:10px;background:var(--wf-ground);white-space:pre;overflow:auto}",
      ".wf-rec-f{display:flex;flex-direction:column;gap:5px;margin-bottom:14px}",
      ".wf-rec-f label{font-size:11px;letter-spacing:.07em;text-transform:uppercase;",
      "color:var(--wf-muted);font-weight:700}",
      ".wf-rec-f .hint{font-size:11.5px;color:var(--wf-faint)}",
      ".wf-rec-f input,.wf-rec-f textarea,.wf-rec-f select{font:inherit;font-size:14px;",
      "padding:9px 11px;border:1px solid var(--wf-line);border-radius:11px;background:#fff;",
      "color:var(--wf-text);width:100%}",
      ".wf-rec-f textarea{resize:vertical;line-height:1.5}"
    ].join("");
    var tag = document.createElement("style");
    tag.id = "wf-rec-styles";
    tag.textContent = css;
    document.head.appendChild(tag);
  })();

  /* Module-level so leaving and coming back keeps your place. */
  var state = {
    section: null, days: 90, query: "",
    cards: null, safety: null, training: null,
    host: null, ctx: null
  };

  function add(p, n) { if (n) p.appendChild(n); return p; }

  /**
   * Time and Quality name individuals and their hours; Safety and Training are
   * everybody's. A worker who opens this tab gets the two that are theirs,
   * rather than a tab that refuses to open.
   */
  var SECTIONS = [
    { id: "time", label: "Time", cap: "see.timers", roles: ["manager", "office"] },
    { id: "quality", label: "Quality", cap: "qc.sign", roles: ["manager", "office"] },
    { id: "safety", label: "Safety", cap: "safety.view" },
    { id: "training", label: "Training" }
  ];

  function allowed(ctx, s) {
    // The board's own answer when there is one, the old fixed one otherwise.
    // Safety is the case that makes this worth doing: everyone may FILE a
    // report, and who may READ them is a decision this shop should own rather
    // than inherit from a role name I chose.
    if (s.cap && typeof ctx.can === "function") return ctx.can(s.cap);
    return !s.roles || s.roles.indexOf(ctx.role) !== -1;
  }

  function visibleSections(ctx) {
    return SECTIONS.filter(function (s) { return allowed(ctx, s); });
  }

  /* --------------------------------------------------------------- loading */

  function paint() {
    if (!state.host) return;
    state.host.innerHTML = "";
    add(state.host, header());
    add(state.host, rail());
    add(state.host, section());
  }

  function refresh() {
    var ctx = state.ctx;
    return Promise.all([
      ctx.cards(),
      WFRecords.loadSafety(ctx.t).catch(function (e) { return { error: e, reports: [], lists: [] }; }),
      WFRecords.getTraining(ctx.t)
    ]).then(function (r) {
      state.cards = r[0];
      state.safety = r[1];
      state.training = r[2];
      paint();
    }).catch(function (e) {
      if (!state.host) return;
      state.host.innerHTML = "";
      state.host.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "Couldn't load the records." }),
        O.el("div.muted", { text: (e && e.message) || String(e) }),
        O.btn("Try again", { onClick: refresh })));
    });
  }

  /* ---------------------------------------------------------------- chrome */

  function header() {
    var head = O.el("div.wf-pagehead", null,
      O.el("div.wf-h1", { text: "Records" }),
      O.el("div.wf-sub", { text: "What happened — hours, quality, safety, training" }),
      O.btn("Refresh", { quiet: true, busyText: "Refreshing…",
        onClick: function () { return state.ctx.reload().then(refresh); } }));
    head.lastChild.classList.add("wf-spacer");
    return head;
  }

  function railCount(id) {
    if (id === "time") return null;
    if (id === "quality") return null;
    if (id === "safety") {
      return ((state.safety && state.safety.reports) || [])
        .filter(function (r) { return r.status !== "closed"; }).length;
    }
    if (id === "training") {
      var s = WFRecords.trainingSummary(state.training || []);
      return s.expired + s.expiring;
    }
    return null;
  }

  function rail() {
    var row = O.el("div.wf-rec-rail");
    visibleSections(state.ctx).forEach(function (s) {
      var b = O.el("button.wf-rec-r" + (state.section === s.id ? ".is-on" : ""), {
        type: "button",
        onClick: function () { state.section = s.id; state.query = ""; paint(); }
      }, O.el("span", { text: s.label }));
      var n = railCount(s.id);
      if (n) b.appendChild(O.el("em", { text: String(n) }));
      row.appendChild(b);
    });
    return row;
  }

  function section() {
    switch (state.section) {
      case "time": return timeView();
      case "quality": return qualityView();
      case "safety": return safetyView();
      case "training": return trainingView();
      default: return O.empty("Nothing to show.");
    }
  }

  function periodPicker() {
    var sel = O.el("select");
    [[30, "Last 30 days"], [90, "Last 90 days"], [365, "Last year"], [0, "Everything"]]
      .forEach(function (p) {
        var o = O.el("option", { value: String(p[0]), text: p[1] });
        if (p[0] === state.days) o.selected = true;
        sel.appendChild(o);
      });
    sel.style.cssText = "font:inherit;font-size:13px;padding:6px 10px;border-radius:999px;" +
      "border:1px solid var(--wf-line);background:#fff";
    sel.addEventListener("change", function () {
      state.days = parseInt(sel.value, 10) || 0;
      paint();
    });
    return sel;
  }

  /* ------------------------------------------------------------------ time */

  function timeView() {
    var all = WFRecords.timeEntries(state.cards);
    var entries = WFRecords.since(all, state.days);
    var open = WFRecords.openEntries(state.cards);
    var s = WFRecords.timeSummary(entries);
    var wrap = O.el("div");

    var right = O.el("div", { style: "display:flex;gap:8px;align-items:center" },
      periodPicker(),
      O.btn("Export", { onClick: function () { openExport(entries); } }));
    var head = O.el("div.wf-pagehead", { style: "margin-bottom:14px" },
      O.el("div.wf-h2", { text: "Time worked", style: "font-size:19px;font-weight:700" }));
    right.classList.add("wf-spacer");
    head.appendChild(right);
    wrap.appendChild(head);

    if (!entries.length) {
      wrap.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "No finished phases recorded in this period." }),
        O.el("div.muted", { text: "A phase lands here once a manager approves it, " +
          "so the log fills up as work is signed off." })));
      return wrap;
    }

    wrap.appendChild(O.el("div.wf-stats", null,
      O.stat("Hours logged", Math.round(s.hours), s.entries + " finished phases"),
      O.stat("Jobs touched", Object.keys(s.byJob).length, "in this period"),
      O.stat("Hours per $1,000",
        s.hoursPerThousand === null ? "—" : round1(s.hoursPerThousand),
        s.enough ? "median across " + s.jobsPriced + " priced jobs"
                 : "needs 5 priced jobs, have " + s.jobsPriced),
      O.stat("Revenue per hour",
        s.revenuePerHour === null ? "—" : O.money(s.revenuePerHour),
        s.enough ? "median" : "not enough data yet")));

    if (!s.enough) {
      wrap.appendChild(O.el("div.wf-rec-note", { style: "margin-bottom:14px",
        text: "The two ratios stay blank until at least five priced jobs have " +
              "finished phases in the period. A build-time standard set from " +
              "three jobs would be worse than no standard — it would just be " +
              "confidently wrong. Keep signing work off and they'll fill in." }));
    }

    var byPhase = O.panel("By phase", "where the hours actually go");
    byPhase.body(table(WFRecords.sortedGroups(s.byPhase), s.hours));
    var byPerson = O.panel("By person", "hours signed off in this period");
    byPerson.body(table(WFRecords.sortedGroups(s.byPerson), s.hours));
    wrap.appendChild(O.el("div.wf-panels.split", null, byPhase, byPerson));

    if (open.length) {
      var running = O.panel("Running right now",
        "not counted in anything above — a half-finished phase isn't a build time");
      running.body(O.el("table.wf-rec-t", null,
        O.el("tbody", null, open.map(function (e) {
          return O.el("tr", null,
            O.el("td", { text: e.job }),
            O.el("td", { text: e.who || "unclaimed" }),
            O.el("td.n", { text: O.hours(e.minutes) }));
        }))));
      wrap.appendChild(running);
    }
    return wrap;
  }

  function table(groups, totalHours) {
    var max = Math.max.apply(null, groups.map(function (g) { return g.hours; }).concat([1]));
    return O.el("table.wf-rec-t", null,
      O.el("thead", null, O.el("tr", null,
        O.el("th", { text: "" }), O.el("th", { text: "Hours" }),
        O.el("th", { text: "Phases" }), O.el("th", { text: "Share" }))),
      O.el("tbody", null, groups.slice(0, 12).map(function (g) {
        return O.el("tr", null,
          O.el("td", { text: g.key }),
          O.el("td.n", { text: round1(g.hours) }),
          O.el("td.n", { text: String(g.count) }),
          O.el("td", { style: "width:90px" },
            O.el("div.wf-rec-bar", null,
              O.el("i", { style: "width:" + Math.round((g.hours / max) * 100) + "%" }))));
      })));
  }

  /**
   * The export, as text you can see before you take it.
   *
   * A download inside a Trello iframe is at the mercy of the sandbox, so the
   * CSV is shown in full and offered as a file — if the download is blocked,
   * select-all and copy still works and nobody is stuck.
   */
  function openExport(entries) {
    var csv = WFRecords.toCSV(entries);
    var box = O.el("textarea.wf-rec-csv", { readonly: true, spellcheck: "false" });
    box.value = csv;

    var body = O.el("div", null,
      O.el("div.wf-rec-note", { style: "margin-bottom:12px",
        text: "One row per approved phase, with the job's value alongside. This " +
              "is the raw material for a real build-time standard — hours per " +
              "$1,000, per phase, per job type — once there are a couple of " +
              "months of it." }),
      box);

    var dlg = O.dialog({
      title: "Export the time log",
      note: entries.length + " finished phases",
      content: body,
      buttons: [{
        label: "Download CSV",
        primary: true,
        onClick: function () {
          try {
            var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = url;
            a.download = "wf-time-log-" + new Date().toISOString().slice(0, 10) + ".csv";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
          } catch (e) {
            global_alert("The download was blocked — select the text and copy it instead.");
          }
        }
      }]
    });
    box.focus();
    box.select();
    return dlg;
  }

  function global_alert(m) { try { window.alert(m); } catch (e) { /* nothing else to do */ } }

  /* --------------------------------------------------------------- quality */

  function qualityView() {
    var all = WFRecords.qcEntries(state.cards);
    var entries = WFRecords.since(all, state.days);
    var s = WFRecords.qcSummary(entries);
    var wrap = O.el("div");

    var head = O.el("div.wf-pagehead", { style: "margin-bottom:14px" },
      O.el("div.wf-h2", { text: "Quality checks", style: "font-size:19px;font-weight:700" }));
    var right = periodPicker();
    right.classList.add("wf-spacer");
    head.appendChild(right);
    wrap.appendChild(head);

    if (!entries.length) {
      wrap.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "No quality checks recorded in this period." }),
        O.el("div.muted", { text: "Checks land here as they're signed in the Quality check tab." })));
      return wrap;
    }

    wrap.appendChild(O.el("div.wf-stats", null,
      // Every round recorded, including self-checks nobody has finished. The
      // pass rate beside it is over the judged rounds only, so the count says
      // how many are still in progress rather than leaving the two numbers
      // looking like they disagree.
      O.stat("Checks", s.rounds, s.unfinished
        ? "rounds recorded · " + s.unfinished + " still in progress"
        : "rounds recorded"),
      O.stat("Passed first time", s.passRate === null ? "—" : s.passRate + "%", ""),
      O.stat("Sent back", s.failed, "rounds with a failed line", s.failed > 0),
      // Still open, right now, somewhere on a bench. Distinct from "sent back",
      // which counts rounds historically -- this one is a to-do.
      O.stat("Faults still open", s.openFaults,
        s.openFaults ? "jobs waiting on an answer" : "every fault answered",
        s.openFaults > 0)));

    if (s.topFailures.length) {
      /* THIS IS THE TRAINING MATERIAL, SO IT SHOWS THE ANSWERS.
       *
       * A tally alone says "dimensions match the measure sheet, 11 times" —
       * which tells you there is a problem and nothing whatever about it. What
       * people wrote when they fixed it is the lesson: eleven different answers
       * means eleven different causes and the line is worded too vaguely;
       * eleven identical answers is one process to change tomorrow.
       *
       * The phase is named for the same reason. A line failing everywhere is a
       * wording problem; a line failing only at one bench is a bench problem,
       * and those want opposite responses. */
      var repeat = O.panel("What fails most",
        "the same line failing repeatedly is a process to change, not a bad day");
      repeat.body(O.el("div.wf-list", null, s.topFailures.map(function (f) {
        var row = O.el("div", { style: "padding:11px 0;border-bottom:1px solid var(--wf-band)" },
          O.el("div", { style: "display:flex;gap:10px;align-items:baseline" },
            O.el("div.wf-job", { text: f.text, style: "flex:1" }),
            O.el("div.n", { text: f.n + (f.n === 1 ? " time" : " times") })));
        if (f.worstPhase) {
          row.appendChild(O.el("div.wf-jobsub", {
            text: "most often in " + f.worstPhase
          }));
        }
        if (f.fixes.length) {
          row.appendChild(O.el("div.muted", {
            style: "font-size:12.5px;margin-top:6px",
            text: "What was done: " + f.fixes.slice(0, 3).join(" · ") +
                  (f.fixes.length > 3 ? " …" : "")
          }));
        } else if (f.notes.length) {
          row.appendChild(O.el("div.muted", {
            style: "font-size:12.5px;margin-top:6px",
            text: "Reported as: " + f.notes.slice(0, 3).join(" · ")
          }));
        }
        return row;
      })));
      wrap.appendChild(repeat);
    }

    var recent = O.panel("Recent checks", "newest first");
    recent.body(O.el("div.wf-list", null, entries.slice(0, 20).map(function (e) {
      var meta = [e.phase, e.checkedBy, e.at ? when(e.at) : ""].filter(Boolean).join(" · ");
      var row = O.el("div.wf-row", { style: "grid-template-columns:1.6fr 1.4fr 120px" },
        O.el("div", null,
          O.el("div.wf-job", { text: e.job }),
          O.el("div.wf-jobsub", { text: meta })),
        /* AN UNFINISHED CHECK IS NOT REPORTED AS A FAILED ONE.
         *
         * A self-check stores unticked lines as "fail", meaning "not finished".
         * The summary above now sets those rounds aside — but this list was
         * still painting them red as "round 1 failed" and naming the unticked
         * lines as though somebody had rejected them. One panel saying a check
         * was set aside above another calling it a failure is the kind of
         * contradiction that makes people stop trusting the whole screen. */
        O.el("div", { style: "font-size:13px;color:var(--wf-muted)",
          text: e.unfinished
            ? (e.items - e.failed.length) + " of " + e.items + " lines ticked so far"
            : e.failed.length
              ? e.failed.map(function (f) {
                  return f.text + (f.fixed ? " → " + f.fix : "");
                }).join("; ")
              : "all " + e.items + " lines checked" }),
        O.el("div", null,
          e.unfinished ? O.tag("in progress", "quiet")
            : e.passed ? O.tag("passed", "go")
            : O.tag("round " + e.round + " failed", "late")));
      return row;
    })));
    wrap.appendChild(recent);
    return wrap;
  }

  /* ---------------------------------------------------------------- safety */

  function safetyView() {
    var data = state.safety || { reports: [], lists: [] };
    var reports = data.reports || [];
    var s = WFRecords.safetySummary(reports);
    var wrap = O.el("div");

    var head = O.el("div.wf-pagehead", { style: "margin-bottom:14px" },
      O.el("div.wf-h2", { text: "Safety", style: "font-size:19px;font-weight:700" }));
    var file = O.btn("Report something", { primary: true, onClick: openSafetyForm });
    file.classList.add("wf-spacer");
    head.appendChild(file);
    wrap.appendChild(head);

    if (data.error) {
      wrap.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "Couldn't reach the safety board." }),
        O.el("div.muted", { text: (data.error.message || String(data.error)) })));
      return wrap;
    }

    wrap.appendChild(O.el("div.wf-stats", null,
      O.stat("Days since an injury",
        s.daysSinceInjury === null ? "—" : Math.floor(s.daysSinceInjury),
        s.daysSinceInjury === null ? "none recorded" : ""),
      O.stat("Still open", s.open, "reports not closed out", s.open > 0),
      O.stat("Last 30 days", s.last30, "reports filed"),
      O.stat("Near misses", s.byKind["Near miss"] || 0, "the ones that predict injuries")));

    wrap.appendChild(O.el("div.wf-rec-note", { style: "margin:0 0 14px",
      text: "Anyone can report, and you can leave your name off it. A near miss " +
            "nobody writes down is the one that comes back as an injury." }));

    if (!reports.length) {
      wrap.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "Nothing reported yet." })));
      return wrap;
    }

    var openList = reports.filter(function (r) { return r.status !== "closed"; });
    var closed = reports.filter(function (r) { return r.status === "closed"; });

    if (openList.length) {
      var p = O.panel("Open", "newest first");
      p.body(O.el("div.wf-list", null, openList.map(reportRow)));
      wrap.appendChild(p);
    }
    if (closed.length) {
      var c = O.panel("Closed out", closed.length + " dealt with");
      c.body(O.el("div.wf-list", null, closed.slice(0, 10).map(reportRow)));
      wrap.appendChild(c);
    }
    return wrap;
  }

  function reportRow(r) {
    var tone = r.kind === "Injury" ? "late" : r.kind === "Near miss" ? "warn" : "quiet";
    return O.el("div.wf-row", { style: "grid-template-columns:1.7fr 130px 140px auto" },
      O.el("div", null,
        O.el("div.wf-job", { text: r.name }),
        O.el("div.wf-jobsub", {
          text: [r.at ? when(r.at) : "", r.owner ? O.displayName(r.owner) : "nobody on it"]
            .filter(Boolean).join(" · ")
        })),
      O.el("div", null, O.tag(r.kind, tone)),
      O.el("div", { style: "font-size:13px;color:var(--wf-muted)", text: r.list }),
      O.el("div.wf-actions", null,
        O.el("a.wf-btn.wf-btn-quiet.wf-btn-sm", {
          href: r.url, target: "_blank", rel: "noopener",
          text: "Open", style: "text-decoration:none"
        })));
  }

  /**
   * The report form. Three questions, and the name is optional.
   *
   * The anonymous box is not a nicety. Somebody who will only report a near
   * miss without their name attached should still be able to report it; the
   * event is what matters, and insisting on attribution just buys fewer
   * reports and a worse picture of the shop.
   */
  function openSafetyForm() {
    var data = state.safety || { lists: [], labels: [] };
    var head = O.el("input", { type: "text",
      placeholder: "e.g. Nearly walked into the forklift by the blast booth" });

    var kind = O.el("select");
    WFRecords.KINDS.forEach(function (k) {
      kind.appendChild(O.el("option", { value: k.name, text: k.name }));
    });

    var anon = O.el("input", { type: "checkbox" });

    var body = O.el("div", null,
      field("Headline", "Short — what it was, in a few words.", head),
      field("What kind?", null, kind));

    var inputs = {};
    WFRecords.INTAKE.forEach(function (q) {
      var ta = O.el("textarea", { rows: String(q.rows || 3) });
      inputs[q.key] = ta;
      body.appendChild(field(q.label + (q.required ? "" : " (optional)"), q.hint, ta));
    });

    body.appendChild(O.el("label", {
      style: "display:flex;gap:9px;align-items:center;font-size:14px;margin-top:4px"
    }, anon, O.el("span", { text: "Leave my name off it" })));

    O.dialog({
      title: "Report something",
      note: "This goes on the safety board. Nobody is in trouble for filing one.",
      content: body,
      buttons: [{
        label: "File it", primary: true, busyText: "Filing…",
        onClick: function () {
          var answers = {};
          Object.keys(inputs).forEach(function (k) { answers[k] = inputs[k].value; });
          if (!String(head.value || "").trim()) {
            return Promise.reject(new Error("Give it a short headline first."));
          }
          if (!String(answers.what || "").trim()) {
            return Promise.reject(new Error("Say what happened — the first box."));
          }
          return WFRecords.fileSafety(state.ctx.t, data, {
            name: head.value, kind: kind.value, answers: answers,
            anonymous: anon.checked, filer: state.ctx.member
          }).then(function () {
            return WFRecords.loadSafety(state.ctx.t).then(function (d) {
              state.safety = d;
              state.section = "safety";
              paint();
            });
          });
        }
      }]
    });
  }

  /* -------------------------------------------------------------- training */

  function trainingView() {
    var rows = state.training || [];
    var mayEdit = state.ctx.role === "manager";
    var s = WFRecords.trainingSummary(rows);
    var wrap = O.el("div");

    var head = O.el("div.wf-pagehead", { style: "margin-bottom:14px" },
      O.el("div.wf-h2", { text: "Training", style: "font-size:19px;font-weight:700" }));
    if (mayEdit) {
      var b = O.btn("Add a record", { primary: true, onClick: function () { openTraining(null); } });
      b.classList.add("wf-spacer");
      head.appendChild(b);
    }
    wrap.appendChild(head);

    if (!rows.length) {
      wrap.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "No training recorded yet." }),
        O.el("div.muted", { text: mayEdit
          ? "Tickets and certificates with expiry dates — forklift, first aid, hot work."
          : "A manager keeps this up to date." })));
      return wrap;
    }

    wrap.appendChild(O.el("div.wf-stats", null,
      O.stat("Records", s.total, "across " + Object.keys(s.people).length + " people"),
      O.stat("Expired", s.expired, "need redoing", s.expired > 0),
      O.stat("Expiring soon", s.expiring, "inside 60 days", s.expiring > 0)));

    var sorted = rows.slice().sort(function (a, b) {
      return rank(a) - rank(b) || String(a.person || "").localeCompare(String(b.person || ""));
    });

    var p = O.panel("Who's covered", "expired and expiring first");
    p.body(O.el("div.wf-list", null, sorted.map(function (r) {
      var st = WFRecords.trainingStatus(r);
      var tone = st.state === "expired" ? "late"
               : st.state === "expiring" ? "warn"
               : st.state === "current" ? "go" : "quiet";
      var text = st.state === "expired" ? "expired " + days(-st.days) + " ago"
               : st.state === "expiring" ? "expires in " + days(st.days)
               : st.state === "current" ? "current" : "no expiry";
      var row = O.el("div.wf-row", { style: "grid-template-columns:1.2fr 1.4fr 150px auto" },
        O.el("div", null,
          O.el("div.wf-job", { text: r.person || "unnamed" }),
          O.el("div.wf-jobsub", { text: r.completedAt ? "done " + when(r.completedAt) : "" })),
        O.el("div", { style: "font-size:13.5px", text: r.topic || "" }),
        O.el("div", null, O.tag(text, tone)),
        O.el("div.wf-actions", null, mayEdit
          ? O.btn("Edit", { quiet: true, small: true,
              onClick: function () { openTraining(r); } })
          : null));
      return row;
    })));
    wrap.appendChild(p);
    return wrap;
  }

  function rank(r) {
    var st = WFRecords.trainingStatus(r).state;
    return st === "expired" ? 0 : st === "expiring" ? 1 : st === "current" ? 2 : 3;
  }

  function openTraining(row) {
    var rows = (state.training || []).slice();
    var isNew = !row;
    row = row || { id: "tr-" + Date.now().toString(36), person: "", topic: "",
                   completedAt: "", expiresAt: "", note: "" };

    var people = ((state.ctx.board && state.ctx.board.members) || []).slice()
      .sort(function (a, b) { return O.displayName(a).localeCompare(O.displayName(b)); });

    var who = O.el("select");
    who.appendChild(O.el("option", { value: "", text: "Pick someone" }));
    people.forEach(function (m) {
      var o = O.el("option", { value: O.displayName(m), text: O.displayName(m) });
      if (O.displayName(m) === row.person) o.selected = true;
      who.appendChild(o);
    });

    var topic = O.el("input", { type: "text", value: row.topic || "",
      placeholder: "e.g. Forklift ticket, First aid, Hot work permit" });
    var done = O.el("input", { type: "date", value: dateVal(row.completedAt) });
    var exp = O.el("input", { type: "date", value: dateVal(row.expiresAt) });

    O.dialog({
      title: isNew ? "Add a training record" : (row.person || "Edit record"),
      note: "Anything with an expiry date is worth putting here — you get 60 " +
            "days' warning, which is about what it takes to rebook.",
      content: O.el("div", null,
        field("Who", null, who),
        field("What", null, topic),
        field("Completed", null, done),
        field("Expires", "Leave blank if it doesn't expire.", exp)),
      buttons: [{
        label: "Save", primary: true, busyText: "Saving…",
        onClick: function () {
          if (!who.value) return Promise.reject(new Error("Pick who it's for."));
          if (!topic.value.trim()) return Promise.reject(new Error("Say what the training was."));
          var next = {
            id: row.id, person: who.value, topic: topic.value.trim(),
            completedAt: done.value || "", expiresAt: exp.value || "", note: row.note || ""
          };
          var list = isNew ? rows.concat([next])
            : rows.map(function (r) { return r.id === row.id ? next : r; });
          return WFRecords.saveTraining(state.ctx.t, list).then(function () {
            state.training = list;
            paint();
          });
        }
      }, !isNew ? {
        label: "Remove", danger: true, busyText: "Removing…",
        onClick: function () {
          var list = rows.filter(function (r) { return r.id !== row.id; });
          return WFRecords.saveTraining(state.ctx.t, list).then(function () {
            state.training = list;
            paint();
          });
        }
      } : null].filter(Boolean)
    });
  }

  /* ---------------------------------------------------------------- shared */

  function field(label, hint, control) {
    var f = O.el("div.wf-rec-f", null, O.el("label", { text: label }));
    f.appendChild(control);
    if (hint) f.appendChild(O.el("div.hint", { text: hint }));
    return f;
  }

  function when(d) {
    if (!d) return "";
    return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function dateVal(d) {
    if (!d) return "";
    var x = new Date(d);
    return isNaN(x) ? "" : x.toISOString().slice(0, 10);
  }

  function days(n) {
    var d = Math.abs(Math.round(n));
    return d + (d === 1 ? " day" : " days");
  }

  function round1(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return Math.round(n * 10) / 10;
  }

  /* -------------------------------------------------------------------- tab */

  O.tab({
    id: "records",
    label: "Records",
    // Nested under Performance, and it keeps its own rail inside -- Time,
    // Quality, Safety, Training stay where they are. Two levels is right here:
    // "how did we do" is the subject, Records is one way of answering it, and
    // a safety report is a different question again from a time log.
    parent: "performance",
    // Open to everyone: a worker gets Safety and Training. Time and Quality are
    // filtered out of the rail rather than the whole tab being locked.
    render: function (ctx) {
      state.ctx = ctx;
      state.host = O.el("div");
      var vis = visibleSections(ctx);
      if (!state.section || !vis.some(function (s) { return s.id === state.section; })) {
        state.section = (vis[0] || {}).id || "safety";
      }
      if (state.cards && state.safety && state.training) { paint(); return state.host; }
      state.host.appendChild(O.el("div.loading", { text: "Opening the records…" }));
      return refresh().then(function () { return state.host; });
    }
  });
})();
