import { NextResponse } from "next/server";
import { pingModel, providerMeta } from "@/lib/novel-ai/provider";
import { aiRunStats, trainingStats } from "@/lib/novel-ai/store";

export const runtime = "nodejs";

export async function GET() {
  const started = Date.now();
  const meta = providerMeta();
  const runs = aiRunStats();
  const stats = trainingStats();
  const configured = meta.configured;
  const ping = configured ? await pingModel() : { ok: false, elapsedMs: 0, error: "MODEL_NOT_CONFIGURED" };

  return NextResponse.json({
    status: configured ? "ok" : "needs_configuration",
    apiStatus: "online",
    modelStatus: configured ? (ping.ok ? "available" : "configured_but_unavailable") : "not_configured",
    analysisStatus: ping.ok ? "model_ping_success" : runs.lastAnalysisSuccessAt ? "recent_success" : runs.lastError ? "recent_error" : "not_tested",
    provider: meta.provider,
    model: meta.model,
    modelId: meta.modelId,
    modelVersion: meta.modelVersion,
    analyzerVersion: stats.versions.storyAnalyzerVersion,
    benchmarkVersion: stats.versions.candidateAnalyzerVersion,
    database: process.env.DATABASE_URL ? "configured" : "memory",
    key: "server-only",
    fallbackEnabled: true,
    fallbackModel: "local-rule",
    responseTimeMs: Date.now() - started,
    modelPingMs: ping.elapsedMs,
    averageResponseTimeMs: runs.averageLatencyMs,
    lastSuccessAt: runs.lastSuccessAt,
    lastAnalysisSuccessAt: runs.lastAnalysisSuccessAt,
    lastError: ping.ok ? runs.lastError : { createdAt: new Date().toISOString(), taskType: "health", errorCode: ping.error || "MODEL_HEALTH_FAILED" },
    last24hSuccessRate: runs.last24hSuccessRate,
    last24hFailureRate: runs.last24hFailureRate,
    dailyTokenUsage: runs.dailyTokens,
    monthlyEstimatedCost: runs.monthlyEstimatedCost,
    trainingExamples: stats.trainingExamples,
    feedback: stats.feedback,
    settings: meta.settings,
  });
}
