-- P0-C2C1 version history, provenance, and integrity metadata.

alter table public.story_bible_versions
  add column if not exists operation_source text,
  add column if not exists mutation_request_ids text[] not null default '{}',
  add column if not exists summary text,
  add column if not exists reverted_version_id text,
  add column if not exists revert_reason text,
  add column if not exists source_provider_type text not null default 'legacy_unknown',
  add column if not exists source_provider_location text,
  add column if not exists source_model_id text,
  add column if not exists source_execution_id text,
  add column if not exists source_mode text,
  add column if not exists data_left_device boolean,
  add column if not exists storage_location text not null default 'supabase-postgres',
  add column if not exists integrity_hash text;

create index if not exists idx_story_versions_project_operation
on public.story_bible_versions(project_id, operation_type, created_at desc);

create index if not exists idx_story_versions_project_provider
on public.story_bible_versions(project_id, source_provider_type, created_at desc);

create index if not exists idx_story_versions_project_created
on public.story_bible_versions(project_id, created_at desc);

insert into public.schema_migrations(version)
values ('p0c2c1_version_history_007')
on conflict (version) do nothing;
