-- Encodings in flight on the program bundle pages.
--
-- Each document row lists the open rulespec-us PRs that add a module for one
-- of its provisions, by provision, with the PR's state: candidate,
-- candidate-reviewed, changes-requested, signed or in-train
-- (src/lib/axiom/program-bundles-in-flight.ts). They give no credit: a
-- provision counts as encoded only once its module merges.
--
-- scripts/collect-program-bundles.mjs writes it on every pass. Before this
-- migration it writes the rows without it, and the page shows no in-flight
-- PRs. Null: the collector could not read the PRs that pass (unknown, not
-- none).
--
--   [{citation, module, pr, url, state, review_decision, draft,
--     manifest_pr: {number, url} | null, encoded}]

alter table encodings.program_bundle_documents
  add column if not exists in_flight jsonb;

comment on column encodings.program_bundle_documents.in_flight is
  'Open rulespec-us PRs that add a module for one of the document''s provisions, by provision; null when they could not be read';
