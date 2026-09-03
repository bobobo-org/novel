import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import {
  PRIVATE_HUB_PUBLIC_LOUNGE_PRODUCER_VERSION,
  PRIVATE_HUB_PUBLIC_LOUNGE_REQUEST_SCHEMA,
  PRIVATE_HUB_PUBLIC_LOUNGE_RESPONSE_SCHEMA,
  PUBLIC_LOUNGE_ATTESTATION_TTL_MS,
  PUBLIC_LOUNGE_RUBRIC_VERSION,
  createPublicLoungeAttestationProducer,
} from "../local-ai/private-hub/public-lounge-attestation-producer.mjs";
import {
  createPublicLoungeAttestationKeyProvisioner,
} from "../local-ai/private-hub/provision-public-lounge-attestation-key.mjs";
import {
  PRIVATE_HUB_PROTOCOL,
  PRIVATE_HUB_MODEL_DISCOVERY_SERVER_TIMEOUT_MS,
  PRIVATE_HUB_PUBLIC_LOUNGE_JUDGE_TIMEOUT_MS,
  createPrivateHubServer,
} from "../local-ai/private-hub/server.mjs";
import {
  PRIVATE_HUB_PUBLIC_LOUNGE_ATTESTATION_TIMEOUT_MS,
} from "../lib/novel-ai/providers/private-ai-hub/private-hub-client.ts";
import {
  PUBLIC_LOUNGE_ATTESTATION_V5_SCHEMA,
  PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA,
  PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA,
  publicLoungeServerReviewAttestationV5PayloadCanonical,
} from "../local-ai/shared/public-lounge-attestation-v5-canonical.mjs";
import {
  validatePublicLoungeServerEligibilityRequestV5,
} from "../lib/novel-ai/public-lounge/contract.ts";
import {
  createPublicLoungeAttestationPublicationFromWholeNovelReview,
  createPublicLoungePublicationFromWholeNovelReview,
  createPublicLoungeServerEligibilityRequestV5,
} from "../lib/novel-ai/public-lounge/client.ts";
import { PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION } from "../lib/novel-ai/public-lounge/types.ts";
import {
  createEd25519PublicLoungeEligibilityReviewerV5,
  publicLoungeServerReviewAttestationV5Payload,
} from "../lib/novel-ai/public-lounge/eligibility-signature.ts";
import {
  canonicalizePublicLoungeInlineText,
  canonicalizePublicLoungeProseText,
} from "../local-ai/shared/public-lounge-publication-canonical.mjs";
import {
  wholeNovelCompletionFingerprintPayload,
} from "../local-ai/shared/whole-novel-completion-fingerprint.mjs";

const PREVIEW_ORIGIN = "https://trusted-producer-preview.vercel.app";
const PRODUCTION_ORIGIN = "https://novel-orcin.vercel.app";
const PRODUCTION_MIRROR_ORIGIN = "https://novel-lqtechs-projects.vercel.app";
const NOW = "2026-09-04T00:00:00.000Z";
let COMPLETION_FINGERPRINT = "";
const MODEL_DIGEST = "b".repeat(64);
const EXPECTED_TARGET_DIGEST = "c".repeat(64);
const PREVIEW_KEY_ID = "novel-pl-preview-contract-v1";
const PREVIEW_AUDIENCE = "novel-public-lounge:preview";
const PRIVATE_KEY_PEM_HEADER = `-----${["BEGIN", "PRIVATE", "KEY"].join(" ")}-----`;
const DIMENSION_KEYS = Object.freeze([
  "plot_coherence",
  "character_arcs",
  "world_canon_consistency",
  "pacing",
  "prose_dialogue",
  "foreshadowing_payoff",
  "ending",
]);
const PRIMARY_JUDGE_ROLES = Object.freeze([
  "literary-editor",
  "continuity-editor",
  "genre-reader",
]);

const results = [];

async function test(name, work) {
  try {
    await work();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    console.error(`FAIL ${name}:`, error);
  }
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createEphemeralKeyMaterial() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const privateKeyDerBase64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  return {
    privateKey,
    publicKeyPem,
    fingerprint: sha256Bytes(publicKeyDer),
    privateSentinels: [privateKeyPem, privateKeyDerBase64],
  };
}

const keyMaterial = createEphemeralKeyMaterial();

function chapterBody(value) {
  return value.trim();
}

const PUBLIC_CHAPTERS = Object.freeze([
  Object.freeze({
    chapterNumber: 1,
    title: "雨夜來信",
    body: chapterBody("雨停後，林澄把最後一封信交還館長。她確認門外已經天亮，也終於說出隱瞞多年的真相。"),
    official: true,
  }),
  Object.freeze({
    chapterNumber: 2,
    title: "歸途",
    body: chapterBody("晨鐘響起時，眾人依約離開舊館。林澄燒掉偽造的名冊，帶著真正的帳本回家，故事至此完結。"),
    official: true,
  }),
]);

function completionSnapshot(publicChapters = PUBLIC_CHAPTERS) {
  return {
    project: { id: "producer-contract-work" },
    chapters: publicChapters.map((chapter, index) => ({
      schemaVersion: "novel-domain-v1",
      id: `producer-contract-chapter-${index + 1}`,
      projectId: "producer-contract-work",
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
      revision: 1,
      source: "user",
      provenance: {
        source: "user",
        actor: "author",
        createdAt: "2026-09-03T00:00:00.000Z",
      },
      title: chapter.title,
      order: index + 1,
      content: chapter.body,
      summary: null,
      status: "completed",
    })),
    characters: [],
    relationships: [],
    worldRules: [],
    storyBible: null,
    storyState: null,
    timeline: [],
    worlds: [],
    offstageCharacterNames: [],
  };
}

