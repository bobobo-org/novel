import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  buildPublicLoungePost,
  PublicLoungeError,
  publicLoungeEligibilityBinding,
  publicLoungePostToSummary,
  validatePublicLoungePublicationInput,
} from "../lib/novel-ai/public-lounge/contract.ts";
import {
  createPublicLoungePublicationFromWholeNovelReview,
  publishPublicLoungePost,
  PublicLoungeClientError,
  resolvePublicLoungeManagementRecovery,
} from "../lib/novel-ai/public-lounge/client.ts";
import {
  createEd25519PublicLoungeEligibilityReviewer,
  publicLoungeServerReviewAttestationPayload,
} from "../lib/novel-ai/public-lounge/eligibility-signature.ts";
import { PublicLoungeService } from "../lib/novel-ai/public-lounge/service.ts";
import {
  PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_SCHEMA_VERSION,
} from "../lib/novel-ai/public-lounge/types.ts";

const NOW = "2026-08-29T03:00:00.000Z";
const COMPLETION_FINGERPRINT = "c".repeat(64);
const MODEL_DIGEST = "d".repeat(64);
const KEY_ID = "private-ai-hub-production-2026-08";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
const tests = [];
let attestationCounter = 0;

function test(name, run) { tests.push({ name, run }); }
function hash(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function qualityBreakdown(score = 86) {
  return Object.fromEntries([
    "plot_coherence", "character_arcs", "world_canon_consistency", "pacing",
    "prose_dialogue", "foreshadowing_payoff", "ending",
  ].map((key) => [key, score]));
}

function validPublication(overrides = {}) {
  return {
    schemaVersion: PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
    title: "《霧港歸航》",
    authorByline: "林舟",
    category: "奇幻",
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

function unsignedPublicationFromRequest(request, score = 86) {
  return {
    schemaVersion: PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
    title: request.title,
    authorByline: request.authorByline,
    category: request.category,
    completionStatus: "completed",
    chapterCount: request.chapterCount,
    wordCount: request.wordCount,
    completedAt: request.completedAt,
    qualityScore: score,
    qualityBreakdown: qualityBreakdown(score),
    fullSynopsis: request.fullSynopsis,
    publicChapters: request.publicChapters,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
  };
}

function signedEligibilityRequest(overrides = {}, attestationOverrides = {}) {
  attestationCounter += 1;
  const base = validPublication(overrides);
  const request = {
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
    completionFingerprint: COMPLETION_FINGERPRINT,
    title: base.title,
    authorByline: base.authorByline,
    category: base.category,
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
  const attestation = {
    schemaVersion: PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_SCHEMA_VERSION,
    issuer: "private-ai-hub",
    keyId: KEY_ID,
    nonce: `nonce${String(attestationCounter).padStart(18, "0")}`,
    issuedAt: "2026-08-29T02:55:00.000Z",
    expiresAt: "2026-08-29T03:10:00.000Z",
    completionFingerprint: COMPLETION_FINGERPRINT,
    publicationDigest: hash(publicLoungeEligibilityBinding(
      unsignedPublicationFromRequest(request, score),
      COMPLETION_FINGERPRINT,
    )),
    qualityScore: score,
    qualityBreakdown: qualityBreakdown(score),
    workCompleted: true,
    fullCoverage: true,
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
    this.listOffsets = [];
    this.activeReads = 0;
    this.maxActiveReads = 0;
    this.readDelayMs = 0;
  }
  async bucketStatus() { return this.status; }
  async readJson(path) {
    const isIndex = path.includes("/index/");
    if (isIndex) {
      this.activeReads += 1;
      this.maxActiveReads = Math.max(this.maxActiveReads, this.activeReads);
      if (this.readDelayMs) await new Promise((resolve) => setTimeout(resolve, this.readDelayMs));
    }
    try {
      const value = this.objects.get(path);
      return value === undefined ? null : structuredClone(value);
    } finally {
      if (isIndex) this.activeReads -= 1;
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
  eligibilityReviewer = createEd25519PublicLoungeEligibilityReviewer({ publicKeyPem, keyId: KEY_ID, now: () => NOW }),
) {
  let tokenCounter = 0;
  let publicIdCounter = 0;
  const service = new PublicLoungeService({
    gateway,
    tokenCodec: {
      issue() {
        tokenCounter += 1;
        const token = `token-${String(tokenCounter).padStart(6, "0")}`.padEnd(43, "x");
        return { token, hash: hash(token) };
      },
      matches: (candidate, expected) => hash(candidate) === expected,
    },
    createPublicId() {
      publicIdCounter += 1;
      return `novel_${String(publicIdCounter).padStart(16, "0")}`;
    },
    now: () => NOW,
    digest: hash,
    eligibilityReviewer,
  });
  return { gateway, service };
}

async function authorizedPublication(fixture, overrides = {}) {
  const proof = await fixture.service.issueEligibility(signedEligibilityRequest(overrides));
  return validPublication({
    ...overrides,
    qualityScore: proof.qualityScore,
    qualityBreakdown: proof.qualityBreakdown,
    eligibilityTicket: proof.eligibilityTicket,
  });
}

function seedSummary(gateway, index, overrides = {}) {
  const publicId = overrides.publicId ?? `novel_${String(index).padStart(16, "0")}`;
  const publication = validPublication({
    title: overrides.title ?? `公開小說 ${index}`,
    category: overrides.category ?? "奇幻",
  });
  const post = buildPublicLoungePost(publication, {
    publicId,
    publishedAt: overrides.publishedAt ?? new Date(Date.UTC(2026, 7, 29, 3, 0, index)).toISOString(),
  });
  const summary = publicLoungePostToSummary(post);
  gateway.objects.set(`public-lounge-v1/index/${publicId}.json`, summary);
  return summary;
}

test("contract accepts an explicit completed rights-cleared integer 80+ publication", () => {
  const parsed = validatePublicLoungePublicationInput(validPublication({
    title: "  霧港\u0000歸航\u202e  ",
    fullSynopsis: "第一行  \r\n第二行",
  }));
  assert.equal(parsed.title, "霧港歸航");
  assert.equal(parsed.fullSynopsis, "第一行\n第二行");
});

test("contract rejects consent rights completion threshold weighted mismatch and private fields", () => {
  expectCode(() => validatePublicLoungePublicationInput(validPublication({ explicitConsent: false })), "PUBLIC_LOUNGE_CONSENT_REQUIRED");
  expectCode(() => validatePublicLoungePublicationInput(validPublication({ authorRightsDeclaration: false })), "PUBLIC_LOUNGE_RIGHTS_DECLARATION_REQUIRED");
  expectCode(() => validatePublicLoungePublicationInput(validPublication({ workCompleted: false })), "PUBLIC_LOUNGE_WORK_NOT_COMPLETED");
  expectCode(() => validatePublicLoungePublicationInput(validPublication({ qualityScore: 79 })), "PUBLIC_LOUNGE_SCORE_NOT_QUALIFIED");
  expectCode(() => validatePublicLoungePublicationInput(validPublication({ qualityScore: 87 })), "PUBLIC_LOUNGE_PAYLOAD_INVALID");
  for (const key of ["projectId", "privateCanon", "systemPrompt", "modelTrace", "backup"]) {
    expectCode(() => validatePublicLoungePublicationInput({ ...validPublication(), [key]: "secret" }), "PUBLIC_LOUNGE_FORBIDDEN_FIELD");
  }
});

test("forged caller-reported 100 score without stored eligibility is rejected", async () => {
  const fixture = serviceFixture();
  await expectAsyncCode(() => fixture.service.publish(validPublication({
    qualityScore: 100,
    qualityBreakdown: qualityBreakdown(100),
    eligibilityTicket: "F".repeat(43),
  })), "PUBLIC_LOUNGE_ELIGIBILITY_INVALID");
});

test("trusted Ed25519 attestation issues one bound ticket and legal publish succeeds", async () => {
  const fixture = serviceFixture();
  const result = await fixture.service.publish(await authorizedPublication(fixture));
  assert.equal(result.post.quality.totalScore, 86);
  assert.equal(result.post.authorBylineStatus, "self_entered_unverified");
  assert.equal((await fixture.service.list()).items.length, 1);
  assert.equal((await fixture.service.get(result.post.publicId)).title, "《霧港歸航》");
  const serialized = JSON.stringify([...fixture.gateway.objects.values()]);
  assert.equal(serialized.includes(result.managementToken), false);
  assert.equal(/projectId|privateCanon|systemPrompt|modelTrace|backup/u.test(serialized), false);
});

test("ticket replay and public-field tampering are rejected", async () => {
  const replayFixture = serviceFixture();
  const publication = await authorizedPublication(replayFixture);
  await replayFixture.service.publish(publication);
  await expectAsyncCode(() => replayFixture.service.publish(publication), "PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED");
  const tamperFixture = serviceFixture();
  const bound = await authorizedPublication(tamperFixture);
  await expectAsyncCode(() => tamperFixture.service.publish({ ...bound, title: "竄改後標題" }), "PUBLIC_LOUNGE_ELIGIBILITY_INVALID");
});

test("attestation tampering and attestation replay are rejected", async () => {
  const tamperFixture = serviceFixture();
  const request = signedEligibilityRequest();
  request.title = "簽章後竄改";
  await expectAsyncCode(() => tamperFixture.service.issueEligibility(request), "PUBLIC_LOUNGE_ELIGIBILITY_INVALID");
  const replayFixture = serviceFixture();
  const replayRequest = signedEligibilityRequest();
  await replayFixture.service.issueEligibility(replayRequest);
  await expectAsyncCode(() => replayFixture.service.issueEligibility(replayRequest), "PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED");
});

test("missing trusted verifier is reported honestly and cannot issue eligibility", async () => {
  const fixture = serviceFixture(
    new MemoryLoungeGateway(),
    createEd25519PublicLoungeEligibilityReviewer({ publicKeyPem: "", keyId: "", now: () => NOW }),
  );
  const health = await fixture.service.health();
  assert.equal(health.trustedEligibilityVerifierConnected, false);
  assert.equal(health.trustedAttestationProducer, "not-available-in-this-release");
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
  const result = await fixture.service.publish(await authorizedPublication(fixture));
  assert.match(result.managementToken, /^[A-Za-z0-9_-]{43}$/u);
});

test("publish rolls back post and index when index commit fails", async () => {
  class RejectIndexWriteGateway extends MemoryLoungeGateway {
    async writeJson(path, value, options) {
      if (path.includes("/index/")) throw new Error("INDEX_WRITE_FAILED");
      return super.writeJson(path, value, options);
    }
  }
  const fixture = serviceFixture(new RejectIndexWriteGateway());
  const publication = await authorizedPublication(fixture);
  await expectAsyncCode(() => fixture.service.publish(publication), "PUBLIC_LOUNGE_NOT_CONNECTED");
  assert.equal([...fixture.gateway.objects.keys()].some((path) => path.includes("/posts/")), false);
  assert.equal([...fixture.gateway.objects.keys()].some((path) => path.includes("/index/")), false);
});

test("management token gates overwrite and retract retry removes ghost index", async () => {
  class FailFirstIndexDeleteGateway extends MemoryLoungeGateway {
    constructor() { super(); this.failed = false; }
    async deleteJson(paths) {
      if (!this.failed && paths.some((path) => path.includes("/index/"))) {
        this.failed = true;
        throw new Error("INDEX_DELETE_FAILED");
      }
      return super.deleteJson(paths);
    }
  }
  const fixture = serviceFixture(new FailFirstIndexDeleteGateway());
  const published = await fixture.service.publish(await authorizedPublication(fixture));
  await expectAsyncCode(
    () => fixture.service.overwrite(published.post.publicId, "B".repeat(43), validPublication()),
    "PUBLIC_LOUNGE_MANAGEMENT_TOKEN_INVALID",
  );
  const revision = await authorizedPublication(fixture, { title: "霧港歸航・修訂版" });
  const overwritten = await fixture.service.overwrite(published.post.publicId, published.managementToken, revision);
  assert.equal(overwritten.title, "霧港歸航・修訂版");
  await expectAsyncCode(
    () => fixture.service.retract(published.post.publicId, published.managementToken),
    "PUBLIC_LOUNGE_NOT_CONNECTED",
  );
  await fixture.service.retract(published.post.publicId, published.managementToken);
  assert.equal((await fixture.service.list()).items.length, 0);
});

test("250 works are cursor-pageable searchable and read with concurrency at most 8", async () => {
  const gateway = new MemoryLoungeGateway();
  gateway.readDelayMs = 1;
  for (let index = 1; index <= 250; index += 1) {
    seedSummary(gateway, index, {
      title: index === 249 ? "唯一深海搜尋命中" : undefined,
      category: index === 250 ? "末頁分類" : undefined,
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
  assert.deepEqual([...new Set(gateway.listOffsets)], [0, 200]);
  assert.ok(gateway.maxActiveReads > 1 && gateway.maxActiveReads <= 8);
  const searched = await fixture.service.list({ search: "唯一深海搜尋命中" });
  assert.equal(searched.totalCount, 1);
  const categoryPage = await fixture.service.list({ category: "末頁分類" });
  assert.equal(categoryPage.totalCount, 1);
  assert.ok(categoryPage.categories.includes("末頁分類"));
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

test("corruption and catalogs above explicit ceiling fail instead of silently truncating", async () => {
  const corruptFixture = serviceFixture();
  for (let index = 1; index <= 201; index += 1) seedSummary(corruptFixture.gateway, index);
  corruptFixture.gateway.objects.set("public-lounge-v1/index/novel_0000000000000201.json", { malformed: true });
  await expectAsyncCode(() => corruptFixture.service.list(), "PUBLIC_LOUNGE_NOT_CONNECTED");
  const largeFixture = serviceFixture();
  for (let index = 1; index <= 5_001; index += 1) {
    largeFixture.gateway.objects.set(`public-lounge-v1/index/novel_${String(index).padStart(16, "0")}.json`, { unread: true });
  }
  await expectAsyncCode(() => largeFixture.service.list(), "PUBLIC_LOUNGE_CATALOG_LIMIT");
});

test("client preflights device storage and recovers failed credential persistence", async () => {
  const fixture = serviceFixture();
  const published = await fixture.service.publish(await authorizedPublication(fixture));
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
      () => publishPublicLoungePost(validPublication(), { completionFingerprint: COMPLETION_FINGERPRINT, storage }),
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

test("missing public or unprovisioned bucket never creates a local substitute", async () => {
  for (const status of [
    { exists: false, public: false, provisioned: false },
    { exists: true, public: true, provisioned: false },
    { exists: true, public: false, provisioned: false },
  ]) {
    const fixture = serviceFixture(new MemoryLoungeGateway(status));
    await expectAsyncCode(() => fixture.service.publish(validPublication()), "PUBLIC_LOUNGE_NOT_CONNECTED");
    assert.equal(fixture.gateway.objects.size, 0);
  }
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
    schemaVersion: "public-lounge-eligibility-proof-v1",
    eligibilityTicket: "E".repeat(43),
    expiresAt: "2026-08-29T03:10:00.000Z",
    backendId: "private-ai-hub",
    modelId: "closed-reviewer-v1",
    completionFingerprint: COMPLETION_FINGERPRINT,
    qualityScore: 86,
    qualityBreakdown: qualityBreakdown(),
  };
  const publication = createPublicLoungePublicationFromWholeNovelReview({
    review,
    authorByline: "林舟",
    selectedOfficialChapters: [{ chapterNumber: 1, title: "霧中燈塔", body: "公開正文" }],
    explicitConsent: true,
    authorRightsDeclaration: true,
    eligibilityProof: proof,
  });
  assert.equal(JSON.stringify(publication).includes("must-never-leave-device"), false);
  assert.equal(publication.qualityScore, proof.qualityScore);
});

for (const { name, run } of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`PUBLIC_LOUNGE_CONTRACT_TESTS_PASS ${tests.length}/${tests.length}`);
