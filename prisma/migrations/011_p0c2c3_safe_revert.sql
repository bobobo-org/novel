alter table public.story_bible_versions
  add column if not exists target_version_id text,
  add column if not exists selected_change_ids text[],
  add column if not exists inverse_change_set jsonb,
  add column if not exists dependency_summary jsonb,
  add column if not exists preview_hash text;

create table if not exists public.story_bible_revert_audits (
  id text primary key,
  project_id text not null,
  target_version_id text not null,
  current_version_before integer,
  new_version_id text,
  selected_change_ids text[],
  preview_hash text,
  dependency_count integer not null default 0,
  blocking_count integer not null default 0,
  warning_count integer not null default 0,
  requested_by text not null default 'admin-token',
  reason text,
  status text not null,
  error_code text,
  failure_stage text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists story_bible_revert_audits_project_created_idx
  on public.story_bible_revert_audits(project_id, created_at desc);

insert into public.schema_migrations(version)
values ('p0c2c3_safe_revert_011')
on conflict (version) do nothing;
