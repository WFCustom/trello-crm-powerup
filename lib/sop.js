/**
 * WFSOP -- the standard-operating-procedure library.
 *
 * WHY THE STORE IS TRELLO
 *
 * A Power-Up iframe cannot store files. Trello plugin data holds small JSON
 * blobs and nothing else, so an "upload" button in the ops window has to put
 * the bytes somewhere real. The options were Google Drive (its own OAuth inside
 * the iframe, and a second set of permissions to manage), the GitHub repo (a
 * write token sitting in a public static file -- not acceptable), or Trello.
 *
 * Trello wins because we are already authorised. A dedicated board -- WF SOP
 * Library -- holds one card per SOP, and Trello's own card attachments hold the
 * files. Real upload, real download, no new credentials and no token to expire.
 *
 * Everything stored here is a NATIVE Trello field, so nothing can drift out of
 * step with the board, and anyone who would rather work in Trello directly sees
 * the same library:
 *
 *   list         the owning position or phase, plus two lifecycle lists
 *                ("Drafts and Under Review", "Retired")
 *   card name    the SOP title
 *   description  what it is for and when to use it
 *   attachments  the documents themselves (files, or links to Drive)
 *   labels       cross-cutting topics -- safety, onboarding, equipment
 *   due date     when it next needs reviewing
 *
 * There is deliberately no parallel index in plugin data. An index would be a
 * second source of truth that a card added straight into Trello would
 * immediately contradict.
 *
 * WHY THIS FILE CARRIES ITS OWN REST CALLS
 *
 * lib/trello-rest.js is the tested spine every other view depends on, and this
 * feature needs one thing it doesn't have: a multipart POST, because a file is
 * the only Trello parameter that can't travel in the query string. Rather than
 * reopen that file, the handful of calls the library needs are built here on
 * top of WFRest.request/WFRest.write, with only the file upload written from
 * scratch. Same pattern as lib/advance.js wrapping phase.js instead of editing
 * it.
 */
