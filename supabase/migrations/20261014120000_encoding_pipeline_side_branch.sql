-- A merge into a side branch, followed to the default branch, and the page
-- of a merge's first tests on main.
--
-- A signed manifest PR that merged into a branch other than its repo's
-- default (pr_targets_default false) reaches the default branch only through
-- that branch's own PR (head = the side branch, base = the default branch).
-- pr_via_* name that PR: its number, page and state (draft | open | merged |
-- closed), and, once it merged, when and at which merge commit. From then on
-- the attempt counts as merged into the default branch there: its index,
-- tests and oracle stages match pr_via_merge_commit and pr_via_merged_at.
-- pr_base_branch, pr_merged_at and pr_merge_commit stay the manifest PR's own.
--
-- tests_first_run_url is the page of the first validation shard run at the
-- merge commit, the run tests_first_at, tests_first_started_at and
-- tests_first_status describe; tests_run_url stays the latest decisive run.
--
-- Nullable and derived; scripts/collect-encoding-pipeline.mjs writes them
-- only once they exist, and follows side branches only then.

alter table encodings.pipeline_attempts
  add column if not exists pr_via_number        integer,
  add column if not exists pr_via_url           text,
  add column if not exists pr_via_state         text,
  add column if not exists pr_via_merged_at     timestamptz,
  add column if not exists pr_via_merge_commit  text,
  add column if not exists tests_first_run_url  text;
