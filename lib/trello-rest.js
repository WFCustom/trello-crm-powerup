/**
 * Thin wrapper around Trello's Power-Up REST helper (t.getRestApi()).
 *
 * Why this exists: the Power-Up connector tools used elsewhere in this
 * workspace (Trello MCP) can't read/write custom fields or action history —
 * that's a connector limitation, not a Trello limitation. Real Power-Ups get
 * a first-class, secure path to this data via t.getRestApi(): Trello handles
 * the OAuth popup and token storage entirely inside the Trello UI, so nothing
 * here ever touches a raw API key/token pair typed into a chat.
 *
 * The API Key in config.js is the Power-Up's public "app key" (like a
 * client_id) — safe to ship in static files. The per-user token is obtained
 * via authorize() and never leaves the browser.
 */
(function (global) {
  const CACHE_TTL_MS = 2 * 60 * 1000;
  const cache = new Map(); // key -> { at, data }

  function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
      cache.delete(key);
      return undefined;
    }
    return hit.data;
  }

  function cacheSet(key, data) {
    cache.set(key, { at: Date.now(), data });
  }

  async function isAuthorized(t) {
    try {
      return await t.getRestApi().isAuthorized();
    } catch (e) {
      return false;
    }
  }

  async function authorize(t, scope) {
    return t.getRestApi().authorize({ scope: scope || "read,write", expiration: "never" });
  }

  async function buildUrl(t, path, params) {
    const key = window.WF_CONFIG.appKey;
    if (!key || key.indexOf("PUT_YOUR") === 0) {
      throw new Error("WF_CONFIG.appKey is not set — see README setup step 3.");
    }
    const token = await t.getRestApi().getToken();
    const qs = new URLSearchParams(Object.assign({ key: key, token: token }, params || {}));
    return "https://api.trello.com/1" + path + "?" + qs.toString();
  }

  async function request(t, path, params) {
    const url = await buildUrl(t, path, params);
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error("Trello API " + res.status + " on " + path + ": " + body.slice(0, 200));
    }
    return res.json();
  }

  // Write calls (POST/PUT/DELETE). Trello's API accepts all parameters as
  // query-string args regardless of HTTP method, so no request body needed.
  async function write(t, method, path, params) {
    const url = await buildUrl(t, path, params);
    const res = await fetch(url, { method: method });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error("Trello API " + res.status + " on " + method + " " + path + ": " + body.slice(0, 200));
    }
    // Some DELETE endpoints return no body
    const text = await res.text().catch(() => "");
    try { return JSON.parse(text); } catch (e) { return { ok: true }; }
  }

  function addMemberToCard(t, cardId, memberId) {
    return write(t, "POST", "/cards/" + cardId + "/idMembers", { value: memberId });
  }

  function moveCard(t, cardId, listId) {
    return write(t, "PUT", "/cards/" + cardId, { idList: listId });
  }

  function postComment(t, cardId, text) {
    return write(t, "POST", "/cards/" + cardId + "/actions/comments", { text: text });
  }

  // Chronological list-transition history for a card: [{ listId, listName, date }]
  // Includes the card's original list at creation, then every subsequent move.
  async function getCardListHistory(t, cardId) {
    const cacheKey = "history:" + cardId;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const actions = await request(t, "/cards/" + cardId + "/actions", {
      filter: "createCard,copyCard,updateCard:idList",
      limit: 50
    });

    // Trello returns newest-first; we want oldest-first for a timeline.
    const chrono = actions.slice().reverse();
    const history = [];
    chrono.forEach((a) => {
      if (a.type === "createCard" || a.type === "copyCard") {
        const list = a.data && a.data.list;
        if (list) history.push({ listId: list.id, listName: list.name, date: a.date });
      } else if (a.type === "updateCard" && a.data && a.data.listAfter) {
        history.push({ listId: a.data.listAfter.id, listName: a.data.listAfter.name, date: a.date });
      }
    });

    cacheSet(cacheKey, history);
    return history;
  }

  async function getBoardCustomFields(t, boardId) {
    const cacheKey = "boardFields:" + boardId;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const fields = await request(t, "/boards/" + boardId + "/customFields");
    cacheSet(cacheKey, fields);
    return fields;
  }

  async function getCardCustomFieldItems(t, cardId) {
    const cacheKey = "cardFields:" + cardId;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const items = await request(t, "/cards/" + cardId + "/customFieldItems");
    cacheSet(cacheKey, items);
    return items;
  }

  // Convenience: resolve { jobValue, jobCost, leadReceivedAt } by name for one card.
  // Returns nulls for anything not found/not yet populated by the QB/Gmail bridge.
  async function getNamedCustomFieldValues(t, boardId, cardId) {
    const names = window.WF_CONFIG.customFieldNames;
    const [boardFields, cardItems] = await Promise.all([
      getBoardCustomFields(t, boardId).catch(() => []),
      getCardCustomFieldItems(t, cardId).catch(() => [])
    ]);

    const idToName = {};
    boardFields.forEach((f) => (idToName[f.id] = f.name));

    const result = { jobValue: null, jobCost: null, leadReceivedAt: null };
    cardItems.forEach((item) => {
      const fieldName = idToName[item.idCustomField];
      if (!fieldName) return;
      const val = item.value || {};
      if (fieldName === names.jobValue) result.jobValue = parseFloat(val.number);
      if (fieldName === names.jobCost) result.jobCost = parseFloat(val.number);
      if (fieldName === names.leadReceivedAt) result.leadReceivedAt = val.date || null;
    });
    return result;
  }


  // All custom field VALUES on a card, resolved to human-readable display
  // strings (list-type fields resolved against the board's option labels).
  // Used by the My Jobs / card-back views to show style, spec, and other
  // outline custom fields production workers need without opening the card.
  async function getCardFieldsDisplay(t, boardId, cardId) {
    const [boardFields, cardItems] = await Promise.all([
      getBoardCustomFields(t, boardId).catch(() => []),
      getCardCustomFieldItems(t, cardId).catch(() => [])
    ]);
    const fieldById = {};
    boardFields.forEach((f) => (fieldById[f.id] = f));
    return cardItems
      .map((item) => {
        const field = fieldById[item.idCustomField];
        if (!field) return null;
        const val = item.value || {};
        let display = "";
        if (field.type === "list") {
          const opt = (field.options || []).find((o) => o.id === item.idValue);
          display = opt ? opt.value.text : "";
        } else if (field.type === "checkbox") {
          display = (val.checked === "true" || val.checked === true) ? "Yes" : "No";
        } else if (field.type === "date") {
          display = val.date ? new Date(val.date).toLocaleDateString() : "";
        } else if (field.type === "number") {
          display = (val.number !== undefined && val.number !== null) ? String(val.number) : "";
        } else {
          display = val.text || "";
        }
        return { name: field.name, display: display };
      })
      .filter((x) => x && x.display);
  }

  // Card attachments (CAD drawing PDFs, reference images, etc.) so workers can
  // open/zoom them straight from the My Jobs dashboard or the card back,
  // without needing to open the full card.
  async function getCardAttachments(t, cardId) {
    const cacheKey = "attachments:" + cardId;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const attachments = await request(t, "/cards/" + cardId + "/attachments", {
      fields: "name,url,mimeType,isUpload,date"
    });
    cacheSet(cacheKey, attachments);
    return attachments;
  }

  async function getBoardLists(t, boardId) {
    const cacheKey = "boardLists:" + boardId;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const lists = await request(t, "/boards/" + boardId + "/lists", { fields: "name" });
    cacheSet(cacheKey, lists);
    return lists;
  }

  // All open cards on a board in one call, with each card's Power-Up "shared"
  // storage embedded (pluginData=true) so the dashboard doesn't need one REST
  // call per card to read economics/handoff data.
  // opts.filter: "open" (default, live board view) or "all" (include
  // closed/archived cards -- needed for historical reporting like Team
  // Performance, since finished jobs get archived once billed/closed).
  async function getBoardCardsFull(t, boardId, opts) {
    const filter = (opts && opts.filter) || "open";
    const cacheKey = "boardCardsFull:" + boardId + ":" + filter;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const cards = await request(t, "/boards/" + boardId + "/cards", {
      fields: "name,idList,dateLastActivity,shortUrl,desc,closed",
      filter: filter,
      pluginData: "true"
    });
    const parsed = cards.map((c) => {
      let shared = {};
      (c.pluginData || []).forEach((pd) => {
        if (pd.scope !== "shared") return;
        try {
          const val = JSON.parse(pd.value);
          shared = Object.assign(shared, val);
        } catch (e) { /* ignore malformed plugin data */ }
      });
      return {
        id: c.id,
        name: c.name,
        idList: c.idList,
        dateLastActivity: c.dateLastActivity,
        shortUrl: c.shortUrl,
        desc: c.desc || "",
        closed: !!c.closed,
        economics: shared.economics || null,
        handoffLog: shared.handoffLog || [],
        phaseWork: shared.phaseWork || null,
        phaseLog: shared.phaseLog || []
      };
    });
    cacheSet(cacheKey, parsed);
    return parsed;
  }


  // Live hourly rates, kept in sync by the QuickBooks scheduled task writing
  // to a single reference card's description (see config.js ratesCardId).
  // Falls back to an empty object if the card isn't configured/reachable --
  // callers should then fall back to config.js hourlyRates themselves.
  async function getLiveRatesCardDesc(t) {
    const cardId = window.WF_CONFIG.ratesCardId;
    if (!cardId || cardId.indexOf("PUT_") === 0) return null;
    const cacheKey = "ratesCard:" + cardId;
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) return cached;
    try {
      const card = await request(t, "/cards/" + cardId, { fields: "desc" });
      cacheSet(cacheKey, card.desc || "");
      return card.desc || "";
    } catch (e) {
      cacheSet(cacheKey, null);
      return null;
    }
  }

  // getBoardCardsFull's results are cached for 2 minutes (see CACHE_TTL_MS),
  // but phase actions (claim/start/pause/complete) write straight to the
  // card via t.set(cardId,...) -- a path the cache has no visibility into.
  // Callers that just changed phase state must invalidate before the next
  // getBoardCardsFull call, or they'll see stale claimed/unclaimed status
  // for up to 2 minutes. See popups/myjobs.js's button() wrapper.
  function invalidateBoardCards(boardId) {
    cache.delete("boardCardsFull:" + boardId + ":open");
    cache.delete("boardCardsFull:" + boardId + ":all");
  }

  global.WFRest = {
    isAuthorized,
    authorize,
    request,
    invalidateBoardCards,
    getCardListHistory,
    getBoardCustomFields,
    getCardCustomFieldItems,
    getNamedCustomFieldValues,
    getCardFieldsDisplay,
    getCardAttachments,
    getBoardLists,
    getBoardCardsFull,
    write,
    addMemberToCard,
    moveCard,
    postComment,
    getLiveRatesCardDesc
  };
})(window);
