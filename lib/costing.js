/**
 * WFCosting -- job cost & margin, with rework isolated as its own cost line.
 *
 * Mirrors wf_costing spreadsheet.xlsx, with one deliberate difference: the
 * spreadsheet asks you to type "Actual Time/Labor" per category per job, and
 * we already measure it. Every approved phase writes { listName, claimedBy,
 * durationMinutes } to the card's phaseLog, so labor cost is computed from
 * logged time x that person's rate instead of being entered by hand.
 *
 * THE REWORK MODEL -- the important part.
 *
 * The four production categories share the job's price (30/35/25/10). ReWork
 * does NOT get a share, because a reworked job doesn't bill more: the customer
 * pays the same and the shop absorbs the extra hours. So rework is pure cost,
 * and every dollar of it comes straight out of margin. That's what makes it
 * visible here:
 *
 *   margin          = price - (production labor + rework labor + overhead)
 *   marginIfNoRework= price - (production labor + overhead)
 *   costOfRework    = marginIfNoRework - margin   (i.e. the rework labor)
 *
 * Reporting both is the point: "we run 34% margin, or 41% on jobs that don't
 * come back" is the sentence this is built to produce.
 *
 * Anything logged against a phase no category claims lands in "Unassigned"
 * rather than being dropped, so totals always reconcile.
 */
