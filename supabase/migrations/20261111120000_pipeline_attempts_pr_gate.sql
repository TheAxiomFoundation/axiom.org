-- What stands between a signed manifest PR and its merge, and whether a run
-- was asked to open a PR at all.
--
-- /ops could say that a PR was open, not why it was not merged, and it had
-- no time for the PR's CI. The collector now reads, per PR (one GraphQL
-- search it already makes, no extra requests):
--
--   pr_head_sha             the head commit
--   pr_merge_state          GitHub's mergeStateStatus for an open PR
--                           (BEHIND | BLOCKED | CLEAN | DIRTY | DRAFT |
--                           HAS_HOOKS | UNSTABLE); null once closed or merged
--   pr_commit_count         commits on the PR. The bot opens it with one, so
--                           count - 1 = branch updates, and each one restarts
--                           CI and leaves an approval on an older commit
--   pr_checks_started_at    first start of a check run on the head commit
--   pr_checks_finished_at   last finish of a check run on the head commit;
--                           null while one still runs
--   pr_approved_at          the latest approving review
--   pr_approval_on_head     whether that review is on the head commit
--   pr_approvals_dismissed  reviews in state DISMISSED
--
-- pr_requested is for a run that passed: false when the step that opens the
-- PR was skipped (dispatched with open_pr false, so the run ends at its
-- signed artifact by design), true when it ran. Null for any other run. It
-- separates "no PR by design" from a PR that the collector cannot find.
--
-- A PR closed without a merge whose module a merge train carried to the
-- default branch uses the existing pr_via_* columns (20261014120000): no new
-- column for that.
--
-- Nullable and derived; scripts/collect-encoding-pipeline.mjs writes them
-- only once they exist, and the page reads rows without them.

alter table encodings.pipeline_attempts
  add column if not exists pr_head_sha             text,
  add column if not exists pr_merge_state          text,
  add column if not exists pr_commit_count         integer,
  add column if not exists pr_checks_started_at    timestamptz,
  add column if not exists pr_checks_finished_at   timestamptz,
  add column if not exists pr_approved_at          timestamptz,
  add column if not exists pr_approval_on_head     boolean,
  add column if not exists pr_approvals_dismissed  integer,
  add column if not exists pr_requested            boolean;
