/* Install -- the crew's surface in the truck, standing at the customer's door.

   WHY THIS IS NOT THE FLOOR TAB WITH A DIFFERENT FILTER

   An installer has the same machinery as a welder -- claim a job, run a clock,
   move a percent, finish it, pass it on -- and that machinery is deliberately
   not re-implemented here: every one of those actions is a call into WFTables,
   WFPhase or WFQC, exactly as the Floor makes it. What differs is the half of
   the screen above the buttons. A welder needs the drawing; the job is six feet
   from him and the customer is a name he will never meet. An installer needs to
   find the house, ring the right phone, know whether he is meant to come back
   with a cheque, and read the one sentence somebody wrote about the gate code --
   and he needs all four before he gets out of the truck, with no signal, on a
   screen he is holding at arm's length in daylight.

   So the furniture leads with customer, site, payment and instructions, and the
   claim/clock/percent/complete controls sit underneath them. That ordering is
   the whole tab.

   THE MONEY RULE, AND WHERE IT BITES HERE

   This screen shows no figure. Not the job value, not cost, not margin, not for
   a manager either. The standing instruction is relevant information at each
   stage and nothing more, and a crew cab is the one place on this board where a
   screen gets handed to a customer to look at.

   What it DOES show is Payment Status, which is a status and not a figure --
   "Collect At Install", "Paid in Full", "Half Down". That is the fact an
   installer needs and it is already visible to the shop through the card panel
   (WFCardView.MONEY_WORDS does not match "Payment Status", by inspection rather
   than by accident). The amount to collect is not shown because the board does
   not record one: `$Value` is the whole job, and it is gated behind
   see.costing. See the note over paymentFrom() below.

   WHAT A "CREW" IS

   A WFTables station whose area is "install". Same shape as a bench: a name, a
   person, a phase. The phase is "Install", which on this board is four Trello
   lists consolidated into one by config.js's `phase` field -- so a crew's queue
   is every card in any of the four, which is what a crew actually has in front
   of it.

   Wired to WFTables, WFPhase, WFQC, WFStage, WFRest, WFCardPanel. */
