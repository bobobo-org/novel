-- L0A.2E.2B-2 project-level source natural-key dedup and candidate-source relations.
-- This migration is intentionally additive. The old story_fact_sources.candidate_id
-- column stays in place for compatibility while the new relation table records
-- all candidates that cite a reused source.

create extension if not exists pgcrypto;

alter table public.story_fact_sources
  add column if not exists source_type text not null default 'text_excerpt',
  add column if not exists natural_key text,
  add column if not exists natural_key_hash text;

create table if not exists public.story_fact_candidate_sources (
  id text primary key,
  project_id text not null,
  candidate_id text not null references public.story_fact_candidates(id) on delete cascade,
  source_id text not null references public.story_fact_sources(id) on delete cascade,
  relation_type text not null default 'evidence',
  created_at timestamptz not null default now(),
  unique(project_id, candidate_id, source_id, relation_type)
);

alter table public.story_fact_candidate_sources enable row level security;

create or replace function public.story_source_natural_key(p_source jsonb)
returns text
language sql
immutable
as $$
  select concat_ws('|',
    'source-natural-key-v1',
    coalesce(nullif(trim(p_source->>'project_id'), ''), '__no_project__'),
    coalesce(nullif(trim(coalesce(p_source->>'source_hash', p_source->>'excerpt_hash')), ''), '__no_hash__'),
    coalesce(nullif(trim(p_source->>'chapter_id'), ''), '__no_chapter__'),
    coalesce(nullif(trim(p_source->>'scene_id'), ''), '__no_scene__'),
    coalesce(nullif(trim(coalesce(p_source->>'paragraph_start', p_source->>'paragraph_index', p_source->>'text_start')), ''), '__no_paragraph_start__'),
    coalesce(nullif(trim(coalesce(p_source->>'paragraph_end', p_source->>'text_end')), ''), '__no_paragraph_end__'),
    coalesce(nullif(trim(p_source->>'source_type'), ''), 'text_excerpt')
  );
$$;

create or replace function public.story_source_natural_key_hash(p_source jsonb)
returns text
language sql
immutable
as $$
  select encode(extensions.digest(public.story_source_natural_key(p_source), 'sha256'), 'hex');
$$;

update public.story_fact_sources
set
  source_type = coalesce(nullif(source_type, ''), 'text_excerpt'),
  natural_key = public.story_source_natural_key(to_jsonb(story_fact_sources)),
  natural_key_hash = public.story_source_natural_key_hash(to_jsonb(story_fact_sources))
where natural_key_hash is null or natural_key is null or source_type is null or source_type = '';

alter table public.story_fact_sources
  alter column natural_key set not null,
  alter column natural_key_hash set not null;

-- Preserve existing one-source-to-one-candidate links before deduplicating rows.
insert into public.story_fact_candidate_sources(id, project_id, candidate_id, source_id, relation_type, created_at)
select
  'rel_' || md5(project_id || ':' || candidate_id || ':' || id || ':evidence'),
  project_id,
  candidate_id,
  id,
  'evidence',
  created_at
from public.story_fact_sources
where candidate_id is not null
on conflict(project_id, candidate_id, source_id, relation_type) do nothing;

-- If old data already has duplicate project-level natural keys, point every
-- relation at the oldest source row, then delete duplicates before adding the
-- unique index. This keeps migration 015 safe on real production data.
with ranked as (
  select
    id,
    project_id,
    natural_key_hash,
    first_value(id) over (partition by project_id, natural_key_hash order by created_at asc, id asc) as keep_id,
    row_number() over (partition by project_id, natural_key_hash order by created_at asc, id asc) as rn
  from public.story_fact_sources
),
duplicate_relations as (
  select
    'rel_' || md5(s.project_id || ':' || s.candidate_id || ':' || r.keep_id || ':evidence') as id,
    s.project_id,
    s.candidate_id,
    r.keep_id as source_id,
    'evidence' as relation_type,
    s.created_at
  from public.story_fact_sources s
  join ranked r on r.id = s.id
  where r.rn > 1 and s.candidate_id is not null
)
insert into public.story_fact_candidate_sources(id, project_id, candidate_id, source_id, relation_type, created_at)
select id, project_id, candidate_id, source_id, relation_type, created_at
from duplicate_relations
on conflict(project_id, candidate_id, source_id, relation_type) do nothing;

with ranked as (
  select
    id,
    row_number() over (partition by project_id, natural_key_hash order by created_at asc, id asc) as rn
  from public.story_fact_sources
)
delete from public.story_fact_sources s
using ranked r
where s.id = r.id and r.rn > 1;

