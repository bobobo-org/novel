import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  PUBLIC_LOUNGE_MAX_REQUEST_BYTES,
  PublicLoungeError,
  publicLoungeEligibilityBinding,
  validatePublicLoungeEligibilityRequest,
  validatePublicLoungeServerEligibilityRequestV5,
} from "../lib/novel-ai/public-lounge/contract.ts";
import {
  createEd25519PublicLoungeEligibilityReviewer,
  createEd25519PublicLoungeEligibilityReviewerV5,
  publicLoungeServerReviewAttestationPayload,
  publicLoungeServerReviewAttestationV5Payload,
} from "../lib/novel-ai/public-lounge/eligibility-signature.ts";
import {
  createPublicLoungeHttpHandlers,
  PublicLoungeRateLimiter,
} from "../lib/novel-ai/public-lounge/http.ts";
import {
  listPublicLoungeShelves,
  normalizePublicLoungeTopicIds,
} from "../lib/novel-ai/public-lounge/taxonomy.ts";
import {
  PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION,
  PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_MULTI_JUDGE_SUMMARY_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES,
  PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION,
  PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_SCHEMA_VERSION,
  PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_V5_SCHEMA_VERSION,
} from "../lib/novel-ai/public-lounge/types.ts";

const ORIGIN = "https://novel.example";
const PUBLIC_ID = "novel_abcdefghijklmnop";
const TOKEN = "A".repeat(43);
const ACCESS_TOKEN = "access." + "B".repeat(64);
const IDEMPOTENCY_KEY = "I".repeat(32);
const CUTOVER_NOW = "2026-08-29T03:00:00.000Z";
const COMPLETION_FINGERPRINT = "c".repeat(64);
const WORK_ID = "a0009e4d-570c-4691-a610-5393b2bb331e";
const V5_KEY_ID = "private-ai-hub-preview-2026-08";
const V5_AUDIENCE = "public-lounge-eligibility";
const V5_PRODUCER_VERSION = "private-ai-hub-1.5.0";
const { privateKey: cutoverPrivateKey, publicKey: cutoverPublicKey } = generateKeyPairSync("ed25519");
const cutoverPublicKeyPem = cutoverPublicKey.export({ format: "pem", type: "spki" }).toString();
process.env.PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY = Buffer.alloc(32, 17).toString("base64url");

function eligibilityBreakdown(score = 86) {
  return Object.fromEntries([
    "plot_coherence",
    "character_arcs",
    "world_canon_consistency",
    "pacing",
    "prose_dialogue",
    "foreshadowing_payoff",
    "ending",
  ].map((key) => [key, score]));
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function apiEligibilityRequestBase() {
  const taxonomy = normalizePublicLoungeTopicIds(["classic-topic-002"]);
  return {
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
    completionFingerprint: COMPLETION_FINGERPRINT,
    title: "霧港歸航",
    authorByline: "林舟",
    ...taxonomy,
    completionStatus: "completed",
    chapterCount: 1,
    wordCount: 8_000,
    completedAt: "2026-08-29T02:50:00.000Z",
    fullSynopsis: "船醫追查失蹤航線，最後必須決定要保住故鄉，還是揭開它賴以生存的謊言。",
    publicChapters: [{
      chapterNumber: 1,
      title: "霧中燈塔",
      body: "潮聲越過防波堤時，沈遙看見熄滅十年的燈塔重新亮起。",
      official: true,
    }],
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
    trustedServerReviewConsent: true,
  };
}

function apiMultiJudgeSummary() {
  return {
    schemaVersion: PUBLIC_LOUNGE_MULTI_JUDGE_SUMMARY_SCHEMA_VERSION,
    primaryJudgeRoles: [...PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES],
    primaryJudgeCount: 3,
    judges: PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES.map((judgeRole) => ({
      judgeRole,
      totalScore: 86,
      dimensionScores: eligibilityBreakdown(),
      fullCoverage: true,
    })),
    aggregationMethod: "per-dimension-median",
    primaryScoreSpread: 0,
    selectedJudgeRoles: [...PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES],
    arbitrationRequired: false,
    arbitrationPerformed: false,
    fullCoverageJudgeRoles: [...PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES],
    reviewedChapterCount: 1,
    reviewedChunkCount: 1,
  };
}

function apiPublication(request) {
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
    qualityScore: 86,
    qualityBreakdown: eligibilityBreakdown(),
    fullSynopsis: request.fullSynopsis,
    publicChapters: request.publicChapters,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
  };
}

