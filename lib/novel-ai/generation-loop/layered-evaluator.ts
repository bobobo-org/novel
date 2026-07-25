import type { StoryContext } from "../story-intelligence";
import type { GenerationEvaluation } from "./types";

export const LAYERED_EVALUATOR_VERSION = "p23-layered-evaluator-v1" as const;

export type LayeredEvaluatorResult = {
  schemaVersion: typeof LAYERED_EVALUATOR_VERSION;
  deterministic: {
    blocking: boolean;
    issueCodes: string[];
    authority: "final_for_hard_rules";
  };
  model: {
    disagreementCount: number;
    authority: "advisory";
  };
  adversarial: {
    blocking: boolean;
    findings: string[];
    authority: "fail_closed";
  };
  disposition: "eligible_for_approval" | "awaiting_review" | "rejected";
};

function contextMemories(context: StoryContext) {
  return [
    ...context.currentScene,
    ...context.recentContext,
    ...context.characterContext,
    ...context.worldContext,
    ...context.plotContext,
    ...context.foreshadowingContext,
  ];
}

export function runLayeredEvaluator(input: {
  evaluation: GenerationEvaluation;
  context: StoryContext;
  externalRequestCount: number;
  canonicalMutationCount: number;
}) {
  const deterministicIssues = input.evaluation.continuityReport.issues
    .filter((issue) => issue.deterministic && ["major", "blocking"].includes(issue.severity))
    .map((issue) => issue.type);
  const tainted = contextMemories(input.context)
    .filter((memory) => memory.metadata.taint?.blockedUsages.includes("approval"))
    .map((memory) => memory.memoryId);
  const adversarialFindings = [
    ...(input.externalRequestCount > 0 ? ["SILENT_EXTERNAL_PROVIDER_SWITCH"] : []),
    ...(input.canonicalMutationCount > 0 ? ["CANONICAL_MUTATION_BEFORE_APPROVAL"] : []),
    ...(tainted.length ? ["TAINTED_CONTEXT_CANNOT_AUTHORIZE_APPROVAL"] : []),
  ];
  const deterministicBlocking = deterministicIssues.length > 0;
  const adversarialBlocking = adversarialFindings.length > 0
    && adversarialFindings.some((finding) => finding !== "TAINTED_CONTEXT_CANNOT_AUTHORIZE_APPROVAL");
  const modelDisagreement = input.evaluation.disagreements.length;
  const disposition = deterministicBlocking || adversarialBlocking
    ? "rejected"
    : modelDisagreement
      ? "awaiting_review"
      : "eligible_for_approval";
  return {
    schemaVersion: LAYERED_EVALUATOR_VERSION,
    deterministic: { blocking: deterministicBlocking, issueCodes: deterministicIssues, authority: "final_for_hard_rules" },
    model: { disagreementCount: modelDisagreement, authority: "advisory" },
    adversarial: { blocking: adversarialBlocking, findings: adversarialFindings, authority: "fail_closed" },
    disposition,
  } satisfies LayeredEvaluatorResult;
}
