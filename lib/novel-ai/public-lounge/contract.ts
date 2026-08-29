import {
  PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION,
  PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_POST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_QUALITY_RUBRIC,
  PUBLIC_LOUNGE_QUALITY_THRESHOLD,
  type PublicLoungeOfficialChapterInput,
  type PublicLoungeEligibilityRequest,
  type PublicLoungePost,
  type PublicLoungePostSummary,
  type PublicLoungePublicationInput,
  type PublicLoungeQualityDimensionKey,
  type PublicLoungeServerReviewAttestation,
} from "./types";

export const PUBLIC_LOUNGE_MAX_REQUEST_BYTES = 2_500_000;
export const PUBLIC_LOUNGE_MAX_PUBLIC_CHAPTERS = 300;

export type PublicLoungeErrorCode =
  | "PUBLIC_LOUNGE_NOT_CONNECTED"
  | "PUBLIC_LOUNGE_PAYLOAD_INVALID"
  | "PUBLIC_LOUNGE_PAYLOAD_TOO_LARGE"
  | "PUBLIC_LOUNGE_FORBIDDEN_FIELD"
  | "PUBLIC_LOUNGE_CONSENT_REQUIRED"
  | "PUBLIC_LOUNGE_RIGHTS_DECLARATION_REQUIRED"
  | "PUBLIC_LOUNGE_WORK_NOT_COMPLETED"
  | "PUBLIC_LOUNGE_SCORE_NOT_QUALIFIED"
  | "PUBLIC_LOUNGE_ELIGIBILITY_REQUIRED"
  | "PUBLIC_LOUNGE_ELIGIBILITY_INVALID"
  | "PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED"
  | "PUBLIC_LOUNGE_ELIGIBILITY_EXPIRED"
  | "PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED"
  | "PUBLIC_LOUNGE_TRUSTED_REVIEW_CONSENT_REQUIRED"
  | "PUBLIC_LOUNGE_CURSOR_INVALID"
  | "PUBLIC_LOUNGE_CATALOG_LIMIT"
  | "PUBLIC_LOUNGE_NOT_FOUND"
  | "PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED"
  | "PUBLIC_LOUNGE_MANAGEMENT_TOKEN_INVALID"
  | "PUBLIC_LOUNGE_ORIGIN_INVALID"
  | "PUBLIC_LOUNGE_RATE_LIMITED";

export class PublicLoungeError extends Error {
  readonly code: PublicLoungeErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: PublicLoungeErrorCode, status: number, retryable = false) {
    super(code);
    this.name = "PublicLoungeError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const PUBLICATION_KEYS = new Set([
  "schemaVersion",
  "title",
  "authorByline",
  "category",
  "completionStatus",
  "chapterCount",
  "wordCount",
  "completedAt",
  "qualityScore",
  "qualityBreakdown",
  "fullSynopsis",
  "publicChapters",
  "eligibilityTicket",
  "explicitConsent",
  "authorRightsDeclaration",
  "workCompleted",
]);
const ELIGIBILITY_REQUEST_KEYS = new Set([
  "schemaVersion",
  "completionFingerprint",
  "title",
  "authorByline",
  "category",
  "completionStatus",
  "chapterCount",
  "wordCount",
  "completedAt",
  "fullSynopsis",
  "publicChapters",
  "serverAttestation",
  "explicitConsent",
  "authorRightsDeclaration",
  "workCompleted",
  "trustedServerReviewConsent",
]);
const CHAPTER_KEYS = new Set(["chapterNumber", "title", "body", "official"]);
const ATTESTATION_KEYS = new Set([
  "schemaVersion",
  "issuer",
  "keyId",
  "nonce",
  "issuedAt",
  "expiresAt",
  "completionFingerprint",
  "publicationDigest",
  "qualityScore",
  "qualityBreakdown",
  "workCompleted",
  "fullCoverage",
  "backendId",
  "modelId",
  "modelDigest",
  "rawContentStored",
  "signature",
]);
const QUALITY_KEYS = new Set<string>(PUBLIC_LOUNGE_QUALITY_RUBRIC.map((item) => item.key));
const PUBLIC_ID_PATTERN = /^novel_[a-z0-9_-]{12,80}$/u;
const ELIGIBILITY_TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const FORBIDDEN_KEY_PATTERN = /(?:project[_-]?id|private|canon|prompt|trace|backup|completionfingerprint|reviewid|provenance|rawnovel|model)/iu;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const BIDI_OVERRIDE_PATTERN = /[\u202A-\u202E\u2066-\u2069]/gu;

