export const PUBLIC_LOUNGE_PUBLICATION_REQUEST_SCHEMA_VERSION = "public-lounge-publication-request-v1" as const;
export const PUBLIC_LOUNGE_POST_SCHEMA_VERSION = "public-lounge-post-v1" as const;
export const PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION = "public-lounge-index-entry-v1" as const;
export const PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION = "public-lounge-stored-post-v1" as const;
export const PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION = "public-lounge-eligibility-request-v1" as const;
export const PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION = "public-lounge-eligibility-proof-v1" as const;
export const PUBLIC_LOUNGE_STORED_ELIGIBILITY_SCHEMA_VERSION = "public-lounge-stored-eligibility-v1" as const;
export const PUBLIC_LOUNGE_SERVER_REVIEW_ATTESTATION_SCHEMA_VERSION = "public-lounge-server-review-attestation-v1" as const;
export const PUBLIC_LOUNGE_QUALITY_THRESHOLD = 80;

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
  category: string;
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

export type PublicLoungeEligibilityRequest = {
  schemaVersion: typeof PUBLIC_LOUNGE_ELIGIBILITY_REQUEST_SCHEMA_VERSION;
  completionFingerprint: string;
  title: string;
  authorByline: string;
  category: string;
  completionStatus: "completed";
  chapterCount: number;
  wordCount: number;
  completedAt: string;
  fullSynopsis: string;
  publicChapters: PublicLoungeOfficialChapterInput[];
  serverAttestation: PublicLoungeServerReviewAttestation;
  explicitConsent: true;
  authorRightsDeclaration: true;
  workCompleted: true;
  trustedServerReviewConsent: true;
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
  backendId: "private-ai-hub";
  modelId: string;
  modelDigest: string;
  rawContentStored: false;
  signature: string;
};

export type PublicLoungeEligibilityProof = {
  schemaVersion: typeof PUBLIC_LOUNGE_ELIGIBILITY_PROOF_SCHEMA_VERSION;
  eligibilityTicket: string;
  expiresAt: string;
  backendId: "private-ai-hub";
  modelId: string;
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

export type PublicLoungePost = {
  schemaVersion: typeof PUBLIC_LOUNGE_POST_SCHEMA_VERSION;
  publicId: string;
  title: string;
  authorByline: string;
  authorBylineStatus: "self_entered_unverified";
  category: string;
  completionStatus: "completed";
  chapterCount: number;
  wordCount: number;
  completedAt: string;
  publishedAt: string;
  quality: {
    totalScore: number;
    threshold: typeof PUBLIC_LOUNGE_QUALITY_THRESHOLD;
    breakdown: PublicLoungeQualityBreakdownItem[];
  };
  fullSynopsis: string;
  publicChapters: PublicLoungeOfficialChapterInput[];
};

export type PublicLoungePostSummary = {
  schemaVersion: typeof PUBLIC_LOUNGE_INDEX_ENTRY_SCHEMA_VERSION;
  publicId: string;
  title: string;
  authorByline: string;
  authorBylineStatus: "self_entered_unverified";
  category: string;
  completionStatus: "completed";
  chapterCount: number;
  wordCount: number;
  completedAt: string;
  publishedAt: string;
  quality: PublicLoungePost["quality"];
  synopsisExcerpt: string;
  publicChapterCount: number;
};

export type PublicLoungeListQuery = {
  search?: string;
  category?: string;
  completedOnly?: boolean;
  cursor?: string;
  limit?: number;
};

export type PublicLoungeListPage = {
  items: PublicLoungePostSummary[];
  nextCursor: string | null;
  totalCount: number;
  categories: string[];
};

export type PublicLoungePublishResult = {
  post: PublicLoungePost;
  managementToken: string;
};

export interface PublicLoungeServiceApi {
  health(): Promise<{
    connected: true;
    storage: "supabase-private-storage";
    bucket: "novel-public-lounge-v1";
    trustedEligibilityVerifierConnected: boolean;
    trustedAttestationProducer: "not-available-in-this-release";
  }>;
  list(query?: PublicLoungeListQuery): Promise<PublicLoungeListPage>;
  get(publicId: string): Promise<PublicLoungePost>;
  issueEligibility(input: unknown): Promise<PublicLoungeEligibilityProof>;
  publish(input: unknown): Promise<PublicLoungePublishResult>;
  overwrite(publicId: string, managementToken: string, input: unknown): Promise<PublicLoungePost>;
  retract(publicId: string, managementToken: string): Promise<void>;
}
