export const PUBLIC_FICTION_CORPUS_MIGRATION_VERSION = "022_public_fiction_corpus_foundation";
export const PUBLIC_FICTION_CORPUS_VERSION = "h2d1-public-fiction-corpus-foundation-v1";

export type PublicCorpusSourceType =
  | "PUBLIC_DOMAIN"
  | "OPEN_LICENSE"
  | "AUTHOR_AUTHORIZED"
  | "USER_IMPORTED"
  | "METADATA_ONLY";

export type PublicCorpusLicenseType =
  | "public_domain"
  | "cc0"
  | "cc_by"
  | "cc_by_sa"
  | "cc_by_nc"
  | "author_permission"
  | "user_owned_private_copy"
  | "metadata_only"
  | "unknown"
  | "blocked";

export type PublicCorpusVisibility = "public_reference" | "private" | "local_only" | "metadata_only" | "blocked";

export type PublicCorpusSourceInput = {
  sourceId: string;
  sourceType: PublicCorpusSourceType;
  sourceUrl?: string;
  licenseType: PublicCorpusLicenseType;
  licenseEvidence: string;
  jurisdiction?: string;
  language: string;
  country?: string;
  publicationYear?: number;
  completeness: "complete" | "partial" | "metadata_only" | "unknown";
  checksum: string;
  humanReviewed?: boolean;
  visibility?: PublicCorpusVisibility;
};

export type PublicCorpusAuthorInput = {
  authorId: string;
  canonicalName: string;
  aliases?: string[];
  birthYear?: number;
  deathYear?: number;
  nationality?: string;
  language?: string;
  authoritySource?: string;
};

export type PublicCorpusWorkInput = {
  workId: string;
  authorId: string;
  canonicalTitle: string;
  alternateTitles?: string[];
  originalLanguage: string;
  firstPublicationYear?: number;
  genre?: string;
  topics?: string[];
  publicDomainStatus: "public_domain" | "open_license" | "authorized" | "private_copy" | "metadata_only" | "unknown" | "blocked";
  copyrightJurisdiction?: string;
  workStatus: "active" | "complete" | "incomplete" | "blocked" | "metadata_only";
};

export type PublicCorpusEditionInput = {
  editionId: string;
  workId: string;
  sourceId: string;
  publisher?: string;
  publicationYear?: number;
  language: string;
  translator?: string;
  licenseId?: string;
  completeness: "complete" | "partial" | "metadata_only" | "unknown";
  checksum: string;
};

export type PublicCorpusChapterInput = {
  chapterId: string;
  editionId: string;
  volumeId?: string;
  title: string;
  chapterOrder: number;
  checksum: string;
};

export type PublicCorpusDedupInput = {
  dedupGroupId: string;
  dedupType: "exact_checksum" | "normalized_checksum" | "title_author_match" | "chapter_sequence_match" | "near_duplicate_metadata" | "translation_relationship" | "edition_relationship";
  canonicalEntityType: "source" | "author" | "work" | "edition" | "chapter";
  canonicalEntityId: string;
  exactChecksum?: string;
  normalizedChecksum?: string;
};

export type PublicCorpusQualityFlagInput = {
  flagId: string;
  entityType: "source" | "author" | "work" | "edition" | "chapter" | "text";
  entityId: string;
  flagType: "incomplete" | "malformed" | "missing_chapters" | "duplicated_chapters" | "encoding_issues" | "suspicious_license" | "unknown_translator" | "ocr_noise" | "metadata_conflict" | "language_mismatch" | "edition_conflict";
  severity: "info" | "warning" | "major" | "blocking";
  explanation: string;
  status?: "open" | "acknowledged" | "resolved";
};

export type PublicCorpusLicenseDecision = {
  licenseStatus: "allowed" | "review_required" | "blocked";
  allowFullTextAnalysis: boolean;
  allowDerivativeReference: boolean;
  allowExport: boolean;
  visibility: PublicCorpusVisibility;
  reason: string;
};
