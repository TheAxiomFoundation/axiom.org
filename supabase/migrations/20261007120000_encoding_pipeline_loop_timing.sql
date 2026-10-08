-- The encode loop's own clock, from the encoder's record.
--
-- From axiom-encode 0.2.2138 (axiom-encode#1802) each encodings.encoding_runs
-- row times its whole loop in outcome.encode_loop_timing: its start, its whole
-- time, and its time before the first try, between tries, and after the last
-- (they add up to the whole). Each entry of iterations also gains its start,
-- its whole time, and its phases in order with a check phase's time by tool;
-- those ride in the existing tries column. encode_loop keeps the loop's clock
-- so /ops can split the encode step into the tries and the time around them.
-- Older records keep it null and read as "not timed".
--
-- Nullable and derived; scripts/collect-encoding-pipeline.mjs rebuilds it
-- from the encoder records each pass and writes it only once it exists.

alter table encodings.pipeline_attempts
  add column if not exists encode_loop jsonb;
