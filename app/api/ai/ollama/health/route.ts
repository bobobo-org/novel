import { NextResponse } from "next/server";
import { checkOllamaHealth } from "@/lib/novel-ai/providers/ollama/ollama-health";

export const runtime = "nodejs";

export async function GET() {
  const health = await checkOllamaHealth();
  return NextResponse.json({
    ollamaBridgeStatus: "contract_ready",
    ollamaStatus: health.status === "configured" ? "configured" : "local_runtime_required",
    ollamaModelStatus: health.status,
    ollamaInstalledModelCount: health.modelCount,
    ollamaSelectedModel: health.selectedModel ?? null,
    ollamaLastPingMs: health.latencyMs,
    ollamaLastErrorCode: health.lastErrorCode,
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
