/* My jobs -- the shop-floor view. What I'm on, what's assigned to me,
   what's up for grabs in the phases I'm listed for. Wired to WFPhase. */
(function () {
  "use strict";
  var O = WFOps;
  var ticks = [];

  function meta(ctx, card) { return { id: card.id, idList: card.idList, idBoard: ctx.board.id }; }

  /* Consolidated phase, so the four Install lists read as one Install and share
     a single crew for hand-offs and QC. */
  function stageOf(ctx, card) {
    return O.phaseForCard(ctx.boardCfg, card);
  }

  function bigTimer(work) {
    var node = O.el("div.wf-callout-v", { text: O.hours(WFPhase.totalMinutes(work)) });
    if (!WFPhase.isRunning(work)) return node;
    var base = (WFPhase.totalMinutes(work) || 0) * 60000, since = Date.now();
    var id = setInterval(function () {
      if (!node.isConnected) return clearInterval(id);
      node.textContent = O.clock(base + (Date.now() - since));
    }, 1000);
    ticks.push(id);
    return node;
  }

  /* Hand off a job you've already claimed. Assign() takes the whole member so
     claimedBy keeps a fullName. */
  function reassignRow(ctx, card, stage) {
    var byUser = {};
    (ctx.board.members || []).forEach(function (m) { byUser[m.username] = m; });
    var names = (ctx.roster.phaseSpecialists || {})[stage ? stage.name : ""] || [];
    var pool = (names.length ? names : Object.keys(byUser))
      .filter(function (u) { return u !== ctx.member.username; });

    var sel = O.el("select", { style: "width:190px" },
      O.el("option", { value: "", text: "Hand off to…" }));
    pool.forEach(function (u) {
      sel.appendChild(O.el("option", { value: u, text: O.displayName(byUser[u] || { username: u }) }));
    });

    return O.el("div", { style: "display:flex;align-items:center;gap:10px;margin-top:14px" },
      sel,
      O.btn("Hand it over", {
        busyText: "Handing over…",
        onClick: function () {
          if (!sel.value) return;
          var to = byUser[sel.value] || { username: sel.value };
          return WFPhase.assign(ctx.t, meta(ctx, card), ctx.member, to)
            .then(function () { return ctx.syncCard(card.id); });
        }
      }));
  }

  /**
   * Finishing a phase asks who should check the work. Either name a peer or
   * release it to the pool for anyone qualified to pick up. Their sign-off is
   * the approval -- there's no second manager gate on shop phases.
   */
  function openQcChooser(ctx, card, stage) {
    var byUser = {};
    (ctx.board.members || []).forEach(function (m) { byUser[m.username] = m; });
    var specialists = (ctx.roster.phaseSpecialists || {})[stage ? stage.name : ""] || [];
    var pool = (specialists.length ? specialists : Object.keys(byUser))
      .filter(function (u) { return u !== ctx.member.username; });   // never check your own work

    var sel = O.el("select", null,
      O.el("option", { value: "", text: pool.length ? "Anyone can check it (QC pool)" : "No one else on this board yet" }));
    pool.forEach(function (u) {
      sel.appendChild(O.el("option", { value: u, text: O.displayName(byUser[u] || { username: u }) }));
    });

    function finish() {
      var reviewer = sel.value ? (byUser[sel.value] || { username: sel.value }) : null;
      return WFPhase.complete(ctx.t, meta(ctx, card))
        .then(function () {
          return WFQC.request(ctx.t, meta(ctx, card), stage ? stage.name : "", ctx.member, reviewer);
        })
        .then(function () { return ctx.syncCard(card.id); });
    }

    O.dialog({
      title: "Send it for a quality check",
      note: card.name + (stage ? " · " + stage.name : ""),
      content: O.el("div", null,
        O.el("label", { text: "Who should check it?" }),
        sel,
        O.el("div.hint", { style: "margin-top:10px",
          text: "Leave it on the pool and whoever's free can pick it up. Once it passes, the job moves to the next phase." })),
      buttons: [{
        label: "Send for QC", primary: true, busyText: "Sending…", onClick: finish
      }]
    });
  }

  /**
   * Self-check: the drafter works their own list and signs it. Ticking every
   * line advances the job; leaving one unticked just means it isn't finished, so
   * nothing moves and nothing is blamed on anyone.
   */
  function openSelfCheck(ctx, card, stage) {
    var phase = stage ? stage.name : "";
    WFQC.getTemplate(ctx.t, phase).then(function (template) {
      var items = template.length ? template : ["Work is complete and correct"];
      var rows = [];
      var body = O.el("div");

      items.forEach(function (text) {
        var box = O.el("input", { type: "checkbox" });
        var note = O.el("input", { type: "text", placeholder: "What's outstanding? (optional)" });
        note.style.display = "";
        box.addEventListener("change", function () {
          note.style.display = box.checked ? "none" : "";
        });
        rows.push({ text: text, box: box, note: note });
        body.appendChild(O.el("div", { style: "padding:10px 0;border-bottom:1px solid var(--wf-band)" },
          O.el("label", { style: "display:flex;align-items:center;gap:10px;margin:0;font-weight:400" },
            box, O.el("span", { style: "font-size:14px;color:var(--wf-text)", text: text })),
          O.el("div", { style: "margin-top:6px" }, note)));
      });

      var status = O.el("div.hint", { style: "margin-top:12px" });

      O.dialog({
        title: phase + " checklist",
        note: card.name,
        content: O.el("div", null, body, status,
          O.el("div.hint", { style: "margin-top:12px",
            text: "Tick everything and the job moves on. Anything left unticked keeps it with you — "
                + "it's saved, so you can come back to it." })),
        buttons: [{
          label: "Sign off and move it on", primary: true, busyText: "Signing…",
          onClick: function () {
            var results = rows.map(function (r) {
              return { text: r.text, result: r.box.checked ? "pass" : "fail", note: r.note.value };
            });
            return WFQC.submitSelfCheck(ctx.t, meta(ctx, card), phase, ctx.member, results)
              .then(function (res) {
                if (!res.passed) {
                  window.alert("Still to do:\n\n" +
                    res.outstanding.map(function (i) {
                      return "• " + i.text + (i.note ? " — " + i.note : "");
                    }).join("\n") +
                    "\n\nSaved. The job stays with you until these are ticked.");
                }
                return ctx.syncCard(card.id);
              });
          }
        }]
      });
    }).catch(function (e) {
      window.alert((e && e.message) || "Couldn't open the checklist.");
    });
  }

  function activeCard(ctx, card, stage) {
    var w = O.activeWork(card);
    var pct = WFPhase.percentComplete(w) || 0;

    var slider = O.el("input", { type: "range", min: "0", max: "100", step: "5", value: String(pct) });
    var pctOut = O.el("span.pct", { text: pct + "%" });
    slider.addEventListener("input", function () { pctOut.textContent = slider.value + "%"; });
    slider.addEventListener("change", function () {
      // No re-render here on purpose -- redrawing mid-drag would yank the slider
      // out from under the user. The label already moved; the write just lands.
      WFPhase.setPercentComplete(ctx.t, meta(ctx, card), Number(slider.value))
        .catch(function () { window.alert("Couldn't save the percentage."); });
    });

    var p = O.panel(card.name, stage ? stage.name : "");
    p.body(
      O.el("div", { style: "display:flex;align-items:center;gap:24px;flex-wrap:wrap" },
        O.el("div.wf-callout", { style: "margin:0;min-width:220px" },
          O.el("div.wf-callout-k", { text: WFPhase.isRunning(w) ? "Running since " + (O.runningSince(w) ? O.timeOfDay(O.runningSince(w)) : "earlier") : "Paused" }),
          bigTimer(w)),
        O.el("div", { style: "flex:1;min-width:260px" },
          O.el("div.slider-row", null, O.el("span.hint", { text: "How far along" }), slider, pctOut),
          O.el("div.wf-actions", { style: "justify-content:flex-start;margin-top:16px" },
            O.btn(WFPhase.isRunning(w) ? "Pause" : "Resume", {
              busyText: "…",
              onClick: function () {
                var go = WFPhase.isRunning(w) ? WFPhase.pause : WFPhase.resume;
                return go(ctx.t, meta(ctx, card)).then(function () { return ctx.syncCard(card.id); });
              }
            }),
            O.btn("Open card", { quiet: true, onClick: function () { O.openCard(card); } }),
            /* Three ways to finish a phase:
                 self-checked (CAD)  -- work your own list, signing advances it
                 peer-checked (shop) -- hand it to someone else to check
                 everything else     -- straight to manager approval, as before
               See WFQC.qcPhases and WFQC.selfCheckPhases. */
            WFQC.requiresSelfCheck(stage ? stage.name : "")
              ? O.btn("I'm done — run my checklist", {
                  primary: true,
                  onClick: function () { openSelfCheck(ctx, card, stage); }
                })
              : WFQC.requiresQc(stage ? stage.name : "")
              ? O.btn("I'm done — send for QC", {
                  primary: true,
                  onClick: function () { openQcChooser(ctx, card, stage); }
                })
              : O.btn("I'm done with this phase", {
                  primary: true, busyText: "Sending for approval…",
                  onClick: function () {
                    return WFPhase.complete(ctx.t, meta(ctx, card))
                      .then(function () { return ctx.syncCard(card.id); });
                  }
                })),
          reassignRow(ctx, card, stage))));
    return p;
  }

  function grabRow(ctx, card, stage, color) {
    var row = O.el("div.wf-card.is-open", { style: "grid-template-columns:1.6fr 1fr auto" },
      O.el("div", null,
        O.el("div.wf-card-t", { text: card.name }),
        O.el("div.wf-card-s", { text: "waiting " + O.elapsedPhrase(WFStage.daysSince(card.dateLastActivity)) })),
      O.el("div", null, O.tag("Up for grabs", "quiet")),
      O.el("div.wf-actions", null,
        O.btn("Take it", {
          primary: true, busyText: "Claiming…",
          onClick: function () {
            return WFPhase.claimAndStart(ctx.t, meta(ctx, card), ctx.member)
              .then(function () { return ctx.syncCard(card.id); });
          }
        })));
    if (color) row.style.borderLeftColor = color;
    return row;
  }

  /**
   * The queue as columns, one per phase, left to right in board order.
   *
   * This used to be a stack of collapsible groups, which meant scrolling past
   * phases you don't work to reach the one you do. Columns put them all on
   * screen at once; each still folds to its header, and what you fold stays
   * folded next time.
   */
  function grabsByPhase(ctx, grabs, mySpecialties, scoped, collapsedState) {
    mySpecialties = mySpecialties || {};
    var order = O.workPhases(ctx.boardCfg);

    var byPhase = {};
    grabs.forEach(function (r) {
      var name = r[1] ? r[1].name : "Unsorted";
      (byPhase[name] = byPhase[name] || []).push(r);
    });

    /* Board order, always -- the columns must not move about as jobs come and
       go. Anything that isn't a mapped work phase goes on the end rather than
       being dropped. */
    var phases = order.filter(function (p) { return byPhase[p.name]; });
    Object.keys(byPhase).forEach(function (name) {
      if (!phases.some(function (p) { return p.name === name; })) phases.push({ name: name });
    });

    return O.phaseColumns(ctx, {
      phases: phases,
      key: scoped ? "colsMyJobs" : "colsMyJobsAll",
      collapsed: collapsedState,
      cardsFor: function (phase) {
        return (byPhase[phase.name] || []).map(function (r) {
          return grabRow(ctx, r[0], r[1], O.phaseColor(ctx.boardCfg, phase.name));
        });
      },
      noteFor: function () { return "Nothing waiting here."; },
      tagFor: function (phase) {
        return mySpecialties[phase.name] ? O.tag("yours", "go") : null;
      }
    });
  }

  function assignedRow(ctx, card, stage) {
    return O.el("div.wf-card.is-review", { style: "grid-template-columns:1.6fr 1fr auto" },
      O.el("div", null,
        O.el("div.wf-card-t", { text: card.name }),
        O.el("div.wf-card-s", { text: (stage ? stage.name : "—") + " · handed to you" })),
      O.el("div", null, O.tag("Assigned to you", "warn")),
      O.el("div.wf-actions", null,
        O.btn("Not me", {
          busyText: "…",
          onClick: function () {
            var why = window.prompt("Why are you passing on this one? (optional)") || "";
            return WFPhase.declineAssignment(ctx.t, meta(ctx, card), ctx.member, why)
              .then(function () { return ctx.syncCard(card.id); });
          }
        }),
        O.btn("Start it", {
          primary: true, busyText: "Starting…",
          onClick: function () {
            return WFPhase.acceptAssignment(ctx.t, meta(ctx, card))
              .then(function () { return ctx.syncCard(card.id); });
          }
        })));
  }

  O.tab({
    id: "myjobs",
    label: "My jobs",
    render: function (ctx) {
      ticks.forEach(clearInterval); ticks = [];

      return Promise.all([
        ctx.cards(),
        // Which columns this person folded away last time; failing open is fine.
        ctx.t.get("member", "private", "colsMyJobs", null).catch(function () { return null; }),
        ctx.t.get("member", "private", "colsMyJobsAll", null).catch(function () { return null; })
      ]).then(function (loaded) {
        var cards = loaded[0];
        var collapsedScoped = loaded[1] || {};
        var collapsedAll = loaded[2] || {};
        var me = ctx.member.username;
        var mine = [], assigned = [], grabs = [], waiting = [];

        /**
         * The phases this person is listed for in Roster, by consolidated name.
         *
         * Workers see only these: a welder shouldn't have to read past CAD and
         * Install to find their own queue. Managers and office keep the full
         * view -- they're the ones handing work out, so hiding phases from them
         * would defeat the point.
         */
        var myPhases = {};
        var spec = ctx.roster.phaseSpecialists || {};
        Object.keys(spec).forEach(function (p) {
          if ((spec[p] || []).indexOf(me) !== -1) myPhases[O.phaseKey(p)] = true;
        });
        var scoped = (ctx.role || "worker") === "worker";
        var phaseNames = Object.keys(myPhases);

        cards.forEach(function (card) {
          var stage = stageOf(ctx, card);
          if (!stage || !stage.isWorkPhase) return;
          // Only work belonging to this card's current phase counts -- see
          // WFOps.activeWork. Reading phaseWork raw is what made Pause dead on
          // cards that had been claimed and then moved.
          var w = O.activeWork(card);
          if (w && w.claimedBy && w.claimedBy.username === me) {
            // assign() puts the assignee in claimedBy with no segments yet, so
            // "handed to me but not started" and "actively mine" both land here.
            if (w.pendingApproval) waiting.push([card, stage]);
            else if (O.isAwaitingStart(w)) assigned.push([card, stage]);
            else mine.push([card, stage]);
          } else if (!w || !w.claimedBy) {
            grabs.push([card, stage]);
          }
        });

        /* Only unclaimed work is scoped. Anything already yours stays visible
           whatever phase it's in -- a job you're timing, or one handed to you,
           must never disappear behind a roster change, or it strands with the
           clock still running and no way to pause it. */
        if (scoped) {
          grabs = grabs.filter(function (r) { return r[1] && myPhases[r[1].name]; });
        }

        var out = O.el("div", null,
          O.el("div.wf-pagehead", null,
            O.el("div.wf-h1", { text: "Hey " + (ctx.member.fullName || me).split(" ")[0] }),
            O.el("div.wf-sub", {
              text: mine.length ? "You're on " + mine.length + (mine.length === 1 ? " job" : " jobs") + " right now"
                                : (scoped && !phaseNames.length
                                    ? "No phases assigned to you yet"
                                    : "Nothing running — pick something up below")
            }),
            scoped && phaseNames.length
              ? O.el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-left:auto" },
                  phaseNames.sort().map(function (n) { return O.tag(n, "quiet"); }))
              : null));

        mine.forEach(function (r) { out.appendChild(activeCard(ctx, r[0], r[1])); });

        if (assigned.length) {
          out.appendChild(O.el("div.wf-group-h", null,
            O.el("div.wf-group-t", { text: "Handed to you" }),
            O.el("span.wf-group-n", { text: String(assigned.length) })));
          out.appendChild(O.el("div.wf-cards", null, assigned.map(function (r) {
            return assignedRow(ctx, r[0], r[1]);
          })));
        }

        if (waiting.length) {
          out.appendChild(O.el("div.wf-group-h", null,
            O.el("div.wf-group-t", { text: "Waiting on a manager" }),
            O.el("span.wf-group-n", { text: String(waiting.length) })));
          out.appendChild(O.el("div.wf-cards", null, waiting.map(function (r) {
            return O.el("div.wf-card.is-review", { style: "grid-template-columns:1.6fr 1fr auto" },
              O.el("div", null,
                O.el("div.wf-card-t", { text: r[0].name }),
                O.el("div.wf-card-s", { text: r[1].name + " · " + O.hours(WFPhase.totalMinutes(O.activeWork(r[0]))) + " logged" })),
              O.el("div", null, O.tag("Sent for sign-off", "warn")),
              O.el("div.wf-actions", null,
                O.btn("Undo", {
                  busyText: "…",
                  onClick: function () {
                    var cid = r[0].id;
                    return WFPhase.undoComplete(ctx.t, meta(ctx, r[0]))
                      .then(function () { return ctx.syncCard(cid); });
                  }
                })));
          })));
        }

        /* Someone with no phases assigned has nothing to pick up, and saying so
           is far better than showing them the whole shop's queue -- which is
           what happened before, and is the thing being fixed here. Their own
           work above still shows, so nothing they've started gets stranded. */
        if (scoped && !phaseNames.length) {
          out.appendChild(O.el("div.wf-group-h", null,
            O.el("div.wf-group-t", { text: "Up for grabs" })));
          out.appendChild(O.el("div.wf-empty", null,
            O.el("div", { text: "No phases assigned to you yet." }),
            O.el("div.muted", { style: "margin-top:6px",
              text: "A manager sets this in the Roster tab. Once you're listed for a phase, "
                  + "the jobs waiting in it show up here." })));
        } else {
          out.appendChild(O.el("div.wf-group-h", null,
            O.el("div.wf-group-t", { text: scoped ? "Up for grabs in your phases" : "Up for grabs" }),
            O.el("span.wf-group-n", { text: grabs.length + (grabs.length === 1 ? " job" : " jobs") }),
            grabs.length
              ? O.el("span.wf-card-s", { style: "margin-left:auto",
                  text: "one column per phase — tap a heading to fold it away" })
              : null));
          out.appendChild(grabs.length
            ? grabsByPhase(ctx, grabs, myPhases, scoped,
                           scoped ? collapsedScoped : collapsedAll)
            : O.empty(scoped
                ? "Nothing waiting in your phases right now."
                : "Everything in the shop is claimed. Nice."));
        }

        return out;
      });
    }
  });
})();
