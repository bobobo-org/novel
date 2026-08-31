import { createHash, createPublicKey, verify } from "node:crypto";
import {
  PublicLoungeError,
  publicLoungeEligibilityBinding,
  validatePublicLoungeMultiJudgeSummary,
} from "./contract";
import type { PublicLoungeEligibilityReviewer } from "./service";
import type { PublicLoungeServerReviewAttestation } from "./types";
import { PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION } from "./types";

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
