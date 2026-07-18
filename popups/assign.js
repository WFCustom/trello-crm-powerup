const t = TrelloPowerUp.iframe({ appKey: window.WF_CONFIG.appKey, appName: "Western Fabrication Ops" });
const content = document.getElementById("content");

async function render() {
  const [card, manager, board] = await Promise.all([
    t.card("id", "idList", "idBoard"),
    t.member("id", "username", "fullName"),
    t.board("members")
  ]);

  if (!WFStage.isManager(manager.username)) {
    content.innerHTML = '<p class="muted">This action is limited to managers listed in config.js.</p>';
    return;
  }

  const members = board.members || [];
  if (!members.length) {
    content.innerHTML = '<p class="muted">No board members found.</p>';
    return;
  }

  content.innerHTML =
    "<label>Assign to</label>" +
    '<select id="worker">' +
    members.map((m) => '<option value="' + m.id + '">' + (m.fullName || m.username) + "</option>").join("") +
    "</select>" +
    '<button class="primary" id="go">Assign</button>';

  document.getElementById("go").addEventListener("click", async () => {
    const workerId = document.getElementById("worker").value;
    const worker = members.find((m) => m.id === workerId);
    await WFPhase.assign(t, card, manager, { id: worker.id, username: worker.username, fullName: worker.fullName || worker.username });
    t.closePopup();
  });
}

render();
