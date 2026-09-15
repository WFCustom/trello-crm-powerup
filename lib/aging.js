/**
 * WFAging -- how long a job has really been sitting, and whether it will make
 * its date.
 *
 * WHAT WAS WRONG BEFORE
 *
 * The dashboard read "days waiting" from `WFStage.daysSince(card.dateLastActivity)`
 * -- time since ANY activity on the card. A comment, a label, an attachment, a
 * checklist tick all reset it to zero. A job parked in Sandblast for three weeks
 * read as "0.2d" because somebody commented on it that morning. It was then
 * compared against the phase's fixed allowance and never against the card's own
 * due date, so the number was neither time-in-stage nor on-track: it answered a
 * question nobody asked.
 *
 * WHAT THIS MEASURES INSTEAD
 *
 * Two separate facts, kept separate on purpose:
 *
 *   TIME IN STAGE   now minus the last time the card moved INTO the list it is
 *                   in. Trello records every list move as an action, so this is
 *                   observed rather than inferred.
 *
 *   WILL IT LAND    the days of work still ahead of it (the SLA allowance of
 *                   this phase and every phase after it) against the days left
 *                   until the card is due.
 *
 * The second is the one a manager acts on. A job three days into a three-day
 * phase is fine if it isn't due for a month, and a crisis if it ships Friday --
 * and the old number couldn't tell those apart.
 *
 * WHY ONE CALL AND NOT ONE PER CARD
 *
 * `WFRest.getCardListHistory` gives a card's move history, but the board has
 * about 140 open cards and that would be 140 REST calls to paint a dashboard.
 * Trello will return the whole board's actions in one request, so this asks for
 * the list-move actions once and indexes them by card.
 *
 * THE WINDOW, AND WHY "AT LEAST" IS AN HONEST ANSWER
 *
 * That one call is capped -- Trello returns at most 1000 actions -- so it is
 * bounded by a time window rather than pretending to reach back forever. A card
 * whose last move predates the window has no record here, and instead of
 * guessing, it reports `atLeast: true`: "in this stage at least 90 days". That
 * is both true and sufficient, because a job that has sat in one phase for a
 * quarter needs attention regardless of the exact figure.
 */
