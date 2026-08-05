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

  function openCard(card) {
    try {
      var p = t.showCard(card.id);
      if (p && p.catch) p.catch(function () { global.open(card.shortUrl, "_blank"); });
    } catch (e) { global.open(card.shortUrl, "_blank"); }
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
          t.get(c.id, "shared", "phaseLog", []).catch(function () { return undefined; })
        ]).then(function (r) {
          if (r[0] !== undefined) c.phaseWork = r[0];
          if (r[1] !== undefined) c.phaseLog = r[1];
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
        return key === "open" ? overlayPhaseState(list) : list;
      });
    }
    return cardCache[key];
  }

  function reload() {
    cardCache = {};
    WFRest.invalidateBoardCards(ctx.board.id);
    WFPricing.invalidate(ctx.board.id);
    // ctx.roster was previously read once at startup, so saving a roster change
    // had no visible effect (and isManager stayed stale) until a full reopen.
    return WFRoster.getRoster(t).then(function (r) {
      if (r) {
        ctx.roster = r;
        ctx.isManager = (r.managers || []).indexOf(ctx.member.username) !== -1 ||
                        WFStage.isManager(ctx.member.username);
      }
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
      t.get(cardId, "shared", "phaseLog", []).catch(function () { return undefined; })
    ]).then(function (r) {
      var patch = {};
      if (r[0] !== undefined) patch.phaseWork = r[0];
      if (r[1] !== undefined) patch.phaseLog = r[1];
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

  function visibleTabs() {
    return tabs.filter(function (d) { return !d.managerOnly || ctx.isManager; });
  }

  function paintTabs() {
    var bar = document.getElementById("tabbar");
    bar.innerHTML = "";
    visibleTabs().forEach(function (d) {
      var b = el("button.wf-tab" + (d.id === active ? ".is-active" : ""), {
        type: "button",
        onClick: function () { goTo(d.id); }
      }, document.createTextNode(d.label));
      if (d.badgeCount) {
        var n = d.badgeCount(ctx);
        if (n) b.appendChild(el("span.wf-badge", { text: String(n) }));
      }
      bar.appendChild(b);
    });
  }

  function goTo(id) {
    active = id;
    try { global.location.hash = id; } catch (e) {}
    paintTabs();
    return renderActive();
  }

  function renderActive() {
    var view = document.getElementById("view");
    var def = visibleTabs().filter(function (d) { return d.id === active; })[0] || visibleTabs()[0];
    if (!def) { view.innerHTML = '<div class="wf-empty">No tabs available for your account.</div>'; return; }
    active = def.id;
    view.innerHTML = '<div class="loading">Loading ' + esc(def.label.toLowerCase()) + "…</div>";
    return Promise.resolve()
      .then(function () { return def.render(ctx); })
      .then(function (node) {
        view.innerHTML = "";
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
        WFRoster.getRoster(t).catch(function () { return { managers: [], phaseSpecialists: {} }; })
      ]).then(function (r) {
        var board = r[0], member = r[1], roster = r[2];

        document.getElementById("boardName").textContent = board.name;
        document.getElementById("meName").textContent = (member.fullName || member.username).split(" ")[0];
        document.getElementById("meInitials").textContent = initials(member.fullName || member.username);

        ctx = {
          t: t,
          board: board,
          member: member,
          boardCfg: WFStage.getBoardConfig(board.id),
          roster: roster,
          isManager: roster.managers.indexOf(member.username) !== -1 ||
                     WFStage.isManager(member.username),
          cards: cards,
          reload: reload,
          syncCard: syncCard,
          goTo: goTo
        };

        var wanted = (global.location.hash || "").replace("#", "");
        active = wanted || (ctx.isManager ? "dashboard" : "myjobs");
        paintTabs();
        return renderActive();
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
    panel: panel, stat: stat, tag: tag, btn: btn, empty: empty,
    money: money, moneyShort: moneyShort, hours: hours, clock: clock,
    initials: initials, timeOfDay: timeOfDay, elapsedPhrase: elapsedPhrase,
    runningSince: runningSince, isAwaitingStart: isAwaitingStart,
    displayName: displayName, firstName: firstName,
    openCard: openCard,
    get t() { return t; }
  };
})(window);
