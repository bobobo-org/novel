import crypto from "crypto";

export type SQLiteMigration = {
  version: number;
  name: string;
  sql: string;
  checksum: string;
};

function checksum(sql: string) {
  return crypto.createHash("sha256").update(sql.trim()).digest("hex");
}

function migration(version: number, name: string, sql: string): SQLiteMigration {
  return { version, name, sql, checksum: checksum(sql) };
}

export const SQLITE_SCHEMA_VERSION = "l0b1_sqlite_foundation_001";

export const SQLITE_MIGRATIONS: SQLiteMigration[] = [
  migration(1, "001_core_projects", `
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS project_storage_policies (
      project_id TEXT PRIMARY KEY,
      row_json TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS story_bibles (
      project_id TEXT PRIMARY KEY,
      row_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      row_json TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `),
  migration(2, "002_story_bible_candidates", `
    CREATE TABLE IF NOT EXISTS extraction_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS extraction_requests (
      request_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_json TEXT,
      row_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      candidate_trust TEXT,
      source_valid INTEGER,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_candidates_project_status ON candidates(project_id, status);
  `),
  migration(3, "003_conflicts", `
    CREATE TABLE IF NOT EXISTS conflicts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      candidate_id TEXT,
      severity TEXT,
      conflict_type TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS candidate_conflicts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      conflict_id TEXT NOT NULL,
      row_json TEXT NOT NULL,
      UNIQUE(project_id, candidate_id, conflict_id),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `),
  migration(4, "004_canonical_entities", `
    CREATE TABLE IF NOT EXISTS canonical_entities (
      project_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      version_number INTEGER NOT NULL DEFAULT 1,
      row_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(project_id, entity_type, entity_id),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_canonical_project_type ON canonical_entities(project_id, entity_type);
  `),
  migration(5, "005_sources_relations", `
    CREATE TABLE IF NOT EXISTS fact_sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      natural_key_hash TEXT NOT NULL,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, natural_key_hash),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS candidate_sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      relation_type TEXT NOT NULL DEFAULT 'evidence',
      row_json TEXT NOT NULL,
      UNIQUE(project_id, candidate_id, source_id, relation_type),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS canonical_source_relations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      source_id TEXT NOT NULL,
      row_json TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `),
  migration(6, "006_versions_history", `
    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      field_path TEXT,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, version_number),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS version_change_sets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      row_json TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `),
  migration(7, "007_integrity", `
    CREATE TABLE IF NOT EXISTS integrity_metadata (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      version_number INTEGER,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `),
  migration(8, "008_mutation_requests", `
    CREATE TABLE IF NOT EXISTS mutation_requests (
      request_id TEXT PRIMARY KEY,
      project_id TEXT,
      status TEXT NOT NULL,
      row_json TEXT NOT NULL,
      response_json TEXT,
      error_json TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `),
  migration(9, "009_export_audits", `
    CREATE TABLE IF NOT EXISTS export_audits (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `),
  migration(10, "010_revert_audits", `
    CREATE TABLE IF NOT EXISTS revert_audits (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `),
  migration(11, "011_extraction_idempotency", `
    CREATE INDEX IF NOT EXISTS idx_extraction_requests_project ON extraction_requests(project_id, request_hash);
    CREATE INDEX IF NOT EXISTS idx_extraction_runs_project ON extraction_runs(project_id);
  `),
  migration(12, "012_source_natural_key", `
    CREATE INDEX IF NOT EXISTS idx_sources_project_natural_key ON fact_sources(project_id, natural_key_hash);
    CREATE TABLE IF NOT EXISTS storage_metadata (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `),
  migration(13, "013_retrieval_embedding_index", `
    CREATE TABLE IF NOT EXISTS retrieval_index_generations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      model_digest TEXT NOT NULL,
      dimensions INTEGER NOT NULL CHECK(dimensions > 0),
      chunking_version TEXT NOT NULL,
      normalization_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('building','validating','active','stale','failed','cancelled')),
      active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
      total_chunks INTEGER NOT NULL DEFAULT 0,
      embedded_chunks INTEGER NOT NULL DEFAULT 0,
      reused_chunks INTEGER NOT NULL DEFAULT 0,
      failed_chunks INTEGER NOT NULL DEFAULT 0,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      completed_at TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_retrieval_active_generation ON retrieval_index_generations(project_id) WHERE active = 1;

    CREATE TABLE IF NOT EXISTS retrieval_chunks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_id TEXT,
      scene_id TEXT,
      content_type TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal > 0),
      start_offset INTEGER NOT NULL CHECK(start_offset >= 0),
      end_offset INTEGER NOT NULL CHECK(end_offset > start_offset),
      normalized_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata_hash TEXT NOT NULL,
      embedding_input_hash TEXT NOT NULL,
      token_estimate INTEGER NOT NULL CHECK(token_estimate > 0),
      chunking_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','stale','deleted')),
      generation_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      row_json TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
      FOREIGN KEY(generation_id) REFERENCES retrieval_index_generations(id) ON DELETE CASCADE,
      UNIQUE(project_id, chapter_id, scene_id, content_type, ordinal, content_hash, chunking_version, generation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_retrieval_chunks_project_status ON retrieval_chunks(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_retrieval_chunks_project_chapter ON retrieval_chunks(project_id, chapter_id);

    CREATE TABLE IF NOT EXISTS retrieval_embeddings (
      chunk_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      model_digest TEXT NOT NULL,
      dimensions INTEGER NOT NULL CHECK(dimensions > 0),
      vector_blob BLOB NOT NULL,
      vector_checksum TEXT NOT NULL,
      normalized INTEGER NOT NULL DEFAULT 1 CHECK(normalized IN (0,1)),
      normalization_version TEXT NOT NULL,
      generation_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(chunk_id, generation_id),
      FOREIGN KEY(chunk_id) REFERENCES retrieval_chunks(id) ON DELETE CASCADE,
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
      FOREIGN KEY(generation_id) REFERENCES retrieval_index_generations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_retrieval_embeddings_project ON retrieval_embeddings(project_id, generation_id);

    CREATE TABLE IF NOT EXISTS retrieval_chunk_entities (
      chunk_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(chunk_id, entity_id),
      FOREIGN KEY(chunk_id) REFERENCES retrieval_chunks(id) ON DELETE CASCADE,
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS retrieval_chunk_events (
      chunk_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(chunk_id, event_id),
      FOREIGN KEY(chunk_id) REFERENCES retrieval_chunks(id) ON DELETE CASCADE,
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS retrieval_chunk_sources (
      chunk_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(chunk_id, source_id),
      FOREIGN KEY(chunk_id) REFERENCES retrieval_chunks(id) ON DELETE CASCADE,
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS retrieval_chunk_relationships (
      chunk_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      relationship_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(chunk_id, relationship_id),
      FOREIGN KEY(chunk_id) REFERENCES retrieval_chunks(id) ON DELETE CASCADE,
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS retrieval_chunk_policy_metadata (
      chunk_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      content_rating TEXT NOT NULL CHECK(content_rating IN ('general','teen','mature','adult')),
      scene_type TEXT NOT NULL CHECK(scene_type IN ('normal','romance','intimacy','violence','horror','other_sensitive')),
      sensitivity_level INTEGER NOT NULL DEFAULT 0 CHECK(sensitivity_level >= 0 AND sensitivity_level <= 5),
      policy_profile_id TEXT,
      adult_verification_status TEXT NOT NULL CHECK(adult_verification_status IN ('not_applicable','verified_adult','unknown','blocked')),
      consent_state TEXT NOT NULL CHECK(consent_state IN ('not_applicable','unspecified','active','withdrawn','invalid')),
      intimacy_stage TEXT NOT NULL CHECK(intimacy_stage IN ('none','setup','approach','consent','escalation','explicit','deescalation','aftermath')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      row_json TEXT NOT NULL,
      FOREIGN KEY(chunk_id) REFERENCES retrieval_chunks(id) ON DELETE CASCADE,
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_retrieval_policy_project ON retrieval_chunk_policy_metadata(project_id, content_rating, scene_type, intimacy_stage);

    CREATE TABLE IF NOT EXISTS retrieval_index_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      generation_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled','resumable')),
      total INTEGER NOT NULL DEFAULT 0,
      processed INTEGER NOT NULL DEFAULT 0,
      reused INTEGER NOT NULL DEFAULT 0,
      embedded INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      current_chapter_id TEXT,
      current_batch INTEGER NOT NULL DEFAULT 0,
      last_checkpoint TEXT,
      error_code TEXT,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_retrieval_jobs_project_status ON retrieval_index_jobs(project_id, status);

    CREATE TABLE IF NOT EXISTS retrieval_model_metadata (
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      model_digest TEXT NOT NULL,
      dimensions INTEGER NOT NULL CHECK(dimensions > 0),
      max_input_tokens INTEGER,
      normalization_version TEXT NOT NULL,
      row_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(project_id, provider, model, model_digest),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `),
];
