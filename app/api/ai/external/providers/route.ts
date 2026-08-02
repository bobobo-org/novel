import { NextResponse } from "next/server";
import {
  EXTERNAL_AI_PROVIDER_IDS,
  isExternalAIProviderId,
} from "@/lib/novel-ai/providers/external/external-provider-contract";
import {
  listExternalAIProviderStatus,
  verifyExternalAIProviderStatus,
} from "@/lib/novel-ai/providers/external/external-provider-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const probe = url.searchParams.get("probe") === "1" || url.searchParams.has("verify");
  const requested = (url.searchParams.get("providers") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(isExternalAIProviderId);
  const providerIds = requested.length > 0 ? requested : [...EXTERNAL_AI_PROVIDER_IDS];
  const providers = probe
    ? await verifyExternalAIProviderStatus(providerIds)
    : listExternalAIProviderStatus().filter((provider) => providerIds.includes(provider.id));
  const verification = !probe
    ? "not-probed"
    : providers.length > 0 && providers.every((provider) => provider.verification === "verified")
      ? "verified"
      : "degraded";

  return NextResponse.json({
    status: "ready",
    credentials: "server-side-only",
    silentFallback: false,
    probePerformed: probe,
    verification,
    providers,
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
