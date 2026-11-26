-- How an encode ended, and why a dispatched run has no try record.
--
-- encodings.live_encoding_runs holds one row per `axiom-encode encode`
-- invocation. From axiom-encode #1750 a row written inside GitHub Actions
-- names its run (runner.github_run_id, runner.github_run_attempt) and its
-- phase (resolve | generate | validate | review | apply). The encoder's
-- finish now also says how the encode ended:
--
--   outcome_status  the encode outcome status (standalone_validated,
--                   standalone_failed, apply_applied, apply_blocked_generation,
--                   apply_blocked_validation, apply_blocked_manifest), or how
--                   the process left: aborted (an exception), exited (a
--                   SystemExit before a run was logged), interrupted.
--                   At most 64 characters of [A-Za-z0-9_.:/-].
--   error_rule      a typed identifier, never free text: exception:<ClassName>,
--                   exit:<code>, exit:message, or a validator check id.
--                   At most 160 characters of the same set.
--
-- Both are null for a row that is still running, for rows written before the
-- encoder sent them, and when the finish carried none. The public ingest
-- route (src/app/api/ops/encoding/ingest) bounds them; it writes a finish
-- without them while the columns do not exist.
--
-- scripts/collect-encoding-pipeline.mjs copies them, with the row's last
-- phase, onto the dispatch whose encode step ran and left no encoder record
-- (joined on runner.github_run_id), so /ops/flow can say why the run stopped:
--
--   encode_exit_status  the live row's outcome_status
--   encode_exit_rule    the live row's error_rule
--   encode_last_phase   the live row's last phase
--
-- All null for a run with an encoder record, a run whose encode step did not
-- run, and a run with no live row that names it (every run before #1750).
--
-- Nullable and derived; the collector writes them only once they exist, and
-- the page reads rows without them.

alter table encodings.live_encoding_runs
  add column if not exists outcome_status text,
  add column if not exists error_rule text;

alter table encodings.pipeline_attempts
  add column if not exists encode_exit_status text,
  add column if not exists encode_exit_rule text,
  add column if not exists encode_last_phase text;
