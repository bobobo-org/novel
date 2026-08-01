import { NextResponse } from "next/server";
import { listExternalAIProviderStatus } from "@/lib/novel-ai/providers/external/external-provider-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ready",
    credentials: "server-side-only",
    silentFallback: false,
    providers: listExternalAIProviderStatus(),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
