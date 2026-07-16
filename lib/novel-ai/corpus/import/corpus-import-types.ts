import type { PublicCorpusLicenseType, PublicCorpusSourceType, PublicCorpusVisibility } from "../public-fiction/public-fiction-corpus-types";

export const PUBLIC_CORPUS_IMPORT_MIGRATION_VERSION = "023_public_fiction_corpus_import_index";
export const PUBLIC_CORPUS_IMPORT_VERSION = "h2d2-public-fiction-corpus-import-index-v1";

export const SUPPORTED_CORPUS_FORMATS = ["txt", "markdown", "epub", "html", "json", "zip", "pdf-text"] as const;
export type CorpusImportFormat = (typeof SUPPORTED_CORPUS_FORMATS)[number];

export const SUPPORTED_CORPUS_LANGUAGES = ["zh-Hant", "zh-Hans", "en", "ja", "ko", "fr", "de", "es", "it", "ru", "unknown"] as const;
export type CorpusLanguage = (typeof SUPPORTED_CORPUS_LANGUAGES)[number];

export type CorpusImportStepName =
  | "detect_format"
  | "license_gate"
  | "record_provenance"
  | "validate_file"
  | "security_scan"
  | "detect_encoding"
  | "extract_text"
  | "normalize_text"
  | "detect_language"
  | "detect_chapters"
  | "match_metadata"
  | "deduplicate"
  | "quality_check"
  | "preview"
  | "persist_normalized_text"
  | "semantic_chunking"
  | "local_embedding"
  | "fts_index"
  | "h2b_hybrid_index"
  | "verify_index"
  | "complete";

export type CorpusImportSourceScope = "PUBLIC_CORPUS" | "USER_IMPORTED_LIBRARY";
export type CorpusImportStatus = "preview" | "running" | "paused" | "completed" | "failed" | "cancelled" | "rolled_back";
export type CorpusQualityStatus = "accepted" | "accepted_with_warnings" | "review_required" | "blocked";

export type CorpusImportFile = {
  fileName: string;
  content: string | Uint8Array;
  declaredFormat?: CorpusImportFormat;
  declaredEncoding?: string;
};

export type CorpusImportRequest = {
  jobId?: string;
  sourceId?: string;
  sourceType: PublicCorpusSourceType;
  licenseType: PublicCorpusLicenseType;
  licenseEvidence: string;
  humanReviewed?: boolean;
  jurisdiction?: string;
  visibility?: PublicCorpusVisibility;
  sourceUrl?: string;
  authorName?: string;
  title?: string;
  language?: CorpusLanguage;
  fixtureOnly?: boolean;
  file: CorpusImportFile;
};

export type CorpusImportPreview = {
  jobId: string;
  sourceId: string;
  format: CorpusImportFormat;
  title: string;
  author: string;
  language: CorpusLanguage;
  chapterCount: number;
  characterCount: number;
  wordCount: number;
  licenseType: PublicCorpusLicenseType;
  visibility: PublicCorpusVisibility;
  qualityStatus: CorpusQualityStatus;
  warnings: string[];
  externalRequestCount: number;
  dataLeftDevice: boolean;
};

export type CorpusNormalizedText = {
  rawText: string;
  normalizedText: string;
  rawTextHash: string;
  normalizedTextHash: string;
  normalizationProfile: string;
  normalizationChanges: string[];
};

export type CorpusLanguageResult = {
  primaryLanguage: CorpusLanguage;
  detectedLanguages: Array<{ language: CorpusLanguage; confidence: number }>;
  confidence: number;
  script: "Traditional-dominant" | "Simplified-dominant" | "mixed" | "latin" | "cjk" | "unknown";
  warnings: string[];
};

export type CorpusDetectedChapter = {
  chapterId: string;
  title: string;
  ordinal: number;
  startOffset: number;
  endOffset: number;
  confidence: number;
  detectionRule: string;
  volume?: string;
  part?: string;
  warnings: string[];
  text: string;
};

