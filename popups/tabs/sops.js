/* SOPs -- the company's standard operating procedures, by position and phase.
   Read by everyone: a welder needs to be able to find the powder-coat startup
   sheet without asking. Written by managers and office only.

   Files live on the WF SOP Library board as Trello card attachments -- see the
   header comment in lib/sop.js for why the store is Trello rather than Drive.
   Wired to WFSOP. */
(function () {
  "use strict";
  var O = WFOps;

  /**
   * The three rules this tab needs that styles.css doesn't already have.
   *
   * They live here rather than in styles.css so the SOP library is a pure
   * addition -- two new files and two script tags -- with nothing edited in a
   * stylesheet every other view depends on. If more views end up needing them,
   * that's the point to move them across.
   */
  (function injectStyles() {
    if (document.getElementById("wf-sop-styles")) return;
    var css =
      /* View / Download / Open are real anchors, so the browser handles the
         download itself, but they should read as buttons. */
      "a.wf-btn{text-decoration:none}" +
      /* A full-width bordered box is the wrong shape for a file picker. */
      'input[type="file"]{padding:8px 10px;font-size:13px;background:var(--wf-band);' +
      "border-style:dashed;cursor:pointer}" +
      /* Keep long procedure text readable rather than edge to edge. */
      ".wf-sop-prose{font-size:14.5px;line-height:1.6;white-space:pre-wrap;max-width:70ch}";
    var tag = document.createElement("style");
    tag.id = "wf-sop-styles";
    tag.textContent = css;
    document.head.appendChild(tag);
  })();

  /* Tab-scoped state, deliberately at module level so switching away to the
     Work board and back puts you on the same SOP you were reading. */
  var state = {
    data: null,          // { categories, labels, sops }
    query: "",
    categoryId: "all",
    labelId: null,
    openId: null,        // the SOP being read, or null for the library list
    host: null,
    ctx: null
  };

  function canEdit(ctx) { return ctx.role === "manager" || ctx.role === "office"; }

  function byId(list, id) {
    return (list || []).filter(function (x) { return x.id === id; })[0] || null;
  }

  /**
   * appendChild with a null tolerated.
   *
   * O.el() skips null children, so it's easy to assume appendChild does too --
   * it doesn't, it throws. Several blocks here return null by design (a worker
   * gets no attention strip; a board with no named labels gets no topic bar),
   * and appending one of those took the whole tab down with "parameter 1 is not
   * of type 'Node'".
   */
  function add(parent, node) {
    if (node) parent.appendChild(node);
    return parent;
  }

  function when(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  /* ------------------------------------------------------------- repainting */

  /** Rebuild the tab's contents from state.data without re-fetching. */
  function paint() {
    if (!state.host) return;
    state.host.innerHTML = "";
    add(state.host, state.openId ? detailView() : libraryView());
  }

  /** Re-read the library from Trello, then repaint. */
  function refresh() {
    return WFSOP.load(state.ctx.t).then(function (data) {
      state.data = data;
      // The SOP we were reading may have been retired or moved by someone else.
      if (state.openId && !byId(data.sops, state.openId)) state.openId = null;
      paint();
    }).catch(function (e) {
      if (!state.host) return;
      state.host.innerHTML = "";
      state.host.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "Couldn't reach the SOP library." }),
        O.el("div.muted", { text: (e && e.message) || String(e) }),
        O.btn("Try again", { onClick: refresh })));
    });
  }

  /* ----------------------------------------------------------- shared bits */

  /** A link styled as a button. Real anchors, so downloads behave normally. */
  function linkBtn(label, url, opts) {
    opts = opts || {};
    var a = O.el("a.wf-btn" + (opts.primary ? ".wf-btn-primary" : ".wf-btn-quiet") +
      (opts.small ? ".wf-btn-sm" : ""), {
      href: url, target: "_blank", rel: "noopener", text: label,
      style: "text-decoration:none"
    });
    if (opts.download) a.setAttribute("download", "");
    return a;
  }

  function reviewTag(sop) {
    var r = sop.review || { state: "none" };
    if (r.state === "overdue") {
      return O.tag("review overdue " + O.elapsedPhrase(Math.abs(r.days)), "late");
    }
    if (r.state === "due") return O.tag("review due " + when(sop.due), "warn");
    return null;
  }

  function kindTag(sop) {
    if (sop.kind === "draft") return O.tag("draft", "warn");
    if (sop.kind === "retired") return O.tag("retired", "quiet");
    return null;
  }

  function labelChips(sop) {
    if (!sop.labels || !sop.labels.length) return null;
    return O.el("span", { style: "display:inline-flex;gap:6px;flex-wrap:wrap" },
      sop.labels.map(function (l) {
        return O.el("span.wf-tag.wf-tag-quiet", { style: "font-size:11.5px;padding:2px 9px",
          text: l.name || l.color });
      }));
  }

  /* -------------------------------------------------------------- filtering */

  function visibleSOPs() {
    var all = (state.data && state.data.sops) || [];
    var out = all;

    if (state.categoryId === "all") {
      // "All" means the working library -- retired procedures are still there
      // if you go looking for them, but they shouldn't clutter a search for
      // how to do the job today.
      out = out.filter(function (s) { return s.kind !== "retired"; });
    } else {
      out = out.filter(function (s) { return s.categoryId === state.categoryId; });
    }

    if (state.labelId) {
      out = out.filter(function (s) {
        return (s.labels || []).some(function (l) { return l.id === state.labelId; });
      });
    }
    return WFSOP.search(out, state.query);
  }

  /* ------------------------------------------------------------- library view */

  function filterBar() {
    var cats = (state.data.categories || []).slice().sort(function (a, b) {
      return a.order - b.order;
    });
    var row = O.el("div.chip-row", { style: "margin:0 0 6px" });

    function chip(label, count, isOn, onClick) {
      var c = O.el("button.wf-btn.wf-btn-sm" + (isOn ? ".wf-btn-primary" : ".wf-btn-quiet"), {
        type: "button", onClick: onClick
      }, document.createTextNode(label));
      if (count) c.appendChild(O.el("span.wf-badge", { text: String(count) }));
      return c;
    }

    var working = (state.data.sops || []).filter(function (s) { return s.kind !== "retired"; });
    row.appendChild(chip("All", working.length, state.categoryId === "all", function () {
      state.categoryId = "all"; paint();
    }));
    cats.forEach(function (c) {
      if (!c.count && c.kind !== "active") return;      // hide empty Drafts/Retired
      row.appendChild(chip(c.name, c.count, state.categoryId === c.id, function () {
        state.categoryId = c.id; paint();
      }));
    });
    return row;
  }

  function labelBar() {
    var labels = (state.data.labels || []).filter(function (l) { return l.name; });
    if (!labels.length) return null;
    var row = O.el("div.chip-row", { style: "margin:0 0 14px;align-items:center" },
      O.el("span.hint", { text: "Topic:" }));
    labels.forEach(function (l) {
      var on = state.labelId === l.id;
      row.appendChild(O.el("button.wf-btn.wf-btn-sm" + (on ? "" : ".wf-btn-quiet"), {
        type: "button", text: l.name,
        onClick: function () { state.labelId = on ? null : l.id; paint(); }
      }));
    });
    if (state.labelId) {
      row.appendChild(O.el("button.wf-btn.wf-btn-sm.wf-btn-quiet", {
        type: "button", text: "clear",
        onClick: function () { state.labelId = null; paint(); }
      }));
    }
    return row;
  }

  function sopRow(ctx, sop) {
    var docs = sop.docs || { count: 0 };
    var docNote = docs.count
      ? docs.count + (docs.count === 1 ? " document" : " documents")
      : "no document attached yet";

    var actions = O.el("div.wf-actions");
    if (docs.current) {
      actions.appendChild(linkBtn("Open", docs.current.url, { small: true, primary: true }));
    }
    actions.appendChild(O.btn("Details", {
      small: true, quiet: true,
      onClick: function () { state.openId = sop.id; paint(); }
    }));

    return O.el("div.wf-card" + (docs.count ? "" : ".is-review"), {
      style: "grid-template-columns:1.7fr 1fr auto"
    },
      O.el("div", null,
        O.el("div.wf-card-t", { text: sop.name }),
        O.el("div.wf-card-s", { text: sop.category + " · " + docNote +
          (sop.updatedAt ? " · updated " + when(sop.updatedAt) : "") }),
        sop.desc ? O.el("div.hint", { style: "margin-top:6px",
          text: sop.desc.length > 160 ? sop.desc.slice(0, 160) + "…" : sop.desc }) : null),
      O.el("div", { style: "display:flex;flex-wrap:wrap;gap:6px;align-items:center" },
        kindTag(sop), reviewTag(sop), labelChips(sop)),
      actions);
  }

  /** Grouped by category when showing everything; a flat list when filtered. */
  function groupedList(ctx, sops) {
    if (state.categoryId !== "all" || state.query) {
      return O.el("div.wf-cards", null, sops.map(function (s) { return sopRow(ctx, s); }));
    }
    var wrap = O.el("div");
    var cats = (state.data.categories || []).slice().sort(function (a, b) { return a.order - b.order; });
    cats.forEach(function (c) {
      var rows = sops.filter(function (s) { return s.categoryId === c.id; });
      if (!rows.length) return;
      wrap.appendChild(O.el("div.wf-group-h", null,
        O.el("div.wf-group-t", { text: c.name }),
        O.el("span.wf-group-n", { text: rows.length +
          (rows.length === 1 ? " procedure" : " procedures") }),
        c.kind === "draft" ? O.tag("not in force yet", "warn") : null));
      wrap.appendChild(O.el("div.wf-cards", null, rows.map(function (s) { return sopRow(ctx, s); })));
    });
    return wrap;
  }

  /** Anything overdue for review, for the people who can act on it. */
  function attentionStrip(ctx) {
    if (!canEdit(ctx)) return null;
    var late = (state.data.sops || []).filter(function (s) {
      return s.kind !== "retired" && s.review && s.review.state === "overdue";
    });
    var blank = (state.data.sops || []).filter(function (s) {
      return s.kind === "active" && (!s.docs || !s.docs.count);
    });
    if (!late.length && !blank.length) return null;

    var lines = [];
    if (late.length) lines.push(late.length + (late.length === 1 ? " procedure is" : " procedures are") + " overdue for review");
    if (blank.length) lines.push(blank.length + (blank.length === 1 ? " has" : " have") + " no document attached");

    return O.el("div.wf-callout", { style: "margin-bottom:20px" },
      O.el("div.wf-callout-k", { text: "Needs attention" }),
      O.el("div", { style: "font-size:14px;margin-top:4px", text: lines.join(" · ") }));
  }

  function libraryView() {
    var ctx = state.ctx;
    var out = O.el("div");

    var search = O.el("input", {
      type: "search", placeholder: "Search procedures, files, topics…",
      value: state.query, style: "width:280px"
    });
    // Repainting on every keystroke would move focus out of the box, so keep
    // the node and only swap the results below it.
    var results = O.el("div");
    search.addEventListener("input", function () {
      state.query = search.value;
      results.innerHTML = "";
      add(results, resultsBlock(ctx));
    });

    var head = O.el("div.wf-pagehead", null,
      O.el("div.wf-h1", { text: "SOPs" }),
      O.el("div.wf-sub", { text: "Standard operating procedures, by position and phase" }),
      O.el("div", { class: "wf-spacer", style: "display:flex;gap:10px;align-items:center" },
        search,
        canEdit(ctx) ? O.btn("New SOP", { primary: true, onClick: function () { openNew(ctx); } }) : null,
        linkBtn("Open the board", "https://trello.com/b/5dZGtGIg/wf-sop-library", { small: true })));

    add(out, head);
    add(out, attentionStrip(ctx));
    add(out, filterBar());
    add(out, labelBar());
    add(results, resultsBlock(ctx));
    add(out, results);
    return out;
  }

  function resultsBlock(ctx) {
    var sops = visibleSOPs();
    if (!sops.length) {
      return O.empty(state.query
        ? "Nothing matches “" + state.query + "”."
        : "No procedures here yet." +
          (canEdit(ctx) ? " Use New SOP to add the first one." : ""));
    }
    return groupedList(ctx, sops);
  }

  /* -------------------------------------------------------------- detail view */

  function docRow(ctx, sop, att, isCurrent) {
    var meta = [
      att.isUpload ? "file" : "link",
      WFSOP.sizeText(att.bytes),
      att.date ? "added " + when(att.date) : ""
    ].filter(Boolean).join(" · ");

    var actions = O.el("div.wf-actions", null,
      linkBtn("View", att.url, { small: true, primary: isCurrent }));
    if (att.isUpload) {
      actions.appendChild(linkBtn("Download", WFSOP.downloadUrl(sop.id, att), { small: true }));
    }
    if (canEdit(ctx)) {
      actions.appendChild(O.btn("Remove", {
        small: true, quiet: true, busyText: "Removing…",
        onClick: function () {
          if (!window.confirm("Remove “" + att.name + "” from this SOP?")) return;
          return WFSOP.removeDocument(ctx.t, sop.id, att.id).then(refresh);
        }
      }));
    }

    return O.el("div.wf-card", { style: "grid-template-columns:1fr auto;padding:14px 18px" },
      O.el("div", null,
        O.el("div", { style: "font-size:14.5px;font-weight:600;color:var(--wf-navy)", text: att.name }),
        O.el("div.wf-card-s", { text: meta })),
      actions);
  }

  /** File picker + link box. Uploading a newer file supersedes, never replaces. */
  function uploadBlock(ctx, sop) {
    var status = O.el("div.hint", { style: "margin-top:8px" });

    var file = O.el("input", { type: "file", multiple: true, style: "font-size:13px" });
    file.addEventListener("change", function () {
      var files = Array.prototype.slice.call(file.files || []);
      if (!files.length) return;
      status.textContent = "Uploading " + files.length + (files.length === 1 ? " file…" : " files…");
      status.className = "hint";
      // One at a time: Trello rate-limits, and a partial success is easier to
      // read than a burst of parallel failures.
      var i = 0;
      function next() {
        if (i >= files.length) return;
        var f = files[i++];
        status.textContent = "Uploading " + f.name + " (" + i + " of " + files.length + ")…";
        return WFSOP.uploadFile(ctx.t, sop.id, f).then(next);
      }
      return Promise.resolve().then(next).then(function () {
        file.value = "";
        status.className = "saved";
        status.textContent = "Uploaded.";
        return refresh();
      }).catch(function (e) {
        status.className = "error";
        status.textContent = (e && e.message) || "That upload didn't go through.";
      });
    });

    var url = O.el("input", { type: "url", placeholder: "…or paste a Google Drive / web link" });
    var name = O.el("input", { type: "text", placeholder: "What to call it (optional)" });

    return O.el("div", null,
      O.el("div", { style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap" }, file),
      O.el("div", { style: "display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap" },
        O.el("div", { style: "flex:1;min-width:220px" }, url),
        O.el("div", { style: "flex:1;min-width:160px" }, name),
        O.btn("Attach link", {
          busyText: "Attaching…",
          onClick: function () {
            if (!url.value.trim()) return;
            return WFSOP.attachLink(ctx.t, sop.id, url.value, name.value.trim() || null)
              .then(function () { url.value = ""; name.value = ""; return refresh(); });
          }
        })),
      status,
      O.el("div.hint", { style: "margin-top:10px",
        text: "Uploading a newer file doesn't delete the old one — it becomes a " +
              "previous version, so you can still see what the procedure said before." }));
  }

  function metaBlock(ctx, sop) {
    if (!canEdit(ctx)) {
      return O.el("div", null,
        sop.desc ? O.el("div.wf-sop-prose", { text: sop.desc })
                 : O.el("div.muted", { text: "No summary written yet." }));
    }

    var title = O.el("input", { type: "text", value: sop.name });
    var desc = O.el("textarea", { rows: "6", style: "width:100%",
      placeholder: "What is this for, and when does someone use it?" });
    desc.value = sop.desc || "";

    var cat = O.el("select");
    (state.data.categories || []).slice().sort(function (a, b) { return a.order - b.order; })
      .forEach(function (c) {
        var o = O.el("option", { value: c.id, text: c.name });
        if (c.id === sop.categoryId) o.selected = true;
        cat.appendChild(o);
      });

    var due = O.el("input", { type: "date", value: sop.due ? String(sop.due).slice(0, 10) : "" });
    var status = O.el("div.hint", { style: "margin-top:10px" });

    return O.el("div", null,
      O.el("div", { style: "display:flex;gap:12px;flex-wrap:wrap" },
        O.el("div", { style: "flex:2;min-width:240px" },
          O.el("div.hint", { text: "Title" }), title),
        O.el("div", { style: "flex:1;min-width:180px" },
          O.el("div.hint", { text: "Position / phase" }), cat),
        O.el("div", { style: "flex:1;min-width:150px" },
          O.el("div.hint", { text: "Review by" }), due)),
      O.el("div", { style: "margin-top:14px" },
        O.el("div.hint", { text: "What it's for" }), desc),
      O.el("div.wf-actions", { style: "margin-top:14px" },
        O.btn("Save", {
          primary: true, busyText: "Saving…",
          onClick: function () {
            if (!title.value.trim()) {
              status.className = "error"; status.textContent = "It needs a title.";
              return;
            }
            return WFSOP.updateSOP(ctx.t, sop.id, {
              name: title.value.trim(),
              desc: desc.value,
              categoryId: cat.value,
              due: due.value ? new Date(due.value + "T12:00:00").toISOString() : ""
            }).then(function () {
              status.className = "saved"; status.textContent = "Saved.";
              return refresh();
            });
          }
        }),
        sop.kind !== "retired" ? O.btn("Retire this SOP", {
          quiet: true, busyText: "Retiring…",
          onClick: function () {
            if (!window.confirm("Move “" + sop.name + "” to Retired? Nothing is deleted.")) return;
            return WFSOP.retire(ctx.t, sop.id, state.data.categories).then(refresh);
          }
        }) : null),
      status);
  }

  function topicBlock(ctx, sop) {
    var labels = (state.data.labels || []).filter(function (l) { return l.name; });
    if (!labels.length) {
      return O.el("div.hint", { text: "No topic tags on the SOP board yet." });
    }
    var row = O.el("div.chip-row", { style: "margin:0" });

    if (!canEdit(ctx)) {
      // Read-only: show what it's tagged with, and don't dress it up as
      // something clickable that then does nothing.
      var mine = sop.labels || [];
      if (!mine.length) return O.el("div.hint", { text: "No topics tagged." });
      mine.forEach(function (l) { row.appendChild(O.tag(l.name, "quiet")); });
      return row;
    }

    labels.forEach(function (l) {
      var on = (sop.labels || []).some(function (x) { return x.id === l.id; });
      row.appendChild(O.btn(l.name, {
        small: true, quiet: !on, primary: on,
        busyText: "…",
        onClick: function () {
          return WFSOP.toggleLabel(ctx.t, sop.id, l.id, !on).then(refresh);
        }
      }));
    });
    return row;
  }

  function detailView() {
    var ctx = state.ctx;
    var sop = byId(state.data.sops, state.openId);
    if (!sop) { state.openId = null; return libraryView(); }
    var docs = sop.docs || {};

    var out = O.el("div");
    out.appendChild(O.el("div.wf-pagehead", null,
      O.btn("← Back to the library", { quiet: true, small: true,
        onClick: function () { state.openId = null; paint(); } }),
      O.el("div.wf-h1", { text: sop.name }),
      kindTag(sop), reviewTag(sop),
      O.el("div", { class: "wf-spacer", style: "display:flex;gap:10px" },
        docs.current ? linkBtn("Open current version", docs.current.url, { primary: true }) : null,
        linkBtn("Open in Trello", sop.url, { small: true }))));

    out.appendChild(O.el("div.wf-sub", { style: "margin:-12px 0 22px",
      text: sop.category + (sop.updatedAt ? " · last touched " + when(sop.updatedAt) : "") }));

    var docPanel = O.panel("Documents",
      docs.count ? null : "Nothing attached yet — this SOP is a title with no procedure behind it.");
    if (docs.current) {
      docPanel.appendChild(O.el("div.wf-cards", { style: "margin-bottom:0" },
        docRow(ctx, sop, docs.current, true)));
    }
    if (docs.links && docs.links.length && docs.links[0] !== docs.current) {
      docPanel.appendChild(O.el("div.wf-group-h", { style: "margin-top:20px" },
        O.el("div.wf-group-t", { style: "font-size:15px", text: "Links" })));
      docPanel.appendChild(O.el("div.wf-cards", { style: "margin-bottom:0" },
        docs.links.filter(function (a) { return a !== docs.current; })
          .map(function (a) { return docRow(ctx, sop, a, false); })));
    }
    if (docs.previous && docs.previous.length) {
      docPanel.appendChild(O.el("div.wf-group-h", { style: "margin-top:20px" },
        O.el("div.wf-group-t", { style: "font-size:15px", text: "Previous versions" }),
        O.el("span.wf-group-n", { text: String(docs.previous.length) })));
      docPanel.appendChild(O.el("div.wf-cards", { style: "margin-bottom:0" },
        docs.previous.map(function (a) { return docRow(ctx, sop, a, false); })));
    }
    if (canEdit(ctx)) {
      docPanel.appendChild(O.el("div", { style: "margin-top:20px;padding-top:18px;" +
        "border-top:1px solid var(--wf-band)" }, uploadBlock(ctx, sop)));
    }
    out.appendChild(docPanel);

    var infoPanel = O.panel(canEdit(ctx) ? "Details" : "What it's for");
    infoPanel.appendChild(metaBlock(ctx, sop));
    infoPanel.appendChild(O.el("div", { style: "margin-top:20px;padding-top:18px;" +
      "border-top:1px solid var(--wf-band)" },
      O.el("div.hint", { style: "margin-bottom:8px", text: "Topics" }),
      topicBlock(ctx, sop)));
    out.appendChild(infoPanel);

    return out;
  }

  /* ---------------------------------------------------------------- new SOP */

  function openNew(ctx) {
    var title = O.el("input", { type: "text", placeholder: "e.g. Powder coat line startup" });
    var cat = O.el("select");
    (state.data.categories || []).slice().sort(function (a, b) { return a.order - b.order; })
      .forEach(function (c) {
        cat.appendChild(O.el("option", { value: c.id, text: c.name }));
      });
    var desc = O.el("textarea", { rows: "4", style: "width:100%",
      placeholder: "What is this for, and when does someone use it?" });

    O.dialog({
      title: "New SOP",
      note: "This creates the entry. You attach the document to it on the next screen.",
      content: O.el("div", null,
        O.el("div.hint", { text: "Title" }), title,
        O.el("div.hint", { style: "margin-top:12px", text: "Position / phase" }), cat,
        O.el("div.hint", { style: "margin-top:12px", text: "What it's for" }), desc),
      buttons: [{
        label: "Create it", primary: true, busyText: "Creating…",
        onClick: function () {
          if (!title.value.trim()) {
            window.alert("Give it a title first.");
            return Promise.reject(new Error("title required"));
          }
          return WFSOP.createSOP(ctx.t, {
            name: title.value.trim(), categoryId: cat.value, desc: desc.value
          }).then(function (card) {
            if (card && card.id) state.openId = card.id;   // straight to attaching a file
            return refresh();
          });
        }
      }]
    });
  }

  /* -------------------------------------------------------------------- tab */

  O.tab({
    id: "sops",
    label: "SOPs",
    // No roles: everyone can read the procedures for their job. Write actions
    // are gated inside on canEdit() rather than by hiding the whole tab.
    render: function (ctx) {
      state.ctx = ctx;
      state.host = O.el("div");
      // First open loads; after that we repaint from what we already have, so
      // coming back to the tab is instant and keeps your place.
      if (state.data) { paint(); return state.host; }
      state.host.appendChild(O.el("div.loading", { text: "Opening the SOP library…" }));
      return refresh().then(function () { return state.host; });
    }
  });
})();
