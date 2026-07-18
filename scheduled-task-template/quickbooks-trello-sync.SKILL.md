<!--
  TEMPLATE — this is NOT ready to schedule as-is. It follows the same shape as
  your existing "trello-lead-intake-sync" scheduled task, but needs three
  things filled in by you (marked TODO below) before it's safe to run for real:

    1. The actual Trello Custom Field IDs for "Job Value (QB)", "Job Cost (QB)",
       and "Lead Received (Gmail)" on each board (create the fields first if
       they don't exist yet — see Step 0).
    2. A real customer-name-matching rule between Trello card names and
       QuickBooks customer names (Step 2 below is a starting guess).
    3. A decision on how to approximate "job cost" from QuickBooks, since
       standard QuickBooks Online doesn't do job costing without Projects/
       QBO Advanced — Step 3 lists the honest options.

  Once filled in, set this up via the "schedule" skill or
  mcp__scheduled-tasks__create_scheduled_task, same as the existing
  lead-intake-sync automation. Recommend running it once in report-only mode
  (skip Step 5's writes) before turning on live writes.
-->

# Trello <-> QuickBooks/Gmail profitability bridge (template)

This is an automated run. The user is not present to answer questions.
Execute autonomously; make reasonable choices and note them in the report.
Only take "write" actions (PUT to Trello custom fields) if explicitly enabled
below — default to report-only until Tallen confirms the matching logic is
solid.

## Why this exists

The Western Fabrication Ops Power-Up (deployed separately, see the parent
folder's README) reads two Trello Custom Fields per card — "Job Value (QB)"
and "Job Cost (QB)" — to show margin on the board dashboard and in each
card's "Job Economics" popup. Those fields don't populate themselves; this
scheduled task is the bridge that keeps them in sync with QuickBooks Online
(and, for lead-timing, Gmail) on a recurring basis.

If this task is never scheduled, the Power-Up still works fine — it just
falls back to whatever value/cost someone types manually into the popup.

## STEP 0 — One-time setup (do this before scheduling)

1. On the **Office Operations** board and the **Lead to Bead Pipeline** board,
   create three Custom Fields if they don't already exist:
   - "Job Value (QB)" — type Number
   - "Job Cost (QB)" — type Number
   - "Lead Received (Gmail)" — type Date
   (The Trello MCP connector cannot create custom fields — do this manually
   in Trello: card menu -> Custom Fields -> Manage Custom Fields -> New, once
   per board. Takes about a minute.)
2. Note each field's ID (Trello shows it in the browser URL/API when you
   inspect it, or ask Claude to fetch `/1/boards/{boardId}/customFields` once
   network access to api.trello.com is confirmed working from a fresh
   session — see the parent README's "network access" note).
3. TODO: paste the six resulting field IDs (3 fields x 2 boards) into the
   CONSTANTS block below before this task is scheduled.

```
CONSTANTS (fill in before scheduling):
  OFFICE_OPS_BOARD_ID = "6939928cc816d7f7d1d2d7ba"
  LEAD_TO_BEAD_BOARD_ID = "6a0630c1e29e7edf8ca1ba5f"
  FIELD_ID_JOB_VALUE_OFFICE_OPS   = "TODO"
  FIELD_ID_JOB_COST_OFFICE_OPS    = "TODO"
  FIELD_ID_LEAD_RECEIVED_OFFICE_OPS = "TODO"
  FIELD_ID_JOB_VALUE_LEAD_TO_BEAD = "TODO"
  FIELD_ID_JOB_COST_LEAD_TO_BEAD  = "TODO"
  FIELD_ID_LEAD_RECEIVED_LEAD_TO_BEAD = "TODO"
  WRITE_MODE = "report-only"   # change to "live" only after a clean dry run
```

## STEP 1 — Pull open cards

For both `OFFICE_OPS_BOARD_ID` and `LEAD_TO_BEAD_BOARD_ID`, list open cards
(exclude the "excludedLists" already documented in the Power-Up's
`config.js` — personal to-do lists, Holding Pattern, etc. — same list, don't
re-derive it, just read it from that file). Skip cards in terminal lists
("Job Closed/Done", "Lost Bids", "Out of Scope") — no need to keep syncing
financials on closed jobs.

## STEP 2 — Match each card to a QuickBooks customer

TODO — starting rule (adjust once you see real mismatches): use the card's
name, stripped of trailing parenthetical notes, as the QuickBooks customer
display name. Call `qbo_contact_search_customer` with that string. If
exactly one match, proceed. If zero or multiple matches, skip the card and
list it in the report under "Unmatched — needs manual mapping" rather than
guessing.

## STEP 3 — Pull financials for the matched customer

- **Job Value**: sum of `qbo_sales_get_invoices` (or `qbo_sales_get_estimates`
  if not yet invoiced) amounts for that customer tied to this job. If a
  customer has multiple jobs/invoices, TODO decide whether to sum all of
  them or ask Tallen to use QuickBooks sub-customers per job for clean 1:1
  matching (recommended long-term fix — flat customer-name matching breaks
  down once a repeat customer has multiple concurrent jobs).
- **Job Cost**: standard QuickBooks Online has no per-job costing without
  Projects/QBO Advanced. Two honest options, pick one and note which in the
  report:
  (a) Use `profit_loss_quickbooks_account` or `qbo_accounting_get_sales_by_customer_summary`
      filtered to this customer as a rough proxy (won't isolate this job if
      the customer has other unrelated purchases).
  (b) Leave Job Cost blank from this automation and let it stay a manual
      entry in the Power-Up's Job Economics popup — simplest, least
      misleading. This is the recommended default until QuickBooks Projects
      or job-level cost tracking is set up.

## STEP 4 — Lead-received timestamp (Gmail)

For cards that came from the website contact form (same source as the
existing `trello-lead-intake-sync` task), reuse that task's Gmail search
pattern (`subject:"Contact Request Confirmation - Western Fabrication Metal
Railings"`) to find the original email and its received date. This becomes
"Lead Received (Gmail)".

## STEP 5 — Write to Trello Custom Fields (only if WRITE_MODE = "live")

For each matched card, `PUT /1/cards/{cardId}/customField/{fieldId}/item`
with `{ "value": { "number": <jobValue> } }` (or `{ "date": <isoDate> }` for
the Gmail field). This requires raw REST access (key + token), since the
Trello MCP connector doesn't expose custom-field writes. Use a token
generated specifically for this automation (not reused from any Power-Up),
and confirm `api.trello.com` is reachable from a fresh scheduled-task
session before enabling live writes — see the parent README's network
access section for the exact Admin -> Capabilities steps.

If `WRITE_MODE` is "report-only", compute and report everything above
without calling this step at all — just show what *would* be written.

## STEP 6 — Report every write action

List, per card: matched QuickBooks customer (or "unmatched"), Job Value
written, Job Cost written (or "skipped — no reliable source"), Lead Received
date written (or "not a website lead"). Never write silently.
