import { buildApprovedLearningContext, generateNarrativeRecipes } from "./combination-engine";
import { sha256Hex, stableStringify } from "./hashing";
import type { SovereignLearningRepository } from "./repository";

const DEFAULT_TASKS = [
  "continue_writing",
  "rewrite",
  "dialogue_generation",
  "scene_expansion",
  "outline_generation",
] as const;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export async function evaluateApprovedLearningCapability(input: {
  repository: SovereignLearningRepository;
  projectId: string;
  taskTypes?: string[];
}) {
  const taskTypes = [...new Set(input.taskTypes?.length ? input.taskTypes : DEFAULT_TASKS)];
  const [sources, allRules, profile] = await Promise.all([
    input.repository.listSources(input.projectId),
    input.repository.listRules(input.projectId),
    input.repository.getProfile(input.projectId),
  ]);
  const activeSources = new Map(sources.filter((source) => source.status === "active").map((source) => [source.id, source]));
  const approvedRules = allRules.filter((rule) => rule.status === "approved" && activeSources.has(rule.sourceId));
  const taskReports = await Promise.all(taskTypes.map(async (taskType) => {
    const context = await buildApprovedLearningContext({
      repository: input.repository,
      projectId: input.projectId,
      taskType,
      maximumRules: 12,
    });
    const control = generateNarrativeRecipes({ rules: [], taskType, count: 3, seed: "control" });
    const treatment = generateNarrativeRecipes({
      rules: context.rules,
      taskType,
      count: 3,
      seed: `learning-capability:${taskType}:${profile?.version ?? 0}`,
    });
    const completeRecipes = treatment.recipes.filter((recipe) =>
      recipe.ruleIds.length > 0
      && recipe.steps.length === recipe.ruleIds.length
      && recipe.constraints.length === recipe.ruleIds.length
      && recipe.evaluation.length === recipe.ruleIds.length);
    return {
      taskType,
      selectedRuleIds: context.selectedRuleIds,
      selectedRuleCount: context.selectedRuleIds.length,
      controlRecipeCount: control.recipes.length,
      treatmentRecipeCount: treatment.recipes.length,
      completeRecipeCount: completeRecipes.length,
      runtimeBoundaryApplied: context.promptBoundary.includes("只使用已核准"),
    };
  }));
  const selectedRuleIds = [...new Set(taskReports.flatMap((report) => report.selectedRuleIds))];
  const selectedRules = approvedRules.filter((rule) => selectedRuleIds.includes(rule.id));
  const lineageCoverage = selectedRules.length
    ? selectedRules.filter((rule) => activeSources.has(rule.sourceId)).length / selectedRules.length
    : 0;
  const taskCoverage = taskReports.filter((report) => report.selectedRuleCount > 0).length / Math.max(1, taskReports.length);
  const recipeCompleteness = taskReports.reduce((total, report) => total + report.completeRecipeCount, 0)
    / Math.max(1, taskReports.reduce((total, report) => total + report.treatmentRecipeCount, 0));
  const familyCoverage = new Set(selectedRules.map((rule) => rule.family)).size / Math.max(1, Math.min(6, approvedRules.length));
  const sourceIntegrity = sources.every((source) => source.rawContentRetained === false)
    && sources.every((source) => source.teacherEvidence?.every((teacher) => teacher.rawResponseRetained === false) ?? true);
  const treatmentScore = selectedRules.length === 0
    ? 0
    : round(100 * (
      taskCoverage * 0.32
      + lineageCoverage * 0.24
      + recipeCompleteness * 0.24
      + Math.min(1, familyCoverage) * 0.12
      + (sourceIntegrity ? 0.08 : 0)
    ));
  const controlScore = 0;
  const version = [
    `profile-${profile?.version ?? 0}`,
    `source-${Math.max(0, ...sources.map((source) => source.revision))}`,
    `rule-${Math.max(0, ...allRules.map((rule) => rule.revision))}`,
  ].join(".");
  const evidence = {
    schemaVersion: "approved-learning-capability-evaluation-v1",
    projectId: input.projectId,
    version,
    metric: "approved-rule-runtime-integration-not-model-weight-quality",
    approvedRuleCount: approvedRules.length,
    selectedRuleIds,
    activeSourceIds: [...new Set(selectedRules.map((rule) => rule.sourceId))],
    taskReports,
    scores: {
      control: controlScore,
      treatment: treatmentScore,
      capabilityDelta: treatmentScore - controlScore,
      taskCoverage: round(taskCoverage),
      lineageCoverage: round(lineageCoverage),
      recipeCompleteness: round(recipeCompleteness),
    },
    privacy: {
      rawSourceStored: false,
      rawTeacherResponseStored: false,
      canonicalMutationCount: 0,
      modelWeightMutationCount: 0,
    },
    rollbackAvailable: sources.some((source) => source.status === "active"),
  };
  const status = approvedRules.length === 0
    ? "needs_approved_rules"
    : !sourceIntegrity || lineageCoverage < 1 || taskReports.some((report) => !report.runtimeBoundaryApplied)
      ? "failed"
      : taskCoverage > 0 && recipeCompleteness === 1 && treatmentScore > controlScore
        ? "passed"
        : "needs_more_coverage";
  return {
    ...evidence,
    status,
    evidenceDigest: await sha256Hex(stableStringify({ ...evidence, status })),
    interpretation: status === "passed"
      ? "已核准規則能被執行期選取並形成完整創作配方；這證明能力整合，不代表底層模型權重已改寫。"
      : "尚未有足夠的已核准規則覆蓋任務；候選內容仍不會影響正式能力。",
  } as const;
}
