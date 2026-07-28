import type { ClosedAICacheLayer } from "../closed-ai-cache";
import type {
  ClosedAIBackendId,
  ClosedAIContextItem,
} from "../closed-agent-os/types";
import type {
  ControlledLearningCandidate,
  ControlledLearningLevel,
} from "./types";

export type ControlledLearningConfiguration =
  Record<string, string | number | boolean>;

const BACKEND_IDS = new Set<ClosedAIBackendId>([
  "browser-ai",
  "local-ollama",
  "private-ai-hub",
]);

const PLANNER_STRATEGIES = new Set([
  "standard",
  "continuity-first",
  "critical-review",
  "character-depth",
]);

const PACING_VALUES = new Set(["slow", "balanced", "fast"]);
const PROMPT_STRATEGIES = new Set([
  "balanced",
  "concise",
  "immersive",
  "dialogue-forward",
  "continuity-first",
]);

const ALLOWED_LEVELS: Record<
  ControlledLearningCandidate["candidateType"],
  ControlledLearningLevel[]
> = {
  preference: ["L0"],
  "prompt-policy": ["L0"],
  "router-policy": ["L0"],
  "planner-policy": ["L0"],
  "cache-policy": ["L0"],
  "retrieval-policy": ["L0", "L1"],
  "character-voice": ["L0"],
  "correction-rule": ["L0"],
  "tool-policy": ["L1"],
  "task-decomposition": ["L1"],
  "project-template": ["L1"],
  "pacing-genre": ["L1"],
  "approved-rule-pack": ["L1"],
  "knowledge-rule-pack": ["L1"],
};

const KEYS_BY_TYPE: Record<
  ControlledLearningCandidate["candidateType"],
  ReadonlySet<string>
> = {
  preference: new Set([
    "pacingWeight",
    "preference.pacing",
    "preference.genre",
    "preference.style",
  ]),
  "prompt-policy": new Set(["prompt.strategy"]),
  "router-policy": new Set(["router.preferredBackend"]),
  "planner-policy": new Set(["planner.strategy"]),
  "cache-policy": new Set([
    "cache.semanticThreshold",
    "cache.exactTtlMs",
    "cache.semanticTtlMs",
    "cache.retrievalTtlMs",
    "cache.agentPlanTtlMs",
    "cache.toolResultTtlMs",
  ]),
  "retrieval-policy": new Set([
    "retrieval.canonWeight",
    "retrieval.storyBibleWeight",
    "retrieval.characterKnowledgeWeight",
    "retrieval.relationshipEventWeight",
    "retrieval.memoryWeight",
    "retrieval.contextWeight",
  ]),
  "character-voice": new Set(["character.voicePreference"]),
  "correction-rule": new Set(["correction.rule"]),
  "tool-policy": new Set(["tool.preferredId"]),
  "task-decomposition": new Set(["planner.strategy"]),
  "project-template": new Set(["template.id", "template.instruction"]),
  "pacing-genre": new Set(["preference.pacing", "preference.genre"]),
  "approved-rule-pack": new Set(["rulePackDigest", "approvedRuleCount"]),
  "knowledge-rule-pack": new Set([
    "sourceDigest",
    "transformationDigest",
    "ruleCount",
    "sourceContentStored",
    "verbatimCopyStored",
  ]),
};

const RUNTIME_KEYS = new Set([
  "pacingWeight",
  "preference.pacing",
  "preference.genre",
  "preference.style",
  "prompt.strategy",
  "router.preferredBackend",
  "planner.strategy",
  "cache.semanticThreshold",
  "cache.exactTtlMs",
  "cache.semanticTtlMs",
  "cache.retrievalTtlMs",
  "cache.agentPlanTtlMs",
  "cache.toolResultTtlMs",
  "retrieval.canonWeight",
  "retrieval.storyBibleWeight",
  "retrieval.characterKnowledgeWeight",
  "retrieval.relationshipEventWeight",
  "retrieval.memoryWeight",
  "retrieval.contextWeight",
  "character.voicePreference",
  "correction.rule",
  "tool.preferredId",
  "template.id",
  "template.instruction",
  "rulePackDigest",
  "approvedRuleCount",
]);

