import type {
  PublicLoungePost,
  PublicLoungePostSummary,
  PublicLoungeQualityDimensionKey,
  PublicLoungeQualityAssurance,
  PublicLoungeAbuseRateScope,
} from "./types";
import {
  PUBLIC_LOUNGE_LEGACY_STORED_POST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PRIOR_STORED_POST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PUBLISHED_VERSION_SCHEMA_VERSION,
  PUBLIC_LOUNGE_STORED_ELIGIBILITY_SCHEMA_VERSION,
  PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION,
} from "./types";

export const PUBLIC_LOUNGE_STORAGE_PREFIX = "public-lounge-v1";
export const PUBLIC_LOUNGE_STORAGE_BUCKET = "novel-public-lounge-v1";
export const PUBLIC_LOUNGE_STORAGE_SCHEMA_VERSION = "novel-public-lounge-storage-v1";
export const PUBLIC_LOUNGE_STORAGE_MIGRATION_VERSION = "public_lounge_storage_001";
export const PUBLIC_LOUNGE_STORAGE_MARKER_PATH = `_system/${PUBLIC_LOUNGE_STORAGE_MIGRATION_VERSION}.json`;
export const PUBLIC_LOUNGE_CONTROL_PLANE_MIGRATION_VERSION = "public_lounge_control_plane_028";
export const PUBLIC_LOUNGE_MUTATION_RATE_SLOT_COUNT = 6;
export const PUBLIC_LOUNGE_ABUSE_RATE_SLOT_COUNT = 6;
export const PUBLIC_LOUNGE_READ_RATE_SLOT_COUNT = 30;

export type PublicLoungeCatalogCursor = {
  publishedAt: string;
  publicId: string;
};

export type PublicLoungeCatalogCandidate = PublicLoungeCatalogCursor;

export type PublicLoungeCatalogCandidatePage = {
  items: PublicLoungeCatalogCandidate[];
  hasMore: boolean;
};

export type PublicLoungeControlPlaneStatus = {
  migrationVersion: typeof PUBLIC_LOUNGE_CONTROL_PLANE_MIGRATION_VERSION;
  catalogReady: true;
  rateReady: true;
};

export type PublicLoungeRateScope = PublicLoungeAbuseRateScope | "work_mutation";

export type PublicLoungeRateReservation = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export interface PublicLoungeStorageGateway {
  bucketStatus(): Promise<{ exists: boolean; public: boolean; provisioned: boolean }>;
  controlPlaneStatus(): Promise<PublicLoungeControlPlaneStatus>;
  readJson<T>(path: string): Promise<T | null>;
  writeJson(path: string, value: unknown, options: { upsert: boolean }): Promise<"stored" | "exists">;
  deleteJson(paths: string[]): Promise<void>;
  listCatalogCandidates(options: {
    after: PublicLoungeCatalogCursor | null;
    limit: number;
  }): Promise<PublicLoungeCatalogCandidatePage>;
  upsertCatalogAnchor(candidate: PublicLoungeCatalogCandidate): Promise<void>;
  deactivateCatalogAnchor(publicId: string): Promise<void>;
  reserveRate(options: {
    identityHash: string;
    scope: PublicLoungeRateScope;
    now: string;
  }): Promise<PublicLoungeRateReservation>;
}

export type StoredPublicLoungePost = {
  schemaVersion: typeof PUBLIC_LOUNGE_PRIOR_STORED_POST_SCHEMA_VERSION
    | typeof PUBLIC_LOUNGE_LEGACY_STORED_POST_SCHEMA_VERSION;
  state: "active";
  publicPost: PublicLoungePost | Record<string, unknown>;
  managementTokenHash: string;
  updatedAt: string;
};

export type StoredPublicLoungeCurrentPointer = {
  schemaVersion: typeof PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION;
  state: "active";
  publicId: string;
  currentVersionId: string;
  currentVersionNumber: number;
  currentVersionDigest?: string;
  mutationSequence?: number;
  publicSummary?: PublicLoungePostSummary;
  publicContentGate?: StoredPublicLoungePublicContentGateBinding;
  managementTokenHash: string;
  updatedAt: string;
};

