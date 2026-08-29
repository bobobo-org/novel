import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

/**
 * The original route called Gemini directly and bypassed the current external-AI
 * execution mode, same-origin guard, request budgets and one-time consent. Keep
 * the path as a fail-closed tombstone so old clients cannot silently send story
 * text outside the device. New clients must use /api/ai/external/generate.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "舊版外接 AI 入口已停用。請由 AI 設定選擇外接模式、供應商，並在每次送出前明確同意。",
      code: "LEGACY_EXTERNAL_AI_ROUTE_DISABLED",
      replacement: "/api/ai/external/generate",
      retryable: false,
    },
    { status: 410, headers: SAFE_HEADERS },
  );
}
