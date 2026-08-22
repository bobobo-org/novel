import { normalizeForLearning, sha256Hex, stableStringify } from "./hashing";
import type {
  LearningRuleDimension,
  LearningRuleDraft,
  LearningRuleFamily,
  LearningWebSourceChannel,
} from "./types";

export const SHARED_LEARNING_SCHEMA_VERSION = "shared-abstract-learning-v1" as const;
export const SHARED_LEARNING_QUERY_LIMIT = 24 as const;
export const SHARED_LEARNING_DATABASE_FETCH_LIMIT = 48 as const;

export type SharedLearningSourceChannel = LearningWebSourceChannel | "user_supplied";

export type SharedLearningRule = LearningRuleDraft & {
  ruleHash: string;
  qualityScore: number;
  observationCount: number;
  teacherVersion: string;
  shared: true;
};

export type SharedLearningSnapshot = {
  schemaVersion: typeof SHARED_LEARNING_SCHEMA_VERSION;
  libraryDigest: string;
  generatedAt: string;
  rules: SharedLearningRule[];
  selection: {
    requestedLimit: number;
    returnedCount: number;
    databaseFetchLimit: typeof SHARED_LEARNING_DATABASE_FETCH_LIMIT;
    entireLibraryScanned: false;
    cacheTtlSeconds: 60;
  };
  persistenceStatus: "ready" | "baseline_only" | "degraded";
  privacy: {
    rawStoryIncluded: false;
    sourceSentencesIncluded: false;
    namedEntitiesIncluded: false;
    abstractRulesOnly: true;
  };
};

export type SharedLearningPublishReceipt = {
  status: "durably_recorded" | "persistence_not_configured" | "persistence_degraded" | "no_safe_rules";
  publishedCount: number;
  newObservationCount: number;
  rejectedCount: number;
  rawStoryReceived: false;
  abstractRulesOnly: true;
};

const FAMILIES = new Set<LearningRuleFamily>([
  "structure", "pacing", "character", "relationship", "dialogue", "style", "foreshadowing", "worldbuilding", "revision",
]);
const DIMENSIONS = new Set<LearningRuleDimension>([
  "viewpoint", "sentence_rhythm", "paragraph_rhythm", "dialogue_density", "opening_hook", "conflict_escalation",
  "reveal_cadence", "scene_transition", "ending_hook", "character_pressure", "relationship_movement", "world_rule_delivery",
  "foreshadow_payoff", "information_control", "tone", "other",
]);
const EXTRACTOR_KINDS = new Set<LearningRuleDraft["extractorKind"]>([
  "deterministic_pattern", "local_closed_ai", "external_teacher_ai",
]);
const CREDENTIAL_PATTERN = /\b(?:vcp|sbp|gh[pousr]|sk)-?[A-Za-z0-9_-]{20,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/iu;
const PROMPT_OVERRIDE_PATTERN = /(?:ignore|disregard|forget|override|bypass).{0,40}(?:system|developer|instruction|policy)|(?:忽略|無視|忘記|覆蓋|繞過).{0,40}(?:系統|開發者|指令|政策)/iu;
const URL_PATTERN = /https?:\/\/|www\.|@[A-Za-z0-9_]{3,}/iu;
const LONG_QUOTE_PATTERN = /[「『“"]([^」』”"\n]{12,})[」』”"]/u;

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function cleanString(value: unknown, maximum: number) {
  return typeof value === "string" ? normalizeForLearning(value).slice(0, maximum) : "";
}

function cleanTags(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => cleanString(item, 32)).filter(Boolean))].slice(0, 10)
    : [];
}

function cleanParameters(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .slice(0, 12)
    .flatMap(([key, item]) => {
      const cleanKey = cleanString(key, 40);
      if (!cleanKey || !["string", "number", "boolean"].includes(typeof item)) return [];
      return [[cleanKey, typeof item === "string" ? cleanString(item, 120) : item]];
    })) as Record<string, string | number | boolean>;
}

function qualityScore(rule: LearningRuleDraft) {
  const recipeComplete = [rule.recipe.when, rule.recipe.operation, rule.recipe.constraint, rule.recipe.evaluate]
    .every((value) => value.length >= 8) ? 1 : 0.5;
  const tagCoverage = Math.min(1, rule.tags.length / 4);
  return Math.round(clamp(
    rule.confidence * 0.3
    + rule.abstractionScore * 0.4
    + recipeComplete * 0.2
    + tagCoverage * 0.1,
  ) * 1_000) / 1_000;
}

