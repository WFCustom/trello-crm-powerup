/* global TrelloPowerUp, WFStage, WFRest */

const ICON = "./icon.svg";

// ---------- small render helpers ----------

function exceptionOrHandoffBadges(t, card, boardId) {
  const stage = WFStage.getStageForList(boardId, card.idList);
  const badges = [];
  if (stage && stage.isException) {
    badges.push({ text: "⚠ " + stage.name, color: "red" });
  }
  if (stage && stage.isHandoff) {
    badges.push({ text: "↦ Handoff: " + (stage.handoffTo || "next team"), color: "blue" });
  }
  return badges;
}

async function timingBadge(t, card, boardId) {
  const authorized = await WFRest.isAuthorized(t).catch(() => false);
  if (!authorized) {
    return {
      text: "🔒 Enable timing",
      color: "light-gray",
      callback: async (t2) => {
        await WFRest.authorize(t2);
        return t2.closePopup && t2.closePopup();
      }
    };
  }

  try {
    const history = await WFRest.getCardListHistory(t, card.id);
    const stage = WFStage.getStageForList(boardId, card.idList);
    const enteredCurrent = history.length ? history[history.length - 1].date : card.dateLastActivity;
    const daysIn = WFStage.daysSince(enteredCurrent);
    const semColor = WFStage.colorForElapsed(stage, daysIn);
    const trelloColor = semColor ? WFStage.TRELLO_BADGE_COLOR[semColor] : null;
    return {
      text: "⏱ " + WFStage.formatDuration(daysIn) + " in stage",
      color: trelloColor || "light-gray"
    };
  } catch (e) {
    return { text: "⏱ timing unavailable", color: "light-gray" };
  }
}

// ---------- capability implementations ----------

async function cardBadges(t) {
  const card = await t.card("id", "idList", "idBoard", "dateLastActivity");
  const boardId = card.idBoard;
  const badges = exceptionOrHandoffBadges(t, card, boardId);
  badges.push(await timingBadge(t, card, boardId));
  return badges;
}

async function cardDetailBadges(t) {
  const card = await t.card("id", "idList", "idBoard");
  const boardId = card.idBoard;

  const economics = await t.get("card", "shared", "economics", null);
  const handoffLog = (await t.get("card", "shared", "handoffLog", [])) || [];
  const stage = WFStage.getStageForList(boardId, card.idList);

  const marginText = economics && economics.value
    ? "$" + Number(economics.value - (economics.cost || 0)).toLocaleString() + " margin"
    : "Set job value/cost";

  const badges = [];

  if (stage && stage.isWorkPhase) {
    const work = await WFPhase.getActivePhaseWork(t, card).catch(() => null);
    let phaseText = "Not claimed yet";
    if (work && work.pendingApproval) {
      phaseText = "Awaiting approval (" + WFPhase.totalMinutes(work) + "m by " + work.claimedBy.fullName + ")";
    } else if (work && work.claimedBy) {
      phaseText = (WFPhase.isRunning(work) ? "In progress" : "Paused") + " -- " +
        work.claimedBy.fullName + " (" + WFPhase.totalMinutes(work) + "m)";
    }
    badges.push({ title: "Phase Status", text: phaseText, icon: ICON });
  }

  badges.push({
      title: "Stage Timeline",
      text: "View timing history",
      icon: ICON,
      callback: (t2) => t2.popup({
        title: "Stage Timeline",
        url: "./popups/timing.html",
        height: 420
      })
    },
    {
      title: "Job Economics",
      text: marginText,
      icon: ICON,
      callback: (t2) => t2.popup({
        title: "Job Economics",
        url: "./popups/economics.html",
        height: 320
      })
    },
    {
      title: "Handoff Log",
      text: handoffLog.length ? handoffLog.length + " handoff(s) logged" : "Log a handoff",
      icon: ICON,
      callback: (t2) => t2.popup({
        title: "Handoff Log",
        url: "./popups/handoff.html",
        height: 420
      })
    }
  );

  return badges;
}

