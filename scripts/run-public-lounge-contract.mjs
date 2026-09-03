import assert from "node:assert/strict";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import {
  buildPublicLoungePost,
  PublicLoungeError,
  publicLoungeEligibilityBinding,
  publicLoungePostToSummary,
  sanitizeStoredPublicLoungeIndexEntry,
  sanitizeStoredPublicLoungePost,
  validatePublicLoungePublicationInput,
} from "../lib/novel-ai/public-lounge/contract.ts";
import {
  createPublicLoungePublicationFromWholeNovelReview,
  loadPublicLoungeWorkPublicationReference,
  publishPublicLoungePost,
  PublicLoungeClientError,
  requestPublicLoungeEligibilityProof,
  removePublicLoungeWorkPublicationReference,
  resolvePublicLoungeManagementRecovery,
  savePublicLoungeWorkPublicationReference,
} from "../lib/novel-ai/public-lounge/client.ts";
import {
  createEd25519PublicLoungeEligibilityReviewer,
  createEd25519PublicLoungeEligibilityReviewerV5,
  publicLoungeServerReviewAttestationPayload,
  publicLoungeServerReviewAttestationV5Payload,
  resolvePublicLoungeAttestationEnvironment,
} from "../lib/novel-ai/public-lounge/eligibility-signature.ts";
import { PublicLoungeService } from "../lib/novel-ai/public-lounge/service.ts";
import { stableStringify } from "../lib/novel-ai/closed-ai-cache/index.ts";
import { buildAuthorDeviceReviewDeclaration } from "../lib/novel-ai/public-lounge/author-device-review.ts";
import {
  PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION,
  PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS,
  PUBLIC_LOUNGE_MULTI_JUDGE_SUMMARY_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES,
  PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION,
  PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_SCHEMA_VERSION,
  PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_V5_SCHEMA_VERSION,
  PUBLIC_LOUNGE_LEGACY_INDEX_ENTRY_SCHEMA_VERSION,
  PUBLIC_LOUNGE_LEGACY_POST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PRIOR_INDEX_ENTRY_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PRIOR_POST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PRIOR_STORED_ELIGIBILITY_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PRIOR_STORED_POST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PUBLISHED_VERSION_SCHEMA_VERSION,
  PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_STORED_ELIGIBILITY_SCHEMA_VERSION,
} from "../lib/novel-ai/public-lounge/types.ts";
import { normalizePublicLoungeTopicIds } from "../lib/novel-ai/public-lounge/taxonomy.ts";
import {
  isPublicLoungeImmutableStorageObjectPath,
  isPublicLoungeStorageObjectPath,
  publicLoungeVersionPath,
} from "../lib/novel-ai/public-lounge/storage.ts";

const NOW = "2026-08-29T03:00:00.000Z";
const COMPLETION_FINGERPRINT = "c".repeat(64);
const MODEL_DIGEST = "d".repeat(64);
const KEY_ID = "private-ai-hub-production-2026-08";
const WORK_ID = "work_public_lounge_contract_0001";
const V5_ENVIRONMENT = "preview";
const V5_AUDIENCE = "novel-public-lounge-preview";
const V5_PRODUCER_VERSION = "private-ai-hub-attestation-producer-v1";
const TEST_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
const tests = [];
let attestationCounter = 0;
let idempotencyCounter = 0;
let serviceTokenCounter = 0;
const DEFAULT_TAXONOMY = normalizePublicLoungeTopicIds(["classic-topic-002"]);

function test(name, run) { tests.push({ name, run }); }
function hash(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function nextIdempotencyKey() {
  idempotencyCounter += 1;
  return `idem-${String(idempotencyCounter).padStart(27, "0")}`;
}
function publish(service, input, idempotencyKey = nextIdempotencyKey()) {
  return service.publish(input, idempotencyKey, TEST_ACTOR_ID, async () => undefined);
}
function qualityBreakdown(score = 86) {
  return Object.fromEntries([
    "plot_coherence", "character_arcs", "world_canon_consistency", "pacing",
    "prose_dialogue", "foreshadowing_payoff", "ending",
  ].map((key) => [key, score]));
}

function attestedJudge(judgeRole, dimensionScores, fullCoverage = true) {
  const totalScore = Math.round([
    ["plot_coherence", 20],
    ["character_arcs", 15],
    ["world_canon_consistency", 15],
    ["pacing", 15],
    ["prose_dialogue", 15],
    ["foreshadowing_payoff", 10],
    ["ending", 10],
  ].reduce((sum, [key, weight]) => sum + dimensionScores[key] * weight, 0)) / 100;
  return { judgeRole, totalScore, dimensionScores, fullCoverage };
}

function multiJudgeSummary(dimensionScores, chapterCount) {
  const judges = PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES.map((judgeRole) => (
    attestedJudge(judgeRole, { ...dimensionScores })
  ));
  return {
    schemaVersion: PUBLIC_LOUNGE_MULTI_JUDGE_SUMMARY_SCHEMA_VERSION,
    primaryJudgeRoles: [...PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES],
    primaryJudgeCount: 3,
    judges,
    aggregationMethod: "per-dimension-median",
    primaryScoreSpread: 0,
    selectedJudgeRoles: [...PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES],
    arbitrationRequired: false,
    arbitrationPerformed: false,
    fullCoverageJudgeRoles: [...PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES],
    reviewedChapterCount: chapterCount,
    reviewedChunkCount: Math.max(chapterCount, chapterCount * 2),
  };
}

function validPublication(overrides = {}) {
  return {
    schemaVersion: PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
    title: "《霧港歸航》",
    authorByline: "林舟",
    ...DEFAULT_TAXONOMY,
    completionStatus: "completed",
    chapterCount: 12,
    wordCount: 86_420,
    completedAt: "2026-08-28T08:30:00.000Z",
    qualityScore: 86,
    qualityBreakdown: qualityBreakdown(),
    fullSynopsis: "船醫在霧港追查失蹤航線，最終必須決定要保住故鄉，還是揭開它賴以生存的謊言。",
    publicChapters: [
      { chapterNumber: 1, title: "霧中燈塔", body: "潮聲越過防波堤時，沈遙看見熄滅十年的燈塔重新亮起。", official: true },
      { chapterNumber: 12, title: "歸航", body: "天亮以前，她把最後一頁航海誌交給港口的每一個人。", official: true },
    ],
    eligibilityTicket: "E".repeat(43),
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
    ...overrides,
  };
}

function unsignedPublicationFromRequest(request, score = 86, breakdown = qualityBreakdown(score)) {
  return {
    schemaVersion: PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
    title: request.title,
    authorByline: request.authorByline,
    storyLibrarySchemaVersion: request.storyLibrarySchemaVersion,
    shelfId: request.shelfId,
    primaryTopicId: request.primaryTopicId,
    topicIds: request.topicIds,
    completionStatus: "completed",
    chapterCount: request.chapterCount,
    wordCount: request.wordCount,
    completedAt: request.completedAt,
    qualityScore: score,
    qualityBreakdown: breakdown,
    fullSynopsis: request.fullSynopsis,
    publicChapters: request.publicChapters,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
  };
}

function signedV4EligibilityRequest(overrides = {}, attestationOverrides = {}) {
  attestationCounter += 1;
  const base = validPublication(overrides);
  const request = {
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
    completionFingerprint: COMPLETION_FINGERPRINT,
    title: base.title,
    authorByline: base.authorByline,
    storyLibrarySchemaVersion: base.storyLibrarySchemaVersion,
    shelfId: base.shelfId,
    primaryTopicId: base.primaryTopicId,
    topicIds: base.topicIds,
    completionStatus: "completed",
    chapterCount: base.chapterCount,
    wordCount: base.wordCount,
    completedAt: base.completedAt,
    fullSynopsis: base.fullSynopsis,
    publicChapters: base.publicChapters,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
    trustedServerReviewConsent: true,
  };
  const score = attestationOverrides.qualityScore ?? 86;
  const breakdown = attestationOverrides.qualityBreakdown ?? qualityBreakdown(score);
  const attestation = {
    schemaVersion: PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_SCHEMA_VERSION,
    issuer: "private-ai-hub",
    keyId: KEY_ID,
    nonce: `nonce${String(attestationCounter).padStart(18, "0")}`,
    issuedAt: "2026-08-29T02:55:00.000Z",
    expiresAt: "2026-08-29T03:10:00.000Z",
    completionFingerprint: COMPLETION_FINGERPRINT,
    publicationDigest: hash(publicLoungeEligibilityBinding(
      unsignedPublicationFromRequest(request, score, breakdown),
      COMPLETION_FINGERPRINT,
    )),
    qualityScore: score,
    qualityBreakdown: breakdown,
    workCompleted: true,
    fullCoverage: true,
    hardGatePassed: true,
    compliancePassed: true,
    criticalDimensionsPassed: true,
    hiddenDraftResidueDetected: false,
    multiJudgeSummary: attestationOverrides.multiJudgeSummary
      ?? multiJudgeSummary(breakdown, base.chapterCount),
    backendId: "private-ai-hub",
    modelId: "closed-reviewer-v1",
    modelDigest: MODEL_DIGEST,
    rawContentStored: false,
    signature: "",
    ...attestationOverrides,
  };
  attestation.signature = sign(
    null,
    Buffer.from(publicLoungeServerReviewAttestationPayload(attestation), "utf8"),
    privateKey,
  ).toString("base64url");
  return { ...request, serverAttestation: attestation };
}

function signedEligibilityRequest(
  overrides = {},
  attestationOverrides = {},
  operationOverrides = {},
) {
  attestationCounter += 1;
  const base = validPublication(overrides);
  const operation = {
    intent: "publish",
    targetPublicationId: null,
    expectedTargetVersionId: null,
    expectedTargetPublicationDigest: null,
    ...operationOverrides,
  };
  const request = {
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
    completionFingerprint: COMPLETION_FINGERPRINT,
    workId: WORK_ID,
    revisionId: COMPLETION_FINGERPRINT,
    title: base.title,
    authorByline: base.authorByline,
    storyLibrarySchemaVersion: base.storyLibrarySchemaVersion,
    shelfId: base.shelfId,
    primaryTopicId: base.primaryTopicId,
    topicIds: base.topicIds,
    completionStatus: "completed",
    chapterCount: base.chapterCount,
    wordCount: base.wordCount,
    completedAt: base.completedAt,
    fullSynopsis: base.fullSynopsis,
    publicChapters: base.publicChapters,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
    trustedServerReviewConsent: true,
    ...operation,
  };
  const score = attestationOverrides.qualityScore ?? 86;
  const breakdown = attestationOverrides.qualityBreakdown ?? qualityBreakdown(score);
  const publication = unsignedPublicationFromRequest(request, score, breakdown);
  const attestation = {
    schemaVersion: PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_V5_SCHEMA_VERSION,
    issuer: "private-ai-hub",
    keyId: KEY_ID,
    attestationId: `attestation${String(attestationCounter).padStart(18, "0")}`,
    ...operation,
    workId: request.workId,
    revisionId: request.revisionId,
    environment: V5_ENVIRONMENT,
    audience: V5_AUDIENCE,
    producerVersion: V5_PRODUCER_VERSION,
    rubricVersion: PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION,
    issuedAt: "2026-08-29T02:55:00.000Z",
    expiresAt: "2026-08-29T03:10:00.000Z",
    completionFingerprint: COMPLETION_FINGERPRINT,
    contentDigest: hash(JSON.stringify(request.publicChapters)),
    publicationDigest: hash(publicLoungeEligibilityBinding(
      publication,
      COMPLETION_FINGERPRINT,
    )),
    qualityScore: score,
    qualityBreakdown: breakdown,
    workCompleted: true,
    fullCoverage: true,
    hardGatePassed: true,
    compliancePassed: true,
    criticalDimensionsPassed: true,
    hiddenDraftResidueDetected: false,
    multiJudgeSummary: attestationOverrides.multiJudgeSummary
      ?? multiJudgeSummary(breakdown, base.chapterCount),
    backendId: "private-ai-hub",
    modelId: "closed-reviewer-v1",
    modelDigest: MODEL_DIGEST,
    rawContentStored: false,
    signature: "",
    ...attestationOverrides,
  };
  attestation.signature = sign(
    null,
    Buffer.from(publicLoungeServerReviewAttestationV5Payload(attestation), "utf8"),
    privateKey,
  ).toString("base64url");
  return { ...request, serverAttestation: attestation };
}

function expectCode(run, code) {
  assert.throws(run, (error) => error instanceof PublicLoungeError && error.code === code);
}
async function expectAsyncCode(run, code) {
  await assert.rejects(run, (error) => error instanceof PublicLoungeError && error.code === code);
}

class MemoryLoungeGateway {
  constructor(status = { exists: true, public: false, provisioned: true }) {
    this.status = status;
    this.objects = new Map();
    this.catalog = new Map();
    this.catalogCalls = [];
    this.rateBuckets = new Map();
    this.attestationLedger = new Map();
    this.attestationLedgerCalls = [];
    this.listOffsets = [];
    this.activeReads = 0;
    this.maxActiveReads = 0;
    this.readDelayMs = 0;
    this.readPaths = [];
  }
  async bucketStatus() { return this.status; }
  async controlPlaneStatus() {
    return {
      migrationVersion: "public_lounge_control_plane_028",
      catalogReady: true,
      rateReady: true,
    };
  }
  async attestationNonceLedgerStatus() {
    return {
      migrationVersion: "public_lounge_attestation_nonce_ledger_029",
      ledgerReady: true,
    };
  }
  async consumeAttestationNonceV5(input) {
    this.attestationLedgerCalls.push(structuredClone(input));
    if (this.attestationLedger.has(input.attestationIdHash)) return "replayed";
    this.attestationLedger.set(input.attestationIdHash, structuredClone(input));
    return "consumed";
  }
  async readJson(path) {
    this.readPaths.push(path);
    const isAuthoritativeHead = path.includes("/posts/");
    if (isAuthoritativeHead) {
      this.activeReads += 1;
      this.maxActiveReads = Math.max(this.maxActiveReads, this.activeReads);
      if (this.readDelayMs) await new Promise((resolve) => setTimeout(resolve, this.readDelayMs));
    }
    try {
      const value = this.objects.get(path);
      return value === undefined ? null : structuredClone(value);
    } finally {
      if (isAuthoritativeHead) this.activeReads -= 1;
    }
  }
  async writeJson(path, value, options) {
    if (!options.upsert && this.objects.has(path)) return "exists";
    this.objects.set(path, structuredClone(value));
    return "stored";
  }
  async deleteJson(paths) { for (const path of paths) this.objects.delete(path); }
  async list(prefix, options) {
    this.listOffsets.push(options.offset);
    return [...this.objects.keys()]
      .filter((path) => path.startsWith(`${prefix}/`))
      .map((path) => path.slice(prefix.length + 1))
      .sort()
      .slice(options.offset, options.offset + options.limit)
      .map((name) => ({ name }));
  }
  async listCatalogCandidates({ after, limit }) {
    this.catalogCalls.push({ after: structuredClone(after), limit });
    const rows = [...this.catalog.values()]
      .filter((candidate) => candidate.active)
      .filter((candidate) => !after
        || candidate.publishedAt < after.publishedAt
        || (candidate.publishedAt === after.publishedAt && candidate.publicId < after.publicId))
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)
        || right.publicId.localeCompare(left.publicId));
    return {
      items: rows.slice(0, limit).map(({ publicId, publishedAt }) => ({ publicId, publishedAt })),
      hasMore: rows.length > limit,
    };
  }
  async upsertCatalogAnchor({ publicId, publishedAt }) {
    const existing = this.catalog.get(publicId);
    if (existing && existing.publishedAt !== publishedAt) throw new Error("CATALOG_ANCHOR_CONFLICT");
    this.catalog.set(publicId, { publicId, publishedAt, active: true });
  }
  async deactivateCatalogAnchor(publicId) {
    const existing = this.catalog.get(publicId);
    if (existing) this.catalog.set(publicId, { ...existing, active: false });
  }
  async reserveRate({ identityHash, scope, now }) {
    const nowMs = Date.parse(now);
    for (const [key] of [...this.rateBuckets.entries()]
      .filter(([, value]) => value.expiresAt <= nowMs)
      .sort((left, right) => left[1].expiresAt - right[1].expiresAt)
      .slice(0, 64)) {
      this.rateBuckets.delete(key);
    }
    const quotaLimit = scope === "read" ? 30 : 6;
    const windowStart = Math.floor(nowMs / 60_000) * 60_000;
    const key = `${scope}:${identityHash}:${windowStart}`;
    const current = this.rateBuckets.get(key);
    const count = Math.min((current?.count ?? 0) + 1, quotaLimit + 1);
    const expiresAt = windowStart + 60_000;
    this.rateBuckets.set(key, { count, expiresAt });
    return {
      allowed: count <= quotaLimit,
      limit: quotaLimit,
      remaining: Math.max(0, quotaLimit - count),
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - nowMs) / 1_000)),
    };
  }
}

