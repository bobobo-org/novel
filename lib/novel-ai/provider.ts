import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import crypto from "crypto";
import {
  ChapterPlanSchema,
  ContinuityReviewSchema,
  RiskLevelSchema,
  StrategyTypeSchema,
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

export const QUALITY_GATE_VERSION = "quality-gate-v9";

export const MODEL_RUNTIME_CONFIG = {
  provider: "google",
  modelId: process.env.AI_MODEL && process.env.AI_MODEL !== "gemini-flash-latest"
    ? process.env.AI_MODEL
    : "gemini-3.1-flash-lite",
  configuredAt: "2026-07-14",
  maxInputTokens: 4_000,
  fastRecentTextChars: 1_000,
  reducedRecentTextChars: 500,
  fastTimeoutMs: 8_000,
  retryTimeoutMs: 6_000,
  reducedTimeoutMs: 5_000,
  deepTimeoutMs: 45_000,
  temperature: 0.25,
  maxOutputTokens: 900,
  responseMimeType: "application/json",
  jsonSchemaVersion: "fast-analysis-schema-v1",
};

const DEFAULT_TIMEOUT_MS = 45_000;

export type AnalysisMode = "FAST_ANALYSIS" | "DEEP_ANALYSIS";
export type FallbackLevel = "cloud-full" | "cloud-retry" | "cloud-reduced" | "local-rule" | "failed";

export type TraceStep = {
  stage: string;
  elapsedMs: number;
  detail?: Record<string, unknown>;
};

export type AnalysisTrace = {
  traceId: string;
  mode: AnalysisMode;
  provider: string;
  modelId: string;
  fallbackUsed: FallbackLevel;
  inputChars: number;
  estimatedInputTokens: number;
  estimatedOutputTokens?: number;
  repairUsed: boolean;
  repairReason?: string;
  steps: TraceStep[];
  errors: Array<{
    stage: string;
    errorType: string;
    message: string;
    elapsedMs: number;
    retryable: boolean;
  }>;
};

export interface StableAnalysisResult {
  analysis: StoryAnalysis;
  trace: AnalysisTrace;
}

export interface NovelModelProvider {
  analyzeStory(context: StoryContext): Promise<StoryAnalysis>;
  generateChapterPlan(context: StoryContext, selection: StoryOption, authorSupplement?: string): Promise<ChapterPlan>;
  reviewContinuity(context: StoryContext, candidateText: string): Promise<ContinuityReview>;
}

export class ModelConfigurationError extends Error {
  code = "MODEL_NOT_CONFIGURED";
}

export class ProviderTimeoutError extends Error {
  code = "MODEL_TIMEOUT_AT_PROVIDER";
}

function modelConfig() {
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
  const provider = process.env.AI_PROVIDER || (googleKey ? "google" : "openai-compatible");
  const requestedModel = process.env.AI_MODEL || "";
  const googleModel = requestedModel && requestedModel !== "gemini-flash-latest"
    ? requestedModel
    : MODEL_RUNTIME_CONFIG.modelId;
  return {
    provider,
    apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "",
    googleKey,
    model: provider === "google" ? googleModel : requestedModel || "gpt-4o-mini",
    baseUrl: (process.env.AI_BASE_URL || "https://api.openai.com/v1/chat/completions").replace(/\/$/, ""),
  };
}

function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateTokens(value: unknown): number {
  return estimateTokensFromText(typeof value === "string" ? value : JSON.stringify(value || ""));
}

function traceStep(trace: AnalysisTrace, started: number, stage: string, detail?: Record<string, unknown>) {
  trace.steps.push({ stage, elapsedMs: Date.now() - started, detail });
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("MODEL_RETURNED_NON_JSON");
    return JSON.parse(match[0]);
  }
}

