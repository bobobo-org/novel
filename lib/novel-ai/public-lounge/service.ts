import {
  assertPublicLoungeId,
  buildPublicLoungePost,
  PublicLoungeError,
  isCanonicalIsoTime,
  publicLoungeEligibilityBinding,
  publicLoungePostToSummary,
  sanitizeStoredPublicLoungeIndexEntry,
  sanitizeStoredPublicLoungePost,
  validatePublicLoungePublicationInput,
  validatePublicLoungeEligibilityRequest,
  validatePublicLoungeQuality,
} from "./contract";
import { evaluatePublicLoungePublicContentGate } from "./public-content-hard-gate";
import {
  PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION,
  PUBLIC_LOUNGE_LEGACY_STORED_POST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PRIOR_STORED_POST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PUBLISHED_VERSION_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_QUALITY_THRESHOLD,
  PUBLIC_LOUNGE_STORED_ELIGIBILITY_SCHEMA_VERSION,
  PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION,
  type PublicLoungeServerEligibilityRequest,
  type PublicLoungeAbuseRateScope,
  type PublicLoungeListQuery,
  type PublicLoungeListPage,
  type PublicLoungePost,
  type PublicLoungePostSummary,
  type PublicLoungePublishResult,
  type PublicLoungeQualityDimensionKey,
  type PublicLoungeQualityAssurance,
  type PublicLoungeServiceApi,
} from "./types";
import {
  isPublicLoungeShelfId,
  listPublicLoungeShelves,
  publicLoungeTopicDisplayNames,
} from "./taxonomy";
import {
  PUBLIC_LOUNGE_STORAGE_BUCKET,
  publicLoungeEligibilityConsumedPath,
  publicLoungeEligibilityPath,
  publicLoungeIndexPath,
  publicLoungeMutationClaimPath,
  publicLoungePostPath,
  publicLoungePublishClaimPath,
  publicLoungeVersionPath,
  type PublicLoungeStorageGateway,
  type PublicLoungeCatalogCursor,
  type StoredPublicLoungeCurrentPointer,
  type StoredPublicLoungeMutationClaim,
  type StoredPublicLoungePublishConsumption,
  type StoredPublicLoungePublishClaim,
  type StoredPublicLoungePublicContentGateBinding,
  type StoredPublicLoungePublishedVersion,
  type StoredPublicLoungePost,
  type StoredPublicLoungeEligibility,
  type StoredPublicLoungeTombstone,
} from "./storage";
import { stableStringify } from "../closed-ai-cache";

export type PublicLoungeTokenCodec = {
  issue(): { token: string; hash: string };
  matches(token: string, expectedHash: string): boolean;
  seal(token: string, context: string): string;
  unseal(sealedToken: string, context: string): string | null;
};

export type PublicLoungeServiceDependencies = {
  gateway: PublicLoungeStorageGateway;
  tokenCodec: PublicLoungeTokenCodec;
  createPublicId(): string;
  now(): string;
  digest(value: string): string;
  eligibilityReviewer: PublicLoungeEligibilityReviewer;
};

export type PublicLoungeEligibilityReviewer = {
  configured: boolean;
  review(input: PublicLoungeServerEligibilityRequest): Promise<{
    backendId: "private-ai-hub";
    modelId: string;
    modelDigest: string;
    completionFingerprint: string;
    qualityScore: number;
    qualityBreakdown: Record<PublicLoungeQualityDimensionKey, number>;
    attestationDigest: string;
  }>;
};

type PublicLoungeEligibilityReviewResult = {
  backendId: "private-ai-hub" | "browser-ai" | "local-ollama";
  modelId: string;
  modelDigest: string;
  completionFingerprint: string;
  qualityScore: number;
  qualityBreakdown: Record<PublicLoungeQualityDimensionKey, number>;
  qualityAssurance: PublicLoungeQualityAssurance;
};

function notConnected(): PublicLoungeError {
  return new PublicLoungeError("PUBLIC_LOUNGE_NOT_CONNECTED", 503, true);
}

function assertPublicLoungeActorId(value: string) {
  const actorId = typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(actorId)) {
    throw new PublicLoungeError("PUBLIC_LOUNGE_AUTH_REQUIRED", 401);
  }
  return actorId;
}

function normalizeQueryText(value: string | undefined, max: number) {
  if (!value) return "";
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max)
    .toLocaleLowerCase("zh-Hant");
}

const INDEX_READ_CONCURRENCY = 8;
const DEFAULT_RESULT_LIMIT = 24;
const MAX_RESULT_LIMIT = 48;
const MAX_CURSOR_LENGTH = 1_024;
const CATALOG_FILTER_BATCH_SIZE = 64;
const MAX_CATALOG_CANDIDATES_PER_REQUEST = 256;
const MAX_MUTATION_SEQUENCE = 10_000;

type NormalizedListQuery = {
  search: string;
  shelfId: string;
  completedOnly: boolean;
};

type PublicLoungeCursor = {
  v: 3;
  after: { publishedAt: string; publicId: string };
  query: NormalizedListQuery;
  seen: number;
};

function cursorInvalid(): PublicLoungeError {
  return new PublicLoungeError("PUBLIC_LOUNGE_CURSOR_INVALID", 400);
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function normalizeListQuery(query: PublicLoungeListQuery) {
  if (
    (query.search !== undefined && typeof query.search !== "string")
    || (query.shelfId !== undefined && typeof query.shelfId !== "string")
    || (query.completedOnly !== undefined && typeof query.completedOnly !== "boolean")
  ) {
    throw cursorInvalid();
  }
  const limit = query.limit === undefined ? DEFAULT_RESULT_LIMIT : query.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULT_LIMIT) throw cursorInvalid();
  const shelfId = normalizeQueryText(query.shelfId, 48);
  if (shelfId && !isPublicLoungeShelfId(shelfId)) throw cursorInvalid();
  return {
    normalized: {
      search: normalizeQueryText(query.search, 120),
      shelfId,
      completedOnly: query.completedOnly !== false,
    },
    limit,
  };
}

function decodeCursor(value: string | undefined, expectedQuery: NormalizedListQuery): PublicLoungeCursor | null {
  if (!value) return null;
  if (typeof value !== "string" || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw cursorInvalid();
  }
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw cursorInvalid();
    const parsed = JSON.parse(decoded.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw cursorInvalid();
    const raw = parsed as Record<string, unknown>;
    if (!exactKeys(raw, ["v", "after", "query", "seen"]) || raw.v !== 3) throw cursorInvalid();
    if (!raw.after || typeof raw.after !== "object" || Array.isArray(raw.after)) throw cursorInvalid();
    if (!raw.query || typeof raw.query !== "object" || Array.isArray(raw.query)) throw cursorInvalid();
    const after = raw.after as Record<string, unknown>;
    const query = raw.query as Record<string, unknown>;
    if (
      !exactKeys(after, ["publishedAt", "publicId"])
      || !exactKeys(query, ["search", "shelfId", "completedOnly"])
      || !isCanonicalIsoTime(after.publishedAt)
      || typeof after.publicId !== "string"
      || !/^novel_[a-z0-9_-]{12,80}$/u.test(after.publicId)
      || typeof query.search !== "string"
      || typeof query.shelfId !== "string"
      || typeof query.completedOnly !== "boolean"
      || !Number.isSafeInteger(raw.seen)
      || Number(raw.seen) < 0
      || query.search !== expectedQuery.search
      || query.shelfId !== expectedQuery.shelfId
      || query.completedOnly !== expectedQuery.completedOnly
    ) {
      throw cursorInvalid();
    }
    return {
      v: 3,
      after: { publishedAt: after.publishedAt, publicId: after.publicId },
      query: expectedQuery,
      seen: Number(raw.seen),
    };
  } catch (error) {
    if (error instanceof PublicLoungeError) throw error;
    throw cursorInvalid();
  }
}

