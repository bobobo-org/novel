import {
  PUBLIC_LOUNGE_QUALITY_RUBRIC,
  PUBLIC_LOUNGE_QUALITY_THRESHOLD,
} from "./types";
import type {
  PublicLoungeOfficialChapterInput,
  PublicLoungeQualityDimensionKey,
} from "./types";
import {
  evaluatePublicLoungePublicContentGate,
} from "./public-content-hard-gate";
import type {
  PublicLoungePublicContentGateCode,
} from "./public-content-hard-gate";

export const AUTHOR_DEVICE_REVIEW_SCHEMA_VERSION = "author-device-closed-ai-review-v1" as const;
export const AUTHOR_DEVICE_REVIEW_ASSURANCE = "author_device_closed_ai_unverified" as const;
export const AUTHOR_DEVICE_REVIEW_CRITICAL_DIMENSION_THRESHOLD = 60;
export const AUTHOR_DEVICE_REVIEW_BACKENDS = [
  "browser-ai",
  "local-ollama",
  "private-ai-hub",
] as const;

export type AuthorDeviceReviewBackendId = typeof AUTHOR_DEVICE_REVIEW_BACKENDS[number];

export type AuthorDeviceReviewDeclaration = Readonly<{
  schemaVersion: typeof AUTHOR_DEVICE_REVIEW_SCHEMA_VERSION;
  assurance: typeof AUTHOR_DEVICE_REVIEW_ASSURANCE;
  issuedAt: string;
  nonce: string;
  completionFingerprint: string;
  backendId: AuthorDeviceReviewBackendId;
  modelId: string;
  modelDigest: string;
  fullCoverage: true;
  hardGatePassed: true;
  compliancePassed: true;
  criticalDimensionsPassed: true;
  qualityScore: number;
  dimensionScores: Readonly<Record<PublicLoungeQualityDimensionKey, number>>;
  reviewDigest: string;
  antiReplayIdentity: string;
}>;

export type AuthorDeviceReviewBuildInput = Readonly<{
  issuedAt: string;
  nonce: string;
  completionFingerprint: string;
  backendId: AuthorDeviceReviewBackendId;
  modelId: string;
  modelDigest: string;
  fullCoverage: boolean;
  hardGatePassed: boolean;
  compliancePassed: boolean;
  criticalDimensionsPassed: boolean;
  qualityScore: number;
  dimensionScores: Readonly<Record<PublicLoungeQualityDimensionKey, number>>;
}>;

export type AuthorDeviceReviewValidationCode =
  | "declaration_shape_invalid"
  | "forbidden_private_content_field"
  | "schema_invalid"
  | "assurance_invalid"
  | "identity_invalid"
  | "issued_at_invalid"
  | "nonce_invalid"
  | "backend_invalid"
  | "completion_fingerprint_invalid"
  | "model_digest_invalid"
  | "full_coverage_required"
  | "hard_gate_required"
  | "compliance_required"
  | "critical_dimensions_required"
  | "dimension_scores_invalid"
  | "critical_dimension_score_too_low"
  | "quality_score_invalid"
  | "quality_score_below_threshold"
  | "weighted_score_mismatch"
  | "review_digest_invalid"
  | "review_digest_mismatch"
  | "anti_replay_identity_invalid"
  | "anti_replay_identity_mismatch"
  | "anti_replay_identity_reused"
  | "completion_identity_mismatch";

export type AuthorDeviceReviewValidationContext = Readonly<{
  expectedCompletionFingerprint: string;
  consumedAntiReplayIdentities?: ReadonlySet<string>;
}>;

export type AuthorDeviceReviewValidationResult = Readonly<{
  valid: boolean;
  reasons: readonly AuthorDeviceReviewValidationCode[];
  declaration: AuthorDeviceReviewDeclaration | null;
}>;

