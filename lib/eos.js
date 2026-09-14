/**
 * WFEOS -- the Entrepreneurial Operating System: Vision, People, Data, Issues,
 * Process, Traction.
 *
 * WHERE EACH OF THE SIX LIVES, AND WHY THEY DON'T ALL LIVE IN THE SAME PLACE
 *
 * The six components are not the same kind of thing, so storing them the same
 * way would be wrong for at least one of them.
 *
 *   ISSUES are a stream. They arrive from anyone at any time, get argued over,
 *   get owned, get solved, and the record of that argument matters months
 *   later. That is exactly a Trello card, so Issues live on a dedicated board
 *   -- WF EOS -- one card per issue, the same reasoning as lib/sop.js:
 *
 *     list          which issues list it sits on -- Inbox, Leadership Team,
 *                   V/TO, a department, or Solved
 *     card name     the headline
 *     description   the intake answers, kept in the order they were asked
 *     position      the rank inside the list, which is how IDS prioritising
 *                   works -- drag the top three up
 *     labels        Issue / Idea / Obstacle, plus any topic labels you add
 *     members       who owns it
 *     due date      when it's meant to be resolved by
 *     comments      the discussion and the eventual resolution note
 *
 *   VISION, DATA, PROCESS, TRACTION and PEOPLE are a small fixed set of records
 *   that leadership edits a few times a quarter. Making a Trello card out of
 *   every scorecard row would bury the board, so those live in Power-Up board
 *   data on the ops board, one key per component.
 *
 * WHY MORE THAN ONE PLUGIN-DATA KEY
 *
 * Trello caps a single plugin-data entry at 4096 characters. One `eos` blob
 * holding all five records would hit that ceiling and start failing saves with
 * no obvious cause. Each record gets its own key, and every save is checked
 * against a margin below the cap so the failure is a sentence rather than a
 * silent truncation.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 *
 * No index of the issue board is kept anywhere. Anyone who prefers to work in
 * Trello directly can drag a card between lists and the tab agrees with them on
 * the next read, because the list IS the answer rather than a copy of it.
 */
