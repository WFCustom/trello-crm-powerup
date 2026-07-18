# Western Fabrication Ops Power-Up

A real Trello Power-Up (badges on cards, popups, a board dashboard) for the
**Office Operations** and **Lead to Bead Pipeline** boards. It tracks:

- **Process timing** — how long each job has sat in its current stage,
  color-coded against an SLA you set per stage, plus a full move-by-move
  timeline per card.
- **Handoffs** — a log of who passed a job to whom (Sales -> Intake ->
  Fabrication -> Finishing -> Install -> Billing), and a badge flagging
  cards sitting in "Transfer to Build Pipeline" waiting to be picked up by
  the production team.
- **Profitability** — job value / cost / margin, entered manually or
  prefilled from a QuickBooks bridge (see `scheduled-task-template/`), shown
  per card and rolled up on a board-wide dashboard sorted worst-margin-first.
- **A board dashboard** — pipeline occupancy by stage, everything currently
  over its SLA, pending handoffs, rework in progress, and the profitability
  rollup, all in one popup (click the board button "Ops Dashboard").
- **Phase-flow with claim/assign, timers, and approval** — workers tap Claim
  & Start (or a manager assigns them) on hands-on shop-floor stages (CAD,
  CNC Table, Assemble, Sandblast/Powder Coat, ReWork, Install), pause/resume
  as needed, then Complete. A manager approves before the card auto-advances
  to the next stage — with the exact duration and who did it logged
  automatically. Mis-taps are recoverable with Undo.
- **"My Jobs" and "Manager Approvals" views** — filtered, noise-free lists
  (My Jobs: your claimed work + what's available to claim in your phase;
  Manager Approvals: everything awaiting sign-off or unassigned) so nobody
  has to scan the whole board to find their next task.

## Why this needed to be a real Power-Up, not just a Cowork automation

Two things earlier chats ran into — a network allowlist block when trying to
hit `api.trello.com` from Claude's sandbox, and the Trello connector having
no support for custom fields or card action history — don't actually apply
here. A Power-Up runs **inside Trello's own browser tab**, using Trello's
own `t.getRestApi()` helper, which handles authorization via a one-time
popup and never needs Claude's sandbox to reach the internet at all. That's
why this is plain static HTML/JS meant to be hosted and registered with
Trello directly, rather than something run from a chat.

## What's in this folder

```
index.html              Power-Up entry point (loads Trello's client.js + our code)
connector.js             Defines the card badges, detail badges, and board button
config.js                <-- the file you'll actually edit: board/list/SLA mapping
lib/stage.js             Pure helper functions (no API calls)
lib/trello-rest.js       Wrapper around Trello's t.getRestApi() for reading
                         action history and custom fields
lib/phase.js             Claim/start/pause/complete/approve/assign state machine
                         (shared by connector.js and the popups below)
popups/
  timing.html/js         Card popup: full stage-by-stage timeline
  economics.html/js      Card popup: set job value/cost, see margin
  handoff.html/js        Card popup: log + view handoffs between teams
  dashboard.html/js      Board popup: the aggregate live-status dashboard
  myjobs.html/js         Board popup: "my claimed jobs" + "available to claim",
                         filtered to your phase
  approvals.html/js      Board popup (managers only): pending approvals +
                         unclaimed/assignable jobs
  assign.html/js         Card popup: manager assigns a specific person to
                         this phase (opened from the card's "Assign..." button)
  performance.html/js    Board popup (managers only): project profitability
                         by job + by type of work, and per-person productivity
lib/metrics.js           Pure aggregation math for the Team Performance view
scheduled-task-template/
  quickbooks-trello-sync.SKILL.md   Template for a Claude scheduled task that
                         syncs QuickBooks + Gmail data into Trello Custom
                         Fields so the Power-Up can display it. Needs
                         customization before it's runnable — see that file.
```

## Setup — three parts

### Part 1: Host the static files

Pick one:

**GitHub Pages (what you chose):**
1. Create a new GitHub repo (public or private — Pages works either way on
   paid plans; public repos get Pages free).
2. Upload everything in this folder to the repo root (keep the folder
   structure — `popups/`, `lib/`, etc. must stay where they are).
3. Repo Settings -> Pages -> Deploy from branch -> pick `main` / root ->
   Save. GitHub gives you a URL like
   `https://<your-username>.github.io/<repo-name>/`.
