/**
 * WFTables -- the physical shop: which stations exist, what each one is
 * working on, and what is queued behind it.
 *
 * WHY A STATION IS NOT A PHASE
 *
 * A phase is a Trello list -- Assemble CNC, Sandblast / Powder Coat. A station
 * is a place with a person standing at it. Four finishing stations all draw
 * from the one "Sandblast / Powder Coat" list, and any welding table can take
 * any Assemble job. So a station is configuration, not board structure: a name,
 * a type, the person on it, and the phase it pulls from. Managers edit that;
 * nothing about it is inferred from the board, because the board has no idea
 * how many booths you own.
 *
 * WHERE "WHAT IS THIS STATION BUILDING" COMES FROM
 *
 * `phaseWork.tableId` -- an explicit "job #2412 is at booth 2", written when
 * somebody starts or assigns a job. It is the authority because it is the only
 * answer that survives two welders swapping benches, one person covering two
 * stations, or a job left paused overnight.
 *
 * Underneath it, as a fallback only, the original derived rule: the card in
 * this phase claimed by whoever is rostered at this station. That stays because
 * the board is full of jobs started before tableId existed, and a station that
 * went blank during the changeover would look broken rather than migrated. It
 * costs four lines and can be deleted once nothing on the board predates the
 * change.
 *
 * QUEUE ORDER, AND WHY TWO ORDERINGS DON'T FIGHT
 *
 * A queue is ordered by `queuePos` where somebody has set one and by Trello's
 * own `pos` where nobody has. So dragging a card up in Trello still reorders
 * the TV, and the arrows on the Full queue view still win over it -- whichever
 * was touched last is the one in force, rather than one silently overriding
 * the other forever.
 */
