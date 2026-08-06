/**
 * Late additions to the board map, applied at runtime.
 *
 * These three Assemble lists were created after config.js was written. Adding
 * them here rather than editing config.js keeps that file — which holds every
 * list id on two boards — untouched, so a mistake here can't scramble the
 * existing stage mapping. Anything already present is left alone.
 */
(function (global) {
  "use strict";

  var BOARD = "6939928cc816d7f7d1d2d7ba";   // Office Operations

  var LATE_STAGES = [
    { listId: "6a74439686dbb64b8cc70edd", name: "Assemble Legacy", order: 8, slaDays: 3, isWorkPhase: true },
    { listId: "6a7443a48c1c28981da03fae", name: "Assemble CAP",    order: 8, slaDays: 3, isWorkPhase: true },
    { listId: "6a7443b2439b65a180127f86", name: "Assemble CNC",    order: 8, slaDays: 3, isWorkPhase: true }
  ];

  var cfg = global.WF_CONFIG;
  var board = cfg && cfg.boards && cfg.boards[BOARD];
  if (!board || !Array.isArray(board.stages)) return;

  LATE_STAGES.forEach(function (s) {
    var already = board.stages.some(function (x) { return x.listId === s.listId; });
    if (!already) board.stages.push(s);
  });

  board.stages.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
})(window);