(function (global) {
  "use strict";

  /* Defaults match the workbook's "Standard Split (updated 7/29/26)".
     Override by adding a costModel block to WF_CONFIG. */
  var DEFAULT_MODEL = {
    categories: [
      { name: "Sales & Office", pct: 30,
        phases: ["Intake", "Portal - CRM", "Make Job Packet", "Portal - Final Measure",
                 "Billing", "Outstanding Invoices"] },
      { name: "Shop", pct: 35,
        phases: ["CAD", "Print CAD", "CNC Table", "Assemble"] },
      { name: "Sand & Powder", pct: 25,
        phases: ["Sandblast / Powder Coat"] },
      { name: "Install", pct: 10,
        phases: ["Install", "Install (Tuesday)"] }
    ],
    // No revenue share. Labor logged here is margin erosion by definition.
    costOnly: [
      { name: "ReWork", phases: ["ReWork"] }
    ]
  };

  function model() {
    return (global.WF_CONFIG && global.WF_CONFIG.costModel) || DEFAULT_MODEL;
  }

  /** phase name -> { category, revenue:bool } */
  function phaseIndex() {
    var m = model(), idx = {};
    (m.categories || []).forEach(function (c) {
      (c.phases || []).forEach(function (p) { idx[p] = { category: c.name, revenue: true }; });
    });
    (m.costOnly || []).forEach(function (c) {
      (c.phases || []).forEach(function (p) { idx[p] = { category: c.name, revenue: false }; });
    });
    return idx;
  }

  function rateFor(rates, username) {
    if (!rates || !username) return null;
    var r = rates[username];
    return (typeof r === "number" && isFinite(r) && r > 0) ? r : null;
  }

  /** Flat % of price added to cost when an owner/manager worked the job. */
  function overheadFor(card, price) {
    var cfg = global.WF_CONFIG && global.WF_CONFIG.managementOverhead;
    if (!cfg || !price) return 0;
    var log = card.phaseLog || [];
    var touched = log.some(function (e) {
      return e.claimedBy && (cfg.usernames || []).indexOf(e.claimedBy.username) !== -1;
    });
    if (!touched) return 0;
    return Number(price) * (cfg.percentOfJobValue || 0) / 100;
  }

  function blankBucket() {
    return { hours: 0, cost: 0, hoursUnpriced: 0, entries: 0 };
  }

  function addEntry(bucket, minutes, rate) {
    var hrs = (Number(minutes) || 0) / 60;
    bucket.hours += hrs;
    bucket.entries++;
    if (rate == null) bucket.hoursUnpriced += hrs;
    else bucket.cost += hrs * rate;
  }

  /**
   * One row per card that has any price or any logged time.
   * rates: { username: dollarsPerHour }
   */
  function buildJobRows(cards, boardCfg, rates) {
    var m = model(), idx = phaseIndex();
    var revenueCats = (m.categories || []).map(function (c) { return c.name; });
    var costOnlyCats = (m.costOnly || []).map(function (c) { return c.name; });
    var pctOf = {};
    (m.categories || []).forEach(function (c) { pctOf[c.name] = c.pct || 0; });

    return (cards || []).map(function (card) {
      var econ = card.economics || {};
      var price = Number(econ.value) || 0;
      var log = card.phaseLog || [];

      var buckets = {};
      revenueCats.concat(costOnlyCats, ["Unassigned"]).forEach(function (n) {
        buckets[n] = blankBucket();
      });

      log.forEach(function (e) {
        var hit = idx[e.listName] || idx[e.name] || null;
        var cat = hit ? hit.category : "Unassigned";
        if (!buckets[cat]) buckets[cat] = blankBucket();
        addEntry(buckets[cat], e.durationMinutes, rateFor(rates, e.claimedBy && e.claimedBy.username));
      });

      var productionCost = 0, productionHours = 0, unpricedHours = 0;
      revenueCats.forEach(function (n) {
        productionCost += buckets[n].cost;
        productionHours += buckets[n].hours;
        unpricedHours += buckets[n].hoursUnpriced;
      });
      // Unassigned time is real work, so it counts as production cost.
      productionCost += buckets.Unassigned.cost;
      productionHours += buckets.Unassigned.hours;
      unpricedHours += buckets.Unassigned.hoursUnpriced;

      var reworkCost = 0, reworkHours = 0, reworkEntries = 0;
      costOnlyCats.forEach(function (n) {
        reworkCost += buckets[n].cost;
        reworkHours += buckets[n].hours;
        reworkEntries += buckets[n].entries;
        unpricedHours += buckets[n].hoursUnpriced;
      });

      var overhead = overheadFor(card, price);
      var enteredCost = Number(econ.cost) || 0;   // manual materials/consumables
      var costNoRework = productionCost + overhead + enteredCost;
      var totalCost = costNoRework + reworkCost;

      var margin = price ? price - totalCost : null;
      var marginNoRework = price ? price - costNoRework : null;

      var allocation = {};
      revenueCats.forEach(function (n) {
        allocation[n] = {
          pct: pctOf[n],
          allocated: price ? price * (pctOf[n] || 0) / 100 : 0,
          hours: buckets[n].hours,
          cost: buckets[n].cost,
          hoursUnpriced: buckets[n].hoursUnpriced
        };
      });

      return {
        id: card.id,
        name: card.name,
        url: card.shortUrl,
        price: price,
        priced: price > 0,
        valueFrom: econ.valueFrom || null,
        allocation: allocation,
        unassigned: buckets.Unassigned,
        rework: {
          cost: reworkCost, hours: reworkHours, entries: reworkEntries,
          everReworked: reworkEntries > 0 || (card.idList && boardCfg ? false : false)
        },
        productionCost: productionCost,
        productionHours: productionHours,
        overhead: overhead,
        enteredCost: enteredCost,
        unpricedHours: unpricedHours,
        totalCost: totalCost,
        costNoRework: costNoRework,
        margin: margin,
        marginPct: (price && margin != null) ? (margin / price) * 100 : null,
        marginNoRework: marginNoRework,
        marginPctNoRework: (price && marginNoRework != null) ? (marginNoRework / price) * 100 : null,
        marginPointsLostToRework: (price && margin != null && marginNoRework != null)
          ? ((marginNoRework - margin) / price) * 100 : null
      };
    }).filter(function (r) {
      return r.priced || r.productionHours > 0 || r.rework.hours > 0;
    });
  }

  /** Board-level totals, including what rework is costing overall. */
  function rollup(rows) {
    var t = {
      jobs: rows.length, pricedJobs: 0,
      revenue: 0, productionCost: 0, reworkCost: 0, overhead: 0, enteredCost: 0,
      totalCost: 0, reworkHours: 0, productionHours: 0, unpricedHours: 0,
      jobsWithRework: 0, byCategory: {}
    };
    rows.forEach(function (r) {
      if (r.priced) { t.pricedJobs++; t.revenue += r.price; }
      t.productionCost += r.productionCost;
      t.reworkCost += r.rework.cost;
      t.reworkHours += r.rework.hours;
      t.productionHours += r.productionHours;
      t.unpricedHours += r.unpricedHours;
      t.overhead += r.overhead;
      t.enteredCost += r.enteredCost;
      t.totalCost += r.totalCost;
      if (r.rework.entries > 0) t.jobsWithRework++;
      Object.keys(r.allocation).forEach(function (n) {
        if (!t.byCategory[n]) t.byCategory[n] = { allocated: 0, cost: 0, hours: 0 };
        t.byCategory[n].allocated += r.allocation[n].allocated;
        t.byCategory[n].cost += r.allocation[n].cost;
        t.byCategory[n].hours += r.allocation[n].hours;
      });
    });
    t.margin = t.revenue - t.totalCost;
    t.marginPct = t.revenue ? (t.margin / t.revenue) * 100 : null;
    t.marginNoRework = t.revenue - (t.totalCost - t.reworkCost);
    t.marginPctNoRework = t.revenue ? (t.marginNoRework / t.revenue) * 100 : null;
    t.marginPointsLostToRework = (t.marginPct != null && t.marginPctNoRework != null)
      ? t.marginPctNoRework - t.marginPct : null;
    t.reworkRate = rows.length ? (t.jobsWithRework / rows.length) * 100 : null;
    return t;
  }

  /**
   * Which phase hands work to ReWork. phaseLog is chronological, so the entry
   * before a rework entry is where the problem originated -- the signal for
   * "what process step is costing us".
   */
  function reworkOrigins(cards) {
    var idx = phaseIndex(), out = {};
    (cards || []).forEach(function (card) {
      var log = card.phaseLog || [];
      log.forEach(function (e, i) {
        var hit = idx[e.listName] || idx[e.name];
        if (!hit || hit.revenue !== false) return;      // only rework entries
        var prev = i > 0 ? log[i - 1] : null;
        var from = prev ? (prev.listName || prev.name || "unknown") : "unknown";
        if (!out[from]) out[from] = { phase: from, count: 0, hours: 0, cost: 0 };
        out[from].count++;
        out[from].hours += (Number(e.durationMinutes) || 0) / 60;
      });
    });
    return Object.keys(out).map(function (k) { return out[k]; })
      .sort(function (a, b) { return b.hours - a.hours; });
  }

  global.WFCosting = {
    model: model,
    phaseIndex: phaseIndex,
    buildJobRows: buildJobRows,
    rollup: rollup,
    reworkOrigins: reworkOrigins,
    DEFAULT_MODEL: DEFAULT_MODEL
  };
})(window);
