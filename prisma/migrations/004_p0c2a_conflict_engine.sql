-- P0-C2A Candidate state model, conflict engine fields, and read API support.

alter table public.story_fact_candidates
  drop constraint if exists story_fact_candidates_status_check;

update public.story_fact_candidates
set status = 'needs_review'
where status = 'needs-review';

alter table public.story_fact_candidates
  add column if not exists previous_status text,
  add column if not exists reviewer_id text,
  add column if not exists review_reason text,
  add column if not exists request_id text,
  add column if not exists source_version_id text,
  add column if not exists based_on_version_id text,
  add column if not exists based_on_version_number integer,
  add column if not exists candidate_trust text,
  add column if not exists source_valid boolean not null default true,
  add column if not exists status_updated_at timestamptz;

alter table public.story_fact_candidates
  add constraint story_fact_candidates_status_check
  check (status in ('pending','needs_review','approved','rejected','stale','superseded','failed'));

alter table public.story_fact_conflicts
  add column if not exists canonical_entity_type text,
  add column if not exists canonical_entity_id text,
  add column if not exists field_path text,
  add column if not exists canonical_value jsonb,
  add column if not exists proposed_value jsonb,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by text;

alter table public.story_fact_conflicts
  drop constraint if exists story_fact_conflicts_status_check;

alter table public.story_fact_conflicts
  add constraint story_fact_conflicts_status_check
  check (status in ('open','resolved','deferred','superseded'));

create table if not exists public.story_bible_mutation_requests (
  request_id text primary key,
  project_id text not null,
  operation text not null,
  candidate_ids text[] not null default '{}',
  result_version_id text,
  status text not null,
  response_hash text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.story_bible_mutation_requests enable row level security;

create index if not exists idx_story_candidates_project_entity on public.story_fact_candidates(project_id, entity_type, entity_id);
create index if not exists idx_story_candidates_project_trust on public.story_fact_candidates(project_id, candidate_trust, created_at desc);
create index if not exists idx_story_conflicts_candidate on public.story_fact_conflicts(candidate_id);
create index if not exists idx_story_conflicts_project_severity on public.story_fact_conflicts(project_id, severity, status, created_at desc);
create index if not exists idx_story_mutation_requests_project on public.story_bible_mutation_requests(project_id, created_at desc);

insert into public.schema_migrations(version)
values ('p0c2a_conflict_engine_004')
on conflict (version) do nothing;
