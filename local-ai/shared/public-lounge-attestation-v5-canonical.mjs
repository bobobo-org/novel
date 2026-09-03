import crypto from "node:crypto";

export const PUBLIC_LOUNGE_ATTESTATION_V5_SCHEMA = "public-lounge-server-review-attestation-v5";
export const PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA = "public-lounge-eligibility-request-v3";
export const PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA = "public-lounge-publication-request-v2";

export function canonicalPublicLoungeQualityBreakdown(breakdown) {
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

export function publicLoungeAttestedPublication(input, qualityScore, qualityBreakdown) {
  return {
    schemaVersion: PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA,
    title: input.title,
    authorByline: input.authorByline,
    storyLibrarySchemaVersion: input.storyLibrarySchemaVersion,
    shelfId: input.shelfId,
    primaryTopicId: input.primaryTopicId,
    topicIds: input.topicIds,
    completionStatus: "completed",
    chapterCount: input.chapterCount,
    wordCount: input.wordCount,
    completedAt: input.completedAt,
    qualityScore,
    qualityBreakdown: canonicalPublicLoungeQualityBreakdown(qualityBreakdown),
    fullSynopsis: input.fullSynopsis,
    publicChapters: input.publicChapters,
    explicitConsent: true,
    authorRightsDeclaration: true,
    workCompleted: true,
  };
}

export function publicLoungeEligibilityBindingPayload(publication, completionFingerprint) {
  return JSON.stringify({
    schemaVersion: PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA,
    completionFingerprint,
    publication,
  });
}

export function publicLoungeContentDigest(publicChapters) {
  return crypto.createHash("sha256").update(JSON.stringify(publicChapters), "utf8").digest("hex");
}

export function publicLoungePublicationDigest(publication, completionFingerprint) {
  return crypto.createHash("sha256")
    .update(publicLoungeEligibilityBindingPayload(publication, completionFingerprint), "utf8")
    .digest("hex");
}

export function publicLoungeServerReviewAttestationV5PayloadCanonical(attestation) {
  return JSON.stringify({
    schemaVersion: attestation.schemaVersion,
    issuer: attestation.issuer,
    keyId: attestation.keyId,
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
    issuedAt: attestation.issuedAt,
    expiresAt: attestation.expiresAt,
    completionFingerprint: attestation.completionFingerprint,
    contentDigest: attestation.contentDigest,
    publicationDigest: attestation.publicationDigest,
    qualityScore: attestation.qualityScore,
    qualityBreakdown: canonicalPublicLoungeQualityBreakdown(attestation.qualityBreakdown),
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
        dimensionScores: canonicalPublicLoungeQualityBreakdown(judge.dimensionScores),
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
