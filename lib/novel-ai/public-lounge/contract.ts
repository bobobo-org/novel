import {
  PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION,
  PUBLIC_LOUNGE_LEGACY_INDEX_ENTRY_SCHEMA_VERSION,
  PUBLIC_LOUNGE_LEGACY_POST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PRIOR_INDEX_ENTRY_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PRIOR_POST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_POST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS,
  PUBLIC_LOUNGE_MULTI_JUDGE_SUMMARY_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES,
  PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION,
  PUBLIC_LOUNGE_QUALITY_RUBRIC,
  PUBLIC_LOUNGE_QUALITY_THRESHOLD,
  PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_SCHEMA_VERSION,
  PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_V5_SCHEMA_VERSION,
  type PublicLoungeOfficialChapterInput,
  type PublicLoungeEligibilityRequest,
  type PublicLoungePost,
  type PublicLoungePostSummary,
  type PublicLoungePublicationInput,
  type PublicLoungeQualityDimensionKey,
  type PublicLoungeQualityAssurance,
  type PublicLoungeAttestedJudgeSummary,
  type PublicLoungeJudgeRole,
  type PublicLoungeMultiJudgeSummary,
  type PublicLoungeServerEligibilityRequestV5,
  type PublicLoungeServerReviewAttestation,
  type PublicLoungeServerReviewAttestationV5,
} from "./types";
import {
  migrateLegacyPublicLoungeCategory,
  normalizePublicLoungeTopicIds,
  PublicLoungeTaxonomyError,
} from "./taxonomy";
import type { AuthorDeviceReviewDeclaration } from "./author-device-review";

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
  | "PUBLIC_LOUNGE_ATTESTATION_VERSION_UNSUPPORTED"
  | "PUBLIC_LOUNGE_ATTESTATION_REPLAYED"
  | "PUBLIC_LOUNGE_ATTESTATION_STATE_UNKNOWN"
  | "PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED"
  | "PUBLIC_LOUNGE_TRUSTED_REVIEW_CONSENT_REQUIRED"
  | "PUBLIC_LOUNGE_AUTH_REQUIRED"
  | "PUBLIC_LOUNGE_CURSOR_INVALID"
  | "PUBLIC_LOUNGE_NOT_FOUND"
  | "PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED"
  | "PUBLIC_LOUNGE_MANAGEMENT_TOKEN_INVALID"
  | "PUBLIC_LOUNGE_MUTATION_BUSY"
  | "PUBLIC_LOUNGE_MUTATION_RATE_LIMITED"
  | "PUBLIC_LOUNGE_IDEMPOTENCY_KEY_REQUIRED"
  | "PUBLIC_LOUNGE_IDEMPOTENCY_CONFLICT"
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
  "storyLibrarySchemaVersion",
  "shelfId",
  "primaryTopicId",
  "topicIds",
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
const ELIGIBILITY_REQUEST_BASE_KEYS = [
  "schemaVersion",
  "completionFingerprint",
  "title",
  "authorByline",
  "storyLibrarySchemaVersion",
  "shelfId",
  "primaryTopicId",
  "topicIds",
  "completionStatus",
  "chapterCount",
  "wordCount",
  "completedAt",
  "fullSynopsis",
  "publicChapters",
  "explicitConsent",
  "authorRightsDeclaration",
  "workCompleted",
] as const;
const SERVER_ELIGIBILITY_REQUEST_KEYS = new Set([
  ...ELIGIBILITY_REQUEST_BASE_KEYS,
  "serverAttestation",
  "trustedServerReviewConsent",
]);
const SERVER_ELIGIBILITY_REQUEST_V5_KEYS = new Set([
  ...SERVER_ELIGIBILITY_REQUEST_KEYS,
  "workId",
  "revisionId",
  "intent",
  "targetPublicationId",
  "expectedTargetVersionId",
  "expectedTargetPublicationDigest",
]);
const AUTHOR_DEVICE_ELIGIBILITY_REQUEST_KEYS = new Set([
  ...ELIGIBILITY_REQUEST_BASE_KEYS,
  "authorDeviceReview",
  "authorDeviceReviewConsent",
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
  "hardGatePassed",
  "compliancePassed",
  "criticalDimensionsPassed",
  "hiddenDraftResidueDetected",
  "multiJudgeSummary",
  "backendId",
  "modelId",
  "modelDigest",
  "rawContentStored",
  "signature",
]);
const ATTESTATION_V5_KEYS = new Set([
  "schemaVersion",
  "issuer",
  "keyId",
  "attestationId",
  "intent",
  "workId",
  "revisionId",
  "targetPublicationId",
  "expectedTargetVersionId",
  "expectedTargetPublicationDigest",
  "environment",
  "audience",
  "producerVersion",
  "rubricVersion",
  "issuedAt",
  "expiresAt",
  "completionFingerprint",
  "contentDigest",
  "publicationDigest",
  "qualityScore",
  "qualityBreakdown",
  "workCompleted",
  "fullCoverage",
  "hardGatePassed",
  "compliancePassed",
  "criticalDimensionsPassed",
  "hiddenDraftResidueDetected",
  "multiJudgeSummary",
  "backendId",
  "modelId",
  "modelDigest",
  "rawContentStored",
  "signature",
]);
const MULTI_JUDGE_SUMMARY_KEYS = new Set([
  "schemaVersion",
  "primaryJudgeRoles",
  "primaryJudgeCount",
  "judges",
  "aggregationMethod",
  "primaryScoreSpread",
  "selectedJudgeRoles",
  "arbitrationRequired",
  "arbitrationPerformed",
  "fullCoverageJudgeRoles",
  "reviewedChapterCount",
  "reviewedChunkCount",
]);
const ATTESTED_JUDGE_KEYS = new Set([
  "judgeRole",
  "totalScore",
  "dimensionScores",
  "fullCoverage",
]);
const QUALITY_KEYS = new Set<string>(PUBLIC_LOUNGE_QUALITY_RUBRIC.map((item) => item.key));
const PUBLIC_ID_PATTERN = /^novel_[a-z0-9_-]{12,80}$/u;
const PUBLIC_VERSION_ID_PATTERN = /^version_[a-z0-9_-]{12,96}$/u;
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

