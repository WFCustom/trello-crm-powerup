const t = TrelloPowerUp.iframe({ appKey: window.WF_CONFIG.appKey, appName: "Western Fabrication Ops" });
const content = document.getElementById("content");

function openCard(card) {
  try {
    const maybePromise = t.showCard(card.id);
    if (maybePromise && maybePromise.catch) maybePromise.catch(() => window.open(card.shortUrl, "_blank"));
  } catch (e) {
    window.open(card.shortUrl, "_blank");
  }
}

async function render() {const t = TrelloPowerUp.iframe({ appKey: window.WF_CONFIG.appKey, appName: "Western Fabrication Ops" });
const content = document.getElementById("content");

function openCard(card) {
  try {
    const maybePromise = t.showCard(card.id);
    if (maybePromise && maybePromise.catch) maybePromise.catch(() => window.open(card.shortUrl, "_blank"));
  } catch (e) {
    window.open(card.shortUrl, "_blank");
  }
}

let currentBoardId = null;

async function render() {
  const authorized = await WFRest.isAuthorized(t).catch(() => false);
  if (!authorized) {
    content.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = "This needs one-time read/write access to review approvals.";
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Enable";
    btn.onclick = async () => { await WFRest.authorize(t); render(); };
    content.appendChild(p);
    content.appendChild(btn);
    return;
  }

  const [board, member] = await Promise.all([t.board("id"), t.member("username", "fullName")]);

  if (!WFStage.isManager(member.username)) {
    content.innerHTML = '<p class="muted">' + member.fullName +
      " isn't listed in config.js <code>managers</code> -- this view is for the people who approve completed phases. " +
      "Ask whoever maintains the Power-Up config to add your Trello username if that's wrong.</p>";
    return;
  }

  content.innerHTML = '<div class="loading">Checking for pending approvals...</div>';

  currentBoardId = board.id;
  const boardCfg = WFStage.getBoardConfig(board.id);
  const cards = await WFRest.getBoardCardsFull(t, board.id);

  const withStage = cards.map((c) => ({
    card: c,
    stage: boardCfg ? boardCfg.stages.find((s) => s.listId === c.idList) : null
  }));

  const pending = withStage.filter((x) => x.card.phaseWork && x.card.phaseWork.pendingApproval);
  const unclaimed = withStage.filter((x) => x.stage && x.stage.isWorkPhase &&
    (!x.card.phaseWork || !x.card.phaseWork.claimedBy));

  function buildTable(rows, columns, rowFn) {
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr>" + columns.map((c) => "<th>" + c + "</th>").join("") + "</tr></thead><tbody></tbody>";
    const body = table.querySelector("tbody");
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="' + columns.length + '" class="muted">Nothing here right now.</td></tr>';
    } else {
      rows.forEach((x) => body.appendChild(rowFn(x)));
    }
    return table;
  }

  const pendingTable = buildTable(pending, ["Job", "Phase", "Completed by", "Time", ""], (x) => {
    const work = x.card.phaseWork;
    const cardMeta = { id: x.card.id, idList: x.card.idList, idBoard: board.id };
    const row = document.createElement("tr");
    row.innerHTML =
      "<td>" + x.card.name + "</td>" +
      "<td>" + (x.stage ? x.stage.name : "?") + "</td>" +
      "<td>" + work.claimedBy.fullName + "</td>" +
      "<td>" + WFStage.formatDuration(WFPhase.totalMinutes(work) / 1440) + "</td>" +
      "<td></td>";
    const cell = row.lastElementChild;

    const approveBtn = document.createElement("button");
    approveBtn.className = "primary";
    approveBtn.style.cssText = "margin:0 4px 0 0;padding:4px 10px;";
    approveBtn.textContent = "Approve & Advance";
    approveBtn.onclick = async () => {
      approveBtn.disabled = true;
      approveBtn.textContent = "Working…";
      try {
        await WFPhase.approveAndAdvance(t, cardMeta, member);
        WFRest.invalidateBoardCards(currentBoardId);
        render();
      } catch (e) {
        window.alert((e && e.message) ? e.message : "Couldn't approve this card.");
        approveBtn.disabled = false;
        approveBtn.textContent = "Approve & Advance";
      }
    };

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "secondary";
    rejectBtn.style.cssText = "margin:0 4px 0 0;padding:4px 10px;background:#fff;border:1px solid #dfe1e6;border-radius:3px;cursor:pointer;";
    rejectBtn.textContent = "Send back";
    rejectBtn.onclick = async () => {
      const reason = window.prompt("Reason for sending this back? (optional)") || "";
      rejectBtn.disabled = true;
      try {
        await WFPhase.reject(t, cardMeta, member, reason);
        WFRest.invalidateBoardCards(currentBoardId);
        render();
      } catch (e) {
        window.alert((e && e.message) ? e.message : "Couldn't send this card back.");
        rejectBtn.disabled = false;
      }
    };

    const reviewBtn = document.createElement("button");
    reviewBtn.className = "secondary";
    reviewBtn.style.cssText = "margin:0;padding:4px 10px;background:#fff;border:1px solid #dfe1e6;border-radius:3px;cursor:pointer;";
    reviewBtn.textContent = "Open card";
    reviewBtn.onclick = () => openCard(x.card);

    cell.appendChild(approveBtn);
    cell.appendChild(rejectBtn);
    cell.appendChild(reviewBtn);
    return row;
  });

  const unclaimedTable = buildTable(unclaimed, ["Job", "Phase", ""], (x) => {
    const row = document.createElement("tr");
    row.innerHTML =
      "<td>" + x.card.name + "</td>" +
      "<td>" + x.stage.name + "</td>" +
      '<td><button class="primary" style="margin:0;padding:4px 10px;">Open to assign</button></td>';
    row.querySelector("button").addEventListener("click", () => openCard(x.card));
    return row;
  });

  content.innerHTML = "";
  content.appendChild(Object.assign(document.createElement("h3"), { textContent: "Awaiting approval" }));
  content.appendChild(pendingTable);
  content.appendChild(Object.assign(document.createElement("p"), {
    className: "muted",
    textContent: "Approve moves the card to its next configured stage. Send back reopens the timer with your reason logged as a comment."
  }));
  content.appendChild(Object.assign(document.createElement("h3"), { textContent: "Unclaimed jobs (assignable)" }));
  content.appendChild(unclaimedTable);
  content.appendChild(Object.assign(document.createElement("p"), {
    className: "muted",
    textContent: 'Tap "Open to assign" and use the Assign... button on the card to hand it to a specific person.'
  }));
}

