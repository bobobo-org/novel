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
];
