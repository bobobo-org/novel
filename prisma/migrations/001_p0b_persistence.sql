-- P0-B formal persistence schema
-- Schema version: p0b_persistence_001
-- Target: Supabase PostgreSQL / Vercel serverless compatible REST access
-- This migration intentionally avoids extension-dependent UUID defaults because
-- service environments may not be allowed to run CREATE EXTENSION.

create table if not exists public.projects (
  id text primary key,
  owner_id text,
  local_owner_key text,
  title text not null default '',
  genre text not null default '',
  status text not null default 'active',
  schema_version text not null default 'p0b_persistence_001',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_runs (
  id text primary key,
  trace_id text,
  project_id text not null,
  task_type text not null,
  mode text,
  provider text not null,
  model_id text not null,
  prompt_version text not null,
  schema_version text not null,
  input_token_count integer,
  output_token_count integer,
  elapsed_ms integer not null default 0,
  provider_elapsed_ms integer,
  fallback_used text,
  fallback_level text,
  success boolean not null default false,
  error_code text,
  error_stage text,
  retryable boolean,
  created_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id text primary key,
  project_id text not null,
  ai_run_id text references public.ai_runs(id) on delete set null,
  rating integer,
  adopted boolean,
  feedback_type text not null default 'unknown',
  comment text,
  original_output_hash text,
  edited_output_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.training_examples (
  id text primary key,
  project_id text not null,
  ai_run_id text references public.ai_runs(id) on delete set null,
  status text not null default 'pending',
  task_type text not null,
  input_summary text not null default '',
  output_summary text not null default '',
  rejection_reason text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.evaluation_runs (
  id text primary key,
  benchmark_version text not null,
  analyzer_version text not null,
  provider text not null,
  model_id text not null,
  evaluation_type text not null,
  total_cases integer not null default 0,
  passed_cases integer not null default 0,
  average_score numeric not null default 0,
  p50_ms integer,
  p95_ms integer,
  json_valid_rate numeric,
  schema_valid_rate numeric,
  fallback_rate numeric,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.model_errors (
  id text primary key,
  trace_id text,
  project_id text,
  provider text not null,
  model_id text not null,
  task_type text not null,
  error_code text not null,
  error_stage text not null,
  technical_message text,
  retryable boolean not null default false,
  elapsed_ms integer not null default 0,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.story_memories (
  id text primary key,
  project_id text not null,
  memory_version text not null,
  status text not null default 'approved',
  memory_json jsonb not null default '{}'::jsonb,
  source_chapter_ids jsonb not null default '[]'::jsonb,
  created_by text not null default 'system',
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memory_candidates (
  id text primary key,
  project_id text not null,
  ai_run_id text references public.ai_runs(id) on delete set null,
  source_chapter_id text,
  candidate_type text not null default 'memory_update',
  candidate_json jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'superseded')),
  conflict_json jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

insert into public.schema_migrations(version)
values ('p0b_persistence_001')
on conflict (version) do nothing;

create index if not exists idx_projects_owner on public.projects(owner_id, local_owner_key);
create index if not exists idx_ai_runs_project_created on public.ai_runs(project_id, created_at desc);
create index if not exists idx_ai_runs_trace on public.ai_runs(trace_id);
create index if not exists idx_feedback_project_created on public.feedback(project_id, created_at desc);
create index if not exists idx_training_project_status on public.training_examples(project_id, status, created_at desc);
create index if not exists idx_evaluation_created on public.evaluation_runs(created_at desc);
create index if not exists idx_model_errors_trace on public.model_errors(trace_id);
create index if not exists idx_model_errors_project_created on public.model_errors(project_id, created_at desc);
create index if not exists idx_story_memories_project_updated on public.story_memories(project_id, updated_at desc);
create index if not exists idx_memory_candidates_project_status on public.memory_candidates(project_id, status, created_at desc);

alter table public.projects enable row level security;
alter table public.ai_runs enable row level security;
alter table public.feedback enable row level security;
alter table public.training_examples enable row level security;
alter table public.evaluation_runs enable row level security;
alter table public.model_errors enable row level security;
alter table public.story_memories enable row level security;
alter table public.memory_candidates enable row level security;
alter table public.schema_migrations enable row level security;