export type AuthorDeviceReviewPublicationGateResult = Readonly<{
  passed: boolean;
  assurance: typeof AUTHOR_DEVICE_REVIEW_ASSURANCE;
  authorDeviceReviewPassed: boolean;
  publicContentPackagingPassed: boolean;
  deterministicPublicContentGateReplacesClosedAI: false;
  reviewReasons: readonly AuthorDeviceReviewValidationCode[];
  publicContentReasons: readonly PublicLoungePublicContentGateCode[];
}>;

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,159}$/u;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const FORBIDDEN_FIELD_PATTERN = /(?:raw.*novel|novel.*(?:text|body|content)|chapter.*(?:text|body|content)|receipt|prompt|canon|trace|provenance|outline|summary|evidence)/iu;
const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "assurance",
  "issuedAt",
  "nonce",
  "completionFingerprint",
  "backendId",
  "modelId",
  "modelDigest",
  "fullCoverage",
  "hardGatePassed",
  "compliancePassed",
  "criticalDimensionsPassed",
  "qualityScore",
  "dimensionScores",
  "reviewDigest",
  "antiReplayIdentity",
] as const;
const DIMENSION_KEYS = PUBLIC_LOUNGE_QUALITY_RUBRIC.map((item) => item.key);
const CRITICAL_DIMENSION_KEYS = [
  "plot_coherence",
  "character_arcs",
  "world_canon_consistency",
  "prose_dialogue",
] as const satisfies ReadonlyArray<PublicLoungeQualityDimensionKey>;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function containsForbiddenField(value: unknown, dimensionScoreRecord = false): boolean {
  if (Array.isArray(value)) return value.some((item) => containsForbiddenField(item));
  const record = recordValue(value);
  if (!record) return false;
  return Object.entries(record).some(([key, child]) => (
    (!dimensionScoreRecord && FORBIDDEN_FIELD_PATTERN.test(key))
    || containsForbiddenField(child, key === "dimensionScores")
  ));
}

function validCanonicalString(value: unknown, pattern: RegExp) {
  return typeof value === "string"
    && value === value.trim()
    && value === value.normalize("NFC")
    && pattern.test(value);
}