function apiEligibilityRequestV4() {
  const request = apiEligibilityRequestBase();
  const unsignedAttestation = {
    schemaVersion: PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_SCHEMA_VERSION,
    issuer: "private-ai-hub",
    keyId: V5_KEY_ID,
    nonce: "api-cutover-nonce-000001",
    issuedAt: "2026-08-29T02:55:00.000Z",
    expiresAt: "2026-08-29T03:10:00.000Z",
    completionFingerprint: COMPLETION_FINGERPRINT,
    publicationDigest: sha256(publicLoungeEligibilityBinding(
      apiPublication(request),
      COMPLETION_FINGERPRINT,
    )),
    qualityScore: 86,
    qualityBreakdown: eligibilityBreakdown(),
    workCompleted: true,
    fullCoverage: true,
    hardGatePassed: true,
    compliancePassed: true,
    criticalDimensionsPassed: true,
    hiddenDraftResidueDetected: false,
    multiJudgeSummary: apiMultiJudgeSummary(),
    backendId: "private-ai-hub",
    modelId: "closed-reviewer-v4",
    modelDigest: "d".repeat(64),
    rawContentStored: false,
    signature: "A".repeat(86),
  };
  return {
    ...request,
    serverAttestation: {
      ...unsignedAttestation,
      signature: sign(
        null,
        Buffer.from(publicLoungeServerReviewAttestationPayload(unsignedAttestation), "utf8"),
        cutoverPrivateKey,
      ).toString("base64url"),
    },
  };
}

function apiEligibilityRequestV5() {
  const request = {
    ...apiEligibilityRequestBase(),
    workId: WORK_ID,
    revisionId: COMPLETION_FINGERPRINT,
    intent: "publish",
    targetPublicationId: null,
    expectedTargetVersionId: null,
    expectedTargetPublicationDigest: null,
  };
  const unsignedAttestation = {
    schemaVersion: PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_V5_SCHEMA_VERSION,
    issuer: "private-ai-hub",
    keyId: V5_KEY_ID,
    attestationId: "api-cutover-v5-id-0001",
    intent: request.intent,
    workId: request.workId,
    revisionId: request.revisionId,
    targetPublicationId: request.targetPublicationId,
    expectedTargetVersionId: request.expectedTargetVersionId,
    expectedTargetPublicationDigest: request.expectedTargetPublicationDigest,
    environment: "preview",
    audience: V5_AUDIENCE,
    producerVersion: V5_PRODUCER_VERSION,
    rubricVersion: PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION,
    issuedAt: "2026-08-29T02:55:00.000Z",
    expiresAt: "2026-08-29T03:10:00.000Z",
    completionFingerprint: COMPLETION_FINGERPRINT,
    contentDigest: sha256(JSON.stringify(request.publicChapters)),
    publicationDigest: sha256(publicLoungeEligibilityBinding(
      apiPublication(request),
      COMPLETION_FINGERPRINT,
    )),
    qualityScore: 86,
    qualityBreakdown: eligibilityBreakdown(),
    workCompleted: true,
    fullCoverage: true,
    hardGatePassed: true,
    compliancePassed: true,
    criticalDimensionsPassed: true,
    hiddenDraftResidueDetected: false,
    multiJudgeSummary: apiMultiJudgeSummary(),
    backendId: "private-ai-hub",
    modelId: "closed-reviewer-v5",
    modelDigest: "d".repeat(64),
    rawContentStored: false,
    signature: "A".repeat(86),
  };
  return {
    ...request,
    serverAttestation: {
      ...unsignedAttestation,
      signature: sign(
        null,
        Buffer.from(publicLoungeServerReviewAttestationV5Payload(unsignedAttestation), "utf8"),
        cutoverPrivateKey,
      ).toString("base64url"),
    },
  };
}

