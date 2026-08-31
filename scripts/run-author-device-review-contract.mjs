import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  AUTHOR_DEVICE_REVIEW_ASSURANCE,
  AUTHOR_DEVICE_REVIEW_SCHEMA_VERSION,
  authorDeviceReviewAntiReplayIdentity,
  authorDeviceReviewDigest,
  buildAuthorDeviceReviewDeclaration,
  calculateAuthorDeviceReviewQualityScore,
  canonicalSerializeAuthorDeviceReview,
  evaluateAuthorDeviceReviewPublicationGate,
  validateAuthorDeviceReviewDeclaration,
} from "../lib/novel-ai/public-lounge/author-device-review.ts";
import { PublicLoungeError } from "../lib/novel-ai/public-lounge/contract.ts";
import { PublicLoungeService } from "../lib/novel-ai/public-lounge/service.ts";
import { normalizePublicLoungeTopicIds } from "../lib/novel-ai/public-lounge/taxonomy.ts";
import { PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION } from "../lib/novel-ai/public-lounge/types.ts";

const completionFingerprint = "a".repeat(64);
const modelDigest = "b".repeat(64);
const dimensions = {
  plot_coherence: 84,
  character_arcs: 82,
  world_canon_consistency: 80,
  pacing: 81,
  prose_dialogue: 83,
  foreshadowing_payoff: 79,
  ending: 85,
};
const qualityScore = calculateAuthorDeviceReviewQualityScore(dimensions);
assert.equal(qualityScore, 82);

const declaration = await buildAuthorDeviceReviewDeclaration({
  issuedAt: "2026-08-31T08:00:00.000Z",
  nonce: "author-device-nonce-0001",
  completionFingerprint,
  backendId: "browser-ai",
  modelId: "webllm/qwen-closed",
  modelDigest,
  fullCoverage: true,
  hardGatePassed: true,
  compliancePassed: true,
  criticalDimensionsPassed: true,
  qualityScore,
  dimensionScores: dimensions,
});
assert.equal(declaration.schemaVersion, AUTHOR_DEVICE_REVIEW_SCHEMA_VERSION);
assert.equal(declaration.assurance, AUTHOR_DEVICE_REVIEW_ASSURANCE);
assert.match(declaration.reviewDigest, /^[a-f0-9]{64}$/u);
assert.match(declaration.antiReplayIdentity, /^[a-f0-9]{64}$/u);
assert.equal("projectId" in declaration, false);
assert.equal("reviewId" in declaration, false);
assert.doesNotMatch(
  JSON.stringify(declaration),
  /"(?:projectId|reviewId|rawNovel|receipt|prompt|canon|trace|provenance|chapterText|novelText)"\s*:/iu,
);

const valid = await validateAuthorDeviceReviewDeclaration(declaration, {
  expectedCompletionFingerprint: completionFingerprint,
});
assert.equal(valid.valid, true);
assert.equal(valid.reasons.length, 0);

for (const [index, backendId] of ["browser-ai", "local-ollama", "private-ai-hub"].entries()) {
  const backendDeclaration = await buildAuthorDeviceReviewDeclaration({
    ...declaration,
    nonce: `author-device-backend-${index}`,
    backendId,
  });
  const result = await validateAuthorDeviceReviewDeclaration(backendDeclaration, {
    expectedCompletionFingerprint: completionFingerprint,
  });
  assert.equal(result.valid, true);
}

const reverseDimensions = Object.fromEntries(Object.entries(dimensions).reverse());
assert.equal(
  canonicalSerializeAuthorDeviceReview({ ...declaration, dimensionScores: reverseDimensions }),
  canonicalSerializeAuthorDeviceReview(declaration),
);

async function rebound(overrides = {}, extra = {}) {
  const candidate = structuredClone({ ...declaration, ...overrides, ...extra });
  candidate.reviewDigest = await authorDeviceReviewDigest(candidate);
  candidate.antiReplayIdentity = await authorDeviceReviewAntiReplayIdentity({
    issuedAt: candidate.issuedAt,
    nonce: candidate.nonce,
    completionFingerprint: candidate.completionFingerprint,
    reviewDigest: candidate.reviewDigest,
  });
  return candidate;
}

for (const gate of ["fullCoverage", "hardGatePassed", "compliancePassed", "criticalDimensionsPassed"]) {
  const forged = await rebound({ [gate]: false });
  const result = await validateAuthorDeviceReviewDeclaration(forged, {
    expectedCompletionFingerprint: completionFingerprint,
  });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((reason) => reason.endsWith("_required")));
}