(function (global) {
  "use strict";

  var FALLBACK_BOARD_ID = "6a7ced7ba19afb7d35401573";   // WF SOP Library

  /**
   * Two list names carry lifecycle meaning; everything else is a category.
   * Matched loosely on purpose -- renaming "Retired" to "Retired / Superseded"
   * in Trello shouldn't silently turn it back into a working category.
   */
  var DRAFT_HINT = /draft|review/i;
  var RETIRED_HINT = /retired|superseded|archive/i;

  function boardId() {
    var cfg = global.WF_CONFIG || {};
    return cfg.sopBoardId || FALLBACK_BOARD_ID;
  }

  function kindOf(listName) {
    if (RETIRED_HINT.test(listName)) return "retired";
    if (DRAFT_HINT.test(listName)) return "draft";
    return "active";
  }

  /* ------------------------------------------------------------- file upload */

  /**
   * The one call WFRest can't make: multipart POST.
   *
   * Trello accepts every ordinary parameter as a query arg regardless of HTTP
   * method, which is why WFRest.write sends no body at all. A file is the
   * exception -- POST /cards/{id}/attachments wants the bytes as
   * multipart/form-data. Key and token still travel in the query string, so
   * this is the same auth path as every other call in the Power-Up.
   *
   * Content-Type is deliberately NOT set: the browser has to add the multipart
   * boundary itself, and setting the header by hand omits the boundary and
   * makes Trello reject the body.
   */
  function uploadFile(t, cardId, file) {
    var key = (global.WF_CONFIG || {}).appKey;
    if (!key) return Promise.reject(new Error("WF_CONFIG.appKey is not set."));
    return Promise.resolve(t.getRestApi().getToken()).then(function (token) {
      var form = new FormData();
      form.append("file", file, file.name || "upload");
      if (file.name) form.append("name", file.name);
      var url = "https://api.trello.com/1/cards/" + cardId + "/attachments?key=" +
                encodeURIComponent(key) + "&token=" + encodeURIComponent(token);
      return fetch(url, { method: "POST", body: form });
    }).then(function (res) {
      if (res.ok) return res.json().catch(function () { return { ok: true }; });
      return res.text().catch(function () { return ""; }).then(function (body) {
        throw new Error("Trello rejected the upload (" + res.status + "): " + body.slice(0, 160));
      });
    });
  }

  /**
   * A URL that reliably hands back the file itself.
   *
   * An uploaded attachment's `url` is a trello.com asset path, which the browser
   * may render inline rather than save. Trello's /download/ route always returns
   * the bytes with a filename, and authenticates off the Trello session cookie
   * the person is already signed in with -- so it works from a plain link and
   * needs no key or token in the URL.
   *
   * Links (isUpload false) point at somebody else's document; return untouched.
   */
  function downloadUrl(cardId, att) {
    if (!att) return "";
    if (!att.isUpload) return att.url;
    return "https://trello.com/1/cards/" + cardId + "/attachments/" + att.id +
           "/download/" + encodeURIComponent(att.name || "document");
  }

  /* ------------------------------------------------------------ attachments */

  /**
   * An SOP's files, newest first, split into the one in force and the ones it
   * replaced.
   *
   * Replacing a document is an upload, not an edit: the old file stays on the
   * card so "what did the procedure say in March" is still answerable. The
   * newest upload is therefore the current one and everything older is a
   * previous version. Links are kept apart -- a Drive link points at a living
   * document that versions itself, so it never becomes "previous".
   */
  function documents(sop) {
    var all = ((sop && sop.attachments) || []).slice().sort(function (a, b) {
      return new Date(b.date || 0) - new Date(a.date || 0);
    });
    var files = all.filter(function (a) { return a.isUpload; });
    var links = all.filter(function (a) { return !a.isUpload; });
    return {
      current: files[0] || links[0] || null,
      files: files,
      links: links,
      previous: files.slice(1),
      count: all.length
    };
  }

  function isImage(att) {
    return /^image\//.test((att && att.mimeType) || "") ||
           /\.(png|jpe?g|gif|webp|svg)$/i.test((att && att.name) || "");
  }

  function isPdf(att) {
    return /pdf/i.test((att && att.mimeType) || "") || /\.pdf$/i.test((att && att.name) || "");
  }

  function sizeText(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return Math.round(bytes / 1024) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  /* ---------------------------------------------------------------- reviews */

  /**
   * How overdue a review is. The card's native due date IS the review date, so
   * it also shows as a due badge to anyone browsing the board in Trello.
   * "none" is not a failure -- plenty of SOPs need no scheduled review.
   */
  function reviewStatus(sop) {
    if (!sop || !sop.due) return { state: "none", days: null };
    var days = (new Date(sop.due).getTime() - Date.now()) / 86400000;
    if (sop.dueComplete) return { state: "ok", days: days };
    if (days < 0) return { state: "overdue", days: days };
    if (days <= 30) return { state: "due", days: days };
    return { state: "ok", days: days };
  }

  /* ------------------------------------------------------------------- load */

  /**
   * The whole library in three REST calls: lists, cards (with attachments
   * inlined), labels. Read fresh rather than through WFRest's cache, because an
   * upload has to appear the moment it lands. A shop this size will have tens of
   * SOPs, not thousands, so one pass over the board is cheap.
   */
  function load(t) {
    var id = boardId();
    return Promise.all([
      WFRest.request(t, "/boards/" + id + "/lists", { fields: "name" }),
      WFRest.request(t, "/boards/" + id + "/cards", {
        fields: "name,desc,idList,idLabels,due,dueComplete,shortUrl,dateLastActivity,closed",
        filter: "open",
        attachments: "true",
        attachment_fields: "name,url,mimeType,bytes,isUpload,date"
      }),
      WFRest.request(t, "/boards/" + id + "/labels", { fields: "name,color", limit: 100 })
        .catch(function () { return []; })
    ]).then(function (r) {
      var lists = r[0] || [], cards = r[1] || [], labels = r[2] || [];

      var categories = lists.map(function (l, i) {
        return { id: l.id, name: l.name, kind: kindOf(l.name), order: i, count: 0 };
      });
      var catById = {};
      categories.forEach(function (c) { catById[c.id] = c; });

      var labelById = {};
      labels.forEach(function (l) { labelById[l.id] = l; });

      var sops = cards.filter(function (c) { return !c.closed; }).map(function (c) {
        var cat = catById[c.idList];
        if (cat) cat.count++;
        var sop = {
          id: c.id,
          name: c.name || "Untitled",
          desc: c.desc || "",
          categoryId: c.idList,
          category: cat ? cat.name : "Uncategorised",
          kind: cat ? cat.kind : "active",
          url: c.shortUrl,
          due: c.due || null,
          dueComplete: !!c.dueComplete,
          updatedAt: c.dateLastActivity,
          attachments: (c.attachments || []).map(function (a) {
            return {
              id: a.id, name: a.name, url: a.url, mimeType: a.mimeType,
              bytes: a.bytes, isUpload: !!a.isUpload, date: a.date
            };
          }),
          labels: (c.idLabels || []).map(function (lid) { return labelById[lid]; })
                    .filter(Boolean)
        };
        sop.docs = documents(sop);
        sop.review = reviewStatus(sop);
        return sop;
      });

      return { boardId: id, categories: categories, labels: labels, sops: sops };
    });
  }

  /* ----------------------------------------------------------------- search */

  /**
   * Free-text match over the parts a person would actually remember: the title,
   * what it is for, the category, its labels, and the filenames on it. Every
   * whitespace-separated term must match something, so "install safety" narrows
   * rather than widens.
   */
  function search(sops, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return sops || [];
    var terms = q.split(/\s+/);
    return (sops || []).filter(function (s) {
      var hay = [
        s.name, s.desc, s.category,
        (s.labels || []).map(function (l) { return l.name; }).join(" "),
        (s.attachments || []).map(function (a) { return a.name; }).join(" ")
      ].join(" ").toLowerCase();
      return terms.every(function (term) { return hay.indexOf(term) !== -1; });
    });
  }

  /* ----------------------------------------------------------------- writes */

  function createSOP(t, fields) {
    return WFRest.write(t, "POST", "/cards", {
      idList: fields.categoryId,
      name: fields.name,
      desc: fields.desc || "",
      pos: "bottom"
    });
  }

  function updateSOP(t, cardId, fields) {
    var params = {};
    if (fields.name !== undefined) params.name = fields.name;
    if (fields.desc !== undefined) params.desc = fields.desc;
    if (fields.categoryId !== undefined) params.idList = fields.categoryId;
    // An empty string is how Trello is told to clear a due date; a key that
    // isn't sent at all leaves the existing value alone.
    if (fields.due !== undefined) params.due = fields.due || "";
    if (fields.dueComplete !== undefined) params.dueComplete = !!fields.dueComplete;
    return WFRest.write(t, "PUT", "/cards/" + cardId, params);
  }

  function retire(t, cardId, categories) {
    var target = (categories || []).filter(function (c) { return c.kind === "retired"; })[0];
    if (!target) return Promise.reject(new Error('There is no "Retired" list on the SOP board.'));
    return WFRest.write(t, "PUT", "/cards/" + cardId, { idList: target.id });
  }

  function attachLink(t, cardId, url, name) {
    if (!/^https?:\/\//i.test(String(url || "").trim())) {
      return Promise.reject(new Error("That doesn't look like a web address -- it needs to start with https://"));
    }
    var params = { url: String(url).trim() };
    if (name) params.name = name;
    return WFRest.write(t, "POST", "/cards/" + cardId + "/attachments", params);
  }

  function removeDocument(t, cardId, attachmentId) {
    return WFRest.write(t, "DELETE", "/cards/" + cardId + "/attachments/" + attachmentId);
  }

  function toggleLabel(t, cardId, labelId, on) {
    return on
      ? WFRest.write(t, "POST", "/cards/" + cardId + "/idLabels", { value: labelId })
      : WFRest.write(t, "DELETE", "/cards/" + cardId + "/idLabels/" + labelId);
  }

  global.WFSOP = {
    boardId: boardId,
    kindOf: kindOf,
    load: load,
    search: search,
    documents: documents,
    reviewStatus: reviewStatus,
    downloadUrl: downloadUrl,
    isImage: isImage,
    isPdf: isPdf,
    sizeText: sizeText,
    createSOP: createSOP,
    updateSOP: updateSOP,
    retire: retire,
    uploadFile: uploadFile,
    attachLink: attachLink,
    removeDocument: removeDocument,
    toggleLabel: toggleLabel
  };
})(window);
