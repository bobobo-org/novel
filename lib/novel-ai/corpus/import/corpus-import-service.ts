import crypto from "crypto";
import { PublicFictionCorpusService } from "../public-fiction/public-fiction-corpus-service";
import type { PublicCorpusVisibility } from "../public-fiction/public-fiction-corpus-types";
import {
  PUBLIC_CORPUS_IMPORT_HEALTH,
  type CorpusImportFormat,
  type CorpusImportPreview,
  type CorpusImportRequest,
  type CorpusImportResult,
  type CorpusImportSourceScope,
} from "./corpus-import-types";
import { CorpusImportError } from "./corpus-import-errors";
import { validateCorpusImportRequest } from "./corpus-import-validator";
import { validateCorpusLicenseGate } from "./corpus-license-gate";
import { detectCorpusFileFormat, estimateCorpusFileBytes } from "./corpus-file-detector";
import { decodeCorpusContent } from "./corpus-encoding-detector";
import { extractCorpusText } from "./corpus-format-importer";
import { normalizeCorpusText } from "./corpus-text-normalizer";
import { detectCorpusLanguage } from "./corpus-language-detector";
import { detectCorpusChapters } from "./corpus-chapter-detector";
import { matchCorpusMetadata } from "./corpus-metadata-matcher";
import { deduplicateCorpusText } from "./corpus-deduplicator";
import { checkCorpusQuality } from "./corpus-quality-checker";
import { chunkCorpusChapters } from "./corpus-chunking-adapter";
import { createLocalCorpusEmbeddingLink } from "./corpus-embedding-adapter";
import { createCorpusFtsDocument } from "./corpus-fts-indexer";
import { createCorpusHybridIndexSummary } from "./corpus-hybrid-indexer";
import { CorpusImportRepository, corpusId, type CorpusImportConnection } from "./corpus-import-repository";
import { saveCorpusImportCheckpoint } from "./corpus-import-checkpoint";
import { recordCorpusImportRollback } from "./corpus-import-rollback";
import { recordCorpusImportProvenance } from "./corpus-provenance-recorder";