function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if ((options.method ?? "GET") !== "GET" && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${ACCESS_TOKEN}`);
  }
  if (!options.omitTrustedIp && !headers.has("x-vercel-forwarded-for")) {
    headers.set("x-vercel-forwarded-for", "203.0.113.10");
  }
  if (
    path === "/api/lounge"
    && (options.method ?? "GET") === "POST"
    && options.omitIdempotencyKey !== true
  ) {
    headers.set("Idempotency-Key", IDEMPOTENCY_KEY);
  }
  if (options.origin !== undefined) headers.set("Origin", options.origin);
  if (options.sameOriginFetch) headers.set("Sec-Fetch-Site", "same-origin");
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    options.body = JSON.stringify(options.json);
  }
  return new Request(`${ORIGIN}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
  });
}

function fakePost() {
  return {
    schemaVersion: "public-lounge-post-v2",
    publicId: PUBLIC_ID,
    title: "霧港歸航",
    authorByline: "林舟",
    authorBylineStatus: "self_entered_unverified",
    ...normalizePublicLoungeTopicIds(["classic-topic-002", "classic-topic-005"]),
    completionStatus: "completed",
    chapterCount: 12,
    wordCount: 86_420,
    completedAt: "2026-08-28T08:30:00.000Z",
    publishedAt: "2026-08-29T03:00:00.000Z",
    versionId: "version_abcdefghijklmnop",
    versionNumber: 1,
    quality: { totalScore: 86, threshold: 80, breakdown: [] },
    qualityAssurance: "private_ai_hub_verified",
    fullSynopsis: "全書大綱",
    publicChapters: [],
  };
}

function fakeOwnerGateway(overrides = {}) {
  const calls = [];
  return {
    calls,
    authenticate: async (incoming) => {
      calls.push(["authenticate", incoming.headers.get("authorization")]);
      return { id: "11111111-1111-4111-8111-111111111111" };
    },
    bind: async (ownerId, post) => {
      calls.push(["bind", ownerId, post.publicId, post.versionId]);
    },
    assertOwner: async (ownerId, publicId) => {
      calls.push(["assertOwner", ownerId, publicId]);
    },
    sync: async (ownerId, expectedVersionId, post) => {
      calls.push(["sync", ownerId, expectedVersionId, post.versionId]);
    },
    deactivate: async (ownerId, publicId, expectedVersionId, expectedVersionNumber) => {
      calls.push(["deactivate", ownerId, publicId, expectedVersionId, expectedVersionNumber]);
    },
    ...overrides,
  };
}

function fakeService(overrides = {}) {
  const calls = [];
  return {
    calls,
    health: async () => ({
      connected: true,
      storage: "supabase-private-storage",
      bucket: "novel-public-lounge-v1",
      trustedEligibilityVerifierConnected: true,
      authorDeviceEligibilityAccepted: false,
      trustedAttestationProducer: "private-ai-hub-v5-client-probe-required",
    }),
    list: async (query) => {
      calls.push(["list", query]);
      return {
        items: [fakePost()],
        nextCursor: "next-page",
        totalCount: 250,
        shelves: listPublicLoungeShelves(),
      };
    },
    get: async (publicId) => {
      calls.push(["get", publicId]);
      return fakePost();
    },
    reserveRequest: async (requestIdentity, scope) => {
      calls.push(["reserveRequest", requestIdentity, scope]);
    },
    publish: async (input, idempotencyKey, actorId, beforeVisible) => {
      calls.push(["publish", input, idempotencyKey, actorId]);
      const post = fakePost();
      await beforeVisible(post);
      return { post, managementToken: TOKEN };
    },
    issueEligibility: async (input, actorId) => {
      calls.push(["issueEligibility", input, actorId]);
      return { eligibilityTicket: TOKEN };
    },
    overwrite: async (publicId, token, input, actorId) => {
      calls.push(["overwrite", publicId, token, input, actorId]);
      return fakePost();
    },
    retract: async (publicId, token) => {
      calls.push(["retract", publicId, token]);
    },
    ...overrides,
  };
}