function encodeCursor(entry: PublicLoungeCatalogCursor, query: NormalizedListQuery, seen: number) {
  const cursor: PublicLoungeCursor = {
    v: 3,
    after: { publishedAt: entry.publishedAt, publicId: entry.publicId },
    query,
    seen,
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

type ParsedStoredPublication = {
  state: "current";
  pointer: StoredPublicLoungeCurrentPointer;
} | {
  state: "legacy";
  post: PublicLoungePost;
  snapshot: StoredPublicLoungePost;
  managementTokenHash: string;
  updatedAt: string;
} | {
  state: "retracted";
  managementTokenHash: string;
  updatedAt: string;
  mutationSequence: number;
};

type ResolvedStoredPublication = {
  state: "active";
  post: PublicLoungePost;
  snapshot: StoredPublicLoungePost | StoredPublicLoungeCurrentPointer;
  managementTokenHash: string;
  updatedAt: string;
} | {
  state: "retracted";
  managementTokenHash: string;
  updatedAt: string;
  mutationSequence: number;
};

type ResolvedStoredHead = {
  state: "active";
  snapshot: StoredPublicLoungePost | StoredPublicLoungeCurrentPointer;
  publicSummary: PublicLoungePostSummary;
  embeddedPost?: PublicLoungePost;
  currentVersionId: string;
  currentVersionNumber: number;
  currentVersionDigest?: string;
  managementTokenHash: string;
  updatedAt: string;
  mutationSequence: number;
} | {
  state: "retracted";
  managementTokenHash: string;
  updatedAt: string;
  mutationSequence: number;
};

function storedPublication(value: unknown, expectedPublicId: string): ParsedStoredPublication {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw notConnected();
  const raw = value as Record<string, unknown>;
  if (
    (raw.schemaVersion !== PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION
      && raw.schemaVersion !== PUBLIC_LOUNGE_PRIOR_STORED_POST_SCHEMA_VERSION
      && raw.schemaVersion !== PUBLIC_LOUNGE_LEGACY_STORED_POST_SCHEMA_VERSION)
    || (raw.state !== "active" && raw.state !== "retracted")
    || typeof raw.managementTokenHash !== "string"
    || !/^[a-f0-9]{64}$/u.test(raw.managementTokenHash)
    || !isCanonicalIsoTime(raw.updatedAt)
  ) {
    throw notConnected();
  }
  if (raw.state === "retracted") {
    if (raw.publicId !== expectedPublicId) throw notConnected();
    return {
      state: "retracted",
      managementTokenHash: raw.managementTokenHash,
      updatedAt: raw.updatedAt,
      mutationSequence: Number.isInteger(raw.mutationSequence) && Number(raw.mutationSequence) >= 1
        ? Number(raw.mutationSequence)
        : 1,
    };
  }
  if (raw.state === "active" && raw.schemaVersion === PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION) {
    if (
      raw.publicId !== expectedPublicId
      || typeof raw.currentVersionId !== "string"
      || !/^version_[a-z0-9_-]{12,96}$/u.test(raw.currentVersionId)
      || !Number.isInteger(raw.currentVersionNumber)
      || Number(raw.currentVersionNumber) < 1
      || (raw.currentVersionDigest !== undefined
        && (typeof raw.currentVersionDigest !== "string"
          || !/^[a-f0-9]{64}$/u.test(raw.currentVersionDigest)))
      || (raw.mutationSequence !== undefined
        && (!Number.isInteger(raw.mutationSequence)
          || Number(raw.mutationSequence) < Number(raw.currentVersionNumber)
          || Number(raw.mutationSequence) > MAX_MUTATION_SEQUENCE))
      || (raw.publicContentGate !== undefined && (
        !raw.publicContentGate
        || typeof raw.publicContentGate !== "object"
        || Array.isArray(raw.publicContentGate)
        || (raw.publicContentGate as Record<string, unknown>).schemaVersion
          !== "public-lounge-public-content-gate-binding-v1"
        || (raw.publicContentGate as Record<string, unknown>).passed !== true
        || !/^[a-f0-9]{64}$/u.test(String(
          (raw.publicContentGate as Record<string, unknown>).contentDigest ?? "",
        ))
      ))
    ) {
      throw notConnected();
    }
    if (raw.publicSummary !== undefined) {
      const summary = sanitizeStoredPublicLoungeIndexEntry(raw.publicSummary);
      if (
        summary.publicId !== expectedPublicId
        || summary.versionId !== raw.currentVersionId
        || summary.versionNumber !== raw.currentVersionNumber
      ) {
        throw notConnected();
      }
    }
    return {
      state: "current",
      pointer: raw as StoredPublicLoungeCurrentPointer,
    };
  }
  const post = sanitizeStoredPublicLoungePost(raw.publicPost);
  if (post.publicId !== expectedPublicId) throw notConnected();
  return {
    state: "legacy",
    post,
    snapshot: raw as StoredPublicLoungePost,
    managementTokenHash: raw.managementTokenHash,
    updatedAt: raw.updatedAt,
  };
}

function storedPublishedVersion(
  value: unknown,
  expectedPublicId: string,
  expectedVersionId: string,
  expectedVersionNumber: number,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw notConnected();
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== PUBLIC_LOUNGE_PUBLISHED_VERSION_SCHEMA_VERSION
    || raw.publicId !== expectedPublicId
    || raw.versionId !== expectedVersionId
    || raw.versionNumber !== expectedVersionNumber
    || !isCanonicalIsoTime(raw.versionPublishedAt)
  ) {
    throw notConnected();
  }
  const post = sanitizeStoredPublicLoungePost(raw.publicPost);
  if (
    post.publicId !== expectedPublicId
    || post.versionId !== expectedVersionId
    || post.versionNumber !== expectedVersionNumber
    || post.versionPublishedAt !== raw.versionPublishedAt
  ) {
    throw notConnected();
  }
  return post;
}

function publishedVersionRecord(post: PublicLoungePost): StoredPublicLoungePublishedVersion {
  return {
    schemaVersion: PUBLIC_LOUNGE_PUBLISHED_VERSION_SCHEMA_VERSION,
    publicId: post.publicId,
    versionId: post.versionId,
    versionNumber: post.versionNumber,
    versionPublishedAt: post.versionPublishedAt,
    publicPost: post,
  };
}

function assertPublishIdempotencyKey(value: string) {
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(value)) {
    throw new PublicLoungeError("PUBLIC_LOUNGE_IDEMPOTENCY_KEY_REQUIRED", 400);
  }
  return value;
}

function publicContentGateInput(post: Pick<
  PublicLoungePost,
  "chapterCount" | "wordCount" | "publicChapters" | "fullSynopsis"
>) {
  return {
    chapterCount: post.chapterCount,
    wordCount: post.wordCount,
    publicChapters: post.publicChapters,
    fullSynopsis: post.fullSynopsis,
  };
}

function publicContentGateBinding(
  post: PublicLoungePost,
  digest: (value: string) => string,
): StoredPublicLoungePublicContentGateBinding {
  const input = publicContentGateInput(post);
  if (!evaluatePublicLoungePublicContentGate(input).passed) {
    throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
  }
  return {
    schemaVersion: "public-lounge-public-content-gate-binding-v1",
    passed: true,
    contentDigest: digest(stableStringify(input)),
  };
}

