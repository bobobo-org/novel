-- P0-C2B1 Story Bible mutation foundation: idempotency and reject audit fields.

alter table public.story_bible_mutation_requests
  add column if not exists request_hash text,
  add column if not exists response_json jsonb,
  add column if not exists error_code text,
  add column if not exists reviewer_id text,
  add column if not exists expected_candidate_status text,
  add column if not exists expected_story_bible_version integer;

update public.story_bible_mutation_requests
set request_hash = coalesce(request_hash, response_hash)
where request_hash is null;

create index if not exists idx_story_mutation_requests_candidate
on public.story_bible_mutation_requests(project_id, operation, candidate_ids);

insert into public.schema_migrations(version)
values ('p0c2b1_mutation_foundation_005')
on conflict (version) do nothing;
