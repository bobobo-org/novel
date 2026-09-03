import type { PublicLoungeShelf, PublicLoungeTopicIds } from "./taxonomy";
import type { AuthorDeviceReviewDeclaration } from "./author-device-review";

export const PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION = "public-lounge-publication-request-v2" as const;
export const PUBLIC_LOUNGE_POST_SCHEMA_VERSION = "public-lounge-post-v3" as const;
export const PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION = "public-lounge-index-entry-v3" as const;
export const PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION = "public-lounge-stored-post-v3" as const;
export const PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION = "public-lounge-eligibility-request-v3" as const;
export const PUBLIC_LOUNGE_PRIOR_POST_SCHEMA_VERSION = "public-lounge-post-v2" as const;
export const PUBLIC_LOUNGE_PRIOR_INDEX_ENTRY_SCHEMA_VERSION = "public-lounge-index-entry-v2" as const;
export const PUBLIC_LOUNGE_PRIOR_STORED_POST_SCHEMA_VERSION = "public-lounge-stored-post-v2" as const;
export const PUBLIC_LOUNGE_LEGACY_POST_SCHEMA_VERSION = "public-lounge-post-v1" as const;
export const PUBLIC_LOUNGE_LEGACY_INDEX_ENTRY_SCHEMA_VERSION = "public-lounge-index-entry-v1" as const;
export const PUBLIC_LOUNGE_LEGACY_STORED_POST_SCHEMA_VERSION = "public-lounge-stored-post-v1" as const;
export const PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION = "public-lounge-eligibility-proof-v3" as const;
export const PUBLIC_LOUNGE_PRIOR_STORED_ELIGIBILITY_SCHEMA_VERSION = "public-lounge-stored-eligibility-v4" as const;
export const PUBLIC_LOUNGE_STORED_ELIGIBILITY_SCHEMA_VERSION = "public-lounge-stored-eligibility-v5" as const;
export const PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_SCHEMA_VERSION = "public-lounge-server-review-attestation-v4" as const;
export const PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_V5_SCHEMA_VERSION = "public-lounge-server-review-attestation-v5" as const;
export const PUBLIC_LOUNGE_MULTI_JUDGE_SUMMARY_SCHEMA_VERSION = "public-lounge-multi-judge-summary-v1" as const;
export const PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION = "public-lounge-rubric-v1" as const;
export const PUBLIC_LOUNGE_PUBLISHED_VERSION_SCHEMA_VERSION = "public-lounge-published-version-v1" as const;
export const PUBLIC_LOUNGE_QUALITY_THRESHOLD = 80;
export const PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS = 140;

export const PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES = [
  "literary-editor",
  "continuity-editor",
  "genre-reader",
] as const;
export type PublicLoungePrimaryJudgeRole = typeof PUBLIC_LOUNGE_PRIMARY_JUDGE_ROLES[number];
export type PublicLoungeJudgeRole = PublicLoungePrimaryJudgeRole | "score-arbitrator";

export const PUBLIC_LOUNGE_QUALITY_ASSURANCES = [
  "private_ai_hub_verified",
  "author_device_closed_ai_unverified",
] as const;
export type PublicLoungeQualityAssurance = typeof PUBLIC_LOUNGE_QUALITY_ASSURANCES[number];

export type PublicLoungeQualityDimensionKey =
  | "plot_coherence"
  | "character_arcs"
  | "world_canon_consistency"
  | "pacing"
  | "prose_dialogue"
  | "foreshadowing_payoff"
  | "ending";

export const PUBLIC_LOUNGE_QUALITY_RUBRIC = [
  { key: "plot_coherence", label: "情節與因果連貫", weight: 20 },
  { key: "character_arcs", label: "角色弧線", weight: 15 },
  { key: "world_canon_consistency", label: "世界與 Canon 一致性", weight: 15 },
  { key: "pacing", label: "節奏與篇章配置", weight: 15 },
  { key: "prose_dialogue", label: "敘事文字與對話", weight: 15 },
  { key: "foreshadowing_payoff", label: "伏筆與回收", weight: 10 },
  { key: "ending", label: "結局完成度", weight: 10 },
] as const satisfies ReadonlyArray<{
  key: PublicLoungeQualityDimensionKey;
  label: string;
  weight: number;
}>;

export type PublicLoungeOfficialChapterInput = {
  chapterNumber: number;
  title: string;
  body: string;
  official: true;
};

export type PublicLoungePublicationInput = {
  schemaVersion: typeof PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION;
  title: string;
  authorByline: string;
  storyLibrarySchemaVersion: string;
  shelfId: string;
  primaryTopicId: string;
  topicIds: PublicLoungeTopicIds;
  completionStatus: "completed";
  chapterCount: number;
  wordCount: number;
  completedAt: string;
  qualityScore: number;
  qualityBreakdown: Record<PublicLoungeQualityDimensionKey, number>;
  fullSynopsis: string;
  publicChapters: PublicLoungeOfficialChapterInput[];
  eligibilityTicket: string;
  explicitConsent: true;
  authorRightsDeclaration: true;
  workCompleted: true;
};