(function (global) {
  "use strict";

  /** How far back to ask for moves. 90 days covers every live job comfortably. */
  var WINDOW_DAYS = 90;

  /** Trello's ceiling. Hitting it exactly means the answer was truncated. */
  var ACTION_LIMIT = 1000;

  var DAY = 86400000;

  /* -------------------------------------------------------------- the moves */

  /**
   * Every list move on the board inside the window, indexed by card id and
   * newest first.
   *
   * createCard and copyCard are included because a card that has never moved
   * still entered its list at some point -- when it was made.
   */
  function loadMoves(t, boardId, windowDays) {
    var days = windowDays || WINDOW_DAYS;
    var since = new Date(Date.now() - days * DAY).toISOString();
    return WFRest.request(t, "/boards/" + boardId + "/actions", {
      filter: "createCard,copyCard,updateCard:idList",
      limit: ACTION_LIMIT,
      since: since
    }).then(function (actions) {
      return index(actions || [], days);
    }).catch(function () {
      return { byCard: {}, windowDays: days, truncated: false, ok: false };
    });
  }

  function index(actions, days) {
    var byCard = {};
    actions.forEach(function (a) {
      var cardId = a.data && a.data.card && a.data.card.id;
      if (!cardId) return;

      var listId = null;
      if (a.type === "updateCard" && a.data.listAfter) listId = a.data.listAfter.id;
      else if (a.type === "createCard" || a.type === "copyCard") {
        listId = (a.data.list && a.data.list.id) || null;
      }
      if (!listId) return;

      (byCard[cardId] = byCard[cardId] || []).push({ listId: listId, date: a.date });
    });

    // Trello hands back newest-first, but don't rely on it.
    Object.keys(byCard).forEach(function (id) {
      byCard[id].sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    });

    return {
      byCard: byCard,
      windowDays: days,
      truncated: actions.length >= ACTION_LIMIT,
      ok: true
    };
  }

  /* ------------------------------------------------------------ time in stage */

  /**
   * When the card entered the list it is in now, or null if that happened
   * before the window.
   *
   * Walks newest-first and takes the first entry matching the card's current
   * list -- the most recent arrival. Earlier visits to the same list (a job
   * that bounced to ReWork and came back) are correctly ignored.
   */
  function enteredAt(moves, card) {
    var log = moves && moves.byCard && moves.byCard[card.id];
    if (!log) return null;
    for (var i = 0; i < log.length; i++) {
      if (log[i].listId === card.idList) return log[i].date;
    }
    return null;
  }

  /**
   * Real days in the current stage.
   *
   * `atLeast` means the move predates the window, so the number is a floor, not
   * a measurement. Callers must render that distinction -- "23 days" and "90+
   * days" are different claims and only one of them is precise.
   */
  function timeInStage(moves, card) {
    var at = enteredAt(moves, card);
    if (at) {
      return {
        days: Math.max(0, (Date.now() - new Date(at).getTime()) / DAY),
        since: at,
        atLeast: false,
        known: true
      };
    }
    return {
      days: (moves && moves.windowDays) || WINDOW_DAYS,
      since: null,
      atLeast: true,
      known: false
    };
  }

  /* -------------------------------------------------------------- the due date */

  /** Days until the card is due. Negative means it's gone past. */
  function daysToDue(card) {
    if (!card || !card.due) return null;
    return (new Date(card.due).getTime() - Date.now()) / DAY;
  }

  /**
   * How many working days of flow are still ahead of this card, counting the
   * phase it is in.
   *
   * Sums each remaining stage's own allowance, which is the only estimate the
   * board carries today. Terminal stages (Job Closed, Lost Bids) add nothing,
   * and ReWork is skipped because it's an exception, not a step every job takes
   * -- counting it would make every job look doomed.
   */
  function remainingDays(boardCfg, card) {
    var stages = (boardCfg && boardCfg.stages) || [];
    var here = stages.filter(function (s) { return s.listId === card.idList; })[0];
    if (!here) return null;

    var seen = {};
    var total = 0;
    stages.forEach(function (s) {
      if ((s.order || 0) < (here.order || 0)) return;
      if (s.isTerminal) return;
      if (s.isException && s.listId !== card.idList) return;
      if (s.slaDays === null || s.slaDays === undefined) return;
      // Four Install lists are one phase; count its allowance once.
      var key = (s.phase || s.name) + "@" + s.order;
      if (seen[key]) return;
      seen[key] = true;
      total += s.slaDays;
    });
    return total;
  }

  /* --------------------------------------------------------------- the verdict */

  /**
   * Will this job make its date?
   *
   * Deliberately arithmetic a person can check: days of work left versus days
   * left. When it says at-risk it can show you the subtraction, which is what
   * makes it worth trusting -- and what the old "days waiting" number could
   * never do.
   */
  function forecast(boardCfg, moves, card) {
    var inStage = timeInStage(moves, card);
    var toDue = daysToDue(card);
    var remaining = remainingDays(boardCfg, card);
    var out = {
      inStage: inStage,
      daysToDue: toDue,
      remainingDays: remaining,
      verdict: "no-date",
      slack: null
    };

    if (card.dueComplete) { out.verdict = "done"; return out; }
    if (toDue === null) { out.verdict = "no-date"; return out; }
    if (toDue < 0) { out.verdict = "late"; return out; }
    if (remaining === null) { out.verdict = "unmapped"; return out; }

    out.slack = toDue - remaining;
    if (out.slack < 0) out.verdict = "at-risk";
    else if (out.slack < remaining * 0.25) out.verdict = "tight";
    else out.verdict = "on-track";
    return out;
  }

  var VERDICT = {
    late:     { text: "past its date",  tone: "late",  rank: 0 },
    "at-risk":{ text: "won't make it",  tone: "late",  rank: 1 },
    tight:    { text: "cutting it fine", tone: "warn", rank: 2 },
    "on-track":{ text: "on track",      tone: "go",    rank: 4 },
    "no-date":{ text: "no date set",    tone: "quiet", rank: 3 },
    unmapped: { text: "phase not mapped", tone: "quiet", rank: 3 },
    done:     { text: "done",           tone: "go",    rank: 5 }
  };

  function verdictText(v) { return (VERDICT[v] || VERDICT["no-date"]).text; }
  function verdictTone(v) { return (VERDICT[v] || VERDICT["no-date"]).tone; }
  function verdictRank(v) { return (VERDICT[v] || VERDICT["no-date"]).rank; }

  /**
   * The sentence under a row: the subtraction, spelled out.
   *
   * "11 days of work left, 4 days until it's due" beats "at risk" on its own,
   * because the first one tells a manager what to change.
   */
  function explain(f) {
    if (f.verdict === "late") {
      return "due " + phrase(-f.daysToDue) + " ago";
    }
    if (f.verdict === "no-date") return "no due date on the card";
    if (f.verdict === "unmapped") return "this list isn't in the phase map";
    if (f.verdict === "done") return "marked complete";
    return round(f.remainingDays) + " days of work left, " +
           round(f.daysToDue) + " until it's due";
  }

  function round(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return Math.round(n * 10) / 10;
  }

  /** "3 days", "5 hours", "just now" -- for a duration, not a date. */
  function phrase(days) {
    if (days === null || days === undefined || isNaN(days)) return "—";
    if (days < 1 / 24) return "just now";
    if (days < 1) {
      var h = Math.max(1, Math.round(days * 24));
      return h + (h === 1 ? " hour" : " hours");
    }
    var d = Math.round(days);
    return d + (d === 1 ? " day" : " days");
  }

  /** "23 days" or "90+ days", never one dressed as the other. */
  function stagePhrase(inStage) {
    if (!inStage) return "—";
    if (inStage.atLeast) return Math.round(inStage.days) + "+ days";
    return phrase(inStage.days);
  }

  /* ------------------------------------------------------- the phase's own clock */

  /**
   * How far past its own allowance this phase has run, as a ratio.
   *
   * Kept apart from the due-date verdict because they answer different
   * questions: this one is "is this step dragging", which is a process problem,
   * while the verdict is "will the customer get it on time".
   */
  function stageOverrun(stage, inStage) {
    if (!stage || stage.slaDays === null || stage.slaDays === undefined) return null;
    if (!inStage) return null;
    return inStage.days / stage.slaDays;
  }

  function overrunTone(ratio) {
    if (ratio === null) return "quiet";
    if (ratio >= 2) return "late";
    if (ratio >= 1) return "warn";
    return "go";
  }

  /* ------------------------------------------------------------------ rollup */

  /**
   * Board-level counts by verdict, for the meter at the top of the dashboard.
   * Only open work counts; a card marked done isn't capacity or risk.
   */
  function summary(rows) {
    var s = { late: 0, atRisk: 0, tight: 0, onTrack: 0, noDate: 0, total: 0, worstFirst: [] };
    (rows || []).forEach(function (r) {
      var v = r.forecast.verdict;
      if (v === "done") return;
      s.total++;
      if (v === "late") s.late++;
      else if (v === "at-risk") s.atRisk++;
      else if (v === "tight") s.tight++;
      else if (v === "on-track") s.onTrack++;
      else s.noDate++;
    });
    s.worstFirst = (rows || []).slice().sort(compare);
    return s;
  }

  /**
   * Worst first: by verdict, then by longest in stage.
   *
   * Sorting by time-in-stage alone is what made the old list useless -- the
   * oldest card on the board floated to the top whether or not anything was
   * wrong with it.
   */
  function compare(a, b) {
    var d = verdictRank(a.forecast.verdict) - verdictRank(b.forecast.verdict);
    if (d) return d;
    return (b.forecast.inStage.days || 0) - (a.forecast.inStage.days || 0);
  }

  /** Attach a forecast to every card sitting in a mapped, non-terminal stage. */
  function rows(boardCfg, moves, cards) {
    var stages = (boardCfg && boardCfg.stages) || [];
    var byList = {};
    stages.forEach(function (s) { byList[s.listId] = s; });

    return (cards || []).map(function (card) {
      var stage = byList[card.idList];
      if (!stage || stage.isTerminal) return null;
      return {
        card: card,
        stage: stage,
        forecast: forecast(boardCfg, moves, card),
        overrun: stageOverrun(stage, timeInStage(moves, card))
      };
    }).filter(Boolean);
  }

  global.WFAging = {
    WINDOW_DAYS: WINDOW_DAYS,
    ACTION_LIMIT: ACTION_LIMIT,
    loadMoves: loadMoves,
    index: index,
    enteredAt: enteredAt,
    timeInStage: timeInStage,
    daysToDue: daysToDue,
    remainingDays: remainingDays,
    forecast: forecast,
    verdictText: verdictText,
    verdictTone: verdictTone,
    verdictRank: verdictRank,
    explain: explain,
    phrase: phrase,
    stagePhrase: stagePhrase,
    stageOverrun: stageOverrun,
    overrunTone: overrunTone,
    rows: rows,
    summary: summary,
    compare: compare
  };
})(window);
