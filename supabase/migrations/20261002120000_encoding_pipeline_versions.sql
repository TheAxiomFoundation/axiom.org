-- Which encoder ran each dispatch, and why a PR's own checks fail.
--
-- encoder_sha is the axiom-encode commit the dispatch ran (the workflow run's
-- head commit) and encoder_version the package version at that commit, so
-- success can be compared across encoder releases. pr_check_error is the
-- message a failing PR check printed before it failed, read from the job
-- log, and pr_check_job_id the job it was read from, so a new CI run is read
-- again.
--
-- All columns are nullable and derived; scripts/collect-encoding-pipeline.mjs
-- writes them only once they exist, so the collector runs either side of
-- this migration.

alter table encodings.pipeline_attempts
  add column if not exists encoder_sha      text,
  add column if not exists encoder_version  text,
  add column if not exists pr_check_error   text,
  add column if not exists pr_check_job_id  bigint;