function fail(code: PublicLoungeErrorCode, status = 422): never {
  throw new PublicLoungeError(code, status);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 400);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: Set<string>) {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    if (FORBIDDEN_KEY_PATTERN.test(key)) fail("PUBLIC_LOUNGE_FORBIDDEN_FIELD", 400);
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 400);
  }
}

function cleanText(value: unknown, options: {
  field: "inline" | "prose";
  min: number;
  max: number;
}) {
  if (typeof value !== "string") fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
  let cleaned = value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(CONTROL_CHARACTER_PATTERN, "")
    .replace(BIDI_OVERRIDE_PATTERN, "");
  cleaned = options.field === "inline"
    ? cleaned.replace(/\s+/gu, " ").trim()
    : cleaned.replace(/[ \t]+\n/gu, "\n").trim();
  if (cleaned.length < options.min || cleaned.length > options.max) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
  }
  return cleaned;
}

function positiveInteger(value: unknown, max: number) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
  }
  return Number(value);
}

export function isCanonicalIsoTime(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

export function parsePublicLoungeQualityBreakdown(value: unknown) {
  const raw = record(value);
  assertAllowedKeys(raw, QUALITY_KEYS);
  if (Object.keys(raw).length !== PUBLIC_LOUNGE_QUALITY_RUBRIC.length) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
  }
  return Object.fromEntries(PUBLIC_LOUNGE_QUALITY_RUBRIC.map((rubric) => {
    const score = raw[rubric.key];
    if (!Number.isInteger(score) || Number(score) < 0 || Number(score) > 100) {
      fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
    }
    return [rubric.key, Number(score)];
  })) as Record<PublicLoungeQualityDimensionKey, number>;
}

function parsePublicChapters(value: unknown, chapterCount: number): PublicLoungeOfficialChapterInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > PUBLIC_LOUNGE_MAX_PUBLIC_CHAPTERS) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
  }
  const seen = new Set<number>();
  let totalCharacters = 0;
  const chapters = value.map((candidate) => {
    const raw = record(candidate);
    assertAllowedKeys(raw, CHAPTER_KEYS);
    if (Object.keys(raw).length !== CHAPTER_KEYS.size || raw.official !== true) {
      fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
    }
    const chapterNumber = positiveInteger(raw.chapterNumber, chapterCount);
    if (seen.has(chapterNumber)) fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
    seen.add(chapterNumber);
    const title = cleanText(raw.title, { field: "inline", min: 1, max: 160 });
    const body = cleanText(raw.body, { field: "prose", min: 1, max: 250_000 });
    totalCharacters += title.length + body.length;
    if (totalCharacters > 2_000_000) fail("PUBLIC_LOUNGE_PAYLOAD_TOO_LARGE", 413);
    return { chapterNumber, title, body, official: true as const };
  });
  return chapters.sort((left, right) => left.chapterNumber - right.chapterNumber);
}

function weightedQualityScore(breakdown: Record<PublicLoungeQualityDimensionKey, number>) {
  const weighted = PUBLIC_LOUNGE_QUALITY_RUBRIC.reduce(
    (sum, rubric) => sum + breakdown[rubric.key] * rubric.weight,
    0,
  );
  return Math.round(weighted / 100);
}

export function validatePublicLoungeQuality(value: {
  qualityScore: unknown;
  qualityBreakdown: unknown;
}) {
  if (!Number.isInteger(value.qualityScore)) fail("PUBLIC_LOUNGE_SCORE_NOT_QUALIFIED");
  const qualityScore = Number(value.qualityScore);
  if (qualityScore < PUBLIC_LOUNGE_QUALITY_THRESHOLD || qualityScore > 100) {
    fail("PUBLIC_LOUNGE_SCORE_NOT_QUALIFIED");
  }
  const qualityBreakdown = parsePublicLoungeQualityBreakdown(value.qualityBreakdown);
  if (weightedQualityScore(qualityBreakdown) !== qualityScore) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
  }
  return { qualityScore, qualityBreakdown };
}