(function () {
  "use strict";
  var O = WFOps;

  /**
   * Install's own skin, in the Floor's palette.
   *
   * Same shop, same brand, same navy field with white cards on it -- but scoped
   * under .wf-in rather than reusing .wf-fl, because the two screens are sized
   * for different distances. The Floor is read across a shop off a TV; this is
   * read at arm's length on an iPad held in one hand, which wants bigger touch
   * targets and less of the condensed display type that carries at ten feet and
   * gets thin at two.
   *
   * Nothing here is hover-only. A tablet has no hover, so every affordance is a
   * button that looks like one; `title` is a bonus for the office desktop, never
   * the only signal that something can be tapped.
   */
  (function injectStyles() {
    if (document.getElementById("wf-install-styles")) return;
    var css = [
      ".wf-in{--p-bg:#0f2340;--p-panel:#ffffff;--p-tile:#eef1f6;--p-ink:#12213a;",
      "--p-muted:#5b6b80;--p-accent:#e8a317;--p-ok:#1f9d63;--p-warn:#d9482e;",
      "margin:-30px -32px -40px;padding:22px 26px 30px;background:var(--p-bg);",
      "min-height:100vh;color:#fff;position:relative}",
      /* The same drawn seam the Floor uses: the ops header is this exact navy,
         so without a hairline and a short shadow the chrome and the canvas read
         as one slab and the tab bar looks like it is floating in the page. */
      ".wf-in:before{content:'';position:absolute;left:0;right:0;top:0;height:1px;",
      "background:rgba(255,255,255,.16)}",
      ".wf-in:after{content:'';position:absolute;left:0;right:0;top:1px;height:22px;",
      "background:linear-gradient(rgba(0,0,0,.28),rgba(0,0,0,0));pointer-events:none}",

      ".wf-in-top{display:flex;align-items:center;gap:16px;flex-wrap:wrap;",
      "color:#fff;padding:2px 4px 20px}",
      ".wf-in-area{font-family:'Barlow Condensed',inherit;font-size:19px;font-weight:700;",
      "letter-spacing:.14em;text-transform:uppercase;line-height:1;color:rgba(255,255,255,.72)}",
      ".wf-in-clock{margin-left:auto;text-align:right;line-height:1.15}",
      ".wf-in-clock b{font-family:'Barlow Condensed',inherit;font-size:30px;font-weight:700;display:block}",
      ".wf-in-clock span{font-size:11px;opacity:.7;letter-spacing:.11em;text-transform:uppercase}",

      ".wf-in-grid{display:grid;gap:16px;align-items:start}",
      ".wf-in-col{background:var(--p-panel);border-radius:26px;padding:20px 20px 22px;",
      "display:flex;flex-direction:column;gap:14px;min-width:0;color:var(--p-ink);",
      "box-shadow:0 0 0 1px rgba(255,255,255,.22),0 22px 44px rgba(3,10,22,.55)}",
      ".wf-in-h{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}",
      ".wf-in-crew{font-family:'Barlow Condensed',inherit;font-size:28px;font-weight:700;",
      "color:var(--p-ink);line-height:1}",
      ".wf-in-st{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;font-weight:700;",
      "letter-spacing:.1em;text-transform:uppercase;color:var(--s);margin-left:auto;white-space:nowrap}",
      ".wf-in-st i{width:9px;height:9px;border-radius:50%;background:var(--s);display:inline-block}",
      ".wf-in-rule{height:3px;border-radius:2px;background:var(--s);opacity:.9}",
      ".wf-in-k{font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;",
      "color:var(--p-muted)}",

      /* --- the four things, each its own block ------------------------- */
      /* 17px body and 1.45 line height: this is read in a cab, in daylight,
         by somebody who is not going to pinch-zoom with gloves on. */
      ".wf-in-block{background:var(--p-tile);border-radius:18px;padding:14px 16px;",
      "display:flex;flex-direction:column;gap:6px}",
      ".wf-in-cust{font-family:'Barlow Condensed',inherit;font-size:34px;font-weight:700;",
      "line-height:1.05;color:var(--p-ink);word-break:break-word}",
      ".wf-in-jobno{font-size:14px;font-weight:700;letter-spacing:.06em;color:var(--p-muted)}",
      ".wf-in-text{font-size:17px;line-height:1.45;color:var(--p-ink);white-space:pre-wrap;",
      "word-break:break-word}",
      /* A tap target, not a link. 48px is Apple's own floor for a finger and
         this screen is used with a work glove half on. */
      ".wf-in-tap{display:flex;align-items:center;gap:10px;min-height:48px;width:100%;",
      "text-align:left;cursor:pointer;font:inherit;font-size:17px;font-weight:600;",
      "line-height:1.35;padding:10px 14px;border-radius:14px;border:2px solid var(--p-ink);",
      "background:#fff;color:var(--p-ink);text-decoration:none;box-sizing:border-box}",
      ".wf-in-tap:active{background:var(--p-tile)}",
      ".wf-in-tap b{font-size:12px;letter-spacing:.1em;text-transform:uppercase;",
      "color:var(--p-muted);flex:0 0 auto}",
      ".wf-in-tap span{flex:1 1 auto;min-width:0}",

      /* Payment is the one block allowed to shout, because the consequence of
         missing it is a second trip to the same house. */
      ".wf-in-pay{border-radius:18px;padding:14px 16px;display:flex;flex-direction:column;gap:4px;",
      "border:2px solid var(--pc);background:var(--pb)}",
      ".wf-in-pay-v{font-family:'Barlow Condensed',inherit;font-size:26px;font-weight:700;",
      "line-height:1.1;color:var(--pc)}",
      ".wf-in-pay-n{font-size:14px;line-height:1.4;color:var(--p-ink)}",

      ".wf-in-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:14px;",
      "color:var(--p-muted)}",
      ".wf-in-dot{width:4px;height:4px;border-radius:50%;background:currentColor;opacity:.5}",
      ".wf-in-late{color:var(--p-warn);font-weight:700}",

      ".wf-in-pct{display:flex;justify-content:space-between;font-size:14px;font-weight:700;",
      "color:var(--p-muted)}",
      ".wf-in-bar{height:12px;border-radius:999px;background:#cfd7e2;overflow:hidden}",
      ".wf-in-bar i{display:block;height:100%;background:var(--p-ok)}",
      /* 44px of thumb on the slider: a 20px handle is unusable with a glove. */
      ".wf-in-slider{width:100%;height:44px}",

      ".wf-in-run{display:flex;gap:10px;flex-wrap:wrap}",
      ".wf-in-run .wf-btn{flex:1 1 auto;min-height:52px;font-size:17px}",

      ".wf-in-tile{display:flex;flex-direction:column;gap:3px;width:100%;text-align:left;",
      "cursor:pointer;font:inherit;min-height:56px;padding:11px 14px;border-radius:14px;",
      "border:1px solid #cfd7e2;background:var(--p-tile);color:var(--p-ink);box-sizing:border-box}",
      ".wf-in-tile:active{background:#e3e8f0}",
      ".wf-in-tile b{font-size:16px;font-weight:700;line-height:1.25}",
      ".wf-in-tile span{font-size:13px;color:var(--p-muted)}",
      ".wf-in-more{font-size:13.5px;color:var(--p-muted);line-height:1.45}",
      ".wf-in-empty{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);",
      "border-radius:18px;padding:22px 24px;color:#fff;font-size:16px;line-height:1.5}",
      ".wf-in-empty b{display:block;font-size:19px;margin-bottom:8px}",

      "@media (max-width:600px){",
      ".wf-in{margin:-30px -16px -40px;padding:18px 14px 26px}",
      ".wf-in-cust{font-size:28px}}"
    ].join("");
    var tag = document.createElement("style");
    tag.id = "wf-install-styles";
    tag.textContent = css;
    document.head.appendChild(tag);
  })();

  /* Module-level, so switching away and back keeps the crew you were looking at
     and gives the clock something stable to clean up. */
  var state = { cfg: null, cards: null, host: null, ctx: null, scale: null };

  /** crewId -> which view that column is showing: "crew" | "queue" | "card". */
  var views = {};

  /** crewId -> the queued card opened in the column, when the view is "card". */
  var opened = {};

  /**
   * cardId -> the card's custom fields, once fetched.
   *
   * Payment Status is a custom field and custom fields do not ride along on the
   * board-wide pull (lib/trello-rest.js getBoardCardsFull asks for plugin data,
   * not field items), so it is one extra REST call per card. Only the job
   * actually on a truck is fetched; a twelve-card queue would be twelve calls
   * for a line nobody is reading yet.
   *
   * `undefined` means "not asked", `null` means "asked and it failed" -- the
   * difference is what stops a failed fetch being retried on every repaint.
   */
  var fields = {};

  var tick = null;
  var onResize = null;

  function stopTimers() {
    if (tick) { clearInterval(tick); tick = null; }
    if (onResize) { window.removeEventListener("resize", onResize); onResize = null; }
  }

  function add(parent, node) { if (node) parent.appendChild(node); return parent; }

  /* ===================================================== what the card says
   *
   * EVERY FUNCTION IN THIS SECTION READS card.name OR card.desc AND NOTHING
   * ELSE, because on this board that is where a customer and a site address
   * actually live. There is no customer field and no address field; a check of
   * the Office Operations board's custom fields found JOB TYPE, Phone #:,
   * Email:, Priority, $Value, Payment Status, the railing-spec fields, Site
   * Phase, Job Series, Building, Source, STAR RATING, Called, Left a Message,
   * SEND ESTIMATE, Rework, Sales Rep and Assign TO DO: -- and no address of any
   * kind. Phone #: and Email: exist but were empty on every Install card looked
   * at; the phone was in the description instead, every time.
   *
   * So these parse prose, which is a thing to do carefully and admit to. The
   * rule throughout is that a miss returns null and the view says so. Nothing
   * here guesses: a crew that is told "no site address on this card" goes and
   * reads the notes, which is what they do today. A crew shown a confidently
   * wrong address drives to it.
   */

  /**
   * The job number, which on this board is the digits the card name opens with.
   *
   * "1795- Robert Pearce", "1762 - Doug Briscoe", "1783 Kelly Fisher" -- there
   * is no "#" on any of them. popups/tabs/floor.js's jobNumber() requires one
   * and therefore answers null for every real Install card; it is matching a
   * convention the board does not use. Not fixed here because that file is the
   * Floor's, but the two want to be one function once somebody decides which
   * convention is real.
   */
  function jobNo(card) {
    var m = /^\s*#?\s*(\d{3,}[\d-]*)/.exec((card && card.name) || "");
    return m ? m[1] : null;
  }

  /**
   * Who the job is for.
   *
   * The name after the job number, cut short where an address follows it. The
   * cut only happens when what comes after the dash STARTS WITH A DIGIT,
   * because a house number does and a surname does not: that one rule is what
   * keeps "1762 - Doug Briscoe" whole while reducing "1795- Robert Pearce —
   * 6094 Fruitwood Ln" to the person.
   */
  function customerOf(card) {
    var name = String((card && card.name) || "").trim();
    if (!name) return null;
    var rest = name.replace(/^\s*#?\s*\d{3,}[\d-]*\s*[-–—:.]?\s*/, "").trim();
    if (!rest) return name;
    var cut = /\s[-–—]\s*(\d)/.exec(rest);
    if (cut) rest = rest.slice(0, cut.index).trim();
    return rest || name;
  }

  /**
   * The site address, taken ONLY from a line of the description that opens with
   * an address label.
   *
   * The intake automation writes a structured block -- "**Site address:** 6094
   * Fruitwood Lane" on its own line -- and that is the form this matches. A
   * card where somebody typed the address mid-paragraph ("… Email: x@y.com.
   * Address: 4846 Garns Mnt. Dr, Victor, ID. Notes indicate …") is deliberately
   * NOT matched, because there is no honest way to find the end of it: cutting
   * at the first full stop takes "4846 Garns Mnt." and calls it an address.
   *
   * Those cards answer null and the crew reads the instructions block, which
   * carries the whole description verbatim a few inches below. A miss costs a
   * glance. A wrong address costs a morning.
   */
  function addressOf(card) {
    var desc = String((card && card.desc) || "");
    var m = /^[ \t>*_]*(?:site|job|install|delivery)?[ \t]*address[ \t]*:[ \t*_]*(.+)$/im.exec(desc);
    if (!m) return null;
    var line = m[1].replace(/[*_`]+/g, "").trim();
    // A label with nothing after it, or the intake template's own placeholder.
    if (!line || /^(?:—|-|n\/a|tbd|unknown)$/i.test(line)) return null;
    return line;
  }

  /**
   * A phone number out of the description.
   *
   * URLs are stripped first: a Google Drive folder id is a long alphanumeric
   * run and every Install card carries one, so scanning the raw text for ten
   * digits eventually finds a "phone number" inside a link.
   */
  function phoneOf(card) {
    var desc = String((card && card.desc) || "").replace(/https?:\/\/\S+/g, " ");
    var m = /(?:^|[^\d])(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})(?!\d)/.exec(desc);
    return m ? m[1].trim() : null;
  }

  /**
   * What to do when you get there.
   *
   * The whole description, verbatim, because there is no install-instruction
   * field and inventing one by pattern-matching a heading would mean silently
   * dropping the sentence somebody wrote under a different heading. The crew
   * reads the notes; this puts the notes where they can read them without
   * opening Trello.
   *
   * The intake template's machine-generated preamble is cut where the card
   * carries a markdown rule, since everything above it is a summary of what is
   * below and reading the same thing twice in a cab is worse than scrolling.
   */
  function instructionsOf(card) {
    var desc = String((card && card.desc) || "").trim();
    if (!desc) return null;
    var parts = desc.split(/\n\s*-{3,}\s*\n/);
    var body = (parts.length > 1 ? parts.slice(1).join("\n") : desc).trim();
    return body || null;
  }

  /**
   * A maps link for an address.
   *
   * Nothing in this repo opened a map before, so this is a new scheme and the
   * choice is worth writing down. Google's documented universal URL is used
   * rather than a `geo:` URI or maps.apple.com: `geo:` does nothing on iOS,
   * which is what the crews carry, and maps.apple.com does nothing on the
   * Android phone in the other truck. This form opens the Google Maps app where
   * it is installed and the browser where it is not, on both.
   */
  function mapsUrl(address) {
    return "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(address);
  }

  /* ---------------------------------------------------------------- payment */

  /**
   * The board's field is spelled exactly "Payment Status". Matched
   * case-insensitively and anchored at the start so a rename to "Payment" still
   * lands, but NOT matched loosely anywhere in the name -- config.js already
   * carries the scar from a field name that was almost right ("Job Value (QB)"
   * for a field called "$Value") and failed silently for months.
   */
  function paymentFrom(list) {
    var hit = (list || []).filter(function (f) {
      return /^payment\b/i.test(String(f && f.name) || "");
    })[0];
    return hit && hit.display ? String(hit.display).trim() : null;
  }

  /**
   * What a payment status means to somebody standing on the doorstep.
   *
   * Three outcomes keyed on what the board's dropdown literally says, and the
   * third is a catch-all on purpose. The field has twelve options -- Builder -
   * Needs Bid, Needs Estimate, No Payment, Half Down, Paid in Full, COMPED,
   * Sent Estimate, LOST BID, Collect At Install, Invoiced, Paid in Full - Card,
   * Paid in Full - Check -- and sorting ten of them into "collect" or "don't"
   * would be this file inventing the shop's billing policy. So only the two
   * unambiguous ends are claimed:
   *
   *   settled   paid in full, however it was paid, or comped
   *   collect   the option that says Collect At Install in so many words
   *   unclear   everything else, which is told to ask the office rather than
   *             guess -- including a blank field, which is the usual case
   *
   * THERE IS NO AMOUNT, and that is not an omission. The only figure on the
   * card is `$Value`, which is the whole job and is a money field gated behind
   * see.costing; there is no balance-due or deposit-taken field anywhere on
   * this board. A crew that needs a number asks the office, and if that becomes
   * a daily nuisance the answer is a "Balance Due" field on the board -- not a
   * figure this screen worked out.
   */
  function readPayment(status) {
    var s = String(status || "").trim();
    if (!s) {
      return { kind: "unclear", value: "Not recorded",
               note: "Nothing on the card says where payment stands. Check with the " +
                     "office before you leave the site.", color: "#e8a317" };
    }
    if (/paid in full/i.test(s) || /^comped$/i.test(s)) {
      return { kind: "settled", value: s,
               note: "Nothing to collect.", color: "#1f9d63" };
    }
    if (/collect at install/i.test(s)) {
      return { kind: "collect", value: s,
               note: "Collect payment on site. The office has the amount — call " +
                     "before you pack up, not after.", color: "#d9482e" };
    }
    return { kind: "unclear", value: s,
             note: "Not settled. Check with the office whether anything is " +
                   "collected today.", color: "#e8a317" };
  }

  function payTint(color) {
    // The same hue at 12% behind the border, so the block reads as one object
    // rather than an outline with a white middle.
    return { "#1f9d63": "#eaf6f0", "#d9482e": "#fdecea", "#e8a317": "#fdf4e3" }[color] || "#fff";
  }

  /**
   * Fetch one card's custom fields, once.
   *
   * Lands straight into `fields` and repaints, rather than being awaited by the
   * caller: a crew column has to draw before the network answers, because a
   * truck with no signal must still show the address and the notes. Payment
   * arrives a beat later or says it could not be read.
   */
  function loadFields(card) {
    if (fields[card.id] !== undefined) return;
    fields[card.id] = null;
    /* "IS THIS STILL THE LIVE HOST", NOT "IS THE HOST IN THE DOCUMENT".
     *
     * The question is whether a re-render has replaced the surface since this
     * fetch started, and render() builds a fresh host every time, so comparing
     * the two answers it exactly. `state.host.isConnected` asks something
     * subtly different -- whether the node is in the document -- and the two
     * only coincide inside Trello, where the tab is mounted before anything is
     * fetched. The Floor learned this the expensive way with its cover image:
     * rendered-then-mounted, the fetch resolves in the gap and the result is
     * silently thrown away. Here that gap costs the payment status, which is
     * the one thing on this screen somebody drove out to find.
     */
    var host = state.host;
    Promise.resolve()
      .then(function () {
        return WFRest.getCardFieldsDisplay(state.ctx.t, state.ctx.board.id, card.id);
      })
      .then(function (list) {
        fields[card.id] = list || [];
        if (state.host === host) paint();
      })
      .catch(function () { /* fields[id] stays null: asked, failed, don't retry */ });
  }

  /* --------------------------------------------------------------- the crews */

  /**
   * The install crews, as WFTables stations.
   *
   * `stationsFor` filters on area alone, so this works whether or not
   * WFTables.AREAS has grown an "install" entry -- it has not, and a crew has to
   * be added by hand in the Floor's gear today. The empty state below says so
   * rather than showing a blank screen.
   */
  function crews() {
    return WFTables.areaState(state.ctx.boardCfg, state.cards, state.cfg, "install");
  }

  /* --------------------------------------------------------------- painting */

  function paint() {
    if (!state.host) return;
    stopTimers();
    state.host.innerHTML = "";
    state.host.className = "wf-in";

    add(state.host, topBar());

    var states = crews();
    if (!states.length) {
      add(state.host, noCrews());
      startTimers();
      return;
    }

    var cols = WFTables.columnsFor(window.innerWidth || 1200, states.length);
    state.scale = WFTables.scaleFor(cols);
    var wrap = O.el("div.wf-in-grid");
    wrap.style.gridTemplateColumns = "repeat(" + Math.max(1, cols) + ",minmax(0,1fr))";
    states.forEach(function (st) { wrap.appendChild(crewColumn(st)); });
    add(state.host, wrap);

    startTimers();
  }

  /**
   * Nothing is configured, and the screen says exactly what to do about it.
   *
   * An empty grid would read as "no work today", which is a completely
   * different and much more reassuring fact than "nobody has told this
   * Power-Up that the install crews exist".
   */
  function noCrews() {
    var box = O.el("div.wf-in-empty", null,
      O.el("b", { text: "No install crews are set up yet." }),
      O.el("div", {
        text: "A crew is a station whose area is Install, the same way a welding " +
              "bench is a station in the shop. Add one in the Floor tab's station " +
              "setup — give it the Install crew type so it pulls the Install lists — " +
              "and it shows up here."
      }));
    if (state.ctx.goTo) {
      box.appendChild(O.el("div", { style: "margin-top:14px" },
        O.btn("Open station setup", {
          primary: true, onClick: function () { state.ctx.goTo("floor"); }
        })));
    }
    return box;
  }

  function topBar() {
    var bar = O.el("div.wf-in-top");
    bar.appendChild(O.el("div.wf-in-area", { text: "Install" }));
    bar.appendChild(O.el("div.wf-in-clock", null,
      O.el("b", { id: "wfInNow", text: nowText() }),
      O.el("span", { text: O.displayName(state.ctx.member) })));
    bar.appendChild(O.btn("Refresh", {
      small: true, busyText: "…",
      onClick: function () { return state.ctx.reload().then(refresh); }
    }));
    return bar;
  }

  function nowText() {
    return new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function refresh() {
    return Promise.all([state.ctx.cards(), WFTables.load(state.ctx.t)])
      .then(function (r) {
        state.cards = r[0];
        state.cfg = r[1];
        paint();
      })
      .catch(function (e) {
        if (!state.host) return;
        state.host.innerHTML = "";
        state.host.className = "wf-in";
        state.host.appendChild(O.el("div.wf-in-empty", null,
          O.el("b", { text: "Couldn't read the install board." }),
          O.el("div", { text: (e && e.message) || String(e) }),
          O.el("div", { style: "margin-top:14px" },
            O.btn("Try again", { primary: true, onClick: refresh }))));
      });
  }

  /** Re-read cards and station config without repainting. */
  function refreshData() {
    return Promise.all([state.ctx.cards(), WFTables.load(state.ctx.t)])
      .then(function (r) { state.cards = r[0]; state.cfg = r[1]; });
  }

  /**
   * What happens after any write: re-read the board, then repaint.
   *
   * Deliberately NOT a copy of the Floor's doWrite(). That function also guards
   * against a double tap with a per-station busy flag, and this tab does not
   * need one: every action here is an O.btn with a busyText, and O.btn already
   * disables the button for the life of the promise. The Floor builds its
   * controls as raw elements and therefore has to solve it itself. One
   * mechanism, in the place that already owns it.
   */
  function after() {
    return refreshData().then(paint);
  }

  function failed(e) {
    O.dialog({
      title: "That didn't go through",
      note: (e && e.message) || "Trello refused the change. Nothing was saved.",
      buttons: []
    });
  }

  /* --------------------------------------------------------------- a column */

  function crewColumn(st) {
    var col = O.el("div.wf-in-col");
    col.setAttribute("data-crew", st.station.id);
    col.style.setProperty("--s", WFTables.statusColor(st.status));

    var head = O.el("div.wf-in-h", null,
      O.el("div.wf-in-crew", { text: st.station.table || "Crew" }),
      O.el("div.wf-in-st", null,
        O.el("i"),
        O.el("span", { text: WFTables.statusText(st.status) })));
    col.appendChild(head);
    col.appendChild(O.el("div.wf-in-rule"));

    var who = st.station.welder || "nobody rostered";
    col.appendChild(O.el("div.wf-in-meta", null,
      O.el("span", { text: who }),
      O.el("span.wf-in-dot"),
      O.el("span", { text: st.phase || "no phase set" })));

    if (!st.station.phase) {
      col.appendChild(O.el("div.wf-in-more", { text: st.note }));
      return col;
    }

    var view = views[st.station.id] || "crew";
    if (view === "card" && opened[st.station.id]) {
      col.appendChild(cardView(st, opened[st.station.id]));
      return col;
    }
    if (view === "queue") {
      col.appendChild(queueView(st));
      return col;
    }

    if (st.job) {
      col.appendChild(onSite(st));
    } else {
      col.appendChild(O.el("div.wf-in-more", { text: st.note || "Nothing on this crew." }));
    }
    col.appendChild(queueStrip(st));
    return col;
  }

  /* ============================================== the four things, in order */

  /**
   * The job this crew is on, led by what an installer needs before he opens the
   * door of the truck.
   *
   * Order is the design: customer, site, payment, instructions, and only then
   * the clock and the buttons. A welder's column opens with a drawing because
   * the drawing is the job. An installer's opens with an address because
   * finding the house is the job's first ten minutes.
   */
  function onSite(st) {
    var card = st.job;
    loadFields(card);

    var box = O.el("div", { style: "display:flex;flex-direction:column;gap:12px" });

    /* --- 1. the customer ------------------------------------------------ */
    var top = O.el("div.wf-in-block");
    top.appendChild(O.el("div.wf-in-k", { text: "On site" }));
    var no = jobNo(card);
    if (no) top.appendChild(O.el("div.wf-in-jobno", { text: "Job " + no }));
    top.appendChild(O.el("div.wf-in-cust", { text: customerOf(card) || card.name }));

    var phone = phoneOf(card);
    if (phone) {
      // tel: is the one scheme that has always worked on every phone and tablet
      // the crews carry, which is why the address below uses a web URL and this
      // does not.
      top.appendChild(O.el("a.wf-in-tap", {
        href: "tel:" + phone.replace(/[^\d+]/g, ""),
        title: "Call " + phone
      }, O.el("b", { text: "Call" }), O.el("span", { text: phone })));
    } else {
      top.appendChild(O.el("div.wf-in-more", { text: "No phone number on this card." }));
    }
    box.appendChild(top);

    /* --- 2. the site ---------------------------------------------------- */
    var site = O.el("div.wf-in-block");
    site.appendChild(O.el("div.wf-in-k", { text: "Site address" }));
    var addr = addressOf(card);
    if (addr) {
      site.appendChild(O.el("a.wf-in-tap", {
        href: mapsUrl(addr), target: "_blank", rel: "noopener",
        title: "Open " + addr + " in maps"
      }, O.el("b", { text: "Maps" }), O.el("span", { text: addr })));
    } else {
      site.appendChild(O.el("div.wf-in-more", {
        text: "No address line on this card — it is in the notes below, or ask " +
              "the office. (The card has no address field to read.)"
      }));
    }
    box.appendChild(site);

    /* --- 3. payment ------------------------------------------------------ */
    box.appendChild(paymentBlock(card));

    /* --- 4. the instructions --------------------------------------------- */
    var notes = O.el("div.wf-in-block");
    notes.appendChild(O.el("div.wf-in-k", { text: "Install instructions" }));
    var body = instructionsOf(card);
    notes.appendChild(body
      ? O.el("div.wf-in-text", { text: body })
      : O.el("div.wf-in-more", { text: "Nothing written on this card." }));
    box.appendChild(notes);

    /* --- then the job itself --------------------------------------------- */
    box.appendChild(jobMeta(st));
    box.appendChild(percentControl(st));
    box.appendChild(runControls(st));
    box.appendChild(O.el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" },
      O.btn("Open the card", {
        small: true, quiet: true,
        onClick: function () { openIn(st, card); }
      })));
    return box;
  }

  function paymentBlock(card) {
    var list = fields[card.id];
    var pay = readPayment(list ? paymentFrom(list) : null);
    var box = O.el("div.wf-in-pay");
    box.style.setProperty("--pc", pay.color);
    box.style.setProperty("--pb", payTint(pay.color));
    box.appendChild(O.el("div.wf-in-k", { text: "Payment" }));
    box.appendChild(O.el("div.wf-in-pay-v", { text: pay.value }));
    box.appendChild(O.el("div.wf-in-pay-n", { text: pay.note }));
    // `undefined` is still loading, `null` is a read that failed -- and those
    // two must not both render as "Not recorded", which is a statement about
    // the board rather than about the network.
    if (list === null) {
      box.appendChild(O.el("div.wf-in-more", {
        text: "Payment status couldn't be read just now; this is not the card's answer."
      }));
    }
    return box;
  }

  /**
   * The job's own facts: who holds it, whether it changed hands, when it is due.
   *
   * The clock is a manager's line and nobody else's, exactly as on the Floor. A
   * crew is further from a manager than a bench is -- nobody is walking past the
   * truck -- so a running timer on this screen would be read as being watched,
   * and the standing rule is that the shop never sees one.
   */
  function jobMeta(st) {
    var work = WFTables.activeWork(st.job);
    var holder = (work && work.claimedBy) ? O.displayName(work.claimedBy) : null;
    var row = O.el("div.wf-in-meta", null,
      O.el("span", { text: holder || "nobody has taken this yet" }));

    if (work && work.takenFrom) {
      row.appendChild(O.el("span.wf-in-dot"));
      row.appendChild(O.el("span", {
        text: "taken from " + (work.takenFrom.fullName || work.takenFrom.username) +
              " at " + (work.takenFrom.pct || 0) + "%"
      }));
    }

    row.appendChild(O.el("span.wf-in-dot"));
    var late = WFTables.isLate(st.job);
    row.appendChild(O.el("span" + (late ? ".wf-in-late" : ""), { text: dueLine(st.job) }));

    if (state.ctx.isManager) {
      var chip = O.el("span", {
        text: WFTables.clockText(WFTables.elapsedMinutes(st.work)) + " on the clock"
      });
      chip.setAttribute("data-card", st.job.id);
      chip.className = "wf-in-mins";
      row.appendChild(O.el("span.wf-in-dot"));
      row.appendChild(chip);
    }
    return row;
  }

  /**
   * The due date in the words a crew uses.
   *
   * "Today" and "tomorrow" rather than a date, because an install is scheduled
   * to a day and the only question in the cab is whether this one is today's.
   * The Floor says "due Sep 18" because a bench job's date is a week out and a
   * weekday means nothing to it.
   */
  function dueLine(card) {
    if (!card || !card.due) return "no date set";
    var due = new Date(card.due);
    var days = Math.round(
      (new Date(due.getFullYear(), due.getMonth(), due.getDate()) -
       new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
      ) / 86400000);
    if (card.dueComplete) return "signed off";
    if (days < 0) return "was due " + (days === -1 ? "yesterday" : (-days) + " days ago");
    if (days === 0) return "due today";
    if (days === 1) return "due tomorrow";
    return "due " + due.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  /* -------------------------------------------------------------- the percent */

  /**
   * Percent complete. The bar moves on release rather than on the write
   * returning, because a slider that snaps back while Trello thinks about it
   * feels broken and gets dragged again -- and a cab has the worst signal of
   * anywhere this Power-Up runs.
   */
  function percentControl(st) {
    var work = WFTables.activeWork(st.job);
    var pct = work && typeof work.percentComplete === "number"
      ? Math.max(0, Math.min(100, work.percentComplete)) : 0;

    var label = O.el("span", { text: pct + "%" });
    var fill = O.el("i", { style: "width:" + pct + "%" });
    var box = O.el("div", { style: "display:flex;flex-direction:column;gap:6px" },
      O.el("div.wf-in-pct", null, label,
        O.el("span", { text: WFTables.isRunning(st.work) ? "running" : "not running" })),
      O.el("div.wf-in-bar", null, fill));

    if (!canWork(st)) return box;

    var slider = O.el("input.wf-in-slider", {
      type: "range", min: "0", max: "100", step: "5", value: String(pct),
      "aria-label": "Percent complete"
    });
    slider.addEventListener("input", function () {
      var v = Number(slider.value) || 0;
      label.textContent = v + "%";
      fill.style.width = v + "%";
    });
    // change, not input: one write when the thumb is let go, not twenty across
    // a drag. The Floor debounces instead because its slider is also its only
    // progress feedback; here the bar above has already moved.
    slider.addEventListener("change", function () {
      var v = Number(slider.value) || 0;
      Promise.resolve(WFPhase.setPercentComplete(state.ctx.t, st.job, v))
        .then(after)
        .catch(failed);
    });
    box.appendChild(slider);
    return box;
  }

  /**
   * May this person move this job along?
   *
   * job.start is the capability, and the subject is whoever holds the job --
   * so "own" reaches your own work and "area" reaches the crew's. An unclaimed
   * job has no holder, so the subject names the crew's rostered installer:
   * picking up unclaimed work on your own crew is the normal case and must not
   * need an area grant.
   *
   * ctx.can is absent until permissions have loaded, and this screen has to
   * draw before then; the fallback is the old role test, which is what the rest
   * of the Power-Up falls back to in the same window.
   */
  function canWork(st) {
    if (!st.job) return false;
    var work = WFTables.activeWork(st.job);
    var holder = (work && work.claimedBy && work.claimedBy.username) || st.station.welder || null;
    if (typeof state.ctx.can === "function") {
      return state.ctx.can("job.start", holder ? { username: holder } : null);
    }
    return true;
  }

  /* ------------------------------------------------------------- the buttons */

  function runControls(st) {
    var row = O.el("div.wf-in-run");
    if (!canWork(st)) {
      row.appendChild(O.el("div.wf-in-more", {
        text: "You can see this job but not start it."
      }));
      return row;
    }

    var work = WFTables.activeWork(st.job);
    var running = WFTables.isRunning(st.work);
    var claimed = !!(work && work.claimedBy);

    row.appendChild(O.btn(running ? "Stop" : "Start", {
      primary: !running, busyText: running ? "Stopping…" : "Starting…",
      onClick: function () {
        return Promise.resolve()
          .then(function () {
            if (running) return WFPhase.pause(state.ctx.t, st.job);
            if (claimed) return WFPhase.resume(state.ctx.t, st.job);
            // The crew's rostered installer where there is one, otherwise
            // whoever is holding the tablet. Same rule the Floor uses: the
            // bench's person, not the tablet's account.
            return WFPhase.claimAndStart(state.ctx.t, st.job, claimant(st));
          })
          .then(after).catch(failed);
      }
    }));

    /* No busyText: this opens a dialog rather than writing, and a button that
       flashes "…" for one frame before a dialog appears reads as a stutter.
       finish() now reads the card's Job Type before it can say where the job is
       going, but both halves of that read -- the board's custom fields and this
       card's values -- were already fetched and cached when this column painted
       (see paymentFrom, and CACHE_TTL_MS in lib/trello-rest.js), so the dialog
       still arrives on the next tick rather than after a round-trip. */
    row.appendChild(O.btn("Finished here", {
      onClick: function () { return finish(st); }
    }));

    row.appendChild(O.btn("Give it back", {
      quiet: true, small: true,
      onClick: function () { confirmRelease(st); }
    }));
    return row;
  }

  /** The person a claim is recorded against -- the crew's installer if rostered. */
  function claimant(st) {
    var roster = st.station.welder;
    if (!roster) return state.ctx.member;
    var m = ((state.ctx.board && state.ctx.board.members) || []).filter(function (x) {
      return x.username === roster;
    })[0];
    return m || state.ctx.member;
  }

  /**
   * Finishing an install.
   *
   * THERE IS NO QUALITY CHECK ON INSTALL TODAY, AND THIS DOES NOT PRETEND
   * OTHERWISE. lib/qc.js's qcPhases() lists Assemble Legacy, Assemble CAP,
   * Assemble CNC and Sandblast / Powder Coat -- Install is not among them, and
   * there is no Install entry in its shipped checklists either, so
   * checklistFor() answers an empty list and canSignOff() refuses an empty
   * list. A Complete button that opened a checklist with no lines on it and
   * then would not let anybody sign would be a dead end on the last screen of
   * the job.
   *
   * So the behaviour follows the data, in both directions:
   *
   *   Install is not a QC phase -> finishing completes the phase and advances
   *                                the card, and the dialog says so plainly.
   *   somebody adds it           -> WF_CONFIG.qcPhases is an override lib/qc.js
   *                                already honours, and a checklist named
   *                                "Install" saved in the Roster library is
   *                                picked up by name. Then the gate applies and
   *                                a signed check is required.
   *
   * The signed path passes through WFQC.passSigned, which is the Floor's own
   * call. The unsigned path does NOT reimplement the Floor's checklist screen:
   * that is ~700 lines of bench chrome over WFQC, and a second copy of it is
   * exactly the thing this repo has spent the week deleting. It says what is
   * missing instead.
   */
  /**
   * Where this job is ACTUALLY going next -- the same answer the move will use.
   *
   * THE DIALOG AND THE MOVE MUST NOT BE ABLE TO DISAGREE, AND THEY DID.
   *
   * This used to ask WFStage.getNextStage(board, list), which is the next
   * column in the FLAT board order. The move does not use that: lib/advance.js
   * wraps WFPhase.advance so the destination comes from the card's own Job Type
   * route, and it pins getNextStage to that answer for the one card. The two
   * were different answers to different questions, and on Install they
   * disagreed outright -- flat said Billing, route-aware said null -- so the
   * dialog promised the installer "the card moves to Billing" and then left it
   * in the Install list. Billing is now on every route, which makes the two
   * agree again for Install specifically; that is a coincidence, not a
   * guarantee, and the next route change takes it away.
   *
   * So it asks the route-aware function outright. __targetStage is exported
   * from lib/advance.js for exactly this and answers in three ways:
   *
   *   a stage   the card moves there;
   *   null      end of this job's route: advance pins null and nothing moves;
   *   undefined advance has no opinion (the list is not mapped, or the Job Type
   *             read failed) and falls through to the unwrapped approve, which
   *             uses the flat order -- so that is what the dialog falls back to
   *             as well, and the two still cannot diverge.
   *
   * Called through Promise.resolve().then so a missing wrapper (install.js
   * loaded without lib/advance.js) surfaces as a rejection the caller reports,
   * rather than a synchronous throw out of a click handler.
   */
  function nextStageFor(card) {
    return Promise.resolve()
      .then(function () { return WFPhase.__targetStage(state.ctx.t, card); })
      .then(function (target) {
        return target === undefined
          ? WFStage.getNextStage(state.ctx.board.id, card.idList)
          : target;
      });
  }

  function finish(st) {
    var needsQc = WFQC.requiresQc(st.phase);
    var signed = WFQC.floorSignOff(st.job, null);
    var who = customerOf(st.job) || st.job.name;

    if (needsQc && !signed) {
      return O.dialog({
        title: "This install needs a signed check first",
        note: "Install has been turned on as a quality-check phase, but the " +
              "checklist for it is signed at a station screen and this one has " +
              "no checklist view yet. Sign it on the Floor tab, or take Install " +
              "back out of the check phases.",
        buttons: []
      });
    }

    var faults = WFQC.openFaults(st.job);
    if (faults.length) {
      return O.dialog({
        title: "Something is recorded as wrong with this job",
        note: faults.length + (faults.length === 1 ? " fault is" : " faults are") +
              " still open against it. They are resolved on the Floor tab, where " +
              "they were raised — a job does not leave install with an open fault.",
        buttons: []
      });
    }

    /* The destination is read before the dialog is built rather than inside it,
       which is the pattern popups/checklist.js already uses for the self-check
       dialog: fetch, then draw, then open. Drawing first and filling the words
       in afterwards would put the sentence that matters most on this screen on
       the screen last, after somebody has read past it. */
    return nextStageFor(st.job).then(function (next) {
      return O.dialog({
        title: "Finished at " + who + "?",
        note: signed
          ? "QC is signed. " + (next
              ? "The card moves to " + next.name + "."
              : "This job is at the end of its route, so the card stays where it is.")
          : (next
              ? "This marks install complete and moves the card to " + next.name + "."
              : "This marks install complete. This job is at the end of its route, " +
                "so the card stays where it is."),
        buttons: [{
          label: next ? "Finish and pass to " + next.name : "Mark it finished",
          primary: true, busyText: "Passing it on…",
          onClick: function () {
            return Promise.resolve()
              .then(function () {
                if (signed) {
                  return WFQC.passSigned(state.ctx.t, st.job, st.job, { phase: st.phase });
                }
                // complete() closes the phase and logs the hours; advance()
                // moves the card along the job's own route -- lib/advance.js
                // wraps it so a CAP job does not get sent down the legacy path,
                // and nextStageFor above asked that same wrapper where it goes.
                return WFPhase.complete(state.ctx.t, st.job)
                  .then(function () {
                    return WFPhase.advance(state.ctx.t, st.job, state.ctx.member,
                      { verb: "Installed" });
                  });
              })
              .then(after).catch(failed);
          }
        }]
      });
    }).catch(failed);
  }

  /**
   * Put a job back as unclaimed, saying first what happens to the time on it.
   *
   * Which of the two things it is, is WFPhase's question and not this dialog's
   * -- asking separately is how the Floor's version came to contradict itself
   * once already.
   */
  function confirmRelease(st) {
    var work = WFTables.activeWork(st.job) || {};
    var mins = WFPhase.reportedMinutes(work);
    var clean = WFPhase.leavesNoTrace(work);
    O.dialog({
      title: "Give this job back?",
      note: clean
        ? "Nothing has been logged against it, so it goes back to looking untouched."
        : "The " + mins + " minutes already logged stay on the job. Only the claim " +
          "comes off, so somebody else can pick it up.",
      buttons: [{
        label: "Give it back", danger: true, busyText: "…",
        onClick: function () {
          return Promise.resolve(
            WFPhase.release(state.ctx.t, st.job, state.ctx.member)
          ).then(after).catch(failed);
        }
      }]
    });
  }

  /* ---------------------------------------------------------------- the queue */

  /**
   * What is behind this crew, as a short strip with a way into the full list.
   *
   * Three, not all of them: the column already carries four blocks of reading
   * above this, and a crew's queue on a Monday is fifteen cards. The rest are
   * one tap away.
   */
  function queueStrip(st) {
    var box = O.el("div", { style: "display:flex;flex-direction:column;gap:8px" });
    box.appendChild(O.el("div.wf-in-k", {
      text: st.queue.length ? ("Next up · " + st.queue.length) : "Nothing queued"
    }));
    st.queue.slice(0, 3).forEach(function (c) {
      box.appendChild(queueTile(st, c));
    });
    if (st.queue.length > 3) {
      box.appendChild(O.btn("See all " + st.queue.length, {
        small: true, quiet: true,
        onClick: function () { setView(st, "queue"); }
      }));
    }
    return box;
  }

  function queueTile(st, card) {
    var addr = addressOf(card);
    var tile = O.el("button.wf-in-tile", {
      type: "button",
      onClick: function () { openIn(st, card); }
    },
      O.el("b", { text: customerOf(card) || card.name }),
      O.el("span", { text: [jobNo(card) ? "Job " + jobNo(card) : null, addr, dueLine(card)]
        .filter(Boolean).join(" · ") }));
    if (WFTables.isLate(card)) tile.style.borderColor = "#d9482e";
    return tile;
  }

  function queueView(st) {
    var box = O.el("div", { style: "display:flex;flex-direction:column;gap:8px" });
    box.appendChild(O.el("div", { style: "display:flex;align-items:center;gap:10px" },
      O.el("div.wf-in-k", { style: "flex:1", text: "Everything queued · " + st.queue.length }),
      O.btn("Back", { small: true, quiet: true, onClick: function () { setView(st, "crew"); } })));
    if (!st.queue.length) {
      box.appendChild(O.el("div.wf-in-more", { text: "Nothing is queued on this crew." }));
      return box;
    }
    st.queue.forEach(function (c) { box.appendChild(queueTile(st, c)); });
    return box;
  }

  /* ----------------------------------------------------------- the card view */

  function setView(st, kind) {
    views[st.station.id] = kind;
    paint();
  }

  function openIn(st, card) {
    opened[st.station.id] = card;
    setView(st, "card");
  }

  /**
   * A queued job opened inside the column, never in a new window.
   *
   * The Floor's second rule applies here with more force, not less: a crew is
   * looking at this on a tablet in a truck, and bouncing them out to Trello
   * means coming back to a cold reload over whatever signal the site has. The
   * shared card panel does the rendition -- and it does the money filtering,
   * which is why it is handed `state.ctx` rather than a role string: the ctx
   * carries `can`, so the board's own permission settings decide, not a
   * hard-coded role.
   */
  function cardView(st, card) {
    var mine = st.job && st.job.id === card.id;
    return WFCardPanel.inline(state.ctx, card, {
      kicker: customerOf(card) || "Job",
      backLabel: "Back",
      onBack: function () { setView(st, "crew"); },
      footer: mine ? null : function () {
        return O.btn("Put this on the crew", {
          primary: true, busyText: "…",
          onClick: function () {
            return Promise.resolve(
              WFTables.setStation(state.ctx.t, card, st.station.id, 0)
            ).then(function () {
              views[st.station.id] = "crew";
              return after();
            }).catch(failed);
          }
        });
      }
    });
  }

  /* ------------------------------------------------------------------ timers */

  /**
   * One interval for the whole tab, replaced rather than added to on every
   * paint -- the same leak every ticking view in this project has had once.
   * Thirty seconds because the only things that move are a wall clock reading
   * h:mm and a manager's elapsed chip reading the same.
   */
  function startTimers() {
    tick = setInterval(function () {
      if (!state.host || !state.host.isConnected) { stopTimers(); return; }
      var now = document.getElementById("wfInNow");
      if (now) now.textContent = nowText();
      if (!state.ctx.isManager) return;
      var byId = {};
      (state.cards || []).forEach(function (c) { byId[c.id] = c; });
      Array.prototype.forEach.call(
        state.host.querySelectorAll(".wf-in-mins[data-card]"), function (chip) {
          var card = byId[chip.getAttribute("data-card")];
          var work = card && WFTables.activeWork(card);
          if (!work) return;
          chip.textContent = WFTables.clockText(WFTables.elapsedMinutes(work)) + " on the clock";
        });
    }, 30000);

    onResize = debounce(function () {
      if (!state.host || !state.host.isConnected) { stopTimers(); return; }
      paint();
    }, 250);
    window.addEventListener("resize", onResize);
  }

  function debounce(fn, ms) {
    var h = null;
    return function () {
      var args = arguments, self = this;
      if (h) clearTimeout(h);
      h = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* --------------------------------------------------------------------- tab */

  O.tab({
    id: "install",
    label: "Install",
    // Takes the whole window, as the Floor does. A tablet mounted in a truck
    // has no room to spare for a tab bar nobody is going to press while driving.
    kiosk: true,
    // No roles and no caps: an installer is shop crew. What a manager gets
    // extra -- the clock -- is gated inside, and there is nothing financial on
    // this screen for anybody.
    render: function (ctx) {
      state.ctx = ctx;
      state.host = O.el("div.wf-in");
      if (state.cfg && state.cards) { paint(); return state.host; }
      state.host.appendChild(O.el("div.loading", { text: "Reading the install board…" }));
      return refresh().then(function () { return state.host; });
    }
  });
})();
