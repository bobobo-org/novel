import type { WholeNovelReviewContract } from "../whole-novel-review";
import type { AuthorDeviceReviewDeclaration } from "./author-device-review";
import {
  PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION,
  PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS,
  type PublicLoungeEligibilityProof,
  type PublicLoungeEligibilityRequest,
  type PublicLoungeAuthorDeviceEligibilityRequest,
  type PublicLoungeListQuery,
  type PublicLoungeListPage,
  type PublicLoungeOfficialChapterInput,
  type PublicLoungePost,
  type PublicLoungePublicationInput,
  type PublicLoungeServerReviewAttestation,
  type PublicLoungeServerEligibilityRequestV5,
  type PublicLoungeServerReviewAttestationV5,
} from "./types";
import { normalizePublicLoungeTopicIds } from "./taxonomy";
import type { PrivateHubPublicLoungeAttestationPublication } from "../providers/private-ai-hub/private-hub-client";
import {
  canonicalizePublicLoungeInlineText,
  canonicalizePublicLoungeProseText,
} from "../../../local-ai/shared/public-lounge-publication-canonical.mjs";

const MANAGEMENT_TOKEN_STORAGE_PREFIX = "novel:public-lounge:management:v1:";
const PUBLICATION_REFERENCE_STORAGE_PREFIX = "novel:public-lounge:publication:v1:";
const PUBLICATION_IDEMPOTENCY_STORAGE_PREFIX = "novel:public-lounge:idempotency:v1:";
const STORAGE_PROBE_PREFIX = "novel:public-lounge:storage-probe:v1:";
export const PUBLIC_LOUNGE_MANAGEMENT_RECOVERY_SCHEMA_VERSION = "public-lounge-management-recovery-v1" as const;

type DeviceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class PublicLoungeClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly recovery?: PublicLoungeManagementRecovery;

  constructor(code: string, status: number, recovery?: PublicLoungeManagementRecovery) {
    super(code);
    this.name = "PublicLoungeClientError";
    this.code = code;
    this.status = status;
    this.recovery = recovery;
  }
}

function normalizePublicLoungeSynopsis(value: string | undefined) {
  const synopsis = canonicalizePublicLoungeProseText(value ?? "");
  if (!synopsis || synopsis.length > PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_PAYLOAD_INVALID", 422);
  }
  return synopsis;
}

function authorDeviceStorage(storage?: DeviceStorage) {
  if (storage) return storage;
  if (typeof window === "undefined") {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_AUTHOR_DEVICE_STORAGE_UNAVAILABLE", 500);
  }
  return window.localStorage;
}

function tokenStorageKey(publicId: string) {
  return `${MANAGEMENT_TOKEN_STORAGE_PREFIX}${publicId}`;
}

export type PublicLoungePublicationReference = {
  publicId: string;
  publishedAt: string;
  title: string;
};

export type PublicLoungeManagementRecovery = {
  schemaVersion: typeof PUBLIC_LOUNGE_MANAGEMENT_RECOVERY_SCHEMA_VERSION;
  publicId: string;
  managementToken: string;
  completionFingerprint: string;
  publishedAt: string;
  title: string;
};

function publicationReferenceStorageKey(completionFingerprint: string) {
  return `${PUBLICATION_REFERENCE_STORAGE_PREFIX}${completionFingerprint}`;
}

