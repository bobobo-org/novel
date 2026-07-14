-- L0A.2E.2A rollback fixture and idempotency state contract.
-- This migration does not expose fault injection through production APIs.

alter table public.story_bible_extraction_requests
  drop constraint if exists story_bible_extraction_requests_status_check;

update public.story_bible_extraction_requests
set status = case
  when status = 'running' then 'processing'
  when status = 'failed' then 'failed_retryable'
  else status
end
where status in ('running', 'failed');

alter table public.story_bible_extraction_requests
  add constraint story_bible_extraction_requests_status_check
  check (status in ('processing','completed','failed_retryable','failed_terminal'));

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
  v_sources int := 0;
  v_candidates int := 0;
  v_conflicts int := 0;
  v_summaries int := 0;
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

  if v_existing.status = 'processing' and v_existing.extraction_run_id is distinct from v_run_id then
    raise exception 'STORAGE_REQUEST_IN_PROGRESS: requestId is already processing';
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

  insert into public.story_fact_sources
  select * from jsonb_populate_recordset(null::public.story_fact_sources, coalesce(p_payload->'sourceRows','[]'::jsonb))
  on conflict do nothing;
  get diagnostics v_sources = row_count;

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
    'sourceIds', coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(coalesce(p_payload->'sourceRows','[]'::jsonb)) x), '[]'::jsonb),
    'candidateIds', coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(coalesce(p_payload->'candidateRows','[]'::jsonb)) x), '[]'::jsonb),
    'conflictIds', coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(coalesce(p_payload->'conflictRows','[]'::jsonb)) x), '[]'::jsonb),
    'chapterSummaryIds', jsonb_build_array(p_payload #>> '{chapterSummaryRow,id}'),
    'createdCounts', jsonb_build_object('sources', v_sources, 'candidates', v_candidates, 'conflicts', v_conflicts, 'chapterSummaries', v_summaries),
    'payloadHash', v_hash,
    'requestId', v_request_id,
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

create or replace function public.persist_story_bible_extraction_atomic_fault_fixture(
  p_payload jsonb,
  p_failure_stage text,
  p_test_claim text
)
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
  v_result jsonb;
begin
  if p_test_claim is distinct from 'l0a2e-admin-fixture' then
    raise exception 'STORAGE_TEST_CLAIM_REQUIRED';
  end if;
  if coalesce(v_project_id, '') not like 'l0a2e_fault_%' then
    raise exception 'STORAGE_TEST_PROJECT_REQUIRED';
  end if;

  insert into public.story_bible_extraction_requests(request_id, project_id, payload_hash, extraction_run_id, status)
  values (v_request_id, v_project_id, v_hash, v_run_id, 'processing');
  if p_failure_stage = 'after_idempotency_lock' then raise exception 'FAULT_after_idempotency_lock'; end if;

  insert into public.story_bibles
  select * from jsonb_populate_record(null::public.story_bibles, p_payload->'storyBibleRow')
  on conflict(project_id) do update set
    schema_version = excluded.schema_version,
    status = excluded.status,
    core_json = excluded.core_json,
    updated_at = excluded.updated_at;

  insert into public.story_bible_extraction_runs
  select * from jsonb_populate_record(null::public.story_bible_extraction_runs, p_payload->'extractionRunRow')
  on conflict(id) do update set status = excluded.status;
  if p_failure_stage = 'after_extraction_run_create' then raise exception 'FAULT_after_extraction_run_create'; end if;

  insert into public.story_fact_sources
  select * from jsonb_populate_recordset(null::public.story_fact_sources, coalesce(p_payload->'sourceRows','[]'::jsonb))
  on conflict do nothing;
  if p_failure_stage in ('after_source_insert','after_source_dedup') then raise exception 'FAULT_%', p_failure_stage; end if;

  insert into public.story_fact_candidates
  select * from jsonb_populate_recordset(null::public.story_fact_candidates, coalesce(p_payload->'candidateRows','[]'::jsonb))
  on conflict(id) do nothing;
  if p_failure_stage in ('after_candidate_insert','after_candidate_source_link') then raise exception 'FAULT_%', p_failure_stage; end if;

  insert into public.story_fact_conflicts
  select * from jsonb_populate_recordset(null::public.story_fact_conflicts, coalesce(p_payload->'conflictRows','[]'::jsonb))
  on conflict(id) do nothing;
  if p_failure_stage in ('after_conflict_insert','after_candidate_conflict_link') then raise exception 'FAULT_%', p_failure_stage; end if;

  insert into public.story_chapter_summaries
  select * from jsonb_populate_record(null::public.story_chapter_summaries, p_payload->'chapterSummaryRow')
  on conflict(project_id, chapter_id) do update set summary = excluded.summary, updated_at = excluded.updated_at;
  if p_failure_stage in ('after_chapter_summary_insert','before_run_complete') then raise exception 'FAULT_%', p_failure_stage; end if;

  v_result := jsonb_build_object(
    'extractionRunId', v_run_id,
    'requestId', v_request_id,
    'transactionStatus', 'committed',
    'faultFixture', true
  );

  update public.story_bible_extraction_requests
  set status = 'completed', result_json = v_result, completed_at = now()
  where request_id = v_request_id;
  if p_failure_stage in ('after_run_complete','before_return') then raise exception 'FAULT_%', p_failure_stage; end if;

  return v_result;
end;
$$;

revoke all on function public.persist_story_bible_extraction_atomic_fault_fixture(jsonb, text, text) from public;
revoke all on function public.persist_story_bible_extraction_atomic_fault_fixture(jsonb, text, text) from anon;
revoke all on function public.persist_story_bible_extraction_atomic_fault_fixture(jsonb, text, text) from authenticated;
grant execute on function public.persist_story_bible_extraction_atomic_fault_fixture(jsonb, text, text) to service_role;

insert into public.schema_migrations(version)
values ('p0_l0a2e2_rollback_fixture_contract_014')
on conflict (version) do nothing;
