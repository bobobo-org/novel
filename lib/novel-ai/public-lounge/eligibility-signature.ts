import { createHash, createPublicKey, verify } from "node:crypto";
import {
  PublicLoungeError,
  parsePublicLoungeServerReviewAttestationV5,
  publicLoungeEligibilityBinding,
  validatePublicLoungeMultiJudgeSummary,
} from "./contract";
import type { PublicLoungeEligibilityReviewer } from "./service";
import type {
  PublicLoungeServerEligibilityRequestV5,
  PublicLoungeServerReviewAttestation,
  PublicLoungeServerReviewAttestationV5,
  PublicLoungeServerReviewAttestationV5Environment,
} from "./types";
import {
  PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
  PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION,
} from "./types";
import {
  publicLoungeAttestedPublication,
  publicLoungeContentDigest,
  publicLoungePublicationDigest,
  publicLoungeServerReviewAttestationV5PayloadCanonical,
} from "../../../local-ai/shared/public-lounge-attestation-v5-canonical.mjs";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalQualityBreakdown(
  breakdown: PublicLoungeServerReviewAttestation["qualityBreakdown"],
) {
  return {
    plot_coherence: breakdown.plot_coherence,
    character_arcs: breakdown.character_arcs,
    world_canon_consistency: breakdown.world_canon_consistency,
    pacing: breakdown.pacing,
    prose_dialogue: breakdown.prose_dialogue,
    foreshadowing_payoff: breakdown.foreshadowing_payoff,
    ending: breakdown.ending,
  };
}

export function publicLoungeServerReviewAttestationPayload(
  attestation: PublicLoungeServerReviewAttestation,
) {
  return JSON.stringify({
    schemaVersion: attestation.schemaVersion,
    issuer: attestation.issuer,
    keyId: attestation.keyId,
    nonce: attestation.nonce,
    issuedAt: attestation.issuedAt,
    expiresAt: attestation.expiresAt,
    completionFingerprint: attestation.completionFingerprint,
    publicationDigest: attestation.publicationDigest,
    qualityScore: attestation.qualityScore,
    qualityBreakdown: canonicalQualityBreakdown(attestation.qualityBreakdown),
    workCompleted: attestation.workCompleted,
    fullCoverage: attestation.fullCoverage,
    hardGatePassed: attestation.hardGatePassed,
    compliancePassed: attestation.compliancePassed,
    criticalDimensionsPassed: attestation.criticalDimensionsPassed,
    hiddenDraftResidueDetected: attestation.hiddenDraftResidueDetected,
    multiJudgeSummary: {
      schemaVersion: attestation.multiJudgeSummary.schemaVersion,
      primaryJudgeRoles: [...attestation.multiJudgeSummary.primaryJudgeRoles],
      primaryJudgeCount: attestation.multiJudgeSummary.primaryJudgeCount,
      judges: attestation.multiJudgeSummary.judges.map((judge) => ({
        judgeRole: judge.judgeRole,
        totalScore: judge.totalScore,
        dimensionScores: canonicalQualityBreakdown(judge.dimensionScores),
        fullCoverage: judge.fullCoverage,
      })),
      aggregationMethod: attestation.multiJudgeSummary.aggregationMethod,
      primaryScoreSpread: attestation.multiJudgeSummary.primaryScoreSpread,
      selectedJudgeRoles: [...attestation.multiJudgeSummary.selectedJudgeRoles],
      arbitrationRequired: attestation.multiJudgeSummary.arbitrationRequired,
      arbitrationPerformed: attestation.multiJudgeSummary.arbitrationPerformed,
      fullCoverageJudgeRoles: [...attestation.multiJudgeSummary.fullCoverageJudgeRoles],
      reviewedChapterCount: attestation.multiJudgeSummary.reviewedChapterCount,
      reviewedChunkCount: attestation.multiJudgeSummary.reviewedChunkCount,
    },
    backendId: attestation.backendId,
    modelId: attestation.modelId,
    modelDigest: attestation.modelDigest,
    rawContentStored: attestation.rawContentStored,
  });
}

export function publicLoungeServerReviewAttestationV5Payload(
  attestation: PublicLoungeServerReviewAttestationV5,
) {
  return publicLoungeServerReviewAttestationV5PayloadCanonical(attestation);
}