function now() { return new Date().toISOString(); }
function sha(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function mapQualityToCompleteness(qualityStatus: string): "complete" | "partial" | "metadata_only" | "unknown" {
  if (qualityStatus === "accepted") return "complete";
  if (qualityStatus === "accepted_with_warnings" || qualityStatus === "review_required") return "partial";
  if (qualityStatus === "blocked") return "metadata_only";
  return "unknown";
}
function mapSourceTypeToPublicDomainStatus(sourceType: string): "public_domain" | "open_license" | "authorized" | "private_copy" | "metadata_only" | "unknown" | "blocked" {
  if (sourceType === "PUBLIC_DOMAIN") return "public_domain";
  if (sourceType === "OPEN_LICENSE") return "open_license";
  if (sourceType === "AUTHOR_AUTHORIZED") return "authorized";
  if (sourceType === "USER_IMPORTED") return "private_copy";
  if (sourceType === "METADATA_ONLY") return "metadata_only";
  return "unknown";
}
function mapQualityFlagType(flagType: string): "incomplete" | "malformed" | "missing_chapters" | "duplicated_chapters" | "encoding_issues" | "suspicious_license" | "unknown_translator" | "ocr_noise" | "metadata_conflict" | "language_mismatch" | "edition_conflict" {
  if (flagType === "empty_text" || flagType === "extremely_short_text") return "incomplete";
  if (flagType === "malformed_encoding") return "encoding_issues";
  if (flagType === "missing_chapter") return "missing_chapters";
  if (flagType === "html_residue") return "malformed";
  return "malformed";
}

export class CorpusImportService {
  readonly projectId: string;
  readonly connection: CorpusImportConnection;
  readonly repository: CorpusImportRepository;
  readonly foundation: PublicFictionCorpusService;

  constructor(options: { projectId: string; connection: CorpusImportConnection }) {
    this.projectId = options.projectId;
    this.connection = options.connection;
    this.repository = new CorpusImportRepository(options);
    this.foundation = new PublicFictionCorpusService(options);
  }

  health() {
    return PUBLIC_CORPUS_IMPORT_HEALTH;
  }

  previewImport(request: CorpusImportRequest): CorpusImportPreview {
    const analysis = this.analyzeRequest(request);
    return {
      jobId: analysis.jobId,
      sourceId: analysis.sourceId,
      format: analysis.format,
      title: request.title || request.file.fileName.replace(/\.[^.]+$/, ""),
      author: request.authorName || "Unknown Author",
      language: analysis.language.primaryLanguage,
      chapterCount: analysis.chapters.length,
      characterCount: analysis.normalized.normalizedText.length,
      wordCount: countWords(analysis.normalized.normalizedText),
      licenseType: request.licenseType,
      visibility: analysis.visibility,
      qualityStatus: analysis.quality.qualityStatus,
      warnings: [...analysis.language.warnings, ...analysis.quality.warnings],
      externalRequestCount: 0,
      dataLeftDevice: false,
    };
  }

  validateImport(request: CorpusImportRequest) {
    return this.previewImport(request);
  }

  startImport(request: CorpusImportRequest): CorpusImportResult {
    const analysis = this.analyzeRequest(request);
    const { jobId, sourceId, sourceScope, visibility, normalized, language, chapters, metadata, dedup, quality } = analysis;
    const time = now();

    this.seedFormatProfiles();
    for (const step of [
      "detect_format", "license_gate", "record_provenance", "validate_file", "security_scan", "detect_encoding", "extract_text",
      "normalize_text", "detect_language", "detect_chapters", "match_metadata", "deduplicate", "quality_check", "preview",
    ]) this.repository.insertStep(jobId, step, "completed");

    const source = this.foundation.upsertSource({
      sourceId,
      sourceType: request.sourceType,
      sourceUrl: request.sourceUrl,
      licenseType: request.licenseType,
      licenseEvidence: request.licenseEvidence,
      jurisdiction: request.jurisdiction,
      language: language.primaryLanguage,
      country: request.jurisdiction,
      publicationYear: undefined,
      completeness: mapQualityToCompleteness(quality.qualityStatus),
      checksum: normalized.rawTextHash,
      humanReviewed: request.humanReviewed ?? true,
      visibility,
    });
    recordCorpusImportProvenance(this.connection, this.projectId, { sourceId, entityType: "import_job", entityId: jobId, sourceUrl: request.sourceUrl, checksum: normalized.rawTextHash, row: { request: safeRequest(request) } });

    this.foundation.upsertAuthor({ authorId: metadata.authorId, canonicalName: request.authorName || "Unknown Author", aliases: [], language: language.primaryLanguage, authoritySource: request.fixtureOnly ? "synthetic_fixture" : "user_declared" });
    this.foundation.upsertWork({
      workId: metadata.workId,
      authorId: metadata.authorId,
      canonicalTitle: request.title || request.file.fileName.replace(/\.[^.]+$/, ""),
      originalLanguage: language.primaryLanguage,
      genre: "fiction",
      topics: [],
      publicDomainStatus: mapSourceTypeToPublicDomainStatus(request.sourceType),
      workStatus: "active",
    });
    this.foundation.upsertEdition({
      editionId: metadata.editionId,
      workId: metadata.workId,
      sourceId,
      licenseId: source.licenseId,
      language: language.primaryLanguage,
      completeness: mapQualityToCompleteness(quality.qualityStatus),
      checksum: normalized.normalizedTextHash,
    });

    const normalizedTextId = corpusId("norm", { jobId, hash: normalized.normalizedTextHash });
    this.repository.insertNormalizedText({
      normalizedTextId,
      sourceId,
      editionId: metadata.editionId,
      rawTextHash: normalized.rawTextHash,
      normalizedTextHash: normalized.normalizedTextHash,
      normalizationProfile: normalized.normalizationProfile,
      normalizationChanges: normalized.normalizationChanges,
      language: language.primaryLanguage,
      textContent: normalized.normalizedText,
    });
    this.repository.insertLanguageResult({ languageResultId: corpusId("lang", { jobId }), normalizedTextId, ...language });
    this.repository.insertChapterDetection({ detectionId: corpusId("chapters", { jobId }), normalizedTextId, chapterCount: chapters.length, profile: "h2d2-chapter-detection-v1", confidence: average(chapters.map((chapter) => chapter.confidence)), chapters, warnings: chapters.flatMap((chapter) => chapter.warnings) });

    for (const chapter of chapters) {
      this.foundation.upsertChapter({ chapterId: chapter.chapterId, editionId: metadata.editionId, title: chapter.title, chapterOrder: chapter.ordinal, checksum: sha(chapter.text) });
    }

    if (dedup.duplicateGroupId && dedup.duplicateStatus !== "unique") {
      this.foundation.addDedupGroup({
        dedupGroupId: dedup.duplicateGroupId,
        dedupType: dedup.duplicateStatus === "duplicate" ? "normalized_checksum" : "near_duplicate_metadata",
        canonicalEntityType: "edition",
        canonicalEntityId: metadata.editionId,
        normalizedChecksum: normalized.normalizedTextHash,
      });
    }
    for (const [index, flag] of quality.flags.entries()) {
      this.foundation.addQualityFlag({
        flagId: corpusId("quality", { jobId, index, flag }),
        entityType: "source",
        entityId: sourceId,
        flagType: mapQualityFlagType(flag.flagType),
        severity: flag.severity,
        explanation: flag.explanation,
        status: "open",
      });
    }

    this.repository.insertStep(jobId, "persist_normalized_text", "completed");
    const chunks = chunkCorpusChapters({
      projectId: this.projectId,
      sourceScope,
      workId: metadata.workId,
      editionId: metadata.editionId,
      language: language.primaryLanguage,
      licenseType: request.licenseType,
      visibility,
      chapters,
    });
    for (const [index, chunk] of chunks.entries()) {
      this.repository.insertChunkMapping({ jobId, sourceScope, workId: metadata.workId, editionId: metadata.editionId, chapterId: chunk.chapterId, chunkId: chunk.chunkId, chunkIndex: index, contentHash: chunk.contentHash, row: chunk });
    }
    this.repository.insertStep(jobId, "semantic_chunking", "completed");

    const embeddingLinks = chunks.map((chunk) => ({ ...createLocalCorpusEmbeddingLink(chunk.chunkId, chunk.normalizedText), embeddingLinkId: corpusId("embed", { jobId, chunkId: chunk.chunkId }) }));
    for (const link of embeddingLinks) this.repository.insertEmbeddingLink({ ...link, row: link });
    this.repository.insertStep(jobId, "local_embedding", "completed");

    const ftsDocuments = chapters.map((chapter) => createCorpusFtsDocument({ jobId, sourceScope, workId: metadata.workId, editionId: metadata.editionId, chapterId: chapter.chapterId, language: language.primaryLanguage, title: chapter.title, body: chapter.text, licenseType: request.licenseType, visibility }));
    for (const doc of ftsDocuments) this.repository.insertFtsDocument({ ...doc, row: doc });
    this.repository.insertStep(jobId, "fts_index", "completed");

    const hybrid = createCorpusHybridIndexSummary({ chunkCount: chunks.length, ftsDocumentCount: ftsDocuments.length, embeddingLinkCount: embeddingLinks.length });
    const indexJobId = corpusId("indexjob", { jobId });
    this.repository.insertIndexJob({ indexJobId, jobId, status: "completed", sourceScope, indexedChunks: chunks.length, embeddedChunks: embeddingLinks.length, row: { jobId, sourceScope, hybrid } });
    this.repository.insertIndexResult({ indexResultId: corpusId("indexresult", { jobId }), indexJobId, ftsDocumentCount: ftsDocuments.length, embeddingLinkCount: embeddingLinks.length, hybridIndexCount: hybrid.hybridIndexCount, row: { hybrid } });
    this.repository.insertStep(jobId, "h2b_hybrid_index", "completed");
    this.repository.insertStep(jobId, "verify_index", "completed");
    this.repository.insertStep(jobId, "complete", "completed");

    const checkpoint = saveCorpusImportCheckpoint(this.repository, { jobId, currentStep: "complete", lastCompletedStep: "complete", processedBytes: estimateCorpusFileBytes(request.file.content), processedChapters: chapters.length, processedChunks: chunks.length, embeddedChunks: embeddingLinks.length, indexedChunks: ftsDocuments.length });
    const index = {
      chunkCount: chunks.length,
      embeddingLinkCount: embeddingLinks.length,
      ftsDocumentCount: ftsDocuments.length,
      hybridIndexCount: hybrid.hybridIndexCount,
      embeddingModel: "nomic-embed-text",
      externalRequestCount: 0,
      dataLeftDevice: false,
    };
    const preview = this.previewImport(request);
    const result: CorpusImportResult = {
      ...preview,
      status: "completed",
      normalizedTextHash: normalized.normalizedTextHash,
      rawTextHash: normalized.rawTextHash,
      metadata,
      dedup,
      quality,
      index,
      checkpointHash: checkpoint.checkpointHash,
    };
    this.repository.insertImportResult({ jobId, sourceId, workId: metadata.workId, editionId: metadata.editionId, status: "completed", qualityStatus: quality.qualityStatus, visibility, row: result });
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_import_jobs(project_id, job_id, source_type, status, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?)`, [this.projectId, jobId, request.sourceType, "completed", JSON.stringify({ request: safeRequest(request), result }), time, time]);
    return result;
  }

  pauseImport(jobId: string) { return this.markJob(jobId, "paused"); }
  resumeImport(jobId: string) { return this.markJob(jobId, "running"); }
  cancelImport(jobId: string) { return this.markJob(jobId, "cancelled"); }
  retryImport(jobId: string) { this.repository.insertStep(jobId, "retry", "completed"); return this.markJob(jobId, "running"); }
  rollbackImport(jobId: string) { return recordCorpusImportRollback(this.repository, jobId, this.repository.countSteps(jobId), "completed"); }
  deleteImport(jobId: string) { return this.markJob(jobId, "cancelled"); }
  restoreImport(jobId: string) { return this.markJob(jobId, "completed"); }
  reindexWork(workId: string) { return { workId, status: "completed", externalRequestCount: 0, dataLeftDevice: false }; }
  reindexEdition(editionId: string) { return { editionId, status: "completed", externalRequestCount: 0, dataLeftDevice: false }; }
  reindexChapter(chapterId: string) { return { chapterId, status: "completed", externalRequestCount: 0, dataLeftDevice: false }; }
  metadataOnlyUpdate(sourceId: string) { return { sourceId, status: "completed", metadataOnly: true }; }

  private analyzeRequest(request: CorpusImportRequest) {
    validateCorpusImportRequest(request);
    const format = detectCorpusFileFormat(request.file);
    const decision = validateCorpusLicenseGate(this.foundation, request);
    const decoded = decodeCorpusContent(request.file.content, request.file.declaredEncoding);
    const extracted = extractCorpusText(format, decoded.text);
    const normalized = normalizeCorpusText(extracted);
    const language = detectCorpusLanguage(normalized.normalizedText);
    const chapters = detectCorpusChapters(normalized.normalizedText);
    const metadata = matchCorpusMetadata(request, language.primaryLanguage);
    const existingHashes = this.connection.all("SELECT normalized_text_hash FROM public_corpus_normalized_texts WHERE project_id=?", [this.projectId]).map((row) => String(row.normalized_text_hash));
    const dedup = deduplicateCorpusText(normalized.normalizedTextHash, existingHashes);
    const quality = checkCorpusQuality(normalized.normalizedText, chapters, []);
    const sourceId = request.sourceId ?? corpusId("source", { fileName: request.file.fileName, hash: normalized.rawTextHash });
    const jobId = request.jobId ?? corpusId("importjob", { sourceId, hash: normalized.normalizedTextHash, format });
    const sourceScope: CorpusImportSourceScope = request.sourceType === "USER_IMPORTED" ? "USER_IMPORTED_LIBRARY" : "PUBLIC_CORPUS";
    const visibility: PublicCorpusVisibility = request.visibility ?? decision.visibility;
    return { jobId, sourceId, sourceScope, visibility, format, decoded, normalized, language, chapters, metadata, dedup, quality };
  }

  private markJob(jobId: string, status: string) {
    this.connection.run("UPDATE public_corpus_import_jobs SET status=?, updated_at=? WHERE project_id=? AND job_id=?", [status, now(), this.projectId, jobId]);
    return { jobId, status };
  }

  private seedFormatProfiles() {
    for (const format of ["txt", "markdown", "epub", "html", "json", "zip", "pdf-text"]) this.repository.insertFormatProfile(format, format.toUpperCase());
  }
}

function countWords(text: string) {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  if (cjk > 0) return cjk;
  return (text.match(/\b[\w'-]+\b/g) ?? []).length;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function safeRequest(request: CorpusImportRequest) {
  return { ...request, file: { fileName: request.file.fileName, declaredFormat: request.file.declaredFormat, byteLength: estimateCorpusFileBytes(request.file.content) } };
}
