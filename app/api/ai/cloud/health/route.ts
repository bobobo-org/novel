import { NextResponse } from "next/server";
import { providerMeta } from "@/lib/novel-ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const metadata = providerMeta();

  return NextResponse.json({
    configured: metadata.configured,
    provider: metadata.provider,
    model: metadata.model,
    pingStatus: metadata.configured
      ? "configured_unverified"
      : "not_configured",
    pingLatencyMs: null,
    liveProbePerformed: false,
    verificationRoute: "/api/ai/external/providers?probe=1",
    verificationPolicy: "explicit_same_origin_metadata_only",
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
