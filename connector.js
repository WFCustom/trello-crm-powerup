/* global TrelloPowerUp, WFStage, WFRest, WFPhase */

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
    // NOTE: card-badges (front of card) do not support a callback per Trello's
    // API -- only card-detail-badges and card-buttons can react to clicks.
    // This badge is informational only; the real "Enable job actions" button
    // (see cardButtons below) is what actually triggers the auth popup.
    return { text: "🔒 Timing off -- see Power-ups button", color: "light-gray" };
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
    // Trello's API forbids calling client.authorize() directly from a
    // capability callback (the browser won't recognize it as a user click
    // and blocks the consent popup) -- so open a real popup with a button
    // instead, per https://developer.atlassian.com/cloud/trello/power-ups/rest-api-client/
    return [{
      icon: ICON,
      text: "Enable job actions",
      callback: (t2) => t2.popup({
        title: "Authorize to continue",
        url: "./popups/authorize.html",
        height: 160
      })
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

// Alternate on-card path (task: card-badges/card-buttons are confirmed not
// rendering on real cards for reasons not yet root-caused, despite proven-
// correct JS and working admin toggles). card-back-section is a structurally
// different capability -- it renders a titled section low on the back of the
// card via a real iframe, rather than a badge/button row -- so it's a good
// independent test of whether ANY per-card capability can render at all.
// Per docs: https://developer.atlassian.com/cloud/trello/power-ups/ui-functions/card-back-section/
async function cardBackSection(t) {
  const card = await t.card("id", "idList", "idBoard");
  const stage = WFStage.getStageForList(card.idBoard, card.idList);
  if (!stage || !stage.isWorkPhase) return null; // nothing to claim/time on non-work stages
  return {
    title: "Job Actions",
    icon: ICON,
    content: {
      type: "iframe",
      url: "./popups/card-back.html",
      height: 240
    }
  };
}

function boardButtons(t) {
  return [
    {
      icon: ICON,
      text: "Ops Dashboard",
      // Fullscreen per request: "the entire board be filled with a pop up
      // that populates pie charts, bar graphs, percentages..."
      callback: (t2) => t2.modal({
        title: "Western Fabrication — Ops Dashboard",
        url: "./popups/dashboard.html",
        fullscreen: true,
        accentColor: "#0079BF"
      })
    },
    {
      icon: ICON,
      text: "My Jobs",
      // Full board-view dashboard, not a cramped popup -- t.modal({fullscreen:true})
      // is the doc-verified way to get a whole-screen overlay (t.popup() has a
      // fixed, small width Trello won't let you override).
      // https://developer.atlassian.com/cloud/trello/power-ups/ui-functions/modal/
      callback: (t2) => t2.modal({
        title: "My Jobs",
        url: "./popups/myjobs.html",
        fullscreen: true,
        accentColor: "#0079BF"
      })
    },
    {
      icon: ICON,
      text: "Manager Approvals",
      callback: (t2) => t2.modal({
        title: "Manager Approvals",
        url: "./popups/approvals.html",
        fullscreen: true,
        accentColor: "#0079BF"
      })
    },
    {
      icon: ICON,
      text: "Team Performance",
      callback: (t2) => t2.modal({
        title: "Team Performance",
        url: "./popups/performance.html",
        fullscreen: true,
        accentColor: "#0079BF"
      })
    }
  ];
}

// Temporary diagnostic wrapper -- logs the real error to the browser console
// instead of silently swallowing it, so failures are visible while we
// confirm the fix. Safe to leave in permanently; it never throws itself.
function logged(label, fn) {
  return (t) => Promise.resolve(fn(t)).catch((e) => {
    console.warn("[Western Fabrication Ops] " + label + " failed:", e && e.stack ? e.stack : e);
    return [];
  });
}

TrelloPowerUp.initialize({
  "card-badges": logged("card-badges", cardBadges),
  "card-detail-badges": logged("card-detail-badges", cardDetailBadges),
  "card-buttons": logged("card-buttons", cardButtons),
  "card-back-section": logged("card-back-section", cardBackSection),
  "board-buttons": (t) => boardButtons(t).concat(extraBoardButtons(t))
}, {
  // Required for t.getRestApi() to work anywhere in this Power-Up (connector
  // and every popup iframe) -- per Trello's docs, getRestApi() throws if
  // appKey/appName aren't provided here. See rest-api-client docs.
  appKey: window.WF_CONFIG.appKey,
  appName: "Western Fabrication Ops"
});


function extraBoardButtons(t) {
    return [
      {
              icon: ICON,
              text: "Assign / Claim Work",
              // Card-level buttons/badges are stuck behind a Trello-side rendering
              // stall (see cardBackSection comment above): this board-level modal
              // gives every worker/manager a reliable way to claim, assign, and
              // time work without depending on that broken per-card UI.
              callback: (t2) => t2.modal({
                        title: "Assign / Claim Work",
                        url: "./popups/workboard.html",
                        fullscreen: true,
                        accentColor: "#0079BF"
              })
      },
      {
              icon: ICON,
              text: "Team Roster",
              callback: (t2) => t2.modal({
                        title: "Team Roster",
                        url: "./popups/roster.html",
                        fullscreen: true,
                        accentColor: "#0079BF"
              })
      }
        ];
}