const service = fakeService();
const ownerGateway = fakeOwnerGateway();
const handlers = createPublicLoungeHttpHandlers(
  () => service,
  new PublicLoungeRateLimiter({ mutationLimit: 20 }),
  undefined,
  () => ownerGateway,
);

{
  const response = await handlers.health(request("/api/lounge/health"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "ready",
    connected: true,
    storage: "supabase-private-storage",
    bucket: "novel-public-lounge-v1",
    trustedEligibilityVerifierConnected: true,
    authorDeviceEligibilityAccepted: false,
    trustedAttestationProducer: "private-ai-hub-v5-client-probe-required",
  });
}

{
  const response = await handlers.eligibility(request("/api/lounge/eligibility", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    json: { requestKind: "trusted-private-ai-hub-review" },
  }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(service.calls.at(-1), ["issueEligibility", {
    requestKind: "trusted-private-ai-hub-review",
  }, "11111111-1111-4111-8111-111111111111"]);
}

{
  const response = await handlers.list(request("/api/lounge?q=霧&shelf=group-5&cursor=opaque&limit=24"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("cache-control").includes("s-maxage"), false);
  const body = await response.json();
  assert.equal(body.connected, true);
  assert.equal(body.count, 1);
  assert.equal(body.totalCount, 250);
  assert.equal(body.nextCursor, "next-page");
  assert.deepEqual(body.shelves.map((shelf) => shelf.shelfId), [
    "group-1", "group-2", "group-3", "group-4", "group-5", "group-6", "group-7", "group-8",
  ]);
  assert.deepEqual(service.calls.at(-1), ["list", {
    search: "霧",
    shelfId: "group-5",
    completedOnly: true,
    cursor: "opaque",
    limit: 24,
  }]);
}

{
  const before = service.calls.length;
  const response = await handlers.list(request("/api/lounge?limit=24x"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_CURSOR_INVALID");
  assert.equal(service.calls.length, before + 1);
  assert.equal(service.calls.at(-1)[0], "reserveRequest");
  assert.equal(service.calls.at(-1)[2], "read");
}

{
  const response = await handlers.eligibility(request("/api/lounge/eligibility", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    json: { signedAttestation: true },
  }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).proof.eligibilityTicket, TOKEN);
  assert.deepEqual(service.calls.at(-1), [
    "issueEligibility",
    { signedAttestation: true },
    "11111111-1111-4111-8111-111111111111",
  ]);
}

{
  const v4Request = apiEligibilityRequestV4();
  const v4Reviewer = createEd25519PublicLoungeEligibilityReviewer({
    publicKeyPem: cutoverPublicKeyPem,
    keyId: V5_KEY_ID,
    now: () => CUTOVER_NOW,
  });
  await v4Reviewer.review(validatePublicLoungeEligibilityRequest(v4Request));

  const v5Reviewer = createEd25519PublicLoungeEligibilityReviewerV5({
    publicKeyPem: cutoverPublicKeyPem,
    keyId: V5_KEY_ID,
    environment: "preview",
    audience: V5_AUDIENCE,
    producerVersion: V5_PRODUCER_VERSION,
    rubricVersion: PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION,
    now: () => CUTOVER_NOW,
  });
  let v5ReviewCalls = 0;
  const cutoverService = fakeService({
    issueEligibility: async (input) => {
      if (
        input?.serverAttestation?.schemaVersion
        !== PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_V5_SCHEMA_VERSION
      ) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_ATTESTATION_VERSION_UNSUPPORTED", 403);
      }
      const parsed = validatePublicLoungeServerEligibilityRequestV5(input);
      v5ReviewCalls += 1;
      await v5Reviewer.review(parsed);
      return {
        schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION,
        eligibilityTicket: TOKEN,
      };
    },
  });
  const cutoverHandlers = createPublicLoungeHttpHandlers(
    () => cutoverService,
    new PublicLoungeRateLimiter({ mutationLimit: 20 }),
    undefined,
    () => fakeOwnerGateway(),
  );
  const rejected = await cutoverHandlers.eligibility(request("/api/lounge/eligibility", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    json: v4Request,
  }));
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error.code, "PUBLIC_LOUNGE_ATTESTATION_VERSION_UNSUPPORTED");
  assert.equal(v5ReviewCalls, 0);

  const current = await cutoverHandlers.eligibility(request("/api/lounge/eligibility", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    json: apiEligibilityRequestV5(),
  }));
  assert.equal(current.status, 201);
  assert.equal((await current.json()).proof.schemaVersion, PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION);
  assert.equal(v5ReviewCalls, 1);
}

