-- How a merge's first tests on main went, not only when they finished.
--
-- tests_first_at (20261005120000) is when the module's validation shard
-- first finished at the merge commit. tests_first_started_at is when that
-- shard run started, so the wait for it splits from the run itself, and
-- tests_first_status is how it ended ("pass" or "fail"), which can differ
-- from the latest result in tests_status.
--
-- Nullable and derived; scripts/collect-encoding-pipeline.mjs writes them
-- only once they exist.

alter table encodings.pipeline_attempts
  add column if not exists tests_first_started_at  timestamptz,
  add column if not exists tests_first_status      text;
