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
 * WHERE "WHAT IS THIS STATION BUILDING" COMES FROM, TODAY
 *
 * The station monitor is deliberately read-only in this first pass, which
 * rules out a `tableId` on the phase work saying "job #2412 is at booth 2" --
 * nothing writes that yet. Rather than invent it, the current job is derived
 * from what the shop already does honestly:
 *
 *   active job  the card in this station's phase whose phase work is claimed
 *               by the person assigned to this station
 *   queue       every other card in that phase nobody has claimed, in the
 *               board's own manual order
 *
 * That is true the moment somebody taps Start, it needs no new data, and it
 * degrades honestly: a station with nobody assigned shows Open with the phase
 * queue behind it, which is exactly what it is.
 *
 * Once Start/Complete are wired up, a `tableId` on the phase work becomes the
 * authority and this falls back to being the seed. The shape of what comes out
 * of stationState() will not change when that happens.
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

    // The job this station is on: claimed by the person standing at it.
    if (station.welder) {
      inPhase.some(function (c) {
        var w = activeWork(c);
        if (!w || w.pendingApproval) return false;
        if (usernameOf(claimant(w)) !== station.welder) return false;
        out.job = c;
        out.work = w;
        return true;
      });
    }

    // Everything else in the phase that nobody has picked up yet, in the
    // board's own manual order -- so dragging a card up in Trello reorders the
    // queue on the TV, with no second place to maintain the priority.
    out.queue = inPhase.filter(function (c) {
      if (out.job && c.id === out.job.id) return false;
      var w = activeWork(c);
      return !(w && claimant(w));
    }).sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); });

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
