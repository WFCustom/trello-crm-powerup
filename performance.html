const t = TrelloPowerUp.iframe();
const content = document.getElementById("content");
const filterDiv = document.getElementById("phaseFilter");

function openCard(card) {
  try {
    const maybePromise = t.showCard(card.id);
    if (maybePromise && maybePromise.catch) maybePromise.catch(() => window.open(card.shortUrl, "_blank"));
  } catch (e) {
    window.open(card.shortUrl, "_blank");
  }
}

function statusLabel(card) {
  const work = card.phaseWork;
  if (!work) return { text: "Unclaimed", cls: "gray" };
  if (work.pendingApproval) return { text: "Awaiting approval", cls: "amber" };
  const running = work.segments && work.segments.length && !work.segments[work.segments.length - 1].end;
  return running
    ? { text: "In progress -- " + work.claimedBy.fullName, cls: "green" }
    : { text: "Paused -- " + work.claimedBy.fullName, cls: "gray" };
}

function renderCardRow(card, stageName) {
  const status = statusLabel(card);
  const row = document.createElement("tr");
  row.innerHTML =
    "<td>" + card.name + "</td>" +
    "<td>" + stageName + "</td>" +
    '<td><span class="pill ' + status.cls + '">' + status.text + "</span></td>" +
    '<td><button class="primary" style="margin:0;padding:4px 10px;">Open</button></td>';
  row.querySelector("button").addEventListener("click", () => openCard(card));
  return row;
}

async function render() {
  const authorized = await WFRest.isAuthorized(t).catch(() => false);
  if (!authorized) {
    content.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = "This needs one-time read/write access to claim and update jobs.";
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Enable";
    btn.onclick = async () => { await WFRest.authorize(t); render(); };
    content.appendChild(p);
    content.appendChild(btn);
    return;
  }

  content.innerHTML = '<div class="loading">Loading jobs...</div>';

  const [board, member] = await Promise.all([t.board("id"), t.member("id", "username", "fullName")]);
  const boardCfg = WFStage.getBoardConfig(board.id);
  if (!boardCfg) {
    content.innerHTML = '<p class="muted">This board is not mapped in config.js.</p>';
    return;
  }

  const workPhases = boardCfg.stages.filter((s) => s.isWorkPhase);
  const phaseNames = [...new Set(workPhases.map((s) => s.name))];

  const specialistPhases = Object.keys((window.WF_CONFIG.phaseSpecialists || {})).filter((phaseName) =>
    (window.WF_CONFIG.phaseSpecialists[phaseName] || []).includes(member.username)
  );

  filterDiv.innerHTML =
    '<label>Show phase</label><select id="phasePick">' +
    '<option value="__mine__">My phase(s) (' + (specialistPhases.length || phaseNames.length) + ")</option>" +
    '<option value="__all__">All work phases</option>' +
    phaseNames.map((n) => '<option value="' + n + '">' + n + "</option>").join("") +
    "</select>";

  const cards = await WFRest.getBoardCardsFull(t, board.id);

  function applyFilterAndRender() {
    const picked = document.getElementById("phasePick").value;
    let allowedNames;
    if (picked === "__mine__") allowedNames = specialistPhases.length ? specialistPhases : phaseNames;
    else if (picked === "__all__") allowedNames = phaseNames;
    else allowedNames = [picked];

    const relevant = cards
      .map((c) => ({ card: c, stage: boardCfg.stages.find((s) => s.listId === c.idList) }))
      .filter((x) => x.stage && x.stage.isWorkPhase && allowedNames.includes(x.stage.name));

    const mine = relevant.filter((x) => x.card.phaseWork && x.card.phaseWork.claimedBy &&
      x.card.phaseWork.claimedBy.username === member.username);
    const unclaimed = relevant.filter((x) => !x.card.phaseWork || !x.card.phaseWork.claimedBy);

    const mineTable = document.createElement("table");
    mineTable.innerHTML = "<thead><tr><th>Job</th><th>Phase</th><th>Status</th><th></th></tr></thead><tbody></tbody>";
    const mineBody = mineTable.querySelector("tbody");
    if (!mine.length) mineBody.innerHTML = '<tr><td colspan="4" class="muted">Nothing active -- claim a job below.</td></tr>';
    mine.forEach((x) => mineBody.appendChild(renderCardRow(x.card, x.stage.name)));

    const availTable = document.createElement("table");
    availTable.innerHTML = "<thead><tr><th>Job</th><th>Phase</th><th>Status</th><th></th></tr></thead><tbody></tbody>";
    const availBody = availTable.querySelector("tbody");
    if (!unclaimed.length) availBody.innerHTML = '<tr><td colspan="4" class="muted">Nothing waiting to be claimed.</td></tr>';
    unclaimed.forEach((x) => availBody.appendChild(renderCardRow(x.card, x.stage.name)));

    content.innerHTML = "";
    const h1 = document.createElement("h3"); h1.textContent = "My active jobs";
    const h2 = document.createElement("h3"); h2.textContent = "Available to claim";
    content.appendChild(h1);
    content.appendChild(mineTable);
    content.appendChild(h2);
    content.appendChild(availTable);
    content.appendChild(Object.assign(document.createElement("p"), {
      className: "muted",
      textContent: 'Tap "Open" to claim/start/pause/complete on the card itself.'
    }));
  }

  document.getElementById("phasePick").addEventListener("change", applyFilterAndRender);
  applyFilterAndRender();
}

render();
