import { NextResponse } from "next/server";
import { checkOllamaHealth } from "@/lib/novel-ai/providers/ollama/ollama-health";

export const runtime = "nodejs";

export async function GET() {
  const health = await checkOllamaHealth();
  return NextResponse.json({
    status: health.status,
    models: health.profiles.map((profile) => ({
      modelId: profile.modelId,
      family: profile.family,
      contextWindow: profile.contextWindow,
      supportsJson: profile.supportsJson,
      supportsStreaming: profile.supportsStreaming,
      installed: profile.installed,
    })),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
