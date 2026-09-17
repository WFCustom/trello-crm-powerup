/**
 * WFRecords -- what happened: hours worked, quality checks, safety reports,
 * training.
 *
 * WHY THESE FOUR SIT TOGETHER
 *
 * Every other tab answers "what is happening now". These four answer "what
 * happened", and that is a different job: you come to them with a question
 * already in mind -- how long does powder coat really take, who signed off the
 * job that came back, when did we last talk about pinch points, whose forklift
 * ticket expires this month. They are searched, not watched.
 *
 * WHERE EACH ONE LIVES, AND WHY
 *
 *   TIME       Already on the cards. Every approved phase appends to the card's
 *              `phaseLog` -- who, which phase, how many minutes. Nothing new is
 *              written here; this reads what the shop has been recording all
 *              along and adds it up.
 *
 *   QUALITY    Already on the cards, in `qcRecord`, round by round with the
 *              signature and any failed line.
 *
 *   SAFETY     A dedicated Trello board, WF Safety. A near miss needs a
 *              conversation, an owner and a date -- that is a card, for the same
 *              reasons SOPs and EOS issues are cards. Status is the list, type
 *              is a label.
 *
 *   TRAINING   Power-Up board data. It is a short list of people against tickets
 *              with expiry dates, edited a few times a year. A card each would
 *              bury the safety board in things that are not incidents.
 *
 * THE POINT OF THE TIME LOG
 *
 * Right now the shop has no standard for how long a job should take, because
 * nobody has ever measured it. The log is the raw material for that standard --
 * which is why `toCSV` exists. Once there are a couple of months in here, the
 * export is what turns "it feels slow" into hours per $1,000 of job value, per
 * phase, per job type. Deliberately an export rather than a number invented on
 * this screen: a standard set from six weeks of thin data would be worse than
 * no standard at all.
 */
