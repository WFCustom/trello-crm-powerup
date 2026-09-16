/* Team roster -- who approves, who's a specialist in which phase, and what
   each person costs per hour. Managers/specialists are wired to WFRoster
   (board pluginData). Rates are read-only: they're owned by the QuickBooks
   sync, so this view shows them and says where they came from. */
(function () {
  "use strict";
  var O = WFOps;

  function label(m) { return (m.fullName || m.username); }

  /* Which section of the rail you were last on. Module-level so it survives
     leaving the tab and coming back -- the whole point of the rail is that you
     do not have to go looking for the thing you were working on. */
  var section = "crew";

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

  /**
   * Hourly rate, editable here. QuickBooks wins when a sync exists -- in that
   * case the figure is shown read-only with where it came from, because typing
   * over a synced rate would just be overwritten on the next run. Until then
   * this is the only source of labour cost, and with no rate every job reads
   * 100% margin, which is worse than useless.
   */
  function rateCell(ctx, m, syncedRate) {
    if (syncedRate != null) {
      return O.el("div", null,
        O.el("div.wf-card-s", { text: "Rate · from QuickBooks" }),
        O.el("div.wf-card-t", { text: "$" + syncedRate + "/hr" }));
    }
    var manual = (ctx.roster.rates || {})[m.username];
    var input = O.el("input", {
      type: "number", min: "0", step: "1", placeholder: "—",
      value: manual != null ? String(manual) : "",
      style: "width:78px;padding:5px 8px"
    });
    function save() {
      return WFRoster.setRate(ctx.t, m.username, input.value).then(ctx.reload);
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); save(); }
    });
    return O.el("div", null,
      O.el("div.wf-card-s", { text: manual != null ? "Rate · entered by hand" : "Rate · not set" }),
      O.el("div", { style: "display:flex;align-items:center;gap:6px;margin-top:2px" },
        O.el("span.wf-card-s", { text: "$" }), input,
        O.btn("Save", { small: true, quiet: true, busyText: "…", onClick: save })));
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
      rateCell(ctx, m, rate),
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
  /* ===================================================== who sees what
   *
   * Lives in the Roster because this is a fact about people, and because the
   * tab bar is already too long to earn another entry. Only somebody holding
   * `permissions.manage` sees any of it.
   */

  /**
   * The preset editor: a grid of capability against scope.
   *
   * Presets are edited rather than chosen from, because the whole point is that
   * the owner decides what "shop manager" means at this company rather than
   * inheriting what it meant at mine.
   */
  function permsPane(ctx, cfg) {
    var note = O.el("div.hint", { style: "margin-top:8px" });

    var chosen = O.el("select", { style: "width:auto;padding:6px 10px;border-radius:9px" });
    WFPerms.presetIds(cfg).forEach(function (id) {
      chosen.appendChild(O.el("option", { value: id, text: cfg.presets[id].label || id }));
    });

    var grid = O.el("div");
    function paintGrid() {
      var preset = cfg.presets[chosen.value];
      grid.innerHTML = "";
      if (!preset) return;

      grid.appendChild(O.el("div.hint", { style: "margin-bottom:10px", text: preset.note || "" }));

      WFPerms.groups().forEach(function (group) {
        grid.appendChild(O.el("div.wf-card-s", {
          style: "margin-top:12px;font-weight:700;text-transform:uppercase;letter-spacing:.07em",
          text: group
        }));

        WFPerms.caps().filter(function (c) { return c.group === group; }).forEach(function (cap) {
          var current = preset.caps[cap.id] || "none";

          var pick = O.el("select", { style: "width:auto;padding:4px 8px;border-radius:8px" });
          var options = cap.scoped
            ? ["none", "own", "crew", "area", "all"]
            : ["none", "all"];
          options.forEach(function (s) {
            var text = s === "none" ? "No"
              : s === "all" ? (cap.scoped ? "Everyone's" : "Yes")
              : s === "own" ? "Only their own"
              : s === "crew" ? "Their crew"
              : "Their area";
            var o = O.el("option", { value: s, text: text });
            if (s === current) o.selected = true;
            pick.appendChild(o);
          });

          pick.addEventListener("change", function () {
            if (pick.value === "none") delete preset.caps[cap.id];
            else preset.caps[cap.id] = pick.value;
            // The lockout guard runs on every change, not only on save, so the
            // screen can never show you a state it would refuse to store.
            WFPerms.guard(cfg);
            note.textContent = lockNote(cfg, chosen.value, cap.id);
          });

          var row = O.el("div", {
            style: "display:flex;gap:10px;align-items:baseline;padding:5px 0;flex-wrap:wrap"
          },
            O.el("div", { style: "flex:1 1 260px;min-width:0" },
              O.el("div", { style: "font-size:13.5px;font-weight:600", text: cap.label }),
              cap.note ? O.el("div.hint", { text: cap.note }) : null),
            pick);
          grid.appendChild(row);
        });
      });
    }

    chosen.addEventListener("change", function () { paintGrid(); note.textContent = ""; });
    paintGrid();

    return O.el("div", null,
      O.el("div", {
        style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px"
      },
        O.el("label", { style: "margin:0", text: "Group" }),
        chosen),
      O.el("div.hint", { style: "margin-bottom:10px", text:
        "This decides what people are shown, not what a determined person could " +
        "extract from a browser. Trello's own board permissions are the real " +
        "enforcement — treat this as focus, not a lock." }),
      grid,
      note);
  }

  /** Say so out loud when the guard has put something back. */
  function lockNote(cfg, presetId, capId) {
    if (capId !== "permissions.manage") return "";
    if (cfg.presets[presetId] && cfg.presets[presetId].caps["permissions.manage"]) return "";
    var holders = WFPerms.presetIds(cfg).filter(function (id) {
      return cfg.presets[id].caps["permissions.manage"];
    });
    if (holders.indexOf(presetId) !== -1) {
      return "Put back — somebody has to be able to reach this screen.";
    }
    return "Still held by: " + holders.map(function (id) {
      return cfg.presets[id].label || id;
    }).join(", ") + ".";
  }

  /**
   * Which preset each person is on, and whether they have been adjusted.
   *
   * A per-person override is deliberately NOT edited here. Naming who is a shop
   * manager is an everyday decision; carving an exception into one person's
   * grants is a rare one, and putting both on the same screen makes the rare
   * one look routine.
   */
  function peoplePane(ctx, cfg, members) {
    var rows = O.el("div");

    members.forEach(function (m) {
      var pick = O.el("select", { style: "width:auto;padding:4px 8px;border-radius:8px" });
      WFPerms.presetIds(cfg).forEach(function (id) {
        var o = O.el("option", { value: id, text: cfg.presets[id].label || id });
        if (id === WFPerms.presetOf(cfg, m.username)) o.selected = true;
        pick.appendChild(o);
      });
      pick.addEventListener("change", function () {
        cfg.people[m.username] = cfg.people[m.username] || { preset: "worker", caps: {} };
        cfg.people[m.username].preset = pick.value;
      });

      var tags = [];
      if (WFPerms.isFloor(m.username)) {
        tags.push(O.tag("always everything", "go"));
        pick.disabled = true;
      }
      if (WFPerms.isCustomised(cfg, m.username)) tags.push(O.tag("adjusted", "warn"));

      rows.appendChild(O.el("div", {
        style: "display:flex;gap:10px;align-items:center;padding:6px 0;flex-wrap:wrap"
      },
        O.el("div", { style: "flex:1 1 200px", text: label(m) }),
        pick,
        O.el("div.wf-actions", null, tags)));
    });

    return O.el("div", null,
      O.el("div.hint", { style: "margin-bottom:10px", text:
        "People named as managers in config.js always hold everything — that is " +
        "the floor that makes a bad save recoverable, and it can't be switched " +
        "off from here." }),
      rows);
  }

  /**
   * Access: one block, two views of the same thing.
   *
   * Access Levels answers "who is in which group", Permissions answers "what
   * that group can do". They were two panels side by side, which made them look
   * like unrelated settings when they are two halves of one sentence -- and it
   * meant two Save buttons over one record, so saving one could quietly discard
   * an unsaved edit in the other.
   *
   * Now: one working copy, one Save, and a tab strip. Whichever tab you are on,
   * you are editing the same draft.
   */
  function accessBlock(ctx, perms, members) {
    var cfg = JSON.parse(JSON.stringify(perms));
    var body = O.el("div");

    var TABS = [
      { id: "levels", label: "Access Levels",
        build: function () { return peoplePane(ctx, cfg, members); } },
      { id: "perms", label: "Permissions",
        build: function () { return permsPane(ctx, cfg); } }
    ];

    var strip = O.el("div", {
      style: "display:flex;gap:6px;margin:0 0 14px;padding:4px;border-radius:999px;" +
             "background:var(--wf-band);align-self:flex-start"
    });

    var current = "levels";
    function show(id) {
      current = id;
      Array.prototype.forEach.call(strip.children, function (b) {
        b.classList.toggle("is-active", b.getAttribute("data-tab") === id);
      });
      body.innerHTML = "";
      body.appendChild(TABS.filter(function (t) { return t.id === id; })[0].build());
    }

    TABS.forEach(function (t) {
      var b = O.el("button.wf-tab", { type: "button", text: t.label });
      b.setAttribute("data-tab", t.id);
      b.addEventListener("click", function () { show(t.id); });
      strip.appendChild(b);
    });

    var saved = O.el("span.hint");
    show(current);

    return O.el("div.phase-block", null,
      O.el("div", { style: "display:flex;align-items:center;gap:12px;flex-wrap:wrap" },
        O.el("h3", { style: "margin:0", text: "Access" }),
        saved),
      O.el("div", { style: "display:flex;flex-direction:column" }, strip),
      body,
      O.el("div", { style: "margin-top:14px" },
        O.btn("Save access", {
          primary: true, busyText: "Saving…",
          // One save for both tabs, because both edit the same record. Two
          // buttons over one record is how an unsaved edit gets thrown away.
          onClick: function () {
            return WFPerms.save(ctx.t, cfg).then(function () {
              saved.textContent = "Saved";
              return ctx.reload();
            });
          }
        })));
  }

  /** Make a new list from nothing. This is the thing that stops needing code. */
  function newChecklistRow(ctx, templates) {
    var name = O.el("input", {
      type: "text", placeholder: "Name a new checklist, e.g. Powder booth",
      style: "flex:1 1 240px"
    });
    var note = O.el("span.hint");

    function create() {
      var v = name.value.trim();
      if (!v) return;
      if (templates[v]) { note.textContent = "There's already a list called that."; return; }
      note.textContent = "";
      // Created empty on purpose: a list seeded with somebody else's items is a
      // list people delete line by line before they can use it.
      return WFQC.saveLibraryEntry(ctx.t, v, []).then(ctx.reload);
    }
    name.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); create(); }
    });

    return O.el("div.add-row", { style: "margin-bottom:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap" },
      name,
      O.btn("Create checklist", { primary: true, busyText: "Creating…", onClick: create }),
      note);
  }

  function qcTemplateBlock(ctx, phase, templates) {
    // An unsaved phase shows the shipped draft so the list isn't blank; a phase
    // saved as empty stays empty, because [] is truthy and wins here.
    var raw = Array.isArray(templates[phase.name])
      ? templates[phase.name]
      : (WFQC.defaultStationItems(phase.name) || WFQC.defaultTemplate(phase.name));
    // Items carry a tolerance now. Old lists are plain strings; normalise so
    // one editor handles both and nobody has to migrate anything.
    var items = (raw || []).map(WFQC.normItem);
    var unsaved = !Array.isArray(templates[phase.name]);
    var selfCheck = !phase.custom && WFQC.requiresSelfCheck(phase.name);
    var listWrap = O.el("div");

    /* Items are editable in place -- reword one without deleting and retyping.
       Reordering matters too: a checker works the list top to bottom. */
    function paint() {
      listWrap.innerHTML = "";
      if (!items.length) {
        listWrap.appendChild(O.el("div.hint", { text: "No checklist yet — the checker just confirms the work is right." }));
      }
      items.forEach(function (item, i) {
        var field = O.el("input", { type: "text", value: item.text, style: "flex:2 1 150px" });
        field.addEventListener("input", function () { items[i].text = field.value; });
        // The tolerance is what turns a line anybody can tick in good conscience
        // into one they can actually fail.
        var spec = O.el("input", {
          type: "text", value: item.spec || "",
          placeholder: "Tolerance (optional)",
          style: "flex:1 1 120px;font-size:12.5px"
        });
        spec.addEventListener("input", function () { items[i].spec = spec.value; });
        listWrap.appendChild(O.el("div", { style: "display:flex;align-items:center;gap:6px;padding:4px 0;flex-wrap:wrap" },
          O.el("span.wf-card-s", { style: "width:18px;text-align:right", text: (i + 1) + "." }),
          field, spec,
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
      items.push({ text: v, spec: "" }); input.value = ""; paint();
    }

    var actions = O.el("div", { style: "margin-top:12px;display:flex;gap:8px;flex-wrap:wrap" },
      O.btn("Save checklist", {
        primary: true, busyText: "Saving…",
        onClick: function () {
          return WFQC.saveLibraryEntry(ctx.t, phase.name, items).then(ctx.reload);
        }
      }));

    // Only lists somebody made here can be deleted. A phase's list can be
    // emptied but not removed, because the phase still exists and a station
    // pointed at it would silently fall back to a draft.
    if (phase.custom) {
      actions.appendChild(O.btn("Delete this list", {
        danger: true, busyText: "Deleting…",
        onClick: function () {
          return WFQC.deleteLibraryEntry(ctx.t, phase.name).then(ctx.reload);
        }
      }));
    }

    return O.el("div.phase-block", null,
      O.el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" },
        O.el("h3", { style: "margin:0", text: phase.name }),
        phase.custom
          ? O.tag("custom list", "quiet")
          : (selfCheck ? O.tag("self-checked", "warn") : O.tag("peer-checked", "go")),
        unsaved ? O.tag("draft — not saved yet", "quiet") : null),
      O.el("div.hint", { style: "margin-top:6px", text: phase.custom
        ? "Point a station at this by name in the Floor gear, or name it after a "
          + "phase or a kind of station and it gets picked up automatically."
        : selfCheck
          ? "The person who does " + phase.name + " ticks this themselves before the job moves on. "
            + "No second signature, and an unticked line just means it isn't finished."
          : "What a peer checks before this phase moves on. Changes affect future checks only." }),
      listWrap,
      O.el("div.add-row", { style: "margin-top:10px" }, input,
        O.btn("Add", { onClick: addItem })),
      actions);
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

        // One block per phase, not per list -- the four Install lists share a
        // single Install block with one crew. See WFOps.workPhases.
        var phases = O.workPhases(ctx.boardCfg);

        var qcPhases = phases.filter(function (p) { return WFQC.needsChecklist(p.name); });
        var phaseNames = {};
        qcPhases.forEach(function (p) { phaseNames[p.name] = true; });
        var extras = Object.keys(qcTemplates).filter(function (n) { return !phaseNames[n]; }).sort();

        /* ================================================== the sections
         *
         * Four things live here and only two of them are about people. Stacked
         * down one page it was a long scroll past a slew of semi-related
         * settings to reach whichever one you actually came for -- and the
         * checklist library, which is edited often, sat at the bottom.
         *
         * A rail that swaps the screen, same as the EOS tab: you land on the
         * crew, and everything else is one click rather than a scroll.
         */
        var SECTIONS = [
          {
            id: "crew", label: "Crew",
            count: members.length + (members.length === 1 ? " person" : " people"),
            build: function () {
              var people = O.panel("Everyone on the board",
                Object.keys(rates).length
                  ? "rates synced from QuickBooks" + (syncedAt ? " · " + syncedAt[1].trim() : "")
                  : "no QuickBooks rates synced yet");
              people.body(O.el("div.wf-cards", { style: "margin:0" }, members.map(function (m) {
                return personRow(ctx, m, rates[m.username],
                  WFRoster.roleOf(ctx.roster, m.username), phasesFor(m.username));
              })));
              return people;
            }
          },
          {
            id: "phases", label: "Who does what",
            count: phases.length + " work phases",
            build: function () {
              if (!phases.length) {
                return O.empty("No work phases configured for this board yet.");
              }
              var grid = O.el("div.wf-panels.halves");
              phases.forEach(function (p) { grid.appendChild(phaseBlock(ctx, p, members)); });
              return grid;
            }
          },
          {
            id: "checklists", label: "Checklists",
            count: (qcPhases.length + extras.length) + " lists",
            build: function () {
              var wrap = O.el("div", null,
                O.el("p.muted", { style: "margin:0 0 12px", text:
                  "A station works the list whose name matches its checklist setting, its " +
                  "phase, or its kind — so a list called \"Powder booth\" is picked up by " +
                  "the powder booth without touching its setup. Editing a list never " +
                  "changes a check somebody already signed." }),
                newChecklistRow(ctx, qcTemplates));
              var qcGrid = O.el("div.wf-panels.halves");
              qcPhases.forEach(function (p) {
                qcGrid.appendChild(qcTemplateBlock(ctx, p, qcTemplates));
              });
              extras.forEach(function (n) {
                qcGrid.appendChild(qcTemplateBlock(ctx, { name: n, custom: true }, qcTemplates));
              });
              wrap.appendChild(qcGrid);
              return wrap;
            }
          }
        ];

        /* Access is gated on the capability rather than on a role, so the
           screen that decides who can do what is governed by the same answer it
           gives. Absent entirely for anyone without it -- a locked tab still
           tells you the setting exists and that you are not trusted with it. */
        if (ctx.can && ctx.can("permissions.manage") && ctx.perms) {
          SECTIONS.push({
            id: "access", label: "Access",
            count: WFPerms.presetIds(ctx.perms).length + " groups",
            build: function () { return accessBlock(ctx, ctx.perms, members); }
          });
        }

        var head = O.el("div.wf-pagehead", null,
          O.el("div.wf-h1", { text: "Who's on the crew" }),
          O.el("div.wf-sub", {
            text: members.length + " people on this board · " + managers.length +
                  (managers.length === 1 ? " manager" : " managers")
          }));

        var rail = O.el("div.wf-tabbar", {
          style: "background:transparent;padding:0 0 16px;gap:8px;flex-wrap:wrap"
        });
        var pane = O.el("div");

        function show(id) {
          section = id;
          Array.prototype.forEach.call(rail.children, function (b) {
            b.classList.toggle("is-active", b.getAttribute("data-sec") === id);
          });
          pane.innerHTML = "";
          var s = SECTIONS.filter(function (x) { return x.id === id; })[0] || SECTIONS[0];
          pane.appendChild(s.build());
        }

        SECTIONS.forEach(function (s) {
          var b = O.el("button.wf-tab", { type: "button" },
            O.el("span", { text: s.label }),
            O.el("span.wf-group-n", { style: "font-size:11px;padding:1px 8px", text: s.count }));
          b.setAttribute("data-sec", s.id);
          b.addEventListener("click", function () { show(s.id); });
          rail.appendChild(b);
        });

        var out = O.el("div", null, head, rail, pane);

        // Come back to the section you were last on. Managers live in one of
        // these four and bouncing them to Crew every time is the same friction
        // the rail was meant to remove.
        show(SECTIONS.some(function (s) { return s.id === section; }) ? section : SECTIONS[0].id);

        out.appendChild(O.el("p.muted", { style: "margin-top:24px", text:
          "Everything here saves to this board, so every board can have its own crew. " +
          "Hourly rates are owned by the QuickBooks sync — change them there, not here." }));

        return out;
      });
    }
  });
})();
