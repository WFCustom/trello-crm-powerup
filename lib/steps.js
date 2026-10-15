/**
 * WFSteps -- more than one station inside a single Trello column.
 *
 * THE PROBLEM THIS EXISTS FOR
 *
 * The board has one list called "Sandblast / Powder Coat". The shop has two
 * benches behind it: parts are blasted, then powder is sprayed on them. Those
 * are different work, done by different people, checked against different
 * lists, and a job that has been blasted is emphatically not still the blast
 * booth's problem.
 *
 * But the card does not move between them, because there is only one column.
 * So before this, both booths pulled the same undifferentiated queue: every job
 * appeared in both at once, and pressing Complete at the blast booth called
 * WFPhase.advance, which moved the card OUT of Sandblast / Powder Coat
 * entirely -- straight past the powder booth.
 *
 * WHY A TRELLO LABEL AND NOT A HIDDEN FIELD
 *
 * A job's position within the phase is carried by a label on the card. That is
 * the same choice lib/sop.js, lib/eos.js and lib/records.js all make: native
 * Trello fields hold the meaning, so the board still reads correctly to
 * somebody looking at Trello without the Power-Up open. Somebody scanning the
 * finishing column sees at a glance which parts are blasted and which are not,
 * and can filter on it in Trello itself.
 *
 * It also survives us. If this Power-Up were switched off tomorrow the
 * information would still be on the board, in a form anybody can read -- which
 * is not true of plugin data, and is worth something given a board admin
 * disabling a Power-Up can clear plugin data outright.
 *
 * N STEPS NEED N-1 LABELS
 *
 * The last step needs no label, because finishing it moves the card to the next
 * list and its position stops being a question. Blast then powder therefore
 * needs exactly one label: "Blasted". A job without it belongs to the blast
 * booth; a job with it belongs to the powder booth. That is the whole model.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No skipping. Every job goes through every step, by decision: a shop where a
 * step can be waved through is a shop where the record stops meaning the work
 * happened. If that changes, the place to add it is `stepFor` -- and it should
 * write down who skipped it and why, not just move the job.
 */
