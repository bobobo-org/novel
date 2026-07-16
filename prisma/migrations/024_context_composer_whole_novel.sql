-- H2C Context Composer and Whole-Novel Intelligence.
-- Parity schema for Supabase/Postgres deployments. Runtime tests use the SQLite
-- migration with the same table names and JSON-compatible payload columns.

create table if not exists public.context_composition_jobs (
  project_id text not null,
  job_id text not null,
  branch_id text not null,
  task_type text not null,
  status text not null,
  policy_version text not null,
  token_budget_json jsonb not null default '{}'::jsonb,
  row_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(project_id, job_id)
);

create table if not exists public.context_composition_inputs (
  project_id text not null,
  input_id text not null,
  job_id text not null,
  source_scope text not null,
  row_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(project_id, input_id)
);

create table if not exists public.context_composition_items (
  project_id text not null,
  context_item_id text not null,
  job_id text not null,
  source_scope text not null,
  source_type text not null,
  source_id text not null,
  chunk_id text,
  branch_id text not null,
  version_id text,
  canonical_status text not null,
  visibility text not null,
  retrieval_score numeric not null default 0,
  selected_reason text not null,
  priority integer not null,
  token_count integer not null,
  citation_label text not null,
  row_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(project_id, context_item_id)
);
create index if not exists idx_context_items_job on public.context_composition_items(project_id, job_id, priority);

create table if not exists public.context_composition_outputs (
  project_id text not null,
  output_id text not null,
  job_id text not null,
  used_context_ids_json jsonb not null default '[]'::jsonb,
  omitted_context_json jsonb not null default '[]'::jsonb,
  source_scopes_json jsonb not null default '[]'::jsonb,
  token_utilization numeric not null default 0,
  unsupported_claim_rate numeric not null default 0,
  citation_coverage numeric not null default 0,
  row_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(project_id, output_id)
);

create table if not exists public.context_token_budgets (
  project_id text not null,
  budget_id text not null,
  job_id text not null,
  model_context_limit integer not null,
  reserved_output_tokens integer not null,
  safety_margin integer not null,
  total_available_tokens integer not null,
  used_tokens integer not null,
  omitted_tokens integer not null,
  compressed_tokens integer not null,
  utilization numeric not null default 0,
  overflow_prevented integer not null default 0,
  budget_breakdown_json jsonb not null default '{}'::jsonb,
  row_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(project_id, budget_id)
);

create table if not exists public.context_citations (
  project_id text not null,
  citation_id text not null,
  job_id text not null,
  context_item_id text not null,
  citation_label text not null,
  source_scope text not null,
  source_id text not null,
  evidence_hash text not null,
  row_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(project_id, citation_id)
);

create table if not exists public.context_omissions (
  project_id text not null,
  omission_id text not null,
  job_id text not null,
  source_id text not null,
  reason text not null,
  token_count integer not null,
  row_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(project_id, omission_id)
);

create table if not exists public.context_conflicts (
  project_id text not null,
  context_conflict_id text not null,
  job_id text not null,
  conflict_id text,
  competing_items_json jsonb not null default '[]'::jsonb,
  selected_item_id text,
  selection_reason text not null,
  unresolved integer not null default 0,
  severity text not null,
  suggested_review text not null,
  row_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(project_id, context_conflict_id)
);

create table if not exists public.context_compression_results (
  project_id text not null,
  compression_id text not null,
  job_id text not null,
  source_item_ids_json jsonb not null default '[]'::jsonb,
  original_token_count integer not null,
  compressed_token_count integer not null,
  compression_method text not null,
  preserved_facts_json jsonb not null default '[]'::jsonb,
  omitted_facts_json jsonb not null default '[]'::jsonb,
  warnings_json jsonb not null default '[]'::jsonb,
  content_hash text not null,
  row_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(project_id, compression_id)
);

create table if not exists public.context_validation_results (
  project_id text not null,
  validation_id text not null,
  job_id text not null,
  citation_coverage numeric not null,
  unsupported_claim_rate numeric not null,
  token_overflow_count integer not null default 0,
  branch_leakage_count integer not null default 0,
  canonical_mutation_count integer not null default 0,
  public_corpus_opt_in_violation_count integer not null default 0,
  warnings_json jsonb not null default '[]'::jsonb,
  row_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(project_id, validation_id)
);

create table if not exists public.whole_novel_analysis_jobs (
  project_id text not null,
  job_id text not null,
  branch_id text not null,
  analysis_type text not null,
  status text not null,
  row_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(project_id, job_id)
);

create table if not exists public.whole_novel_analysis_results (
  project_id text not null,
  result_id text not null,
  job_id text not null,
  premise text not null,
  major_arcs_json jsonb not null default '[]'::jsonb,
  major_events_json jsonb not null default '[]'::jsonb,
  unresolved_threads_json jsonb not null default '[]'::jsonb,
  foreshadowing_json jsonb not null default '[]'::jsonb,
  pacing_notes_json jsonb not null default '[]'::jsonb,
  evidence_json jsonb not null default '[]'::jsonb,
  row_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(project_id, result_id)
);

create table if not exists public.character_arc_results (project_id text not null, result_id text not null, job_id text not null, character_id text not null, row_json jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), primary key(project_id, result_id));
create table if not exists public.timeline_results (project_id text not null, result_id text not null, job_id text not null, row_json jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), primary key(project_id, result_id));
create table if not exists public.foreshadow_results (project_id text not null, result_id text not null, job_id text not null, status text not null, row_json jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), primary key(project_id, result_id));
create table if not exists public.open_thread_results (project_id text not null, result_id text not null, job_id text not null, urgency text not null, row_json jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), primary key(project_id, result_id));
create table if not exists public.relationship_progression_results (project_id text not null, result_id text not null, job_id text not null, relationship_id text not null, row_json jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), primary key(project_id, result_id));
create table if not exists public.pacing_analysis_results (project_id text not null, result_id text not null, job_id text not null, pacing_profile text not null, row_json jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), primary key(project_id, result_id));
create table if not exists public.repeated_pattern_results (project_id text not null, result_id text not null, job_id text not null, pattern_type text not null, row_json jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), primary key(project_id, result_id));
create table if not exists public.world_rule_audit_results (project_id text not null, result_id text not null, job_id text not null, severity text not null, row_json jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), primary key(project_id, result_id));
create table if not exists public.branch_comparison_results (project_id text not null, result_id text not null, job_id text not null, branch_ids_json jsonb not null default '[]'::jsonb, row_json jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), primary key(project_id, result_id));
create table if not exists public.public_corpus_comparison_results (project_id text not null, result_id text not null, job_id text not null, selected_works_json jsonb not null default '[]'::jsonb, originality_risks_json jsonb not null default '[]'::jsonb, row_json jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), primary key(project_id, result_id));
create table if not exists public.retrieval_generation_traces (
  project_id text not null,
  trace_id text not null,
  job_id text not null,
  task_type text not null,
  retrieved_context_ids_json jsonb not null default '[]'::jsonb,
  used_context_ids_json jsonb not null default '[]'::jsonb,
  cited_evidence_json jsonb not null default '[]'::jsonb,
  unsupported_claims_json jsonb not null default '[]'::jsonb,
  source_scopes_json jsonb not null default '[]'::jsonb,
  external_request_count integer not null default 0,
  data_left_device integer not null default 0,
  row_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(project_id, trace_id)
);