class BarrierMutationClaimGateway extends MemoryLoungeGateway {
  constructor() {
    super();
    this.claimArrivals = 0;
    this.claimBarrier = new Promise((resolve) => { this.releaseClaimBarrier = resolve; });
    this.firstClaimArrived = new Promise((resolve) => { this.resolveFirstClaimArrived = resolve; });
  }
  async writeJson(path, value, options) {
    if (path.includes("/mutations/claims/") && !this.objects.has(path)) {
      this.claimArrivals += 1;
      if (this.claimArrivals === 1) {
        this.resolveFirstClaimArrived();
        await this.claimBarrier;
      }
      else if (this.claimArrivals === 2) this.releaseClaimBarrier();
    }
    return super.writeJson(path, value, options);
  }
}

class BarrierEligibilityConsumptionGateway extends MemoryLoungeGateway {
  constructor() {
    super();
    this.arrivals = 0;
    this.barrier = new Promise((resolve) => { this.releaseBarrier = resolve; });
  }
  async writeJson(path, value, options) {
    if (path.includes("/eligibility/consumed/") && !this.objects.has(path)) {
      this.arrivals += 1;
      if (this.arrivals === 1) await this.barrier;
      else if (this.arrivals === 2) this.releaseBarrier();
    }
    return super.writeJson(path, value, options);
  }
}

class BarrierAttestationNonceGateway extends MemoryLoungeGateway {
  constructor() {
    super();
    this.attestationArrivals = 0;
    this.attestationBarrier = new Promise((resolve) => { this.releaseAttestationBarrier = resolve; });
  }
  async consumeAttestationNonceV5(input) {
    if (!this.attestationLedger.has(input.attestationIdHash)) {
      this.attestationArrivals += 1;
      if (this.attestationArrivals === 1) await this.attestationBarrier;
      else if (this.attestationArrivals === 2) this.releaseAttestationBarrier();
    }
    return super.consumeAttestationNonceV5(input);
  }
}

class MemoryDeviceStorage {
  constructor({ failOnSetCall = 0 } = {}) {
    this.failOnSetCall = failOnSetCall;
    this.setCalls = 0;
    this.values = new Map();
  }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    this.setCalls += 1;
    if (this.failOnSetCall === this.setCalls) throw new Error("DEVICE_STORAGE_WRITE_FAILED");
    this.values.set(key, String(value));
  }
  removeItem(key) { this.values.delete(key); }
}

function serviceFixture(
  gateway = new MemoryLoungeGateway(),
  eligibilityReviewer = createEd25519PublicLoungeEligibilityReviewerV5({
    publicKeyPem,
    keyId: KEY_ID,
    environment: V5_ENVIRONMENT,
    audience: V5_AUDIENCE,
    producerVersion: V5_PRODUCER_VERSION,
    rubricVersion: PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION,
    now: () => NOW,
  }),
) {
  let publicIdCounter = 0;
  const sealKey = Buffer.from(hash("public-lounge-contract-seal-key"), "hex");
  const service = new PublicLoungeService({
    gateway,
    tokenCodec: {
      issue() {
        serviceTokenCounter += 1;
        const token = `token-${String(serviceTokenCounter).padStart(6, "0")}`.padEnd(43, "x");
        return { token, hash: hash(token) };
      },
      matches: (candidate, expected) => hash(candidate) === expected,
      seal(token, context) {
        const iv = Buffer.alloc(12, 7);
        const cipher = createCipheriv("aes-256-gcm", sealKey, iv);
        cipher.setAAD(Buffer.from(context, "utf8"));
        const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
        return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
      },
      unseal(sealed, context) {
        try {
          const [iv, tag, encrypted] = sealed.split(".").map((part) => Buffer.from(part, "base64url"));
          const decipher = createDecipheriv("aes-256-gcm", sealKey, iv);
          decipher.setAAD(Buffer.from(context, "utf8"));
          decipher.setAuthTag(tag);
          return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
        } catch {
          return null;
        }
      },
    },
    createPublicId() {
      publicIdCounter += 1;
      return `novel_${String(publicIdCounter).padStart(16, "0")}`;
    },
    now: () => NOW,
    digest: hash,
    eligibilityReviewer,
  });
  const issueEligibility = service.issueEligibility.bind(service);
  service.issueEligibility = (input, actorId = TEST_ACTOR_ID) => issueEligibility(input, actorId);
  const overwrite = service.overwrite.bind(service);
  service.overwrite = (publicId, managementToken, input, actorId = TEST_ACTOR_ID) => (
    overwrite(publicId, managementToken, input, actorId)
  );
  return { gateway, service };
}

async function authorizedPublication(fixture, overrides = {}, operation = {}) {
  const proof = await fixture.service.issueEligibility(signedEligibilityRequest(overrides, {}, operation));
  return validPublication({
    ...overrides,
    qualityScore: proof.qualityScore,
    qualityBreakdown: proof.qualityBreakdown,
    eligibilityTicket: proof.eligibilityTicket,
  });
}

function publishedVersionDigest(post) {
  return hash(stableStringify(post));
}

async function currentOverwriteOperation(fixture, publicId) {
  const current = await fixture.service.get(publicId);
  return {
    intent: "overwrite",
    targetPublicationId: publicId,
    expectedTargetVersionId: current.versionId,
    expectedTargetPublicationDigest: publishedVersionDigest(current),
  };
}

async function authorizedOverwritePublication(fixture, publicId, overrides = {}) {
  return authorizedPublication(
    fixture,
    overrides,
    await currentOverwriteOperation(fixture, publicId),
  );
}

function replaceStoredEligibilityWithV4(fixture, eligibilityTicket) {
  const ticketHash = hash(eligibilityTicket);
  const path = `public-lounge-v1/eligibility/issued/${ticketHash}.json`;
  const stored = fixture.gateway.objects.get(path);
  assert.ok(stored);
  fixture.gateway.objects.set(path, {
    schemaVersion: PUBLIC_LOUNGE_PRIOR_STORED_ELIGIBILITY_SCHEMA_VERSION,
    state: "issued",
    ticketHash: stored.ticketHash,
    completionFingerprint: stored.completionFingerprint,
    publicationDigest: stored.publicationDigest,
    authorizedOwnerIdHash: stored.authorizedOwnerIdHash,
    backendId: stored.backendId,
    modelId: stored.modelId,
    modelDigest: stored.modelDigest,
    qualityScore: stored.qualityScore,
    qualityBreakdown: stored.qualityBreakdown,
    qualityAssurance: stored.qualityAssurance,
    issuedAt: stored.issuedAt,
    expiresAt: stored.expiresAt,
  });
  return { path, ticketHash };
}

let authorDeviceNonceCounter = 0;
async function authorDeviceEligibilityRequest(overrides = {}) {
  authorDeviceNonceCounter += 1;
  const base = validPublication(overrides);
  const declaration = await buildAuthorDeviceReviewDeclaration({
    issuedAt: NOW,
    nonce: `author-device-${String(authorDeviceNonceCounter).padStart(16, "0")}`,
    completionFingerprint: COMPLETION_FINGERPRINT,
    backendId: "browser-ai",
    modelId: "closed-ai/multi-judge-median",
    modelDigest: MODEL_DIGEST,
    fullCoverage: true,
    hardGatePassed: true,
    compliancePassed: true,
    criticalDimensionsPassed: true,
    qualityScore: 86,
    dimensionScores: qualityBreakdown(86),
  });
  return {
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
    completionFingerprint: COMPLETION_FINGERPRINT,
    title: base.title,
    authorByline: base.authorByline,
    storyLibrarySchemaVersion: base.storyLibrarySchemaVersion,
    shelfId: base.shelfId,
    primaryTopicId: base.primaryTopicId,
    topicIds: base.topicIds,
    completionStatus: "completed",
    chapterCount: base.chapterCount,
    wordCount: base.wordCount,
    completedAt: base.completedAt,
    fullSynopsis: base.fullSynopsis,
    publicChapters: base.publicChapters,
    authorDeviceReview: declaration,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
    authorDeviceReviewConsent: true,
  };
}