(function (global) {
  "use strict";

  /**
   * Steps within a phase, in order.
   *
   * `station` is the WFTables station TYPE that serves the step, which is what
   * lets a bench work out which jobs are its own. `label` is the Trello label
   * applied when the step is finished; the last step in a phase carries none,
   * because completing it advances the card for real.
   *
   * Overridable from config.js via WF_CONFIG.phaseSteps so a shop can add a
   * bench without a release.
   */
  var DEFAULT_STEPS = {
    "Sandblast / Powder Coat": [
      { id: "blast", name: "Sandblast", station: "blast", label: "Blasted",
        color: "sky" },
      // Last step: no label. Finishing powder coat moves the card on, and a
      // job that has left the column does not need a marker saying where it
      // was inside it.
      { id: "powder", name: "Powder coat", station: "powder", label: null }
    ]
  };

  function allSteps() {
    var c = global.WF_CONFIG && global.WF_CONFIG.phaseSteps;
    return (c && typeof c === "object") ? c : DEFAULT_STEPS;
  }

  /** The steps for a phase, or [] where the phase is one undivided piece. */
  function stepsFor(phaseName) {
    var s = allSteps()[phaseName];
    return Array.isArray(s) ? s.slice() : [];
  }

  /** Does this phase have more than one bench inside it? */
  function isSplit(phaseName) { return stepsFor(phaseName).length > 1; }

  /** Every label name a step uses, for creating them on the board once. */
  function labelNames() {
    var out = [];
    var all = allSteps();
    Object.keys(all).forEach(function (phase) {
      (all[phase] || []).forEach(function (s) {
        if (s.label && out.indexOf(s.label) === -1) out.push(s.label);
      });
    });
    return out;
  }

  /**
   * Which step a card is at, given the labels it carries.
   *
   * Walks the steps in order and stops at the first one whose label the card
   * does NOT have: that is the work still to do. A card carrying every label is
   * at the last step, which is the one that ships it.
   *
   * `labelNamesOn` is the set of label NAMES on the card. Names rather than ids
   * because ids are per-board and a name is the thing a person set.
   */
  function stepFor(phaseName, labelNamesOn) {
    var steps = stepsFor(phaseName);
    if (!steps.length) return null;
    var have = {};
    (labelNamesOn || []).forEach(function (n) {
      if (n) have[String(n).toLowerCase()] = true;
    });
    for (var i = 0; i < steps.length; i++) {
      var lab = steps[i].label;
      // No label means nothing marks this step done, so it is where the job
      // stops. That is always true of the last step, and is what ends the walk.
      if (!lab || !have[lab.toLowerCase()]) {
        return { index: i, step: steps[i], last: i === steps.length - 1 };
      }
    }
    var n = steps.length - 1;
    return { index: n, step: steps[n], last: true };
  }

  /**
   * Resolve a card's label ids to names using the board's label list.
   *
   * getBoardCardsFull returns idLabels; the names live on the board. Kept here
   * rather than making every caller join the two.
   */
  function namesOn(card, boardLabels) {
    var byId = {};
    (boardLabels || []).forEach(function (l) { if (l && l.id) byId[l.id] = l.name; });
    return ((card && card.idLabels) || []).map(function (id) { return byId[id]; })
      .filter(Boolean);
  }

  /**
   * Does this card belong in this station's queue right now?
   *
   * A station whose type serves no step in this phase takes everything, which
   * keeps every undivided phase behaving exactly as it did -- the welding
   * benches know nothing about any of this.
   */
  function isForStation(phaseName, card, boardLabels, stationType) {
    var steps = stepsFor(phaseName);
    if (!steps.length) return true;
    var serves = steps.filter(function (s) { return s.station === stationType; })[0];
    if (!serves) return true;
    var at = stepFor(phaseName, namesOn(card, boardLabels));
    return !!(at && at.step.id === serves.id);
  }

  /** The step a station type serves in a phase, or null. */
  function stepForStation(phaseName, stationType) {
    return stepsFor(phaseName).filter(function (s) {
      return s.station === stationType;
    })[0] || null;
  }

  /**
   * Finish a step that is NOT the last one: mark it and leave the card be.
   *
   * Returns { handedTo } naming the step that now owns the job, so the caller
   * can say so rather than reporting a move that did not happen. The card's
   * list is untouched on purpose -- there is nowhere for it to go, which is the
   * entire reason this file exists.
   *
   * Creating the label if it is missing is deliberate: a board that has never
   * run a finishing job has no "Blasted" label, and asking a manager to make
   * one before the first job can leave the blast booth is a setup step nobody
   * will have done at the moment it is needed.
   */
  function completeStep(t, card, phaseName, boardId, stepId) {
    var steps = stepsFor(phaseName);
    var i = steps.map(function (s) { return s.id; }).indexOf(stepId);
    if (i === -1 || i === steps.length - 1) {
      return Promise.reject(new Error("That step doesn't hand on to another."));
    }
    var step = steps[i];
    var next = steps[i + 1];
    if (!step.label) {
      return Promise.reject(new Error(
        "Step \"" + step.name + "\" has no label, so there is no way to record " +
        "that it is done."));
    }

    return ensureLabel(t, boardId, step.label, step.color).then(function (label) {
      if (!label || !label.id) throw new Error("Couldn't create the " + step.label + " label.");
      return global.WFRest.addLabelToCard(t, card.id, label.id).then(function () {
        return global.WFRest.postComment(t, card.id,
          step.name + " finished. Handed to " + next.name +
          " — the card stays in this list.")
          .catch(function () { /* the label is the record; the comment is manners */ });
      }).then(function () {
        return { handedTo: next, label: label };
      });
    });
  }

  /**
   * Find a label by name on the board, creating it if it is missing.
   *
   * Matched on name, case-insensitively, because the label is a thing a person
   * reads and may well have made by hand before we got there.
   */
  function ensureLabel(t, boardId, name, color) {
    return global.WFRest.getBoardLabels(t, boardId).then(function (labels) {
      var hit = (labels || []).filter(function (l) {
        return l && l.name && l.name.toLowerCase() === String(name).toLowerCase();
      })[0];
      if (hit) return hit;
      return global.WFRest.createLabel(t, boardId, name, color || "sky");
    });
  }

  /**
   * Take every step label off a card.
   *
   * Called when a job leaves the phase for real. A card arriving in Install
   * still wearing "Blasted" is not wrong exactly, but it is noise on a board
   * people read at a glance -- and if the job ever comes back for rework, a
   * stale label would put it straight into the powder queue without anybody
   * having blasted it again.
   */
  function clearStepLabels(t, card, phaseName, boardLabels) {
    var steps = stepsFor(phaseName);
    if (!steps.length) return Promise.resolve(0);
    var wanted = {};
    steps.forEach(function (s) { if (s.label) wanted[s.label.toLowerCase()] = true; });

    var byId = {};
    (boardLabels || []).forEach(function (l) { if (l && l.id) byId[l.id] = l.name; });
    var toDrop = ((card && card.idLabels) || []).filter(function (id) {
      var nm = byId[id];
      return nm && wanted[String(nm).toLowerCase()];
    });
    if (!toDrop.length) return Promise.resolve(0);

    return toDrop.reduce(function (chain, id) {
      return chain.then(function () {
        return global.WFRest.removeLabelFromCard(t, card.id, id)
          .catch(function () { /* a label that will not come off is not worth failing a hand-off for */ });
      });
    }, Promise.resolve()).then(function () { return toDrop.length; });
  }

  global.WFSteps = {
    DEFAULT_STEPS: DEFAULT_STEPS,
    stepsFor: stepsFor,
    isSplit: isSplit,
    labelNames: labelNames,
    stepFor: stepFor,
    namesOn: namesOn,
    isForStation: isForStation,
    stepForStation: stepForStation,
    completeStep: completeStep,
    clearStepLabels: clearStepLabels,
    ensureLabel: ensureLabel
  };
})(window);
