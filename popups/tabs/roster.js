/* Team roster -- who approves, who's a specialist in which phase, and what
   each person costs per hour. Managers/specialists are wired to WFRoster
   (board pluginData). Rates are read-only: they're owned by the QuickBooks
   sync, so this view shows them and says where they came from. */
(function () {
  "use strict";
  var O = WFOps;

  function label(m) { return (m.fullName || m.username); }

  function personRow(ctx, m, rate, isManager, phases) {
    return O.el("div.wf-card" + (isManager ? ".is-running" : ""), {
      style: "grid-template-columns:1.4fr 1.4fr 160px auto"
    },
      O.el("div", { style: "display:flex;align-items:center;gap:12px" },
        O.el("div.wf-avatar", { style: "background:var(--wf-steel-2)", text: O.initials(label(m)) }),
        O.el("div", null,
          O.el("div.wf-card-t", { text: label(m) }),
          O.el("div.wf-card-s", { text: "@" + m.username }))),
      O.el("div", { style: "display:flex;flex-wrap:wrap;gap:6px" },
        phases.length
          ? phases.map(function (p) { return O.tag(p, "quiet"); })
          : [O.el("span.wf-card-s", { text: "No phases assigned" })]),
      O.el("div", null,
        O.el("div.wf-card-s", { text: "Labor rate" }),
        O.el("div.wf-card-t", { text: rate != null ? "$" + rate + "/hr" : "—" })),
      O.el("div.wf-actions", null,
        isManager
          ? O.btn("Remove as manager", {
              small: true, busyText: "…",
              onClick: function () { return WFRoster.removeManager(ctx.t, m.username).then(ctx.reload); }
            })
          : O.btn("Make a manager", {
              small: true, busyText: "…",
              onClick: function () { return WFRoster.addManager(ctx.t, m.username).then(ctx.reload); }
            })));
  }

  function phaseBlock(ctx, phase, members) {
    var list = (ctx.roster.phaseSpecialists || {})[phase.name] || [];
    var byUser = {};
    members.forEach(function (m) { byUser[m.username] = m; });

    var chips = O.el("div.chip-row");
    list.forEach(function (u) {
      var chip = O.el("span.chip", null,
        document.createTextNode(byUser[u] ? label(byUser[u]) : u));
      chip.appendChild(O.el("button", {
        type: "button", title: "Remove", html: "&times;",
        onClick: function () { WFRoster.removeSpecialist(ctx.t, phase.name, u).then(ctx.reload); }
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
    managerOnly: true,
    render: function (ctx) {
      return WFRest.getLiveRatesCardDesc(ctx.t).catch(function () { return null; }).then(function (desc) {
        var rates = desc ? WFMetrics.parseRatesCardDesc(desc) : {};
        var syncedAt = desc && desc.match(/Last synced:\s*(.+)/);
        var members = (ctx.board.members || []).slice()
          .sort(function (a, b) { return label(a).localeCompare(label(b)); });
        var managers = ctx.roster.managers || [];
        var specialists = ctx.roster.phaseSpecialists || {};

        var phasesFor = function (username) {
          return Object.keys(specialists).filter(function (p) {
            return (specialists[p] || []).indexOf(username) !== -1;
          });
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
          return personRow(ctx, m, rates[m.username], managers.indexOf(m.username) !== -1, phasesFor(m.username));
        })));

        var out = O.el("div", null, head, people);

        var phases = ctx.boardCfg
          ? ctx.boardCfg.stages.filter(function (s) { return s.isWorkPhase; })
              .sort(function (a, b) { return a.order - b.order; })
          : [];

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

        out.appendChild(O.el("p.muted", { text:
          "Managers and specialists save to this board, so every board can have its own crew. " +
          "Hourly rates are owned by the QuickBooks sync — change them there, not here." }));

        return out;
      });
    }
  });
})();