const CACHE_TTL_KEYS: Partial<Record<ClosedAICacheLayer, string>> = {
  exact: "cache.exactTtlMs",
  semantic: "cache.semanticTtlMs",
  retrieval: "cache.retrievalTtlMs",
  "agent-plan": "cache.agentPlanTtlMs",
  "tool-result": "cache.toolResultTtlMs",
};

function policyError(code: string, field?: string) {
  return Object.assign(new Error(code), { code, field });
}

function assertString(
  value: unknown,
  key: string,
  options: { maximum: number; allowed?: Set<string> },
) {
  if (
    typeof value !== "string"
    || !value.trim()
    || value !== value.trim()
    || value.length > options.maximum
    || (options.allowed && !options.allowed.has(value))
  ) {
    throw policyError("CONTROLLED_LEARNING_PROPOSAL_VALUE_INVALID", key);
  }
}

function assertNumber(value: unknown, key: string, minimum: number, maximum: number) {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
  ) {
    throw policyError("CONTROLLED_LEARNING_PROPOSAL_VALUE_INVALID", key);
  }
}

function assertKnownValue(key: string, value: string | number | boolean) {
  if (key === "router.preferredBackend") {
    assertString(value, key, { maximum: 32, allowed: BACKEND_IDS });
    return;
  }
  if (key === "planner.strategy") {
    assertString(value, key, { maximum: 64, allowed: PLANNER_STRATEGIES });
    return;
  }
  if (key === "preference.pacing") {
    assertString(value, key, { maximum: 32, allowed: PACING_VALUES });
    return;
  }
  if (key === "prompt.strategy") {
    assertString(value, key, { maximum: 64, allowed: PROMPT_STRATEGIES });
    return;
  }
  if (key === "cache.semanticThreshold") {
    assertNumber(value, key, 0.6, 0.95);
    return;
  }
  if (key.startsWith("cache.") && key.endsWith("TtlMs")) {
    assertNumber(value, key, 60_000, 86_400_000);
    return;
  }
  if (key.startsWith("retrieval.") || key === "pacingWeight") {
    assertNumber(value, key, 0, 2);
    return;
  }
  if (key === "approvedRuleCount" || key === "ruleCount") {
    assertNumber(value, key, 1, 64);
    return;
  }
  if (key === "sourceContentStored" || key === "verbatimCopyStored") {
    if (value !== false) {
      throw policyError("CONTROLLED_LEARNING_RAW_SOURCE_STORAGE_FORBIDDEN", key);
    }
    return;
  }
  if (
    key === "sourceDigest"
    || key === "transformationDigest"
    || key === "rulePackDigest"
  ) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/iu.test(value)) {
      throw policyError("CONTROLLED_LEARNING_PROPOSAL_VALUE_INVALID", key);
    }
    return;
  }
  if (key.endsWith(".category")) {
    assertString(value, key, { maximum: 32 });
    return;
  }
  if (key.endsWith(".statement")) {
    assertString(value, key, { maximum: 800 });
    return;
  }
  assertString(value, key, { maximum: 320 });
}

export function assertControlledLearningProposal(input: {
  level: ControlledLearningLevel;
  candidateType: ControlledLearningCandidate["candidateType"];
  proposal: ControlledLearningConfiguration;
}) {
  if (input.level !== "L0" && input.level !== "L1") {
    throw policyError("CONTROLLED_LEARNING_LEVEL_NOT_AVAILABLE");
  }
  if (!Object.hasOwn(ALLOWED_LEVELS, input.candidateType)) {
    throw policyError("CONTROLLED_LEARNING_CANDIDATE_TYPE_INVALID");
  }
  if (!ALLOWED_LEVELS[input.candidateType].includes(input.level)) {
    throw policyError("CONTROLLED_LEARNING_LEVEL_TYPE_MISMATCH");
  }
  const entries = Object.entries(input.proposal);
  if (!entries.length || entries.length > 128) {
    throw policyError("CONTROLLED_LEARNING_PROPOSAL_SIZE_INVALID");
  }
  for (const [key, value] of entries) {
    const dynamicRuleKey = input.candidateType === "knowledge-rule-pack"
      && /^rule\.\d+\.(?:id|category|statement)$/u.test(key);
    if (!KEYS_BY_TYPE[input.candidateType].has(key) && !dynamicRuleKey) {
      throw policyError("CONTROLLED_LEARNING_PROPOSAL_KEY_NOT_ALLOWED", key);
    }
    if (
      typeof value !== "string"
      && typeof value !== "number"
      && typeof value !== "boolean"
    ) {
      throw policyError("CONTROLLED_LEARNING_PROPOSAL_VALUE_INVALID", key);
    }
    assertKnownValue(key, value);
  }
}

