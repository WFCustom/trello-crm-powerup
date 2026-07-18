/**
 * My Jobs -- fullscreen personal dashboard (opened via t.modal({fullscreen:true})
 * from the board-buttons "My Jobs" entry in connector.js).
 *
 * Lists the signed-in member's active/assigned jobs and everything available
 * to claim, with working Accept/Decline/Claim/Start/Pause/Complete buttons,
 * a start-stop time log, total hours, and a 0-100% progress slider -- all
 * actionable right here without opening each card individually. Also surfaces
 * each job's custom fields (style/spec) and attached CAD drawing PDFs so a
 * worker can reference the build spec while a job is in progress.
 *
 * Every action here calls lib/phase.js functions with an explicit card ID
 * (t.set(cardId,...) under the hood), which per Trello's docs works from any
 * context -- that's what lets this board-level modal claim/start/pause/
 * complete ANY card without that card's own iframe being open.
 */
const t = TrelloPowerUp.iframe({ appKey: window.WF_CONFIG.appKey, appName: "Western Fabrication Ops" });
const content = document.getElementById("content");
const filterDiv = document.getElementById("phaseFilter");

let tickTimer = null;
let currentBoardId = null;

function openCard(card) {
  try {
    const maybePromise = t.showCard(card.id);
    if (maybePromise && maybePromise.catch) maybePromise.catch(() => window.open(card.shortUrl, "_blank"));
  } catch (e) {
    window.open(card.shortUrl, "_blank");
  }
}

function formatMinutes(min) {
  if (min < 60) return min + "m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h + "h " + (m ? m + "m" : "");
}

function formatClock(iso) {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function segmentLog(work) {
  if (!work || !work.segments || !work.segments.length) return null;
  const ul = document.createElement("ul");
  ul.className = "segment-log";
  work.segments.forEach((seg) => {
    const li = document.createElement("li");
    const start = formatClock(seg.start);
    const end = seg.end ? formatClock(seg.end) : "running…";
    const mins = Math.round(((seg.end ? new Date(seg.end) : new Date()) - new Date(seg.start)) / 60000);
    li.textContent = start + " → " + end + " (" + formatMinutes(mins) + ")";
    ul.appendChild(li);
  });
  return ul;
}

function button(label, cls, onClick) {
  const b = document.createElement("button");
  b.className = cls || "secondary";
  b.type = "button";
  b.textContent = label;
  b.onclick = async (ev) => {
    ev.stopPropagation();
    b.disabled = true;
    const original = b.textContent;
    b.textContent = "Working…";
    try {
      await onClick();
      if (currentBoardId) WFRest.invalidateBoardCards(currentBoardId);
      await renderAll();
    } catch (e) {
      b.disabled = false;
      b.textContent = original;
      window.alert((e && e.message) ? e.message : "Something went wrong.");
    }
  };
  return b;
}

function percentSlider(cardMeta, work) {
  const row = document.createElement("div");
  row.className = "slider-row";
  const label = document.createElement("span");
  label.className = "muted";
  label.textContent = "Progress";
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "100";
  input.step = "5";
  input.value = String(WFPhase.percentComplete(work));
  const pct = document.createElement("span");
  pct.className = "pct";
  pct.textContent = input.value + "%";
  input.oninput = (ev) => { ev.stopPropagation(); pct.textContent = input.value + "%"; };
  input.onclick = (ev) => ev.stopPropagation();
  let debounce = null;
  input.onchange = (ev) => {
    ev.stopPropagation();
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      WFPhase.setPercentComplete(t, cardMeta, Number(input.value));
      if (currentBoardId) WFRest.invalidateBoardCards(currentBoardId);
    }, 150);
  };
  row.appendChild(label);
  row.appendChild(input);
  row.appendChild(pct);
  return row;
}