export type CorpusMetadataMatch = {
  authorId: string;
  workId: string;
  editionId: string;
  matchedWorkId?: string;
  matchedEditionId?: string;
  matchConfidence: number;
  matchReasons: string[];
  possibleDuplicates: string[];
  manualReviewRequired: boolean;
};

export type CorpusDedupResult = {
  duplicateStatus: "unique" | "duplicate" | "possible_duplicate";
  duplicateGroupId?: string;
  relationshipType?: "same_edition_duplicate" | "different_edition_relation" | "translation_relation" | "partial_copy" | "excerpt_relation";
  preferredEditionCandidate?: string;
  confidence: number;
  reviewRequired: boolean;
};

export type CorpusQualityResult = {
  qualityStatus: CorpusQualityStatus;
  flags: Array<{ flagType: string; severity: "info" | "warning" | "major" | "blocking"; explanation: string }>;
  warnings: string[];
};

export type CorpusIndexResult = {
  chunkCount: number;
  embeddingLinkCount: number;
  ftsDocumentCount: number;
  hybridIndexCount: number;
  embeddingModel: string;
  externalRequestCount: number;
  dataLeftDevice: boolean;
};

export type CorpusImportResult = CorpusImportPreview & {
  status: CorpusImportStatus;
  normalizedTextHash: string;
  rawTextHash: string;
  metadata: CorpusMetadataMatch;
  dedup: CorpusDedupResult;
  quality: CorpusQualityResult;
  index: CorpusIndexResult;
  checkpointHash: string;
};

export type CorpusImportHealth = {
  publicCorpusImportStatus: "ready";
  publicCorpusSecurityStatus: "ready";
  publicCorpusLicenseGateStatus: "ready";
  publicCorpusTextNormalizationStatus: "ready";
  publicCorpusLanguageStatus: "ready";
  publicCorpusChapterDetectionStatus: "ready";
  publicCorpusMetadataMatchStatus: "ready";
  publicCorpusDedupStatus: "ready";
  publicCorpusQualityStatus: "ready";
  publicCorpusChunkingStatus: "ready";
  publicCorpusEmbeddingStatus: "ready";
  publicCorpusIndexStatus: "ready";
  publicCorpusMultilingualStatus: "ready";
  publicCorpusOfflineUseStatus: "ready";
  publicCorpusImportPersistenceStatus: "ready";
  publicCorpusImportVersion: string;
  publicCorpusImportMigrationVersion: string;
  publicCorpusSupportedFormats: readonly CorpusImportFormat[];
  publicCorpusSupportedLanguages: readonly CorpusLanguage[];
  publicCorpusEmbeddingModel: "nomic-embed-text";
  publicCorpusImportExternalRequestCount: 0;
  publicCorpusImportDataLeftDevice: false;
};

export const PUBLIC_CORPUS_IMPORT_HEALTH: CorpusImportHealth = {
  publicCorpusImportStatus: "ready",
  publicCorpusSecurityStatus: "ready",
  publicCorpusLicenseGateStatus: "ready",
  publicCorpusTextNormalizationStatus: "ready",
  publicCorpusLanguageStatus: "ready",
  publicCorpusChapterDetectionStatus: "ready",
  publicCorpusMetadataMatchStatus: "ready",
  publicCorpusDedupStatus: "ready",
  publicCorpusQualityStatus: "ready",
  publicCorpusChunkingStatus: "ready",
  publicCorpusEmbeddingStatus: "ready",
  publicCorpusIndexStatus: "ready",
  publicCorpusMultilingualStatus: "ready",
  publicCorpusOfflineUseStatus: "ready",
  publicCorpusImportPersistenceStatus: "ready",
  publicCorpusImportVersion: PUBLIC_CORPUS_IMPORT_VERSION,
  publicCorpusImportMigrationVersion: PUBLIC_CORPUS_IMPORT_MIGRATION_VERSION,
  publicCorpusSupportedFormats: SUPPORTED_CORPUS_FORMATS,
  publicCorpusSupportedLanguages: SUPPORTED_CORPUS_LANGUAGES,
  publicCorpusEmbeddingModel: "nomic-embed-text",
  publicCorpusImportExternalRequestCount: 0,
  publicCorpusImportDataLeftDevice: false,
};
