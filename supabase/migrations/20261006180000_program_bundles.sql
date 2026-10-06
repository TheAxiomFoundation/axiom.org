-- Program bundles for the /ops/bundles pages.
--
-- A program bundle (axiom-corpus manifests/program-bundles/*.yaml) lists the
-- documents of each delivery tier of one program in one jurisdiction: the
-- screener-level parity tier and the full document bundle. These tables hold
-- how far each document has come. scripts/collect-program-bundles.mjs
-- rebuilds them from the bundle files, the served corpus, the RuleSpec rule
-- index and encodings.pipeline_attempts; nothing else writes here, so every
-- column is derived and safe to recompute.

-- One row per bundle: its header and its tiers' definitions.
create table if not exists encodings.program_bundles (
  id            text primary key,          -- <jurisdiction>/<program>, e.g. us-az/snap
  title         text not null,
  program       text not null,
  jurisdiction  text not null,
  as_of         date,                      -- when the bundle file was generated
  parts         jsonb not null default '[]', -- the parts of the program, in reading order
  tiers         jsonb not null,            -- [{id, title, definition, membership, notes}]
  source        text,                      -- the bundle file read: <repo>@main:<path>#<blob sha>
  collected_at  timestamptz not null
);

-- One row per document and tier, with its measure.
create table if not exists encodings.program_bundle_documents (
  bundle_id           text not null references encodings.program_bundles (id) on delete cascade,
  tier                text not null,       -- screener | full
  key                 text not null,       -- citation path, or source URL for a document the corpus does not hold
  name                text not null,
  layer               text not null,       -- federal | state | other state
  part                text not null,       -- the part of the program it feeds (calculation or manual part)
  scope               text not null,       -- in | excluded
  reason              text,                -- why an excluded document is out
  citation_path       text,
  source_url          text,
  sources             text[] not null default '{}',  -- plan | policyengine-references
  manifest            text,                -- the source manifest that registers it
  in_corpus           boolean not null,
  -- The document's text-bearing provisions (corpus leaves), each in one
  -- state: encoded (a module's source is it or a provision above it),
  -- partly (a module encodes only part of it), in progress or failed (its
  -- newest encode run), or not started (the rest).
  provisions              integer not null,
  encoded_provisions      integer not null,
  partly_provisions       integer not null,
  provisions_in_progress  integer not null,
  provisions_failed       integer not null,
  open_provisions         jsonb not null default '[]',  -- [{path, state, stage, citation, at}], newest first
  modules             integer not null,    -- distinct modules whose source is in the document
  -- Screener tier only: each provision PolicyEngine cites, graded by the
  -- parity rule: [{key, name, path, url, part, references, state, detail, run}].
  units               jsonb not null default '[]',
  runs                integer not null,    -- targeted encode runs for citations in the document
  latest_citation     text,
  latest_run_at       timestamptz,
  latest_stage        text,                -- the pipeline stage of the newest run
  latest_run_url      text,
  status              text,                -- complete | partly | not_started | not_in_corpus; null when excluded
  collected_at        timestamptz not null,
  primary key (bundle_id, tier, key)
);

-- Each tier's counts once a day, for progress over time.
create table if not exists encodings.program_bundle_snapshots (
  bundle_id  text not null references encodings.program_bundles (id) on delete cascade,
  tier       text not null,
  day        date not null,
  counts     jsonb not null,               -- documents, excluded, byStatus, provisions, byProvisionState, units, byUnitState
  primary key (bundle_id, tier, day)
);

alter table encodings.program_bundles enable row level security;
alter table encodings.program_bundle_documents enable row level security;
alter table encodings.program_bundle_snapshots enable row level security;

drop policy if exists "program_bundles are publicly readable" on encodings.program_bundles;
create policy "program_bundles are publicly readable"
  on encodings.program_bundles for select using (true);
drop policy if exists "program_bundle_documents are publicly readable" on encodings.program_bundle_documents;
create policy "program_bundle_documents are publicly readable"
  on encodings.program_bundle_documents for select using (true);
drop policy if exists "program_bundle_snapshots are publicly readable" on encodings.program_bundle_snapshots;
create policy "program_bundle_snapshots are publicly readable"
  on encodings.program_bundle_snapshots for select using (true);

grant select on encodings.program_bundles, encodings.program_bundle_documents, encodings.program_bundle_snapshots
  to anon, authenticated;
grant select, insert, update, delete
  on encodings.program_bundles, encodings.program_bundle_documents, encodings.program_bundle_snapshots
  to service_role;
