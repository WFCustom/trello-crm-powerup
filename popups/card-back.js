/**
 * Card-back-section iframe: claim/accept/decline, start/pause the timer, and a
 * 0-100% progress slider, right on the back of the card itself. The on-card
 * counterpart to My jobs -- same lib/phase.js functions, same cardId-scoped
 * storage, so state is identical whichever surface you act from.
 *
 * WHAT THIS SURFACE DELIBERATELY DOES NOT DO: finish a phase. Start, pause and
 * resume are one-tap facts about right now and belong on the card. Finishing
 * means working a checklist and signing it, which is a dialog that already
 * exists in the ops window, and a copy of it in this 240px iframe would be the
 * third -- the first two drifted and one of them stranded every job it touched.
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

/**
 * Where "I'm done" goes.
 *
 * A card-back section cannot open the board-level modal that holds the
 * checklist -- t.modal from inside this iframe is not a route Trello offers --
 * so this says where to go rather than pretending to be a button that works.
 * A control that looks live and does nothing is exactly what we spent today
 * removing.
 */
function doneNote() {
  const p = document.createElement("p");
  p.className = "muted";
  p.style.margin = "0";
  p.style.fontSize = "13px";
  p.textContent = "Done with this phase? Open WF Ops Dashboard from the board " +
    "menu and sign the checklist — that is what passes it to the next phase.";
  return p;
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
  } else if (WFPhase.isFinished(work)) {
    /* A CARD THAT IS FINISHED AND STILL HERE IS STUCK, AND SAYS SO.
     *
     * This used to read "Awaiting approval" and offer a manager Approve &
     * Advance. There is no approval step any more -- a signed checklist
     * finishes a phase and moves the card in one action -- so that message
     * sent people looking for a queue that no longer exists, and the cards
     * sat here.
     *
     * Two honest ways out: reopen it (the work is evidently not done if the
     * job is still in this list), or go and sign the checklist, which is what
     * actually passes it on. */
    status.textContent = "Finished but not passed on — " + WFPhase.totalMinutes(work) +
      "m logged by " + ((work.claimedBy && work.claimedBy.fullName) || "somebody") +
      ". Sign the checklist in WF Ops to move it, or reopen it.";
    actions.appendChild(button("Reopen", "secondary", () => WFPhase.undoComplete(t, cardMeta)));
    if (managerHere) {
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
    /* No Complete button here. It called WFPhase.complete and stopped, which
     * finished the phase without moving the card and without a checklist --
     * the shortest route to a stranded job in the whole Power-Up. Finishing
     * means signing, and the checklist lives in the ops window; a third copy
     * of that dialog in this iframe is how the first two drifted apart. */
    status.textContent = "In progress — " + work.claimedBy.fullName + " (" + WFPhase.totalMinutes(work) + "m so far).";
    actions.appendChild(button("Pause", "secondary", () => WFPhase.pause(t, cardMeta)));
    actions.appendChild(doneNote());
  } else {
    status.textContent = "Paused — " + work.claimedBy.fullName + " (" + WFPhase.totalMinutes(work) + "m so far).";
    actions.appendChild(button("Resume", "primary", () => WFPhase.resume(t, cardMeta)));
    actions.appendChild(doneNote());
  }

  content.appendChild(status);
  content.appendChild(actions);
  if (work) content.appendChild(percentSlider(cardMeta, work));
  resize();
}

render();
