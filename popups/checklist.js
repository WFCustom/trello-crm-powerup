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
   * Work the phase's checklist and, if every line passes, move the job on.
   *
   * `onDone` is called after the write so the caller can refresh whatever it
   * draws. Returns nothing useful -- the dialog owns the flow from here.
   */
  function open(ctx, card, stage, onDone) {
    var phase = stage ? stage.name : "";
    var meta = { id: card.id, idList: card.idList, idBoard: ctx.board.id };

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

      O.dialog({
        title: (phase || "This phase") + " checklist",
        note: card.name,
        content: O.el("div", null, body,
          O.el("div.hint", { style: "margin-top:12px",
            text: "Tick everything and the job moves on. Anything left unticked keeps it with you — "
                + "it's saved, so you can come back to it." })),
        buttons: [{
          label: "Sign off and move it on", primary: true, busyText: "Signing…",
          onClick: function () {
            var results = rows.map(function (r) {
              return { text: r.text, result: r.box.checked ? "pass" : "fail", note: r.note.value };
            });
            return WFQC.submitSelfCheck(ctx.t, meta, phase, ctx.member, results)
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