function detailsToggle(cardMeta) {
  const wrap = document.createElement("div");
  const toggle = document.createElement("button");
  toggle.className = "link";
  toggle.type = "button";
  toggle.textContent = "Show specs & drawings ▾";
  const panel = document.createElement("div");
  panel.className = "details";
  let loaded = false;

  toggle.onclick = async (ev) => {
    ev.stopPropagation();
    const willOpen = !panel.classList.contains("open");
    panel.classList.toggle("open");
    toggle.textContent = willOpen ? "Hide specs & drawings ▴" : "Show specs & drawings ▾";
    if (willOpen && !loaded) {
      loaded = true;
      panel.innerHTML = '<div class="loading">Loading…</div>';
      try {
        const [fields, attachments] = await Promise.all([
          WFRest.getCardFieldsDisplay(t, cardMeta.idBoard, cardMeta.id).catch(() => []),
          WFRest.getCardAttachments(t, cardMeta.id).catch(() => [])
        ]);
        panel.innerHTML = "";
        const col = document.createElement("div");
        col.className = "col";

        const fieldBox = document.createElement("div");
        if (fields.length) {
          const dl = document.createElement("dl");
          fields.forEach((f) => {
            const dt = document.createElement("dt"); dt.textContent = f.name;
            const dd = document.createElement("dd"); dd.textContent = f.display;
            dl.appendChild(dt); dl.appendChild(dd);
          });
          fieldBox.appendChild(dl);
        } else {
          fieldBox.innerHTML = '<p class="muted">No custom fields set on this card.</p>';
        }
        col.appendChild(fieldBox);

        const attBox = document.createElement("div");
        attBox.className = "attachment-list";
        if (attachments.length) {
          const h = document.createElement("div");
          h.className = "muted";
          h.style.marginBottom = "4px";
          h.textContent = "Attachments (drawings, references):";
          attBox.appendChild(h);
          attachments.forEach((a) => {
            const link = document.createElement("a");
            link.href = a.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = (a.mimeType === "application/pdf" ? "📄 " : "🔗 ") + a.name;
            attBox.appendChild(link);
          });
        } else {
          attBox.innerHTML = '<p class="muted">No attachments on this card yet.</p>';
        }
        col.appendChild(attBox);

        panel.appendChild(col);
      } catch (e) {
        panel.innerHTML = '<p class="muted">Couldn\'t load details.</p>';
      }
    }
  };

  wrap.appendChild(toggle);
  wrap.appendChild(panel);
  return wrap;
}

function renderJobCard(card, stageName, cardMeta, member) {
  const work = card.phaseWork;
  const box = document.createElement("div");
  box.className = "job-card";

  const top = document.createElement("div");
  top.className = "top-row";

  const left = document.createElement("div");
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = card.name;
  title.onclick = () => openCard(card);
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = stageName;
  left.appendChild(title);
  left.appendChild(meta);

  const pill = document.createElement("span");
  const state = jobState(work, member);
  pill.className = "pill " + state.cls;
  pill.textContent = state.text;

  top.appendChild(left);
  top.appendChild(pill);
  box.appendChild(top);

  const actions = document.createElement("div");
  actions.className = "actions";

  if (!work || !work.claimedBy) {
    actions.appendChild(button("Claim & Start", "primary", () => WFPhase.claimAndStart(t, cardMeta, member)));
  } else if (work.pendingApproval) {
    if (work.claimedBy.username === member.username) {
      actions.appendChild(button("Undo", "secondary", () => WFPhase.undoComplete(t, cardMeta)));
    }
  } else if (!work.segments || !work.segments.length) {
    if (work.claimedBy.username === member.username) {
      actions.appendChild(button("Accept & Start", "primary", () => WFPhase.acceptAssignment(t, cardMeta)));
      actions.appendChild(button("Decline", "secondary", () => {
        const reason = window.prompt("Reason for declining? (optional)") || "";
        return WFPhase.declineAssignment(t, cardMeta, member, reason);
      }));
    }
  } else if (WFPhase.isRunning(work)) {
    actions.appendChild(button("Pause", "secondary", () => WFPhase.pause(t, cardMeta)));
    actions.appendChild(button("Complete", "primary", () => WFPhase.complete(t, cardMeta)));
  } else {
    actions.appendChild(button("Resume", "primary", () => WFPhase.resume(t, cardMeta)));
    actions.appendChild(button("Complete", "secondary", () => WFPhase.complete(t, cardMeta)));
  }
  box.appendChild(actions);

  if (work && work.claimedBy) {
    box.appendChild(percentSlider(cardMeta, work));
    const total = document.createElement("div");
    total.className = "meta";
    total.style.marginTop = "8px";
    total.textContent = "Total logged: " + formatMinutes(WFPhase.totalMinutes(work));
    box.appendChild(total);
    const log = segmentLog(work);
    if (log) box.appendChild(log);
  }

  box.appendChild(detailsToggle(cardMeta));
  return box;
}

