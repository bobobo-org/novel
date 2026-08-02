import { listExternalAIProviderStatus } from "@/lib/novel-ai/providers/external/external-provider-runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const external = listExternalAIProviderStatus();
  return Response.json({
    status: "ready_runtime_dependent",
    privacyDefault: "strict-local",
    providers: {
      browserAI: "runtime_ready_device_and_model_dependent",
      localOllama: "self_hosted_client_probe_required",
      privateAIHub: "self_hosted_client_probe_required",
      packagedTaskModel: "ready_non_generative",
      externalAI: external.some((provider) => provider.configured)
        ? "configured_live_probe_required"
        : "disabled_by_default",
    },
    externalProviders: external,
    noSilentExternalFallback: true,
    candidateFirst: true,
    cacheMemoryLearningCanonSeparated: true,
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