{
  const response = await handlers.get(request(`/api/lounge/${PUBLIC_ID}`), PUBLIC_ID);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("cache-control").includes("stale-while-revalidate"), false);
  assert.equal((await response.json()).post.publicId, PUBLIC_ID);
}

for (const origin of [undefined, "https://attacker.example"]) {
  const response = await handlers.publish(request("/api/lounge", {
    method: "POST",
    origin,
    json: { visible: true },
  }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_ORIGIN_INVALID");
}

{
  const compensationService = fakeService();
  const failingOwner = fakeOwnerGateway({
    bind: async () => {
      throw new Error("owner database unavailable");
    },
  });
  const compensationHandlers = createPublicLoungeHttpHandlers(
    () => compensationService,
    new PublicLoungeRateLimiter({ mutationLimit: 20 }),
    undefined,
    () => failingOwner,
  );
  const response = await compensationHandlers.publish(request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    json: { visible: true },
  }));
  assert.equal(response.status, 503);
  assert.equal(compensationService.calls.at(-1)[0], "publish");
  assert.equal(compensationService.calls.some(([kind]) => kind === "retract"), false);
}

{
  const response = await handlers.publish(request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    headers: { "Sec-Fetch-Site": "same-site" },
    json: { visible: true },
  }));
  assert.equal(response.status, 403);
}

{
  const response = await handlers.publish(request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    json: { visible: true },
  }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.managementToken, TOKEN);
  assert.deepEqual(service.calls.at(-1), [
    "publish",
    { visible: true },
    IDEMPOTENCY_KEY,
    "11111111-1111-4111-8111-111111111111",
  ]);
  assert.deepEqual(ownerGateway.calls.at(-1), [
    "bind",
    "11111111-1111-4111-8111-111111111111",
    PUBLIC_ID,
    "version_abcdefghijklmnop",
  ]);
}

{
  const before = service.calls.length;
  const response = await handlers.publish(request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    omitIdempotencyKey: true,
    json: { visible: true },
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(service.calls.length, before + 1);
  assert.equal(service.calls.at(-1)[0], "reserveRequest");
  assert.equal(service.calls.at(-1)[2], "publish");
}

{
  const response = await handlers.publish(request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: { "Content-Type": "text/plain" },
    body: "{}",
  }));
  assert.equal(response.status, 415);
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_PAYLOAD_INVALID");
}

{
  const response = await handlers.publish(request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(PUBLIC_LOUNGE_MAX_REQUEST_BYTES + 1),
    },
    body: "{}",
  }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_PAYLOAD_TOO_LARGE");
}

{
  const oversized = `{"text":"${"漢".repeat(Math.ceil(PUBLIC_LOUNGE_MAX_REQUEST_BYTES / 3) + 10)}"}`;
  const response = await handlers.publish(request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: { "Content-Type": "application/json" },
    body: oversized,
  }));
  assert.equal(response.status, 413);
}

{
  const response = await handlers.overwrite(request(`/api/lounge/${PUBLIC_ID}`, {
    method: "PUT",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: { "X-Public-Lounge-Management-Token": TOKEN },
    json: { title: "修訂" },
  }), PUBLIC_ID);
  assert.equal(response.status, 200);
  assert.deepEqual(service.calls.at(-1), [
    "overwrite",
    PUBLIC_ID,
    TOKEN,
    { title: "修訂" },
    "11111111-1111-4111-8111-111111111111",
  ]);
  assert.deepEqual(ownerGateway.calls.at(-1), [
    "sync",
    "11111111-1111-4111-8111-111111111111",
    "version_abcdefghijklmnop",
    "version_abcdefghijklmnop",
  ]);
}

