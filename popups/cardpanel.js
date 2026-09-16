/**
 * WFCardPanel -- a Trello card, drawn and edited in place.
 *
 * This is the piece the mockup had and the build didn't. Every list of jobs in
 * this Power-Up used to end at "open in Trello", which is a one-way door: you
 * lose the dashboard you were reading, the drill-down you opened, and the
 * station column you were standing in front of. The panel renders the card
 * itself -- cover, labels, members, due, fields, description, checklists,
 * files, comments -- and an X puts you back exactly where you were.
 *
 * TWO SHAPES, ONE BODY
 *
 *   inline(ctx, card, opts)  a plain element the caller drops into a column.
 *                            The Floor tab swaps it in over a station.
 *   sheet(ctx, card, opts)   the same body inside a centred overlay.
 *                            The Dashboard opens it over the drill-down list.
 *
 * Both take `opts.onBack` -- the label and handler for the close control -- so
 * "× close" and "‹ Back to list" are the same code path.
 *
 * WHY IT SAVES ON BLUR AND NOT ON A SAVE BUTTON
 *
 * A station screen is touched with gloves on, sideways, in passing. A Save
 * button that must be found and pressed is a button that doesn't get pressed,
 * and the edit is lost silently. Fields commit when you leave them and show a
 * brief "Saved" instead -- and because a failed write is the dangerous case,
 * a failure puts the old value back and says so rather than leaving a number
 * on screen that isn't in Trello.
 *
 * WHAT IT REFUSES TO DO
 *
 * It does not show money to the shop. WFCardView.visibleFields drops financial
 * custom fields for the worker role, and editRights withholds title, due date
 * and description from anyone who isn't manager or office -- see lib/cardview.js
 * for why those two live together.
 */
