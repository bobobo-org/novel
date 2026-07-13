import {
  ChapterPlanSchema,
  ContinuityReviewSchema,
  enforceOptionLabels,
  StoryAnalysisSchema,
  type ChapterPlan,
  type ContinuityReview,
  type StoryAnalysis,
  type StoryContext,
  type StoryOption,
} from "./schemas";
import {
  buildAnalysisPrompt,
  buildChapterPlanPrompt,
  buildContinuityPrompt,
  STORY_ANALYZER_SYSTEM_PROMPT,
} from "./prompts";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";

export const QUALITY_GATE_VERSION = "quality-gate-v3";

export interface NovelModelProvider {
  analyzeStory(context: StoryContext): Promise<StoryAnalysis>;
  generateChapterPlan(context: StoryContext, selection: StoryOption, authorSupplement?: string): Promise<ChapterPlan>;
  reviewContinuity(context: StoryContext, candidateText: string): Promise<ContinuityReview>;
}

export class ModelConfigurationError extends Error {
  code = "MODEL_NOT_CONFIGURED";
}

function modelConfig() {
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
  const provider = process.env.AI_PROVIDER || (googleKey ? "google" : "openai-compatible");
  const requestedModel = process.env.AI_MODEL || "";
  const googleModel = requestedModel.startsWith("gemini") ? requestedModel : "gemini-flash-latest";
  return {
    provider,
    apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "",
    googleKey,
    model: provider === "google" ? googleModel : requestedModel || "gpt-4o-mini",
    baseUrl: (process.env.AI_BASE_URL || "https://api.openai.com/v1/chat/completions").replace(/\/$/, ""),
  };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("模型回應中找不到可解析的 JSON。");
    return JSON.parse(match[0]);
  }
}