function localJsonRepair(text: string): unknown | undefined {
  try {
    return extractJson(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  timeoutCode = "MODEL_TIMEOUT",
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(externalSignal?.reason || new Error("REQUEST_ABORTED"));
  if (externalSignal) {
    if (externalSignal.aborted) onAbort();
    else externalSignal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new ProviderTimeoutError(timeoutCode)), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted && error instanceof Error && error.name === "AbortError") {
      throw new ProviderTimeoutError(timeoutCode);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

const FastAnalysisSchema = z.object({
  summary: z.string().min(2).max(500),
  currentStage: z.string().min(1).max(80),
  activeConflict: z.string().min(1).max(300),
  characterRisks: z.array(z.string().max(180)).max(5).default([]),
  continuityRisks: z.array(z.string().max(180)).max(5).default([]),
  nextChapterOptions: z.tuple([
    z.object({ label: z.literal("A"), action: z.string().min(8).max(240), risk: z.string().max(80), possibleCost: z.string().max(160), expectedEffect: z.string().max(180) }),
    z.object({ label: z.literal("B"), action: z.string().min(8).max(240), risk: z.string().max(80), possibleCost: z.string().max(160), expectedEffect: z.string().max(180) }),
    z.object({ label: z.literal("C"), action: z.string().min(8).max(240), risk: z.string().max(80), possibleCost: z.string().max(160), expectedEffect: z.string().max(180) }),
  ]),
  confidence: z.number().min(0).max(1),
});

type FastAnalysis = z.infer<typeof FastAnalysisSchema>;

function trimContext(context: StoryContext, recentTextChars: number): StoryContext {
  return {
    ...context,
    recentText: (context.recentText || "").slice(-recentTextChars),
    previousChapterSummary: (context.previousChapterSummary || "").slice(0, 600),
    unresolvedEvents: (context.unresolvedEvents || []).slice(0, 5),
    resolvedEvents: (context.resolvedEvents || []).slice(0, 3),
    revealedSecrets: (context.revealedSecrets || []).slice(0, 3),
    unrevealedSecrets: (context.unrevealedSecrets || []).slice(0, 5),
    importantItems: (context.importantItems || []).slice(0, 5),
    recentChoices: (context.recentChoices || []).slice(0, 5),
    forbiddenChanges: (context.forbiddenChanges || []).slice(0, 5),
    contextSelection: [
      `FAST recentText ${Math.min((context.recentText || "").length, recentTextChars)} chars`,
      "protagonist",
      "mainConflict",
      "top unresolved events",
    ],
  };
}

function buildFastAnalysisPrompt(context: StoryContext): string {
  const payload = {
    task: "FAST_ANALYSIS",
    outputRules: {
      language: "Traditional Chinese",
      jsonOnly: true,
      maxOptions: 3,
      optionLabels: ["A", "B", "C"],
      noMarkdown: true,
      schema: {
        summary: "string <= 500 chars",
        currentStage: "string",
        activeConflict: "string",
        characterRisks: "string[] <= 5",
        continuityRisks: "string[] <= 5",
        nextChapterOptions: [
          { label: "A", action: "concrete action", risk: "low/mid/high", possibleCost: "string", expectedEffect: "string" },
          { label: "B", action: "concrete action", risk: "low/mid/high", possibleCost: "string", expectedEffect: "string" },
          { label: "C", action: "concrete action", risk: "low/mid/high", possibleCost: "string", expectedEffect: "string" },
        ],
        confidence: "number 0-1",
      },
    },
    context: {
      genre: context.genre,
      subgenre: context.subgenre,
      narrativeStyle: context.narrativeStyle,
      protagonist: context.protagonist,
      antagonist: context.antagonist,
      mainConflict: context.mainConflict,
      authorInstruction: context.authorInstruction,
      previousChapterSummary: context.previousChapterSummary,
      recentText: context.recentText,
      unresolvedEvents: context.unresolvedEvents,
      unrevealedSecrets: context.unrevealedSecrets,
      importantItems: context.importantItems,
      forbiddenChanges: context.forbiddenChanges,
    },
  };
  return JSON.stringify(payload);
}

function normalizeRisk(text: string): string {
  if (/高|high/i.test(text)) return RiskLevelSchema.options[2];
  if (/低|low/i.test(text)) return RiskLevelSchema.options[0];
  return RiskLevelSchema.options[1];
}

function adaptFastAnalysis(context: StoryContext, fast: FastAnalysis, fallbackUsed: FallbackLevel): StoryAnalysis {
  const protagonist = context.protagonist.name || "主角";
  const strategyTypes = StrategyTypeSchema.options;
  const warnings = [...fast.continuityRisks, ...(fallbackUsed === "local-rule" ? ["雲端模型未完成，已使用本機規則降級分析。"] : [])].slice(0, 12);
  return {
    situation: fast.summary,
    currentStoryStage: fast.currentStage,
    characterConsistency: {
      status: fast.characterRisks.length ? ("需確認" as never) : ("穩定" as never),
      explanation: fast.characterRisks.length ? fast.characterRisks.join("；") : `${protagonist}目前行動與既有設定未見明顯衝突。`,
    },
    recommendedStrategy: fast.nextChapterOptions[0]?.action || `${protagonist}先釐清眼前衝突。`,
    recommendationReason: fast.activeConflict,
    continuityWarnings: warnings,
    missingInformation: [],
    forbiddenActions: context.forbiddenChanges || [],
    options: fast.nextChapterOptions.map((option, index) => ({
      label: option.label,
      action: option.action,
      strategyType: strategyTypes[index] || strategyTypes[0],
      reason: option.expectedEffect || fast.activeConflict,
      risk: normalizeRisk(option.risk),
      possibleCost: option.possibleCost || "需要作者確認代價。",
      expectedEffect: option.expectedEffect || "推進本章局勢。",
      characterFitScore: Math.max(1, Math.min(10, Math.round(fast.confidence * 10))),
      plotProgressScore: index === 0 ? 8 : index === 1 ? 6 : 7,
      noveltyScore: index === 2 ? 8 : 6,
    })) as StoryAnalysis["options"],
    analysisEvidence: [
      {
        sourceType: "主角設定" as never,
        sourceId: "protagonist",
        sourceLabel: protagonist,
        reason: context.protagonist.archetype || context.protagonist.actionStyle || "目前主角設定",
      },
      {
        sourceType: "最近正文" as never,
        sourceId: "recentText",
        sourceLabel: "最近正文",
        reason: (context.recentText || context.previousChapterSummary || fast.summary).slice(0, 240),
      },
    ],
    analysisScores: {
      plotProgress: 7,
      characterConsistency: fast.characterRisks.length ? 6 : 8,
      novelty: 6,
      readerHook: 7,
      emotionalPayoff: 6,
      riskClarity: fast.continuityRisks.length ? 7 : 6,
      evidenceUse: 7,
    },
    qualityGate: {
      passed: fallbackUsed !== "failed",
      warnings,
    },
  };
}

function localRuleAnalysis(context: StoryContext, fallbackReason: string): StoryAnalysis {
  const protagonist = context.protagonist.name || "主角";
  const archetype = context.protagonist.archetype || "目前原型";
  const conflict = context.mainConflict || context.unresolvedEvents?.[0] || "目前主要衝突";
  const fast: FastAnalysis = {
    summary: `${protagonist}正面對「${conflict}」。雲端模型未能在時限內完成，因此先提供可用的本機規則分析。`,
    currentStage: context.chapterGoal ? "本章規劃期" : "衝突推進期",
    activeConflict: conflict,
    characterRisks: context.forbiddenChanges?.length ? [`需避免：${context.forbiddenChanges[0]}`] : [],
    continuityRisks: [fallbackReason],
    nextChapterOptions: [
      {
        label: "A",
        action: `${protagonist}依照${archetype}的行動習慣，直接處理「${conflict}」並逼出對手反應。`,
        risk: "高",
        possibleCost: "可能暴露意圖或失去安全距離。",
        expectedEffect: "主線推進最快，能快速製造章節張力。",
      },
      {
        label: "B",
        action: `${protagonist}暫時壓下衝動，先蒐集與「${conflict}」有關的證據與人物反應。`,
        risk: "中",
        possibleCost: "推進較慢，但能降低誤判。",
        expectedEffect: "保留懸疑感，適合承接下一章。",
      },
      {
        label: "C",
        action: `${protagonist}故意放出一部分訊息，引誘對手提前行動，但可能牽連盟友。`,
        risk: "高",
        possibleCost: "關係受損，秘密可能提前曝光。",
        expectedEffect: "製造轉折與章尾鉤子。",
      },
    ],
    confidence: 0.58,
  };
  return adaptFastAnalysis(context, fast, "local-rule");
}

async function callFastJsonModel(
  userPrompt: string,
  timeoutMs: number,
  maxOutputTokens: number,
  trace: AnalysisTrace,
  started: number,
  externalSignal?: AbortSignal,
): Promise<{ raw: unknown; textLength: number }> {
  const cfg = modelConfig();
  return withTimeout(async (signal) => {
    if (cfg.provider === "google") {
      if (!cfg.googleKey) throw new ModelConfigurationError("GOOGLE_GENERATIVE_AI_API_KEY is not configured.");
      const { text } = await generateText({
        model: google(cfg.model),
        system: "你是小說分析器。只輸出符合要求的 JSON，不要 Markdown，不要額外解釋。",
        prompt: userPrompt,
        abortSignal: signal,
        temperature: MODEL_RUNTIME_CONFIG.temperature,
        maxOutputTokens,
      });
      traceStep(trace, started, "provider_complete", { outputChars: text.length });
      const local = localJsonRepair(text);
      if (local == null) throw new Error("MODEL_RETURNED_INVALID_JSON");
      return { raw: local, textLength: text.length };
    }

    if (!cfg.apiKey) throw new ModelConfigurationError("AI_API_KEY or OPENAI_API_KEY is not configured.");
    const response = await fetch(cfg.baseUrl, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: MODEL_RUNTIME_CONFIG.temperature,
        max_tokens: maxOutputTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你是小說分析器。只輸出 JSON。" },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("MODEL_RETURNED_EMPTY_CONTENT");
    const local = localJsonRepair(content);
    if (local == null) throw new Error("MODEL_RETURNED_INVALID_JSON");
    return { raw: local, textLength: content.length };
  }, timeoutMs, "MODEL_TIMEOUT_AT_PROVIDER", externalSignal);
}

async function runFastCloudAttempt(
  context: StoryContext,
  trace: AnalysisTrace,
  started: number,
  attempt: { level: FallbackLevel; recentTextChars: number; timeoutMs: number; maxOutputTokens: number },
  externalSignal?: AbortSignal,
): Promise<StoryAnalysis> {
  const trimmed = trimContext(context, attempt.recentTextChars);
  const promptStart = Date.now();
  const prompt = buildFastAnalysisPrompt(trimmed);
  traceStep(trace, started, "buildAnalysisPrompt", {
    attempt: attempt.level,
    elapsedMs: Date.now() - promptStart,
    promptChars: prompt.length,
    estimatedInputTokens: estimateTokensFromText(prompt),
    recentTextChars: trimmed.recentText.length,
  });
  trace.inputChars = prompt.length;
  trace.estimatedInputTokens = estimateTokensFromText(prompt);
  const { raw, textLength } = await callFastJsonModel(prompt, attempt.timeoutMs, attempt.maxOutputTokens, trace, started, externalSignal);
  const parseStart = Date.now();
  const fast = FastAnalysisSchema.parse(raw);
  traceStep(trace, started, "schema_validate", { attempt: attempt.level, elapsedMs: Date.now() - parseStart });
  trace.estimatedOutputTokens = estimateTokens({ fast, textLength });
  return adaptFastAnalysis(trimmed, fast, attempt.level);
}

export async function analyzeStoryWithFallback(
  context: StoryContext,
  options: { mode?: AnalysisMode; traceId?: string; signal?: AbortSignal } = {},
): Promise<StableAnalysisResult> {
  const cfg = modelConfig();
  const started = Date.now();
  const trace: AnalysisTrace = {
    traceId: options.traceId || crypto.randomUUID(),
    mode: options.mode || "FAST_ANALYSIS",
    provider: cfg.provider,
    modelId: cfg.model,
    fallbackUsed: "failed",
    inputChars: 0,
    estimatedInputTokens: 0,
    repairUsed: false,
    steps: [],
    errors: [],
  };

  if (trace.mode === "DEEP_ANALYSIS") {
    const prompt = buildAnalysisPrompt(context);
    trace.inputChars = prompt.length;
    trace.estimatedInputTokens = estimateTokensFromText(prompt);
    const raw = await callFastJsonModel(prompt, MODEL_RUNTIME_CONFIG.deepTimeoutMs, 1_800, trace, started, options.signal);
    const parseStart = Date.now();
    const analysis = applyQualityGate(context, enforceOptionLabels(StoryAnalysisSchema.parse(raw.raw)));
    traceStep(trace, started, "schema_validate", { elapsedMs: Date.now() - parseStart });
    trace.fallbackUsed = "cloud-full";
    traceStep(trace, started, "quality_gate", { fallbackUsed: trace.fallbackUsed });
    return { analysis, trace };
  }

  const attempts = [
    { level: "cloud-full" as FallbackLevel, recentTextChars: MODEL_RUNTIME_CONFIG.fastRecentTextChars, timeoutMs: MODEL_RUNTIME_CONFIG.fastTimeoutMs, maxOutputTokens: MODEL_RUNTIME_CONFIG.maxOutputTokens },
    { level: "cloud-retry" as FallbackLevel, recentTextChars: MODEL_RUNTIME_CONFIG.fastRecentTextChars, timeoutMs: MODEL_RUNTIME_CONFIG.retryTimeoutMs, maxOutputTokens: MODEL_RUNTIME_CONFIG.maxOutputTokens },
    { level: "cloud-reduced" as FallbackLevel, recentTextChars: MODEL_RUNTIME_CONFIG.reducedRecentTextChars, timeoutMs: MODEL_RUNTIME_CONFIG.reducedTimeoutMs, maxOutputTokens: 700 },
  ];

  for (const attempt of attempts) {
    try {
      if (attempt.level === "cloud-retry") await new Promise((resolve) => setTimeout(resolve, 250));
      traceStep(trace, started, "provider_start", { attempt: attempt.level, timeoutMs: attempt.timeoutMs });
      const analysis = await runFastCloudAttempt(context, trace, started, attempt, options.signal);
      trace.fallbackUsed = attempt.level;
      traceStep(trace, started, "quality_gate", { fallbackUsed: trace.fallbackUsed });
      return { analysis, trace };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trace.errors.push({
        stage: attempt.level,
        errorType: error instanceof ModelConfigurationError ? "MODEL_NOT_CONFIGURED" : error instanceof ProviderTimeoutError ? "MODEL_TIMEOUT_AT_PROVIDER" : "MODEL_CALL_FAILED",
        message,
        elapsedMs: Date.now() - started,
        retryable: !(error instanceof ModelConfigurationError),
      });
      if (error instanceof ModelConfigurationError) break;
    }
  }

  trace.fallbackUsed = "local-rule";
  const reason = trace.errors.at(-1)?.message || "雲端模型未在時限內完成。";
  const analysis = localRuleAnalysis(context, reason);
  traceStep(trace, started, "local_rule_fallback", { reason });
  return { analysis, trace };
}

async function callJsonModel(userPrompt: string): Promise<unknown> {
  const trace: AnalysisTrace = {
    traceId: crypto.randomUUID(),
    mode: "DEEP_ANALYSIS",
    provider: modelConfig().provider,
    modelId: modelConfig().model,
    fallbackUsed: "failed",
    inputChars: userPrompt.length,
    estimatedInputTokens: estimateTokensFromText(userPrompt),
    repairUsed: false,
    steps: [],
    errors: [],
  };
  const result = await callFastJsonModel(userPrompt, DEFAULT_TIMEOUT_MS, 1_800, trace, Date.now());
  return result.raw;
}

async function withRepair<T>(prompt: string, parse: (value: unknown) => T): Promise<T> {
  const first = await callJsonModel(prompt);
  try {
    return parse(first);
  } catch (error) {
    const repairPrompt =
      `${prompt}\n\nThe previous JSON failed this schema error: ${error instanceof Error ? error.message : "unknown"}.\n` +
      `Return one valid compact JSON object only. Previous object: ${JSON.stringify(first).slice(0, 1800)}`;
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

function includesAny(text: string, values: string[] | undefined): string | undefined {
  return (values || []).find((value) => value && text.includes(value.slice(0, Math.min(value.length, 24))));
}

function applyQualityGate(context: StoryContext, analysis: StoryAnalysis): StoryAnalysis {
  const warnings = [...(analysis.qualityGate?.warnings || [])];
  const actions = analysis.options.map((x) => x.action.trim());
  const protagonistName = context.protagonist.name || "主角";
  if (new Set(actions).size !== actions.length || optionSimilarity(actions[0], actions[1]) || optionSimilarity(actions[1], actions[2]) || optionSimilarity(actions[0], actions[2])) {
    warnings.push("A/B/C 選項過於相似，需要重寫為不同策略。");
  }
  for (const option of analysis.options) {
    if (option.action.length < 18) warnings.push(`${option.label} 選項行動過短，需要更具體。`);
    if (!option.action.includes(protagonistName) && protagonistName !== "主角") warnings.push(`${option.label} 選項未引用主角姓名。`);
    const forbiddenChange = includesAny(option.action, context.forbiddenChanges);
    if (forbiddenChange) warnings.push(`${option.label} 可能違反 forbiddenChanges：${forbiddenChange}`);
  }

  const evidence = [...(analysis.analysisEvidence || [])];
  if (evidence.length === 0) {
    evidence.push({
      sourceType: "主角設定" as never,
      sourceId: "protagonist",
      sourceLabel: protagonistName,
      reason: context.protagonist.archetype || context.protagonist.actionStyle || "目前主角設定",
    });
  }

  return {
    ...analysis,
    analysisEvidence: evidence.slice(0, 12),
    qualityGate: { passed: warnings.length === 0, warnings: [...new Set(warnings)].slice(0, 20) },
  };
}

export class OpenAICompatibleNovelProvider implements NovelModelProvider {
  async analyzeStory(context: StoryContext): Promise<StoryAnalysis> {
    const stable = await analyzeStoryWithFallback(context, { mode: "FAST_ANALYSIS" });
    return stable.analysis;
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
    modelId: cfg.model,
    modelVersion: cfg.model,
    baseUrl: cfg.baseUrl.replace(/\/chat\/completions$/, "/chat/completions"),
    configured: cfg.provider === "google" ? Boolean(cfg.googleKey) : Boolean(cfg.apiKey),
    settings: MODEL_RUNTIME_CONFIG,
  };
}

export async function pingModel(timeoutMs = 3_500): Promise<{ ok: boolean; elapsedMs: number; error?: string }> {
  const started = Date.now();
  try {
    const cfg = modelConfig();
    if (cfg.provider === "google") {
      if (!cfg.googleKey) throw new ModelConfigurationError("GOOGLE_GENERATIVE_AI_API_KEY is not configured.");
      await withTimeout(
        (signal) =>
          generateText({
            model: google(cfg.model),
            system: "Return compact JSON only.",
            prompt: "{\"ping\":true}",
            abortSignal: signal,
            temperature: 0,
            maxOutputTokens: 24,
          }),
        timeoutMs,
        "MODEL_HEALTH_TIMEOUT",
      );
      return { ok: true, elapsedMs: Date.now() - started };
    }
    if (!cfg.apiKey) throw new ModelConfigurationError("AI_API_KEY or OPENAI_API_KEY is not configured.");
    const response = await withTimeout(
      (signal) =>
        fetch(cfg.baseUrl, {
          method: "POST",
          signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            max_tokens: 8,
            messages: [
              { role: "system", content: "Return JSON only." },
              { role: "user", content: "{\"ping\":true}" },
            ],
          }),
        }),
      timeoutMs,
      "MODEL_HEALTH_TIMEOUT",
    );
    if (!response.ok) throw new Error(`MODEL_HEALTH_HTTP_${response.status}`);
    return { ok: true, elapsedMs: Date.now() - started };
  } catch (error) {
    return { ok: false, elapsedMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

export function createNovelProvider(): NovelModelProvider {
  return new OpenAICompatibleNovelProvider();
}