function seedSummary(gateway, index, overrides = {}) {
  const publicId = overrides.publicId ?? `novel_${String(index).padStart(16, "0")}`;
  const publication = validPublication({
    title: overrides.title ?? `公開小說 ${index}`,
    ...(overrides.topicIds ? normalizePublicLoungeTopicIds(overrides.topicIds) : DEFAULT_TAXONOMY),
  });
  const post = buildPublicLoungePost(publication, {
    publicId,
    publishedAt: overrides.publishedAt ?? new Date(Date.UTC(2026, 7, 29, 3, 0, index)).toISOString(),
    versionId: `version_seed_${String(index).padStart(16, "0")}`,
    versionNumber: 1,
    versionPublishedAt: overrides.publishedAt ?? new Date(Date.UTC(2026, 7, 29, 3, 0, index)).toISOString(),
    qualityAssurance: overrides.qualityAssurance ?? "private_ai_hub_verified",
  });
  const summary = publicLoungePostToSummary(post);
  gateway.catalog.set(publicId, { publicId, publishedAt: post.publishedAt, active: true });
  gateway.objects.set(`public-lounge-v1/index/${publicId}.json`, summary);
  gateway.objects.set(`public-lounge-v1/versions/${publicId}/${post.versionId}.json`, {
    schemaVersion: PUBLIC_LOUNGE_PUBLISHED_VERSION_SCHEMA_VERSION,
    publicId,
    versionId: post.versionId,
    versionNumber: post.versionNumber,
    versionPublishedAt: post.versionPublishedAt,
    publicPost: post,
  });
  gateway.objects.set(`public-lounge-v1/posts/${publicId}.json`, {
    schemaVersion: PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION,
    state: "active",
    publicId,
    currentVersionId: post.versionId,
    currentVersionNumber: post.versionNumber,
    mutationSequence: 1,
    publicSummary: summary,
    publicContentGate: {
      schemaVersion: "public-lounge-public-content-gate-binding-v1",
      passed: true,
      contentDigest: hash(stableStringify({
        chapterCount: post.chapterCount,
        wordCount: post.wordCount,
        publicChapters: post.publicChapters,
        fullSynopsis: post.fullSynopsis,
      })),
    },
    managementTokenHash: hash(`seed-management-${publicId}`),
    updatedAt: post.versionPublishedAt,
  });
  return summary;
}

function withoutTaxonomy(value) {
  const copy = structuredClone(value);
  delete copy.storyLibrarySchemaVersion;
  delete copy.shelfId;
  delete copy.primaryTopicId;
  delete copy.topicIds;
  return copy;
}

test("contract accepts an explicit completed rights-cleared integer 80+ publication", () => {
  const parsed = validatePublicLoungePublicationInput(validPublication({
    title: "  霧港\u0000歸航\u202e  ",
    fullSynopsis: "第一行  \r\n第二行",
  }));
  assert.equal(parsed.title, "霧港歸航");
  assert.equal(parsed.fullSynopsis, "第一行\n第二行");
});

test("Vercel Preview and Production reject a mismatched attestation trust domain", () => {
  assert.equal(resolvePublicLoungeAttestationEnvironment("preview", "preview"), "preview");
  assert.equal(resolvePublicLoungeAttestationEnvironment("production", "production"), "production");
  assert.equal(
    resolvePublicLoungeAttestationEnvironment("preview", "production"),
    "deployment-environment-mismatch",
  );
  assert.equal(
    resolvePublicLoungeAttestationEnvironment("production", "preview"),
    "deployment-environment-mismatch",
  );
});

test("v2 taxonomy is canonical, shelf is primary-topic derived, and legacy v1 never guesses", () => {
  expectCode(() => validatePublicLoungePublicationInput(validPublication({
    shelfId: "group-1",
  })), "PUBLIC_LOUNGE_PAYLOAD_INVALID");
  expectCode(() => validatePublicLoungePublicationInput(validPublication({
    topicIds: ["classic-topic-002", "classic-topic-002"],
  })), "PUBLIC_LOUNGE_PAYLOAD_INVALID");

  const v2Post = buildPublicLoungePost(validPublication(), {
    publicId: "novel_legacytest0001",
    publishedAt: NOW,
    versionId: "version_legacytest0001",
    versionNumber: 1,
    versionPublishedAt: NOW,
    qualityAssurance: "private_ai_hub_verified",
  });
  const legacyPostCommon = withoutTaxonomy(v2Post);
  const mappedPost = sanitizeStoredPublicLoungePost({
    ...legacyPostCommon,
    schemaVersion: PUBLIC_LOUNGE_LEGACY_POST_SCHEMA_VERSION,
    category: "都市奇幻",
  });
  assert.equal(mappedPost.primaryTopicId, "classic-topic-002");
  assert.equal(mappedPost.shelfId, "group-5");

  const unknownPost = sanitizeStoredPublicLoungePost({
    ...legacyPostCommon,
    schemaVersion: PUBLIC_LOUNGE_LEGACY_POST_SCHEMA_VERSION,
    category: "無法精確對應的舊分類",
  });
  assert.equal(unknownPost.primaryTopicId, null);
  assert.equal(unknownPost.shelfId, null);
  assert.deepEqual(unknownPost.topicIds, []);
  assert.equal(Object.hasOwn(unknownPost, "legacyCategory"), false);

  const v2Summary = publicLoungePostToSummary(v2Post);
  const legacySummaryCommon = withoutTaxonomy(v2Summary);
  const unknownSummary = sanitizeStoredPublicLoungeIndexEntry({
    ...legacySummaryCommon,
    schemaVersion: PUBLIC_LOUNGE_LEGACY_INDEX_ENTRY_SCHEMA_VERSION,
    category: "無法精確對應的舊分類",
  });
  assert.deepEqual(unknownSummary.topicIds, []);
  assert.equal(Object.hasOwn(unknownSummary, "legacyCategory"), false);
});

test("contract rejects consent rights completion threshold weighted mismatch and private fields", () => {
  expectCode(() => validatePublicLoungePublicationInput(validPublication({ explicitConsent: false })), "PUBLIC_LOUNGE_CONSENT_REQUIRED");
  expectCode(() => validatePublicLoungePublicationInput(validPublication({ authorRightsDeclaration: false })), "PUBLIC_LOUNGE_RIGHTS_DECLARATION_REQUIRED");
  expectCode(() => validatePublicLoungePublicationInput(validPublication({ workCompleted: false })), "PUBLIC_LOUNGE_WORK_NOT_COMPLETED");
  expectCode(() => validatePublicLoungePublicationInput(validPublication({ qualityScore: 79 })), "PUBLIC_LOUNGE_SCORE_NOT_QUALIFIED");
  expectCode(() => validatePublicLoungePublicationInput(validPublication({ qualityScore: 87 })), "PUBLIC_LOUNGE_PAYLOAD_INVALID");
  assert.equal(validatePublicLoungePublicationInput(validPublication({
    fullSynopsis: "摘".repeat(PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS),
  })).fullSynopsis.length, PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS);
  expectCode(() => validatePublicLoungePublicationInput(validPublication({
    fullSynopsis: "摘".repeat(PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS + 1),
  })), "PUBLIC_LOUNGE_PAYLOAD_INVALID");
  for (const key of ["projectId", "privateCanon", "systemPrompt", "modelTrace", "backup"]) {
    expectCode(() => validatePublicLoungePublicationInput({ ...validPublication(), [key]: "secret" }), "PUBLIC_LOUNGE_FORBIDDEN_FIELD");
  }
});

test("forged caller-reported 100 score without stored eligibility is rejected", async () => {
  const fixture = serviceFixture();
  await expectAsyncCode(() => publish(fixture.service, validPublication({
    qualityScore: 100,
    qualityBreakdown: qualityBreakdown(100),
    eligibilityTicket: "F".repeat(43),
  })), "PUBLIC_LOUNGE_ELIGIBILITY_INVALID");
});

test("the original v4 verifier remains independently usable while public ticket issuance rejects v4", async () => {
  const request = signedV4EligibilityRequest();
  const reviewer = createEd25519PublicLoungeEligibilityReviewer({
    publicKeyPem,
    keyId: KEY_ID,
    now: () => NOW,
  });
  const reviewed = await reviewer.review(request);
  assert.equal(reviewed.qualityScore, 86);
  assert.equal(reviewed.completionFingerprint, COMPLETION_FINGERPRINT);
  const frozenPayload = JSON.parse(publicLoungeServerReviewAttestationPayload(request.serverAttestation));
  assert.equal(frozenPayload.schemaVersion, PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_SCHEMA_VERSION);
  assert.equal(Object.hasOwn(frozenPayload, "intent"), false);

  const tampered = signedV4EligibilityRequest();
  tampered.title = "簽章後竄改的 v4 標題";
  await expectAsyncCode(() => reviewer.review(tampered), "PUBLIC_LOUNGE_ELIGIBILITY_INVALID");

  const fixture = serviceFixture();
  await expectAsyncCode(
    () => fixture.service.issueEligibility(request),
    "PUBLIC_LOUNGE_ATTESTATION_VERSION_UNSUPPORTED",
  );
  assert.equal(fixture.gateway.attestationLedgerCalls.length, 0);
  assert.equal([...fixture.gateway.objects.keys()].some((path) => path.includes("/eligibility/issued/")), false);
});

test("trusted v5 Ed25519 attestation issues one bound ticket and legal publish succeeds", async () => {
  const fixture = serviceFixture();
  const proof = await fixture.service.issueEligibility(signedEligibilityRequest());
  assert.equal(proof.schemaVersion, PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION);
  const storedEligibility = [...fixture.gateway.objects.entries()]
    .find(([path]) => path.includes("/eligibility/issued/"))?.[1];
  assert.equal(storedEligibility?.schemaVersion, PUBLIC_LOUNGE_STORED_ELIGIBILITY_SCHEMA_VERSION);
  const result = await publish(fixture.service, validPublication({
    qualityScore: proof.qualityScore,
    qualityBreakdown: proof.qualityBreakdown,
    eligibilityTicket: proof.eligibilityTicket,
  }));
  assert.equal(result.post.quality.totalScore, 86);
  assert.equal(result.post.qualityAssurance, "private_ai_hub_verified");
  assert.equal(result.post.authorBylineStatus, "self_entered_unverified");
  assert.equal((await fixture.service.list()).items.length, 1);
  assert.equal((await fixture.service.get(result.post.publicId)).title, "《霧港歸航》");
  const serialized = JSON.stringify([...fixture.gateway.objects.values()]);
  const storedPost = [...fixture.gateway.objects.entries()]
    .find(([path]) => path.includes("/versions/"))?.[1].publicPost;
  const storedIndex = [...fixture.gateway.objects.entries()]
    .find(([path]) => path.includes("/index/"))?.[1];
  for (const stored of [storedPost, storedIndex]) {
    assert.equal(stored.storyLibrarySchemaVersion, "story-library-v1");
    assert.equal(stored.shelfId, "group-5");
    assert.equal(stored.primaryTopicId, "classic-topic-002");
    assert.deepEqual(stored.topicIds, ["classic-topic-002"]);
    assert.equal(Object.hasOwn(stored, "category"), false);
  }
  assert.equal(serialized.includes(result.managementToken), false);
  assert.equal(/projectId|privateCanon|systemPrompt|modelTrace|backup/u.test(serialized), false);
});

test("real server service completes signed eligibility publish read overwrite and retract without browser fixtures", async () => {
  const fixture = serviceFixture();
  const initial = await authorizedPublication(fixture);
  const published = await publish(fixture.service, initial);
  assert.equal((await fixture.service.list({ limit: 24 })).items[0].publicId, published.post.publicId);
  assert.equal((await fixture.service.get(published.post.publicId)).versionNumber, 1);
  const revision = await authorizedOverwritePublication(fixture, published.post.publicId, {
    title: "《霧港歸航・作者修訂版》",
    fullSynopsis: "作者重新撰寫的公開摘要。",
  });
  const overwritten = await fixture.service.overwrite(
    published.post.publicId,
    published.managementToken,
    revision,
  );
  assert.equal(overwritten.versionNumber, 2);
  assert.equal((await fixture.service.get(published.post.publicId)).title, "《霧港歸航・作者修訂版》");
  await fixture.service.retract(published.post.publicId, published.managementToken);
  await expectAsyncCode(() => fixture.service.get(published.post.publicId), "PUBLIC_LOUNGE_NOT_FOUND");
  assert.equal((await fixture.service.list({ limit: 24 })).items.length, 0);
});

test("v5 eligibility binds publish and overwrite intent to the exact current target", async () => {
  const fixture = serviceFixture();
  const published = await publish(fixture.service, await authorizedPublication(fixture));
  const publishOnly = await authorizedPublication(fixture, { title: "不得拿發布票覆寫" });
  await expectAsyncCode(
    () => fixture.service.overwrite(
      published.post.publicId,
      published.managementToken,
      publishOnly,
    ),
    "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
  );

  const currentOperation = await currentOverwriteOperation(fixture, published.post.publicId);
  const overwriteOnly = await authorizedPublication(
    fixture,
    { title: "不得拿覆寫票另建公開作品" },
    currentOperation,
  );
  await expectAsyncCode(
    () => publish(fixture.service, overwriteOnly),
    "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
  );

  await expectAsyncCode(
    () => fixture.service.issueEligibility(signedEligibilityRequest(
      { title: "錯誤目標作品" },
      {},
      {
        ...currentOperation,
        targetPublicationId: "novel_wrongtarget0001",
      },
    )),
    "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
  );

  await expectAsyncCode(
    () => fixture.service.issueEligibility(signedEligibilityRequest(
      { title: "錯誤既有版本 digest" },
      {},
      {
        ...currentOperation,
        expectedTargetPublicationDigest: "e".repeat(64),
      },
    )),
    "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
  );

  const firstAgainstV1 = await authorizedPublication(
    fixture,
    { title: "第一張 V1 覆寫票" },
    currentOperation,
  );
  const staleAgainstV1 = await authorizedPublication(
    fixture,
    { title: "第二張已過時的 V1 覆寫票" },
    currentOperation,
  );
  const version2 = await fixture.service.overwrite(
    published.post.publicId,
    published.managementToken,
    firstAgainstV1,
  );
  assert.equal(version2.versionNumber, 2);
  await expectAsyncCode(
    () => fixture.service.overwrite(
      published.post.publicId,
      published.managementToken,
      staleAgainstV1,
    ),
    "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
  );
  assert.equal((await fixture.service.get(published.post.publicId)).versionNumber, 2);
});