(function (global) {
  "use strict";

  var FALLBACK_SAFETY_BOARD = "6aa995807f1faa0ade385032";   // WF Safety
  var TRAINING_KEY = "wfTraining";
  var DAY = 86400000;

  /* =========================================================== time worked */

  /**
   * Every finished phase on every card, flattened.
   *
   * `phaseLog` is appended when a manager approves a phase, so an entry means
   * the work was done AND signed off -- which is the honest unit to measure,
   * because a phase somebody started and abandoned is not a build time.
   *
   * The job's value rides along where it is known, since hours on their own
   * can't be compared between a handrail and a stair run.
   */
  function timeEntries(cards) {
    var out = [];
    (cards || []).forEach(function (card) {
      var econ = card.economics || {};
      var value = Number(econ.value) || null;
      (card.phaseLog || []).forEach(function (e) {
        var mins = Number(e.durationMinutes);
        if (!isFinite(mins) || mins <= 0) return;
        out.push({
          cardId: card.id,
          job: card.name,
          jobNumber: jobNumber(card.name),
          phase: e.listName || "",
          who: nameOf(e.claimedBy),
          approvedBy: nameOf(e.approvedBy),
          minutes: mins,
          hours: mins / 60,
          at: e.completedAt || e.approvedAt || null,
          value: value,
          ongoing: false
        });
      });
    });
    out.sort(function (a, b) { return new Date(b.at || 0) - new Date(a.at || 0); });
    return out;
  }

  /**
   * Phases running right now, as provisional entries.
   *
   * Flagged `ongoing` and kept out of every average on purpose: a job half
   * finished would drag the numbers down and make the shop look slower than it
   * is. Shown, not counted.
   */
  function openEntries(cards) {
    var out = [];
    (cards || []).forEach(function (card) {
      var w = card.phaseWork;
      if (!w || w.listId !== card.idList) return;
      var mins = minutesOf(w);
      if (!mins) return;
      out.push({
        cardId: card.id,
        job: card.name,
        jobNumber: jobNumber(card.name),
        phase: "",
        who: nameOf(w.claimedBy),
        approvedBy: "",
        minutes: mins,
        hours: mins / 60,
        at: null,
        value: Number((card.economics || {}).value) || null,
        ongoing: true
      });
    });
    return out;
  }

  function minutesOf(work) {
    if (!work || !work.segments) return 0;
    var ms = 0;
    work.segments.forEach(function (seg) {
      var end = seg.end ? new Date(seg.end) : new Date();
      ms += end - new Date(seg.start);
    });
    return Math.round(ms / 60000);
  }

  /**
   * Totals, plus the two ratios worth watching.
   *
   * `hoursPerThousand` is the estimating number -- 4.2 means a $12k job is
   * about 50 hours. `revenuePerHour` is the throughput number. Both are medians
   * rather than means, because one nightmare job drags a mean and the shop then
   * plans around a figure it never actually hits.
   *
   * Both are null until there is something to divide: a ratio computed from two
   * jobs is a number, not a fact, and showing it would invite someone to plan
   * with it.
   */
  function timeSummary(entries, opts) {
    var min = (opts && opts.minJobs) || 5;
    var s = {
      entries: entries.length, minutes: 0, hours: 0,
      byPerson: {}, byPhase: {}, byJob: {},
      hoursPerThousand: null, revenuePerHour: null, jobsPriced: 0, enough: false
    };

    entries.forEach(function (e) {
      s.minutes += e.minutes;
      bump(s.byPerson, e.who || "unrecorded", e);
      bump(s.byPhase, e.phase || "unrecorded", e);
      bump(s.byJob, e.job, e, e.value);
    });
    s.hours = s.minutes / 60;

    var ratios = [], rates = [];
    Object.keys(s.byJob).forEach(function (k) {
      var j = s.byJob[k];
      if (!j.value || !j.hours) return;
      s.jobsPriced++;
      ratios.push(j.hours / (j.value / 1000));
      rates.push(j.value / j.hours);
    });
    s.enough = s.jobsPriced >= min;
    if (s.enough) {
      s.hoursPerThousand = median(ratios);
      s.revenuePerHour = median(rates);
    }
    return s;
  }

  function bump(map, key, e, value) {
    var g = map[key] || (map[key] = { key: key, minutes: 0, hours: 0, count: 0, value: null });
    g.minutes += e.minutes;
    g.hours = g.minutes / 60;
    g.count++;
    if (value) g.value = value;
    return g;
  }

  function median(nums) {
    var a = (nums || []).slice().sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function sortedGroups(map) {
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.minutes - a.minutes; });
  }

  /** Entries inside the last n days. Null `at` (an ongoing phase) never matches. */
  function since(entries, days) {
    if (!days) return entries;
    var cut = Date.now() - days * DAY;
    return (entries || []).filter(function (e) {
      return e.at && new Date(e.at).getTime() >= cut;
    });
  }

  /**
   * The export.
   *
   * One row per finished phase with the job value alongside, which is exactly
   * what is needed to work out a real standard build time -- and what makes
   * that possible outside this window, in a spreadsheet or by somebody who
   * knows what they are looking at.
   */
  function toCSV(entries) {
    var head = ["Job", "Job number", "Phase", "Who", "Approved by",
                "Minutes", "Hours", "Completed", "Job value", "Hours per $1,000"];
    var rows = (entries || []).filter(function (e) { return !e.ongoing; })
      .map(function (e) {
        var per = (e.value && e.hours) ? (e.hours / (e.value / 1000)) : "";
        return [
          e.job, e.jobNumber || "", e.phase, e.who, e.approvedBy,
          Math.round(e.minutes), round2(e.hours),
          e.at ? new Date(e.at).toISOString().slice(0, 10) : "",
          e.value || "", per === "" ? "" : round2(per)
        ];
      });
    return [head].concat(rows).map(function (r) {
      return r.map(csvCell).join(",");
    }).join("\n");
  }

  function csvCell(v) {
    var s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /* ============================================================== quality */

  /**
   * Every QC round ever recorded, newest first.
   *
   * Reads the same `qcRecord` the Quality check tab writes, so the archive can
   * never disagree with the live view -- there is one record and two ways of
   * looking at it.
   */
  function qcEntries(cards) {
    var out = [];
    (cards || []).forEach(function (card) {
      var rec = card.qcRecord;
      if (!rec || !rec.rounds) return;
      rec.rounds.forEach(function (rd) {
        // Through WFQC so both round shapes read the same. A slim round stores
        // verdicts by position against the record's template; reading rd.items
        // directly would report every check as having zero lines.
        var items = (global.WFQC && global.WFQC.roundItems)
          ? global.WFQC.roundItems(rec, rd)
          : (rd.items || []);
        var failed = items.filter(function (i) { return i.result === "fail"; });
        out.push({
          cardId: card.id,
          job: card.name,
          jobNumber: jobNumber(card.name),
          phase: rec.phase || rec.listName || "",
          round: rd.n,
          checkedBy: nameOf(rd.checkedBy),
          at: rd.checkedAt || rd.correctedAt || rd.verifiedAt || null,
          passed: failed.length === 0 && items.length > 0,
          items: items.length,
          failed: failed.map(function (i) { return { text: i.text, note: i.note || "" }; }),
          corrections: (rd.corrections || []).map(function (c) {
            return { text: c.text, what: c.whatIDid || "", who: nameOf(c.correctedBy) };
          }),
          /* Round first, record second. These used to read the round only, and
           * no round writer had ever written either field -- they lived on the
           * record -- so the archive's signature columns were blank for every
           * check ever done, silently. Rounds carry them now; the record-level
           * fallback keeps every check signed before that change readable.
           * Record level describes the LATEST round, so it is only correct as a
           * fallback, never as the first choice. */
          signature: rd.signature || rec.signature || "",
          signedBy: nameOf(rd.signedBy || rec.signedBy),
          // Via global, and guarded: records.test.js loads this file without
          // qc.js, and a bare WFQC reference would throw on every row.
          mode: rd.mode ||
            ((global.WFQC && global.WFQC.modeOf) ? global.WFQC.modeOf(rec) : null)
        });
      });
    });
    out.sort(function (a, b) { return new Date(b.at || 0) - new Date(a.at || 0); });
    return out;
  }

  /**
   * How often things pass, and what fails most.
   *
   * The repeat-offender list is the point: one job failing on "dimensions match
   * the measure sheet" is a bad day, the same line failing eleven times is a
   * process that needs changing.
   */
  function qcSummary(entries) {
    var s = { rounds: entries.length, passed: 0, failed: 0, passRate: null,
              byPhase: {}, topFailures: [] };
    var fails = {};
    entries.forEach(function (e) {
      if (e.passed) s.passed++; else s.failed++;
      var g = s.byPhase[e.phase] || (s.byPhase[e.phase] = { key: e.phase, rounds: 0, failed: 0 });
      g.rounds++;
      if (!e.passed) g.failed++;
      e.failed.forEach(function (f) {
        fails[f.text] = (fails[f.text] || 0) + 1;
      });
    });
    if (s.rounds) s.passRate = Math.round((s.passed / s.rounds) * 100);
    s.topFailures = Object.keys(fails).map(function (k) { return { text: k, n: fails[k] }; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
    return s;
  }

  /* =============================================================== safety */

  function safetyBoardId() {
    var cfg = global.WF_CONFIG || {};
    return cfg.safetyBoardId || FALLBACK_SAFETY_BOARD;
  }

  /**
   * What a report is. Near miss leads deliberately: it is the one people don't
   * bother reporting, and it is the one that predicts the injury.
   */
  var KINDS = [
    { name: "Near miss", color: "yellow" },
    { name: "Injury", color: "red" },
    { name: "Hazard", color: "orange" },
    { name: "PPE request", color: "blue" }
  ];

  var OPEN_HINT = /just reported|new|report/i;
  var CLOSED_HINT = /closed|done|resolved/i;

  function safetyStatusOf(listName) {
    var n = String(listName || "");
    if (CLOSED_HINT.test(n)) return "closed";
    if (OPEN_HINT.test(n)) return "new";
    return "working";
  }

  /**
   * The three questions a safety report asks.
   *
   * Short on purpose. A long form on a phone in a shop is a form nobody fills
   * in, and an unreported near miss is worth nothing at all.
   */
  var INTAKE = [
    { key: "what", label: "What happened?", required: true, rows: 3,
      hint: "Plain words. Nobody is in trouble for writing this down." },
    { key: "where", label: "Where, and when?", rows: 2,
      hint: "Which machine, bay or job — and roughly when." },
    { key: "fix", label: "What would stop it happening again?", rows: 2,
      hint: "Optional. Say so if you don't know." }
  ];

  function ensureLabels(t, existing) {
    var have = {};
    (existing || []).forEach(function (l) { if (l.name) have[l.name.toLowerCase()] = l; });
    var missing = KINDS.filter(function (k) { return !have[k.name.toLowerCase()]; });
    if (!missing.length) return Promise.resolve(existing || []);
    return Promise.all(missing.map(function (k) {
      return WFRest.write(t, "POST", "/labels", {
        idBoard: safetyBoardId(), name: k.name, color: k.color
      }).catch(function () { return null; });
    })).then(function (made) {
      return (existing || []).concat(made.filter(Boolean));
    });
  }

  function loadSafety(t) {
    var id = safetyBoardId();
    return Promise.all([
      WFRest.request(t, "/boards/" + id + "/lists", { fields: "name" }),
      WFRest.request(t, "/boards/" + id + "/cards", {
        fields: "name,desc,idList,idLabels,idMembers,due,dateLastActivity,shortUrl,badges,closed",
        filter: "open"
      }),
      WFRest.request(t, "/boards/" + id + "/labels", { fields: "name,color", limit: 50 })
        .catch(function () { return []; }),
      WFRest.request(t, "/boards/" + id + "/members", { fields: "fullName,username" })
        .catch(function () { return []; })
    ]).then(function (r) {
      return ensureLabels(t, r[2] || []).then(function (labels) {
        return buildSafety(r[0] || [], r[1] || [], labels, r[3] || []);
      });
    });
  }

  function buildSafety(rawLists, rawCards, labels, members) {
    var lists = rawLists.map(function (l, i) {
      return { id: l.id, name: l.name, status: safetyStatusOf(l.name), order: i, count: 0 };
    });
    var listById = {}; lists.forEach(function (l) { listById[l.id] = l; });
    var labelById = {}; (labels || []).forEach(function (l) { labelById[l.id] = l; });
    var memberById = {}; (members || []).forEach(function (m) { memberById[m.id] = m; });

    var reports = rawCards.filter(function (c) { return !c.closed; }).map(function (c) {
      var list = listById[c.idList];
      if (list) list.count++;
      var names = (c.idLabels || []).map(function (id) { return labelById[id]; })
        .filter(Boolean).map(function (l) { return l.name; });
      return {
        id: c.id,
        name: c.name || "Untitled",
        desc: c.desc || "",
        kind: KINDS.map(function (k) { return k.name; })
          .filter(function (n) { return names.indexOf(n) !== -1; })[0] || "Hazard",
        status: list ? list.status : "new",
        list: list ? list.name : "",
        listId: c.idList,
        url: c.shortUrl,
        due: c.due || null,
        at: filedAt(c.id),
        updatedAt: c.dateLastActivity,
        comments: (c.badges && c.badges.comments) || 0,
        owner: (c.idMembers || []).map(function (m) { return memberById[m]; })
          .filter(Boolean)[0] || null
      };
    });
    reports.sort(function (a, b) { return new Date(b.at || 0) - new Date(a.at || 0); });
    return { boardId: safetyBoardId(), lists: lists, labels: labels, members: members, reports: reports };
  }

  /**
   * File a report.
   *
   * `anonymous` is offered and honoured: the name is simply left out of the
   * card. Somebody who will only report a near miss without their name on it
   * should still be able to report it -- the event is what matters, and a
   * system that insists on attribution just gets fewer reports.
   */
  function fileSafety(t, data, fields) {
    var target = ((data && data.lists) || []).filter(function (l) {
      return l.status === "new";
    })[0] || ((data && data.lists) || [])[0];
    if (!target) {
      return Promise.reject(new Error(
        'The safety board has no "Just reported" list — add one in Trello and try again.'));
    }
    var headline = String((fields && fields.name) || "").trim();
    if (!headline) return Promise.reject(new Error("Give it a short headline first."));

    var label = ((data && data.labels) || []).filter(function (l) {
      return l.name === (fields.kind || "Hazard");
    })[0];

    return WFRest.write(t, "POST", "/cards", {
      idList: target.id,
      name: headline,
      desc: composeSafetyDesc(fields.answers, fields.anonymous ? null : fields.filer),
      pos: "top",
      idLabels: label ? label.id : undefined
    });
  }

  function composeSafetyDesc(answers, filer) {
    var parts = [];
    INTAKE.forEach(function (q) {
      var v = String((answers && answers[q.key]) || "").trim();
      if (v) parts.push("**" + q.label + "**\n" + v);
    });
    parts.push("---\nReported " +
      new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) +
      (filer ? " by " + (filer.fullName || filer.username) : " anonymously") + ".");
    return parts.join("\n\n");
  }

  /**
   * The numbers a safety meeting opens with. Days since the last injury is the
   * one everybody recognises, and it is null rather than zero when there has
   * never been one -- "0 days" would read as "somebody got hurt today".
   */
  function safetySummary(reports) {
    var s = { total: 0, open: 0, byKind: {}, daysSinceInjury: null, last30: 0 };
    var cut = Date.now() - 30 * DAY;
    (reports || []).forEach(function (r) {
      s.total++;
      if (r.status !== "closed") s.open++;
      s.byKind[r.kind] = (s.byKind[r.kind] || 0) + 1;
      if (r.at && new Date(r.at).getTime() >= cut) s.last30++;
      if (r.kind === "Injury" && r.at) {
        var d = (Date.now() - new Date(r.at).getTime()) / DAY;
        if (s.daysSinceInjury === null || d < s.daysSinceInjury) s.daysSinceInjury = d;
      }
    });
    return s;
  }

  /* ============================================================= training */

  function getTraining(t) {
    return t.get("board", "shared", TRAINING_KEY, null).then(function (v) {
      if (!Array.isArray(v)) return [];
      return v;
    }).catch(function () { return []; });
  }

  /**
   * The size check here was a hand-copy of lib/eos.js's, and it had already
   * drifted to inline 3800/4096 instead of shared constants. It also measured
   * only this record, which is not the limit -- the board's keys share one
   * budget. Both problems go away by using the one write path.
   */
  function saveTraining(t, rows) {
    return global.WFStore.set(t, "board", TRAINING_KEY, rows || [],
      { label: "the training records" });
  }

  /**
   * Current / expiring / expired / no expiry.
   *
   * Sixty days of warning is deliberate: a forklift ticket or a first-aid
   * certificate takes weeks to rebook, so a warning that arrives the week it
   * lapses is a warning that arrives too late.
   */
  function trainingStatus(row) {
    if (!row || !row.expiresAt) return { state: "none", days: null };
    var days = (new Date(row.expiresAt).getTime() - Date.now()) / DAY;
    if (days < 0) return { state: "expired", days: days };
    if (days <= 60) return { state: "expiring", days: days };
    return { state: "current", days: days };
  }

  function trainingSummary(rows) {
    var s = { total: 0, expired: 0, expiring: 0, current: 0, noExpiry: 0, people: {} };
    (rows || []).forEach(function (r) {
      s.total++;
      var st = trainingStatus(r).state;
      if (st === "expired") s.expired++;
      else if (st === "expiring") s.expiring++;
      else if (st === "current") s.current++;
      else s.noExpiry++;
      (s.people[r.person || "unnamed"] = s.people[r.person || "unnamed"] || []).push(r);
    });
    return s;
  }

  /* ================================================================ shared */

  function nameOf(p) {
    if (!p) return "";
    if (typeof p === "string") return p;
    return p.fullName || p.username || "";
  }

  function jobNumber(name) {
    var m = /#\s*(\d[\d-]*)/.exec(String(name || ""));
    return m ? "#" + m[1] : "";
  }

  /** Creation time out of a Trello id -- see lib/eos.js for why this is safe. */
  function filedAt(cardId) {
    var hex = String(cardId || "").substring(0, 8);
    if (!/^[0-9a-f]{8}$/i.test(hex)) return null;
    return new Date(parseInt(hex, 16) * 1000);
  }

  /** Free-text match across whatever the section holds. */
  function search(rows, query, fields) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return rows || [];
    var terms = q.split(/\s+/);
    return (rows || []).filter(function (r) {
      var hay = (fields || Object.keys(r)).map(function (f) {
        var v = r[f];
        return typeof v === "string" ? v : "";
      }).join(" ").toLowerCase();
      return terms.every(function (term) { return hay.indexOf(term) !== -1; });
    });
  }

  global.WFRecords = {
    TRAINING_KEY: TRAINING_KEY,
    KINDS: KINDS,
    INTAKE: INTAKE,

    timeEntries: timeEntries,
    openEntries: openEntries,
    timeSummary: timeSummary,
    sortedGroups: sortedGroups,
    since: since,
    toCSV: toCSV,
    median: median,

    qcEntries: qcEntries,
    qcSummary: qcSummary,

    safetyBoardId: safetyBoardId,
    safetyStatusOf: safetyStatusOf,
    ensureLabels: ensureLabels,
    loadSafety: loadSafety,
    buildSafety: buildSafety,
    fileSafety: fileSafety,
    composeSafetyDesc: composeSafetyDesc,
    safetySummary: safetySummary,

    getTraining: getTraining,
    saveTraining: saveTraining,
    trainingStatus: trainingStatus,
    trainingSummary: trainingSummary,

    nameOf: nameOf,
    jobNumber: jobNumber,
    filedAt: filedAt,
    search: search
  };
})(window);