function parseV2Taxonomy(raw: Record<string, unknown>) {
  try {
    const selection = normalizePublicLoungeTopicIds(raw.topicIds);
    if (
      raw.storyLibrarySchemaVersion !== selection.storyLibrarySchemaVersion
      || raw.shelfId !== selection.shelfId
      || raw.primaryTopicId !== selection.primaryTopicId
    ) {
      fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
    }
    return selection;
  } catch (error) {
    if (error instanceof PublicLoungeError) throw error;
    if (error instanceof PublicLoungeTaxonomyError) fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
    throw error;
  }
}

function storedTaxonomy(raw: Record<string, unknown>, schemaVersion: unknown) {
  if (
    schemaVersion === PUBLIC_LOUNGE_POST_SCHEMA_VERSION
    || schemaVersion === PUBLIC_LOUNGE_PRIOR_POST_SCHEMA_VERSION
    || schemaVersion === PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION
    || schemaVersion === PUBLIC_LOUNGE_PRIOR_INDEX_ENTRY_SCHEMA_VERSION
  ) {
    return { ...parseV2Taxonomy(raw) };
  }
  const legacyCategory = cleanText(raw.category, { field: "inline", min: 1, max: 48 });
  const migration = migrateLegacyPublicLoungeCategory(legacyCategory);
  if (migration.status === "migrated") return { ...migration.selection };
  return {
    storyLibrarySchemaVersion: null,
    shelfId: null,
    primaryTopicId: null,
    topicIds: [] as const,
  };
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

function invalidEligibility(): never {
  fail("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
}

function eligibilityRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidEligibility();
  return value as Record<string, unknown>;
}

function exactJudgeRoles(value: unknown, expected: readonly PublicLoungeJudgeRole[]) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((role, index) => role === expected[index]);
}

function parseAttestedJudge(value: unknown): PublicLoungeAttestedJudgeSummary {
  const raw = eligibilityRecord(value);
  if (
    Object.keys(raw).length !== ATTESTED_JUDGE_KEYS.size
    || Object.keys(raw).some((key) => !ATTESTED_JUDGE_KEYS.has(key))
    || ![...PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES, "score-arbitrator"].includes(
      raw.judgeRole as PublicLoungeJudgeRole,
    )
    || raw.fullCoverage !== true
    || typeof raw.totalScore !== "number"
    || !Number.isFinite(raw.totalScore)
    || raw.totalScore < 0
    || raw.totalScore > 100
    || Math.abs(Math.round(raw.totalScore * 100) - raw.totalScore * 100) > 1e-8
  ) invalidEligibility();
  const dimensions = eligibilityRecord(raw.dimensionScores);
  if (
    Object.keys(dimensions).length !== PUBLIC_LOUNGE_QUALITY_RUBRIC.length
    || Object.keys(dimensions).some((key) => !QUALITY_KEYS.has(key))
  ) invalidEligibility();
  const dimensionScores = Object.fromEntries(PUBLIC_LOUNGE_QUALITY_RUBRIC.map((rubric) => {
    const score = dimensions[rubric.key];
    if (!Number.isInteger(score) || Number(score) < 0 || Number(score) > 100) invalidEligibility();
    return [rubric.key, Number(score)];
  })) as Record<PublicLoungeQualityDimensionKey, number>;
  const expectedTotal = Math.round(PUBLIC_LOUNGE_QUALITY_RUBRIC.reduce(
    (sum, rubric) => sum + dimensionScores[rubric.key] * rubric.weight,
    0,
  )) / 100;
  if (raw.totalScore !== expectedTotal) invalidEligibility();
  return {
    judgeRole: raw.judgeRole as PublicLoungeJudgeRole,
    totalScore: raw.totalScore,
    dimensionScores,
    fullCoverage: true,
  };
}