(function () {
  "use strict";

  var O = WFOps;
  var V = WFCardView;

  /* ------------------------------------------------------------------ styling */

  var CSS = [
    ".wf-cp{display:flex;flex-direction:column;min-height:0;height:100%;",
    "  background:#fff;border-radius:16px;overflow:hidden;color:var(--wf-ink,#12213a)}",
    ".wf-cp-head{display:flex;align-items:center;gap:10px;padding:12px 14px;",
    "  border-bottom:1px solid var(--wf-line,#e4e9f0);flex:0 0 auto}",
    ".wf-cp-kicker{font-size:10px;letter-spacing:.09em;text-transform:uppercase;",
    "  font-weight:800;color:var(--wf-muted,#5b6b80);white-space:nowrap}",
    ".wf-cp-crumb{font-size:12px;color:var(--wf-muted,#5b6b80);overflow:hidden;",
    "  text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}",
    ".wf-cp-x{flex:0 0 auto;border:1px solid var(--wf-line,#e4e9f0);background:#fff;",
    "  border-radius:999px;min-width:30px;height:30px;padding:0 10px;cursor:pointer;",
    "  font:inherit;font-size:13px;font-weight:700;color:var(--wf-muted,#5b6b80)}",
    ".wf-cp-x:hover{background:#f3f5f8;color:var(--wf-ink,#12213a)}",
    ".wf-cp-body{overflow:auto;padding:14px;display:flex;flex-direction:column;gap:14px;",
    "  flex:1 1 auto;min-height:0}",
    ".wf-cp-cover{width:100%;aspect-ratio:16/10;background:#e4e9f0;border-radius:12px;",
    "  object-fit:contain;display:block}",
    ".wf-cp-title{font-size:19px;font-weight:700;line-height:1.25;margin:0;",
    "  border:1px solid transparent;border-radius:8px;padding:3px 5px;margin-left:-5px}",
    ".wf-cp-title[contenteditable=true]:hover{border-color:var(--wf-line,#e4e9f0)}",
    ".wf-cp-title[contenteditable=true]:focus{border-color:var(--wf-accent,#e8a317);outline:none;background:#fffdf6}",
    ".wf-cp-labels{display:flex;flex-wrap:wrap;gap:6px}",
    ".wf-cp-label{font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;",
    "  color:#fff;border-radius:999px;padding:4px 10px}",
    ".wf-cp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:9px}",
    ".wf-cp-cell{background:#f3f5f8;border-radius:11px;padding:8px 11px;min-width:0}",
    ".wf-cp-k{font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;font-weight:800;",
    "  color:var(--wf-muted,#5b6b80);margin-bottom:3px}",
    ".wf-cp-v{font-size:13.5px;font-weight:600;word-break:break-word}",
    ".wf-cp-v.is-late{color:var(--wf-bad,#d9482e)}",
    ".wf-cp-v.is-done{color:var(--wf-good,#1f9d63)}",
    ".wf-cp-avs{display:flex;gap:5px;flex-wrap:wrap}",
    ".wf-cp-av{width:26px;height:26px;border-radius:999px;background:#0f2340;color:#fff;",
    "  font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center}",
    ".wf-cp-sec{display:flex;flex-direction:column;gap:7px}",
    ".wf-cp-h{font-size:10px;letter-spacing:.09em;text-transform:uppercase;font-weight:800;",
    "  color:var(--wf-muted,#5b6b80)}",
    ".wf-cp-desc{font-size:13.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;",
    "  border:1px solid transparent;border-radius:9px;padding:7px 9px;margin:-7px -9px}",
    ".wf-cp-desc.is-edit:hover{border-color:var(--wf-line,#e4e9f0)}",
    ".wf-cp-ta{width:100%;font:inherit;font-size:13.5px;line-height:1.55;padding:8px 10px;",
    "  border:1px solid var(--wf-accent,#e8a317);border-radius:9px;background:#fffdf6;",
    "  resize:vertical;min-height:110px;box-sizing:border-box}",
    ".wf-cp-ck{display:flex;align-items:flex-start;gap:9px;font-size:13.5px;padding:4px 0;",
    "  cursor:pointer;line-height:1.4}",
    ".wf-cp-ck input{margin:2px 0 0;width:16px;height:16px;flex:0 0 auto;cursor:pointer}",
    ".wf-cp-ck.is-done span{text-decoration:line-through;color:var(--wf-muted,#5b6b80)}",
    ".wf-cp-bar{height:7px;border-radius:999px;background:var(--wf-line,#cfd7e2);overflow:hidden}",
    ".wf-cp-bar i{display:block;height:100%;background:var(--wf-good,#1f9d63);border-radius:999px}",
    ".wf-cp-file{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:9px;",
    "  background:#f3f5f8;font-size:13px;cursor:pointer;border:1px solid transparent;",
    "  width:100%;text-align:left;font-family:inherit;color:inherit}",
    ".wf-cp-file:hover{border-color:var(--wf-line,#e4e9f0)}",
    ".wf-cp-tag{font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;",
    "  background:#0f2340;color:#fff;border-radius:999px;padding:3px 7px;flex:0 0 auto}",
    ".wf-cp-fname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}",
    ".wf-cp-frame{width:100%;height:320px;border:1px solid var(--wf-line,#e4e9f0);",
    "  border-radius:11px;background:#fff}",
    ".wf-cp-cmt{display:flex;gap:9px;align-items:flex-start;font-size:13px;line-height:1.5}",
    ".wf-cp-cmt-b{flex:1 1 auto;min-width:0}",
    ".wf-cp-cmt-w{font-weight:700;font-size:12px}",
    ".wf-cp-cmt-t{color:var(--wf-muted,#5b6b80);font-size:11px;margin-left:6px;font-weight:500}",
    ".wf-cp-cmt-x{white-space:pre-wrap;word-break:break-word;margin-top:2px}",
    ".wf-cp-note{font-size:11.5px;color:var(--wf-muted,#5b6b80)}",
    ".wf-cp-note.is-bad{color:var(--wf-bad,#d9482e);font-weight:600}",
    ".wf-cp-note.is-ok{color:var(--wf-good,#1f9d63);font-weight:600}",
    ".wf-cp-foot{flex:0 0 auto;border-top:1px solid var(--wf-line,#e4e9f0);padding:10px 14px;",
    "  display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
    ".wf-cp-sheet{position:fixed;inset:0;background:rgba(20,41,61,.5);z-index:10000;",
    "  display:flex;align-items:center;justify-content:center;padding:20px}",
    ".wf-cp-sheet>.wf-cp{width:100%;max-width:640px;max-height:88vh;",
    "  box-shadow:0 24px 60px rgba(9,20,38,.4)}",
    "@media (max-width:640px){.wf-cp-sheet{padding:0}",
    "  .wf-cp-sheet>.wf-cp{max-width:none;max-height:100vh;height:100vh;border-radius:0}",
    "  .wf-cp-frame{height:220px}}"
  ].join("");

  function ensureStyles() {
    if (document.getElementById("wf-cp-styles")) return;
    var s = document.createElement("style");
    s.id = "wf-cp-styles";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* --------------------------------------------------------------- small parts */

  function cell(k, v, tone) {
    return O.el("div.wf-cp-cell", null,
      O.el("div.wf-cp-k", { text: k }),
      O.el("div.wf-cp-v" + (tone ? "." + tone : ""), { text: v }));
  }

  function section(title, body) {
    var s = O.el("div.wf-cp-sec");
    if (title) s.appendChild(O.el("div.wf-cp-h", { text: title }));
    if (body) s.appendChild(body);
    return s;
  }

  function ago(iso) {
    var ms = Date.now() - new Date(iso).getTime();
    var m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    var d = Math.round(h / 24);
    if (d < 30) return d + "d ago";
    return new Date(iso).toLocaleDateString();
  }

  /**
   * A field that saves when you leave it.
   *
   * `commit` returns a promise. On success the note reads "Saved" and fades;
   * on failure the old value goes back on screen, because a field showing a
   * number Trello never accepted is worse than a field that admits it failed.
   */
  function autosave(node, read, write, note) {
    var original = read();
    node.addEventListener("blur", function () {
      var now = read();
      if (now === original) return;
      note.className = "wf-cp-note";
      note.textContent = "Saving…";
      write(now).then(function () {
        original = now;
        note.className = "wf-cp-note is-ok";
        note.textContent = "Saved";
        setTimeout(function () { if (note.textContent === "Saved") note.textContent = ""; }, 2200);
      }, function (e) {
        // Put the old value back. A field left showing something Trello never
        // accepted is the one outcome worse than a failed save.
        if (node.isContentEditable || node.getAttribute("contenteditable") === "true") {
          node.textContent = original;
        } else {
          node.value = original;
        }
        note.className = "wf-cp-note is-bad";
        note.textContent = "Didn't save — " + (e && e.message ? e.message : "try again");
      });
    });
  }

  /* ------------------------------------------------------------------- the body */

  /**
   * Draw the card. `card` is the full record from WFRest.getCardDetail.
   *
   * Returns { node, refresh } -- refresh re-reads the card and repaints in
   * place, which is what the caller wants after the Floor tab writes to it.
   */
  function body(ctx, card, opts) {
    opts = opts || {};
    var rights = V.editRights(ctx.role);
    var wrap = O.el("div.wf-cp-body");

    /* cover -------------------------------------------------------------- */
    var cover = V.coverFrom(card);
    if (cover) {
      wrap.appendChild(O.el("img.wf-cp-cover", { src: cover, alt: "", loading: "lazy" }));
    }

    /* title -------------------------------------------------------------- */
    var titleNote = O.el("div.wf-cp-note");
    var title = O.el("h2.wf-cp-title", { text: card.name || "Untitled" });
    if (rights.title) {
      title.setAttribute("contenteditable", "true");
      title.setAttribute("spellcheck", "false");
      autosave(title,
        function () { return title.textContent.trim(); },
        function (v) {
          if (!v) return Promise.reject(new Error("a card needs a name"));
          return WFRest.updateCard(ctx.t, card.id, { name: v });
        }, titleNote);
    }
    wrap.appendChild(title);
    wrap.appendChild(titleNote);

    /* labels ------------------------------------------------------------- */
    var labels = V.labels(card);
    if (labels.length) {
      wrap.appendChild(O.el("div.wf-cp-labels", null, labels.map(function (l) {
        return O.el("span.wf-cp-label", { style: "background:" + l.hex, text: l.name });
      })));
    }

    /* members · due · custom fields -------------------------------------- */
    var grid = O.el("div.wf-cp-grid");

    var mem = V.members(card);
    if (mem.length) {
      var avs = O.el("div.wf-cp-avs", null, mem.map(function (m) {
        return O.el("div.wf-cp-av", { title: m.name, text: m.initials });
      }));
      var mcell = O.el("div.wf-cp-cell", null, O.el("div.wf-cp-k", { text: "Members" }), avs);
      grid.appendChild(mcell);
    }

    var due = V.dueState(card);
    if (rights.due && !opts.readOnlyDue) {
      var dueNote = O.el("div.wf-cp-note");
      var input = O.el("input", {
        type: "datetime-local",
        style: "font:inherit;font-size:13px;border:1px solid var(--wf-line,#e4e9f0);" +
               "border-radius:8px;padding:4px 6px;width:100%;box-sizing:border-box"
      });
      if (due.iso) input.value = toLocalInput(due.iso);
      autosave(input,
        function () { return input.value; },
        function (v) {
          return WFRest.updateCard(ctx.t, card.id,
            { due: v ? new Date(v).toISOString() : "null" });
        }, dueNote);
      grid.appendChild(O.el("div.wf-cp-cell", null,
        O.el("div.wf-cp-k", { text: "Due" + (due.late ? " · past" : "") }), input, dueNote));
    } else {
      grid.appendChild(cell("Due", due.text,
        due.late ? "is-late" : (due.done ? "is-done" : null)));
    }

    wrap.appendChild(grid);

    // Custom fields arrive separately and are the slowest part; the grid is
    // already on screen, so they fill in rather than holding everything up.
    var fieldsCell = O.el("div.wf-cp-note", { text: "Reading card fields…" });
    wrap.appendChild(fieldsCell);
    WFRest.getCardFieldsDisplay(ctx.t, card.idBoard || ctx.board.id, card.id)
      .then(function (list) {
        var shown = V.visibleFields(list, ctx.role);
        var hidden = (list || []).length - shown.length;
        fieldsCell.textContent = "";
        fieldsCell.className = "";
        if (shown.length) {
          var g2 = O.el("div.wf-cp-grid");
          shown.forEach(function (f) { g2.appendChild(cell(f.name, f.display)); });
          fieldsCell.appendChild(g2);
        }
        if (hidden > 0) {
          fieldsCell.appendChild(O.el("div.wf-cp-note", {
            style: "margin-top:6px",
            text: hidden + (hidden === 1 ? " field is" : " fields are") +
                  " costing information, not shown on shop screens."
          }));
        }
        if (!shown.length && !hidden) {
          fieldsCell.className = "wf-cp-note";
          fieldsCell.textContent = "No card fields filled in.";
        }
      })
      .catch(function () {
        fieldsCell.className = "wf-cp-note is-bad";
        fieldsCell.textContent = "Couldn't read the card's fields.";
      });

    /* description -------------------------------------------------------- */
    var descNote = O.el("div.wf-cp-note");
    var desc = O.el("div.wf-cp-desc" + (rights.description ? ".is-edit" : ""), {
      text: card.desc || (rights.description ? "Add a description…" : "No description.")
    });
    if (!card.desc) desc.style.color = "var(--wf-muted,#5b6b80)";
    if (rights.description) {
      desc.addEventListener("click", function () {
        var ta = O.el("textarea.wf-cp-ta");
        ta.value = card.desc || "";
        desc.parentNode.replaceChild(ta, desc);
        ta.focus();
        autosave(ta,
          function () { return ta.value; },
          function (v) {
            return WFRest.updateCard(ctx.t, card.id, { desc: v }).then(function () {
              card.desc = v;
            });
          }, descNote);
        ta.addEventListener("blur", function () {
          setTimeout(function () {
            if (!ta.parentNode) return;
            desc.textContent = card.desc || "Add a description…";
            desc.style.color = card.desc ? "" : "var(--wf-muted,#5b6b80)";
            ta.parentNode.replaceChild(desc, ta);
          }, 60);
        });
      });
    }
    wrap.appendChild(section("Description", desc));
    wrap.appendChild(descNote);

    /* checklists --------------------------------------------------------- */
    var lists = V.checklists(card);
    if (lists.length) {
      var prog = V.checklistProgress(card);
      var bar = O.el("div.wf-cp-bar", null,
        O.el("i", { style: "width:" + (prog.pct || 0) + "%" }));
      var ckSec = section("Checklist · " + prog.done + " of " + prog.total, bar);
      var ckNote = O.el("div.wf-cp-note");

      lists.forEach(function (l) {
        if (lists.length > 1) {
          ckSec.appendChild(O.el("div.wf-cp-k", { style: "margin-top:6px", text: l.name }));
        }
        l.items.forEach(function (it) {
          var box = O.el("input", { type: "checkbox" });
          box.checked = it.done;
          var row = O.el("label.wf-cp-ck" + (it.done ? ".is-done" : ""), null,
            box, O.el("span", { text: it.name }));
          box.addEventListener("change", function () {
            var want = box.checked;
            box.disabled = true;
            ckNote.className = "wf-cp-note";
            ckNote.textContent = "Saving…";
            WFRest.setCheckItem(ctx.t, card.id, it.id, want ? "complete" : "incomplete")
              .then(function () {
                box.disabled = false;
                row.classList.toggle("is-done", want);
                it.done = want;
                var d = 0, tot = 0;
                lists.forEach(function (x) {
                  x.items.forEach(function (y) { tot++; if (y.done) d++; });
                });
                bar.firstChild.style.width = (tot ? Math.round(d / tot * 100) : 0) + "%";
                ckSec.firstChild.textContent = "Checklist · " + d + " of " + tot;
                ckNote.className = "wf-cp-note is-ok";
                ckNote.textContent = "Saved";
                setTimeout(function () {
                  if (ckNote.textContent === "Saved") ckNote.textContent = "";
                }, 1800);
              }, function (e) {
                box.disabled = false;
                box.checked = !want;
                ckNote.className = "wf-cp-note is-bad";
                ckNote.textContent = "Didn't save — " + (e && e.message ? e.message : "try again");
              });
          });
          ckSec.appendChild(row);
        });
      });
      ckSec.appendChild(ckNote);
      wrap.appendChild(ckSec);
    }

    /* files -------------------------------------------------------------- */
    var files = V.attachments(card);
    if (files.length) {
      var fSec = section("Files · " + files.length, null);
      var preview = O.el("div");
      files.forEach(function (f) {
        var btn = O.el("button.wf-cp-file", { type: "button" },
          O.el("span.wf-cp-tag", { text: f.tag }),
          O.el("span.wf-cp-fname", { text: f.name }));
        btn.addEventListener("click", function () {
          preview.textContent = "";
          if (f.inline === "image") {
            preview.appendChild(O.el("img.wf-cp-cover", { src: f.url, alt: f.name }));
          } else if (f.inline === "frame") {
            preview.appendChild(O.el("iframe.wf-cp-frame", { src: f.url, title: f.name }));
          } else {
            preview.appendChild(O.el("div.wf-cp-note", {
              text: "A " + f.tag.toLowerCase() + " can't be shown here."
            }));
          }
          preview.appendChild(O.el("a.wf-cp-note", {
            href: f.url, target: "_blank", rel: "noopener",
            style: "display:inline-block;margin-top:6px;text-decoration:underline",
            text: "Open full screen"
          }));
        });
        fSec.appendChild(btn);
      });
      fSec.appendChild(preview);
      wrap.appendChild(fSec);
    }

    /* activity ----------------------------------------------------------- */
    var cmts = V.comments(card);
    var aSec = section("Activity", null);
    var box = O.el("textarea.wf-cp-ta", {
      placeholder: "Add a note to this card…", style: "min-height:64px"
    });
    var cNote = O.el("div.wf-cp-note");
    var send = O.btn("Post note", {
      small: true, primary: true, busyText: "Posting…",
      onClick: function () {
        var text = box.value.trim();
        if (!text) { cNote.className = "wf-cp-note is-bad"; cNote.textContent = "Nothing to post."; return; }
        return WFRest.postComment(ctx.t, card.id, text).then(function () {
          box.value = "";
          cNote.className = "wf-cp-note is-ok";
          cNote.textContent = "Posted";
          WFRest.invalidateCard(card.id);
          list.insertBefore(commentRow({
            who: O.displayName(ctx.member) || "You",
            initials: O.initials(O.displayName(ctx.member) || "You"),
            when: new Date().toISOString(), text: text
          }), list.firstChild);
        }, function (e) {
          cNote.className = "wf-cp-note is-bad";
          cNote.textContent = "Didn't post — " + (e && e.message ? e.message : "try again");
        });
      }
    });
    aSec.appendChild(box);
    aSec.appendChild(O.el("div", { style: "display:flex;gap:8px;align-items:center" }, send, cNote));

    var list = O.el("div", { style: "display:flex;flex-direction:column;gap:10px;margin-top:8px" });
    if (!cmts.length) {
      list.appendChild(O.el("div.wf-cp-note", { text: "No notes on this card yet." }));
    }
    cmts.forEach(function (c) { list.appendChild(commentRow(c)); });
    aSec.appendChild(list);
    wrap.appendChild(aSec);

    return wrap;
  }

  function commentRow(c) {
    return O.el("div.wf-cp-cmt", null,
      O.el("div.wf-cp-av", { text: c.initials }),
      O.el("div.wf-cp-cmt-b", null,
        O.el("div.wf-cp-cmt-w", null,
          document.createTextNode(c.who),
          O.el("span.wf-cp-cmt-t", { text: ago(c.when) })),
        O.el("div.wf-cp-cmt-x", { text: c.text })));
  }

  /** ISO -> the value a datetime-local input wants, in the viewer's own zone. */
  function toLocalInput(iso) {
    var d = new Date(iso);
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
           "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* ------------------------------------------------------------------- shells */

  /**
   * The panel as a plain element, for dropping into a column.
   *
   * Paints a loading state immediately and fills itself in, so a station
   * column never goes blank while a card loads.
   */
  function inline(ctx, cardRef, opts) {
    ensureStyles();
    opts = opts || {};
    var panel = O.el("div.wf-cp");

    var head = O.el("div.wf-cp-head", null,
      O.el("div.wf-cp-kicker", { text: opts.kicker || "Trello card" }),
      O.el("div.wf-cp-crumb", { text: "…" }));
    head.appendChild(O.el("button.wf-cp-x", {
      type: "button",
      title: opts.backLabel || "Close",
      text: opts.backLabel || "×",
      onClick: function () { if (opts.onBack) opts.onBack(); }
    }));
    panel.appendChild(head);

    var slot = O.el("div.wf-cp-body", null,
      O.el("div.loading", { text: "Opening the card…" }));
    panel.appendChild(slot);

    WFRest.getCardDetail(ctx.t, cardRef.id).then(function (card) {
      head.children[1].textContent = V.breadcrumb(card);
      var b = body(ctx, card, opts);
      panel.replaceChild(b, slot);

      var foot = O.el("div.wf-cp-foot", null,
        O.el("a.wf-cp-note", {
          href: card.shortUrl, target: "_blank", rel: "noopener",
          style: "text-decoration:underline",
          text: "Open in Trello"
        }));
      if (opts.footer) foot.insertBefore(opts.footer(card), foot.firstChild);
      panel.appendChild(foot);
    }).catch(function (e) {
      slot.textContent = "";
      slot.appendChild(O.el("div.wf-cp-note.is-bad", {
        text: "Couldn't open this card — " + (e && e.message ? e.message : "unknown error")
      }));
      slot.appendChild(O.el("a.wf-cp-note", {
        href: cardRef.shortUrl || "#", target: "_blank", rel: "noopener",
        style: "text-decoration:underline", text: "Open it in Trello instead"
      }));
    });

    return panel;
  }

  /** The same panel, floated over whatever the caller was showing. */
  function sheet(ctx, cardRef, opts) {
    ensureStyles();
    opts = opts || {};
    var back = O.el("div.wf-cp-sheet");

    function close() {
      document.removeEventListener("keydown", onKey, true);
      if (back.parentNode) back.parentNode.removeChild(back);
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }

    var o = {};
    Object.keys(opts).forEach(function (k) { o[k] = opts[k]; });
    o.onBack = function () { close(); if (opts.onBack) opts.onBack(); };
    o.backLabel = opts.backLabel || "×";

    back.appendChild(inline(ctx, cardRef, o));
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(back);
    return { close: close };
  }

  window.WFCardPanel = {
    ensureStyles: ensureStyles,
    inline: inline,
    sheet: sheet,
    body: body,
    toLocalInput: toLocalInput,
    ago: ago
  };
})();
