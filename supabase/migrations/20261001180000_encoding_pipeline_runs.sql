-- How each dispatch's run went, for the /ops signing-approval and
-- cancellation views: who dispatched it, when its encode job started (it
-- waits for the production-signing approval first), how far a cancelled run
-- got, and when the jobs were read, so a run is looked up only once.
--
-- Nullable and derived; scripts/collect-encoding-pipeline.mjs writes them
-- only once they exist.

alter table encodings.pipeline_attempts
  add column if not exists dispatched_by      text,
  add column if not exists encode_started_at  timestamptz,
  -- approval (cancelled waiting for signing approval) | before_job (the
  -- encode job never existed) | running (cancelled mid-run)
  add column if not exists cancel_stage       text,
  add column if not exists jobs_checked_at    timestamptz;
