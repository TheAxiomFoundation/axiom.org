-- Event log of the encoding pipeline, for /ops/flow and agents.
--
-- One row per thing that happened to one case at one station: a dispatch
-- queued, the signing approval waited, a try of the encode loop generated a
-- candidate, a validator issue, the PR's checks, the merge, the index, the
-- compile sweep, the tests on main, the oracle comparison. A case is a row of
-- encodings.pipeline_attempts (its id), so every event joins back to it.
--
-- scripts/backfill-pipeline-events.mjs rebuilds the rows derived from
-- pipeline_attempts (source = 'pipeline_attempts') and loads issues from
-- archived failure bundles and local A/B runs ('failure_bundle',
-- 'local_ab') and the RuleSpec repos' validation waivers with their expiry
-- ('waiver_ledger'). Ids are deterministic, so a rebuild upserts. Live writers
-- (the encoder, the corpus release workflows) add their own sources later.
--
-- The stations, edges, counts, rates and colours on /ops/flow are all
-- computed from these rows (src/lib/axiom/pipeline-flow.ts); a new station is
-- a new value here, not new code.

create table if not exists encodings.pipeline_events (
  -- <case_id>/<station>/<kind>/<seq>: stable across rebuilds.
  id              text primary key,
  case_id         text not null,
  citation        text not null,
  jurisdiction    text,
  -- dispatch | approval | setup | generate | validate | publish | pr_checks |
  -- review | merge | index | compile | tests | oracle, and upstream
  -- corpus_ingest | release_publish | release_activate | target_gate.
  station         text not null,
  -- enter | leave | fail | cancel | wait | issue
  kind            text not null,
  at              timestamptz not null,
  -- How long the station took, on leave / fail / cancel.
  duration_ms     bigint,
  -- ok | fail | cancelled | waived | pending | match | explained | disagree | ...
  outcome         text,
  -- The encode-loop try, for generate / validate / issue events.
  try_no          integer,
  -- A validator rule (complete-source-unit:tests) or infra:<workflow step>.
  rule_id         text,
  -- Issue or error text, cut to 500 characters.
  message         text,
  -- The model of a try, who dispatched, who reviewed.
  actor           text,
  cost_usd        numeric,
  encoder_version text,
  -- pipeline_attempts | failure_bundle | local_ab | encoder | waiver_ledger
  source          text not null,
  -- The GitHub run, PR, check job or report the event comes from.
  ref_url         text,
  attrs           jsonb not null default '{}',
  collected_at    timestamptz not null default now(),
  constraint pipeline_events_kind_check
    check (kind in ('enter', 'leave', 'fail', 'cancel', 'wait', 'issue'))
);

create index if not exists pipeline_events_station_idx
  on encodings.pipeline_events (station, at desc);
create index if not exists pipeline_events_citation_idx
  on encodings.pipeline_events (citation, at desc);
create index if not exists pipeline_events_case_idx
  on encodings.pipeline_events (case_id, at);
create index if not exists pipeline_events_rule_idx
  on encodings.pipeline_events (rule_id, at desc) where rule_id is not null;

alter table encodings.pipeline_events enable row level security;

drop policy if exists "pipeline_events are publicly readable"
  on encodings.pipeline_events;
create policy "pipeline_events are publicly readable"
  on encodings.pipeline_events for select using (true);

grant select on encodings.pipeline_events to anon, authenticated;
grant select, insert, update, delete on encodings.pipeline_events to service_role;

-- What each station should do, for the alerts on /ops/flow and in the agent
-- brief. Null means "no target". Tune here; no deploy needed.
create table if not exists encodings.pipeline_station_targets (
  station         text primary key,
  -- Share of cases that leave the station ok, 0..1.
  min_yield       numeric,
  -- p95 time at the station, in hours.
  max_p95_hours   numeric,
  -- Open cases at the station.
  max_wip         integer,
  -- A single case at the station longer than this is over its SLA, in hours.
  sla_hours       numeric,
  note            text,
  updated_at      timestamptz not null default now()
);

alter table encodings.pipeline_station_targets enable row level security;

drop policy if exists "pipeline_station_targets are publicly readable"
  on encodings.pipeline_station_targets;
create policy "pipeline_station_targets are publicly readable"
  on encodings.pipeline_station_targets for select using (true);

grant select on encodings.pipeline_station_targets to anon, authenticated;
grant select, insert, update, delete on encodings.pipeline_station_targets to service_role;

-- Starting targets: the "stuck after" times /ops already uses
-- (STAGE_COPY in src/lib/axiom/encoding-pipeline.ts) and floors near the
-- last 90 days' yields, so an alert means "worse than usual".
insert into encodings.pipeline_station_targets (station, min_yield, max_p95_hours, max_wip, sla_hours, note) values
  ('approval',  0.90, 12,   20, 24,  'production-signing approval wait'),
  ('setup',     0.90, 0.5,  null, 2, 'checkouts, corpus fetch, identity checks'),
  ('validate',  0.30, 1,    null, 3, 'encode loop: share of tries that pass'),
  ('publish',   0.95, 0.5,  null, 2, 'sign and open the manifest PR'),
  ('pr_checks', 0.80, 6,    50,  72, 'manifest PR checks'),
  ('review',    0.50, 72,   100, 72, 'review and merge'),
  ('index',     0.95, 8,    null, 8, 'rulespec_files sync after merge'),
  ('compile',   0.95, 36,   null, 36, 'axiom-api nightly compile sweep'),
  ('tests',     0.90, 36,   null, 36, 'jurisdiction validation on main')
on conflict (station) do nothing;