async function callJsonModel(userPrompt: string, signal?: AbortSignal): Promise<unknown> {
  const cfg = modelConfig();
  if (cfg.provider === "google") {
    if (!cfg.googleKey) {
      throw new ModelConfigurationError("尚未設定 GOOGLE_GENERATIVE_AI_API_KEY，無法使用 Gemini。");
    }
    const { text } = await generateText({
      model: google(cfg.model),
      system: STORY_ANALYZER_SYSTEM_PROMPT,
      prompt: userPrompt,
      abortSignal: signal,
    });
    return extractJson(text);
  }

  if (!cfg.apiKey) {
    throw new ModelConfigurationError("尚未設定 AI_API_KEY 或 OPENAI_API_KEY，無法使用 OpenAI-compatible 模型。");
  }

  const response = await fetch(cfg.baseUrl, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: STORY_ANALYZER_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    let code = "MODEL_HTTP_ERROR";
    try {
      const body = await response.json();
      code = typeof body?.error?.type === "string" ? body.error.type : code;
    } catch {
      // Do not expose provider response bodies because they can contain request IDs.
    }
    throw new Error(`模型服務呼叫失敗：HTTP ${response.status}，${code}。請檢查 AI_BASE_URL、模型名稱與金鑰。`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("模型回應缺少 choices[0].message.content。");
  return extractJson(content);
}

async function withRepair<T>(prompt: string, parse: (value: unknown) => T): Promise<T> {
  const first = await callJsonModel(prompt);
  try {
    return parse(first);
  } catch (error) {
    const repairPrompt =
      `${prompt}\n\n上一版 JSON 不符合 schema：${error instanceof Error ? error.message : "未知錯誤"}\n` +
      `請只回傳修正後的 JSON，不要 Markdown，不要說明。上一版輸出：${JSON.stringify(first).slice(0, 5000)}`;
    return parse(await callJsonModel(repairPrompt));
  }
}

function optionSimilarity(a: string, b: string): boolean {
  const left = new Set(a.replace(/[^\p{L}\p{N}]/gu, "").split(""));
  const right = new Set(b.replace(/[^\p{L}\p{N}]/gu, "").split(""));
  const overlap = [...left].filter((x) => right.has(x)).length;
  const denom = Math.max(left.size, right.size, 1);
  return overlap / denom > 0.82;
}

function applyQualityGate(context: StoryContext, analysis: StoryAnalysis): StoryAnalysis {
  const warnings = [...(analysis.qualityGate?.warnings || [])];
  const actions = analysis.options.map((x) => x.action.trim());
  const preference = (context.authorPreference || {}) as {
    forbiddenCharacterBehaviors?: string[];
    rejectedStrategyPatterns?: string[];
    repeatedRejectionReasons?: Array<{ reason?: string; count?: number }>;
  };

  if (new Set(actions).size !== actions.length || optionSimilarity(actions[0], actions[1]) || optionSimilarity(actions[1], actions[2]) || optionSimilarity(actions[0], actions[2])) {
    warnings.push("A/B/C 選項過於相似，應提供三種不同決策後果。");
  }
  for (const option of analysis.options) {
    if (option.action.length < 18) warnings.push(`${option.label} 選項太短，應包含具體人物行動。`);
    if (!option.action.includes(context.protagonist.name || "主角")) warnings.push(`${option.label} 未明確引用主角姓名或主角稱呼。`);
    if (option.risk === "高" && option.possibleCost.length < 4) warnings.push(`${option.label} 是高風險選項，但代價描寫不足。`);
    for (const forbidden of context.forbiddenChanges || []) {
      if (forbidden && option.action.includes(forbidden)) warnings.push(`${option.label} 可能違反禁止變更：${forbidden}`);
    }
    for (const forbiddenBehavior of preference.forbiddenCharacterBehaviors || []) {
      if (forbiddenBehavior && option.action.includes(forbiddenBehavior.slice(0, 24))) warnings.push(`${option.label} 可能踩到作者反覆拒絕的角色行為。`);
    }
    for (const rejectedStrategy of preference.rejectedStrategyPatterns || []) {
      if (rejectedStrategy && (option.strategyType.includes(rejectedStrategy) || option.action.includes(rejectedStrategy.slice(0, 16)))) {
        warnings.push(`${option.label} 使用了作者曾拒絕的策略：${rejectedStrategy}`);
      }
    }
  }
  for (const reason of preference.repeatedRejectionReasons || []) {
    if ((reason.count || 0) >= 2 && actions.some((action) => reason.reason && action.includes(reason.reason.slice(0, 16)))) {
      warnings.push(`本次候選可能重複作者常見拒絕原因：${reason.reason}`);
    }
  }

  const evidence = [...(analysis.analysisEvidence || [])];
  if (evidence.length === 0) {
    evidence.push({
      sourceType: "主角設定",
      sourceId: "protagonist",
      sourceLabel: context.protagonist.name || "主角",
      reason: `依據主角原型「${context.protagonist.archetype || "尚未設定"}」與行動方式「${context.protagonist.actionStyle || "尚未設定"}」判斷。`,
    });
  }
  if (context.previousChapterSummary && evidence.length < 2) {
    evidence.push({ sourceType: "上一章摘要", sourceId: "previousChapterSummary", sourceLabel: "上一章摘要", reason: context.previousChapterSummary.slice(0, 200) });
  }
  if (context.unresolvedEvents?.[0] && evidence.length < 2) {
    evidence.push({ sourceType: "未解事件", sourceId: "unresolvedEvents.0", sourceLabel: "未解事件", reason: context.unresolvedEvents[0] });
  }
  if (evidence.length < 2) warnings.push("分析證據少於 2 筆，建議補足故事記憶或上一章摘要。");

  const scores = analysis.analysisScores || {
    plotProgress: 7,
    characterConsistency: 7,
    novelty: 7,
    readerHook: 7,
    emotionalPayoff: 7,
    riskClarity: 7,
    evidenceUse: 7,
  };
  if (scores.characterConsistency < 6) warnings.push("角色一致性分數偏低，請檢查主角行為是否偏離原型。");
  if (scores.evidenceUse < 6) warnings.push("證據引用分數偏低，請增加對上下文的明確承接。");

  return {
    ...analysis,
    analysisScores: scores,
    analysisEvidence: evidence.slice(0, 12),
    qualityGate: { passed: warnings.length === 0, warnings: [...new Set(warnings)].slice(0, 20) },
  };
}

export class OpenAICompatibleNovelProvider implements NovelModelProvider {
  async analyzeStory(context: StoryContext): Promise<StoryAnalysis> {
    return withRepair(buildAnalysisPrompt(context), (value) =>
      applyQualityGate(context, enforceOptionLabels(StoryAnalysisSchema.parse(value))),
    );
  }

  async generateChapterPlan(context: StoryContext, selection: StoryOption, authorSupplement = ""): Promise<ChapterPlan> {
    return withRepair(buildChapterPlanPrompt(context, selection, authorSupplement), (value) =>
      ChapterPlanSchema.parse(value),
    );
  }

  async reviewContinuity(context: StoryContext, candidateText: string): Promise<ContinuityReview> {
    return withRepair(buildContinuityPrompt(context, candidateText), (value) => ContinuityReviewSchema.parse(value));
  }
}

export function providerMeta() {
  const cfg = modelConfig();
  return {
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl.replace(/\/chat\/completions$/, "/chat/completions"),
    configured: cfg.provider === "google" ? Boolean(cfg.googleKey) : Boolean(cfg.apiKey),
  };
}

export function createNovelProvider(): NovelModelProvider {
  return new OpenAICompatibleNovelProvider();
}