(function (global) {
  "use strict";

  var KEY = "wfStations";

  /**
   * The two screens the shop has. An area is just a grouping of stations --
   * one TV in the main shop, one in the finishing bay -- so it carries no
   * behaviour beyond deciding what shows on which screen.
   */
  var AREAS = [
    { id: "shop", label: "Main shop" },
    { id: "finishing", label: "Finishing bay" }
  ];

  /**
   * The stations as the approved mock named them, mapped to the phases this
   * board actually has. Two deliberate choices:
   *
   *   - the laser bay has no phase, because no list on the board corresponds
   *     to it. It renders as "no phase set" rather than being quietly pointed
   *     at Print CAD, which would be a guess dressed as a fact.
   *   - nobody is assigned to anything. Station staffing changes weekly and is
   *     a manager's call; seeding it with names from the mock's sample data
   *     would put the wrong people on the wrong booths on day one.
   */
  var DEFAULTS = [
    { id: "s1", area: "shop", table: "Station #1", station: "Welding", welder: "", phase: "Assemble Legacy" },
    { id: "s2", area: "shop", table: "Station #2", station: "Welding", welder: "", phase: "Assemble CAP" },
    { id: "s3", area: "shop", table: "Station #3", station: "Welding", welder: "", phase: "Assemble CNC" },
    { id: "s4", area: "shop", table: "Station #4", station: "Laser bay", welder: "", phase: "" },
    { id: "f1", area: "finishing", table: "Blast booth", station: "Sandblast · prep", welder: "", phase: "Sandblast / Powder Coat" },
    { id: "f2", area: "finishing", table: "Powder booth", station: "Spray · powder coat", welder: "", phase: "Sandblast / Powder Coat" },
    { id: "f3", area: "finishing", table: "Cure oven", station: "Bake · cool-down", welder: "", phase: "Sandblast / Powder Coat" },
    { id: "f4", area: "finishing", table: "Wet paint", station: "Liquid finish — ventilated", welder: "", phase: "" }
  ];

  function areas() { return AREAS.slice(); }

  function areaLabel(id) {
    var a = AREAS.filter(function (x) { return x.id === id; })[0];
    return a ? a.label : "Shop";
  }

  function defaults() { return JSON.parse(JSON.stringify(DEFAULTS)); }

  /* ------------------------------------------------------------------ config */

  /**
   * Read the station setup, falling back to the defaults above.
   *
   * A saved config is merged over the defaults by id rather than replacing
   * them, so adding a station in a later release appears for boards that saved
   * a config months ago instead of silently going missing.
   */
  function load(t) {
    return t.get("board", "shared", KEY, null).then(function (saved) {
      return merge(saved);
    }).catch(function () { return merge(null); });
  }

  function merge(saved) {
    var base = defaults();
    var out = { stations: base, visible: base.map(function (s) { return s.id; }) };
    if (!saved || typeof saved !== "object") return out;

    var byId = {};
    (saved.stations || []).forEach(function (s) { if (s && s.id) byId[s.id] = s; });

    out.stations = base.map(function (d) {
      var s = byId[d.id];
      if (!s) return d;
      return {
        id: d.id,
        area: s.area || d.area,
        table: s.table !== undefined ? s.table : d.table,
        station: s.station !== undefined ? s.station : d.station,
        welder: s.welder !== undefined ? s.welder : d.welder,
        phase: s.phase !== undefined ? s.phase : d.phase
      };
    });

    // Stations the board added that aren't in DEFAULTS are kept as they are.
    (saved.stations || []).forEach(function (s) {
      if (s && s.id && !base.some(function (d) { return d.id === s.id; })) out.stations.push(s);
    });

    if (Array.isArray(saved.visible) && saved.visible.length) {
      var known = {};
      out.stations.forEach(function (s) { known[s.id] = true; });
      var keep = saved.visible.filter(function (id) { return known[id]; });
      if (keep.length) out.visible = keep;
    }
    return out;
  }

  function save(t, cfg) {
    return t.set("board", "shared", KEY, {
      stations: cfg.stations || [],
      visible: cfg.visible || []
    });
  }

  /** The stations on one screen, in configured order, visible ones only. */
  function stationsFor(cfg, areaId) {
    var vis = {};
    (cfg.visible || []).forEach(function (id) { vis[id] = true; });
    return (cfg.stations || []).filter(function (s) {
      return s.area === areaId && vis[s.id];
    });
  }

  /** Every phase name a station could be pointed at, in board order. */
  function phaseOptions(boardCfg) {
    var seen = {}, out = [];
    ((boardCfg && boardCfg.stages) || []).forEach(function (s) {
      if (!s.isWorkPhase) return;
      var name = s.phase || s.name;
      if (seen[name]) return;
      seen[name] = true;
      out.push(name);
    });
    return out;
  }

  /* ------------------------------------------------------------------- cards */

  /** The phase a card is sitting in, or null if its list isn't a work phase. */
  function phaseOf(boardCfg, card) {
    var stage = ((boardCfg && boardCfg.stages) || []).filter(function (s) {
      return s.listId === card.idList;
    })[0];
    if (!stage) return null;
    return stage.phase || stage.name;
  }

  /**
   * The phase work belonging to the card's CURRENT list, or null.
   *
   * Deliberately duplicated from WFOps rather than imported: this file is a
   * lib and must not depend on the popup shell, and the rule is four lines.
   * Work whose listId doesn't match the card's list is left over from an
   * earlier phase and means nothing here.
   */
  function activeWork(card) {
    var w = card && card.phaseWork;
    if (!w) return null;
    return w.listId === card.idList ? w : null;
  }

  function isRunning(work) {
    if (!work || !work.segments || !work.segments.length) return false;
    return !work.segments[work.segments.length - 1].end;
  }

  function claimant(work) {
    return (work && work.claimedBy) || null;
  }

  function usernameOf(person) {
    return (person && person.username) || "";
  }

  function isLate(card) {
    if (!card || !card.due || card.dueComplete) return false;
    return new Date(card.due).getTime() < Date.now();
  }

  /* --------------------------------------------------------------- one station */

  /**
   * What a station is building and what is behind it.
   *
   * Returns the same shape whether or not the station has a phase, a person or
   * any work, so the view never has to special-case a half-configured shop.
   */
  /**
   * Cards in a phase that are on no station at all -- what the Assign view offers.
   *
   * A card already queued somewhere else is excluded: assigning it here would
   * silently take it off another bench, and the person standing at that bench
   * would find their next job gone with no explanation.
   */
  function unassignedInPhase(boardCfg, cards, phase) {
    return (cards || []).filter(function (c) {
      if (phaseOf(boardCfg, c) !== phase) return false;
      var w = activeWork(c);
      if (!w) return true;
      if (w.pendingApproval) return false;
      return !w.tableId;
    }).sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); });
  }

  /** Manual order first where somebody set it, Trello's own order otherwise. */
  function byQueuePos(a, b) {
    var wa = activeWork(a), wb = activeWork(b);
    var qa = wa && typeof wa.queuePos === "number" ? wa.queuePos : null;
    var qb = wb && typeof wb.queuePos === "number" ? wb.queuePos : null;
    if (qa !== null && qb !== null) return qa - qb;
    if (qa !== null) return -1;
    if (qb !== null) return 1;
    return (a.pos || 0) - (b.pos || 0);
  }

  /* ------------------------------------------------------------- the writes */

  /**
   * Put a card on a station, or take it off with stationId = null.
   *
   * Writes onto the existing phaseWork rather than a key of its own, so one
   * read of a card tells you everything about where its current phase stands.
   * A card with no phase work yet gets a stub -- assigning a job to a bench is
   * a real decision and has to survive even though nobody has started a timer.
   */
  function setStation(t, card, stationId, queuePos) {
    return t.get(card.id, "shared", "phaseWork", null).then(function (work) {
      var w = work || { listId: card.idList, claimedBy: null, segments: [] };
      w.tableId = stationId || null;
      if (typeof queuePos === "number") w.queuePos = queuePos;
      if (!stationId) w.queuePos = null;
      return t.set(card.id, "shared", "phaseWork", w).then(function () { return w; });
    });
  }

  /**
   * Write a whole station queue's order at once.
   *
   * Sequential integers rather than gaps, because the ▲▼ buttons swap
   * neighbours and a gapped scheme drifts until two cards collide. Rewriting
   * the run costs a handful of small writes and is always correct.
   */
  function reorder(t, cards, stationId, orderedIds) {
    var byId = {};
    (cards || []).forEach(function (c) { byId[c.id] = c; });
    return (orderedIds || []).reduce(function (chain, id, i) {
      return chain.then(function () {
        var card = byId[id];
        if (!card) return null;
        return setStation(t, card, stationId, i);
      });
    }, Promise.resolve());
  }

  function stationState(boardCfg, cards, station) {
    var out = {
      station: station,
      phase: station.phase || "",
      job: null,
      work: null,
      queue: [],
      status: "unset",
      note: ""
    };

    if (!station.phase) {
      out.note = "No phase set for this station — a manager picks one in the gear.";
      return out;
    }

    var inPhase = (cards || []).filter(function (c) {
      return phaseOf(boardCfg, c) === station.phase;
    });

    /* WHICH JOB IS AT THIS STATION
     *
     * Two answers, in order.
     *
     * First: the card whose phase work says `tableId === this station`. That is
     * an explicit fact somebody put there by starting or assigning the job, and
     * it is the only answer that can survive two welders swapping benches, one
     * person running two stations, or a job left paused on a station overnight.
     *
     * Second, only when no card claims the station: the old rule -- the card in
     * this phase claimed by whoever is rostered here. It stays because the board
     * is full of jobs started before tableId existed, and a station that went
     * blank during the changeover would look broken rather than migrated.
     */
    inPhase.some(function (c) {
      var w = activeWork(c);
      if (!w || w.pendingApproval) return false;
      if (w.tableId !== station.id) return false;
      out.job = c;
      out.work = w;
      out.owned = true;
      return true;
    });

    if (!out.job && station.welder) {
      inPhase.some(function (c) {
        var w = activeWork(c);
        if (!w || w.pendingApproval) return false;
        if (w.tableId && w.tableId !== station.id) return false;
        if (usernameOf(claimant(w)) !== station.welder) return false;
        out.job = c;
        out.work = w;
        return true;
      });
    }

    /* THE QUEUE
     *
     * Jobs put on this station and not currently running, plus -- for a station
     * nobody has queued anything on yet -- the unclaimed cards in its phase.
     *
     * Ordered by `queuePos` where it has been set and Trello's own `pos` where
     * it hasn't, so dragging a card up in Trello still reorders the TV and the
     * ▲▼ buttons on the Full queue view still win over it. Two orderings would
     * be one too many if either could silently override the other; this way the
     * explicit one is always the one that was touched most recently.
     */
    var mine = [], loose = [];
    inPhase.forEach(function (c) {
      if (out.job && c.id === out.job.id) return;
      var w = activeWork(c);
      if (w && w.pendingApproval) return;
      if (w && w.tableId === station.id) { mine.push(c); return; }
      if (w && w.tableId) return;        // queued on somebody else's station
      // Claimed by somebody and not put on this bench: it is their work in
      // progress, paused or not. Offering it here is how two people end up
      // starting the same job.
      if (w && claimant(w)) return;
      loose.push(c);
    });

    out.queue = mine.sort(byQueuePos).concat(loose.sort(byQueuePos));

    out.status = statusOf(out);
    if (out.status === "open") {
      out.note = station.welder
        ? "Nothing started yet."
        : "Nobody assigned to this station.";
    }
    return out;
  }

  /**
   * In progress / Paused / Behind / Open.
   *
   * Behind outranks the others on purpose: a job past its date is the one fact
   * on the screen somebody has to act on, and burying it under "In progress"
   * is how a late job stays late.
   */
  function statusOf(state) {
    if (!state.station.phase) return "unset";
    if (!state.job) return "open";
    if (isLate(state.job)) return "behind";
    return isRunning(state.work) ? "running" : "paused";
  }

  var STATUS_TEXT = {
    running: "In progress",
    paused: "Paused",
    behind: "Behind",
    open: "Open",
    unset: "Not set up"
  };

  var STATUS_COLOR = {
    running: "#1f9d63",
    paused: "#e8a317",
    behind: "#d9482e",
    open: "#8896a8",
    unset: "#8896a8"
  };

  function statusText(s) { return STATUS_TEXT[s] || s; }
  function statusColor(s) { return STATUS_COLOR[s] || "#8896a8"; }

  /** Every station on a screen, resolved. */
  function areaState(boardCfg, cards, cfg, areaId) {
    return stationsFor(cfg, areaId).map(function (s) {
      return stationState(boardCfg, cards, s);
    });
  }

  /* ------------------------------------------------------------------ layout */

  /**
   * How many station columns fit.
   *
   * A welder on his phone wants one station -- his -- not four squeezed to
   * nothing; the same page on the shop TV should fill all four. Width decides,
   * capped by how many stations are actually on that screen, so two stations
   * never render as four columns with two empty.
   */
  function columnsFor(width, stationCount) {
    var n = stationCount || 0;
    if (!n) return 0;
    var fit = width < 600 ? 1 : width < 1024 ? 2 : width < 1500 ? 3 : 4;
    return Math.min(fit, n);
  }

  /** Type scales down as columns multiply, per the approved mock. */
  function scaleFor(columns) {
    if (columns >= 4) return { job: 34, name: 15, compact: true };
    if (columns === 3) return { job: 40, name: 16, compact: true };
    if (columns === 2) return { job: 48, name: 17, compact: false };
    return { job: 56, name: 18, compact: false };
  }

  /* ------------------------------------------------------------------ elapsed */

  /**
   * Minutes on the clock, counting the open segment up to now.
   *
   * Whether this is ever SHOWN is the view's decision and a deliberate one:
   * the shop floor sees status and percent, never a running timer, because a
   * clock ticking at a welder turns an honest record of how long things take
   * into something he is being judged by -- and the moment that happens the
   * timings stop being honest and the whole dataset is worthless. Managers see
   * it, because capacity planning needs it.
   */
  function elapsedMinutes(work) {
    if (!work || !work.segments) return 0;
    var ms = 0;
    work.segments.forEach(function (seg) {
      var end = seg.end ? new Date(seg.end) : new Date();
      ms += end - new Date(seg.start);
    });
    return Math.round(ms / 60000);
  }

  function clockText(minutes) {
    var m = Math.max(0, Math.round(minutes || 0));
    var h = Math.floor(m / 60);
    var r = m % 60;
    return h + ":" + (r < 10 ? "0" : "") + r;
  }

  /* -------------------------------------------------------------- the numbers */

  /**
   * The line a manager reads at a glance: how much of the shop is actually
   * turning. Deliberately counts stations, not people -- a booth with nobody
   * on it is idle capacity whether or not anyone was rostered to it.
   */
  function summary(states) {
    var s = { total: 0, running: 0, paused: 0, behind: 0, open: 0, queued: 0 };
    (states || []).forEach(function (st) {
      if (st.status === "unset") return;
      s.total++;
      if (st.status === "running") s.running++;
      else if (st.status === "paused") s.paused++;
      else if (st.status === "behind") s.behind++;
      else s.open++;
      s.queued += st.queue.length;
    });
    s.utilisation = s.total ? Math.round(((s.running + s.behind) / s.total) * 100) : 0;
    return s;
  }

  global.WFTables = {
    KEY: KEY,
    AREAS: AREAS,
    areas: areas,
    areaLabel: areaLabel,
    defaults: defaults,
    merge: merge,
    load: load,
    save: save,
    stationsFor: stationsFor,
    phaseOptions: phaseOptions,

    phaseOf: phaseOf,
    activeWork: activeWork,
    isRunning: isRunning,
    isLate: isLate,

    stationState: stationState,
    setStation: setStation,
    reorder: reorder,
    byQueuePos: byQueuePos,
    unassignedInPhase: unassignedInPhase,
    areaState: areaState,
    statusOf: statusOf,
    statusText: statusText,
    statusColor: statusColor,

    columnsFor: columnsFor,
    scaleFor: scaleFor,
    elapsedMinutes: elapsedMinutes,
    clockText: clockText,
    summary: summary
  };
})(window);
