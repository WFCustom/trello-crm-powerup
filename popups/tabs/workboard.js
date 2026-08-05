/* Work board -- every work phase, grouped, with the claim/pause/complete/approve
   actions the shop actually uses. Wired to WFPhase. Live timers tick locally. */
(function () {
  "use strict";
  var O = WFOps;
  var timers = [];

  function stopTimers() {
    timers.forEach(clearInterval);
    timers = [];
  }

  function liveTimer(work) {
    var node = O.el("span.wf-timer", { text: O.hours(WFPhase.totalMinutes(work)) });
    if (!WFPhase.isRunning(work)) return node;
    var base = (WFPhase.totalMinutes(work) || 0) * 60000;
    var since = Date.now();
    var id = setInterval(function () {
      if (!node.isConnected) return clearInterval(id);
      node.textContent = O.clock(base + (Date.now() - since));
    }, 1000);
    timers.push(id);
    return node;
  }

  function state(card) {
    var w = card.phaseWork;
    if (!w || !w.claimedBy) return "open";
    if (w.pendingApproval) return "review";
    // Handed to someone who hasn't tapped Start yet -- distinct from "paused",
    // which would wrongly imply they had already been working on it.
    if (O.isAwaitingStart(w)) return "assigned";
    return WFPhase.isRunning(w) ? "running" : "paused";
  }

  function metaFor(ctx, card) {
    return { id: card.id, idList: card.idList, idBoard: ctx.board.id };
  }

  function assignSelect(ctx, stageName) {
    var names = (ctx.roster.phaseSpecialists || {})[stageName] || [];
    var byUser = {};
    (ctx.board.members || []).forEach(function (m) { byUser[m.username] = m; });
    var pool = names.length ? names : (ctx.board.members || []).map(function (m) { return m.username; });

    var sel = O.el("select", { style: "width:170px" },
      O.el("option", { value: "", text: "Give it to…" }));
    pool.forEach(function (u) {
      var m = byUser[u];
      sel.appendChild(O.el("option", { value: u, text: m ? (m.fullName || m.username) : u }));
    });
    return sel;
  }

  function jobCard(ctx, card, stage) {
    var st = state(card);
    var w = card.phaseWork || {};
    var meta = metaFor(ctx, card);
    var days = WFStage.daysSince(card.dateLastActivity);
    var late = WFStage.colorForElapsed(stage, days) === "red";

    var node = O.el("div.wf-card.is-" + (st === "paused" || st === "assigned" ? "review" : st) + (late ? ".is-late" : ""), {
      style: "grid-template-columns:1.5fr 1fr auto"
    });

    var sub;
    if (st === "open") sub = "waiting " + O.elapsedPhrase(days);
    else if (st === "assigned") sub = "handed to " + w.claimedBy.fullName.split(" ")[0] + " · not started yet";
    else if (st === "review") sub = w.claimedBy.fullName.split(" ")[0] + " finished in " + O.hours(WFPhase.totalMinutes(w));
    else sub = "started " + (O.runningSince(w) ? O.timeOfDay(O.runningSince(w)) : "earlier") +
      " · " + (WFPhase.percentComplete(w) || 0) + "% done";

    node.appendChild(O.el("div", null,
      O.el("div.wf-card-t", { text: card.name }),
      O.el("div.wf-card-s", { text: sub })));

    var status = O.el("div", { style: "display:flex;align-items:center;gap:12px" });
    if (st === "open") status.appendChild(O.tag("Nobody yet", "quiet"));
    else if (st === "assigned") status.appendChild(O.tag("Not started yet", "warn"));
    else if (st === "review") status.appendChild(O.tag("Needs your OK", "warn"));
    else {
      status.appendChild(O.tag(w.claimedBy.fullName.split(" ")[0] +
        (st === "running" ? " is on it" : " paused it"), st === "running" ? "go" : "quiet"));
      status.appendChild(liveTimer(w));
    }
    node.appendChild(status);

    var actions = O.el("div.wf-actions");
    if (st === "open") {
      var sel = assignSelect(ctx, stage.name);
      actions.appendChild(sel);
      actions.appendChild(O.btn("Hand it over", {
        busyText: "Assigning…",
        onClick: function () {
          if (!sel.value) return;
          return WFPhase.assign(ctx.t, meta, ctx.member, { username: sel.value })
            .then(function () { return ctx.syncCard(card.id); });
        }
      }));
      actions.appendChild(O.btn("Claim it", {
        primary: true, busyText: "Claiming…",
        onClick: function () {
          return WFPhase.claimAndStart(ctx.t, meta, ctx.member)
            .then(function () { return ctx.syncCard(card.id); });
        }
      }));
    } else if (st === "assigned") {
      var resel = assignSelect(ctx, stage.name);
      actions.appendChild(resel);
      actions.appendChild(O.btn("Hand to someone else", {
        busyText: "Reassigning…",
        onClick: function () {
          if (!resel.value) return;
          return WFPhase.assign(ctx.t, meta, ctx.member, { username: resel.value })
            .then(function () { return ctx.syncCard(card.id); });
        }
      }));
      actions.appendChild(O.btn("Start it", {
        primary: true, busyText: "Starting…",
        onClick: function () {
          return WFPhase.acceptAssignment(ctx.t, meta)
            .then(function () { return ctx.syncCard(card.id); });
        }
      }));
    } else if (st === "review") {
      actions.appendChild(O.btn("Send back", {
        busyText: "Sending…",
        onClick: function () {
          var reason = window.prompt("What needs fixing? (optional)") || "";
          return WFPhase.reject(ctx.t, meta, ctx.member, reason)
            .then(function () { return ctx.syncCard(card.id); });
        }
      }));
      actions.appendChild(O.btn("Approve & move on", {
        primary: true, busyText: "Approving…",
        onClick: function () {
          if (!ctx.isManager) { window.alert("Only managers can approve a phase."); return; }
          // Approving moves the card; the SDK won't report the new list, so pass
          // the destination we already know.
          var target = WFStage.getNextStage(ctx.board.id, card.idList);
          return WFPhase.approveAndAdvance(ctx.t, meta, ctx.member)
            .then(function () {
              return ctx.syncCard(card.id, target ? { idList: target.listId } : null);
            });
        }
      }));
    } else {
      var mine = w.claimedBy && w.claimedBy.username === ctx.member.username;
      actions.appendChild(O.btn(st === "running" ? "Pause" : "Resume", {
        busyText: "…",
        onClick: function () {
          var p = st === "running" ? WFPhase.pause(ctx.t, meta) : WFPhase.resume(ctx.t, meta);
          return p.then(function () { return ctx.syncCard(card.id); });
        }
      }));
      actions.appendChild(O.btn("Mark done", {
        primary: true, busyText: "Finishing…",
        onClick: function () {
          return WFPhase.complete(ctx.t, meta)
            .then(function () { return ctx.syncCard(card.id); });
        }
      }));
      if (!mine) actions.firstChild.title = "Claimed by " + w.claimedBy.fullName;
    }
    node.appendChild(actions);
    return node;
  }

  O.tab({
    id: "workboard",
    label: "Work board",
    render: function (ctx) {
      stopTimers();
      return ctx.cards().then(function (cards) {
        if (!ctx.boardCfg) return O.empty("This board isn't mapped in config.js yet.");

        var phases = ctx.boardCfg.stages
          .filter(function (s) { return s.isWorkPhase; })
          .sort(function (a, b) { return a.order - b.order; });

        var counts = { open: 0, running: 0, review: 0, assigned: 0 };
        cards.forEach(function (c) {
          var s = state(c);
          if (counts[s] !== undefined) counts[s]++;
        });

        var search = O.el("input", { style: "max-width:300px", placeholder: "Find a job…", type: "search" });
        var head = O.el("div.wf-pagehead", null,
          O.el("div.wf-h1", { text: "Work board" }),
          search,
          O.el("div.wf-sub.wf-spacer", {
            text: counts.open + " unclaimed · " + counts.running + " running · " +
                  (counts.assigned ? counts.assigned + " not started · " : "") +
                  counts.review + " to approve"
          }));

        var groups = O.el("div");
        phases.forEach(function (stage) {
          var mine = cards.filter(function (c) { return c.idList === stage.listId; });
          if (!mine.length) return;
          groups.appendChild(O.el("div.wf-group-h", null,
            O.el("div.wf-group-t", { text: stage.name }),
            O.el("span.wf-group-n", { text: mine.length + (mine.length === 1 ? " job" : " jobs") })));
          groups.appendChild(O.el("div.wf-cards", null, mine.map(function (c) {
            return jobCard(ctx, c, stage);
          })));
        });

        if (!groups.childNodes.length) groups.appendChild(O.empty("No jobs in any work phase right now."));

        search.addEventListener("input", function () {
          var q = search.value.toLowerCase();
          groups.querySelectorAll(".wf-card").forEach(function (n) {
            n.style.display = !q || n.textContent.toLowerCase().indexOf(q) !== -1 ? "" : "none";
          });
        });

        return O.el("div", null, head, groups);
      });
    }
  });
})();
