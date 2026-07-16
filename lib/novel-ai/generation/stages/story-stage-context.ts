import crypto from "crypto";
import type { SQLiteProjectConnection } from "../../storage/sqlite/sqlite-connection";
import type { StorySceneProfileId } from "../../scenes/story-scene-types";

export type StoryStageOperation =
  | "planStages"
  | "generateStage"
  | "regenerateStage"
  | "rewriteStage"
  | "extendStage"
  | "shortenStage"
  | "changeTone"
  | "changePerspective"
  | "changePacing"
  | "increaseDetail"
  | "decreaseDetail"
  | "splitStage"
  | "mergeStages"
  | "branchFromStage"
  | "rollbackStage"
  | "mergeWholeScene";

export type StoryProviderMode = "local-only" | "local-first" | "external-allowed" | "external-preferred";

export type StoryStageContext = {
  projectId: string;
  sceneId: string;
  stageId: string;
  branchId?: string;
  profileId: StorySceneProfileId | "general_story" | "custom_template";
  stageType: string;
  stageGoal: string;
  classificationPackId?: string;
  topicId?: string;
  storyEngineId?: string;
  previousStageSummary?: string;
  continuityState?: Record<string, unknown>;
  characterCanonical?: Array<Record<string, unknown>>;
  relationshipState?: Record<string, unknown>;
  requiredEvents?: string[];
  forbiddenEvents?: string[];
  requiredNextBeat?: string;
  narrativePurpose?: string;
  targetLength?: number;
  tone?: string;
  perspective?: string;
  policy?: {
    providerMode?: StoryProviderMode;
    adultPolicyEnabled?: boolean;
    policyVersion?: number;
    participantsVerifiedAdult?: boolean;
    relationshipPermitted?: boolean;
    consentState?: "active" | "withdrawn" | "unspecified";
    withdrawalState?: "none" | "active";
    ratingPermitted?: boolean;
    localOnlyRequired?: boolean;
  };
};

export type StoryStageGenerationOutput = {
  draftText: string;
  stageSummary: string;
  continuityChanges: Record<string, unknown>;
  characterStateChanges: Array<Record<string, unknown>>;
  relationshipChanges: Array<Record<string, unknown>>;
  plotProgress: string;
  newlyIntroducedFacts: Array<Record<string, unknown>>;
  possibleCandidates: Array<Record<string, unknown>>;
  unresolvedActions: string[];
  nextStageRequirements: string[];
  warnings: string[];
  usedContextIds: string[];
  provider: string;
  model: string;
  externalRequestCount: number;
  dataLeftDevice: boolean;
};

export type StoryStageVersionRecord = StoryStageGenerationOutput & {
  versionId: string;
  parentVersionId?: string;
  operation: StoryStageOperation;
  projectId: string;
  sceneId: string;
  stageId: string;
  branchId: string;
  profileId: string;
  stageType: string;
  promptHash: string;
  contentHash: string;
  createdAt: string;
};

export type StoryStageGenerationOptions = {
  connection?: SQLiteProjectConnection;
  ollamaEndpoint?: string;
  model?: string;
  timeoutMs?: number;
  stream?: boolean;
  signal?: AbortSignal;
  instruction?: string;
  parentVersionId?: string;
};

export function normalizeProfileId(profileId: StoryStageContext["profileId"]): StorySceneProfileId {
  if (profileId === "general_story") return "general_plot";
  if (profileId === "custom_template") return "custom";
  return profileId;
}

export function stableHash(value: unknown) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export function nowIso() {
  return new Date().toISOString();
}

export function id(prefix: string) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}
