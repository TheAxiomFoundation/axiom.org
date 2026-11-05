-- What an open signed manifest PR waits on (src/lib/axiom/pr-links.ts).
--
-- pr_links holds, for an attempt whose PR is open or a draft: the PRs and
-- issues linked to it two steps out (GitHub cross-reference events, and the
-- full references in its body), each with its kind (encoder fix, corpus, pin
-- bump, encoding PR, RuleSpec change, issue), state and review decision; a
-- merged encoder fix's version at its merge commit; the PR's repo's encoder
-- pin; the PR's last review; and its comment count and last comment. Null
-- once the PR is merged or closed.
--
-- Nullable and derived; scripts/collect-encoding-pipeline.mjs writes it only
-- once it exists, and reads the links only then.

alter table encodings.pipeline_attempts
  add column if not exists pr_links jsonb;