export function validatePublicLoungeMultiJudgeSummary(
  value: unknown,
  aggregateBreakdown: Record<PublicLoungeQualityDimensionKey, number>,
): PublicLoungeMultiJudgeSummary {
  const raw = eligibilityRecord(value);
  if (
    Object.keys(raw).length !== MULTI_JUDGE_SUMMARY_KEYS.size
    || Object.keys(raw).some((key) => !MULTI_JUDGE_SUMMARY_KEYS.has(key))
    || raw.schemaVersion !== PUBLIC_LOUNGE_MULTI_JUDGE_SUMMARY_SCHEMA_VERSION
    || raw.primaryJudgeCount !== PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES.length
    || raw.aggregationMethod !== "per-dimension-median"
    || !exactJudgeRoles(raw.primaryJudgeRoles, PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES)
    || typeof raw.arbitrationRequired !== "boolean"
    || typeof raw.arbitrationPerformed !== "boolean"
    || !Number.isInteger(raw.reviewedChapterCount)
    || Number(raw.reviewedChapterCount) < 1
    || Number(raw.reviewedChapterCount) > 100_000
    || !Number.isInteger(raw.reviewedChunkCount)
    || Number(raw.reviewedChunkCount) < Number(raw.reviewedChapterCount)
    || Number(raw.reviewedChunkCount) > 1_000_000
    || !Array.isArray(raw.judges)
  ) invalidEligibility();
  const judges = raw.judges.map(parseAttestedJudge);
  const primaryJudges = PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES.map((role) => (
    judges.find((judge) => judge.judgeRole === role)
  ));
  const arbitrators = judges.filter((judge) => judge.judgeRole === "score-arbitrator");
  if (
    primaryJudges.some((judge) => !judge)
    || new Set(judges.map((judge) => judge.judgeRole)).size !== judges.length
    || arbitrators.length > 1
  ) invalidEligibility();
  const primaries = primaryJudges as PublicLoungeAttestedJudgeSummary[];
  const primaryScoreSpread = Math.round((
    Math.max(...primaries.map((judge) => judge.totalScore))
    - Math.min(...primaries.map((judge) => judge.totalScore))
  ) * 100) / 100;
  const arbitrationRequired = primaryScoreSpread > 10;
  const expectedJudgeRoles: PublicLoungeJudgeRole[] = arbitrationRequired
    ? [...PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES, "score-arbitrator"]
    : [...PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES];
  if (
    typeof raw.primaryScoreSpread !== "number"
    || raw.primaryScoreSpread !== primaryScoreSpread
    || raw.arbitrationRequired !== arbitrationRequired
    || raw.arbitrationPerformed !== arbitrationRequired
    || judges.length !== expectedJudgeRoles.length
    || !exactJudgeRoles(judges.map((judge) => judge.judgeRole), expectedJudgeRoles)
    || !exactJudgeRoles(raw.fullCoverageJudgeRoles, expectedJudgeRoles)
  ) invalidEligibility();
  const arbitrator = arbitrators[0] ?? null;
  const selectedJudges = arbitrator
    ? [
      arbitrator,
      ...primaries
        .map((judge, index) => ({
          judge,
          index,
          distance: Math.abs(judge.totalScore - arbitrator.totalScore),
        }))
        .sort((left, right) => left.distance - right.distance || left.index - right.index)
        .slice(0, 2)
        .map((item) => item.judge),
    ]
    : primaries;
  const selectedJudgeRoles = selectedJudges.map((judge) => judge.judgeRole) as [
    PublicLoungeJudgeRole,
    PublicLoungeJudgeRole,
    PublicLoungeJudgeRole,
  ];
  if (!exactJudgeRoles(raw.selectedJudgeRoles, selectedJudgeRoles)) invalidEligibility();
  for (const rubric of PUBLIC_LOUNGE_QUALITY_RUBRIC) {
    const scores = selectedJudges
      .map((judge) => judge.dimensionScores[rubric.key])
      .sort((left, right) => left - right);
    if (aggregateBreakdown[rubric.key] !== scores[1]) invalidEligibility();
  }
  return {
    schemaVersion: PUBLIC_LOUNGE_MULTI_JUDGE_SUMMARY_SCHEMA_VERSION,
    primaryJudgeRoles: [...PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES],
    primaryJudgeCount: 3,
    judges,
    aggregationMethod: "per-dimension-median",
    primaryScoreSpread,
    selectedJudgeRoles,
    arbitrationRequired,
    arbitrationPerformed: arbitrationRequired,
    fullCoverageJudgeRoles: expectedJudgeRoles,
    reviewedChapterCount: Number(raw.reviewedChapterCount),
    reviewedChunkCount: Number(raw.reviewedChunkCount),
  };
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
  const taxonomy = parseV2Taxonomy(raw);
  return {
    schemaVersion: PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
    title: cleanText(raw.title, { field: "inline", min: 1, max: 120 }),
    authorByline: cleanText(raw.authorByline, { field: "inline", min: 1, max: 80 }),
    ...taxonomy,
    completionStatus: "completed",
    chapterCount,
    wordCount,
    completedAt: raw.completedAt,
    qualityScore,
    qualityBreakdown,
    fullSynopsis: cleanText(raw.fullSynopsis, {
      field: "prose",
      min: 1,
      max: PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS,
    }),
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
  const multiJudgeSummary = validatePublicLoungeMultiJudgeSummary(
    raw.multiJudgeSummary,
    quality.qualityBreakdown,
  );
  if (
    Object.keys(raw).length !== ATTESTATION_KEYS.size
    || raw.schemaVersion !== PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_SCHEMA_VERSION
    || raw.issuer !== "private-ai-hub"
    || raw.backendId !== "private-ai-hub"
    || raw.workCompleted !== true
    || raw.fullCoverage !== true
    || raw.hardGatePassed !== true
    || raw.compliancePassed !== true
    || raw.criticalDimensionsPassed !== true
    || raw.hiddenDraftResidueDetected !== false
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
    schemaVersion: PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_SCHEMA_VERSION,
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
    hardGatePassed: true,
    compliancePassed: true,
    criticalDimensionsPassed: true,
    hiddenDraftResidueDetected: false,
    multiJudgeSummary,
    backendId: "private-ai-hub",
    modelId: raw.modelId.trim(),
    modelDigest: raw.modelDigest,
    rawContentStored: false,
    signature: raw.signature,
  };
}

export function parsePublicLoungeServerReviewAttestationV5(
  value: unknown,
): PublicLoungeServerReviewAttestationV5 {
  const raw = record(value);
  assertAllowedKeys(raw, ATTESTATION_V5_KEYS);
  const quality = validatePublicLoungeQuality({
    qualityScore: raw.qualityScore,
    qualityBreakdown: raw.qualityBreakdown,
  });
  const multiJudgeSummary = validatePublicLoungeMultiJudgeSummary(
    raw.multiJudgeSummary,
    quality.qualityBreakdown,
  );
  const boundedToken = (candidate: unknown, max: number) => (
    typeof candidate === "string"
    && candidate.length >= 1
    && candidate.length <= max
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(candidate)
  );
  const sha256Digest = (candidate: unknown) => (
    typeof candidate === "string" && /^[a-f0-9]{64}$/u.test(candidate)
  );
  if (
    Object.keys(raw).length !== ATTESTATION_V5_KEYS.size
    || raw.schemaVersion !== PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_V5_SCHEMA_VERSION
    || raw.issuer !== "private-ai-hub"
    || raw.backendId !== "private-ai-hub"
    || raw.rubricVersion !== PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION
    || (raw.environment !== "preview" && raw.environment !== "production")
    || (raw.intent !== "publish" && raw.intent !== "overwrite")
    || raw.workCompleted !== true
    || raw.fullCoverage !== true
    || raw.hardGatePassed !== true
    || raw.compliancePassed !== true
    || raw.criticalDimensionsPassed !== true
    || raw.hiddenDraftResidueDetected !== false
    || raw.rawContentStored !== false
    || typeof raw.keyId !== "string"
    || !/^[A-Za-z0-9._-]{1,120}$/u.test(raw.keyId)
    || typeof raw.attestationId !== "string"
    || !/^[A-Za-z0-9_-]{22,128}$/u.test(raw.attestationId)
    || typeof raw.workId !== "string"
    || !/^[A-Za-z0-9_-]{1,160}$/u.test(raw.workId)
    || !sha256Digest(raw.revisionId)
    || !boundedToken(raw.audience, 160)
    || !boundedToken(raw.producerVersion, 120)
    || !sha256Digest(raw.completionFingerprint)
    || raw.revisionId !== raw.completionFingerprint
    || !sha256Digest(raw.contentDigest)
    || !sha256Digest(raw.publicationDigest)
    || typeof raw.modelId !== "string"
    || !raw.modelId.trim()
    || raw.modelId.length > 160
    || !sha256Digest(raw.modelDigest)
    || typeof raw.signature !== "string"
    || !/^[A-Za-z0-9_-]{86}$/u.test(raw.signature)
    || !isCanonicalIsoTime(raw.issuedAt)
    || !isCanonicalIsoTime(raw.expiresAt)
    || Date.parse(raw.expiresAt) <= Date.parse(raw.issuedAt)
    || Date.parse(raw.expiresAt) - Date.parse(raw.issuedAt) > 30 * 60_000
  ) {
    fail("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
  }

  const common = {
    schemaVersion: PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_V5_SCHEMA_VERSION,
    issuer: "private-ai-hub" as const,
    keyId: raw.keyId as string,
    attestationId: raw.attestationId as string,
    workId: raw.workId as string,
    revisionId: raw.revisionId as string,
    environment: raw.environment as "preview" | "production",
    audience: raw.audience as string,
    producerVersion: raw.producerVersion as string,
    rubricVersion: PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION,
    issuedAt: raw.issuedAt as string,
    expiresAt: raw.expiresAt as string,
    completionFingerprint: raw.completionFingerprint as string,
    contentDigest: raw.contentDigest as string,
    publicationDigest: raw.publicationDigest as string,
    qualityScore: quality.qualityScore,
    qualityBreakdown: quality.qualityBreakdown,
    workCompleted: true as const,
    fullCoverage: true as const,
    hardGatePassed: true as const,
    compliancePassed: true as const,
    criticalDimensionsPassed: true as const,
    hiddenDraftResidueDetected: false as const,
    multiJudgeSummary,
    backendId: "private-ai-hub" as const,
    modelId: (raw.modelId as string).trim(),
    modelDigest: raw.modelDigest as string,
    rawContentStored: false as const,
    signature: raw.signature as string,
  };

  if (raw.intent === "publish") {
    if (
      raw.targetPublicationId !== null
      || raw.expectedTargetVersionId !== null
      || raw.expectedTargetPublicationDigest !== null
    ) {
      fail("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
    }
    return {
      ...common,
      intent: "publish",
      targetPublicationId: null,
      expectedTargetVersionId: null,
      expectedTargetPublicationDigest: null,
    };
  }

  if (
    typeof raw.targetPublicationId !== "string"
    || !PUBLIC_ID_PATTERN.test(raw.targetPublicationId)
    || typeof raw.expectedTargetVersionId !== "string"
    || !PUBLIC_VERSION_ID_PATTERN.test(raw.expectedTargetVersionId)
    || !sha256Digest(raw.expectedTargetPublicationDigest)
  ) {
    fail("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
  }
  return {
    ...common,
    intent: "overwrite",
    targetPublicationId: raw.targetPublicationId,
    expectedTargetVersionId: raw.expectedTargetVersionId,
    expectedTargetPublicationDigest: raw.expectedTargetPublicationDigest as string,
  };
}

export function validatePublicLoungeEligibilityRequest(value: unknown): PublicLoungeEligibilityRequest {
  const raw = record(value);
  const hasServerAttestation = Object.prototype.hasOwnProperty.call(raw, "serverAttestation");
  const hasAuthorDeviceReview = Object.prototype.hasOwnProperty.call(raw, "authorDeviceReview");
  if (hasServerAttestation === hasAuthorDeviceReview) {
    fail("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
  }
  const allowedKeys = hasServerAttestation
    ? SERVER_ELIGIBILITY_REQUEST_KEYS
    : AUTHOR_DEVICE_ELIGIBILITY_REQUEST_KEYS;
  assertAllowedKeys(raw, allowedKeys);
  if (Object.keys(raw).length !== allowedKeys.size
    || raw.schemaVersion !== PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 400);
  }
  if (raw.explicitConsent !== true) fail("PUBLIC_LOUNGE_CONSENT_REQUIRED");
  if (raw.authorRightsDeclaration !== true) fail("PUBLIC_LOUNGE_RIGHTS_DECLARATION_REQUIRED");
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
  const taxonomy = parseV2Taxonomy(raw);
  const common = {
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
    completionFingerprint: raw.completionFingerprint,
    title: cleanText(raw.title, { field: "inline", min: 1, max: 120 }),
    authorByline: cleanText(raw.authorByline, { field: "inline", min: 1, max: 80 }),
    ...taxonomy,
    completionStatus: "completed",
    chapterCount,
    wordCount,
    completedAt: raw.completedAt,
    fullSynopsis: cleanText(raw.fullSynopsis, {
      field: "prose",
      min: 1,
      max: PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS,
    }),
    publicChapters,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
  } as const;
  if (hasServerAttestation) {
    if (raw.trustedServerReviewConsent !== true) {
      fail("PUBLIC_LOUNGE_TRUSTED_REVIEW_CONSENT_REQUIRED");
    }
    const serverAttestation = parseServerAttestation(raw.serverAttestation);
    if (serverAttestation.completionFingerprint !== raw.completionFingerprint) {
      fail("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
    }
    return {
      ...common,
      serverAttestation,
      trustedServerReviewConsent: true,
    };
  }
  if (raw.authorDeviceReviewConsent !== true) {
    fail("PUBLIC_LOUNGE_CONSENT_REQUIRED");
  }
  const authorDeviceReview = record(raw.authorDeviceReview);
  return {
    ...common,
    authorDeviceReview: authorDeviceReview as AuthorDeviceReviewDeclaration,
    authorDeviceReviewConsent: true,
  } as PublicLoungeEligibilityRequest;
}

export function validatePublicLoungeServerEligibilityRequestV5(
  value: unknown,
): PublicLoungeServerEligibilityRequestV5 {
  const raw = record(value);
  assertAllowedKeys(raw, SERVER_ELIGIBILITY_REQUEST_V5_KEYS);
  if (
    Object.keys(raw).length !== SERVER_ELIGIBILITY_REQUEST_V5_KEYS.size
    || raw.schemaVersion !== PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION
  ) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 400);
  }
  if (raw.explicitConsent !== true) fail("PUBLIC_LOUNGE_CONSENT_REQUIRED");
  if (raw.authorRightsDeclaration !== true) fail("PUBLIC_LOUNGE_RIGHTS_DECLARATION_REQUIRED");
  if (raw.workCompleted !== true || raw.completionStatus !== "completed") {
    fail("PUBLIC_LOUNGE_WORK_NOT_COMPLETED");
  }
  if (typeof raw.completionFingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(raw.completionFingerprint)) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
  }
  if (raw.trustedServerReviewConsent !== true) {
    fail("PUBLIC_LOUNGE_TRUSTED_REVIEW_CONSENT_REQUIRED");
  }
  const chapterCount = positiveInteger(raw.chapterCount, 10_000);
  const wordCount = positiveInteger(raw.wordCount, 2_000_000_000);
  if (!isCanonicalIsoTime(raw.completedAt)) fail("PUBLIC_LOUNGE_PAYLOAD_INVALID");
  const publicChapters = parsePublicChapters(raw.publicChapters, chapterCount);
  const taxonomy = parseV2Taxonomy(raw);
  const serverAttestation = parsePublicLoungeServerReviewAttestationV5(raw.serverAttestation);
  if (
    serverAttestation.completionFingerprint !== raw.completionFingerprint
    || serverAttestation.workId !== raw.workId
    || serverAttestation.revisionId !== raw.revisionId
    || serverAttestation.intent !== raw.intent
    || serverAttestation.targetPublicationId !== raw.targetPublicationId
    || serverAttestation.expectedTargetVersionId !== raw.expectedTargetVersionId
    || serverAttestation.expectedTargetPublicationDigest !== raw.expectedTargetPublicationDigest
  ) {
    fail("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
  }
  const common = {
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
    completionFingerprint: raw.completionFingerprint,
    workId: serverAttestation.workId,
    revisionId: serverAttestation.revisionId,
    title: cleanText(raw.title, { field: "inline", min: 1, max: 120 }),
    authorByline: cleanText(raw.authorByline, { field: "inline", min: 1, max: 80 }),
    ...taxonomy,
    completionStatus: "completed",
    chapterCount,
    wordCount,
    completedAt: raw.completedAt,
    fullSynopsis: cleanText(raw.fullSynopsis, {
      field: "prose",
      min: 1,
      max: PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS,
    }),
    publicChapters,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
    trustedServerReviewConsent: true,
  } as const;
  return serverAttestation.intent === "publish"
    ? {
      ...common,
      intent: "publish",
      targetPublicationId: null,
      expectedTargetVersionId: null,
      expectedTargetPublicationDigest: null,
      serverAttestation,
    }
    : {
      ...common,
      intent: "overwrite",
      targetPublicationId: serverAttestation.targetPublicationId,
      expectedTargetVersionId: serverAttestation.expectedTargetVersionId,
      expectedTargetPublicationDigest: serverAttestation.expectedTargetPublicationDigest,
      serverAttestation,
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
  versionId: string;
  versionNumber: number;
  versionPublishedAt: string;
  qualityAssurance: PublicLoungeQualityAssurance;
}): PublicLoungePost {
  if (
    !PUBLIC_ID_PATTERN.test(metadata.publicId)
    || !isCanonicalIsoTime(metadata.publishedAt)
    || !PUBLIC_VERSION_ID_PATTERN.test(metadata.versionId)
    || !Number.isInteger(metadata.versionNumber)
    || metadata.versionNumber < 1
    || !isCanonicalIsoTime(metadata.versionPublishedAt)
    || (metadata.qualityAssurance !== "private_ai_hub_verified"
      && metadata.qualityAssurance !== "author_device_closed_ai_unverified")
  ) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 500);
  }
  const taxonomy = normalizePublicLoungeTopicIds(input.topicIds);
  return {
    schemaVersion: PUBLIC_LOUNGE_POST_SCHEMA_VERSION,
    publicId: metadata.publicId,
    title: input.title,
    authorByline: input.authorByline,
    authorBylineStatus: "self_entered_unverified",
    ...taxonomy,
    completionStatus: "completed",
    chapterCount: input.chapterCount,
    wordCount: input.wordCount,
    completedAt: input.completedAt,
    publishedAt: metadata.publishedAt,
    versionId: metadata.versionId,
    versionNumber: metadata.versionNumber,
    versionPublishedAt: metadata.versionPublishedAt,
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
    qualityAssurance: metadata.qualityAssurance,
    fullSynopsis: input.fullSynopsis,
    publicChapters: input.publicChapters.map((chapter) => ({ ...chapter })),
  };
}

export function publicLoungePostToSummary(post: PublicLoungePost): PublicLoungePostSummary {
  if (post.topicIds.length < 1) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 500);
  }
  const taxonomy = normalizePublicLoungeTopicIds(post.topicIds);
  return {
    schemaVersion: PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION,
    publicId: post.publicId,
    title: post.title,
    authorByline: post.authorByline,
    authorBylineStatus: post.authorBylineStatus,
    ...taxonomy,
    completionStatus: "completed",
    chapterCount: post.chapterCount,
    wordCount: post.wordCount,
    completedAt: post.completedAt,
    publishedAt: post.publishedAt,
    versionId: post.versionId,
    versionNumber: post.versionNumber,
    versionPublishedAt: post.versionPublishedAt,
    quality: {
      totalScore: post.quality.totalScore,
      threshold: PUBLIC_LOUNGE_QUALITY_THRESHOLD,
      breakdown: post.quality.breakdown.map((item) => ({ ...item })),
    },
    qualityAssurance: post.qualityAssurance,
    synopsisExcerpt: post.fullSynopsis.slice(0, PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS),
    publicChapterCount: post.publicChapters.length,
  };
}

