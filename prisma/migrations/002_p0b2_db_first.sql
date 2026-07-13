-- P0-B2 DB-first recovery and verification additions

create table if not exists public.health_checks (
  id text primary key,
  created_at timestamptz not null default now()
);

insert into public.schema_migrations(version)
values ('p0b2_db_first_002')
on conflict (version) do nothing;

create index if not exists idx_ai_runs_success_created on public.ai_runs(success, created_at desc);
create index if not exists idx_feedback_ai_run on public.feedback(ai_run_id);
create index if not exists idx_evaluation_analyzer_created on public.evaluation_runs(analyzer_version, created_at desc);
create index if not exists idx_story_memories_project_version on public.story_memories(project_id, memory_version);

alter table public.health_checks enable row level security;
