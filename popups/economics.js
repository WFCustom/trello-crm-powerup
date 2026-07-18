const t = TrelloPowerUp.iframe({ appKey: window.WF_CONFIG.appKey, appName: "Western Fabrication Ops" });
const content = document.getElementById("content");

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

async function tryPrefillFromQuickBooksBridge(card) {
  // If the QuickBooks/Gmail bridge scheduled task has populated Trello Custom
  // Fields on this card, offer those as a starting point (read-only source of
  // truth still lives in QuickBooks -- this just saves manual re-typing).
  try {
    const authorized = await WFRest.isAuthorized(t);
    if (!authorized) return null;
    return await WFRest.getNamedCustomFieldValues(t, card.idBoard, card.id);
  } catch (e) {
    return null;
  }
}

async function render() {
  const card = await t.card("id", "idBoard");
  const existing = (await t.get("card", "shared", "economics", null)) || {};
  const bridge = await tryPrefillFromQuickBooksBridge(card);

  const value = existing.value !== undefined ? existing.value : (bridge && bridge.jobValue) || "";
  const cost = existing.cost !== undefined ? existing.cost : (bridge && bridge.jobCost) || "";

  content.innerHTML =
    '<label>Job Value ($)</label>' +
    '<input id="value" type="number" step="1" value="' + value + '">' +
    '<label>Job Cost ($)</label>' +
    '<input id="cost" type="number" step="1" value="' + cost + '">' +
    '<div id="margin" class="section"></div>' +
    '<button class="primary" id="save">Save</button>' +
    (bridge && (bridge.jobValue || bridge.jobCost)
      ? '<p class="muted">Prefilled from QuickBooks bridge custom fields where available.</p>'
      : '<p class="muted">No QuickBooks bridge data found on this card yet -- enter manually.</p>');

  const valueInput = document.getElementById("value");
  const costInput = document.getElementById("cost");
  const marginDiv = document.getElementById("margin");

  function updateMargin() {
    const v = parseFloat(valueInput.value) || 0;
    const c = parseFloat(costInput.value) || 0;
    const margin = v - c;
    const pct = v ? Math.round((margin / v) * 1000) / 10 : null;
    marginDiv.innerHTML =
      "<strong>Margin: " + fmtMoney(margin) + (pct !== null ? " (" + pct + "%)" : "") + "</strong>";
  }
  valueInput.addEventListener("input", updateMargin);
  costInput.addEventListener("input", updateMargin);
  updateMargin();

  document.getElementById("save").addEventListener("click", async () => {
    const v = parseFloat(valueInput.value) || 0;
    const c = parseFloat(costInput.value) || 0;
    await t.set("card", "shared", "economics", { value: v, cost: c, updatedAt: new Date().toISOString() });
    t.closePopup();
  });
}

render();
