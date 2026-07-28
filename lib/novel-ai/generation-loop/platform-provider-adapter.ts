import { executePlatformAI } from "../router/platform-executor";
import type { PlatformTaskType } from "../router/platform-types";
import type {
  ClosedGenerationProvider,
  GenerationProviderRequest,
  GenerationProviderResponse,
} from "./types";

function taskType(request: GenerationProviderRequest): PlatformTaskType {
  if (request.taskType === "planning" || request.taskType === "outline_generation") return "chapter.outline";
  if (request.taskType === "evaluation") return "story.consistencyCheck";
  if (request.taskType === "revision" || request.taskType === "rewrite") return "chapter.rewrite";
  if (request.taskType === "dialogue_generation") return "character.dialogue";
  if (request.taskType === "scene_expansion") return "chapter.expand";
  return "chapter.continue";
}

function localJson(value: string) {
  try {
    return JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").replace(/,\s*([}\]])/g, "$1"));
  } catch {
    return undefined;
  }
}

export class PlatformGenerationProviderAdapter implements ClosedGenerationProvider {
  readonly allowPrivateHub: boolean;

  constructor(options: { allowPrivateHub?: boolean } = {}) {
    this.allowPrivateHub = options.allowPrivateHub === true;
  }

  async generate(request: GenerationProviderRequest): Promise<GenerationProviderResponse> {
    const result = await executePlatformAI({
      requestId: request.requestId,
      projectId: request.projectId,
      taskType: taskType(request),
      privacyMode: this.allowPrivateHub ? "private-hub-allowed" : "strict-local",
      privacyLevel: this.allowPrivateHub ? "private_infrastructure_only" : "device_only",
      fallbackPolicy: "closed-only",
      input: request.draft ? `${request.instruction}\n\n【待處理候選】\n${request.draft}` : request.instruction,
      context: [
        request.context.currentScene.map((row) => row.text).join("\n"),
        request.context.recentContext.map((row) => row.text).join("\n"),
        request.context.characterContext.map((row) => row.text).join("\n"),
        request.context.worldContext.map((row) => row.text).join("\n"),
        request.context.plotContext.map((row) => row.text).join("\n"),
        request.context.foreshadowingContext.map((row) => row.text).join("\n"),
        `限制：${request.context.constraints.join("；")}`,
        `文風：${request.context.styleProfile.join("；")}`,
      ].filter((value) => value.trim().length > 0),
      externalConsent: false,
      requiresStructured: request.structured,
      requiredCapabilities: request.structured ? ["text", "structured"] : ["text"],
      closedOnly: true,
      offlineRequired: false,
      estimatedContextSize: request.context.tokenBudget.used,
      idempotencyKey: request.requestId,
      signal: request.signal,
    });
    return {
      provider: result.providerId === "local-ollama" ? "local-ollama" : result.providerId === "browser-ai" ? "browser-ai" : result.providerId === "private-ai-hub" ? "private-ai-hub" : "local-rule",
      model: result.modelId ?? "unknown",
      modelDigest: result.modelDigest ?? null,
      text: result.content,
      structuredOutput: request.structured ? localJson(result.content) : undefined,
      latencyMs: result.elapsedMs,
      estimatedInputTokens: request.context.tokenBudget.used,
      estimatedOutputTokens: Math.ceil(result.content.length / 2.5),
      externalRequest: result.externalRequest,
      warnings: result.provenance.warnings,
      generationParameters: { structured: request.structured, maxOutputTokens: request.maxOutputTokens },
    };
  }
}
