-- Each try of a dispatch's encode loop, from the encoder's own record.
--
-- encodings.encoding_runs.iterations holds one entry per generation attempt
-- (model, time, tokens, cost, the errors that sent it back). tries keeps
-- what /ops shows of each: attempt, model, the model's own milliseconds,
-- estimated cost, whether its candidate passed, and the first error. Runs
-- with no encoder record keep it null.
--
-- Nullable and derived; scripts/collect-encoding-pipeline.mjs rebuilds it
-- from the encoder records each pass and writes it only once it exists.

alter table encodings.pipeline_attempts
  add column if not exists tries jsonb;
