const t = TrelloPowerUp.iframe({
  appKey: window.WF_CONFIG.appKey,
  appName: "Western Fabrication Ops"
});
const content = document.getElementById("content");

let STATE = null; // { boardId, member, roster, phases, jobs }
let FILTER = "";

function resize() {
  t.sizeTo(document.body).catch(() => {});
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function memberLabel(m) {
  if (!m) return "";
  return m.fullName || m.username || "";
}

function renderAuthPrompt() {
  content.innerHTML =
    '<div class="section">' +
    "<p>Connect your Trello account to view and manage work.</p>" +
    '<button class="primary" id="auth-btn">Connect Trello</button>' +
    "</div>";
  document.getElementById("auth-btn").addEventListener("click", () => {
    WFRest.authorize(t, "read,write").then(() => render()).catch(() => {});
  });
  resize();
}

function jobStatus(work) {
  if (!work) return { label: "Unclaimed", pill: "gray" };
  if (!work.segments || work.segments.length === 0) {
    return { label: "Assigned to " + memberLabel(work.claimedBy) + " — awaiting acceptance", pill: "amber" };
  }
  if (WFPhase.isRunning(work)) {
    return { label: "In progress — " + memberLabel(work.claimedBy), pill: "green" };
  }
  if (work.pendingApproval) {
    return { label: "Pending approval — " + memberLabel(work.claimedBy), pill: "amber" };
  }
  return { label: "Paused — " + memberLabel(work.claimedBy), pill: "gray" };
}

function actionButtons(job) {
  const work = job.work;
  const member = STATE.member;
  const isViewerManager = STATE.roster.managers.indexOf(member.username) !== -1;
  const isOwner = work && work.claimedBy && work.claimedBy.id === member.id;
  const buttons = [];

  if (!work) {
    buttons.push(mkButton("Claim & Start", "primary", "claim", job));
    if (isViewerManager) {
      buttons.push(mkAssignControl(job));
    }
    return buttons;
  }

  if ((!work.segments || work.segments.length === 0) && isOwner) {
    buttons.push(mkButton("Accept & Start", "primary", "accept", job));
    buttons.push(mkButton("Decline", "secondary", "decline", job));
    return buttons;
  }

  if (WFPhase.isRunning(work) && isOwner) {
    buttons.push(mkButton("Pause", "secondary", "pause", job));
    buttons.push(mkButton("Complete", "primary", "complete", job));
    return buttons;
  }

  if (work.pendingApproval && isViewerManager) {
    buttons.push(mkButton("Approve & Advance", "primary", "approve", job));
    buttons.push(mkButton("Send back", "secondary", "reject", job));
    return buttons;
  }

  if (work.pendingApproval && isOwner) {
    buttons.push(mkButton("Undo", "secondary", "undo", job));
    return buttons;
  }

  if (!WFPhase.isRunning(work) && !work.pendingApproval && isOwner) {
    buttons.push(mkButton("Resume", "primary", "resume", job));
    buttons.push(mkButton("Complete", "secondary", "complete", job));
    return buttons;
  }

  return buttons;
}

function mkButton(label, cls, action, job) {
  const btn = document.createElement("button");
  btn.className = cls;
  btn.textContent = label;
  btn.addEventListener("click", () => runAction(action, job, btn));
  return btn;
}

function mkAssignControl(job) {
  const wrap = document.createElement("span");
  wrap.style.display = "inline-flex";
  wrap.style.gap = "4px";

  const select = document.createElement("select");
  select.className = "inline-select";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Assign to…";
  select.appendChild(blank);

  const suggested = STATE.roster.phaseSpecialists[job.stageName] || [];
  const byUsername = {};
  STATE.boardMembers.forEach((m) => { byUsername[m.username] = m; });
  const ordered = suggested
    .map((u) => byUsername[u])
    .filter(Boolean)
    .concat(STATE.boardMembers.filter((m) => suggested.indexOf(m.username) === -1));

  ordered.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = memberLabel(m) + (suggested.indexOf(m.username) !== -1 ? " ★" : "");
    select.appendChild(opt);
  });

  const btn = document.createElement("button");
  btn.className = "secondary";
  btn.textContent = "Assign";
  btn.addEventListener("click", () => {
    const workerId = select.value;
    if (!workerId) return;
    const worker = STATE.boardMembers.find((m) => m.id === workerId);
    if (!worker) return;
    runAction("assign", job, btn, worker);
  });

  wrap.appendChild(select);
  wrap.appendChild(btn);
  return wrap;
}

