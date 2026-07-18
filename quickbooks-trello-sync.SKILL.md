/**
 * Team Performance aggregation: turns raw card data (economics + phaseLog,
 * both already being captured by the phase-flow system) into a per-project
 * view and a per-person view. No new data collection required -- this is
 * pure read-side math over what's already there.
 */
(function (global) {
  function parseDescField(desc, fieldName) {
    if (!desc) return null;
    const re = new RegExp("^" + fieldName + ":\\s*(.+)$", "im");
    const match = desc.match(re);
    return match ? match[1].trim() : null;
  }

  function projectStatus(boardCfg, idList) {
    const stage = boardCfg.stages.find((s) => s.listId === idList);
    if (!stage) return "unknown";
    if (stage.isTerminal === "won") return "won";
    if (stage.isTerminal === "lost") return "lost";
    return "open";
  }

  // One row per card: value, cost, margin, work type, status, total logged
  // time, and "production time" = span between the first and last approved
  // phase (a proxy for cycle time -- it won't capture the gap between
  // intake and the first claimed phase, called out here on purpose rather
  // than quietly mislabeling it as full order-to-cash time).
  function buildProjectRollup(cards, boardCfg) {
    return cards.map((card) => {
      const type = parseDescField(card.desc, "Type of Project") || "Unclassified";
      const econ = card.economics;
      const value = econ && econ.value != null ? Number(econ.value) : null;
      const cost = econ && econ.cost != null ? Number(econ.cost) : null;
      const margin = value != null && cost != null ? value - cost : null;
      const marginPct = value ? Math.round(((margin || 0) / value) * 1000) / 10 : null;

      const log = card.phaseLog || [];
      const totalMinutes = log.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
      let productionDays = null;
      if (log.length) {
        const dates = log.map((e) => new Date(e.approvedAt).getTime()).filter((n) => !isNaN(n));
        if (dates.length) {
          productionDays = (Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24);
        }
      }

      return {
        id: card.id,
        name: card.name,
        type,
        status: boardCfg ? projectStatus(boardCfg, card.idList) : "unknown",
        value, cost, margin, marginPct,
        totalMinutes,
        productionDays,
        phaseCount: log.length
      };
    });
  }

  function groupProjectsByType(projectRows) {
    const byType = new Map();
    projectRows.forEach((p) => {
      if (p.value == null) return; // only include jobs with economics entered
      const bucket = byType.get(p.type) || { type: p.type, count: 0, sumValue: 0, sumCost: 0 };
      bucket.count++;
      bucket.sumValue += p.value;
      bucket.sumCost += p.cost || 0;
      byType.set(p.type, bucket);
    });
    return Array.from(byType.values()).map((b) => {
      const margin = b.sumValue - b.sumCost;
      return Object.assign(b, {
        margin,
        marginPct: b.sumValue ? Math.round((margin / b.sumValue) * 1000) / 10 : null
      });
    });
  }

  // Per-person productivity + a simple activity-based revenue attribution:
  // each person's share of a project's margin is proportional to their share
  // of the total logged minutes on that project. If config.hourlyRates has
  // an entry for their username, labor cost and net contribution are added;
  // otherwise it's just hours + attributed revenue share (no rate needed).
  function buildPersonRollup(cards, boardId, sinceDate, liveRates) {
    // Live QuickBooks-synced rates win; config.js hourlyRates is only a
    // fallback for anyone not (yet) present on the synced Rates card.
    const configRates = (global.WF_CONFIG && global.WF_CONFIG.hourlyRates) || {};
    const hourlyRates = Object.assign({}, configRates, liveRates || {});
    const people = new Map(); // username -> aggregate

    cards.forEach((card) => {
      const log = card.phaseLog || [];
      if (!log.length) return;
      const cardTotalMinutes = log.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
      const cardMargin = (card.economics && card.economics.value != null)
        ? Number(card.economics.value) - Number(card.economics.cost || 0)
        : null;

      log.forEach((entry) => {
        if (sinceDate && new Date(entry.approvedAt) < sinceDate) return;
        const username = entry.claimedBy && entry.claimedBy.username;
        if (!username) return;

        const person = people.get(username) || {
          username,
          fullName: entry.claimedBy.fullName || username,
          totalMinutes: 0,
          phasesCompleted: 0,
          projects: new Set(),
          efficiencyRatios: [],
          attributedMargin: 0
        };

        person.totalMinutes += entry.durationMinutes || 0;
        person.phasesCompleted += 1;
        person.projects.add(card.name);

        const stage = global.WFStage.getStageForList(boardId, entry.listId);
        if (stage && stage.slaDays) {
          const actualDays = (entry.durationMinutes || 0) / (60 * 24);
          person.efficiencyRatios.push(actualDays / stage.slaDays);
        }

        if (cardMargin != null && cardTotalMinutes > 0) {
          const share = (entry.durationMinutes || 0) / cardTotalMinutes;
          person.attributedMargin += cardMargin * share;
        }

        people.set(username, person);
      });
    });

    return Array.from(people.values()).map((p) => {
      const hours = Math.round((p.totalMinutes / 60) * 10) / 10;
      const avgEfficiency = p.efficiencyRatios.length
        ? Math.round((p.efficiencyRatios.reduce((a, b) => a + b, 0) / p.efficiencyRatios.length) * 100) / 100
        : null;
      const rate = hourlyRates[p.username];
      const laborCost = rate ? Math.round(hours * rate) : null;
      const netContribution = laborCost != null ? Math.round(p.attributedMargin - laborCost) : null;
      return {
        username: p.username,
        fullName: p.fullName,
        hours,
        phasesCompleted: p.phasesCompleted,
        projectCount: p.projects.size,
        avgEfficiency, // <1 = faster than SLA on average, >1 = slower
        attributedMargin: Math.round(p.attributedMargin),
        laborCost,
        netContribution
      };
    }).sort((a, b) => b.attributedMargin - a.attributedMargin);
  }


  // Parse the live Rates card description ("username: rate" lines) into a
  // plain object. Tolerant of the surrounding instructional text in that
  // card -- only lines matching the pattern are picked up.
  function parseRatesCardDesc(desc) {
    const rates = {};
    if (!desc) return rates;
    desc.split("\n").forEach((line) => {
      const m = line.match(/^\s*([a-zA-Z0-9_.\-]+)\s*:\s*([\d.]+)\s*$/);
      if (m) rates[m[1]] = parseFloat(m[2]);
    });
    return rates;
  }

  global.WFMetrics = {
    parseDescField,
    projectStatus,
    buildProjectRollup,
    groupProjectsByType,
    buildPersonRollup,
    parseRatesCardDesc
  };
})(window);
