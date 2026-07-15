import { NextResponse } from "next/server";
import { defaultProviderCapabilities } from "@/lib/novel-ai/providers/default-providers";
import { decideAiProvider } from "@/lib/novel-ai/router/ai-router";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const decision = decideAiProvider({
      taskType: body.taskType || "simple_summary",
      storageMode: body.storageMode || "SUPABASE_CLOUD",
      requestedPrivacyMode: body.privacyMode,
      allowExternalProvider: body.allowExternalProvider === true,
      fullOfflineRequired: body.fullOfflineRequired === true,
      internetAvailable: body.internetAvailable !== false,
      providerPreference: body.providerPreference,
      availableProviders: await defaultProviderCapabilities(),
      contextCharacters: body.contextCharacters,
    });
    return NextResponse.json(decision, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const status = typeof error === "object" && error && "code" in error ? 409 : 500;
    return NextResponse.json({
      errorCode: typeof error === "object" && error && "code" in error ? String(error.code) : "AI_ROUTER_ERROR",
      errorType: error instanceof Error ? error.name : "UnknownError",
      userMessage: error instanceof Error ? error.message : "AI router failed",
      retryable: false,
    }, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
