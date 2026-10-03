-- Finer encoding pipeline stages for the /ops view.
--
-- Review: what holds a signed manifest PR (which checks failed, how many
-- were cancelled before finishing, whom a review is requested from).
-- Index sync: the merge commit, so a sync counts only when the commit it
-- read contains the merge. Correct: the module's jurisdiction validation on
-- the default branch (compile, companion tests, source-unit rules) at a
-- commit that contains the merge.
--
-- All columns are nullable and derived; scripts/collect-encoding-pipeline.mjs
-- writes them only once they exist, so the collector runs either side of
-- this migration.

alter table encodings.pipeline_attempts
  add column if not exists pr_failed_checks       text[],
  add column if not exists pr_cancelled_checks    integer,
  add column if not exists pr_requested_reviewers text[],
  add column if not exists pr_merge_commit        text,
  -- pass | fail | waived (an active known-validation-gaps waiver skips its tests)
  add column if not exists tests_status           text,
  add column if not exists tests_checked_at       timestamptz,
  add column if not exists tests_run_url          text;

-- Correct, beyond self-consistency: the axiom-oracles comparison report
-- covering the module, if any. match | explained (only dispositioned engine,
-- bridge, or residual differences) | disagree | stale (the report compared an
-- earlier version of the module).
alter table encodings.pipeline_attempts
  add column if not exists oracle_status      text,
  add column if not exists oracle_report      text,
  add column if not exists oracle_engine      text,
  add column if not exists oracle_checked_at  timestamptz;
