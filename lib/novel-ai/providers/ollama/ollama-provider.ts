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

  constructor(options: { endpoint?: string; model?: string; timeoutMs?: number } = {}) {
    this.client = new OllamaClient({ endpoint: options.endpoint, timeoutMs: options.timeoutMs });
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
    const result = await this.client.generate({
      model,
      prompt,
      stream: Boolean(request.constraints?.stream),
      signal: request.abortSignal,
      options: {
        temperature: request.temperature ?? 0.2,
        num_predict: Number(request.maxOutputTokens ?? request.constraints?.maxOutputTokens ?? 220),
      },
    });
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

  analyzeStory(request: AiProviderRequest) {
    return this.run(request, `請分析目前故事狀態，指出主要衝突、角色風險、連續性風險與下一章可行方向。請使用繁體中文。\n\n${request.input}`);
  }

  extractStoryBible(request: AiProviderRequest) {
    return this.run(request, `請從章節文字抽取 Story Bible 候選資料。只輸出可由文字證明的候選，不要寫入正式 canonical，不要自行補設定。請優先使用 JSON。\n\n${request.input}`);
  }

  summarizeChapter(request: AiProviderRequest) {
    return this.run(request, `請摘要本章，包含短摘要、重要事件、角色變化、新事實與未解問題。請使用繁體中文。\n\n${request.input}`);
  }

  checkConsistency(request: AiProviderRequest) {
    return this.run(request, `請檢查下列內容的一致性問題，包含人物、時間線、世界規則、道具、伏筆與視角。只提出有依據的問題。\n\n${request.input}`);
  }

  continueWriting(request: AiProviderRequest) {
    return this.run(request, `請依照既有設定續寫下一段小說正文。不得覆蓋原文，不得改變已確定的角色姓名與世界規則。請使用繁體中文。\n\n${request.input}`);
  }

  rewriteText(request: AiProviderRequest) {
    return this.run(request, `請依照作者要求改寫選定文字，保留原意與連續性，並避免新增未鋪陳設定。請使用繁體中文。\n\n${request.input}`);
  }

  brainstormPlot(request: AiProviderRequest) {
    return this.run(request, `請提出劇情發展方案，包含優點、風險、連續性影響、需要鋪陳與可能回收。請使用繁體中文。\n\n${request.input}`);
  }

  classifyTask(request: AiProviderRequest) {
    return this.run(request, `請判斷作者任務類型，並說明需要讀取哪些作品資料。請使用繁體中文。\n\n${request.input}`);
  }

  async ping() {
    const health = await checkOllamaHealth();
    return {
      provider: this.id,
      checkedAt: new Date().toISOString(),
      ...health,
      status: health.status === "runtime_not_installed" ? "unavailable" as const : health.status,
    };
  }

  async getCapabilities(): Promise<AiProviderCapabilities> {
    const health = await checkOllamaHealth();
    return {
      provider: this.id,
      status: health.status === "runtime_not_installed" ? "unavailable" : health.status,
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