(function (global) {
  "use strict";

  var FALLBACK_BOARD_ID = "6aa8660a5bdeb68c9c62f0b7";   // WF EOS

  /* ------------------------------------------------------- the six components */

  /**
   * Order, label and identity colour for each component. The colours are the
   * ops palette, not new ones -- the point is to stop six sections blurring
   * together, not to introduce a second visual language.
   */
  var COMPONENTS = [
    { id: "vision",   label: "Vision",   color: "#1f4e79", blurb: "Where we're going and why." },
    { id: "people",   label: "People",   color: "#4d7ba6", blurb: "The seats, and who sits in them." },
    { id: "data",     label: "Data",     color: "#1f6f4a", blurb: "A handful of numbers, weekly." },
    { id: "issues",   label: "Issues",   color: "#c8471c", blurb: "Everything in the way, and who's on it." },
    { id: "process",  label: "Process",  color: "#d98324", blurb: "The way we do it here." },
    { id: "traction", label: "Traction", color: "#7a4d9e", blurb: "Rocks this quarter." }
  ];

  function components() { return COMPONENTS.slice(); }

  function component(id) {
    return COMPONENTS.filter(function (c) { return c.id === id; })[0] || null;
  }

  /* ---------------------------------------------------------------- the board */

  function boardId() {
    var cfg = global.WF_CONFIG || {};
    return cfg.eosBoardId || FALLBACK_BOARD_ID;
  }

  /**
   * What a list on the EOS board means.
   *
   * Matched on the name rather than by id so the board stays editable: adding
   * "Dept · Powder Coat" in Trello gives you a new departmental list with no
   * code change, and renaming "Solved" to "Solved / Closed" doesn't quietly
   * turn the resolution archive back into a working list.
   */
  var INBOX_HINT = /inbox|new from|unsorted/i;
  var LEADERSHIP_HINT = /leadership|level\s*10|l10/i;
  var VTO_HINT = /v\s*\/?\s*to|long[\s-]?term|vision/i;
  var DEPT_HINT = /^\s*dept\b|^\s*department\b/i;
  var SOLVED_HINT = /solved|resolved|closed|archive/i;

  function kindOf(listName) {
    var n = String(listName || "");
    if (SOLVED_HINT.test(n)) return "solved";
    if (INBOX_HINT.test(n)) return "inbox";
    if (LEADERSHIP_HINT.test(n)) return "leadership";
    if (VTO_HINT.test(n)) return "vto";
    if (DEPT_HINT.test(n)) return "department";
    return "department";   // an unrecognised list is a department, not a mystery
  }

  /** "Dept · Shop Floor" -> "Shop Floor". Anything else comes back unchanged. */
  function shortName(listName) {
    return String(listName || "").replace(/^\s*dep(?:t|artment)\.?\s*[·\-:|]?\s*/i, "").trim() ||
           String(listName || "");
  }

  /**
   * Who is allowed to look at a list.
   *
   * Leadership Team and V/TO carry conversations about people and money that
   * aren't the shop's to read; everything else is open, because an issues
   * system nobody can see isn't one. Filing is never restricted -- anyone can
   * raise anything, it just lands in the Inbox.
   */
  function canSeeList(role, kind) {
    if (role === "manager") return true;
    if (kind === "leadership" || kind === "vto") return false;
    return true;
  }

  /** Read access per component. Data carries money, so it stays with managers. */
  function canSeeComponent(role, id) {
    if (role === "manager") return true;
    return id !== "data";
  }

  function canEdit(role) { return role === "manager"; }

  /* ------------------------------------------------------------------ labels */

  /**
   * The three kinds an item can be. EOS calls everything an "issue", but people
   * won't file a suggestion under a word that means complaint, so Idea and
   * Obstacle exist to get things written down at all.
   */
  var KINDS = [
    { name: "Issue", color: "red" },
    { name: "Idea", color: "green" },
    { name: "Obstacle", color: "orange" }
  ];

  function kindLabel(issue) {
    var names = (issue.labels || []).map(function (l) { return l.name; });
    for (var i = 0; i < KINDS.length; i++) {
      if (names.indexOf(KINDS[i].name) !== -1) return KINDS[i].name;
    }
    return "Issue";
  }

  /**
   * Create any of the three kind labels the board is missing, once.
   *
   * A brand-new Trello board comes with six unnamed colour labels, so the
   * alternative was asking someone to go and name them by hand before the tab
   * worked. Matching on name makes this safe to call on every load: a label
   * that already exists is left exactly as it is, including a colour somebody
   * changed on purpose.
   */
  function ensureLabels(t, existing) {
    var have = {};
    (existing || []).forEach(function (l) { if (l.name) have[l.name.toLowerCase()] = l; });

    var missing = KINDS.filter(function (k) { return !have[k.name.toLowerCase()]; });
    if (!missing.length) return Promise.resolve(existing || []);

    return Promise.all(missing.map(function (k) {
      return WFRest.write(t, "POST", "/labels", {
        idBoard: boardId(), name: k.name, color: k.color
      }).catch(function () { return null; });
    })).then(function (made) {
      return (existing || []).concat(made.filter(Boolean));
    });
  }

  /* -------------------------------------------------------------------- time */

  /**
   * When a card was created, from the card id itself.
   *
   * The first eight hex characters of a Trello object id are its creation time
   * in unix seconds. Using that beats storing a "filed on" field, which would
   * be a second source of truth that a card created in Trello wouldn't have.
   */
  function filedAt(cardId) {
    var hex = String(cardId || "").substring(0, 8);
    if (!/^[0-9a-f]{8}$/i.test(hex)) return null;
    return new Date(parseInt(hex, 16) * 1000);
  }

  function ageDays(issue) {
    var d = issue && issue.filedAt;
    if (!d) return null;
    return (Date.now() - new Date(d).getTime()) / 86400000;
  }

  /**
   * How an issue is doing against its own promise. "stale" is the one worth
   * having: an issue nobody has touched in three weeks is being avoided, and
   * that is a different problem from one that's simply hard.
   */
  function health(issue) {
    if (!issue) return { state: "ok", note: "" };
    if (issue.kind === "solved") return { state: "solved", note: "solved" };
    if (issue.due) {
      var days = (new Date(issue.due).getTime() - Date.now()) / 86400000;
      if (days < 0) return { state: "overdue", days: days, note: "past its date" };
      if (days <= 3) return { state: "due", days: days, note: "due soon" };
    }
    var idle = issue.updatedAt
      ? (Date.now() - new Date(issue.updatedAt).getTime()) / 86400000
      : null;
    if (idle !== null && idle > 21) return { state: "stale", days: idle, note: "untouched" };
    if (!issue.owner && issue.kind !== "inbox") {
      return { state: "unowned", note: "no owner" };
    }
    return { state: "ok", note: "" };
  }

  /* -------------------------------------------------------------------- load */

  /**
   * The whole issues board in three calls, then the label top-up.
   *
   * Read fresh rather than through WFRest's cache: someone files an issue and
   * expects to see it, and a shop this size will have tens of open issues, not
   * thousands.
   */
  function load(t) {
    var id = boardId();
    return Promise.all([
      WFRest.request(t, "/boards/" + id + "/lists", { fields: "name" }),
      WFRest.request(t, "/boards/" + id + "/cards", {
        fields: "name,desc,idList,idLabels,idMembers,due,dueComplete,shortUrl," +
                "dateLastActivity,badges,pos,closed",
        filter: "open"
      }),
      WFRest.request(t, "/boards/" + id + "/labels", { fields: "name,color", limit: 100 })
        .catch(function () { return []; }),
      WFRest.request(t, "/boards/" + id + "/members", { fields: "fullName,username" })
        .catch(function () { return []; })
    ]).then(function (r) {
      return ensureLabels(t, r[2] || []).then(function (labels) {
        return buildBoard(r[0] || [], r[1] || [], labels, r[3] || []);
      });
    });
  }

  function buildBoard(rawLists, rawCards, labels, members) {
    var lists = rawLists.map(function (l, i) {
      return {
        id: l.id,
        name: l.name,
        short: shortName(l.name),
        kind: kindOf(l.name),
        order: i,
        count: 0
      };
    });

    var listById = {};
    lists.forEach(function (l) { listById[l.id] = l; });

    var labelById = {};
    (labels || []).forEach(function (l) { labelById[l.id] = l; });

    var memberById = {};
    (members || []).forEach(function (m) { memberById[m.id] = m; });

    var issues = rawCards.filter(function (c) { return !c.closed; }).map(function (c) {
      var list = listById[c.idList];
      if (list) list.count++;
      var issue = {
        id: c.id,
        name: c.name || "Untitled",
        desc: c.desc || "",
        listId: c.idList,
        list: list ? list.name : "Unsorted",
        listShort: list ? list.short : "Unsorted",
        kind: list ? list.kind : "inbox",
        pos: c.pos,
        url: c.shortUrl,
        due: c.due || null,
        dueComplete: !!c.dueComplete,
        updatedAt: c.dateLastActivity,
        filedAt: filedAt(c.id),
        comments: (c.badges && c.badges.comments) || 0,
        owner: (c.idMembers || []).map(function (mid) { return memberById[mid]; })
                 .filter(Boolean)[0] || null,
        labels: (c.idLabels || []).map(function (lid) { return labelById[lid]; })
                  .filter(Boolean)
      };
      issue.type = kindLabel(issue);
      issue.health = health(issue);
      return issue;
    });

    // Rank inside a list is the EOS priority: the top three get worked.
    issues.sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); });

    return { boardId: boardId(), lists: lists, labels: labels, members: members, issues: issues };
  }

  /** The issues on one list, already in rank order. */
  function inList(data, listId) {
    return ((data && data.issues) || []).filter(function (i) { return i.listId === listId; });
  }

  /** The lists this person is allowed to see, in board order. */
  function listsFor(data, role) {
    return ((data && data.lists) || []).filter(function (l) {
      return canSeeList(role, l.kind);
    });
  }

  function search(issues, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return issues || [];
    var terms = q.split(/\s+/);
    return (issues || []).filter(function (i) {
      var hay = [
        i.name, i.desc, i.listShort, i.type,
        i.owner ? (i.owner.fullName || i.owner.username) : "",
        (i.labels || []).map(function (l) { return l.name; }).join(" ")
      ].join(" ").toLowerCase();
      return terms.every(function (term) { return hay.indexOf(term) !== -1; });
    });
  }

  /* ------------------------------------------------------------------ intake */

  /**
   * The questions the intake form asks, in the order it asks them.
   *
   * Three, deliberately. A longer form gets abandoned on a phone in a shop, and
   * the third question is the one that turns a complaint into something
   * actionable -- but it's optional, because "I don't know, that's why I'm
   * telling you" is a legitimate answer.
   */
  var INTAKE = [
    { key: "what", label: "What's the issue?",
      hint: "One or two sentences. What actually happened.", required: true, rows: 3 },
    { key: "impact", label: "What's it costing us?",
      hint: "Time, money, a job, somebody's patience — whatever it is.", rows: 2 },
    { key: "idea", label: "What would you do about it?",
      hint: "Optional. Leave it blank if you're not sure.", rows: 2 }
  ];

  /**
   * Turn the form answers into a card description.
   *
   * Plain markdown with the questions as headings, so the card reads properly
   * in Trello, in email notifications and on a phone -- none of which know
   * anything about this Power-Up.
   */
  function composeDesc(answers, filer) {
    var parts = [];
    INTAKE.forEach(function (q) {
      var v = String((answers && answers[q.key]) || "").trim();
      if (v) parts.push("**" + q.label + "**\n" + v);
    });
    var who = filer ? (filer.fullName || filer.username) : "someone";
    parts.push("---\nFiled by " + who + " on " + new Date().toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric"
    }) + ".");
    return parts.join("\n\n");
  }

  function inboxList(data) {
    return ((data && data.lists) || []).filter(function (l) { return l.kind === "inbox"; })[0] ||
           ((data && data.lists) || [])[0] || null;
  }

  function solvedList(data) {
    return ((data && data.lists) || []).filter(function (l) { return l.kind === "solved"; })[0] || null;
  }

  /**
   * File an issue or idea. Everything lands in the Inbox regardless of who
   * filed it, because sorting is leadership's job and asking a welder to pick
   * the right departmental list is how you get things filed nowhere.
   */
  function fileIssue(t, data, fields) {
    var target = inboxList(data);
    if (!target) {
      return Promise.reject(new Error(
        'The EOS board has no Inbox list — add one called "Inbox" in Trello and try again.'));
    }
    var headline = String((fields && fields.name) || "").trim();
    if (!headline) return Promise.reject(new Error("Give it a short headline first."));

    var label = ((data && data.labels) || []).filter(function (l) {
      return l.name === (fields.type || "Issue");
    })[0];

    return WFRest.write(t, "POST", "/cards", {
      idList: target.id,
      name: headline,
      desc: composeDesc(fields.answers, fields.filer),
      pos: "bottom",
      idLabels: label ? label.id : undefined
    });
  }

  /* ------------------------------------------------------------------ writes */

  function moveIssue(t, cardId, listId, pos) {
    var params = { idList: listId };
    if (pos !== undefined) params.pos = pos;
    return WFRest.write(t, "PUT", "/cards/" + cardId, params);
  }

  /** Move to the top of its list -- how the top three get chosen each meeting. */
  function promote(t, cardId) {
    return WFRest.write(t, "PUT", "/cards/" + cardId, { pos: "top" });
  }

  function setOwner(t, cardId, memberId, previousOwnerId) {
    var drop = previousOwnerId && previousOwnerId !== memberId
      ? WFRest.write(t, "DELETE", "/cards/" + cardId + "/idMembers/" + previousOwnerId)
          .catch(function () { return null; })
      : Promise.resolve(null);
    return drop.then(function () {
      if (!memberId) return null;
      return WFRest.write(t, "POST", "/cards/" + cardId + "/idMembers", { value: memberId });
    });
  }

  function setDue(t, cardId, iso) {
    return WFRest.write(t, "PUT", "/cards/" + cardId, { due: iso || "" });
  }

  function setType(t, data, issue, typeName) {
    var labels = (data && data.labels) || [];
    var want = labels.filter(function (l) { return l.name === typeName; })[0];
    var current = (issue.labels || []).filter(function (l) {
      return KINDS.some(function (k) { return k.name === l.name; });
    });
    var drops = current.filter(function (l) { return !want || l.id !== want.id; })
      .map(function (l) {
        return WFRest.write(t, "DELETE", "/cards/" + issue.id + "/idLabels/" + l.id)
          .catch(function () { return null; });
      });
    return Promise.all(drops).then(function () {
      if (!want || current.some(function (l) { return l.id === want.id; })) return null;
      return WFRest.write(t, "POST", "/cards/" + issue.id + "/idLabels", { value: want.id });
    });
  }

  /**
   * Solve it: the note goes on as a comment first, then the card moves.
   *
   * That order matters. If the move succeeds and the comment fails you have an
   * issue in Solved with no explanation, which is worse than an explained issue
   * still sitting on the list -- the second is obvious and fixable, the first
   * looks finished.
   */
  function solve(t, data, cardId, note) {
    var target = solvedList(data);
    if (!target) {
      return Promise.reject(new Error(
        'The EOS board has no "Solved" list — add one in Trello and try again.'));
    }
    var text = String(note || "").trim();
    var comment = text
      ? WFRest.write(t, "POST", "/cards/" + cardId + "/actions/comments",
          { text: "**Solved.** " + text })
      : Promise.resolve(null);
    return comment.then(function () {
      return WFRest.write(t, "PUT", "/cards/" + cardId,
        { idList: target.id, pos: "top", dueComplete: true });
    });
  }

  function reopen(t, data, cardId, listId) {
    var target = listId || (inboxList(data) || {}).id;
    if (!target) return Promise.reject(new Error("Nowhere to reopen it to."));
    return WFRest.write(t, "PUT", "/cards/" + cardId,
      { idList: target, dueComplete: false, pos: "top" });
  }

  function comment(t, cardId, text) {
    return WFRest.write(t, "POST", "/cards/" + cardId + "/actions/comments",
      { text: String(text || "") });
  }

  function discussion(t, cardId) {
    return WFRest.request(t, "/cards/" + cardId + "/actions",
      { filter: "commentCard", limit: 30 }).catch(function () { return []; });
  }

  /* ----------------------------------------------- vision, data, traction, people */

  /**
   * One plugin-data key per record, and a size check on every save.
   *
   * Trello caps a plugin-data entry at 4096 characters. Saving at the cap fails
   * in a way that looks like the save simply didn't happen, so every write is
   * measured first and refused with a sentence that says which record is too
   * big and roughly by how much.
   */
  var KEYS = {
    vto: "eosVto",
    rocks: "eosRocks",
    scorecard: "eosScorecard",
    seats: "eosSeats",
    processes: "eosProcesses"
  };

  var LIMIT = 4096;
  var MARGIN = 3800;   // leaves room for the growth one more edit will cause

  var EMPTY = {
    vto: {
      coreValues: [],
      purpose: "",
      niche: "",
      tenYear: "",
      uniques: [],
      provenProcess: "",
      guarantee: "",
      threeYear: { date: "", revenue: "", profit: "", looksLike: [] },
      oneYear: { date: "", revenue: "", profit: "", goals: [] }
    },
    rocks: [],
    scorecard: [],
    seats: [],
    processes: []
  };

  function blank(name) { return JSON.parse(JSON.stringify(EMPTY[name])); }

  function getRecord(t, name) {
    var key = KEYS[name];
    if (!key) return Promise.reject(new Error("No EOS record called " + name + "."));
    return t.get("board", "shared", key, null).then(function (v) {
      if (v === null || v === undefined) return blank(name);
      if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { return blank(name); } }
      // An object where a list belongs (or the reverse) means somebody's older
      // shape survived a rename. Fall back rather than render nonsense.
      var wantArray = Array.isArray(EMPTY[name]);
      if (wantArray !== Array.isArray(v)) return blank(name);
      return v;
    }).catch(function () { return blank(name); });
  }

  function saveRecord(t, name, value) {
    var key = KEYS[name];
    if (!key) return Promise.reject(new Error("No EOS record called " + name + "."));
    var json = JSON.stringify(value);
    if (json.length > MARGIN) {
      return Promise.reject(new Error(
        "That's too much for one " + name + " record to hold (" + json.length +
        " of " + LIMIT + " characters). Trim or remove a few rows and save again."));
    }
    return t.set("board", "shared", key, value);
  }

  /** How close a record is to the ceiling, for a quiet warning in the UI. */
  function recordSize(value) {
    var n = JSON.stringify(value || null).length;
    return { chars: n, limit: LIMIT, pct: Math.min(100, Math.round((n / MARGIN) * 100)) };
  }

  function getAll(t) {
    var names = Object.keys(KEYS);
    return Promise.all(names.map(function (n) { return getRecord(t, n); }))
      .then(function (vals) {
        var out = {};
        names.forEach(function (n, i) { out[n] = vals[i]; });
        return out;
      });
  }

  /* ------------------------------------------------------------------- rocks */

  /**
   * The quarter a date falls in, as "Q3 2026". Rocks are quarterly by
   * definition, so the tab defaults to this one rather than making somebody
   * type it.
   */
  function quarterOf(date) {
    var d = date ? new Date(date) : new Date();
    return "Q" + (Math.floor(d.getMonth() / 3) + 1) + " " + d.getFullYear();
  }

  function rocksFor(rocks, quarter) {
    var q = quarter || quarterOf();
    return (rocks || []).filter(function (r) { return (r.quarter || quarterOf()) === q; });
  }

  /** On track / off track, the only two answers a rock gets in a Level 10. */
  function rockState(rock) {
    if (!rock) return "off";
    if (rock.done) return "done";
    return rock.onTrack === false ? "off" : "on";
  }

  function rockProgress(rocks) {
    var list = rocks || [];
    if (!list.length) return { done: 0, total: 0, pct: 0 };
    var done = list.filter(function (r) { return r.done; }).length;
    return { done: done, total: list.length, pct: Math.round((done / list.length) * 100) };
  }

  /* --------------------------------------------------------------- scorecard */

  /**
   * The Monday-start week a date belongs to, as "2026-W37".
   *
   * A scorecard is read weekly and compared week on week, so the column key has
   * to be stable no matter which day somebody happens to enter the number.
   */
  function weekKey(date) {
    var d = new Date(date || Date.now());
    d.setHours(0, 0, 0, 0);
    // ISO weeks run Monday-Sunday and are numbered by the Thursday they contain.
    var day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day + 3);
    var firstThursday = new Date(d.getFullYear(), 0, 4);
    var fday = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - fday + 3);
    var week = 1 + Math.round((d - firstThursday) / (7 * 86400000));
    return d.getFullYear() + "-W" + (week < 10 ? "0" : "") + week;
  }

  /** The last n week keys, oldest first, ending with the week `from` is in. */
  function recentWeeks(n, from) {
    var out = [];
    var d = new Date(from || Date.now());
    for (var i = (n || 13) - 1; i >= 0; i--) {
      var w = new Date(d.getTime() - i * 7 * 86400000);
      out.push(weekKey(w));
    }
    return out;
  }

  /**
   * Whether a week's number hit its goal. The comparison direction has to be
   * declared per row: quotes sent should go up, rework hours should go down,
   * and scoring both the same way makes the whole board meaningless.
   */
  function onGoal(row, value) {
    if (value === null || value === undefined || value === "") return null;
    var goal = parseFloat(row && row.goal);
    var v = parseFloat(value);
    if (isNaN(goal) || isNaN(v)) return null;
    return (row.direction === "down") ? v <= goal : v >= goal;
  }

  function weekValue(row, week) {
    var w = (row && row.weeks) || {};
    var v = w[week];
    return (v === undefined || v === "") ? null : v;
  }

  /**
   * Trim a row's history to the weeks still on screen.
   *
   * Without this a scorecard grows forever and quietly walks into the 4096
   * character ceiling a year from now, at which point every save starts
   * failing. Dropping weeks nobody is looking at keeps the record flat.
   */
  function trimWeeks(rows, keep) {
    var live = {};
    recentWeeks(keep || 26).forEach(function (w) { live[w] = true; });
    return (rows || []).map(function (r) {
      var kept = {};
      Object.keys(r.weeks || {}).forEach(function (w) { if (live[w]) kept[w] = r.weeks[w]; });
      var copy = JSON.parse(JSON.stringify(r));
      copy.weeks = kept;
      return copy;
    });
  }

  /* ------------------------------------------------------------------- seats */

  /**
   * Suggest the accountability chart from the roster rather than starting from
   * a blank page.
   *
   * Every phase someone is a specialist for is a seat they already sit in, so
   * the first draft of the chart is something they can correct instead of
   * something they have to author. Never saved automatically -- a suggestion
   * that writes itself into the record is indistinguishable from a decision
   * somebody made.
   */
  function suggestSeats(roster, boardCfg) {
    var specialists = (roster && roster.phaseSpecialists) || {};
    var seen = {};
    var out = [];
    Object.keys(specialists).forEach(function (phase) {
      var who = specialists[phase] || [];
      if (!who.length) return;
      var key = phase.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        id: "seat-" + key.replace(/[^a-z0-9]+/g, "-"),
        seat: phase,
        who: who.join(", "),
        roles: []
      });
    });
    (boardCfg && boardCfg.stages ? [] : []).forEach(function () { /* config is advisory only */ });
    return out;
  }

  function seatGaps(seats) {
    return (seats || []).filter(function (s) {
      return !String(s.who || "").trim() || String(s.who).trim() === "—";
    });
  }

  /* ----------------------------------------------------------------- process */

  /**
   * Link a documented process to its SOP so Process isn't a second place the
   * same procedure gets written down. The EOS side records that the process
   * exists, is agreed and is followed by all; the words themselves stay in the
   * SOP library where the shop already looks for them.
   */
  function processSop(proc, sops) {
    if (!proc || !proc.sopId) return null;
    return (sops || []).filter(function (s) { return s.id === proc.sopId; })[0] || null;
  }

  function processHealth(procs) {
    var list = procs || [];
    var documented = list.filter(function (p) { return !!p.sopId; }).length;
    return {
      total: list.length,
      documented: documented,
      pct: list.length ? Math.round((documented / list.length) * 100) : 0
    };
  }

  global.WFEOS = {
    boardId: boardId,
    components: components,
    component: component,
    KINDS: KINDS,
    INTAKE: INTAKE,

    kindOf: kindOf,
    shortName: shortName,
    canSeeList: canSeeList,
    canSeeComponent: canSeeComponent,
    canEdit: canEdit,

    load: load,
    buildBoard: buildBoard,
    inList: inList,
    listsFor: listsFor,
    search: search,
    filedAt: filedAt,
    ageDays: ageDays,
    health: health,
    kindLabel: kindLabel,
    ensureLabels: ensureLabels,

    composeDesc: composeDesc,
    inboxList: inboxList,
    solvedList: solvedList,
    fileIssue: fileIssue,
    moveIssue: moveIssue,
    promote: promote,
    setOwner: setOwner,
    setDue: setDue,
    setType: setType,
    solve: solve,
    reopen: reopen,
    comment: comment,
    discussion: discussion,

    getRecord: getRecord,
    saveRecord: saveRecord,
    recordSize: recordSize,
    getAll: getAll,
    blank: blank,

    quarterOf: quarterOf,
    rocksFor: rocksFor,
    rockState: rockState,
    rockProgress: rockProgress,

    weekKey: weekKey,
    recentWeeks: recentWeeks,
    onGoal: onGoal,
    weekValue: weekValue,
    trimWeeks: trimWeeks,

    suggestSeats: suggestSeats,
    seatGaps: seatGaps,
    processSop: processSop,
    processHealth: processHealth
  };
})(window);