export function validatePublicLoungePublicationInput(value: unknown): PublicLoungePublicationInput {
  const raw = record(value);
  assertAllowedKeys(raw, PUBLICATION_KEYS);
  if (Object.keys(raw).length !== PUBLICATION_KEYS.size) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 400);
  }
  if (raw.schemaVersion !== PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 400);
  }
  if (raw.explicitConsent !== true) fail("PUBLIC_LOUNGE_CONSENT_REQUIRED");
  if (raw.authorRightsDeclaration !== true) fail("PUBLIC_LOUNGE_RIGHTS_DECLARATION_REQUIRED");
  if (raw.workCompleted !== true || raw.completionStatus !== "completed") {
    fail("PUBLIC_LOUNGE_WORK_NOT_COMPLETED");
  }
  const { qualityScore, qualityBreakdown } = validatePublicLoungeQuality({
    qualityScore: raw.qualityScore,
    qualityBreakdown: raw.qualityBreakdown,
  });
  if (typeof raw.eligibilityTicket !== "string" || !ELIGIBILITY_TICKET_PATTERN.test(raw.eligibilityTicket)) {
    fail("PUBLIC_LOUNGE_ELIGIBILITY_REQUIRED", 403);
  }
  const chapterCount = positiveInteger(raw.chapterCount, 100_000);
  const wordCount = positiveInteger(raw.wordCount, 2_000_000_000);
  if (!isCanonicalIsoTime(raw.completedAt)) fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
  return {
    schemaVersion: PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
    title: cleanText(raw.title, { field: "inline", min: 1, max: 120 }),
    authorByline: cleanText(raw.authorByline, { field: "inline", min: 1, max: 80 }),
    category: cleanText(raw.category, { field: "inline", min: 1, max: 48 }),
    completionStatus: "completed",
    chapterCount,
    wordCount,
    completedAt: raw.completedAt,
    qualityScore,
    qualityBreakdown,
    fullSynopsis: cleanText(raw.fullSynopsis, { field: "prose", min: 1, max: 50_000 }),
    publicChapters: parsePublicChapters(raw.publicChapters, chapterCount),
    eligibilityTicket: raw.eligibilityTicket,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
  };
}

function parseServerAttestation(value: unknown): PublicLoungeServerReviewAttestation {
  const raw = record(value);
  assertAllowedKeys(raw, ATTESTATION_KEYS);
  const quality = validatePublicLoungeQuality({
    qualityScore: raw.qualityScore,
    qualityBreakdown: raw.qualityBreakdown,
  });
  if (
    Object.keys(raw).length !== ATTESTATION_KEYS.size
    || raw.schemaVersion !== "public-lounge-server-review-attestation-v1"
    || raw.issuer !== "private-ai-hub"
    || raw.backendId !== "private-ai-hub"
    || raw.workCompleted !== true
    || raw.fullCoverage !== true
    || raw.rawContentStored !== false
    || typeof raw.keyId !== "string"
    || !/^[A-Za-z0-9._-]{1,120}$/u.test(raw.keyId)
    || typeof raw.nonce !== "string"
    || !/^[A-Za-z0-9_-]{22,128}$/u.test(raw.nonce)
    || typeof raw.completionFingerprint !== "string"
    || !/^[a-f0-9]{64}$/u.test(raw.completionFingerprint)
    || typeof raw.publicationDigest !== "string"
    || !/^[a-f0-9]{64}$/u.test(raw.publicationDigest)
    || typeof raw.modelId !== "string"
    || !raw.modelId.trim()
    || raw.modelId.length > 160
    || typeof raw.modelDigest !== "string"
    || !/^[a-f0-9]{64}$/u.test(raw.modelDigest)
    || typeof raw.signature !== "string"
    || !/^[A-Za-z0-9_-]{86}$/u.test(raw.signature)
    || !isCanonicalIsoTime(raw.issuedAt)
    || !isCanonicalIsoTime(raw.expiresAt)
    || Date.parse(raw.expiresAt) <= Date.parse(raw.issuedAt)
    || Date.parse(raw.expiresAt) - Date.parse(raw.issuedAt) > 30 * 60_000
  ) {
    fail("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
  }
  return {
    schemaVersion: "public-lounge-server-review-attestation-v1",
    issuer: "private-ai-hub",
    keyId: raw.keyId,
    nonce: raw.nonce,
    issuedAt: raw.issuedAt,
    expiresAt: raw.expiresAt,
    completionFingerprint: raw.completionFingerprint,
    publicationDigest: raw.publicationDigest,
    qualityScore: quality.qualityScore,
    qualityBreakdown: quality.qualityBreakdown,
    workCompleted: true,
    fullCoverage: true,
    backendId: "private-ai-hub",
    modelId: raw.modelId.trim(),
    modelDigest: raw.modelDigest,
    rawContentStored: false,
    signature: raw.signature,
  };
}

export function validatePublicLoungeEligibilityRequest(value: unknown): PublicLoungeEligibilityRequest {
  const raw = record(value);
  assertAllowedKeys(raw, ELIGIBILITY_REQUEST_KEYS);
  if (Object.keys(raw).length !== ELIGIBILITY_REQUEST_KEYS.size
    || raw.schemaVersion !== PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 400);
  }
  if (raw.explicitConsent !== true) fail("PUBLIC_LOUNGE_CONSENT_REQUIRED");
  if (raw.authorRightsDeclaration !== true) fail("PUBLIC_LOUNGE_RIGHTS_DECLARATION_REQUIRED");
  if (raw.trustedServerReviewConsent !== true) {
    fail("PUBLIC_LOUNGE_TRUSTED_REVIEW_CONSENT_REQUIRED");
  }
  if (raw.workCompleted !== true || raw.completionStatus !== "completed") {
    fail("PUBLIC_LOUNGE_WORK_NOT_COMPLETED");
  }
  if (typeof raw.completionFingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(raw.completionFingerprint)) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
  }
  const chapterCount = positiveInteger(raw.chapterCount, 10_000);
  const wordCount = positiveInteger(raw.wordCount, 2_000_000_000);
  if (!isCanonicalIsoTime(raw.completedAt)) fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
  const publicChapters = parsePublicChapters(raw.publicChapters, chapterCount);
  const serverAttestation = parseServerAttestation(raw.serverAttestation);
  if (serverAttestation.completionFingerprint !== raw.completionFingerprint) {
    fail("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
  }
  return {
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
    completionFingerprint: raw.completionFingerprint,
    title: cleanText(raw.title, { field: "inline", min: 1, max: 120 }),
    authorByline: cleanText(raw.authorByline, { field: "inline", min: 1, max: 80 }),
    category: cleanText(raw.category, { field: "inline", min: 1, max: 48 }),
    completionStatus: "completed",
    chapterCount,
    wordCount,
    completedAt: raw.completedAt,
    fullSynopsis: cleanText(raw.fullSynopsis, { field: "prose", min: 1, max: 50_000 }),
    publicChapters,
    serverAttestation,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
    trustedServerReviewConsent: true,
  };
}

