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
  migration(14, "014_adult_story_policy", `
    CREATE TABLE IF NOT EXISTS project_adult_policy (
      project_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
      rating TEXT NOT NULL CHECK(rating IN ('E0','E1','E2','E3','E4','E5')),
      explicitness INTEGER NOT NULL DEFAULT 0 CHECK(explicitness >= 0 AND explicitness <= 5),
      direct_language INTEGER NOT NULL DEFAULT 0 CHECK(direct_language IN (0,1)),
      fade_to_black INTEGER NOT NULL DEFAULT 1 CHECK(fade_to_black IN (0,1)),
      pacing TEXT NOT NULL,
      dialogue_ratio INTEGER NOT NULL DEFAULT 35 CHECK(dialogue_ratio >= 0 AND dialogue_ratio <= 100),
      sensory_detail INTEGER NOT NULL DEFAULT 1 CHECK(sensory_detail >= 0 AND sensory_detail <= 5),
      emotional_detail INTEGER NOT NULL DEFAULT 3 CHECK(emotional_detail >= 0 AND emotional_detail <= 5),
      psychological_detail INTEGER NOT NULL DEFAULT 3 CHECK(psychological_detail >= 0 AND psychological_detail <= 5),
      default_scene_length INTEGER NOT NULL DEFAULT 600 CHECK(default_scene_length >= 0),
      aftermath_length INTEGER NOT NULL DEFAULT 150 CHECK(aftermath_length >= 0),
      public_version_mode TEXT NOT NULL,
      generation_mode TEXT NOT NULL,
      policy_version INTEGER NOT NULL DEFAULT 1,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_adult_policy_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      policy_version INTEGER NOT NULL,
      change_reason TEXT NOT NULL,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, policy_version),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_adult_preferences (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      preference_key TEXT NOT NULL,
      preference_value TEXT NOT NULL,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, preference_key),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_adult_exclusions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      exclusion_key TEXT NOT NULL,
      reason TEXT,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, exclusion_key),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS character_adult_assertions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      age_value INTEGER,
      age_source TEXT NOT NULL,
      verification_status TEXT NOT NULL CHECK(verification_status IN ('verified_adult','verified_minor','unknown','conflicting','revoked')),
      canonical_entity_id TEXT,
      verified_at TEXT,
      verification_version INTEGER NOT NULL DEFAULT 1,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, character_id),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_character_adult_assertions_project_status ON character_adult_assertions(project_id, verification_status);

    CREATE TABLE IF NOT EXISTS relationship_intimacy_rules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      relationship_id TEXT NOT NULL,
      participant_ids_json TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      relationship_stage TEXT NOT NULL,
      intimacy_allowed INTEGER NOT NULL DEFAULT 0 CHECK(intimacy_allowed IN (0,1)),
      allowed_from_chapter INTEGER,
      required_events_json TEXT NOT NULL,
      forbidden_events_json TEXT NOT NULL,
      exclusivity_rule TEXT,
      public_risk INTEGER NOT NULL DEFAULT 0 CHECK(public_risk >= 0 AND public_risk <= 5),
      trust_level INTEGER NOT NULL DEFAULT 0 CHECK(trust_level >= 0 AND trust_level <= 5),
      attraction_level INTEGER NOT NULL DEFAULT 0 CHECK(attraction_level >= 0 AND attraction_level <= 5),
      resentment_level INTEGER NOT NULL DEFAULT 0 CHECK(resentment_level >= 0 AND resentment_level <= 5),
      power_balance TEXT,
      consequence_profile TEXT,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, relationship_id),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS adult_policy_audits (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      policy_version INTEGER,
      action TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      prompt_template_version TEXT,
      validation_status TEXT NOT NULL,
      data_left_device INTEGER NOT NULL DEFAULT 0 CHECK(data_left_device IN (0,1)),
      external_request_count INTEGER NOT NULL DEFAULT 0,
      output_hash TEXT,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_adult_policy_audits_project ON adult_policy_audits(project_id, created_at);

    CREATE TABLE IF NOT EXISTS adult_policy_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      title TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, profile_id),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `),
  migration(15, "015_adult_taxonomy_scenarios", `
    CREATE TABLE IF NOT EXISTS adult_taxonomy_categories (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS adult_taxonomy_tags (
      id TEXT PRIMARY KEY,
      tag_id TEXT NOT NULL UNIQUE,
      category_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      adult_only INTEGER NOT NULL DEFAULT 0 CHECK(adult_only IN (0,1)),
      minimum_rating TEXT NOT NULL CHECK(minimum_rating IN ('E0','E1','E2','E3','E4','E5')),
      default_weight REAL NOT NULL DEFAULT 1,
      preference_weight REAL NOT NULL DEFAULT 1,
      novelty_weight REAL NOT NULL DEFAULT 1,
      repetition_weight REAL NOT NULL DEFAULT 1,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(category_id) REFERENCES adult_taxonomy_categories(category_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_adult_tags_category ON adult_taxonomy_tags(category_id, enabled);

    CREATE TABLE IF NOT EXISTS adult_tag_aliases (
      tag_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      alias_normalized TEXT NOT NULL,
      PRIMARY KEY(tag_id, alias_normalized),
      FOREIGN KEY(tag_id) REFERENCES adult_taxonomy_tags(tag_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS adult_tag_compatibility (
      tag_id TEXT NOT NULL,
      compatible_tag_id TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      PRIMARY KEY(tag_id, compatible_tag_id),
      FOREIGN KEY(tag_id) REFERENCES adult_taxonomy_tags(tag_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS adult_tag_requirements (
      tag_id TEXT NOT NULL,
      required_tag_id TEXT NOT NULL,
      PRIMARY KEY(tag_id, required_tag_id),
      FOREIGN KEY(tag_id) REFERENCES adult_taxonomy_tags(tag_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS adult_tag_exclusions (
      tag_id TEXT NOT NULL,
      excluded_tag_id TEXT NOT NULL,
      PRIMARY KEY(tag_id, excluded_tag_id),
      FOREIGN KEY(tag_id) REFERENCES adult_taxonomy_tags(tag_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS adult_scenario_packs (
      id TEXT PRIMARY KEY,
      scenario_pack_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      premise TEXT NOT NULL,
      participant_roles_json TEXT NOT NULL,
      required_relationship_stages_json TEXT NOT NULL,
      required_setup_json TEXT NOT NULL,
      location_options_json TEXT NOT NULL,
      emotional_tone_options_json TEXT NOT NULL,
      stage_template_json TEXT NOT NULL,
      narrative_purpose TEXT NOT NULL,
      consequence_template TEXT NOT NULL,
      compatible_tags_json TEXT NOT NULL,
      incompatible_tags_json TEXT NOT NULL,
      rating_min TEXT NOT NULL CHECK(rating_min IN ('E0','E1','E2','E3','E4','E5')),
      rating_max TEXT NOT NULL CHECK(rating_max IN ('E0','E1','E2','E3','E4','E5')),
      version INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS adult_scenario_pack_tags (
      scenario_pack_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY(scenario_pack_id, tag_id),
      FOREIGN KEY(scenario_pack_id) REFERENCES adult_scenario_packs(scenario_pack_id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES adult_taxonomy_tags(tag_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS adult_scenario_pack_versions (
      id TEXT PRIMARY KEY,
      scenario_pack_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(scenario_pack_id, version)
    );

    CREATE TABLE IF NOT EXISTS adult_scenario_usage (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scenario_pack_id TEXT NOT NULL,
      used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      row_json TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_adult_scenario_usage_project ON adult_scenario_usage(project_id, scenario_pack_id, used_at);

    CREATE TABLE IF NOT EXISTS adult_scenario_favorites (
      project_id TEXT NOT NULL,
      scenario_pack_id TEXT NOT NULL,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(project_id, scenario_pack_id),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS adult_scenario_hidden (
      project_id TEXT NOT NULL,
      scenario_pack_id TEXT NOT NULL,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(project_id, scenario_pack_id),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS adult_scenario_feedback (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scenario_pack_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      feedback_text TEXT,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_adult_taxonomy_preferences (
      project_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      row_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(project_id, tag_id),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_adult_taxonomy_exclusions (
      project_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      reason TEXT,
      row_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(project_id, tag_id),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `),
  migration(16, "016_segmented_scene_state_machine", `
    CREATE TABLE IF NOT EXISTS intimacy_scenes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_id TEXT,
      branch_id TEXT NOT NULL,
      scenario_pack_id TEXT,
      policy_version INTEGER NOT NULL,
      rating TEXT NOT NULL,
      explicitness INTEGER NOT NULL DEFAULT 0 CHECK(explicitness >= 0 AND explicitness <= 5),
      title TEXT NOT NULL,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('planned','ready','active','paused','completed','cancelled','blocked','archived')),
      current_stage_id TEXT,
      current_stage_type TEXT,
      planned_stage_count INTEGER NOT NULL DEFAULT 0,
      approved_stage_count INTEGER NOT NULL DEFAULT 0,
      participant_count INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_intimacy_scenes_project_status ON intimacy_scenes(project_id, status, branch_id);

    CREATE TABLE IF NOT EXISTS intimacy_scene_participants (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      role TEXT NOT NULL,
      verified_adult_status TEXT NOT NULL,
      relationship_id TEXT,
      relationship_stage TEXT,
      consent_state TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0,1)),
      ordinal INTEGER NOT NULL,
      joined_at TEXT NOT NULL,
      left_at TEXT,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, scene_id, participant_id),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
      FOREIGN KEY(scene_id) REFERENCES intimacy_scenes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS intimacy_scene_stages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      stage_type TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      target_length INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('planned','ready','active','paused','draft_ready','approved','rejected','failed','cancelled','superseded','archived','skipped')),
      current_version_id TEXT,
      previous_stage_id TEXT,
      next_stage_id TEXT,
      required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0,1)),
      skippable INTEGER NOT NULL DEFAULT 0 CHECK(skippable IN (0,1)),
      version INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, scene_id, branch_id, stage_id),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
      FOREIGN KEY(scene_id) REFERENCES intimacy_scenes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_intimacy_stages_scene_status ON intimacy_scene_stages(project_id, scene_id, status);

    CREATE TABLE IF NOT EXISTS intimacy_scene_stage_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      parent_version_id TEXT,
      operation TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','current','approved','rejected','superseded','restored','archived')),
      goal_snapshot TEXT NOT NULL,
      continuity_input_hash TEXT NOT NULL,
      policy_version INTEGER NOT NULL,
      prompt_template_version TEXT NOT NULL,
      draft_text TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      superseded_at TEXT,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, version_id),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
      FOREIGN KEY(scene_id) REFERENCES intimacy_scenes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_intimacy_versions_stage ON intimacy_scene_stage_versions(project_id, scene_id, stage_id, status);

    CREATE TABLE IF NOT EXISTS intimacy_continuity_states (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      stage_id TEXT,
      version_id TEXT,
      branch_id TEXT NOT NULL,
      continuity_version INTEGER NOT NULL DEFAULT 1,
      before_snapshot_json TEXT,
      after_snapshot_json TEXT,
      delta_json TEXT,
      validation_result_json TEXT,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
      FOREIGN KEY(scene_id) REFERENCES intimacy_scenes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS intimacy_scene_branches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      parent_branch_id TEXT,
      divergence_stage_id TEXT,
      divergence_version_id TEXT,
      branch_name TEXT NOT NULL,
      branch_status TEXT NOT NULL CHECK(branch_status IN ('active','paused','completed','rejected','archived')),
      continuity_snapshot_id TEXT,
      policy_version INTEGER NOT NULL,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, scene_id, branch_id),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
      FOREIGN KEY(scene_id) REFERENCES intimacy_scenes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS intimacy_scene_transitions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      stage_id TEXT,
      branch_id TEXT,
      transition_type TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      next_status TEXT NOT NULL,
      validation_result_json TEXT NOT NULL,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
      FOREIGN KEY(scene_id) REFERENCES intimacy_scenes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS intimacy_scene_audits (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scene_id TEXT,
      stage_id TEXT,
      version_id TEXT,
      branch_id TEXT,
      action TEXT NOT NULL,
      previous_status TEXT,
      next_status TEXT,
      policy_version INTEGER,
      validation_result_json TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      content_hash TEXT,
      summary_hash TEXT,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_intimacy_audits_project_scene ON intimacy_scene_audits(project_id, scene_id, created_at);

    CREATE TABLE IF NOT EXISTS intimacy_scene_drafts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      stage_id TEXT,
      branch_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('candidate','accepted','rejected','archived')),
      summary TEXT NOT NULL,
      draft_text TEXT NOT NULL,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
      FOREIGN KEY(scene_id) REFERENCES intimacy_scenes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS intimacy_scene_stage_dependencies (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      depends_on_stage_id TEXT NOT NULL,
      dependency_type TEXT NOT NULL,
      required_status TEXT NOT NULL,
      condition_json TEXT NOT NULL,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, scene_id, stage_id, depends_on_stage_id, dependency_type),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
      FOREIGN KEY(scene_id) REFERENCES intimacy_scenes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS intimacy_scene_stage_requirements (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      requirement_type TEXT NOT NULL,
      requirement_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','met','waived','blocked')),
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
      FOREIGN KEY(scene_id) REFERENCES intimacy_scenes(id) ON DELETE CASCADE
    );
  `),
];