4. Wait a minute or two for the first deploy, then confirm
   `https://<that-url>/index.html` loads in a browser (should show a mostly
   blank page — that's correct, it only does anything inside Trello).

### Part 2: Register the Power-Up with Trello

1. Go to `trello.com/power-ups/admin`.
2. Click **New** (or reuse an existing empty Power-Up entry if you made one
   during earlier troubleshooting — either is fine, this doesn't reuse any
   old code).
3. Name it "Western Fabrication Ops", pick the **Western Fabrication**
   Workspace, and set the **Iframe connector URL** to
   `https://<your-github-pages-url>/index.html`.
4. Go to the **API Key** tab on this new Power-Up and generate a key if one
   isn't shown. Copy it.
5. Open `config.js` in this folder, find `appKey: "PUT_YOUR_POWERUP_API_KEY_HERE"`,
   and replace it with the key you just copied. Re-deploy (push the change
   to GitHub — Pages auto-updates in ~1 minute).
6. Back on the Power-Up admin page, go to **Capabilities** and confirm
   `card-badges`, `card-detail-badges`, and `board-buttons` are all listed
   (they're auto-detected from `connector.js`, but double check).
7. On each board (Office Operations, Lead to Bead Pipeline): board menu ->
   Power-Ups -> search for "Western Fabrication Ops" -> Enable.

### Part 3: First run

1. In `config.js`, set `managers` to the real Trello usernames of whoever
   should approve completed phases / assign work (see "Phase-flow" section
   below). Re-deploy after editing.
2. Open any card on Office Operations. You should see a badge that says
   "🔒 Enable timing" — click it. Trello will pop up a one-time
   authorization window (this is what replaces needing a raw API key/token
   pasted into a chat — each person who opens the board authorizes their
   own access, once).
3. After authorizing, reopen the card — badges should now show real
   "⏱ Xd in stage" timing, and (on work-phase lists) Claim & Start buttons.
4. Click the board's **Ops Dashboard**, **My Jobs**, and **Manager
   Approvals** buttons to see the other views.

## Phase-flow: claim, assign, timers, approval, auto-advance

This is the worker/manager workflow layered on top of the same board — it
does **not** create separate boards per phase. Cards move through your
existing lists (CAD -> Print CAD -> CNC Table -> Assemble -> Sandblast/
Powder Coat -> ReWork -> Install -> Billing), the same lists already in
`config.js`. Only lists marked `isWorkPhase: true` there get these buttons
(admin/portal/office lists don't).

**Worker flow (buttons appear on the card itself):**
1. **Claim & Start** — self-assigns and starts the timer, one tap. (A
   manager can instead hit **Assign...** on an unclaimed card to hand it to
   a specific person — the worker then sees **Start** waiting for them.)
2. **Pause** / **Resume** — for breaks, shift changes, interruptions. Time
   only accumulates while "running."
3. **Complete** — stops the timer and flags the card as awaiting approval.
   The card does **not** move yet.
4. If it's a mis-tap: **Undo** reopens it and resumes the timer, no data
   lost, no manager involvement needed.
5. A manager taps **Approve & Advance** — this logs who did it, how long it
   took, and moves the card to the next configured stage automatically. A
   comment is posted on the card as an audit trail.

**Manager tools:**
- **Manager Approvals** (board button) — everything currently awaiting
  sign-off, plus every unclaimed assignable job board-wide, in one place.
- **Assign...** (card button, managers only) — pick anyone on the board to
  hand this phase to, independent of Trello's own card-Members field (so it
  doesn't get mixed up with whoever's just "watching" a card for other
  reasons).

**Why "My Jobs" and "Manager Approvals" only have an "Open"/"Review" button
instead of acting inline:** Trello's Power-Up SDK only allows writing a
card's private data (`t.set`) from an iframe that's already scoped to that
specific card — a board-level popup can't reach into an arbitrary card's
storage directly. So these two views work as smart, pre-filtered triage
lists: they read board-wide data fine (that's a plain REST call), and
tapping through opens the exact right card where the real action buttons
are one more tap away. In practice this is barely slower and means the
state machine only lives in one place (`lib/phase.js`).

**Setup:** in `config.js`, fill in `managers: [...]` with the Trello
**usernames** (not full names) of whoever should see Approve/Assign
buttons. Optionally fill in `phaseSpecialists` to pre-filter each person's
"My Jobs" view to their usual phase(s) — leave it empty and everyone just
gets a manual phase picker instead, nothing breaks.

The first time anyone uses Claim/Assign/Approve, Trello will prompt for a
one-time **read + write** authorization (broader than the read-only prompt
used by the timing/dashboard features) — same popup mechanism, just a wider
scope, since these buttons actually change card state and move cards.

## Team Performance (admin/manager only)

A separate board button, gated the same way Manager Approvals is (config.js
`managers` list) -- workers don't see it. Two questions it answers:

**"What kind of work should we chase more of?"** -- every job's margin,
grouped by "Type of Project" (the same field your lead-intake automation
already captures from the website contact form), sorted best-margin-first.
Also a full project-by-project table, worst-margin-first, so underwater
jobs are impossible to miss.

**"Who's productive, and what are they worth?"** -- for each person who's
had a phase approved, their hours logged, phases completed, and speed
relative to each stage's configured SLA (a real efficiency signal since
it's normalized per stage, not just "who logs the most hours"). The dollar
figure is a **revenue share**, not exact accounting: each project's margin
is split across whoever logged time on it, proportional to their hours.
Fill in `hourlyRates` in `config.js` (Trello username -> $/hour) and it
also shows labor cost and net contribution per person; leave it empty and
you still get hours + revenue share with no extra setup.

This pulls **all** cards, including closed/archived ones (`filter=all`),
since "who was productive last quarter" needs finished jobs, not just
what's currently open. On a board with a long history this is a bigger API
call than the other views -- it's cached for the same 2 minutes as
everything else, so it won't hammer Trello on every popup open.

A toggle switches the per-person table between all-time and a rolling
30/90-day window; the project and type-of-work tables are always all-time
(a job's total margin doesn't change based on a viewing window).

**This is now live-wired, not just a manual `hourlyRates` fallback.** A
Trello card ("CONFIG: Hourly Rates", already created on Office Operations ->
Miscellaneous) holds the current rates as plain text, kept in sync by
`scheduled-task-template/quickbooks-hourly-rate-sync.SKILL.md`. The Team
Performance popup reads that card fresh every time it's opened
(`config.js` -> `ratesCardId`) and merges it over any manual `hourlyRates`
entries (live data wins; manual entries are just the fallback for anyone
not yet mapped). Updating a pay rate means editing QuickBooks, not
redeploying the Power-Up.

**Two things stand between this and actually running:**
1. **QuickBooks isn't connected in this workspace yet** — the payroll tools
   returned an authentication error when checked. Connect it under Cowork's
   connector settings, then the sync template can run for real.
2. **Only one Trello board member exists right now** (you). The per-person
   features throughout this whole Power-Up — claiming jobs, the handoff
   log, Team Performance — only mean something once your team members are
   added as actual Trello board members with their own logins. Worth doing
   before rolling any of this out day-to-day.

Once both are sorted: fill in `EMPLOYEE_MAP` in the sync template (Trello
username -> exact QuickBooks employee name — deliberately manual, not
auto-matched, since guessing wrong on payroll data is the kind of mistake
that erodes trust fast) and schedule it (weekly is plenty, pay rates don't
change often).

## Configuration — `config.js`

This is the only file you should need to touch regularly. It maps each
Trello list to a "stage" with an `slaDays` — the number of days a card
should reasonably sit there before its badge turns amber, then red. The
values shipped here are first-guess defaults based on your current board
structure; tune them once you've watched it run for a couple of weeks.

If you add/rename/reorder lists on either board, add or update the matching
entry in `config.js` — the Power-Up otherwise just skips lists it doesn't
recognize (it won't error, it just won't show timing for cards there).

## Security notes

- The API Key in `config.js` is a public identifier (like an OAuth
  `client_id`) — safe to have in a public GitHub repo. It cannot read or
  write anything by itself.
- The actual access token is obtained per-user via Trello's own
  authorization popup and stored by Trello, not by this code — it's never
  visible in source, logs, or chat transcripts.
- Separately: earlier troubleshooting sessions generated a raw Trello API
  key + token pair (for a different, now-abandoned approach) and that pair
  was pasted directly into chat more than once. Since chat transcripts
  aren't a secure place to keep credentials, it's worth rotating that pair
  — go to `trello.com/power-ups/admin`, find that old Power-Up entry, API
  Key tab, and regenerate. It isn't used by anything in this folder.

## Known limitations / roadmap

- **"Manager" is just a username list, not a real Trello permission.**
  `config.js` -> `managers` gates the Approve/Assign buttons in this
  Power-Up's UI, but doesn't stop someone from editing the card directly in
  Trello. Fine for a small trusted shop team; wouldn't hold up as real
  access control at a bigger scale.
- **My Jobs / Manager Approvals are triage lists, not action panels** — by
  design, per the SDK constraint explained above. One extra tap ("Open") to
  actually act, which also means whoever's acting sees full card context
  (description, attachments, checklist) rather than a stripped-down row.
- **Duplicate "Install" lists.** Your board has four separate lists that are
  all effectively "Install" (`install`, `Install Tuesday`, `Install`,
  `Install`). Auto-advance targets one of them (marked `isPrimaryTarget` in
  `config.js`) — change which one in config if that's not the right default.
- **Dashboard timing is approximate.** For speed (one API call for the
  whole board instead of one per card), the dashboard uses each card's
  last-activity timestamp as a stand-in for "time in current stage." Open a
  card and check "Stage Timeline" for the exact figure, computed from full
  move history.
- **One board at a time.** The dashboard button only covers the board
  you're on — there's no combined Sales + Production view yet. Doable as a
  v2 if useful, but needs a bit more design (which board "owns" a card that
  appears conceptually on both).
- **QuickBooks/Gmail sync is a template, not wired up yet.** See
  `scheduled-task-template/quickbooks-trello-sync.SKILL.md` — it needs
  Trello Custom Fields created first and a couple of judgment calls filled
  in (how to match a Trello card to a QuickBooks customer, how to
  approximate job cost since QuickBooks Online doesn't do job-costing
  without Projects/Advanced). Until that's set up, "Job Economics" is a
  manual entry per card, which still works fine on its own.
- **Rate limits.** Trello allows roughly 300 API calls per 10 seconds per
  token. Card badge timing is cached for 2 minutes per card
  (`lib/trello-rest.js`, `CACHE_TTL_MS`) to stay well under that even on a
  busy board; raise it if you have a very large board and see errors.
