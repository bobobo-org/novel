import { executePlatformAI, localProviderSnapshots } from "../router/platform-executor";
import type {
  PlatformAIRequest,
  PlatformAIResult,
  PlatformProviderId,
  PlatformProviderSnapshot,
  PlatformTaskType,
} from "../router/platform-types";

export type StudioClosedAIStatus =
  | "ollama_ready"
  | "browser_ready"
  | "auth_required"
  | "runtime_required";

export type StudioClosedAISnapshot = {
  status: StudioClosedAIStatus;
  providerId: PlatformProviderId | null;
  modelId: string | null;
  providers: PlatformProviderSnapshot[];
};

export type StudioClosedAITaskInput = {
  projectId: string;
  task: string;
  input: string;
  targetLength?: number;
  signal?: AbortSignal;
};

type SnapshotReader = (signal?: AbortSignal) => Promise<PlatformProviderSnapshot[]>;
type PlatformExecutor = (request: PlatformAIRequest) => Promise<PlatformAIResult>;

export function studioPlatformTaskType(task: string): PlatformTaskType {
  if (task === "knowledge_rule_extraction") return "knowledge.ruleExtraction";
  if (task === "knowledge_rule_synthesis") return "knowledge.ruleSynthesis";
  if (task === "learning_preference_review") return "learning.preferenceReview";
  if (task === "first_chapter" || task === "continue_story" || task === "branch_choice") return "chapter.continue";
  if (task === "rewrite_selection" || task === "improve_settings") return "chapter.rewrite";
  if (task === "dialogue_boost") return "character.dialogue";
  if (task === "emotion_boost" || task === "pacing_tune") return "chapter.expand";
  if (task === "chapter_hook") return "chapter.endingCandidates";
  if (task === "three_choices") return "chapter.abcChoices";
  if (task === "plan_chapter") return "chapter.outline";
  if (task === "topic_recommendation") return "creation.genreSuggestions";
  if (task === "protagonist_recommendation") return "creation.protagonistCandidates";
  if (task === "world_recommendation") return "creation.worldCandidates";
  if (task === "conflict_recommendation") return "creation.conflictCandidates";
  if (task === "story_seed") return "creation.storySeed";
  if (task === "idea_directions" || task === "mode_recommendation") return "creation.guidedChoices";
  return "story.summary";
}

export async function discoverStudioClosedAI(
  signal?: AbortSignal,
  readSnapshots: SnapshotReader = localProviderSnapshots,
): Promise<StudioClosedAISnapshot> {
  const providers = await readSnapshots(signal);
  const localOllama = providers.find((provider) => provider.id === "local-ollama");
  const browserAI = providers.find((provider) => provider.id === "browser-ai");
  if (localOllama?.status === "ready") {
    return { status: "ollama_ready", providerId: localOllama.id, modelId: localOllama.modelId, providers };
  }
  if (browserAI?.status === "ready") {
    return { status: "browser_ready", providerId: browserAI.id, modelId: browserAI.modelId, providers };
  }
  if (localOllama?.status === "auth_required" || browserAI?.status === "auth_required") {
    return { status: "auth_required", providerId: null, modelId: null, providers };
  }
  return { status: "runtime_required", providerId: null, modelId: null, providers };
}

export async function runStudioClosedAI(
  input: StudioClosedAITaskInput,
  execute: PlatformExecutor = executePlatformAI,
) {
  const requestId = `studio-closed-${crypto.randomUUID()}`;
  const targetInstruction = input.targetLength
    ? `\n\n請將候選內容控制在約 ${input.targetLength} 個中文字以內。`
    : "";
  const result = await execute({
    requestId,
    projectId: input.projectId,
    taskType: studioPlatformTaskType(input.task),
    privacyMode: "strict-local",
    privacyLevel: "device_only",
    fallbackPolicy: "closed-only",
    preferredProvider: "local-ollama",
    input: `${input.input}${targetInstruction}`,
    context: [],
    externalConsent: false,
    requiredCapabilities: ["text"],
    closedOnly: true,
    offlineRequired: false,
    estimatedContextSize: Math.ceil(input.input.length / 2.5),
    idempotencyKey: requestId,
    signal: input.signal,
  });
  if (
    !["browser-ai", "local-ollama"].includes(result.providerId)
    || result.externalRequest
    || result.dataLeavesDevice
  ) {
    throw Object.assign(
      new Error("Closed AI provider returned a result outside the device-only boundary."),
      { code: "CLOSED_AI_BOUNDARY_VIOLATION" },
    );
  }
  return {
    taskId: result.requestId,
    status: "completed" as const,
    provider: result.providerId,
    model: result.modelId ?? "unknown",
    content: result.content,
    dataLeftDevice: result.dataLeavesDevice,
    externalRequest: result.externalRequest,
    warnings: result.provenance.warnings,
  };
}
