import { listExternalAIProviderStatus } from "@/lib/novel-ai/providers/external/external-provider-runtime";
import {
  UNIFIED_CLOSED_AI_COMPUTE_SOURCES,
  UNIFIED_CLOSED_AI_COORDINATOR_VERSION,
  UNIFIED_CLOSED_AI_GOVERNANCE,
  UNIFIED_CLOSED_AI_ROLES,
} from "@/lib/novel-ai/sovereign-learning/unified-closed-ai-coordinator";

export const dynamic = "force-dynamic";

export async function GET() {
  const external = listExternalAIProviderStatus();
  return Response.json({
    status: "ready_runtime_dependent",
    privacyDefault: "strict-local",
    product: {
      id: "unified_closed_ai",
      label: "閉端 AI 自動協調器",
      version: UNIFIED_CLOSED_AI_COORDINATOR_VERSION,
      userFacingInstanceCount: 1,
      coordinationMode: "automatic",
      userBackendSelectionRequired: false,
    },
    automaticCoordinator: {
      functionalRoles: UNIFIED_CLOSED_AI_ROLES,
      runtimeStatus: "client_probe_required",
      executionAndGovernanceIntegrated: true,
      executionResponsibilities: [
        "analysis-and-classification",
        "retrieval-and-context",
        "story-generation",
        "causal-teacher",
      ],
      governanceResponsibilities: [
        "six-layer-cache",
        "controlled-learning",
        "approval-gate",
        "evidence-ledger",
        "canon-transaction",
      ],
      computeSources: UNIFIED_CLOSED_AI_COMPUTE_SOURCES,
      governancePolicies: UNIFIED_CLOSED_AI_GOVERNANCE,
      runtimeResourceIds: UNIFIED_CLOSED_AI_COMPUTE_SOURCES.map((source) => source.id),
      externalProvidersOptional: true,
      noSilentExternalFallback: true,
    },
    runtimeResources: {
      presentation: "internal-capacity-not-separate-user-facing-ai",
      selection: "automatic-only",
    },
    // Kept for older clients; these are coordinator resources, not products.
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
    legacyProviderFieldsCompatibilityOnly: true,
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