async function publicationIdempotencyStorageKey(
  completionFingerprint: string,
  eligibilityTicket: string,
) {
  if (!globalThis.crypto?.subtle) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_AUTHOR_DEVICE_STORAGE_UNAVAILABLE", 500);
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(eligibilityTicket),
  );
  const ticketHash = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${PUBLICATION_IDEMPOTENCY_STORAGE_PREFIX}${completionFingerprint}:${ticketHash}`;
}

function freshPublicationIdempotencyKey() {
  const value = globalThis.crypto?.randomUUID?.().replace(/-/gu, "") ?? "";
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(value)) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_AUTHOR_DEVICE_STORAGE_UNAVAILABLE", 500);
  }
  return value;
}

function workPublicationReferenceStorageKey(workId: string) {
  if (!workId.trim()) throw new PublicLoungeClientError("PUBLIC_LOUNGE_PAYLOAD_INVALID", 422);
  return `${PUBLICATION_REFERENCE_STORAGE_PREFIX}work:${encodeURIComponent(workId.trim())}`;
}

function parsePublicationReference(serialized: string | null): PublicLoungePublicationReference | null {
  try {
    const value = JSON.parse(serialized ?? "null") as Partial<PublicLoungePublicationReference> | null;
    return value
      && typeof value.publicId === "string"
      && /^novel_[a-z0-9_-]{12,80}$/u.test(value.publicId)
      && typeof value.publishedAt === "string"
      && Number.isFinite(new Date(value.publishedAt).valueOf())
      && typeof value.title === "string"
      ? value as PublicLoungePublicationReference
      : null;
  } catch {
    return null;
  }
}

function bestEffortRemove(storage: DeviceStorage, keys: string[]) {
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // The recovery credential remains in memory and can still be exported.
    }
  }
}

export function assertPublicLoungeAuthorDeviceStorageWritable(storage?: DeviceStorage) {
  const target = authorDeviceStorage(storage);
  const probeKey = `${STORAGE_PROBE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const probeValue = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    target.setItem(probeKey, probeValue);
    if (target.getItem(probeKey) !== probeValue) throw new Error("STORAGE_PROBE_MISMATCH");
    target.removeItem(probeKey);
    return target;
  } catch {
    bestEffortRemove(target, [probeKey]);
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_AUTHOR_DEVICE_STORAGE_UNAVAILABLE", 507);
  }
}

export function persistPublicLoungeManagementRecovery(
  recovery: PublicLoungeManagementRecovery,
  storage?: DeviceStorage,
  workId?: string,
) {
  const target = assertPublicLoungeAuthorDeviceStorageWritable(storage);
  const tokenKey = tokenStorageKey(recovery.publicId);
  const referenceKey = publicationReferenceStorageKey(recovery.completionFingerprint);
  const workReferenceKey = workId ? workPublicationReferenceStorageKey(workId) : null;
  const serializedReference = JSON.stringify({
    publicId: recovery.publicId,
    publishedAt: recovery.publishedAt,
    title: recovery.title,
  });
  try {
    target.setItem(tokenKey, recovery.managementToken);
    target.setItem(referenceKey, serializedReference);
    if (workReferenceKey) target.setItem(workReferenceKey, serializedReference);
    if (
      target.getItem(tokenKey) !== recovery.managementToken
      || target.getItem(referenceKey) !== serializedReference
      || (workReferenceKey !== null && target.getItem(workReferenceKey) !== serializedReference)
    ) {
      throw new Error("STORAGE_COMMIT_MISMATCH");
    }
  } catch {
    bestEffortRemove(target, [tokenKey, referenceKey, ...(workReferenceKey ? [workReferenceKey] : [])]);
    throw new PublicLoungeClientError(
      "PUBLIC_LOUNGE_AUTHOR_DEVICE_STORAGE_WRITE_FAILED",
      507,
      recovery,
    );
  }
  return {
    publicId: recovery.publicId,
    publishedAt: recovery.publishedAt,
    title: recovery.title,
  } satisfies PublicLoungePublicationReference;
}

export function savePublicLoungePublicationReference(
  completionFingerprint: string,
  post: Pick<PublicLoungePost, "publicId" | "publishedAt" | "title">,
  storage?: DeviceStorage,
) {
  authorDeviceStorage(storage).setItem(
    publicationReferenceStorageKey(completionFingerprint),
    JSON.stringify({ publicId: post.publicId, publishedAt: post.publishedAt, title: post.title }),
  );
}