test("publish and overwrite expose only the current immutable PublishedVersion while retaining history", async () => {
  const fixture = serviceFixture();
  const published = await publish(fixture.service, await authorizedPublication(fixture));
  assert.equal(published.post.versionNumber, 1);
  assert.equal(published.post.versionPublishedAt, NOW);
  assert.match(published.post.versionId, /^version_[a-z0-9_-]{12,96}$/u);
  const pointerPath = `public-lounge-v1/posts/${published.post.publicId}.json`;
  const pointerV1 = structuredClone(fixture.gateway.objects.get(pointerPath));
  assert.equal(pointerV1.currentVersionId, published.post.versionId);
  assert.equal(pointerV1.currentVersionNumber, 1);
  assert.equal(pointerV1.mutationSequence, 1);
  assert.equal(Object.hasOwn(pointerV1, "publicPost"), false);
  const version1Path = publicLoungeVersionPath(published.post.publicId, published.post.versionId);
  const version1Snapshot = structuredClone(fixture.gateway.objects.get(version1Path));
  assert.equal(version1Snapshot.publicPost.title, "《霧港歸航》");

  const revision = await authorizedOverwritePublication(
    fixture,
    published.post.publicId,
    { title: "《霧港歸航・第二版》" },
  );
  const version2 = await fixture.service.overwrite(
    published.post.publicId,
    published.managementToken,
    revision,
  );
  assert.equal(version2.versionNumber, 2);
  assert.notEqual(version2.versionId, published.post.versionId);
  assert.deepEqual(fixture.gateway.objects.get(version1Path), version1Snapshot);
  assert.equal((await fixture.service.get(published.post.publicId)).versionId, version2.versionId);
  const summary = (await fixture.service.list()).items[0];
  assert.equal(summary.versionId, version2.versionId);
  assert.equal(summary.versionNumber, 2);
  assert.equal(summary.versionPublishedAt, NOW);
  const versionPaths = [...fixture.gateway.objects.keys()].filter((path) => path.includes("/versions/"));
  assert.equal(versionPaths.length, 2);
  assert.equal(fixture.gateway.objects.get(pointerPath).currentVersionId, version2.versionId);
  const overwriteClaim = fixture.gateway.objects.get(
    `public-lounge-v1/mutations/claims/${published.post.publicId}/2.json`,
  );
  assert.equal(overwriteClaim.targetPointer.currentVersionId, version2.versionId);
  assert.equal(Object.hasOwn(overwriteClaim, "targetVersion"), false);
  assert.equal(JSON.stringify(overwriteClaim).includes(version2.publicChapters[0].body), false);

  await fixture.service.retract(published.post.publicId, published.managementToken);
  await expectAsyncCode(() => fixture.service.get(published.post.publicId), "PUBLIC_LOUNGE_NOT_FOUND");
  assert.equal((await fixture.service.list()).items.length, 0);
  assert.equal([...fixture.gateway.objects.keys()].filter((path) => path.includes("/versions/")).length, 2);
  const stableAnchor = fixture.gateway.objects.get(pointerPath);
  assert.equal(stableAnchor.state, "retracted");
  assert.equal(stableAnchor.mutationSequence, 3);
  const retractClaim = fixture.gateway.objects.get(
    `public-lounge-v1/mutations/claims/${published.post.publicId}/3.json`,
  );
  assert.equal(retractClaim.targetTombstone.state, "retracted");
});

test("one immutable claim wins concurrent overwrites without pointer index divergence", async () => {
  const gateway = new BarrierMutationClaimGateway();
  const fixture = serviceFixture(gateway);
  const peer = serviceFixture(gateway);
  const published = await publish(fixture.service, await authorizedPublication(fixture));
  const firstRevision = await authorizedOverwritePublication(
    fixture,
    published.post.publicId,
    { title: "第一個並行修訂" },
  );
  const secondRevision = await authorizedOverwritePublication(
    peer,
    published.post.publicId,
    { title: "第二個並行修訂" },
  );

  const settled = await Promise.allSettled([
    fixture.service.overwrite(
      published.post.publicId,
      published.managementToken,
      firstRevision,
    ),
    peer.service.overwrite(
      published.post.publicId,
      published.managementToken,
      secondRevision,
    ),
  ]);
  const fulfilled = settled.filter((result) => result.status === "fulfilled");
  const rejected = settled.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason?.code, "PUBLIC_LOUNGE_MUTATION_BUSY");
  assert.equal(rejected[0].reason?.status, 409);
  const version2 = fulfilled[0].value;

  const pointerPath = `public-lounge-v1/posts/${published.post.publicId}.json`;
  const indexPath = `public-lounge-v1/index/${published.post.publicId}.json`;
  assert.equal(version2.versionNumber, 2);
  assert.equal((await fixture.service.get(published.post.publicId)).versionId, version2.versionId);
  assert.equal((await fixture.service.list()).items[0].versionId, version2.versionId);
  assert.equal(gateway.objects.get(pointerPath).currentVersionId, version2.versionId);
  assert.equal(gateway.objects.get(indexPath).versionId, published.post.versionId);
  assert.equal([...gateway.objects.keys()].filter((path) => path.includes("/mutations/claims/")).length, 1);
  assert.equal([...gateway.rateBuckets.keys()].filter((key) => key.startsWith("work_mutation:")).length, 1);
  assert.equal(
    [...gateway.objects.keys()].filter((path) => path.includes(`/versions/${published.post.publicId}/`)).length,
    3,
  );

  // Claims are never deleted, so the next request advances without a stale lock.
  const version3 = await peer.service.overwrite(
    published.post.publicId,
    published.managementToken,
    await authorizedOverwritePublication(peer, published.post.publicId, { title: "第三個後續修訂" }),
  );
  assert.equal(version3.versionNumber, 3);
  assert.equal((await peer.service.get(published.post.publicId)).versionId, version3.versionId);
  assert.equal((await peer.service.list()).items[0].versionId, version3.versionId);
  assert.equal([...gateway.objects.keys()].filter((path) => path.includes("/mutations/claims/")).length, 2);
  assert.equal(
    [...gateway.objects.keys()].filter((path) => path.includes(`/versions/${published.post.publicId}/`)).length,
    4,
  );
});

test("an out-of-order checkpoint can regress without hiding a later committed claim", async () => {
  class ReorderedCheckpointGateway extends MemoryLoungeGateway {
    constructor() {
      super();
      this.firstCheckpointArrived = new Promise((resolve) => { this.resolveFirstCheckpoint = resolve; });
      this.releaseFirstCheckpoint = new Promise((resolve) => { this.resolveRelease = resolve; });
      this.delayed = false;
    }
    release() { this.resolveRelease(); }
    async writeJson(path, value, options) {
      if (
        !this.delayed
        && options.upsert
        && path.includes("/posts/")
        && value?.state === "active"
        && value?.mutationSequence === 2
      ) {
        this.delayed = true;
        this.resolveFirstCheckpoint();
        await this.releaseFirstCheckpoint;
      }
      return super.writeJson(path, value, options);
    }
  }

  const gateway = new ReorderedCheckpointGateway();
  const fixture = serviceFixture(gateway);
  const peer = serviceFixture(gateway);
  const published = await publish(fixture.service, await authorizedPublication(fixture));
  const first = fixture.service.overwrite(
    published.post.publicId,
    published.managementToken,
    await authorizedOverwritePublication(
      fixture,
      published.post.publicId,
      { title: "先提交但晚寫 checkpoint" },
    ),
  );
  await gateway.firstCheckpointArrived;
  const second = await peer.service.overwrite(
    published.post.publicId,
    published.managementToken,
    await authorizedOverwritePublication(
      peer,
      published.post.publicId,
      { title: "後提交但先寫 checkpoint" },
    ),
  );
  gateway.release();
  await first;

  const regressed = gateway.objects.get(`public-lounge-v1/posts/${published.post.publicId}.json`);
  assert.equal(regressed.mutationSequence, 2);
  assert.equal(second.versionNumber, 3);
  assert.equal((await fixture.service.get(published.post.publicId)).versionId, second.versionId);
  assert.equal((await fixture.service.list()).items[0].versionId, second.versionId);
});

test("retract wins an overwrite race atomically and the stale body cannot resurrect the work", async () => {
  const gateway = new BarrierMutationClaimGateway();
  const fixture = serviceFixture(gateway);
  const peer = serviceFixture(gateway);
  const published = await publish(fixture.service, await authorizedPublication(fixture));
  const staleRevision = await authorizedOverwritePublication(
    peer,
    published.post.publicId,
    { title: "不得復活的修訂" },
  );

  const staleOverwrite = peer.service.overwrite(
    published.post.publicId,
    published.managementToken,
    staleRevision,
  );
  await gateway.firstClaimArrived;
  const retracting = fixture.service.retract(published.post.publicId, published.managementToken);
  await expectAsyncCode(
    () => staleOverwrite,
    "PUBLIC_LOUNGE_MUTATION_BUSY",
  );
  await retracting;

  const pointerPath = `public-lounge-v1/posts/${published.post.publicId}.json`;
  assert.equal(gateway.objects.get(pointerPath).state, "retracted");
  assert.equal(gateway.objects.has(`public-lounge-v1/index/${published.post.publicId}.json`), false);
  const claim = gateway.objects.get(`public-lounge-v1/mutations/claims/${published.post.publicId}/2.json`);
  assert.equal(claim.operation, "retract");
  assert.equal(
    [...gateway.objects.keys()].filter((path) => path.includes(`/versions/${published.post.publicId}/`)).length,
    2,
  );
  await expectAsyncCode(() => fixture.service.get(published.post.publicId), "PUBLIC_LOUNGE_NOT_FOUND");
  await expectAsyncCode(
    () => peer.service.overwrite(
      published.post.publicId,
      published.managementToken,
      staleRevision,
    ),
    "PUBLIC_LOUNGE_NOT_FOUND",
  );
});

test("durable per-work mutation slots cap sequential serverless abuse without relying on process memory", async () => {
  const gateway = new MemoryLoungeGateway();
  const fixture = serviceFixture(gateway);
  const peer = serviceFixture(gateway);
  const published = await publish(fixture.service, await authorizedPublication(fixture));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const actor = attempt % 2 === 0 ? fixture : peer;
    await actor.service.overwrite(
      published.post.publicId,
      published.managementToken,
      await authorizedOverwritePublication(
        actor,
        published.post.publicId,
        { title: `耐久限流修訂 ${attempt + 1}` },
      ),
    );
  }
  await expectAsyncCode(
    async () => peer.service.overwrite(
      published.post.publicId,
      published.managementToken,
      await authorizedOverwritePublication(peer, published.post.publicId, { title: "第七次應被限流" }),
    ),
    "PUBLIC_LOUNGE_MUTATION_RATE_LIMITED",
  );
  assert.equal(
    [...gateway.rateBuckets.keys()].filter((key) => key.startsWith("work_mutation:")).length,
    1,
  );
  assert.equal(
    [...gateway.objects.keys()].filter((path) => path.includes("/mutations/claims/")).length,
    6,
  );
  assert.equal((await fixture.service.get(published.post.publicId)).versionNumber, 7);
});

test("durable request slots are shared by serverless instances for every public route scope", async () => {
  for (const scope of ["read", "eligibility", "publish", "management"]) {
    const gateway = new MemoryLoungeGateway();
    const first = serviceFixture(gateway);
    const second = serviceFixture(gateway);
    const limit = scope === "read" ? 30 : 6;
    const identity = hash("203.0.113.77");
    for (let attempt = 0; attempt < limit; attempt += 1) {
      await (attempt % 2 === 0 ? first : second).service.reserveRequest(
        identity,
        scope,
      );
    }
    await expectAsyncCode(
      () => second.service.reserveRequest(identity, scope),
      "PUBLIC_LOUNGE_RATE_LIMITED",
    );
    assert.equal(
      [...gateway.rateBuckets.keys()].filter((key) => key.startsWith(`${scope}:`)).length,
      1,
    );
  }
});

test("expired database quota buckets are removed by bounded TTL cleanup", async () => {
  const gateway = new MemoryLoungeGateway();
  for (let index = 0; index < 80; index += 1) {
    gateway.rateBuckets.set(`expired:${index}`, {
      count: 1,
      expiresAt: Date.parse("2026-08-29T02:59:00.000Z"),
    });
  }
  gateway.rateBuckets.set("future", {
    count: 1,
    expiresAt: Date.parse("2026-08-29T03:02:00.000Z"),
  });
  await gateway.reserveRate({
    identityHash: hash("ttl-cleanup-client"),
    scope: "read",
    now: NOW,
  });
  assert.equal([...gateway.rateBuckets.keys()].filter((key) => key.startsWith("expired:")).length, 16);
  assert.equal(gateway.rateBuckets.has("future"), true);
});