export type StoredPublicLoungePublicContentGateBinding = {
  schemaVersion: "public-lounge-public-content-gate-binding-v1";
  passed: true;
  contentDigest: string;
};

export type StoredPublicLoungePublishedVersion = {
  schemaVersion: typeof PUBLIC_LOUNGE_PUBLISHED_VERSION_SCHEMA_VERSION;
  publicId: string;
  versionId: string;
  versionNumber: number;
  versionPublishedAt: string;
  publicPost: PublicLoungePost;
};

export type StoredPublicLoungeTombstone = {
  schemaVersion: typeof PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION
    | typeof PUBLIC_LOUNGE_PRIOR_STORED_POST_SCHEMA_VERSION
    | typeof PUBLIC_LOUNGE_LEGACY_STORED_POST_SCHEMA_VERSION;
  state: "retracted";
  publicId: string;
  mutationSequence?: number;
  managementTokenHash: string;
  updatedAt: string;
};

export type StoredPublicLoungeIndexEntry = PublicLoungePostSummary;

export type StoredPublicLoungeEligibility = {
  schemaVersion: typeof PUBLIC_LOUNGE_STORED_ELIGIBILITY_SCHEMA_VERSION;
  state: "issued";
  ticketHash: string;
  completionFingerprint: string;
  publicationDigest: string;
  authorizedOwnerIdHash: string;
  backendId: "private-ai-hub" | "browser-ai" | "local-ollama";
  modelId: string;
  modelDigest: string;
  qualityScore: number;
  qualityBreakdown: Record<PublicLoungeQualityDimensionKey, number>;
  qualityAssurance: PublicLoungeQualityAssurance;
  issuedAt: string;
  expiresAt: string;
};

export type StoredPublicLoungeAuthorDeviceReviewConsumption = {
  schemaVersion: "public-lounge-author-device-review-consumption-v1";
  antiReplayIdentity: string;
  reviewDigest: string;
  consumedAt: string;
};

type StoredPublicLoungeMutationClaimBase = {
  schemaVersion: "public-lounge-mutation-claim-v1";
  publicId: string;
  baseMutationSequence: number;
  mutationSequence: number;
  claimIdHash: string;
  claimedAt: string;
};

export type StoredPublicLoungeMutationClaim = StoredPublicLoungeMutationClaimBase & ({
  operation: "overwrite";
  targetPointer: StoredPublicLoungeCurrentPointer;
  targetTombstone?: never;
} | {
  operation: "retract";
  targetPointer?: never;
  targetTombstone: StoredPublicLoungeTombstone;
});

export type StoredPublicLoungeMutationRateReservation = {
  schemaVersion: "public-lounge-mutation-rate-reservation-v1";
  publicId: string;
  operation: "overwrite" | "retract";
  mutationIdHash: string;
  minuteBucket: number;
  slot: number;
  reservedAt: string;
};

export type StoredPublicLoungeEligibilityConsumption = {
  schemaVersion: "public-lounge-eligibility-consumption-v1";
  ticketHash: string;
  consumerIdHash?: string;
  consumedAt: string;
};

export type StoredPublicLoungePublishConsumption = {
  schemaVersion: "public-lounge-publish-consumption-v1";
  ticketHash: string;
  idempotencyKeyHash: string;
  publicationDigest: string;
  eligibilityTicketHash: string;
  authorizedOwnerIdHash: string;
  publicId: string;
  versionId: string;
  publishedAt: string;
  managementTokenHash: string;
  createdAt: string;
};

export type StoredPublicLoungePublishClaim = {
  schemaVersion: "public-lounge-publish-claim-v1";
  idempotencyKeyHash: string;
  publicationDigest: string;
  eligibilityTicketHash: string;
  authorizedOwnerIdHash: string;
  publicId: string;
  versionId: string;
  publishedAt: string;
  managementTokenHash: string;
  sealedManagementToken: string;
  createdAt: string;
};

export type StoredPublicLoungeAbuseRateReservation = {
  schemaVersion: "public-lounge-abuse-rate-reservation-v1";
  scope: PublicLoungeAbuseRateScope;
  clientKeyHash: string;
  requestIdHash: string;
  minuteBucket: number;
  slot: number;
  reservedAt: string;
};

