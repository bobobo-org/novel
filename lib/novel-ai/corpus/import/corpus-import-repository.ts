import crypto from "crypto";

export type CorpusImportConnection = {
  run(sql: string, params?: unknown[]): unknown;
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
};

function json(value: unknown) { return JSON.stringify(value); }
function bool(value: unknown) { return value ? 1 : 0; }
function now() { return new Date().toISOString(); }
export function corpusId(prefix: string, value: unknown) {
  return `${prefix}_${crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 16)}`;
}

export class CorpusImportRepository {
  readonly projectId: string;
  readonly connection: CorpusImportConnection;

  constructor(options: { projectId: string; connection: CorpusImportConnection }) {
    this.projectId = options.projectId;
    this.connection = options.connection;
  }

  insertStep(jobId: string, stepName: string, status = "completed", details: Record<string, unknown> = {}) {
    const stepId = corpusId("step", { jobId, stepName, status, index: this.countSteps(jobId) });
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_import_steps(project_id, step_id, job_id, step_name, status, elapsed_ms, row_json, created_at)
      VALUES(?,?,?,?,?,?,?,?)`, [this.projectId, stepId, jobId, stepName, status, Number(details.elapsedMs ?? 0), json(details), now()]);
  }

  insertNormalizedText(input: { normalizedTextId: string; sourceId: string; editionId?: string; chapterId?: string; rawTextHash: string; normalizedTextHash: string; normalizationProfile: string; normalizationChanges: string[]; language?: string; textContent: string }) {
    const time = now();
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_normalized_texts(project_id, normalized_text_id, source_id, edition_id, chapter_id, raw_text_hash, normalized_text_hash, normalization_profile, normalization_changes_json, language, text_content, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      this.projectId, input.normalizedTextId, input.sourceId, input.editionId ?? null, input.chapterId ?? null, input.rawTextHash, input.normalizedTextHash,
      input.normalizationProfile, json(input.normalizationChanges), input.language ?? null, input.textContent, json(input), time, time,
    ]);
  }

  insertLanguageResult(input: { languageResultId: string; normalizedTextId: string; primaryLanguage: string; detectedLanguages: unknown[]; confidence: number; script: string; warnings: string[] }) {
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_language_results(project_id, language_result_id, normalized_text_id, primary_language, detected_languages_json, confidence, script, warnings_json, row_json, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, [this.projectId, input.languageResultId, input.normalizedTextId, input.primaryLanguage, json(input.detectedLanguages), input.confidence, input.script, json(input.warnings), json(input), now()]);
  }

  insertChapterDetection(input: { detectionId: string; normalizedTextId: string; chapterCount: number; profile: string; confidence: number; chapters: unknown[]; warnings: string[] }) {
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_chapter_detection(project_id, detection_id, normalized_text_id, chapter_count, profile, confidence, chapters_json, warnings_json, row_json, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, [this.projectId, input.detectionId, input.normalizedTextId, input.chapterCount, input.profile, input.confidence, json(input.chapters), json(input.warnings), json(input), now()]);
  }

  insertImportResult(input: { jobId: string; sourceId: string; workId?: string; editionId?: string; status: string; qualityStatus: string; visibility: string; row: unknown }) {
    const time = now();
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_import_results(project_id, job_id, source_id, work_id, edition_id, status, quality_status, visibility, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [this.projectId, input.jobId, input.sourceId, input.workId ?? null, input.editionId ?? null, input.status, input.qualityStatus, input.visibility, json(input.row), time, time]);
  }

  insertChunkMapping(input: { jobId: string; sourceScope: string; workId?: string; editionId?: string; chapterId?: string; chunkId: string; chunkIndex: number; contentHash: string; row: unknown }) {
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_chunk_mappings(project_id, chunk_mapping_id, job_id, source_scope, work_id, edition_id, chapter_id, chunk_id, chunk_index, content_hash, row_json, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [
      this.projectId, corpusId("chunkmap", { jobId: input.jobId, chunkId: input.chunkId }), input.jobId, input.sourceScope, input.workId ?? null,
      input.editionId ?? null, input.chapterId ?? null, input.chunkId, input.chunkIndex, input.contentHash, json(input.row), now(),
    ]);
  }

  insertIndexJob(input: { indexJobId: string; jobId: string; status: string; sourceScope: string; indexedChunks: number; embeddedChunks: number; row: unknown }) {
    const time = now();
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_index_jobs(project_id, index_job_id, job_id, status, source_scope, indexed_chunks, embedded_chunks, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, [this.projectId, input.indexJobId, input.jobId, input.status, input.sourceScope, input.indexedChunks, input.embeddedChunks, json(input.row), time, time]);
  }

  insertIndexResult(input: { indexResultId: string; indexJobId: string; ftsDocumentCount: number; embeddingLinkCount: number; hybridIndexCount: number; row: unknown }) {
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_index_results(project_id, index_result_id, index_job_id, fts_document_count, embedding_link_count, hybrid_index_count, row_json, created_at)
      VALUES(?,?,?,?,?,?,?,?)`, [this.projectId, input.indexResultId, input.indexJobId, input.ftsDocumentCount, input.embeddingLinkCount, input.hybridIndexCount, json(input.row), now()]);
  }

  insertEmbeddingLink(input: { embeddingLinkId: string; chunkId: string; embeddingProvider: string; embeddingModel: string; embeddingDimensions: number; vectorChecksum: string; row: unknown }) {
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_embedding_links(project_id, embedding_link_id, chunk_id, embedding_provider, embedding_model, embedding_dimensions, vector_checksum, row_json, created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`, [this.projectId, input.embeddingLinkId, input.chunkId, input.embeddingProvider, input.embeddingModel, input.embeddingDimensions, input.vectorChecksum, json(input.row), now()]);
  }

  insertFtsDocument(input: { ftsDocumentId: string; jobId: string; sourceScope: string; workId?: string; editionId?: string; chapterId?: string; language: string; title: string; body: string; contentHash: string; licenseType: string; visibility: string; row: unknown }) {
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_fts_documents(project_id, fts_document_id, job_id, source_scope, work_id, edition_id, chapter_id, language, title, body, content_hash, license_type, visibility, row_json, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      this.projectId, input.ftsDocumentId, input.jobId, input.sourceScope, input.workId ?? null, input.editionId ?? null, input.chapterId ?? null, input.language,
      input.title, input.body, input.contentHash, input.licenseType, input.visibility, json(input.row), now(),
    ]);
  }

  insertError(input: { jobId?: string; errorCode: string; errorType: string; message: string; retryable?: boolean; row?: unknown }) {
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_import_errors(project_id, error_id, job_id, error_code, error_type, message, retryable, row_json, created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`, [this.projectId, corpusId("err", { ...input, at: now() }), input.jobId ?? null, input.errorCode, input.errorType, input.message, bool(input.retryable), json(input.row ?? input), now()]);
  }

  insertCheckpoint(input: { checkpointId: string; jobId: string; currentStep: string; lastCompletedStep?: string; processedBytes: number; processedChapters: number; processedChunks: number; embeddedChunks: number; indexedChunks: number; retryCount?: number; checkpointHash: string; row: unknown }) {
    const time = now();
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_import_checkpoints(project_id, checkpoint_id, job_id, current_step, last_completed_step, processed_bytes, processed_chapters, processed_chunks, embedded_chunks, indexed_chunks, retry_count, checkpoint_hash, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      this.projectId, input.checkpointId, input.jobId, input.currentStep, input.lastCompletedStep ?? null, input.processedBytes, input.processedChapters, input.processedChunks,
      input.embeddedChunks, input.indexedChunks, input.retryCount ?? 0, input.checkpointHash, json(input.row), time, time,
    ]);
  }

  insertRollback(input: { rollbackId: string; jobId: string; rollbackStatus: string; rolledBackRows: number; row: unknown }) {
    const time = now();
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_import_rollbacks(project_id, rollback_id, job_id, rollback_status, rolled_back_rows, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?)`, [this.projectId, input.rollbackId, input.jobId, input.rollbackStatus, input.rolledBackRows, json(input.row), time, time]);
  }

  insertFormatProfile(formatType: string, displayName: string) {
    const time = now();
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_format_profiles(project_id, format_profile_id, format_type, display_name, allow_import, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?)`, [this.projectId, corpusId("format", formatType), formatType, displayName, 1, json({ formatType, displayName }), time, time]);
  }

  count(table: string) {
    return Number(this.connection.get(`SELECT count(*) AS count FROM ${table} WHERE project_id=?`, [this.projectId])?.count ?? 0);
  }

  countSteps(jobId: string) {
    return Number(this.connection.get("SELECT count(*) AS count FROM public_corpus_import_steps WHERE project_id=? AND job_id=?", [this.projectId, jobId])?.count ?? 0);
  }
}