export function loadPublicLoungePublicationReference(
  completionFingerprint: string,
  storage?: DeviceStorage,
): PublicLoungePublicationReference | null {
  return parsePublicationReference(authorDeviceStorage(storage).getItem(
    publicationReferenceStorageKey(completionFingerprint),
  ));
}

/**
 * Device-only stable association between a local work and its public post.
 * The work id is used only as a localStorage key and is never serialized into
 * an eligibility or publication request.
 */
export function savePublicLoungeWorkPublicationReference(
  workId: string,
  post: Pick<PublicLoungePost, "publicId" | "publishedAt" | "title">,
  storage?: DeviceStorage,
) {
  authorDeviceStorage(storage).setItem(
    workPublicationReferenceStorageKey(workId),
    JSON.stringify({ publicId: post.publicId, publishedAt: post.publishedAt, title: post.title }),
  );
}

export function loadPublicLoungeWorkPublicationReference(
  workId: string,
  storage?: DeviceStorage,
): PublicLoungePublicationReference | null {
  return parsePublicationReference(authorDeviceStorage(storage).getItem(
    workPublicationReferenceStorageKey(workId),
  ));
}

export function removePublicLoungeWorkPublicationReference(
  workId: string,
  storage?: DeviceStorage,
) {
  bestEffortRemove(authorDeviceStorage(storage), [workPublicationReferenceStorageKey(workId)]);
}

export function removePublicLoungePublicationReference(
  completionFingerprint: string,
  storage?: DeviceStorage,
) {
  bestEffortRemove(authorDeviceStorage(storage), [publicationReferenceStorageKey(completionFingerprint)]);
}

async function responseJson<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null) as {
    error?: { code?: string };
  } | null;
  if (!response.ok) {
    throw new PublicLoungeClientError(
      value?.error?.code ?? "PUBLIC_LOUNGE_REQUEST_FAILED",
      response.status,
    );
  }
  return value as T;
}

async function publicationAccessToken(explicit?: string) {
  let token = explicit?.trim() ?? "";
  if (!token) {
    token = await import("./auth-browser").then(({ requirePublicLoungeAccessToken }) => (
      requirePublicLoungeAccessToken()
    ));
  }
  if (!/^[A-Za-z0-9._~-]{32,4096}$/u.test(token)) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_AUTH_REQUIRED", 401);
  }
  return token;
}

export function createPublicLoungePublicationFromWholeNovelReview(input: {
  review: WholeNovelReviewContract;
  authorByline: string;
  topicIds: readonly string[];
  fullSynopsis?: string;
  selectedOfficialChapters: Array<Omit<PublicLoungeOfficialChapterInput, "official">>;
  explicitConsent: boolean;
  authorRightsDeclaration: boolean;
  eligibilityProof: PublicLoungeEligibilityProof;
}): PublicLoungePublicationInput {
  if (!Number.isInteger(input.eligibilityProof.qualityScore) || input.eligibilityProof.qualityScore < 80) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_SCORE_NOT_QUALIFIED", 422);
  }
  if (!input.explicitConsent) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_CONSENT_REQUIRED", 422);
  }
  if (!input.authorRightsDeclaration) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_RIGHTS_DECLARATION_REQUIRED", 422);
  }
  const fullSynopsis = normalizePublicLoungeSynopsis(
    input.fullSynopsis?.trim() || input.review.publicMetadata.synopsis?.trim(),
  );
  let taxonomy;
  try {
    taxonomy = normalizePublicLoungeTopicIds(input.topicIds);
  } catch {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_PAYLOAD_INVALID", 422);
  }
  if (
    input.eligibilityProof.schemaVersion !== PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION
    || input.eligibilityProof.qualityAssurance !== "private_ai_hub_verified"
    || input.eligibilityProof.backendId !== "private-ai-hub"
    || input.eligibilityProof.completionFingerprint !== input.review.completion.completionFingerprint
  ) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
  }
  return {
    schemaVersion: PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
    title: canonicalizePublicLoungeInlineText(input.review.publicMetadata.title),
    authorByline: canonicalizePublicLoungeInlineText(input.authorByline),
    ...taxonomy,
    completionStatus: "completed",
    chapterCount: input.review.publicMetadata.chapterCount,
    wordCount: input.review.publicMetadata.nonWhitespaceCharacters,
    completedAt: input.review.publicMetadata.completedAt,
    qualityScore: input.eligibilityProof.qualityScore,
    qualityBreakdown: input.eligibilityProof.qualityBreakdown,
    fullSynopsis,
    publicChapters: input.selectedOfficialChapters.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      title: canonicalizePublicLoungeInlineText(chapter.title),
      body: canonicalizePublicLoungeProseText(chapter.body),
      official: true,
    })),
    eligibilityTicket: input.eligibilityProof.eligibilityTicket,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
  };
}

