import { NextResponse } from "next/server";
import { pingModel, providerMeta } from "@/lib/novel-ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const metadata = providerMeta();
  const ping = metadata.configured
    ? await pingModel()
    : { ok: false, elapsedMs: 0, error: "MODEL_NOT_CONFIGURED" };

  return NextResponse.json({
    configured: metadata.configured,
    provider: metadata.provider,
    model: metadata.model,
    pingStatus: metadata.configured
      ? ping.ok
        ? "reachable"
        : "configured_but_unavailable"
      : "not_configured",
    pingLatencyMs: ping.elapsedMs,
    dataLeavesDevice: true,
    requiresExplicitConsent: true,
    closedModeEligible: false,
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Novel-Runtime-Surface": "cloud-ai",
    },
  });
}
