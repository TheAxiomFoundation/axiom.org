-- What a re-encode asked for: the dispatch inputs of a run of a citation
-- that had already merged (src/lib/axiom/encoding-pipeline-collect.ts,
-- dispatchInputLookups).
--
-- dispatch_inputs holds { replace_path, review_finding, repair_run_id,
-- read_at }: the existing RuleSpec file the run replaces, the finding it
-- was dispatched to address, and the failed run it repairs, as the encode
-- job's log prints them (the workflow run API does not return inputs). A
-- run's inputs never change, so each is read once and carried. Null for a
-- run that is not a re-encode, or not read yet.
--
-- Nullable and derived; scripts/collect-encoding-pipeline.mjs writes it only
-- once it exists, and reads the inputs only then.

alter table encodings.pipeline_attempts
  add column if not exists dispatch_inputs jsonb;