test("invalid management tokens do not amplify reads across immutable history", async () => {
  const gateway = new MemoryLoungeGateway();
  const fixture = serviceFixture(gateway);
  const published = await publish(fixture.service, await authorizedPublication(fixture));
  await fixture.service.overwrite(
    published.post.publicId,
    published.managementToken,
    await authorizedOverwritePublication(fixture, published.post.publicId, { title: "歷史修訂一" }),
  );
  await fixture.service.overwrite(
    published.post.publicId,
    published.managementToken,
    await authorizedOverwritePublication(fixture, published.post.publicId, { title: "歷史修訂二" }),
  );

  gateway.readPaths = [];
  await expectAsyncCode(
    () => fixture.service.overwrite(published.post.publicId, "invalid-token", {}),
    "PUBLIC_LOUNGE_MANAGEMENT_TOKEN_INVALID",
  );
  assert.deepEqual(gateway.readPaths, [`public-lounge-v1/posts/${published.post.publicId}.json`]);
});

test("catalog list replays compact claims without downloading immutable chapter bodies", async () => {
  const gateway = new MemoryLoungeGateway();
  const fixture = serviceFixture(gateway);
  const published = await publish(fixture.service, await authorizedPublication(fixture));
  const updated = await fixture.service.overwrite(
    published.post.publicId,
    published.managementToken,
    await authorizedOverwritePublication(fixture, published.post.publicId, { title: "清單摘要修訂" }),
  );

  gateway.readPaths = [];
  const page = await fixture.service.list();
  assert.equal(page.items[0].versionId, updated.versionId);
  assert.equal(gateway.readPaths.some((path) => path.includes("/versions/")), false);
  assert.equal(gateway.readPaths.some((path) => path.includes("/mutations/claims/")), true);
});

test("public reads hide weak legacy reviews and strong records without a bound hard gate", async () => {
  const gateway = new MemoryLoungeGateway();
  const fixture = serviceFixture(gateway);
  const weak = seedSummary(gateway, 801, {
    qualityAssurance: "author_device_closed_ai_unverified",
  });
  const unbound = seedSummary(gateway, 802);
  const unboundPath = `public-lounge-v1/posts/${unbound.publicId}.json`;
  delete gateway.objects.get(unboundPath).publicContentGate;
  const strong = seedSummary(gateway, 803);

  const page = await fixture.service.list();
  assert.deepEqual(page.items.map((item) => item.publicId), [strong.publicId]);
  await expectAsyncCode(() => fixture.service.get(weak.publicId), "PUBLIC_LOUNGE_NOT_FOUND");
  await expectAsyncCode(() => fixture.service.get(unbound.publicId), "PUBLIC_LOUNGE_NOT_FOUND");
  assert.equal((await fixture.service.get(strong.publicId)).publicId, strong.publicId);
});

test("a legacy v2 post cannot mint a v5 overwrite ticket and remains unchanged", async () => {
  const fixture = serviceFixture();
  const publicId = "novel_legacyversion001";
  const managementToken = "legacy-management-token";
  const currentPost = buildPublicLoungePost(validPublication({ title: "舊版正文" }), {
    publicId,
    publishedAt: NOW,
    versionId: "version_temporarylegacy001",
    versionNumber: 1,
    versionPublishedAt: NOW,
    qualityAssurance: "private_ai_hub_verified",
  });
  const priorPost = structuredClone(currentPost);
  priorPost.schemaVersion = PUBLIC_LOUNGE_PRIOR_POST_SCHEMA_VERSION;
  delete priorPost.versionId;
  delete priorPost.versionNumber;
  delete priorPost.versionPublishedAt;
  const priorIndex = structuredClone(publicLoungePostToSummary(currentPost));
  priorIndex.schemaVersion = PUBLIC_LOUNGE_PRIOR_INDEX_ENTRY_SCHEMA_VERSION;
  delete priorIndex.versionId;
  delete priorIndex.versionNumber;
  delete priorIndex.versionPublishedAt;
  fixture.gateway.objects.set(`public-lounge-v1/posts/${publicId}.json`, {
    schemaVersion: PUBLIC_LOUNGE_PRIOR_STORED_POST_SCHEMA_VERSION,
    state: "active",
    publicPost: priorPost,
    managementTokenHash: hash(managementToken),
    updatedAt: NOW,
  });
  fixture.gateway.objects.set(`public-lounge-v1/index/${publicId}.json`, priorIndex);

  const storedHead = structuredClone(fixture.gateway.objects.get(`public-lounge-v1/posts/${publicId}.json`));
  const storedIndex = structuredClone(fixture.gateway.objects.get(`public-lounge-v1/index/${publicId}.json`));
  await expectAsyncCode(
    () => fixture.service.issueEligibility(signedEligibilityRequest(
      { title: "新版正文" },
      {},
      {
        intent: "overwrite",
        targetPublicationId: publicId,
        expectedTargetVersionId: "version_temporarylegacy001",
        expectedTargetPublicationDigest: hash(stableStringify(priorPost)),
      },
    )),
    "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
  );
  assert.deepEqual(fixture.gateway.objects.get(`public-lounge-v1/posts/${publicId}.json`), storedHead);
  assert.deepEqual(fixture.gateway.objects.get(`public-lounge-v1/index/${publicId}.json`), storedIndex);
  assert.equal(
    [...fixture.gateway.objects.keys()].some((path) => path.includes(`/versions/${publicId}/`)),
    false,
  );
  assert.equal(fixture.gateway.attestationLedger.size, 0);
});

test("storage path allowlist accepts immutable versions and rejects traversal or malformed ids", () => {
  assert.equal(isPublicLoungeStorageObjectPath(
    "public-lounge-v1/versions/novel_0000000000000001/version_0000000000000001.json",
  ), true);
  assert.equal(isPublicLoungeStorageObjectPath(
    "public-lounge-v1/versions/novel_0000000000000001/../posts/novel_0000000000000001.json",
  ), false);
  assert.equal(isPublicLoungeStorageObjectPath(
    "public-lounge-v1/versions/novel_short/version_0000000000000001.json",
  ), false);
  assert.equal(isPublicLoungeStorageObjectPath(
    "public-lounge-v1/mutations/claims/novel_0000000000000001/2.json",
  ), true);
  assert.equal(isPublicLoungeStorageObjectPath(
    "public-lounge-v1/mutations/rate/novel_0000000000000001/29827260-5.json",
  ), true);
  assert.equal(isPublicLoungeStorageObjectPath(
    "public-lounge-v1/mutations/rate/novel_0000000000000001/29827260-6.json",
  ), false);
  assert.equal(isPublicLoungeStorageObjectPath(
    "public-lounge-v1/mutations/claims/../novel_0000000000000001/2.json",
  ), false);
  assert.equal(isPublicLoungeStorageObjectPath(
    "public-lounge-v1/mutations/claims/novel_0000000000000001/0.json",
  ), false);
  assert.equal(isPublicLoungeStorageObjectPath(
    "public-lounge-v1/mutations/claims/novel_0000000000000001/10001.json",
  ), false);
  assert.equal(isPublicLoungeImmutableStorageObjectPath(
    "public-lounge-v1/versions/novel_0000000000000001/version_0000000000000001.json",
  ), true);
  assert.equal(isPublicLoungeImmutableStorageObjectPath(
    "public-lounge-v1/mutations/claims/novel_0000000000000001/2.json",
  ), true);
  assert.equal(isPublicLoungeImmutableStorageObjectPath(
    "public-lounge-v1/mutations/rate/novel_0000000000000001/29827260-5.json",
  ), true);
  assert.equal(isPublicLoungeImmutableStorageObjectPath(
    `public-lounge-v1/publish/idempotency/${"a".repeat(64)}.json`,
  ), true);
  assert.equal(isPublicLoungeImmutableStorageObjectPath(
    `public-lounge-v1/publish/idempotency/${"a".repeat(63)}g.json`,
  ), false);
  assert.equal(isPublicLoungeImmutableStorageObjectPath(
    `public-lounge-v1/mutations/abuse/publish/${"b".repeat(64)}/29827260-5.json`,
  ), true);
  assert.equal(isPublicLoungeImmutableStorageObjectPath(
    `public-lounge-v1/mutations/abuse/read/${"b".repeat(64)}/29827260-5.json`,
  ), true);
  assert.equal(isPublicLoungeImmutableStorageObjectPath(
    `public-lounge-v1/mutations/abuse/read/${"b".repeat(64)}/29827260-30.json`,
  ), false);
  assert.equal(isPublicLoungeImmutableStorageObjectPath(
    "public-lounge-v1/posts/novel_0000000000000001.json",
  ), false);
});

test("a caller-recomputed 100-point author-device digest cannot mint public eligibility", async () => {
  const fixture = serviceFixture();
  const request = await authorDeviceEligibilityRequest();
  request.authorDeviceReview = await buildAuthorDeviceReviewDeclaration({
    issuedAt: NOW,
    nonce: "attacker-recomputed-000001",
    completionFingerprint: COMPLETION_FINGERPRINT,
    backendId: "browser-ai",
    modelId: "caller-controlled-model",
    modelDigest: MODEL_DIGEST,
    fullCoverage: true,
    hardGatePassed: true,
    compliancePassed: true,
    criticalDimensionsPassed: true,
    qualityScore: 100,
    dimensionScores: qualityBreakdown(100),
  });
  await expectAsyncCode(
    () => fixture.service.issueEligibility(request),
    "PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED",
  );
  assert.equal([...fixture.gateway.objects.keys()].some((path) => path.includes("/eligibility/issued/")), false);
  assert.equal([...fixture.gateway.objects.keys()].some((path) => path.includes("/author-device/")), false);
});

test("eligibility request is an exact exclusive union and every device-shaped payload fails closed", async () => {
  const fixture = serviceFixture();
  const authorRequest = await authorDeviceEligibilityRequest();
  const serverRequest = signedEligibilityRequest();
  await expectAsyncCode(() => fixture.service.issueEligibility({
    ...authorRequest,
    serverAttestation: serverRequest.serverAttestation,
    trustedServerReviewConsent: true,
  }), "PUBLIC_LOUNGE_PAYLOAD_INVALID");
  const neither = structuredClone(authorRequest);
  delete neither.authorDeviceReview;
  delete neither.authorDeviceReviewConsent;
  await expectAsyncCode(
    () => fixture.service.issueEligibility(neither),
    "PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED",
  );
  const privateField = structuredClone(authorRequest);
  privateField.authorDeviceReview.projectId = "must-not-leave-device";
  await expectAsyncCode(
    () => fixture.service.issueEligibility(privateField),
    "PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED",
  );
  const forgedScore = structuredClone(authorRequest);
  forgedScore.authorDeviceReview.qualityScore = 100;
  await expectAsyncCode(
    () => fixture.service.issueEligibility(forgedScore),
    "PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED",
  );
});

test("fresh author-device nonces remain local-only and are never consumed as public trust", async () => {
  const fixture = serviceFixture();
  const request = await authorDeviceEligibilityRequest();
  await expectAsyncCode(
    () => fixture.service.issueEligibility(request),
    "PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED",
  );
  const freshRequest = await authorDeviceEligibilityRequest();
  await expectAsyncCode(
    () => fixture.service.issueEligibility(freshRequest),
    "PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED",
  );
  assert.equal([...fixture.gateway.objects.keys()].some((path) => path.includes("/author-device/")), false);
});

test("device review never qualifies publicly while trusted review enforces the content hard gate", async () => {
  const authorFixture = serviceFixture();
  const authorRequest = await authorDeviceEligibilityRequest();
  authorRequest.publicChapters[0].body = "NEXT TURN：請選擇 A/B/C";
  await expectAsyncCode(
    () => authorFixture.service.issueEligibility(authorRequest),
    "PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED",
  );
  const serverFixture = serviceFixture();
  await expectAsyncCode(
    () => serverFixture.service.issueEligibility(signedEligibilityRequest({
      publicChapters: [
        { chapterNumber: 1, title: "候選草稿", body: "NEXT TURN：請選擇 A/B/C", official: true },
      ],
    })),
    "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
  );
});

