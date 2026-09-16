/* Floor -- the shop's live surface: what every station is building and what is
   queued behind it.

   THE ONE RULE THIS SCREEN IS BUILT AROUND: no running timer is ever shown to
   the shop. A welder sees status and percent; a manager sees the clock. The
   minute a timer ticks at somebody, the timings stop being an honest record of
   how long work takes and start being something to manage, and the data we
   need for capacity planning is gone.

   THE SECOND RULE, FROM THE MOCKUP: a column never sends you somewhere else.
   The cover, the card, the queue all render in the column, and the X in any
   view header puts Station back without leaving it. A station screen gets
   glanced at from across the shop -- bouncing somebody out to Trello to read a
   drawing means they come back to a reloaded page and have to find their
   station again.

   THE THIRD RULE, AND THE BIGGEST CHANGE: THERE IS NO MANAGER APPROVAL.
   Complete opens the station's QC checklist unless it has already been signed.
   Every line has to be ticked, a name typed and a signer chosen, and then the
   job passes to the next phase on the spot. The old path -- mark complete, wait
   in a manager's queue, get approved -- put work in a holding pattern and
   called it quality control. A signed checklist naming who checked it is a
   better record than an approval click, and it happens at the bench while the
   job is still in front of the person who can fix it.

   Wired to WFTables, WFPhase, WFQC, WFStage, WFCardView, WFCardPanel. */
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
      "border-radius:14px;padding:10px 12px;min-width:0;border:1.5px solid transparent}",
      ".wf-fl-t:hover{border-color:var(--p-track)}",
      ".wf-fl-t.is-late{box-shadow:inset 3px 0 0 var(--p-warn)}",
      ".wf-fl-t-p{font-family:'Barlow Condensed',inherit;font-size:17px;font-weight:700;",
      "color:var(--p-idle);min-width:17px;line-height:1.35}",
      ".wf-fl-t-m{min-width:0;flex:1}",
      ".wf-fl-t-n{font-size:13.5px;font-weight:600;color:var(--p-ink);line-height:1.3;",
      "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
      ".wf-fl-t-d{font-size:11.5px;color:var(--p-muted);margin-top:2px}",
      ".wf-fl-t-d.is-late{color:var(--p-warn);font-weight:700}",
      ".wf-fl-more{font-size:11.5px;color:var(--p-muted);padding-left:2px}",

      /* Job number on the left, the three round buttons on the right. The
         buttons stay put while the job name wraps under them. */
      ".wf-fl-titlerow{display:flex;align-items:flex-start;gap:10px}",
      ".wf-fl-icons{display:flex;gap:6px;flex:0 0 auto;padding-top:4px}",
      ".wf-fl-ic{width:30px;height:30px;border-radius:999px;border:1.5px solid var(--p-track);",
      "background:#fff;color:var(--p-ink);font-size:14px;line-height:1;cursor:pointer;",
      "display:flex;align-items:center;justify-content:center;font-family:inherit;padding:0}",
      ".wf-fl-ic:hover{border-color:var(--p-bg);background:var(--p-tile)}",
      ".wf-fl-ic.is-off{opacity:.35;cursor:not-allowed}",

      /* Never cropped: on a shop screen a cover is a drawing, and a cropped
         drawing is a wrong drawing. */
      ".wf-fl-cover{width:100%;aspect-ratio:16/10;background:var(--p-tile);",
      "border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center}",
      ".wf-fl-cover img{width:100%;height:100%;object-fit:contain;display:block}",

      /* When a column is showing a card it gives the whole column over to it. */
      ".wf-fl-col.is-card{padding:0;overflow:hidden}",
      ".wf-fl-col.is-card .wf-cp{height:100%}",

      ".wf-fl-gear{width:34px;height:34px;border-radius:999px;border:1.5px solid rgba(255,255,255,.28);",
      "background:transparent;color:#fff;font-size:17px;line-height:1;cursor:pointer;",
      "display:flex;align-items:center;justify-content:center;font-family:inherit;padding:0;flex:0 0 auto}",
      ".wf-fl-gear:hover{background:rgba(255,255,255,.14);border-color:#fff}",

      ".wf-fl-ic.is-passed{background:var(--p-ok);border-color:var(--p-ok);color:#fff}",

      /* --- a view that has taken the column over ---------------------- */
      ".wf-fl-vh{display:flex;align-items:flex-start;gap:10px}",
      ".wf-fl-vh-t{font-family:'Barlow Condensed',inherit;font-size:19px;font-weight:700;",
      "letter-spacing:.03em;text-transform:uppercase;color:var(--p-ink);line-height:1.1;flex:0 0 auto}",
      ".wf-fl-vh-s{font-size:12px;color:var(--p-muted);flex:1 1 auto;min-width:0;",
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-top:3px}",
      ".wf-fl-vx{flex:0 0 auto;width:28px;height:28px;border-radius:999px;cursor:pointer;",
      "border:1.5px solid var(--p-track);background:#fff;color:var(--p-muted);font:inherit;",
      "font-size:15px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0}",
      ".wf-fl-vx:hover{background:var(--p-tile);color:var(--p-ink)}",
      ".wf-fl-vbody{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto}",

      /* --- controls --------------------------------------------------- */
      ".wf-fl-slider{width:100%;accent-color:var(--s,var(--p-ok));cursor:pointer;margin:2px 0}",
      ".wf-fl-run{display:flex;gap:8px;margin-top:2px}",
      ".wf-fl-btn{flex:1 1 0;cursor:pointer;font:inherit;font-weight:700;font-size:14px;",
      "padding:11px 10px;border-radius:999px;border:1.5px solid var(--p-track);",
      "background:#fff;color:var(--p-ink)}",
      ".wf-fl-btn:hover{border-color:var(--p-bg)}",
      ".wf-fl-btn:disabled{cursor:default}",
      ".wf-fl-btn.wf-fl-small{flex:0 0 auto;font-size:12.5px;padding:7px 14px}",
      ".wf-fl-done{color:var(--p-muted)}",
      ".wf-fl-done.is-on{background:var(--p-ok);border-color:var(--p-ok);color:#fff}",
      ".wf-fl-assign{margin-top:10px;cursor:pointer;font:inherit;font-weight:700;font-size:13.5px;",
      "padding:10px 16px;border-radius:999px;border:1.5px solid var(--p-track);background:#fff;",
      "color:var(--p-ink)}",
      ".wf-fl-assign:hover{border-color:var(--p-bg);background:var(--p-tile)}",
      ".wf-fl-link{cursor:pointer;font:inherit;font-size:11.5px;font-weight:700;border:0;",
      "background:none;color:var(--p-muted);padding:0;text-decoration:underline;text-align:left}",
      ".wf-fl-link:hover{color:var(--p-ink)}",
      ".wf-fl-qhead{display:flex;align-items:baseline;justify-content:space-between;gap:10px}",
      ".wf-fl-hint{font-size:11px;color:var(--p-muted);margin-top:-4px}",

      /* --- full queue -------------------------------------------------- */
      ".wf-fl-qrow{display:flex;gap:7px;align-items:stretch}",
      ".wf-fl-arrows{display:flex;flex-direction:column;gap:3px;flex:0 0 auto}",
      ".wf-fl-arrow{width:26px;flex:1 1 0;border-radius:8px;border:1.5px solid var(--p-track);",
      "background:#fff;color:var(--p-muted);font-size:10px;line-height:1;cursor:pointer;padding:0}",
      ".wf-fl-arrow:hover{border-color:var(--p-bg);color:var(--p-ink)}",
      ".wf-fl-t.is-current{background:var(--p-bg);color:#fff}",
      ".wf-fl-t.is-current .wf-fl-t-n,.wf-fl-t.is-current .wf-fl-t-p{color:#fff}",
      ".wf-fl-t.is-current .wf-fl-t-d{color:rgba(255,255,255,.7)}",
      ".wf-fl-t.is-open{box-shadow:inset 3px 0 0 var(--p-ok)}",

      /* --- assign ------------------------------------------------------ */
      ".wf-fl-panel{background:var(--p-tile);border-radius:14px;padding:11px 13px;",
      "display:flex;flex-direction:column;gap:5px}",
      ".wf-fl-sel,.wf-fl-input{width:100%;box-sizing:border-box;font:inherit;font-size:13.5px;",
      "padding:8px 10px;border-radius:10px;border:1.5px solid var(--p-track);background:#fff;",
      "color:var(--p-ink)}",
      ".wf-fl-atile{background:var(--p-tile);border-radius:14px;padding:10px 12px;",
      "display:flex;flex-direction:column;gap:4px}",
      ".wf-fl-arow{display:flex;gap:8px;align-items:center;margin-top:4px}",

      /* --- QC checklist ------------------------------------------------ */
      ".wf-fl-amber{background:#fdf0d5;border-left:4px solid var(--p-accent);color:#6b4a06;",
      "border-radius:10px;padding:9px 12px;font-size:12.5px;font-weight:600}",
      ".wf-fl-ck{display:flex;gap:10px;align-items:flex-start;background:transparent;",
      "border:1.5px solid var(--p-track);border-radius:12px;padding:9px 11px}",
      ".wf-fl-ck.is-on{background:var(--p-tile);border-color:transparent}",
      ".wf-fl-box{flex:0 0 auto;width:20px;height:20px;border-radius:6px;border:2px solid var(--p-muted);",
      "display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;margin-top:1px}",
      ".wf-fl-ck.is-on .wf-fl-box{background:var(--p-ok);border-color:var(--p-ok)}",
      ".wf-fl-ck-t{font-size:13px;font-weight:700;color:var(--p-ink);line-height:1.3}",
      ".wf-fl-ck-s{font-size:11px;color:var(--p-muted);margin-top:2px;line-height:1.35}",
      ".wf-fl-stamp{background:var(--p-ok);color:#fff;border-radius:14px;padding:12px 14px;",
      "display:flex;flex-direction:column;gap:3px;font-size:12px}",
      ".wf-fl-stamp b{font-family:'Barlow Condensed',inherit;font-size:20px;letter-spacing:.03em}",

      "@media (max-width:600px){.wf-fl-top{padding:12px 14px}.wf-fl-area{font-size:20px}",
      ".wf-fl-clock b{font-size:21px}",
      ".wf-fl-icons{gap:4px}.wf-fl-ic{width:27px;height:27px}",
      ".wf-fl-run{flex-direction:column}}"
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
    // The gear. It used to be a small button labelled "Stations" wedged beside
    // Refresh, which is why nobody found it -- station setup is the first thing
    // a manager needs on this screen and it looked like a filter.
    if (state.ctx.isManager) {
      bar.appendChild(O.el("button.wf-fl-gear", {
        type: "button", title: "Station setup", "aria-label": "Station setup",
        text: "⚙", onClick: openStations
      }));
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

  /* ===================================================== one view per column
   *
   * The mockup's central rule, and the thing this screen was missing: a column
   * shows exactly ONE view at a time, and the X in any view header returns it
   * to Station without leaving the column. Stacking the card, the checklist and
   * the assign list down a single scrolling column -- which is what was here
   * before -- turns a screen you read from ten feet away into one you have to
   * walk up to and scroll.
   *
   * View state is per station and lives outside the DOM, so a repaint after a
   * write puts you back where you were instead of throwing you to Station.
   */

  /** stationId -> "station" | "card" | "qc" | "assign" | "queue" */
  var views = {};

  /** stationId -> the checklist being worked: items, ticks, signature, signer. */
  var qcState = {};

  /** stationId -> true while a write is in flight, so nothing double-fires. */
  var busy = {};

  function viewOf(id) { return views[id] || "station"; }

  /**
   * Switch a column to a view and repaint just that column.
   *
   * Opening one view closes every other, exactly as the mock's state machine
   * does -- there is no arrangement in which two of these should be on screen
   * at once, and allowing it would mean deciding which wins.
   */
  function setView(st, kind) {
    views[st.station.id] = kind;
    repaintColumn(st);
  }

  function closeView(st) { setView(st, "station"); }

  /**
   * Redraw one column in place.
   *
   * A full paint() would restart the clock interval and scroll every other
   * column back to the top, which on a four-station TV means three people lose
   * their place because a fourth ticked a checkbox.
   */
  function repaintColumn(st) {
    if (!state.host) return;
    var old = state.host.querySelector('[data-station="' + st.station.id + '"]');
    if (!old) return paint();
    var fresh = column(st, WFTables.scaleFor(
      WFTables.columnsFor(window.innerWidth || 1200, 1)));
    old.parentNode.replaceChild(fresh, old);
  }

  /** The station state as it is right now, re-derived from the current cards. */
  function stationNow(id) {
    var all = WFTables.areaState(state.ctx.boardCfg, state.cards, state.cfg, state.area);
    return all.filter(function (s) { return s.station.id === id; })[0] || null;
  }

  /* --------------------------------------------------------------- the column */

  function column(st, scale) {
    var color = WFTables.statusColor(st.status);
    // data-station is how a view finds its own column again; without it every
    // interaction would have to repaint the whole floor.
    var col = O.el("div.wf-fl-col", {
      style: "--s:" + color, "data-station": st.station.id
    });

    var kind = viewOf(st.station.id);

    // The card view is the one that brings its own header, because it is the
    // shared panel every other tab uses too.
    if (kind === "card" && st.job) {
      col.classList.add("is-card");
      col.appendChild(WFCardPanel.inline(state.ctx, st.job, {
        kicker: "Trello card",
        backLabel: "×",
        onBack: function () { closeView(st); }
      }));
      return col;
    }

    if (kind !== "station") {
      col.appendChild(viewHeader(st, kind));
      col.appendChild(O.el("div.wf-fl-rule"));
      col.appendChild(
        kind === "qc" ? qcView(st) :
        kind === "assign" ? assignView(st) :
        kind === "queue" ? queueView(st) :
        O.el("div"));
      return col;
    }

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

  /** The header every non-station view shares: what you're in, and the way out. */
  function viewHeader(st, kind) {
    var titles = {
      qc: "QC checklist",
      assign: "Assign to " + (st.station.table || "this station"),
      queue: "Full queue"
    };
    var subs = {
      qc: st.job ? jobNumber(st.job) || jobTitle(st.job) : "",
      assign: (st.phase || "") + " · nothing on a station yet",
      queue: st.queue.length + (st.queue.length === 1 ? " waiting" : " waiting")
    };
    var h = O.el("div.wf-fl-vh", null,
      O.el("div.wf-fl-vh-t", { text: titles[kind] || "" }),
      O.el("div.wf-fl-vh-s", { text: subs[kind] || "" }));
    h.appendChild(O.el("button.wf-fl-vx", {
      type: "button", title: "Back to the station", "aria-label": "Back to the station",
      text: "×",
      onClick: function () { closeView(st); }
    }));
    return h;
  }

  /* ------------------------------------------------------------ icon buttons */

  /**
   * Assign, QC and card, as the mock places them: round, beside the job number.
   *
   * The QC button carries the state of the check -- outline while the checklist
   * is unsigned, solid green once it is signed, with the signer's name in the
   * tooltip. That makes "has this been checked" answerable from across the shop
   * without opening anything.
   */
  function iconRow(st) {
    var row = O.el("div.wf-fl-icons");
    var signed = st.job ? WFQC.floorSignOff(st.job) : null;

    row.appendChild(O.el("button.wf-fl-ic", {
      type: "button", title: "Assign a job to this station", "aria-label": "Assign a job",
      text: "⇲", onClick: function () { setView(st, "assign"); }
    }));

    row.appendChild(O.el("button.wf-fl-ic" + (signed ? ".is-passed" : ""), {
      type: "button",
      title: signed
        ? "QC passed · " + ((signed.signedBy && signed.signedBy.fullName) || signed.signature)
        : "QC checklist · sign off",
      "aria-label": "QC checklist",
      text: "✓", onClick: function () { setView(st, "qc"); }
    }));

    row.appendChild(O.el("button.wf-fl-ic", {
      type: "button", title: "Open this card here", "aria-label": "Open the card",
      text: "↗", onClick: function () { setView(st, "card"); }
    }));
    return row;
  }

  /* --------------------------------------------------------- the station view */

  function nowBuilding(st, scale) {
    var box = O.el("div", { style: "display:flex;flex-direction:column;gap:9px" });
    var num = jobNumber(st.job);

    box.appendChild(O.el("div.wf-fl-k", { text: "Now building" }));

    var titleRow = O.el("div.wf-fl-titlerow");
    var titles = O.el("div", { style: "min-width:0;flex:1 1 auto" });
    titles.appendChild(O.el("div.wf-fl-num", {
      style: "font-size:" + (num ? scale.job : Math.round(scale.job * 0.55)) + "px",
      text: num || jobTitle(st.job)
    }));
    if (num) {
      titles.appendChild(O.el("div.wf-fl-job", {
        style: "font-size:" + scale.name + "px", text: jobTitle(st.job)
      }));
    }
    titleRow.appendChild(titles);
    titleRow.appendChild(iconRow(st));
    box.appendChild(titleRow);

    // A station that can't reach the card still has to draw the station, so the
    // whole fetch sits inside a promise chain: a missing endpoint costs you the
    // picture, not the column.
    var shot = O.el("div.wf-fl-cover");
    box.appendChild(shot);
    Promise.resolve()
      .then(function () { return WFRest.getCardDetail(state.ctx.t, st.job.id); })
      .then(function (full) {
        var url = WFCardView.coverFrom(full);
        if (!url) throw new Error("no cover");
        shot.appendChild(O.el("img", { src: url, alt: "", loading: "lazy" }));
      })
      .catch(function () { if (shot.parentNode) shot.parentNode.removeChild(shot); });

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

    // The clock, managers only. data-card lets the ticker find it again without
    // re-rendering the column every thirty seconds.
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

    box.appendChild(percentControl(st));
    box.appendChild(runControls(st));
    return box;
  }

  /**
   * Percent complete: the number, the bar, and the slider under it.
   *
   * The bar moves the instant you let go of the slider rather than after the
   * write returns, because a slider that snaps back while Trello thinks about
   * it feels broken and gets dragged again. The write is debounced so a drag
   * across the full range is one save, not twenty.
   */
  function percentControl(st) {
    var pct = WFTables.activeWork(st.job) && typeof st.work.percentComplete === "number"
      ? Math.max(0, Math.min(100, st.work.percentComplete)) : 0;

    var label = O.el("span", { text: pct + "%" });
    var note = O.el("span", { text: WFTables.isRunning(st.work) ? "running" : "not running" });
    var fill = O.el("i", { style: "width:" + pct + "%" });
    var row = O.el("div.wf-fl-pct", null, label, note);
    var bar = O.el("div.wf-fl-bar", null, fill);

    var slider = O.el("input.wf-fl-slider", {
      type: "range", min: "0", max: "100", step: "5", value: String(pct),
      "aria-label": "Percent complete"
    });

    var save = debounce(function (v) {
      write(st, function () {
        return WFPhase.setPercentComplete(state.ctx.t, st.job, v);
      }, { quiet: true });
    }, 400);

    slider.addEventListener("input", function () {
      var v = Number(slider.value) || 0;
      label.textContent = v + "%";
      fill.style.width = v + "%";
      save(v);
    });

    var box = O.el("div", { style: "display:flex;flex-direction:column;gap:6px" }, row, bar);
    if (canWork(st)) box.appendChild(slider);
    return box;
  }

  /**
   * Start/Stop and Complete.
   *
   * Complete is an outline button until QC is signed for this card and solid
   * green after -- the mock's signal, and the reason nobody has to remember
   * whether they checked it. Pressing it unsigned does NOT refuse: it opens the
   * checklist, which is the whole point of putting the gate here rather than in
   * a manager's inbox.
   */
  function runControls(st) {
    var running = WFTables.isRunning(st.work);
    var signed = WFQC.floorSignOff(st.job);
    var row = O.el("div.wf-fl-run");

    if (!canWork(st)) {
      row.appendChild(O.el("div.wf-fl-more", {
        text: "Nobody has claimed this job yet."
      }));
      return row;
    }

    row.appendChild(O.el("button.wf-fl-btn", {
      type: "button",
      text: running ? "■ Stop" : "▶ Start",
      onClick: function () {
        write(st, function () {
          return running
            ? WFPhase.pause(state.ctx.t, st.job)
            : WFPhase.resume(state.ctx.t, st.job);
        });
      }
    }));

    row.appendChild(O.el("button.wf-fl-btn.wf-fl-done" + (signed ? ".is-on" : ""), {
      type: "button",
      text: (signed ? "✓ " : "") + "Complete",
      title: signed ? "QC signed — pass it to the next phase" : "Opens the QC checklist first",
      onClick: function () { askComplete(st); }
    }));
    return row;
  }

  /** Somebody has this job on the clock, so the controls mean something. */
  function canWork(st) {
    var w = WFTables.activeWork(st.job);
    return !!(w && w.claimedBy);
  }

  function idle(st) {
    var box = O.el("div.wf-fl-idle", null,
      O.el("b", { text: "Open" }),
      O.el("div", { text: st.note || "Nothing started yet." }));
    box.appendChild(O.el("button.wf-fl-assign", {
      type: "button", text: "⇲  Assign a job to this station",
      onClick: function () { setView(st, "assign"); }
    }));
    return box;
  }

  /* ------------------------------------------------------------- the queue */

  function queue(st, scale) {
    var show = scale.compact ? 2 : 3;
    var box = O.el("div", { style: "display:flex;flex-direction:column;gap:8px" });

    var head = O.el("div.wf-fl-qhead", null,
      O.el("div.wf-fl-k", { text: st.queue.length ? "Next up · build by" : "Next up" }));
    if (st.queue.length) {
      head.appendChild(O.el("button.wf-fl-link", {
        type: "button", text: "Full queue · " + st.queue.length,
        onClick: function () { setView(st, "queue"); }
      }));
    }
    box.appendChild(head);

    if (!st.queue.length) {
      box.appendChild(O.el("div.wf-fl-more", {
        text: "Nothing waiting in " + (st.phase || "this phase") + "."
      }));
      return box;
    }

    box.appendChild(O.el("div.wf-fl-hint", {
      text: st.job ? "Tap a job to switch" : "Tap a job to start"
    }));

    var list = O.el("div.wf-fl-q");
    st.queue.slice(0, show).forEach(function (c, i) {
      list.appendChild(queueTile(st, c, i));
    });
    box.appendChild(list);
    if (st.queue.length > show) {
      box.appendChild(O.el("button.wf-fl-link", {
        type: "button", text: "+ " + (st.queue.length - show) + " more waiting",
        onClick: function () { setView(st, "queue"); }
      }));
    }
    return box;
  }

  function queueTile(st, c, i) {
    var late = WFTables.isLate(c);
    var w = WFTables.activeWork(c);
    var who = w && w.claimedBy ? O.firstName(w.claimedBy) : "Unclaimed";
    return O.el("button.wf-fl-t" + (late ? ".is-late" : "") + (st.job ? "" : ".is-open"), {
      type: "button",
      title: st.job ? "Switch to this job" : "Start this job",
      style: "width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer",
      onClick: function () { requestStart(st, c); }
    },
      O.el("div.wf-fl-t-p", { text: String(i + 1).padStart(2, "0") }),
      O.el("div.wf-fl-t-m", null,
        O.el("div.wf-fl-t-n", { text: c.name }),
        O.el("div.wf-fl-t-d" + (late ? ".is-late" : ""), {
          text: who + " · " + (dueText(c) || "no date set")
        })));
  }

  /* --------------------------------------------------------- the full queue */

  /**
   * Every waiting job, reorderable.
   *
   * The arrows write `queuePos` for the whole run rather than for the two cards
   * that swapped, because a gapped scheme drifts until two cards collide and
   * the order silently stops meaning anything.
   */
  function queueView(st) {
    var box = O.el("div.wf-fl-vbody");

    if (st.job) {
      box.appendChild(O.el("div.wf-fl-k", { text: "On the station now" }));
      box.appendChild(O.el("div.wf-fl-t.is-current", null,
        O.el("div.wf-fl-t-p", { text: "•" }),
        O.el("div.wf-fl-t-m", null,
          O.el("div.wf-fl-t-n", { text: st.job.name }),
          O.el("div.wf-fl-t-d", { text: dueText(st.job) || "no date set" }))));
    }

    if (!st.queue.length) {
      box.appendChild(O.el("div.wf-fl-more", { text: "Nothing else waiting." }));
      return box;
    }

    box.appendChild(O.el("div.wf-fl-k", { style: "margin-top:10px", text: "Waiting" }));
    var ids = st.queue.map(function (c) { return c.id; });

    st.queue.forEach(function (c, i) {
      var late = WFTables.isLate(c);
      var row = O.el("div.wf-fl-qrow");
      row.appendChild(O.el("button.wf-fl-t" + (late ? ".is-late" : ""), {
        type: "button",
        style: "flex:1 1 auto;text-align:left;font:inherit;color:inherit;cursor:pointer",
        title: st.job ? "Switch to this job" : "Start this job",
        onClick: function () { requestStart(st, c); }
      },
        O.el("div.wf-fl-t-p", { text: String(i + 1).padStart(2, "0") }),
        O.el("div.wf-fl-t-m", null,
          O.el("div.wf-fl-t-n", { text: c.name }),
          O.el("div.wf-fl-t-d" + (late ? ".is-late" : ""),
            { text: dueText(c) || "no date set" }))));

      var arrows = O.el("div.wf-fl-arrows");
      arrows.appendChild(arrow("▲", i === 0, function () { move(st, ids, i, -1); }));
      arrows.appendChild(arrow("▼", i === ids.length - 1, function () { move(st, ids, i, 1); }));
      row.appendChild(arrows);
      box.appendChild(row);
    });
    return box;
  }

  function arrow(glyph, off, fn) {
    return O.el("button.wf-fl-arrow", {
      type: "button", text: glyph, disabled: off,
      style: off ? "opacity:.3;cursor:default" : "",
      onClick: off ? null : fn
    });
  }

  function move(st, ids, i, dir) {
    var j = i + dir;
    if (j < 0 || j >= ids.length) return;
    var next = ids.slice();
    var tmp = next[i]; next[i] = next[j]; next[j] = tmp;
    write(st, function () {
      return WFTables.reorder(state.ctx.t, state.cards, st.station.id, next);
    }, { keepView: "queue" });
  }

  /* ------------------------------------------------------------ assign view */

  /**
   * Jobs in this phase that are on no station, each one click from being here.
   *
   * Assigning does not start a timer. Putting a job on a bench is a scheduling
   * decision made by whoever is planning the day; starting it is a statement
   * about what somebody is doing right now, and conflating the two is how
   * timings stop meaning anything.
   */
  function assignView(st) {
    var box = O.el("div.wf-fl-vbody");
    var pool = WFTables.unassignedInPhase(state.ctx.boardCfg, state.cards, st.phase);

    var people = ((state.ctx.board && state.ctx.board.members) || []).slice()
      .sort(function (a, b) { return O.displayName(a).localeCompare(O.displayName(b)); });

    var who = O.el("select.wf-fl-sel");
    people.forEach(function (m) {
      var o = O.el("option", { value: m.username, text: O.displayName(m) });
      if (m.username === (st.station.welder || state.ctx.member.username)) o.selected = true;
      who.appendChild(o);
    });

    box.appendChild(O.el("div.wf-fl-panel", null,
      O.el("div.wf-fl-k", { text: "Assign to" }),
      who,
      O.el("div.wf-fl-more", {
        text: "Pick yourself to claim, or someone else to assign. The job lands " +
              "at the end of this station's queue; tap it there to start."
      })));

    if (!pool.length) {
      box.appendChild(O.el("div.wf-fl-more", {
        style: "margin-top:12px",
        text: "Every job in " + (st.phase || "this phase") + " is already on a station."
      }));
      return box;
    }

    pool.forEach(function (c) {
      var late = WFTables.isLate(c);
      var tile = O.el("div.wf-fl-atile");
      tile.appendChild(O.el("div.wf-fl-t-n", { text: c.name }));
      tile.appendChild(O.el("div.wf-fl-t-d" + (late ? ".is-late" : ""),
        { text: dueText(c) || "no date set" }));

      var acts = O.el("div.wf-fl-arow");
      acts.appendChild(O.el("button.wf-fl-link", {
        type: "button", text: "↗ Preview",
        onClick: function () { previewFromAssign(st, c); }
      }));
      acts.appendChild(O.el("button.wf-fl-btn.wf-fl-small", {
        type: "button",
        text: "Assign to " + O.firstName(
          people.filter(function (m) { return m.username === who.value; })[0] || { fullName: "them" }),
        onClick: function () { assignTo(st, c, who.value); }
      }));
      tile.appendChild(acts);
      box.appendChild(tile);
    });
    return box;
  }

  /** Preview a pool card, with a way back to the list rather than to Station. */
  function previewFromAssign(st, card) {
    var col = state.host.querySelector('[data-station="' + st.station.id + '"]');
    if (!col) return;
    col.textContent = "";
    col.classList.add("is-card");
    col.appendChild(WFCardPanel.inline(state.ctx, card, {
      kicker: "Trello card",
      backLabel: "‹ Back to list",
      onBack: function () { setView(st, "assign"); }
    }));
  }

  function assignTo(st, card, username) {
    var member = ((state.ctx.board && state.ctx.board.members) || [])
      .filter(function (m) { return m.username === username; })[0];
    if (!member) return;
    write(st, function () {
      return WFPhase.assign(state.ctx.t, card, state.ctx.member, member)
        .then(function () {
          return WFTables.setStation(state.ctx.t, card, st.station.id, st.queue.length);
        });
    }, { keepView: "assign" });
  }

  /* --------------------------------------------------------------- starting */

  /**
   * Tap a queued job.
   *
   * On an open station it just starts. On a busy one it asks first, because the
   * job already on the bench has a percentage against it and silently pausing
   * somebody's work to start something else is the kind of surprise that makes
   * a shop stop trusting a screen.
   */
  function requestStart(st, card) {
    if (!st.job) return startHere(st, card);

    var pct = (st.work && st.work.percentComplete) || 0;
    O.dialog({
      title: "Pause " + (jobNumber(st.job) || "this job") +
             " and start " + (jobNumber(card) || "that one") + "?",
      note: (jobNumber(st.job) || "It") + " stays at " + pct +
            "% and goes back to the front of the queue. Drag the slider first if " +
            "you want to update where you left off.",
      buttons: [{
        label: "Pause and switch", primary: true, busyText: "Switching…",
        onClick: function () {
          return doWrite(st, function () {
            return WFPhase.pause(state.ctx.t, st.job)
              .then(function () {
                return WFTables.setStation(state.ctx.t, st.job, st.station.id, -1);
              })
              .then(function () { return start(st, card); });
          });
        }
      }, {
        label: "Keep working on " + (jobNumber(st.job) || "it"), quiet: true
      }]
    });
  }

  function startHere(st, card) {
    write(st, function () { return start(st, card); });
  }

  /** Claim it if nobody has, resume it if somebody did, and put it on the bench. */
  function start(st, card) {
    var w = WFTables.activeWork(card);
    var begin = (w && w.claimedBy)
      ? WFPhase.resume(state.ctx.t, card)
      : WFPhase.claimAndStart(state.ctx.t, card, state.ctx.member);
    return begin.then(function () {
      return WFTables.setStation(state.ctx.t, card, st.station.id, 0);
    });
  }

  /* ------------------------------------------------------------ the QC gate */

  /**
   * Complete.
   *
   * Unsigned, this opens the checklist -- it does not refuse and it does not
   * warn. The forced checklist IS the gate, and it replaces manager approval
   * entirely: a signed list naming who checked the work is a better record than
   * an approval click, and it happens at the bench while the job is still in
   * front of the person who can fix it.
   */
  function askComplete(st) {
    if (!WFQC.floorSignOff(st.job)) {
      qcState[st.station.id] = qcState[st.station.id] || {};
      qcState[st.station.id].pending = true;
      return setView(st, "qc");
    }
    confirmComplete(st);
  }

  function confirmComplete(st) {
    var next = WFStage.getNextStage(state.ctx.board.id, st.job.idList);
    var rec = WFQC.floorSignOff(st.job);
    O.dialog({
      title: "Mark " + (jobNumber(st.job) || "this job") + " complete?",
      note: "QC signed by " +
        ((rec && rec.signedBy && rec.signedBy.fullName) || (rec && rec.signature) || "somebody") +
        ". " + (next
          ? "The card moves to " + next.name + " and shows up in that phase's queue."
          : "No next phase is configured, so the card stays where it is."),
      buttons: [{
        label: next ? "Complete and pass to " + next.name : "Mark complete",
        primary: true, busyText: "Passing it on…",
        onClick: function () {
          return doWrite(st, function () {
            return WFPhase.approveAndAdvance(state.ctx.t, st.job,
              (rec && rec.signedBy) || state.ctx.member);
          }).then(function () { delete qcState[st.station.id]; });
        }
      }]
    });
  }

  /**
   * The checklist view.
   *
   * Items come from the station's own list, not the phase's -- the blast booth,
   * the powder booth and the cure oven all sit on one phase and check
   * completely different things. Each line carries its tolerance underneath,
   * because "frame is square" is a line anybody can tick in good conscience and
   * "diagonals within 1/8 inch" is one they can fail.
   */
  function qcView(st) {
    var box = O.el("div.wf-fl-vbody");
    var id = st.station.id;
    var q = qcState[id];

    if (!st.job) {
      box.appendChild(O.el("div.wf-fl-more", { text: "No job on this station to check." }));
      return box;
    }

    var done = WFQC.floorSignOff(st.job);
    if (done) {
      box.appendChild(signedStamp(st, done));
      return box;
    }

    if (!q || !q.items) {
      box.appendChild(O.el("div.loading", { text: "Reading the checklist…" }));
      WFQC.getStationChecklist(state.ctx.t, id, st.phase).then(function (items) {
        qcState[id] = Object.assign({ checked: {}, signature: "", signedBy: "" },
          qcState[id] || {}, { items: items });
        repaintColumn(st);
      }).catch(function () {
        qcState[id] = Object.assign({ checked: {}, signature: "", signedBy: "" },
          qcState[id] || {}, { items: [] });
        repaintColumn(st);
      });
      return box;
    }

    if (q.pending) {
      box.appendChild(O.el("div.wf-fl-amber", {
        text: "This job can't pass until the checklist is worked and signed."
      }));
    }

    box.appendChild(O.el("div.wf-fl-k", { text: "Inspecting" }));
    box.appendChild(O.el("div.wf-fl-num", { style: "font-size:24px", text: jobTitle(st.job) }));

    var total = q.items.length;
    var checked = q.items.filter(function (_, i) { return q.checked[i]; }).length;
    var head = O.el("div.wf-fl-pct", null,
      O.el("span", { text: checked + " of " + total + " checked" }),
      O.el("span", { text: Math.round((checked / Math.max(1, total)) * 100) + "%" }));
    var fill = O.el("i", { style: "width:" + Math.round((checked / Math.max(1, total)) * 100) + "%" });
    box.appendChild(head);
    box.appendChild(O.el("div.wf-fl-bar", null, fill));

    if (!total) {
      box.appendChild(O.el("div.wf-fl-more", {
        text: "No checklist set up for this station yet. A manager adds one in the gear."
      }));
      return box;
    }

    q.items.forEach(function (item, i) {
      var on = !!q.checked[i];
      var row = O.el("button.wf-fl-ck" + (on ? ".is-on" : ""), {
        type: "button",
        style: "width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer",
        onClick: function () {
          q.checked[i] = !q.checked[i];
          repaintColumn(st);
        }
      },
        O.el("span.wf-fl-box", { text: on ? "✓" : "" }),
        O.el("span", null,
          O.el("div.wf-fl-ck-t", { text: item.text }),
          item.spec ? O.el("div.wf-fl-ck-s", { text: item.spec }) : null));
      box.appendChild(row);
    });

    box.appendChild(signBlock(st, q));
    return box;
  }

  /**
   * Signature and signer.
   *
   * Two fields, not one, and the difference matters: the typed name is who is
   * attesting, the dropdown is who actually looked. A welder signing their own
   * work picks themselves in both; a peer check has two different names, and
   * that is exactly the fact worth keeping.
   */
  function signBlock(st, q) {
    var id = st.station.id;
    var box = O.el("div.wf-fl-panel", { style: "margin-top:12px" });

    var sig = O.el("input.wf-fl-input", {
      type: "text", placeholder: "Type your name to sign", value: q.signature || ""
    });
    sig.addEventListener("input", function () {
      q.signature = sig.value;
      refreshSignState();
    });

    var by = O.el("select.wf-fl-sel");
    by.appendChild(O.el("option", { value: "", text: "Who signed off…" }));
    ((state.ctx.board && state.ctx.board.members) || []).slice()
      .sort(function (a, b) { return O.displayName(a).localeCompare(O.displayName(b)); })
      .forEach(function (m) {
        var o = O.el("option", { value: m.username, text: O.displayName(m) });
        if (m.username === q.signedBy) o.selected = true;
        by.appendChild(o);
      });
    by.addEventListener("change", function () {
      q.signedBy = by.value;
      refreshSignState();
    });

    box.appendChild(O.el("div.wf-fl-k", { text: "Signature" }));
    box.appendChild(sig);
    box.appendChild(O.el("div.wf-fl-k", { style: "margin-top:8px", text: "Signed off by" }));
    box.appendChild(by);

    var hint = O.el("div.wf-fl-more");
    var btn = O.el("button.wf-fl-btn.wf-fl-done", {
      type: "button", text: "Sign and pass QC",
      onClick: function () { signOff(st, q); }
    });
    box.appendChild(O.el("div", { style: "margin-top:10px" }, btn));
    box.appendChild(hint);

    function refreshSignState() {
      var ok = WFQC.canSignOff(q.items, q.checked, q.signature,
        q.signedBy ? { username: q.signedBy } : null);
      btn.disabled = !ok;
      btn.style.opacity = ok ? "1" : ".4";
      btn.classList.toggle("is-on", ok);
      hint.textContent = WFQC.signHint(q.items, q.checked, q.signature,
        q.signedBy ? { username: q.signedBy } : null);
    }
    refreshSignState();
    return box;
  }

  function signOff(st, q) {
    var signer = ((state.ctx.board && state.ctx.board.members) || [])
      .filter(function (m) { return m.username === q.signedBy; })[0];
    if (!signer) return;

    write(st, function () {
      return WFQC.signOffAndPass(state.ctx.t, st.job, {
        stationId: st.station.id,
        phase: st.phase,
        items: q.items,
        checked: q.checked,
        signature: q.signature,
        signedBy: signer,
        worker: state.ctx.member
      });
    }).then(function () { delete qcState[st.station.id]; });
  }

  function signedStamp(st, rec) {
    var box = O.el("div.wf-fl-vbody");
    box.appendChild(O.el("div.wf-fl-stamp", null,
      O.el("b", { text: "✓ QC passed" }),
      O.el("div", {
        text: "Signed " + (rec.signature || "") +
              (rec.signedBy && rec.signedBy.fullName ? " · checked by " + rec.signedBy.fullName : "")
      }),
      O.el("div", {
        text: rec.signedAt ? new Date(rec.signedAt).toLocaleString() : ""
      })));
    (rec.rounds && rec.rounds[0] ? rec.rounds[0].items : []).forEach(function (i) {
      box.appendChild(O.el("div.wf-fl-ck.is-on", null,
        O.el("span.wf-fl-box", { text: "✓" }),
        O.el("span", null,
          O.el("div.wf-fl-ck-t", { text: i.text }),
          i.spec ? O.el("div.wf-fl-ck-s", { text: i.spec }) : null)));
    });
    return box;
  }

  /* ------------------------------------------------------------- writing */

  /**
   * Every write on this screen goes through here.
   *
   * One place to guard against a double tap, one place to surface a failure,
   * and one place that re-reads the board afterwards so the column shows what
   * actually happened rather than what was asked for. On a screen people press
   * with gloves on, a button that can fire twice is a job started twice.
   */
  function write(st, fn, opts) {
    return doWrite(st, fn, opts).catch(function () { /* already shown */ });
  }

  function doWrite(st, fn, opts) {
    opts = opts || {};
    var id = st.station.id;
    if (busy[id]) return Promise.resolve();
    busy[id] = true;

    return Promise.resolve()
      .then(fn)
      .then(function () { return state.ctx.reload(); })
      .then(function () { return refreshData(); })
      .then(function () {
        busy[id] = false;
        if (opts.keepView) views[id] = opts.keepView;
        else if (!opts.quiet) views[id] = "station";
        paint();
      })
      .catch(function (e) {
        busy[id] = false;
        if (!opts.quiet) {
          O.dialog({
            title: "That didn't go through",
            note: (e && e.message) || "Trello refused the change. Nothing was saved.",
            buttons: []
          });
        }
        throw e;
      });
  }

  /** Re-read cards and station config without repainting. */
  function refreshData() {
    return Promise.all([state.ctx.cards(), WFTables.load(state.ctx.t)])
      .then(function (r) { state.cards = r[0]; state.cfg = r[1]; });
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

  /** Trailing-edge debounce that keeps its arguments -- the slider sends the value. */
  function debounce(fn, ms) {
    var h = null;
    return function () {
      var args = arguments, self = this;
      if (h) clearTimeout(h);
      h = setTimeout(function () { fn.apply(self, args); }, ms);
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

      // The checklist lives per station, not per phase, because the blast
      // booth, the powder booth and the cure oven share one phase and check
      // completely different things. One line per item; "text | tolerance"
      // splits into the line and the small print under it.
      var checks = O.el("textarea", { rows: "5", placeholder: "Loading…" });
      checks.disabled = true;
      WFQC.getStationChecklist(state.ctx.t, s.id, s.phase).then(function (items) {
        checks.value = items.map(function (i) {
          return i.spec ? i.text + " | " + i.spec : i.text;
        }).join("\n");
        checks.placeholder = "Dimensions match shop drawing | Within ±1/8″";
        checks.disabled = false;
      }).catch(function () {
        checks.placeholder = "Couldn't read this station's checklist.";
        checks.disabled = false;
      });
      card.appendChild(field("QC checklist — one per line, \"item | tolerance\"", checks));

      body.appendChild(card);
      rows.push({ s: s, on: on, table: table, type: type, phase: phase, who: who, checks: checks });
    });

    O.dialog({
      title: "Stations",
      note: "A station shows nothing until it has a phase. Untick a station to " +
            "take it off the screen without losing its setup. The checklist is " +
            "what Complete makes somebody work through before a job can pass.",
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
          return WFTables.save(state.ctx.t, cfg)
            .then(function () { return saveChecklists(rows); })
            .then(function () {
              state.cfg = cfg;
              qcState = {};   // stale lists must not survive an edit
              paint();
            });
        }
      }]
    });
  }

  /** Parse the textareas back into {text, spec} items and save each station's. */
  function saveChecklists(rows) {
    return rows.reduce(function (chain, r) {
      return chain.then(function () {
        if (r.checks.disabled) return null;   // never loaded; don't overwrite
        var items = r.checks.value.split("\n")
          .map(function (line) {
            var parts = String(line).split("|");
            return { text: (parts[0] || "").trim(), spec: (parts[1] || "").trim() };
          })
          .filter(function (i) { return i.text; });
        return WFQC.saveStationChecklist(state.ctx.t, r.s.id, items);
      });
    }, Promise.resolve());
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
