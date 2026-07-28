import type { NovelAiProvider } from "../providers/provider-interface";
import type { AiProviderRequest, AiTaskType } from "../providers/provider-types";
import type {
  ClosedGenerationProvider,
  GenerationProviderRequest,
  GenerationProviderResponse,
} from "./types";

function providerTask(task: GenerationProviderRequest["taskType"]): AiTaskType {
  if (task === "planning") return "plot_brainstorm";
  if (task === "evaluation") return "consistency_check";
  if (task === "revision") return "rewrite";
  return task;
}

export class NovelProviderGenerationAdapter implements ClosedGenerationProvider {
  readonly provider: NovelAiProvider;

  constructor(provider: NovelAiProvider) {
    this.provider = provider;
  }

  async generate(request: GenerationProviderRequest): Promise<GenerationProviderResponse> {
    const common: AiProviderRequest = {
      requestId: request.requestId,
      projectId: request.projectId,
      taskType: providerTask(request.taskType),
      input: request.instruction,
      recentContext: request.context.recentContext.map((row) => row.text).join("\n\n"),
      storyBibleContext: request.context,
      outputSchema: request.structured ? { type: "object" } : undefined,
      timeoutMs: 45_000,
      maxOutputTokens: request.maxOutputTokens,
      privacyMode: "local_only",
      allowExternalProvider: false,
      abortSignal: request.signal,
    };
    const result = request.taskType === "evaluation"
      ? await this.provider.checkConsistency(common)
      : request.taskType === "revision" || request.taskType === "rewrite"
        ? await this.provider.rewriteText(common)
        : request.taskType === "planning"
          ? await this.provider.brainstormPlot(common)
          : await this.provider.continueWriting(common);
    return {
      provider: result.provider === "ollama-local" ? "local-ollama" : result.provider === "local-rule" ? "local-rule" : "private-ai-hub",
      model: result.model,
      modelDigest: null,
      text: result.content,
      structuredOutput: result.structuredOutput,
      latencyMs: result.latencyMs,
      estimatedInputTokens: result.estimatedInputTokens ?? result.promptTokens ?? 0,
      estimatedOutputTokens: result.estimatedOutputTokens ?? result.outputTokens ?? 0,
      externalRequest: result.dataLeftDevice,
      warnings: result.warnings,
      generationParameters: { structured: request.structured, maxOutputTokens: request.maxOutputTokens },
    };
  }
}
