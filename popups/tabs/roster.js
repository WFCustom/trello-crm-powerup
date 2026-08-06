/* Team roster -- who approves, who's a specialist in which phase, and what
   each person costs per hour. Managers/specialists are wired to WFRoster
   (board pluginData). Rates are read-only: they're owned by the QuickBooks
   sync, so this view shows them and says where they came from. */
(function () {
  "use strict";
  var O = WFOps;

  function label(m) { return (m.fullName || m.username); }

  /* What each role gets, spelled out in the UI so it isn't guesswork.
     Roles are editable here at any time and take effect on the next render --
     no reopening the window. */
  var ROLE_NOTE = {
    manager: "Everything, including costing and per-person figures",
    office: "Paperwork steps and the work board. No financials",
    worker: "Own queue only: claim, timer, complete. No financials"
  };

  function roleControls(ctx, m, role) {
    var acts = [];
    if (role !== "manager") {
      acts.push(O.btn("Make a manager", {
        small: true, busyText: "…",
        onClick: function () { return WFRoster.addManager(ctx.t, m.username).then(ctx.reload); }
      }));
    } else {
      acts.push(O.btn("Remove as manager", {
        small: true, busyText: "…",
        onClick: function () { return WFRoster.removeManager(ctx.t, m.username).then(ctx.reload); }
      }));
    }
    if (role === "office") {
      acts.push(O.btn("Not office", {
        small: true, quiet: true, busyText: "…",
        onClick: function () { return WFRoster.removeOffice(ctx.t, m.username).then(ctx.reload); }
      }));
    } else if (role !== "manager") {
      acts.push(O.btn("Make office", {
        small: true, quiet: true, busyText: "…",
        onClick: function () { return WFRoster.addOffice(ctx.t, m.username).then(ctx.reload); }
      }));
    }
    return acts;
  }

  function personRow(ctx, m, rate, role, phases) {
    var edge = role === "manager" ? ".is-running" : (role === "office" ? ".is-review" : "");
    return O.el("div.wf-card" + edge, {
      style: "grid-template-columns:1.3fr 1.3fr 150px auto"
    },
      O.el("div", { style: "display:flex;align-items:center;gap:12px" },
        O.el("div.wf-avatar", { style: "background:var(--wf-steel-2)", text: O.initials(label(m)) }),
        O.el("div", null,
          O.el("div.wf-card-t", { text: label(m) }),
          O.el("div.wf-card-s", { text: "@" + m.username }),
          O.el("div", { style: "margin-top:6px;display:flex;align-items:center;gap:8px" },
            O.tag(role, role === "manager" ? "solid" : (role === "office" ? "warn" : "quiet")),
            O.el("span.wf-card-s", { text: ROLE_NOTE[role] || "" })))),
      O.el("div", { style: "display:flex;flex-wrap:wrap;gap:6px" },
        phases.length
          ? phases.map(function (p) { return O.tag(p, "quiet"); })
          : [O.el("span.wf-card-s", { text: "No phases assigned" })]),
      O.el("div", null,
        O.el("div.wf-card-s", { text: "Labor rate" }),
        O.el("div.wf-card-t", { text: rate != null ? "$" + rate + "/hr" : "—" })),
      O.el("div.wf-actions", { style: "flex-wrap:wrap" }, roleControls(ctx, m, role)));
  }

  /**
   * Everyone listed against this phase under ANY of the raw list names that
   * collapse into it -- so people previously added under "Install (Tuesday)"
   * still show on the single consolidated Install block rather than vanishing.
   */
  function specialistsFor(ctx, phaseName) {
    var spec = ctx.roster.phaseSpecialists || {};
    var seen = {}, out = [];
    Object.keys(spec).forEach(function (rawName) {
      if (O.phaseKey(rawName) !== phaseName) return;
      (spec[rawName] || []).forEach(function (u) {
        if (!seen[u]) { seen[u] = true; out.push(u); }
      });
    });
    return out;
  }

  /**
   * The QC checklist for a phase. Managers edit it here; edits apply to future
   * checks only, because a check snapshots the list when it opens -- adding an
   * item later must not make an already-signed check look incomplete.
   */
  function qcTemplateBlock(ctx, phase, templates) {
    var items = (templates[phase.name] || []).slice();
    var listWrap = O.el("div");

    /* Items are editable in place -- reword one without deleting and retyping.
       Reordering matters too: a checker works the list top to bottom. */
    function paint() {
      listWrap.innerHTML = "";
      if (!items.length) {
        listWrap.appendChild(O.el("div.hint", { text: "No checklist yet — the checker just confirms the work is right." }));
      }
      items.forEach(function (text, i) {
        var field = O.el("input", { type: "text", value: text, style: "flex:1" });
        field.addEventListener("input", function () { items[i] = field.value; });
        listWrap.appendChild(O.el("div", { style: "display:flex;align-items:center;gap:6px;padding:4px 0" },
          O.el("span.wf-card-s", { style: "width:18px;text-align:right", text: (i + 1) + "." }),
          field,
          O.btn("↑", {
            small: true, quiet: true,
            onClick: function () {
              if (i === 0) return;
              var tmp = items[i - 1]; items[i - 1] = items[i]; items[i] = tmp; paint();
            }
          }),
          O.btn("↓", {
            small: true, quiet: true,
            onClick: function () {
              if (i === items.length - 1) return;
              var tmp = items[i + 1]; items[i + 1] = items[i]; items[i] = tmp; paint();
            }
          }),
          O.btn("Remove", {
            small: true, quiet: true,
            onClick: function () { items.splice(i, 1); paint(); }
          })));
      });
    }
    paint();

    var input = O.el("input", { type: "text", placeholder: "e.g. Welds ground flush" });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addItem(); }
    });
    function addItem() {
      var v = input.value.trim();
      if (!v) return;
      items.push(v); input.value = ""; paint();
    }

    return O.el("div.phase-block", null,
      O.el("h3", { text: phase.name + " — QC checklist" }),
      O.el("div.hint", { text: "What a peer checks before this phase moves on. Changes affect future checks only." }),
      listWrap,
      O.el("div.add-row", { style: "margin-top:10px" }, input,
        O.btn("Add", { onClick: addItem })),
      O.el("div", { style: "margin-top:12px" },
        O.btn("Save checklist", {
          primary: true, busyText: "Saving…",
          onClick: function () {
            return WFQC.saveTemplate(ctx.t, phase.name, items).then(ctx.reload);
          }
        })));
  }

  function phaseBlock(ctx, phase, members) {
    var list = specialistsFor(ctx, phase.name);
    var byUser = {};
    members.forEach(function (m) { byUser[m.username] = m; });

    var chips = O.el("div.chip-row");
    list.forEach(function (u) {
      var chip = O.el("span.chip", null,
        document.createTextNode(byUser[u] ? label(byUser[u]) : u));
      chip.appendChild(O.el("button", {
        type: "button", title: "Remove", html: "&times;",
        onClick: function () {
          // Clear them from every raw list name that folds into this phase.
          var spec = ctx.roster.phaseSpecialists || {};
          var names = Object.keys(spec).filter(function (n) { return O.phaseKey(n) === phase.name; });
          if (names.indexOf(phase.name) === -1) names.push(phase.name);
          return names.reduce(function (chain, n) {
            return chain.then(function () { return WFRoster.removeSpecialist(ctx.t, n, u); });
          }, Promise.resolve()).then(ctx.reload);
        }
      }));
      chips.appendChild(chip);
    });
    if (!list.length) chips.appendChild(O.el("span.hint", { text: "Anyone can pick this phase up." }));

    var sel = O.el("select", null, O.el("option", { value: "", text: "Add someone…" }));
    members.filter(function (m) { return list.indexOf(m.username) === -1; })
      .forEach(function (m) { sel.appendChild(O.el("option", { value: m.username, text: label(m) })); });

    return O.el("div.phase-block", null,
      O.el("h3", { text: phase.name }),
      O.el("div.hint", { text: "Shows up first when this phase needs handing out." }),
      chips,
      O.el("div.add-row", null, sel,
        O.btn("Add", {
          onClick: function () {
            if (!sel.value) return;
            return WFRoster.addSpecialist(ctx.t, phase.name, sel.value).then(ctx.reload);
          }
        })));
  }

  O.tab({
    id: "roster",
    label: "Roster",
    roles: ["manager"],   // only managers change who can do what
    render: function (ctx) {
      return Promise.all([
        WFRest.getLiveRatesCardDesc(ctx.t).catch(function () { return null; }),
        WFQC.getTemplates(ctx.t).catch(function () { return {}; })
      ]).then(function (loaded) {
        var desc = loaded[0], qcTemplates = loaded[1] || {};
        var rates = desc ? WFMetrics.parseRatesCardDesc(desc) : {};
        var syncedAt = desc && desc.match(/Last synced:\s*(.+)/);
        var members = (ctx.board.members || []).slice()
          .sort(function (a, b) { return label(a).localeCompare(label(b)); });
        var managers = ctx.roster.managers || [];
        var specialists = ctx.roster.phaseSpecialists || {};

        // Show one tag per phase, not per underlying list, so someone on two
        // Install lists reads as "Install" once.
        var phasesFor = function (username) {
          var seen = {}, out = [];
          Object.keys(specialists).forEach(function (p) {
            if ((specialists[p] || []).indexOf(username) === -1) return;
            var key = O.phaseKey(p);
            if (!seen[key]) { seen[key] = true; out.push(key); }
          });
          return out;
        };

        var head = O.el("div.wf-pagehead", null,
          O.el("div.wf-h1", { text: "Who's on the crew" }),
          O.el("div.wf-sub", {
            text: members.length + " people on this board · " + managers.length +
                  (managers.length === 1 ? " manager" : " managers")
          }));

        var people = O.panel("Everyone on the board",
          Object.keys(rates).length
            ? "rates synced from QuickBooks" + (syncedAt ? " · " + syncedAt[1].trim() : "")
            : "no QuickBooks rates synced yet");
        people.body(O.el("div.wf-cards", { style: "margin:0" }, members.map(function (m) {
          return personRow(ctx, m, rates[m.username],
            WFRoster.roleOf(ctx.roster, m.username), phasesFor(m.username));
        })));

        var out = O.el("div", null, head, people);

        // One block per phase, not per list -- the four Install lists share a
        // single Install block with one crew. See WFOps.workPhases.
        var phases = O.workPhases(ctx.boardCfg);

        out.appendChild(O.el("div.wf-group-h", { style: "margin-top:28px" },
          O.el("div.wf-group-t", { text: "Who does what" }),
          O.el("span.wf-group-n", { text: phases.length + " work phases" })));

        if (phases.length) {
          var grid = O.el("div.wf-panels.halves", { style: "margin-bottom:20px" });
          phases.forEach(function (p) { grid.appendChild(phaseBlock(ctx, p, members)); });
          out.appendChild(grid);
        } else {
          out.appendChild(O.empty("No work phases configured for this board yet."));
        }

        // Checklists only for the phases that actually gate on a peer check.
        var qcPhases = phases.filter(function (p) { return WFQC.requiresQc(p.name); });
        if (qcPhases.length) {
          out.appendChild(O.el("div.wf-group-h", { style: "margin-top:28px" },
            O.el("div.wf-group-t", { text: "Quality checklists" }),
            O.el("span.wf-group-n", { text: qcPhases.length + " gated phases" })));
          var qcGrid = O.el("div.wf-panels.halves", { style: "margin-bottom:20px" });
          qcPhases.forEach(function (p) { qcGrid.appendChild(qcTemplateBlock(ctx, p, qcTemplates)); });
          out.appendChild(qcGrid);
        }

        out.appendChild(O.el("p.muted", { text:
          "Managers and specialists save to this board, so every board can have its own crew. " +
          "Hourly rates are owned by the QuickBooks sync — change them there, not here." }));

        return out;
      });
    }
  });
})();
