import type { NovelAiProvider } from "../provider-interface";
import type { AiProviderCapabilities } from "../provider-capabilities";
import type { AiProviderResult } from "../provider-result";
import type { AiProviderRequest } from "../provider-types";
import { OllamaClient } from "./ollama-client";
import { checkOllamaHealth } from "./ollama-health";

function traceId() {
  return `ollama_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export class OllamaProvider implements NovelAiProvider {
  readonly id = "ollama-local" as const;
  private client: OllamaClient;
  private defaultModel?: string;

  constructor(options: { endpoint?: string; model?: string } = {}) {
    this.client = new OllamaClient({ endpoint: options.endpoint });
    this.defaultModel = options.model;
  }

  private async run(request: AiProviderRequest, prompt: string): Promise<AiProviderResult> {
    const started = Date.now();
    const model = this.defaultModel || (await checkOllamaHealth()).selectedModel;
    if (!model) {
      return {
        provider: this.id,
        model: "not-installed",
        taskType: request.taskType,
        content: "",
        finishReason: "error",
        latencyMs: Date.now() - started,
        dataLeftDevice: false,
        fallbackUsed: false,
        warnings: ["No installed Ollama model was detected"],
        requestId: request.requestId,
        traceId: traceId(),
      };
    }
    const result = await this.client.generate({ model, prompt, stream: Boolean(request.constraints?.stream), signal: request.abortSignal });
    const content = result.response ?? "";
    return {
      provider: this.id,
      model,
      taskType: request.taskType,
      content,
      structuredOutput: tryJson(content),
      finishReason: "stop",
      estimatedInputTokens: Math.ceil(prompt.length / 3.2),
      estimatedOutputTokens: Math.ceil(content.length / 3.2),
      latencyMs: Date.now() - started,
      dataLeftDevice: false,
      fallbackUsed: false,
      warnings: [],
      requestId: request.requestId,
      traceId: traceId(),
    };
  }

  analyzeStory(request: AiProviderRequest) { return this.run(request, `分析故事，輸出繁體中文：\n${request.input}`); }
  extractStoryBible(request: AiProviderRequest) { return this.run(request, `抽取 Story Bible 候選 JSON，不得直接寫入 canonical：\n${request.input}`); }
  summarizeChapter(request: AiProviderRequest) { return this.run(request, `摘要章節：\n${request.input}`); }
  checkConsistency(request: AiProviderRequest) { return this.run(request, `檢查一致性並列出候選問題：\n${request.input}`); }
  continueWriting(request: AiProviderRequest) { return this.run(request, `續寫候選草稿，不得覆蓋正文：\n${request.input}`); }
  rewriteText(request: AiProviderRequest) { return this.run(request, `改寫候選稿，保留原意：\n${request.input}`); }
  brainstormPlot(request: AiProviderRequest) { return this.run(request, `提出劇情發想：\n${request.input}`); }
  classifyTask(request: AiProviderRequest) { return this.run(request, `分類任務：\n${request.input}`); }

  async ping() {
    const health = await checkOllamaHealth();
    return { provider: this.id, checkedAt: new Date().toISOString(), ...health };
  }

  async getCapabilities(): Promise<AiProviderCapabilities> {
    const health = await checkOllamaHealth();
    return {
      provider: this.id,
      status: health.status,
      models: health.profiles.map((p) => p.modelId),
      capabilities: ["text", "structured_json", "streaming", "local_only", "story_bible", "generative_writing", "consistency_check"],
      maxContextTokens: health.profiles[0]?.contextWindow ?? 8192,
      supportsAbort: true,
      supportsStreaming: true,
      dataLeavesDevice: false,
    };
  }

  async estimateContext(request: AiProviderRequest) {
    const capabilities = await this.getCapabilities();
    const estimatedTokens = Math.ceil([request.input, request.recentContext ?? ""].join("\n").length / 3.2);
    return { estimatedTokens, maxContextTokens: capabilities.maxContextTokens, fits: estimatedTokens <= capabilities.maxContextTokens };
  }

  async cancel() {
    return true;
  }
}

function tryJson(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}