const BASE_COMPLETION_SNAPSHOT = completionSnapshot();
COMPLETION_FINGERPRINT = sha256Bytes(
  wholeNovelCompletionFingerprintPayload(BASE_COMPLETION_SNAPSHOT),
);

function publication() {
  return {
    schemaVersion: PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA,
    title: "雨夜帳本",
    authorByline: "測試作者",
    storyLibrarySchemaVersion: "story-library-v1",
    shelfId: "group-1",
    primaryTopicId: "topic-mystery",
    topicIds: ["topic-mystery", "topic-family"],
    completionStatus: "completed",
    chapterCount: PUBLIC_CHAPTERS.length,
    wordCount: PUBLIC_CHAPTERS.reduce(
      (total, chapter) => total + chapter.body.replace(/\s/gu, "").length,
      0,
    ),
    completedAt: "2026-09-03T00:00:00.000Z",
    fullSynopsis: "一封遲到多年的信，迫使守館人與返鄉女子在雨夜交出各自隱藏的真相。",
    publicChapters: PUBLIC_CHAPTERS.map((chapter) => ({ ...chapter })),
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
  };
}

function request(overrides = {}) {
  return {
    schemaVersion: PRIVATE_HUB_PUBLIC_LOUNGE_REQUEST_SCHEMA,
    workId: "producer-contract-work",
    revisionId: COMPLETION_FINGERPRINT,
    completionFingerprint: COMPLETION_FINGERPRINT,
    completionSnapshot: structuredClone(BASE_COMPLETION_SNAPSHOT),
    intent: "publish",
    targetPublicationId: null,
    expectedTargetVersionId: null,
    expectedTargetPublicationDigest: null,
    publication: publication(),
    ...overrides,
  };
}

function scores(score, overrides = {}) {
  return Object.fromEntries(DIMENSION_KEYS.map((key) => [key, overrides[key] ?? score]));
}

function trustedReview({
  score = 82,
  scoreOverrides = {},
  hiddenDraftResidueDetected = false,
  publicSafetyPassed = true,
  completenessPassed = true,
  privacyCopyrightPassed = true,
  reviewedChapterNumbers = [1, 2],
} = {}) {
  return {
    modelId: "qwen2.5:3b",
    modelDigest: MODEL_DIGEST,
    judges: PRIMARY_JUDGE_ROLES.map((judgeRole) => ({
      judgeRole,
      reviewedChapterNumbers: [...reviewedChapterNumbers],
      dimensionScores: scores(score, scoreOverrides),
      compliance: {
        publicSafetyPassed,
        completenessPassed,
        privacyCopyrightPassed,
        hiddenDraftResidueDetected,
      },
    })),
  };
}

function producer({ review = trustedReview(), keyProvider } = {}) {
  return createPublicLoungeAttestationProducer({
    runtimeDir: path.join(os.tmpdir(), "novel-producer-contract-unused"),
    productionOrigins: [PRODUCTION_ORIGIN, PRODUCTION_MIRROR_ORIGIN],
    producerVersion: PRIVATE_HUB_PUBLIC_LOUNGE_PRODUCER_VERSION,
    audiences: {
      preview: PREVIEW_AUDIENCE,
      production: "novel-public-lounge:production",
    },
    keyIds: {
      preview: PREVIEW_KEY_ID,
      production: "novel-pl-production-contract-v1",
    },
    keyProvider: keyProvider ?? (async () => ({
      privateKey: keyMaterial.privateKey,
      fingerprint: keyMaterial.fingerprint,
    })),
    now: () => new Date(NOW),
    reviewPublication: async () => structuredClone(review),
  });
}

function reviewer() {
  return createEd25519PublicLoungeEligibilityReviewerV5({
    publicKeyPem: keyMaterial.publicKeyPem,
    keyId: PREVIEW_KEY_ID,
    environment: "preview",
    audience: PREVIEW_AUDIENCE,
    producerVersion: PRIVATE_HUB_PUBLIC_LOUNGE_PRODUCER_VERSION,
    rubricVersion: PUBLIC_LOUNGE_RUBRIC_VERSION,
    now: () => NOW,
  });
}

function productionReviewer() {
  return createEd25519PublicLoungeEligibilityReviewerV5({
    publicKeyPem: keyMaterial.publicKeyPem,
    keyId: "novel-pl-production-contract-v1",
    environment: "production",
    audience: "novel-public-lounge:production",
    producerVersion: PRIVATE_HUB_PUBLIC_LOUNGE_PRODUCER_VERSION,
    rubricVersion: PUBLIC_LOUNGE_RUBRIC_VERSION,
    now: () => NOW,
  });
}

function reviewerInput(sourceRequest, attestation) {
  const { schemaVersion: _publicationSchema, ...publicationFields } = sourceRequest.publication;
  return {
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA,
    completionFingerprint: sourceRequest.completionFingerprint,
    workId: sourceRequest.workId,
    revisionId: sourceRequest.revisionId,
    intent: sourceRequest.intent,
    targetPublicationId: sourceRequest.targetPublicationId,
    expectedTargetVersionId: sourceRequest.expectedTargetVersionId,
    expectedTargetPublicationDigest: sourceRequest.expectedTargetPublicationDigest,
    ...publicationFields,
    serverAttestation: attestation,
    trustedServerReviewConsent: true,
  };
}

