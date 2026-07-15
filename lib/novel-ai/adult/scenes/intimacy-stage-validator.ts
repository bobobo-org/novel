import type { IntimacyStage } from "./intimacy-scene-types";

export function validateStageSequence(stages: IntimacyStage[]) {
  const issues: Array<{ code: string; severity: "warning" | "blocking"; message: string }> = [];
  const ordinals = new Set<number>();
  for (const stage of stages) {
    if (ordinals.has(stage.ordinal)) issues.push({ code: "INTIMACY_STAGE_DUPLICATE_ORDINAL", severity: "blocking", message: `Duplicate ordinal ${stage.ordinal}.` });
    ordinals.add(stage.ordinal);
  }
  const consent = stages.find((stage) => stage.stageType === "consent");
  const escalation = stages.find((stage) => stage.stageType === "escalation" || stage.stageType === "explicit" || stage.stageType === "peak");
  if (escalation && consent && consent.ordinal > escalation.ordinal) {
    issues.push({ code: "INTIMACY_STAGE_DEPENDENCY_UNMET", severity: "blocking", message: "Consent stage must precede escalation stages." });
  }
  return { ok: !issues.some((issue) => issue.severity === "blocking"), issues, dataLeftDevice: false, externalRequestCount: 0 };
}
