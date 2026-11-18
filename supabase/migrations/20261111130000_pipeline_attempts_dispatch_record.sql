-- What a dispatch asked for.
--
-- axiom-encode's targeted re-encode workflow records each dispatch in a
-- "Record dispatch" job (axiom-encode/dispatch-record/v1). Its upload step
-- repeats the main fields in its name, which the jobs API returns, so the
-- collector reads them with the jobs request it already makes:
--
--   dispatch_record  { "kind": "promotion" | "repair" | "queue" | "adhoc",
--                      "open_pr": boolean,
--                      "pr_base_branch": text,
--                      "repair_run_id": text }
--
-- A field is null when the record leaves it out or marks it invalid. The
-- column is null for a run without that job (every run before the job
-- existed). The record says what the dispatch requested, not what the
-- workflow admitted.
--
-- Nullable and derived; scripts/collect-encoding-pipeline.mjs writes it only
-- once it exists, and the page reads rows without it.

alter table encodings.pipeline_attempts
  add column if not exists dispatch_record jsonb;
