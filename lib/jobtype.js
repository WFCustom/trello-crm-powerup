/**
 * WFJobType -- what kind of job this is, and therefore which phases it goes
 * through.
 *
 * The board grew a dedicated CNC list because someone needed to see at a
 * glance which jobs weren't taking the normal path. That instinct was right;
 * the list was the wrong place to express it. A job's route is a property of
 * the JOB, not of a column, so it belongs on the card.
 *
 * Read from a "Job Type" dropdown custom field. Cards without one fall back to
 * LEGACY, which is the bulk of the work and the safest assumption -- an
 * unlabelled job keeps the full shop route rather than quietly skipping steps.
 *
 * QC is deliberately absent from every route. Quality checks are not columns;
 * they sit between phases inside the Power-Up, so they apply to all routes
 * without appearing here.
 */
(function (global) {
  "use strict";

  var FIELD_NAME = "Job Type";

  /* Phase names as they appear after WFOps.phaseKey() normalisation. */
  var P = {
    PACKET: "Make Job Packet",
    CAD: "CAD",
    PRINT: "Print CAD",
    APPROVAL: "Final Approval",
    ASM_LEGACY: "Assemble Legacy",
    ASM_CAP: "Assemble CAP",
    ASM_CNC: "Assemble CNC",
    FINISH: "Sandblast / Powder Coat",
    INSTALL: "Install"
  };

  /**
   * Routes are ordered. Auto-advance walks this list, so a phase absent here is
   * never routed to -- that is how CNC stops being forced on jobs with no
   * cutting in them.
   */
  var TYPES = [
    {
      key: "legacy",
      label: "Legacy fabrication",
      note: "Railings, window well covers, chimney caps, staircases, grabrails, custom work",
      route: [P.PACKET, P.APPROVAL, P.CAD, P.PRINT, P.ASM_LEGACY, P.FINISH, P.INSTALL]
    },
    {
      key: "cnc_only",
      label: "CNC only",
      note: "A cut shape on its own. May or may not be powder coated",
      // No separate cutting stage: Assemble CNC covers cut and build. The old
      // "CNC Table" column is gone from the board, so routing through it sent
      // jobs to a list that no longer exists.
      route: [P.CAD, P.ASM_CNC, P.INSTALL],
      optional: [P.FINISH]
    },
    {
      key: "cap_only",
      label: "CAP railing only",
      note: "Aluminium system: no fabrication finish step",
      route: [P.CAD, P.ASM_CAP, P.INSTALL]
    },
    {
      key: "custom",
      label: "Other custom fabrication",
      note: "Anything else; takes the full legacy shop route",
      route: [P.PACKET, P.APPROVAL, P.CAD, P.PRINT, P.ASM_LEGACY, P.FINISH, P.INSTALL]
    },

    /* Combination jobs are not a route -- they are two jobs sharing a number.
       Under the linked-card model each half becomes its own card so neither
       history has to be merged later. splitsInto names the halves. */
    {
      key: "legacy_cnc",
      label: "CNC + legacy railing",
      note: "Cut-out is a component of the rail; split so each half tracks its own work",
      splitsInto: ["legacy", "cnc_only"]
    },
    {
      key: "legacy_cap",
      label: "Legacy + CAP",
      note: "CAP aluminium outside, welded iron inside; split into two cards",
      splitsInto: ["legacy", "cap_only"]
    }
  ];

  var DEFAULT_KEY = "legacy";

  function all() { return TYPES.slice(); }

  function byKey(key) {
    return TYPES.filter(function (x) { return x.key === key; })[0] || null;
  }

  /** Match a dropdown value to a type, tolerantly -- people rename options. */
  function fromLabel(text) {
    if (!text) return null;
    var v = String(text).trim().toLowerCase();
    var exact = TYPES.filter(function (t) { return t.label.toLowerCase() === v; })[0];
    if (exact) return exact;
    var hasCnc = v.indexOf("cnc") !== -1;
    var hasCap = v.indexOf("cap") !== -1;
    var hasLegacy = v.indexOf("legacy") !== -1 || v.indexOf("railing") !== -1;
    if (hasCnc && hasLegacy) return byKey("legacy_cnc");
    if (hasCnc) return byKey("cnc_only");
    if (hasCap && hasLegacy) return byKey("legacy_cap");
    if (hasCap) return byKey("cap_only");
    if (v.indexOf("custom") !== -1 || v.indexOf("other") !== -1) return byKey("custom");
    if (hasLegacy) return byKey("legacy");
    return null;
  }

  /** The type recorded on a card, defaulting to legacy. */
  function forCard(card) {
    var t = card && card.jobType ? fromLabel(card.jobType) : null;
    return t || byKey(DEFAULT_KEY);
  }

  /** Combination types have no route of their own -- they split first. */
  function needsSplit(card) {
    var t = forCard(card);
    return Array.isArray(t.splitsInto) ? t.splitsInto.slice() : null;
  }

  function routeFor(card) {
    var t = forCard(card);
    if (Array.isArray(t.splitsInto)) {
      // Until it's split, follow the first half so the job isn't stuck.
      var first = byKey(t.splitsInto[0]);
      return first ? first.route.slice() : [];
    }
    return (t.route || []).slice();
  }

  function isOnRoute(card, phaseName) {
    return routeFor(card).indexOf(phaseName) !== -1;
  }

  /**
   * The next phase this particular job should go to, skipping anything not on
   * its route. Returns null at the end of the route.
   *
   * Being off-route is not an error -- someone may hand-drag a card anywhere.
   * In that case we resume at the first route phase that comes after it in the
   * shop's overall order, so the job rejoins its route rather than stalling.
   */
  function nextPhase(card, currentPhaseName, shopOrder) {
    var route = routeFor(card);
    var i = route.indexOf(currentPhaseName);
    if (i !== -1) return route[i + 1] || null;

    if (!shopOrder || !shopOrder.length) return route[0] || null;
    var here = shopOrder.indexOf(currentPhaseName);
    if (here === -1) return route[0] || null;
    for (var j = here + 1; j < shopOrder.length; j++) {
      if (route.indexOf(shopOrder[j]) !== -1) return shopOrder[j];
    }
    return null;
  }

  global.WFJobType = {
    FIELD_NAME: FIELD_NAME,
    PHASES: P,
    DEFAULT_KEY: DEFAULT_KEY,
    all: all, byKey: byKey, fromLabel: fromLabel,
    forCard: forCard, routeFor: routeFor, isOnRoute: isOnRoute,
    needsSplit: needsSplit,
    nextPhase: nextPhase
  };
})(window);