export function publicLoungePostPath(publicId: string) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/posts/${publicId}.json`;
}

export function publicLoungeIndexPath(publicId: string) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/index/${publicId}.json`;
}

export function publicLoungeIndexPrefix() {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/index`;
}

export function publicLoungeVersionPath(publicId: string, versionId: string) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/versions/${publicId}/${versionId}.json`;
}

export function isPublicLoungeStorageObjectPath(path: string) {
  if (/^(?:public-lounge-v1\/(?:index|posts)\/novel_[a-z0-9_-]{12,80}\.json|public-lounge-v1\/versions\/novel_[a-z0-9_-]{12,80}\/version_[a-z0-9_-]{12,96}\.json|public-lounge-v1\/eligibility\/(?:issued|consumed|attestations|author-device)\/[a-f0-9]{64}\.json|public-lounge-v1\/publish\/idempotency\/[a-f0-9]{64}\.json|public-lounge-v1\/mutations\/claims\/novel_[a-z0-9_-]{12,80}\/(?:[1-9]\d{0,3}|10000)\.json)$/u.test(path)) {
    return true;
  }
  const rate = /^public-lounge-v1\/mutations\/rate\/novel_[a-z0-9_-]{12,80}\/\d{8,20}-(\d+)\.json$/u.exec(path);
  if (rate !== null) return Number.isInteger(Number(rate[1]))
    && Number(rate[1]) >= 0
    && Number(rate[1]) < PUBLIC_LOUNGE_MUTATION_RATE_SLOT_COUNT;
  const abuse = /^public-lounge-v1\/mutations\/abuse\/(read|eligibility|publish|management)\/[a-f0-9]{64}\/\d{8,20}-(\d+)\.json$/u.exec(path);
  if (abuse === null) return false;
  const slot = Number(abuse[2]);
  const limit = abuse[1] === "read"
    ? PUBLIC_LOUNGE_READ_RATE_SLOT_COUNT
    : PUBLIC_LOUNGE_ABUSE_RATE_SLOT_COUNT;
  return Number.isInteger(slot) && slot >= 0 && slot < limit;
}

export function isPublicLoungeImmutableStorageObjectPath(path: string) {
  return isPublicLoungeStorageObjectPath(path)
    && /^(?:public-lounge-v1\/versions\/|public-lounge-v1\/eligibility\/(?:issued|consumed|attestations)\/|public-lounge-v1\/publish\/idempotency\/|public-lounge-v1\/mutations\/(?:claims|rate|abuse)\/)/u.test(path);
}

export function publicLoungeEligibilityPath(ticketHash: string) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/eligibility/issued/${ticketHash}.json`;
}

export function publicLoungeEligibilityConsumedPath(ticketHash: string) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/eligibility/consumed/${ticketHash}.json`;
}

export function publicLoungePublishClaimPath(idempotencyKeyHash: string) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/publish/idempotency/${idempotencyKeyHash}.json`;
}

export function publicLoungeEligibilityAttestationPath(attestationDigest: string) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/eligibility/attestations/${attestationDigest}.json`;
}

export function publicLoungeAuthorDeviceReviewConsumedPath(antiReplayIdentity: string) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/eligibility/author-device/${antiReplayIdentity}.json`;
}

export function publicLoungeEligibilityRatePath(clientKey: string, minuteBucket: number) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/eligibility/rate/${clientKey}-${minuteBucket}.json`;
}

export function publicLoungeMutationClaimPath(publicId: string, mutationSequence: number) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/mutations/claims/${publicId}/${mutationSequence}.json`;
}

export function publicLoungeMutationRateSlotPath(
  publicId: string,
  minuteBucket: number,
  slot: number,
) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/mutations/rate/${publicId}/${minuteBucket}-${slot}.json`;
}

export function publicLoungeAbuseRateSlotPath(
  scope: PublicLoungeAbuseRateScope,
  clientKeyHash: string,
  minuteBucket: number,
  slot: number,
) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/mutations/abuse/${scope}/${clientKeyHash}/${minuteBucket}-${slot}.json`;
}