const lowDimensions = Object.fromEntries(Object.keys(dimensions).map((key) => [key, 79]));
const lowScore = await rebound({
  dimensionScores: lowDimensions,
  qualityScore: calculateAuthorDeviceReviewQualityScore(lowDimensions),
});
const lowResult = await validateAuthorDeviceReviewDeclaration(lowScore, {
  expectedCompletionFingerprint: completionFingerprint,
});
assert.ok(lowResult.reasons.includes("quality_score_below_threshold"));

const wrongWeighting = await rebound({ qualityScore: 90 });
const wrongWeightingResult = await validateAuthorDeviceReviewDeclaration(wrongWeighting, {
  expectedCompletionFingerprint: completionFingerprint,
});
assert.ok(wrongWeightingResult.reasons.includes("weighted_score_mismatch"));

const invalidBackend = await rebound({ backendId: "external-open-ai" });
const invalidBackendResult = await validateAuthorDeviceReviewDeclaration(invalidBackend, {
  expectedCompletionFingerprint: completionFingerprint,
});
assert.ok(invalidBackendResult.reasons.includes("backend_invalid"));
const trustedAssuranceForgery = await rebound({ assurance: "platform_trusted_verified" });
const trustedAssuranceResult = await validateAuthorDeviceReviewDeclaration(trustedAssuranceForgery, {
  expectedCompletionFingerprint: completionFingerprint,
});
assert.ok(trustedAssuranceResult.reasons.includes("assurance_invalid"));

const criticalForgeryDimensions = { ...dimensions, plot_coherence: 59, pacing: 100, ending: 100 };
const criticalForgery = await rebound({
  dimensionScores: criticalForgeryDimensions,
  qualityScore: calculateAuthorDeviceReviewQualityScore(criticalForgeryDimensions),
});
const criticalForgeryResult = await validateAuthorDeviceReviewDeclaration(criticalForgery, {
  expectedCompletionFingerprint: completionFingerprint,
});
assert.ok(criticalForgeryResult.reasons.includes("critical_dimension_score_too_low"));

for (const forbidden of [
  { rawNovel: "完整小說正文" },
  { receipt: { taskId: "private" } },
  { promptPayload: "system prompt" },
  { privateCanon: "hidden canon" },
  { trace: ["private trace"] },
  { provenance: { executor: "hidden" } },
]) {
  const contaminated = await rebound({}, forbidden);
  const result = await validateAuthorDeviceReviewDeclaration(contaminated, {
    expectedCompletionFingerprint: completionFingerprint,
  });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("forbidden_private_content_field"));
}

const badModelDigest = await rebound({ modelDigest: "not-a-sha256" });
const badModelDigestResult = await validateAuthorDeviceReviewDeclaration(badModelDigest, {
  expectedCompletionFingerprint: completionFingerprint,
});
assert.ok(badModelDigestResult.reasons.includes("model_digest_invalid"));

const badCompletionFingerprint = await rebound({ completionFingerprint: "not-a-sha256" });
const badCompletionFingerprintResult = await validateAuthorDeviceReviewDeclaration(badCompletionFingerprint, {
  expectedCompletionFingerprint: completionFingerprint,
});
assert.ok(badCompletionFingerprintResult.reasons.includes("completion_fingerprint_invalid"));

const badReviewDigest = structuredClone(declaration);
badReviewDigest.reviewDigest = "c".repeat(64);
const badReviewDigestResult = await validateAuthorDeviceReviewDeclaration(badReviewDigest, {
  expectedCompletionFingerprint: completionFingerprint,
});
assert.ok(badReviewDigestResult.reasons.includes("review_digest_mismatch"));
const malformedReviewDigest = structuredClone(declaration);
malformedReviewDigest.reviewDigest = "not-a-sha256";
const malformedReviewDigestResult = await validateAuthorDeviceReviewDeclaration(malformedReviewDigest, {
  expectedCompletionFingerprint: completionFingerprint,
});
assert.ok(malformedReviewDigestResult.reasons.includes("review_digest_invalid"));
const forgedAntiReplayIdentity = structuredClone(declaration);
forgedAntiReplayIdentity.antiReplayIdentity = "d".repeat(64);
const forgedAntiReplayResult = await validateAuthorDeviceReviewDeclaration(forgedAntiReplayIdentity, {
  expectedCompletionFingerprint: completionFingerprint,
});
assert.ok(forgedAntiReplayResult.reasons.includes("anti_replay_identity_mismatch"));

