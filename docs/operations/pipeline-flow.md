# Pipeline flow: an event log and a zoomable graph of the encoding pipeline

Status: prototype (draft PR). Page: `/ops/flow`. Agent API: `/api/ops/flow`
(JSON) and `/api/ops/flow?format=md` (markdown).

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

## Event schema: `encodings.pipeline_events`

Migration: `supabase/migrations/20261021120000_pipeline_events.sql`.

| column | meaning |
|---|---|
| `id` | deterministic: `<case_id>/<station>/<kind>/<seq>`, so a rebuild upserts |
| `case_id` | the `pipeline_attempts.id` (a dispatch, `pr:` outside merge, or `dep:` module) |
| `citation`, `jurisdiction` | the case's unit of law |
| `station` | see above |
| `kind` | `enter`, `leave`, `fail`, `cancel`, `wait`, `issue` |
| `at`, `duration_ms` | when, and how long the station took (on `leave`/`fail`) |
| `outcome` | `ok`, `fail`, `cancelled`, `waived`, `pending`, `match`, ... |
| `try_no` | the encode-loop try (generate/validate/issue) |
| `rule_id` | a validator rule (`complete-source-unit:tests`) or `infra:<step>` |
| `message` | the issue text, cut to 500 characters |
| `actor` | the model on a try, the dispatcher, the reviewer |
| `cost_usd`, `encoder_version` | per try / per run |
| `source` | `pipeline_attempts`, `failure_bundle`, `local_ab`, `encoder` (live writer, later) |
| `ref_url` | the GitHub run, PR, check job or report the event comes from |
| `attrs` | anything else (phases' tool times, file, lane, model params) |

Indexes: `(station, at)`, `(citation, at)`, `(case_id)`, `(rule_id)`.
A second table, `encodings.pipeline_station_targets`, holds the targets the
alerts use (yield floor, p95 ceiling, WIP ceiling, SLA per station). Targets
are data, so Pavel can tune them without a deploy.

## Zoom model

The page is one graph canvas with a breadcrumb; each level is a graph, and a
click on a node goes one level deeper (URL parameters keep the place):

1. **Pipeline** (`/ops/flow`). Stations as nodes, laid out left to right by
   the directly-follows graph. Edge width = cases that moved; edge particles
   move faster with more throughput. Exit edges to `failed`/`cancelled`
   sinks are red. The encode loop (`generate ⇄ validate`) is a loop edge
   labelled with retries. A node shows yield (ring and colour), WIP, p50/p95
   time, and a weekly throughput sparkline. A window selector (7/30/90 days)
   and a jurisdiction filter re-mine the log.
2. **Station** (`?station=validate`). The failure modes the station raised
   (by rule id), and for `validate` the issue-transition graph across tries.
3. **Programs** (`?view=bundles`). Program → jurisdiction bundle → documents,
   coloured by encoding status from `program_bundle_documents`.
4. **Citation** (`?citation=us/statute/7/2014`). Every case of one citation
   over time as parallel lanes through the stations.
5. **Run** (`?case=<id>`). Each try: model, time, cost, the issues it hit,
   and links to the GitHub run, the PR and the failure bundle.

Library: **React Flow (`@xyflow/react`) with `dagre` layout**. Both are
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

Pure functions over events (`src/lib/axiom/pipeline-flow.ts`):

- **Directly-follows graph (DFG).** For each case, order its station events
  by time; count each `a → b` and the median wait between them.
- **Variants.** Each case's station path plus its end (`merged`, `failed at
  validate`, ...); top variants with share and median lead time.
- **Waiting hotspots.** Edges ranked by total waiting time (count × median).
- **Issue transitions.** For cases with two or more tries that carry rule
  ids, edges `rule at try n → rule at try n+1`, and `rule → passed`. Self
  loops mean the encoder did not fix the rule; long chains show the
  whack-a-mole pattern (deferral → tests → structure).
- **Co-occurrence.** Pairs of rule ids in the same try, by lift.
- **Looping citations.** Citations with many cases and no merge.

## Agent interface

`GET /api/ops/flow` returns JSON: stations (with stats and targets),
edges, alerts, top failure modes, issue transitions, looping citations, and
links. `GET /api/ops/flow?format=md` returns the same as a short markdown
brief for an agent prompt ("read this before you dispatch"). Both take
`window` (days) and `j` (jurisdiction). Both are read-only and need no key,
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
