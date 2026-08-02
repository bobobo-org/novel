import type {
  LearningEngagementMetric,
  LearningRuleDraft,
  LearningWebSourceChannel,
  LearningWebSourceProfile,
  TextFingerprint,
} from "./types";

export const CONTROLLED_WEB_KNOWLEDGE_VERSION = "controlled-web-knowledge-v2" as const;
export const POPULAR_SOURCE_MINIMUM_ENGAGEMENT = 100_000 as const;

export type ControlledTeacherProvider = "openai" | "grok";

export type ControlledWebTeacherEvidence = {
  provider: ControlledTeacherProvider;
  model: string;
  responseDigest: string;
  acceptedRuleCount: number;
  rejectionCodes: string[];
  candidateOnly: true;
  dataLeavesDevice: true;
  rawResponseRetained: false;
};

export type ControlledWebSourceEvidence = {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  fetchedAt: string;
  contentType: string;
  contentCharacters: number;
  redirects: number;
  robotsPolicy: "allowed" | "not_present";
  sourceDigest: string;
  sourceProfile: LearningWebSourceProfile;
  fingerprint: TextFingerprint;
  sanitizationStatus: "unchanged" | "sanitized";
  warningCodes: string[];
  rawContentRetained: false;
};

const SOURCE_CHANNELS = new Set<LearningWebSourceChannel>(["article", "youtube", "novel_app", "popular_web", "classical_chinese"]);
const ENGAGEMENT_METRICS = new Set<LearningEngagementMetric>(["views", "reads", "installs", "ratings", "followers", "monthly_visits"]);

export function normalizeControlledWebSourceProfile(input: {
  sourceChannel?: unknown;
  engagementMetric?: unknown;
  engagementCount?: unknown;
  engagementEvidence?: unknown;
  observedAt?: string;
}): LearningWebSourceProfile {
  const channel = String(input.sourceChannel || "article") as LearningWebSourceChannel;
  if (!SOURCE_CHANNELS.has(channel)) {
    throw Object.assign(new Error("不支援的熱門來源類型。"), { code: "POPULAR_SOURCE_CHANNEL_INVALID" });
  }
  if (channel === "article" || channel === "classical_chinese") return { channel, engagement: null };
  const metric = String(input.engagementMetric || "views") as LearningEngagementMetric;
  if (!ENGAGEMENT_METRICS.has(metric)) {
    throw Object.assign(new Error("不支援的人氣衡量方式。"), { code: "POPULAR_SOURCE_METRIC_INVALID" });
  }
  const observedCount = Math.floor(Number(input.engagementCount));
  if (!Number.isSafeInteger(observedCount) || observedCount < POPULAR_SOURCE_MINIMUM_ENGAGEMENT) {
    throw Object.assign(new Error("熱門來源必須提供至少 100,000 次的可查證人氣指標。"), { code: "POPULAR_SOURCE_THRESHOLD_NOT_MET" });
  }
  const evidenceReference = String(input.engagementEvidence || "").trim().slice(0, 500);
  if (evidenceReference.length < 4) {
    throw Object.assign(new Error("熱門來源必須提供公開計數、平台頁面或其他可稽核證據。"), { code: "POPULAR_SOURCE_EVIDENCE_REQUIRED" });
  }
  return {
    channel,
    engagement: {
      metric,
      observedCount,
      minimumRequired: POPULAR_SOURCE_MINIMUM_ENGAGEMENT,
      thresholdPassed: true,
      verification: "operator_attested",
      evidenceReference,
      observedAt: input.observedAt || new Date().toISOString(),
    },
  };
}

export type DistilledWebKnowledgeBundle = {
  schemaVersion: typeof CONTROLLED_WEB_KNOWLEDGE_VERSION;
  source: ControlledWebSourceEvidence;
  rules: LearningRuleDraft[];
  teachers: ControlledWebTeacherEvidence[];
  teacherAgreement: {
    requestedTeachers: number;
    completedTeachers: number;
    crossTeacherRuleCount: number;
  };
  privacy: {
    rawSourceRetained: false;
    rawTeacherResponseRetained: false;
    externalRequestCount: number;
    dataLeftDevice: true;
    candidateOnly: true;
    canonicalMutationCount: 0;
  };
  immutableDigest: string;
};

export function distilledWebKnowledgePayload(bundle: DistilledWebKnowledgeBundle) {
  return {
    schemaVersion: bundle.schemaVersion,
    source: bundle.source,
    rules: bundle.rules,
    teachers: bundle.teachers,
    teacherAgreement: bundle.teacherAgreement,
    privacy: bundle.privacy,
  };
}
