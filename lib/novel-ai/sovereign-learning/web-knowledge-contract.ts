import type {
  LearningRuleDraft,
  LearningWebSourceChannel,
  LearningWebSourceProfile,
  TextFingerprint,
} from "./types";
import type { VerifiedStoryResearchProfile } from "./verified-story-teacher";
import type { SharedLearningPublishReceipt } from "./shared-learning-contract";

export const CONTROLLED_WEB_KNOWLEDGE_VERSION = "controlled-web-knowledge-v6" as const;

export type ControlledTeacherProvider = "openai" | "gemini" | "grok";
export type ControlledWebAnalysisMode = "external_teacher" | "hybrid" | "local_deterministic";

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
  contentEligibility: ControlledWebContentEligibility;
  sourceTruncated: boolean;
  fingerprint: TextFingerprint;
  sanitizationStatus: "unchanged" | "sanitized";
  warningCodes: string[];
  rawContentRetained: false;
};

export type ControlledWebContentEligibility = {
  mode: "narrative_page_text" | "metadata_only";
  ruleCreationAllowed: boolean;
  transcriptStatus: "not_applicable" | "missing";
  reasonCode: "ARTICLE_PAGE_TEXT" | "VIDEO_TRANSCRIPT_REQUIRED";
};

const VIDEO_PLATFORM_HOSTS = [
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "douyin.com",
  "vimeo.com",
  "dailymotion.com",
  "twitch.tv",
  "bilibili.com",
  "kuaishou.com",
] as const;

function hostMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Video landing pages expose titles, descriptions and social metadata, not a
 * trustworthy transcript. Those fields may identify a source but can never
 * become narrative-learning evidence.
 */
export function classifyControlledWebContent(input: {
  url: string;
  sourceProfile: LearningWebSourceProfile;
}): ControlledWebContentEligibility {
  let hostname = "";
  let pathname = "";
  try {
    const parsed = new URL(input.url);
    hostname = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    // URL validation belongs to the HTTPS/SSRF boundary. A selected video
    // channel remains metadata-only even before a complete URL is entered.
  }
  const explicitVideoChannel = input.sourceProfile.channel === "youtube";
  const knownVideoHost = VIDEO_PLATFORM_HOSTS.some((domain) => hostMatches(hostname, domain));
  const socialVideoPath = (
    (hostMatches(hostname, "instagram.com") && /^\/(?:reel|reels)\//u.test(pathname))
    || (hostMatches(hostname, "facebook.com") && /^\/(?:watch|reel|videos)(?:\/|$)/u.test(pathname))
    || hostMatches(hostname, "fb.watch")
  );
  if (explicitVideoChannel || knownVideoHost || socialVideoPath) {
    return {
      mode: "metadata_only",
      ruleCreationAllowed: false,
      transcriptStatus: "missing",
      reasonCode: "VIDEO_TRANSCRIPT_REQUIRED",
    };
  }
  return {
    mode: "narrative_page_text",
    ruleCreationAllowed: true,
    transcriptStatus: "not_applicable",
    reasonCode: "ARTICLE_PAGE_TEXT",
  };
}

export function assertControlledWebContentCanCreateRules(
  eligibility: ControlledWebContentEligibility | null | undefined,
) {
  if (
    !eligibility
    || eligibility.mode !== "narrative_page_text"
    || eligibility.ruleCreationAllowed !== true
    || eligibility.transcriptStatus !== "not_applicable"
    || eligibility.reasonCode !== "ARTICLE_PAGE_TEXT"
  ) {
    throw Object.assign(new Error(
      "影片網址目前只能辨識為 metadata-only；標題、描述與頁面資訊不是字幕，不能建立或寫入學習規則。請貼上逐字稿，或上傳 SRT／VTT 字幕檔。",
    ), { code: "VIDEO_TRANSCRIPT_REQUIRED", status: 422 });
  }
}

const SOURCE_CHANNELS = new Set<LearningWebSourceChannel>(["article", "youtube", "novel_app", "popular_web", "classical_chinese"]);

export function normalizeControlledWebSourceProfile(input: {
  sourceChannel?: unknown;
}): LearningWebSourceProfile {
  const channel = String(input.sourceChannel || "article") as LearningWebSourceChannel;
  if (!SOURCE_CHANNELS.has(channel)) {
    throw Object.assign(new Error("不支援的公開來源類型。"), { code: "WEB_SOURCE_CHANNEL_INVALID" });
  }
  return { channel };
}

export type DistilledWebKnowledgeBundle = {
  schemaVersion: typeof CONTROLLED_WEB_KNOWLEDGE_VERSION;
  analysisMode: ControlledWebAnalysisMode;
  source: ControlledWebSourceEvidence;
  storyResearch: VerifiedStoryResearchProfile;
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
    dataLeftDevice: boolean;
    candidateOnly: true;
    canonicalMutationCount: 0;
  };
  immutableDigest: string;
};

export type DistilledWebKnowledgeResponse = DistilledWebKnowledgeBundle & {
  sharedLibrary: SharedLearningPublishReceipt;
};

export function distilledWebKnowledgePayload(bundle: DistilledWebKnowledgeBundle) {
  return {
    schemaVersion: bundle.schemaVersion,
    analysisMode: bundle.analysisMode,
    source: bundle.source,
    storyResearch: bundle.storyResearch,
    rules: bundle.rules,
    teachers: bundle.teachers,
    teacherAgreement: bundle.teacherAgreement,
    privacy: bundle.privacy,
  };
}