type PublicLoungeEligibilityRequestBase = {
  schemaVersion: typeof PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION;
  completionFingerprint: string;
  title: string;
  authorByline: string;
  storyLibrarySchemaVersion: string;
  shelfId: string;
  primaryTopicId: string;
  topicIds: PublicLoungeTopicIds;
  completionStatus: "completed";
  chapterCount: number;
  wordCount: number;
  completedAt: string;
  fullSynopsis: string;
  publicChapters: PublicLoungeOfficialChapterInput[];
  explicitConsent: true;
  authorRightsDeclaration: true;
  workCompleted: true;
};

export type PublicLoungeServerEligibilityRequest = PublicLoungeEligibilityRequestBase & {
  serverAttestation: PublicLoungeServerReviewAttestation;
  trustedServerReviewConsent: true;
  authorDeviceReview?: never;
  authorDeviceReviewConsent?: never;
};

export type PublicLoungeAuthorDeviceEligibilityRequest = PublicLoungeEligibilityRequestBase & {
  authorDeviceReview: AuthorDeviceReviewDeclaration;
  authorDeviceReviewConsent: true;
  serverAttestation?: never;
  trustedServerReviewConsent?: never;
};

export type PublicLoungeEligibilityRequest =
  | PublicLoungeServerEligibilityRequest
  | PublicLoungeAuthorDeviceEligibilityRequest;

export type PublicLoungeAttestedJudgeSummary = {
  judgeRole: PublicLoungeJudgeRole;
  totalScore: number;
  dimensionScores: Record<PublicLoungeQualityDimensionKey, number>;
  fullCoverage: true;
};

export type PublicLoungeMultiJudgeSummary = {
  schemaVersion: typeof PUBLIC_LOUNGE_MULTI_JUDGE_SUMMARY_SCHEMA_VERSION;
  primaryJudgeRoles: readonly [
    "literary-editor",
    "continuity-editor",
    "genre-reader",
  ];
  primaryJudgeCount: 3;
  judges: readonly PublicLoungeAttestedJudgeSummary[];
  aggregationMethod: "per-dimension-median";
  primaryScoreSpread: number;
  selectedJudgeRoles: readonly [PublicLoungeJudgeRole, PublicLoungeJudgeRole, PublicLoungeJudgeRole];
  arbitrationRequired: boolean;
  arbitrationPerformed: boolean;
  fullCoverageJudgeRoles: readonly PublicLoungeJudgeRole[];
  reviewedChapterCount: number;
  reviewedChunkCount: number;
};

export type PublicLoungeServerReviewAttestation = {
  schemaVersion: typeof PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_SCHEMA_VERSION;
  issuer: "private-ai-hub";
  keyId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  completionFingerprint: string;
  publicationDigest: string;
  qualityScore: number;
  qualityBreakdown: Record<PublicLoungeQualityDimensionKey, number>;
  workCompleted: true;
  fullCoverage: true;
  hardGatePassed: true;
  compliancePassed: true;
  criticalDimensionsPassed: true;
  hiddenDraftResidueDetected: false;
  multiJudgeSummary: PublicLoungeMultiJudgeSummary;
  backendId: "private-ai-hub";
  modelId: string;
  modelDigest: string;
  rawContentStored: false;
  signature: string;
};

export type PublicLoungeServerReviewAttestationV5Intent = "publish" | "overwrite";
export type PublicLoungeServerReviewAttestationV5Environment = "preview" | "production";

type PublicLoungeServerReviewAttestationV5Base = {
  schemaVersion: typeof PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_V5_SCHEMA_VERSION;
  issuer: "private-ai-hub";
  keyId: string;
  attestationId: string;
  workId: string;
  revisionId: string;
  environment: PublicLoungeServerReviewAttestationV5Environment;
  audience: string;
  producerVersion: string;
  rubricVersion: typeof PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION;
  issuedAt: string;
  expiresAt: string;
  completionFingerprint: string;
  contentDigest: string;
  publicationDigest: string;
  qualityScore: number;
  qualityBreakdown: Record<PublicLoungeQualityDimensionKey, number>;
  workCompleted: true;
  fullCoverage: true;
  hardGatePassed: true;
  compliancePassed: true;
  criticalDimensionsPassed: true;
  hiddenDraftResidueDetected: false;
  multiJudgeSummary: PublicLoungeMultiJudgeSummary;
  backendId: "private-ai-hub";
  modelId: string;
  modelDigest: string;
  rawContentStored: false;
  signature: string;
};

export type PublicLoungeServerReviewAttestationV5 =
  | (PublicLoungeServerReviewAttestationV5Base & {
    intent: "publish";
    targetPublicationId: null;
    expectedTargetVersionId: null;
    expectedTargetPublicationDigest: null;
  })
  | (PublicLoungeServerReviewAttestationV5Base & {
    intent: "overwrite";
    targetPublicationId: string;
    expectedTargetVersionId: string;
    expectedTargetPublicationDigest: string;
  });