export function createPublicLoungeEligibilityRequestFromWholeNovelReview(input: {
  review: WholeNovelReviewContract;
  authorByline: string;
  topicIds: readonly string[];
  fullSynopsis: string;
  selectedOfficialChapters: Array<Omit<PublicLoungeOfficialChapterInput, "official">>;
  explicitConsent: boolean;
  authorRightsDeclaration: boolean;
  serverAttestation: PublicLoungeServerReviewAttestation;
}): PublicLoungeEligibilityRequest {
  if (!input.explicitConsent) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_CONSENT_REQUIRED", 422);
  }
  if (!input.authorRightsDeclaration) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_RIGHTS_DECLARATION_REQUIRED", 422);
  }
  let taxonomy;
  try {
    taxonomy = normalizePublicLoungeTopicIds(input.topicIds);
  } catch {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_PAYLOAD_INVALID", 422);
  }
  return {
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
    completionFingerprint: input.review.completion.completionFingerprint,
    title: input.review.publicMetadata.title,
    authorByline: input.authorByline,
    ...taxonomy,
    completionStatus: "completed",
    chapterCount: input.review.publicMetadata.chapterCount,
    wordCount: input.review.publicMetadata.nonWhitespaceCharacters,
    completedAt: input.review.publicMetadata.completedAt,
    fullSynopsis: normalizePublicLoungeSynopsis(input.fullSynopsis),
    publicChapters: input.selectedOfficialChapters.map((chapter) => ({ ...chapter, official: true })),
    serverAttestation: input.serverAttestation,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
    trustedServerReviewConsent: true,
  };
}

export function createPublicLoungeAttestationPublicationFromWholeNovelReview(input: {
  review: WholeNovelReviewContract;
  authorByline: string;
  topicIds: readonly string[];
  fullSynopsis: string;
  selectedOfficialChapters: Array<Omit<PublicLoungeOfficialChapterInput, "official">>;
  explicitConsent: boolean;
  authorRightsDeclaration: boolean;
}): PrivateHubPublicLoungeAttestationPublication {
  if (!input.explicitConsent) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_CONSENT_REQUIRED", 422);
  }
  if (!input.authorRightsDeclaration) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_RIGHTS_DECLARATION_REQUIRED", 422);
  }
  let taxonomy;
  try {
    taxonomy = normalizePublicLoungeTopicIds(input.topicIds);
  } catch {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_PAYLOAD_INVALID", 422);
  }
  const publicChapters = input.selectedOfficialChapters.map((chapter) => ({
    chapterNumber: chapter.chapterNumber,
    title: canonicalizePublicLoungeInlineText(chapter.title),
    body: canonicalizePublicLoungeProseText(chapter.body),
    official: true as const,
  }));
  const wordCount = publicChapters.reduce(
    (total, chapter) => total + chapter.body.replace(/\s/gu, "").length,
    0,
  );
  if (
    publicChapters.length !== input.review.publicMetadata.chapterCount
    || publicChapters.some((chapter, index) => (
      chapter.chapterNumber !== index + 1 || !chapter.title || !chapter.body
    ))
    || wordCount !== input.review.publicMetadata.nonWhitespaceCharacters
  ) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_WORK_NOT_COMPLETED", 422);
  }
  return {
    schemaVersion: PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
    title: canonicalizePublicLoungeInlineText(input.review.publicMetadata.title),
    authorByline: canonicalizePublicLoungeInlineText(input.authorByline),
    ...taxonomy,
    completionStatus: "completed",
    chapterCount: input.review.publicMetadata.chapterCount,
    wordCount,
    completedAt: input.review.publicMetadata.completedAt,
    fullSynopsis: normalizePublicLoungeSynopsis(input.fullSynopsis),
    publicChapters,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
  };
}