function jobState(work, member) {
  if (!work || !work.claimedBy) return { text: "Unclaimed", cls: "gray" };
  if (work.pendingApproval) return { text: "Awaiting approval", cls: "amber" };
  if (!work.segments || !work.segments.length) {
    return { text: "Assigned -- needs accept", cls: "amber" };
  }
  return WFPhase.isRunning(work)
    ? { text: "In progress", cls: "green" }
    : { text: "Paused", cls: "gray" };
}

async function renderAuthPrompt() {
  content.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = "This needs one-time read/write access to claim and update jobs.";
  const btn = document.createElement("button");
  btn.className = "primary";
  btn.textContent = "Enable";
  btn.onclick = async () => { await WFRest.authorize(t, "read,write"); renderAll(); };
  content.appendChild(p);
  content.appendChild(btn);
}

let boardCfgCache = null;
let memberCache = null;

async function renderAll() {
  const authorized = await WFRest.isAuthorized(t).catch(() => false);
  if (!authorized) return renderAuthPrompt();

  content.innerHTML = '<div class="loading">Loading jobs…</div>';

  const [board, member] = await Promise.all([t.board("id"), t.member("id", "username", "fullName")]);
  currentBoardId = board.id;
  memberCache = member;
  const boardCfg = WFStage.getBoardConfig(board.id);
  boardCfgCache = boardCfg;
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
    '<select id="phasePick">' +
    '<option value="__mine__">My phase(s) (' + (specialistPhases.length || phaseNames.length) + ")</option>" +
    '<option value="__all__">All work phases</option>' +
    phaseNames.map((n) => '<option value="' + n + '">' + n + "</option>").join("") +
    "</select>";

  const cards = await WFRest.getBoardCardsFull(t, board.id);

  function draw() {
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

    content.innerHTML = "";

    const h1 = document.createElement("h3");
    h1.textContent = "My Jobs (" + mine.length + ")";
    content.appendChild(h1);
    if (!mine.length) {
      const e = document.createElement("div");
      e.className = "empty-state";
      e.textContent = "Nothing claimed or assigned right now -- claim something below.";
      content.appendChild(e);
    } else {
      mine.forEach((x) => {
        const cardMeta = { id: x.card.id, idList: x.card.idList, idBoard: board.id };
        content.appendChild(renderJobCard(x.card, x.stage.name, cardMeta, member));
      });
    }

    const h2 = document.createElement("h3");
    h2.style.marginTop = "24px";
    h2.textContent = "Available to Claim (" + unclaimed.length + ")";
    content.appendChild(h2);
    if (!unclaimed.length) {
      const e = document.createElement("div");
      e.className = "empty-state";
      e.textContent = "Nothing waiting to be claimed in this view.";
      content.appendChild(e);
    } else {
      unclaimed.forEach((x) => {
        const cardMeta = { id: x.card.id, idList: x.card.idList, idBoard: board.id };
        content.appendChild(renderJobCard(x.card, x.stage.name, cardMeta, member));
      });
    }
  }

  document.getElementById("phasePick").addEventListener("change", draw);
  draw();

  // Live-tick the "in progress" totals once a minute so the dashboard feels
  // like a real running timer without needing to re-fetch from Trello.
  clearInterval(tickTimer);
  tickTimer = setInterval(draw, 60000);
}

renderAll();
