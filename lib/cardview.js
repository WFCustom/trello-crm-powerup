/**
 * WFCardView -- the rules behind showing a Trello card without opening Trello.
 *
 * WHY THIS EXISTS
 *
 * Every tab that listed jobs ended the same way: a button that threw you out
 * to Trello. You lost the dashboard, lost your filter, lost your place, and
 * came back by hitting the browser's back button and waiting for a reload. The
 * mockup solved it by rendering the card *in place* -- a rendition you can read
 * and edit, with an X that puts you back exactly where you were.
 *
 * This file holds the decisions that rendition depends on. The drawing lives in
 * popups/cardpanel.js; everything here is a pure function of data, which is
 * what makes it testable without a browser.
 *
 * THE MONEY RULE
 *
 * The standing instruction is that margins and overall financials stay off the
 * shop's screens -- "relevant info focused at each stage, no extra unnecessary
 * details". The card panel is the one place every role meets the same card, so
 * the filter has to live here rather than in each caller.
 *
 * It works on field NAMES, not on an allow-list of ids, because custom fields
 * get added on the board without anyone touching this repo. A new field called
 * "Margin %" must be hidden from the shop the day it is created, not the day
 * somebody remembers to update a list. The cost of that choice is the odd false
 * positive -- a field called "Value engineering" gets hidden from workers too.
 * That is the right way round: hiding something harmless is a nuisance, showing
 * a margin to the floor is the thing we were asked to prevent.
 */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------- the money rule */

  /**
   * Words that make a field financial. Matched case-insensitively anywhere in
   * the field name.
   *
   * "value" is here because the board's job-value field is literally "Value",
   * and it is the number the whole costing model keys off.
   */
  var MONEY_WORDS = [
    "value", "price", "pricing", "cost", "margin", "profit", "quote", "quoted",
    "total", "amount", "invoice", "billing", "budget", "rate", "deposit",
    "markup", "discount", "$"
  ];

  function isMoneyField(name) {
    var n = String(name || "").toLowerCase();
    for (var i = 0; i < MONEY_WORDS.length; i++) {
      if (n.indexOf(MONEY_WORDS[i]) !== -1) return true;
    }
    return false;
  }

  /** Managers and office see money. The shop does not. */
  function canSeeMoney(role) {
    return role === "manager" || role === "office";
  }

  /**
   * Strip the financial fields for anyone who shouldn't have them.
   *
   * Takes the output of WFRest.getCardFieldsDisplay -- [{name, display}].
   */
  function visibleFields(fields, role) {
    if (canSeeMoney(role)) return (fields || []).slice();
    return (fields || []).filter(function (f) { return !isMoneyField(f.name); });
  }

  /* ----------------------------------------------------------------- the cover */

  /**
   * The picture to show at the top of the card.
   *
   * Trello's `cover` object names a scaled variant when the user has set one,
   * which is the cheapest correct answer. Failing that, fall back to the first
   * image attachment, because a job card with a drawing on it should show the
   * drawing whether or not anybody remembered to make it the cover.
   *
   * Prefers a preview around 600px wide: big enough for a station column on a
   * TV, small enough that four of them don't stall the page.
   */
  function coverFrom(card) {
    var cover = card && card.cover;
    if (cover && cover.scaled && cover.scaled.length) {
      return pickScaled(cover.scaled);
    }
    if (cover && cover.url) return cover.url;

    var atts = (card && card.attachments) || [];
    for (var i = 0; i < atts.length; i++) {
      if (!isImage(atts[i])) continue;
      if (atts[i].previews && atts[i].previews.length) return pickScaled(atts[i].previews);
      return atts[i].url;
    }
    return null;
  }

  function pickScaled(list) {
    var best = null;
    (list || []).forEach(function (s) {
      if (!s || !s.url) return;
      if (!best) { best = s; return; }
      // Closest to 600px wide without going under 300.
      var bw = best.width || 0, sw = s.width || 0;
      if (bw < 300 && sw > bw) best = s;
      else if (sw >= 300 && sw < bw && bw > 700) best = s;
      else if (bw < 300 && sw >= 300) best = s;
    });
    return best ? best.url : null;
  }

  function isImage(att) {
    if (!att) return false;
    if (att.mimeType && att.mimeType.indexOf("image/") === 0) return true;
    return /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(att.url || "");
  }

  /* ------------------------------------------------------------ attachment kinds */

  /**
   * A short tag for the files list, and whether we can show it inline.
   *
   * Only PDFs and images render in an iframe or an img. Everything else --
   * DWG, STEP, a Fusion share link -- is honest about it and offers to open
   * the real thing, because pretending to preview a solid model would be worse
   * than saying we can't.
   */
  function attachmentKind(att) {
    var url = String((att && att.url) || "");
    var name = String((att && att.name) || url);
    if (isImage(att)) return { tag: "Image", inline: "image" };
    if (/\.pdf(\?|$)/i.test(url) || (att && att.mimeType === "application/pdf")) {
      return { tag: "PDF", inline: "frame" };
    }
    if (/autodesk|fusion360|a360/i.test(url)) return { tag: "3D", inline: "frame" };
    if (/\.(dwg|dxf)(\?|$)/i.test(name)) return { tag: "CAD", inline: null };
    if (/\.(step|stp|iges|igs|sldprt|f3d)(\?|$)/i.test(name)) return { tag: "Model", inline: null };
    if (/^https?:/i.test(url) && !/\./.test(name.split("/").pop() || "")) {
      return { tag: "Link", inline: null };
    }
    return { tag: "File", inline: null };
  }

  function attachments(card) {
    return ((card && card.attachments) || []).map(function (a) {
      var k = attachmentKind(a);
      return {
        id: a.id,
        name: a.name || a.url,
        url: a.url,
        tag: k.tag,
        inline: k.inline,
        date: a.date || null
      };
    });
  }

  /* ---------------------------------------------------------------- checklists */

  /**
   * Flatten Trello's checklists into one progress figure plus the items.
   *
   * The mockup shows "phases checklist + %" as a single bar; a card with three
   * checklists on it is still one job, and three separate bars would tell a
   * manager nothing they could act on.
   */
  function checklistProgress(card) {
    var lists = (card && card.checklists) || [];
    var done = 0, total = 0;
    lists.forEach(function (l) {
      (l.checkItems || []).forEach(function (it) {
        total++;
        if (it.state === "complete") done++;
      });
    });
    return {
      done: done,
      total: total,
      pct: total ? Math.round((done / total) * 100) : null
    };
  }

  function checklists(card) {
    return ((card && card.checklists) || []).slice()
      .sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); })
      .map(function (l) {
        var items = (l.checkItems || []).slice()
          .sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); })
          .map(function (it) {
            return { id: it.id, name: it.name, done: it.state === "complete" };
          });
        return {
          id: l.id,
          name: l.name,
          items: items,
          done: items.filter(function (i) { return i.done; }).length,
          total: items.length
        };
      });
  }

  /* ------------------------------------------------------------------ comments */

  /**
   * The comment thread, newest first, as {who, initials, when, text}.
   *
   * Trello returns commentCard actions with the author embedded; nothing else
   * on the card tells you who said what, so this is the only source.
   */
  function comments(card) {
    return ((card && card.actions) || [])
      .filter(function (a) { return a.type === "commentCard"; })
      .map(function (a) {
        var m = a.memberCreator || {};
        return {
          id: a.id,
          who: m.fullName || m.username || "Someone",
          initials: m.initials || initialsOf(m.fullName || m.username || ""),
          when: a.date,
          text: (a.data && a.data.text) || ""
        };
      });
  }

  function initialsOf(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "··";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /* ---------------------------------------------------------------- the due date */

  /**
   * How the due date should read, and whether it's a problem.
   *
   * Deliberately returns `late` separately from the text so the caller decides
   * the colour -- the same fact is a red banner on the floor and a quiet row on
   * a manager's list.
   */
  function dueState(card) {
    if (!card || !card.due) return { text: "No due date", late: false, done: false, none: true };
    var d = new Date(card.due);
    var done = !!card.dueComplete;
    var late = !done && d.getTime() < Date.now();
    return {
      text: d.toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit"
      }),
      iso: card.due,
      late: late,
      done: done,
      none: false
    };
  }

  /** Trello's label colour names mapped to something the sheet can paint. */
  var LABEL_HEX = {
    green: "#61bd4f", yellow: "#f2d600", orange: "#ff9f1a", red: "#eb5a46",
    purple: "#c377e0", blue: "#0079bf", sky: "#00c2e0", lime: "#51e898",
    pink: "#ff78cb", black: "#344563", null: "#b3bac5"
  };

  function labelHex(color) { return LABEL_HEX[color] || LABEL_HEX["null"]; }

  /**
   * Labels worth drawing. Trello lets a label exist with a colour and no name;
   * those carry no meaning to a reader, so they are dropped rather than shown
   * as an anonymous blob.
   */
  function labels(card) {
    return ((card && card.labels) || [])
      .filter(function (l) { return l && l.name; })
      .map(function (l) { return { id: l.id, name: l.name, hex: labelHex(l.color) }; });
  }

  function members(card) {
    return ((card && card.members) || []).map(function (m) {
      return {
        id: m.id,
        name: m.fullName || m.username,
        username: m.username,
        initials: m.initials || initialsOf(m.fullName || m.username)
      };
    });
  }

  /** "Office Operations › CNC table" -- the line across the top of the panel. */
  function breadcrumb(card) {
    var board = (card && card.board && card.board.name) || "";
    var list = (card && card.list && card.list.name) || "";
    return [board, list].filter(Boolean).join(" › ");
  }

  /* ------------------------------------------------------------- what's editable */

  /**
   * Which parts of the card this person may change.
   *
   * The shop can move its own work along -- tick a checklist item, leave a
   * comment -- but renaming a job or moving its due date is a scheduling
   * decision, and a scheduling decision made from a station screen by whoever
   * is standing there is how dates quietly drift.
   */
  function editRights(role) {
    var manage = role === "manager" || role === "office";
    return {
      title: manage,
      description: manage,
      due: manage,
      checkItems: true,
      comment: true,
      money: canSeeMoney(role)
    };
  }

  global.WFCardView = {
    MONEY_WORDS: MONEY_WORDS,
    isMoneyField: isMoneyField,
    canSeeMoney: canSeeMoney,
    visibleFields: visibleFields,
    coverFrom: coverFrom,
    isImage: isImage,
    attachmentKind: attachmentKind,
    attachments: attachments,
    checklistProgress: checklistProgress,
    checklists: checklists,
    comments: comments,
    dueState: dueState,
    labelHex: labelHex,
    labels: labels,
    members: members,
    breadcrumb: breadcrumb,
    editRights: editRights
  };
})(window);
