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

export interface NovelModelProvider {
  analyzeStory(context: StoryContext): Promise<StoryAnalysis>;
  generateChapterPlan(context: StoryContext, selection: StoryOption, authorSupplement?: string): Promise<ChapterPlan>;
  reviewContinuity(context: StoryContext, candidateText: string): Promise<ContinuityReview>;
}

export class ModelConfigurationError extends Error {
  code = "MODEL_NOT_CONFIGURED";
}

function modelConfig() {
  return {
    apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "",
    model: process.env.AI_MODEL || "gpt-4o-mini",
    baseUrl: (process.env.AI_BASE_URL || "https://api.openai.com/v1/chat/completions").replace(/\/$/, ""),
  };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("模型沒有回傳 JSON。");
    return JSON.parse(match[0]);
  }
}

async function callJsonModel(userPrompt: string, signal?: AbortSignal): Promise<unknown> {
  const cfg = modelConfig();
  if (!cfg.apiKey) {
    throw new ModelConfigurationError("尚未設定 AI_API_KEY，雲端專屬小說 AI 無法呼叫模型。");
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
    const body = await response.text();
    throw new Error(`模型呼叫失敗：${response.status} ${body.slice(0, 240)}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("模型回應格式不含 content。");
  return extractJson(content);
}

async function withRepair<T>(prompt: string, parse: (value: unknown) => T): Promise<T> {
  const first = await callJsonModel(prompt);
  try {
    return parse(first);
  } catch (error) {
    const repairPrompt =
      `${prompt}\n\n上一輪 JSON 未通過驗證，錯誤如下：${error instanceof Error ? error.message : "未知錯誤"}\n` +
      `請只回傳符合 schema 的修正 JSON，不要加入 Markdown。上一輪內容：${JSON.stringify(first).slice(0, 5000)}`;
    return parse(await callJsonModel(repairPrompt));
  }
}

export class OpenAICompatibleNovelProvider implements NovelModelProvider {
  async analyzeStory(context: StoryContext): Promise<StoryAnalysis> {
    return withRepair(buildAnalysisPrompt(context), (value) =>
      enforceOptionLabels(StoryAnalysisSchema.parse(value)),
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
    provider: "openai-compatible",
    model: cfg.model,
    baseUrl: cfg.baseUrl.replace(/\/chat\/completions$/, "/chat/completions"),
    configured: Boolean(cfg.apiKey),
  };
}

export function createNovelProvider(): NovelModelProvider {
  return new OpenAICompatibleNovelProvider();
}
