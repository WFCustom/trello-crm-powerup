/**
 * WFChecklist -- the self-check dialog, shared by every surface that finishes
 * a phase.
 *
 * WHY THIS IS ITS OWN FILE
 *
 * It started inside the My jobs tab, which meant the Work board had no way to
 * reach it. So the Work board's "Mark done" called WFPhase.complete() bare --
 * setting pendingApproval and leaving the card waiting for a manager who, under
 * the model we are moving to, is never coming. Two surfaces, two behaviours,
 * one of them silently stranding work.
 *
 * Copying the dialog into the second file would have fixed the symptom and
 * guaranteed the two drift apart. A phase either ends with somebody putting
 * their name to a list or it doesn't, and that has to be one answer in one
 * place, whichever screen the person happens to be standing on.
 *
 * A PHASE WITH NO SAVED CHECKLIST IS NOT A PHASE WITH NO GATE. The list falls
 * back to a single "Work is complete and correct" line, so the job still gets
 * a signature and still moves. The alternative -- advancing silently because
 * nobody wrote a checklist yet -- is how a gate becomes decoration.
 */
(function () {
  "use strict";

  var O = WFOps;

  /**
   * Who may vouch for this phase's work.
   *
   * A peer-checked phase offers everyone EXCEPT the person who did the work,
   * and starts with nobody selected so a name has to be chosen deliberately.
   * Everything else defaults to the worker signing their own list. That is the
   * "peer by default, self where it makes sense" rule, expressed once.
   *
   * Phase specialists come first when the roster names any, because on a phase
   * with a specialist they are the answer; the rest of the board follows, since
   * the specialist list is often empty and an empty dropdown blocks the job.
   */
  function signerOptions(ctx, stage, peer) {
    var members = (ctx.board && ctx.board.members) || [];
    var me = ctx.member.username;
    var specialists = (ctx.roster && ctx.roster.phaseSpecialists &&
      ctx.roster.phaseSpecialists[stage ? stage.name : ""]) || [];
    var rank = {};
    specialists.forEach(function (u, i) { rank[u] = i; });

    return members
      .filter(function (m) { return !peer || m.username !== me; })
      .slice()
      .sort(function (a, b) {
        var ra = rank[a.username], rb = rank[b.username];
        if (ra !== undefined && rb !== undefined) return ra - rb;
        if (ra !== undefined) return -1;
        if (rb !== undefined) return 1;
        return O.displayName(a).localeCompare(O.displayName(b));
      });
  }

  /**
   * Work the phase's checklist and, if every line passes, move the job on.
   *
   * `onDone` is called after the write so the caller can refresh whatever it
   * draws. Returns nothing useful -- the dialog owns the flow from here.
   */
  function open(ctx, card, stage, onDone) {
    var phase = stage ? stage.name : "";
    var meta = { id: card.id, idList: card.idList, idBoard: ctx.board.id };
    /* PEER-CHECKED PHASES COME THROUGH HERE NOW TOO.
     *
     * They used to call WFPhase.complete() bare and then park a qcRecord with
     * status "awaiting_check" -- which only the Quality check tab could clear,
     * and that tab is retired. The primary green button on most shop phases was
     * therefore putting jobs somewhere nothing could get them out of: off the
     * station (isFinished reads pendingApproval), into "Waiting on a manager",
     * and no manager coming. The work is checked and signed at the bench now;
     * the only thing a peer phase adds is that the name on the signature is
     * somebody else's. */
    var peer = !!(WFQC.requiresQc && WFQC.requiresQc(phase));

    WFQC.getTemplate(ctx.t, phase).then(function (template) {
      var items = (template && template.length)
        ? template.map(function (i) { return WFQC.normItem(i).text; })
        : ["Work is complete and correct"];
      var rows = [];
      var body = O.el("div");

      items.forEach(function (text) {
        var box = O.el("input", { type: "checkbox" });
        // The note only matters for a line somebody could NOT tick, so it hides
        // itself once the line passes. Asking what went wrong with something
        // that went right is how forms get ignored.
        var note = O.el("input", { type: "text", placeholder: "What's outstanding? (optional)" });
        box.addEventListener("change", function () {
          note.style.display = box.checked ? "none" : "";
        });
        rows.push({ text: text, box: box, note: note });
        body.appendChild(O.el("div", {
          style: "padding:10px 0;border-bottom:1px solid var(--wf-band)"
        },
          O.el("label", {
            style: "display:flex;align-items:center;gap:10px;margin:0;font-weight:400"
          }, box, O.el("span", { style: "font-size:14px;color:var(--wf-text)", text: text })),
          O.el("div", { style: "margin-top:6px" }, note)));
      });

      var people = signerOptions(ctx, stage, peer);
      var who = O.el("select");
      who.appendChild(O.el("option", {
        value: "",
        text: peer ? "Who checked it…" : "Signing it myself"
      }));
      people.forEach(function (m) {
        who.appendChild(O.el("option", { value: m.username, text: O.displayName(m) }));
      });

      var signRow = O.el("div", { style: "margin-top:14px" },
        O.el("label", { text: peer ? "Who checked this work?" : "Signed off by" }),
        who,
        O.el("div.hint", { style: "margin-top:6px",
          text: peer
            ? "This phase is peer-checked, so the name here has to be somebody " +
              "other than you. They are who the record says vouched for it."
            : "Leave it as is to sign your own work, or name whoever checked it." }));

      O.dialog({
        title: (phase || "This phase") + " checklist",
        note: card.name,
        content: O.el("div", null, body, signRow,
          O.el("div.hint", { style: "margin-top:12px",
            text: "Tick everything and the job moves on. Anything left unticked keeps it with you — "
                + "it's saved, so you can come back to it." })),
        buttons: [{
          label: "Sign off and move it on", primary: true, busyText: "Signing…",
          onClick: function () {
            var signer = people.filter(function (m) {
              return m.username === who.value;
            })[0] || null;
            // A peer phase with nobody named is not signable. Refusing here,
            // before anything is written, is the whole point of the gate.
            if (peer && !signer) {
              window.alert("Name who checked it. A peer-checked phase needs a " +
                "second person's name on it before the job can move on.");
              return;
            }
            var results = rows.map(function (r) {
              return { text: r.text, result: r.box.checked ? "pass" : "fail", note: r.note.value };
            });
            return WFQC.submitSelfCheck(ctx.t, meta, phase, ctx.member, results, signer)
              .then(function (res) {
                if (!res.passed) {
                  // Not a rejection and not a failure: an unticked line simply
                  // means the phase isn't finished. Nothing moves, nobody is
                  // blamed, and what's left is written down.
                  window.alert("Still to do:\n\n" +
                    res.outstanding.map(function (i) {
                      return "• " + i.text + (i.note ? " — " + i.note : "");
                    }).join("\n") +
                    "\n\nSaved. The job stays with you until these are ticked.");
                }
                return onDone ? onDone(res) : res;
              });
          }
        }]
      });
    }).catch(function (e) {
      window.alert((e && e.message) || "Couldn't open the checklist.");
    });
  }

  window.WFChecklist = { open: open };
})();
