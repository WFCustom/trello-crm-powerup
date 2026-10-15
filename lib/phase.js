/**
 * Shared phase-flow logic: claim/accept/decline -> start/pause -> complete ->
 * manager approval -> auto-advance to next stage. Used by connector.js (card
 * buttons, if/when they render) and by popups/myjobs.js (the fullscreen "My
 * Jobs" dashboard), which is the primary, always-working surface for this --
 * see README for why.
 *
 * IMPORTANT: every function here takes a card ID (string), not a Trello card
 * object, and calls t.get()/t.set()/t.remove() with that ID as the scope
 * instead of the literal string "card". Per Trello's docs
 * (client-library/getting-and-setting-data), "you can set data on a card from
 * any context by calling t.set with its ID" -- this is what lets My Jobs
 * claim/start/pause/complete ANY card directly from one board-level modal,
 * without needing that card open in an iframe of its own. The literal-"card"
 * scope only works when Trello considers a card "in scope" (i.e. you're
 * already inside that card's own capability/iframe) -- using the ID instead
 * is a strict superset that works everywhere, including from inside the
 * card's own context, so connector.js uses it too for consistency.
 *
 * Storage (per card, scope = that card's ID, visibility = "shared"):
 *   phaseWork = {
 *     listId, claimedBy, assignedBy,
 *     segments: [{start,end}],       // start/stop timer log
 *     pendingApproval, completedAt,
 *     percentComplete                // 0-100, settable any time
 *   }
 *   phaseLog = [ { listId, listName, claimedBy, durationMinutes, completedAt, approvedBy, approvedAt }, ... ]
 */