function publishClaimSealContext(
  claim: Omit<StoredPublicLoungePublishClaim, "sealedManagementToken">,
) {
  return stableStringify({
    domain: "public-lounge-publish-token-v1",
    idempotencyKeyHash: claim.idempotencyKeyHash,
    publicationDigest: claim.publicationDigest,
    eligibilityTicketHash: claim.eligibilityTicketHash,
    authorizedOwnerIdHash: claim.authorizedOwnerIdHash,
    publicId: claim.publicId,
    versionId: claim.versionId,
    publishedAt: claim.publishedAt,
    managementTokenHash: claim.managementTokenHash,
    createdAt: claim.createdAt,
  });
}

function storedPublishClaim(
  value: unknown,
  expectedIdempotencyKeyHash: string,
): StoredPublicLoungePublishClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw notConnected();
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== "public-lounge-publish-claim-v1"
    || raw.idempotencyKeyHash !== expectedIdempotencyKeyHash
    || !/^[a-f0-9]{64}$/u.test(String(raw.publicationDigest ?? ""))
    || !/^[a-f0-9]{64}$/u.test(String(raw.eligibilityTicketHash ?? ""))
    || !/^[a-f0-9]{64}$/u.test(String(raw.authorizedOwnerIdHash ?? ""))
    || !/^novel_[a-z0-9_-]{12,80}$/u.test(String(raw.publicId ?? ""))
    || !/^version_[a-z0-9_-]{12,96}$/u.test(String(raw.versionId ?? ""))
    || !isCanonicalIsoTime(raw.publishedAt)
    || !/^[a-f0-9]{64}$/u.test(String(raw.managementTokenHash ?? ""))
    || typeof raw.sealedManagementToken !== "string"
    || raw.sealedManagementToken.length < 60
    || raw.sealedManagementToken.length > 512
    || !/^[A-Za-z0-9_.-]+$/u.test(raw.sealedManagementToken)
    || !isCanonicalIsoTime(raw.createdAt)
  ) {
    throw notConnected();
  }
  return raw as StoredPublicLoungePublishClaim;
}

function storedPublishConsumption(
  value: unknown,
  expectedTicketHash: string,
): StoredPublicLoungePublishConsumption {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw notConnected();
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== "public-lounge-publish-consumption-v1"
    || raw.ticketHash !== expectedTicketHash
    || !/^[a-f0-9]{64}$/u.test(String(raw.idempotencyKeyHash ?? ""))
    || !/^[a-f0-9]{64}$/u.test(String(raw.publicationDigest ?? ""))
    || !/^[a-f0-9]{64}$/u.test(String(raw.eligibilityTicketHash ?? ""))
    || !/^[a-f0-9]{64}$/u.test(String(raw.authorizedOwnerIdHash ?? ""))
    || !/^novel_[a-z0-9_-]{12,80}$/u.test(String(raw.publicId ?? ""))
    || !/^version_[a-z0-9_-]{12,96}$/u.test(String(raw.versionId ?? ""))
    || !isCanonicalIsoTime(raw.publishedAt)
    || !/^[a-f0-9]{64}$/u.test(String(raw.managementTokenHash ?? ""))
    || !isCanonicalIsoTime(raw.createdAt)
  ) {
    throw notConnected();
  }
  return raw as StoredPublicLoungePublishConsumption;
}

function storedMutationClaim(
  value: unknown,
  expectedPublicId: string,
  expectedMutationSequence: number,
): StoredPublicLoungeMutationClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw notConnected();
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== "public-lounge-mutation-claim-v1"
    || raw.publicId !== expectedPublicId
    || (raw.operation !== "overwrite" && raw.operation !== "retract")
    || raw.mutationSequence !== expectedMutationSequence
    || raw.baseMutationSequence !== expectedMutationSequence - 1
    || typeof raw.claimIdHash !== "string"
    || !/^[a-f0-9]{64}$/u.test(raw.claimIdHash)
    || !isCanonicalIsoTime(raw.claimedAt)
  ) {
    throw notConnected();
  }
  if (raw.operation === "overwrite") {
    if (!raw.targetPointer || raw.targetTombstone !== undefined) throw notConnected();
    const targetPointer = raw.targetPointer as StoredPublicLoungeCurrentPointer;
    const parsedPointer = storedPublication(targetPointer, expectedPublicId);
    const publicSummary = targetPointer.publicSummary
      ? sanitizeStoredPublicLoungeIndexEntry(targetPointer.publicSummary)
      : null;
    if (
      parsedPointer.state !== "current"
      || targetPointer.mutationSequence !== expectedMutationSequence
      || typeof targetPointer.currentVersionDigest !== "string"
      || !/^[a-f0-9]{64}$/u.test(targetPointer.currentVersionDigest)
      || !publicSummary
      || publicSummary.versionId !== targetPointer.currentVersionId
      || publicSummary.versionNumber !== targetPointer.currentVersionNumber
    ) {
      throw notConnected();
    }
  } else {
    if (!raw.targetTombstone || raw.targetPointer !== undefined) {
      throw notConnected();
    }
    const target = storedPublication(raw.targetTombstone, expectedPublicId);
    if (target.state !== "retracted" || target.mutationSequence !== expectedMutationSequence) {
      throw notConnected();
    }
  }
  return raw as StoredPublicLoungeMutationClaim;
}

export class PublicLoungeService implements PublicLoungeServiceApi {
  private readonly gateway: PublicLoungeStorageGateway;
  private readonly tokenCodec: PublicLoungeTokenCodec;
  private readonly createPublicId: () => string;
  private readonly now: () => string;
  private readonly digest: (value: string) => string;
  private readonly eligibilityReviewer: PublicLoungeEligibilityReviewer;

  constructor(dependencies: PublicLoungeServiceDependencies) {
    this.gateway = dependencies.gateway;
    this.tokenCodec = dependencies.tokenCodec;
    this.createPublicId = dependencies.createPublicId;
    this.now = dependencies.now;
    this.digest = dependencies.digest;
    this.eligibilityReviewer = dependencies.eligibilityReviewer;
  }

  private async ensureConnected() {
    try {
      const [status, controlPlane] = await Promise.all([
        this.gateway.bucketStatus(),
        this.gateway.controlPlaneStatus(),
      ]);
      if (!status.exists || status.public || !status.provisioned) throw notConnected();
      if (!controlPlane.catalogReady || !controlPlane.rateReady) throw notConnected();
    } catch (error) {
      if (error instanceof PublicLoungeError) throw error;
      throw notConnected();
    }
  }

  async health() {
    await this.ensureConnected();
    return {
      connected: true as const,
      storage: "supabase-private-storage" as const,
      bucket: PUBLIC_LOUNGE_STORAGE_BUCKET,
      trustedEligibilityVerifierConnected: this.eligibilityReviewer.configured,
      authorDeviceEligibilityAccepted: false as const,
      trustedAttestationProducer: "not-available-in-this-release" as const,
    } as const;
  }

  private async readManagementTokenHash(publicId: string) {
    try {
      const value = await this.gateway.readJson<unknown>(publicLoungePostPath(publicId));
      if (!value) return null;
      const parsed = storedPublication(value, publicId);
      return parsed.state === "current"
        ? parsed.pointer.managementTokenHash
        : parsed.managementTokenHash;
    } catch (error) {
      if (error instanceof PublicLoungeError && error.code === "PUBLIC_LOUNGE_NOT_CONNECTED") throw error;
      throw notConnected();
    }
  }

