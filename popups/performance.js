const t = TrelloPowerUp.iframe({ appKey: window.WF_CONFIG.appKey, appName: "Western Fabrication Ops" });
const content = document.getElementById("content");
const controls = document.getElementById("controls");

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function efficiencyPill(ratio) {
  if (ratio === null || ratio === undefined) return '<span class="pill gray">n/a</span>';
  const cls = ratio <= 0.85 ? "green" : ratio <= 1.15 ? "amber" : "red";
  return '<span class="pill ' + cls + '">' + ratio + "x SLA</span>";
}

function marginPill(pct) {
  if (pct === null || pct === undefined) return '<span class="pill gray">-</span>';
  const cls = pct < 15 ? "red" : pct < 30 ? "amber" : "green";
  return '<span class="pill ' + cls + '">' + pct + "%</span>";
}

let allCards = [];
let boardId = null;
let boardCfg = null;
let liveRates = {};
let ratesSyncedAt = null;

function sinceDateFor(rangeValue) {
  if (rangeValue === "all") return null;
  const days = rangeValue === "90" ? 90 : 30;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function renderTables() {
  const range = document.getElementById("rangePick").value;
  const sinceDate = sinceDateFor(range);

  const projects = WFMetrics.buildProjectRollup(allCards, boardCfg);
  const withEcon = projects.filter((p) => p.value != null);
  const byType = WFMetrics.groupProjectsByType(projects).sort((a, b) => (b.marginPct || 0) - (a.marginPct || 0));
  const people = WFMetrics.buildPersonRollup(allCards, boardId, sinceDate, liveRates);

  const projectRows = withEcon
    .slice()
    .sort((a, b) => (a.marginPct || 0) - (b.marginPct || 0))
    .map((p) =>
      "<tr><td>" + p.name + "</td><td>" + p.type + "</td><td>" + p.status + "</td><td>" +
      fmtMoney(p.value) + "</td><td>" + fmtMoney(p.cost) + "</td><td>" + marginPill(p.marginPct) +
      "</td><td>" + Math.round(p.totalMinutes / 60 * 10) / 10 + "h</td><td>" +
      (p.productionDays != null ? Math.round(p.productionDays * 10) / 10 + "d" : "-") + "</td></tr>"
    ).join("") || '<tr><td colspan="8" class="muted">No jobs with value/cost entered yet.</td></tr>';

  const typeRows = byType.map((b) =>
    "<tr><td>" + b.type + "</td><td>" + b.count + "</td><td>" + fmtMoney(b.sumValue) + "</td><td>" +
    fmtMoney(b.sumCost) + "</td><td>" + marginPill(b.marginPct) + "</td></tr>"
  ).join("") || '<tr><td colspan="5" class="muted">No data yet.</td></tr>';

  const personRows = people.map((p) =>
    "<tr><td>" + p.fullName + "</td><td>" + p.projectCount + "</td><td>" + p.phasesCompleted + "</td><td>" +
    p.hours + "h</td><td>" + efficiencyPill(p.avgEfficiency) + "</td><td>" + fmtMoney(p.attributedMargin) +
    "</td><td>" + (p.laborCost != null ? fmtMoney(p.laborCost) : "-") + "</td><td>" +
    (p.netContribution != null ? fmtMoney(p.netContribution) : "-") + "</td></tr>"
  ).join("") || '<tr><td colspan="8" class="muted">No approved phase work logged yet' +
    (sinceDate ? " in this range." : ".") + "</td></tr>";

  content.innerHTML =
    '<div class="section"><h3>By project (worst margin first)</h3>' +
    "<table><thead><tr><th>Job</th><th>Type</th><th>Status</th><th>Value</th><th>Cost</th><th>Margin</th><th>Hours logged</th><th>Production time</th></tr></thead><tbody>" +
    projectRows + "</tbody></table></div>" +

    '<div class="section"><h3>By type of work</h3>' +
    "<table><thead><tr><th>Type</th><th>Jobs</th><th>Total value</th><th>Total cost</th><th>Margin</th></tr></thead><tbody>" +
    typeRows + "</tbody></table>" +
    '<p class="muted">Sorted best-margin-first -- this is what tells you which kind of work to chase more of.</p></div>' +

    '<div class="section"><h3>By person' + (sinceDate ? " (last " + range + " days)" : " (all-time)") + "</h3>" +
    '<p class="muted">Rates: ' + (Object.keys(liveRates).length
      ? Object.keys(liveRates).length + " synced from QuickBooks (last synced: " + (ratesSyncedAt && ratesSyncedAt !== "never" ? ratesSyncedAt : "unknown") + ")"
      : "none synced yet -- using config.js fallback values, if any") + "</p>" +
    "<table><thead><tr><th>Person</th><th>Jobs</th><th>Phases</th><th>Hours</th><th>Avg speed vs SLA</th><th>Revenue share</th><th>Labor cost</th><th>Net contribution</th></tr></thead><tbody>" +
    personRows + "</tbody></table>" +
    '<p class="muted">"Revenue share" = each project\\u2019s margin split by their share of logged hours on it -- an estimate, not exact accounting. ' +
    "Labor cost/net contribution only show up if you've filled in <code>hourlyRates</code> in config.js for that username. " +
    '"Avg speed vs SLA": under 1.0x means faster than the configured SLA on average (green), over 1.15x flags consistently slow (red).</p></div>';
}

async function render() {
  const authorized = await WFRest.isAuthorized(t).catch(() => false);
  if (!authorized) {
    content.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = "This needs one-time read access to this board's cards (including closed/archived jobs).";
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Enable";
    btn.onclick = async () => { await WFRest.authorize(t); render(); };
    content.appendChild(p);
    content.appendChild(btn);
    return;
  }

  const [board, member] = await Promise.all([t.board("id"), t.member("username", "fullName")]);
  boardId = board.id;

  if (!WFStage.isManager(member.username)) {
    controls.innerHTML = "";
    content.innerHTML = '<p class="muted">' + member.fullName +
      " isn't listed in config.js <code>managers</code> -- Team Performance is limited to admins/managers.</p>";
    return;
  }

  boardCfg = WFStage.getBoardConfig(boardId);
  content.innerHTML = '<div class="loading">Loading full job history (including archived)...</div>';
  const [cards, ratesDesc] = await Promise.all([
    WFRest.getBoardCardsFull(t, boardId, { filter: "all" }),
    WFRest.getLiveRatesCardDesc(t)
  ]);
  allCards = cards;
  liveRates = ratesDesc ? WFMetrics.parseRatesCardDesc(ratesDesc) : {};
  const syncedMatch = ratesDesc && ratesDesc.match(/Last synced:\s*(.+)/);
  ratesSyncedAt = syncedMatch ? syncedMatch[1].trim() : null;

  controls.innerHTML =
    '<label>Person view range</label><select id="rangePick">' +
    '<option value="all">All-time</option>' +
    '<option value="90">Last 90 days</option>' +
    '<option value="30">Last 30 days</option>' +
    "</select>";
  document.getElementById("rangePick").addEventListener("change", renderTables);

  renderTables();
}

render();
