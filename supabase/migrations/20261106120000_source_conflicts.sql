-- RuleSpec source-conflict registers, for the app.
--
-- Each rulespec-* repo may keep known-source-conflicts.yaml at the root of
-- main: places where a jurisdiction's sources disagree (statute against
-- regulation, regulation against an agency manual), the readings each side
-- supports and the reading adopted. scripts/collect-source-conflicts.mjs
-- reads every register and replaces this table's rows each pass; nothing
-- else writes here, so every column is derived and safe to recompute.

create table if not exists encodings.source_conflicts (
  global_id          text primary key,          -- <jurisdiction>:<id>, the id code outside RuleSpec cites
  repo               text not null,             -- the rulespec-* repo that holds the register
  jurisdiction       text not null,
  entry_id           text not null,             -- the entry's id inside its register
  program            text,
  status             text not null,             -- open | ruled | confirmed | contradicted | ...
  question           text not null,
  reading            text not null,             -- the reading the entry adopts
  basis              text,
  alternatives       jsonb not null default '[]', -- [{id, reading, effect}]
  ruling             jsonb,                     -- {by, date, record}
  citation_paths     text[] not null default '{}', -- texts[].corpus_citation_path, each once
  pending_citations  jsonb not null default '[]', -- pending_texts[]: [{citation, kind, url}]
  adopted_by         jsonb not null default '[]', -- [{module, interpretation}]
  entry              jsonb not null,            -- the whole entry as the register holds it
  source_url         text not null,             -- the register file on GitHub main
  collected_at       timestamptz not null
);

-- The lookup from a corpus provision to the conflicts that cite it.
create index if not exists source_conflicts_citation_paths
  on encodings.source_conflicts using gin (citation_paths);

alter table encodings.source_conflicts enable row level security;

drop policy if exists "source_conflicts are publicly readable" on encodings.source_conflicts;
create policy "source_conflicts are publicly readable"
  on encodings.source_conflicts for select using (true);

grant select on encodings.source_conflicts to anon, authenticated;
grant select, insert, update, delete on encodings.source_conflicts to service_role;