  private async readStoredHead(publicId: string): Promise<ResolvedStoredHead | null> {
    try {
      const value = await this.gateway.readJson<unknown>(publicLoungePostPath(publicId));
      if (!value) return null;
      const parsed = storedPublication(value, publicId);
      let resolved: ResolvedStoredHead;
      if (parsed.state === "retracted") {
        resolved = parsed;
      } else if (parsed.state === "legacy") {
        resolved = {
          state: "active" as const,
          snapshot: parsed.snapshot,
          publicSummary: publicLoungePostToSummary(parsed.post),
          embeddedPost: parsed.post,
          currentVersionId: parsed.post.versionId,
          currentVersionNumber: parsed.post.versionNumber,
          managementTokenHash: parsed.managementTokenHash,
          updatedAt: parsed.updatedAt,
          mutationSequence: parsed.post.versionNumber,
        };
      } else {
        const pointer = parsed.pointer;
        let post: PublicLoungePost | undefined;
        let summary: PublicLoungePostSummary;
        if (pointer.publicSummary) {
          summary = sanitizeStoredPublicLoungeIndexEntry(pointer.publicSummary);
        } else {
          const version = await this.gateway.readJson<unknown>(publicLoungeVersionPath(
            publicId,
            pointer.currentVersionId,
          ));
          if (!version) throw notConnected();
          post = storedPublishedVersion(
            version,
            publicId,
            pointer.currentVersionId,
            pointer.currentVersionNumber,
          );
          summary = publicLoungePostToSummary(post);
        }
        resolved = {
          state: "active" as const,
          snapshot: pointer,
          publicSummary: summary,
          embeddedPost: post,
          currentVersionId: pointer.currentVersionId,
          currentVersionNumber: pointer.currentVersionNumber,
          currentVersionDigest: pointer.currentVersionDigest,
          managementTokenHash: pointer.managementTokenHash,
          updatedAt: pointer.updatedAt,
          mutationSequence: Number(pointer.mutationSequence ?? pointer.currentVersionNumber),
        };
      }

      let sequence = resolved.mutationSequence;
      while (sequence < MAX_MUTATION_SEQUENCE) {
        const nextSequence = sequence + 1;
        const rawClaim = await this.gateway.readJson<unknown>(
          publicLoungeMutationClaimPath(publicId, nextSequence),
        );
        if (!rawClaim) break;
        const claim = storedMutationClaim(rawClaim, publicId, nextSequence);
        if (resolved.state === "retracted") throw notConnected();
        if (claim.operation === "overwrite") {
          const targetPointer = claim.targetPointer;
          const summary = sanitizeStoredPublicLoungeIndexEntry(targetPointer.publicSummary);
          if (
            summary.publishedAt !== resolved.publicSummary.publishedAt
            || targetPointer.currentVersionNumber !== resolved.currentVersionNumber + 1
            || targetPointer.managementTokenHash !== resolved.managementTokenHash
          ) {
            throw notConnected();
          }
          resolved = {
            state: "active",
            snapshot: targetPointer,
            publicSummary: summary,
            currentVersionId: targetPointer.currentVersionId,
            currentVersionNumber: targetPointer.currentVersionNumber,
            currentVersionDigest: targetPointer.currentVersionDigest,
            managementTokenHash: targetPointer.managementTokenHash,
            updatedAt: targetPointer.updatedAt,
            mutationSequence: nextSequence,
          };
        } else {
          const tombstone = claim.targetTombstone;
          if (!tombstone || tombstone.managementTokenHash !== resolved.managementTokenHash) {
            throw notConnected();
          }
          resolved = {
            state: "retracted",
            managementTokenHash: tombstone.managementTokenHash,
            updatedAt: tombstone.updatedAt,
            mutationSequence: nextSequence,
          };
        }
        sequence = nextSequence;
      }
      return resolved;
    } catch (error) {
      if (error instanceof PublicLoungeError && error.code === "PUBLIC_LOUNGE_NOT_CONNECTED") throw error;
      throw notConnected();
    }
  }

  private async readStored(publicId: string): Promise<ResolvedStoredPublication | null> {
    const head = await this.readStoredHead(publicId);
    if (!head || head.state === "retracted") return head;
    let post = head.embeddedPost;
    if (!post || post.versionId !== head.currentVersionId) {
      const rawVersion = await this.storageWrite(() => this.gateway.readJson<unknown>(
        publicLoungeVersionPath(publicId, head.currentVersionId),
      ));
      if (!rawVersion) throw notConnected();
      post = storedPublishedVersion(
        rawVersion,
        publicId,
        head.currentVersionId,
        head.currentVersionNumber,
      );
      if (
        head.currentVersionDigest
        && this.digest(stableStringify(publishedVersionRecord(post))) !== head.currentVersionDigest
      ) {
        throw notConnected();
      }
    }
    if (stableStringify(publicLoungePostToSummary(post)) !== stableStringify(head.publicSummary)) {
      throw notConnected();
    }
    return {
      state: "active",
      post,
      snapshot: head.snapshot,
      managementTokenHash: head.managementTokenHash,
      updatedAt: head.updatedAt,
    };
  }

