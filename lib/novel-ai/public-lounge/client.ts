import type { WholeNovelReviewContract } from "../whole-novel-review";
import {
  PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION,
  type PublicLoungeEligibilityProof,
  type PublicLoungeEligibilityRequest,
  type PublicLoungeListQuery,
  type PublicLoungeListPage,
  type PublicLoungeOfficialChapterInput,
  type PublicLoungePost,
  type PublicLoungePublicationInput,
  type PublicLoungeServerReviewAttestation,
} from "./types";

const MANAGEMENT_TOKEN_STORAGE_PREFIX = "novel:public-lounge:management:v1:";
const PUBLICATION_REFERENCE_STORAGE_PREFIX = "novel:public-lounge:publication:v1:";
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
) {
  const target = assertPublicLoungeAuthorDeviceStorageWritable(storage);
  const tokenKey = tokenStorageKey(recovery.publicId);
  const referenceKey = publicationReferenceStorageKey(recovery.completionFingerprint);
  const serializedReference = JSON.stringify({
    publicId: recovery.publicId,
    publishedAt: recovery.publishedAt,
    title: recovery.title,
  });
  try {
    target.setItem(tokenKey, recovery.managementToken);
    target.setItem(referenceKey, serializedReference);
    if (
      target.getItem(tokenKey) !== recovery.managementToken
      || target.getItem(referenceKey) !== serializedReference
    ) {
      throw new Error("STORAGE_COMMIT_MISMATCH");
    }
  } catch {
    bestEffortRemove(target, [tokenKey, referenceKey]);
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
  try {
    const value = JSON.parse(authorDeviceStorage(storage).getItem(
      publicationReferenceStorageKey(completionFingerprint),
    ) ?? "null") as Partial<PublicLoungePublicationReference> | null;
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

export function createPublicLoungePublicationFromWholeNovelReview(input: {
  review: WholeNovelReviewContract;
  authorByline: string;
  category?: string;
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
  const category = input.category?.trim() || input.review.publicMetadata.category?.trim();
  const fullSynopsis = input.fullSynopsis?.trim() || input.review.publicMetadata.synopsis?.trim();
  if (!category || !fullSynopsis) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_PAYLOAD_INVALID", 422);
  }
  if (
    input.eligibilityProof.schemaVersion !== PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION
    || input.eligibilityProof.backendId !== "private-ai-hub"
    || input.eligibilityProof.completionFingerprint !== input.review.completion.completionFingerprint
  ) {
    throw new PublicLoungeClientError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
  }
  return {
    schemaVersion: PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
    title: input.review.publicMetadata.title,
    authorByline: input.authorByline,
    category,
    completionStatus: "completed",
    chapterCount: input.review.publicMetadata.chapterCount,
    wordCount: input.review.publicMetadata.nonWhitespaceCharacters,
    completedAt: input.review.publicMetadata.completedAt,
    qualityScore: input.eligibilityProof.qualityScore,
    qualityBreakdown: input.eligibilityProof.qualityBreakdown,
    fullSynopsis,
    publicChapters: input.selectedOfficialChapters.map((chapter) => ({
      ...chapter,
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
  category: string;
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
  return {
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
    completionFingerprint: input.review.completion.completionFingerprint,
    title: input.review.publicMetadata.title,
    authorByline: input.authorByline,
    category: input.category,
    completionStatus: "completed",
    chapterCount: input.review.publicMetadata.chapterCount,
    wordCount: input.review.publicMetadata.nonWhitespaceCharacters,
    completedAt: input.review.publicMetadata.completedAt,
    fullSynopsis: input.fullSynopsis,
    publicChapters: input.selectedOfficialChapters.map((chapter) => ({ ...chapter, official: true })),
    serverAttestation: input.serverAttestation,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
    trustedServerReviewConsent: true,
  };
}

export async function requestPublicLoungeEligibilityProof(input: PublicLoungeEligibilityRequest) {
  const response = await fetch("/api/lounge/eligibility", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await responseJson<{ proof: PublicLoungeEligibilityProof }>(response)).proof;
}

export async function publishPublicLoungePost(
  input: PublicLoungePublicationInput,
  options: { completionFingerprint: string; storage?: DeviceStorage },
) {
  const storage = assertPublicLoungeAuthorDeviceStorageWritable(options.storage);
  const response = await fetch("/api/lounge", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
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
    persistPublicLoungeManagementRecovery(recovery, storage);
  } catch {
    try {
      await retractPublicLoungePostWithToken(recovery.publicId, recovery.managementToken);
      bestEffortRemove(storage, [
        tokenStorageKey(recovery.publicId),
        publicationReferenceStorageKey(recovery.completionFingerprint),
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

export async function retractPublicLoungePostWithToken(publicId: string, managementToken: string) {
  const response = await fetch(`/api/lounge/${encodeURIComponent(publicId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { Authorization: `Bearer ${managementToken}` },
  });
  if (!response.ok) await responseJson(response);
}

export async function resolvePublicLoungeManagementRecovery(
  recovery: PublicLoungeManagementRecovery,
  action: "persist" | "retract",
  options: { storage?: DeviceStorage } = {},
) {
  if (action === "persist") {
    return persistPublicLoungeManagementRecovery(recovery, options.storage);
  }
  await retractPublicLoungePostWithToken(recovery.publicId, recovery.managementToken);
  const storage = authorDeviceStorage(options.storage);
  bestEffortRemove(storage, [
    tokenStorageKey(recovery.publicId),
    publicationReferenceStorageKey(recovery.completionFingerprint),
  ]);
  return null;
}

export async function overwritePublicLoungePost(
  publicId: string,
  input: PublicLoungePublicationInput,
  options: { storage?: DeviceStorage } = {},
) {
  const token = authorDeviceStorage(options.storage).getItem(tokenStorageKey(publicId));
  if (!token) throw new PublicLoungeClientError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED", 401);
  const response = await fetch(`/api/lounge/${encodeURIComponent(publicId)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return (await responseJson<{ post: PublicLoungePost }>(response)).post;
}

export async function retractPublicLoungePost(
  publicId: string,
  options: { storage?: DeviceStorage } = {},
) {
  const storage = authorDeviceStorage(options.storage);
  const token = storage.getItem(tokenStorageKey(publicId));
  if (!token) throw new PublicLoungeClientError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED", 401);
  await retractPublicLoungePostWithToken(publicId, token);
  bestEffortRemove(storage, [tokenStorageKey(publicId)]);
}

export async function listPublicLoungePosts(query: PublicLoungeListQuery = {}) {
  const search = new URLSearchParams();
  if (query.search) search.set("q", query.search);
  if (query.category) search.set("category", query.category);
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
