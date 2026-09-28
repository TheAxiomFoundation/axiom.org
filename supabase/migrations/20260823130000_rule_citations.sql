-- Materialized rule-level reverse index from corpus provisions to RuleSpec rules.
--
-- A provision can ground hundreds of rules across large modules, so fetching
-- every citing rulespec_files row makes the reader both noisy and expensive.
-- This table stores the individual rule YAML needed by the reader and supports
-- a bounded, honest result count. Ranking presents singular module sources
-- first (0), then value-bearing atoms (1), formula atoms (2), and
-- condition-family or otherwise grounding atoms (3). effective_period remains
-- a value-bearing kind and therefore ranks 1. Import and ordering atoms are
-- references between declarations and are not indexed here.

create table if not exists encodings.rule_citations (
  citation_path        text not null,
  module_citation_path text not null,
  rule_name            text not null,
  file_path            text not null,
  repo                 text not null,
  jurisdiction         text not null,
  is_module_source     boolean not null default false,
  atom_kinds           text[] not null default '{}',
  rank                 smallint not null,
  rule_yaml            text not null,
  synced_at            timestamptz not null default now(),
  primary key (citation_path, module_citation_path, rule_name)
);

create index if not exists rule_citations_citation_path_rank_idx
  on encodings.rule_citations (citation_path, rank, module_citation_path);
create index if not exists rule_citations_module_idx
  on encodings.rule_citations (module_citation_path);

alter table encodings.rule_citations enable row level security;

drop policy if exists "rule_citations are publicly readable"
  on encodings.rule_citations;
create policy "rule_citations are publicly readable"
  on encodings.rule_citations for select using (true);

grant select on encodings.rule_citations to anon, authenticated;

-- The sync script writes with the service role, which does not inherit
-- privileges on tables created by other roles in this schema (the
-- rulespec_files index needed the same companion grant).
grant select, insert, update, delete on encodings.rule_citations to service_role;
