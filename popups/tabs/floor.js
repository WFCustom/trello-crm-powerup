/* Floor -- the shop's live surface: what every station is building and what is
   queued behind it. Read-only in this pass; Start, Stop, the percent slider
   and Complete land next.

   THE ONE RULE THIS SCREEN IS BUILT AROUND: no running timer is ever shown to
   the shop. A welder sees status and percent; a manager sees the clock. The
   minute a timer ticks at somebody, the timings stop being an honest record of
   how long work takes and start being something to manage, and the data we
   need for capacity planning is gone. Wired to WFTables. */
(function () {
  "use strict";
  var O = WFOps;

  /**
   * The approved "Navy · daylight" palette from the floor mock, kept as its own
   * vocabulary rather than folded into the ops skin. This screen is read across
   * a room off a TV, so it needs bigger type, heavier weight and more contrast
   * than a tab somebody reads at a desk -- and the two shouldn't drift into
   * each other.
   */
  (function injectStyles() {
    if (document.getElementById("wf-floor-styles")) return;
    var css = [
      ".wf-fl{--p-bg:#0f2340;--p-panel:#f3f5f8;--p-tile:#e4e9f0;--p-track:#cfd7e2;",
      "--p-ink:#12213a;--p-muted:#5b6b80;--p-accent:#e8a317;--p-ok:#1f9d63;",
      "--p-warn:#d9482e;--p-idle:#8896a8}",

      /* --- top bar -------------------------------------------------- */
      ".wf-fl-top{display:flex;align-items:center;gap:14px;flex-wrap:wrap;",
      "background:var(--p-bg);color:#fff;border-radius:18px;padding:14px 18px;margin-bottom:14px}",
      ".wf-fl-area{font-family:'Barlow Condensed',inherit;font-size:24px;font-weight:700;",
      "letter-spacing:.03em;text-transform:uppercase;line-height:1}",
      ".wf-fl-tabs{display:flex;gap:6px}",
      ".wf-fl-tab{cursor:pointer;font:inherit;font-size:13px;font-weight:600;padding:6px 14px;",
      "border-radius:999px;border:1px solid rgba(255,255,255,.28);background:transparent;color:#fff}",
      ".wf-fl-tab.is-on{background:#fff;color:var(--p-bg);border-color:#fff}",
      ".wf-fl-clock{margin-left:auto;text-align:right;line-height:1.15}",
      ".wf-fl-clock b{font-family:'Barlow Condensed',inherit;font-size:26px;font-weight:700;display:block}",
      ".wf-fl-clock span{font-size:11.5px;opacity:.72;letter-spacing:.06em;text-transform:uppercase}",
      ".wf-fl-top button.wf-btn{background:rgba(255,255,255,.14);border-color:transparent;color:#fff}",

      /* --- summary strip -------------------------------------------- */
      ".wf-fl-sum{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:14px}",
      ".wf-fl-s{flex:1 1 120px;background:#fff;border:1px solid var(--p-track);border-radius:16px;",
      "padding:10px 14px}",
      ".wf-fl-s b{font-family:'Barlow Condensed',inherit;font-size:26px;font-weight:700;",
      "display:block;line-height:1;color:var(--p-ink)}",
      ".wf-fl-s span{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--p-muted)}",

      /* --- station grid --------------------------------------------- */
      ".wf-fl-grid{display:grid;gap:13px;align-items:start}",
      ".wf-fl-col{background:var(--p-panel);border-radius:22px;padding:16px 17px 17px;",
      "border-top:5px solid var(--s,var(--p-idle));display:flex;flex-direction:column;gap:12px;min-width:0}",
      ".wf-fl-h{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}",
      ".wf-fl-name{font-family:'Barlow Condensed',inherit;font-size:21px;font-weight:700;",
      "letter-spacing:.02em;text-transform:uppercase;color:var(--p-ink);line-height:1}",
      ".wf-fl-st{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;",
      "color:var(--s);margin-left:auto;white-space:nowrap}",
      ".wf-fl-st i{width:9px;height:9px;border-radius:50%;background:var(--s);display:block}",
      ".wf-fl-who{font-size:12.5px;color:var(--p-muted);width:100%;margin-top:-4px}",
      ".wf-fl-rule{height:3px;border-radius:2px;background:var(--s);opacity:.55}",

      ".wf-fl-k{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;",
      "color:var(--p-muted);font-weight:700}",
      ".wf-fl-num{font-family:'Barlow Condensed',inherit;font-weight:700;line-height:.95;",
      "color:var(--p-ink);word-break:break-word}",
      ".wf-fl-job{font-weight:600;line-height:1.3;color:var(--p-ink);",
      "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
      ".wf-fl-meta{font-size:12.5px;color:var(--p-muted);display:flex;gap:7px;",
      "flex-wrap:wrap;align-items:center}",
      ".wf-fl-dot{width:3px;height:3px;border-radius:50%;background:var(--p-idle);flex:none}",

      /* The clock only ever renders for a manager -- see the file header. */
      ".wf-fl-elapsed{display:inline-flex;align-items:center;gap:6px;background:var(--p-bg);",
      "color:#fff;border-radius:999px;padding:3px 11px;font-size:12px;font-weight:700;",
      "font-variant-numeric:tabular-nums}",
      ".wf-fl-elapsed em{font-style:normal;opacity:.6;font-weight:600;font-size:10.5px;",
      "letter-spacing:.08em;text-transform:uppercase}",

      ".wf-fl-bar{height:9px;border-radius:999px;background:var(--p-track);overflow:hidden}",
      ".wf-fl-bar i{display:block;height:100%;border-radius:999px;background:var(--s)}",
      ".wf-fl-pct{display:flex;justify-content:space-between;font-size:12px;color:var(--p-muted);",
      "font-weight:600}",

      ".wf-fl-idle{background:var(--p-tile);border-radius:16px;padding:16px;text-align:center;",
      "color:var(--p-muted);font-size:13.5px}",
      ".wf-fl-idle b{display:block;font-family:'Barlow Condensed',inherit;font-size:22px;",
      "font-weight:700;text-transform:uppercase;color:var(--p-idle);margin-bottom:4px}",

      ".wf-fl-q{display:flex;flex-direction:column;gap:7px}",
      ".wf-fl-t{display:flex;gap:11px;align-items:flex-start;background:var(--p-tile);",
      "border-radius:14px;padding:10px 12px;min-width:0}",
      ".wf-fl-t.is-late{box-shadow:inset 3px 0 0 var(--p-warn)}",
      ".wf-fl-t-p{font-family:'Barlow Condensed',inherit;font-size:17px;font-weight:700;",
      "color:var(--p-idle);min-width:17px;line-height:1.35}",
      ".wf-fl-t-m{min-width:0;flex:1}",
      ".wf-fl-t-n{font-size:13.5px;font-weight:600;color:var(--p-ink);line-height:1.3;",
      "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
      ".wf-fl-t-d{font-size:11.5px;color:var(--p-muted);margin-top:2px}",
      ".wf-fl-t-d.is-late{color:var(--p-warn);font-weight:700}",
      ".wf-fl-more{font-size:11.5px;color:var(--p-muted);padding-left:2px}",

      "@media (max-width:600px){.wf-fl-top{padding:12px 14px}.wf-fl-area{font-size:20px}",
      ".wf-fl-clock b{font-size:21px}}"
    ].join("");
    var tag = document.createElement("style");
    tag.id = "wf-floor-styles";
    tag.textContent = css;
    document.head.appendChild(tag);
  })();

  /* Module-level so switching tabs and coming back keeps you on the same
     screen, and so the timers below have something stable to clean up. */
  var state = { area: "shop", cfg: null, cards: null, host: null, ctx: null };

  /**
   * One interval and one resize handler for the whole tab, replaced rather than
   * added to on every paint.
   *
   * Every earlier version of a ticking view in this project leaked: a paint
   * started a second interval, the first kept running against a detached node,
   * and after ten tab switches the window was doing ten times the work for one
   * visible clock. Both handlers also check isConnected and remove themselves,
   * so closing the window can't leave anything behind.
   */
  var tick = null;
  var onResize = null;

  function stopTimers() {
    if (tick) { clearInterval(tick); tick = null; }
    if (onResize) { window.removeEventListener("resize", onResize); onResize = null; }
  }

  function add(parent, node) { if (node) parent.appendChild(node); return parent; }

  function initials(name) {
    return String(name || "").trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w[0] || ""; }).join("").toUpperCase() || "··";
  }

  /**
   * The job number, if the card name carries one.
   *
   * Cards on this board are named however whoever made them felt that day.
   * Where a "#2412" exists it is the thing a welder recognises from across the
   * shop, so it becomes the headline and the rest becomes the subtitle; where
   * it doesn't, the name is the headline and nothing is invented.
   */
  function jobNumber(card) {
    var m = /#\s*(\d[\d-]*)/.exec((card && card.name) || "");
    return m ? "#" + m[1] : null;
  }

  function jobTitle(card) {
    var name = (card && card.name) || "";
    return name.replace(/#\s*\d[\d-]*\s*[-–—:·]?\s*/, "").trim() || name;
  }

  function dueText(card) {
    if (!card || !card.due) return "";
    var d = new Date(card.due);
    var txt = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return WFTables.isLate(card) ? "was due " + txt : "due " + txt;
  }

  /* --------------------------------------------------------------- painting */

  function paint() {
    if (!state.host) return;
    stopTimers();
    state.host.innerHTML = "";
    state.host.className = "wf-fl";
    add(state.host, topBar());
    var states = WFTables.areaState(state.ctx.boardCfg, state.cards, state.cfg, state.area);
    if (state.ctx.isManager) add(state.host, summaryStrip(states));
    add(state.host, grid(states));
    startTimers();
  }

  function refresh() {
    return Promise.all([
      state.ctx.cards(),
      WFTables.load(state.ctx.t)
    ]).then(function (r) {
      state.cards = r[0];
      state.cfg = r[1];
      paint();
    }).catch(function (e) {
      if (!state.host) return;
      state.host.innerHTML = "";
      state.host.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "Couldn't read the shop floor." }),
        O.el("div.muted", { text: (e && e.message) || String(e) }),
        O.btn("Try again", { onClick: refresh })));
    });
  }

  /* ---------------------------------------------------------------- top bar */

  function topBar() {
    var bar = O.el("div.wf-fl-top");
    bar.appendChild(O.el("div.wf-fl-area", { text: WFTables.areaLabel(state.area) }));

    var tabs = O.el("div.wf-fl-tabs");
    WFTables.areas().forEach(function (a) {
      tabs.appendChild(O.el("button.wf-fl-tab" + (a.id === state.area ? ".is-on" : ""), {
        type: "button", text: a.label,
        onClick: function () { state.area = a.id; paint(); }
      }));
    });
    bar.appendChild(tabs);

    // Time of day, not a job timer -- this one is fine for everybody and is
    // the thing a shop TV is expected to show.
    var clock = O.el("div.wf-fl-clock", null,
      O.el("b", { id: "wfFlNow", text: nowText() }),
      O.el("span", {
        text: new Date().toLocaleDateString(undefined,
          { weekday: "long", month: "long", day: "numeric" })
      }));
    bar.appendChild(clock);

    bar.appendChild(O.btn("Refresh", {
      small: true, busyText: "…",
      onClick: function () { return state.ctx.reload().then(refresh); }
    }));
    if (state.ctx.isManager) {
      bar.appendChild(O.btn("Stations", { small: true, onClick: openStations }));
    }
    return bar;
  }

  function nowText() {
    return new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  /* -------------------------------------------------------------- summary */

  function summaryStrip(states) {
    var s = WFTables.summary(states);
    var row = O.el("div.wf-fl-sum");
    var cell = function (v, k) {
      return O.el("div.wf-fl-s", null, O.el("b", { text: String(v) }), O.el("span", { text: k }));
    };
    row.appendChild(cell(s.running + s.behind, "stations turning"));
    row.appendChild(cell(s.open + s.paused, "idle or paused"));
    row.appendChild(cell(s.queued, "jobs queued"));
    row.appendChild(cell(s.utilisation + "%", "of stations busy"));
    return row;
  }

  /* --------------------------------------------------------------- the grid */

  function grid(states) {
    var wrap = O.el("div.wf-fl-grid");
    if (!states.length) {
      wrap.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "No stations on this screen." }),
        O.el("div.muted", { text: state.ctx.isManager
          ? "Add or show one under Stations."
          : "A manager sets these up." })));
      return wrap;
    }
    var cols = WFTables.columnsFor(window.innerWidth || 1200, states.length);
    wrap.style.gridTemplateColumns = "repeat(" + Math.max(1, cols) + ",minmax(0,1fr))";
    var scale = WFTables.scaleFor(cols);
    states.forEach(function (st) { wrap.appendChild(column(st, scale)); });
    return wrap;
  }

  function column(st, scale) {
    var color = WFTables.statusColor(st.status);
    var col = O.el("div.wf-fl-col", { style: "--s:" + color });

    var head = O.el("div.wf-fl-h", null,
      O.el("div.wf-fl-name", { text: st.station.table || "Station" }),
      O.el("div.wf-fl-st", null,
        O.el("i"), O.el("span", { text: WFTables.statusText(st.status) })));
    head.appendChild(O.el("div.wf-fl-who", {
      text: [st.station.station, st.station.welder || "Unassigned"]
        .filter(Boolean).join(" · ")
    }));
    col.appendChild(head);
    col.appendChild(O.el("div.wf-fl-rule"));

    if (st.status === "unset") {
      col.appendChild(O.el("div.wf-fl-idle", null,
        O.el("b", { text: "Not set up" }),
        O.el("div", { text: st.note })));
      return col;
    }

    add(col, st.job ? nowBuilding(st, scale) : idle(st));
    add(col, queue(st, scale));
    return col;
  }

  function nowBuilding(st, scale) {
    var box = O.el("div", { style: "display:flex;flex-direction:column;gap:9px" });
    var num = jobNumber(st.job);

    box.appendChild(O.el("div.wf-fl-k", { text: "Now building" }));
    box.appendChild(O.el("div.wf-fl-num", {
      style: "font-size:" + (num ? scale.job : Math.round(scale.job * 0.55)) + "px",
      text: num || jobTitle(st.job)
    }));
    if (num) {
      box.appendChild(O.el("div.wf-fl-job", {
        style: "font-size:" + scale.name + "px", text: jobTitle(st.job)
      }));
    }

    var who = WFTables.activeWork(st.job);
    var person = (who && who.claimedBy) ? O.displayName(who.claimedBy) : st.station.welder;
    var meta = O.el("div.wf-fl-meta", null,
      O.el("span", { text: initials(person) + " · " + (person || "unclaimed") }));
    if (st.phase) {
      meta.appendChild(O.el("span.wf-fl-dot"));
      meta.appendChild(O.el("span", { text: st.phase }));
    }
    var due = dueText(st.job);
    if (due) {
      meta.appendChild(O.el("span.wf-fl-dot"));
      meta.appendChild(O.el("span", {
        text: due,
        style: WFTables.isLate(st.job) ? "color:var(--p-warn);font-weight:700" : ""
      }));
    }
    box.appendChild(meta);

    // The clock, managers only. data-work lets the ticker find it again
    // without re-rendering the whole column every thirty seconds.
    if (state.ctx.isManager) {
      var chip = O.el("div.wf-fl-elapsed", null,
        O.el("em", { text: "on the clock" }),
        O.el("span.wf-fl-mins", {
          text: WFTables.clockText(WFTables.elapsedMinutes(st.work))
        }));
      chip.setAttribute("data-card", st.job.id);
      if (!WFTables.isRunning(st.work)) chip.style.opacity = ".55";
      box.appendChild(O.el("div", null, chip));
    }

    var pct = (st.work && typeof st.work.percentComplete === "number")
      ? Math.max(0, Math.min(100, st.work.percentComplete)) : 0;
    box.appendChild(O.el("div.wf-fl-pct", null,
      O.el("span", { text: pct + "% complete" }),
      O.el("span", { text: WFTables.isRunning(st.work) ? "running" : "not running" })));
    box.appendChild(O.el("div.wf-fl-bar", null, O.el("i", { style: "width:" + pct + "%" })));
    return box;
  }

  function idle(st) {
    return O.el("div.wf-fl-idle", null,
      O.el("b", { text: "No active job" }),
      O.el("div", { text: st.note || "Nothing started yet." }));
  }

  function queue(st, scale) {
    var show = scale.compact ? 2 : 3;
    var box = O.el("div", { style: "display:flex;flex-direction:column;gap:8px" });
    box.appendChild(O.el("div.wf-fl-k", {
      text: st.queue.length ? "Next up · " + st.queue.length : "Next up"
    }));
    if (!st.queue.length) {
      box.appendChild(O.el("div.wf-fl-more", { text: "Nothing waiting in " + (st.phase || "this phase") + "." }));
      return box;
    }
    var list = O.el("div.wf-fl-q");
    st.queue.slice(0, show).forEach(function (c, i) {
      var late = WFTables.isLate(c);
      list.appendChild(O.el("div.wf-fl-t" + (late ? ".is-late" : ""), null,
        O.el("div.wf-fl-t-p", { text: String(i + 1) }),
        O.el("div.wf-fl-t-m", null,
          O.el("div.wf-fl-t-n", { text: c.name }),
          O.el("div.wf-fl-t-d" + (late ? ".is-late" : ""),
            { text: dueText(c) || "no date set" }))));
    });
    box.appendChild(list);
    if (st.queue.length > show) {
      box.appendChild(O.el("div.wf-fl-more", {
        text: "+ " + (st.queue.length - show) + " more waiting"
      }));
    }
    return box;
  }

  /* ---------------------------------------------------------------- timers */

  /**
   * One interval drives the wall clock and, for a manager, the elapsed chips.
   *
   * Thirty seconds, not one: the chips read h:mm, so a per-second tick would
   * repaint the same characters twenty-nine times out of thirty on a screen
   * that may be a TV left on all day.
   */
  function startTimers() {
    tick = setInterval(function () {
      if (!state.host || !state.host.isConnected) { stopTimers(); return; }
      var now = document.getElementById("wfFlNow");
      if (now) now.textContent = nowText();
      if (!state.ctx.isManager) return;
      var byId = {};
      (state.cards || []).forEach(function (c) { byId[c.id] = c; });
      Array.prototype.forEach.call(
        state.host.querySelectorAll(".wf-fl-elapsed[data-card]"), function (chip) {
          var card = byId[chip.getAttribute("data-card")];
          var work = card && WFTables.activeWork(card);
          if (!work) return;
          var out = chip.querySelector(".wf-fl-mins");
          if (out) out.textContent = WFTables.clockText(WFTables.elapsedMinutes(work));
        });
    }, 30000);

    onResize = debounce(function () {
      if (!state.host || !state.host.isConnected) { stopTimers(); return; }
      paint();
    }, 250);
    window.addEventListener("resize", onResize);
  }

  function debounce(fn, ms) {
    var h = null;
    return function () {
      if (h) clearTimeout(h);
      h = setTimeout(fn, ms);
    };
  }

  /* --------------------------------------------------------------- stations */

  /**
   * Station setup. This is the one thing a manager can write from this screen
   * in the read-only pass, and it has to be: nothing renders until somebody
   * says which phase a booth pulls from and who is standing at it. It writes
   * configuration, never a job.
   */
  function openStations() {
    var cfg = JSON.parse(JSON.stringify(state.cfg));
    var phases = WFTables.phaseOptions(state.ctx.boardCfg);
    var people = ((state.ctx.board && state.ctx.board.members) || []).slice()
      .sort(function (a, b) {
        return O.displayName(a).localeCompare(O.displayName(b));
      });

    var body = O.el("div");
    var rows = [];

    cfg.stations.forEach(function (s) {
      var shown = (cfg.visible || []).indexOf(s.id) !== -1;

      var on = O.el("input", { type: "checkbox" });
      on.checked = shown;

      var table = O.el("input", { type: "text", value: s.table || "" });
      var type = O.el("input", { type: "text", value: s.station || "" });

      var phase = O.el("select");
      phase.appendChild(O.el("option", { value: "", text: "No phase yet" }));
      phases.forEach(function (p) {
        var o = O.el("option", { value: p, text: p });
        if (p === s.phase) o.selected = true;
        phase.appendChild(o);
      });

      var who = O.el("select");
      who.appendChild(O.el("option", { value: "", text: "Unassigned" }));
      people.forEach(function (m) {
        var o = O.el("option", { value: m.username, text: O.displayName(m) });
        if (m.username === s.welder) o.selected = true;
        who.appendChild(o);
      });

      var card = O.el("div", {
        style: "border:1px solid var(--wf-line);border-radius:14px;padding:12px 14px;" +
               "margin-bottom:10px;display:flex;flex-direction:column;gap:8px"
      },
        O.el("label", { style: "display:flex;align-items:center;gap:8px;font-weight:600" },
          on, O.el("span", { text: WFTables.areaLabel(s.area) + " · " + (s.table || s.id) })),
        field("Station name", table),
        field("What it does", type),
        field("Phase it pulls from", phase),
        field("Who's on it", who));

      body.appendChild(card);
      rows.push({ s: s, on: on, table: table, type: type, phase: phase, who: who });
    });

    O.dialog({
      title: "Stations",
      note: "A station shows nothing until it has a phase. Untick a station to " +
            "take it off the screen without losing its setup.",
      content: body,
      buttons: [{
        label: "Save", primary: true, busyText: "Saving…",
        onClick: function () {
          var visible = [];
          rows.forEach(function (r) {
            r.s.table = r.table.value.trim();
            r.s.station = r.type.value.trim();
            r.s.phase = r.phase.value;
            r.s.welder = r.who.value;
            if (r.on.checked) visible.push(r.s.id);
          });
          cfg.visible = visible;
          return WFTables.save(state.ctx.t, cfg).then(function () {
            state.cfg = cfg;
            paint();
          });
        }
      }]
    });
  }

  function field(label, control) {
    var f = O.el("div", { style: "display:flex;flex-direction:column;gap:4px" },
      O.el("label", {
        text: label,
        style: "font-size:11px;letter-spacing:.07em;text-transform:uppercase;" +
               "color:var(--wf-muted);font-weight:700"
      }));
    control.style.cssText = "font:inherit;font-size:14px;padding:8px 10px;" +
      "border:1px solid var(--wf-line);border-radius:10px;background:#fff;width:100%";
    f.appendChild(control);
    return f;
  }

  /* -------------------------------------------------------------------- tab */

  O.tab({
    id: "floor",
    label: "Floor",
    // No roles: this is the shop's screen first. What a manager gets extra --
    // the clock, the summary strip, station setup -- is gated inside.
    render: function (ctx) {
      state.ctx = ctx;
      state.host = O.el("div.wf-fl");
      if (state.cfg && state.cards) { paint(); return state.host; }
      state.host.appendChild(O.el("div.loading", { text: "Reading the shop floor…" }));
      return refresh().then(function () { return state.host; });
    }
  });
})();