{
  const response = await handlers.retract(request(`/api/lounge/${PUBLIC_ID}`, {
    method: "DELETE",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: { "X-Public-Lounge-Management-Token": TOKEN },
  }), PUBLIC_ID);
  assert.equal(response.status, 204);
  assert.deepEqual(service.calls.at(-1), ["retract", PUBLIC_ID, TOKEN]);
  assert.deepEqual(ownerGateway.calls.at(-1), [
    "deactivate",
    "11111111-1111-4111-8111-111111111111",
    PUBLIC_ID,
    "version_abcdefghijklmnop",
    1,
  ]);
}

{
  const before = service.calls.length;
  const response = await handlers.retract(request("/api/lounge/not-a-public-id", {
    method: "DELETE",
    origin: ORIGIN,
    sameOriginFetch: true,
  }), "not-a-public-id");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED");
  assert.equal(service.calls.length, before + 1);
  assert.equal(service.calls.at(-1)[0], "reserveRequest");
  assert.equal(service.calls.at(-1)[2], "management");
}

{
  const busyService = fakeService({
    overwrite: async () => {
      throw new PublicLoungeError("PUBLIC_LOUNGE_MUTATION_BUSY", 409, true);
    },
  });
  const response = await createPublicLoungeHttpHandlers(
    () => busyService,
    new PublicLoungeRateLimiter({ mutationLimit: 20 }),
    undefined,
    () => fakeOwnerGateway(),
  ).overwrite(request(`/api/lounge/${PUBLIC_ID}`, {
    method: "PUT",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: { "X-Public-Lounge-Management-Token": TOKEN },
    json: { title: "並行修訂" },
  }), PUBLIC_ID);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: { code: "PUBLIC_LOUNGE_MUTATION_BUSY", retryable: true },
  });
}

{
  const durableLimitedService = fakeService({
    retract: async () => {
      throw new PublicLoungeError("PUBLIC_LOUNGE_MUTATION_RATE_LIMITED", 429, true);
    },
  });
  const response = await createPublicLoungeHttpHandlers(
    () => durableLimitedService,
    new PublicLoungeRateLimiter({ mutationLimit: 20 }),
    undefined,
    () => fakeOwnerGateway(),
  ).retract(request(`/api/lounge/${PUBLIC_ID}`, {
    method: "DELETE",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: { "X-Public-Lounge-Management-Token": TOKEN },
  }), PUBLIC_ID);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_MUTATION_RATE_LIMITED");
}

{
  const strictLimiter = new PublicLoungeRateLimiter({ mutationLimit: 1, windowMs: 60_000 });
  const limitedHandlers = createPublicLoungeHttpHandlers(
    () => fakeService(),
    strictLimiter,
    undefined,
    () => fakeOwnerGateway(),
  );
  const publishRequest = () => request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: {
      "x-vercel-forwarded-for": "203.0.113.10",
      "user-agent": "first-browser/1.0",
      "accept-language": "zh-TW",
    },
    json: { visible: true },
  });
  assert.equal((await limitedHandlers.publish(publishRequest())).status, 201);
  const limited = await limitedHandlers.publish(request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: {
      "x-vercel-forwarded-for": "203.0.113.10",
      "user-agent": "different-browser/9.0",
      "accept-language": "en-US",
    },
    json: { visible: true },
  }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
}

{
  const response = await createPublicLoungeHttpHandlers(() => fakeService()).health(
    request("/api/lounge/health", { omitTrustedIp: true }),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_NOT_CONNECTED");
}

{
  const failing = fakeService({
    list: async () => {
      throw new Error("secret Supabase backend detail");
    },
  });
  const response = await createPublicLoungeHttpHandlers(() => failing).list(request("/api/lounge"));
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.match(text, /PUBLIC_LOUNGE_NOT_CONNECTED/u);
  assert.equal(text.includes("secret Supabase"), false);
}

{
  const disconnected = fakeService({
    list: async () => {
      throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_CONNECTED", 503, true);
    },
  });
  const response = await createPublicLoungeHttpHandlers(() => disconnected).list(request("/api/lounge"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_NOT_CONNECTED");
}

console.log("PUBLIC_LOUNGE_API_TESTS_PASS");
