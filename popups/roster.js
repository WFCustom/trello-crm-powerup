const t = TrelloPowerUp.iframe({
  appKey: window.WF_CONFIG.appKey,
  appName: "Western Fabrication Ops"
});
const content = document.getElementById("content");

function resize() {
  t.sizeTo(document.body).catch(() => {});
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function memberLabel(m) {
  return (m.fullName || m.username) + (m.username ? " (@" + m.username + ")" : "");
}

async function render() {
  content.innerHTML = '<div class="loading">Loading team roster…</div>';

  const [board, roster] = await Promise.all([
    t.board("id", "members"),
    WFRoster.getRoster(t)
  ]);

  const boardConfig = WFStage.getBoardConfig(board.id);
  const phases = boardConfig
    ? boardConfig.stages.filter((s) => s.isWorkPhase)
    : [];
  const members = board.members || [];
  const byUsername = {};
  members.forEach((m) => { byUsername[m.username] = m; });

  const managerOptions = members
    .filter((m) => roster.managers.indexOf(m.username) === -1)
    .map((m) => '<option value="' + escapeHtml(m.username) + '">' + escapeHtml(memberLabel(m)) + "</option>")
    .join("");

  const managerChips = roster.managers
    .map((u) => {
      const label = byUsername[u] ? memberLabel(byUsername[u]) : u;
      return (
        '<span class="chip">' + escapeHtml(label) +
        '<button data-action="remove-manager" data-username="' + escapeHtml(u) + '" title="Remove">&times;</button></span>'
      );
    })
    .join("");

  let phasesHtml = "";
  phases.forEach((phase) => {
    const list = roster.phaseSpecialists[phase.name] || [];
    const chips = list
      .map((u) => {
        const label = byUsername[u] ? memberLabel(byUsername[u]) : u;
        return (
          '<span class="chip">' + escapeHtml(label) +
          '<button data-action="remove-specialist" data-phase="' + escapeHtml(phase.name) +
          '" data-username="' + escapeHtml(u) + '" title="Remove">&times;</button></span>'
        );
      })
      .join("");
    const options = members
      .filter((m) => list.indexOf(m.username) === -1)
      .map((m) => '<option value="' + escapeHtml(m.username) + '">' + escapeHtml(memberLabel(m)) + "</option>")
      .join("");

    phasesHtml +=
      '<div class="phase-block">' +
      "<h3>" + escapeHtml(phase.name) + "</h3>" +
      '<div class="chip-row">' + (chips || '<span class="hint">No specialists assigned yet.</span>') + "</div>" +
      '<div class="add-row">' +
      '<select data-phase="' + escapeHtml(phase.name) + '" class="specialist-select">' +
      '<option value="">Add a worker…</option>' + options + "</select>" +
      '<button class="secondary" data-action="add-specialist" data-phase="' + escapeHtml(phase.name) + '">Add</button>' +
      "</div></div>";
  });

  content.innerHTML =
    "<h2>Managers</h2>" +
    '<div class="hint">Managers can approve phase completions and reassign work.</div>' +
    '<div class="chip-row" id="manager-chips">' + (managerChips || '<span class="hint">No managers configured yet.</span>') + "</div>" +
    '<div class="add-row">' +
    '<select id="manager-select"><option value="">Add a manager…</option>' + managerOptions + "</select>" +
    '<button class="secondary" id="add-manager-btn">Add</button>' +
    "</div>" +
    '<div id="manager-msg"></div>' +
    "<h2>Phase Specialists</h2>" +
    '<div class="hint">Workers listed here appear as suggested assignees for that phase.</div>' +
    phasesHtml +
    (phases.length === 0 ? '<div class="hint">No work-phase stages are configured for this board.</div>' : "");

  document.getElementById("add-manager-btn").addEventListener("click", async () => {
    const sel = document.getElementById("manager-select");
    const username = sel.value;
    if (!username) return;
    try {
      await WFRoster.addManager(t, username);
      await render();
    } catch (e) {
      showMsg("manager-msg", "Couldn't save: " + (e && e.message ? e.message : e), true);
    }
  });

  content.querySelectorAll('[data-action="remove-manager"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await WFRoster.removeManager(t, btn.getAttribute("data-username"));
        await render();
      } catch (e) {
        showMsg("manager-msg", "Couldn't save: " + (e && e.message ? e.message : e), true);
      }
    });
  });

  content.querySelectorAll('[data-action="add-specialist"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const phase = btn.getAttribute("data-phase");
      const sel = content.querySelector('select.specialist-select[data-phase="' + CSS.escape(phase) + '"]');
      const username = sel ? sel.value : "";
      if (!username) return;
      await WFRoster.addSpecialist(t, phase, username);
      await render();
    });
  });

  content.querySelectorAll('[data-action="remove-specialist"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      await WFRoster.removeSpecialist(t, btn.getAttribute("data-phase"), btn.getAttribute("data-username"));
      await render();
    });
  });

  resize();
}

function showMsg(id, text, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = isError ? "error" : "saved";
  el.textContent = text;
}

render().catch((e) => {
  content.innerHTML = '<div class="error">Failed to load: ' + escapeHtml(e && e.message ? e.message : e) + "</div>";
  resize();
});