type PublicLoungeEligibilityV5Operation =
  | {
    intent: "publish";
    targetPublicationId: null;
    expectedTargetVersionId: null;
    expectedTargetPublicationDigest: null;
    serverAttestation: Extract<PublicLoungeServerReviewAttestationV5, { intent: "publish" }>;
  }
  | {
    intent: "overwrite";
    targetPublicationId: string;
    expectedTargetVersionId: string;
    expectedTargetPublicationDigest: string;
    serverAttestation: Extract<PublicLoungeServerReviewAttestationV5, { intent: "overwrite" }>;
  };

export function createPublicLoungeServerEligibilityRequestV5(input: {
  projectId: string;
  completionFingerprint: string;
  publication: PrivateHubPublicLoungeAttestationPublication;
} & PublicLoungeEligibilityV5Operation): PublicLoungeServerEligibilityRequestV5 {
  const workId = input.projectId.trim();
  const revisionId = input.completionFingerprint;
  const attestation = input.serverAttestation;
  const { schemaVersion: publicationSchemaVersion, ...publication } = input.publication;
  if (
    !workId
    || !/^[a-f0-9]{64}$/u.test(revisionId)
    || publicationSchemaVersion !== PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION
    || attestation.workId !== workId
    || attestation.revisionId !== revisionId
    || attestation.completionFingerprint !== revisionId
    || attestation.intent !== input.intent
    || attestation.targetPublicationId !== input.targetPublicationId
    || attestation.expectedTargetVersionId !== input.expectedTargetVersionId
    || attestation.expectedTargetPublicationDigest !== input.expectedTargetPublicationDigest
  ) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
  }
  const common = {
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
    completionFingerprint: revisionId,
    workId,
    revisionId,
    ...publication,
    trustedServerReviewConsent: true as const,
  };
  return input.intent === "publish"
    ? {
      ...common,
      intent: "publish",
      targetPublicationId: null,
      expectedTargetVersionId: null,
      expectedTargetPublicationDigest: null,
      serverAttestation: input.serverAttestation,
    }
    : {
      ...common,
      intent: "overwrite",
      targetPublicationId: input.targetPublicationId,
      expectedTargetVersionId: input.expectedTargetVersionId,
      expectedTargetPublicationDigest: input.expectedTargetPublicationDigest,
      serverAttestation: input.serverAttestation,
    };
}

