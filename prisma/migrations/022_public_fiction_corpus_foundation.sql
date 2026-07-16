-- H2D.1 Public Fiction Corpus Foundation
-- This migration establishes metadata, licensing, provenance, visibility,
-- deduplication, and quality-control tables for legally usable fiction corpus
-- material. It intentionally does not import or seed copyrighted full text.

create table if not exists public_corpus_sources (
  source_id text primary key,
  source_type text not null check (source_type in ('PUBLIC_DOMAIN', 'OPEN_LICENSE', 'AUTHOR_AUTHORIZED', 'USER_IMPORTED', 'METADATA_ONLY')),
  display_name text not null,
  homepage_url text,
  jurisdiction text,
  trust_level text not null default 'review_required',
  import_allowed boolean not null default false,
  full_text_allowed boolean not null default false,
  metadata_only boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public_corpus_licenses (
  license_id text primary key,
  source_id text references public_corpus_sources(source_id) on delete cascade,
  license_type text not null check (license_type in ('public_domain', 'cc0', 'cc_by', 'cc_by_sa', 'cc_by_nc', 'author_permission', 'user_owned_private_copy', 'metadata_only', 'unknown', 'blocked')),
  license_name text not null,
  license_url text,
  attribution_required boolean not null default false,
  commercial_allowed boolean not null default false,
  derivative_allowed boolean not null default false,
  full_text_allowed boolean not null default false,
  export_allowed boolean not null default false,
  local_only boolean not null default false,
  decision_status text not null default 'review_required',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public_corpus_license_evidence (
  evidence_id text primary key,
  license_id text not null references public_corpus_licenses(license_id) on delete cascade,
  evidence_type text not null,
  evidence_url text,
  evidence_text text,
  captured_at timestamptz not null default now(),
  captured_by text not null default 'system'
);

create table if not exists public_corpus_authors (
  author_id text primary key,
  canonical_name text not null,
  birth_year integer,
  death_year integer,
  nationality text,
  public_domain_basis text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public_corpus_author_aliases (
  alias_id text primary key,
  author_id text not null references public_corpus_authors(author_id) on delete cascade,
  alias text not null,
  locale text,
  unique(author_id, alias, locale)
);

create table if not exists public_corpus_works (
  work_id text primary key,
  author_id text references public_corpus_authors(author_id) on delete set null,
  canonical_title text not null,
  original_language text,
  first_publication_year integer,
  corpus_scope text not null default 'metadata_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public_corpus_work_titles (
  title_id text primary key,
  work_id text not null references public_corpus_works(work_id) on delete cascade,
  title text not null,
  locale text,
  title_type text not null default 'alias',
  unique(work_id, title, locale)
);

create table if not exists public_corpus_editions (
  edition_id text primary key,
  work_id text not null references public_corpus_works(work_id) on delete cascade,
  source_id text not null references public_corpus_sources(source_id) on delete restrict,
  license_id text references public_corpus_licenses(license_id) on delete set null,
  edition_title text not null,
  edition_language text,
  publication_year integer,
  text_hash text,
  visibility_scope text not null default 'metadata_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public_corpus_translations (
  translation_id text primary key,
  edition_id text not null references public_corpus_editions(edition_id) on delete cascade,
  translator_name text,
  source_language text,
  target_language text not null,
  license_id text references public_corpus_licenses(license_id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public_corpus_volumes (
  volume_id text primary key,
  edition_id text not null references public_corpus_editions(edition_id) on delete cascade,
  volume_title text not null,
  volume_order integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public_corpus_chapters (
  chapter_id text primary key,
  edition_id text not null references public_corpus_editions(edition_id) on delete cascade,
  volume_id text references public_corpus_volumes(volume_id) on delete set null,
  chapter_title text not null,
  chapter_order integer not null default 1,
  word_count integer not null default 0,
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public_corpus_texts (
  text_id text primary key,
  chapter_id text not null references public_corpus_chapters(chapter_id) on delete cascade,
  text_kind text not null default 'full_text',
  text_content text,
  text_hash text,
  storage_scope text not null default 'metadata_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public_corpus_import_jobs (
  job_id text primary key,
  source_id text references public_corpus_sources(source_id) on delete set null,
  job_status text not null default 'created',
  import_scope text not null default 'metadata_only',
  requested_by text not null default 'system',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public_corpus_import_files (
  file_id text primary key,
  job_id text not null references public_corpus_import_jobs(job_id) on delete cascade,
  file_name text not null,
  file_hash text,
  detected_license_id text references public_corpus_licenses(license_id) on delete set null,
  file_status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public_corpus_provenance (
  provenance_id text primary key,
  entity_type text not null,
  entity_id text not null,
  source_id text references public_corpus_sources(source_id) on delete set null,
  license_id text references public_corpus_licenses(license_id) on delete set null,
  origin_url text,
  evidence_id text references public_corpus_license_evidence(evidence_id) on delete set null,
  captured_at timestamptz not null default now()
);

create table if not exists public_corpus_dedup_groups (
  dedup_group_id text primary key,
  canonical_entity_type text not null,
  canonical_entity_id text not null,
  duplicate_entity_type text not null,
  duplicate_entity_id text not null,
  match_type text not null,
  match_score real not null default 0,
  review_status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public_corpus_quality_flags (
  flag_id text primary key,
  entity_type text not null,
  entity_id text not null,
  flag_type text not null,
  severity text not null default 'info',
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public_corpus_visibility_rules (
  rule_id text primary key,
  source_type text not null,
  license_type text not null,
  can_store_full_text boolean not null default false,
  can_analyze_full_text boolean not null default false,
  can_export_full_text boolean not null default false,
  local_only boolean not null default false,
  rule_reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public_corpus_audits (
  audit_id text primary key,
  actor text not null default 'system',
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_public_corpus_authors_name on public_corpus_authors(canonical_name);
create index if not exists idx_public_corpus_works_author on public_corpus_works(author_id);
create index if not exists idx_public_corpus_editions_work on public_corpus_editions(work_id);
create index if not exists idx_public_corpus_chapters_edition on public_corpus_chapters(edition_id);
create index if not exists idx_public_corpus_provenance_entity on public_corpus_provenance(entity_type, entity_id);
create index if not exists idx_public_corpus_quality_entity on public_corpus_quality_flags(entity_type, entity_id);
