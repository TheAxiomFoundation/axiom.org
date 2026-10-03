-- End-to-end encoding pipeline index for the /ops dashboard.
--
-- One row per targeted re-encode dispatch (a GitHub Actions run of
-- axiom-encode's targeted-signed-reencode.yml), followed through every
-- downstream stage it reaches: the encoder's own outcome, the signed
-- manifest PR in a rulespec-* repo, the merge, the rulespec_files sync,
-- and the nightly compile sweep. scripts/collect-encoding-pipeline.mjs
-- rebuilds the rows from GitHub and Supabase on a schedule; nothing else
-- writes here, so every column is derived and safe to recompute.
--
-- The stage a row sits in is derived in the app (src/lib/axiom/ops-pipeline)
-- from these timestamps and states, not stored, so a new stage rule never
-- needs a backfill.

create table if not exists encodings.pipeline_attempts (
  -- GitHub Actions run id of the dispatch.
  id                   text primary key,
  citation             text not null,
  jurisdiction         text,
  -- The run name's "[queue:item:sha]" tag; "adhoc:adhoc:adhoc" for manual runs.
  queue_ref            text,
  run_url              text not null,
  run_attempt          integer,
  dispatched_at        timestamptz not null,
  started_at           timestamptz,
  finished_at          timestamptz,
  -- queued | in_progress | completed (GitHub's run status).
  run_status           text not null,
  -- success | failure | cancelled | skipped | timed_out | ... (null until completed).
  run_conclusion       text,
  -- The first failed step when the run failed: the diagnostics bundle's
  -- step id (encode_apply, ...) or else the workflow step's name.
  failed_step          text,
  -- Where the failure detail came from: encoder_run (encodings.encoding_runs),
  -- diagnostics (the run's targeted-reencode-failure artifact), jobs (the
  -- Actions jobs API only). Null until looked up; set rows are not refetched,
  -- so reasons survive the artifacts' 90-day expiry.
  failure_source       text,

  -- The encoder's own record (encodings.encoding_runs) for this dispatch.
  encoder_run_id       text,
  encoder_status       text,
  -- First validator issue or apply error, from the encoder record or the
  -- diagnostics bundle.
  encoder_error        text,
  -- Bracketed validator rule of that issue, e.g. complete-source-unit:structure.
  encoder_error_rule   text,
  generation_attempts  integer,
  cost_usd             numeric,

  -- The signed manifest PR the dispatch opened, if any.
  pr_repo              text,
  pr_number            integer,
  pr_url               text,
  -- draft | open | merged | closed
  pr_state             text,
  pr_base_branch       text,
  pr_targets_default   boolean,
  pr_created_at        timestamptz,
  pr_merged_at         timestamptz,
  pr_closed_at         timestamptz,
  -- success | failure | pending | none (the head commit's check rollup).
  pr_checks            text,
  -- approved | changes_requested | review_required | none
  pr_review            text,
  -- RuleSpec module files the PR adds or changes (repo-relative paths).
  module_paths         text[] not null default '{}',

  -- When a sync that ran after the merge first showed every merged module
  -- in encodings.rulespec_files.
  synced_at            timestamptz,
  -- indexed | missing (a post-merge sync ran but some module is not in the
  -- index, e.g. an experimental repo) | null (no sync since the merge).
  index_status         text,
  -- ok | compile_error | exec_error | closure_error | skipped (null = not checked).
  compile_status       text,
  compile_checked_at   timestamptz,
  compile_error        text,

  collected_at         timestamptz not null default now()
);

create index if not exists pipeline_attempts_citation_idx
  on encodings.pipeline_attempts (citation, dispatched_at desc);
create index if not exists pipeline_attempts_dispatched_idx
  on encodings.pipeline_attempts (dispatched_at desc);

alter table encodings.pipeline_attempts enable row level security;

drop policy if exists "pipeline_attempts are publicly readable"
  on encodings.pipeline_attempts;
create policy "pipeline_attempts are publicly readable"
  on encodings.pipeline_attempts for select using (true);

grant select on encodings.pipeline_attempts to anon, authenticated;
grant select, insert, update, delete on encodings.pipeline_attempts to service_role;

-- Which commit of each rulespec repo a rulespec_files row was read from, so a
-- merge can be matched to the sync that picked it up.
alter table encodings.rulespec_files
  add column if not exists commit_sha text;
