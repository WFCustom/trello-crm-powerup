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
      ".wf-rec-f textarea{resize:vertical;line-height:1.5}",

      /* The live rows. Louder than the rest of this tab on purpose: everything
         else here is read at a desk with a question in mind, and this one strip
         is the only thing on the screen somebody might glance at from the other
         side of the office to see whether the shop is moving. */
      ".wf-rec-live{display:grid;grid-template-columns:116px minmax(0,1.6fr) minmax(0,1fr) auto;",
      "gap:16px;align-items:center;padding:12px 15px;margin-bottom:8px;border-radius:13px;",
      "background:#fff;border:1px solid var(--wf-line);border-left:6px solid var(--wf-line)}",
      ".wf-rec-live.is-run{border-left-color:var(--wf-go);background:var(--wf-tint-go)}",
      ".wf-rec-live.is-pause{border-left-color:var(--wf-amber);background:var(--wf-tint-amber)}",
      ".wf-rec-live.is-done{border-left-color:var(--wf-steel);background:var(--wf-tint-steel)}",
      /* Not started: progress on the slider, nothing on the clock. Deliberately
         the quietest row on the strip -- it is here so the work is not
         invisible, not because it wants attention. */
      ".wf-rec-live.is-idle{border-left-color:var(--wf-steel)}",
      ".wf-rec-state{display:flex;align-items:center;gap:8px;font-family:var(--wf-font-cond);",
      "font-size:16px;font-weight:700;letter-spacing:.07em;text-transform:uppercase}",
      ".is-run .wf-rec-state{color:var(--wf-ink-go)}",
      ".is-pause .wf-rec-state{color:var(--wf-ink-amber)}",
      ".is-done .wf-rec-state{color:var(--wf-steel)}",
      ".is-idle .wf-rec-state{color:var(--wf-steel)}",
      /* COLOUR IS NOT THE ONLY DIFFERENCE, and that is deliberate: a colour-blind
         reader, a sun-washed screen and a greyscale print all lose it. Running is
         a round mark that breathes, paused is a square one that does not. */
      ".wf-rec-state b{display:block;width:11px;height:11px;background:currentColor;",
      "border-radius:50%}",
      ".wf-rec-live.is-pause .wf-rec-state b{border-radius:2px}",
      // Hollow, not filled: nothing has happened on this one yet.
      ".wf-rec-live.is-idle .wf-rec-state b{border-radius:2px;background:none;",
      "box-shadow:inset 0 0 0 2px currentColor}",
      ".wf-rec-live.is-run .wf-rec-state b{animation:wf-rec-beat 1.6s ease-in-out infinite}",
      "@keyframes wf-rec-beat{0%,100%{opacity:1}50%{opacity:.2}}",
      ".wf-rec-pct{display:flex;align-items:center;gap:11px;font-weight:700;",
      "font-variant-numeric:tabular-nums}",
      ".wf-rec-pct .wf-rec-bar{flex:1;height:9px;background:#fff}",
      ".is-run .wf-rec-bar i{background:var(--wf-go)}",
      ".is-pause .wf-rec-bar i{background:var(--wf-amber)}",
      ".is-done .wf-rec-bar i{background:var(--wf-steel)}",
      ".is-idle .wf-rec-bar i{background:var(--wf-steel)}",
      ".wf-rec-clock{font-family:var(--wf-font-cond);font-size:27px;font-weight:700;",
      "font-variant-numeric:tabular-nums;color:var(--wf-navy);white-space:nowrap;line-height:1}",
      ".wf-rec-h2{font-size:19px;font-weight:700}"
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

  /* ------------------------------------------------------------- the clock */

  /**
   * MAY THIS PERSON SEE A RUNNING CLOCK? Leadership, and nobody else.
   *
   * `see.timers` at scope "all" -- the grant that reads "every time log, not
   * just the ones in your area" -- rather than a capability of its own. A
   * second switch for the same question is a second switch to forget, and the
   * thing being withheld here is not a new secret: lib/tables.js' elapsedMinutes
   * explains why the shop floor never sees a ticking clock, and a worker who
   * cannot see one at his bench must not be able to open Records and watch it
   * there instead. Only the leadership preset ships with "all"; a shop or
   * office manager holds "area", which gets them the archive and no clock.
   *
   * Fails closed, twice over. `scopeFor` is built by ops.js, which cannot
   * construct a ctx without WFPerms, so its absence means we are somewhere that
   * never granted anything -- and the safe answer there is no.
   *
   * The SECOND guard is not belt and braces. This used to be unreachable
   * without WFPerms: the Time section carried `minScope`, `allowed()` refused
   * it when the library was missing, and a function that never ran could
   * dereference a global that was not there. Opening Time to everyone made
   * `liveTracker` -- and therefore this -- run on every Time render, so a
   * missing permissions.js stopped being a tightened gate and became a
   * ReferenceError that refresh()'s catch turned into "Couldn't load the
   * records" for the whole tab. Probe with `typeof`, which is the only form
   * that cannot throw; see the same note in `allowed()`.
   */
  function maySeeClock(ctx) {
    if (!ctx || typeof ctx.scopeFor !== "function") return false;
    if (typeof WFPerms === "undefined" || !WFPerms || !WFPerms.atLeast) return false;
    return WFPerms.atLeast(ctx.scopeFor("see.timers"), "all");
  }

  /**
   * May this reader see the ARCHIVE half of Time -- everybody's hours, the
   * two ratios, the export?
   *
   * "area", not "all". This is a different question from maySeeClock and
   * deliberately a lower bar: a shop or office manager needs last month's
   * numbers to plan with and does not need a clock ticking at a named
   * welder. "own" is the grant a welder holds so he can read his own time at
   * his own bench, and it has never meant he may read everyone's.
   *
   * Fails closed, same as maySeeClock and for the same reason: a ctx with no
   * scopeFor is one that never granted anything.
   */
  function maySeeArchive(ctx) {
    if (!ctx) return false;
    if (typeof ctx.scopeFor === "function") {
      if (typeof WFPerms === "undefined" || !WFPerms || !WFPerms.atLeast) return false;
      return WFPerms.atLeast(ctx.scopeFor("see.timers"), "area");
    }
    /* Pre-capability ctx: answer with the same role list the Time section
     * itself used before scopes existed. maySeeClock can hard-refuse here
     * because a legacy ctx never promised a clock to anyone; this one cannot,
     * because refusing would hide the archive from the very managers the old
     * model let in -- the opposite of the leak this is closing. */
    return ctx.role === "manager" || ctx.role === "office";
  }

  /**
   * ONE interval for the whole tab, replaced rather than added to on each paint.
   *
   * There is no teardown hook on O.tab to hang this on -- ops.js' renderActive
   * empties #view and builds the next tab's node, so a tab is never told it is
   * leaving. What it IS told, implicitly, is that its host stopped being part
   * of the document: the isConnected check below is the teardown, and it is the
   * same one the Floor uses. Without it every visit to this tab would leave a
   * second clock running against a detached row for the life of the window.
   *
   * If a real lifecycle hook ever lands, this is one of the three places that
   * should stop guessing -- see popups/tabs/floor.js and popups/tabs/workboard.js.
   */
  var tick = null;

  function stopTimers() {
    if (tick) { clearInterval(tick); tick = null; }
  }

  /**
   * One second, not the Floor's thirty: these read h:mm:ss, so every tick
   * changes a character. The Floor's chips read h:mm and would be repainting
   * the same text twenty-nine times out of thirty on a TV left on all day.
   *
   * The elapsed figure is re-read from the phase work rather than counted up
   * from a number captured at paint time. Same answer for a running job, and
   * for a PAUSED one it is the only right answer: elapsedMs stops where the
   * last segment closed, so a paused clock stands still, which is the state
   * showing itself.
   */
  function startClock() {
    tick = setInterval(function () {
      if (!state.host || !state.host.isConnected) { stopTimers(); return; }
      Array.prototype.forEach.call(
        state.host.querySelectorAll(".wf-rec-clock[data-card]"), function (node) {
          var ms = elapsedOf(node.getAttribute("data-card"));
          // A tablet with an unreadable clock gives NaN here. openEntries drops
          // that row before it is ever painted, so this is belt and braces --
          // but "NaN:NaN:NaN" in 27px type is not a thing to risk.
          if (isFinite(ms)) node.textContent = O.clock(ms);
        });
    }, 1000);
  }

  /**
   * Milliseconds on a card's clock, read fresh from the phase work.
   *
   * Through O.activeWork so phase work left behind by an EARLIER phase is
   * ignored, which is the same rule lib/phase.js applies and the reason a
   * card claimed and then moved does not keep ticking here.
   */
  function elapsedOf(cardId) {
    var cards = state.cards || [];
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].id === cardId) {
        var work = O.activeWork(cards[i]);
        return work ? WFPhase.elapsedMs(work) : NaN;
      }
    }
    return NaN;
  }

  /**
   * Safety and Training are everybody's. Quality names individuals and their
   * sign-offs. Time is TWO things with two different audiences, and that is
   * why only one of them is gated here.
   *
   * THE GATE MOVED DOWN A LEVEL, ON PURPOSE. It was briefly on the Time
   * section itself, with `minScope: "area"`, to close a real leak: `ctx.can`
   * is true at ANY scope above none, every preset including `worker` holds
   * see.timers at "own" so a welder can read his own clock, and the archive
   * -- by-person hours for the whole shop, the ratios, the CSV export -- sat
   * behind that bare check. Closing it at the section closed too much. The
   * live mirror in the same section is the half the shop floor is shown
   * anyway: state and percent, no clock. Gating the section took that away
   * too and left a welder with a Records tab containing one pill reading
   * "Training". So Time stays open to everyone and `doneTracker` carries the
   * scope test instead -- see `maySeeArchive`.
   *
   * THE ROLE LIST WENT WITH THE minScope, and for the same reason. `roles` is
   * how an unscoped section answers a pre-capability ctx, and `["manager",
   * "office"]` was the OLD policy written out twice: refuse the whole of Time
   * to a welder. Leaving it behind would have meant a legacy ctx still hiding
   * the live mirror from the shop floor while a capability ctx showed it --
   * the same question answered two different ways depending on which side of
   * the permissions release you were on. Time now has no role list, so the
   * legacy answer is yes and `maySeeArchive`'s own role list ("manager" or
   * "office") is the only place the old distinction still lives: the archive.
   */
  var SECTIONS = [
    { id: "time", label: "Time", cap: "see.timers" },
    // Quality is a straight section gate and stays one: qc.sign at "own"
    // means a welder may sign his own work, which does not qualify him to
    // read the shop's whole QC history. There is no floor-visible half here
    // the way there is in Time.
    { id: "quality", label: "Quality", cap: "qc.sign", minScope: "area", roles: ["manager", "office"] },
    { id: "safety", label: "Safety", cap: "safety.view" },
    { id: "training", label: "Training" }
  ];

  function allowed(ctx, s) {
    /* A SCOPED SECTION IS ANSWERED BY THE SCOPE MODEL OR NOT AT ALL.
     *
     * `ctx.can` is true at ANY scope above none, which is precisely the grant
     * `minScope` exists to refuse -- every preset including `worker` holds
     * see.timers at "own". So `can` must never stand in as a fallback for a
     * section that declares a minScope: that is not a degraded answer, it is
     * the wrong one, and it fails OPEN on the exact path this guard was added
     * to close. Each branch below therefore refuses rather than relaxes.
     *
     * There is no `global` in this file -- it is a bare IIFE, not one of the
     * lib modules that takes `window` as a parameter -- so WFPerms is probed
     * with `typeof`, which is the only form that cannot throw. Reaching for
     * `global.WFPerms` here threw a ReferenceError on EVERY render, for
     * everyone, and took the whole tab down with it.
     */
    if (s.cap && s.minScope) {
      // In the capability world: ops.js hangs `can` and `scopeFor` together,
      // so `scopeFor` present means the scope model is the question being
      // asked. If WFPerms is missing we cannot compare two scopes, and the
      // safe answer to a question we cannot evaluate is no.
      if (typeof ctx.scopeFor === "function") {
        if (typeof WFPerms === "undefined" || !WFPerms || !WFPerms.atLeast) return false;
        return WFPerms.atLeast(ctx.scopeFor(s.cap), s.minScope);
      }
      // Pre-capability context -- no scopeFor, and therefore no `can` either.
      // The role list is the only answer such a ctx can give, and a scoped
      // section that names no roles gets refused rather than waved through.
      return !!s.roles && s.roles.indexOf(ctx.role) !== -1;
    }

    // Unscoped sections keep the old order: the board's own answer when there
    // is one, the fixed role list otherwise. Safety is the case that makes
    // this worth doing -- everyone may FILE a report, and who may READ them is
    // a decision this shop should own rather than inherit from a role name.
    if (s.cap && typeof ctx.can === "function") return ctx.can(s.cap);
    return !s.roles || s.roles.indexOf(ctx.role) !== -1;
  }

  function visibleSections(ctx) {
    return SECTIONS.filter(function (s) { return allowed(ctx, s); });
  }

  /* --------------------------------------------------------------- loading */

  function paint() {
    if (!state.host) return;
    // Before the rows it ticks are thrown away, not after: a paint that left
    // the old interval running would have it hunting for nodes that no longer
    // exist, and the next paint would start a second one beside it.
    stopTimers();
    state.host.innerHTML = "";
    add(state.host, header());
    add(state.host, rail());
    add(state.host, section());
    if (state.host.querySelector(".wf-rec-clock")) startClock();
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

  /**
   * TWO TRACKERS, AND THEY ARE DELIBERATELY NOT THE SAME FURNITURE.
   *
   * Live work is a mirror of what the benches are doing this second: one row
   * per phase, state and progress, nothing averaged and nothing totalled into
   * the archive. Completed work is the archive: signed-off phases, a total,
   * and the two ratios the shop is trying to learn.
   *
   * Keeping them apart is the same judgement `ongoing` encodes in the library,
   * one level up. A half-finished phase counted as a build time makes the shop
   * look slower than it is; a finished phase shown as live makes it look
   * busier. Both were on this screen before -- the stats were right and the
   * "Running right now" panel quietly listed completed phases that had not yet
   * moved on, with the clock beside them still being read as a clock.
   */
  function timeView() {
    var all = WFRecords.timeEntries(state.cards);
    var entries = WFRecords.since(all, state.days);
    var open = WFRecords.openEntries(state.cards);
    var wrap = O.el("div");

    wrap.appendChild(O.el("div.wf-pagehead", { style: "margin-bottom:14px" },
      O.el("div.wf-h2.wf-rec-h2", { text: "Time worked" })));

    wrap.appendChild(liveTracker(open.filter(function (e) { return !e.finished; })));

    /* THE ARCHIVE IS THE GATED HALF, NOT THE SECTION. A welder reaches Time
     * because he holds see.timers at "own" -- enough to watch the board move,
     * which is what the live mirror above is and what the shop floor is shown
     * anyway. It is not enough to read everybody's hours, the ratios and the
     * CSV. That distinction used to live on the SECTIONS entry, where it cost
     * the welder both halves; see the comment there. */
    if (maySeeArchive(state.ctx)) {
      wrap.appendChild(doneTracker(entries, open.filter(function (e) { return e.finished; })));
    }
    return wrap;
  }

  /**
   * The live mirror: what has a timer on it right now, and how far along it is.
   *
   * No period picker, because "last 90 days" is not a question you can ask
   * about now, and no total hours unless the reader may see a clock at all.
   */
  function liveTracker(rows) {
    var showClock = maySeeClock(state.ctx);
    /* THREE STATES IN THE SUBTITLE TOO. This used to read
       `rows.length - running` paused, which was true while every row had a
       clock on it. A percent-only row now reaches this list and has no clock,
       so that arithmetic filed it under "paused" -- the panel heading saying
       somebody walked away from a job whose own row, two inches below, reads
       "Not started". Counted from the flags instead, so the two cannot drift. */
    var running = rows.filter(function (e) { return e.running; }).length;
    var paused = rows.filter(function (e) { return e.paused; }).length;
    var idle = rows.length - running - paused;
    var note = rows.length
      ? [running + " running", paused + " paused"]
          .concat(idle ? [idle + " not started"] : []).join(" · ")
      : "nothing on a bench at the moment";

    /* The one figure the live tracker totals, and it is made of clocks, so it
       is gated exactly like the per-row ones. "So far" rather than "right now"
       because a paused job's minutes are in it: the question this answers is
       how much time is sunk into what is open, not how many timers are
       turning. */
    var total = (showClock && rows.length)
      ? O.el("div", { style: "font-size:13px;color:var(--wf-muted)" },
          O.el("span", { text: "on these jobs so far: " }),
          O.el("b", { text: O.hours(rows.reduce(function (n, e) {
            return n + e.minutes;
          }, 0)) }))
      : null;

    var p = O.panel("Live work", note, total);
    if (!rows.length) {
      p.body(O.el("div.wf-rec-note", {
        text: "No bench has anything open right now. A job appears here the " +
              "moment somebody taps Start — or the moment a manager moves its " +
              "slider — and stays while it is paused." }));
      return p;
    }
    p.body(O.el("div", null, rows.map(function (e) { return liveRow(e, showClock); })));
    return p;
  }

  /**
   * One live job: what state it is in, who has it, how far along, how long.
   *
   * The state is said three ways -- a word, a colour and the shape of the mark
   * beside it -- because this is the one strip on the tab somebody reads at a
   * glance rather than studies, and a single cue is one bad monitor away from
   * no cue at all.
   */
  function liveRow(e, showClock) {
    /* THREE STATES, NOT TWO. A row with progress but no segments is neither:
     * nobody has started the clock on it, so "Paused" would claim somebody
     * walked away from work that has not begun. It reaches this list because
     * a manager pushed its slider, and that is worth showing -- as what it
     * is. See openEntries, which stopped conflating zero-clock with no-row. */
    var kind = e.running ? "run" : e.paused ? "pause" : "idle";
    var word = e.running ? "Running" : e.paused ? "Paused" : "Not started";
    var row = O.el("div.wf-rec-live.is-" + kind, null,
      O.el("div.wf-rec-state", null,
        O.el("b"),
        O.el("span", { text: word })),
      O.el("div", null,
        O.el("div.wf-job", { text: e.job }),
        O.el("div.wf-jobsub", { text: e.who || "unclaimed" })),
      progress(e.percent));

    /* THE CLOCK IS THE ONLY THING WITHHELD. State and percent are on every
     * row for everybody who can open this section at all -- they are what the
     * shop floor is shown too, and they are the half of the mirror that is
     * about the job rather than about the person holding it. */
    if (showClock) {
      row.appendChild(O.el("div.wf-rec-clock", {
        // The exact elapsed, not `e.minutes * 60000`. The row's minutes are
        // rounded, so painting from them and then letting the ticker correct
        // it a second later makes the clock jump by up to half a minute the
        // moment you look at it.
        text: O.clock(elapsedOf(e.cardId)),
        // Lets the ticker find this node again without repainting the panel,
        // and tells it which card to re-read. Same trick as the Floor's chips.
        "data-card": e.cardId
      }));
    }
    return row;
  }

  /** The percent, as a number and a bar, coloured by the row's state. */
  function progress(pct) {
    var n = Math.max(0, Math.min(100, Math.round(pct || 0)));
    return O.el("div.wf-rec-pct", null,
      O.el("div.wf-rec-bar", null, O.el("i", { style: "width:" + n + "%" })),
      O.el("span", { text: n + "%" }));
  }

  /**
   * Completed work: signed-off phases, totalled.
   *
   * `settling` is the awkward third case -- phases marked complete whose cards
   * have not moved on yet. They belong on this side of the line rather than in
   * the live mirror (nobody is working them), but they are not in the total
   * either, because the total counts phaseLog and they are not in it yet. Shown
   * without any figure at all for that reason: an uncounted number printed next
   * to a total is an invitation to add it on.
   */
  function doneTracker(entries, settling) {
    var s = WFRecords.timeSummary(entries);
    var wrap = O.el("div");

    var right = O.el("div", { style: "display:flex;gap:8px;align-items:center" },
      periodPicker(),
      O.btn("Export", { onClick: function () { openExport(entries); } }));
    var head = O.el("div.wf-pagehead", { style: "margin:22px 0 14px" },
      O.el("div.wf-h2.wf-rec-h2", { text: "Completed work" }));
    right.classList.add("wf-spacer");
    head.appendChild(right);
    wrap.appendChild(head);

    if (!entries.length) {
      wrap.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "No finished phases recorded in this period." }),
        O.el("div.muted", { text: "A phase lands here once a manager approves it, " +
          "so the log fills up as work is signed off." })));
      // Last, here as below: the totals are the headline of this half of the
      // screen, and the settling rows are a footnote about what is not in them.
      if (settling.length) wrap.appendChild(settlingPanel(settling));
      return wrap;
    }

    wrap.appendChild(O.el("div.wf-stats", null,
      /* `s.phases`, NOT `s.entries`. A phase that changed hands emits one row
       * per person so the hours land on the right names, so `s.entries` is a
       * ROW count -- it read a two-person CAD job as "2 finished phases" under
       * a correct hours figure, which is the combination most likely to be
       * believed. `s.phases` counts distinct (card, phase, step, when). */
      O.stat("Hours logged", Math.round(s.hours), s.phases + " finished phases"),
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

    if (settling.length) wrap.appendChild(settlingPanel(settling));
    return wrap;
  }

  /**
   * Finished, but the card has not moved on yet.
   *
   * Normally the gap between complete() and advance() is one round trip and
   * nobody sees this. It lasts when the move failed, and forever on a card
   * finished under the retired approval model. Either way the phase is at
   * 100% and nobody is working it, so showing it as live would be a lie about
   * both the state and the person's whereabouts.
   */
  function settlingPanel(rows) {
    var p = O.panel("Finished, waiting to move on",
      "complete at 100% — they join the totals above once the card advances");
    p.body(O.el("div", null, rows.map(function (e) {
      return O.el("div.wf-rec-live.is-done", null,
        O.el("div.wf-rec-state", null, O.el("b"), O.el("span", { text: "Complete" })),
        O.el("div", null,
          O.el("div.wf-job", { text: e.job }),
          O.el("div.wf-jobsub", { text: e.who || "unclaimed" })),
        progress(e.percent),
        // No elapsed figure, for anybody. It is a finished number that the
        // total beside it does not include, and the only thing to do with a
        // number like that is add it in by hand and be wrong.
        O.el("div"));
    })));
    return p;
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
    // Rows and phases are not the same number once a phase has changed hands,
    // and the CSV has one row per person -- so the dialog counts the phases
    // the export is ABOUT, the same figure the headline above it shows.
    var phases = WFRecords.timeSummary(entries).phases;
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
      note: phases + " finished phases",
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
