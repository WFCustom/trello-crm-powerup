/* EOS -- Vision, People, Data, Issues, Process, Traction, in one tab.

   Six components behind a rail rather than six tabs: they're one system, and
   putting them on the main tab bar would have said otherwise. Issues carry the
   day-to-day weight, so that's where the tab opens.

   Issues are cards on the WF EOS board; the other five are Power-Up board
   records. See the header of lib/eos.js for why they're stored differently.
   Wired to WFEOS, and to WFSOP for the Process section's links. */
(function () {
  "use strict";
  var O = WFOps;

  /* -------------------------------------------------------------- the skin */

  /**
   * This tab's own stylesheet, injected once.
   *
   * It lives here rather than in styles.css for the same reason the SOP tab's
   * does -- the EOS tab stays a pure addition, with nothing edited in a
   * stylesheet nine other views depend on. It is a bigger sheet than the SOP
   * one because this tab was asked to look better than the rest, and "better"
   * is mostly spacing, weight and restraint with colour rather than anything
   * structural.
   *
   * Every colour resolves to the existing ops palette. The six component
   * colours come from WFEOS.components(), applied as a custom property so one
   * rule can serve all six.
   */
  (function injectStyles() {
    if (document.getElementById("wf-eos-styles")) return;
    var css = [
      /* --- hero ------------------------------------------------------- */
      ".wf-eos-hero{position:relative;overflow:hidden;border-radius:var(--wf-r-card);",
      "background:linear-gradient(135deg,#14293d 0%,#1f4e79 62%,#2a5f8f 100%);",
      "color:#fff;padding:26px 28px;margin-bottom:18px;box-shadow:var(--wf-shadow-lift)}",
      /* A single soft highlight, angled. Enough to stop the band reading as a
         flat rectangle; not so much that it competes with the content. */
      ".wf-eos-hero:after{content:'';position:absolute;right:-90px;top:-120px;width:340px;",
      "height:340px;border-radius:50%;background:rgba(255,255,255,.07);pointer-events:none}",
      ".wf-eos-hero-row{position:relative;z-index:1;display:flex;align-items:flex-end;",
      "gap:20px;flex-wrap:wrap}",
      ".wf-eos-hero-t{font-family:'Barlow Condensed',inherit;font-size:34px;line-height:1;",
      "font-weight:700;letter-spacing:.02em;text-transform:uppercase}",
      ".wf-eos-hero-s{font-size:13.5px;opacity:.82;margin-top:6px;max-width:52ch}",
      ".wf-eos-hero-sp{display:flex;gap:26px;flex-wrap:wrap}",
      /* The right-hand stack: the "i" sits above the numbers, right-aligned to
         them, so the band reads title-left / measures-right with one small
         affordance over the top rather than a button loose in the corner. */
      ".wf-eos-hero-right{margin-left:auto;display:flex;flex-direction:column;",
      "align-items:flex-end;gap:12px}",
      ".wf-eos-hero-infobar{display:flex;justify-content:flex-end}",
      ".wf-eos-hs{min-width:74px}",
      ".wf-eos-hs-v{font-family:'Barlow Condensed',inherit;font-size:27px;font-weight:700;line-height:1}",
      ".wf-eos-hs-k{font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;opacity:.72;margin-top:3px}",

      /* --- component rail --------------------------------------------- */
      ".wf-eos-rail{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:20px}",
      ".wf-eos-r{flex:1 1 150px;min-width:132px;text-align:left;cursor:pointer;",
      "background:#fff;border:1px solid var(--wf-line);border-radius:var(--wf-r-tile);",
      "padding:11px 13px 12px;font:inherit;color:var(--wf-text);position:relative;",
      "overflow:hidden;transition:transform .12s ease,box-shadow .12s ease}",
      ".wf-eos-r:before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;",
      "background:var(--c)}",
      ".wf-eos-r:hover{transform:translateY(-1px);box-shadow:var(--wf-shadow)}",
      ".wf-eos-r.is-on{background:var(--c);border-color:var(--c);color:#fff;",
      "box-shadow:var(--wf-shadow-lift)}",
      ".wf-eos-r.is-on:before{background:rgba(255,255,255,.55)}",
      ".wf-eos-r-t{font-weight:700;font-size:14.5px;letter-spacing:.01em}",
      ".wf-eos-r-b{font-size:11.5px;opacity:.68;margin-top:2px;line-height:1.35}",
      ".wf-eos-r-n{position:absolute;right:11px;top:10px;font-size:11px;font-weight:700;",
      "background:var(--wf-band);color:var(--wf-muted);border-radius:999px;padding:1px 7px}",
      ".wf-eos-r.is-on .wf-eos-r-n{background:rgba(255,255,255,.22);color:#fff}",

      /* --- section furniture ------------------------------------------ */
      ".wf-eos-head{display:flex;align-items:center;gap:10px;margin:2px 0 14px;flex-wrap:wrap}",
      ".wf-eos-head-t{font-family:'Barlow Condensed',inherit;font-size:22px;font-weight:700;",
      "letter-spacing:.02em;text-transform:uppercase;line-height:1}",
      ".wf-eos-head-t:before{content:'';display:inline-block;width:9px;height:9px;",
      "border-radius:2px;background:var(--c);margin-right:9px;vertical-align:1px}",
      ".wf-eos-sp{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
      ".wf-eos-grid{display:grid;gap:13px;grid-template-columns:repeat(auto-fill,minmax(268px,1fr))}",
      ".wf-eos-card{background:#fff;border:1px solid var(--wf-line);border-radius:var(--wf-r-tile);",
      "padding:15px 16px 16px;border-top:3px solid var(--c);box-shadow:var(--wf-shadow)}",
      ".wf-eos-card-k{font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;",
      "color:var(--wf-muted);font-weight:700}",
      ".wf-eos-card-v{font-size:14.5px;line-height:1.55;margin-top:7px;white-space:pre-wrap}",
      ".wf-eos-li{display:flex;gap:9px;align-items:baseline;padding:4px 0;font-size:14px}",
      ".wf-eos-li b{font-family:'Barlow Condensed',inherit;font-size:15px;color:var(--c);",
      "min-width:15px;font-weight:700}",
      ".wf-eos-blank{color:var(--wf-faint);font-style:italic}",

      /* --- the issues list -------------------------------------------- */
      ".wf-eos-pills{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px}",
      ".wf-eos-p{cursor:pointer;font:inherit;font-size:12.5px;padding:5px 12px;",
      "border-radius:999px;border:1px solid var(--wf-line);background:#fff;",
      "color:var(--wf-muted);white-space:nowrap}",
      ".wf-eos-p:hover{border-color:var(--wf-steel-2);color:var(--wf-steel)}",
      ".wf-eos-p.is-on{background:var(--wf-navy);border-color:var(--wf-navy);color:#fff;font-weight:600}",
      ".wf-eos-p em{font-style:normal;opacity:.65;margin-left:5px}",
      ".wf-eos-p.is-on em{opacity:.8}",
      ".wf-eos-issues{display:flex;flex-direction:column;gap:9px}",
      ".wf-eos-i{display:flex;gap:13px;align-items:flex-start;background:#fff;cursor:pointer;",
      "border:1px solid var(--wf-line);border-left:4px solid var(--e,var(--wf-line));",
      "border-radius:var(--wf-r-tile);padding:13px 15px;text-align:left;font:inherit;",
      "color:var(--wf-text);width:100%;transition:box-shadow .12s ease,transform .12s ease}",
      ".wf-eos-i:hover{box-shadow:var(--wf-shadow-lift);transform:translateY(-1px)}",
      /* The rank IS the priority -- the top three on a list are what gets
         worked at the meeting, so the number has to be the first thing read. */
      ".wf-eos-i-r{font-family:'Barlow Condensed',inherit;font-size:20px;font-weight:700;",
      "color:var(--wf-faint);min-width:23px;text-align:right;line-height:1.3}",
      ".wf-eos-i.is-top .wf-eos-i-r{color:var(--wf-ember)}",
      ".wf-eos-i-m{flex:1;min-width:0}",
      ".wf-eos-i-t{font-size:14.5px;font-weight:600;line-height:1.35}",
      ".wf-eos-i-s{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;",
      "font-size:11.5px;color:var(--wf-muted)}",
      ".wf-eos-dot{width:3px;height:3px;border-radius:50%;background:var(--wf-faint);flex:none}",
      ".wf-eos-av{width:28px;height:28px;border-radius:50%;background:var(--wf-band);",
      "color:var(--wf-steel);display:flex;align-items:center;justify-content:center;",
      "font-size:10.5px;font-weight:700;flex:none;letter-spacing:.02em}",
      ".wf-eos-av.is-none{background:repeating-linear-gradient(45deg,#eef2f6,#eef2f6 4px,#e2e9f0 4px,#e2e9f0 8px);color:var(--wf-faint)}",

      /* --- detail ------------------------------------------------------ */
      ".wf-eos-back{cursor:pointer;font:inherit;font-size:12.5px;background:none;border:0;",
      "color:var(--wf-steel);padding:0;margin-bottom:12px}",
      ".wf-eos-prose{font-size:14.5px;line-height:1.62;white-space:pre-wrap;max-width:68ch}",
      ".wf-eos-prose b{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;",
      "color:var(--wf-muted);margin-top:15px}",
      ".wf-eos-prose b:first-child{margin-top:0}",
      ".wf-eos-note{background:var(--wf-band);border-radius:12px;padding:10px 13px;",
      "font-size:13.5px;line-height:1.5;margin-bottom:8px}",
      ".wf-eos-note-w{font-size:11px;color:var(--wf-muted);margin-bottom:3px}",

      /* --- scorecard --------------------------------------------------- */
      ".wf-eos-scroll{overflow-x:auto;border:1px solid var(--wf-line);",
      "border-radius:var(--wf-r-tile);background:#fff}",
      ".wf-eos-sc{border-collapse:separate;border-spacing:0;width:100%;font-size:13px}",
      ".wf-eos-sc th{position:sticky;top:0;background:var(--wf-band);font-size:10.5px;",
      "letter-spacing:.08em;text-transform:uppercase;color:var(--wf-muted);font-weight:700;",
      "padding:9px 10px;text-align:center;white-space:nowrap}",
      ".wf-eos-sc th.k,.wf-eos-sc td.k{text-align:left;position:sticky;left:0;z-index:2;",
      "background:#fff;min-width:186px;box-shadow:1px 0 0 var(--wf-line)}",
      ".wf-eos-sc th.k{background:var(--wf-band);z-index:3}",
      ".wf-eos-sc td{padding:7px 8px;text-align:center;border-top:1px solid var(--wf-line)}",
      ".wf-eos-sc td.k{padding:9px 11px}",
      ".wf-eos-sc-m{font-weight:600;font-size:13.5px}",
      ".wf-eos-sc-o{font-size:11px;color:var(--wf-muted);margin-top:1px}",
      ".wf-eos-cell{width:56px;border:1px solid transparent;border-radius:8px;padding:5px 4px;",
      "font:inherit;font-size:13px;text-align:center;background:transparent;color:inherit}",
      ".wf-eos-cell:focus{border-color:var(--wf-steel-2);background:#fff;outline:none}",
      ".wf-eos-cell:disabled{opacity:1}",
      ".wf-eos-hit{background:var(--wf-tint-go);color:var(--wf-ink-go);font-weight:600}",
      ".wf-eos-miss{background:var(--wf-tint-ember);color:var(--wf-ink-ember);font-weight:600}",
      ".wf-eos-now{box-shadow:inset 0 0 0 2px rgba(31,78,121,.18)}",

      /* --- rocks ------------------------------------------------------- */
      ".wf-eos-bar{height:7px;border-radius:999px;background:var(--wf-band);overflow:hidden;margin-top:10px}",
      ".wf-eos-bar i{display:block;height:100%;border-radius:999px;background:var(--c);",
      "transition:width .2s ease}",

      /* --- misc -------------------------------------------------------- */
      ".wf-eos-f{display:flex;flex-direction:column;gap:5px;margin-bottom:14px}",
      ".wf-eos-f label{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;",
      "color:var(--wf-muted);font-weight:700}",
      ".wf-eos-f .hint{font-size:11.5px;color:var(--wf-faint)}",
      ".wf-eos-f input,.wf-eos-f textarea,.wf-eos-f select{font:inherit;font-size:14px;",
      "padding:9px 11px;border:1px solid var(--wf-line);border-radius:12px;background:#fff;",
      "color:var(--wf-text);width:100%}",
      ".wf-eos-f textarea{resize:vertical;line-height:1.5}",
      ".wf-eos-f input:focus,.wf-eos-f textarea:focus,.wf-eos-f select:focus{",
      "outline:none;border-color:var(--wf-steel-2)}",
      ".wf-eos-seg{display:flex;gap:0;border:1px solid var(--wf-line);border-radius:999px;",
      "overflow:hidden;width:fit-content}",
      ".wf-eos-seg button{font:inherit;font-size:12.5px;padding:6px 15px;border:0;cursor:pointer;",
      "background:#fff;color:var(--wf-muted)}",
      ".wf-eos-seg button+button{border-left:1px solid var(--wf-line)}",
      ".wf-eos-seg button.is-on{background:var(--wf-navy);color:#fff;font-weight:600}",
      "@media (max-width:640px){.wf-eos-hero{padding:20px}.wf-eos-hero-t{font-size:26px}",
      ".wf-eos-hero-right{margin-left:0;align-items:flex-start;width:100%}",
      ".wf-eos-hero-sp{gap:18px}.wf-eos-r{flex:1 1 44%}}"
    ].join("");
    var tag = document.createElement("style");
    tag.id = "wf-eos-styles";
    tag.textContent = css;
    document.head.appendChild(tag);
  })();

  /* Module-level so leaving for the Work board and coming back puts you on the
     same component, the same issues list and the same issue. */
  var state = {
    comp: "issues",
    listId: null,      // null means "every list I can see"
    query: "",
    openId: null,
    quarter: null,
    data: null,        // the issues board
    rec: null,         // the five plugin-data records
    sops: null,        // loaded lazily, only by the Process section
    host: null,
    ctx: null
  };

  var inboxCount = 0;   // for the tab badge; set on every load

  /** appendChild that tolerates a null, since several blocks return one. */
  function add(parent, node) { if (node) parent.appendChild(node); return parent; }

  function byId(list, id) {
    return (list || []).filter(function (x) { return x.id === id; })[0] || null;
  }

  function nameOf(m) { return m ? (m.fullName || m.username || "") : ""; }

  function when(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function color(id) {
    var c = WFEOS.component(id);
    return c ? c.color : "#1f4e79";
  }

  /* --------------------------------------------------------------- loading */

  function paint() {
    if (!state.host) return;
    state.host.innerHTML = "";
    add(state.host, hero());
    add(state.host, rail());
    add(state.host, section());
  }

  function refresh() {
    var t = state.ctx.t;
    return Promise.all([WFEOS.load(t), WFEOS.getAll(t)]).then(function (r) {
      state.data = r[0];
      state.rec = r[1];
      var inbox = WFEOS.inboxList(state.data);
      inboxCount = inbox ? WFEOS.inList(state.data, inbox.id).length : 0;
      // The issue we had open may have been solved or moved by someone else.
      if (state.openId && !byId(state.data.issues, state.openId)) state.openId = null;
      paint();
    }).catch(function (e) {
      if (!state.host) return;
      state.host.innerHTML = "";
      state.host.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "Couldn't reach the EOS board." }),
        O.el("div.muted", { text: (e && e.message) || String(e) }),
        O.btn("Try again", { onClick: refresh })));
    });
  }

  /* ------------------------------------------------------------------ hero */

  /**
   * The questions that get issues out of a quiet room.
   *
   * REFERENCE ONLY, AND THAT IS THE POINT. It files nothing, changes nothing
   * and remembers nothing. An IDS session stalls when nobody wants to go
   * first, and what unsticks it is a better question rather than another field
   * to fill in -- the moment this captured answers it would become a form, and
   * nobody opens a form mid-conversation.
   *
   * Semi-opaque rather than a solid dialog so the issue list stays visible
   * underneath: you read a question and go back to the room, you do not leave
   * the screen.
   */
  var IDS_QUESTIONS = [
    "What are we not talking about that we should be?",
    "What's frustrating us, or slowing us down?",
    "What could make things better or simpler?",
    "Any recurring patterns, or feedback from customers or employees?"
  ];

  function openInfo() {
    var back = O.el("div.wf-info-back");
    function close() {
      document.removeEventListener("keydown", onKey, true);
      if (back.parentNode) back.parentNode.removeChild(back);
    }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }

    back.appendChild(O.el("div.wf-info-box", null,
      O.el("div.wf-info-h", null,
        O.el("div.wf-panel-t", { text: "Identify · Discuss · Solve" }),
        O.btn("Close", { small: true, quiet: true, onClick: close })),
      O.el("div.wf-info-sub", {
        text: "Problems · challenges · obstacles · ideas · " +
              "opportunities · decisions · blocks"
      }),
      O.el("div.wf-info-list", null, IDS_QUESTIONS.map(function (q) {
        return O.el("div.wf-info-q", { text: q });
      })),
      O.el("div.wf-info-foot", {
        text: "Keep it concise. Anything worth keeping goes on the board — " +
              "this is only here to get the room talking."
      })));

    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(back);
  }

  function heroStat(label, value) {
    return O.el("div.wf-eos-hs", null,
      O.el("div.wf-eos-hs-v", { text: String(value) }),
      O.el("div.wf-eos-hs-k", { text: label }));
  }

  /**
   * The band across the top: what the system is, and the four numbers that say
   * whether it's being run rather than merely set up.
   */
  function hero() {
    var ctx = state.ctx;
    var issues = (state.data && state.data.issues) || [];
    var open = issues.filter(function (i) { return i.kind !== "solved"; });
    var solved = issues.filter(function (i) { return i.kind === "solved"; });
    var rocks = WFEOS.rocksFor((state.rec && state.rec.rocks) || [], quarter());
    var prog = WFEOS.rockProgress(rocks);

    var strip = O.el("div.wf-eos-hero-sp", null,
      heroStat("open issues", open.length),
      heroStat("in the inbox", inboxCount),
      heroStat("rocks on track", prog.total ? (prog.done + "/" + prog.total) : "—"),
      heroStat("solved", solved.length));

    // The "i" sits above the numbers rather than in the window chrome: these
    // questions are EOS material, and they are wanted at the moment somebody
    // is looking at this band deciding what to raise.
    var info = O.el("button.wf-info", {
      type: "button", text: "i",
      title: "Questions that surface issues",
      "aria-label": "Questions that surface issues",
      onClick: openInfo
    });
    var right = O.el("div.wf-eos-hero-right", null,
      O.el("div.wf-eos-hero-infobar", null, info), strip);

    var file = O.btn("File an issue or idea", {
      primary: true,
      onClick: function () { openIntake(); }
    });
    file.style.cssText = "background:#fff;color:var(--wf-navy);border-color:#fff;font-weight:700";

    return O.el("div.wf-eos-hero", null,
      O.el("div.wf-eos-hero-row", null,
        O.el("div", null,
          O.el("div.wf-eos-hero-t", { text: "The way we run" }),
          O.el("div.wf-eos-hero-s", {
            text: "Six things, kept honest: where we're going, who's accountable, " +
                  "the numbers, what's in the way, how we do it, and what we've " +
                  "promised this quarter."
          }),
          O.el("div", { style: "margin-top:14px" }, file)),
        right));
  }

  /* ------------------------------------------------------------------ rail */

  function railCount(id) {
    if (id === "issues") {
      return ((state.data && state.data.issues) || []).filter(function (i) {
        return i.kind !== "solved";
      }).length;
    }
    if (id === "traction") return WFEOS.rocksFor((state.rec && state.rec.rocks) || [], quarter()).length;
    if (id === "data") return ((state.rec && state.rec.scorecard) || []).length;
    if (id === "people") return ((state.rec && state.rec.seats) || []).length;
    if (id === "process") return ((state.rec && state.rec.processes) || []).length;
    return null;
  }

  function rail() {
    var role = state.ctx.role;
    var row = O.el("div.wf-eos-rail");
    WFEOS.components().forEach(function (c) {
      if (!WFEOS.canSeeComponent(role, c.id)) return;
      var n = railCount(c.id);
      var b = O.el("button.wf-eos-r" + (state.comp === c.id ? ".is-on" : ""), {
        type: "button",
        style: "--c:" + c.color,
        onClick: function () {
          state.comp = c.id;
          state.openId = null;
          paint();
        }
      },
        O.el("div.wf-eos-r-t", { text: c.label }),
        O.el("div.wf-eos-r-b", { text: c.blurb }));
      if (n !== null && n > 0) b.appendChild(O.el("div.wf-eos-r-n", { text: String(n) }));
      row.appendChild(b);
    });
    return row;
  }

  function head(title, right) {
    var h = O.el("div.wf-eos-head", { style: "--c:" + color(state.comp) },
      O.el("div.wf-eos-head-t", { text: title }));
    if (right) { right.classList.add("wf-eos-sp"); h.appendChild(right); }
    return h;
  }

  function section() {
    switch (state.comp) {
      case "vision": return visionView();
      case "people": return peopleView();
      case "data": return dataView();
      case "process": return processView();
      case "traction": return tractionView();
      default: return state.openId ? issueDetail() : issuesView();
    }
  }

  /* ------------------------------------------------------------ form fields */

  function field(label, hint, control) {
    var f = O.el("div.wf-eos-f", null, O.el("label", { text: label }));
    f.appendChild(control);
    if (hint) f.appendChild(O.el("div.hint", { text: hint }));
    return f;
  }

  function textInput(value, ph) {
    return O.el("input", { type: "text", value: value || "", placeholder: ph || "" });
  }

  function areaInput(value, rows, ph) {
    var a = O.el("textarea", { rows: String(rows || 3), placeholder: ph || "" });
    a.value = value || "";
    return a;
  }

  function selectInput(options, value) {
    var s = O.el("select");
    (options || []).forEach(function (o) {
      var opt = O.el("option", { value: o.value, text: o.label });
      if (String(o.value) === String(value)) opt.selected = true;
      s.appendChild(opt);
    });
    return s;
  }

  /** A textarea whose lines become a list, and back. */
  function linesInput(list, rows, ph) {
    return areaInput((list || []).join("\n"), rows, ph);
  }

  function toLines(v) {
    return String(v || "").split("\n").map(function (s) { return s.trim(); })
      .filter(function (s) { return s; });
  }

  /** Save one record, repaint, and turn a Trello refusal into a sentence. */
  function persist(name, value) {
    return WFEOS.saveRecord(state.ctx.t, name, value).then(function () {
      state.rec[name] = value;
      paint();
    });
  }

  /* ----------------------------------------------------------------- intake */

  /**
   * The form anyone can open from the hero, on any component, at any time.
   *
   * It is deliberately the same three questions for a welder and for the owner,
   * and it always lands in the Inbox. Filing is the one thing in this tab that
   * nobody's role restricts -- an issues system that only some people can add
   * to stops being a picture of what's actually wrong.
   */
  function openIntake() {
    var head = textInput("", "e.g. Powder booth filters clog before Friday");
    var type = "Issue";

    var seg = O.el("div.wf-eos-seg");
    WFEOS.KINDS.forEach(function (k) {
      var b = O.el("button" + (k.name === type ? ".is-on" : ""), {
        type: "button", text: k.name,
        onClick: function () {
          type = k.name;
          Array.prototype.forEach.call(seg.children, function (c) {
            c.classList.toggle("is-on", c.textContent === type);
          });
        }
      });
      seg.appendChild(b);
    });

    var body = O.el("div", null,
      field("Headline", "Short. It's what the leadership team will read first.", head),
      field("What kind of thing is it?", null, seg));

    var inputs = {};
    WFEOS.INTAKE.forEach(function (q) {
      inputs[q.key] = areaInput("", q.rows, "");
      body.appendChild(field(q.label + (q.required ? "" : " (optional)"), q.hint, inputs[q.key]));
    });

    O.dialog({
      title: "File an issue or idea",
      note: "It lands in the Inbox. Leadership sorts it from there — you don't " +
            "have to know which list it belongs on.",
      content: body,
      buttons: [{
        label: "File it", primary: true, busyText: "Filing…",
        onClick: function () {
          var answers = {};
          Object.keys(inputs).forEach(function (k) { answers[k] = inputs[k].value; });
          if (!String(head.value || "").trim()) {
            return Promise.reject(new Error("Give it a short headline first."));
          }
          if (!String(answers.what || "").trim()) {
            return Promise.reject(new Error("Say what the issue is — the first box."));
          }
          return WFEOS.fileIssue(state.ctx.t, state.data, {
            name: head.value, type: type, answers: answers, filer: state.ctx.member
          }).then(function () {
            state.comp = "issues";
            var inbox = WFEOS.inboxList(state.data);
            state.listId = inbox ? inbox.id : null;
            return refresh();
          });
        }
      }]
    });
  }

  /* ----------------------------------------------------------------- issues */

  function visibleLists() {
    return WFEOS.listsFor(state.data, state.ctx.role);
  }

  function visibleIssues() {
    var ok = {};
    visibleLists().forEach(function (l) { ok[l.id] = true; });
    var all = ((state.data && state.data.issues) || []).filter(function (i) {
      return ok[i.listId];
    });
    if (state.listId) all = all.filter(function (i) { return i.listId === state.listId; });
    else all = all.filter(function (i) { return i.kind !== "solved"; });
    return WFEOS.search(all, state.query);
  }

  function listPills() {
    var row = O.el("div.wf-eos-pills");
    var all = O.el("button.wf-eos-p" + (state.listId ? "" : ".is-on"), {
      type: "button",
      onClick: function () { state.listId = null; paint(); }
    }, O.el("span", { text: "Everything open" }));
    row.appendChild(all);

    visibleLists().forEach(function (l) {
      var p = O.el("button.wf-eos-p" + (state.listId === l.id ? ".is-on" : ""), {
        type: "button",
        onClick: function () { state.listId = l.id; paint(); }
      }, O.el("span", { text: l.short }));
      if (l.count) p.appendChild(O.el("em", { text: String(l.count) }));
      row.appendChild(p);
    });
    return row;
  }

  function avatar(person) {
    if (!person) return O.el("div.wf-eos-av.is-none", { text: "—", title: "Nobody owns this yet" });
    return O.el("div.wf-eos-av", { text: O.initials(nameOf(person)), title: nameOf(person) });
  }

  function healthTag(h) {
    if (!h) return null;
    if (h.state === "overdue") return O.tag("past its date", "late");
    if (h.state === "due") return O.tag("due " + O.elapsedPhrase(h.days), "warn");
    if (h.state === "stale") return O.tag("untouched " + O.elapsedPhrase(h.days), "warn");
    if (h.state === "unowned") return O.tag("no owner", "quiet");
    return null;
  }

  function issueRow(issue, rank) {
    var edge = issue.type === "Idea" ? "#1f6f4a"
             : issue.type === "Obstacle" ? "#d98324" : "#c8471c";
    var meta = O.el("div.wf-eos-i-s", null,
      O.el("span", { text: issue.type }),
      O.el("span.wf-eos-dot"),
      O.el("span", { text: issue.listShort }));
    if (issue.filedAt) {
      meta.appendChild(O.el("span.wf-eos-dot"));
      meta.appendChild(O.el("span", { text: "filed " + when(issue.filedAt) }));
    }
    if (issue.comments) {
      meta.appendChild(O.el("span.wf-eos-dot"));
      meta.appendChild(O.el("span", {
        text: issue.comments + (issue.comments === 1 ? " note" : " notes")
      }));
    }
    var tag = healthTag(issue.health);
    if (tag) { meta.appendChild(O.el("span.wf-eos-dot")); meta.appendChild(tag); }

    return O.el("button.wf-eos-i" + (rank <= 3 && state.listId ? ".is-top" : ""), {
      type: "button",
      style: "--e:" + edge,
      onClick: function () { state.openId = issue.id; paint(); }
    },
      O.el("div.wf-eos-i-r", { text: state.listId ? String(rank) : "" }),
      O.el("div.wf-eos-i-m", null,
        O.el("div.wf-eos-i-t", { text: issue.name }),
        meta),
      avatar(issue.owner));
  }

  function issuesView() {
    var wrap = O.el("div");

    var search = O.el("input", {
      type: "search", value: state.query, placeholder: "Search issues…",
      style: "font:inherit;font-size:13px;padding:7px 12px;border:1px solid var(--wf-line);" +
             "border-radius:999px;min-width:190px;background:#fff",
      onInput: function (e) {
        state.query = e.target.value;
        var host = wrap.querySelector(".wf-eos-issues");
        if (host) { host.innerHTML = ""; fillIssues(host); }
      }
    });
    wrap.appendChild(head("Issues", O.el("div", null, search)));

    var list = state.listId ? byId(state.data.lists, state.listId) : null;
    if (list) {
      var note =
        list.kind === "inbox"
          ? "Everything filed by the shop lands here. Sort it to a list, give it an " +
            "owner, or solve it on the spot."
        : list.kind === "leadership"
          ? "The Level 10 list. Rank the top three, then identify, discuss, solve — " +
            "in that order, one at a time."
        : list.kind === "vto"
          ? "Long-term issues. Things that aren't this week's problem but will be " +
            "somebody's if they stay on the list."
        : list.kind === "solved"
          ? "What's been dealt with, most recent first. The resolution note is on " +
            "the issue."
          : "Issues this department owns and can solve without the leadership team.";
      wrap.appendChild(O.el("div.muted", { text: note, style: "margin:-6px 0 12px" }));
    }

    wrap.appendChild(listPills());
    var host = O.el("div.wf-eos-issues");
    fillIssues(host);
    wrap.appendChild(host);
    return wrap;
  }

  function fillIssues(host) {
    var issues = visibleIssues();
    if (!issues.length) {
      host.appendChild(O.el("div.wf-empty", null,
        O.el("div", {
          text: state.query ? "Nothing matches that."
              : state.listId ? "Nothing on this list."
              : "No open issues. Either things are going very well or nobody's saying."
        }),
        state.query ? null : O.btn("File an issue or idea", { onClick: openIntake })));
      return;
    }
    issues.forEach(function (i, n) { host.appendChild(issueRow(i, n + 1)); });
  }

  /* ---------------------------------------------------------- issue detail */

  /**
   * Render the intake description.
   *
   * The card's description is markdown so it reads properly in Trello, which
   * means it arrives here with **bold** question headings in it. Rather than
   * pull in a markdown parser for one pattern, the bold runs become the only
   * thing this understands, and everything else is left as typed.
   */
  function prose(text) {
    var box = O.el("div.wf-eos-prose");
    String(text || "").split(/(\*\*[^*]+\*\*)/).forEach(function (part) {
      if (!part) return;
      var m = /^\*\*([^*]+)\*\*$/.exec(part);
      if (m) box.appendChild(O.el("b", { text: m[1] }));
      else box.appendChild(document.createTextNode(part.replace(/^\n/, "")));
    });
    return box;
  }

  function issueDetail() {
    var issue = byId(state.data.issues, state.openId);
    if (!issue) { state.openId = null; return issuesView(); }
    var mayEdit = WFEOS.canEdit(state.ctx.role);
    var wrap = O.el("div");

    wrap.appendChild(O.el("button.wf-eos-back", {
      type: "button", text: "← Back to " + (state.listId ? issue.listShort : "issues"),
      onClick: function () { state.openId = null; paint(); }
    }));

    var actions = O.el("div");
    if (mayEdit && issue.kind !== "solved") {
      actions.appendChild(O.btn("Solved", { primary: true, onClick: function () { openSolve(issue); } }));
      actions.appendChild(O.btn("Move", { onClick: function () { openMove(issue); } }));
      actions.appendChild(O.btn("Owner and date", { onClick: function () { openOwner(issue); } }));
      if (state.listId) {
        actions.appendChild(O.btn("Move to top", {
          quiet: true, busyText: "Moving…",
          onClick: function () { return WFEOS.promote(state.ctx.t, issue.id).then(refresh); }
        }));
      }
    } else if (mayEdit) {
      actions.appendChild(O.btn("Reopen", {
        busyText: "Reopening…",
        onClick: function () {
          return WFEOS.reopen(state.ctx.t, state.data, issue.id).then(refresh);
        }
      }));
    }
    actions.appendChild(O.btn("Add a note", { quiet: true, onClick: function () { openNote(issue); } }));
    wrap.appendChild(head(issue.type, actions));

    var meta = O.el("div.wf-eos-i-s", { style: "margin:-8px 0 16px" },
      O.el("span", { text: "on " + issue.listShort }),
      O.el("span.wf-eos-dot"),
      O.el("span", { text: issue.owner ? nameOf(issue.owner) + " owns it" : "nobody owns it" }));
    if (issue.due) {
      meta.appendChild(O.el("span.wf-eos-dot"));
      meta.appendChild(O.el("span", { text: "by " + when(issue.due) }));
    }
    var tag = healthTag(issue.health);
    if (tag) { meta.appendChild(O.el("span.wf-eos-dot")); meta.appendChild(tag); }

    var p = O.panel(issue.name);
    p.body(meta, prose(issue.desc || "No detail was written down."),
      O.el("div", { style: "margin-top:16px" },
        O.el("a.wf-btn.wf-btn-quiet.wf-btn-sm", {
          href: issue.url, target: "_blank", rel: "noopener",
          text: "Open in Trello", style: "text-decoration:none"
        })));
    wrap.appendChild(p);

    var notes = O.panel("Discussion", "Notes, decisions and the resolution.");
    var body = O.el("div", null, O.el("div.loading", { text: "Reading the notes…" }));
    notes.body(body);
    WFEOS.discussion(state.ctx.t, issue.id).then(function (actions) {
      body.innerHTML = "";
      if (!actions.length) {
        body.appendChild(O.el("div.muted", { text: "Nothing said yet." }));
        return;
      }
      actions.forEach(function (a) {
        var who = (a.memberCreator && (a.memberCreator.fullName || a.memberCreator.username)) || "someone";
        body.appendChild(O.el("div.wf-eos-note", null,
          O.el("div.wf-eos-note-w", { text: who + " · " + when(a.date) }),
          O.el("div", { text: (a.data && a.data.text) || "" })));
      });
    }).catch(function () {
      body.innerHTML = "";
      body.appendChild(O.el("div.muted", { text: "Couldn't load the notes." }));
    });
    wrap.appendChild(notes);
    return wrap;
  }

  function openSolve(issue) {
    var note = areaInput("", 3, "What was done about it?");
    O.dialog({
      title: "Solved: " + issue.name,
      note: "The note goes on the issue as a comment, then it moves to Solved. " +
            "It stays readable — solving isn't deleting.",
      content: field("Resolution", "What changed, so the next person understands why.", note),
      buttons: [{
        label: "Mark it solved", primary: true, busyText: "Saving…",
        onClick: function () {
          return WFEOS.solve(state.ctx.t, state.data, issue.id, note.value).then(function () {
            state.openId = null;
            return refresh();
          });
        }
      }]
    });
  }

  function openMove(issue) {
    var sel = selectInput(visibleLists().map(function (l) {
      return { value: l.id, label: l.short };
    }), issue.listId);
    O.dialog({
      title: "Move this issue",
      note: "Which list should it be worked from?",
      content: field("List", null, sel),
      buttons: [{
        label: "Move it", primary: true, busyText: "Moving…",
        onClick: function () {
          return WFEOS.moveIssue(state.ctx.t, issue.id, sel.value, "top").then(function () {
            state.listId = sel.value;
            return refresh();
          });
        }
      }]
    });
  }

  function openOwner(issue) {
    var members = (state.data.members || []).slice().sort(function (a, b) {
      return nameOf(a).localeCompare(nameOf(b));
    });
    var sel = selectInput([{ value: "", label: "Nobody yet" }].concat(
      members.map(function (m) { return { value: m.id, label: nameOf(m) }; })
    ), issue.owner ? issue.owner.id : "");
    var due = O.el("input", {
      type: "date",
      value: issue.due ? new Date(issue.due).toISOString().slice(0, 10) : ""
    });
    var type = selectInput(WFEOS.KINDS.map(function (k) {
      return { value: k.name, label: k.name };
    }), issue.type);

    O.dialog({
      title: "Who's on it, and by when",
      note: "One owner, not a committee — EOS only works if a single person is " +
            "accountable for each issue.",
      content: O.el("div", null,
        field("Owner", null, sel),
        field("Resolve by", "Leave blank if there's no date on it.", due),
        field("Kind", null, type)),
      buttons: [{
        label: "Save", primary: true, busyText: "Saving…",
        onClick: function () {
          var t = state.ctx.t;
          return Promise.resolve()
            .then(function () {
              return WFEOS.setOwner(t, issue.id, sel.value || null,
                issue.owner ? issue.owner.id : null);
            })
            .then(function () { return WFEOS.setDue(t, issue.id, due.value || ""); })
            .then(function () {
              if (type.value === issue.type) return null;
              return WFEOS.setType(t, state.data, issue, type.value);
            })
            .then(refresh);
        }
      }]
    });
  }

  function openNote(issue) {
    var note = areaInput("", 3, "");
    O.dialog({
      title: "Add a note",
      note: "Goes on the issue in Trello, so it's there for whoever picks it up.",
      content: field("Note", null, note),
      buttons: [{
        label: "Add it", primary: true, busyText: "Adding…",
        onClick: function () {
          if (!String(note.value || "").trim()) {
            return Promise.reject(new Error("Nothing to add."));
          }
          return WFEOS.comment(state.ctx.t, issue.id, note.value).then(refresh);
        }
      }]
    });
  }

  /* ----------------------------------------------------------------- vision */

  function visionCard(title, value, onEdit, opts) {
    opts = opts || {};
    var card = O.el("div.wf-eos-card", { style: "--c:" + color("vision") },
      O.el("div.wf-eos-card-k", { text: title }));
    if (Array.isArray(value)) {
      if (!value.length) card.appendChild(O.el("div.wf-eos-card-v.wf-eos-blank", { text: opts.blank || "Not written down yet." }));
      else value.forEach(function (v, i) {
        card.appendChild(O.el("div.wf-eos-li", { style: "--c:" + color("vision") },
          O.el("b", { text: String(i + 1) }), O.el("span", { text: v })));
      });
    } else {
      card.appendChild(O.el("div.wf-eos-card-v" + (value ? "" : ".wf-eos-blank"),
        { text: value || opts.blank || "Not written down yet." }));
    }
    if (onEdit) {
      card.appendChild(O.el("div", { style: "margin-top:12px" },
        O.btn("Edit", { quiet: true, small: true, onClick: onEdit })));
    }
    return card;
  }

  function visionView() {
    var v = (state.rec && state.rec.vto) || WFEOS.blank("vto");
    var mayEdit = WFEOS.canEdit(state.ctx.role);
    var wrap = O.el("div");
    wrap.appendChild(head("Vision",
      mayEdit ? O.el("div", null, O.btn("Edit the V/TO", {
        primary: true, onClick: function () { openVto(v); }
      })) : null));
    wrap.appendChild(O.el("div.muted", {
      style: "margin:-6px 0 14px",
      text: "Everyone reads this, not just the leadership team — that's the point of writing it down."
    }));

    var edit = mayEdit ? function () { openVto(v); } : null;

    var g = O.el("div.wf-eos-grid");
    g.appendChild(visionCard("Core values", v.coreValues, edit,
      { blank: "The handful of behaviours we hire, fire and praise by." }));
    g.appendChild(visionCard("Core focus", [v.purpose, v.niche].filter(Boolean).length
      ? ["Purpose: " + (v.purpose || "—"), "Niche: " + (v.niche || "—")] : [], edit,
      { blank: "Why we exist, and the one thing we're best at." }));
    g.appendChild(visionCard("10-year target", v.tenYear, edit,
      { blank: "The big one. One sentence, one number, one date." }));
    g.appendChild(visionCard("What makes us different", v.uniques, edit,
      { blank: "Three things a customer can't get from the next shop." }));
    g.appendChild(visionCard("Our proven process", v.provenProcess, edit,
      { blank: "How a job goes from first call to final walk-through." }));
    g.appendChild(visionCard("Our guarantee", v.guarantee, edit,
      { blank: "The promise we'll actually stand behind." }));
    wrap.appendChild(g);

    var three = v.threeYear || {}, one = v.oneYear || {};
    var g2 = O.el("div.wf-eos-grid", { style: "margin-top:13px" });
    g2.appendChild(visionCard("3-year picture" + (three.date ? " · " + three.date : ""),
      [three.revenue ? "Revenue: " + three.revenue : null,
       three.profit ? "Profit: " + three.profit : null]
        .filter(Boolean).concat(three.looksLike || []), edit,
      { blank: "What the place looks like in three years." }));
    g2.appendChild(visionCard("1-year plan" + (one.date ? " · " + one.date : ""),
      [one.revenue ? "Revenue: " + one.revenue : null,
       one.profit ? "Profit: " + one.profit : null]
        .filter(Boolean).concat(one.goals || []), edit,
      { blank: "Three to seven goals for the year. No more." }));
    wrap.appendChild(g2);
    return wrap;
  }

  function openVto(v) {
    var f = {
      coreValues: linesInput(v.coreValues, 5, "One per line"),
      purpose: textInput(v.purpose, "Why we exist"),
      niche: textInput(v.niche, "The one thing we're best at"),
      tenYear: textInput(v.tenYear, "e.g. $12m and four crews by 2036"),
      uniques: linesInput(v.uniques, 3, "One per line"),
      provenProcess: textInput(v.provenProcess, "e.g. Measure → CAD → Build → Finish → Install"),
      guarantee: textInput(v.guarantee, "e.g. Installed right or we come back free"),
      tyDate: textInput((v.threeYear || {}).date, "e.g. Dec 2029"),
      tyRev: textInput((v.threeYear || {}).revenue, "e.g. $6m"),
      tyProfit: textInput((v.threeYear || {}).profit, "e.g. 14%"),
      tyLooks: linesInput((v.threeYear || {}).looksLike, 4, "One per line"),
      oyDate: textInput((v.oneYear || {}).date, "e.g. Dec 2027"),
      oyRev: textInput((v.oneYear || {}).revenue, "e.g. $3.2m"),
      oyProfit: textInput((v.oneYear || {}).profit, "e.g. 11%"),
      oyGoals: linesInput((v.oneYear || {}).goals, 5, "One per line")
    };

    var body = O.el("div", null,
      field("Core values", "One per line. Three to seven of them.", f.coreValues),
      field("Purpose", null, f.purpose),
      field("Niche", null, f.niche),
      field("10-year target", null, f.tenYear),
      field("What makes us different", "One per line, ideally three.", f.uniques),
      field("Our proven process", null, f.provenProcess),
      field("Our guarantee", null, f.guarantee),
      field("3-year picture — date", null, f.tyDate),
      field("3-year revenue", null, f.tyRev),
      field("3-year profit", null, f.tyProfit),
      field("3-year — what it looks like", "One per line.", f.tyLooks),
      field("1-year plan — date", null, f.oyDate),
      field("1-year revenue", null, f.oyRev),
      field("1-year profit", null, f.oyProfit),
      field("1-year goals", "One per line. Three to seven.", f.oyGoals));

    O.dialog({
      title: "The Vision / Traction Organiser",
      note: "Leave anything blank you haven't decided yet — a half-filled V/TO " +
            "beats one nobody wrote.",
      content: body,
      buttons: [{
        label: "Save", primary: true, busyText: "Saving…",
        onClick: function () {
          return persist("vto", {
            coreValues: toLines(f.coreValues.value),
            purpose: f.purpose.value.trim(),
            niche: f.niche.value.trim(),
            tenYear: f.tenYear.value.trim(),
            uniques: toLines(f.uniques.value),
            provenProcess: f.provenProcess.value.trim(),
            guarantee: f.guarantee.value.trim(),
            threeYear: {
              date: f.tyDate.value.trim(), revenue: f.tyRev.value.trim(),
              profit: f.tyProfit.value.trim(), looksLike: toLines(f.tyLooks.value)
            },
            oneYear: {
              date: f.oyDate.value.trim(), revenue: f.oyRev.value.trim(),
              profit: f.oyProfit.value.trim(), goals: toLines(f.oyGoals.value)
            }
          });
        }
      }]
    });
  }

  /* ----------------------------------------------------------------- people */

  function peopleView() {
    var seats = (state.rec && state.rec.seats) || [];
    var mayEdit = WFEOS.canEdit(state.ctx.role);
    var wrap = O.el("div");

    var right = O.el("div");
    if (mayEdit) {
      right.appendChild(O.btn("Add a seat", {
        primary: true, onClick: function () { openSeat(null); }
      }));
      if (!seats.length) {
        right.appendChild(O.btn("Start from the roster", {
          busyText: "Building…",
          onClick: function () {
            var s = WFEOS.suggestSeats(state.ctx.roster, state.ctx.boardCfg);
            if (!s.length) {
              return Promise.reject(new Error(
                "Nobody's assigned to a phase in the Roster tab yet, so there's " +
                "nothing to build the chart from."));
            }
            return persist("seats", s);
          }
        }));
      }
    }
    wrap.appendChild(head("People", right));

    var gaps = WFEOS.seatGaps(seats);
    wrap.appendChild(O.el("div.muted", {
      style: "margin:-6px 0 14px",
      text: seats.length
        ? "One name per seat. Two names in a seat means nobody's accountable for it." +
          (gaps.length ? "  " + gaps.length + " seat" + (gaps.length === 1 ? " has" : "s have") +
            " nobody in it." : "")
        : "The accountability chart: the seats this company needs filled, and who sits in each."
    }));

    if (!seats.length) {
      wrap.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "No seats yet." }),
        O.el("div.muted", { text: mayEdit
          ? "Start from the roster, or add them one at a time."
          : "A manager sets this up." })));
      return wrap;
    }

    var g = O.el("div.wf-eos-grid");
    seats.forEach(function (s) {
      var vacant = !String(s.who || "").trim();
      var card = O.el("div.wf-eos-card", { style: "--c:" + color("people") },
        O.el("div.wf-eos-card-k", { text: s.seat || "Seat" }),
        O.el("div.wf-eos-card-v" + (vacant ? ".wf-eos-blank" : ""),
          { text: vacant ? "Nobody in this seat" : s.who, style: "font-weight:600" }));
      (s.roles || []).forEach(function (r, i) {
        card.appendChild(O.el("div.wf-eos-li", { style: "--c:" + color("people") },
          O.el("b", { text: String(i + 1) }), O.el("span", { text: r })));
      });
      if (!(s.roles || []).length) {
        card.appendChild(O.el("div.muted", { style: "margin-top:8px;font-size:12.5px",
          text: "No roles written down for this seat." }));
      }
      if (mayEdit) {
        card.appendChild(O.el("div", { style: "margin-top:12px;display:flex;gap:6px" },
          O.btn("Edit", { quiet: true, small: true, onClick: function () { openSeat(s); } }),
          O.btn("Remove", {
            quiet: true, small: true, busyText: "…",
            onClick: function () {
              return persist("seats", seats.filter(function (x) { return x.id !== s.id; }));
            }
          })));
      }
      g.appendChild(card);
    });
    wrap.appendChild(g);
    return wrap;
  }

  function openSeat(seat) {
    var seats = (state.rec && state.rec.seats) || [];
    var isNew = !seat;
    seat = seat || { id: "seat-" + Date.now().toString(36), seat: "", who: "", roles: [] };
    var f = {
      seat: textInput(seat.seat, "e.g. Shop Foreman"),
      who: textInput(seat.who, "One name"),
      roles: linesInput(seat.roles, 5, "One per line, up to five")
    };
    O.dialog({
      title: isNew ? "Add a seat" : seat.seat || "Edit seat",
      note: "Five roles at most. If it takes more than five lines to describe, " +
            "it's probably two seats.",
      content: O.el("div", null,
        field("Seat", null, f.seat),
        field("Who sits in it", "Leave blank if it's vacant — a visible gap is useful.", f.who),
        field("What they're accountable for", "One per line.", f.roles)),
      buttons: [{
        label: "Save", primary: true, busyText: "Saving…",
        onClick: function () {
          if (!String(f.seat.value || "").trim()) {
            return Promise.reject(new Error("Give the seat a name."));
          }
          var next = {
            id: seat.id, seat: f.seat.value.trim(), who: f.who.value.trim(),
            roles: toLines(f.roles.value).slice(0, 5)
          };
          var list = isNew
            ? seats.concat([next])
            : seats.map(function (s) { return s.id === seat.id ? next : s; });
          return persist("seats", list);
        }
      }]
    });
  }

  /* ------------------------------------------------------------------- data */

  function quarter() { return state.quarter || WFEOS.quarterOf(); }

  /**
   * The scorecard: measurables down the side, weeks across the top.
   *
   * Thirteen weeks is a quarter, which is the window a weekly number is
   * actually read in. Cells are inputs rather than text so entering Monday's
   * numbers is one pass across a row instead of thirteen dialogs, and they're
   * only written on Save -- typing shouldn't fire a REST call per keystroke.
   */
  function dataView() {
    var rows = (state.rec && state.rec.scorecard) || [];
    var mayEdit = WFEOS.canEdit(state.ctx.role);
    var weeks = WFEOS.recentWeeks(13);
    var thisWeek = WFEOS.weekKey();
    var wrap = O.el("div");

    var right = O.el("div");
    if (mayEdit) {
      right.appendChild(O.btn("Add a measurable", {
        primary: true, onClick: function () { openMeasurable(null); }
      }));
    }
    wrap.appendChild(head("Data", right));
    wrap.appendChild(O.el("div.muted", {
      style: "margin:-6px 0 14px",
      text: "Five to fifteen numbers, read once a week. Green means the number hit " +
            "its goal; red means it didn't — not that anyone's in trouble."
    }));

    if (!rows.length) {
      wrap.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "No measurables yet." }),
        O.el("div.muted", {
          text: "Quotes sent, jobs installed, rework hours, days to first CAD — " +
                "things somebody can count on a Monday."
        })));
      return wrap;
    }

    var edits = {};   // rowId -> { week -> value }, only what's been typed

    var table = O.el("table.wf-eos-sc");
    var hr = O.el("tr", null, O.el("th.k", { text: "Measurable" }), O.el("th", { text: "Goal" }));
    weeks.forEach(function (w) {
      hr.appendChild(O.el("th", { text: w.split("-W")[1], title: w }));
    });
    table.appendChild(O.el("thead", null, hr));

    var body = O.el("tbody");
    rows.forEach(function (row) {
      var tr = O.el("tr", null,
        O.el("td.k", null,
          O.el("div.wf-eos-sc-m", { text: row.measurable || "Untitled" }),
          O.el("div.wf-eos-sc-o", {
            text: (row.owner || "no owner") +
                  (row.direction === "down" ? " · lower is better" : "")
          })),
        O.el("td", { text: row.goal === "" || row.goal === undefined ? "—" : String(row.goal),
                     style: "font-weight:600;color:var(--wf-muted)" }));

      weeks.forEach(function (w) {
        var td = O.el("td");
        var val = WFEOS.weekValue(row, w);
        var hit = WFEOS.onGoal(row, val);
        var cell = O.el("input.wf-eos-cell" +
          (hit === true ? ".wf-eos-hit" : hit === false ? ".wf-eos-miss" : "") +
          (w === thisWeek ? ".wf-eos-now" : ""), {
          type: "text", inputmode: "decimal",
          value: val === null ? "" : String(val),
          title: row.measurable + " · " + w
        });
        if (!mayEdit) cell.disabled = true;
        cell.addEventListener("input", function () {
          edits[row.id] = edits[row.id] || {};
          edits[row.id][w] = cell.value;
          var h = WFEOS.onGoal(row, cell.value);
          cell.classList.toggle("wf-eos-hit", h === true);
          cell.classList.toggle("wf-eos-miss", h === false);
        });
        td.appendChild(cell);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(O.el("div.wf-eos-scroll", null, table));

    if (mayEdit) {
      /* The warning is about the BOARD, not this record.
       *
       * It used to measure the scorecard alone against 3,800 characters, which
       * is not the limit -- every board-scoped key shares one 4,096-character
       * budget. So the scorecard could read "42% full" while the board had no
       * room left at all, and saving failed anyway.
       *
       * Filled in asynchronously because the honest answer needs a read. The
       * tag simply doesn't appear until it resolves, which is the right way
       * round: a missing warning is better than a wrong reassurance. */
      var sizeTag = O.el("span");
      WFStore.usage(state.ctx.t, "board").then(function (size) {
        if (!size.warn || !sizeTag.isConnected) return;
        sizeTag.appendChild(O.tag("board storage " + size.pct + "% full",
          size.full ? "late" : "warn"));
      }).catch(function () { /* a gauge that fails is not worth an error */ });

      var foot = O.el("div", { style: "display:flex;gap:8px;align-items:center;margin-top:13px;flex-wrap:wrap" },
        O.btn("Save the numbers", {
          primary: true, busyText: "Saving…",
          onClick: function () {
            var next = rows.map(function (r) {
              var mine = edits[r.id];
              if (!mine) return r;
              var copy = JSON.parse(JSON.stringify(r));
              copy.weeks = copy.weeks || {};
              Object.keys(mine).forEach(function (w) {
                var v = String(mine[w]).trim();
                if (v === "") delete copy.weeks[w];
                else copy.weeks[w] = v;
              });
              return copy;
            });
            return persist("scorecard", WFEOS.trimWeeks(next, 26));
          }
        }),
        O.el("div.muted", { style: "font-size:12px", text: "Type across a row, then save once." }),
        sizeTag);
      wrap.appendChild(foot);

      var edit = O.el("div", { style: "margin-top:16px;display:flex;gap:7px;flex-wrap:wrap" });
      rows.forEach(function (r) {
        edit.appendChild(O.btn(r.measurable || "Untitled", {
          quiet: true, small: true, onClick: function () { openMeasurable(r); }
        }));
      });
      wrap.appendChild(O.el("div", null,
        O.el("div.muted", { style: "margin-top:16px;font-size:12px", text: "Edit a measurable:" }),
        edit));
    }
    return wrap;
  }

  function openMeasurable(row) {
    var rows = (state.rec && state.rec.scorecard) || [];
    var isNew = !row;
    row = row || { id: "m-" + Date.now().toString(36), measurable: "", owner: "", goal: "", direction: "up", weeks: {} };
    var f = {
      measurable: textInput(row.measurable, "e.g. Quotes sent"),
      owner: textInput(row.owner, "One name"),
      goal: textInput(row.goal, "e.g. 12"),
      direction: selectInput([
        { value: "up", label: "Hit or above the goal is good" },
        { value: "down", label: "At or below the goal is good" }
      ], row.direction || "up")
    };
    O.dialog({
      title: isNew ? "Add a measurable" : row.measurable || "Edit measurable",
      note: "Something one person can count, weekly, without a spreadsheet.",
      content: O.el("div", null,
        field("Measurable", null, f.measurable),
        field("Who reports it", null, f.owner),
        field("Weekly goal", null, f.goal),
        field("Which way is good?",
          "Rework hours going down is a win; quotes sent going down isn't.", f.direction)),
      buttons: [{
        label: isNew ? "Add it" : "Save", primary: true, busyText: "Saving…",
        onClick: function () {
          if (!String(f.measurable.value || "").trim()) {
            return Promise.reject(new Error("Give it a name."));
          }
          var next = {
            id: row.id, measurable: f.measurable.value.trim(), owner: f.owner.value.trim(),
            goal: f.goal.value.trim(), direction: f.direction.value, weeks: row.weeks || {}
          };
          var list = isNew
            ? rows.concat([next])
            : rows.map(function (r) { return r.id === row.id ? next : r; });
          return persist("scorecard", list);
        }
      }, !isNew ? {
        label: "Remove", danger: true, busyText: "Removing…",
        onClick: function () {
          return persist("scorecard", rows.filter(function (r) { return r.id !== row.id; }));
        }
      } : null].filter(Boolean)
    });
  }

  /* ---------------------------------------------------------------- process */

  function processView() {
    var procs = (state.rec && state.rec.processes) || [];
    var mayEdit = WFEOS.canEdit(state.ctx.role);
    var h = WFEOS.processHealth(procs);
    var wrap = O.el("div");

    var right = O.el("div");
    if (mayEdit) {
      right.appendChild(O.btn("Add a core process", {
        primary: true, onClick: function () { openProcess(null); }
      }));
    }
    wrap.appendChild(head("Process", right));
    wrap.appendChild(O.el("div.muted", {
      style: "margin:-6px 0 14px",
      text: procs.length
        ? "The handful of processes that run this company. " + h.documented + " of " +
          h.total + " are written up as an SOP — the steps live in the SOPs tab, " +
          "not here, so there's only ever one copy."
        : "The six to ten processes that run this company, each pointing at the SOP " +
          "that spells it out."
    }));

    if (!procs.length) {
      wrap.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "No core processes listed yet." }),
        O.el("div.muted", {
          text: "Measure and quote, CAD and drawing, fabrication, finishing, " +
                "install, invoicing, hiring — that sort of thing."
        })));
      return wrap;
    }

    var g = O.el("div.wf-eos-grid");
    procs.forEach(function (p) {
      var card = O.el("div.wf-eos-card", { style: "--c:" + color("process") },
        O.el("div.wf-eos-card-k", { text: p.owner ? p.owner + " owns it" : "no owner" }),
        O.el("div", { text: p.name || "Untitled", style: "font-size:16px;font-weight:700;margin-top:5px" }));
      (p.steps || []).forEach(function (s, i) {
        card.appendChild(O.el("div.wf-eos-li", { style: "--c:" + color("process") },
          O.el("b", { text: String(i + 1) }), O.el("span", { text: s })));
      });
      if (!(p.steps || []).length) {
        card.appendChild(O.el("div.muted", { style: "margin-top:8px;font-size:12.5px",
          text: "No steps written down." }));
      }
      var row = O.el("div", { style: "margin-top:12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap" });
      row.appendChild(p.sopId
        ? O.tag("documented", "go")
        : O.tag("not documented", "warn"));
      if (p.sopId) {
        row.appendChild(O.btn("Open the SOP", {
          quiet: true, small: true,
          onClick: function () { state.ctx.goTo("sops"); }
        }));
      }
      if (mayEdit) {
        row.appendChild(O.btn("Edit", { quiet: true, small: true, onClick: function () { openProcess(p); } }));
      }
      card.appendChild(row);
      g.appendChild(card);
    });
    wrap.appendChild(g);
    return wrap;
  }

  function openProcess(proc) {
    var procs = (state.rec && state.rec.processes) || [];
    var isNew = !proc;
    proc = proc || { id: "p-" + Date.now().toString(36), name: "", owner: "", steps: [], sopId: null };

    var f = {
      name: textInput(proc.name, "e.g. Measure and quote"),
      owner: textInput(proc.owner, "One name"),
      steps: linesInput(proc.steps, 6, "One step per line — the major ones, not every keystroke")
    };
    var sopSel = selectInput([{ value: "", label: "Not documented yet" }], proc.sopId || "");

    var body = O.el("div", null,
      field("Process", null, f.name),
      field("Who owns it", null, f.owner),
      field("The major steps", "Aim for under ten. If it needs more, it's two processes.", f.steps),
      field("Its SOP", "The written procedure lives in the SOPs tab.", sopSel));

    // The SOP list is worth waiting for but not worth blocking on -- the dialog
    // opens immediately and the picker fills in when the library answers.
    (state.sops ? Promise.resolve(state.sops) : WFSOP.load(state.ctx.t).then(function (d) {
      state.sops = d.sops || [];
      return state.sops;
    })).then(function (sops) {
      sops.forEach(function (s) {
        var opt = O.el("option", { value: s.id, text: s.name + " · " + s.category });
        if (s.id === proc.sopId) opt.selected = true;
        sopSel.appendChild(opt);
      });
    }).catch(function () {
      sopSel.appendChild(O.el("option", { value: "", text: "(couldn't reach the SOP library)" }));
    });

    O.dialog({
      title: isNew ? "Add a core process" : proc.name || "Edit process",
      content: body,
      buttons: [{
        label: "Save", primary: true, busyText: "Saving…",
        onClick: function () {
          if (!String(f.name.value || "").trim()) {
            return Promise.reject(new Error("Give the process a name."));
          }
          var next = {
            id: proc.id, name: f.name.value.trim(), owner: f.owner.value.trim(),
            steps: toLines(f.steps.value), sopId: sopSel.value || null
          };
          var list = isNew
            ? procs.concat([next])
            : procs.map(function (p) { return p.id === proc.id ? next : p; });
          return persist("processes", list);
        }
      }, !isNew ? {
        label: "Remove", danger: true, busyText: "Removing…",
        onClick: function () {
          return persist("processes", procs.filter(function (p) { return p.id !== proc.id; }));
        }
      } : null].filter(Boolean)
    });
  }

  /* --------------------------------------------------------------- traction */

  function tractionView() {
    var all = (state.rec && state.rec.rocks) || [];
    var q = quarter();
    var rocks = WFEOS.rocksFor(all, q);
    var mayEdit = WFEOS.canEdit(state.ctx.role);
    var prog = WFEOS.rockProgress(rocks);
    var wrap = O.el("div");

    var quarters = {};
    all.forEach(function (r) { quarters[r.quarter || WFEOS.quarterOf()] = true; });
    quarters[WFEOS.quarterOf()] = true;
    var qSel = selectInput(Object.keys(quarters).sort().reverse().map(function (k) {
      return { value: k, label: k };
    }), q);
    qSel.addEventListener("change", function () { state.quarter = qSel.value; paint(); });

    var right = O.el("div", null, qSel);
    if (mayEdit) {
      right.appendChild(O.btn("Add a rock", { primary: true, onClick: function () { openRock(null); } }));
    }
    wrap.appendChild(head("Traction", right));
    wrap.appendChild(O.el("div.muted", {
      style: "margin:-6px 0 14px",
      text: rocks.length
        ? prog.done + " of " + prog.total + " done this quarter. Three to seven rocks " +
          "is the range — more than that and none of them move."
        : "Rocks are the three to seven things that must be finished this quarter. " +
          "One owner each, done or not done, no partial credit at the end."
    }));

    if (!rocks.length) {
      wrap.appendChild(O.el("div.wf-empty", null,
        O.el("div", { text: "No rocks set for " + q + "." }),
        O.el("div.muted", { text: mayEdit ? "Add the first one." : "A manager sets these." })));
      return wrap;
    }

    var g = O.el("div.wf-eos-grid");
    rocks.forEach(function (r) {
      var st = WFEOS.rockState(r);
      var c = st === "done" ? "#1f6f4a" : st === "off" ? "#c8471c" : color("traction");
      var pct = r.done ? 100 : Math.max(0, Math.min(100, parseInt(r.pct, 10) || 0));

      var card = O.el("div.wf-eos-card", { style: "--c:" + c },
        O.el("div.wf-eos-card-k", { text: (r.owner || "no owner") + " · " + (r.quarter || q) }),
        O.el("div", { text: r.title || "Untitled",
                      style: "font-size:16px;font-weight:700;margin-top:5px;line-height:1.35" }));
      card.appendChild(O.el("div", { style: "margin-top:10px" },
        st === "done" ? O.tag("done", "go")
        : st === "off" ? O.tag("off track", "late")
        : O.tag("on track", "go")));
      card.appendChild(O.el("div.wf-eos-bar", { style: "--c:" + c },
        O.el("i", { style: "width:" + pct + "%" })));
      card.appendChild(O.el("div.muted", { style: "font-size:12px;margin-top:5px",
        text: pct + "% there" }));

      if (mayEdit) {
        card.appendChild(O.el("div", { style: "margin-top:12px;display:flex;gap:6px;flex-wrap:wrap" },
          O.btn(r.done ? "Not done after all" : "Mark it done", {
            small: true, busyText: "…",
            onClick: function () {
              return persist("rocks", all.map(function (x) {
                if (x.id !== r.id) return x;
                var c2 = JSON.parse(JSON.stringify(x));
                c2.done = !x.done;
                if (c2.done) c2.pct = 100;
                return c2;
              }));
            }
          }),
          O.btn("Edit", { quiet: true, small: true, onClick: function () { openRock(r); } })));
      }
      g.appendChild(card);
    });
    wrap.appendChild(g);
    return wrap;
  }

  function openRock(rock) {
    var all = (state.rec && state.rec.rocks) || [];
    var isNew = !rock;
    rock = rock || {
      id: "r-" + Date.now().toString(36), title: "", owner: "",
      quarter: quarter(), done: false, onTrack: true, pct: 0
    };
    var f = {
      title: textInput(rock.title, "e.g. Powder line running two shifts"),
      owner: textInput(rock.owner, "One name"),
      quarter: textInput(rock.quarter || quarter(), "e.g. Q4 2026"),
      pct: O.el("input", { type: "number", min: "0", max: "100", value: String(rock.pct || 0) }),
      onTrack: selectInput([
        { value: "yes", label: "On track" },
        { value: "no", label: "Off track" }
      ], rock.onTrack === false ? "no" : "yes")
    };
    O.dialog({
      title: isNew ? "Add a rock" : rock.title || "Edit rock",
      note: "One owner. At the end of the quarter it's done or it isn't — the " +
            "percentage is only there to see it coming.",
      content: O.el("div", null,
        field("Rock", null, f.title),
        field("Owner", null, f.owner),
        field("Quarter", null, f.quarter),
        field("How far along", null, f.pct),
        field("Honestly?", null, f.onTrack)),
      buttons: [{
        label: "Save", primary: true, busyText: "Saving…",
        onClick: function () {
          if (!String(f.title.value || "").trim()) {
            return Promise.reject(new Error("Give the rock a name."));
          }
          var next = {
            id: rock.id, title: f.title.value.trim(), owner: f.owner.value.trim(),
            quarter: f.quarter.value.trim() || quarter(),
            done: !!rock.done, onTrack: f.onTrack.value === "yes",
            pct: Math.max(0, Math.min(100, parseInt(f.pct.value, 10) || 0))
          };
          var list = isNew
            ? all.concat([next])
            : all.map(function (r) { return r.id === rock.id ? next : r; });
          state.quarter = next.quarter;
          return persist("rocks", list);
        }
      }, !isNew ? {
        label: "Remove", danger: true, busyText: "Removing…",
        onClick: function () {
          return persist("rocks", all.filter(function (r) { return r.id !== rock.id; }));
        }
      } : null].filter(Boolean)
    });
  }

  /* -------------------------------------------------------------------- tab */

  O.tab({
    id: "eos",
    label: "EOS",
    // No roles: the vision, the seats and the issues are for everybody. The two
    // things that aren't -- the Leadership and V/TO lists, and the scorecard --
    // are filtered inside, so a worker gets a real tab rather than a locked one.
    badgeCount: function () { return inboxCount; },
    render: function (ctx) {
      state.ctx = ctx;
      state.host = O.el("div");
      if (state.data && state.rec) { paint(); return state.host; }
      state.host.appendChild(O.el("div.loading", { text: "Opening the EOS board…" }));
      return refresh().then(function () { return state.host; });
    }
  });
})();