type PublicLoungeServerEligibilityRequestV5Base =
  Omit<PublicLoungeServerEligibilityRequest, "serverAttestation"> & {
    workId: string;
    revisionId: string;
  };

export type PublicLoungeServerEligibilityRequestV5 =
  | (PublicLoungeServerEligibilityRequestV5Base & {
    intent: "publish";
    targetPublicationId: null;
    expectedTargetVersionId: null;
    expectedTargetPublicationDigest: null;
    serverAttestation: Extract<PublicLoungeServerReviewAttestationV5, { intent: "publish" }>;
  })
  | (PublicLoungeServerEligibilityRequestV5Base & {
    intent: "overwrite";
    targetPublicationId: string;
    expectedTargetVersionId: string;
    expectedTargetPublicationDigest: string;
    serverAttestation: Extract<PublicLoungeServerReviewAttestationV5, { intent: "overwrite" }>;
  });

export type PublicLoungeEligibilityProof = {
  schemaVersion: typeof PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION;
  eligibilityTicket: string;
  expiresAt: string;
  backendId: "private-ai-hub" | "browser-ai" | "local-ollama";
  modelId: string;
  qualityAssurance: PublicLoungeQualityAssurance;
  completionFingerprint: string;
  qualityScore: number;
  qualityBreakdown: Record<PublicLoungeQualityDimensionKey, number>;
};

export type PublicLoungeQualityBreakdownItem = {
  key: PublicLoungeQualityDimensionKey;
  label: string;
  weight: number;
  score: number;
  weightedPoints: number;
};

export type PublicLoungePublicTaxonomy = {
  storyLibrarySchemaVersion: string | null;
  shelfId: string | null;
  primaryTopicId: string | null;
  topicIds: PublicLoungeTopicIds | readonly [];
};

export type PublicLoungePost = PublicLoungePublicTaxonomy & {
  schemaVersion: typeof PUBLIC_LOUNGE_POST_SCHEMA_VERSION;
  publicId: string;
  title: string;
  authorByline: string;
  authorBylineStatus: "self_entered_unverified";
  completionStatus: "completed";
  chapterCount: number;
  wordCount: number;
  completedAt: string;
  publishedAt: string;
  versionId: string;
  versionNumber: number;
  versionPublishedAt: string;
  quality: {
    totalScore: number;
    threshold: typeof PUBLIC_LOUNGE_QUALITY_THRESHOLD;
    breakdown: PublicLoungeQualityBreakdownItem[];
  };
  qualityAssurance: PublicLoungeQualityAssurance;
  fullSynopsis: string;
  publicChapters: PublicLoungeOfficialChapterInput[];
};

export type PublicLoungePostSummary = PublicLoungePublicTaxonomy & {
  schemaVersion: typeof PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION;
  publicId: string;
  title: string;
  authorByline: string;
  authorBylineStatus: "self_entered_unverified";
  completionStatus: "completed";
  chapterCount: number;
  wordCount: number;
  completedAt: string;
  publishedAt: string;
  versionId: string;
  versionNumber: number;
  versionPublishedAt: string;
  quality: PublicLoungePost["quality"];
  qualityAssurance: PublicLoungeQualityAssurance;
  synopsisExcerpt: string;
  publicChapterCount: number;
};

export type PublicLoungeListQuery = {
  search?: string;
  shelfId?: string;
  completedOnly?: boolean;
  cursor?: string;
  limit?: number;
};

export type PublicLoungeListPage = {
  items: PublicLoungePostSummary[];
  nextCursor: string | null;
  totalCount: number;
  shelves: readonly PublicLoungeShelf[];
};

export type PublicLoungePublishResult = {
  post: PublicLoungePost;
  managementToken: string;
};

export type PublicLoungeAbuseRateScope = "read" | "eligibility" | "publish" | "management";

export interface PublicLoungeServiceApi {
  health(): Promise<{
    connected: true;
    storage: "supabase-private-storage";
    bucket: "novel-public-lounge-v1";
    trustedEligibilityVerifierConnected: boolean;
    authorDeviceEligibilityAccepted: false;
    trustedAttestationProducer: "private-ai-hub-v5-client-probe-required";
  }>;
  list(query?: PublicLoungeListQuery): Promise<PublicLoungeListPage>;
  get(publicId: string): Promise<PublicLoungePost>;
  reserveRequest(requestIdentity: string, scope: PublicLoungeAbuseRateScope): Promise<void>;
  issueEligibility(input: unknown, actorId: string): Promise<PublicLoungeEligibilityProof>;
  publish(
    input: unknown,
    idempotencyKey: string,
    actorId: string,
    beforeVisible: (post: PublicLoungePost) => Promise<void>,
  ): Promise<PublicLoungePublishResult>;
  overwrite(publicId: string, managementToken: string, input: unknown, actorId: string): Promise<PublicLoungePost>;
  retract(publicId: string, managementToken: string): Promise<void>;
}
