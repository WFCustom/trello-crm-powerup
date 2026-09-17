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
      /* THE FLOOR IS A NAVY PAGE WITH WHITE CARDS ON IT.
       *
       * Not a tab inside the grey ops shell -- that was the mistake here for
       * several passes. The mock is a full-viewport navy field and the stations
       * are white cards floating on it, and the reason is not taste: this
       * screen is read from across a shop, often off a TV, and white-on-navy
       * carries at ten feet where grey-on-grey does not.
       *
       * The negative margins break out of .wf-body's padding so the navy runs
       * edge to edge. Every value below is from the approved mock. */
      ".wf-fl{--p-bg:#0f2340;--p-panel:#ffffff;--p-tile:#eef1f6;--p-track:#cfd7e2;",
      "--p-ink:#12213a;--p-muted:#5b6b80;--p-accent:#e8a317;--p-ok:#1f9d63;",
      "--p-warn:#d9482e;--p-idle:#8896a8;",
      "margin:-30px -32px -40px;padding:22px 26px 30px;background:var(--p-bg);",
      "min-height:100vh;color:#fff;position:relative}",

      /* THE SEAM.
       *
       * The ops window's own header is #0f2340 and so is this canvas, so
       * without something here the chrome and the floor merge into one navy
       * slab and the tab bar looks like it is floating in the page.
       *
       * Rather than change the mock's navy -- which is the one colour we most
       * want to be faithful to -- the join is drawn: a hairline of light at the
       * top edge, and a short shadow falling onto the canvas from above, so the
       * chrome reads as sitting OVER the floor rather than being part of it.
       * Costs nothing elsewhere in the Power-Up and is two lines to remove. */
      ".wf-fl:before{content:'';position:absolute;left:0;right:0;top:0;height:1px;",
      "background:rgba(255,255,255,.16)}",
      ".wf-fl:after{content:'';position:absolute;left:0;right:0;top:1px;height:22px;",
      "background:linear-gradient(rgba(0,0,0,.28),rgba(0,0,0,0));pointer-events:none}",

      /* --- top bar: content on the navy, not a bar sitting on a page -- */
      ".wf-fl-top{display:flex;align-items:center;gap:16px;flex-wrap:wrap;",
      "color:#fff;padding:2px 4px 20px}",
      /* The area reads as the quiet second half of a wordmark, as in the mock:
         "WESTERN FABRICATION  MAIN SHOP". The ops window supplies the first
         half in its own header, so repeating it here would be shouting twice. */
      ".wf-fl-area{font-family:'Barlow Condensed',inherit;font-size:19px;font-weight:700;",
      "letter-spacing:.14em;text-transform:uppercase;line-height:1;color:rgba(255,255,255,.72)}",
      ".wf-fl-tabs{display:flex;gap:7px}",
      ".wf-fl-tab{cursor:pointer;font:inherit;font-size:13px;font-weight:600;padding:7px 16px;",
      "border-radius:999px;border:1.5px solid rgba(255,255,255,.3);background:transparent;color:#fff}",
      ".wf-fl-tab:hover{border-color:#fff}",
      ".wf-fl-tab.is-on{background:#fff;color:var(--p-bg);border-color:#fff}",
      ".wf-fl-clock{margin-left:auto;text-align:right;line-height:1.1}",
      ".wf-fl-clock b{font-family:'Barlow Condensed',inherit;font-size:30px;font-weight:700;display:block}",
      ".wf-fl-clock span{font-size:11px;opacity:.7;letter-spacing:.11em;text-transform:uppercase}",
      ".wf-fl-top button.wf-btn{background:transparent;border:1.5px solid rgba(255,255,255,.3);",
      "color:#fff}",
      ".wf-fl-top button.wf-btn:hover{border-color:#fff;background:rgba(255,255,255,.12)}",

      /* --- summary strip: translucent on the navy, never a white bar --- */
      ".wf-fl-sum{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}",
      ".wf-fl-s{flex:1 1 120px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);",
      "border-radius:16px;padding:10px 14px}",
      ".wf-fl-s b{font-family:'Barlow Condensed',inherit;font-size:26px;font-weight:700;",
      "display:block;line-height:1;color:#fff}",
      ".wf-fl-s span{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;",
      "color:rgba(255,255,255,.66)}",

      /* --- station cards: WHITE, floating on the navy ----------------- */
      ".wf-fl-grid{display:grid;gap:16px;align-items:start}",
      /* Lift, not outline. On navy a dark shadow alone does almost nothing --
         it is the thin light edge that separates a white card from the field,
         and the long soft shadow underneath that makes it sit above rather
         than sit in. Both together read as a physical card on a dark wall,
         which is the whole point of this screen. */
      ".wf-fl-col{background:var(--p-panel);border-radius:26px;padding:20px 20px 22px;",
      "display:flex;flex-direction:column;gap:12px;min-width:0;color:var(--p-ink);",
      "box-shadow:0 0 0 1px rgba(255,255,255,.22),0 22px 44px rgba(3,10,22,.55),",
      "0 4px 10px rgba(3,10,22,.32)}",
      /* Header, straight off the mock: station name large and condensed, status
         with its dot pushed right, the type-and-operator line in small tracked
         caps beneath, then a solid rule in the status colour. */
      ".wf-fl-h{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}",
      ".wf-fl-name{font-family:'Barlow Condensed',inherit;font-size:30px;font-weight:700;",
      "letter-spacing:.01em;color:var(--p-ink);line-height:1}",
      ".wf-fl-st{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;font-weight:700;",
      "letter-spacing:.1em;text-transform:uppercase;color:var(--s);margin-left:auto;white-space:nowrap}",
      ".wf-fl-st i{width:9px;height:9px;border-radius:50%;background:var(--s);display:block}",
      ".wf-fl-who{font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;",
      "color:var(--p-muted);width:100%;margin-top:2px}",
      ".wf-fl-rule{height:4px;border-radius:2px;background:var(--s);margin-top:2px}",

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

      /* NEXT UP: two tiles side by side, as in the mock.
         Two, not three, and never a scrolling stack -- this is "what am I
         building after this one", and a list long enough to need reading is the
         Full queue's job. Square-ish so the pair reads as a set rather than as
         two rows that happen to be adjacent. */
      ".wf-fl-q{display:grid;grid-template-columns:1fr 1fr;gap:9px}",
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

      /* Scoped to the Next up grid: the Full queue view reuses .wf-fl-t in a
         horizontal row with reorder arrows and must keep that shape. */
      ".wf-fl-q .wf-fl-t{flex-direction:column;gap:5px;padding:12px 13px;",
      "min-height:104px;border-radius:16px}",
      ".wf-fl-q .wf-fl-t-top{display:flex;align-items:baseline;gap:8px;width:100%}",
      ".wf-fl-q .wf-fl-t-p{font-size:12px;letter-spacing:.06em;min-width:0}",
      ".wf-fl-q .wf-fl-t-num{font-family:'Barlow Condensed',inherit;font-size:21px;",
      "font-weight:700;line-height:1;color:var(--p-ink)}",
      ".wf-fl-q .wf-fl-t-m{flex:1 1 auto;width:100%;display:flex;flex-direction:column}",
      ".wf-fl-q .wf-fl-t-d{margin-top:auto;padding-top:6px}",
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
      ".wf-fl-svg{width:15px;height:15px;display:block}",
      ".wf-fl-due{font:inherit;font-size:inherit;border:0;background:none;padding:0;",
      "color:var(--p-muted);cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}",
      ".wf-fl-due:hover{color:var(--p-ink)}",
      ".wf-fl-due.is-late{color:var(--p-warn);font-weight:700}",
      ".wf-fl-assign .wf-fl-svg{width:16px;height:16px}",
      ".wf-fl-assign{display:inline-flex;align-items:center;gap:8px}",

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
      ".wf-fl-allrow{display:flex;gap:14px;align-items:center;flex-wrap:wrap;",
      "padding:2px 0 4px;border-bottom:1px solid var(--p-track);margin-bottom:4px}",
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

      /* .wf-body carries different padding on a phone, so the full-bleed
         margins have to match it or the navy stops short of the edges. */
      "@media (max-width:600px){.wf-fl{margin:-18px -14px -28px;padding:16px 14px 22px}",
      ".wf-fl-top{padding:2px 2px 14px}.wf-fl-area{font-size:16px}",
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
  var state = { area: "shop", cfg: null, cards: null, host: null, ctx: null, scale: null };

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
    // Kept so repaintColumn redraws a column at the size its neighbours are at.
    var scale = state.scale = WFTables.scaleFor(cols);
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

  /** stationId -> "station" | "card" | "qc" | "assign" | "queue" | "preview" */
  var views = {};

  /** stationId -> the pool card being previewed from the assign list. */
  var previewing = {};

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
    /* THE SCALE COMES FROM THE GRID, NOT FROM THIS COLUMN.
     *
     * This used to recompute it with a station count of 1 -- which answers "one
     * column wide", so type came back at the single-column size while the three
     * columns beside it stayed at the four-up size. Every repaint (a checkbox,
     * closing a view, a switch) blew that one column's job number from 34px to
     * 56px inside a grid track that had not changed width, so the text rewrapped
     * and the whole card jumped. That is the preview "shrinking up": the column
     * was being redrawn to a layout it is not in.
     *
     * state.scale is whatever the last full paint decided, which is the only
     * value that agrees with the neighbours. */
    var fresh = column(st, state.scale || WFTables.scaleFor(
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

    // A pool card being read before it is assigned. Same panel, but the way out
    // is back to the list you opened it from, not to the station.
    if (kind === "preview" && previewing[st.station.id]) {
      col.classList.add("is-card");
      col.appendChild(WFCardPanel.inline(state.ctx, previewing[st.station.id], {
        kicker: "Trello card",
        backLabel: "‹ Back to list",
        onBack: function () {
          delete previewing[st.station.id];
          setView(st, "assign");
        }
      }));
      return col;
    }

    /* A VIEW WHOSE SUBJECT HAS GONE FALLS BACK, IT DOES NOT DRAW NOTHING.
     *
     * Both of these are reachable: "card" when the job leaves the bench while
     * somebody is reading it (completed elsewhere, moved phase, a repaint
     * triggered by another station's write), "preview" when a reload clears the
     * previewed card. Without the fallback, viewHeader is handed a kind it has
     * no title or body for and renders a blank white column with a rule and an
     * ×, which looks like the Power-Up broke rather than like the job moved. */
    if (kind === "preview") kind = "assign";
    if (kind === "card") kind = "station";

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

    var assign = O.el("button.wf-fl-ic", {
      type: "button", title: "Assign a job to this station", "aria-label": "Assign a job",
      onClick: function () { setView(st, "assign"); }
    });
    assign.appendChild(icon("person-plus"));
    row.appendChild(assign);

    var qc = O.el("button.wf-fl-ic" + (signed ? ".is-passed" : ""), {
      type: "button",
      title: signed
        ? "QC passed · " + ((signed.signedBy && signed.signedBy.fullName) || signed.signature)
        : "QC checklist · sign off",
      "aria-label": "QC checklist",
      onClick: function () { setView(st, "qc"); }
    });
    qc.appendChild(icon("clipboard-check"));
    row.appendChild(qc);

    var open = O.el("button.wf-fl-ic", {
      type: "button", title: "Open this card here", "aria-label": "Open the card",
      onClick: function () { setView(st, "card"); }
    });
    open.appendChild(icon("arrow-out"));
    row.appendChild(open);
    return row;
  }

  /**
   * Line icons, drawn rather than typed.
   *
   * The first pass used whatever unicode glyph was closest -- "⇲" for assign --
   * and it read as an arrow into a corner, not as a person. A glyph is at the
   * mercy of whichever font the TV falls back to; an inline SVG is the same
   * shape on every screen in the building. Lucide geometry, stroke 2.5, to
   * match the mock.
   */
  function icon(name) {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "wf-fl-svg");

    (PATHS[name] || []).forEach(function (d) {
      var p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    });
    return svg;
  }

  var PATHS = {
    // A head and shoulders with a plus -- Lucide user-plus. The mock's assign icon.
    "person-plus": [
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
      "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
      "M19 8v6", "M22 11h-6"
    ],
    // A clipboard with a tick -- the QC checklist.
    "clipboard-check": [
      "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
      "M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z",
      "M9 14l2 2 4-4"
    ],
    // Out of the box -- open the card.
    "arrow-out": [
      "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
      "M15 3h6v6", "M10 14L21 3"
    ]
  };

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

    /* NOTHING IS DRAWN UNTIL THERE IS A PICTURE.
     *
     * This used to append an empty grey frame straight away and remove it again
     * if no cover came back -- so a card with no image flashed a grey box and
     * then collapsed, and every repaint did it again. That is the flicker: not
     * the preview vanishing, but a placeholder that should never have been
     * there appearing first.
     *
     * The slot is a zero-height anchor that only becomes a frame once an image
     * actually resolves, so a card without one simply never has a gap.
     *
     * A station that cannot reach the card still has to draw the station, so
     * the whole fetch sits inside a promise chain: a missing endpoint costs the
     * picture, not the column. */
    var shot = O.el("div");
    box.appendChild(shot);
    Promise.resolve()
      .then(function () { return WFRest.getCardDetail(state.ctx.t, st.job.id); })
      .then(function (full) {
        var url = WFCardView.coverFrom(full);
        // The column may have been repainted while this was in flight.
        if (!url || !shot.isConnected) return;
        shot.className = "wf-fl-cover";
        shot.appendChild(O.el("img", { src: url, alt: "", loading: "lazy" }));
      })
      .catch(function () { /* no picture, no frame, no gap */ });

    var who = WFTables.activeWork(st.job);
    var person = (who && who.claimedBy) ? O.displayName(who.claimedBy) : st.station.welder;
    var meta = O.el("div.wf-fl-meta", null,
      O.el("span", { text: initials(person) + " · " + (person || "unclaimed") }));
    if (st.phase) {
      meta.appendChild(O.el("span.wf-fl-dot"));
      meta.appendChild(O.el("span", { text: st.phase }));
    }
    // The due date, and -- for whoever schedules -- a way to move it without
    // leaving the station. A job going red on the shop floor is exactly when
    // somebody wants to push the date, and making them open the card, scroll to
    // the field and come back is how dates quietly stop being maintained.
    var late = WFTables.isLate(st.job);
    var due = dueText(st.job) || "no date set";
    meta.appendChild(O.el("span.wf-fl-dot"));
    if (canSchedule()) {
      meta.appendChild(O.el("button.wf-fl-due" + (late ? ".is-late" : ""), {
        type: "button", text: due + " · change",
        title: "Move this job's due date",
        onClick: function () { openDue(st); }
      }));
    } else {
      meta.appendChild(O.el("span", {
        text: due, style: late ? "color:var(--p-warn);font-weight:700" : ""
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
    // One source for both the guard and the value. It used to test
    // activeWork(st.job) and then read st.work, which are the same object only
    // because stationState always sets job and work together -- a coincidence
    // to rely on for a TypeError.
    var work = WFTables.activeWork(st.job);
    var pct = work && typeof work.percentComplete === "number"
      ? Math.max(0, Math.min(100, work.percentComplete)) : 0;

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

    /* START IS NEVER ABSENT FROM A JOB ON THE BENCH.
     *
     * This used to render a sentence instead of the buttons whenever the job
     * had no claim on it, which turned an unclaimed job into a dead end: no way
     * to start it, no way to clear it, and -- because the bench slot is above
     * the queue -- no way to get at the work behind it either. A welder
     * standing at that station has no move.
     *
     * A job on a bench with nobody's name on it is not a locked state, it is
     * just a job nobody has picked up. Start picks it up: claim it and put it
     * on the clock in one press, which is exactly what tapping it in the queue
     * would have done. Whose name goes on it is answered by pressing the
     * button, not by finding somebody to assign it first.
     */
    var claimed = !!(WFTables.activeWork(st.job) || {}).claimedBy;

    row.appendChild(O.el("button.wf-fl-btn", {
      type: "button",
      text: running ? "■ Stop" : "▶ Start",
      title: claimed ? "" : "Nobody has claimed this job — starting it claims it for you",
      onClick: function () {
        write(st, function () {
          if (running) return WFPhase.pause(state.ctx.t, st.job);
          if (claimed) return WFPhase.resume(state.ctx.t, st.job);
          return WFPhase.claimAndStart(state.ctx.t, st.job, state.ctx.member);
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

  /**
   * Is there phase work here for a control to act on?
   *
   * Deliberately NOT "is it claimed". It used to be, and that hid the percent
   * slider on any job without a claim -- which, combined with the Start button
   * being hidden for the same reason, left the bench with a job on it and not a
   * single control. `setPercentComplete` writes onto whatever phase work
   * exists, claimed or not, so there is nothing for the stricter test to
   * protect.
   */
  function canWork(st) {
    return !!WFTables.activeWork(st.job);
  }

  /**
   * Who may move a promise made to a customer.
   *
   * A due date is a commitment somebody else is planning around, so it stays
   * with the people who schedule. A welder can see it has gone red and say so;
   * they can't quietly buy themselves a week.
   */
  function canSchedule() {
    var ctx = state.ctx;
    if (typeof ctx.can === "function") return ctx.can("edit.due");
    return ctx.role === "manager" || ctx.role === "office";
  }

  /**
   * Move a due date from the station.
   *
   * The quick buttons are there because the realistic answer to "this is going
   * to be late" is almost always a few days, and a date picker for that is four
   * interactions to say something you already knew. The picker stays for the
   * cases where the real answer is a specific day.
   */
  function openDue(st) {
    var card = st.job;
    var base = card.due ? new Date(card.due) : new Date();
    if (WFTables.isLate(card)) base = new Date();   // bump from today, not from the miss

    var picker = O.el("input", {
      type: "datetime-local",
      style: "font:inherit;font-size:14px;padding:8px 10px;border-radius:10px;" +
             "border:1px solid var(--wf-line);width:100%;box-sizing:border-box"
    });
    if (card.due) picker.value = WFCardPanel.toLocalInput(card.due);

    var note = O.el("div.muted", { style: "font-size:12.5px;margin-top:8px" });
    var quick = O.el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px" });
    [["+1 day", 1], ["+3 days", 3], ["+1 week", 7], ["+2 weeks", 14]].forEach(function (p) {
      quick.appendChild(O.btn(p[0], {
        small: true,
        onClick: function () {
          var d = new Date(base.getTime() + p[1] * 86400000);
          picker.value = WFCardPanel.toLocalInput(d.toISOString());
          note.textContent = "New date: " + d.toLocaleString();
        }
      }));
    });

    O.dialog({
      title: "Due date for " + (jobNumber(card) || jobTitle(card)),
      note: card.due
        ? (WFTables.isLate(card) ? "Past due " : "Currently due ") +
          new Date(card.due).toLocaleString() +
          ". Pushing from today, not from the date it missed."
        : "This job has no due date, so nothing can be forecast for it.",
      content: O.el("div", null, quick, picker, note),
      buttons: [{
        label: "Save the date", primary: true, busyText: "Saving…",
        onClick: function () {
          if (!picker.value) return;
          return doWrite(st, function () {
            return WFRest.updateCard(state.ctx.t, card.id,
              { due: new Date(picker.value).toISOString() });
          });
        }
      }]
    });
  }

  function idle(st) {
    var box = O.el("div.wf-fl-idle", null,
      O.el("b", { text: "Open" }),
      O.el("div", { text: st.note || "Nothing started yet." }));
    var go = O.el("button.wf-fl-assign", {
      type: "button", onClick: function () { setView(st, "assign"); }
    });
    go.appendChild(icon("person-plus"));
    go.appendChild(O.el("span", { text: "Assign a job to this station" }));
    box.appendChild(go);
    return box;
  }

  /* ------------------------------------------------------------- the queue */

  function queue(st, scale) {
    // Always two. The mock shows a pair side by side and stops, because this
    // answers "what's after this one" -- anything past that is the Full queue's
    // job, and a third tile only shrinks the two that matter.
    var show = 2;
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

  /**
   * One "Next up" tile.
   *
   * Position and job number share the top line, the way the mock has it --
   * "01  #2431". The number is what a welder recognises from across the shop,
   * so it gets the weight; the position is just running order and stays small.
   */
  function queueTile(st, c, i) {
    var late = WFTables.isLate(c);
    var w = WFTables.activeWork(c);
    var who = w && w.claimedBy ? O.firstName(w.claimedBy) : "Unclaimed";
    var num = jobNumber(c);

    var top = O.el("div.wf-fl-t-top", null,
      O.el("div.wf-fl-t-p", { text: String(i + 1).padStart(2, "0") }));
    if (num) top.appendChild(O.el("div.wf-fl-t-num", { text: num }));

    return O.el("button.wf-fl-t" + (late ? ".is-late" : "") + (st.job ? "" : ".is-open"), {
      type: "button",
      title: st.job ? "Switch to this job" : "Start this job",
      style: "width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer",
      onClick: function () { requestStart(st, c); }
    },
      top,
      O.el("div.wf-fl-t-m", null,
        // Without a number in the name there is nothing on the top line worth
        // reading, so the name takes the headline instead of being demoted.
        O.el("div.wf-fl-t-n", { text: num ? jobTitle(c) : c.name }),
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

      // Send it somewhere else. The queue is the one place you can see the
      // whole backlog for a bench, so it is where somebody realises this job
      // belongs on a different one -- making them go to the other station and
      // hunt for it in an assign list is the long way round.
      var others = movableTo(st);
      if (others.length) {
        var to = O.el("select.wf-fl-sel", { style: "margin:2px 0 10px" });
        to.appendChild(O.el("option", { value: "", text: "Move to another station…" }));
        others.forEach(function (o) {
          to.appendChild(O.el("option", {
            value: o.station.id,
            text: o.station.table + (o.phase && o.phase !== st.phase ? " · " + o.phase : "")
          }));
        });
        to.addEventListener("change", function () {
          if (!to.value) return;
          moveToStation(st, c, to.value);
        });
        box.appendChild(to);
      }
    });
    return box;
  }

  /**
   * Stations this job could go to instead.
   *
   * Only ones pulling the same phase: a bench that draws from another list will
   * never show the card, so offering it would be a move that looks like it
   * worked and then loses the job. Ones on another screen are included and
   * labelled, because the finishing bay is exactly where a shop job legitimately
   * needs sending.
   */
  function movableTo(st) {
    var all = WFTables.areas().reduce(function (acc, a) {
      return acc.concat(WFTables.areaState(
        state.ctx.boardCfg, state.cards, state.cfg, a.id));
    }, []);
    return all.filter(function (o) {
      return o.station.id !== st.station.id && o.phase && o.phase === st.phase;
    });
  }

  function moveToStation(st, card, stationId) {
    var target = movableTo(st).filter(function (o) {
      return o.station.id === stationId;
    })[0];
    if (!target) return;
    write(st, function () {
      // End of the destination's queue: it has its own order and dropping a
      // card into the middle of it would reshuffle somebody else's day.
      return WFTables.setStation(state.ctx.t, card, stationId, target.queue.length);
    }, { keepView: "queue" });
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

      /* SAY WHEN A JOB IS ALREADY SOMEBODY'S.
       *
       * The pool is "not on a station", which is not the same as "nobody has
       * it": a job claimed and started from My jobs has no tableId and lands
       * here looking exactly like fresh work. WFPhase.assign overwrites
       * phaseWork wholesale, so one tap threw away that person's claim, their
       * segments and their percentage with no warning and no way back.
       *
       * Reassigning genuinely is needed -- somebody leaves a job running and
       * goes home -- so the tile says whose it is and how far along, and the
       * button asks before it clobbers. The manager keeps the power; they just
       * stop using it by accident. */
      var held = WFTables.activeWork(c);
      if (held && held.claimedBy) {
        var pct = typeof held.percentComplete === "number" ? held.percentComplete : 0;
        tile.appendChild(O.el("div.wf-fl-t-d", {
          style: "color:var(--p-warn);font-weight:700",
          text: (WFTables.isRunning(held) ? "On the clock — " : "Claimed by ") +
                O.displayName(held.claimedBy) + " · " + pct + "%"
        }));
      }

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
  /**
   * Preview a pool card without leaving the column.
   *
   * It goes through the view state like everything else. It used to reach into
   * the DOM and rewrite the column directly while `views` still said "assign",
   * so the next paint -- a write on another station, a window resize, the
   * 30-second clock -- silently threw the preview away and snapped back to the
   * list. Somebody reading a drawing lost it because a colleague pressed Start
   * three benches away.
   */
  function previewFromAssign(st, card) {
    previewing[st.station.id] = card;
    setView(st, "preview");
  }

  function assignTo(st, card, username) {
    var member = ((state.ctx.board && state.ctx.board.members) || [])
      .filter(function (m) { return m.username === username; })[0];
    if (!member) return;

    // Reassigning live work destroys the claim, the segments and the percent,
    // and there is no undo. Ask once, naming what gets lost.
    var held = WFTables.activeWork(card);
    if (held && held.claimedBy && held.claimedBy.username !== username) {
      var mins = WFTables.elapsedMinutes(held);
      return O.dialog({
        title: "Take this off " + O.firstName(held.claimedBy) + "?",
        note: O.displayName(held.claimedBy) + " has this job at " +
              (held.percentComplete || 0) + "%" +
              (mins ? " with " + WFTables.clockText(mins) + " logged" : "") +
              ". Assigning it to " + O.displayName(member) +
              " clears that and starts the phase from zero. There is no undo.",
        buttons: [{
          label: "Reassign to " + O.firstName(member), primary: true,
          busyText: "Reassigning…",
          onClick: function () { return doAssign(st, card, member); }
        }, {
          label: "Leave it with " + O.firstName(held.claimedBy), quiet: true
        }]
      });
    }
    doAssign(st, card, member);
  }

  function doAssign(st, card, member) {
    return write(st, function () {
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
      // Stamped with the job, so qcView can tell an in-progress list for THIS
      // job from one left behind by the last job on this bench.
      var q = qcState[st.station.id];
      if (!q || q.cardId !== st.job.id) q = qcState[st.station.id] = { cardId: st.job.id };
      q.pending = true;
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
          // The delete only runs on a real pass. A dropped or failed write must
          // leave the signed state exactly where it was.
          return doWrite(st, function () {
            return WFQC.passSigned(state.ctx.t, st.job, st.job);
          })
            .then(function () { delete qcState[st.station.id]; })
            .catch(function (e) { if (!e || !e.dropped) throw e; });
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

    /* A CHECKLIST IN PROGRESS BELONGS TO A JOB, NOT TO A BENCH.
     *
     * qcState is keyed by station, and nothing cleared it when the job on that
     * station changed. So a welder who ticked 7 of 10 on one job and then got
     * pulled onto another opened the checklist on the NEW job already showing
     * "7 of 10 checked" -- for work nobody had inspected. Tick the last three,
     * sign, and the stored record asserts a careful line-by-line check of a job
     * that was never looked at.
     *
     * That is worse than a UI glitch. The entire argument for replacing manager
     * approval with a signed checklist is that the checklist is a truer record
     * than an approval click; a checklist that inherits somebody else's ticks is
     * a worse one. So the job it was started against is stamped on it, and a
     * mismatch throws the whole thing away and starts clean. */
    if (q && q.cardId && q.cardId !== st.job.id) {
      delete qcState[id];
      q = null;
    }

    if (!q || !q.items) {
      box.appendChild(O.el("div.loading", { text: "Reading the checklist…" }));
      WFQC.checklistFor(state.ctx.t, st.station).then(function (r) {
        qcState[id] = Object.assign({ checked: {}, signature: "", signedBy: "" },
          qcState[id] || {},
          { cardId: st.job.id, items: r.items, listName: r.name, source: r.source });
        repaintColumn(st);
      }).catch(function () {
        qcState[id] = Object.assign({ checked: {}, signature: "", signedBy: "" },
          qcState[id] || {},
          { cardId: st.job.id, items: [], listName: null, source: "draft" });
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

    // Which list this is. Worth naming: a station picking up the wrong list by
    // name-match is the one failure of the library that a person can spot
    // instantly and the code never can.
    box.appendChild(O.el("div.wf-fl-more", {
      text: q.listName
        ? "Working the “" + q.listName + "” checklist"
        : "No saved checklist — working the shipped draft"
    }));

    var total = q.items.length;
    var checked = q.items.filter(function (_, i) { return q.checked[i]; }).length;
    var head = O.el("div.wf-fl-pct", null,
      O.el("span", { text: checked + " of " + total + " checked" }),
      O.el("span", { text: Math.round((checked / Math.max(1, total)) * 100) + "%" }));
    var fill = O.el("i", { style: "width:" + Math.round((checked / Math.max(1, total)) * 100) + "%" });
    box.appendChild(head);
    box.appendChild(O.el("div.wf-fl-bar", null, fill));

    /* AN EMPTY CHECKLIST MUST NOT BE A LOCKED DOOR.
     *
     * Only Assemble ships with a default list, so the blast booth, the powder
     * booth, the cure oven and Install all land here with nothing to tick. This
     * used to return before the rest of the view was built -- including, as it
     * happens, the manager-only "Edit this list" button, which lives inside
     * checkAllRow. Complete sends you to the checklist, the checklist has no
     * items, canSignOff refuses an empty list, so the job cannot be passed on
     * and the one control that could fix it was below the early return. The
     * whole finishing bay could start work and never hand it off, and the
     * manager standing right there could not unblock it either.
     *
     * So the row comes first and the message sits under it: a manager builds
     * the list without leaving the bench, and everyone else is told plainly
     * whose job that is.
     */
    if (!total) {
      box.appendChild(checkAllRow(st, q, 0, 0));
      box.appendChild(O.el("div.wf-fl-more", {
        text: state.ctx.isManager
          ? "No checklist for this station yet. Build one with “Edit this list” " +
            "above — it saves to the shared library, so every station using it " +
            "gets it."
          : "No checklist set up for this station yet, so this job can't be " +
            "passed on. A manager needs to build one — tell them, and they can " +
            "do it from this screen."
      }));
      return box;
    }

    box.appendChild(checkAllRow(st, q, checked, total));

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
   * Check all, and clear all.
   *
   * SAY THE QUIET PART. A one-tap "I did all of these" is genuinely what
   * somebody who has built the same gate four hundred times needs -- making
   * them tap ten boxes they already know the answer to is theatre, and theatre
   * is what teaches people to stop reading. But it is also, obviously, the
   * fastest way to sign for work nobody looked at.
   *
   * So the button exists and the record tells the truth about it: ticking the
   * list one line at a time and ticking it in one go are stored differently,
   * and `checkedAll` rides on the signed record. Nobody is stopped; if a job
   * comes back, the record can answer honestly how carefully it was checked.
   * Clear all is there so an accidental tap isn't ten taps to undo.
   */
  function checkAllRow(st, q, checked, total) {
    var all = total > 0 && checked === total;
    var row = O.el("div.wf-fl-allrow");

    // With no items there is nothing to check or clear, and the row exists only
    // to carry "Edit this list" for a manager building the list from here.
    if (total) row.appendChild(O.el("button.wf-fl-link", {
      type: "button",
      text: all ? "Clear all" : "Check all " + total,
      onClick: function () {
        if (all) {
          q.checked = {};
          q.checkedAll = false;
        } else {
          q.items.forEach(function (_, i) { q.checked[i] = true; });
          // Only counts as a bulk tick if it wasn't nearly done by hand already.
          q.checkedAll = checked === 0;
        }
        repaintColumn(st);
      }
    }));

    if (state.ctx.isManager) {
      row.appendChild(O.el("button.wf-fl-link", {
        type: "button", text: "Edit this list",
        onClick: function () { editChecklist(st, q); }
      }));
    }
    return row;
  }

  /**
   * Add and remove items without leaving the station.
   *
   * Edits go to the named library entry, which is the same thing the Roster
   * edits -- so a manager fixing a badly worded line at the bench fixes it
   * everywhere, rather than creating a second version of the list that only
   * this station sees. If the station is working a shipped draft, saving here
   * promotes it into a real named list for the first time.
   */
  function editChecklist(st, q) {
    var items = q.items.map(function (i) { return { text: i.text, spec: i.spec || "" }; });
    var name = q.listName || st.station.phase || st.station.table || st.station.id;

    var nameField = O.el("input", {
      type: "text", value: name,
      style: "font:inherit;font-size:14px;padding:8px 10px;border-radius:10px;" +
             "border:1px solid var(--wf-line);width:100%;box-sizing:border-box"
    });

    var listWrap = O.el("div", { style: "display:flex;flex-direction:column;gap:6px" });
    function paintItems() {
      listWrap.innerHTML = "";
      if (!items.length) {
        listWrap.appendChild(O.el("div.muted", { style: "font-size:13px", text: "No items yet." }));
      }
      items.forEach(function (it, i) {
        var text = O.el("input", {
          type: "text", value: it.text, placeholder: "What to check",
          style: "flex:2 1 160px;font:inherit;font-size:13.5px;padding:6px 9px;" +
                 "border-radius:9px;border:1px solid var(--wf-line)"
        });
        text.addEventListener("input", function () { it.text = text.value; });
        var spec = O.el("input", {
          type: "text", value: it.spec, placeholder: "Tolerance (optional)",
          style: "flex:1 1 120px;font:inherit;font-size:12.5px;padding:6px 9px;" +
                 "border-radius:9px;border:1px solid var(--wf-line)"
        });
        spec.addEventListener("input", function () { it.spec = spec.value; });

        listWrap.appendChild(O.el("div", {
          style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap"
        }, text, spec,
          O.btn("↑", { small: true, quiet: true, onClick: function () {
            if (!i) return;
            var t2 = items[i - 1]; items[i - 1] = items[i]; items[i] = t2; paintItems();
          } }),
          O.btn("↓", { small: true, quiet: true, onClick: function () {
            if (i === items.length - 1) return;
            var t2 = items[i + 1]; items[i + 1] = items[i]; items[i] = t2; paintItems();
          } }),
          O.btn("Remove", { small: true, quiet: true, onClick: function () {
            items.splice(i, 1); paintItems();
          } })));
      });
    }
    paintItems();

    var adder = O.el("input", {
      type: "text", placeholder: "Add an item and press Enter",
      style: "font:inherit;font-size:13.5px;padding:8px 10px;border-radius:10px;" +
             "border:1px solid var(--wf-line);width:100%;box-sizing:border-box;margin-top:8px"
    });
    adder.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      var v = adder.value.trim();
      if (!v) return;
      items.push({ text: v, spec: "" });
      adder.value = "";
      paintItems();
    });

    O.dialog({
      title: "Checklist for " + (st.station.table || "this station"),
      note: "This is the shared list, not a copy — changes show up anywhere else " +
            "using it. Editing a list never changes a check somebody already signed.",
      content: O.el("div", null,
        O.el("div.wf-cp-k", { text: "List name" }), nameField,
        O.el("div", { style: "height:10px" }),
        listWrap, adder),
      buttons: [{
        label: "Save the list", primary: true, busyText: "Saving…",
        onClick: function () {
          var newName = nameField.value.trim();
          if (!newName) return;
          var clean = items.filter(function (i) { return String(i.text || "").trim(); });
          return WFQC.saveLibraryEntry(state.ctx.t, newName, clean)
            .then(function () {
              // Point the station at it explicitly, so a rename can't orphan it.
              var s = state.cfg.stations.filter(function (x) {
                return x.id === st.station.id;
              })[0];
              if (s) s.checklist = newName;
              return WFTables.save(state.ctx.t, state.cfg);
            })
            .then(function () {
              delete qcState[st.station.id];
              return refreshData();
            })
            .then(paint);
        }
      }]
    });
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

  /**
   * Sign the checklist -- and stop there.
   *
   * Signing used to pass the job on in the same action, which meant the mock's
   * "are you sure you're sending this to Sandblast?" question never appeared
   * and there was no moment between attesting to the work and letting go of it.
   * Signing now returns to the station with Complete gone green; Complete is
   * what ships it, and it asks first.
   */
  function signOff(st, q) {
    var signer = ((state.ctx.board && state.ctx.board.members) || [])
      .filter(function (m) { return m.username === q.signedBy; })[0];
    // A button that does nothing and says nothing is how this whole afternoon
    // started. If the chosen signer can't be resolved against the board, say so.
    if (!signer) {
      return O.dialog({
        title: "Pick who checked it",
        note: "That name isn't on this board any more, so the sign-off has " +
              "nobody to attribute. Choose someone from the list and sign again.",
        buttons: []
      });
    }

    // doWrite, not write: write() swallows the rejection and resolves, so the
    // `delete` below ran even when the sign-off had failed -- the welder got
    // "That didn't go through" AND lost every tick, the signature and the
    // signer, and had to work the whole list again. A failure must leave the
    // work in progress exactly where it was.
    doWrite(st, function () {
      return WFQC.signOff(state.ctx.t, st.job, {
        stationId: st.station.id,
        phase: st.phase,
        listName: q.listName,
        items: q.items,
        checked: q.checked,
        // Ticked in one go rather than line by line. Recorded, not prevented --
        // if a job comes back, the record answers honestly how it was checked.
        checkedAll: !!q.checkedAll,
        signature: q.signature,
        signedBy: signer,
        worker: state.ctx.member
      });
    })
      .then(function () { delete qcState[st.station.id]; })
      .catch(function () { /* dialog already shown; the checklist stays put */ });
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

    /* A DROPPED PRESS HAS TO SAY SO.
     *
     * The guard is right -- two writes to one station racing each other is how
     * a job ends up on two benches. But it used to resolve silently, so a
     * button press during an in-flight write closed its dialog and changed
     * nothing, with no error and no clue. "Pause and switch does nothing" looks
     * identical whether the switch failed or was never attempted, and it cost
     * an afternoon to tell those apart.
     *
     * The stamp is the second half: a write that never settles (a hung REST
     * call) would otherwise leave the flag set forever and every later press on
     * that station would vanish into it for the rest of the session. After
     * twenty seconds the station is assumed free rather than assumed stuck,
     * because a shop that has to reload the page is worse than two writes.
     */
    if (busy[id] && Date.now() - busy[id] < 20000) {
      if (!opts.quiet) {
        O.dialog({
          title: "One thing at a time",
          note: "This station is still saving the last change. Give it a second " +
                "and press again — nothing was lost.",
          buttons: []
        });
      }
      /* REJECT, DO NOT RESOLVE.
       *
       * Resolving here says "that worked" to every caller that chains a .then,
       * and the thing they chain is usually cleanup -- signOff deletes the
       * worked checklist, confirmComplete deletes the QC state. A dropped press
       * would therefore throw away the welder's ticks, their signature and their
       * signer while writing nothing at all: the precise bug the guard's own
       * comment claims to have fixed, reintroduced through the guard.
       *
       * `dropped` marks it as "never attempted" rather than "failed", so the
       * error dialog below is not shown twice for one press. */
      return Promise.reject(Object.assign(
        new Error("A change is already saving on this station."), { dropped: true }));
    }
    busy[id] = Date.now();

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
        // A dropped press already had its say above; showing a second dialog
        // for one press is how people learn to dismiss dialogs without reading.
        if (!opts.quiet && !(e && e.dropped)) {
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
   * Station setup: what exists, what kind it is, who's on it and which
   * checklist it works. Configuration only -- this never touches a job.
   *
   * The checklist names have to be in hand before the dialog paints, because a
   * dropdown that fills in half a second after you open it is a dropdown people
   * close before it finishes.
   */
  function openStations() {
    WFQC.libraryNames(state.ctx.t)
      .catch(function () { return []; })
      .then(paintStations);
  }

  function paintStations(libNames) {
    var cfg = JSON.parse(JSON.stringify(state.cfg));
    var phases = WFTables.phaseOptions(state.ctx.boardCfg);
    var people = ((state.ctx.board && state.ctx.board.members) || []).slice()
      .sort(function (a, b) {
        return O.displayName(a).localeCompare(O.displayName(b));
      });

    var body = O.el("div");
    var list = O.el("div");
    var rows = [];

    /**
     * One station's card in the editor.
     *
     * The type dropdown is the important control: picking "Welding" points the
     * station at Assemble Legacy without anybody choosing a list, which is what
     * makes a fifth welding bench a ten-second job. The phase dropdown stays
     * underneath as an override, because the board can grow a list this code
     * has never heard of and guessing silently would be worse than asking.
     */
    function addRow(s) {
      var shown = (cfg.visible || []).indexOf(s.id) !== -1;

      var on = O.el("input", { type: "checkbox" });
      on.checked = shown;

      var table = O.el("input", { type: "text", value: s.table || "" });

      var kind = O.el("select");
      WFTables.types().forEach(function (tp) {
        var o = O.el("option", { value: tp.id, text: tp.label });
        if (tp.id === s.type) o.selected = true;
        kind.appendChild(o);
      });

      var phase = O.el("select");
      var fillPhases = function (selected) {
        phase.innerHTML = "";
        phase.appendChild(O.el("option", { value: "", text: "No phase yet" }));
        phases.forEach(function (p) {
          var o = O.el("option", { value: p, text: p });
          if (p === selected) o.selected = true;
          phase.appendChild(o);
        });
      };
      fillPhases(s.phase);

      // Changing the type re-points the queue. Silently leaving the old phase
      // behind is how a bench ends up labelled Welding and pulling powder work.
      kind.addEventListener("change", function () {
        fillPhases(WFTables.phaseForType(kind.value));
      });

      var who = O.el("select");
      who.appendChild(O.el("option", { value: "", text: "Unassigned" }));
      people.forEach(function (m) {
        var o = O.el("option", { value: m.username, text: O.displayName(m) });
        if (m.username === s.welder) o.selected = true;
        who.appendChild(o);
      });

      var area = O.el("select");
      WFTables.areas().forEach(function (a) {
        var o = O.el("option", { value: a.id, text: a.label });
        if (a.id === s.area) o.selected = true;
        area.appendChild(o);
      });

      var card = O.el("div", {
        style: "border:1px solid var(--wf-line);border-radius:14px;padding:12px 14px;" +
               "margin-bottom:10px;display:flex;flex-direction:column;gap:8px"
      });

      var head = O.el("div", {
        style: "display:flex;align-items:center;gap:8px;font-weight:600"
      },
        on, O.el("span", { text: s.table || s.id }));
      head.appendChild(O.btn("Remove", {
        small: true, danger: true,
        onClick: function () {
          // Recorded by id so the station stays gone. A plain filter would let
          // the shipped default walk back in on the next load.
          cfg.removed = (cfg.removed || []).concat([s.id]);
          cfg.stations = cfg.stations.filter(function (x) { return x.id !== s.id; });
          rows = rows.filter(function (r) { return r.s.id !== s.id; });
          card.parentNode.removeChild(card);
        }
      }));
      head.lastChild.style.marginLeft = "auto";
      card.appendChild(head);

      card.appendChild(field("Station name", table));
      card.appendChild(field("What kind of station", kind));
      card.appendChild(field("Queue pulls from", phase));
      card.appendChild(field("Who's on it", who));
      card.appendChild(field("Which screen", area));

      // A station POINTS AT a checklist; it doesn't own one. The lists live in
      // one library that the Roster edits, so the same list can serve four
      // welding benches and a manager fixes a badly worded line once.
      var check = O.el("select");
      check.appendChild(O.el("option", { value: "", text: "Match by name automatically" }));
      (libNames || []).forEach(function (n) {
        var o = O.el("option", { value: n, text: n });
        if (n === s.checklist) o.selected = true;
        check.appendChild(o);
      });
      card.appendChild(field("QC checklist", check));

      var whichNote = O.el("div.muted", { style: "font-size:11.5px;margin-top:-4px" });
      card.appendChild(whichNote);
      WFQC.checklistFor(state.ctx.t, s).then(function (r) {
        whichNote.textContent = r.name
          ? "Currently working “" + r.name + "” · " + r.items.length + " items"
          : "No saved list matches — working the shipped draft of " +
            r.items.length + " items. Make one in the Roster.";
      }).catch(function () { whichNote.textContent = ""; });

      list.appendChild(card);
      rows.push({ s: s, on: on, table: table, kind: kind, phase: phase,
                  who: who, area: area, check: check });
    }

    cfg.stations.forEach(addRow);
    body.appendChild(list);

    var adder = O.el("div", { style: "display:flex;gap:8px;align-items:center;margin-top:4px" });
    var newKind = O.el("select", { style: "width:auto;padding:6px 10px;border-radius:9px" });
    WFTables.types().forEach(function (tp) {
      newKind.appendChild(O.el("option", { value: tp.id, text: tp.label }));
    });
    adder.appendChild(newKind);
    adder.appendChild(O.btn("Add a station", {
      onClick: function () {
        var s = WFTables.newStation(cfg, state.area, newKind.value);
        s.table = WFTables.typeLabel(newKind.value) + " station";
        cfg.stations.push(s);
        cfg.visible = (cfg.visible || []).concat([s.id]);
        // Un-remove it, in case this id was deleted earlier in the same sitting.
        cfg.removed = (cfg.removed || []).filter(function (id) { return id !== s.id; });
        addRow(s);
      }
    }));
    body.appendChild(adder);

    O.dialog({
      title: "Stations",
      note: "Stations describe the shop, not the board — four welding benches " +
            "all pull the same list. The kind of station sets where its queue " +
            "comes from. Untick one to take it off the screen without losing " +
            "its setup; Remove deletes it for good.",
      content: body,
      buttons: [{
        label: "Save", primary: true, busyText: "Saving…",
        onClick: function () {
          var visible = [];
          rows.forEach(function (r) {
            r.s.table = r.table.value.trim();
            r.s.type = r.kind.value;
            r.s.station = WFTables.typeLabel(r.kind.value);
            r.s.phase = r.phase.value;
            r.s.welder = r.who.value;
            r.s.area = r.area.value;
            r.s.checklist = r.check.value || "";
            if (r.on.checked) visible.push(r.s.id);
          });
          cfg.visible = visible;
          return WFTables.save(state.ctx.t, cfg)
            .then(function () {
              state.cfg = cfg;
              qcState = {};   // stale lists must not survive an edit
              views = {};     // a removed station must not keep a view open
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
    // The shop's screen takes the whole window. The tab bar slides away and
    // comes back when the pointer nears the top -- on a TV across a room it is
    // chrome nobody will click, and on a desk it is one motion away.
    kiosk: true,
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
