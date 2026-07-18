const t = TrelloPowerUp.iframe({ appKey: window.WF_CONFIG.appKey, appName: "Western Fabrication Ops" });
const logDiv = document.getElementById("log");
const formDiv = document.getElementById("form");

const TEAMS = ["Sales", "Intake/Portal", "CAD/Drafting", "Fabrication", "Finishing", "Install", "Billing"];

function renderLog(entries) {
  if (!entries.length) {
    logDiv.innerHTML = '<p class="muted">No handoffs logged yet.</p>';
    return;
  }
  const rows = entries.slice().reverse().map((e) => {
    return "<tr><td>" + e.from + " -> " + e.to + "</td><td>" +
      new Date(e.at).toLocaleString() + "</td><td>" + (e.note || "") + "</td></tr>";
  }).join("");
  logDiv.innerHTML =
    "<table><thead><tr><th>Handoff</th><th>When</th><th>Note</th></tr></thead><tbody>" +
    rows + "</tbody></table>";
}

function optionsHtml(id) {
  return TEAMS.map((team) => '<option value="' + team + '">' + team + "</option>").join("");
}

async function render() {
  const entries = (await t.get("card", "shared", "handoffLog", [])) || [];
  renderLog(entries);

  formDiv.innerHTML =
    '<div class="row">' +
    '<div><label>From</label><select id="from">' + optionsHtml("from") + "</select></div>" +
    '<div><label>To</label><select id="to">' + optionsHtml("to") + "</select></div>" +
    "</div>" +
    "<label>Note (optional)</label>" +
    '<textarea id="note" placeholder="e.g. job packet complete, ready for CNC"></textarea>' +
    '<button class="primary" id="save">Log handoff</button>';

  document.getElementById("save").addEventListener("click", async () => {
    const member = await t.member("fullName");
    const entry = {
      from: document.getElementById("from").value,
      to: document.getElementById("to").value,
      note: document.getElementById("note").value,
      by: member.fullName,
      at: new Date().toISOString()
    };
    const current = (await t.get("card", "shared", "handoffLog", [])) || [];
    const updated = current.concat([entry]).slice(-20); // cap log length
    await t.set("card", "shared", "handoffLog", updated);
    renderLog(updated);
    document.getElementById("note").value = "";
  });
}

render();
