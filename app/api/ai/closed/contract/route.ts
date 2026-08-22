import { NextResponse } from "next/server";
import {
  UNIFIED_CLOSED_AI_COMPUTE_SOURCES,
  UNIFIED_CLOSED_AI_COORDINATOR_VERSION,
  UNIFIED_CLOSED_AI_GOVERNANCE,
  UNIFIED_CLOSED_AI_ROLES,
} from "@/lib/novel-ai/sovereign-learning/unified-closed-ai-coordinator";

export const dynamic = "force-dynamic";

const CLOSED_AI_CONTRACT = Object.freeze({
  product: {
    id: "unified_closed_ai",
    label: "閉端 AI 自動協調器",
    version: UNIFIED_CLOSED_AI_COORDINATOR_VERSION,
    userFacingInstanceCount: 1,
    userBackendSelectionRequired: false,
    coordinationMode: "automatic",
    runtimeStatus: "client_probe_required",
  },
  automaticCoordinator: {
    functionalRoles: UNIFIED_CLOSED_AI_ROLES,
    taskRouting: {
      mode: "automatic",
      userSelectionRequired: false,
      signals: [
        "task-capability",
        "privacy-boundary",
        "runtime-readiness",
        "context-budget",
        "latency",
        "quality",
      ],
    },
    execution: {
      integrated: true,
      responsibilities: [
        "analysis-and-classification",
        "retrieval-and-context",
        "story-generation",
        "causal-teacher",
      ],
    },
    governance: {
      integrated: true,
      sharedAcrossRuntimeResources: true,
      responsibilities: [
        "six-layer-cache",
        "controlled-learning",
        "approval-gate",
        "evidence-ledger",
        "canon-transaction",
      ],
      cacheIsMemory: false,
      candidateOnlyBeforeApproval: true,
      canonicalMutationBeforeApproval: 0,
    },
    computeSources: UNIFIED_CLOSED_AI_COMPUTE_SOURCES,
    governancePolicies: UNIFIED_CLOSED_AI_GOVERNANCE,
    runtimeResourceIds: UNIFIED_CLOSED_AI_COMPUTE_SOURCES.map((source) => source.id),
    externalProvidersOptional: true,
    noSilentExternalFallback: true,
  },
  runtimeResources: {
    presentation: "internal-capacity-not-separate-user-facing-ai",
    selection: "automatic-only",
    ids: UNIFIED_CLOSED_AI_COMPUTE_SOURCES.map((source) => source.id),
  },
  // Compatibility fields remain available to existing clients. They describe
  // internal capacity owned by the single automatic coordinator, not three
  // separate products the user must choose between.
  browserAI: {
    scope: "client",
    taskModel: {
      label: "瀏覽器本機分析器",
      generative: false,
      runtimeStatus: "client_probe_required",
    },
    nativeSummarizer: {
      label: "瀏覽器摘要模型",
      generative: false,
      runtimeStatus: "client_probe_required",
    },
    nativeLanguageModel: {
      label: "瀏覽器裝置內生成模型",
      generative: true,
      maximumComplexity: "standard",
      runtimeStatus: "client_probe_required",
    },
  },
  localOllama: {
    scope: "client-loopback",
    path: "Browser -> Local Bridge 127.0.0.1:3217 -> Ollama 127.0.0.1:11434",
    runtimeStatus: "client_probe_required",
  },
  privateHub: {
    scope: "client-loopback-private-node",
    runtimeStatus: "client_probe_required",
  },
  closedAgentOS: {
    candidateOnlyBeforeApproval: true,
    canonicalMutationBeforeApproval: 0,
    runtimeStatus: "client_runtime",
  },
  legacyBackendFieldsCompatibilityOnly: true,
  noSilentExternalFallback: true,
});

export async function GET() {
  return NextResponse.json(CLOSED_AI_CONTRACT, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Novel-Runtime-Surface": "closed-ai-contract",
    },
  });
}