export function publicLoungeEligibilityBinding(
  publication: Omit<PublicLoungePublicationInput, "eligibilityTicket">,
  completionFingerprint: string,
) {
  return JSON.stringify({
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
    completionFingerprint,
    publication,
  });
}

export function buildPublicLoungePost(input: PublicLoungePublicationInput, metadata: {
  publicId: string;
  publishedAt: string;
}): PublicLoungePost {
  if (!PUBLIC_ID_PATTERN.test(metadata.publicId) || !isCanonicalIsoTime(metadata.publishedAt)) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 500);
  }
  return {
    schemaVersion: PUBLIC_LOUNGE_POST_SCHEMA_VERSION,
    publicId: metadata.publicId,
    title: input.title,
    authorByline: input.authorByline,
    authorBylineStatus: "self_entered_unverified",
    category: input.category,
    completionStatus: "completed",
    chapterCount: input.chapterCount,
    wordCount: input.wordCount,
    completedAt: input.completedAt,
    publishedAt: metadata.publishedAt,
    quality: {
      totalScore: input.qualityScore,
      threshold: PUBLIC_LOUNGE_QUALITY_THRESHOLD,
      breakdown: PUBLIC_LOUNGE_QUALITY_RUBRIC.map((rubric) => ({
        key: rubric.key,
        label: rubric.label,
        weight: rubric.weight,
        score: input.qualityBreakdown[rubric.key],
        weightedPoints: Math.round(input.qualityBreakdown[rubric.key] * rubric.weight) / 100,
      })),
    },
    fullSynopsis: input.fullSynopsis,
    publicChapters: input.publicChapters.map((chapter) => ({ ...chapter })),
  };
}

export function publicLoungePostToSummary(post: PublicLoungePost): PublicLoungePostSummary {
  return {
    schemaVersion: PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION,
    publicId: post.publicId,
    title: post.title,
    authorByline: post.authorByline,
    authorBylineStatus: post.authorBylineStatus,
    category: post.category,
    completionStatus: "completed",
    chapterCount: post.chapterCount,
    wordCount: post.wordCount,
    completedAt: post.completedAt,
    publishedAt: post.publishedAt,
    quality: {
      totalScore: post.quality.totalScore,
      threshold: PUBLIC_LOUNGE_QUALITY_THRESHOLD,
      breakdown: post.quality.breakdown.map((item) => ({ ...item })),
    },
    synopsisExcerpt: post.fullSynopsis.slice(0, 220),
    publicChapterCount: post.publicChapters.length,
  };
}

