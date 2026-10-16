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
  /**
   * username -> the name a human would recognise, built from the cards in hand.
   *
   * WHY THIS EXISTS: `who` HAS TO MEAN ONE THING.
   *
   * The byPerson split a hand-over writes is keyed by USERNAME -- that is all
   * takeOver can afford to store, and all it needs, since the card already
   * carries the full name elsewhere. Every other row in timeEntries sets `who`
   * from nameOf(claimedBy), which is a DISPLAY NAME. timeSummary then groups on
   * `who`, so without this the same welder lands in the report twice -- once as
   * "kevinmoss" and once as "Kevin Moss" -- with their hours split across the
   * two rows. That is worse than the bug the split was written to fix: it does
   * not just misattribute hours, it hides a person's real total in plain sight.
   *
   * So the username is resolved back to a display name before it is used as a
   * key. The names come from the same data the hours do -- every claimedBy and
   * approvedBy on every card in the set -- so no roster lookup, no network call
   * and no new storage. A username nobody is named against anywhere falls back
   * to itself, which is a readable last resort and still groups consistently.
   */
  function nameIndex(cards) {
    var idx = {};
    function note(p) {
      if (!p || typeof p !== "object") return;
      if (p.username && p.fullName && !idx[p.username]) idx[p.username] = p.fullName;
    }
    (cards || []).forEach(function (card) {
      (card.phaseLog || []).forEach(function (e) {
        note(e && e.claimedBy);
        note(e && e.approvedBy);
      });
      var w = card.phaseWork;
      if (w) { note(w.claimedBy); note(w.assignedBy); note(w.takenFrom); }
    });
    return idx;
  }

  function timeEntries(cards) {
    var out = [];
    var names = nameIndex(cards);
    (cards || []).forEach(function (card) {
      var econ = card.economics || {};
      var value = Number(econ.value) || null;
      (card.phaseLog || []).forEach(function (e) {
        var mins = Number(e.durationMinutes);
        if (!isFinite(mins) || mins <= 0) return;

        /* A PHASE THAT CHANGED HANDS IS MORE THAN ONE PERSON'S WORK.
         *
         * `durationMinutes` is how long the phase took, which is right for
         * costing and for the hours-per-$1,000 figure. But "who" used to read
         * `claimedBy`, which after a hand-over is whoever FINISHED it — so a
         * job Kevin took to 70% and Dale closed out reported every hour against
         * Dale, and the per-person build times this whole build exists to
         * produce were quietly wrong in exactly that dimension.
         *
         * Where the log carries a byPerson split, one row per person. The phase
         * total is unchanged because the parts sum to it; what changes is that
         * the hours land on the right names. */
        var split = e.byPerson && typeof e.byPerson === "object"
          ? Object.keys(e.byPerson) : [];

        if (split.length > 1) {
          split.forEach(function (username) {
            var m = Number(e.byPerson[username]);
            if (!isFinite(m) || m <= 0) return;
            out.push({
              cardId: card.id,
              job: card.name,
              jobNumber: jobNumber(card.name),
              phase: e.listName || "",
              // Which bench, where a phase has more than one. Carried because
              // phaseKey needs it to tell blast from powder -- see phaseKey.
              step: e.step || "",
              // Resolved to a display name so it groups with every other row
              // this person has -- see nameIndex.
              who: names[username] || username,
              approvedBy: nameOf(e.approvedBy),
              minutes: m,
              hours: m / 60,
              at: e.completedAt || e.approvedAt || null,
              value: value,
              // Flagged so a reader can tell a shared phase from a solo one,
              // and so the job-level value is not counted once per person.
              shared: true,
              ongoing: false
            });
          });
          return;
        }

        out.push({
          cardId: card.id,
          job: card.name,
          jobNumber: jobNumber(card.name),
          phase: e.listName || "",
          step: e.step || "",
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
   * Every phase with work on the card right now, as provisional entries.
   *
   * Flagged `ongoing` and kept out of every average on purpose: a job half
   * finished would drag the numbers down and make the shop look slower than it
   * is. Shown, not counted.
   *
   * NOT ALL OF THESE ARE LIVE. The row carries `running`, `paused`, `finished`
   * and `percent` so a caller can tell a welder mid-job from one that stopped
   * for lunch from one that is done and waiting to move on. Splitting them is
   * the caller's job because the three want different screen furniture, but
   * deciding WHICH each one is happens here, once.
   */
  function openEntries(cards) {
    var out = [];
    (cards || []).forEach(function (card) {
      var w = card.phaseWork;
      if (!w || w.listId !== card.idList) return;
      var mins = minutesOf(w);
      var pct = global.WFPhase.percentComplete(w);

      /* TWO SEPARATE REASONS TO DROP A ROW, which used to be one guard.
       *
       * NaN is the hard one: an unreadable clock (see minutesOf) must never
       * reach the screen, because "NaN" beside a welder's name is worse than
       * no row at all. That check stays absolute.
       *
       * A zero clock is the soft one, and it was costing us a row the owner
       * explicitly asked for. `if (!mins)` dropped NaN and zero together, so
       * a phase assigned to a bench and pushed along the slider -- no
       * segments, therefore no minutes -- never appeared in the live mirror
       * at all, despite having visible progress to mirror. Zero minutes with
       * progress on it is real work somebody is doing off the clock; zero
       * with nothing on it is an empty assignment and still not worth a row.
       */
      if (typeof mins !== "number" || isNaN(mins)) return;
      if (!mins && !pct) return;

      /* THE THREE FACTS THE LIVE MIRROR IS MADE OF, read from the one place
       * that owns them. The Records tab paints these beside the bench's own
       * chips, so "running" has to mean on both screens what the Start/Pause
       * button means: an open final segment, and nothing else.
       *
       * `finished` is here because a phase that has been COMPLETED but not yet
       * moved on still has phase work sitting on the card -- normally for the
       * moment between complete() and advance(), but indefinitely for a card
       * whose move failed, and permanently for one finished under the retired
       * approval model. Without the flag every one of those rendered under
       * "Running right now": a job nobody is touching, shown as live work.
       */
      var running = global.WFPhase.isRunning(w);
      var finished = global.WFPhase.isFinished(w);

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
        ongoing: true,
        running: running,
        // PAUSED MEANS STOPPED, NOT MERELY NOT-RUNNING. It used to be safe to
        // conflate them, because nothing without segments survived the guard
        // above. Now a percent-only row does, and calling that "paused" would
        // put a stopped-clock label on a job whose clock was never started --
        // telling a manager somebody walked away from work nobody has begun.
        paused: !running && !finished && !!(w.segments || []).length,
        finished: finished,

        /* 100 ONCE THE PHASE IS FINISHED, whatever the slider last said.
         *
         * complete() writes percentComplete = 100 itself and is the only
         * writer of completedAt anywhere in the repo, so every phase finished
         * under the current model already reads 100 without this. What it
         * catches is the card finished under the retired approval model, which
         * isFinished still honours through `pendingApproval`: those were
         * parked at whatever percent the bench had reached, and a finished
         * phase reading 65% next to the word "complete" is the contradiction
         * that makes people stop believing the screen. */
        percent: finished ? 100 : global.WFPhase.percentComplete(w)
      });
    });
    return out;
  }

  /**
   * DELEGATES ON PURPOSE -- this was the third private copy of the same sum.
   *
   * The copies drifted. WFPhase clamps a segment that runs backwards to zero,
   * because a shop tablet with a fast clock writes a `start` in the future and
   * unclamped that NEGATIVE stretch cancels out real hours. This copy did not
   * clamp, and it feeds further than any of the others: `openEntries` guards
   * with `if (!mins) return`, a negative is truthy, so −30 minutes flowed into
   * timeSummary's running totals and out through byJob, byPerson, byPhase and
   * both ratios. A skewed tablet could drag the shop's hours-per-thousand
   * figure down without a single visible symptom.
   */
  function minutesOf(work) {
    // No local fallback on purpose -- see WFTables.elapsedMinutes. A guarded
    // duplicate would just be the fourth copy, agreeing for now.
    return Math.round(global.WFPhase.elapsedMs(work) / 60000);
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

    /* A SHARED PHASE IS ONE PHASE, HOWEVER MANY PEOPLE WORKED IT.
     *
     * A phase that changed hands emits one row per person so the hours land on
     * the right names -- but `count` was counting rows, so the Records header
     * reported a two-person CAD phase as "2 finished phases" and the per-phase
     * table doubled with it. Minutes were right and the headline above them was
     * not, which is the combination most likely to be believed.
     *
     * Counted on (card, phase, when) instead, so the parts of one phase
     * collapse back into one. byPerson still counts per person, because there
     * two rows genuinely are two people's work.
     */
    var seenPhase = {};
    entries.forEach(function (e) {
      // Same key the export uses, so the two can never disagree about what
      // counts as one phase.
      var key = phaseKey(e);
      var firstOfPhase = !seenPhase[key];
      seenPhase[key] = true;

      s.minutes += e.minutes;
      bump(s.byPerson, e.who || "unrecorded", e);
      bump(s.byPhase, e.phase || "unrecorded", e, null, firstOfPhase);
      bump(s.byJob, e.job, e, e.value, firstOfPhase);
    });
    s.hours = s.minutes / 60;
    s.phases = Object.keys(seenPhase).length;

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

  /**
   * `countIt` defaults to true so every existing caller is unchanged.
   *
   * It is false for the second and later rows of a phase that changed hands:
   * their MINUTES are real and belong in the total, but they are not another
   * finished phase. Counting them was turning one shared CAD job into two.
   */
  function bump(map, key, e, value, countIt) {
    var g = map[key] || (map[key] = { key: key, minutes: 0, hours: 0, count: 0, value: null });
    g.minutes += e.minutes;
    g.hours = g.minutes / 60;
    if (countIt !== false) g.count++;
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
    /* A SHARED PHASE MUST NOT POISON THE SPREADSHEET.
     *
     * This file is the raw material for setting the shop's standard build time,
     * so a figure that is quietly a fraction of the truth is worse here than
     * anywhere else in the system -- nobody re-derives it, they SUM the column
     * and believe it.
     *
     * Two things go wrong on a phase that changed hands, and both are silent:
     *
     *   Job value repeated on every row of a phase. Written on the first row
     *   of each phase instead, so two people working one phase stop counting
     *   that job's value twice.
     *
     *   NOT the same as "the column sums to the total job value", and the first
     *   version of this comment claimed it was. A job with CAD, Assemble and
     *   Finishing in the window writes its value on three rows, because this
     *   export is one row per PHASE and always has been. Per-phase placement is
     *   what makes the ratio column below meaningful, so it stays -- but anyone
     *   summing that column is summing value-by-phase, not value-by-job, and
     *   should group on Job first.
     *
     *   Hours per $1,000 computed per row. Each row holds one person's share of
     *   the hours against the WHOLE job value, so a two-way split reads as
     *   roughly half the real ratio -- on the single number this export exists
     *   to produce. Left blank on a split row rather than printed wrong, with
     *   the phase's true figure on the first row where the hours are whole.
     *
     * The `Shared phase` column is what makes both legible: anyone can filter
     * on it and see immediately which rows are parts rather than wholes.
     */
    var head = ["Job", "Job number", "Phase", "Who", "Approved by",
                "Minutes", "Hours", "Completed", "Job value", "Hours per $1,000",
                "Shared phase"];

    var live = (entries || []).filter(function (e) { return !e.ongoing; });

    // Phase totals, so a split row's first line can still carry a true ratio.
    var totals = {};
    live.forEach(function (e) {
      var k = phaseKey(e);
      totals[k] = (totals[k] || 0) + (e.hours || 0);
    });

    var seen = {};
    var rows = live.map(function (e) {
      var k = phaseKey(e);
      var first = !seen[k];
      seen[k] = true;
      var shared = !!e.shared;
      var hours = shared ? totals[k] : e.hours;
      var per = (e.value && hours && first) ? (hours / (e.value / 1000)) : "";
      return [
        e.job, e.jobNumber || "", e.phase, e.who, e.approvedBy,
        Math.round(e.minutes), round2(e.hours),
        e.at ? new Date(e.at).toISOString().slice(0, 10) : "",
        // Value on the first row of a phase only -- see above.
        (first && e.value) ? e.value : "",
        per === "" ? "" : round2(per),
        shared ? "yes" : ""
      ];
    });
    return [head].concat(rows).map(function (r) {
      return r.map(csvCell).join(",");
    }).join("\n");
  }

  /**
   * One phase of one job, finished once -- however many people touched it.
   *
   * `step` IS PART OF THE IDENTITY, NOT DECORATION.
   *
   * The blast booth and the powder booth share one Trello column, and both log
   * under that column's PHASE name on the same card -- deliberately, because
   * lib/costing.js buckets on the phase (see lib/steps.js and logPhase's
   * `opts.listName`). So cardId|phase is the same string for two genuinely
   * separate pieces of finished work, and only the timestamp keeps them apart.
   * That is a tie-breaker, not an identity: two benches finishing in the same
   * millisecond -- or any entry written without a completedAt, where `at`
   * falls back to null for both -- collapses blast and powder into one phase.
   * The visible damage is the quiet kind this whole fix exists to stop: the
   * phase count under-reports, and the export writes the job value and the
   * hours-per-$1,000 on one row of the two, so SUM(Job value) loses a job.
   *
   * `step` is absent on every undivided phase, so nothing else moves.
   */
  function phaseKey(e) {
    return (e.cardId || "") + "|" + (e.phase || "") + "|" + (e.step || "") +
           "|" + (e.at || "");
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
      rec.rounds.forEach(function (rd, n) {
        var isLast = n === rec.rounds.length - 1;
        // Through WFQC so both round shapes read the same. A slim round stores
        // verdicts by position against the record's template; reading rd.items
        // directly would report every check as having zero lines.
        var items = (global.WFQC && global.WFQC.roundItems)
          ? global.WFQC.roundItems(rec, rd)
          : (rd.items || []);
        var failed = items.filter(function (i) { return i.result === "fail"; });

        /* AN UNFINISHED CHECK IS NOT A FAILED CHECK.
         *
         * popups/checklist.js stores every unticked line of a self-check as
         * result "fail", meaning "the phase isn't finished" -- nothing moved,
         * nobody was blamed. The Floor now tells that apart from a real fault
         * via isFaultRound, but the archive did not, so a drafter who ticked
         * one line of the eight-line CAD list and went home scored a failed
         * round: the QC pass rate fell toward zero and "what fails most" filled
         * with lines nobody had said were wrong. A training table built from
         * people not having finished yet is worse than no table.
         *
         * A self-check round carrying failures is therefore work in progress.
         * A peer round's failures ARE judgements -- submitCheck takes an
         * explicit pass/fail per line from a checker who looked -- and a floor
         * fault round is a judgement by definition. Both still count.
         */
        var mode = rd.mode ||
          ((global.WFQC && global.WFQC.modeOf) ? global.WFQC.modeOf(rec) : null);
        var raised = global.WFQC && global.WFQC.isFaultRound &&
          global.WFQC.isFaultRound(rd);

        /* `rd.mode`, NOT the inferred one. Only a round we KNOW is a self-check.
         *
         * WFQC.modeOf falls back to "self" for any record with no mode, no
         * signature and no peer markers -- which is every record written before
         * the mode field existed. Those came from the peer path, where a checker
         * looked at a line and failed it deliberately. Reading them as
         * unfinished would quietly drop real history out of the pass rate and
         * the training table: the archive would get cleaner-looking by
         * forgetting things.
         *
         * Every current writer stamps the round explicitly, so "unknown" can
         * safely mean "count it" -- an old judgement still counts as one. */
        var unfinished = !!failed.length && rd.mode === "self" && !raised;

        out.push({
          unfinished: unfinished,
          cardId: card.id,
          job: card.name,
          jobNumber: jobNumber(card.name),
          phase: rec.phase || rec.listName || "",
          round: rd.n,
          checkedBy: nameOf(rd.checkedBy),
          at: rd.checkedAt || rd.correctedAt || rd.verifiedAt || null,
          passed: failed.length === 0 && items.length > 0,
          items: items.length,
          /* A fault and what was done about it, together.
           *
           * `fixes` is keyed by the item's position in the round, which is how
           * the slim round stores everything. Carrying the answer alongside the
           * fault is the whole reason faults are collected: "twisted 3mm across
           * the diagonal" on its own is a complaint, next to "reheated and
           * re-clamped, re-measured at 1/16" it is training material. */
          failed: failed.map(function (i) {
            var fix = (rd.fixes || {})[i.index] || (rd.fixes || {})[String(i.index)] || null;
            return {
              text: i.text, note: i.note || "",
              fixed: !!fix,
              fix: fix ? fix.what : "",
              fixedBy: fix ? nameOf(fix.by) : "",
              fixedAt: fix ? fix.at : null
            };
          }),
          /* OPEN MEANS OPEN NOW, WHICH IS A NARROWER THING THAN IT LOOKS.
           *
           * Two filters, and both are load-bearing:
           *
           * `isFaultRound` -- an unticked line of a self-check is stored as
           * "fail" and means "not finished yet", not "something is wrong". Only
           * a round somebody deliberately raised as a fault can hold one.
           *
           * the last round only -- an earlier round's failure was either
           * answered or superseded by a later look. Counting every round would
           * make every job that ever failed anything show as needing attention
           * forever, and a to-do list that only grows gets ignored.
           */
          openFaults: (isLast && global.WFQC && global.WFQC.isFaultRound &&
                       global.WFQC.isFaultRound(rd))
            ? failed.filter(function (i) {
                var fx = rd.fixes || {};
                return !(fx[i.index] || fx[String(i.index)]);
              }).length
            : 0,
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
          // Via global, and guarded, so a surface that loads this file without
          // lib/qc.js still renders rather than throwing on every row. ops.html
          // always loads qc.js first, and so does records.test.js -- the guards
          // are a floor, not the path anybody should be testing against.
          mode: mode
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
              byPhase: {}, topFailures: [], openFaults: 0, unfinished: 0 };
    var fails = {};
    entries.forEach(function (e) {
      // Open faults are counted even on an unfinished round, because an open
      // fault is a fact about right now. Everything else below is a judgement
      // about quality, and an unfinished check has not made one.
      s.openFaults += e.openFaults || 0;
      if (e.unfinished) { s.unfinished++; return; }

      if (e.passed) s.passed++; else s.failed++;
      var g = s.byPhase[e.phase] || (s.byPhase[e.phase] = { key: e.phase, rounds: 0, failed: 0 });
      g.rounds++;
      if (!e.passed) g.failed++;
      e.failed.forEach(function (f) {
        /* THE ANSWERS ARE KEPT, NOT JUST THE COUNT.
         *
         * A tally says "dimensions match the measure sheet, 11 times". That
         * tells a trainer there is a problem and nothing about it. The fixes
         * people wrote are the content of the lesson -- eleven different
         * answers means eleven different causes and the line is too vague;
         * eleven of the same answer is one process to change.
         *
         * Kept at eight so the record stays a size a person will read and a
         * board will store. */
        var f0 = fails[f.text] || (fails[f.text] = {
          text: f.text, n: 0, phases: {}, notes: [], fixes: []
        });
        f0.n++;
        if (e.phase) f0.phases[e.phase] = (f0.phases[e.phase] || 0) + 1;
        if (f.note && f0.notes.length < 8) f0.notes.push(f.note);
        if (f.fix && f0.fixes.length < 8) f0.fixes.push(f.fix);
      });
    });
    // Completed rounds are the denominator, not every round. Dividing by
    // s.rounds would put unfinished checks back into the figure through the
    // bottom of the fraction after taking them out of the top.
    var judged = s.passed + s.failed;
    if (judged) s.passRate = Math.round((s.passed / judged) * 100);
    s.topFailures = Object.keys(fails).map(function (k) {
      var f = fails[k];
      // The phase it fails in most. A line failing everywhere is a wording
      // problem; a line failing only at one bench is a bench problem, and the
      // two want completely different responses.
      f.worstPhase = Object.keys(f.phases).sort(function (a, b) {
        return f.phases[b] - f.phases[a];
      })[0] || "";
      return f;
    }).sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
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
    nameIndex: nameIndex,
    jobNumber: jobNumber,
    filedAt: filedAt,
    search: search
  };
})(window);