export function createEd25519PublicLoungeEligibilityReviewer(options: {
  publicKeyPem: string;
  keyId: string;
  now?: () => string;
}): PublicLoungeEligibilityReviewer {
  const now = options.now ?? (() => new Date().toISOString());
  let publicKey: ReturnType<typeof createPublicKey> | null = null;
  try {
    publicKey = createPublicKey(options.publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") publicKey = null;
  } catch {
    publicKey = null;
  }
  return {
    configured: Boolean(publicKey && options.keyId),
    async review(input) {
      if (!publicKey || !options.keyId) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED", 503, true);
      }
      const attestation = input.serverAttestation;
      const multiJudgeSummary = validatePublicLoungeMultiJudgeSummary(
        attestation.multiJudgeSummary,
        attestation.qualityBreakdown,
      );
      const nowMs = Date.parse(now());
      if (
        attestation.keyId !== options.keyId
        || multiJudgeSummary.reviewedChapterCount !== input.chapterCount
        || Date.parse(attestation.issuedAt) > nowMs + 5 * 60_000
        || Date.parse(attestation.expiresAt) <= nowMs
      ) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
      }
      const publication = {
        schemaVersion: PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION,
        title: input.title,
        authorByline: input.authorByline,
        storyLibrarySchemaVersion: input.storyLibrarySchemaVersion,
        shelfId: input.shelfId,
        primaryTopicId: input.primaryTopicId,
        topicIds: input.topicIds,
        completionStatus: "completed" as const,
        chapterCount: input.chapterCount,
        wordCount: input.wordCount,
        completedAt: input.completedAt,
        qualityScore: attestation.qualityScore,
        qualityBreakdown: attestation.qualityBreakdown,
        fullSynopsis: input.fullSynopsis,
        publicChapters: input.publicChapters,
        explicitConsent: true as const,
        authorRightsDeclaration: true as const,
        workCompleted: true as const,
      };
      const expectedPublicationDigest = sha256(publicLoungeEligibilityBinding(
        publication,
        input.completionFingerprint,
      ));
      const payload = publicLoungeServerReviewAttestationPayload(attestation);
      const signature = Buffer.from(attestation.signature, "base64url");
      const criticalDimensionsPassed = [
        "plot_coherence",
        "character_arcs",
        "world_canon_consistency",
        "prose_dialogue",
      ].every((key) => attestation.qualityBreakdown[
        key as keyof typeof attestation.qualityBreakdown
      ] >= 60);
      if (
        attestation.publicationDigest !== expectedPublicationDigest
        || attestation.hardGatePassed !== true
        || attestation.compliancePassed !== true
        || attestation.criticalDimensionsPassed !== true
        || attestation.hiddenDraftResidueDetected !== false
        || !criticalDimensionsPassed
        || !verify(null, Buffer.from(payload, "utf8"), publicKey, signature)
      ) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
      }
      return {
        backendId: "private-ai-hub",
        modelId: attestation.modelId,
        modelDigest: attestation.modelDigest,
        completionFingerprint: attestation.completionFingerprint,
        qualityScore: attestation.qualityScore,
        qualityBreakdown: attestation.qualityBreakdown,
        attestationDigest: sha256(`${payload}\n${attestation.signature}`),
      };
    },
  };
}

export type PublicLoungeEligibilityReviewV5Result = {
  backendId: "private-ai-hub";
  modelId: string;
  modelDigest: string;
  completionFingerprint: string;
  qualityScore: number;
  qualityBreakdown: PublicLoungeServerReviewAttestationV5["qualityBreakdown"];
  bindingDigest: string;
  attestationDigest: string;
  attestationId: string;
  intent: PublicLoungeServerReviewAttestationV5["intent"];
  workId: string;
  revisionId: string;
  targetPublicationId: string | null;
  expectedTargetVersionId: string | null;
  expectedTargetPublicationDigest: string | null;
  environment: PublicLoungeServerReviewAttestationV5Environment;
  audience: string;
  producerVersion: string;
  rubricVersion: typeof PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION;
  keyId: string;
};

export type PublicLoungeEligibilityReviewerV5 = {
  configured: boolean;
  expectedEnvironment: PublicLoungeServerReviewAttestationV5Environment | null;
  expectedAudience: string | null;
  expectedProducerVersion: string | null;
  expectedRubricVersion: string | null;
  expectedKeyId: string | null;
  review(input: PublicLoungeServerEligibilityRequestV5): Promise<PublicLoungeEligibilityReviewV5Result>;
};

export function resolvePublicLoungeAttestationEnvironment(
  configuredValue: string | undefined,
  platformValue: string | undefined,
) {
  const configured = configuredValue?.trim() ?? "";
  const platform = platformValue?.trim() ?? "";
  if (
    (platform === "production" || platform === "preview")
    && configured !== platform
  ) {
    return "deployment-environment-mismatch";
  }
  return configured;
}