async function cardButtons(t) {
  const card = await t.card("id", "idList", "idBoard");
  const stage = WFStage.getStageForList(card.idBoard, card.idList);
  if (!stage || !stage.isWorkPhase) return [];

  const authorized = await WFRest.isAuthorized(t).catch(() => false);
  if (!authorized) {
    return [{
      icon: ICON,
      text: "Enable job actions",
      callback: async (t2) => { await WFRest.authorize(t2, "read,write"); }
    }];
  }

  const member = await t.member("id", "username", "fullName");
  const work = await WFPhase.getActivePhaseWork(t, card);
  const buttons = [];
  const managerHere = WFStage.isManager(member.username);

  const assignButton = (label) => ({
    icon: ICON,
    text: label,
    callback: (t2) => t2.popup({
      title: "Assign phase",
      url: "./popups/assign.html",
      height: 260
    })
  });

  if (!work || !work.claimedBy) {
    buttons.push({
      icon: ICON,
      text: "Claim & Start",
      callback: async (t2) => { await WFPhase.claimAndStart(t2, card, member); }
    });
    if (managerHere) buttons.push(assignButton("Assign..."));
  } else if (work.pendingApproval) {
    buttons.push({
      icon: ICON,
      text: "Undo (" + WFPhase.totalMinutes(work) + "m logged)",
      callback: async (t2) => { await WFPhase.undoComplete(t2, card); }
    });
    if (managerHere) {
      buttons.push({
        icon: ICON,
        text: "Approve & Advance",
        callback: async (t2) => { await WFPhase.approveAndAdvance(t2, card, member); }
      });
    }
  } else if (!work.segments || !work.segments.length) {
    // Manager-assigned but the worker hasn't tapped Start yet.
    buttons.push({
      icon: ICON,
      text: "Start (assigned: " + work.claimedBy.fullName + ")",
      callback: async (t2) => { await WFPhase.resume(t2, card); }
    });
    if (managerHere) buttons.push(assignButton("Reassign..."));
  } else if (WFPhase.isRunning(work)) {
    buttons.push({
      icon: ICON,
      text: "Pause (" + WFPhase.totalMinutes(work) + "m)",
      callback: async (t2) => { await WFPhase.pause(t2, card); }
    });
    buttons.push({
      icon: ICON,
      text: "Complete",
      callback: async (t2) => { await WFPhase.complete(t2, card); }
    });
  } else {
    buttons.push({
      icon: ICON,
      text: "Resume (" + WFPhase.totalMinutes(work) + "m)",
      callback: async (t2) => { await WFPhase.resume(t2, card); }
    });
    buttons.push({
      icon: ICON,
      text: "Complete",
      callback: async (t2) => { await WFPhase.complete(t2, card); }
    });
  }
  return buttons;
}

function boardButtons(t) {
  return [
    {
      icon: ICON,
      text: "Ops Dashboard",
      callback: (t2) => t2.popup({
        title: "Western Fabrication — Ops Dashboard",
        url: "./popups/dashboard.html",
        height: 640,
        width: 760
      })
    },
    {
      icon: ICON,
      text: "My Jobs",
      callback: (t2) => t2.popup({
        title: "My Jobs",
        url: "./popups/myjobs.html",
        height: 560,
        width: 620
      })
    },
    {
      icon: ICON,
      text: "Manager Approvals",
      callback: (t2) => t2.popup({
        title: "Manager Approvals",
        url: "./popups/approvals.html",
        height: 560,
        width: 680
      })
    },
    {
      icon: ICON,
      text: "Team Performance",
      callback: (t2) => t2.popup({
        title: "Team Performance",
        url: "./popups/performance.html",
        height: 680,
        width: 820
      })
    }
  ];
}

TrelloPowerUp.initialize({
  "card-badges": (t) => cardBadges(t).catch(() => []),
  "card-detail-badges": (t) => cardDetailBadges(t).catch(() => []),
  "card-buttons": (t) => cardButtons(t).catch(() => []),
  "board-buttons": (t) => boardButtons(t)
});
