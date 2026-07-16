import type { ViralStoryPlan } from "./viral-story-types";
export function auditViralStoryPlan(plan: ViralStoryPlan) {
  return {
    planId: plan.planId,
    externalRequestCount: plan.externalRequestCount,
    dataLeftDevice: plan.dataLeftDevice,
    qualityStatus: plan.quality.qualityStatus,
    issueCount: plan.quality.issues.length,
    branchId: plan.branchId,
  };
}