export function sanitizeControlledLearningConfiguration(
  configuration: ControlledLearningConfiguration,
) {
  const sanitized: ControlledLearningConfiguration = {};
  for (const [key, value] of Object.entries(configuration)) {
    if (
      !RUNTIME_KEYS.has(key)
      && !/^rule\.\d+\.(?:id|category|statement)$/u.test(key)
    ) continue;
    try {
      assertKnownValue(key, value);
      sanitized[key] = value;
    } catch {
      // Invalid historical configuration is ignored instead of reaching a runtime.
    }
  }
  return sanitized;
}

export function learningString(
  configuration: ControlledLearningConfiguration | undefined,
  key: string,
) {
  const value = configuration?.[key];
  return typeof value === "string" ? value : null;
}

export function learningNumber(
  configuration: ControlledLearningConfiguration | undefined,
  key: string,
) {
  const value = configuration?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function learningSemanticThreshold(
  configuration: ControlledLearningConfiguration | undefined,
) {
  return Math.min(
    0.95,
    Math.max(0.6, learningNumber(configuration, "cache.semanticThreshold") ?? 0.72),
  );
}

export function learningCacheTtl(
  configuration: ControlledLearningConfiguration | undefined,
  layer: ClosedAICacheLayer,
) {
  const key = CACHE_TTL_KEYS[layer];
  if (!key) return undefined;
  const value = learningNumber(configuration, key);
  return value === null
    ? undefined
    : Math.min(86_400_000, Math.max(60_000, value));
}

export function learningPreferredBackend(
  configuration: ControlledLearningConfiguration | undefined,
) {
  const value = learningString(configuration, "router.preferredBackend");
  return value && BACKEND_IDS.has(value as ClosedAIBackendId)
    ? value as ClosedAIBackendId
    : null;
}

export function learningPlannerStrategy(
  configuration: ControlledLearningConfiguration | undefined,
) {
  const value = learningString(configuration, "planner.strategy") ?? "standard";
  return PLANNER_STRATEGIES.has(value) ? value : "standard";
}

export function learningPreferredTool(
  configuration: ControlledLearningConfiguration | undefined,
) {
  return learningString(configuration, "tool.preferredId");
}

export function learningRetrievalWeight(
  configuration: ControlledLearningConfiguration | undefined,
  kind: ClosedAIContextItem["kind"],
  facet?: ClosedAIContextItem["learningFacet"],
) {
  const facetKey: Partial<Record<
    NonNullable<ClosedAIContextItem["learningFacet"]>,
    string
  >> = {
    "character-knowledge": "retrieval.characterKnowledgeWeight",
    "relationship-event": "retrieval.relationshipEventWeight",
    "story-bible": "retrieval.storyBibleWeight",
    general: "retrieval.contextWeight",
  };
  const key: Partial<Record<ClosedAIContextItem["kind"], string>> = {
    canon: "retrieval.canonWeight",
    "story-bible": "retrieval.storyBibleWeight",
    memory: "retrieval.memoryWeight",
    retrieval: "retrieval.contextWeight",
  };
  const configured = facet && facetKey[facet]
    ? learningNumber(configuration, facetKey[facet]!)
    : key[kind]
      ? learningNumber(configuration, key[kind]!)
      : null;
  return configured ?? 1;
}