function normalizeCandidate(value: unknown): LearningRuleDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<LearningRuleDraft>;
  const family = cleanString(row.family, 40) as LearningRuleFamily;
  const dimension = cleanString(row.dimension, 48) as LearningRuleDimension;
  const statement = cleanString(row.statement, 320);
  const recipeRow = row.recipe && typeof row.recipe === "object" ? row.recipe : null;
  const recipe = recipeRow ? {
    when: cleanString(recipeRow.when, 240),
    operation: cleanString(recipeRow.operation, 320),
    constraint: cleanString(recipeRow.constraint, 320),
    evaluate: cleanString(recipeRow.evaluate, 320),
  } : null;
  const combined = recipe ? [statement, recipe.when, recipe.operation, recipe.constraint, recipe.evaluate].join(" ") : statement;
  if (
    !FAMILIES.has(family)
    || !DIMENSIONS.has(dimension)
    || !recipe
    || statement.length < 12
    || Object.values(recipe).some((item) => item.length < 4)
    || CREDENTIAL_PATTERN.test(combined)
    || PROMPT_OVERRIDE_PATTERN.test(combined)
    || URL_PATTERN.test(combined)
    || LONG_QUOTE_PATTERN.test(combined)
    || !EXTRACTOR_KINDS.has(row.extractorKind as LearningRuleDraft["extractorKind"])
    || !Number.isFinite(row.confidence)
    || Number(row.confidence) < 0.35
    || Number(row.confidence) > 0.95
    || !Number.isFinite(row.abstractionScore)
    || Number(row.abstractionScore) < 0.55
    || !Number.isFinite(row.sourceOverlapScore)
    || Number(row.sourceOverlapScore) < 0
    || Number(row.sourceOverlapScore) >= 0.14
    || !Number.isInteger(row.longestSourceMatch)
    || Number(row.longestSourceMatch) < 0
    || Number(row.longestSourceMatch) >= 18
  ) return null;
  return {
    family,
    dimension,
    statement,
    tags: cleanTags(row.tags),
    parameters: cleanParameters(row.parameters),
    recipe,
    confidence: Math.round(Number(row.confidence) * 1_000) / 1_000,
    extractorKind: row.extractorKind as LearningRuleDraft["extractorKind"],
    extractorProvider: cleanString(row.extractorProvider, 120) || "unknown-abstract-teacher",
    extractorModel: cleanString(row.extractorModel, 120) || null,
    sourceOverlapScore: Math.round(Number(row.sourceOverlapScore) * 10_000) / 10_000,
    longestSourceMatch: Number(row.longestSourceMatch),
    abstractionScore: Math.round(Number(row.abstractionScore) * 10_000) / 10_000,
    conflictKey: cleanString(row.conflictKey, 120) || null,
  };
}

export async function normalizeSharedLearningRules(input: {
  rules: unknown[];
  teacherVersion: string;
  observationCount?: number;
}) {
  const teacherVersion = cleanString(input.teacherVersion, 120) || "unversioned-teacher";
  const rules: SharedLearningRule[] = [];
  let rejectedCount = 0;
  for (const value of input.rules.slice(0, 16)) {
    const rule = normalizeCandidate(value);
    if (!rule) {
      rejectedCount += 1;
      continue;
    }
    const ruleHash = await sha256Hex(stableStringify({
      family: rule.family,
      dimension: rule.dimension,
      statement: rule.statement,
      recipe: rule.recipe,
    }));
    if (rules.some((candidate) => candidate.ruleHash === ruleHash)) continue;
    rules.push({
      ...rule,
      ruleHash,
      qualityScore: qualityScore(rule),
      observationCount: Math.max(0, Math.floor(input.observationCount ?? 1)),
      teacherVersion,
      shared: true,
    });
  }
  return { rules, rejectedCount };
}

export function isLearningRuleFamily(value: string): value is LearningRuleFamily {
  return FAMILIES.has(value as LearningRuleFamily);
}

export function isLearningRuleDimension(value: string): value is LearningRuleDimension {
  return DIMENSIONS.has(value as LearningRuleDimension);
}
