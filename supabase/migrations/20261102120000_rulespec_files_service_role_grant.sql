-- The sync script (scripts/sync-rulespec-index.mjs) writes
-- encodings.rulespec_files with the service role, which does not inherit
-- privileges on tables created by other roles in this schema. The grant
-- was applied by hand; this migration records it so a fresh environment
-- reproduces both index grants (rule_citations has its own in
-- 20260823130000_rule_citations.sql). Granting an existing privilege is a
-- no-op, so it is safe where the grant is already in place.

grant select, insert, update, delete on encodings.rulespec_files to service_role;