test("all legacy v2 tickets fail closed, including unexpired strong-labelled tickets", async () => {
  for (const legacy of [
    {
      tokenCharacter: "W",
      backendId: "browser-ai",
      modelId: "legacy-device-review",
      qualityAssurance: "author_device_closed_ai_unverified",
    },
    {
      tokenCharacter: "S",
      backendId: "private-ai-hub",
      modelId: "legacy-strong-private-review",
      qualityAssurance: "private_ai_hub_verified",
    },
  ]) {
    const fixture = serviceFixture();
    const eligibilityTicket = legacy.tokenCharacter.repeat(43);
    const publication = validPublication({ eligibilityTicket });
    const validated = validatePublicLoungePublicationInput(publication);
    const { eligibilityTicket: ignoredTicket, ...boundPublication } = validated;
    void ignoredTicket;
    const ticketHash = hash(eligibilityTicket);
    fixture.gateway.objects.set(`public-lounge-v1/eligibility/issued/${ticketHash}.json`, {
      schemaVersion: "public-lounge-stored-eligibility-v2",
      state: "issued",
      ticketHash,
      completionFingerprint: COMPLETION_FINGERPRINT,
      publicationDigest: hash(publicLoungeEligibilityBinding(boundPublication, COMPLETION_FINGERPRINT)),
      backendId: legacy.backendId,
      modelId: legacy.modelId,
      modelDigest: MODEL_DIGEST,
      qualityScore: 86,
      qualityBreakdown: qualityBreakdown(86),
      qualityAssurance: legacy.qualityAssurance,
      issuedAt: NOW,
      expiresAt: "2026-08-29T03:15:00.000Z",
    });
    await expectAsyncCode(
      () => publish(fixture.service, publication),
      "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
    );
    assert.equal([...fixture.gateway.objects.keys()].some((path) => path.includes("/eligibility/consumed/")), false);
    assert.equal([...fixture.gateway.objects.keys()].some((path) => path.includes("/posts/")), false);
  }
});

test("stored v4 eligibility tickets are rejected for both publish and overwrite", async () => {
  const publishFixture = serviceFixture();
  const v4Publish = await authorizedPublication(publishFixture, { title: "v4 票不得發布" });
  const v4PublishTicket = replaceStoredEligibilityWithV4(
    publishFixture,
    v4Publish.eligibilityTicket,
  );
  await expectAsyncCode(
    () => publish(publishFixture.service, v4Publish),
    "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
  );
  assert.equal((await publishFixture.service.list()).items.length, 0);
  assert.equal(
    publishFixture.gateway.objects.has(
      `public-lounge-v1/eligibility/consumed/${v4PublishTicket.ticketHash}.json`,
    ),
    false,
  );

  const overwriteFixture = serviceFixture();
  const published = await publish(
    overwriteFixture.service,
    await authorizedPublication(overwriteFixture),
  );
  const v4Overwrite = await authorizedOverwritePublication(
    overwriteFixture,
    published.post.publicId,
    { title: "v4 票不得覆寫" },
  );
  const v4OverwriteTicket = replaceStoredEligibilityWithV4(
    overwriteFixture,
    v4Overwrite.eligibilityTicket,
  );
  await expectAsyncCode(
    () => overwriteFixture.service.overwrite(
      published.post.publicId,
      published.managementToken,
      v4Overwrite,
    ),
    "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
  );
  assert.equal((await overwriteFixture.service.get(published.post.publicId)).versionNumber, 1);
  assert.equal(
    overwriteFixture.gateway.objects.has(
      `public-lounge-v1/eligibility/consumed/${v4OverwriteTicket.ticketHash}.json`,
    ),
    false,
  );
});

test("ticket replay and public-field tampering are rejected", async () => {
  const replayFixture = serviceFixture();
  const publication = await authorizedPublication(replayFixture);
  await publish(replayFixture.service, publication);
  await expectAsyncCode(() => publish(replayFixture.service, publication), "PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED");
  const tamperFixture = serviceFixture();
  const bound = await authorizedPublication(tamperFixture);
  await expectAsyncCode(() => publish(tamperFixture.service, { ...bound, title: "竄改後標題" }), "PUBLIC_LOUNGE_ELIGIBILITY_INVALID");
});

test("v5 attestation tampering is rejected before the nonce ledger is touched", async () => {
  const tamperFixture = serviceFixture();
  const request = signedEligibilityRequest();
  request.title = "簽章後竄改";
  await expectAsyncCode(() => tamperFixture.service.issueEligibility(request), "PUBLIC_LOUNGE_ELIGIBILITY_INVALID");
  assert.equal(tamperFixture.gateway.attestationLedgerCalls.length, 0);
  assert.equal(tamperFixture.gateway.attestationLedger.size, 0);
  assert.equal(
    [...tamperFixture.gateway.objects.keys()].some((path) => path.includes("/eligibility/issued/")),
    false,
  );
});

test("v5 work revision and validity-window mismatches fail before nonce consumption", async () => {
  const cases = [
    () => ({ ...signedEligibilityRequest(), workId: "work_other" }),
    () => ({ ...signedEligibilityRequest(), revisionId: "f".repeat(64) }),
    () => signedEligibilityRequest({}, {
      issuedAt: "2026-08-29T03:06:00.000Z",
      expiresAt: "2026-08-29T03:20:00.000Z",
    }),
    () => signedEligibilityRequest({}, {
      issuedAt: "2026-08-29T02:30:00.000Z",
      expiresAt: "2026-08-29T02:50:00.000Z",
    }),
  ];
  for (const build of cases) {
    const fixture = serviceFixture();
    await expectAsyncCode(
      () => fixture.service.issueEligibility(build()),
      "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
    );
    assert.equal(fixture.gateway.attestationLedgerCalls.length, 0);
    assert.equal([...fixture.gateway.objects.keys()].some((path) => path.includes("/eligibility/issued/")), false);
  }
});

test("the same valid v5 attestation can mint exactly one eligibility ticket", async () => {
  const replayFixture = serviceFixture();
  const replayRequest = signedEligibilityRequest();
  const first = await replayFixture.service.issueEligibility(replayRequest);
  await expectAsyncCode(
    () => replayFixture.service.issueEligibility(replayRequest),
    "PUBLIC_LOUNGE_ATTESTATION_REPLAYED",
  );
  assert.match(first.eligibilityTicket, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(replayFixture.gateway.attestationLedger.size, 1);
  assert.equal(replayFixture.gateway.attestationLedgerCalls.length, 2);
  assert.equal(
    [...replayFixture.gateway.objects.keys()].filter((path) => path.includes("/eligibility/issued/")).length,
    1,
  );
});

test("an eligibility ticket cannot cross verifier environment audience producer rubric or key domains", async () => {
  const gateway = new MemoryLoungeGateway();
  const preview = serviceFixture(gateway);
  const publication = await authorizedPublication(preview);
  const mismatches = [
    { environment: "production" },
    { audience: "another-public-lounge" },
    { producerVersion: "private-ai-hub-attestation-producer-v2" },
    { rubricVersion: "public-lounge-rubric-v2" },
    { keyId: "preview-attestation-key-other" },
  ];
  for (const mismatch of mismatches) {
    const otherDomain = serviceFixture(gateway, createEd25519PublicLoungeEligibilityReviewerV5({
      publicKeyPem,
      keyId: KEY_ID,
      environment: V5_ENVIRONMENT,
      audience: V5_AUDIENCE,
      producerVersion: V5_PRODUCER_VERSION,
      rubricVersion: PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION,
      now: () => NOW,
      ...mismatch,
    }));
    await expectAsyncCode(
      () => publish(otherDomain.service, publication),
      "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
    );
  }
  assert.equal([...gateway.objects.keys()].some((path) => path.includes("/posts/")), false);
});

test("concurrent serverless v5 issuance consumes one attestation exactly once", async () => {
  const gateway = new BarrierAttestationNonceGateway();
  const first = serviceFixture(gateway);
  const second = serviceFixture(gateway);
  const request = signedEligibilityRequest();
  const settled = await Promise.allSettled([
    first.service.issueEligibility(request),
    second.service.issueEligibility(request),
  ]);
  const fulfilled = settled.filter((result) => result.status === "fulfilled");
  const rejected = settled.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason?.code, "PUBLIC_LOUNGE_ATTESTATION_REPLAYED");
  assert.equal(gateway.attestationLedger.size, 1);
  assert.equal(gateway.attestationLedgerCalls.length, 2);
  assert.equal(
    [...gateway.objects.keys()].filter((path) => path.includes("/eligibility/issued/")).length,
    1,
  );
});

test("an ambiguous database response after nonce commit fails closed and burns the attestation", async () => {
  class CommitThenRejectAttestationLedgerGateway extends MemoryLoungeGateway {
    constructor() {
      super();
      this.rejectAfterCommit = true;
    }
    async consumeAttestationNonceV5(input) {
      const result = await super.consumeAttestationNonceV5(input);
      if (this.rejectAfterCommit && result === "consumed") {
        this.rejectAfterCommit = false;
        throw new Error("ATTESTATION_LEDGER_RESPONSE_LOST_AFTER_COMMIT");
      }
      return result;
    }
  }
  const gateway = new CommitThenRejectAttestationLedgerGateway();
  const fixture = serviceFixture(gateway);
  const request = signedEligibilityRequest();
  await expectAsyncCode(
    () => fixture.service.issueEligibility(request),
    "PUBLIC_LOUNGE_ATTESTATION_STATE_UNKNOWN",
  );
  assert.equal(gateway.attestationLedger.size, 1);
  assert.equal([...gateway.objects.keys()].some((path) => path.includes("/eligibility/issued/")), false);
  await expectAsyncCode(
    () => fixture.service.issueEligibility(request),
    "PUBLIC_LOUNGE_ATTESTATION_REPLAYED",
  );
  assert.equal([...gateway.objects.keys()].some((path) => path.includes("/eligibility/issued/")), false);
});

test("ticket storage failure after nonce consumption cannot mint a replacement from the same attestation", async () => {
  class RejectIssuedTicketStorageGateway extends MemoryLoungeGateway {
    constructor() {
      super();
      this.issuedWriteAttempts = 0;
    }
    async writeJson(path, value, options) {
      if (path.includes("/eligibility/issued/")) {
        this.issuedWriteAttempts += 1;
        throw new Error("ELIGIBILITY_STORAGE_UNAVAILABLE_AFTER_LEDGER_COMMIT");
      }
      return super.writeJson(path, value, options);
    }
  }
  const gateway = new RejectIssuedTicketStorageGateway();
  const fixture = serviceFixture(gateway);
  const request = signedEligibilityRequest();
  await expectAsyncCode(
    () => fixture.service.issueEligibility(request),
    "PUBLIC_LOUNGE_ATTESTATION_STATE_UNKNOWN",
  );
  assert.equal(gateway.attestationLedger.size, 1);
  assert.equal(gateway.issuedWriteAttempts, 1);
  assert.equal([...gateway.objects.keys()].some((path) => path.includes("/eligibility/issued/")), false);
  await expectAsyncCode(
    () => fixture.service.issueEligibility(request),
    "PUBLIC_LOUNGE_ATTESTATION_REPLAYED",
  );
  assert.equal(gateway.issuedWriteAttempts, 1);
});

test("signed server attestation hard gates are bound and critical scores are recomputed", async () => {
  for (const overrides of [
    { hardGatePassed: false },
    { compliancePassed: false },
    { criticalDimensionsPassed: false },
    { hiddenDraftResidueDetected: true },
  ]) {
    const fixture = serviceFixture();
    await expectAsyncCode(
      () => fixture.service.issueEligibility(signedEligibilityRequest({}, overrides)),
      "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
    );
  }

  const criticalBreakdown = qualityBreakdown(100);
  criticalBreakdown.plot_coherence = 59;
  const criticalFixture = serviceFixture();
  await expectAsyncCode(
    () => criticalFixture.service.issueEligibility(signedEligibilityRequest({}, {
      qualityScore: 92,
      qualityBreakdown: criticalBreakdown,
      hardGatePassed: true,
      compliancePassed: true,
      criticalDimensionsPassed: true,
      hiddenDraftResidueDetected: false,
    })),
    "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
  );

  const singleJudge = multiJudgeSummary(qualityBreakdown(), 12);
  singleJudge.primaryJudgeCount = 1;
  singleJudge.judges = singleJudge.judges.slice(0, 1);
  singleJudge.selectedJudgeRoles = ["literary-editor"];
  singleJudge.fullCoverageJudgeRoles = ["literary-editor"];
  await expectAsyncCode(
    () => serviceFixture().service.issueEligibility(signedEligibilityRequest({}, {
      multiJudgeSummary: singleJudge,
    })),
    "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
  );

  await expectAsyncCode(
    () => serviceFixture().service.issueEligibility(signedEligibilityRequest({}, {
      qualityScore: 90,
      qualityBreakdown: qualityBreakdown(90),
      multiJudgeSummary: multiJudgeSummary(qualityBreakdown(86), 12),
    })),
    "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
  );

  await expectAsyncCode(
    () => serviceFixture().service.issueEligibility(signedEligibilityRequest({}, {
      multiJudgeSummary: multiJudgeSummary(qualityBreakdown(86), 11),
    })),
    "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
  );

  const arbitratedSummary = {
    schemaVersion: PUBLIC_LOUNGE_MULTI_JUDGE_SUMMARY_SCHEMA_VERSION,
    primaryJudgeRoles: [...PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES],
    primaryJudgeCount: 3,
    judges: [
      attestedJudge("literary-editor", qualityBreakdown(70)),
      attestedJudge("continuity-editor", qualityBreakdown(86)),
      attestedJudge("genre-reader", qualityBreakdown(94)),
      attestedJudge("score-arbitrator", qualityBreakdown(88)),
    ],
    aggregationMethod: "per-dimension-median",
    primaryScoreSpread: 24,
    selectedJudgeRoles: ["score-arbitrator", "continuity-editor", "genre-reader"],
    arbitrationRequired: true,
    arbitrationPerformed: true,
    fullCoverageJudgeRoles: [...PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES, "score-arbitrator"],
    reviewedChapterCount: 12,
    reviewedChunkCount: 24,
  };
  const arbitrationProof = await serviceFixture().service.issueEligibility(signedEligibilityRequest({}, {
    qualityScore: 88,
    qualityBreakdown: qualityBreakdown(88),
    multiJudgeSummary: arbitratedSummary,
  }));
  assert.equal(arbitrationProof.qualityScore, 88);

  const legacyAttestationFixture = serviceFixture();
  const legacyAttestation = signedEligibilityRequest();
  legacyAttestation.serverAttestation.schemaVersion = "public-lounge-server-review-attestation-v2";
  await expectAsyncCode(
    () => legacyAttestationFixture.service.issueEligibility(legacyAttestation),
    "PUBLIC_LOUNGE_ATTESTATION_VERSION_UNSUPPORTED",
  );
});

