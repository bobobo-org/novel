import {
  CONTROLLED_LEARNING_SCHEMA_VERSION,
  type ControlledLearningCandidateStatus,
  type ControlledLearningOutcome,
  type ControlledLearningRecord,
  type ControlledLearningSourceClass,
} from "./types";

function sourceClass(outcome: ControlledLearningOutcome): ControlledLearningSourceClass {
  if (outcome === "rejected" || outcome === "abandoned") return "negative-label-only";
  if (outcome === "approved_story_bible" || outcome === "approved_canon") {
    return "approved-authority";
  }
  if ([
    "consistency_result",
    "character_consistency_result",
    "plot_continuity_result",
    "tool_result",
    "planner_result",
  ].includes(outcome)) {
    return "verified-runtime-result";
  }
  return "user-decision";
}

function pipelineStatus(status: ControlledLearningCandidateStatus) {
  if (status === "evaluated") return "evaluated" as const;
  if (status === "approved") return "approved" as const;
  if (status === "testing") return "ab-testing" as const;
  if (status === "adopted") return "adopted" as const;
  if (status === "rolled_back") return "rolled-back" as const;
  if (status === "rejected") return "rejected" as const;
  return "candidate-created" as const;
}

export function migrateControlledLearningRecord(
  value: unknown,
): ControlledLearningRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== "controlled-learning-os-v1"
    && record.schemaVersion !== CONTROLLED_LEARNING_SCHEMA_VERSION
  ) return null;

  if (record.schemaVersion === CONTROLLED_LEARNING_SCHEMA_VERSION) {
    return structuredClone(record) as ControlledLearningRecord;
  }

  const base = {
    ...structuredClone(record),
    schemaVersion: CONTROLLED_LEARNING_SCHEMA_VERSION,
  };
  if (record.kind === "experience") {
    const outcome = record.outcome as ControlledLearningOutcome;
    const negativeSignalOnly = outcome === "rejected" || outcome === "abandoned";
    return {
      ...base,
      sourceClass: sourceClass(outcome),
      negativeSignalOnly,
      privacyFilterStatus: "legacy-review-required",
      outcomeLabelingStatus: "completed",
      evaluatorEligible: false,
      formalLearningData: false,
      recordDigest: "",
    } as ControlledLearningRecord;
  }
  if (record.kind === "candidate") {
    const status = record.status as ControlledLearningCandidateStatus;
    const evaluation = record.evaluation && typeof record.evaluation === "object"
      ? {
        ...(record.evaluation as Record<string, unknown>),
        evidenceDigest: String(record.proposalDigest || "").padEnd(64, "0").slice(0, 64),
      }
      : null;
    const humanApproval = record.humanApproval && typeof record.humanApproval === "object"
      ? {
        ...(record.humanApproval as Record<string, unknown>),
        approvalTransactionId: "",
        approvalTransactionDigest: "",
      }
      : null;
    return {
      ...base,
      evaluation,
      humanApproval,
      pipelineStatus: pipelineStatus(status),
    } as ControlledLearningRecord;
  }
  if (record.kind === "version") {
    return {
      ...base,
      approvalTransactionId: "",
      approvalTransactionDigest: "",
    } as ControlledLearningRecord;
  }
  if (record.kind === "dataset") {
    return {
      ...base,
      approvalTransactionId: "",
      approvalTransactionDigest: "",
    } as ControlledLearningRecord;
  }
  if (record.kind === "ab-test") {
    const baselineScores = Array.isArray(record.baselineScores)
      ? record.baselineScores.filter((item): item is number => typeof item === "number")
      : [];
    const candidateScores = Array.isArray(record.candidateScores)
      ? record.candidateScores.filter((item): item is number => typeof item === "number")
      : [];
    const baselineMean = baselineScores.length
      ? baselineScores.reduce((sum, item) => sum + item, 0) / baselineScores.length
      : null;
    const candidateMean = candidateScores.length
      ? candidateScores.reduce((sum, item) => sum + item, 0) / candidateScores.length
      : null;
    return {
      ...base,
      baselineMean,
      candidateMean,
      measuredImprovement: baselineMean === null || candidateMean === null
        ? null
        : candidateMean - baselineMean,
    } as ControlledLearningRecord;
  }
  if (
    record.kind === "consent"
    || record.kind === "kill-switch"
  ) {
    return base as ControlledLearningRecord;
  }
  return null;
}