(function (global) {
  async function getPhaseWork(t, cardId) {
    return (await t.get(cardId, "shared", "phaseWork", null)) || null;
  }

  // Returns phaseWork only if it belongs to the card's CURRENT list -- once a
  // card is approved and moved, any leftover phaseWork is stale and ignored.
  // cardMeta needs at least { id, idList }.
  async function getActivePhaseWork(t, cardMeta) {
    const work = await getPhaseWork(t, cardMeta.id);
    if (work && work.listId === cardMeta.idList) return work;
    return null;
  }

  function totalMinutes(work) {
    if (!work || !work.segments) return 0;
    let ms = 0;
    work.segments.forEach((seg) => {
      const end = seg.end ? new Date(seg.end) : new Date();
      ms += end - new Date(seg.start);
    });
    return Math.round(ms / 60000);
  }

  function isRunning(work) {
  if (!work || !work.segments || !work.segments.length) return false;
    const last = work.segments[work.segments.length - 1];
    return !last.end;
  }

  /**
   * Minutes on this phase, split by whose hands were on it.
   *
   * `totalMinutes` answers "how long did this phase take", which is the right
   * figure for costing and for a due-date forecast. This answers "how long did
   * each person spend", which is the one the shop is actually trying to learn,
   * and the two stop agreeing the moment a job changes hands.
   *
   * An unstamped segment belongs to whoever currently holds the claim -- see
   * takeOver, which stamps the outgoing worker's segments on the way past. So a
   * job that never changed hands needs no extra storage and still answers
   * correctly here.
   */
  function minutesByPerson(work) {
    const out = {};
    if (!work || !work.segments) return out;
    const fallback = (work.claimedBy && work.claimedBy.username) || "unrecorded";
    work.segments.forEach((seg) => {
      const who = seg.by || fallback;
      const end = seg.end ? new Date(seg.end) : new Date();
      out[who] = (out[who] || 0) + (end - new Date(seg.start));
    });
    Object.keys(out).forEach((k) => { out[k] = Math.round(out[k] / 60000); });
    return out;
  }

  /** True once more than one person has worked this phase. */
  function changedHands(work) {
    return Object.keys(minutesByPerson(work)).length > 1;
  }

  function percentComplete(work) {
    if (!work || typeof work.percentComplete !== "number") return 0;
    return Math.max(0, Math.min(100, work.percentComplete));
  }

  /**
   * Has the work in this phase been finished?
   *
   * ONE ANSWER, IN ONE PLACE, BECAUSE THIS QUESTION USED TO HAVE SEVEN.
   *
   * Seven screens each asked it by reading `work.pendingApproval` directly, and
   * that flag means "a manager has not clicked Approve yet" -- a fact about a
   * workflow we are removing, not about the work. So retiring approvals broke
   * all seven at once, silently and in different directions: the shop floor
   * kept finished jobs on benches forever, the Dashboard's "Waiting on you"
   * tile read a permanent zero, and My jobs' "Waiting on a manager" bucket
   * emptied out while the cards in it stayed stuck.
   *
   * `completedAt` is the fact. It is a timestamp saying the work was finished,
   * and it is true whether a manager approved it, a peer signed it, or the
   * person who did it signed their own list.
   *
   * The `pendingApproval` clause is a READ-ONLY bridge for cards that were
   * completed under the old model and are still sitting on the board. Nothing
   * writes that flag any more. Delete the clause once the board has none left.
   */
  function isFinished(work) {
    if (!work) return false;
    return !!(work.completedAt || work.pendingApproval);
  }

  async function setPercentComplete(t, cardMeta, percent) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work) return null;
    work.percentComplete = Math.max(0, Math.min(100, Math.round(percent)));
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    return work;
  }

  // Manager assigns a specific worker to this phase without starting the
  // timer -- distinct from Trello's native card-member picker, so it doesn't
  // get mixed up with unrelated "who's watching this card" assignments.
  // The worker still taps Accept (or Start) when they actually begin.
  async function assign(t, cardMeta, manager, worker) {
    const work = {
      listId: cardMeta.idList,
      claimedBy: { id: worker.id, username: worker.username, fullName: worker.fullName },
      assignedBy: { id: manager.id, username: manager.username, fullName: manager.fullName },
      segments: [],
      pendingApproval: false,
      completedAt: null,
      percentComplete: 0
    };
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    try { await global.WFRest.addMemberToCard(t, cardMeta.id, worker.id); } catch (e) { /* non-fatal */ }
    try {
      await global.WFRest.postComment(t, cardMeta.id, manager.fullName + " assigned this phase to " + worker.fullName + ".");
    } catch (e) { /* non-fatal */ }
    return work;
  }

  // Worker declines a manager assignment -- clears it back to unclaimed so
  // anyone else (or a manager) can reassign. Distinct from Undo, which is for
  // a worker's OWN mis-tap on Complete.
  async function declineAssignment(t, cardMeta, worker, reason) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work) return null;
    try {
      await global.WFRest.postComment(
        t, cardMeta.id,
        worker.fullName + " declined this assignment" + (reason ? (": " + reason) : ".")
      );
    } catch (e) { /* non-fatal */ }
    await t.remove(cardMeta.id, "shared", "phaseWork");
    return null;
  }

  async function claimAndStart(t, cardMeta, member) {
    const work = {
      listId: cardMeta.idList,
      claimedBy: { id: member.id, username: member.username, fullName: member.fullName },
      segments: [{ start: new Date().toISOString(), end: null }],
      pendingApproval: false,
      completedAt: null,
      percentComplete: 0
    };
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    try { await global.WFRest.addMemberToCard(t, cardMeta.id, member.id); } catch (e) { /* non-fatal */ }
    return work;
  }

  // Worker accepts a manager assignment and starts the timer -- same effect
  // as "Start", named separately so the UI can offer Accept/Decline together.
  async function acceptAssignment(t, cardMeta) {
    return resume(t, cardMeta);
  }

  /**
   * Take a job somebody else had, and write down that it changed hands.
   *
   * WHY THE HANDOVER IS RECORDED RATHER THAN JUST WARNED ABOUT
   *
   * A welder who gets ahead pulling the next job off another bench is the shop
   * organising itself, and it should not need a manager. But a job that has
   * been worked carries somebody's hours and a percentage against it, and
   * moving it silently makes two people's numbers wrong: the first looks slow
   * for work they handed on, the second looks fast for work they inherited.
   *
   * So the fact is kept. The comment is the permanent half -- native to the
   * card, readable without the Power-Up, and free of the 4096-character budget.
   * `takenFrom` is the live half, so the station can say "taken from Kevin at
   * 40%" rather than the new person wondering why the bar is not at zero.
   *
   * Only the LAST handover is kept on the card. A job changing hands four times
   * is worth knowing, and the comments say so in order; keeping the whole chain
   * in phase work would spend the card's budget on history that already exists
   * somewhere better.
   */
  async function takeOver(t, cardMeta, member, opts) {
    opts = opts || {};
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work) throw new Error("There is no open work on this job to take.");

    const from = work.claimedBy;
    const pct = percentComplete(work);
    const mins = totalMinutes(work);
    const same = from && member && from.username === member.username;
    if (same) return work;

    // The clock stops for the person handing over, so their segments end here
    // and the next person's start clean. Without this the first worker's timer
    // keeps running against somebody else's hands on the job.
    if (isRunning(work)) {
      work.segments[work.segments.length - 1].end = new Date().toISOString();
    }

    /* STAMP THE OUTGOING WORKER ONTO THEIR OWN SEGMENTS, BEFORE THE CLAIM MOVES.
     *
     * Segments are one list and `totalMinutes` sums the lot, so without this
     * the person who FINISHES a job is credited with every hour the person who
     * started it put in — in the bench display, in My jobs, and permanently in
     * the phaseLog entry that Performance and Records read. A job Kevin took to
     * 70% and Dale finished would record entirely against Dale. Per-person
     * build times are the reason the timer exists, so that is not a rounding
     * error, it is the measurement being wrong.
     *
     * Stamped HERE rather than on every push, so an ordinary job that never
     * changes hands pays nothing: an unstamped segment belongs to whoever
     * `claimedBy` says, and that is only ambiguous once somebody else takes
     * over. Doing it one moment before the claim moves is what keeps it cheap
     * and keeps it correct.
     */
    if (from && from.username) {
      work.segments = (work.segments || []).map(function (seg) {
        return seg.by ? seg : Object.assign({}, seg, { by: from.username });
      });
    }

    work.claimedBy = { id: member.id, username: member.username, fullName: member.fullName };
    if (from) {
      work.takenFrom = {
        username: from.username || null,
        fullName: from.fullName || from.username || null,
        pct: pct,
        at: new Date().toISOString()
      };
    }
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    try { await global.WFRest.addMemberToCard(t, cardMeta.id, member.id); } catch (e) { /* non-fatal */ }

    if (from) {
      try {
        await global.WFRest.postComment(
          t, cardMeta.id,
          member.fullName + " took this over from " + (from.fullName || from.username) +
          " at " + pct + "%" + (mins ? " (" + mins + " min logged so far)" : "") +
          (opts.reason ? " — " + opts.reason : "") + "."
        );
      } catch (e) { /* the record is the comment; losing it must not block the job */ }
    }
    return work;
  }

  async function pause(t, cardMeta) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work || !isRunning(work)) return work;
    work.segments[work.segments.length - 1].end = new Date().toISOString();
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    return work;
  }

  async function resume(t, cardMeta) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work || isRunning(work)) return work;
    work.segments.push({ start: new Date().toISOString(), end: null });
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    return work;
  }

  // `opts.silent` suppresses the comment. The shop floor passes it because the
  // job does NOT then wait for a manager -- QC sign-off advances it on the spot,
  // and approveAndAdvance writes its own comment a moment later. Without this
  // every floor hand-off would leave "awaiting manager approval" on the card,
  // immediately contradicted by the next line. A comment that is wrong for a
  // second is a comment somebody screenshots.
  async function complete(t, cardMeta, opts) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work) return null;
    if (isRunning(work)) work.segments[work.segments.length - 1].end = new Date().toISOString();
    /* pendingApproval IS NO LONGER WRITTEN.
     *
     * It meant "waiting for a manager to click Approve", and there is no such
     * click any more -- a signed checklist finishes a phase and moves the card
     * in one action. Setting it was what stranded jobs: it took the card off
     * the shop floor (isFinished counts it) and parked it in a queue whose only
     * two screens have been retired. Nothing was coming for those cards.
     *
     * completedAt carries the fact on its own. Everything that used to read the
     * flag now goes through isFinished, which still honours it for cards
     * completed before this change.
     */
    work.completedAt = new Date().toISOString();
    work.percentComplete = 100;
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    if (opts && opts.silent) return work;
    try {
      await global.WFRest.postComment(
        t, cardMeta.id,
        "Marked complete by " + ((work.claimedBy && work.claimedBy.fullName) || "somebody") +
        " after " + totalMinutes(work) + " min."
      );
    } catch (e) { /* non-fatal, comment is a nice-to-have audit trail */ }
    return work;
  }

  // Mis-tap recovery: reopen a card that was marked complete, resuming the timer.
  async function undoComplete(t, cardMeta) {
    const work = await getActivePhaseWork(t, cardMeta);
    // Gating on pendingApproval alone made this a SILENT no-op the moment
    // complete() stopped writing that flag -- the button stayed, did nothing,
    // and reported nothing. This is also the rescue for a card stranded under
    // the old model, so it has to accept both.
    if (!work || !isFinished(work)) return work;
    work.pendingApproval = false;
    work.completedAt = null;
    work.segments.push({ start: new Date().toISOString(), end: null });
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    return work;
  }

  // Manager action: log the finished phase, clear the working state, and
  // move the card to the next configured stage (if any). cardMeta needs
  // { id, idList, idBoard }.
  async function approveAndAdvance(t, cardMeta, manager) {
    const work = await getActivePhaseWork(t, cardMeta);
    // isFinished, not the flag: complete() no longer writes pendingApproval, and
    // gating on it here would have made this throw for every job finished after
    // the change -- including the self-check path, which calls complete() and
    // then comes straight here.
    if (!work || !isFinished(work)) throw new Error("This phase has not been finished yet.");

    // Through the global on purpose: lib/advance.js replaces WFPhase.advance
    // with a route-aware wrapper, and calling the local binding would quietly
    // skip it -- sending plain railings down the CNC route again.
    return global.WFPhase.advance(t, cardMeta, manager, { verb: "Approved" });
  }

  /**
   * Finish a phase and move the card on. No approval involved.
   *
   * THIS IS THE ONLY CODE THAT RETIRES A PHASE: it writes the phaseLog entry,
   * clears phaseWork, moves the card and posts the audit comment. Everything
   * that ends a phase goes through here -- manager approval, a signed QC
   * checklist, a self-check -- so the record of what happened has one shape
   * regardless of which gate let it past.
   *
   * It was previously fused into approveAndAdvance, which refused to run unless
   * `pendingApproval` was set. That made retiring approvals impossible without
   * losing the logging and the move along with them. Split so the gate and the
   * bookkeeping are separate decisions.
   *
   * `by` is whoever is credited. Deliberately not called "manager": under the
   * QC model it is the person who signed the checklist, and the audit trail
   * should name whoever actually vouched for the work.
   */
  /**
   * Append one finished piece of work to the card's phase log.
   *
   * SPLIT OUT OF advance() BECAUSE NOT EVERY FINISH IS A MOVE.
   *
   * The blast booth and the powder booth share one Trello column, so when blast
   * finishes there is nowhere for the card to go -- but the hours are real and
   * have to be recorded, or they vanish when the phase work is cleared and the
   * next bench starts its own. Logging and moving were fused, so a step that
   * could not move could not log either, and every hour of blasting the shop
   * had ever done was absent from costing.
   *
   * `opts.listName` overrides the stage name, so a step logs under its PHASE --
   * lib/costing.js buckets on that name and would file "Sandblast" as
   * Unassigned. `opts.step` rides alongside for anyone asking which bench.
   */
  /**
   * Append one entry to the card's phase log, trimming only as far as it must.
   *
   * THE LOG MUST NOT BE ABLE TO BLOCK A JOB, AND MUST NOT LOSE A PHASE QUIETLY.
   *
   * Two bad options and this picks the third. `.slice(-30)` allowed about
   * 11,000 characters on a card whose whole budget is 4,096 -- so a job with a
   * couple of ReWork loops would eventually make this write fail, and because
   * the log is written before the card moves, the hand-off failed with it. A
   * welder pressing Complete on a well-travelled job would have been stuck.
   *
   * Refusing is not an option on a shop floor. Trimming silently is the exact
   * data loss we are here to stop. So it trims only as far as it must, and
   * counts what it dropped: `trimmed` rides on the entries, so the archive can
   * later report "this job lost 3 earlier phases" rather than the history being
   * quietly shorter than the truth.
   *
   * The running total is read BEFORE anything is trimmed. The first cut put it
   * on `log.trimmed` -- a property of the ARRAY, which t.get rebuilds from JSON
   * on every read, so it was always undefined and the count silently restarted
   * at zero. Three trims of 6, 1 and 1 recorded "1".
   *
   * When phase records move to durable storage this whole dance goes away: the
   * log becomes a pointer and the card stops carrying history at all.
   */
  async function appendLog(t, cardMeta, entry) {
    const log = (await t.get(cardMeta.id, "shared", "phaseLog", [])) || [];
    const carried = log.reduce((n, e) => Math.max(n, (e && e.trimmed) || 0), 0);

    let updated = log.concat([entry]);
    let dropped = 0;
    if (global.WFStore) {
      let room = await global.WFStore.roomFor(t, cardMeta.id, "phaseLog", updated);
      // Never drop the entry just written -- that is the one this call exists
      // to record, and losing it would make finished work invisible.
      while (room.full && updated.length > 1) {
        updated = updated.slice(1);
        dropped++;
        room = await global.WFStore.roomFor(t, cardMeta.id, "phaseLog", updated);
      }
    } else {
      updated = updated.slice(-30);
    }
    if (carried || dropped) entry.trimmed = carried + dropped;
    await t.set(cardMeta.id, "shared", "phaseLog", updated);
    return updated;
  }

  async function logPhase(t, cardMeta, opts) {
    opts = opts || {};
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work) throw new Error("No open phase work on this card.");
    const by = opts.by || {};
    const stage = global.WFStage.getStageForList(cardMeta.idBoard, cardMeta.idList);
    const entry = {
      listId: cardMeta.idList,
      listName: opts.listName || (stage ? stage.name : cardMeta.idList),
      claimedBy: work.claimedBy,
      durationMinutes: totalMinutes(work),
      completedAt: work.completedAt,
      approvedBy: { id: by.id, username: by.username, fullName: by.fullName },
      approvedAt: new Date().toISOString()
    };
    if (opts.step) entry.step = opts.step;
    // Only when it actually changed hands. One name is already in claimedBy,
    // and a byPerson map repeating it would cost budget to say nothing.
    if (changedHands(work)) entry.byPerson = minutesByPerson(work);
    await appendLog(t, cardMeta, entry);
    return entry;
  }

  async function advance(t, cardMeta, by, opts) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work) throw new Error("No open phase work on this card.");
    const verb = (opts && opts.verb) || "Completed";

    const stage = global.WFStage.getStageForList(cardMeta.idBoard, cardMeta.idList);
    const logEntry = {
      listId: cardMeta.idList,
      listName: stage ? stage.name : cardMeta.idList,
      claimedBy: work.claimedBy,
      durationMinutes: totalMinutes(work),
      completedAt: work.completedAt,
      // Kept under the old key names. Records, Performance and the tests all
      // read approvedBy/approvedAt, and renaming them to suit the new model
      // would break four screens to gain nothing.
      approvedBy: { id: by.id, username: by.username, fullName: by.fullName },
      approvedAt: new Date().toISOString()
    };

    /* WHICH BENCH, WHERE A PHASE HAS MORE THAN ONE.
     *
     * logPhase() stamps this on every step that hands over, but the LAST step
     * of a split phase ships the card and so comes through here instead. With
     * no stamp the archive showed one finishing entry saying "Sandblast" and a
     * second saying nothing at all -- indistinguishable from a legacy
     * whole-phase entry, so nobody could tell whether the unstamped hours were
     * powder coat or a job logged before the split existed. Same field, same
     * meaning, both paths. Absent for every undivided phase, as before. */
    if (opts && opts.step) logEntry.step = opts.step;
    // The per-person split, where a job changed hands. Without it the archive
    // credits every hour of the phase to whoever happened to finish it, and
    // per-person build times -- the reason the timer exists -- read as fiction.
    if (changedHands(work)) logEntry.byPerson = minutesByPerson(work);

    await appendLog(t, cardMeta, logEntry);

    const who = (work.claimedBy && work.claimedBy.fullName) || "somebody";
    const head = verb + " by " + by.fullName + " (" + logEntry.listName + ", " +
                 logEntry.durationMinutes + " min by " + who + ").";

    /* ORDER MATTERS, AND IT USED TO BE WRONG.
     *
     * phaseWork was removed BEFORE the card was moved. When the move failed --
     * a permissions blip, a 429, a dropped connection -- the phase record was
     * already destroyed while the card sat in the same list. The result was a
     * job with a valid signed QC record, no phase work, and a Complete button
     * that threw "No open phase work on this card" every single time it was
     * pressed. The only escape was to Start it again from zero, losing the
     * recorded duration.
     *
     * Moving first inverts which failure you get, and the inverted one is
     * strictly better:
     *   log write fails  -> nothing else has happened, press it again.
     *   move fails       -> phaseWork is intact, press it again; the log gets a
     *                       duplicate line, which is visible and harmless.
     *   remove fails     -> the card has moved, so the leftover work no longer
     *                       matches its list and getActivePhaseWork already
     *                       ignores it by design.
     * None of those is a dead end.
     */
    const next = global.WFStage.getNextStage(cardMeta.idBoard, cardMeta.idList);
    if (next) await global.WFRest.moveCard(t, cardMeta.id, next.listId);

    await t.remove(cardMeta.id, "shared", "phaseWork");

    // The comment is the audit trail, not the mechanism. A board that refuses
    // comments must not undo a hand-off that has already happened.
    try {
      await global.WFRest.postComment(t, cardMeta.id, next
        ? head + " Moved to " + next.name + "."
        : head + " No next stage configured -- card left in place.");
    } catch (e) { /* non-fatal */ }
    return { logEntry, movedTo: next };
  }

  // Manager reject: clear pendingApproval without advancing, e.g. QC failed.
  async function reject(t, cardMeta, manager, reason) {
    const work = await getActivePhaseWork(t, cardMeta);
    if (!work) return null;
    work.pendingApproval = false;
    work.completedAt = null;
    work.segments.push({ start: new Date().toISOString(), end: null });
    await t.set(cardMeta.id, "shared", "phaseWork", work);
    try {
      await global.WFRest.postComment(
        t, cardMeta.id,
        "Sent back by " + manager.fullName + (reason ? (": " + reason) : " (no reason given).") + " Timer resumed."
      );
    } catch (e) { /* non-fatal */ }
    return work;
  }

  global.WFPhase = {
    getPhaseWork,
    getActivePhaseWork,
    totalMinutes,
    minutesByPerson,
    changedHands,
    isRunning,
    isFinished,
    percentComplete,
    setPercentComplete,
    assign,
    declineAssignment,
    claimAndStart,
    acceptAssignment,
    takeOver,
    pause,
    resume,
    complete,
    undoComplete,
    advance,
    logPhase,
    appendLog,
    approveAndAdvance,
    reject
  };
})(window);