test("missing trusted verifier is reported honestly and cannot issue eligibility", async () => {
  const fixture = serviceFixture(
    new MemoryLoungeGateway(),
    createEd25519PublicLoungeEligibilityReviewerV5({
      publicKeyPem: "",
      keyId: "",
      environment: V5_ENVIRONMENT,
      audience: V5_AUDIENCE,
      producerVersion: V5_PRODUCER_VERSION,
      rubricVersion: PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION,
      now: () => NOW,
    }),
  );
  const health = await fixture.service.health();
  assert.equal(health.trustedEligibilityVerifierConnected, false);
  assert.equal(health.trustedAttestationProducer, "private-ai-hub-v5-client-probe-required");
  await expectAsyncCode(
    () => fixture.service.issueEligibility(signedEligibilityRequest()),
    "PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED",
  );
});

test("publish returns token after commit without a fallible post-commit read", async () => {
  class RejectPostReadsGateway extends MemoryLoungeGateway {
    async readJson(path) {
      if (path.includes("/posts/")) throw new Error("POST_COMMIT_READ_FAILED");
      return super.readJson(path);
    }
  }
  const fixture = serviceFixture(new RejectPostReadsGateway());
  const result = await publish(fixture.service, await authorizedPublication(fixture));
  assert.match(result.managementToken, /^[A-Za-z0-9_-]{43}$/u);
});

test("publish response loss is resumable without a duplicate public work or token", async () => {
  class RejectCatalogAnchorGateway extends MemoryLoungeGateway {
    constructor() {
      super();
      this.failNextAnchor = true;
    }
    async upsertCatalogAnchor(candidate) {
      if (this.failNextAnchor) {
        this.failNextAnchor = false;
        throw new Error("CATALOG_ANCHOR_WRITE_FAILED");
      }
      return super.upsertCatalogAnchor(candidate);
    }
  }
  const fixture = serviceFixture(new RejectCatalogAnchorGateway());
  const publication = await authorizedPublication(fixture);
  const idempotencyKey = nextIdempotencyKey();
  await expectAsyncCode(
    () => publish(fixture.service, publication, idempotencyKey),
    "PUBLIC_LOUNGE_NOT_CONNECTED",
  );
  assert.equal([...fixture.gateway.objects.keys()].some((path) => path.includes("/posts/")), true);
  assert.equal(fixture.gateway.catalog.size, 0);
  const recovered = await publish(fixture.service, publication, idempotencyKey);
  assert.equal((await fixture.service.list()).items.length, 1);
  assert.equal((await fixture.service.get(recovered.post.publicId)).publicId, recovered.post.publicId);
  assert.equal([...fixture.gateway.objects.keys()].filter((path) => path.includes("/posts/")).length, 1);
  assert.equal([...fixture.gateway.objects.keys()].filter((path) => path.includes("/publish/idempotency/")).length, 1);
  assert.equal(fixture.gateway.catalog.size, 1);
});

test("publish response loss plus a fresh attestation ticket still converges on one public work", async () => {
  class RejectCatalogAnchorOnceGateway extends MemoryLoungeGateway {
    constructor() {
      super();
      this.failNextAnchor = true;
    }
    async upsertCatalogAnchor(candidate) {
      if (this.failNextAnchor) {
        this.failNextAnchor = false;
        throw new Error("CATALOG_ANCHOR_RESPONSE_LOST_AFTER_STORAGE_COMMIT");
      }
      return super.upsertCatalogAnchor(candidate);
    }
  }
  const fixture = serviceFixture(new RejectCatalogAnchorOnceGateway());
  const firstPublication = await authorizedPublication(fixture);
  const firstIdempotencyKey = "L".repeat(32);
  await expectAsyncCode(
    () => publish(fixture.service, firstPublication, firstIdempotencyKey),
    "PUBLIC_LOUNGE_NOT_CONNECTED",
  );
  assert.equal([...fixture.gateway.objects.keys()].filter((path) => path.includes("/posts/")).length, 1);
  assert.equal(fixture.gateway.catalog.size, 0);

  const freshPublication = await authorizedPublication(fixture);
  assert.notEqual(freshPublication.eligibilityTicket, firstPublication.eligibilityTicket);
  const recovered = await publish(fixture.service, freshPublication, "N".repeat(32));
  const originalRetry = await publish(fixture.service, firstPublication, firstIdempotencyKey);

  assert.equal(originalRetry.post.publicId, recovered.post.publicId);
  assert.equal(originalRetry.post.versionId, recovered.post.versionId);
  assert.equal(originalRetry.managementToken, recovered.managementToken);
  assert.equal((await fixture.service.list()).items.length, 1);
  assert.equal([...fixture.gateway.objects.keys()].filter((path) => path.includes("/posts/")).length, 1);
  assert.equal([...fixture.gateway.objects.keys()].filter((path) => path.includes("/versions/")).length, 1);
  assert.equal([...fixture.gateway.objects.keys()].filter((path) => path.includes("/index/")).length, 1);
  assert.equal([...fixture.gateway.objects.keys()].filter((path) => path.includes("/publish/idempotency/")).length, 1);
  assert.equal([...fixture.gateway.objects.keys()].filter((path) => path.includes("/eligibility/consumed/")).length, 2);
  assert.equal(fixture.gateway.attestationLedger.size, 2);
  assert.equal(fixture.gateway.catalog.size, 1);
});

test("concurrent serverless publish claims cannot spend one eligibility twice", async () => {
  const gateway = new BarrierEligibilityConsumptionGateway();
  const first = serviceFixture(gateway);
  const second = serviceFixture(gateway);
  const publication = await authorizedPublication(first);
  const settled = await Promise.allSettled([
    publish(first.service, publication, "A".repeat(32)),
    publish(second.service, publication, "B".repeat(32)),
  ]);
  const fulfilled = settled.filter((result) => result.status === "fulfilled");
  const rejected = settled.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason?.code, "PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED");
  assert.equal([...gateway.objects.keys()].filter((path) => path.includes("/posts/")).length, 1);
  assert.equal([...gateway.objects.keys()].filter((path) => path.includes("/index/")).length, 1);
  assert.equal([...gateway.objects.keys()].filter((path) => path.includes("/eligibility/consumed/")).length, 1);
});

test("the same publish idempotency key recovers the same public id and management token", async () => {
  const gateway = new MemoryLoungeGateway();
  const first = serviceFixture(gateway);
  const second = serviceFixture(gateway);
  const publication = await authorizedPublication(first);
  const idempotencyKey = "R".repeat(32);
  const initial = await publish(first.service, publication, idempotencyKey);
  const replay = await publish(second.service, publication, idempotencyKey);
  assert.equal(replay.post.publicId, initial.post.publicId);
  assert.equal(replay.post.versionId, initial.post.versionId);
  assert.equal(replay.managementToken, initial.managementToken);
  assert.equal([...gateway.objects.keys()].filter((path) => path.includes("/posts/")).length, 1);
  assert.equal([...gateway.objects.keys()].filter((path) => path.includes("/publish/idempotency/")).length, 1);
});

test("management token gates mutations and retract removes its catalog anchor", async () => {
  const fixture = serviceFixture();
  const published = await publish(fixture.service, await authorizedPublication(fixture));
  await expectAsyncCode(
    () => fixture.service.overwrite(published.post.publicId, "B".repeat(43), validPublication()),
    "PUBLIC_LOUNGE_MANAGEMENT_TOKEN_INVALID",
  );
  const revision = await authorizedOverwritePublication(
    fixture,
    published.post.publicId,
    { title: "霧港歸航・修訂版" },
  );
  const overwritten = await fixture.service.overwrite(published.post.publicId, published.managementToken, revision);
  assert.equal(overwritten.title, "霧港歸航・修訂版");
  await fixture.service.retract(published.post.publicId, published.managementToken);
  await fixture.service.retract(published.post.publicId, published.managementToken);
  assert.equal((await fixture.service.list()).items.length, 0);
  assert.equal(
    fixture.gateway.objects.has(`public-lounge-v1/index/${published.post.publicId}.json`),
    false,
  );
  assert.equal(fixture.gateway.catalog.get(published.post.publicId)?.active, false);
  assert.equal(
    [...fixture.gateway.objects.keys()].filter((path) => path.includes("/mutations/claims/")).length,
    2,
  );
});

test("an ambiguous claim response is accepted only when the immutable receipt exactly matches", async () => {
  class CommitThenRejectClaimGateway extends MemoryLoungeGateway {
    constructor() {
      super();
      this.armed = false;
    }
    arm() { this.armed = true; }
    async writeJson(path, value, options) {
      if (this.armed && path.includes("/mutations/claims/") && value?.operation === "overwrite") {
        this.armed = false;
        await super.writeJson(path, value, options);
        throw new Error("CLAIM_WRITE_RESPONSE_LOST_AFTER_COMMIT");
      }
      return super.writeJson(path, value, options);
    }
  }
  const gateway = new CommitThenRejectClaimGateway();
  const fixture = serviceFixture(gateway);
  const published = await publish(fixture.service, await authorizedPublication(fixture));
  const postPath = [...gateway.objects.keys()].find((path) => path.includes("/posts/"));
  const indexPath = [...gateway.objects.keys()].find((path) => path.includes("/index/"));
  const oldPost = structuredClone(gateway.objects.get(postPath));
  const oldIndex = structuredClone(gateway.objects.get(indexPath));
  const newTitle = "霧港歸航・已提交修訂";
  const revision = await authorizedOverwritePublication(fixture, published.post.publicId, { title: newTitle });
  gateway.arm();

  const updated = await fixture.service.overwrite(
    published.post.publicId,
    published.managementToken,
    revision,
  );

  assert.notDeepEqual(gateway.objects.get(postPath), oldPost);
  assert.equal(gateway.objects.get(postPath).currentVersionId, updated.versionId);
  assert.deepEqual(gateway.objects.get(indexPath), oldIndex);
  assert.equal((await fixture.service.get(published.post.publicId)).versionId, updated.versionId);
  assert.equal((await fixture.service.list()).items[0].title, newTitle);
  assert.equal([...gateway.objects.keys()].filter((path) => path.includes("/mutations/claims/")).length, 1);
});

test("a failed claim create leaves its immutable version orphaned but cannot expose or corrupt the work", async () => {
  class RejectFirstClaimGateway extends MemoryLoungeGateway {
    constructor() {
      super();
      this.rejectNextClaim = false;
    }
    arm() { this.rejectNextClaim = true; }
    async writeJson(path, value, options) {
      if (this.rejectNextClaim && path.includes("/mutations/claims/")) {
        this.rejectNextClaim = false;
        throw new Error("CLAIM_CREATE_FAILED_BEFORE_COMMIT");
      }
      return super.writeJson(path, value, options);
    }
  }
  const gateway = new RejectFirstClaimGateway();
  const fixture = serviceFixture(gateway);
  const published = await publish(fixture.service, await authorizedPublication(fixture));
  const newTitle = "霧港歸航・不可曝光修訂";
  const revision = await authorizedOverwritePublication(fixture, published.post.publicId, { title: newTitle });
  gateway.arm();

  await expectAsyncCode(
    () => fixture.service.overwrite(published.post.publicId, published.managementToken, revision),
    "PUBLIC_LOUNGE_NOT_CONNECTED",
  );

  assert.equal((await fixture.service.get(published.post.publicId)).title, published.post.title);
  assert.equal((await fixture.service.list()).items[0].title, published.post.title);
  assert.equal([...gateway.objects.keys()].filter((path) => path.includes("/mutations/claims/")).length, 0);
  assert.equal(
    [...gateway.objects.keys()].filter((path) => path.includes(`/versions/${published.post.publicId}/`)).length,
    2,
  );
  const recovered = await fixture.service.overwrite(
    published.post.publicId,
    published.managementToken,
    await authorizedOverwritePublication(
      fixture,
      published.post.publicId,
      { title: "霧港歸航・安全重試" },
    ),
  );
  assert.equal(recovered.versionNumber, 2);
  assert.equal((await fixture.service.list()).items[0].title, "霧港歸航・安全重試");
  assert.equal([...gateway.objects.keys()].filter((path) => path.includes("/mutations/claims/")).length, 1);
});