const replayResult = await validateAuthorDeviceReviewDeclaration(declaration, {
  expectedCompletionFingerprint: completionFingerprint,
  consumedAntiReplayIdentities: new Set([declaration.antiReplayIdentity]),
});
assert.ok(replayResult.reasons.includes("anti_replay_identity_reused"));

const publicChapters = [1, 2, 3].map((chapterNumber) => ({
  chapterNumber,
  title: `第 ${chapterNumber} 章`,
  body: `${["霧港追查", "盟友抉擇", "真相回收"][chapterNumber - 1]}。${"人物以行動承擔選擇造成的後果，線索則在場景變化中推進。".repeat(20)}`,
  official: true,
}));
const publicWordCount = publicChapters.reduce(
  (total, chapter) => total + chapter.body.replace(/\s/gu, "").length,
  0,
);
const publicContent = {
  chapterCount: 3,
  wordCount: publicWordCount,
  fullSynopsis: "三名角色在不同選擇中承擔代價，最後完成核心衝突。",
  publicChapters,
};
const publicationGate = await evaluateAuthorDeviceReviewPublicationGate({
  declaration,
  validationContext: {
    expectedCompletionFingerprint: completionFingerprint,
  },
  publicContent,
});
assert.equal(publicationGate.passed, true);
assert.equal(publicationGate.authorDeviceReviewPassed, true);
assert.equal(publicationGate.publicContentPackagingPassed, true);
assert.equal(publicationGate.deterministicPublicContentGateReplacesClosedAI, false);

const taxonomy = normalizePublicLoungeTopicIds(["classic-topic-002"]);
const failClosedService = new PublicLoungeService({
  gateway: {
    async bucketStatus() {
      return { exists: true, public: false, provisioned: true };
    },
    async controlPlaneStatus() {
      return {
        migrationVersion: "public_lounge_control_plane_028",
        catalogReady: true,
        rateReady: true,
      };
    },
  },
  tokenCodec: {
    issue() {
      return { token: "unused", hash: "unused" };
    },
    matches() {
      return false;
    },
  },
  createPublicId() {
    return "novel_author_device_test";
  },
  now() {
    return "2026-08-31T08:00:00.000Z";
  },
  digest(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
  },
  eligibilityReviewer: {
    configured: false,
    async review() {
      throw new Error("trusted reviewer is not connected");
    },
  },
});
const health = await failClosedService.health();
assert.equal(health.authorDeviceEligibilityAccepted, false);
assert.equal(health.trustedAttestationProducer, "not-available-in-this-release");

const weakAuthorDeviceEligibilityRequest = {
  schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION,
  completionFingerprint,
  title: "《只供本機評改的作品》",
  authorByline: "測試作者",
  ...taxonomy,
  completionStatus: "completed",
  chapterCount: publicContent.chapterCount,
  wordCount: publicContent.wordCount,
  completedAt: "2026-08-31T07:50:00.000Z",
  fullSynopsis: publicContent.fullSynopsis,
  publicChapters: publicContent.publicChapters,
  explicitConsent: true,
  authorRightsDeclaration: true,
  workCompleted: true,
  authorDeviceReview: declaration,
  authorDeviceReviewConsent: true,
};
await assert.rejects(
  () => failClosedService.issueEligibility(
    weakAuthorDeviceEligibilityRequest,
    "11111111-1111-4111-8111-111111111111",
  ),
  (error) => error instanceof PublicLoungeError
    && error.code === "PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED",
);

const residueGate = await evaluateAuthorDeviceReviewPublicationGate({
  declaration,
  validationContext: {
    expectedCompletionFingerprint: completionFingerprint,
  },
  publicContent: {
    ...publicContent,
    fullSynopsis: "NEXT TURN：請選擇 A/B/C，附 private_canon。",
  },
});
assert.equal(residueGate.passed, false);
assert.equal(residueGate.authorDeviceReviewPassed, true);
assert.equal(residueGate.publicContentPackagingPassed, false);
assert.ok(residueGate.publicContentReasons.includes("private_payload_residue"));
assert.ok(residueGate.publicContentReasons.includes("interactive_fragment_residue"));

console.log(JSON.stringify({
  status: "PASS",
  schemaVersion: declaration.schemaVersion,
  assurance: declaration.assurance,
  supportedBackends: ["browser-ai", "local-ollama", "private-ai-hub"],
  qualityScore: declaration.qualityScore,
  canonicalDigestBound: true,
  antiReplayIdentityBound: true,
  strictPrivateFieldRejection: true,
  localReviewMayGuideEditing: true,
  authorDeviceEligibilityAccepted: health.authorDeviceEligibilityAccepted,
  publicUnlockRequiresTrustedServerAttestation: true,
}, null, 2));
