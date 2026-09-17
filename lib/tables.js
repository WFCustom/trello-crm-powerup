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
   * What KIND of station this is, and which list that kind pulls work from.
   *
   * THIS IS THE THING THAT WAS WRONG. The first version gave each welding
   * station a different phase -- bench 1 pulled Assemble Legacy, bench 2 pulled
   * Assemble CAP, bench 3 pulled Assemble CNC -- which quietly modelled the
   * Trello board instead of the shop. The shop has four welding benches that
   * all do the same work, so all four pull the same list, and only Station #1
   * ever had anything in its queue.
   *
   * A station's TYPE carries the phase. Add a fifth welding bench and it
   * inherits the right queue without anybody choosing a list; add a CNC bench
   * and it pulls Assemble CNC. The phase stays overridable per station, because
   * a board can grow a list this table has never heard of and guessing wrong
   * silently is worse than letting a manager say.
   */
  var TYPES = [
    { id: "weld",    label: "Welding",              phase: "Assemble Legacy" },
    { id: "cnc",     label: "CNC assembly",         phase: "Assemble CNC" },
    { id: "cap",     label: "CAP rail assembly",    phase: "Assemble CAP" },
    { id: "laser",   label: "Laser bay",            phase: "" },
    { id: "blast",   label: "Sandblast · prep",     phase: "Sandblast / Powder Coat" },
    { id: "powder",  label: "Spray · powder coat",  phase: "Sandblast / Powder Coat" },
    { id: "cure",    label: "Bake · cool-down",     phase: "Sandblast / Powder Coat" },
    { id: "wet",     label: "Liquid finish",        phase: "" },
    { id: "install", label: "Install crew",         phase: "Install" },
    { id: "other",   label: "Something else",       phase: "" }
  ];

  function types() { return TYPES.map(function (x) { return Object.assign({}, x); }); }

  function typeOf(id) {
    return TYPES.filter(function (x) { return x.id === id; })[0] || null;
  }

  /** The list a kind of station pulls from, before any per-station override. */
  function phaseForType(typeId) {
    var t = typeOf(typeId);
    return t ? t.phase : "";
  }

  function typeLabel(typeId) {
    var t = typeOf(typeId);
    return t ? t.label : "";
  }

  /**
   * The shop as it actually stands: four welding benches and one CAP rail
   * bench, plus the finishing line.
   *
   * Two deliberate choices kept from before:
   *
   *   - the laser bay and wet paint have no phase, because no list on the board
   *     corresponds to them. They render as "no phase set" rather than being
   *     quietly pointed somewhere plausible, which would be a guess dressed as
   *     a fact.
   *   - nobody is assigned to anything. Station staffing changes weekly and is
   *     a manager's call; seeding it would put the wrong people on the wrong
   *     benches on day one.
   *
   * This is a starting point, not a fixture. Stations are added and removed in
   * the gear, because a shop that grows a sixth bench should not need a release.
   */
  var DEFAULTS = [
    { id: "s1", area: "shop", table: "Station #1", type: "weld", welder: "" },
    { id: "s2", area: "shop", table: "Station #2", type: "weld", welder: "" },
    { id: "s3", area: "shop", table: "Station #3", type: "weld", welder: "" },
    { id: "s4", area: "shop", table: "Station #4", type: "weld", welder: "" },
    { id: "s5", area: "shop", table: "CAP rail bench", type: "cap", welder: "" },
    { id: "f1", area: "finishing", table: "Blast booth", type: "blast", welder: "" },
    { id: "f2", area: "finishing", table: "Powder booth", type: "powder", welder: "" },
    { id: "f3", area: "finishing", table: "Cure oven", type: "cure", welder: "" },
    { id: "f4", area: "finishing", table: "Wet paint", type: "wet", welder: "" }
  ];

  /**
   * Fill in what a station doesn't say for itself.
   *
   * `station` (the words under the name) and `phase` (the list it pulls) both
   * come from the type unless the station overrides them. Older saved configs
   * carry `station` and `phase` but no `type`, so the type is inferred back out
   * of them -- a board that saved a config last month must not come back with
   * every bench set to "Something else".
   */
  function hydrate(s) {
    var out = Object.assign({}, s);
    if (!out.type) out.type = inferType(s);
    var t = typeOf(out.type);
    if (!out.station) out.station = t ? t.label : "";
    if (out.phase === undefined || out.phase === null) out.phase = t ? t.phase : "";
    return out;
  }

  function inferType(s) {
    var label = String((s && s.station) || "").toLowerCase();
    var phase = String((s && s.phase) || "").toLowerCase();
    var hit = TYPES.filter(function (x) {
      return x.label.toLowerCase() === label;
    })[0];
    if (hit) return hit.id;
    if (/cap/.test(phase)) return "cap";
    if (/cnc/.test(phase)) return "cnc";
    if (/assemble/.test(phase)) return "weld";
    if (/sandblast|powder/.test(phase)) return "blast";
    if (/install/.test(phase)) return "install";
    if (/weld/.test(label)) return "weld";
    if (/laser/.test(label)) return "laser";
    return "other";
  }

  /** A fresh station a manager just added. Ids must never collide with saved ones. */
  function newStation(cfg, areaId, typeId) {
    var used = {};
    ((cfg && cfg.stations) || []).forEach(function (s) { used[s.id] = true; });
    var n = 1, id;
    do { id = "x" + n++; } while (used[id]);
    var t = typeOf(typeId) || typeOf("weld");
    return hydrate({
      id: id, area: areaId || "shop", table: "New station",
      type: t.id, welder: ""
    });
  }

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

  /**
   * A saved config laid over the shipped one.
   *
   * Two rules that pull in opposite directions, and both matter:
   *
   *   a station added in a later release must APPEAR on a board that saved its
   *   config months ago, or shops silently miss new benches;
   *
   *   a station a manager DELETED must stay deleted, or it returns on the next
   *   load and they delete it again, and again.
   *
   * A plain merge gives the first and breaks the second. So deletions are
   * recorded by id in `removed` -- an explicit fact about what somebody chose,
   * which is the only thing that can outrank a default.
   */
  function merge(saved) {
    var base = defaults().map(hydrate);
    var out = {
      stations: base,
      visible: base.map(function (s) { return s.id; }),
      removed: []
    };
    if (!saved || typeof saved !== "object") return out;

    var gone = {};
    (saved.removed || []).forEach(function (id) { gone[id] = true; });
    out.removed = (saved.removed || []).slice();

    var byId = {};
    (saved.stations || []).forEach(function (s) { if (s && s.id) byId[s.id] = s; });

    out.stations = base.filter(function (d) { return !gone[d.id]; }).map(function (d) {
      var s = byId[d.id];
      if (!s) return d;
      return hydrate({
        id: d.id,
        area: s.area || d.area,
        table: s.table !== undefined ? s.table : d.table,
        type: s.type || d.type,
        station: s.station !== undefined ? s.station : undefined,
        welder: s.welder !== undefined ? s.welder : d.welder,
        phase: s.phase !== undefined ? s.phase : undefined,
        /* A HAND-PICKED CHECKLIST IS A DECISION AND HAS TO SURVIVE A RELOAD.
         *
         * This field-by-field rebuild silently dropped `checklist`, which a
         * manager sets in the gear and which lib/qc.js reads FIRST when working
         * out which list a station inspects against. Stations a shop added
         * itself kept it (they are pushed through hydrate wholesale below); the
         * nine shipped ones lost it on the next load and quietly fell back to
         * matching by name. Because the blast booth, the powder booth and the
         * cure oven all sit on one phase, name-matching hands all three the
         * same list -- precisely what choosing per station exists to prevent.
         * The manager sees it take effect, then finds it reset later. */
        checklist: s.checklist !== undefined ? s.checklist : d.checklist
      });
    });

    // Stations this shop added itself are kept exactly as they were saved.
    (saved.stations || []).forEach(function (s) {
      if (!s || !s.id || gone[s.id]) return;
      if (base.some(function (d) { return d.id === s.id; })) return;
      out.stations.push(hydrate(s));
    });

    if (Array.isArray(saved.visible)) {
      var known = {};
      out.stations.forEach(function (x) { known[x.id] = true; });
      out.visible = saved.visible.filter(function (id) { return known[id]; });
    }
    return out;
  }

  function save(t, cfg) {
    return t.set("board", "shared", KEY, {
      stations: cfg.stations || [],
      visible: cfg.visible || [],
      removed: cfg.removed || []
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
      if (isFinished(w)) return false;
      return !w.tableId;
    }).sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); });
  }

  /**
   * Is this phase's work finished, whatever happens to it next?
   *
   * THE SHOP FLOOR MUST NOT CARE HOW A JOB LEAVES. It used to read
   * `pendingApproval` directly at four points, which quietly made the station
   * queues depend on the approval model: stop writing that flag -- which is
   * exactly what retiring approvals does -- and finished jobs never leave a
   * bench. Every station fills up with work nobody can clear, and nothing
   * reports a problem.
   *
   * So the question is asked once, here, and it accepts either answer:
   *
   *   completedAt     the phase was finished. Set by WFPhase.complete on both
   *                   the old approval path and the new QC one.
   *   pendingApproval the older flag, still written by paths that have not
   *                   been converted yet.
   *
   * When approvals are gone, the second clause is deleted and nothing else
   * moves.
   */
  function isFinished(work) {
    if (!work) return false;
    return !!(work.completedAt || work.pendingApproval);
  }

  /**
   * When this work was last on the clock, as a timestamp, or 0 if it never was.
   *
   * Reads the end of the newest segment, falling back to its start for one
   * that is still open. A card assigned but never started answers 0, which is
   * what puts it behind anything anybody has actually worked on.
   */
  function lastTouched(work) {
    var segs = (work && work.segments) || [];
    var best = 0;
    segs.forEach(function (s) {
      var when = Date.parse(s.end || s.start || "");
      if (when && when > best) best = when;
    });
    return best;
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
    /* WHAT IS ON THE BENCH IS NOT THE SAME QUESTION AS WHAT IS QUEUED ON IT.
     *
     * Several cards legitimately carry this station's tableId at once: the job
     * on the clock, a job paused mid-switch, and every card whose queue order
     * somebody set with the ▲▼ arrows or moved here from another bench. Those
     * last ones are pure scheduling -- `setStation` writes a stub
     * `{claimedBy:null, segments:[]}` for a card that had no phase work at all,
     * which is the correct record of "this is queued here" and nothing more.
     *
     * Taking the first card carrying the tableId therefore let a card nobody
     * had ever touched win the "Now building" slot. Because it had no claim,
     * `canWork` said no and the Start button did not render: the station showed
     * a job it was impossible to start, and the real work was pushed out of the
     * queue behind it. That is the "start and stop are gone" report, and it is
     * also why switching looked like it did nothing -- the switch worked, and
     * then this picked the stub again on the repaint.
     *
     * So the bench slot is only ever taken by work somebody has actually
     * engaged with -- a claim, or time on the clock. A bare queue entry stays
     * in the queue, where it can be tapped to start.
     *
     * Order within that: running beats paused (pausing A to start B leaves both
     * here and the station must show what is on the clock), then the queue's
     * own order, so the answer never depends on what order Trello handed the
     * cards back in.
     */
    var mineHere = inPhase.filter(function (c) {
      var w = activeWork(c);
      if (!w || isFinished(w) || w.tableId !== station.id) return false;
      return !!(w.claimedBy || (w.segments && w.segments.length));
    }).sort(byQueuePos);
    var pick = mineHere.filter(function (c) { return isRunning(activeWork(c)); })[0] ||
               mineHere.slice().sort(function (a, b) {
                 /* Nothing running: the bench shows what was touched last.
                  *
                  * Queue order is wrong here. Pausing A to start B parks A at
                  * the FRONT of the queue, so ordering by queuePos means
                  * stopping B flips the station back to A -- the job the welder
                  * deliberately stepped away from, reappearing because they
                  * pressed Stop. Last touched keeps the bench on the job they
                  * were actually on. Queue order still decides between two
                  * jobs neither of which has ever run. */
                 var d = lastTouched(activeWork(b)) - lastTouched(activeWork(a));
                 return d || byQueuePos(a, b);
               })[0];
    if (pick) {
      out.job = pick;
      out.work = activeWork(pick);
      out.owned = true;
    }

    if (!out.job && station.welder) {
      inPhase.some(function (c) {
        var w = activeWork(c);
        if (!w || isFinished(w)) return false;
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
      if (w && isFinished(w)) return;
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
    TYPES: TYPES,
    types: types,
    typeOf: typeOf,
    typeLabel: typeLabel,
    phaseForType: phaseForType,
    hydrate: hydrate,
    inferType: inferType,
    newStation: newStation,
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
    lastTouched: lastTouched,
    isFinished: isFinished,
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
