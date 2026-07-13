import { NextResponse } from "next/server";
import { providerMeta } from "@/lib/novel-ai/provider";
import { aiRunStats, trainingStats } from "@/lib/novel-ai/store";

export const runtime = "nodejs";

export async function GET() {
  const started = Date.now();
  const meta = providerMeta();
  const runs = aiRunStats();
  const stats = trainingStats();
  const configured = meta.configured;

  return NextResponse.json({
    status: configured ? "ok" : "needs_configuration",
    apiStatus: "online",
    modelStatus: configured ? "configured" : "not_configured",
    analysisStatus: runs.lastAnalysisSuccessAt ? "recent_success" : runs.lastError ? "recent_error" : "not_tested",
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
    averageResponseTimeMs: runs.averageLatencyMs,
    lastSuccessAt: runs.lastSuccessAt,
    lastAnalysisSuccessAt: runs.lastAnalysisSuccessAt,
    lastError: runs.lastError,
    last24hSuccessRate: runs.last24hSuccessRate,
    last24hFailureRate: runs.last24hFailureRate,
    dailyTokenUsage: runs.dailyTokens,
    monthlyEstimatedCost: runs.monthlyEstimatedCost,
    trainingExamples: stats.trainingExamples,
    feedback: stats.feedback,
    settings: meta.settings,
  });
}
