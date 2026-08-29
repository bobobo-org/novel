import { NextResponse } from "next/server";
import {
  EXTERNAL_AI_PROVIDER_IDS,
  isExternalAIProviderId,
} from "@/lib/novel-ai/providers/external/external-provider-contract";
import {
  listExternalAIProviderStatus,
  verifyExternalAIProviderStatus,
} from "@/lib/novel-ai/providers/external/external-provider-runtime";
import {
  assertExternalAIRequestOrigin,
  externalAIClientIdentifier,
  ExternalAIRequestGuardError,
  reserveExternalAIRequest,
} from "@/lib/novel-ai/providers/external/external-request-guard.server";
import { isExternalAIPublicExecutionEnabled } from "@/lib/novel-ai/providers/external/external-execution-policy.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SAFE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request) {
  const executionEnabled = isExternalAIPublicExecutionEnabled();
  const url = new URL(request.url);
  const probe = url.searchParams.get("probe") === "1" || url.searchParams.has("verify");
  const requested = (url.searchParams.get("providers") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(isExternalAIProviderId);
  const providerIds = requested.length > 0 ? requested : [...EXTERNAL_AI_PROVIDER_IDS];
  let probeLease: ReturnType<typeof reserveExternalAIRequest> | null = null;
  if (probe) {
    try {
      // A live verification sends server-held credentials to provider metadata
      // endpoints. Keep the ordinary configuration snapshot public/read-only,
      // but require an intentional same-origin browser action for this path.
      assertExternalAIRequestOrigin(request);
      probeLease = reserveExternalAIRequest(externalAIClientIdentifier(request), 64);
    } catch (error) {
      if (error instanceof ExternalAIRequestGuardError) {
        return NextResponse.json(
          { error: error.message, code: error.code, probePerformed: false },
          { status: error.status, headers: { ...SAFE_RESPONSE_HEADERS, ...error.headers } },
        );
      }
      return NextResponse.json(
        { error: "外接 AI 驗證安全額度目前不可用。", code: "EXTERNAL_AI_PROBE_GUARD_UNAVAILABLE", probePerformed: false },
        { status: 503, headers: SAFE_RESPONSE_HEADERS },
      );
    }
  }

  let providers: ReturnType<typeof listExternalAIProviderStatus>;
  try {
    providers = probe
      ? await verifyExternalAIProviderStatus(providerIds)
      : listExternalAIProviderStatus().filter((provider) => providerIds.includes(provider.id));
  } finally {
    probeLease?.release();
  }
  const verification = !probe
    ? "not-probed"
    : providers.length > 0 && providers.every((provider) => provider.verification === "verified")
      ? "verified"
      : "degraded";

  return NextResponse.json({
    status: "ready",
    routeReady: true,
    executionEnabled,
    operational: executionEnabled && probe && verification === "verified",
    credentials: "server-side-only",
    silentFallback: false,
    probePerformed: probe,
    verification,
    providers,
  }, {
    headers: {
      ...SAFE_RESPONSE_HEADERS,
      ...(probeLease?.headers || {}),
    },
  });
}
