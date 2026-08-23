import type { SovereignLearningRepository } from "./repository";
import { sha256Hex, stableStringify } from "./hashing";
import type {
  LearnedNarrativeRule,
  LearningPreferenceProfile,
  LearningRuleFamily,
  LearningSourceRecord,
} from "./types";

export const APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION = "approved-learning-context-snapshot-v1" as const;

export type ApprovedLearningCausalSignal = {
  ruleId: string;
  family: LearningRuleFamily;
  dimension: LearnedNarrativeRule["dimension"];
  statement: string;
  operation: string;
  constraint: string;
  evaluate: string;
};

const TASK_FAMILIES: Record<string, LearningRuleFamily[]> = {
  continue_writing: ["structure", "pacing", "character", "relationship", "dialogue", "style", "foreshadowing", "worldbuilding"],
  rewrite: ["revision", "style", "pacing", "dialogue", "structure"],
  dialogue_generation: ["dialogue", "character", "relationship", "style", "pacing"],
  scene_expansion: ["structure", "pacing", "character", "worldbuilding", "style"],
  outline_generation: ["structure", "pacing", "foreshadowing", "character", "relationship", "worldbuilding"],
  three_choices: ["structure", "pacing", "character", "relationship", "foreshadowing", "worldbuilding", "revision", "dialogue"],
  default: ["structure", "pacing", "character", "dialogue", "style", "foreshadowing", "worldbuilding"],
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function factorial(value: number) {
  let result = 1;
  for (let current = 2; current <= value; current += 1) result *= current;
  return result;
}

function displayCombinationCount(value: number) {
  if (!Number.isFinite(value) || value > 1_000_000_000_000) return "> 1 兆";
  return value.toLocaleString("zh-TW");
}

export function estimateRuleCombinationSpace(rules: LearnedNarrativeRule[]) {
  const active = rules.filter((rule) => rule.status === "approved");
  const byDimension = new Map<string, LearnedNarrativeRule[]>();
  for (const rule of active) {
    const key = `${rule.family}:${rule.dimension}`;
    byDimension.set(key, [...(byDimension.get(key) ?? []), rule]);
  }
  const choiceProduct = [...byDimension.values()]
    .reduce((total, values) => total * Math.max(1, values.length), 1);
  const flexibleDimensions = Math.min(
    8,
    [...byDimension.keys()].filter((key) =>
      /opening|conflict|reveal|transition|ending|pressure|movement|payoff/u.test(key)).length,
  );
  const orderVariants = factorial(Math.max(1, flexibleDimensions));
  const total = choiceProduct * orderVariants;
  return {
    approvedRuleCount: active.length,
    dimensionCount: byDimension.size,
    choiceProduct: choiceProduct.toString(),
    orderVariants: orderVariants.toString(),
    total: total.toString(),
    display: displayCombinationCount(total),
    exhaustiveEnumerationRecommended: total <= 20_000,
  };
}

function taskFamilies(taskType: string) {
  return TASK_FAMILIES[taskType] ?? TASK_FAMILIES.default;
}

function scoreRule(
  rule: LearnedNarrativeRule,
  profile: LearningPreferenceProfile | null,
  sourceTrust: number,
  familyPriority: number,
) {
  const familyWeight = profile?.familyWeights[rule.family] ?? 0;
  const ruleWeight = profile?.ruleWeights[rule.id] ?? 0;
  return (
    rule.confidence * 0.36
    + rule.abstractionScore * 0.2
    + sourceTrust * 0.22
    + clamp(familyWeight, -1, 1) * 0.1
    + clamp(ruleWeight, -1, 1) * 0.1
    + familyPriority * 0.02
  );
}

export async function buildApprovedLearningContext(input: {
  repository: SovereignLearningRepository;
  projectId: string;
  taskType: string;
  maximumRules?: number;
}) {
  const maximumRules = Math.max(1, Math.min(16, input.maximumRules ?? 8));
  const families = taskFamilies(input.taskType);
  // Every story dimension contributes a fixed tiny candidate set. Retrieval
  // stays bounded after years of learning, while a high-volume dimension can
  // no longer crowd every other mechanism out before final scoring.
  const candidateLimitPerDimension = 2;
  const [rules, profile] = await Promise.all([
    input.repository.queryApprovedRulesByDimension(
      input.projectId,
      families,
      candidateLimitPerDimension,
    ),
    input.repository.getProfile(input.projectId),
  ]);
  const sources = (await Promise.all(
    [...new Set(rules.map((rule) => rule.sourceId))]
      .map((sourceId) => input.repository.getSource(sourceId)),
  )).filter((source): source is LearningSourceRecord => source !== null);
  const activeSourceTrust = new Map(
    sources
      .filter((source) => source.status === "active")
      .map((source) => [source.id, source.trustScore]),
  );
  const ranked = rules
    .filter((rule) =>
      rule.status === "approved"
      && activeSourceTrust.has(rule.sourceId)
      && families.includes(rule.family))
    .map((rule) => ({
      rule,
      score: scoreRule(
        rule,
        profile,
        activeSourceTrust.get(rule.sourceId) ?? 0,
        Math.max(0, families.length - families.indexOf(rule.family)),
      ),
    }))
    .sort((left, right) => right.score - left.score || left.rule.id.localeCompare(right.rule.id));
  const selected: typeof ranked = [];
  const usedDimensions = new Set<string>();
  for (const candidate of ranked) {
    const key = `${candidate.rule.family}:${candidate.rule.dimension}`;
    if (usedDimensions.has(key)) continue;
    selected.push(candidate);
    usedDimensions.add(key);
    if (selected.length >= maximumRules) break;
  }
  if (selected.length < maximumRules) {
    for (const candidate of ranked) {
      if (selected.some((item) => item.rule.id === candidate.rule.id)) continue;
      selected.push(candidate);
      if (selected.length >= maximumRules) break;
    }
  }
  const instructions = selected.map(({ rule }) => [
    `[${rule.family}/${rule.dimension}] ${rule.statement}`,
    `適用：${rule.recipe.when}`,
    `操作：${rule.recipe.operation}`,
    `限制：${rule.recipe.constraint}`,
    `檢查：${rule.recipe.evaluate}`,
  ].join("；"));
  const causalSignals: ApprovedLearningCausalSignal[] = selected.map(({ rule }) => ({
    ruleId: rule.id,
    family: rule.family,
    dimension: rule.dimension,
    statement: rule.statement,
    operation: rule.recipe.operation,
    constraint: rule.recipe.constraint,
    evaluate: rule.recipe.evaluate,
  }));
  const sourceDigestById = new Map(
    sources.map((source) => [source.id, source.contentHash]),
  );
  const snapshotDigest = await sha256Hex(stableStringify({
    snapshotVersion: APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION,
    projectId: input.projectId,
    taskType: input.taskType,
    maximumRules,
    preferenceProfileVersion: profile?.version ?? 0,
    rules: selected.map(({ rule }) => ({
      id: rule.id,
      revision: rule.revision,
      sourceDigest: sourceDigestById.get(rule.sourceId) ?? "missing-source-digest",
      family: rule.family,
      dimension: rule.dimension,
      statement: rule.statement,
      operation: rule.recipe.operation,
      constraint: rule.recipe.constraint,
      evaluate: rule.recipe.evaluate,
      confidence: rule.confidence,
      abstractionScore: rule.abstractionScore,
    })),
  }));
  return {
    snapshotVersion: APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION,
    snapshotDigest,
    selectedRuleIds: selected.map(({ rule }) => rule.id),
    instructions,
    causalSignals,
    rules: selected.map(({ rule }) => rule),
    preferenceProfileVersion: profile?.version ?? 0,
    combinationSpace: estimateRuleCombinationSpace(
      rules.filter((rule) => activeSourceTrust.has(rule.sourceId)),
    ),
    promptBoundary: "只使用已核准的抽象創作規則；不得還原、模仿或引用來源文本。",
  };
}

function seededRandom(seed: string) {
  let state = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function generateNarrativeRecipes(input: {
  rules: LearnedNarrativeRule[];
  taskType: string;
  count?: number;
  seed?: string;
}) {
  const families = taskFamilies(input.taskType);
  const approved = input.rules.filter((rule) =>
    rule.status === "approved" && families.includes(rule.family));
  const byFamily = new Map<LearningRuleFamily, LearnedNarrativeRule[]>();
  for (const rule of approved) {
    byFamily.set(rule.family, [...(byFamily.get(rule.family) ?? []), rule]);
  }
  const count = Math.max(1, Math.min(24, input.count ?? 3));
  const random = seededRandom(input.seed ?? `${input.taskType}:${approved.length}`);
  const recipes: Array<{
    recipeId: string;
    ruleIds: string[];
    steps: string[];
    constraints: string[];
    evaluation: string[];
  }> = [];
  const seen = new Set<string>();
  for (let attempt = 0; attempt < count * 12 && recipes.length < count; attempt += 1) {
    const selected = families.flatMap((family) => {
      const values = byFamily.get(family) ?? [];
      return values.length ? [values[Math.floor(random() * values.length)]] : [];
    });
    const signature = selected.map((rule) => rule.id).join("|");
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    recipes.push({
      recipeId: `recipe-${recipes.length + 1}`,
      ruleIds: selected.map((rule) => rule.id),
      steps: selected.map((rule) => rule.recipe.operation),
      constraints: selected.map((rule) => rule.recipe.constraint),
      evaluation: selected.map((rule) => rule.recipe.evaluate),
    });
  }
  return {
    recipes,
    combinationSpace: estimateRuleCombinationSpace(approved),
  };
}
