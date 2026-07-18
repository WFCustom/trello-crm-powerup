/**
 * Western Fabrication Ops Power-Up — configuration
 *
 * This is the ONLY file most people will ever need to touch after deployment.
 * It maps Trello list IDs to production/sales "stages" so the Power-Up knows
 * how to compute time-in-stage, flag stale cards, and build the dashboard.
 *
 * HOW TO FIND A LIST ID:
 *   Open https://trello.com/b/<shortLink>.json in a browser while logged in
 *   and search for the list name; the "id" field next to it goes here.
 *   (Or ask Claude in Cowork — it already has these mapped below.)
 *
 * slaDays: expected max number of days a card should sit in that list before
 *   the badge turns amber/red. Tune these to match reality — they're a first
 *   guess, not a policy.
 */

window.WF_CONFIG = {
  // Fill this in with the API Key from YOUR registered Power-Up
  // (trello.com/power-ups/admin -> your Power-Up -> API Key tab).
  // This is a public "app key", not a secret — safe to commit/host.
  // Do NOT reuse the key/token pair from earlier troubleshooting chats;
  // generate a fresh one for this Power-Up and see README "Security notes".
  appKey: "79ba7e89699a07e528c224e6c2099418",

  // Trello USERNAMES (not full names) allowed to approve a completed phase
  // and advance a card to the next stage. Anyone not listed still sees the
  // "Complete" button and can trigger the approval request -- they just
  // won't see the Approve button in the Manager Approvals view.
  // TODO: fill in with real Trello usernames.
    managers: ["bannista", "craigjacaway", "dalejacaway", "westernfabpmt1"],

  // Optional: which Trello usernames typically work each phase, used only to
  // pre-filter the "My Jobs" view. Leave a phase out (or the whole object
  // empty) and workers just get a manual phase picker instead -- nothing
  // breaks either way.
  phaseSpecialists: {
        "CAD": ["dalejacaway", "bannista"],
        "CNC Table": ["dalejacaway", "bannista"],
  },

  // Live, QuickBooks-driven hourly rates. A scheduled task (see
  // scheduled-task-template/quickbooks-hourly-rate-sync.SKILL.md) keeps this
  // Trello card's description in sync with QuickBooks payroll data -- the
  // Team Performance popup reads it fresh on every load, so updating pay
  // rates doesn't require redeploying the Power-Up.
  // This card already exists on Office Operations -> Miscellaneous list.
  ratesCardId: "6a5ae3f1b4da67918f72d961",

  // Manual fallback / bootstrap: used for anyone not yet found on the synced
  // Rates card (e.g. before QuickBooks is connected, or a new hire QB
  // hasn't been mapped for yet). Trello username -> hourly pay rate.
  // Leave empty and Team Performance still works -- it just shows hours +
  // revenue share with no labor-cost/net-contribution column for that person.
  hourlyRates: {
    // "someusername": 22
  },

  // Required before the QuickBooks sync can run for real: map each Trello
  // username to the exact QuickBooks employee display name (or QB employee
  // ID once you have it) so payroll data never gets attached to the wrong
  // person. Deliberately NOT auto-matched by name similarity -- confirm
  // this by hand once, then the sync just references it every run.
  qbEmployeeMap: {
    // "trellousername": "QuickBooks Employee Display Name"
  },

  boards: {
    // --- Office Operations (production board) ---
    "6939928cc816d7f7d1d2d7ba": {
      name: "Office Operations",
      type: "production",
      stages: [
        { listId: "6a2c22e6014540415868cc02", name: "Intake",                 order: 1,  slaDays: 1 },
        { listId: "69a743b54496e7a4b924acf6", name: "Portal - CRM",           order: 2,  slaDays: 2 },
        { listId: "6939928cc816d7f7d1d2d7b9", name: "Make Job Packet",        order: 3,  slaDays: 2, isWorkPhase: true },
        { listId: "6a1da6d2bbab87140dc09a20", name: "Portal - Final Measure", order: 4,  slaDays: 3 },
        { listId: "69a730d9c78b097f55a36df0", name: "CAD",                    order: 5,  slaDays: 2, isWorkPhase: true },
        { listId: "69a72f453b199d4c20fb3868", name: "Print CAD",              order: 6,  slaDays: 1, isWorkPhase: true },
        { listId: "6a5127b8d82e999f671bd840", name: "CNC Table",              order: 7,  slaDays: 2, isWorkPhase: true },
        { listId: "69a7308d189ef61a8836dbe3", name: "Assemble",               order: 8,  slaDays: 3, isWorkPhase: true },
        { listId: "69a730a894c7174c44e8c4e0", name: "Sandblast / Powder Coat",order: 9,  slaDays: 3, isWorkPhase: true },
        { listId: "69a730bbe0235638ecd9b160", name: "ReWork",                 order: 10, slaDays: 1, isException: true, isWorkPhase: true },
        { listId: "69b9c6369e225825d36d6f6e", name: "Install",                order: 11, slaDays: 1, isWorkPhase: true },
        { listId: "69b9c6a7260f97abbb4194ac", name: "Install (Tuesday)",      order: 11, slaDays: 1, isWorkPhase: true },
        { listId: "69a730b27303839ae3bc9add", name: "Install",                order: 11, slaDays: 1, isWorkPhase: true, isPrimaryTarget: true },
        { listId: "69b9c6d1a44e75fbc3138376", name: "Install",                order: 11, slaDays: 1, isWorkPhase: true },
        { listId: "69a848037fc4f5092a6d5dcd", name: "Billing",                order: 12, slaDays: 3 },
        { listId: "69ab2cc348d183651451c342", name: "Outstanding Invoices",   order: 13, slaDays: 7 },
        { listId: "69a85a220a76edceafef6544", name: "Job Closed / Done",      order: 14, slaDays: null, isTerminal: "won" },
        { listId: "69a7335b4436e169f24f2c86", name: "Lost Bids",              order: 15, slaDays: null, isTerminal: "lost" }
      ],
      // Lists intentionally excluded from stage-timing/dashboard math (personal
      // to-do lists, catch-alls) — still visible on the board, just not "flow".
      excludedLists: [
        "69b9c47623b08cdf0c22f26a",
        "69e00b1d0aa39787e59200cb",
        "69ca9524dcdebbcd9de18724",
        "69c5bbdde17a5ba2be4d9c9a",
        "69b1d857555baf0446ba452f",
        "69ca95355818da46016724f0"
      ]
    },

    // --- Lead to Bead Pipeline (sales board) ---
    "6a0630c1e29e7edf8ca1ba5f": {
      name: "Lead to Bead Pipeline",
      type: "sales",
      stages: [
        { listId: "6a063293dfada46f8461b008", name: "Cold Call Leads",        order: 1, slaDays: 3 },
        { listId: "6a06328497b107b96fd5c239", name: "Warm / Follow-Up",       order: 1, slaDays: 5 },
        { listId: "6a0630c1e29e7edf8ca1ba4f", name: "HOT Inbound Leads",      order: 1, slaDays: 1 },
        { listId: "69c5938bba5ecc0c9b1170f1", name: "Home Show Contacts",     order: 1, slaDays: 3 },
        { listId: "6a303ba14cc3b023f03894f2", name: "Awaiting Response",      order: 2, slaDays: 2 },
        { listId: "6a0630c1e29e7edf8ca1ba47", name: "Sales / Measure",        order: 3, slaDays: 2 },
        { listId: "6a2c2653371fc8bef8b96e53", name: "Converted / Go Measure", order: 4, slaDays: 2 },
        { listId: "6a06326a0283cc5ad25f16a8", name: "OTP Bid/Measure",        order: 5, slaDays: 2 },
        { listId: "6a2c2a0ed3dbfae76e18dd50", name: "Generate Bid/Estimate",  order: 6, slaDays: 2 },
        { listId: "6a0630c1e29e7edf8ca1ba53", name: "Bid Sent / Pending",     order: 7, slaDays: 5 },
        { listId: "6a0632c1f884a57950f5fd47", name: "Bead Laid - WON",        order: 8, slaDays: 1 },
        { listId: "6a0632d4e00f8e94875028bb", name: "Finalize Details / Job Packet", order: 9,  slaDays: 2 },
        { listId: "6a2c44c90adea7f2ec6f4223", name: "Make Job Packet",        order: 10, slaDays: 2 },
        { listId: "6a2c2be47b421e8758650f57", name: "Final Measure",          order: 11, slaDays: 3 },
        { listId: "6a0630c1e29e7edf8ca1ba46", name: "Transfer to Build Pipeline", order: 12, slaDays: 1, isHandoff: true, handoffTo: "Office Operations / Intake" },
        { listId: "6a0630c1e29e7edf8ca1ba4e", name: "Lost Bids",              order: 13, slaDays: null, isTerminal: "lost" },
        { listId: "6a30462de3f61c6ccdcdf555", name: "Out of Scope",           order: 13, slaDays: null, isTerminal: "lost" }
      ],
      excludedLists: [
        "6a0630c1e29e7edf8ca1ba54",
        "6a31800a88b8bbbfd33d27cb",
        "6a0630c1e29e7edf8ca1ba5a",
        "6a0630c1e29e7edf8ca1ba5b",
        "6a0630c1e29e7edf8ca1ba5c",
        "6a0630c1e29e7edf8ca1ba5e"
      ]
    }
  },

  // Custom Field names this Power-Up will look for (read-only, via t.getRestApi()).
  // These are populated by the QuickBooks/Gmail bridge scheduled task — see
  // /scheduled-task-template/quickbooks-trello-sync.SKILL.md. If a board doesn't
  // have these custom fields yet, the Power-Up just skips that data silently.
  customFieldNames: {
    jobValue: "Job Value (QB)",
    jobCost: "Job Cost (QB)",
    leadReceivedAt: "Lead Received (Gmail)"
  },

  // Badge color thresholds, as a fraction of slaDays elapsed
  thresholds: {
    amberAt: 0.75,
    redAt: 1.0
  }
};