export function createPublicLoungeAuthorDeviceEligibilityRequestFromWholeNovelReview(input: {
  review: WholeNovelReviewContract;
  authorByline: string;
  topicIds: readonly string[];
  fullSynopsis: string;
  selectedOfficialChapters: Array<Omit<PublicLoungeOfficialChapterInput, "official">>;
  explicitConsent: boolean;
  authorRightsDeclaration: boolean;
  authorDeviceReviewConsent: boolean;
  authorDeviceReview: AuthorDeviceReviewDeclaration;
}): PublicLoungeAuthorDeviceEligibilityRequest {
  if (!input.explicitConsent || !input.authorDeviceReviewConsent) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_CONSENT_REQUIRED", 422);
  }
  if (!input.authorRightsDeclaration) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_RIGHTS_DECLARATION_REQUIRED", 422);
  }
  if (input.authorDeviceReview.completionFingerprint !== input.review.completion.completionFingerprint) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
  }
  let taxonomy;
  try {
    taxonomy = normalizePublicLoungeTopicIds(input.topicIds);
  } catch {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_PAYLOAD_INVALID", 422);
  }
  return {
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
    completionFingerprint: input.review.completion.completionFingerprint,
    title: input.review.publicMetadata.title,
    authorByline: input.authorByline,
    ...taxonomy,
    completionStatus: "completed",
    chapterCount: input.review.publicMetadata.chapterCount,
    wordCount: input.review.publicMetadata.nonWhitespaceCharacters,
    completedAt: input.review.publicMetadata.completedAt,
    fullSynopsis: normalizePublicLoungeSynopsis(input.fullSynopsis),
    publicChapters: input.selectedOfficialChapters.map((chapter) => ({ ...chapter, official: true })),
    authorDeviceReview: input.authorDeviceReview,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
    authorDeviceReviewConsent: true,
  };
}

