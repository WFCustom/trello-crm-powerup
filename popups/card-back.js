/**
 * Card-back-section iframe: claim/accept/decline, start/pause/complete timer,
 * and a 0-100% progress slider, right on the back of the card itself. This is
 * the on-card counterpart to the My Jobs dashboard -- same lib/phase.js
 * functions, same cardId-scoped storage, so state is identical whichever
 * surface you act from.
 */
const t = TrelloPowerUp.iframe({ appKey: window.WF_CONFIG.appKey, appName: "Western Fabrication Ops" });
const content = document.getElementById("content");

function resize() {
  t.sizeTo(document.body).catch(() => {});
}

function renderAuthPrompt() {
  content.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = "Job actions need one-time read/write access to this board.";
  const btn = document.createElement("button");
  btn.className = "primary";
  btn.textContent = "Enable job actions";
  btn.onclick = async () => {
    await WFRest.authorize(t, "read,write");
    render();
  };
  content.appendChild(p);
  content.appendChild(btn);
  resize();
}

function button(label, cls, onClick) {
  const b = document.createElement("button");
  b.className = cls || "secondary";
  b.type = "button";
  b.textContent = label;
  b.onclick = async () => {
    b.disabled = true;
    b.textContent = "Working…";
    try {
      await onClick();
      await render();
    } catch (e) {
      await render();
      const err = document.createElement("p");
      err.className = "muted";
      err.textContent = (e && e.message) ? e.message : "Something went wrong.";
      content.appendChild(err);
      resize();
    }
  };
  return b;
}

function percentSlider(cardMeta, work) {
  const row = document.createElement("div");
  row.className = "slider-row";
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "100";
  input.step = "5";
  input.value = String(WFPhase.percentComplete(work));
  const pct = document.createElement("span");
  pct.className = "pct";
  pct.textContent = input.value + "%";
  input.oninput = () => { pct.textContent = input.value + "%"; };
  let debounce = null;
  input.onchange = () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      await WFPhase.setPercentComplete(t, cardMeta, Number(input.value));
    }, 150);
  };
  row.appendChild(input);
  row.appendChild(pct);
  return row;
}

async function render() {
  const authorized = await WFRest.isAuthorized(t).catch(() => false);
  if (!authorized) return renderAuthPrompt();

  content.innerHTML = '<div class="loading">Loading job status…</div>';

  const card = await t.card("id", "idList", "idBoard");
  const cardMeta = { id: card.id, idList: card.idList, idBoard: card.idBoard };
  const stage = WFStage.getStageForList(cardMeta.idBoard, cardMeta.idList);

  if (!stage || !stage.isWorkPhase) {
    content.innerHTML = '<p class="muted">This stage isn\'t a claimable work phase.</p>';
    resize();
    return;
  }

  const member = await t.member("id", "username", "fullName");
  const managerHere = WFStage.isManager(member.username);
  const work = await WFPhase.getActivePhaseWork(t, cardMeta);

  content.innerHTML = "";
  const status = document.createElement("p");
  const actions = document.createElement("div");
  actions.className = "actions";

  if (!work || !work.claimedBy) {
    status.textContent = "Not claimed yet.";
    actions.appendChild(button("Claim & Start", "primary", () => WFPhase.claimAndStart(t, cardMeta, member)));
  } else if (work.pendingApproval) {
    status.textContent = "Awaiting approval — " + WFPhase.totalMinutes(work) + "m logged by " + work.claimedBy.fullName + ".";
    actions.appendChild(button("Undo", "secondary", () => WFPhase.undoComplete(t, cardMeta)));
    if (managerHere) {
      actions.appendChild(button("Approve & Advance", "primary", () => WFPhase.approveAndAdvance(t, cardMeta, member)));
      actions.appendChild(button("Send back", "secondary", () => {
        const reason = window.prompt("Reason for sending this back? (optional)") || "";
        return WFPhase.reject(t, cardMeta, member, reason);
      }));
    }
  } else if (!work.segments || !work.segments.length) {
    // Manager-assigned, worker hasn't accepted yet.
    status.textContent = "Assigned to " + work.claimedBy.fullName + " by " + (work.assignedBy ? work.assignedBy.fullName : "a manager") + ".";
    if (member.id === work.claimedBy.id) {
      actions.appendChild(button("Accept & Start", "primary", () => WFPhase.acceptAssignment(t, cardMeta)));
      actions.appendChild(button("Decline", "secondary", () => {
        const reason = window.prompt("Reason for declining? (optional)") || "";
        return WFPhase.declineAssignment(t, cardMeta, member, reason);
      }));
    } else {
      status.textContent += " Waiting on them to accept.";
    }
  } else if (WFPhase.isRunning(work)) {
    status.textContent = "In progress — " + work.claimedBy.fullName + " (" + WFPhase.totalMinutes(work) + "m so far).";
    actions.appendChild(button("Pause", "secondary", () => WFPhase.pause(t, cardMeta)));
    actions.appendChild(button("Complete", "primary", () => WFPhase.complete(t, cardMeta)));
  } else {
    status.textContent = "Paused — " + work.claimedBy.fullName + " (" + WFPhase.totalMinutes(work) + "m so far).";
    actions.appendChild(button("Resume", "primary", () => WFPhase.resume(t, cardMeta)));
    actions.appendChild(button("Complete", "secondary", () => WFPhase.complete(t, cardMeta)));
  }

  content.appendChild(status);
  content.appendChild(actions);
  if (work) content.appendChild(percentSlider(cardMeta, work));
  resize();
}

render();
