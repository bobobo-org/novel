-- L0A.2D Atomic Story Bible extraction persistence RPC.
-- Narrow scope: persist the already validated extraction row payload in one
-- PostgreSQL transaction. Any exception rolls back the entire extraction.

create or replace function public.persist_story_bible_extraction_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id text := p_payload->>'projectId';
  v_run_id text := p_payload #>> '{extractionRunRow,id}';
  v_hash text := md5(p_payload::text);
  v_sources int := 0;
  v_candidates int := 0;
  v_conflicts int := 0;
  v_summaries int := 0;
begin
  if coalesce(v_project_id, '') = '' then
    raise exception 'STORAGE_SCHEMA_INCOMPATIBLE: projectId is required';
  end if;
  if coalesce(v_run_id, '') = '' then
    raise exception 'STORAGE_SCHEMA_INCOMPATIBLE: extractionRunRow.id is required';
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
  on conflict(id) do nothing;
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

  return jsonb_build_object(
    'extractionRunId', v_run_id,
    'sourceIds', coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(coalesce(p_payload->'sourceRows','[]'::jsonb)) x), '[]'::jsonb),
    'candidateIds', coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(coalesce(p_payload->'candidateRows','[]'::jsonb)) x), '[]'::jsonb),
    'conflictIds', coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(coalesce(p_payload->'conflictRows','[]'::jsonb)) x), '[]'::jsonb),
    'chapterSummaryIds', jsonb_build_array(p_payload #>> '{chapterSummaryRow,id}'),
    'createdCounts', jsonb_build_object('sources', v_sources, 'candidates', v_candidates, 'conflicts', v_conflicts, 'chapterSummaries', v_summaries),
    'reusedSourceCount', 0,
    'payloadHash', v_hash,
    'transactionStatus', 'committed',
    'completedAt', now()
  );
end;
$$;

grant execute on function public.persist_story_bible_extraction_atomic(jsonb) to service_role;

insert into public.schema_migrations(version)
values ('p0_l0a2d_atomic_extraction_rpc_012')
on conflict (version) do nothing;
