const t = TrelloPowerUp.iframe({ appKey: window.WF_CONFIG.appKey, appName: "Western Fabrication Ops" });
const content = document.getElementById("content");

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function renderAuthPrompt() {
  content.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = "The dashboard needs one-time read access to this board's cards and activity.";
  const btn = document.createElement("button");const t = TrelloPowerUp.iframe({ appKey: window.WF_CONFIG.appKey, appName: "Western Fabrication Ops" });
const content = document.getElementById("content");

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function renderAuthPrompt() {
  content.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = "The dashboard needs one-time read access to this board's cards and activity.";
  const btn = document.createElement("button");
  btn.className = "primary";
  btn.textContent = "Enable dashboard";
  btn.onclick = async () => {
    await WFRest.authorize(t);
    render();
  };
  content.appendChild(p);
  content.appendChild(btn);
}

function stageLabel(boardCfg, listId) {
  const stage = boardCfg.stages.find((s) => s.listId === listId);
  return stage ? stage.name : null;
}

async function render() {
  const authorized = await WFRest.isAuthorized(t).catch(() => false);
  if (!authorized) return renderAuthPrompt();

  content.innerHTML = '<div class="loading">Crunching board data...</div>';

  const board = await t.board("id", "name");
  document.getElementById("title").textContent = board.name + " -- Ops Dashboard";

  const boardCfg = WFStage.getBoardConfig(board.id);
  if (!boardCfg) {
    content.innerHTML = '<p class="muted">This board is not mapped in config.js yet -- add it to WF_CONFIG.boards to enable the dashboard.</p>';
    return;
  }

  const cards = await WFRest.getBoardCardsFull(t, board.id);

  // Bucket cards by stage, skipping excluded/unmapped lists.
  const byStageOrder = new Map(); // order -> { name, cards: [] }
  const flagged = []; // { card, stage, daysIn, severity }
  const handoffPending = [];
  const exceptions = [];
  let econCount = 0, sumValue = 0, sumCost = 0;
  const econRows = [];
  let pendingApprovalCount = 0;
  const recentCompletions = []; // flattened phaseLog entries across all cards
  const slaCounts = { green: 0, amber: 0, red: 0, none: 0 };

  cards.forEach((card) => {
    if (WFStage.isExcluded(board.id, card.idList)) return;
    const stage = boardCfg.stages.find((s) => s.listId === card.idList);
    if (!stage) return; // list not mapped (e.g. board changed since config was written)

    const key = stage.order + ":" + stage.name;
    if (!byStageOrder.has(key)) byStageOrder.set(key, { order: stage.order, name: stage.name, cards: [] });
    byStageOrder.get(key).cards.push(card);

    const daysIn = WFStage.daysSince(card.dateLastActivity);
    const color = WFStage.colorForElapsed(stage, daysIn);
    slaCounts[color || "none"] = (slaCounts[color || "none"] || 0) + 1;
    if (color === "amber" || color === "red") {
      flagged.push({ card, stage, daysIn, color });
    }
    if (stage.isHandoff) handoffPending.push({ card, daysIn });
    if (stage.isException) exceptions.push({ card, daysIn });

    if (card.economics && card.economics.value) {
      econCount++;
      sumValue += Number(card.economics.value) || 0;
      sumCost += Number(card.economics.cost) || 0;
      econRows.push(card);
    }

    if (card.phaseWork && card.phaseWork.pendingApproval) pendingApprovalCount++;
    (card.phaseLog || []).forEach((entry) => {
      recentCompletions.push(Object.assign({ cardName: card.name }, entry));
    });
  });

  const avgByStage = new Map(); // stage name -> { total, count }
  cards.forEach((card) => (card.phaseLog || []).forEach((entry) => {
    const bucket = avgByStage.get(entry.listName) || { total: 0, count: 0 };
    bucket.total += entry.durationMinutes || 0;
    bucket.count += 1;
    avgByStage.set(entry.listName, bucket);
  }));

  const stageRows = Array.from(byStageOrder.values())
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const bucket = avgByStage.get(s.name);
      const avgText = bucket && bucket.count ? Math.round(bucket.total / bucket.count) + "m (" + bucket.count + " completed)" : "-";
      return "<tr><td>" + s.name + "</td><td>" + s.cards.length + "</td><td>" + avgText + "</td></tr>";
    })
    .join("");

  flagged.sort((a, b) => b.daysIn - a.daysIn);
  const flaggedRows = flagged.slice(0, 10).map((f) =>
    "<tr><td>" + f.card.name + "</td><td>" + f.stage.name + "</td><td><span class=\"pill " + f.color + "\">" +
    WFStage.formatDuration(f.daysIn) + "</span></td></tr>"
  ).join("") || '<tr><td colspan="3" class="muted">Nothing over SLA right now.</td></tr>';

  const handoffRows = handoffPending.map((h) =>
    "<tr><td>" + h.card.name + "</td><td>" + WFStage.formatDuration(h.daysIn) + " waiting</td></tr>"
  ).join("") || '<tr><td colspan="2" class="muted">No cards waiting on handoff.</td></tr>';

  const exceptionRows = exceptions.map((e) =>
    "<tr><td>" + e.card.name + "</td><td>" + WFStage.formatDuration(e.daysIn) + " in rework</td></tr>"
  ).join("") || '<tr><td colspan="2" class="muted">No rework in progress.</td></tr>';

  const margin = sumValue - sumCost;
  const marginPct = sumValue ? Math.round((margin / sumValue) * 1000) / 10 : null;

  econRows.sort((a, b) => {
    const ma = (a.economics.value || 0) - (a.economics.cost || 0);
    const mb = (b.economics.value || 0) - (b.economics.cost || 0);
    return ma - mb; // worst margin first, easiest to spot underwater jobs
  });
  const econTableRows = econRows.slice(0, 8).map((c) => {
    const m = (c.economics.value || 0) - (c.economics.cost || 0);
    const pct = c.economics.value ? Math.round((m / c.economics.value) * 1000) / 10 : null;
    const cls = pct !== null && pct < 15 ? "red" : pct !== null && pct < 30 ? "amber" : "green";
    return "<tr><td>" + c.name + "</td><td>" + fmtMoney(c.economics.value) + "</td><td>" + fmtMoney(c.economics.cost) +
      "</td><td><span class=\"pill " + cls + "\">" + fmtMoney(m) + (pct !== null ? " (" + pct + "%)" : "") + "</span></td></tr>";
  }).join("") || '<tr><td colspan="4" class="muted">No job economics entered yet on this board.</td></tr>';

  recentCompletions.sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt));
  const completionRows = recentCompletions.slice(0, 10).map((e) =>
    "<tr><td>" + e.cardName + "</td><td>" + e.listName + "</td><td>" + e.claimedBy.fullName + "</td><td>" +
    e.durationMinutes + "m</td><td>" + (e.approvedBy ? e.approvedBy.fullName : "-") + "</td></tr>"
  ).join("") || '<tr><td colspan="5" class="muted">No approved phase completions logged yet.</td></tr>';

  content.innerHTML =
    (pendingApprovalCount
      ? '<div class="section"><span class="pill amber">' + pendingApprovalCount +
        " job(s) awaiting manager approval</span> -- use the \"Manager Approvals\" board button to review.</div>"
      : "") +

    '<div class="section"><h3>Pipeline occupancy</h3><table><thead><tr><th>Stage</th><th>Cards</th><th>Avg completed time</th></tr></thead><tbody>' +
    stageRows + "</tbody></table></div>" +

    '<div class="section"><h3>Recent phase completions</h3><table><thead><tr><th>Job</th><th>Phase</th><th>By</th><th>Time</th><th>Approved by</th></tr></thead><tbody>' +
    completionRows + "</tbody></table></div>" +

    '<div class="section"><h3>Needs attention (over SLA)</h3><table><thead><tr><th>Card</th><th>Stage</th><th>Time in stage</th></tr></thead><tbody>' +
    flaggedRows + "</tbody></table></div>" +

    '<div class="section"><h3>Handoffs pending</h3><table><thead><tr><th>Card</th><th>Waiting</th></tr></thead><tbody>' +
    handoffRows + "</tbody></table></div>" +

    '<div class="section"><h3>Rework in progress</h3><table><thead><tr><th>Card</th><th>Time</th></tr></thead><tbody>' +
    exceptionRows + "</tbody></table></div>" +

    '<div class="section"><h3>Profitability (' + econCount + ' job(s) with economics entered)</h3>' +
    "<p><strong>Total value:</strong> " + fmtMoney(sumValue) + " &nbsp; <strong>Total cost:</strong> " + fmtMoney(sumCost) +
    " &nbsp; <strong>Blended margin:</strong> " + fmtMoney(margin) + (marginPct !== null ? " (" + marginPct + "%)" : "") + "</p>" +
    "<table><thead><tr><th>Card</th><th>Value</th><th>Cost</th><th>Margin</th></tr></thead><tbody>" +
    econTableRows + "</tbody></table>" +
    '<p class="muted">Sorted worst-margin-first so underwater jobs surface immediately.</p></div>' +

    "<p class=\"muted\">Time in stage here uses each card&rsquo;s last-activity timestamp as a fast approximation across the whole board. Open a card and check Stage Timeline for the exact, move-by-move history.</p>";

  renderCharts({
    stageLabels: Array.from(byStageOrder.values()).sort((a, b) => a.order - b.order).map((s) => s.name),
    stageCounts: Array.from(byStageOrder.values()).sort((a, b) => a.order - b.order).map((s) => s.cards.length),
    sla: slaCounts,
    econLabels: econRows.slice(0, 8).map((c) => c.name),
    econValues: econRows.slice(0, 8).map((c) => c.economics.value || 0),
    econCosts: econRows.slice(0, 8).map((c) => c.economics.cost || 0)
  });
}