export function createEd25519PublicLoungeEligibilityReviewerV5(options: {
  publicKeyPem: string;
  keyId: string;
  environment: string;
  audience: string;
  producerVersion: string;
  rubricVersion: string;
  now?: () => string;
}): PublicLoungeEligibilityReviewerV5 {
  const now = options.now ?? (() => new Date().toISOString());
  let publicKey: ReturnType<typeof createPublicKey> | null = null;
  try {
    publicKey = createPublicKey(options.publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") publicKey = null;
  } catch {
    publicKey = null;
  }
  const expectedEnvironment = options.environment === "preview" || options.environment === "production"
    ? options.environment
    : null;
  const configurationReady = Boolean(
    publicKey
    && options.keyId
    && expectedEnvironment
    && options.audience
    && options.producerVersion
    && options.rubricVersion,
  );
  return {
    configured: configurationReady,
    expectedEnvironment,
    expectedAudience: options.audience || null,
    expectedProducerVersion: options.producerVersion || null,
    expectedRubricVersion: options.rubricVersion || null,
    expectedKeyId: options.keyId || null,
    async review(input) {
      if (!publicKey || !configurationReady) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED", 503, true);
      }
      const attestation = parsePublicLoungeServerReviewAttestationV5(input.serverAttestation);
      const multiJudgeSummary = validatePublicLoungeMultiJudgeSummary(
        attestation.multiJudgeSummary,
        attestation.qualityBreakdown,
      );
      const nowMs = Date.parse(now());
      if (
        attestation.keyId !== options.keyId
        || attestation.environment !== expectedEnvironment
        || attestation.audience !== options.audience
        || attestation.producerVersion !== options.producerVersion
        || attestation.rubricVersion !== options.rubricVersion
        || attestation.rubricVersion !== PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION
        || attestation.completionFingerprint !== input.completionFingerprint
        || attestation.workId !== input.workId
        || attestation.revisionId !== input.revisionId
        || attestation.revisionId !== input.completionFingerprint
        || attestation.intent !== input.intent
        || attestation.targetPublicationId !== input.targetPublicationId
        || attestation.expectedTargetVersionId !== input.expectedTargetVersionId
        || attestation.expectedTargetPublicationDigest !== input.expectedTargetPublicationDigest
        || multiJudgeSummary.reviewedChapterCount !== input.chapterCount
        || Date.parse(attestation.issuedAt) > nowMs + 5 * 60_000
        || Date.parse(attestation.expiresAt) <= nowMs
      ) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
      }
      const publication = publicLoungeAttestedPublication(
        input,
        attestation.qualityScore,
        attestation.qualityBreakdown,
      );
      const expectedContentDigest = publicLoungeContentDigest(publication.publicChapters);
      const expectedPublicationDigest = publicLoungePublicationDigest(
        publication,
        input.completionFingerprint,
      );
      const payload = publicLoungeServerReviewAttestationV5Payload(attestation);
      const signature = Buffer.from(attestation.signature, "base64url");
      const criticalDimensionsPassed = [
        "plot_coherence",
        "character_arcs",
        "world_canon_consistency",
        "prose_dialogue",
      ].every((key) => attestation.qualityBreakdown[
        key as keyof typeof attestation.qualityBreakdown
      ] >= 60);
      if (
        attestation.contentDigest !== expectedContentDigest
        || attestation.publicationDigest !== expectedPublicationDigest
        || attestation.hardGatePassed !== true
        || attestation.compliancePassed !== true
        || attestation.criticalDimensionsPassed !== true
        || attestation.hiddenDraftResidueDetected !== false
        || !criticalDimensionsPassed
        || !verify(null, Buffer.from(payload, "utf8"), publicKey, signature)
      ) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
      }
      return {
        backendId: "private-ai-hub",
        modelId: attestation.modelId,
        modelDigest: attestation.modelDigest,
        completionFingerprint: attestation.completionFingerprint,
        qualityScore: attestation.qualityScore,
        qualityBreakdown: attestation.qualityBreakdown,
        bindingDigest: sha256(payload),
        attestationDigest: sha256(`${payload}\n${attestation.signature}`),
        attestationId: attestation.attestationId,
        intent: attestation.intent,
        workId: attestation.workId,
        revisionId: attestation.revisionId,
        targetPublicationId: attestation.targetPublicationId,
        expectedTargetVersionId: attestation.expectedTargetVersionId,
        expectedTargetPublicationDigest: attestation.expectedTargetPublicationDigest,
        environment: attestation.environment,
        audience: attestation.audience,
        producerVersion: attestation.producerVersion,
        rubricVersion: attestation.rubricVersion,
        keyId: attestation.keyId,
      };
    },
  };
}
