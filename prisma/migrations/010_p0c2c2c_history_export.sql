create table if not exists public.story_bible_export_audits (
  id text primary key,
  project_id text not null,
  requested_by text not null default 'system',
  export_options_hash text not null,
  from_version integer,
  to_version integer,
  content_hash text,
  package_hash text,
  status text not null,
  estimated_bytes integer,
  actual_bytes integer,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists story_bible_export_audits_project_created_idx
  on public.story_bible_export_audits(project_id, created_at desc);

create table if not exists public.story_bible_export_packages (
  id text primary key,
  project_id text not null,
  content_hash text not null,
  package_hash text not null,
  from_version integer,
  to_version integer,
  format text not null,
  format_version text not null,
  actual_bytes integer,
  manifest_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists story_bible_export_packages_project_created_idx
  on public.story_bible_export_packages(project_id, created_at desc);

insert into public.schema_migrations(version)
values ('p0c2c2c_history_export_010')
on conflict (version) do nothing;
