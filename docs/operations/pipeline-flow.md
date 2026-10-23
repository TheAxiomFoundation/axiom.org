# Pipeline flow: an event log and a zoomable graph of the encoding pipeline

Status: prototype (draft PR). Pages: the `/ops` tabs (Now, Line,
Programs) and the `/ops/journey` drill-down; `/ops/flow` redirects to the
Line tab. Agent API: `/api/ops/flow` (JSON) and `/api/ops/flow?format=md`
(markdown).

## Where it lives: one /ops page

`/ops` is one page with three tabs, each its own page load that reads only
its data. The accepted-modules counts are not on the page: they are in
`/api/ops/flow?accepted`, which the roadmap flow model reads.

| tab | question | built from |
|---|---|---|
| Now (`/ops`) | What runs now, and what runs next? | the fleet box, the workflows strip, the run ledger, the queues and recent ingests |
| Line (`?tab=line`) | Where do cases wait, fail or loop? | the station diagram and panel, alerts, reason sources, station trends, and the "Loops and rules" view (`&view=discovery`) |
| Programs (`?tab=programs`) | How far is each program? | the bundle grid first (or a bundle's page, `&bundle=`), then the programs map, then validation waivers |

One drill-down: `/ops/journey?citation=<path>` (and `&case=<id>` for one
run) draws a citation's cases from the event log, derived from
`pipeline_attempts` until `encodings.pipeline_events` is live;
`/api/ops/flow?citation=` serves the same lanes as JSON.

Old addresses keep working: `?tab=ledger`, `?tab=pipeline` and
`?tab=bundles` redirect to Now, Line and Programs, and the retired
`?tab=output` to Now; `/ops/flow` redirects
to the Line tab (a citation or run to the journey, the programs view to
Programs); `/axiom/ops` redirects to `/ops`; `/ops/bundles/<id>` opens the
bundle on the Programs tab.

## Why

`encodings.pipeline_attempts` holds one wide row per encoding: a column per
stage it reached. That shape answers "where is this run now", but not "how
does work move through the factory": the order of stations, the time between
them, the loops, and which failure follows which. Those questions need an
**event log**: one row per thing that happened to one case at one station.
With an event log, the stations, edges, counts, rates, times and colours of
the graph all come from data; a new station is a new value, not new code.

Two uses:

1. **Factory monitor.** Every station with throughput, work in progress (WIP),
   yield, time at the station (p50/p95) and the errors it raises, with
   alerts the moment a station misses its target.
2. **Process discovery for agents.** Mine the log for systematic problems:
   the common paths (variants), where work waits, which validator rules
   follow each other across tries (the "whack-a-mole" loop), and which
   failure modes come together. Agents read a short summary before they
   dispatch.

## Stations

A station is a value in `pipeline_events.station`. The backfill and the
collector emit these today, in pipeline order:

| station | what happens | from |
|---|---|---|
| `dispatch` | a targeted re-encode run is queued | `dispatched_at` |
| `approval` | the `production-signing` environment waits for a human | `started_at` → `encode_started_at`, `cancel_stage=approval` |
| `setup` | checkouts, corpus fetch, identity checks | `setup_seconds`, `failed_step` (workflow steps) |
| `generate` | the model writes a candidate (one event per try) | `tries[].phases.model_call` |
| `validate` | checks judge the candidate (one event per try, issues attached) | `tries[].phases.*validation`, `tries[].error`, failure bundles |
| `publish` | package, sign, open the manifest PR | `publish_seconds`, `pr_created_at` |
| `pr_checks` | CI on the manifest PR | `pr_checks`, `pr_failed_checks`, `pr_check_error` |
| `review` | review and merge decision | `pr_review`, `pr_requested_reviewers` |
| `merge` | merged into the default branch (or a side branch, then its PR) | `pr_merged_at`, `pr_via_*` |
| `index` | the `rulespec_files` sync picks the module up | `indexed_at`, `index_status` |
| `compile` | axiom-api's nightly compile sweep | `compile_checked_at`, `compile_status` |
| `tests` | the jurisdiction's validation on main | `tests_first_*`, `tests_status` |
| `oracle` | the axiom-oracles comparison | `oracle_checked_at`, `oracle_status` |

Upstream stations (`corpus_ingest`, `release_publish`, `release_activate`,
`target_gate`) are part of the schema but have no backfill source yet: the
corpus release workflows do not record per-document events. The graph shows
them as soon as rows exist. Until then the page shows those workflows' state
from the workflow health read (`src/lib/axiom/workflow-health.ts`).

Display names and one-line descriptions of stations are copy (in
`pipeline-flow.ts`), not data: an unknown station still renders, with its id
as its name.

## Accepted modules

The flow model in axiom-roadmap-dashboard (#233) runs on one number:
**accepted modules per week**. This page is its measured source, and the
monthly ramp report reads it from here. Pavel agreed the definition below on
2026-10-22. Code: `src/lib/axiom/accepted-modules.ts` (`moduleLedger`,
`acceptedSeries`).

### Definition

A **module** is one RuleSpec file, keyed by `<repo>:<path>`. Every module
merged into a default branch lands in exactly one of three groups, by the
checks on main as they stand now:

- **Accepted** (the headline). All four hold:
  1. **Merged** into the default branch: `mainMergedAt` is set (a merge into
     a side branch counts only once that branch's own PR merged).
  2. **Compiles**: axiom-api's compile sweep reports `compile_status = ok`.
  3. **Passes tests**: the jurisdiction's validation on main reports
     `tests_status = pass`.
  4. **No active waiver**: the module is not in the repo's
     `known-validation-gaps.yaml` with an `active` waiver.
- **Not accepted**: a check gave a verdict against it: the compile failed or
  was `skipped` (the sweep skips a waived module), the tests failed, or the
  tests are `waived`.
- **Not measured**: no verdict against it, but a result is missing: no
  compile result (the repo is not in the `rulespec_files` index, as
  rulespec-de and rulespec-dk are today, or the sweep has not reached it
  yet) or no test result. An unknown result is not a failure: it is not
  counted as accepted, and not as a failure. The count of modules not
  measured sits beside the accepted count, per week (the week of the module's
  latest merge) with the same route and program split, and by repo, so the
  gap stays visible; indexing rulespec-de and rulespec-dk brings it toward
  zero.

An accepted module counts **once**, in the ISO week (Monday, UTC) of the
first merge that made it accepted. Every later merge of the same file is
**rework**: it uses capacity but adds no module, so it is counted
separately, in the week of that merge, whatever its own checks say. A
module never accepted is grouped by the checks on its latest merge.

The checks are read as they stand now, so a module that later fails a
sweep or its tests, or gets a waiver, leaves the headline (its week
included) until it passes again.

### Route and sub-route

Each module carries the route of its merge, and a sub-route:

- **pipeline**: the encoder wrote it. Sub-routes:
  - **dispatch**: a targeted re-encode run;
  - **dep**: a `dep:` row, a module the encoder wrote inside another
    citation's run.
- **hand**: a `pr:<repo>#<n>:<path>` row, a PR merged into the default
  branch with no dispatch behind it.

Every count has the form `{pipeline, dispatch, dep, hand}`, where
`pipeline = dispatch + dep`, so the headline can show the pipeline whole or
split. The route comes from the case id today (`attemptSource`). When axiom-encode #1750 lands, the GitHub Actions run id on each
encoder record replaces the time-window join for the pipeline route.

### Program

Each case carries `attrs.programs` on its events: the programs (`snap`,
`medicaid`, `chip`, `tanf`, ...) whose in-scope `program_bundle_documents`
sit at the case's citation or a path above it, in any jurisdiction's layer.
The program is the part of the bundle id after the slash (`us-or/snap` →
`snap`). A citation that no bundle holds is `["out_of_plan"]` (tariff and
customs rules, Canadian and other non-US modules): it stays in the counts,
in its own row. A module in several programs' bundles (a federal tax
provision sits in `ctc`, `eitc` and `income_tax`) counts in each program
and once in the total, so program rows can sum to more than the total.

- **Backfill**: `scripts/backfill-pipeline-events.mjs` tags every case
  (skip with `--no-programs`).
- **Request time**: events derived from `pipeline_attempts` (while the
  events table is not live) carry no tag; `/api/ops/flow` looks up the
  accepted modules' citations in the bundle tables. If that lookup returns
  nothing, they read `untagged`, not out of plan.
- **New runs**: the program should come from axiom-encode itself, on its
  encoder record, so a run carries it from dispatch (follow-up).

### API

`GET /api/ops/flow?accepted` returns only the accepted series:

- `accepted.definition`: the definition as text.
- `accepted.weeks[]`: every week from the first accepted or not-measured
  module to now, empty weeks included. Each has `total` (new accepted
  modules), `programs` (the same, by program), `rework`, `not_measured` and
  `not_measured_programs`.
- `accepted.totals`: `total`, `programs`, `rework`, `not_measured`,
  `not_measured_programs`, `not_measured_by_repo` and `not_accepted`.
- `accepted.programs`: plan programs first, then `out_of_plan`, `untagged`.
- `accepted.modules`: the ledger itself, `accepted[]`, `rework[]`,
  `not_measured[]` and `not_accepted[]`, each entry with its `status`
  (`accepted`, `rework`, `not_measured`, `not_accepted`), module, case,
  route, sub-route, programs, time and week.

Only `?accepted` runs the program lookup. The full `GET /api/ops/flow`
carries the cached headline series as `accepted` (totals, weeks, routes,
not measured, rework; programs read `untagged` until the backfill tags the
events), and the markdown brief ends with its summary and a pointer to
`?accepted` for programs; the API reads that series from a cache kept for
ten minutes (`getAcceptedHeadline`). The page does not show them. The `window`, `j` and `pop` parameters do not narrow them:
they are the whole history.

### Counts when the definition was agreed

From `encodings.pipeline_attempts` on 2026-10-22 (2,233 rows: 1,352
dispatches, 44 `dep:`, 837 hand-merged module files). Distinct modules:

| week of | accepted: dispatch | dep | hand | of hand: `us/policies/usitc` | rework (hand) |
|---|---:|---:|---:|---:|---:|
| 2026-07-20 | 1 | 0 | 17 | | 9 |
| 2026-07-27 | 0 | 0 | 94 | 85 | 5 |
| 2026-08-17 | 0 | 0 | 3 | | 2 |
| 2026-09-07 | 1 | 0 | 9 | | |
| 2026-09-14 | 1 | 0 | 0 | | |
| 2026-09-21 | 0 | 0 | 2 | | |
| 2026-09-28 | 1 | 0 | 1 | | |
| 2026-10-12 | 0 | 0 | 1 | | |
| **total** | **4** | **0** | **127** | | **16** |

Beside the headline:

- **Not measured**: 55 modules (15 dispatch, 40 hand): rulespec-de 17,
  rulespec-dk 14, rulespec-us 9, rulespec-zm 8, rulespec-ug 4, and one each
  in rulespec-rw, rulespec-et and rulespec-ng. The draft's "26 files in
  rulespec-de (7) and rulespec-dk (19)" counted dispatch module rows; this
  counts distinct modules over every route, so hand merges in those repos
  are in it too. 24 of the 55 are in indexed repos with no sweep or test
  result yet, so indexing rulespec-de and rulespec-dk leaves those.
- **Not accepted**: 524 modules (1 dispatch, 523 hand). Most hand-merged
  modules are merged under an active waiver. The one dispatch module passes
  its tests but fails to compile (`exec_error`).

No `dep:` module has merged on its own row yet: a module the encoder wrote
inside another run reaches main in its host run's PR, so it counts there
as dispatch until the encoder records which modules a PR carries.

The four pipeline modules:
`ca/policies/cra/td1-2026/provincial-territorial-personal-credits.yaml`
(rulespec-ca#21), `us/statutes/7/2015/f.yaml` (rulespec-us#1347),
`us/policies/irs/rev-proc-2025-32/page-15.yaml` (rulespec-us#1366),
`us-az/policies/des/faa5/na-categorical-eligibility/basic-categorical-eligibility.yaml`
(rulespec-us#1448). #233 reports 3; the difference is the rulespec-ca
module, which no plan program covers (`out_of_plan`).

By program, the 131 accepted modules (pipeline + hand): `out_of_plan`
1 + 121, `snap` 2 + 1, `income_tax` 1 + 5, `ctc` 1 + 0, `eitc` 1 + 0.

## Event schema: `encodings.pipeline_events`

Migration: `supabase/migrations/20261021120000_pipeline_events.sql`.

| column | meaning |
|---|---|
| `id` | deterministic: `<case_id>/<station>/<kind>/<seq>`, so a rebuild upserts |
| `case_id` | the `pipeline_attempts.id` (a dispatch, `pr:` outside merge, or `dep:` module) |
| `citation`, `jurisdiction` | the case's unit of law |
| `station` | see above |
| `kind` | `enter`, `leave`, `fail`, `cancel`, `wait`, `issue`, and `change` (a merged encoder PR that names a rule) |
| `at`, `duration_ms` | when, and how long the station took (on `leave`/`fail`) |
| `outcome` | `ok`, `fail`, `cancelled`, `waived`, `pending`, `match`, ... |
| `try_no` | the encode-loop try (generate/validate/issue) |
| `rule_id` | a validator rule (`complete-source-unit:tests`) or `infra:<step>` |
| `message` | the issue text, cut to 500 characters |
| `actor` | the model on a try, the dispatcher, the reviewer |
| `cost_usd`, `encoder_version` | per try / per run |
| `source` | `pipeline_attempts`, `failure_bundle`, `local_ab`, `waiver_ledger`, `encoder_change`, `encoder` (live writer, later) |
| `ref_url` | the GitHub run, PR, check job or report the event comes from |
| `attrs` | anything else (phases' tool times, file, lane, model params) |

Indexes: `(station, at)`, `(citation, at)`, `(case_id)`, `(rule_id)`.
A second table, `encodings.pipeline_station_targets`, holds the targets the
alerts use (yield floor, p95 ceiling, WIP ceiling, SLA per station). Targets
are data, so Pavel can tune them without a deploy.

## Zoom model

Each level is a graph, and a click on a node goes one level deeper (URL
parameters keep the place):

1. **Pipeline** (`/ops?tab=line`). Stations as boxes on a serpentine line, as
   many per row as the canvas shows at a readable zoom. Edge width = cases;
   particles move faster with more throughput. Edges are routed so none
   crosses a box: neighbours on a row meet side to side, a skip or a step
   back on a row (the encode loop's retries) arcs through the aisle under
   the row from the boxes' inner quarters, adjacent rows meet through the
   aisle between them, and an edge that would cross a whole row is a note
   on its station. Exits are lines too, routed around every box: down
   from the box into the aisle under its row (below that row's arcs), right
   to a gutter beside the floor, down, and left into the Failed (red) or
   Cancelled (grey, dashed) sink under the floor; width = cases. Each box
   also shows a red bar for the share of its cases that left there, the
   count and the top reason (hover for the system that reported it), and
   the stations with the biggest share of all exits glow red. A window selector (7/30/90 days) and a jurisdiction filter
   re-mine the log. The line counts every case: dispatched runs, PRs
   merged without a run and modules inside another run, which start at
   different stations (Dispatch, PR checks, Generate). The page has no
   filter by kind; the API still takes `pop`.
2. **Station** (`?station=validate`). Opens beside the diagram: targets, the
   week's trend, every failure the station raised (also the tries a later
   try recovered) and the oldest open items.
3. **Programs** (`/ops?tab=programs`). Program → jurisdiction bundle →
   documents, coloured by encoding status from `program_bundle_documents`.
4. **Citation** (`/ops/journey?citation=us/statute/7/2014`). Every case of
   one citation over time as parallel lanes through the stations, the
   line's own cases first.
5. **Run** (`/ops/journey?citation=…&case=<id>`). Each try: model, time, cost, the issues it hit,
   and links to the GitHub run, the PR and the failure bundle.

Library: **React Flow (`@xyflow/react`)** with positions computed in
`flow-layout.ts`. Both are
already dependencies (the rule graph viewer uses them), so the PR adds no
package. React Flow renders nodes as DOM (good text, focus and screen-reader
support, custom React nodes) and edges as SVG; with
`onlyRenderVisibleElements` it keeps a few thousand elements smooth. Each
zoom level is bounded (13 stations, ≤ ~200 documents per bundle, ≤ ~100
cases per citation), so no level needs WebGL. Sigma/WebGL would only pay off
for an un-aggregated view of all ~30,000 events, which is not a useful
picture. elkjs gives better orthogonal routing but adds a 1.4 MB worker for
little gain on a 13-node DAG.

## Process discovery

Every block on the page answers one question and starts with a one-sentence
answer; its numbers are the evidence and link to the runs behind them. Pure
functions over events (`src/lib/axiom/pipeline-flow.ts`):

- **Did our fixes work?** For the rules the encoder does not fix: the share of
  runs with try records whose tries hit the rule, per week; whether the same
  citation still hits it when run again a week or more later (controls for the
  changing mix of citations); and merged axiom-encode PRs that name the rule
  (`change` events, source `encoder_change`, written by the backfill).
- **What follows a fix?** Pairs where fixing rule X makes rule Y appear in the
  next try at 2× or more its usual rate (10 tries or more): the whack-a-mole
  loop.
- **Which rules does another try not fix?** Failed tries times the share of
  next tries that fail the same rule again, cases that still recovered, and
  the try from which retries stop paying (under 5% pass).
- **Which citations to stop dispatching?** Citations with 4 or more runs in
  the window and no merge, with their failures and recorded cost.
- **Is each station getting better or worse?** The last 7 days against the 7
  before: finished visits and yield.
- **How much can these numbers see?** Share of dispatches with per-try
  records, cost and full issue lists; stations that are not timed.

Station order and the encode loop come from the directly-follows graph (a
depth-first walk marks back edges as loops).

## Agent interface

`GET /api/ops/flow` returns JSON: stations (with stats and targets),
edges, alerts, top failure modes, issue transitions, looping citations, and
links. `GET /api/ops/flow?format=md` returns the same as a short markdown
brief for an agent prompt ("read this before you dispatch"). Both take
`window` (days), `j` (jurisdiction) and `pop` (population). The brief
opens with where cases leave the line and why, each reason tagged with the
system that reported it. Both are read-only and need no key,
like the rest of `/ops`.

## Alert rules

Computed at read time from events, targets and the workflow health read.
Each alert has a severity, a station, a one-line reason and links:

| rule | fires when |
|---|---|
| `yield_below_target` | a station's yield in the window is under its floor |
| `p95_over_target` | a station's p95 time is over its ceiling |
| `wip_over_target` | open cases at a station exceed the ceiling |
| `case_over_sla` | a case sits at a station longer than the station SLA |
| `workflow_red` | a watched workflow (release activation, publish, signer, collector) is failing |
| `deadline_near` | a dated item is within 90 days (waiver expiry, bundle retention) |
| `rule_spike` | a validator rule's share of failures in the last 7 days is 2× its share before |
| `looping_citation` | a citation has ≥ 4 cases in the window and none merged |

Deadlines come from data where it exists: the oldest failure-bundle expiry
(90 days after the run) from `pipeline_events` with `source=failure_bundle`,
and waiver expiry from the RuleSpec repos' `known-validation-gaps.yaml`
(the backfill writes one `waiver_ledger` event per active waiver).

## Telemetry: add

1. **Every issue of every try** (not the first one only): the encoder writes
   `issue` events, or `tries[].issues` per axiom-encode #1660. The backfill
   loads them from failure bundles and local A/B runs for now.
2. **GitHub run id and live phase** in encoder records (axiom-encode #1750):
   exact joins instead of citation + time windows; live `generate`/
   `validate` WIP.
3. **Document type and program** on each case (from the corpus path and
   bundle membership), so yield splits by statute / regulation / manual.
   Program: done in the backfill and at request time (see "Accepted
   modules"); still to do in axiom-encode's own records for new runs, and
   the document type.
4. **PR block reason** (`pin_mismatch`, `check_failed:<rule>`,
   `awaiting_review`, `superseded`) as a `wait` event at `review`.
5. **Local and A/B runs** with `source=local_ab` and `attrs.experiment`.
6. **Rule id for infra failures**: `infra:<workflow step>` so they group.
7. **Archive failure bundles** before the 90-day expiry (Aug bundles go from
   2026-11-02); the backfill keeps their issues as events.
8. **Corpus stations**: publish/activate workflows emit `release_*` events.

## Telemetry: remove or stop reading

Measured on 2026-10-21 over 2,231 `pipeline_attempts` rows:

- `encodings.live_encoding_runs.phase`: null in 100% of rows. Fill it
  (#1750) or drop it.
- `encoding_runs.final_scores`, `oracle_*`, `actual_cost_usd`: 100% null.
  Drop or fill.
- `pipeline_attempts.pr_requested_reviewers` (99.8% null), `pr_via_*`
  (99.6–99.8% null): keep, but the event log carries them as `wait` events,
  so the wide row need not grow further.
- Stop adding stage columns to `pipeline_attempts`; add stations as events.
