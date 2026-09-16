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
    var w = O.activeWork(card);
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

  /* Hand assign() the whole board member, not just a username. Passing
     { username } alone stored a claimedBy with no fullName, which then crashed
     every render that wanted a first name. */
  function memberByUsername(ctx, username) {
    var hit = (ctx.board.members || []).filter(function (m) { return m.username === username; })[0];
    return hit || { username: username };
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
    var w = O.activeWork(card) || {};
    var meta = metaFor(ctx, card);
    var days = WFStage.daysSince(card.dateLastActivity);
    var late = WFStage.colorForElapsed(stage, days) === "red";

    var node = O.el("div.wf-card.is-" + (st === "paused" || st === "assigned" ? "review" : st) + (late ? ".is-late" : ""), {
      style: "grid-template-columns:1.5fr 1fr auto"
    });

    var sub;
    if (st === "open") sub = "waiting " + O.elapsedPhrase(days);
    else if (st === "assigned") sub = "handed to " + O.firstName(w.claimedBy) + " · not started yet";
    else if (st === "review") sub = O.firstName(w.claimedBy) + " finished in " + O.hours(WFPhase.totalMinutes(w));
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
      status.appendChild(O.tag(O.firstName(w.claimedBy) +
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
          return WFPhase.assign(ctx.t, meta, ctx.member, memberByUsername(ctx, sel.value))
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
          return WFPhase.assign(ctx.t, meta, ctx.member, memberByUsername(ctx, resel.value))
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
      // Was a bare WFPhase.complete(), which set pendingApproval and left the
      // card waiting for a manager who is no longer part of the flow. Same
      // checklist as My jobs, from the same place, so the two can't drift.
      actions.appendChild(O.btn("Mark done", {
        primary: true,
        onClick: function () {
          WFChecklist.open(ctx, card, stage, function () { return ctx.syncCard(card.id); });
        }
      }));
      if (!mine) actions.firstChild.title = "Claimed by " + O.displayName(w.claimedBy);
    }
    node.appendChild(actions);
    return node;
  }

  O.tab({
    id: "workboard",
    label: "Work board",
    // Everyone-else's-work view: supervisory. Workers get "My jobs" instead,
    // which shows their own queue plus what's free to claim in their phases.
    roles: ["manager", "office"],
    render: function (ctx) {
      stopTimers();
      return Promise.all([
        ctx.cards(),
        // Which columns this person folded away last time. A failure here just
        // means everything opens, which is the right way to fail.
        ctx.t.get("member", "private", "colsWorkboard", null).catch(function () { return null; })
      ]).then(function (loaded) {
        var cards = loaded[0];
        var collapsedState = loaded[1] || {};
        if (!ctx.boardCfg) return O.empty("This board isn't mapped in config.js yet.");

        // One row per phase, not per list -- the four Install lists read as a
        // single Install here. See WFOps.workPhases.
        var phases = O.workPhases(ctx.boardCfg);

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

        /* Every work phase gets a column, including the empty ones. Trello does
           the same, and it matters: a phase that vanishes when it empties makes
           the columns shuffle sideways, so you'd lose your place every time a
           job moved. */
        var groups = O.el("div");
        groups.appendChild(O.phaseColumns(ctx, {
          phases: phases,
          key: "colsWorkboard",
          collapsed: collapsedState,
          cardsFor: function (stage) {
            return cards
              .filter(function (c) { return stage.listIds.indexOf(c.idList) !== -1; })
              .map(function (c) { return jobCard(ctx, c, stage); });
          },
          noteFor: function () { return "No jobs in this phase."; }
        }));

        if (!phases.length) {
          groups.innerHTML = "";
          groups.appendChild(O.empty("No work phases configured for this board yet."));
        }

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
