import { PUBLIC_STORY_RESEARCH_RULES_V1 } from "./rules-v1";
import { PUBLIC_STORY_RESEARCH_SOURCES_V1 } from "./sources-v1";
import {
  PUBLIC_STORY_RESEARCH_SCHEMA_VERSION,
  PUBLIC_STORY_RESEARCH_SEED_VERSION,
  SHARED_STORY_EXPERIENCE_MODES,
  TEN_CAUSAL_DIMENSIONS,
  type PublicStoryResearchSeed,
  type SharedCausalResearchLibrary,
} from "./types";

export const PUBLIC_STORY_RESEARCH_SEED_V1 = {
  schemaVersion: PUBLIC_STORY_RESEARCH_SCHEMA_VERSION,
  seedVersion: PUBLIC_STORY_RESEARCH_SEED_VERSION,
  releasedAt: "2026-08-23T00:00:00.000Z",
  tenDimensionSchema: TEN_CAUSAL_DIMENSIONS,
  supportedExperiences: SHARED_STORY_EXPERIENCE_MODES,
  networkPolicy: {
    runtimeFetch: false,
    automatedCrawl: false,
    robotsBypass: false,
    loginBypass: false,
    staticResearchOnly: true,
  },
  retention: {
    sourceTextRetained: false,
    socialPostRetained: false,
    videoOrAudioRetained: false,
    transcriptRetained: false,
    storySpecificExpressionRetained: false,
  },
  sources: PUBLIC_STORY_RESEARCH_SOURCES_V1,
  inferenceRules: PUBLIC_STORY_RESEARCH_RULES_V1,
} as const satisfies PublicStoryResearchSeed;

// "approved" here means approved for bounded knowledge retrieval. Every adapter
// output remains a human-review teacher candidate and is never model training.
export const PUBLIC_STORY_RESEARCH_SHARED_LIBRARY_V1 = {
  libraryVersion: `${PUBLIC_STORY_RESEARCH_SEED_VERSION}:shared-library-v1`,
  learningSemantics: "knowledge_retrieval_and_rule_weight_learning",
  modelWeightTraining: false,
  entries: PUBLIC_STORY_RESEARCH_RULES_V1.map((rule, index) => ({
    rule,
    approvalStatus: "approved" as const,
    abstractWeight: Math.max(0.5, 1 - index * 0.015),
    evidenceRefs: rule.sourceFactRefs,
    aggregateFeedback: {
      accepted: 0,
      edited: 0,
      rejected: 0,
    },
    rawStoryRetained: false as const,
    chainOfThoughtRetained: false as const,
  })),
} satisfies SharedCausalResearchLibrary;

const PROHIBITED_CONTENT_KEYS = new Set([
  "rawtext",
  "rawcontent",
  "sourcetext",
  "sourcecontent",
  "storytext",
  "storycontent",
  "originaltext",
  "excerpt",
  "transcript",
  "postbody",
  "videobody",
  "dialogue",
  "charactername",
  "plotsummary",
  "chainofthought",
]);

