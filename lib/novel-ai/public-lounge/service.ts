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
import {
  PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION,
  PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION,
  type PublicLoungeEligibilityRequest,
  type PublicLoungeListQuery,
  type PublicLoungeListPage,
  type PublicLoungePost,
  type PublicLoungePostSummary,
  type PublicLoungePublishResult,
  type PublicLoungeQualityDimensionKey,
  type PublicLoungeServiceApi,
} from "./types";
import {
  PUBLIC_LOUNGE_STORAGE_BUCKET,
  publicLoungeEligibilityAttestationPath,
  publicLoungeEligibilityConsumedPath,
  publicLoungeEligibilityPath,
  publicLoungeIndexPath,
  publicLoungeIndexPrefix,
  publicLoungePostPath,
  type PublicLoungeStorageGateway,
  type StoredPublicLoungePost,
  type StoredPublicLoungeEligibility,
  type StoredPublicLoungeTombstone,
} from "./storage";

export type PublicLoungeTokenCodec = {
  issue(): { token: string; hash: string };
  matches(token: string, expectedHash: string): boolean;
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
  review(input: PublicLoungeEligibilityRequest): Promise<{
    backendId: "private-ai-hub";
    modelId: string;
    modelDigest: string;
    completionFingerprint: string;
    qualityScore: number;
    qualityBreakdown: Record<PublicLoungeQualityDimensionKey, number>;
    attestationDigest: string;
  }>;
};

function notConnected(): PublicLoungeError {
  return new PublicLoungeError("PUBLIC_LOUNGE_NOT_CONNECTED", 503, true);
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

const STORAGE_LIST_PAGE_SIZE = 200;
const INDEX_READ_CONCURRENCY = 8;
const DEFAULT_RESULT_LIMIT = 24;
const MAX_RESULT_LIMIT = 48;
const MAX_CURSOR_LENGTH = 1_024;
const MAX_INDEX_OBJECTS = 5_000;
const INDEX_FILE_PATTERN = /^(novel_[a-z0-9_-]{12,80})\.json$/u;

type NormalizedListQuery = {
  search: string;
  category: string;
  completedOnly: boolean;
};

type PublicLoungeCursor = {
  v: 1;
  after: { publishedAt: string; publicId: string };
  query: NormalizedListQuery;
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
    || (query.category !== undefined && typeof query.category !== "string")
    || (query.completedOnly !== undefined && typeof query.completedOnly !== "boolean")
  ) {
    throw cursorInvalid();
  }
  const limit = query.limit === undefined ? DEFAULT_RESULT_LIMIT : query.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULT_LIMIT) throw cursorInvalid();
  return {
    normalized: {
      search: normalizeQueryText(query.search, 120),
      category: normalizeQueryText(query.category, 48),
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
    if (!exactKeys(raw, ["v", "after", "query"]) || raw.v !== 1) throw cursorInvalid();
    if (!raw.after || typeof raw.after !== "object" || Array.isArray(raw.after)) throw cursorInvalid();
    if (!raw.query || typeof raw.query !== "object" || Array.isArray(raw.query)) throw cursorInvalid();
    const after = raw.after as Record<string, unknown>;
    const query = raw.query as Record<string, unknown>;
    if (
      !exactKeys(after, ["publishedAt", "publicId"])
      || !exactKeys(query, ["search", "category", "completedOnly"])
      || !isCanonicalIsoTime(after.publishedAt)
      || typeof after.publicId !== "string"
      || !/^novel_[a-z0-9_-]{12,80}$/u.test(after.publicId)
      || typeof query.search !== "string"
      || typeof query.category !== "string"
      || typeof query.completedOnly !== "boolean"
      || query.search !== expectedQuery.search
      || query.category !== expectedQuery.category
      || query.completedOnly !== expectedQuery.completedOnly
    ) {
      throw cursorInvalid();
    }
    return {
      v: 1,
      after: { publishedAt: after.publishedAt, publicId: after.publicId },
      query: expectedQuery,
    };
  } catch (error) {
    if (error instanceof PublicLoungeError) throw error;
    throw cursorInvalid();
  }
}

