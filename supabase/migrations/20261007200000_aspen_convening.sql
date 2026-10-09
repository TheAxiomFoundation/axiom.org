-- Aspen State Benefits Leadership Cohort convening (Phoenix, 2026-10-26):
-- what the room does on axiom.org/aspen.
--
-- Written only by the site's API routes (src/app/api/aspen/*) with the
-- server-side service key. RLS is on with no policies, so the anon key
-- that ships to browsers can neither read nor write these tables.
--
-- run_id separates rehearsals from the live session: the presenter view
-- starts a new run, and every row is stamped with the run active when it
-- was written.

-- The live stage and run, one row.
create table if not exists public.aspen_control (
  id          text primary key default 'live' check (id = 'live'),
  run_id      text not null default 'rehearsal',
  stage       text not null default 'welcome',
  updated_at  timestamptz not null default now()
);
insert into public.aspen_control (id) values ('live') on conflict (id) do nothing;

-- One row per phone (an anonymous id kept in the browser).
create table if not exists public.aspen_participants (
  id            uuid primary key,
  run_id        text not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  perspective   text,
  state         text,
  role          text,
  user_agent    text
);
create index if not exists aspen_participants_run_idx on public.aspen_participants (run_id);

-- One row per question sent to the chatbot, with the answer, the
-- participant's rating, and what the rules said when they checked.
create table if not exists public.aspen_prompts (
  id                  uuid primary key,
  run_id              text not null,
  participant_id      uuid not null,
  conversation_id     uuid not null,
  turn                integer not null default 0,
  created_at          timestamptz not null default now(),
  stage               text,
  perspective         text,
  household_id        text,
  question_id         text,
  twists              text[],
  prompt_template     text,
  prompt              text not null,
  edited              boolean,
  backend             text,
  model               text,
  web_search          boolean,
  answer              text,
  answer_sources      jsonb,
  latency_ms          integer,
  error               text,
  rated_at            timestamptz,
  verdict             text,
  would_act           text,
  resident_action     text,
  went_well           text[],
  went_wrong          text[],
  rating_note         text,
  rules_requested_at  timestamptz,
  rules_answer        text,
  rules_program       text,
  rules_period        text,
  rules_amount        numeric,
  rules_outputs       jsonb,
  rules_latency_ms    integer,
  rules_error         text,
  post_check_verdict  text
);
create index if not exists aspen_prompts_run_idx on public.aspen_prompts (run_id, created_at);
create index if not exists aspen_prompts_participant_idx on public.aspen_prompts (participant_id);

-- Everything else: profile picks, stage views, chip taps, discussion and
-- breakout notes, Rate it scores, and survey answers (source of truth).
create table if not exists public.aspen_events (
  id              bigint generated always as identity primary key,
  run_id          text not null,
  participant_id  uuid,
  created_at      timestamptz not null default now(),
  kind            text not null,
  stage           text,
  payload         jsonb not null default '{}'::jsonb
);
create index if not exists aspen_events_run_idx on public.aspen_events (run_id, kind, created_at);

-- Follow-up requests. The only table with names and emails; the results
-- view selects state and the two checkboxes only.
create table if not exists public.aspen_pledges (
  id              uuid primary key default gen_random_uuid(),
  run_id          text not null,
  participant_id  uuid,
  created_at      timestamptz not null default now(),
  name            text,
  title           text,
  state           text,
  email           text not null,
  accurate_ai     boolean not null default false,
  state_systems   boolean not null default false,
  show_state      boolean not null default true,
  note            text
);
create index if not exists aspen_pledges_run_idx on public.aspen_pledges (run_id, created_at);

alter table public.aspen_control      enable row level security;
alter table public.aspen_participants enable row level security;
alter table public.aspen_prompts      enable row level security;
alter table public.aspen_events       enable row level security;
alter table public.aspen_pledges      enable row level security;

-- Belt and braces: the browser-facing roles get no table privileges either.
revoke all on public.aspen_control, public.aspen_participants, public.aspen_prompts,
  public.aspen_events, public.aspen_pledges from anon, authenticated;