test("250 works are cursor-pageable searchable and read with concurrency at most 8", async () => {
  const gateway = new MemoryLoungeGateway();
  gateway.readDelayMs = 1;
  for (let index = 1; index <= 250; index += 1) {
    seedSummary(gateway, index, {
      title: index === 249 ? "唯一深海搜尋命中" : undefined,
      topicIds: index === 250 ? ["classic-topic-001"] : undefined,
      publishedAt: "2026-08-29T03:00:00.000Z",
    });
  }
  const fixture = serviceFixture(gateway);
  const found = [];
  let cursor;
  do {
    const page = await fixture.service.list({ limit: 48, cursor });
    found.push(...page.items.map((item) => item.publicId));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(found.length, 250);
  assert.equal(new Set(found).size, 250);
  assert.deepEqual(found, [...found].sort().reverse());
  assert.equal(gateway.listOffsets.length, 0, "catalog pagination must never list Storage objects");
  assert.ok(gateway.catalogCalls.every((call) => call.limit <= 48));
  assert.ok(gateway.maxActiveReads > 1 && gateway.maxActiveReads <= 8);
  const searched = await fixture.service.list({ search: "唯一深海搜尋命中" });
  assert.equal(searched.totalCount, 1);
  const shelfPage = await fixture.service.list({ shelfId: "group-7" });
  assert.equal(shelfPage.totalCount, 1);
  assert.deepEqual(shelfPage.shelves.map((shelf) => shelf.shelfId), [
    "group-1", "group-2", "group-3", "group-4", "group-5", "group-6", "group-7", "group-8",
  ]);
});

test("cursor is query-bound and malformed cursor or invalid limit fails safely", async () => {
  const fixture = serviceFixture();
  for (let index = 1; index <= 30; index += 1) seedSummary(fixture.gateway, index);
  const first = await fixture.service.list({ search: "公開小說", limit: 10 });
  assert.ok(first.nextCursor);
  await expectAsyncCode(
    () => fixture.service.list({ search: "不同搜尋", limit: 10, cursor: first.nextCursor }),
    "PUBLIC_LOUNGE_CURSOR_INVALID",
  );
  await expectAsyncCode(() => fixture.service.list({ cursor: "not-json" }), "PUBLIC_LOUNGE_CURSOR_INVALID");
  await expectAsyncCode(() => fixture.service.list({ limit: 49 }), "PUBLIC_LOUNGE_CURSOR_INVALID");
});

test("limit one reads one DB candidate and a 5001st anchor never blacks out the catalog", async () => {
  const gateway = new MemoryLoungeGateway();
  const publishedAt = "2026-08-29T03:00:00.000Z";
  for (let index = 1; index <= 5_000; index += 1) {
    const publicId = `novel_${String(index).padStart(16, "0")}`;
    gateway.catalog.set(publicId, { publicId, publishedAt, active: true });
  }
  const expected = seedSummary(gateway, 5_001, { publishedAt });
  const fixture = serviceFixture(gateway);
  const page = await fixture.service.list({ limit: 1 });
  assert.deepEqual(page.items.map((item) => item.publicId), [expected.publicId]);
  assert.equal(page.nextCursor !== null, true);
  assert.deepEqual(gateway.catalogCalls.map((call) => call.limit), [1]);
  assert.equal(gateway.listOffsets.length, 0);
  assert.deepEqual(
    gateway.readPaths.filter((path) => path.includes("/posts/")),
    [`public-lounge-v1/posts/${expected.publicId}.json`],
  );
});

test("missing retracted and stale catalog anchors are never exposed", async () => {
  const gateway = new MemoryLoungeGateway();
  const missing = seedSummary(gateway, 601);
  gateway.objects.delete(`public-lounge-v1/posts/${missing.publicId}.json`);

  const retracted = seedSummary(gateway, 602);
  gateway.objects.set(`public-lounge-v1/posts/${retracted.publicId}.json`, {
    schemaVersion: PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION,
    state: "retracted",
    publicId: retracted.publicId,
    mutationSequence: 2,
    managementTokenHash: hash(`seed-management-${retracted.publicId}`),
    updatedAt: retracted.publishedAt,
  });

  const stale = seedSummary(gateway, 603);
  gateway.catalog.set(stale.publicId, {
    publicId: stale.publicId,
    publishedAt: "2026-08-29T02:00:00.000Z",
    active: true,
  });

  const page = await serviceFixture(gateway).service.list({ limit: 10 });
  assert.deepEqual(page.items, []);
  assert.equal(gateway.catalog.get(missing.publicId)?.active, false);
  assert.equal(gateway.catalog.get(retracted.publicId)?.active, false);
  assert.equal(gateway.catalog.get(stale.publicId)?.active, true);
});

test("client preflights device storage and recovers failed credential persistence", async () => {
  const fixture = serviceFixture();
  const published = await publish(fixture.service, await authorizedPublication(fixture));
  const previousFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error("FETCH_MUST_NOT_RUN"); };
    await assert.rejects(
      () => publishPublicLoungePost(validPublication(), {
        completionFingerprint: COMPLETION_FINGERPRINT,
        storage: new MemoryDeviceStorage({ failOnSetCall: 1 }),
      }),
      (error) => error instanceof PublicLoungeClientError && error.code === "PUBLIC_LOUNGE_AUTHOR_DEVICE_STORAGE_UNAVAILABLE",
    );
    assert.equal(calls, 0);

    const methods = [];
    globalThis.fetch = async (_url, init = {}) => {
      methods.push(init.method ?? "GET");
      return init.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json(published, { status: 201 });
    };
    await assert.rejects(
      () => publishPublicLoungePost(validPublication(), {
        completionFingerprint: COMPLETION_FINGERPRINT,
        storage: new MemoryDeviceStorage({ failOnSetCall: 4 }),
        accessToken: "access." + "B".repeat(64),
      }),
      (error) => error.code === "PUBLIC_LOUNGE_AUTHOR_DEVICE_STORAGE_WRITE_ROLLED_BACK",
    );
    assert.deepEqual(methods, ["POST", "DELETE"]);

    globalThis.fetch = async (_url, init = {}) => init.method === "DELETE"
      ? Response.json({ error: { code: "PUBLIC_LOUNGE_NOT_CONNECTED" } }, { status: 503 })
      : Response.json(published, { status: 201 });
    const storage = new MemoryDeviceStorage({ failOnSetCall: 4 });
    let recovery;
    await assert.rejects(
      () => publishPublicLoungePost(validPublication(), {
        completionFingerprint: COMPLETION_FINGERPRINT,
        storage,
        accessToken: "access." + "B".repeat(64),
      }),
      (error) => {
        recovery = error.recovery;
        return error.code === "PUBLIC_LOUNGE_MANAGEMENT_RECOVERY_REQUIRED"
          && error.recovery?.managementToken === published.managementToken;
      },
    );
    const reference = await resolvePublicLoungeManagementRecovery(recovery, "persist", { storage });
    assert.equal(reference.publicId, published.post.publicId);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("eligibility exchange never auto-retries replay ambiguous or network failures", async () => {
  const previousFetch = globalThis.fetch;
  try {
    const cases = [
      {
        expectedCode: "PUBLIC_LOUNGE_ATTESTATION_REPLAYED",
        response: () => Response.json({
          error: { code: "PUBLIC_LOUNGE_ATTESTATION_REPLAYED" },
        }, { status: 409 }),
      },
      {
        expectedCode: "PUBLIC_LOUNGE_ATTESTATION_STATE_UNKNOWN",
        response: () => Response.json({
          error: { code: "PUBLIC_LOUNGE_ATTESTATION_STATE_UNKNOWN" },
        }, { status: 503 }),
      },
      {
        expectedCode: "NETWORK_FAILURE",
        response: () => { throw Object.assign(new Error("NETWORK_FAILURE"), { code: "NETWORK_FAILURE" }); },
      },
    ];
    for (const item of cases) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return item.response();
      };
      await assert.rejects(
        () => requestPublicLoungeEligibilityProof(signedEligibilityRequest(), {
          accessToken: "access." + "N".repeat(64),
        }),
        (error) => error?.code === item.expectedCode || error?.message === item.expectedCode,
      );
      assert.equal(calls, 1, `${item.expectedCode} must not trigger a second eligibility exchange`);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("device-only stable work reference survives a changed completion fingerprint", () => {
  const storage = new MemoryDeviceStorage();
  const projectId = "private-project-id-never-sent";
  const post = {
    publicId: "novel_stablework000001",
    publishedAt: NOW,
    title: "舊稿已公開",
  };
  savePublicLoungeWorkPublicationReference(projectId, post, storage);
  const loadedAfterEdit = loadPublicLoungeWorkPublicationReference(projectId, storage);
  assert.deepEqual(loadedAfterEdit, post);
  assert.equal([...storage.values.keys()].some((key) => key.includes(projectId)), true);
  removePublicLoungeWorkPublicationReference(projectId, storage);
  assert.equal(loadPublicLoungeWorkPublicationReference(projectId, storage), null);
});

test("missing public or unprovisioned bucket never creates a local substitute", async () => {
  for (const status of [
    { exists: false, public: false, provisioned: false },
    { exists: true, public: true, provisioned: false },
    { exists: true, public: false, provisioned: false },
  ]) {
    const fixture = serviceFixture(new MemoryLoungeGateway(status));
    await expectAsyncCode(() => publish(fixture.service, validPublication()), "PUBLIC_LOUNGE_NOT_CONNECTED");
    assert.equal(fixture.gateway.objects.size, 0);
  }
});

test("missing production control-plane migration fails the gateway closed", async () => {
  class MissingControlPlaneGateway extends MemoryLoungeGateway {
    async controlPlaneStatus() {
      throw new Error("RPC_NOT_FOUND");
    }
  }
  const fixture = serviceFixture(new MissingControlPlaneGateway());
  await expectAsyncCode(() => fixture.service.health(), "PUBLIC_LOUNGE_NOT_CONNECTED");
  await expectAsyncCode(() => fixture.service.list({ limit: 1 }), "PUBLIC_LOUNGE_NOT_CONNECTED");
});

test("whole-novel adapter uses trusted proof quality and only public allowlist", () => {
  const review = {
    project: { id: "must-never-leave-device" },
    completion: { completionFingerprint: COMPLETION_FINGERPRINT },
    publicMetadata: {
      title: "霧港歸航", category: "奇幻", synopsis: "一段全書大綱",
      nonWhitespaceCharacters: 86_420, chapterCount: 12, completedAt: "2026-08-28T08:30:00.000Z",
    },
  };
  const proof = {
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION,
    eligibilityTicket: "E".repeat(43),
    expiresAt: "2026-08-29T03:10:00.000Z",
    backendId: "private-ai-hub",
    modelId: "closed-reviewer-v1",
    qualityAssurance: "private_ai_hub_verified",
    completionFingerprint: COMPLETION_FINGERPRINT,
    qualityScore: 86,
    qualityBreakdown: qualityBreakdown(),
  };
  const publication = createPublicLoungePublicationFromWholeNovelReview({
    review,
    authorByline: "林舟",
    topicIds: ["classic-topic-002", "classic-topic-005"],
    selectedOfficialChapters: [{ chapterNumber: 1, title: "霧中燈塔", body: "公開正文" }],
    explicitConsent: true,
    authorRightsDeclaration: true,
    eligibilityProof: proof,
  });
  assert.equal(JSON.stringify(publication).includes("must-never-leave-device"), false);
  assert.equal(publication.qualityScore, proof.qualityScore);
  assert.throws(
    () => createPublicLoungePublicationFromWholeNovelReview({
      review,
      authorByline: "林舟",
      topicIds: ["classic-topic-002"],
      selectedOfficialChapters: [{ chapterNumber: 1, title: "霧中燈塔", body: "公開正文" }],
      explicitConsent: true,
      authorRightsDeclaration: true,
      eligibilityProof: {
        ...proof,
        backendId: "browser-ai",
        qualityAssurance: "author_device_closed_ai_unverified",
      },
    }),
    (error) => error instanceof PublicLoungeClientError && error.code === "PUBLIC_LOUNGE_ELIGIBILITY_INVALID",
  );
  assert.throws(
    () => createPublicLoungePublicationFromWholeNovelReview({
      review,
      authorByline: "林舟",
      topicIds: ["classic-topic-002"],
      fullSynopsis: "摘".repeat(PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS + 1),
      selectedOfficialChapters: [{ chapterNumber: 1, title: "霧中燈塔", body: "公開正文" }],
      explicitConsent: true,
      authorRightsDeclaration: true,
      eligibilityProof: proof,
    }),
    (error) => error instanceof PublicLoungeClientError && error.code === "PUBLIC_LOUNGE_PAYLOAD_INVALID",
  );
});

for (const { name, run } of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`PUBLIC_LOUNGE_CONTRACT_TESTS_PASS ${tests.length}/${tests.length}`);