export function sanitizeStoredPublicLoungeIndexEntry(value: unknown): PublicLoungePostSummary {
  const raw = record(value);
  if (
    raw.schemaVersion !== PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION
    || raw.authorBylineStatus !== "self_entered_unverified"
    || raw.completionStatus !== "completed"
    || typeof raw.publicId !== "string"
    || !PUBLIC_ID_PATTERN.test(raw.publicId)
    || !isCanonicalIsoTime(raw.completedAt)
    || !isCanonicalIsoTime(raw.publishedAt)
  ) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 502);
  }
  const quality = record(raw.quality);
  const qualityBreakdown = quality.breakdown;
  if (
    quality.threshold !== PUBLIC_LOUNGE_QUALITY_THRESHOLD
    || !Number.isInteger(quality.totalScore)
    || Number(quality.totalScore) < PUBLIC_LOUNGE_QUALITY_THRESHOLD
    || Number(quality.totalScore) > 100
    || !Array.isArray(qualityBreakdown)
    || qualityBreakdown.length !== PUBLIC_LOUNGE_QUALITY_RUBRIC.length
  ) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 502);
  }
  const breakdown = PUBLIC_LOUNGE_QUALITY_RUBRIC.map((rubric) => {
    const candidate = qualityBreakdown.find((item: unknown) => (
      item && typeof item === "object" && !Array.isArray(item)
      && (item as Record<string, unknown>).key === rubric.key
    ));
    const item = record(candidate);
    const score = item.score;
    const weightedPoints = Math.round(Number(score) * rubric.weight) / 100;
    if (
      item.label !== rubric.label
      || item.weight !== rubric.weight
      || !Number.isInteger(score)
      || Number(score) < 0
      || Number(score) > 100
      || item.weightedPoints !== weightedPoints
    ) {
      fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 502);
    }
    return { ...rubric, score: Number(score), weightedPoints };
  });
  const computedTotal = Math.round(breakdown.reduce(
    (sum, item) => sum + item.score * item.weight,
    0,
  ) / 100);
  if (computedTotal !== quality.totalScore) fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 502);
  return {
    schemaVersion: PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION,
    publicId: raw.publicId,
    title: cleanText(raw.title, { field: "inline", min: 1, max: 120 }),
    authorByline: cleanText(raw.authorByline, { field: "inline", min: 1, max: 80 }),
    authorBylineStatus: "self_entered_unverified",
    category: cleanText(raw.category, { field: "inline", min: 1, max: 48 }),
    completionStatus: "completed",
    chapterCount: positiveInteger(raw.chapterCount, 100_000),
    wordCount: positiveInteger(raw.wordCount, 2_000_000_000),
    completedAt: raw.completedAt,
    publishedAt: raw.publishedAt,
    quality: {
      totalScore: Number(quality.totalScore),
      threshold: PUBLIC_LOUNGE_QUALITY_THRESHOLD,
      breakdown,
    },
    synopsisExcerpt: cleanText(raw.synopsisExcerpt, { field: "prose", min: 1, max: 220 }),
    publicChapterCount: positiveInteger(raw.publicChapterCount, PUBLIC_LOUNGE_MAX_PUBLIC_CHAPTERS),
  };
}

export function sanitizeStoredPublicLoungePost(value: unknown): PublicLoungePost {
  const raw = record(value);
  const quality = record(raw.quality);
  if (!Array.isArray(quality.breakdown)) fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 502);
  const scores = Object.fromEntries(quality.breakdown.map((candidate) => {
    const item = record(candidate);
    return [String(item.key), item.score];
  }));
  const publication = validatePublicLoungePublicationInput({
    schemaVersion: PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
    title: raw.title,
    authorByline: raw.authorByline,
    category: raw.category,
    completionStatus: raw.completionStatus,
    chapterCount: raw.chapterCount,
    wordCount: raw.wordCount,
    completedAt: raw.completedAt,
    qualityScore: quality.totalScore,
    qualityBreakdown: scores,
    fullSynopsis: raw.fullSynopsis,
    publicChapters: raw.publicChapters,
    eligibilityTicket: "A".repeat(43),
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
  });
  if (
    raw.schemaVersion !== PUBLIC_LOUNGE_POST_SCHEMA_VERSION
    || raw.authorBylineStatus !== "self_entered_unverified"
    || typeof raw.publicId !== "string"
    || typeof raw.publishedAt !== "string"
  ) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 502);
  }
  return buildPublicLoungePost(publication, {
    publicId: raw.publicId,
    publishedAt: raw.publishedAt,
  });
}

export function assertPublicLoungeId(value: string) {
  if (!PUBLIC_ID_PATTERN.test(value)) fail("PUBLIC_LOUNGE_NOT_FOUND", 404);
  return value;
}
