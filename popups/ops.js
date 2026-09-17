/**
 * WFOps -- shell for the full-screen ops window.
 *
 * Owns: Trello iframe handle, board/member/config/roster load, the card cache,
 * the tab registry and routing, and the shared render helpers every tab uses.
 * Tabs live in ./tabs/*.js and register themselves with WFOps.tab().
 *
 * A tab render() gets a ctx:
 *   ctx.t          Trello iframe handle
 *   ctx.board      { id, name, members }
 *   ctx.member     { username, fullName }
 *   ctx.boardCfg   WFStage.getBoardConfig(board.id)  (may be null)
 *   ctx.roster     { managers, phaseSpecialists }
 *   ctx.isManager  bool
 *   ctx.cards()    -> Promise<cards>  (cached; pass {filter:'all'} for archived)
 *   ctx.reload()   invalidate the card cache and re-render the active tab
 *   ctx.syncCard(id, extra?)  re-read ONE card's phase state through the SDK and
 *                  re-render. Use this after any phase action -- ctx.reload()
 *                  re-reads over REST, which lags the write and makes the
 *                  action look like it didn't take.
 *   ctx.goTo(id)   switch tabs
 */
(function (global) {
  "use strict";

  var t = null;
  var tabs = [];
  var active = null;
  var ctx = null;
  var cardCache = {};

  /**
   * Sandbox mode -- a manager temporarily acts as someone else so they can
   * exercise a worker's or a checker's side of a flow without a second login.
   *
   * It is deliberately in-memory only: nothing is persisted, closing the window
   * drops it. Writes made while acting genuinely record the acted-as person,
   * because the point is to test the real flow -- so the banner is loud.
   */
  var realMember = null;
  var actingAs = null;

  /**
   * Who sees what, read once at startup and re-read on every reload.
   *
   * Every role check in every tab goes through `ctx.can` rather than asking
   * about roles directly. That is the point of the exercise: the answer to
   * "may this person see costing" used to live in four files with four slightly
   * different spellings, and changing it needed a release.
   */
  var perms = null;

  /**
   * May the current person do this, and -- if a subject is given -- to this
   * particular record?
   *
   * Fails closed. A missing config or an unknown capability is "no", because
   * every other direction of failure hands somebody something they were not
   * meant to have.
   */
  function can(capId, subject) {
    if (!perms || !ctx || !ctx.member) return false;
    return WFPerms.allows(perms, ctx.member.username, capId, subject);
  }

  function scopeFor(capId) {
    if (!perms || !ctx || !ctx.member) return "none";
    return WFPerms.scopeFor(perms, ctx.member.username, capId);
  }

  /* ----------------------------------------------------------- dom helpers */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** el('div.wf-panel', {onclick: fn}, child, child…) */
  function el(spec, attrs) {
    var parts = String(spec).split(/(?=[.#])/);
    var node = document.createElement(parts.shift() || "div");
    parts.forEach(function (p) {
      if (p[0] === ".") node.classList.add(p.slice(1));
      else node.id = p.slice(1);
    });
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "html") node.innerHTML = v;
        else if (k === "text") node.textContent = v;
        else if (k === "style") node.style.cssText = v;
        else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function frag() {
    var f = document.createDocumentFragment();
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) f.appendChild(arguments[i]);
    return f;
  }

  /* --------------------------------------------------------- format helpers */

  function money(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function moneyShort(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    var a = Math.abs(n);
    if (a >= 1000000) return "$" + (n / 1000000).toFixed(1) + "m";
    if (a >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
    return "$" + Math.round(n);
  }

  function hours(mins) {
    if (mins == null || isNaN(mins)) return "—";
    var h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return h ? h + "h " + (m < 10 ? "0" : "") + m + "m" : m + "m";
  }

  function clock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return h + ":" + p(m) + ":" + p(sec);
  }

  /**
   * People stored on a card may only carry a username -- an assignment made
   * before we started passing the whole member object writes claimedBy with no
   * fullName, and calling .split() on that undefined crashed the Work board.
   * Always go through these two.
   */
  function displayName(person) {
    if (!person) return "someone";
    return person.fullName || person.username || "someone";
  }

  function firstName(person) {
    return String(displayName(person)).split(" ")[0] || "someone";
  }

  /**
   * The phase work belonging to the card's CURRENT list, or null.
   *
   * lib/phase.js intentionally ignores work whose listId doesn't match the
   * card's list -- work belongs to the phase it was claimed in. The tabs were
   * reading card.phaseWork raw, so a card claimed and then moved to another
   * list still rendered as "yours, running" while Pause and Complete silently
   * did nothing: the action layer correctly saw no active work for that phase.
   * Reading through here keeps what's shown and what's actionable in agreement.
   */
  function activeWork(card) {
    var w = card && card.phaseWork;
    if (!w) return null;
    if (w.listId && card.idList && w.listId !== card.idList) return null;
    return w;
  }

  /** True when a card carries work left behind by an earlier phase. */
  function hasOrphanedWork(card) {
    var w = card && card.phaseWork;
    return !!(w && w.listId && card.idList && w.listId !== card.idList);
  }

  /**
   * Which phase a list belongs to.
   *
   * The board has four Install columns — North, Central, South and "Next week
   * Install" — that are one phase of work as far as the shop is concerned: one
   * crew, one time allowance, one QC checklist.
   *
   * This used to be inferred by stripping any parenthetical off the list name,
   * which worked only while the odd one out was called "Install (Tuesday)". The
   * moment the columns were renamed the inference broke and one Install silently
   * became four. config.js now says the grouping outright with a `phase` field,
   * and this consults that map.
   *
   * The old stripping rule stays as a fallback, because roster entries are
   * stored under whatever the list was called when someone was added to it.
   */
  var phaseAlias = {};
  var aliasBuilt = false;

  function buildPhaseAliases(boardCfg) {
    phaseAlias = {};
    ((boardCfg && boardCfg.stages) || []).forEach(function (s) {
      if (s && s.phase && s.name) phaseAlias[s.name] = s.phase;
    });
    aliasBuilt = true;
    return phaseAlias;
  }

  function phaseKey(name) {
    var raw = String(name || "").trim();
    // Built lazily as well as at startup: phaseKey is called from tabs and from
    // the roster, and getting the answer wrong because of call order would
    // quietly split one Install back into four.
    if (!aliasBuilt && ctx && ctx.boardCfg) buildPhaseAliases(ctx.boardCfg);
    if (phaseAlias[raw]) return phaseAlias[raw];
    return raw.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  }

  /** Work phases, de-duplicated by name, each carrying all of its lists. */
  function workPhases(boardCfg) {
    if (!boardCfg) return [];
    var byKey = {};
    (boardCfg.stages || []).forEach(function (s) {
      if (!s.isWorkPhase) return;
      var key = s.phase || phaseKey(s.name);
      if (!byKey[key]) {
        byKey[key] = {
          name: key, order: s.order, listIds: [], slaDays: s.slaDays,
          isException: !!s.isException, isWorkPhase: true, primaryListId: null,
          listId: s.listId          // first list, for code that wants a single id
        };
      }
      var p = byKey[key];
      p.listIds.push(s.listId);
      if (s.order < p.order) p.order = s.order;
      if (s.isPrimaryTarget) p.primaryListId = s.listId;
      if (s.isException) p.isException = true;
      // Keep the tightest allowance across the merged lists.
      if (s.slaDays != null && (p.slaDays == null || s.slaDays < p.slaDays)) p.slaDays = s.slaDays;
    });
    return Object.keys(byKey).map(function (k) { return byKey[k]; })
      .sort(function (a, b) { return a.order - b.order; });
  }

  /** The consolidated phase a card currently sits in, or null. */
  function phaseForCard(boardCfg, card) {
    var all = workPhases(boardCfg);
    for (var i = 0; i < all.length; i++) {
      if (all[i].listIds.indexOf(card.idList) !== -1) return all[i];
    }
    return null;
  }

  /**
   * A stable colour per phase, so the same phase is the same colour every time
   * and across views. Keyed off the phase's position in the flow rather than a
   * hash, so the shop reads left-to-right through the process: office blues
   * early, shop ambers in the middle, install green at the end, rework red.
   */
  var PHASE_COLORS = [
    "#1f4e79", // Make Job Packet
    "#2f6f9f", // CAD
    "#4d7ba6", // Print CAD
    "#8a6d3b", // Assemble Legacy
    "#b07d2b", // Assemble CAP
    "#a8862f", // Assemble CNC
    "#7a5ea8", // Sandblast / Powder Coat
    "#c8471c", // ReWork
    "#1f6f4a"  // Install
  ];

  function phaseColor(boardCfg, phaseName) {
    var all = workPhases(boardCfg);
    for (var i = 0; i < all.length; i++) {
      if (all[i].name === phaseName) return PHASE_COLORS[i % PHASE_COLORS.length];
    }
    return "#5d6b7a";
  }

  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w[0]; }).join("").toUpperCase();
  }

  function timeOfDay(d) {
    return new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  }

  /**
   * Wall-clock start of the run that's currently in progress.
   * lib/phase.js stores time as a `segments` array of {start, end} pairs; the
   * in-progress one is the last entry with no `end`. (There is no `startedAt`
   * field on phaseWork -- an earlier draft of the tabs assumed one.)
   * Returns null when nothing is running.
   */
  function runningSince(work) {
    var segs = (work && work.segments) || [];
    for (var i = segs.length - 1; i >= 0; i--) {
      if (segs[i] && segs[i].start && !segs[i].end) return segs[i].start;
    }
    return null;
  }

  /**
   * True when a manager assigned this phase to someone who hasn't tapped Start
   * yet. lib/phase.js's assign() sets `claimedBy` to the assignee (plus
   * `assignedBy`) and leaves `segments` empty -- the same test connector.js uses.
   */
  function isAwaitingStart(work) {
    return !!(work && work.claimedBy && !work.pendingApproval &&
              (!work.segments || !work.segments.length));
  }

  /** Plain-language time-in-stage, matching the mockup's voice. */
  function elapsedPhrase(days) {
    if (days == null) return "—";
    if (days < 1 / 24) return "just now";
    if (days < 1) return Math.round(days * 24) + " hours";
    return Math.round(days) + (Math.round(days) === 1 ? " day" : " days");
  }

  /* ------------------------------------------------------------ ui fragments */

  function tag(text, kind) {
    return el("span.wf-tag.wf-tag-" + (kind || "quiet"), { text: text });
  }

  function btn(text, opts) {
    opts = opts || {};
    var b = el("button.wf-btn" + (opts.primary ? ".wf-btn-primary" : "") +
      (opts.danger ? ".wf-btn-danger" : "") + (opts.quiet ? ".wf-btn-quiet" : "") +
      (opts.small ? ".wf-btn-sm" : ""), { text: text, type: "button" });
    if (opts.onClick) {
      b.addEventListener("click", function () {
        if (!opts.busyText) return opts.onClick(b);
        var was = b.textContent;
        b.disabled = true; b.textContent = opts.busyText;
        Promise.resolve(opts.onClick(b)).catch(function (e) {
          global.alert((e && e.message) || "That didn't go through.");
        }).then(function () {
          if (b.isConnected) { b.disabled = false; b.textContent = was; }
        });
      });
    }
    if (opts.stub) b.setAttribute("data-wf-stub", opts.stub);
    return b;
  }

  function panel(title, note, right) {
    var head = el("div.wf-panel-h", null, el("div.wf-panel-t", { text: title }));
    if (note) head.appendChild(el("div.muted", { text: note }));
    if (right) { right.classList.add("wf-spacer"); head.appendChild(right); }
    var p = el("div.wf-panel", null, head);
    p.body = function () {
      for (var i = 0; i < arguments.length; i++) if (arguments[i]) p.appendChild(arguments[i]);
      return p;
    };
    return p;
  }

  function stat(label, value, note, alert) {
    return el("div.wf-stat" + (alert ? ".is-alert" : ""), null,
      el("div.wf-stat-k", { text: label }),
      el("div.wf-stat-v", { text: String(value) }),
      note ? el("div.wf-stat-n", { text: note }) : null);
  }

  function empty(text) { return el("div.wf-empty", { text: text }); }

  /* ---------------------------------------------------------- phase columns */

  /** A phase colour at low opacity, for tinting a column header. */
  function tint(hex, alpha) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
    if (!m) return "transparent";
    return "rgba(" + parseInt(m[1], 16) + "," + parseInt(m[2], 16) + "," +
           parseInt(m[3], 16) + "," + alpha + ")";
  }

  /**
   * Lay phases out as columns, left to right, the way the board itself reads.
   *
   * Stacked phase groups meant scrolling past CAD and Print CAD to reach
   * Assemble, which is the opposite of what a board view is for. Columns put
   * every phase on screen at once in flow order, each one collapsible so the
   * phases somebody doesn't care about can be folded down to a header.
   *
   * Colour is deliberately subtle: a solid rule across the top of the column and
   * a wash behind its header, both from WFOps.phaseColor, so the same phase is
   * the same colour in every view. Enough to stop nine columns blurring
   * together, not so much that it looks like a warning.
   *
   * spec:
   *   phases      [{ name }]            in the order to show them
   *   cardsFor    fn(phase) -> [node]   the cards for one column
   *   noteFor     fn(phase) -> string   optional line under an empty column
   *   key         string                where to remember what's collapsed
   *   tagFor      fn(phase) -> node     optional badge beside the title
   */
  function phaseColumns(ctx, spec) {
    var collapsed = (spec.collapsed && typeof spec.collapsed === "object") ? spec.collapsed : {};
    var row = el("div.wf-cols");

    (spec.phases || []).forEach(function (phase) {
      var color = phaseColor(ctx.boardCfg, phase.name);
      var cards = spec.cardsFor(phase) || [];
      var isShut = !!collapsed[phase.name];

      /* The cards are the same nodes the stacked views use, and those set a
         multi-column grid inline for a full-width row. In a 296px column that
         squashes every field, so stack their contents instead. */
      cards.forEach(function (n) {
        if (n && n.style) n.style.gridTemplateColumns = "1fr";
      });

      var caret = el("span.wf-col-caret", { text: isShut ? "▸" : "▾" });
      var body = cards.length
        ? el("div.wf-col-b", null, cards)
        : el("div.wf-col-empty", { text: (spec.noteFor && spec.noteFor(phase)) || "Nothing here." });
      if (isShut) body.style.display = "none";

      var col = el("div.wf-col" + (isShut ? ".is-collapsed" : ""));
      col.style.borderTopColor = color;

      var head = el("div.wf-col-h", {
        title: isShut ? "Show " + phase.name : "Hide " + phase.name,
        onClick: function () {
          isShut = !isShut;
          body.style.display = isShut ? "none" : "";
          caret.textContent = isShut ? "▸" : "▾";
          col.classList.toggle("is-collapsed", isShut);
          head.title = (isShut ? "Show " : "Hide ") + phase.name;
          collapsed[phase.name] = isShut;
          if (spec.key && ctx && ctx.t) {
            // Purely a convenience -- if the write fails the layout still works,
            // it just won't remember next time. Goes through ctx.t rather than
            // the module handle so this works for whoever is passed in.
            try { ctx.t.set("member", "private", spec.key, collapsed); } catch (e) {}
          }
        }
      },
        caret,
        el("div.wf-col-t", { text: phase.name }),
        spec.tagFor ? spec.tagFor(phase) : null,
        el("span.wf-col-n", { text: String(cards.length) }));
      head.style.background = tint(color, 0.1);

      col.appendChild(head);
      col.appendChild(body);
      row.appendChild(col);
    });

    return row;
  }


  /**
   * In-window dialog. We're already a fullscreen page, so this is our own
   * overlay rather than t.popup() -- which is narrow, fixed-width, and would
   * fight the layout. Escape or the backdrop cancels.
   *
   * dialog({ title, note, content, buttons:[{label, primary, quiet, onClick}] })
   * A button's onClick may return a promise; the dialog closes when it settles.
   */
  function dialog(opts) {
    opts = opts || {};
    var backdrop = el("div", {
      style: "position:fixed;inset:0;background:rgba(20,41,61,.45);z-index:9999;" +
             "display:flex;align-items:center;justify-content:center;padding:24px"
    });
    var box = el("div", {
      style: "background:#fff;border-radius:var(--wf-r-card);box-shadow:var(--wf-shadow-lift);" +
             "max-width:520px;width:100%;padding:26px 28px;max-height:80vh;overflow:auto"
    },
      el("div.wf-panel-t", { text: opts.title || "" }),
      opts.note ? el("div.muted", { style: "margin-top:4px", text: opts.note }) : null,
      opts.content ? el("div", { style: "margin-top:18px" }, opts.content) : null);

    function close() {
      document.removeEventListener("keydown", onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }

    var row = el("div.wf-actions", { style: "margin-top:22px" });
    (opts.buttons || []).forEach(function (b) {
      row.appendChild(btn(b.label, {
        primary: b.primary, quiet: b.quiet, danger: b.danger,
        busyText: b.busyText,
        onClick: function () {
          var r = b.onClick ? b.onClick() : undefined;
          if (r && r.then) return r.then(close, function (e) { close(); throw e; });
          close();
          return r;
        }
      }));
    });
    row.appendChild(btn("Cancel", { quiet: true, onClick: close }));
    box.appendChild(row);

    backdrop.appendChild(box);
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(backdrop);
    return { close: close };
  }

  /**
   * Open a card WITHOUT losing this window.
   *
   * t.showCard() replaces the fullscreen modal with Trello's card view, which
   * tears the ops window down entirely -- you come back to a cold start on the
   * default tab, having lost your place. Opening in a browser tab leaves the
   * window exactly as it was, so you just switch back.
   *
   * If the browser blocks the new tab we fall back to t.showCard rather than
   * doing nothing; the tab you were on is remembered either way (see goTo), so
   * reopening still lands you back where you were.
   */
  function openCard(card) {
    var url = card && card.shortUrl;
    if (url) {
      var w = global.open(url, "_blank", "noopener");
      if (w) return;
    }
    try { t.showCard(card.id); } catch (e) { /* nothing else we can do */ }
  }

  /* ------------------------------------------------------------------ cards */

  /**
   * Correct the phase fields straight from the SDK after a REST board fetch.
   *
   * Trello's REST plugin-data is eventually consistent: a card claimed moments
   * ago can come back from /boards/{id}/cards looking unclaimed. That's what
   * made state appear to reset after opening a card and coming back -- the
   * modal reopens, loads fresh over REST, and gets a pre-claim snapshot.
   *
   * t.get reads the same store t.set wrote to, so it's authoritative. We only
   * do this for cards sitting in work phases (37 on this board today), which
   * keeps it bounded, and only for the live "open" view -- the historical
   * filter:"all" pass is looking backwards, where REST is perfectly fine.
   */
  function overlayPhaseState(list) {
    var cfg = ctx.boardCfg;
    if (!cfg || !list || !list.length) return Promise.resolve(list);

    var isWorkList = {};
    (cfg.stages || []).forEach(function (s) { if (s.isWorkPhase) isWorkList[s.listId] = true; });
    var targets = list.filter(function (c) { return isWorkList[c.idList]; });
    if (!targets.length) return Promise.resolve(list);

    var i = 0;
    function nextBatch() {
      if (i >= targets.length) return Promise.resolve();
      var batch = targets.slice(i, i + 10);
      i += 10;
      return Promise.all(batch.map(function (c) {
        return Promise.all([
          t.get(c.id, "shared", "phaseWork", null).catch(function () { return undefined; }),
          t.get(c.id, "shared", "phaseLog", []).catch(function () { return undefined; }),
          // qcRequest isn't part of getBoardCardsFull, so it only ever arrives here.
          t.get(c.id, "shared", WFQC.KEY, null).catch(function () { return undefined; })
        ]).then(function (r) {
          if (r[0] !== undefined) c.phaseWork = r[0];
          if (r[1] !== undefined) c.phaseLog = r[1];
          if (r[2] !== undefined) c.qcRequest = r[2];
        });
      })).then(nextBatch);
    }
    return nextBatch().then(function () { return list; });
  }

  function cards(opts) {
    var key = (opts && opts.filter) || "open";
    if (!cardCache[key]) {
      cardCache[key] = Promise.all([
        WFRest.getBoardCardsFull(t, ctx.board.id, opts || {}),
        // Pricing lives in the "$Value" custom field that sales already keeps
        // up to date. Never let a pricing failure take the whole view down.
        WFPricing.getBoardValues(t, ctx.board.id, opts || {}).catch(function () { return {}; })
      ]).then(function (r) {
        var list = r[0] || [], byCard = r[1] || {};
        list.forEach(function (c) {
          var fromField = byCard[c.id];
          if (fromField == null) return;
          c.fieldValue = fromField;
          c.economics = c.economics || {};
          // A figure typed into Job Economics is a deliberate override, so it
          // wins. Otherwise $Value fills it in, tagged so the UI can say so.
          if (c.economics.value == null || c.economics.value === "") {
            c.economics.value = fromField;
            c.economics.valueFrom = WFPricing.fieldName();
          }
        });
        // Test mode last: getBoardCardsFull reads what Trello has, which by
        // design is not what this session has done. Without this the screen
        // would forget every change the moment it repainted.
        return Promise.resolve(key === "open" ? overlayPhaseState(list) : list)
          .then(function (out) { return WFSandbox.decorate(out); });
      });
    }
    return cardCache[key];
  }

  /**
   * One place that decides someone's role, so it can't drift.
   * WFStage.isManager reads config.js directly -- keep honouring it so the
   * hardcoded managers still have rights on a board whose roster was never saved.
   */
  function resolveRole(roster, username) {
    var role = WFRoster.roleOf(roster, username);
    if (role !== "manager" && WFStage.isManager(username)) role = "manager";
    return role;
  }

  function reload() {
    cardCache = {};
    WFRest.invalidateBoardCards(ctx.board.id);
    WFPricing.invalidate(ctx.board.id);
    // Re-read the roster on every reload so a role or responsibility change
    // takes effect immediately -- tabs appear/disappear on the spot rather than
    // waiting for the window to be reopened. Previously ctx.roster was read once
    // at startup, so edits had no visible effect at all.
    return Promise.all([
      WFRoster.getRoster(t),
      // Re-read permissions here too, so an edit on the Roster takes effect the
      // moment it is saved rather than on the next window. A permission change
      // nobody can see happen is a permission change people repeat.
      WFPerms.load(t).catch(function () { return perms; })
    ]).then(function (r) {
      if (r[0]) {
        ctx.roster = r[0];
        ctx.role = resolveRole(r[0], ctx.member.username);
        ctx.isManager = ctx.role === "manager";
      }
      if (r[1]) { perms = r[1]; ctx.perms = perms; }
    }).catch(function () { /* keep whatever we had */ })
      .then(function () { return renderActive(); });
  }

  /** Copy own properties of src onto dst (kept ES5-plain like the rest of this file). */
  function assignInto(dst, src) {
    Object.keys(src).forEach(function (k) { dst[k] = src[k]; });
    return dst;
  }

  /** Mutate the already-resolved card objects in every cached list. */
  function patchCachedCard(cardId, patch) {
    return Promise.all(Object.keys(cardCache).map(function (k) {
      return cardCache[k].then(function (list) {
        (list || []).forEach(function (c) { if (c.id === cardId) assignInto(c, patch); });
      }).catch(function () { /* a failed list will be refetched anyway */ });
    }));
  }

  /**
   * Refresh one card after an action, WITHOUT re-fetching the board.
   *
   * This is the fix for actions appearing to "bounce". Phase state is written
   * with t.set(), which goes through Trello's SDK, but getBoardCardsFull() reads
   * it back over the REST API -- and that read lags the write. Re-rendering off
   * a fresh REST fetch therefore repainted the OLD state and the row snapped
   * back, even though the write had succeeded.
   *
   * t.get() reads the same store t.set() wrote to, so it is immediately
   * consistent. We read the card's phase state back through the SDK, patch it
   * into the cached list in place, and re-render off that.
   *
   * `extra` is for facts the caller already knows that the SDK can't tell us --
   * chiefly idList after an approve moves the card to the next phase.
   */
  function syncCard(cardId, extra) {
    return Promise.all([
      WFPhase.getPhaseWork(t, cardId).catch(function () { return undefined; }),
      t.get(cardId, "shared", "phaseLog", []).catch(function () { return undefined; }),
      t.get(cardId, "shared", WFQC.KEY, null).catch(function () { return undefined; })
    ]).then(function (r) {
      var patch = {};
      if (r[0] !== undefined) patch.phaseWork = r[0];
      if (r[1] !== undefined) patch.phaseLog = r[1];
      if (r[2] !== undefined) patch.qcRequest = r[2];
      if (extra) assignInto(patch, extra);
      return patchCachedCard(cardId, patch);
    }).then(function () {
      // Drop the REST cache so the next *full* load can't serve a stale copy
      // from inside its 2-minute window.
      WFRest.invalidateBoardCards(ctx.board.id);
      return renderActive();
    });
  }

  /* ------------------------------------------------------------------- tabs */

  function tab(def) { tabs.push(def); }

  /* -------------------------------------------------------------- tab order */

  /**
   * Where the tab bar's order comes from.
   *
   * Three layers, most specific first: this person's own arrangement, then the
   * board's default, then the order the scripts happen to load in. A saved
   * order is a list of tab ids, and anything NOT in it keeps its registration
   * position at the end -- so adding a new tab later makes it appear rather
   * than silently vanish because an old saved order didn't mention it.
   */
  var BOARD_ORDER_KEY = "wfTabOrder";
  var MY_ORDER_KEY = "tabOrder";
  var boardOrder = null;     // shop default, set by a manager
  var myOrder = null;        // this person's override, if any

  function applyOrder(list, order) {
    if (!order || !order.length) return list;
    var pos = {};
    order.forEach(function (id, i) { pos[id] = i; });
    // Array.prototype.sort is stable, so unknown ids keep their relative
    // registration order among themselves.
    return list.slice().sort(function (a, b) {
      var ai = pos[a.id], bi = pos[b.id];
      if (ai === undefined && bi === undefined) return 0;
      if (ai === undefined) return 1;
      if (bi === undefined) return -1;
      return ai - bi;
    });
  }

  /** Every registered tab id, in the order currently in force. */
  function fullOrder() {
    return applyOrder(tabs, myOrder || boardOrder).map(function (d) { return d.id; });
  }

  /**
   * Rebuild a full order after the VISIBLE tabs were rearranged.
   *
   * Someone reordering only sees the tabs their role gets, so a naive save would
   * drop every hidden one. Walking the full list and refilling only the visible
   * slots keeps the hidden tabs exactly where they were.
   */
  function weaveOrder(fullIds, visibleIds, newVisibleIds) {
    var queue = newVisibleIds.slice();
    return fullIds.map(function (id) {
      return visibleIds.indexOf(id) !== -1 ? queue.shift() : id;
    });
  }

  function saveMyOrder(ids) {
    myOrder = ids;
    return Promise.resolve(t.set("member", "private", MY_ORDER_KEY, ids))
      .catch(function () { /* order is a convenience; never block the UI */ });
  }

  function saveBoardOrder(ids) {
    boardOrder = ids;
    return Promise.resolve(t.set("board", "shared", BOARD_ORDER_KEY, ids));
  }

  function clearMyOrder() {
    myOrder = null;
    return Promise.resolve(t.set("member", "private", MY_ORDER_KEY, null))
      .catch(function () {});
  }

  /** Move one visible tab to sit immediately before another, and save it. */
  function moveTabBefore(draggedId, targetId) {
    var vis = visibleTabs().map(function (d) { return d.id; });
    var from = vis.indexOf(draggedId), to = vis.indexOf(targetId);
    if (from === -1 || to === -1 || from === to) return Promise.resolve();
    var next = vis.slice();
    next.splice(from, 1);
    next.splice(next.indexOf(targetId) + (from < to ? 1 : 0), 0, draggedId);
    return saveMyOrder(weaveOrder(fullOrder(), vis, next)).then(paintTabs);
  }

  /**
   * The gear. Up/down rather than drag, because the shop may be on a tablet and
   * HTML5 drag does nothing on touch.
   */
  function openTabOrder() {
    var vis = visibleTabs();
    var ids = vis.map(function (d) { return d.id; });
    var labelOf = {};
    vis.forEach(function (d) { labelOf[d.id] = d.label; });
    var listWrap = el("div");

    function paintList() {
      listWrap.innerHTML = "";
      ids.forEach(function (id, i) {
        listWrap.appendChild(el("div", {
          style: "display:flex;align-items:center;gap:8px;padding:7px 0;" +
                 "border-bottom:1px solid var(--wf-band)"
        },
          el("span.wf-card-s", { style: "width:20px;text-align:right", text: (i + 1) + "." }),
          el("div", { style: "flex:1;font-size:14.5px;font-weight:600;color:var(--wf-navy)",
                      text: labelOf[id] }),
          btn("↑", { small: true, quiet: true, onClick: function () {
            if (i === 0) return;
            var tmp = ids[i - 1]; ids[i - 1] = ids[i]; ids[i] = tmp; paintList();
          } }),
          btn("↓", { small: true, quiet: true, onClick: function () {
            if (i === ids.length - 1) return;
            var tmp = ids[i + 1]; ids[i + 1] = ids[i]; ids[i] = tmp; paintList();
          } })));
      });
    }
    paintList();

    var buttons = [{
      label: "Save for me", primary: true, busyText: "Saving…",
      onClick: function () {
        return saveMyOrder(weaveOrder(fullOrder(), visibleTabs().map(function (d) { return d.id; }), ids))
          .then(paintTabs);
      }
    }];
    if (ctx.isManager) {
      buttons.push({
        label: "Set as the board default", busyText: "Saving…",
        onClick: function () {
          var woven = weaveOrder(fullOrder(), visibleTabs().map(function (d) { return d.id; }), ids);
          // Setting the shop default while holding a personal override would
          // look like nothing happened, so drop the override at the same time.
          return saveBoardOrder(woven).then(clearMyOrder).then(paintTabs);
        }
      });
    }
    if (myOrder) {
      buttons.push({
        label: "Reset to the board default", quiet: true, busyText: "Resetting…",
        onClick: function () { return clearMyOrder().then(paintTabs); }
      });
    }

    dialog({
      title: "Arrange the tabs",
      note: myOrder ? "You're using your own arrangement" : "You're using the board default",
      content: el("div", null, listWrap,
        el("div.hint", { style: "margin-top:12px",
          text: ctx.isManager
            ? "Save for me changes only your bar. Set as the board default changes it for everyone who hasn't arranged their own."
            : "This changes only your own bar. Nobody else is affected." })),
      buttons: buttons
    });
  }

  /**
   * Which tabs this person gets.
   *
   * Three ways to declare it, in order of precedence:
   *
   *   caps: ["see.costing"]   the board's own permission settings decide. This
   *                           is the one to use -- it can be changed on a
   *                           Tuesday without a release.
   *   roles: ["manager"]      the old fixed answer, kept so nothing breaks
   *                           mid-migration.
   *   managerOnly: true       older still.
   *
   * Undeclared means everyone, so a worker's default view is their own queue
   * and nothing financial.
   *
   * This is relevance, not security -- it decides what the window shows, and a
   * determined person can still read the underlying card through Trello itself.
   */
  function visibleTabs() {
    var mine = tabs.filter(function (d) {
      // Nested tabs belong to their parent's ribbon, not the top bar.
      if (d.parent) return false;
      // Any one of the listed capabilities is enough. A tab that needs two
      // unrelated grants is a tab that should have been two tabs.
      if (d.caps && d.caps.length) {
        return d.caps.some(function (c) { return can(c); });
      }
      if (d.roles) return d.roles.indexOf(ctx.role) !== -1;
      if (d.managerOnly) return ctx.isManager;
      return true;
    });
    return applyOrder(mine, myOrder || boardOrder);
  }

  function paintTabs() {
    var bar = document.getElementById("tabbar");
    bar.innerHTML = "";
    // A drag ends in a click on the tab you dropped, which would switch tabs
    // as a side effect of rearranging. This swallows exactly that one click.
    var justDragged = false;

    visibleTabs().forEach(function (d) {
      var b = el("button.wf-tab" + (d.id === active ? ".is-active" : ""), {
        type: "button",
        draggable: "true",
        onClick: function () { if (!justDragged) goTo(d.id); }
      }, document.createTextNode(d.label));
      if (d.badgeCount) {
        var n = d.badgeCount(ctx);
        if (n) b.appendChild(el("span.wf-badge", { text: String(n) }));
      }

      b.addEventListener("dragstart", function (e) {
        justDragged = false;
        b.style.opacity = "0.4";
        try { e.dataTransfer.setData("text/plain", d.id); } catch (err) {}
        try { e.dataTransfer.effectAllowed = "move"; } catch (err) {}
      });
      b.addEventListener("dragend", function () {
        b.style.opacity = "";
        bar.querySelectorAll(".wf-tab").forEach(function (x) { x.style.borderLeft = ""; });
      });
      b.addEventListener("dragover", function (e) {
        e.preventDefault();
        b.style.borderLeft = "3px solid var(--wf-steel)";
      });
      b.addEventListener("dragleave", function () { b.style.borderLeft = ""; });
      b.addEventListener("drop", function (e) {
        e.preventDefault();
        b.style.borderLeft = "";
        var dragged = "";
        try { dragged = e.dataTransfer.getData("text/plain"); } catch (err) {}
        if (!dragged || dragged === d.id) return;
        justDragged = true;
        moveTabBefore(dragged, d.id);
      });

      bar.appendChild(b);
    });

    bar.appendChild(el("button.wf-tab", {
      type: "button",
      title: "Arrange the tabs",
      style: "margin-left:auto;font-size:15px",
      onClick: openTabOrder
    }, document.createTextNode("⚙")));
  }

  function goTo(id) {
    active = id;
    try { global.location.hash = id; } catch (e) {}
    // Remember it against the member, not the URL: a reopened modal loads a
    // fresh iframe at ./popups/ops.html with no hash, so the hash alone would
    // drop you on the default tab every time the window is closed.
    try { t.set("member", "private", "lastOpsTab", id); } catch (e) {}
    paintTabs();
    return renderActive();
  }

  /** Manager-only controls: step into someone's shoes, and cut the wire. */
  function paintSandbox() {
    var slot = document.getElementById("syncNote");
    if (!slot) return;
    slot.innerHTML = "";
    // Gate on the REAL person, so you can't act as a worker and get stuck there.
    if (!realMember || resolveRole(ctx.roster, realMember.username) !== "manager") return;

    var sel = el("select", {
      style: "width:auto;padding:4px 8px;font-size:12.5px;border-radius:8px"
    }, el("option", { value: "", text: "Acting as myself" }));
    (ctx.board.members || []).forEach(function (m) {
      if (m.username === realMember.username) return;
      var o = el("option", { value: m.username, text: "Act as " + displayName(m) });
      if (actingAs && actingAs.username === m.username) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { setActingAs(sel.value); });
    slot.appendChild(sel);

    slot.appendChild(btn(WFSandbox.active() ? "Leave test mode" : "Test mode", {
      small: true,
      onClick: function () {
        if (WFSandbox.active()) return leaveSandbox();
        return enterSandbox();
      }
    }));
  }

  /* -------------------------------------------------------- write-free mode */

  /**
   * Test mode: the real code path, with the last inch to Trello cut.
   *
   * Swapping ctx.t for the wrapper is the whole mechanism on this side -- every
   * tab already reads and writes through ctx.t, so none of them needs to know.
   * The re-render is what makes it take effect everywhere at once rather than
   * on whichever tab you happen to open next.
   */
  function enterSandbox() {
    WFSandbox.enable();
    ctx.t = WFSandbox.wrap(realT());
    cardCache = {};
    paintSandbox();
    paintSandboxBanner();
    return reload();
  }

  /**
   * Leave, and throw the session away.
   *
   * The card cache has to go with it. It is full of a session that never
   * happened, and serving one card of it after the banner came down would be
   * the worst possible outcome of a feature whose entire promise is that you
   * can tell the difference.
   */
  function leaveSandbox() {
    WFSandbox.disable();
    ctx.t = realT();
    cardCache = {};
    paintSandbox();
    paintSandboxBanner();
    return reload();
  }

  /** The unwrapped `t`, whether or not we are currently wrapped. */
  function realT() { return (ctx.t && ctx.t.__real) || t; }

  /** Everything this session would have sent to Trello, in plain words. */
  function openSandboxLog() {
    var items = WFSandbox.entries().filter(function (e) { return e.kind !== "session"; });
    var body = el("div");

    if (!items.length) {
      body.appendChild(el("div.muted", {
        text: "Nothing yet. Start a job, move a slider, sign off a check — " +
              "everything you do lands here instead of on the board."
      }));
    }

    items.slice().reverse().forEach(function (e) {
      body.appendChild(el("div", {
        style: "display:flex;gap:10px;align-items:baseline;padding:7px 0;" +
               "border-bottom:1px solid var(--wf-line)"
      },
        el("span", {
          text: e.kind === "trello" ? "Trello" : "Data",
          style: "flex:0 0 52px;font-size:10px;letter-spacing:.07em;text-transform:uppercase;" +
                 "font-weight:800;color:" + (e.kind === "trello" ? "var(--wf-ember)" : "var(--wf-muted)")
        }),
        el("span", { text: e.summary, style: "font-size:13.5px" }),
        el("span", {
          text: new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }),
          style: "margin-left:auto;font-size:11.5px;color:var(--wf-muted);white-space:nowrap"
        })));
    });

    dialog({
      title: "What this session would have changed",
      note: items.length
        ? items.length + (items.length === 1 ? " change" : " changes") +
          ", newest first. None of it reached the board."
        : "",
      content: body,
      buttons: [{
        label: "Start the run again", quiet: true,
        onClick: function () { WFSandbox.reset(); cardCache = {}; paintSandboxBanner(); return reload(); }
      }]
    });
  }

  /**
   * The banner, covering both kinds of pretending.
   *
   * They are genuinely different and must not read as one thing: acting as
   * someone else writes for real against their name, while test mode writes
   * nowhere at all. Somebody who mixes those two up either thinks a rehearsal
   * was real or thinks a real change was a rehearsal. So test mode gets the
   * louder colour and the blunter sentence, and when both are on the banner
   * says both.
   */
  function paintSandboxBanner() {
    var existing = document.getElementById("wfSandboxBanner");
    if (existing) existing.parentNode.removeChild(existing);
    var testing = WFSandbox.active();
    if (!actingAs && !testing) return;
    var shell = document.querySelector(".wf-shell");
    if (!shell) return;

    var words = testing
      ? "Test mode — nothing you do here reaches the Trello board."
      : "Sandbox — you are acting as " + displayName(actingAs) +
        ". Anything you do is recorded against them.";
    if (testing && actingAs) {
      words = "Test mode, acting as " + displayName(actingAs) +
              " — nothing you do here reaches the Trello board.";
    }

    var bar = el("div#wfSandboxBanner", {
      style: "background:" + (testing ? "#6b21a8" : "var(--wf-ember)") + ";color:#fff;" +
             "padding:9px 24px;font-size:13.5px;font-weight:600;display:flex;" +
             "align-items:center;gap:12px;flex-wrap:wrap"
    }, el("span", { text: words }));

    if (testing) {
      var n = WFSandbox.entries().filter(function (e) { return e.kind !== "session"; }).length;
      bar.appendChild(btn(n ? "Show the " + n + " change" + (n === 1 ? "" : "s") : "Nothing changed yet", {
        small: true, quiet: true, onClick: openSandboxLog
      }));
      bar.appendChild(btn("Leave test mode", { small: true, quiet: true, onClick: leaveSandbox }));
    }
    if (actingAs) {
      bar.appendChild(btn("Stop acting as " + firstName(actingAs), {
        small: true, quiet: true, onClick: function () { setActingAs(""); }
      }));
    }

    Array.prototype.forEach.call(bar.querySelectorAll("button"), function (b) {
      b.style.color = "#fff";
      b.style.borderColor = "rgba(255,255,255,.5)";
    });
    shell.insertBefore(bar, shell.firstChild.nextSibling);
  }

  function setActingAs(username) {
    var m = (ctx.board.members || []).filter(function (x) { return x.username === username; })[0];
    actingAs = m || null;
    ctx.member = actingAs || realMember;
    ctx.role = resolveRole(ctx.roster, ctx.member.username);
    ctx.isManager = ctx.role === "manager";
    ctx.actingAs = actingAs;
    ctx.realMember = realMember;
    document.getElementById("meName").textContent = firstName(ctx.member);
    document.getElementById("meInitials").textContent = initials(displayName(ctx.member));
    paintSandbox();
    paintSandboxBanner();
    // Role may have changed which tabs exist, so fall back to a visible one.
    var still = visibleTabs().filter(function (d) { return d.id === active; })[0];
    if (!still) active = (visibleTabs()[0] || {}).id;
    paintTabs();
    return renderActive();
  }

  /**
   * Tabs that live INSIDE another tab.
   *
   * A tab declares `parent: "performance"` and disappears from the top bar,
   * reappearing as an entry in that parent's ribbon. The tab bar was growing
   * past the point where anybody could find anything, and several of the
   * entries were plainly facets of one subject rather than separate places --
   * Job costing and Records are both "how did we do", not two destinations.
   *
   * Generic rather than a Performance special case, so grouping the next pair
   * costs one line instead of another bespoke shell.
   */
  function childrenOf(id) {
    return tabs.filter(function (d) {
      if (d.parent !== id) return false;
      if (d.caps && d.caps.length) return d.caps.some(function (c) { return can(c); });
      if (d.roles) return d.roles.indexOf(ctx.role) !== -1;
      if (d.managerOnly) return ctx.isManager;
      return true;
    });
  }

  /** Which entry of a parent's ribbon is open, remembered per parent. */
  var subTab = {};

  /**
   * The ribbon. Same pills as the main bar on purpose -- one visual grammar for
   * "these are the places you can be", whatever level you are at.
   */
  function ribbon(def, entries) {
    var bar = el("div.wf-tabbar", {
      style: "background:transparent;padding:0 0 18px;gap:8px;flex-wrap:wrap"
    });
    entries.forEach(function (e) {
      var b = el("button.wf-tab" + (e.id === subTab[def.id] ? ".is-active" : ""), {
        type: "button", text: e.label
      });
      b.addEventListener("click", function () {
        if (subTab[def.id] === e.id) return;
        subTab[def.id] = e.id;
        renderActive();
      });
      bar.appendChild(b);
    });
    return bar;
  }

  /**
   * Kiosk mode: a tab declares `kiosk: true` and the window chrome gets out of
   * its way.
   *
   * Pointer-driven rather than a shortcut, because the people this is for are
   * standing at a bench and will never learn a key combination -- moving
   * towards the top of the screen is what somebody already does when they want
   * to leave. 70px of reach, and it stays down for a beat after you drop below
   * so the bar does not snap away mid-click.
   *
   * Touch gets the same behaviour from a tap near the top, since an iPad has no
   * hover at all and would otherwise have no way back.
   */
  /* How far down the pointer has to be before the bar comes back.
   *
   * Deliberately small. At 70px it caught people reaching for the Floor's own
   * area tabs, which sit near the top of the iframe just under Trello's modal
   * header -- the bar kept dropping when nobody asked for it. A narrow strip at
   * the very edge is still easy to hit on purpose and almost impossible to hit
   * by accident. The Floor also holds its content further down in kiosk, so
   * there is clear air between its tabs and this strip. */
  var PEEK_EDGE = 22;

  var peekTimer = null;
  function setPeek(on) {
    var shell = document.querySelector(".wf-shell");
    if (!shell) return;
    if (peekTimer) { clearTimeout(peekTimer); peekTimer = null; }
    shell.classList.toggle("is-peek", !!on);
  }

  /**
   * The bar comes down when the pointer reaches the top edge, and goes away the
   * moment it leaves the bar itself.
   *
   * No hide-delay: a timer means the bar hangs around after you have visibly
   * moved off it, which reads as lag rather than patience. Leaving the chrome
   * is an unambiguous "done with it", so it is the only signal needed.
   */
  function watchForPeek() {
    if (watchForPeek.done) return;
    watchForPeek.done = true;

    var inKiosk = function () {
      var shell = document.querySelector(".wf-shell");
      return shell && shell.classList.contains("is-kiosk") ? shell : null;
    };

    document.addEventListener("mousemove", function (e) {
      if (!inKiosk()) return;
      if (e.clientY <= PEEK_EDGE) setPeek(true);
    });

    var chrome = document.querySelector(".wf-chrome");
    if (chrome) {
      chrome.addEventListener("mouseleave", function () {
        if (inKiosk()) setPeek(false);
      });
    }

    // An iPad has no hover, so a tap at the top opens it and a tap anywhere
    // else closes it again.
    document.addEventListener("touchstart", function (e) {
      if (!inKiosk()) return;
      var y = e.touches && e.touches[0] ? e.touches[0].clientY : 999;
      setPeek(y <= PEEK_EDGE * 3);
    }, { passive: true });
  }

  function setKiosk(on) {
    var shell = document.querySelector(".wf-shell");
    if (!shell) return;
    var was = shell.classList.contains("is-kiosk");
    shell.classList.toggle("is-kiosk", !!on);
    watchForPeek();

    if (!on) {
      // Leaving kiosk: the chrome is back in the flow, so nothing to peek at.
      if (peekTimer) { clearTimeout(peekTimer); peekTimer = null; }
      shell.classList.remove("is-peek");
      return;
    }
    if (was) return;

    // Arriving: show the bar just long enough to register where it went, then
    // get out of the way. 1.6s was long enough to feel like something was
    // stuck; this is a glance, not a notification.
    shell.classList.add("is-peek");
    if (peekTimer) clearTimeout(peekTimer);
    peekTimer = setTimeout(function () {
      shell.classList.remove("is-peek");
    }, 800);
  }

  function renderActive() {
    var view = document.getElementById("view");
    var def = visibleTabs().filter(function (d) { return d.id === active; })[0] || visibleTabs()[0];
    if (!def) { view.innerHTML = '<div class="wf-empty">No tabs available for your account.</div>'; return; }
    active = def.id;

    // The parent's own content is the first entry, so Performance still opens
    // on Performance and the ribbon is an addition rather than a detour.
    var kids = childrenOf(def.id);
    var entries = kids.length ? [{ id: def.id, label: def.label, def: def }].concat(
      kids.map(function (k) { return { id: k.id, label: k.label, def: k }; })) : [];
    if (entries.length && !entries.some(function (e) { return e.id === subTab[def.id]; })) {
      subTab[def.id] = def.id;
    }
    var showing = entries.length
      ? entries.filter(function (e) { return e.id === subTab[def.id]; })[0].def
      : def;

    // A tab can ask for the whole screen. Decided here rather than by the tab
    // itself so leaving it always puts the chrome back, whatever went wrong
    // inside it.
    setKiosk(!!showing.kiosk);

    view.innerHTML = '<div class="loading">Loading ' + esc(showing.label.toLowerCase()) + "…</div>";
    return Promise.resolve()
      .then(function () { return showing.render(ctx); })
      .then(function (node) {
        view.innerHTML = "";
        if (entries.length) view.appendChild(ribbon(def, entries));
        view.appendChild(node || empty("Nothing to show here yet."));
        paintTabs();
      })
      .catch(function (e) {
        view.innerHTML = "";
        view.appendChild(el("div.wf-empty", null,
          el("div", { text: "Couldn't load " + def.label + "." }),
          el("div.muted", { text: (e && e.message) || String(e) }),
          btn("Try again", { onClick: function () { renderActive(); } })));
      });
  }

  /* ------------------------------------------------------------------ start */

  function authGate() {
    var view = document.getElementById("view");
    view.innerHTML = "";
    view.appendChild(el("div.wf-empty", null,
      el("div", { text: "The ops window needs one-time access to this board's cards and activity." }),
      el("div", { style: "margin-top:14px" },
        btn("Turn it on", {
          primary: true, busyText: "Working…",
          onClick: function () { return WFRest.authorize(t).then(start); }
        }))));
  }

  function start() {
    if (!t) {
      t = TrelloPowerUp.iframe({
        appKey: global.WF_CONFIG.appKey,
        appName: "Western Fabrication Ops"
      });
    }

    return WFRest.isAuthorized(t).catch(function () { return false; }).then(function (ok) {
      if (!ok) return authGate();

      return Promise.all([
        t.board("id", "name", "members"),
        t.member("username", "fullName"),
        WFRoster.getRoster(t).catch(function () { return { managers: [], phaseSpecialists: {} }; }),
        t.get("board", "shared", BOARD_ORDER_KEY, null).catch(function () { return null; }),
        t.get("member", "private", MY_ORDER_KEY, null).catch(function () { return null; }),
        WFPerms.load(t).catch(function () { return WFPerms.defaults(); })
      ]).then(function (r) {
        var board = r[0], member = r[1], roster = r[2];
        boardOrder = Array.isArray(r[3]) && r[3].length ? r[3] : null;
        myOrder = Array.isArray(r[4]) && r[4].length ? r[4] : null;
        perms = r[5];

        document.getElementById("boardName").textContent = board.name;
        document.getElementById("meName").textContent = (member.fullName || member.username).split(" ")[0];
        document.getElementById("meInitials").textContent = initials(member.fullName || member.username);

        var boardCfg = WFStage.getBoardConfig(board.id);
        // Must happen before any tab renders -- phaseKey is useless until it
        // knows how this board groups its lists.
        buildPhaseAliases(boardCfg);

        ctx = {
          t: t,
          board: board,
          member: member,
          boardCfg: boardCfg,
          roster: roster,
          role: resolveRole(roster, member.username),
          isManager: resolveRole(roster, member.username) === "manager",
          perms: perms,
          can: can,
          scopeFor: scopeFor,
          cards: cards,
          reload: reload,
          syncCard: syncCard,
          goTo: goTo
        };

        realMember = member;
        ctx.realMember = member;
        ctx.actingAs = null;

        paintSandbox();

        // Come back where you left off. Precedence: an explicit deep link
        // (#records) beats the remembered tab, which beats the role default.
        // The remembered tab is what makes closing the window and returning
        // from a card feel like resuming rather than starting over.
        //
        // A link or a remembered id naming a retired tab is harmless --
        // renderActive falls back to the first tab this person can see.
        var linked = (global.location.hash || "").replace("#", "");
        return (linked
          ? Promise.resolve(linked)
          : t.get("member", "private", "lastOpsTab", null).catch(function () { return null; })
        ).then(function (remembered) {
          var fallback = ctx.isManager ? "dashboard" : "myjobs";
          var pick = remembered || fallback;
          // A remembered tab may no longer be visible to this role.
          if (!visibleTabs().filter(function (d) { return d.id === pick; })[0]) {
            pick = (visibleTabs()[0] || {}).id || fallback;
          }
          active = pick;
          paintTabs();
          return renderActive();
        });
      });
    }).catch(function (e) {
      document.getElementById("view").innerHTML =
        '<div class="wf-empty">Couldn\'t start the ops window.<div class="muted">' +
        esc((e && e.message) || e) + "</div></div>";
    });
  }

  global.WFOps = {
    start: start, tab: tab, goTo: goTo, reload: reload,
    el: el, frag: frag, esc: esc,
    panel: panel, stat: stat, tag: tag, btn: btn, empty: empty, dialog: dialog,
    money: money, moneyShort: moneyShort, hours: hours, clock: clock,
    initials: initials, timeOfDay: timeOfDay, elapsedPhrase: elapsedPhrase,
    runningSince: runningSince, isAwaitingStart: isAwaitingStart,
    displayName: displayName, firstName: firstName,
    activeWork: activeWork, hasOrphanedWork: hasOrphanedWork,
    phaseKey: phaseKey, buildPhaseAliases: buildPhaseAliases,
    applyOrder: applyOrder, weaveOrder: weaveOrder,
    workPhases: workPhases, phaseForCard: phaseForCard,
    phaseColor: phaseColor, tint: tint, phaseColumns: phaseColumns,
    openCard: openCard,
    get t() { return t; }
  };
})(window);