export async function requestPublicLoungeEligibilityProof(
  input: PublicLoungeEligibilityRequest,
  options: { accessToken?: string } = {},
) {
  const accessToken = await publicationAccessToken(options.accessToken);
  const response = await fetch("/api/lounge/eligibility", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  return (await responseJson<{ proof: PublicLoungeEligibilityProof }>(response)).proof;
}

export async function requestPublicLoungeEligibilityProofV5(
  input: PublicLoungeServerEligibilityRequestV5,
  options: { accessToken?: string } = {},
) {
  const accessToken = await publicationAccessToken(options.accessToken);
  const response = await fetch("/api/lounge/eligibility", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  return (await responseJson<{ proof: PublicLoungeEligibilityProof }>(response)).proof;
}

export async function publishPublicLoungePost(
  input: PublicLoungePublicationInput,
  options: {
    completionFingerprint: string;
    workId?: string;
    storage?: DeviceStorage;
    accessToken?: string;
  },
) {
  const storage = assertPublicLoungeAuthorDeviceStorageWritable(options.storage);
  const idempotencyStorageKey = await publicationIdempotencyStorageKey(
    options.completionFingerprint,
    input.eligibilityTicket,
  );
  let idempotencyKey = storage.getItem(idempotencyStorageKey) ?? "";
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(idempotencyKey)) {
    idempotencyKey = freshPublicationIdempotencyKey();
    try {
      storage.setItem(idempotencyStorageKey, idempotencyKey);
      if (storage.getItem(idempotencyStorageKey) !== idempotencyKey) {
        throw new Error("IDEMPOTENCY_WRITE_MISMATCH");
      }
    } catch {
      bestEffortRemove(storage, [idempotencyStorageKey]);
      throw new PublicLoungeClientError("PUBLIC_LOUNGE_AUTHOR_DEVICE_STORAGE_WRITE_FAILED", 507);
    }
  }
  const accessToken = await publicationAccessToken(options.accessToken);
  const response = await fetch("/api/lounge", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  const result = await responseJson<{ post: PublicLoungePost; managementToken: string }>(response);
  const recovery: PublicLoungeManagementRecovery = {
    schemaVersion: PUBLIC_LOUNGE_MANAGEMENT_RECOVERY_SCHEMA_VERSION,
    publicId: result.post.publicId,
    managementToken: result.managementToken,
    completionFingerprint: options.completionFingerprint,
    publishedAt: result.post.publishedAt,
    title: result.post.title,
  };
  try {
    persistPublicLoungeManagementRecovery(recovery, storage, options.workId);
    bestEffortRemove(storage, [idempotencyStorageKey]);
  } catch {
    try {
      await retractPublicLoungePostWithToken(
        recovery.publicId,
        recovery.managementToken,
        accessToken,
      );
      bestEffortRemove(storage, [
        tokenStorageKey(recovery.publicId),
        publicationReferenceStorageKey(recovery.completionFingerprint),
        ...(options.workId ? [workPublicationReferenceStorageKey(options.workId)] : []),
        idempotencyStorageKey,
      ]);
      throw new PublicLoungeClientError(
        "PUBLIC_LOUNGE_AUTHOR_DEVICE_STORAGE_WRITE_ROLLED_BACK",
        507,
      );
    } catch (compensationError) {
      if (
        compensationError instanceof PublicLoungeClientError
        && compensationError.code === "PUBLIC_LOUNGE_AUTHOR_DEVICE_STORAGE_WRITE_ROLLED_BACK"
      ) {
        throw compensationError;
      }
      throw new PublicLoungeClientError(
        "PUBLIC_LOUNGE_MANAGEMENT_RECOVERY_REQUIRED",
        503,
        recovery,
      );
    }
  }
  return result.post;
}

export async function retractPublicLoungePostWithToken(
  publicId: string,
  managementToken: string,
  explicitAccessToken?: string,
) {
  const accessToken = await publicationAccessToken(explicitAccessToken);
  const response = await fetch(`/api/lounge/${encodeURIComponent(publicId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Public-Lounge-Management-Token": managementToken,
    },
  });
  if (!response.ok) await responseJson(response);
}

export async function resolvePublicLoungeManagementRecovery(
  recovery: PublicLoungeManagementRecovery,
  action: "persist" | "retract",
  options: { storage?: DeviceStorage; workId?: string; accessToken?: string } = {},
) {
  if (action === "persist") {
    return persistPublicLoungeManagementRecovery(recovery, options.storage, options.workId);
  }
  await retractPublicLoungePostWithToken(
    recovery.publicId,
    recovery.managementToken,
    options.accessToken,
  );
  const storage = authorDeviceStorage(options.storage);
  bestEffortRemove(storage, [
    tokenStorageKey(recovery.publicId),
    publicationReferenceStorageKey(recovery.completionFingerprint),
    ...(options.workId ? [workPublicationReferenceStorageKey(options.workId)] : []),
  ]);
  return null;
}

export async function overwritePublicLoungePost(
  publicId: string,
  input: PublicLoungePublicationInput,
  options: { storage?: DeviceStorage; accessToken?: string } = {},
) {
  const accessToken = await publicationAccessToken(options.accessToken);
  const token = authorDeviceStorage(options.storage).getItem(tokenStorageKey(publicId));
  if (!token) throw new PublicLoungeClientError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED", 401);
  const response = await fetch(`/api/lounge/${encodeURIComponent(publicId)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Public-Lounge-Management-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return (await responseJson<{ post: PublicLoungePost }>(response)).post;
}

export async function retractPublicLoungePost(
  publicId: string,
  options: { storage?: DeviceStorage; accessToken?: string } = {},
) {
  const storage = authorDeviceStorage(options.storage);
  const token = storage.getItem(tokenStorageKey(publicId));
  if (!token) throw new PublicLoungeClientError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED", 401);
  await retractPublicLoungePostWithToken(publicId, token, options.accessToken);
  bestEffortRemove(storage, [tokenStorageKey(publicId)]);
}

export async function listPublicLoungePosts(query: PublicLoungeListQuery = {}) {
  const search = new URLSearchParams();
  if (query.search) search.set("q", query.search);
  if (query.shelfId) search.set("shelf", query.shelfId);
  if (query.completedOnly === false) search.set("completed", "false");
  if (query.cursor) search.set("cursor", query.cursor);
  if (query.limit !== undefined) search.set("limit", String(query.limit));
  const response = await fetch(`/api/lounge${search.size ? `?${search}` : ""}`, {
    credentials: "same-origin",
  });
  return responseJson<PublicLoungeListPage & { connected: true; count: number }>(response);
}

export async function getPublicLoungePost(publicId: string) {
  const response = await fetch(`/api/lounge/${encodeURIComponent(publicId)}`, {
    credentials: "same-origin",
  });
  return (await responseJson<{ post: PublicLoungePost }>(response)).post;
}