function visitKeys(value: unknown, errors: string[], path = "seed") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitKeys(item, errors, `${path}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (PROHIBITED_CONTENT_KEYS.has(key.toLowerCase())) {
      errors.push(`PROHIBITED_CONTENT_KEY:${path}.${key}`);
    }
    visitKeys(item, errors, `${path}.${key}`);
  }
}

function sameOrderedValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validatePublicStoryResearchSeed(
  seed: PublicStoryResearchSeed = PUBLIC_STORY_RESEARCH_SEED_V1,
) {
  const errorCodes: string[] = [];
  if (seed.schemaVersion !== PUBLIC_STORY_RESEARCH_SCHEMA_VERSION) {
    errorCodes.push("RESEARCH_SEED_SCHEMA_UNSUPPORTED");
  }
  if (!sameOrderedValues(seed.tenDimensionSchema, TEN_CAUSAL_DIMENSIONS)) {
    errorCodes.push("RESEARCH_SEED_TEN_DIMENSION_SCHEMA_INVALID");
  }
  if (
    seed.networkPolicy.runtimeFetch
    || seed.networkPolicy.automatedCrawl
    || seed.networkPolicy.robotsBypass
    || seed.networkPolicy.loginBypass
    || !seed.networkPolicy.staticResearchOnly
  ) {
    errorCodes.push("RESEARCH_SEED_NETWORK_POLICY_INVALID");
  }
  if (Object.values(seed.retention).some(Boolean)) {
    errorCodes.push("RESEARCH_SEED_SOURCE_RETENTION_INVALID");
  }

  const sourceIds = new Set<string>();
  const factIds = new Set<string>();
  for (const source of seed.sources) {
    if (sourceIds.has(source.sourceId)) errorCodes.push(`RESEARCH_SOURCE_DUPLICATE:${source.sourceId}`);
    sourceIds.add(source.sourceId);
    if (!source.url || (!source.url.startsWith("https://") && !source.url.startsWith("urn:novel:"))) {
      errorCodes.push(`RESEARCH_SOURCE_URL_INVALID:${source.sourceId}`);
    }
    if (
      source.rights.sourceTextCopied
      || source.rights.storyExpressionUsed
      || source.rights.redistributionClaimed
      || source.robots.automatedCollectionPerformed
      || source.robots.robotsOrLoginBypass
      || Object.values(source.retention).some(Boolean)
    ) {
      errorCodes.push(`RESEARCH_SOURCE_BOUNDARY_INVALID:${source.sourceId}`);
    }
    if (!source.provenance.publisher || !source.provenance.citationTitle || !source.provenance.reviewedAt) {
      errorCodes.push(`RESEARCH_SOURCE_PROVENANCE_REQUIRED:${source.sourceId}`);
    }
    if (!source.sourceFacts.length) errorCodes.push(`RESEARCH_SOURCE_FACT_REQUIRED:${source.sourceId}`);
    for (const fact of source.sourceFacts) {
      if (factIds.has(fact.factId)) errorCodes.push(`RESEARCH_FACT_DUPLICATE:${fact.factId}`);
      factIds.add(fact.factId);
      if (!fact.summary.trim() || fact.summary.length > 360) {
        errorCodes.push(`RESEARCH_FACT_SUMMARY_INVALID:${fact.factId}`);
      }
    }
  }

  const ruleIds = new Set<string>();
  for (const rule of seed.inferenceRules) {
    if (ruleIds.has(rule.ruleId)) errorCodes.push(`RESEARCH_RULE_DUPLICATE:${rule.ruleId}`);
    ruleIds.add(rule.ruleId);
    const dimensions = Object.keys(rule.tenDimensions);
    if (!sameOrderedValues(dimensions, TEN_CAUSAL_DIMENSIONS)) {
      errorCodes.push(`RESEARCH_RULE_TEN_DIMENSIONS_INVALID:${rule.ruleId}`);
    }
    for (const dimension of TEN_CAUSAL_DIMENSIONS) {
      if (rule.tenDimensions[dimension]?.dimension !== dimension) {
        errorCodes.push(`RESEARCH_RULE_DIMENSION_PAYLOAD_INVALID:${rule.ruleId}:${dimension}`);
      }
    }
    if (
      !rule.candidateOnly
      || rule.autoApprove
      || rule.outcomeGuarantee
      || !rule.experimentRequired
      || rule.triggerParameters.some((item) => !item.experimentOnly)
    ) {
      errorCodes.push(`RESEARCH_RULE_EXPERIMENT_BOUNDARY_INVALID:${rule.ruleId}`);
    }
    if (!rule.experienceModes.length || !rule.consumerFits.length) {
      errorCodes.push(`RESEARCH_RULE_CONSUMER_SCOPE_REQUIRED:${rule.ruleId}`);
    }
    for (const factRef of rule.sourceFactRefs) {
      if (!factIds.has(factRef)) errorCodes.push(`RESEARCH_RULE_FACT_REF_MISSING:${rule.ruleId}:${factRef}`);
    }
    if (
      rule.mechanismClass === "popular_short_drama_experiment"
      && !["inference", "experiment"].includes(rule.claimKind)
    ) {
      errorCodes.push(`POPULAR_MECHANISM_NOT_EXPERIMENTAL:${rule.ruleId}`);
    }
    if ("sourceFacts" in rule) errorCodes.push(`RESEARCH_FACT_INFERENCE_MIXED:${rule.ruleId}`);
  }

  const researchSourceCount = seed.sources.filter((source) =>
    source.sourceType === "peer_reviewed_original_research").length;
  if (researchSourceCount < 2) errorCodes.push("RESEARCH_PRIMARY_STUDIES_INSUFFICIENT");
  for (const platform of [
    "project_gutenberg",
    "royal_road",
    "youtube",
    "meta_facebook",
    "meta_instagram",
    "peer_reviewed_research",
  ] as const) {
    if (!seed.sources.some((source) => source.platform === platform)) {
      errorCodes.push(`RESEARCH_REQUIRED_PLATFORM_MISSING:${platform}`);
    }
  }
  visitKeys(seed, errorCodes);
  return {
    valid: errorCodes.length === 0,
    errorCodes,
    sourceCount: seed.sources.length,
    factCount: factIds.size,
    ruleCount: seed.inferenceRules.length,
    primaryResearchSourceCount: researchSourceCount,
  };
}
