-- P0-C2B2 canonical mutation metadata, versioning fields, and source relations.

alter table public.story_bible_versions
  add column if not exists operation_type text,
  add column if not exists candidate_ids text[] not null default '{}',
  add column if not exists request_id text;

create table if not exists public.story_canonical_sources (
  id text primary key,
  project_id text not null references public.story_bibles(project_id) on delete cascade,
  canonical_entity_type text not null,
  canonical_entity_id text not null,
  field_path text not null,
  source_type text not null,
  source_id text,
  candidate_id text references public.story_fact_candidates(id) on delete set null,
  version_id text references public.story_bible_versions(id) on delete set null,
  source_hash text,
  created_by text not null default 'system',
  created_at timestamptz not null default now()
);

alter table public.story_canonical_sources enable row level security;

create index if not exists idx_story_canonical_sources_project_entity
on public.story_canonical_sources(project_id, canonical_entity_type, canonical_entity_id, field_path);

create index if not exists idx_story_versions_project_number
on public.story_bible_versions(project_id, version_number desc);

insert into public.schema_migrations(version)
values ('p0c2b2_canonical_transaction_006')
on conflict (version) do nothing;