let charts = [];
function renderCharts(data) {
  charts.forEach((c) => c.destroy());
  charts = [];

  const wrap = document.createElement("div");
  wrap.className = "section";
  wrap.innerHTML =
    '<h3>Visual Summary</h3>' +
    '<div class="chart-row">' +
    '<div class="chart-box"><canvas id="stageChart"></canvas></div>' +
    '<div class="chart-box"><canvas id="slaChart"></canvas></div>' +
    "</div>" +
    '<div class="chart-box wide" style="margin-top:20px;"><canvas id="econChart"></canvas></div>';
  content.appendChild(wrap);

  if (typeof Chart === "undefined") return; // CDN blocked/unreachable -- tables above still work fine

  charts.push(new Chart(document.getElementById("stageChart"), {
    type: "bar",
    data: {
      labels: data.stageLabels,
      datasets: [{ label: "Cards in stage", data: data.stageCounts, backgroundColor: "#0079bf" }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, title: { display: true, text: "Pipeline occupancy" } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  }));

  charts.push(new Chart(document.getElementById("slaChart"), {
    type: "doughnut",
    data: {
      labels: ["On track", "Amber (watch)", "Red (over SLA)", "Not configured"],
      datasets: [{
        data: [data.sla.green || 0, data.sla.amber || 0, data.sla.red || 0, data.sla.none || 0],
        backgroundColor: ["#4bce97", "#f5cd47", "#e2483d", "#dfe1e6"]
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { title: { display: true, text: "Time-in-stage health" } }
    }
  }));

  charts.push(new Chart(document.getElementById("econChart"), {
    type: "bar",
    data: {
      labels: data.econLabels,
      datasets: [
        { label: "Value", data: data.econValues, backgroundColor: "#0079bf" },
        { label: "Cost", data: data.econCosts, backgroundColor: "#e2483d" }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { title: { display: true, text: "Job value vs. cost (worst margin first)" } },
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => "$" + v.toLocaleString() } } }
    }
  }));
}

render();

  btn.className = "primary";
  btn.textContent = "Enable dashboard";
  btn.onclick = async () => {
    await WFRest.authorize(t);
    render();
  };
  content.appendChild(p);
  content.appendChild(btn);
}

function stageLabel(boardCfg, listId) {
  const stage = boardCfg.stages.find((s) => s.listId === listId);
  return stage ? stage.name : null;
}

async function render() {
  const authorized = await WFRest.isAuthorized(t).catch(() => false);
  if (!authorized) return renderAuthPrompt();

  content.innerHTML = '<div class="loading">Crunching board data...</div>';

  const board = await t.board("id", "name");
  document.getElementById("title").textContent = board.name + " -- Ops Dashboard";

  const boardCfg = WFStage.getBoardConfig(board.id);
  if (!boardCfg) {
    content.innerHTML = '<p class="muted">This board is not mapped in config.js yet -- add it to WF_CONFIG.boards to enable the dashboard.</p>';
    return;
  }

  const cards = await WFRest.getBoardCardsFull(t, board.id);

  // Bucket cards by stage, skipping excluded/unmapped lists.
  const byStageOrder = new Map(); // order -> { name, cards: [] }
  const flagged = []; // { card, stage, daysIn, severity }
  const handoffPending = [];
  const exceptions = [];
  let econCount = 0, sumValue = 0, sumCost = 0;
  const econRows = [];
  let pendingApprovalCount = 0;
  const recentCompletions = []; // flattened phaseLog entries across all cards

  cards.forEach((card) => {
    if (WFStage.isExcluded(board.id, card.idList)) return;
    const stage = boardCfg.stages.find((s) => s.listId === card.idList);
    if (!stage) return; // list not mapped (e.g. board changed since config was written)

    const key = stage.order + ":" + stage.name;
    if (!byStageOrder.has(key)) byStageOrder.set(key, { order: stage.order, name: stage.name, cards: [] });
    byStageOrder.get(key).cards.push(card);

    const daysIn = WFStage.daysSince(card.dateLastActivity);
    const color = WFStage.colorForElapsed(stage, daysIn);
    if (color === "amber" || color === "red") {
      flagged.push({ card, stage, daysIn, color });
    }
    if (stage.isHandoff) handoffPending.push({ card, daysIn });
    if (stage.isException) exceptions.push({ card, daysIn });

    if (card.economics && card.economics.value) {
      econCount++;
      sumValue += Number(card.economics.value) || 0;
      sumCost += Number(card.economics.cost) || 0;
      econRows.push(card);
    }

    if (card.phaseWork && card.phaseWork.pendingApproval) pendingApprovalCount++;
    (card.phaseLog || []).forEach((entry) => {
      recentCompletions.push(Object.assign({ cardName: card.name }, entry));
    });
  });

  const avgByStage = new Map(); // stage name -> { total, count }
  cards.forEach((card) => (card.phaseLog || []).forEach((entry) => {
    const bucket = avgByStage.get(entry.listName) || { total: 0, count: 0 };
    bucket.total += entry.durationMinutes || 0;
    bucket.count += 1;
    avgByStage.set(entry.listName, bucket);
  }));

  const stageRows = Array.from(byStageOrder.values())
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const bucket = avgByStage.get(s.name);
      const avgText = bucket && bucket.count ? Math.round(bucket.total / bucket.count) + "m (" + bucket.count + " completed)" : "-";
      return "<tr><td>" + s.name + "</td><td>" + s.cards.length + "</td><td>" + avgText + "</td></tr>";
    })
    .join("");

  flagged.sort((a, b) => b.daysIn - a.daysIn);
  const flaggedRows = flagged.slice(0, 10).map((f) =>
    "<tr><td>" + f.card.name + "</td><td>" + f.stage.name + "</td><td><span class=\"pill " + f.color + "\">" +
    WFStage.formatDuration(f.daysIn) + "</span></td></tr>"
  ).join("") || '<tr><td colspan="3" class="muted">Nothing over SLA right now.</td></tr>';

  const handoffRows = handoffPending.map((h) =>
    "<tr><td>" + h.card.name + "</td><td>" + WFStage.formatDuration(h.daysIn) + " waiting</td></tr>"
  ).join("") || '<tr><td colspan="2" class="muted">No cards waiting on handoff.</td></tr>';

  const exceptionRows = exceptions.map((e) =>
    "<tr><td>" + e.card.name + "</td><td>" + WFStage.formatDuration(e.daysIn) + " in rework</td></tr>"
  ).join("") || '<tr><td colspan="2" class="muted">No rework in progress.</td></tr>';

  const margin = sumValue - sumCost;
  const marginPct = sumValue ? Math.round((margin / sumValue) * 1000) / 10 : null;

  econRows.sort((a, b) => {
    const ma = (a.economics.value || 0) - (a.economics.cost || 0);
    const mb = (b.economics.value || 0) - (b.economics.cost || 0);
    return ma - mb; // worst margin first, easiest to spot underwater jobs
  });
  const econTableRows = econRows.slice(0, 8).map((c) => {
    const m = (c.economics.value || 0) - (c.economics.cost || 0);
    const pct = c.economics.value ? Math.round((m / c.economics.value) * 1000) / 10 : null;
    const cls = pct !== null && pct < 15 ? "red" : pct !== null && pct < 30 ? "amber" : "green";
    return "<tr><td>" + c.name + "</td><td>" + fmtMoney(c.economics.value) + "</td><td>" + fmtMoney(c.economics.cost) +
      "</td><td><span class=\"pill " + cls + "\">" + fmtMoney(m) + (pct !== null ? " (" + pct + "%)" : "") + "</span></td></tr>";
  }).join("") || '<tr><td colspan="4" class="muted">No job economics entered yet on this board.</td></tr>';

  recentCompletions.sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt));
  const completionRows = recentCompletions.slice(0, 10).map((e) =>
    "<tr><td>" + e.cardName + "</td><td>" + e.listName + "</td><td>" + e.claimedBy.fullName + "</td><td>" +
    e.durationMinutes + "m</td><td>" + (e.approvedBy ? e.approvedBy.fullName : "-") + "</td></tr>"
  ).join("") || '<tr><td colspan="5" class="muted">No approved phase completions logged yet.</td></tr>';

  content.innerHTML =
    (pendingApprovalCount
      ? '<div class="section"><span class="pill amber">' + pendingApprovalCount +
        " job(s) awaiting manager approval</span> -- use the \"Manager Approvals\" board button to review.</div>"
      : "") +

    '<div class="section"><h3>Pipeline occupancy</h3><table><thead><tr><th>Stage</th><th>Cards</th><th>Avg completed time</th></tr></thead><tbody>' +
    stageRows + "</tbody></table></div>" +

    '<div class="section"><h3>Recent phase completions</h3><table><thead><tr><th>Job</th><th>Phase</th><th>By</th><th>Time</th><th>Approved by</th></tr></thead><tbody>' +
    completionRows + "</tbody></table></div>" +

    '<div class="section"><h3>Needs attention (over SLA)</h3><table><thead><tr><th>Card</th><th>Stage</th><th>Time in stage</th></tr></thead><tbody>' +
    flaggedRows + "</tbody></table></div>" +

    '<div class="section"><h3>Handoffs pending</h3><table><thead><tr><th>Card</th><th>Waiting</th></tr></thead><tbody>' +
    handoffRows + "</tbody></table></div>" +

    '<div class="section"><h3>Rework in progress</h3><table><thead><tr><th>Card</th><th>Time</th></tr></thead><tbody>' +
    exceptionRows + "</tbody></table></div>" +

    '<div class="section"><h3>Profitability (' + econCount + ' job(s) with economics entered)</h3>' +
    "<p><strong>Total value:</strong> " + fmtMoney(sumValue) + " &nbsp; <strong>Total cost:</strong> " + fmtMoney(sumCost) +
    " &nbsp; <strong>Blended margin:</strong> " + fmtMoney(margin) + (marginPct !== null ? " (" + marginPct + "%)" : "") + "</p>" +
    "<table><thead><tr><th>Card</th><th>Value</th><th>Cost</th><th>Margin</th></tr></thead><tbody>" +
    econTableRows + "</tbody></table>" +
    '<p class="muted">Sorted worst-margin-first so underwater jobs surface immediately.</p></div>' +

    "<p class=\"muted\">Time in stage here uses each card&rsquo;s last-activity timestamp as a fast approximation across the whole board. Open a card and check Stage Timeline for the exact, move-by-move history.</p>";
}

render();