async function runAction(action, job, btn, extra) {
  const cardMeta = { id: job.id, idList: job.idList, idBoard: STATE.boardId };
  const member = STATE.member;
  if (btn) btn.disabled = true;
  try {
    if (action === "claim") await WFPhase.claimAndStart(t, cardMeta, member);
    else if (action === "assign") await WFPhase.assign(t, cardMeta, member, extra);
    else if (action === "accept") await WFPhase.acceptAssignment(t, cardMeta);
    else if (action === "decline") await WFPhase.declineAssignment(t, cardMeta, member, "declined from Work Board");
    else if (action === "pause") await WFPhase.pause(t, cardMeta);
    else if (action === "resume") await WFPhase.resume(t, cardMeta);
    else if (action === "complete") await WFPhase.complete(t, cardMeta);
    else if (action === "undo") await WFPhase.undoComplete(t, cardMeta);
    else if (action === "approve") await WFPhase.approveAndAdvance(t, cardMeta, member);
    else if (action === "reject") await WFPhase.reject(t, cardMeta, member, "sent back from Work Board");
    await loadJobs();
    renderList();
  } catch (e) {
    if (btn) btn.disabled = false;
    alert("Action failed: " + (e && e.message ? e.message : e));
  }
}

async function loadJobs() {
  const boardConfig = WFStage.getBoardConfig(STATE.boardId);
  const phases = boardConfig ? boardConfig.stages.filter((s) => s.isWorkPhase) : [];
  const listIds = {};
  phases.forEach((p) => { listIds[p.listId] = p.name; });

  const cards = await WFRest.getBoardCardsFull(t, STATE.boardId, { filter: "open" });
  const workCards = cards.filter((c) => listIds[c.idList]);

  const workResults = await Promise.all(
    workCards.map((c) => WFPhase.getActivePhaseWork(t, { id: c.id, idList: c.idList }))
  );

  STATE.jobs = workCards.map((c, i) => ({
    id: c.id,
    name: c.name,
    idList: c.idList,
    url: c.shortUrl || c.url,
    stageName: listIds[c.idList],
    work: workResults[i]
  }));
  STATE.phases = phases;
}

function renderList() {
  const term = FILTER.trim().toLowerCase();
  const byStage = {};
  STATE.phases.forEach((p) => { byStage[p.name] = []; });
  STATE.jobs.forEach((j) => {
    if (term && j.name.toLowerCase().indexOf(term) === -1 && j.stageName.toLowerCase().indexOf(term) === -1) return;
    if (!byStage[j.stageName]) byStage[j.stageName] = [];
    byStage[j.stageName].push(j);
  });

  const listEl = document.getElementById("job-list");
  listEl.innerHTML = "";

  let any = false;
  STATE.phases.forEach((phase) => {
    const jobs = byStage[phase.name] || [];
    if (jobs.length === 0) return;
    any = true;
    const heading = document.createElement("div");
    heading.className = "stage-heading";
    heading.textContent = phase.name + " (" + jobs.length + ")";
    listEl.appendChild(heading);

    jobs.forEach((job) => {
      const status = jobStatus(job.work);
      const row = document.createElement("div");
      row.className = "job-row";

      const nameEl = document.createElement("div");
      nameEl.className = "job-name";
      const a = document.createElement("a");
      a.href = job.url || "#";
      a.target = "_top";
      a.textContent = job.name;
      nameEl.appendChild(a);

      const statusEl = document.createElement("div");
      statusEl.className = "job-status";
      statusEl.innerHTML = '<span class="pill ' + status.pill + '">' + escapeHtml(status.label) + "</span>";
      if (job.work) {
        const mins = WFPhase.totalMinutes(job.work);
        statusEl.innerHTML += ' <span class="hint">' + mins + " min logged</span>";
      }

      const actionsEl = document.createElement("div");
      actionsEl.className = "job-actions";
      actionButtons(job).forEach((el) => actionsEl.appendChild(el));

      row.appendChild(nameEl);
      row.appendChild(statusEl);
      row.appendChild(actionsEl);
      listEl.appendChild(row);
    });
  });

  if (!any) {
    listEl.innerHTML = '<div class="empty">No matching work-phase cards found.</div>';
  }
  resize();
}

async function render() {
  const authorized = await WFRest.isAuthorized(t).catch(() => false);
  if (!authorized) return renderAuthPrompt();

  content.innerHTML = '<div class="loading">Loading work…</div>';

  const [board, member, roster] = await Promise.all([
    t.board("id", "members"),
    t.member("id", "username", "fullName"),
    WFRoster.getRoster(t)
  ]);

  STATE = {
    boardId: board.id,
    boardMembers: board.members || [],
    member,
    roster,
    jobs: [],
    phases: []
  };

  await loadJobs();

  content.innerHTML =
    '<div class="toolbar"><input id="search" type="text" placeholder="Search by card name or stage…"></div>' +
    '<div id="job-list"></div>';

  document.getElementById("search").addEventListener("input", (e) => {
    FILTER = e.target.value;
    renderList();
  });

  renderList();
}

render().catch((e) => {
  content.innerHTML = '<div class="error">Failed to load: ' + escapeHtml(e && e.message ? e.message : e) + "</div>";
  resize();
});
