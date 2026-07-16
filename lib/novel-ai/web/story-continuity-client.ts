export type WorkspacePrivacyStatus = {
  provider: "local-runtime" | "offline-rule";
  model: string;
  privacyMode: "local_only";
  externalAllowed: false;
  externalRequestCount: 0;
  dataLeftDevice: false;
};

export function buildWorkspaceStatus(): WorkspacePrivacyStatus {
  return {
    provider: "local-runtime",
    model: "qwen2.5:3b",
    privacyMode: "local_only",
    externalAllowed: false,
    externalRequestCount: 0,
    dataLeftDevice: false,
  };
}

export function createContinuityPanel(stageContent: string) {
  return {
    characterPosition: "preserved",
    emotion: stageContent.includes("cost") ? "pressured" : "stable",
    relationship: "candidate",
    location: "current scene",
    time: "same sequence",
    object: "tracked if mentioned",
    completedActions: stageContent ? ["stage draft created"] : [],
    unresolvedActions: stageContent ? ["author review required"] : [],
    requiredNextBeat: "continue from accepted stage outcome",
    warnings: stageContent ? [] : ["empty stage content"],
  };
}