function encodeCursor(entry: PublicLoungePostSummary, query: NormalizedListQuery) {
  const cursor: PublicLoungeCursor = {
    v: 1,
    after: { publishedAt: entry.publishedAt, publicId: entry.publicId },
    query,
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

type StoredPublication = {
  state: "active";
  post: PublicLoungePost;
  managementTokenHash: string;
} | {
  state: "retracted";
  managementTokenHash: string;
};

function storedPublication(value: unknown, expectedPublicId: string): StoredPublication {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw notConnected();
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION
    || (raw.state !== "active" && raw.state !== "retracted")
    || typeof raw.managementTokenHash !== "string"
    || !/^[a-f0-9]{64}$/u.test(raw.managementTokenHash)
  ) {
    throw notConnected();
  }
  if (raw.state === "retracted") {
    if (raw.publicId !== expectedPublicId) throw notConnected();
    return {
      state: "retracted",
      managementTokenHash: raw.managementTokenHash,
    };
  }
  const post = sanitizeStoredPublicLoungePost(raw.publicPost);
  if (post.publicId !== expectedPublicId) throw notConnected();
  return { state: "active", post, managementTokenHash: raw.managementTokenHash };
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
      const status = await this.gateway.bucketStatus();
      if (!status.exists || status.public || !status.provisioned) throw notConnected();
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
      trustedAttestationProducer: "not-available-in-this-release" as const,
    } as const;
  }

  private async readStored(publicId: string) {
    try {
      const value = await this.gateway.readJson<unknown>(publicLoungePostPath(publicId));
      if (!value) return null;
      return storedPublication(value, publicId);
    } catch (error) {
      if (error instanceof PublicLoungeError && error.code === "PUBLIC_LOUNGE_NOT_CONNECTED") throw error;
      throw notConnected();
    }
  }

  private async storageWrite<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof PublicLoungeError) throw error;
      throw notConnected();
    }
  }

  async list(query: PublicLoungeListQuery = {}): Promise<PublicLoungeListPage> {
    await this.ensureConnected();
    const { normalized, limit } = normalizeListQuery(query);
    const cursor = decodeCursor(query.cursor, normalized);
    const objectNames: string[] = [];
    const seenNames = new Set<string>();
    let offset = 0;
    let scannedObjects = 0;
    while (true) {
      const objects = await this.storageWrite(() => this.gateway.list(publicLoungeIndexPrefix(), {
        limit: STORAGE_LIST_PAGE_SIZE,
        offset,
      }));
      scannedObjects += objects.length;
      if (scannedObjects > MAX_INDEX_OBJECTS) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_CATALOG_LIMIT", 503, true);
      }
      for (const object of objects) {
        if (!INDEX_FILE_PATTERN.test(object.name) || seenNames.has(object.name)) continue;
        seenNames.add(object.name);
        objectNames.push(object.name);
      }
      offset += objects.length;
      if (objects.length < STORAGE_LIST_PAGE_SIZE) break;
    }

    const loaded = await mapWithConcurrency(objectNames, INDEX_READ_CONCURRENCY, async (name) => {
      try {
        const raw = await this.gateway.readJson<unknown>(`${publicLoungeIndexPrefix()}/${name}`);
        if (!raw) return null; // Concurrent retract between list and read.
        const entry = sanitizeStoredPublicLoungeIndexEntry(raw);
        if (`${entry.publicId}.json` !== name) throw notConnected();
        return entry;
      } catch (error) {
        if (error instanceof PublicLoungeError && error.code === "PUBLIC_LOUNGE_NOT_CONNECTED") throw error;
        throw notConnected();
      }
    });
    const entries = loaded.filter((entry): entry is PublicLoungePostSummary => entry !== null);
    if (new Set(entries.map((entry) => entry.publicId)).size !== entries.length) throw notConnected();
    const categories = [...new Set(entries.map((entry) => entry.category))]
      .sort((left, right) => left.localeCompare(right, "zh-Hant"));
    const filtered = entries
      .filter((entry) => !normalized.completedOnly || entry.completionStatus === "completed")
      .filter((entry) => !normalized.category
        || entry.category.toLocaleLowerCase("zh-Hant") === normalized.category)
      .filter((entry) => !normalized.search || [entry.title, entry.authorByline, entry.category, entry.synopsisExcerpt]
        .some((value) => value.toLocaleLowerCase("zh-Hant").includes(normalized.search)))
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)
        || right.publicId.localeCompare(left.publicId));
    const afterCursor = cursor
      ? filtered.filter((entry) => entry.publishedAt < cursor.after.publishedAt
        || (entry.publishedAt === cursor.after.publishedAt && entry.publicId < cursor.after.publicId))
      : filtered;
    const candidates = afterCursor.slice(0, limit + 1);
    const items = candidates.slice(0, limit);
    return {
      items,
      nextCursor: candidates.length > limit && items.length > 0
        ? encodeCursor(items[items.length - 1], normalized)
        : null,
      totalCount: filtered.length,
      categories,
    };
  }

  async get(publicId: string): Promise<PublicLoungePost> {
    assertPublicLoungeId(publicId);
    await this.ensureConnected();
    const stored = await this.readStored(publicId);
    if (!stored || stored.state === "retracted") {
      throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_FOUND", 404);
    }
    return stored.post;
  }

  async issueEligibility(input: unknown) {
    const request = validatePublicLoungeEligibilityRequest(input);
    await this.ensureConnected();
    let reviewed: Awaited<ReturnType<PublicLoungeEligibilityReviewer["review"]>>;
    try {
      reviewed = await this.eligibilityReviewer.review(request);
    } catch (error) {
      if (error instanceof PublicLoungeError) throw error;
      throw new PublicLoungeError("PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED", 503, true);
    }
    if (
      reviewed.backendId !== "private-ai-hub"
      || reviewed.completionFingerprint !== request.completionFingerprint
      || typeof reviewed.modelId !== "string"
      || !reviewed.modelId.trim()
      || !/^[a-f0-9]{64}$/u.test(reviewed.modelDigest)
      || !/^[a-f0-9]{64}$/u.test(reviewed.attestationDigest)
    ) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 502);
    }
    const quality = validatePublicLoungeQuality(reviewed);
    const publication = {
      schemaVersion: "public-lounge-publication-request-v1" as const,
      title: request.title,
      authorByline: request.authorByline,
      category: request.category,
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
    const attestationUse = await this.storageWrite(() => this.gateway.writeJson(
      publicLoungeEligibilityAttestationPath(reviewed.attestationDigest),
      {
        schemaVersion: "public-lounge-attestation-consumption-v1",
        attestationDigest: reviewed.attestationDigest,
        consumedAt: issuedAt,
      },
      { upsert: false },
    ));
    if (attestationUse === "exists") {
      throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED", 409);
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const issued = this.tokenCodec.issue();
      if (!/^[a-f0-9]{64}$/u.test(issued.hash)) throw notConnected();
      const stored: StoredPublicLoungeEligibility = {
        schemaVersion: "public-lounge-stored-eligibility-v1",
        state: "issued",
        ticketHash: issued.hash,
        completionFingerprint: request.completionFingerprint,
        publicationDigest,
        backendId: "private-ai-hub",
        modelId: reviewed.modelId.trim().slice(0, 160),
        modelDigest: reviewed.modelDigest,
        qualityScore: quality.qualityScore,
        qualityBreakdown: quality.qualityBreakdown,
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
        backendId: "private-ai-hub" as const,
        modelId: stored.modelId,
        completionFingerprint: stored.completionFingerprint,
        qualityScore: stored.qualityScore,
        qualityBreakdown: stored.qualityBreakdown,
      };
    }
    throw notConnected();
  }

  private async consumeEligibility(publication: ReturnType<typeof validatePublicLoungePublicationInput>) {
    const { eligibilityTicket, ...boundPublication } = publication;
    const ticketHash = this.digest(eligibilityTicket);
    const path = publicLoungeEligibilityPath(ticketHash);
    const stored = await this.storageWrite(() => this.gateway.readJson<StoredPublicLoungeEligibility>(path));
    if (
      !stored
      || stored.schemaVersion !== "public-lounge-stored-eligibility-v1"
      || stored.state !== "issued"
      || stored.ticketHash !== ticketHash
      || !/^[a-f0-9]{64}$/u.test(stored.completionFingerprint)
      || stored.backendId !== "private-ai-hub"
      || !/^[a-f0-9]{64}$/u.test(stored.modelDigest)
      || !Number.isFinite(Date.parse(stored.expiresAt))
    ) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
    }
    if (Date.parse(stored.expiresAt) <= Date.parse(this.now())) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_EXPIRED", 410);
    }
    const actualDigest = this.digest(publicLoungeEligibilityBinding(
      boundPublication,
      stored.completionFingerprint,
    ));
    if (actualDigest !== stored.publicationDigest) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
    }
    const consumed = await this.storageWrite(() => this.gateway.writeJson(
      publicLoungeEligibilityConsumedPath(ticketHash),
      {
        schemaVersion: "public-lounge-eligibility-consumption-v1",
        ticketHash,
        consumedAt: this.now(),
      },
      { upsert: false },
    ));
    if (consumed === "exists") {
      throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED", 409);
    }
  }

  async publish(input: unknown): Promise<PublicLoungePublishResult> {
    const publication = validatePublicLoungePublicationInput(input);
    await this.ensureConnected();
    await this.consumeEligibility(publication);
    const publishedAt = this.now();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const publicId = assertPublicLoungeId(this.createPublicId());
      const issued = this.tokenCodec.issue();
      if (!/^[a-f0-9]{64}$/u.test(issued.hash)) throw notConnected();
      const post = buildPublicLoungePost(publication, { publicId, publishedAt });
      const stored: StoredPublicLoungePost = {
        schemaVersion: PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION,
        state: "active",
        publicPost: post,
        managementTokenHash: issued.hash,
        updatedAt: publishedAt,
      };
      const result = await this.storageWrite(() => this.gateway.writeJson(
        publicLoungePostPath(publicId),
        stored,
        { upsert: false },
      ));
      if (result === "exists") continue;
      let indexResult: "stored" | "exists";
      try {
        indexResult = await this.storageWrite(() => this.gateway.writeJson(
          publicLoungeIndexPath(publicId),
          publicLoungePostToSummary(post),
          { upsert: false },
        ));
      } catch (error) {
        await this.storageWrite(() => this.gateway.deleteJson([
          publicLoungeIndexPath(publicId),
          publicLoungePostPath(publicId),
        ]));
        throw error;
      }
      if (indexResult === "exists") {
        await this.storageWrite(() => this.gateway.deleteJson([publicLoungePostPath(publicId)]));
        continue;
      }
      // Both durable objects are now committed. Do not perform any fallible read after this
      // point: a failed verification read would strand a public post while withholding the
      // only plaintext management token from its author.
      return { post, managementToken: issued.token };
    }
    throw notConnected();
  }

  async overwrite(publicId: string, managementToken: string, input: unknown): Promise<PublicLoungePost> {
    assertPublicLoungeId(publicId);
    if (!managementToken) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED", 401);
    }
    const publication = validatePublicLoungePublicationInput(input);
    await this.ensureConnected();
    const existing = await this.readStored(publicId);
    if (!existing || existing.state === "retracted") {
      throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_FOUND", 404);
    }
    if (!this.tokenCodec.matches(managementToken, existing.managementTokenHash)) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_INVALID", 403);
    }
    await this.consumeEligibility(publication);
    const updatedAt = this.now();
    const post = buildPublicLoungePost(publication, {
      publicId,
      publishedAt: existing.post.publishedAt,
    });
    const stored: StoredPublicLoungePost = {
      schemaVersion: PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION,
      state: "active",
      publicPost: post,
      managementTokenHash: existing.managementTokenHash,
      updatedAt,
    };
    await this.storageWrite(() => this.gateway.writeJson(publicLoungePostPath(publicId), stored, { upsert: true }));
    await this.storageWrite(() => this.gateway.writeJson(
      publicLoungeIndexPath(publicId),
      publicLoungePostToSummary(post),
      { upsert: true },
    ));
    return post;
  }

  async retract(publicId: string, managementToken: string): Promise<void> {
    assertPublicLoungeId(publicId);
    if (!managementToken) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED", 401);
    }
    await this.ensureConnected();
    const existing = await this.readStored(publicId);
    if (!existing) throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_FOUND", 404);
    if (!this.tokenCodec.matches(managementToken, existing.managementTokenHash)) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_INVALID", 403);
    }
    if (existing.state === "active") {
      const tombstone: StoredPublicLoungeTombstone = {
        schemaVersion: PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION,
        state: "retracted",
        publicId,
        managementTokenHash: existing.managementTokenHash,
        updatedAt: this.now(),
      };
      await this.storageWrite(() => this.gateway.writeJson(
        publicLoungePostPath(publicId),
        tombstone,
        { upsert: true },
      ));
    }
    await this.storageWrite(() => this.gateway.deleteJson([publicLoungeIndexPath(publicId)]));
  }
}