async function expectCode(work, code, status) {
  let caught = null;
  try {
    await work();
  } catch (error) {
    caught = error;
  }
  assert(caught, `expected ${code}`);
  assert.equal(caught.code, code);
  if (status !== undefined) assert.equal(caught.status, status);
  return caught;
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function json(response) {
  return { status: response.status, body: await response.json().catch(() => null) };
}

await test("browser request has no score and trusted 82 is the only signed score", async () => {
  const input = request();
  assert.equal(Object.hasOwn(input, "qualityScore"), false);
  assert.equal(Object.hasOwn(input.publication, "qualityScore"), false);
  let reviewedInput = null;
  const signer = createPublicLoungeAttestationProducer({
    runtimeDir: path.join(os.tmpdir(), "novel-producer-contract-unused"),
    productionOrigin: PRODUCTION_ORIGIN,
    producerVersion: PRIVATE_HUB_PUBLIC_LOUNGE_PRODUCER_VERSION,
    audiences: { preview: PREVIEW_AUDIENCE, production: "novel-public-lounge:production" },
    keyIds: { preview: PREVIEW_KEY_ID, production: "novel-pl-production-contract-v1" },
    keyProvider: async () => ({
      privateKey: keyMaterial.privateKey,
      fingerprint: keyMaterial.fingerprint,
    }),
    now: () => new Date(NOW),
    randomId: () => "contract-attestation-id-0001",
    reviewPublication: async (value) => {
      reviewedInput = structuredClone(value);
      return trustedReview({ score: 82 });
    },
  });
  const result = await signer.issue(input, { origin: PREVIEW_ORIGIN });
  assert.equal(result.schemaVersion, PRIVATE_HUB_PUBLIC_LOUNGE_RESPONSE_SCHEMA);
  assert.equal(result.ok, true);
  assert.equal(result.attestation.schemaVersion, PUBLIC_LOUNGE_ATTESTATION_V5_SCHEMA);
  assert.equal(result.attestation.qualityScore, 82);
  assert.equal(result.attestation.intent, "publish");
  assert.equal(result.attestation.targetPublicationId, null);
  assert.equal(result.attestation.expectedTargetVersionId, null);
  assert.equal(result.attestation.expectedTargetPublicationDigest, null);
  assert.equal(Object.hasOwn(reviewedInput, "qualityScore"), false);
  assert.equal(Object.hasOwn(reviewedInput.publication, "qualityScore"), false);
  assert.equal(
    publicLoungeServerReviewAttestationV5Payload(result.attestation),
    publicLoungeServerReviewAttestationV5PayloadCanonical(result.attestation),
  );
  assert.equal(
    Date.parse(result.attestation.expiresAt) - Date.parse(result.attestation.issuedAt),
    PUBLIC_LOUNGE_ATTESTATION_TTL_MS,
  );
  const reviewed = await reviewer().review(reviewerInput(input, result.attestation));
  assert.equal(reviewed.qualityScore, 82);
  assert.equal(reviewed.intent, "publish");
});

await test("browser Hub and Vercel share CRLF NFD whitespace and bidi canonical bytes", async () => {
  const rawTitle = "  Cafe\u0301\t  finale\u202E\u0007  ";
  const rawByline = "  Lin\t\tZhou\u2067  ";
  const rawChapterTitle = "  Re\u0301union\t  at dawn\u202D  ";
  const rawBody = "  Cafe\u0301  returned\t \r\nwith\u202E\u0007  two  letters.  ";
  const rawSynopsis = "  Cafe\u0301 waited\t \r\nthrough\u2066\u0007  dawn.  ";
  const canonicalTitle = "Caf\u00e9 finale";
  const canonicalByline = "Lin Zhou";
  const canonicalChapterTitle = "R\u00e9union at dawn";
  const canonicalBody = "Caf\u00e9  returned\nwith  two  letters.";
  const canonicalSynopsis = "Caf\u00e9 waited\nthrough  dawn.";
  assert.equal(canonicalizePublicLoungeInlineText(rawTitle), canonicalTitle);
  assert.equal(canonicalizePublicLoungeInlineText(rawByline), canonicalByline);
  assert.equal(canonicalizePublicLoungeInlineText(rawChapterTitle), canonicalChapterTitle);
  assert.equal(canonicalizePublicLoungeProseText(rawBody), canonicalBody);
  assert.equal(canonicalizePublicLoungeProseText(rawSynopsis), canonicalSynopsis);

  const canonicalWordCount = canonicalBody.replace(/\s/gu, "").length;
  const canonicalSnapshot = completionSnapshot([{
    chapterNumber: 1,
    title: rawChapterTitle,
    body: rawBody,
    official: true,
  }]);
  const canonicalFingerprint = sha256Bytes(
    wholeNovelCompletionFingerprintPayload(canonicalSnapshot),
  );
  const browserReview = {
    completion: { completionFingerprint: canonicalFingerprint },
    publicMetadata: {
      title: rawTitle,
      synopsis: rawSynopsis,
      nonWhitespaceCharacters: canonicalWordCount,
      chapterCount: 1,
      completedAt: "2026-09-03T00:00:00.000Z",
    },
  };
  const selectedOfficialChapters = [{
    chapterNumber: 1,
    title: rawChapterTitle,
    body: rawBody,
  }];
  const browserPublication = createPublicLoungeAttestationPublicationFromWholeNovelReview({
    review: browserReview,
    authorByline: rawByline,
    topicIds: ["classic-topic-002"],
    fullSynopsis: rawSynopsis,
    selectedOfficialChapters,
    explicitConsent: true,
    authorRightsDeclaration: true,
  });
  assert.equal(browserPublication.title, canonicalTitle);
  assert.equal(browserPublication.authorByline, canonicalByline);
  assert.equal(browserPublication.fullSynopsis, canonicalSynopsis);
  assert.equal(browserPublication.publicChapters[0].title, canonicalChapterTitle);
  assert.equal(browserPublication.publicChapters[0].body, canonicalBody);

  const rawProducerPublication = {
    ...browserPublication,
    title: rawTitle,
    authorByline: rawByline,
    fullSynopsis: rawSynopsis,
    publicChapters: [{
      chapterNumber: 1,
      title: rawChapterTitle,
      body: rawBody,
      official: true,
    }],
  };
  const sourceRequest = request({
    revisionId: canonicalFingerprint,
    completionFingerprint: canonicalFingerprint,
    completionSnapshot: canonicalSnapshot,
    publication: rawProducerPublication,
  });
  const signed = await producer({
    review: trustedReview({ reviewedChapterNumbers: [1] }),
  }).issue(sourceRequest, { origin: PREVIEW_ORIGIN });

  const vercelParsedRawRequest = validatePublicLoungeServerEligibilityRequestV5(
    reviewerInput(sourceRequest, signed.attestation),
  );
  assert.equal(vercelParsedRawRequest.title, canonicalTitle);
  assert.equal(vercelParsedRawRequest.authorByline, canonicalByline);
  assert.equal(vercelParsedRawRequest.fullSynopsis, canonicalSynopsis);
  assert.equal(vercelParsedRawRequest.publicChapters[0].title, canonicalChapterTitle);
  assert.equal(vercelParsedRawRequest.publicChapters[0].body, canonicalBody);
  await reviewer().review(vercelParsedRawRequest);

  const browserEligibilityRequest = createPublicLoungeServerEligibilityRequestV5({
    projectId: sourceRequest.workId,
    completionFingerprint: canonicalFingerprint,
    publication: browserPublication,
    intent: "publish",
    targetPublicationId: null,
    expectedTargetVersionId: null,
    expectedTargetPublicationDigest: null,
    serverAttestation: signed.attestation,
  });
  const vercelParsedBrowserRequest = validatePublicLoungeServerEligibilityRequestV5(
    browserEligibilityRequest,
  );
  assert.deepEqual(
    {
      title: vercelParsedBrowserRequest.title,
      authorByline: vercelParsedBrowserRequest.authorByline,
      fullSynopsis: vercelParsedBrowserRequest.fullSynopsis,
      publicChapters: vercelParsedBrowserRequest.publicChapters,
    },
    {
      title: vercelParsedRawRequest.title,
      authorByline: vercelParsedRawRequest.authorByline,
      fullSynopsis: vercelParsedRawRequest.fullSynopsis,
      publicChapters: vercelParsedRawRequest.publicChapters,
    },
  );
  await reviewer().review(vercelParsedBrowserRequest);

  const finalPublication = createPublicLoungePublicationFromWholeNovelReview({
    review: browserReview,
    authorByline: rawByline,
    topicIds: ["classic-topic-002"],
    fullSynopsis: rawSynopsis,
    selectedOfficialChapters,
    explicitConsent: true,
    authorRightsDeclaration: true,
    eligibilityProof: {
      schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION,
      eligibilityTicket: "E".repeat(43),
      expiresAt: signed.attestation.expiresAt,
      backendId: "private-ai-hub",
      modelId: signed.attestation.modelId,
      qualityAssurance: "private_ai_hub_verified",
      completionFingerprint: canonicalFingerprint,
      qualityScore: signed.attestation.qualityScore,
      qualityBreakdown: signed.attestation.qualityBreakdown,
    },
  });
  assert.equal(finalPublication.title, browserPublication.title);
  assert.equal(finalPublication.authorByline, browserPublication.authorByline);
  assert.equal(finalPublication.fullSynopsis, browserPublication.fullSynopsis);
  assert.deepEqual(finalPublication.publicChapters, browserPublication.publicChapters);
});

await test("browser score injection is rejected instead of becoming trusted input", async () => {
  const signer = producer();
  await expectCode(
    () => signer.issue({ ...request(), qualityScore: 100 }, { origin: PREVIEW_ORIGIN }),
    "PUBLIC_LOUNGE_PRODUCER_REQUEST_INVALID",
    400,
  );
  await expectCode(
    () => signer.issue({
      ...request(),
      publication: { ...publication(), qualityScore: 100 },
    }, { origin: PREVIEW_ORIGIN }),
    "PUBLIC_LOUNGE_PRODUCER_REQUEST_INVALID",
    400,
  );
});

await test("Hub recomputes the complete snapshot fingerprint and rejects stale bound state", async () => {
  let reviewCalls = 0;
  const signer = createPublicLoungeAttestationProducer({
    runtimeDir: path.join(os.tmpdir(), "novel-producer-completion-contract"),
    productionOrigins: [PRODUCTION_ORIGIN, PRODUCTION_MIRROR_ORIGIN],
    keyIds: { preview: PREVIEW_KEY_ID, production: "novel-pl-production-contract-v1" },
    audiences: { preview: PREVIEW_AUDIENCE, production: "novel-public-lounge:production" },
    keyProvider: async () => ({
      privateKey: keyMaterial.privateKey,
      fingerprint: keyMaterial.fingerprint,
    }),
    reviewPublication: async () => {
      reviewCalls += 1;
      return trustedReview();
    },
  });
  const mutations = [
    (snapshot) => { snapshot.project.title = "已改標題"; },
    (snapshot) => { snapshot.storyBible = { id: "changed-story-bible" }; },
    (snapshot) => { snapshot.characters.push({ id: "changed-character", name: "新人" }); },
    (snapshot) => { snapshot.chapters[0].content += "正文已被改動。"; },
  ];
  for (const mutate of mutations) {
    const input = request();
    mutate(input.completionSnapshot);
    await expectCode(
      () => signer.issue(input, { origin: PREVIEW_ORIGIN }),
      "PUBLIC_LOUNGE_PRODUCER_COMPLETION_STATE_INVALID",
      403,
    );
  }
  const mismatchedPublication = request();
  mismatchedPublication.publication.publicChapters[0].body += "公開包已被改動。";
  mismatchedPublication.publication.wordCount = mismatchedPublication.publication.publicChapters
    .reduce((total, chapter) => total + chapter.body.replace(/\s/gu, "").length, 0);
  await expectCode(
    () => signer.issue(mismatchedPublication, { origin: PREVIEW_ORIGIN }),
    "PUBLIC_LOUNGE_PRODUCER_COMPLETION_STATE_INVALID",
    403,
  );
  assert.equal(reviewCalls, 0);
});

await test("both exact production aliases use Production trust and reviewer", async () => {
  const signer = producer();
  for (const origin of [PRODUCTION_ORIGIN, PRODUCTION_MIRROR_ORIGIN]) {
    const status = await signer.status(origin);
    assert.equal(status.status, "ready");
    assert.equal(status.environment, "production");
    assert.equal(status.audience, "novel-public-lounge:production");
    assert.equal(status.keyId, "novel-pl-production-contract-v1");
    const input = request();
    const signed = await signer.issue(input, { origin });
    assert.equal(signed.attestation.environment, "production");
    assert.equal(signed.attestation.audience, "novel-public-lounge:production");
    await productionReviewer().review(reviewerInput(input, signed.attestation));
  }
  assert.equal((await signer.status(PREVIEW_ORIGIN)).environment, "preview");
});

await test("four judges plus discovery remain below the client attestation deadline", async () => {
  assert.ok(
    PRIVATE_HUB_MODEL_DISCOVERY_SERVER_TIMEOUT_MS
      + (4 * PRIVATE_HUB_PUBLIC_LOUNGE_JUDGE_TIMEOUT_MS)
      < PRIVATE_HUB_PUBLIC_LOUNGE_ATTESTATION_TIMEOUT_MS,
  );
});

await test("trusted low score hard gate hidden draft and incomplete coverage all fail closed", async () => {
  await expectCode(
    () => producer({ review: trustedReview({ score: 79 }) }).issue(request(), { origin: PREVIEW_ORIGIN }),
    "PUBLIC_LOUNGE_SCORE_NOT_QUALIFIED",
    422,
  );
  await expectCode(
    () => producer({
      review: trustedReview({ score: 90, scoreOverrides: { plot_coherence: 59 } }),
    }).issue(request(), { origin: PREVIEW_ORIGIN }),
    "PUBLIC_LOUNGE_REVIEW_HARD_GATE_FAILED",
    403,
  );
  await expectCode(
    () => producer({
      review: trustedReview({ hiddenDraftResidueDetected: true }),
    }).issue(request(), { origin: PREVIEW_ORIGIN }),
    "PUBLIC_LOUNGE_REVIEW_HARD_GATE_FAILED",
    403,
  );
  await expectCode(
    () => producer({
      review: trustedReview({ reviewedChapterNumbers: [1] }),
    }).issue(request(), { origin: PREVIEW_ORIGIN }),
    "PUBLIC_LOUNGE_PRODUCER_FULL_COVERAGE_REQUIRED",
    403,
  );
});

await test("missing key is unavailable and never invokes the trusted reviewer", async () => {
  let reviewCalls = 0;
  const signer = createPublicLoungeAttestationProducer({
    runtimeDir: path.join(os.tmpdir(), "novel-producer-contract-missing-key"),
    productionOrigin: PRODUCTION_ORIGIN,
    keyProvider: async () => null,
    reviewPublication: async () => {
      reviewCalls += 1;
      return trustedReview();
    },
  });
  const status = await signer.status(PREVIEW_ORIGIN);
  assert.equal(status.status, "unavailable");
  assert.equal(status.keyId, null);
  assert.equal(status.publicKeyFingerprint, null);
  await expectCode(
    () => signer.issue(request(), { origin: PREVIEW_ORIGIN }),
    "PUBLIC_LOUNGE_PRODUCER_UNAVAILABLE",
    503,
  );
  assert.equal(reviewCalls, 0);
});

await test("each JIT issuance has a unique attestation id", async () => {
  const signer = producer();
  const first = await signer.issue(request(), { origin: PREVIEW_ORIGIN });
  const second = await signer.issue(request(), { origin: PREVIEW_ORIGIN });
  assert.notEqual(first.attestation.attestationId, second.attestation.attestationId);
  assert.match(first.attestation.attestationId, /^[A-Za-z0-9_-]{16,128}$/u);
  assert.match(second.attestation.attestationId, /^[A-Za-z0-9_-]{16,128}$/u);
});

await test("overwrite attestation binds the exact target while publish target stays null", async () => {
  const overwrite = request({
    intent: "overwrite",
    targetPublicationId: "novel_producercontract01",
    expectedTargetVersionId: "version_producercontract0001",
    expectedTargetPublicationDigest: EXPECTED_TARGET_DIGEST,
  });
  const result = await producer().issue(overwrite, { origin: PREVIEW_ORIGIN });
  assert.equal(result.attestation.intent, "overwrite");
  assert.equal(result.attestation.targetPublicationId, overwrite.targetPublicationId);
  assert.equal(result.attestation.expectedTargetVersionId, overwrite.expectedTargetVersionId);
  assert.equal(
    result.attestation.expectedTargetPublicationDigest,
    overwrite.expectedTargetPublicationDigest,
  );
  const reviewed = await reviewer().review(reviewerInput(overwrite, result.attestation));
  assert.equal(reviewed.intent, "overwrite");
  assert.equal(reviewed.targetPublicationId, overwrite.targetPublicationId);
});

await test("private key material never appears in producer status or success response", async () => {
  const signer = producer();
  const serialized = JSON.stringify({
    status: await signer.status(PREVIEW_ORIGIN),
    response: await signer.issue(request(), { origin: PREVIEW_ORIGIN }),
  });
  for (const sentinel of keyMaterial.privateSentinels) {
    assert.equal(serialized.includes(sentinel), false);
  }
  assert.equal(serialized.includes(PRIVATE_KEY_PEM_HEADER.slice(5, -5)), false);
});

await test("explicit key provisioning is idempotent and exports only public identity", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "novel-producer-key-contract-"));
  const portableProvisioner = createPublicLoungeAttestationKeyProvisioner({ platform: "posix" });
  try {
    const created = await portableProvisioner({
      environment: "preview",
      runtimeDir,
    });
    const repeated = await portableProvisioner({
      environment: "preview",
      runtimeDir,
    });
    assert.equal(created.status, "created");
    assert.equal(repeated.status, "already_exists");
    assert.equal(created.keyId, repeated.keyId);
    assert.equal(created.publicKeyFingerprint, repeated.publicKeyFingerprint);
    assert.equal(created.privateKeyExported, false);
    assert.equal(repeated.privateKeyExported, false);
    assert.match(created.publicKeyPem, /^-----BEGIN PUBLIC KEY-----/u);
    const serialized = JSON.stringify({ created, repeated });
    assert.equal(serialized.includes(PRIVATE_KEY_PEM_HEADER.slice(5, -5)), false);
    const privateKeyFile = path.join(
      runtimeDir,
      "public-lounge-attestation",
      "preview.ed25519-private.pem",
    );
    assert.ok((await readFile(privateKeyFile, "utf8")).startsWith(PRIVATE_KEY_PEM_HEADER));
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

async function provisioningTempFiles(runtimeDir) {
  const keyDirectory = path.join(runtimeDir, "public-lounge-attestation");
  const entries = await readdir(keyDirectory).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((entry) => entry.endsWith(".tmp"));
}

await test("Windows provisioning seals an empty temp before writing private key material", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "novel-producer-key-seal-order-"));
  let sealedPath = null;
  const windowsProvisioner = createPublicLoungeAttestationKeyProvisioner({
    platform: "win32",
    secureWindowsFile: async (file) => {
      sealedPath = file;
      assert.equal(await readFile(file, "utf8"), "");
    },
  });
  try {
    const created = await windowsProvisioner({ environment: "preview", runtimeDir });
    const keyFile = path.join(
      runtimeDir,
      "public-lounge-attestation",
      "preview.ed25519-private.pem",
    );
    assert.equal(created.status, "created");
    assert.equal(path.dirname(sealedPath), path.dirname(keyFile));
    assert.notEqual(sealedPath, keyFile);
    assert.ok((await readFile(keyFile, "utf8")).startsWith(PRIVATE_KEY_PEM_HEADER));
    assert.deepEqual(await provisioningTempFiles(runtimeDir), []);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

await test("Windows ACL failure never publishes a new private key and removes its temp file", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "novel-producer-key-acl-failure-"));
  let sealedPath = null;
  const provisionWithAclFailure = createPublicLoungeAttestationKeyProvisioner({
    platform: "win32",
    secureWindowsFile: async (file) => {
      sealedPath = file;
      throw new Error("INJECTED_WINDOWS_ACL_FAILURE");
    },
  });
  try {
    await expectCode(
      () => provisionWithAclFailure({ environment: "preview", runtimeDir }),
      "ATTESTATION_KEY_ACL_HARDEN_FAILED",
    );
    const keyFile = path.join(
      runtimeDir,
      "public-lounge-attestation",
      "preview.ed25519-private.pem",
    );
    await assert.rejects(() => readFile(keyFile), { code: "ENOENT" });
    assert.equal(path.dirname(sealedPath), path.dirname(keyFile));
    assert.notEqual(sealedPath, keyFile);
    assert.deepEqual(await provisioningTempFiles(runtimeDir), []);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

await test("Windows ACL failure while resealing leaves the existing private key untouched", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "novel-producer-key-reseal-failure-"));
  const keyFile = path.join(
    runtimeDir,
    "public-lounge-attestation",
    "preview.ed25519-private.pem",
  );
  const portableProvisioner = createPublicLoungeAttestationKeyProvisioner({ platform: "posix" });
  try {
    await portableProvisioner({ environment: "preview", runtimeDir });
    const originalPrivateKey = await readFile(keyFile, "utf8");
    const provisionWithAclFailure = createPublicLoungeAttestationKeyProvisioner({
      platform: "win32",
      secureWindowsFile: async () => {
        throw new Error("INJECTED_WINDOWS_ACL_FAILURE");
      },
    });
    await expectCode(
      () => provisionWithAclFailure({ environment: "preview", runtimeDir }),
      "ATTESTATION_KEY_ACL_HARDEN_FAILED",
    );
    assert.equal(await readFile(keyFile, "utf8"), originalPrivateKey);
    assert.deepEqual(await provisioningTempFiles(runtimeDir), []);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

await test("atomic reseal replacement failure preserves the existing key and removes its temp file", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "novel-producer-key-replace-failure-"));
  const keyFile = path.join(
    runtimeDir,
    "public-lounge-attestation",
    "preview.ed25519-private.pem",
  );
  const portableProvisioner = createPublicLoungeAttestationKeyProvisioner({ platform: "posix" });
  try {
    await portableProvisioner({ environment: "preview", runtimeDir });
    const originalPrivateKey = await readFile(keyFile, "utf8");
    const provisionWithReplaceFailure = createPublicLoungeAttestationKeyProvisioner({
      platform: "win32",
      secureWindowsFile: async () => undefined,
      renameFile: async () => {
        const error = new Error("INJECTED_ATOMIC_REPLACE_FAILURE");
        error.code = "EACCES";
        throw error;
      },
    });
    await assert.rejects(
      () => provisionWithReplaceFailure({ environment: "preview", runtimeDir }),
      { code: "EACCES" },
    );
    assert.equal(await readFile(keyFile, "utf8"), originalPrivateKey);
    assert.deepEqual(await provisioningTempFiles(runtimeDir), []);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

await test("existing key is resealed through a same-directory temp before atomic replacement", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "novel-producer-key-reseal-success-"));
  const keyFile = path.join(
    runtimeDir,
    "public-lounge-attestation",
    "preview.ed25519-private.pem",
  );
  const portableProvisioner = createPublicLoungeAttestationKeyProvisioner({ platform: "posix" });
  try {
    const created = await portableProvisioner({ environment: "preview", runtimeDir });
    const originalPrivateKey = await readFile(keyFile, "utf8");
    let sealedPath = null;
    const windowsProvisioner = createPublicLoungeAttestationKeyProvisioner({
      platform: "win32",
      secureWindowsFile: async (file) => {
        sealedPath = file;
      },
    });
    const resealed = await windowsProvisioner({ environment: "preview", runtimeDir });
    assert.equal(resealed.status, "already_exists");
    assert.equal(resealed.publicKeyFingerprint, created.publicKeyFingerprint);
    assert.equal(resealed.privateKeyAcl, "windows-owner-and-system-only");
    assert.equal(await readFile(keyFile, "utf8"), originalPrivateKey);
    assert.equal(path.dirname(sealedPath), path.dirname(keyFile));
    assert.notEqual(sealedPath, keyFile);
    assert.deepEqual(await provisioningTempFiles(runtimeDir), []);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

await test("loopback route requires exact origin pairing authorization and CSRF", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "novel-producer-server-contract-"));
  const port = await reserveLoopbackPort();
  const signer = producer();
  const hub = createPrivateHubServer({
    port,
    testMode: true,
    runtimeDir,
    pairingFile: path.join(runtimeDir, "pairing.json"),
    accessLogPath: path.join(runtimeDir, "access.jsonl"),
    extraOrigins: PREVIEW_ORIGIN,
    trustedAutoSessionOrigins: false,
    publicLoungeAttestationProducer: signer,
  });
  const base = `http://127.0.0.1:${port}`;
  const headers = (extra = {}) => ({
    Origin: PREVIEW_ORIGIN,
    "X-Private-Hub-Protocol": PRIVATE_HUB_PROTOCOL,
    ...extra,
  });
  try {
    await hub.start();
    const health = await json(await fetch(`${base}/health`, { headers: headers() }));
    assert.equal(health.status, 200);
    assert.equal(health.body.publicLoungeAttestationProducer.status, "ready");
    assert.equal(health.body.publicLoungeAttestationProducer.environment, "preview");
    assert.equal(health.body.publicLoungeAttestationProducer.keyId, PREVIEW_KEY_ID);

    const lookalike = await json(await fetch(`${base}/health`, {
      headers: {
        Origin: `${PREVIEW_ORIGIN}.evil.example`,
        "X-Private-Hub-Protocol": PRIVATE_HUB_PROTOCOL,
      },
    }));
    assert.equal(lookalike.status, 403);
    assert.equal(lookalike.body.errorCode, "BRIDGE_ORIGIN_NOT_ALLOWED");

    const unauthenticated = await json(await fetch(`${base}/public-lounge/attest/v5`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(request()),
    }));
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.body.errorCode, "BRIDGE_NOT_PAIRED");

    const pairing = await json(await fetch(`${base}/pair/request`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: "{}",
    }));
    assert.equal(pairing.status, 201);
    const session = await json(await fetch(`${base}/pair/confirm`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        pairingId: pairing.body.pairingId,
        code: pairing.body.testCode,
      }),
    }));
    assert.equal(session.status, 200);

    const missingCsrf = await json(await fetch(`${base}/public-lounge/attest/v5`, {
      method: "POST",
      headers: headers({
        Authorization: `Bearer ${session.body.token}`,
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(request()),
    }));
    assert.equal(missingCsrf.status, 403);
    assert.equal(missingCsrf.body.errorCode, "LOCAL_SECURITY_POLICY_VIOLATION");

    const signed = await json(await fetch(`${base}/public-lounge/attest/v5`, {
      method: "POST",
      headers: headers({
        Authorization: `Bearer ${session.body.token}`,
        "X-Hub-CSRF": session.body.csrf,
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(request()),
    }));
    assert.equal(signed.status, 201);
    assert.equal(signed.body.attestation.qualityScore, 82);
    const exposed = JSON.stringify({
      health: health.body,
      signed: signed.body,
      logs: hub.logs,
      accessLogs: hub.accessLogs,
    });
    for (const sentinel of keyMaterial.privateSentinels) {
      assert.equal(exposed.includes(sentinel), false);
    }
    assert.equal(exposed.includes(PRIVATE_KEY_PEM_HEADER.slice(5, -5)), false);
  } finally {
    await hub.stop().catch(() => undefined);
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

await test("trusted judge timeout covers a stalled Ollama response body", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "novel-producer-body-timeout-"));
  const hubPort = await reserveLoopbackPort();
  const ollamaPort = await reserveLoopbackPort();
  const originalFetch = globalThis.fetch;
  let resolveStalledResponseClosed;
  const stalledResponseClosed = new Promise((resolve) => {
    resolveStalledResponseClosed = resolve;
  });
  const ollama = http.createServer((incoming, outgoing) => {
    incoming.resume();
    if (incoming.url === "/api/tags") {
      outgoing.writeHead(200, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({
        models: [{
          name: "qwen2.5:3b",
          model: "qwen2.5:3b",
          digest: MODEL_DIGEST,
          size: 1_000_000,
          details: { family: "qwen2", parameter_size: "3B", quantization_level: "Q4_K_M" },
        }],
      }));
      return;
    }
    if (incoming.url === "/api/generate") {
      outgoing.once("close", resolveStalledResponseClosed);
      outgoing.writeHead(200, {
        "Content-Type": "application/json",
        "Transfer-Encoding": "chunked",
      });
      outgoing.write('{"response":"partial');
      return;
    }
    outgoing.writeHead(404, { "Content-Type": "application/json" });
    outgoing.end('{"error":"not found"}');
  });
  const hub = createPrivateHubServer({
    port: hubPort,
    testMode: true,
    runtimeDir,
    pairingFile: path.join(runtimeDir, "pairing.json"),
    accessLogPath: path.join(runtimeDir, "access.jsonl"),
    extraOrigins: PREVIEW_ORIGIN,
    trustedAutoSessionOrigins: false,
    publicLoungeJudgeTimeoutMs: 1_000,
    publicLoungeAttestationKeyIds: {
      preview: PREVIEW_KEY_ID,
      production: "novel-pl-production-contract-v1",
    },
    publicLoungeAttestationAudiences: {
      preview: PREVIEW_AUDIENCE,
      production: "novel-public-lounge:production",
    },
    publicLoungeAttestationKeyProvider: async () => ({
      privateKey: keyMaterial.privateKey,
      fingerprint: keyMaterial.fingerprint,
    }),
  });
  const base = `http://127.0.0.1:${hubPort}`;
  const headers = (extra = {}) => ({
    Origin: PREVIEW_ORIGIN,
    "X-Private-Hub-Protocol": PRIVATE_HUB_PROTOCOL,
    ...extra,
  });
  try {
    await new Promise((resolve, reject) => {
      ollama.once("error", reject);
      ollama.listen(ollamaPort, "127.0.0.1", () => {
        ollama.off("error", reject);
        resolve();
      });
    });
    globalThis.fetch = (input, init) => {
      const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (target.origin === "http://127.0.0.1:11434") {
        target.port = String(ollamaPort);
      }
      return originalFetch(target, init);
    };
    await hub.start();
    const pairing = await json(await originalFetch(`${base}/pair/request`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: "{}",
    }));
    const session = await json(await originalFetch(`${base}/pair/confirm`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        pairingId: pairing.body.pairingId,
        code: pairing.body.testCode,
      }),
    }));
    const startedAt = Date.now();
    const timedOut = await json(await originalFetch(`${base}/public-lounge/attest/v5`, {
      method: "POST",
      headers: headers({
        Authorization: `Bearer ${session.body.token}`,
        "X-Hub-CSRF": session.body.csrf,
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(request()),
    }));
    const elapsedMs = Date.now() - startedAt;
    assert.equal(timedOut.status, 504);
    assert.equal(timedOut.body.errorCode, "PUBLIC_LOUNGE_PRODUCER_TIMEOUT");
    assert(elapsedMs >= 750, `deadline fired too early: ${elapsedMs}ms`);
    assert(elapsedMs < 6_000, `stalled response body exceeded deadline: ${elapsedMs}ms`);
    let closeDeadline;
    try {
      await Promise.race([
        stalledResponseClosed,
        new Promise((_, reject) => {
          closeDeadline = setTimeout(
            () => reject(new Error("Ollama response stream was not aborted after the deadline.")),
            2_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(closeDeadline);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await hub.stop().catch(() => undefined);
    ollama.closeAllConnections?.();
    await new Promise((resolve) => ollama.close(() => resolve()));
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

const failed = results.filter((result) => result.status === "FAIL");
console.log(`PUBLIC_LOUNGE_ATTESTATION_PRODUCER_TESTS_${failed.length ? "FAIL" : "PASS"} ${results.length - failed.length}/${results.length}`);
if (failed.length) process.exitCode = 1;