function validIsoTimestamp(value: unknown) {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function orderedDimensionScores(value: Readonly<Record<PublicLoungeQualityDimensionKey, number>>) {
  return Object.fromEntries(PUBLIC_LOUNGE_QUALITY_RUBRIC.map((rubric) => [
    rubric.key,
    value[rubric.key],
  ])) as Record<PublicLoungeQualityDimensionKey, number>;
}

export function calculateAuthorDeviceReviewQualityScore(
  dimensionScores: Readonly<Record<PublicLoungeQualityDimensionKey, number>>,
) {
  return Math.round(PUBLIC_LOUNGE_QUALITY_RUBRIC.reduce((total, rubric) => (
    total + dimensionScores[rubric.key] * rubric.weight
  ), 0) / 100);
}

type AuthorDeviceReviewDigestPayload = Omit<
  AuthorDeviceReviewDeclaration,
  "reviewDigest" | "antiReplayIdentity"
>;

function digestPayload(value: AuthorDeviceReviewBuildInput | AuthorDeviceReviewDeclaration): AuthorDeviceReviewDigestPayload {
  const declarationFields = value as Partial<AuthorDeviceReviewDeclaration>;
  return {
    schemaVersion: declarationFields.schemaVersion ?? AUTHOR_DEVICE_REVIEW_SCHEMA_VERSION,
    assurance: declarationFields.assurance ?? AUTHOR_DEVICE_REVIEW_ASSURANCE,
    issuedAt: value.issuedAt,
    nonce: value.nonce,
    completionFingerprint: value.completionFingerprint,
    backendId: value.backendId,
    modelId: value.modelId,
    modelDigest: value.modelDigest,
    fullCoverage: value.fullCoverage as true,
    hardGatePassed: value.hardGatePassed as true,
    compliancePassed: value.compliancePassed as true,
    criticalDimensionsPassed: value.criticalDimensionsPassed as true,
    qualityScore: value.qualityScore,
    dimensionScores: orderedDimensionScores(value.dimensionScores),
  };
}

export function canonicalSerializeAuthorDeviceReview(
  value: AuthorDeviceReviewBuildInput | AuthorDeviceReviewDeclaration,
) {
  return JSON.stringify(digestPayload(value));
}

async function sha256Hex(value: string) {
  if (!globalThis.crypto?.subtle) throw new Error("AUTHOR_DEVICE_REVIEW_DIGEST_UNAVAILABLE");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalSerializeAuthorDeviceReviewAntiReplayBinding(input: {
  issuedAt: string;
  nonce: string;
  completionFingerprint: string;
  reviewDigest: string;
}) {
  return JSON.stringify({
    completionFingerprint: input.completionFingerprint,
    issuedAt: input.issuedAt,
    nonce: input.nonce,
    reviewDigest: input.reviewDigest,
  });
}

export async function authorDeviceReviewDigest(
  value: AuthorDeviceReviewBuildInput | AuthorDeviceReviewDeclaration,
) {
  return sha256Hex(`novel:author-device-review:digest:v1\n${canonicalSerializeAuthorDeviceReview(value)}`);
}

export async function authorDeviceReviewAntiReplayIdentity(input: {
  issuedAt: string;
  nonce: string;
  completionFingerprint: string;
  reviewDigest: string;
}) {
  return sha256Hex(
    `novel:author-device-review:anti-replay:v1\n${canonicalSerializeAuthorDeviceReviewAntiReplayBinding(input)}`,
  );
}

function structuralValidationReasons(value: unknown) {
  const reasons = new Set<AuthorDeviceReviewValidationCode>();
  const record = recordValue(value);
  if (!record || !hasExactKeys(record, TOP_LEVEL_KEYS)) reasons.add("declaration_shape_invalid");
  if (containsForbiddenField(value)) reasons.add("forbidden_private_content_field");
  if (!record) return [...reasons];

  if (record.schemaVersion !== AUTHOR_DEVICE_REVIEW_SCHEMA_VERSION) reasons.add("schema_invalid");
  if (record.assurance !== AUTHOR_DEVICE_REVIEW_ASSURANCE) reasons.add("assurance_invalid");
  if (!validCanonicalString(record.modelId, MODEL_ID_PATTERN)) {
    reasons.add("identity_invalid");
  }
  if (!validIsoTimestamp(record.issuedAt)) reasons.add("issued_at_invalid");
  if (!validCanonicalString(record.nonce, NONCE_PATTERN)) reasons.add("nonce_invalid");
  if (!AUTHOR_DEVICE_REVIEW_BACKENDS.includes(record.backendId as AuthorDeviceReviewBackendId)) {
    reasons.add("backend_invalid");
  }
  if (typeof record.completionFingerprint !== "string" || !HASH_PATTERN.test(record.completionFingerprint)) {
    reasons.add("completion_fingerprint_invalid");
  }
  if (typeof record.modelDigest !== "string" || !HASH_PATTERN.test(record.modelDigest)) {
    reasons.add("model_digest_invalid");
  }
  if (record.fullCoverage !== true) reasons.add("full_coverage_required");
  if (record.hardGatePassed !== true) reasons.add("hard_gate_required");
  if (record.compliancePassed !== true) reasons.add("compliance_required");
  if (record.criticalDimensionsPassed !== true) reasons.add("critical_dimensions_required");

  const dimensionScores = recordValue(record.dimensionScores);
  const dimensionShapeValid = Boolean(dimensionScores && hasExactKeys(dimensionScores, DIMENSION_KEYS));
  if (!dimensionShapeValid || DIMENSION_KEYS.some((key) => (
    !Number.isInteger(dimensionScores?.[key])
    || (dimensionScores?.[key] as number) < 0
    || (dimensionScores?.[key] as number) > 100
  ))) {
    reasons.add("dimension_scores_invalid");
  }
  if (dimensionShapeValid && CRITICAL_DIMENSION_KEYS.some((key) => (
    (dimensionScores?.[key] as number) < AUTHOR_DEVICE_REVIEW_CRITICAL_DIMENSION_THRESHOLD
  ))) {
    reasons.add("critical_dimension_score_too_low");
  }
  if (typeof record.qualityScore !== "number" || !Number.isFinite(record.qualityScore)) {
    reasons.add("quality_score_invalid");
  } else {
    if (record.qualityScore < PUBLIC_LOUNGE_QUALITY_THRESHOLD) reasons.add("quality_score_below_threshold");
    if (dimensionShapeValid) {
      const expected = calculateAuthorDeviceReviewQualityScore(
        dimensionScores as Record<PublicLoungeQualityDimensionKey, number>,
      );
      if (record.qualityScore !== expected) reasons.add("weighted_score_mismatch");
    }
  }
  if (typeof record.reviewDigest !== "string" || !HASH_PATTERN.test(record.reviewDigest)) {
    reasons.add("review_digest_invalid");
  }
  if (typeof record.antiReplayIdentity !== "string" || !HASH_PATTERN.test(record.antiReplayIdentity)) {
    reasons.add("anti_replay_identity_invalid");
  }
  return [...reasons];
}

export async function validateAuthorDeviceReviewDeclaration(
  value: unknown,
  context: AuthorDeviceReviewValidationContext,
): Promise<AuthorDeviceReviewValidationResult> {
  const reasons = new Set(structuralValidationReasons(value));
  const record = recordValue(value);
  if (!record) return Object.freeze({ valid: false, reasons: Object.freeze([...reasons].sort()), declaration: null });
  if (record.completionFingerprint !== context.expectedCompletionFingerprint) {
    reasons.add("completion_identity_mismatch");
  }

  if (!reasons.has("declaration_shape_invalid")
    && !reasons.has("dimension_scores_invalid")
    && !reasons.has("review_digest_invalid")
    && !reasons.has("anti_replay_identity_invalid")) {
    const declaration = record as AuthorDeviceReviewDeclaration;
    const expectedReviewDigest = await authorDeviceReviewDigest(declaration);
    if (declaration.reviewDigest !== expectedReviewDigest) reasons.add("review_digest_mismatch");
    const expectedAntiReplayIdentity = await authorDeviceReviewAntiReplayIdentity({
      issuedAt: declaration.issuedAt,
      nonce: declaration.nonce,
      completionFingerprint: declaration.completionFingerprint,
      reviewDigest: declaration.reviewDigest,
    });
    if (declaration.antiReplayIdentity !== expectedAntiReplayIdentity) {
      reasons.add("anti_replay_identity_mismatch");
    }
    if (context.consumedAntiReplayIdentities?.has(declaration.antiReplayIdentity)) {
      reasons.add("anti_replay_identity_reused");
    }
  }

  const orderedReasons = Object.freeze([...reasons].sort());
  return Object.freeze({
    valid: orderedReasons.length === 0,
    reasons: orderedReasons,
    declaration: orderedReasons.length === 0 ? value as AuthorDeviceReviewDeclaration : null,
  });
}

export async function buildAuthorDeviceReviewDeclaration(
  input: AuthorDeviceReviewBuildInput,
): Promise<AuthorDeviceReviewDeclaration> {
  const reviewDigest = await authorDeviceReviewDigest(input);
  const antiReplayIdentity = await authorDeviceReviewAntiReplayIdentity({
    issuedAt: input.issuedAt,
    nonce: input.nonce,
    completionFingerprint: input.completionFingerprint,
    reviewDigest,
  });
  const declaration = {
    ...digestPayload(input),
    reviewDigest,
    antiReplayIdentity,
  } as AuthorDeviceReviewDeclaration;
  const validation = await validateAuthorDeviceReviewDeclaration(declaration, {
    expectedCompletionFingerprint: input.completionFingerprint,
  });
  if (!validation.valid || !validation.declaration) {
    throw Object.assign(new Error(validation.reasons[0] ?? "AUTHOR_DEVICE_REVIEW_INVALID"), {
      code: validation.reasons[0] ?? "AUTHOR_DEVICE_REVIEW_INVALID",
      reasons: validation.reasons,
    });
  }
  return Object.freeze({
    ...validation.declaration,
    dimensionScores: Object.freeze({ ...validation.declaration.dimensionScores }),
  });
}

/**
 * Combines the author-device declaration check with the deterministic public
 * payload packaging gate. The packaging gate is additive only: it cannot
 * perform, verify, or replace the closed-AI review represented by the
 * explicitly unverified author-device declaration.
 */
export async function evaluateAuthorDeviceReviewPublicationGate(input: {
  declaration: unknown;
  validationContext: AuthorDeviceReviewValidationContext;
  publicContent: {
    chapterCount: number;
    wordCount: number;
    publicChapters: readonly PublicLoungeOfficialChapterInput[];
    fullSynopsis: string;
  };
}): Promise<AuthorDeviceReviewPublicationGateResult> {
  const [review, publicContent] = await Promise.all([
    validateAuthorDeviceReviewDeclaration(input.declaration, input.validationContext),
    Promise.resolve(evaluatePublicLoungePublicContentGate(input.publicContent)),
  ]);
  return Object.freeze({
    passed: review.valid && publicContent.passed,
    assurance: AUTHOR_DEVICE_REVIEW_ASSURANCE,
    authorDeviceReviewPassed: review.valid,
    publicContentPackagingPassed: publicContent.passed,
    deterministicPublicContentGateReplacesClosedAI: false,
    reviewReasons: review.reasons,
    publicContentReasons: publicContent.reasons,
  });
}
