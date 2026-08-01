import { NextResponse } from "next/server";
import { cloudSyncServerHealth } from "@/lib/novel-ai/cloud-sync/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await cloudSyncServerHealth();
  return NextResponse.json(health, {
    status: health.status === "ready" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Novel-Runtime-Surface": "cloud-sync-health",
    },
  });
}