  private async storageWrite<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof PublicLoungeError) throw error;
      throw notConnected();
    }
  }

  private mutationSequence(stored: ResolvedStoredPublication) {
    if (stored.state === "retracted") return stored.mutationSequence;
    if (
      stored.snapshot.schemaVersion === PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION
      && Number.isInteger(stored.snapshot.mutationSequence)
      && Number(stored.snapshot.mutationSequence) >= stored.post.versionNumber
    ) {
      return Number(stored.snapshot.mutationSequence);
    }
    return stored.post.versionNumber;
  }

  private issueMutationIdentity() {
    const issued = this.tokenCodec.issue();
    if (!/^[a-f0-9]{64}$/u.test(issued.hash)) throw notConnected();
    return issued.hash;
  }

  private publishClaimToken(claim: StoredPublicLoungePublishClaim) {
    const {
      sealedManagementToken,
      ...context
    } = claim;
    const token = this.tokenCodec.unseal(
      sealedManagementToken,
      publishClaimSealContext(context),
    );
    if (!token || !this.tokenCodec.matches(token, claim.managementTokenHash)) throw notConnected();
    return token;
  }

  private async getOrCreatePublishClaim(
    publication: ReturnType<typeof validatePublicLoungePublicationInput>,
    idempotencyKey: string,
    authorizedOwnerIdHash: string,
  ) {
    const idempotencyKeyHash = this.digest(assertPublishIdempotencyKey(idempotencyKey));
    const publicationDigest = this.digest(stableStringify(publication));
    const eligibilityTicketHash = this.digest(publication.eligibilityTicket);
    const path = publicLoungePublishClaimPath(idempotencyKeyHash);
    const validateBinding = (value: unknown) => {
      const claim = storedPublishClaim(value, idempotencyKeyHash);
      if (
        claim.publicationDigest !== publicationDigest
        || claim.eligibilityTicketHash !== eligibilityTicketHash
        || claim.authorizedOwnerIdHash !== authorizedOwnerIdHash
      ) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_IDEMPOTENCY_CONFLICT", 409);
      }
      return { claim, managementToken: this.publishClaimToken(claim) };
    };
    const existing = await this.storageWrite(() => this.gateway.readJson<unknown>(path));
    if (existing) return validateBinding(existing);

    const publishedAt = this.now();
    if (!isCanonicalIsoTime(publishedAt)) throw notConnected();
    const publicId = assertPublicLoungeId(this.createPublicId());
    const versionId = this.versionId(publicId, 1, publishedAt, idempotencyKeyHash);
    const issued = this.tokenCodec.issue();
    if (!/^[a-f0-9]{64}$/u.test(issued.hash)) throw notConnected();
    const context = {
      schemaVersion: "public-lounge-publish-claim-v1" as const,
      idempotencyKeyHash,
      publicationDigest,
      eligibilityTicketHash,
      authorizedOwnerIdHash,
      publicId,
      versionId,
      publishedAt,
      managementTokenHash: issued.hash,
      createdAt: publishedAt,
    };
    let sealedManagementToken: string;
    try {
      sealedManagementToken = this.tokenCodec.seal(issued.token, publishClaimSealContext(context));
    } catch {
      throw notConnected();
    }
    const claim: StoredPublicLoungePublishClaim = { ...context, sealedManagementToken };
    let result: "stored" | "exists";
    try {
      result = await this.gateway.writeJson(path, claim, { upsert: false });
    } catch {
      const ambiguous = await this.storageWrite(() => this.gateway.readJson<unknown>(path));
      if (!ambiguous) throw notConnected();
      return validateBinding(ambiguous);
    }
    if (result === "stored") return { claim, managementToken: issued.token };
    return validateBinding(await this.storageWrite(() => this.gateway.readJson<unknown>(path)));
  }

  async reserveRequest(requestIdentity: string, scope: PublicLoungeAbuseRateScope): Promise<void> {
    if (
      !["read", "eligibility", "publish", "management"].includes(scope)
      || typeof requestIdentity !== "string"
      || !/^[a-f0-9]{64}$/u.test(requestIdentity)
    ) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_PAYLOAD_INVALID", 400);
    }
    await this.ensureConnected();
    const reservedAt = this.now();
    if (!isCanonicalIsoTime(reservedAt)) {
      throw notConnected();
    }
    const reservation = await this.storageWrite(() => this.gateway.reserveRate({
      identityHash: requestIdentity,
      scope,
      now: reservedAt,
    }));
    if (!reservation.allowed) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_RATE_LIMITED", 429, true);
    }
  }

  private async createMutationClaim(claim: StoredPublicLoungeMutationClaim) {
    const path = publicLoungeMutationClaimPath(claim.publicId, claim.mutationSequence);
    let result: "stored" | "exists";
    try {
      result = await this.gateway.writeJson(path, claim, { upsert: false });
    } catch {
      // An upload response can be lost after Supabase committed the object. The
      // immutable object itself is the receipt, so verify it before failing.
      const afterAmbiguousWrite = await this.storageWrite(() => this.gateway.readJson<unknown>(path));
      if (!afterAmbiguousWrite) throw notConnected();
      const committed = storedMutationClaim(
        afterAmbiguousWrite,
        claim.publicId,
        claim.mutationSequence,
      );
      if (stableStringify(committed) === stableStringify(claim)) return;
      throw new PublicLoungeError("PUBLIC_LOUNGE_MUTATION_BUSY", 409, true);
    }
    if (result === "stored") return;
    const winner = storedMutationClaim(
      await this.storageWrite(() => this.gateway.readJson<unknown>(path)),
      claim.publicId,
      claim.mutationSequence,
    );
    if (winner.claimIdHash === claim.claimIdHash && stableStringify(winner) === stableStringify(claim)) return;
    throw new PublicLoungeError("PUBLIC_LOUNGE_MUTATION_BUSY", 409, true);
  }

  private async writeMutationCheckpoint(snapshot: StoredPublicLoungeCurrentPointer | StoredPublicLoungeTombstone) {
    try {
      await this.gateway.writeJson(publicLoungePostPath(snapshot.publicId), snapshot, { upsert: true });
    } catch {
      // The immutable claim is the commit record. A checkpoint can be missing or
      // even regress when requests finish out of order: replay starts at its
      // mutationSequence and deterministically reaches every later claim.
    }
  }

  private async reserveDurableMutationSlot(
    publicId: string,
    reservedAt: string,
  ) {
    const identityHash = this.digest(`work:${publicId}`);
    if (!isCanonicalIsoTime(reservedAt) || !/^[a-f0-9]{64}$/u.test(identityHash)) throw notConnected();
    const reservation = await this.storageWrite(() => this.gateway.reserveRate({
      identityHash,
      scope: "work_mutation",
      now: reservedAt,
    }));
    if (!reservation.allowed) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_MUTATION_RATE_LIMITED", 429, true);
    }
  }

  private versionId(
    publicId: string,
    versionNumber: number,
    versionPublishedAt: string,
    mutationIdHash = "",
  ) {
    return `version_${this.digest(JSON.stringify({
      publicId,
      versionNumber,
      versionPublishedAt,
      mutationIdHash,
    })).slice(0, 40)}`;
  }

  private async writeImmutableVersion(post: PublicLoungePost) {
    const path = publicLoungeVersionPath(post.publicId, post.versionId);
    const record = publishedVersionRecord(post);
    let result: "stored" | "exists";
    try {
      result = await this.gateway.writeJson(path, record, { upsert: false });
    } catch {
      const ambiguous = await this.storageWrite(() => this.gateway.readJson<unknown>(path));
      if (!ambiguous) throw notConnected();
      const committedPost = storedPublishedVersion(
        ambiguous,
        post.publicId,
        post.versionId,
        post.versionNumber,
      );
      if (stableStringify(committedPost) !== stableStringify(post)) throw notConnected();
      return;
    }
    if (result === "stored") return;
    const existing = await this.storageWrite(() => this.gateway.readJson<unknown>(path));
    const existingPost = storedPublishedVersion(
      existing,
      post.publicId,
      post.versionId,
      post.versionNumber,
    );
    if (stableStringify(existingPost) !== stableStringify(post)) throw notConnected();
  }

  private isTrustedPublicHead(head: ResolvedStoredHead) {
    if (head.state !== "active") return false;
    if (head.publicSummary.qualityAssurance !== "private_ai_hub_verified") return false;
    if (head.publicSummary.quality.totalScore < PUBLIC_LOUNGE_QUALITY_THRESHOLD) return false;
    if (head.snapshot.schemaVersion !== PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION) return false;
    const binding = head.snapshot.publicContentGate;
    return binding?.schemaVersion === "public-lounge-public-content-gate-binding-v1"
      && binding.passed === true
      && /^[a-f0-9]{64}$/u.test(binding.contentDigest);
  }

  private isTrustedPublicPost(stored: Extract<ResolvedStoredPublication, { state: "active" }>) {
    if (stored.post.qualityAssurance !== "private_ai_hub_verified") return false;
    if (stored.post.quality.totalScore < PUBLIC_LOUNGE_QUALITY_THRESHOLD) return false;
    if (stored.snapshot.schemaVersion !== PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION) return false;
    const binding = stored.snapshot.publicContentGate;
    const input = publicContentGateInput(stored.post);
    return binding?.schemaVersion === "public-lounge-public-content-gate-binding-v1"
      && binding.passed === true
      && evaluatePublicLoungePublicContentGate(input).passed
      && binding.contentDigest === this.digest(stableStringify(input));
  }

  async list(query: PublicLoungeListQuery = {}): Promise<PublicLoungeListPage> {
    await this.ensureConnected();
    const { normalized, limit } = normalizeListQuery(query);
    const cursor = decodeCursor(query.cursor, normalized);
    const items: PublicLoungePostSummary[] = [];
    const seenPublicIds = new Set<string>();
    const hasFilters = Boolean(normalized.search || normalized.shelfId || !normalized.completedOnly);
    let after: PublicLoungeCatalogCursor | null = cursor?.after ?? null;
    let lastScanned: PublicLoungeCatalogCursor | null = null;
    let continuation: PublicLoungeCatalogCursor | null = null;
    let scannedCandidates = 0;
    let moreCandidates = false;

    candidatePages: while (
      items.length < limit
      && scannedCandidates < MAX_CATALOG_CANDIDATES_PER_REQUEST
    ) {
      const batchLimit = Math.min(
        hasFilters ? CATALOG_FILTER_BATCH_SIZE : Math.max(1, limit - items.length),
        MAX_CATALOG_CANDIDATES_PER_REQUEST - scannedCandidates,
      );
      const catalogPage = await this.storageWrite(() => this.gateway.listCatalogCandidates({
        after,
        limit: batchLimit,
      }));
      if (catalogPage.items.length === 0) {
        moreCandidates = false;
        break;
      }
      scannedCandidates += catalogPage.items.length;
      lastScanned = catalogPage.items[catalogPage.items.length - 1];

      const validated = await mapWithConcurrency(
        catalogPage.items,
        INDEX_READ_CONCURRENCY,
        async (candidate) => {
          const current = await this.readStoredHead(candidate.publicId);
          if (!current || current.state === "retracted") {
            try {
              await this.gateway.deactivateCatalogAnchor(candidate.publicId);
            } catch {
              // The missing/tombstoned Storage head is authoritative.  Catalog
              // cleanup is retried later and can never make this ID visible.
            }
            return null;
          }
          // Cross-system atomicity is unavailable.  The database therefore
          // stores only an opaque ID and ordering metadata; every candidate is
          // rebound to the authoritative Storage head before it can be exposed.
          if (
            current.publicSummary.publishedAt !== candidate.publishedAt
            || !this.isTrustedPublicHead(current)
          ) {
            return null;
          }
          const entry = current.publicSummary;
          if (normalized.completedOnly && entry.completionStatus !== "completed") return null;
          if (normalized.shelfId && entry.shelfId !== normalized.shelfId) return null;
          if (normalized.search && ![
            entry.title,
            entry.authorByline,
            ...publicLoungeTopicDisplayNames(entry.topicIds),
            entry.synopsisExcerpt,
          ].some((value) => value.toLocaleLowerCase("zh-Hant").includes(normalized.search))) {
            return null;
          }
          return entry;
        },
      );

      for (let index = 0; index < validated.length; index += 1) {
        const entry = validated[index];
        if (!entry) continue;
        if (seenPublicIds.has(entry.publicId)) throw notConnected();
        seenPublicIds.add(entry.publicId);
        items.push(entry);
        if (items.length === limit) {
          moreCandidates = index < validated.length - 1 || catalogPage.hasMore;
          if (moreCandidates) {
            continuation = { publishedAt: entry.publishedAt, publicId: entry.publicId };
          }
          break candidatePages;
        }
      }

      moreCandidates = catalogPage.hasMore;
      if (!catalogPage.hasMore) break;
      after = lastScanned;
    }

    if (
      items.length < limit
      && scannedCandidates >= MAX_CATALOG_CANDIDATES_PER_REQUEST
      && moreCandidates
      && lastScanned
    ) {
      continuation = lastScanned;
    }
    const seen = (cursor?.seen ?? 0) + items.length;
    const nextCursor = continuation ? encodeCursor(continuation, normalized, seen) : null;
    return {
      items,
      nextCursor,
      // With an ID-only cross-system catalog an exact filtered count would
      // require revalidating the entire catalog.  Return a monotonic lower bound
      // instead; content exposure still requires a verified Storage head.
      totalCount: seen + (nextCursor && items.length > 0 ? 1 : 0),
      shelves: listPublicLoungeShelves(),
    };
  }

  async get(publicId: string): Promise<PublicLoungePost> {
    assertPublicLoungeId(publicId);
    await this.ensureConnected();
    const stored = await this.readStored(publicId);
    if (!stored || stored.state === "retracted" || !this.isTrustedPublicPost(stored)) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_FOUND", 404);
    }
    return stored.post;
  }

  async issueEligibility(input: unknown, actorId: string) {
    const request = validatePublicLoungeEligibilityRequest(input);
    const authorizedOwnerIdHash = this.digest(assertPublicLoungeActorId(actorId));
    await this.ensureConnected();
    const publicContent = {
      chapterCount: request.chapterCount,
      wordCount: request.wordCount,
      publicChapters: request.publicChapters,
      fullSynopsis: request.fullSynopsis,
    };
    // A digest produced on the author's device is integrity metadata, not a
    // trust boundary: the caller can recompute it after changing every score.
    // Keep local reviews available for editing, but never mint a public ticket
    // without a server-verifiable Private AI Hub attestation.
    if (request.serverAttestation === undefined) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED", 503, true);
    }
    let reviewed: PublicLoungeEligibilityReviewResult;
    {
      if (!evaluatePublicLoungePublicContentGate(publicContent).passed) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
      }
      let serverReview: Awaited<ReturnType<PublicLoungeEligibilityReviewer["review"]>>;
      try {
        serverReview = await this.eligibilityReviewer.review(request);
      } catch (error) {
        if (error instanceof PublicLoungeError) throw error;
        throw new PublicLoungeError("PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED", 503, true);
      }
      if (
        serverReview.backendId !== "private-ai-hub"
        || serverReview.completionFingerprint !== request.completionFingerprint
        || typeof serverReview.modelId !== "string"
        || !serverReview.modelId.trim()
        || !/^[a-f0-9]{64}$/u.test(serverReview.modelDigest)
        || !/^[a-f0-9]{64}$/u.test(serverReview.attestationDigest)
      ) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 502);
      }
      // The signed review is not consumed at ticket issuance. Authentication,
      // author-device storage, or a network request may still fail after this
      // point. Each ticket remains short-lived, actor-bound, content-bound, and
      // single-use at publish/overwrite, so retries cannot turn into a replay
      // dead end and another account cannot front-run a captured ticket.
      reviewed = {
        ...serverReview,
        qualityAssurance: "private_ai_hub_verified",
      };
    }
    if (
      reviewed.completionFingerprint !== request.completionFingerprint
      || typeof reviewed.modelId !== "string"
      || !reviewed.modelId.trim()
      || !/^[a-f0-9]{64}$/u.test(reviewed.modelDigest)
    ) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 502);
    }
    const quality = validatePublicLoungeQuality(reviewed);
    const publication = {
      schemaVersion: PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
      title: request.title,
      authorByline: request.authorByline,
      storyLibrarySchemaVersion: request.storyLibrarySchemaVersion,
      shelfId: request.shelfId,
      primaryTopicId: request.primaryTopicId,
      topicIds: request.topicIds,
      completionStatus: "completed" as const,
      chapterCount: request.chapterCount,
      wordCount: request.wordCount,
      completedAt: request.completedAt,
      qualityScore: quality.qualityScore,
      qualityBreakdown: quality.qualityBreakdown,
      fullSynopsis: request.fullSynopsis,
      publicChapters: request.publicChapters,
      explicitConsent: true as const,
      authorRightsDeclaration: true as const,
      workCompleted: true as const,
    };
    const publicationDigest = this.digest(publicLoungeEligibilityBinding(
      publication,
      request.completionFingerprint,
    ));
    const issuedAt = this.now();
    const expiresAt = new Date(Date.parse(issuedAt) + 15 * 60_000).toISOString();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const issued = this.tokenCodec.issue();
      if (!/^[a-f0-9]{64}$/u.test(issued.hash)) throw notConnected();
      const stored: StoredPublicLoungeEligibility = {
        schemaVersion: PUBLIC_LOUNGE_STORED_ELIGIBILITY_SCHEMA_VERSION,
        state: "issued",
        ticketHash: issued.hash,
        completionFingerprint: request.completionFingerprint,
        publicationDigest,
        authorizedOwnerIdHash,
        backendId: reviewed.backendId,
        modelId: reviewed.modelId.trim().slice(0, 160),
        modelDigest: reviewed.modelDigest,
        qualityScore: quality.qualityScore,
        qualityBreakdown: quality.qualityBreakdown,
        qualityAssurance: reviewed.qualityAssurance,
        issuedAt,
        expiresAt,
      };
      const result = await this.storageWrite(() => this.gateway.writeJson(
        publicLoungeEligibilityPath(issued.hash),
        stored,
        { upsert: false },
      ));
      if (result === "exists") continue;
      return {
        schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION,
        eligibilityTicket: issued.token,
        expiresAt,
        backendId: stored.backendId,
        modelId: stored.modelId,
        qualityAssurance: stored.qualityAssurance,
        completionFingerprint: stored.completionFingerprint,
        qualityScore: stored.qualityScore,
        qualityBreakdown: stored.qualityBreakdown,
      };
    }
    throw notConnected();
  }

  private async validateEligibility(
    publication: ReturnType<typeof validatePublicLoungePublicationInput>,
    actorId: string,
    allowExpired = false,
  ) {
    const { eligibilityTicket, ...boundPublication } = publication;
    const ticketHash = this.digest(eligibilityTicket);
    const path = publicLoungeEligibilityPath(ticketHash);
    const stored = await this.storageWrite(() => this.gateway.readJson<StoredPublicLoungeEligibility>(path));
    if (
      !stored
      || stored.schemaVersion !== PUBLIC_LOUNGE_STORED_ELIGIBILITY_SCHEMA_VERSION
      || stored.state !== "issued"
      || stored.ticketHash !== ticketHash
      || stored.authorizedOwnerIdHash !== this.digest(assertPublicLoungeActorId(actorId))
      || !/^[a-f0-9]{64}$/u.test(stored.completionFingerprint)
      || !/^[a-f0-9]{64}$/u.test(stored.modelDigest)
      || stored.qualityAssurance !== "private_ai_hub_verified"
      || stored.backendId !== "private-ai-hub"
      || !Number.isFinite(Date.parse(stored.expiresAt))
    ) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
    }
    if (!allowExpired && Date.parse(stored.expiresAt) <= Date.parse(this.now())) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_EXPIRED", 410);
    }
    const actualDigest = this.digest(publicLoungeEligibilityBinding(
      boundPublication,
      stored.completionFingerprint,
    ));
    if (actualDigest !== stored.publicationDigest) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
    }
    return { stored, ticketHash };
  }

  private async consumeEligibility(
    publication: ReturnType<typeof validatePublicLoungePublicationInput>,
    actorId: string,
  ) {
    const { stored, ticketHash } = await this.validateEligibility(publication, actorId);
    const consumed = await this.storageWrite(() => this.gateway.writeJson(
      publicLoungeEligibilityConsumedPath(ticketHash),
      {
        schemaVersion: "public-lounge-eligibility-consumption-v1",
        ticketHash,
        consumerIdHash: stored.authorizedOwnerIdHash,
        consumedAt: this.now(),
      },
      { upsert: false },
    ));
    if (consumed === "exists") {
      throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED", 409);
    }
    return stored;
  }

  private async consumeEligibilityForPublish(
    publication: ReturnType<typeof validatePublicLoungePublicationInput>,
    claim: StoredPublicLoungePublishClaim,
    actorId: string,
  ) {
    const path = publicLoungeEligibilityConsumedPath(claim.eligibilityTicketHash);
    const existing = await this.storageWrite(() => this.gateway.readJson<unknown>(path));
    let exactExisting: StoredPublicLoungePublishConsumption | null = null;
    if (existing) {
      try {
        exactExisting = storedPublishConsumption(existing, claim.eligibilityTicketHash);
      } catch {
        throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED", 409);
      }
    }
    const { stored, ticketHash } = await this.validateEligibility(publication, actorId, exactExisting !== null);
    if (ticketHash !== claim.eligibilityTicketHash) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_IDEMPOTENCY_CONFLICT", 409);
    }
    const receipt: StoredPublicLoungePublishConsumption = {
      schemaVersion: "public-lounge-publish-consumption-v1",
      ticketHash,
      idempotencyKeyHash: claim.idempotencyKeyHash,
      publicationDigest: claim.publicationDigest,
      eligibilityTicketHash: claim.eligibilityTicketHash,
      authorizedOwnerIdHash: claim.authorizedOwnerIdHash,
      publicId: claim.publicId,
      versionId: claim.versionId,
      publishedAt: claim.publishedAt,
      managementTokenHash: claim.managementTokenHash,
      createdAt: claim.createdAt,
    };
    const acceptExact = (candidate: StoredPublicLoungePublishConsumption) => {
      if (stableStringify(candidate) !== stableStringify(receipt)) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED", 409);
      }
    };
    if (exactExisting) {
      acceptExact(exactExisting);
      return stored;
    }
    let result: "stored" | "exists";
    try {
      result = await this.gateway.writeJson(path, receipt, { upsert: false });
    } catch {
      const ambiguous = await this.storageWrite(() => this.gateway.readJson<unknown>(path));
      if (!ambiguous) throw notConnected();
      try {
        acceptExact(storedPublishConsumption(ambiguous, ticketHash));
      } catch (error) {
        if (error instanceof PublicLoungeError) throw error;
        throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED", 409);
      }
      return stored;
    }
    if (result === "stored") return stored;
    const winner = await this.storageWrite(() => this.gateway.readJson<unknown>(path));
    try {
      acceptExact(storedPublishConsumption(winner, ticketHash));
    } catch (error) {
      if (error instanceof PublicLoungeError) throw error;
      throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED", 409);
    }
    return stored;
  }

  async publish(
    input: unknown,
    idempotencyKey: string,
    actorId: string,
    beforeVisible: (post: PublicLoungePost) => Promise<void>,
  ): Promise<PublicLoungePublishResult> {
    const publication = validatePublicLoungePublicationInput(input);
    const authorizedOwnerIdHash = this.digest(assertPublicLoungeActorId(actorId));
    await this.ensureConnected();
    const { claim, managementToken } = await this.getOrCreatePublishClaim(
      publication,
      idempotencyKey,
      authorizedOwnerIdHash,
    );
    const eligibility = await this.consumeEligibilityForPublish(publication, claim, actorId);
    const post = buildPublicLoungePost(publication, {
      publicId: claim.publicId,
      publishedAt: claim.publishedAt,
      versionId: claim.versionId,
      versionNumber: 1,
      versionPublishedAt: claim.publishedAt,
      qualityAssurance: eligibility.qualityAssurance,
    });
    const summary = publicLoungePostToSummary(post);
    const versionRecord = publishedVersionRecord(post);
    const stored: StoredPublicLoungeCurrentPointer = {
      schemaVersion: PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION,
      state: "active",
      publicId: claim.publicId,
      currentVersionId: claim.versionId,
      currentVersionNumber: 1,
      currentVersionDigest: this.digest(stableStringify(versionRecord)),
      mutationSequence: 1,
      publicSummary: summary,
      publicContentGate: publicContentGateBinding(post, this.digest),
      managementTokenHash: claim.managementTokenHash,
      updatedAt: claim.publishedAt,
    };
    // Bind ownership before the first publicly readable Storage object exists.
    // If owner binding fails, no post/index/catalog object is written. A stale
    // owner reservation is harmless because every reader action revalidates
    // the authoritative Storage head, and the same idempotent retry may bind it
    // again before making the post visible.
    await beforeVisible(post);
    await this.writeImmutableVersion(post);
    let pointerResult: "stored" | "exists";
    try {
      pointerResult = await this.gateway.writeJson(
        publicLoungePostPath(claim.publicId),
        stored,
        { upsert: false },
      );
    } catch {
      const ambiguous = await this.storageWrite(() => this.gateway.readJson<unknown>(
        publicLoungePostPath(claim.publicId),
      ));
      if (!ambiguous || stableStringify(ambiguous) !== stableStringify(stored)) throw notConnected();
      pointerResult = "exists";
    }
    if (pointerResult === "exists") {
      const current = await this.readStoredHead(claim.publicId);
      if (
        !current
        || current.state !== "active"
        || current.managementTokenHash !== claim.managementTokenHash
        || current.publicSummary.publishedAt !== claim.publishedAt
      ) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_IDEMPOTENCY_CONFLICT", 409);
      }
    }
    let indexResult: "stored" | "exists";
    try {
      indexResult = await this.gateway.writeJson(
        publicLoungeIndexPath(claim.publicId),
        summary,
        { upsert: false },
      );
    } catch {
      const ambiguous = await this.storageWrite(() => this.gateway.readJson<unknown>(
        publicLoungeIndexPath(claim.publicId),
      ));
      if (!ambiguous) throw notConnected();
      const existing = sanitizeStoredPublicLoungeIndexEntry(ambiguous);
      if (existing.publicId !== claim.publicId) throw notConnected();
      indexResult = "exists";
    }
    if (indexResult === "exists") {
      const existing = sanitizeStoredPublicLoungeIndexEntry(await this.storageWrite(
        () => this.gateway.readJson<unknown>(publicLoungeIndexPath(claim.publicId)),
      ));
      if (existing.publicId !== claim.publicId) throw notConnected();
    }
    await this.storageWrite(() => this.gateway.upsertCatalogAnchor({
      publicId: claim.publicId,
      publishedAt: summary.publishedAt,
    }));
    return { post, managementToken };
  }

  async overwrite(
    publicId: string,
    managementToken: string,
    input: unknown,
    actorId: string,
  ): Promise<PublicLoungePost> {
    assertPublicLoungeId(publicId);
    if (!managementToken) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED", 401);
    }
    await this.ensureConnected();
    const managementTokenHash = await this.readManagementTokenHash(publicId);
    if (!managementTokenHash) throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_FOUND", 404);
    if (!this.tokenCodec.matches(managementToken, managementTokenHash)) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_INVALID", 403);
    }
    const publication = validatePublicLoungePublicationInput(input);
    const existing = await this.readStored(publicId);
    if (!existing || existing.state === "retracted") {
      throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_FOUND", 404);
    }
    if (!this.tokenCodec.matches(managementToken, existing.managementTokenHash)) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_INVALID", 403);
    }
    const mutationSequence = this.mutationSequence(existing) + 1;
    if (mutationSequence > MAX_MUTATION_SEQUENCE) throw notConnected();
    const claimIdHash = this.issueMutationIdentity();
    const claimedAt = this.now();
    if (!isCanonicalIsoTime(claimedAt)) throw notConnected();
    await this.reserveDurableMutationSlot(
      publicId,
      claimedAt,
    );
    const eligibility = await this.consumeEligibility(publication, actorId);
    if (existing.snapshot.schemaVersion !== PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION) {
      await this.writeImmutableVersion(existing.post);
    }
    const versionNumber = existing.post.versionNumber + 1;
    const versionId = this.versionId(publicId, versionNumber, claimedAt, claimIdHash);
    const post = buildPublicLoungePost(publication, {
      publicId,
      publishedAt: existing.post.publishedAt,
      versionId,
      versionNumber,
      versionPublishedAt: claimedAt,
      qualityAssurance: eligibility.qualityAssurance,
    });
    const versionRecord = publishedVersionRecord(post);
    const targetPointer: StoredPublicLoungeCurrentPointer = {
      schemaVersion: PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION,
      state: "active",
      publicId,
      currentVersionId: versionId,
      currentVersionNumber: versionNumber,
      currentVersionDigest: this.digest(stableStringify(versionRecord)),
      mutationSequence,
      publicSummary: publicLoungePostToSummary(post),
      publicContentGate: publicContentGateBinding(post, this.digest),
      managementTokenHash: existing.managementTokenHash,
      updatedAt: claimedAt,
    };
    // The immutable version may be orphaned if another writer wins, but it can
    // never become visible without winning the single atomic claim below.
    await this.writeImmutableVersion(post);
    await this.createMutationClaim({
      schemaVersion: "public-lounge-mutation-claim-v1",
      publicId,
      operation: "overwrite",
      baseMutationSequence: mutationSequence - 1,
      mutationSequence,
      claimIdHash,
      claimedAt,
      targetPointer,
    });
    await this.writeMutationCheckpoint(targetPointer);
    return post;
  }

  async retract(publicId: string, managementToken: string): Promise<void> {
    assertPublicLoungeId(publicId);
    if (!managementToken) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED", 401);
    }
    await this.ensureConnected();
    const managementTokenHash = await this.readManagementTokenHash(publicId);
    if (!managementTokenHash) throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_FOUND", 404);
    if (!this.tokenCodec.matches(managementToken, managementTokenHash)) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_INVALID", 403);
    }
    const existing = await this.readStored(publicId);
    if (!existing) throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_FOUND", 404);
    if (!this.tokenCodec.matches(managementToken, existing.managementTokenHash)) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_INVALID", 403);
    }
    if (existing.state === "retracted") {
      await this.storageWrite(() => this.gateway.deactivateCatalogAnchor(publicId));
      try {
        await this.gateway.deleteJson([publicLoungeIndexPath(publicId)]);
      } catch {
        // The inactive DB anchor and Storage tombstone are authoritative.
      }
      return;
    }
    const mutationSequence = this.mutationSequence(existing) + 1;
    if (mutationSequence > MAX_MUTATION_SEQUENCE) throw notConnected();
    const claimIdHash = this.issueMutationIdentity();
    const claimedAt = this.now();
    if (!isCanonicalIsoTime(claimedAt)) throw notConnected();
    await this.reserveDurableMutationSlot(
      publicId,
      claimedAt,
    );
    const tombstone: StoredPublicLoungeTombstone = {
      schemaVersion: PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION,
      state: "retracted",
      publicId,
      mutationSequence,
      managementTokenHash: existing.managementTokenHash,
      updatedAt: claimedAt,
    };
    await this.createMutationClaim({
      schemaVersion: "public-lounge-mutation-claim-v1",
      publicId,
      operation: "retract",
      baseMutationSequence: mutationSequence - 1,
      mutationSequence,
      claimIdHash,
      claimedAt,
      targetTombstone: tombstone,
    });
    await this.writeMutationCheckpoint(tombstone);
    await this.storageWrite(() => this.gateway.deactivateCatalogAnchor(publicId));
    try {
      await this.gateway.deleteJson([publicLoungeIndexPath(publicId)]);
    } catch {
      // Retraction and the DB inactive anchor already committed.  The legacy
      // object index is no longer queried and its deletion is only hygiene.
    }
  }
}
