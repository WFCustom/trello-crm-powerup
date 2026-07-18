const t = TrelloPowerUp.iframe({ appKey: window.WF_CONFIG.appKey, appName: "Western Fabrication Ops" });
const content = document.getElementById("content");

function renderAuthPrompt() {
  content.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = "Timing history needs one-time read access to this board's card activity.";
  const btn = document.createElement("button");
  btn.className = "primary";
  btn.textContent = "Enable timing";
  btn.onclick = async () => {
    await WFRest.authorize(t);
    render();
  };
  content.appendChild(p);
  content.appendChild(btn);
}

async function render() {
  const authorized = await WFRest.isAuthorized(t).catch(() => false);
  if (!authorized) return renderAuthPrompt();

  content.innerHTML = '<div class="loading">Loading timing history...</div>';

  const card = await t.card("id", "idBoard", "idList");
  const history = await WFRest.getCardListHistory(t, card.id);

  if (!history.length) {
    content.innerHTML = '<p class="muted">No list-move history found for this card yet.</p>';
    return;
  }

  const rows = history.map((entry, i) => {
    const nextDate = i + 1 < history.length ? history[i + 1].date : null;
    const durationDays = nextDate
      ? (new Date(nextDate) - new Date(entry.date)) / (1000 * 60 * 60 * 24)
      : WFStage.daysSince(entry.date);
    const stage = WFStage.getStageForList(card.idBoard, entry.listId);
    const color = i + 1 < history.length
      ? null
      : WFStage.colorForElapsed(stage, durationDays);
    const pillClass = color || "gray";
    const pill = '<span class="pill ' + pillClass + '">' + WFStage.formatDuration(durationDays) + "</span>";
    const label = i + 1 === history.length ? " (current)" : "";
    return "<tr><td>" + entry.listName + label + "</td><td>" + new Date(entry.date).toLocaleDateString() + "</td><td>" + pill + "</td></tr>";
  }).join("");

  content.innerHTML =
    "<table><thead><tr><th>Stage</th><th>Entered</th><th>Duration</th></tr></thead><tbody>" +
    rows +
    "</tbody></table>" +
    '<p class="muted">Duration for past stages = time until the next move. Current stage duration is colored against its configured SLA.</p>';
}

render();