create unique index if not exists story_fact_sources_project_natural_key_idx
on public.story_fact_sources(project_id, natural_key_hash);

create or replace function public.persist_story_bible_extraction_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id text := p_payload->>'projectId';
  v_run_id text := p_payload #>> '{extractionRunRow,id}';
  v_request_id text := coalesce(p_payload->>'requestId', p_payload #>> '{extractionRunRow,id}');
  v_hash text := md5((p_payload - 'requestId')::text);
  v_existing public.story_bible_extraction_requests%rowtype;
  v_source_input jsonb;
  v_source_record public.story_fact_sources%rowtype;
  v_inserted_source_id text;
  v_source_id text;
  v_natural_key text;
  v_natural_key_hash text;
  v_sources_created int := 0;
  v_sources_reused int := 0;
  v_relations_created int := 0;
  v_candidates int := 0;
  v_conflicts int := 0;
  v_summaries int := 0;
  v_source_ids jsonb := '[]'::jsonb;
  v_source_keys jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if coalesce(v_project_id, '') = '' then
    raise exception 'STORAGE_SCHEMA_INCOMPATIBLE: projectId is required';
  end if;
  if coalesce(v_run_id, '') = '' then
    raise exception 'STORAGE_SCHEMA_INCOMPATIBLE: extractionRunRow.id is required';
  end if;
  if coalesce(v_request_id, '') = '' then
    raise exception 'STORAGE_SCHEMA_INCOMPATIBLE: requestId is required';
  end if;

  if exists (select 1 from jsonb_array_elements(coalesce(p_payload->'candidateRows','[]'::jsonb)) r where r->>'project_id' is distinct from v_project_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_payload->'sourceRows','[]'::jsonb)) r where r->>'project_id' is distinct from v_project_id)
    or exists (select 1 from jsonb_array_elements(coalesce(p_payload->'conflictRows','[]'::jsonb)) r where r->>'project_id' is distinct from v_project_id)
    or (p_payload #>> '{storyBibleRow,project_id}') is distinct from v_project_id
    or (p_payload #>> '{extractionRunRow,project_id}') is distinct from v_project_id
    or (p_payload #>> '{chapterSummaryRow,project_id}') is distinct from v_project_id
  then
    raise exception 'STORAGE_SCHEMA_INCOMPATIBLE: project isolation violation';
  end if;

  insert into public.story_bible_extraction_requests(request_id, project_id, payload_hash, extraction_run_id, status)
  values (v_request_id, v_project_id, v_hash, v_run_id, 'processing')
  on conflict(request_id) do nothing;

  select * into v_existing
  from public.story_bible_extraction_requests
  where request_id = v_request_id
  for update;

  if v_existing.payload_hash is distinct from v_hash then
    raise exception 'STORAGE_IDEMPOTENCY_CONFLICT: requestId reused with different payload';
  end if;

  if v_existing.status = 'completed' and v_existing.result_json is not null then
    return v_existing.result_json || jsonb_build_object('idempotentReplay', true);
  end if;

  insert into public.story_bibles
  select * from jsonb_populate_record(null::public.story_bibles, p_payload->'storyBibleRow')
  on conflict(project_id) do update set
    schema_version = excluded.schema_version,
    status = excluded.status,
    core_json = excluded.core_json,
    updated_at = excluded.updated_at;

  insert into public.story_bible_extraction_runs
  select * from jsonb_populate_record(
    null::public.story_bible_extraction_runs,
    jsonb_set(p_payload->'extractionRunRow', '{output_json,atomicPayloadHash}', to_jsonb(v_hash), true)
  )
  on conflict(id) do update set
    status = excluded.status,
    confidence = excluded.confidence,
    warnings = excluded.warnings,
    output_json = excluded.output_json,
    error_code = excluded.error_code;

  insert into public.story_fact_candidates
  select * from jsonb_populate_recordset(null::public.story_fact_candidates, coalesce(p_payload->'candidateRows','[]'::jsonb))
  on conflict(id) do nothing;
  get diagnostics v_candidates = row_count;

  insert into public.story_fact_conflicts
  select * from jsonb_populate_recordset(null::public.story_fact_conflicts, coalesce(p_payload->'conflictRows','[]'::jsonb))
  on conflict(id) do nothing;
  get diagnostics v_conflicts = row_count;

  for v_source_input in select * from jsonb_array_elements(coalesce(p_payload->'sourceRows','[]'::jsonb))
  loop
    v_natural_key := public.story_source_natural_key(v_source_input);
    v_natural_key_hash := public.story_source_natural_key_hash(v_source_input);
    v_inserted_source_id := v_source_input->>'id';

    insert into public.story_fact_sources(
      id, project_id, extraction_run_id, candidate_id, chapter_id, scene_id, paragraph_index,
      text_start, text_end, excerpt_hash, excerpt, created_at, source_type, natural_key, natural_key_hash
    )
    values (
      v_inserted_source_id,
      v_source_input->>'project_id',
      v_source_input->>'extraction_run_id',
      v_source_input->>'candidate_id',
      v_source_input->>'chapter_id',
      v_source_input->>'scene_id',
      nullif(v_source_input->>'paragraph_index', '')::integer,
      nullif(v_source_input->>'text_start', '')::integer,
      nullif(v_source_input->>'text_end', '')::integer,
      v_source_input->>'excerpt_hash',
      v_source_input->>'excerpt',
      coalesce(nullif(v_source_input->>'created_at', '')::timestamptz, now()),
      coalesce(nullif(v_source_input->>'source_type', ''), 'text_excerpt'),
      v_natural_key,
      v_natural_key_hash
    )
    on conflict(project_id, natural_key_hash) do update set
      natural_key_hash = public.story_fact_sources.natural_key_hash
    returning * into v_source_record;

    if v_source_record.id = v_inserted_source_id then
      v_sources_created := v_sources_created + 1;
    else
      v_sources_reused := v_sources_reused + 1;
    end if;

    v_source_id := v_source_record.id;
    v_source_ids := v_source_ids || to_jsonb(v_source_id);
    v_source_keys := v_source_keys || to_jsonb(v_natural_key_hash);

    if coalesce(v_source_input->>'candidate_id', '') <> '' then
      insert into public.story_fact_candidate_sources(id, project_id, candidate_id, source_id, relation_type)
      values (
        'rel_' || md5(v_project_id || ':' || (v_source_input->>'candidate_id') || ':' || v_source_id || ':evidence'),
        v_project_id,
        v_source_input->>'candidate_id',
        v_source_id,
        'evidence'
      )
      on conflict(project_id, candidate_id, source_id, relation_type) do nothing;
      if found then
        v_relations_created := v_relations_created + 1;
      end if;
    end if;
  end loop;

  insert into public.story_chapter_summaries
  select * from jsonb_populate_record(null::public.story_chapter_summaries, p_payload->'chapterSummaryRow')
  on conflict(project_id, chapter_id) do update set
    chapter_number = excluded.chapter_number,
    title = excluded.title,
    summary = excluded.summary,
    summary_json = excluded.summary_json,
    source_hash = excluded.source_hash,
    updated_at = excluded.updated_at;
  get diagnostics v_summaries = row_count;

  v_result := jsonb_build_object(
    'extractionRunId', v_run_id,
    'sourceIds', v_source_ids,
    'sourceNaturalKeys', v_source_keys,
    'candidateIds', coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(coalesce(p_payload->'candidateRows','[]'::jsonb)) x), '[]'::jsonb),
    'conflictIds', coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(coalesce(p_payload->'conflictRows','[]'::jsonb)) x), '[]'::jsonb),
    'chapterSummaryIds', jsonb_build_array(p_payload #>> '{chapterSummaryRow,id}'),
    'createdCounts', jsonb_build_object(
      'sources', v_sources_created,
      'reusedSources', v_sources_reused,
      'candidateSourceRelations', v_relations_created,
      'candidates', v_candidates,
      'conflicts', v_conflicts,
      'chapterSummaries', v_summaries
    ),
    'payloadHash', v_hash,
    'requestId', v_request_id,
    'sourceNaturalKeyVersion', 'source-natural-key-v1',
    'transactionStatus', 'committed',
    'completedAt', now()
  );

  update public.story_bible_extraction_requests
  set status = 'completed', result_json = v_result, completed_at = now(), error_code = null
  where request_id = v_request_id;

  return v_result;
exception when others then
  update public.story_bible_extraction_requests
  set status = case
      when sqlstate in ('23502','23503','23505','22P02','P0001') then 'failed_terminal'
      else 'failed_retryable'
    end,
    error_code = sqlstate,
    completed_at = now()
  where request_id = v_request_id and status = 'processing';
  raise;
end;
$$;

grant execute on function public.persist_story_bible_extraction_atomic(jsonb) to service_role;

insert into public.schema_migrations(version)
values ('p0_l0a2e2_project_source_natural_key_015')
on conflict (version) do nothing;
