import type { AiProviderCapabilities } from "./provider-capabilities";
import type { NovelAiProvider } from "./provider-interface";
import type { AiProviderResult } from "./provider-result";
import type { AiProviderRequest } from "./provider-types";

function result(request: AiProviderRequest, content: string, structuredOutput?: unknown): AiProviderResult {
  return {
    provider: "local-rule",
    model: "local-rule-v1",
    modelVersion: "h1-contract",
    taskType: request.taskType,
    content,
    structuredOutput,
    finishReason: "stop",
    estimatedInputTokens: Math.ceil(request.input.length / 3.2),
    estimatedOutputTokens: Math.ceil(content.length / 3.2),
    latencyMs: 1,
    dataLeftDevice: false,
    fallbackUsed: false,
    warnings: ["local-rule is deterministic and not model reasoning"],
    requestId: request.requestId,
    traceId: `local_${request.requestId}`,
  };
}

export class LocalRuleProvider implements NovelAiProvider {
  readonly id = "local-rule" as const;

  analyzeStory(request: AiProviderRequest) {
    return Promise.resolve(result(request, "本機規則分析：已建立最低限度候選結果。", { summary: request.input.slice(0, 160), source: "local-rule" }));
  }
  extractStoryBible(request: AiProviderRequest) {
    const candidates = request.input.match(/[一-龥A-Za-z0-9]{2,12}/g)?.slice(0, 5).map((value, index) => ({
      entityType: "open_thread",
      temporaryEntityId: `local_${index}`,
      operation: "create",
      fieldPath: "plot.openThreads",
      proposedValue: value,
      confidence: 0.35,
      evidenceType: "explicit_text",
      reason: "local-rule keyword candidate; requires author review",
    })) ?? [];
    return Promise.resolve(result(request, "本機規則抽取完成，僅供審核。", { candidates, confidence: 0.35 }));
  }
  summarizeChapter(request: AiProviderRequest) {
    return Promise.resolve(result(request, request.input.replace(/\s+/g, " ").slice(0, 240)));
  }
  checkConsistency(request: AiProviderRequest) {
    return Promise.resolve(result(request, "本機規則一致性檢查完成。", { issues: [] }));
  }
  continueWriting(request: AiProviderRequest) {
    return Promise.resolve(result(request, "【本機規則候選草稿】\n主角承接上一段的壓力，先確認眼前衝突，再保留下一章懸念。"));
  }
  rewriteText(request: AiProviderRequest) {
    return Promise.resolve(result(request, request.input));
  }
  brainstormPlot(request: AiProviderRequest) {
    return Promise.resolve(result(request, "1. 推進主要衝突\n2. 補一個角色代價\n3. 章尾留下具體鉤子"));
  }
  classifyTask(request: AiProviderRequest) {
    return Promise.resolve(result(request, request.taskType, { taskType: request.taskType }));
  }
  ping() {
    return Promise.resolve({ provider: this.id, status: "ready" as const, latencyMs: 1, modelCount: 1, selectedModel: "local-rule-v1", lastErrorCode: null, checkedAt: new Date().toISOString() });
  }
  getCapabilities(): Promise<AiProviderCapabilities> {
    return Promise.resolve({
      provider: this.id,
      status: "ready",
      models: ["local-rule-v1"],
      capabilities: ["text", "structured_json", "local_only", "story_bible", "consistency_check"],
      maxContextTokens: 4096,
      supportsAbort: false,
      supportsStreaming: false,
      dataLeavesDevice: false,
    });
  }
  async estimateContext(request: AiProviderRequest) {
    const estimatedTokens = Math.ceil(request.input.length / 3.2);
    return { estimatedTokens, maxContextTokens: 4096, fits: estimatedTokens <= 4096 };
  }
  async cancel() {
    return false;
  }
}