export function sanitizeStoredPublicLoungeIndexEntry(value: unknown): PublicLoungePostSummary {
  const raw = record(value);
  if (
    (raw.schemaVersion !== PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION
      && raw.schemaVersion !== PUBLIC_LOUNGE_PRIOR_INDEX_ENTRY_SCHEMA_VERSION
      && raw.schemaVersion !== PUBLIC_LOUNGE_LEGACY_INDEX_ENTRY_SCHEMA_VERSION)
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
  const taxonomy = storedTaxonomy(raw, raw.schemaVersion);
  const qualityAssurance = raw.qualityAssurance === undefined
    && raw.schemaVersion === PUBLIC_LOUNGE_LEGACY_INDEX_ENTRY_SCHEMA_VERSION
    ? "private_ai_hub_verified"
    : raw.qualityAssurance;
  if (
    qualityAssurance !== "private_ai_hub_verified"
    && qualityAssurance !== "author_device_closed_ai_unverified"
  ) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 502);
  }
  const isVersioned = raw.schemaVersion === PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION;
  const versionId = isVersioned
    ? raw.versionId
    : `version_legacy_${String(raw.publicId).slice("novel_".length)}`;
  const versionNumber = isVersioned ? raw.versionNumber : 1;
  const versionPublishedAt = isVersioned ? raw.versionPublishedAt : raw.publishedAt;
  if (
    typeof versionId !== "string"
    || !PUBLIC_VERSION_ID_PATTERN.test(versionId)
    || !Number.isInteger(versionNumber)
    || Number(versionNumber) < 1
    || !isCanonicalIsoTime(versionPublishedAt)
  ) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 502);
  }
  return {
    schemaVersion: PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION,
    publicId: raw.publicId,
    title: cleanText(raw.title, { field: "inline", min: 1, max: 120 }),
    authorByline: cleanText(raw.authorByline, { field: "inline", min: 1, max: 80 }),
    authorBylineStatus: "self_entered_unverified",
    ...taxonomy,
    completionStatus: "completed",
    chapterCount: positiveInteger(raw.chapterCount, 100_000),
    wordCount: positiveInteger(raw.wordCount, 2_000_000_000),
    completedAt: raw.completedAt,
    publishedAt: raw.publishedAt,
    versionId,
    versionNumber: Number(versionNumber),
    versionPublishedAt,
    quality: {
      totalScore: Number(quality.totalScore),
      threshold: PUBLIC_LOUNGE_QUALITY_THRESHOLD,
      breakdown,
    },
    qualityAssurance,
    synopsisExcerpt: cleanText(raw.synopsisExcerpt, {
      field: "prose",
      min: 1,
      max: PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS,
    }),
    publicChapterCount: positiveInteger(raw.publicChapterCount, PUBLIC_LOUNGE_MAX_PUBLIC_CHAPTERS),
  };
}

