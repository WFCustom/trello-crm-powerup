<!--
  TEMPLATE — needs two things filled in before scheduling (marked TODO):
    1. EMPLOYEE_MAP below (Trello username -> exact QuickBooks employee name).
       Mirror the same mapping into the Power-Up's config.js qbEmployeeMap so
       a human reading either file sees the same source of truth.
    2. Confirm the QuickBooks connector is authenticated in this workspace
       (Settings -> Connectors in Cowork) -- as of this template being
       written, it was not yet connected, so this cannot run for real until
       that's done.

  Unlike the job-value/job-cost bridge template, this one writes through the
  already-connected Trello MCP tools directly (trelloWriteCard) -- no raw
  REST API, no key/token, no network-allowlist issue. Rates are just a card
  description, and the Trello connector already supports updating those.
-->

# QuickBooks -> Trello hourly-rate sync (template)

This is an automated run. The user is not present to answer questions.
Execute autonomously; make reasonable, conservative choices and note them
in the report. This task only ever updates ONE card's description (the
Rates reference card below) -- never touch any other card, list, or board.

## Why this exists

The Western Fabrication Ops Power-Up's "Team Performance" view (manager-only)
shows each person's labor cost and net contribution per project, using
their real hourly pay rate. Rather than someone hand-typing rates into the
Power-Up's config file (which would mean redeploying the whole Power-Up
every time a rate changes), this task keeps a single Trello card's
description in sync with QuickBooks payroll, and the Power-Up reads that
card fresh every time the dashboard is opened.

```
CONSTANTS (fill in before scheduling):
  RATES_CARD_ID = "6a5ae3f1b4da67918f72d961"   # already created: Office
                                                 # Operations -> Miscellaneous
                                                 # -> "CONFIG: Hourly Rates"
  EMPLOYEE_MAP = {
    # "trellousername": "QuickBooks Employee Display Name",
    # TODO -- add one line per person. Do not guess/fuzzy-match names;
    # leave someone out rather than risk attaching the wrong rate to the
    # wrong person.
  }
```

## STEP 1 — Confirm QuickBooks is reachable

Call `company_info`. If it errors with an authentication/connection message,
stop here and report exactly that -- don't proceed with partial data.

## STEP 2 — Resolve each mapped employee

For each entry in `EMPLOYEE_MAP`, call `qbo_payroll_search_employee` with
the QuickBooks display name. If exactly one match, keep its employee ID
(the `local_id` from the `external_ids` entry where
`namespace_id='Intuit.ems.iop'` — same field `qbo_payroll_get_employees`
uses). If zero or multiple matches, skip this person and list them under
"Unmatched" in the report — never guess.

## STEP 3 — Get pay rate

For each resolved employee, call `qbo_payroll_get_employee_contract_details`
(omit `as_of_date` to get the current record). Handle by `pay_type`:

- **HOURLY**: use the contract's pay rate amount directly as the hourly rate.
- **SALARY**: convert to an effective hourly rate using the contract's
  weekly contracted hours: `hourly = annual_rate / 52 / weekly_hours`. If
  weekly hours aren't available, assume 40 and say so explicitly in the
  report (this is an approximation, flag it as one).
- **COMMISSION_ONLY**: no stable hourly figure -- skip this person, note it
  in the report as "commission-based, no hourly rate available."

Round every computed rate to 2 decimal places.

## STEP 4 — Write the Rates card

Build the new description for `RATES_CARD_ID` in exactly this format (reuse
the existing card's intro text, just replace the RATES block and the synced
timestamp):

```
Do not edit this card by hand -- it's meant to be kept in sync by a scheduled automation once QuickBooks is connected and the employee mapping is confirmed.

RATES:
<username>: <rate>
<username>: <rate>
...

---
Format: one line per person as "trellousername: rate".

Last synced: <current UTC ISO timestamp>
```

Update it via the Trello MCP `trelloWriteCard` tool, `action: "update"`,
`cardId` = `RATES_CARD_ID`, with the new `desc`. This is a normal card
description edit — no raw API key/token needed, unlike the custom-field
work in the other bridge template.

## STEP 5 — Report every write action

List: which usernames got a rate written (and the rate), which were
skipped and why (unmatched in QuickBooks, commission-only, contract data
missing), and confirm the card was updated with a link. If QuickBooks
wasn't reachable (Step 1), report only that and make no other changes.

## Suggested schedule

Pay rates don't change often — weekly (e.g. Monday mornings) is plenty.
Once `EMPLOYEE_MAP` is filled in and QuickBooks is connected, use the
"schedule" skill or `mcp__scheduled-tasks__create_scheduled_task` with this
file as the task prompt.
