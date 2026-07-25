import type { NovelAiProvider } from "../provider-interface";
import type { AiProviderCapabilities } from "../provider-capabilities";
import type { AiProviderResult } from "../provider-result";
import type { AiProviderRequest } from "../provider-types";
import { OllamaClient } from "./ollama-client";
import { checkOllamaHealth } from "./ollama-health";

function traceId() {
  return `ollama_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function contextText(request: AiProviderRequest) {
  return [
    request.recentContext ? `【最近正文與摘要】\n${request.recentContext}` : "",
    request.storyBibleContext ? `【Story Bible 與相關記憶】\n${JSON.stringify(request.storyBibleContext)}` : "",
    request.constraints ? `【限制】\n${JSON.stringify(request.constraints)}` : "",
    `【作者要求或正文】\n${request.input}`,
  ].filter(Boolean).join("\n\n");
}

function taskPrompt(instruction: string, request: AiProviderRequest) {
  return [
    "你是完全在使用者裝置上執行的繁體中文小說助手。",
    "不得新增來源中不存在的硬事實；不確定時明確標示不確定。",
    instruction,
    contextText(request),
  ].join("\n\n");
}

function tryJson(content: string) {
  try {
    const normalized = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(normalized);
  } catch {
    return undefined;
  }
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
      format: request.outputSchema ? "json" : undefined,
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
    return this.run(request, taskPrompt("分析故事目前階段、主要衝突、人物風險與未解情節。每個判斷都要指出參考的章節或記憶。", request));
  }

  extractStoryBible(request: AiProviderRequest) {
    return this.run(request, taskPrompt("只抽取原文明確支持的 Story Bible 候選。每筆必須包含 entityId、field、value、factType、evidenceSpans、confidence；禁止直接宣稱已寫入正式資料。", request));
  }

  summarizeChapter(request: AiProviderRequest) {
    return this.run(request, taskPrompt("摘要本章人物、事件、地點、因果、狀態變化、伏筆與未解問題。使用繁體中文，不加入原文沒有的內容。", request));
  }

  checkConsistency(request: AiProviderRequest) {
    return this.run(request, taskPrompt("檢查人物、地點、時間線、世界規則、物品、生死狀態、敘事視角與重複內容。輸出分數、理由與來源；不得覆蓋 deterministic rule 已確認的衝突。", request));
  }

  continueWriting(request: AiProviderRequest) {
    return this.run(request, taskPrompt("續寫下一段小說正文。承接現有因果與人物目標，遵守世界規則，避免 AI 套話與重複摘要，結尾留下新的後果或推進。只輸出候選正文。", request));
  }

  rewriteText(request: AiProviderRequest) {
    return this.run(request, taskPrompt("依作者要求局部修稿，保留原事件與已確認事實，修正因果、節奏、人物語氣、重複與一致性問題。只輸出修訂後正文。", request));
  }

  brainstormPlot(request: AiProviderRequest) {
    return this.run(request, taskPrompt("提出可執行的情節規劃，說明行動、阻力、後果、伏筆與章尾鉤子。所有建議必須能追溯至目前故事資料。", request));
  }

  classifyTask(request: AiProviderRequest) {
    return this.run(request, taskPrompt("判斷作者要求屬於摘要、抽取、一致性檢查、續寫、改寫、對話、場景擴寫、大綱或情節建議。", request));
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
      models: health.profiles.map((profile) => profile.modelId),
      capabilities: ["text", "structured_json", "streaming", "local_only", "story_bible", "generative_writing", "consistency_check"],
      maxContextTokens: health.profiles[0]?.contextWindow ?? 8192,
      supportsAbort: true,
      supportsStreaming: true,
      dataLeavesDevice: false,
    };
  }

  async estimateContext(request: AiProviderRequest) {
    const capabilities = await this.getCapabilities();
    const estimatedTokens = Math.ceil([request.input, request.recentContext ?? "", JSON.stringify(request.storyBibleContext ?? null)].join("\n").length / 3.2);
    return { estimatedTokens, maxContextTokens: capabilities.maxContextTokens, fits: estimatedTokens <= capabilities.maxContextTokens };
  }

  async cancel() {
    return true;
  }
}
