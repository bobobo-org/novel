import crypto from "crypto";
import {
  analyzeStoryWithFallback,
  estimateTokens,
  ModelConfigurationError,
  providerMeta,
  type TraceStep,
} from "@/lib/novel-ai/provider";
import { inputHash, recordAiRun } from "@/lib/novel-ai/store";
import { StoryContextSchema } from "@/lib/novel-ai/schemas";
import { buildStoryAnalysisContext } from "@/lib/novel-ai/memory";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteTrace = {
  traceId: string;
  steps: TraceStep[];
};

function addStep(trace: RouteTrace, started: number, stage: string, detail?: Record<string, unknown>) {
  trace.steps.push({ stage, elapsedMs: Date.now() - started, detail });
}

function errorResponse(input: {
  status: number;
  errorCode: string;
  errorType: string;
  stage: string;
  provider?: string;
  modelId?: string;
  elapsedMs: number;
  retryable: boolean;
  fallbackUsed?: string;
  userMessage: string;
  technicalMessage: string;
  traceId: string;
  trace?: RouteTrace;
}) {
  return Response.json(input, { status: input.status });
}

export async function POST(req: Request) {
  const started = Date.now();
  const trace: RouteTrace = { traceId: crypto.randomUUID(), steps: [] };
  const meta = providerMeta();

  let body: unknown;
  try {
    const parseStart = Date.now();
    body = await req.json();
    addStep(trace, started, "request_body_parse", { elapsedMs: Date.now() - parseStart });
  } catch (error) {
    return errorResponse({
      status: 400,
      errorCode: "BAD_JSON",
      errorType: "VALIDATION_ERROR",
      stage: "request_body_parse",
      provider: meta.provider,
      modelId: meta.modelId,
      elapsedMs: Date.now() - started,
      retryable: false,
      fallbackUsed: "none",
      userMessage: "請求內容不是有效 JSON。",
      technicalMessage: error instanceof Error ? error.message : String(error),
      traceId: trace.traceId,
      trace,
    });
  }

  let parsed;
  try {
    const schemaStart = Date.now();
    parsed = StoryContextSchema.parse(body);
    addStep(trace, started, "StoryContextSchema_validate", { elapsedMs: Date.now() - schemaStart });
  } catch (error) {
    return errorResponse({
      status: 400,
      errorCode: "VALIDATION_ERROR",
      errorType: "VALIDATION_ERROR",
      stage: "StoryContextSchema_validate",
      provider: meta.provider,
      modelId: meta.modelId,
      elapsedMs: Date.now() - started,
      retryable: false,
      fallbackUsed: "none",
      userMessage: "故事上下文格式不正確，請確認 projectId 與 protagonist 等必要欄位。",
      technicalMessage: error instanceof Error ? error.message : String(error),
      traceId: trace.traceId,
      trace,
    });
  }

  try {
    const contextStart = Date.now();
    const builtContext = buildStoryAnalysisContext(parsed);
    addStep(trace, started, "buildTaskContext", {
      elapsedMs: Date.now() - contextStart,
      recentTextChars: builtContext.recentText.length,
      estimatedContextTokens: estimateTokens(builtContext),
      contextSelection: builtContext.contextSelection || [],
    });

    const analysisStart = Date.now();
    const stable = await analyzeStoryWithFallback(builtContext, {
      mode: "FAST_ANALYSIS",
      traceId: trace.traceId,
      signal: req.signal,
    });
    addStep(trace, started, "analyzeStoryWithFallback", {
      elapsedMs: Date.now() - analysisStart,
      fallbackUsed: stable.trace.fallbackUsed,
      providerErrors: stable.trace.errors,
    });

    const recordStart = Date.now();
    const aiRun = recordAiRun({
      projectId: builtContext.projectId,
      chapterId: builtContext.chapterId,
      taskType: "story_analysis",
      provider: meta.provider,
      model: meta.modelId,
      inputHash: inputHash({ builtContext, mode: "FAST_ANALYSIS" }),
      inputContext: builtContext,
      modelOutput: {
        analysis: stable.analysis,
        trace: stable.trace,
        fallbackUsed: stable.trace.fallbackUsed,
      },
      latencyMs: Date.now() - started,
      inputTokens: stable.trace.estimatedInputTokens || estimateTokens(builtContext),
      outputTokens: stable.trace.estimatedOutputTokens || estimateTokens(stable.analysis),
      status: "completed",
    });
    addStep(trace, started, "recordAiRun", { elapsedMs: Date.now() - recordStart, aiRunId: aiRun.id });

    return Response.json({
      analysis: stable.analysis,
      aiRunId: aiRun.id,
      contextSelection: builtContext.contextSelection || [],
      mode: stable.trace.mode,
      fallbackUsed: stable.trace.fallbackUsed,
      provider: stable.trace.provider,
      modelId: stable.trace.modelId,
      traceId: trace.traceId,
      trace: {
        ...stable.trace,
        routeSteps: trace.steps,
        totalElapsedMs: Date.now() - started,
      },
    });
  } catch (error) {
    const status = error instanceof ModelConfigurationError ? 503 : 502;
    recordAiRun({
      projectId: parsed.projectId,
      chapterId: parsed.chapterId,
      taskType: "story_analysis",
      provider: meta.provider,
      model: meta.modelId,
      inputHash: inputHash({ parsed, mode: "FAST_ANALYSIS" }),
      inputContext: parsed,
      latencyMs: Date.now() - started,
      inputTokens: estimateTokens(parsed),
      status: "failed",
      errorCode: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return errorResponse({
      status,
      errorCode: error instanceof ModelConfigurationError ? "MODEL_NOT_CONFIGURED" : "ANALYZE_UNHANDLED_ERROR",
      errorType: error instanceof ModelConfigurationError ? "CONFIGURATION_ERROR" : "MODEL_ERROR",
      stage: "analyzeStoryWithFallback",
      provider: meta.provider,
      modelId: meta.modelId,
      elapsedMs: Date.now() - started,
      retryable: !(error instanceof ModelConfigurationError),
      fallbackUsed: "failed",
      userMessage: "AI分析暫時無法完成，原有作品資料沒有被修改。",
      technicalMessage: error instanceof Error ? error.message : String(error),
      traceId: trace.traceId,
      trace,
    });
  }
}
