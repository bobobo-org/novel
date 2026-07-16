-- H2D.2 Public Fiction Corpus Import and Multilingual Index
-- Foundation for local-only import, normalization, multilingual detection,
-- chapter detection, chunk mapping, local embedding links, FTS documents,
-- checkpoint/retry/rollback, and import diagnostics.

create table if not exists public_corpus_normalized_texts (
  project_id text not null,
  normalized_text_id text not null,
  source_id text not null,
  edition_id text,
  chapter_id text,
  raw_text_hash text not null,
  normalized_text_hash text not null,
  normalization_profile text not null,
  normalization_changes_json jsonb not null default '[]'::jsonb,
  language text,
  text_content text not null,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(project_id, normalized_text_id)
);
create index if not exists idx_public_corpus_normalized_source on public_corpus_normalized_texts(project_id, source_id, normalized_text_hash);

create table if not exists public_corpus_language_results (
  project_id text not null,
  language_result_id text not null,
  normalized_text_id text not null,
  primary_language text not null,
  detected_languages_json jsonb not null default '[]'::jsonb,
  confidence real not null,
  script text not null,
  warnings_json jsonb not null default '[]'::jsonb,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key(project_id, language_result_id)
);

create table if not exists public_corpus_chapter_detection (
  project_id text not null,
  detection_id text not null,
  normalized_text_id text not null,
  chapter_count integer not null,
  profile text not null,
  confidence real not null,
  chapters_json jsonb not null default '[]'::jsonb,
  warnings_json jsonb not null default '[]'::jsonb,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key(project_id, detection_id)
);

create table if not exists public_corpus_import_results (
  project_id text not null,
  job_id text not null,
  source_id text not null,
  work_id text,
  edition_id text,
  status text not null,
  quality_status text not null,
  visibility text not null,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(project_id, job_id)
);

create table if not exists public_corpus_import_steps (
  project_id text not null,
  step_id text not null,
  job_id text not null,
  step_name text not null,
  status text not null,
  elapsed_ms integer not null default 0,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key(project_id, step_id)
);

create table if not exists public_corpus_chunk_mappings (
  project_id text not null,
  chunk_mapping_id text not null,
  job_id text not null,
  source_scope text not null,
  work_id text,
  edition_id text,
  chapter_id text,
  chunk_id text not null,
  chunk_index integer not null,
  content_hash text not null,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key(project_id, chunk_mapping_id)
);
create index if not exists idx_public_corpus_chunk_scope on public_corpus_chunk_mappings(project_id, source_scope, work_id, edition_id);

create table if not exists public_corpus_index_jobs (
  project_id text not null,
  index_job_id text not null,
  job_id text not null,
  status text not null,
  source_scope text not null,
  indexed_chunks integer not null default 0,
  embedded_chunks integer not null default 0,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(project_id, index_job_id)
);

create table if not exists public_corpus_index_results (
  project_id text not null,
  index_result_id text not null,
  index_job_id text not null,
  fts_document_count integer not null,
  embedding_link_count integer not null,
  hybrid_index_count integer not null,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key(project_id, index_result_id)
);

create table if not exists public_corpus_embedding_links (
  project_id text not null,
  embedding_link_id text not null,
  chunk_id text not null,
  embedding_provider text not null,
  embedding_model text not null,
  embedding_dimensions integer not null,
  vector_checksum text not null,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key(project_id, embedding_link_id)
);

create table if not exists public_corpus_fts_documents (
  project_id text not null,
  fts_document_id text not null,
  job_id text not null,
  source_scope text not null,
  work_id text,
  edition_id text,
  chapter_id text,
  language text not null,
  title text not null,
  body text not null,
  content_hash text not null,
  license_type text not null,
  visibility text not null,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key(project_id, fts_document_id)
);
create index if not exists idx_public_corpus_fts_scope on public_corpus_fts_documents(project_id, source_scope, language, visibility);

create table if not exists public_corpus_import_errors (
  project_id text not null,
  error_id text not null,
  job_id text,
  error_code text not null,
  error_type text not null,
  message text not null,
  retryable boolean not null default false,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key(project_id, error_id)
);

create table if not exists public_corpus_cleanup_jobs (
  project_id text not null,
  cleanup_job_id text not null,
  job_id text not null,
  cleanup_status text not null,
  removed_rows integer not null default 0,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(project_id, cleanup_job_id)
);

create table if not exists public_corpus_import_checkpoints (
  project_id text not null,
  checkpoint_id text not null,
  job_id text not null,
  current_step text not null,
  last_completed_step text,
  processed_bytes integer not null default 0,
  processed_chapters integer not null default 0,
  processed_chunks integer not null default 0,
  embedded_chunks integer not null default 0,
  indexed_chunks integer not null default 0,
  retry_count integer not null default 0,
  checkpoint_hash text not null,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(project_id, checkpoint_id)
);

create table if not exists public_corpus_import_rollbacks (
  project_id text not null,
  rollback_id text not null,
  job_id text not null,
  rollback_status text not null,
  rolled_back_rows integer not null default 0,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(project_id, rollback_id)
);

create table if not exists public_corpus_format_profiles (
  project_id text not null,
  format_profile_id text not null,
  format_type text not null,
  display_name text not null,
  allow_import boolean not null default true,
  row_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(project_id, format_profile_id)
);