export function sanitizeStoredPublicLoungePost(value: unknown): PublicLoungePost {
  const raw = record(value);
  if (
    (raw.schemaVersion !== PUBLIC_LOUNGE_POST_SCHEMA_VERSION
      && raw.schemaVersion !== PUBLIC_LOUNGE_PRIOR_POST_SCHEMA_VERSION
      && raw.schemaVersion !== PUBLIC_LOUNGE_LEGACY_POST_SCHEMA_VERSION)
    || raw.authorBylineStatus !== "self_entered_unverified"
    || typeof raw.publicId !== "string"
    || typeof raw.publishedAt !== "string"
  ) {
    fail("PUBLIC_LOUNGE_PAYLOAD_INVALID", 502);
  }
  const fullSynopsis = cleanText(raw.fullSynopsis, {
    field: "prose",
    min: 1,
    max: PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS,
  });
  const rawChapters = Array.isArray(raw.publicChapters) ? raw.publicChapters : [];
  const summary = sanitizeStoredPublicLoungeIndexEntry({
    ...raw,
    schemaVersion: raw.schemaVersion === PUBLIC_LOUNGE_LEGACY_POST_SCHEMA_VERSION
      ? PUBLIC_LOUNGE_LEGACY_INDEX_ENTRY_SCHEMA_VERSION
      : raw.schemaVersion === PUBLIC_LOUNGE_PRIOR_POST_SCHEMA_VERSION
        ? PUBLIC_LOUNGE_PRIOR_INDEX_ENTRY_SCHEMA_VERSION
        : PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION,
    synopsisExcerpt: fullSynopsis.slice(0, PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS),
    publicChapterCount: rawChapters.length,
  });
  return {
    schemaVersion: PUBLIC_LOUNGE_POST_SCHEMA_VERSION,
    storyLibrarySchemaVersion: summary.storyLibrarySchemaVersion,
    shelfId: summary.shelfId,
    primaryTopicId: summary.primaryTopicId,
    topicIds: summary.topicIds,
    publicId: summary.publicId,
    title: summary.title,
    authorByline: summary.authorByline,
    authorBylineStatus: summary.authorBylineStatus,
    completionStatus: summary.completionStatus,
    chapterCount: summary.chapterCount,
    wordCount: summary.wordCount,
    completedAt: summary.completedAt,
    publishedAt: summary.publishedAt,
    versionId: summary.versionId,
    versionNumber: summary.versionNumber,
    versionPublishedAt: summary.versionPublishedAt,
    quality: summary.quality,
    qualityAssurance: summary.qualityAssurance,
    fullSynopsis,
    publicChapters: parsePublicChapters(raw.publicChapters, summary.chapterCount),
  };
}

export function assertPublicLoungeId(value: string) {
  if (!PUBLIC_ID_PATTERN.test(value)) fail("PUBLIC_LOUNGE_NOT_FOUND", 404);
  return value;
}