render();

  const authorized = await WFRest.isAuthorized(t).catch(() => false);
  if (!authorized) {
    content.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = "This needs one-time read/write access to review approvals.";
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Enable";
    btn.onclick = async () => { await WFRest.authorize(t); render(); };
    content.appendChild(p);
    content.appendChild(btn);
    return;
  }

  const [board, member] = await Promise.all([t.board("id"), t.member("username", "fullName")]);

  if (!WFStage.isManager(member.username)) {
    content.innerHTML = '<p class="muted">' + member.fullName +
      " isn't listed in config.js <code>managers</code> -- this view is for the people who approve completed phases. " +
      "Ask whoever maintains the Power-Up config to add your Trello username if that's wrong.</p>";
    return;
  }

  content.innerHTML = '<div class="loading">Checking for pending approvals...</div>';

  const boardCfg = WFStage.getBoardConfig(board.id);
  const cards = await WFRest.getBoardCardsFull(t, board.id);

  const withStage = cards.map((c) => ({
    card: c,
    stage: boardCfg ? boardCfg.stages.find((s) => s.listId === c.idList) : null
  }));

  const pending = withStage.filter((x) => x.card.phaseWork && x.card.phaseWork.pendingApproval);
  const unclaimed = withStage.filter((x) => x.stage && x.stage.isWorkPhase &&
    (!x.card.phaseWork || !x.card.phaseWork.claimedBy));

  function buildTable(rows, columns, rowFn) {
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr>" + columns.map((c) => "<th>" + c + "</th>").join("") + "</tr></thead><tbody></tbody>";
    const body = table.querySelector("tbody");
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="' + columns.length + '" class="muted">Nothing here right now.</td></tr>';
    } else {
      rows.forEach((x) => body.appendChild(rowFn(x)));
    }
    return table;
  }

  const pendingTable = buildTable(pending, ["Job", "Phase", "Completed by", "Time", ""], (x) => {
    const work = x.card.phaseWork;
    const row = document.createElement("tr");
    row.innerHTML =
      "<td>" + x.card.name + "</td>" +
      "<td>" + (x.stage ? x.stage.name : "?") + "</td>" +
      "<td>" + work.claimedBy.fullName + "</td>" +
      "<td>" + WFStage.formatDuration(WFPhase.totalMinutes(work) / 1440) + "</td>" +
      '<td><button class="primary" style="margin:0;padding:4px 10px;">Review</button></td>';
    row.querySelector("button").addEventListener("click", () => openCard(x.card));
    return row;
  });

  const unclaimedTable = buildTable(unclaimed, ["Job", "Phase", ""], (x) => {
    const row = document.createElement("tr");
    row.innerHTML =
      "<td>" + x.card.name + "</td>" +
      "<td>" + x.stage.name + "</td>" +
      '<td><button class="primary" style="margin:0;padding:4px 10px;">Open to assign</button></td>';
    row.querySelector("button").addEventListener("click", () => openCard(x.card));
    return row;
  });

  content.innerHTML = "";
  content.appendChild(Object.assign(document.createElement("h3"), { textContent: "Awaiting approval" }));
  content.appendChild(pendingTable);
  content.appendChild(Object.assign(document.createElement("p"), {
    className: "muted",
    textContent: 'Tap "Review" to open the card and use Approve & Advance (or Undo to send it back).'
  }));
  content.appendChild(Object.assign(document.createElement("h3"), { textContent: "Unclaimed jobs (assignable)" }));
  content.appendChild(unclaimedTable);
  content.appendChild(Object.assign(document.createElement("p"), {
    className: "muted",
    textContent: 'Tap "Open to assign" and use the Assign... button on the card to hand it to a specific person.'
  }));
}

render();
