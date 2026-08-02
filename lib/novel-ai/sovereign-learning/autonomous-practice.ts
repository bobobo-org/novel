import { evaluateApprovedLearningCapability } from "./capability-evaluator";
import { sha256Hex, stableStringify } from "./hashing";
import type { SovereignLearningRepository } from "./repository";

export const AUTONOMOUS_PRACTICE_VERSION = "controlled-autonomous-practice-v1" as const;

export type AutonomousPracticeExperience = {
  schemaVersion: typeof AUTONOMOUS_PRACTICE_VERSION;
  projectDigest: string;
  installationDigest: string;
  consentDigest: string;
  practiceKind: "approved-rule-sandbox-rehearsal";
  capabilityEvidenceDigest: string;
  approvedRuleSetDigest: string;
  approvedRuleCount: number;
  selectedRuleCount: number;
  taskCount: number;
  treatmentRecipeCount: number;
  completeRecipeCount: number;
  scores: {
    control: number;
    treatment: number;
    capabilityDelta: number;
    taskCoverage: number;
    lineageCoverage: number;
    recipeCompleteness: number;
  };
  outcome: "practice_passed" | "needs_more_coverage" | "blocked";
  recommendedNextStep: "retain_current_version" | "collect_more_approved_rules" | "human_review_required";
  privacy: {
    rawPromptIncluded: false;
    rawStoryIncluded: false;
    rawOutputIncluded: false;
    rawChainOfThoughtIncluded: false;
    credentialIncluded: false;
    authorOnlyIncluded: false;
    canonicalMutationCount: 0;
    memoryMutationCount: 0;
    modelWeightMutationCount: 0;
  };
  createdAt: string;
  experienceDigest: string;
};

export async function runAutonomousLearningPractice(input: {
  repository: SovereignLearningRepository;
  projectId: string;
  installationId: string;
  consentId: string;
  now?: () => string;
}) {
  if (!input.projectId.trim() || !input.installationId.trim() || !input.consentId.trim()) {
    throw Object.assign(new Error("自動練習缺少作品、裝置或同意識別資料。"), {
      code: "AUTONOMOUS_PRACTICE_IDENTITY_REQUIRED",
    });
  }
  const capability = await evaluateApprovedLearningCapability({
    repository: input.repository,
    projectId: input.projectId,
  });
  const createdAt = input.now?.() ?? new Date().toISOString();
  const treatmentRecipeCount = capability.taskReports.reduce((total, report) => total + report.treatmentRecipeCount, 0);
  const completeRecipeCount = capability.taskReports.reduce((total, report) => total + report.completeRecipeCount, 0);
  const body: Omit<AutonomousPracticeExperience, "experienceDigest"> = {
    schemaVersion: AUTONOMOUS_PRACTICE_VERSION,
    projectDigest: await sha256Hex(`project|${input.installationId}|${input.projectId}`),
    installationDigest: await sha256Hex(`installation|${input.installationId}`),
    consentDigest: await sha256Hex(`consent|${input.installationId}|${input.consentId}`),
    practiceKind: "approved-rule-sandbox-rehearsal",
    capabilityEvidenceDigest: capability.evidenceDigest,
    approvedRuleSetDigest: await sha256Hex(stableStringify(capability.selectedRuleIds)),
    approvedRuleCount: capability.approvedRuleCount,
    selectedRuleCount: capability.selectedRuleIds.length,
    taskCount: capability.taskReports.length,
    treatmentRecipeCount,
    completeRecipeCount,
    scores: capability.scores,
    outcome: capability.status === "passed"
      ? "practice_passed"
      : capability.status === "failed"
        ? "blocked"
        : "needs_more_coverage",
    recommendedNextStep: capability.status === "passed"
      ? "retain_current_version"
      : capability.status === "failed"
        ? "human_review_required"
        : "collect_more_approved_rules",
    privacy: {
      rawPromptIncluded: false,
      rawStoryIncluded: false,
      rawOutputIncluded: false,
      rawChainOfThoughtIncluded: false,
      credentialIncluded: false,
      authorOnlyIncluded: false,
      canonicalMutationCount: 0,
      memoryMutationCount: 0,
      modelWeightMutationCount: 0,
    },
    createdAt,
  };
  return {
    capability,
    experience: {
      ...body,
      experienceDigest: await sha256Hex(stableStringify(body)),
    } satisfies AutonomousPracticeExperience,
  };
}
