-- How long each part of a dispatch took, and when its merge first reached
-- the index and the tests on main.
--
-- setup_seconds, encode_seconds, and publish_seconds split the encode job at
-- its "Encode, review, validate, and apply" step: the checkouts, builds, and
-- input checks before it; the step itself (generation, validation, repair,
-- review); and the packaging, signing, and draft PR after it. steps_read_at
-- marks a run whose steps were read, so one that never reached a step is not
-- read again.
--
-- indexed_at is when the first successful index sync that started after the
-- merge finished, and tests_first_at when the module's validation shard first
-- finished at the merge commit on the default branch. Until now only a later
-- sync (synced_at) and the latest validation run (tests_checked_at) were kept.
--
-- All columns are nullable and derived; scripts/collect-encoding-pipeline.mjs
-- writes them only once they exist, so the collector runs either side of
-- this migration.

alter table encodings.pipeline_attempts
  add column if not exists setup_seconds    integer,
  add column if not exists encode_seconds   integer,
  add column if not exists publish_seconds  integer,
  add column if not exists steps_read_at    timestamptz,
  add column if not exists indexed_at       timestamptz,
  add column if not exists tests_first_at   timestamptz;
