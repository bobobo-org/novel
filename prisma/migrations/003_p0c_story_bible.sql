-- P0-C1 Story Bible core schema, candidate extraction, and source references

create table if not exists public.story_bibles (
  project_id text primary key,
  schema_version text not null,
  status text not null default 'active',
  core_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.story_bible_versions (
  id text primary key,
  project_id text not null references public.story_bibles(project_id) on delete cascade,
  version_number integer not null,
  parent_version_id text,
  change_set jsonb not null default '{}'::jsonb,
  approved_candidate_ids text[] not null default '{}',
  conflict_resolution_ids text[] not null default '{}',
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  unique(project_id, version_number)
);

create table if not exists public.story_bible_extraction_runs (
  id text primary key,
  project_id text not null,
  chapter_id text,
  chapter_number integer,
  extraction_mode text not null,
  schema_version text not null,
  prompt_version text not null,
  model_id text not null,
  fallback_level text not null,
  status text not null,
  confidence numeric,
  warnings jsonb not null default '[]'::jsonb,
  input_hash text not null,
  output_json jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists public.story_characters (
  id text primary key,
  project_id text not null references public.story_bibles(project_id) on delete cascade,
  character_id text not null,
  canonical_name text not null,
  character_json jsonb not null default '{}'::jsonb,
  confidence numeric,
  updated_at timestamptz not null default now(),
  unique(project_id, character_id)
);

create table if not exists public.story_relationships (
  id text primary key,
  project_id text not null references public.story_bibles(project_id) on delete cascade,
  relationship_id text not null,
  relationship_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(project_id, relationship_id)
);

create table if not exists public.story_world_rules (
  id text primary key,
  project_id text not null references public.story_bibles(project_id) on delete cascade,
  rule_id text not null,
  title text not null,
  rule_json jsonb not null default '{}'::jsonb,
  immutable boolean not null default false,
  confidence numeric,
  updated_at timestamptz not null default now(),
  unique(project_id, rule_id)
);

create table if not exists public.story_locations (
  id text primary key,
  project_id text not null references public.story_bibles(project_id) on delete cascade,
  location_id text not null,
  name text not null,
  location_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(project_id, location_id)
);

create table if not exists public.story_factions (
  id text primary key,
  project_id text not null references public.story_bibles(project_id) on delete cascade,
  faction_id text not null,
  name text not null,
  faction_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(project_id, faction_id)
);

create table if not exists public.story_items (
  id text primary key,
  project_id text not null references public.story_bibles(project_id) on delete cascade,
  item_id text not null,
  name text not null,
  item_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(project_id, item_id)
);

create table if not exists public.story_events (
  id text primary key,
  project_id text not null references public.story_bibles(project_id) on delete cascade,
  event_id text not null,
  chapter_id text,
  event_type text,
  title text not null,
  event_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(project_id, event_id)
);

create table if not exists public.story_timeline (
  id text primary key,
  project_id text not null references public.story_bibles(project_id) on delete cascade,
  timeline_entry_id text not null,
  event_id text,
  chapter_id text,
  story_date text,
  relative_order integer,
  timeline_json jsonb not null default '{}'::jsonb,
  unique(project_id, timeline_entry_id)
);

create table if not exists public.story_foreshadowing (
  id text primary key,
  project_id text not null references public.story_bibles(project_id) on delete cascade,
  foreshadow_id text not null,
  title text not null,
  status text not null default 'planted',
  foreshadow_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(project_id, foreshadow_id),
  check (status in ('planted','developing','partially_paid','paid','abandoned'))
);

create table if not exists public.story_open_threads (
  id text primary key,
  project_id text not null references public.story_bibles(project_id) on delete cascade,
  thread_id text not null,
  thread_type text not null,
  title text not null,
  status text not null default 'open',
  thread_json jsonb not null default '{}'::jsonb,
  unique(project_id, thread_id)
);

create table if not exists public.story_chapter_summaries (
  id text primary key,
  project_id text not null references public.story_bibles(project_id) on delete cascade,
  chapter_id text not null,
  chapter_number integer,
  title text,
  summary text not null,
  summary_json jsonb not null default '{}'::jsonb,
  source_hash text,
  updated_at timestamptz not null default now(),
  unique(project_id, chapter_id)
);

create table if not exists public.story_fact_candidates (
  id text primary key,
  project_id text not null,
  extraction_run_id text not null references public.story_bible_extraction_runs(id) on delete cascade,
  entity_type text not null,
  entity_id text,
  temporary_entity_id text,
  operation text not null,
  field_path text not null,
  previous_value jsonb,
  proposed_value jsonb not null,
  confidence numeric,
  evidence text,
  source_refs jsonb not null default '[]'::jsonb,
  reason text,
  conflict_risk text not null default 'low',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check (operation in ('create','update','append','remove','supersede','no-change')),
  check (status in ('pending','approved','rejected','superseded','needs-review'))
);

create table if not exists public.story_fact_conflicts (
  id text primary key,
  project_id text not null,
  extraction_run_id text not null references public.story_bible_extraction_runs(id) on delete cascade,
  candidate_id text references public.story_fact_candidates(id) on delete set null,
  severity text not null,
  conflict_type text not null,
  canonical_fact jsonb,
  candidate_fact jsonb not null,
  source_refs jsonb not null default '[]'::jsonb,
  explanation text not null,
  suggested_resolution text,
  auto_resolvable boolean not null default false,
  confidence numeric,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  check (severity in ('info','warning','major','blocking'))
);

create table if not exists public.story_fact_sources (
  id text primary key,
  project_id text not null,
  extraction_run_id text not null references public.story_bible_extraction_runs(id) on delete cascade,
  candidate_id text references public.story_fact_candidates(id) on delete cascade,
  chapter_id text,
  scene_id text,
  paragraph_index integer,
  text_start integer,
  text_end integer,
  excerpt_hash text not null,
  excerpt text,
  created_at timestamptz not null default now()
);

insert into public.schema_migrations(version)
values ('p0c_story_bible_003')
on conflict (version) do nothing;

create index if not exists idx_story_bibles_updated on public.story_bibles(updated_at desc);
create index if not exists idx_story_extraction_project_created on public.story_bible_extraction_runs(project_id, created_at desc);
create index if not exists idx_story_candidates_project_status on public.story_fact_candidates(project_id, status, created_at desc);
create index if not exists idx_story_candidates_run on public.story_fact_candidates(extraction_run_id);
create index if not exists idx_story_conflicts_project_status on public.story_fact_conflicts(project_id, status, created_at desc);
create index if not exists idx_story_sources_project_chapter on public.story_fact_sources(project_id, chapter_id);
create index if not exists idx_story_characters_project_name on public.story_characters(project_id, canonical_name);
create index if not exists idx_story_events_project_chapter on public.story_events(project_id, chapter_id);
create index if not exists idx_story_foreshadowing_project_status on public.story_foreshadowing(project_id, status);

alter table public.story_bibles enable row level security;
alter table public.story_bible_versions enable row level security;
alter table public.story_bible_extraction_runs enable row level security;
alter table public.story_characters enable row level security;
alter table public.story_relationships enable row level security;
alter table public.story_world_rules enable row level security;
alter table public.story_locations enable row level security;
alter table public.story_factions enable row level security;
alter table public.story_items enable row level security;
alter table public.story_events enable row level security;
alter table public.story_timeline enable row level security;
alter table public.story_foreshadowing enable row level security;
alter table public.story_open_threads enable row level security;
alter table public.story_chapter_summaries enable row level security;
alter table public.story_fact_candidates enable row level security;
alter table public.story_fact_conflicts enable row level security;
alter table public.story_fact_sources enable row level security;
