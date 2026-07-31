import { BROWSER_AI_LIGHT_TASKS, taskComplexity } from "./backend-manifest";
import { learningPreferredBackend } from "../controlled-learning-os";
import type {
  ClosedAIBackendId,
  ClosedAIBackendSnapshot,
  ClosedAgentTaskRequest,
  ClosedAITaskComplexity,
} from "./types";

const complexityRank: Record<ClosedAITaskComplexity, number> = {
  light: 1,
  standard: 2,
  heavy: 3,
};

function supports(
  backend: ClosedAIBackendSnapshot,
  request: Pick<ClosedAgentTaskRequest, "taskType" | "namespace">,
  complexity: ClosedAITaskComplexity,
) {
  if (backend.status !== "ready") return false;
  if (complexityRank[backend.maximumComplexity] < complexityRank[complexity]) return false;
  if (backend.supportedTaskTypes !== "all" && !backend.supportedTaskTypes.includes(request.taskType)) return false;
  if (request.namespace.privacyLevel === "device_only" && backend.dataBoundary !== "device") return false;
  if (
    request.namespace.privacyLevel === "private_infrastructure_only"
    && backend.id !== "private-ai-hub"
  ) return false;
  return true;
}

function compatibleBackendIds(
  snapshots: ClosedAIBackendSnapshot[],
  request: Pick<ClosedAgentTaskRequest, "taskType" | "namespace">,
  complexity: ClosedAITaskComplexity,
) {
  return snapshots
    .filter((snapshot) => supports(snapshot, request, complexity))
    .map((snapshot) => snapshot.id);
}

export type ClosedAIRoutePolicy = {
  preferredBackend?: ClosedAIBackendId;
};

export type ClosedAIRouteResolution =
  | {
    executionStatus: "routable";
    backend: ClosedAIBackendSnapshot;
    complexity: ClosedAITaskComplexity;
    automatic: boolean;
    reasonCode: string;
    requiredCapability:
      | "light_analysis"
      | "standard_generation"
      | "heavy_private_generation";
    recommendedNextAction: "execute";
    fallbackAttempted: false;
  }
  | {
    executionStatus: "not_executed";
    backend: null;
    complexity: ClosedAITaskComplexity;
    automatic: boolean;
    reasonCode: string;
    requiredCapability:
      | "light_analysis"
      | "standard_generation"
      | "heavy_private_generation";
    recommendedNextAction:
      | "allow_local_network"
      | "start_local_ai_service"
      | "pair_local_ai"
      | "verify_model"
      | "configure_local_ai"
      | "pair_private_hub";
    compatibleBackendIds: ClosedAIBackendId[];
    fallbackAttempted: false;
  };

function routeOrder(complexity: ClosedAITaskComplexity) {
  if (complexity === "heavy") {
    return ["private-ai-hub"] as const;
  }
  if (complexity === "standard") {
    return ["local-ollama", "browser-ai"] as const;
  }
  return ["browser-ai", "local-ollama"] as const;
}

function requiredCapability(complexity: ClosedAITaskComplexity) {
  if (complexity === "heavy") return "heavy_private_generation" as const;
  if (complexity === "standard") return "standard_generation" as const;
  return "light_analysis" as const;
}

function nextAction(
  snapshots: ClosedAIBackendSnapshot[],
  complexity: ClosedAITaskComplexity,
) {
  if (complexity === "heavy") return "pair_private_hub" as const;
  const local = snapshots.find((snapshot) => snapshot.id === "local-ollama");
  if (local?.detailCode === "LOCAL_NETWORK_PERMISSION_DENIED") {
    return "allow_local_network" as const;
  }
  if (
    local?.detailCode?.includes("model_inference_not_verified")
    || local?.status === "degraded"
  ) {
    return "verify_model" as const;
  }
  if (
    local?.detailCode?.includes("pair")
    || local?.status === "runtime_required"
  ) {
    return "pair_local_ai" as const;
  }
  if (local?.status === "contract_ready_runtime_not_connected") {
    return "start_local_ai_service" as const;
  }
  return "configure_local_ai" as const;
}

export function resolveClosedAIRoute(
  task: Pick<
    ClosedAgentTaskRequest,
    "taskType" | "namespace" | "complexity" | "learningConfiguration"
  >,
  snapshots: ClosedAIBackendSnapshot[],
  policy: ClosedAIRoutePolicy = {},
): ClosedAIRouteResolution {
  const complexity = task.complexity ?? taskComplexity(task.taskType);
  const capability = requiredCapability(complexity);
  const compatible = compatibleBackendIds(snapshots, task, complexity);
  if (policy.preferredBackend) {
    const selected = snapshots.find(
      (snapshot) => snapshot.id === policy.preferredBackend,
    );
    if (selected && supports(selected, task, complexity)) {
      return {
        executionStatus: "routable",
        backend: selected,
        complexity,
        automatic: false,
        reasonCode: "USER_SELECTED_BACKEND_LOCKED",
        requiredCapability: capability,
        recommendedNextAction: "execute",
        fallbackAttempted: false,
      };
    }
    return {
      executionStatus: "not_executed",
      backend: null,
      complexity,
      automatic: false,
      reasonCode: selected
        ? "CLOSED_AI_SELECTED_BACKEND_NOT_READY"
        : "CLOSED_AI_SELECTED_BACKEND_UNKNOWN",
      requiredCapability: capability,
      recommendedNextAction: nextAction(snapshots, complexity),
      compatibleBackendIds: compatible,
      fallbackAttempted: false,
    };
  }

  const learnedBackendId = learningPreferredBackend(
    task.learningConfiguration,
  );
  if (learnedBackendId) {
    const learned = snapshots.find(
      (snapshot) => snapshot.id === learnedBackendId,
    );
    if (learned && supports(learned, task, complexity)) {
      return {
        executionStatus: "routable",
        backend: learned,
        complexity,
        automatic: true,
        reasonCode:
          `LEARNED_L0_ROUTE_${
            learnedBackendId.toUpperCase().replaceAll("-", "_")
          }`,
        requiredCapability: capability,
        recommendedNextAction: "execute",
        fallbackAttempted: false,
      };
    }
  }

  const order = complexity === "light"
      && !BROWSER_AI_LIGHT_TASKS.includes(task.taskType)
    ? ["local-ollama", "browser-ai"] as const
    : routeOrder(complexity);
  const selected = order
    .map((backendId) => snapshots.find((snapshot) => snapshot.id === backendId))
    .find((snapshot) => snapshot && supports(snapshot, task, complexity));
  if (selected && supports(selected, task, complexity)) {
    return {
      executionStatus: "routable",
      backend: selected,
      complexity,
      automatic: true,
      reasonCode: `AUTO_SELECTED_${selected.id.toUpperCase().replaceAll("-", "_")}`,
      requiredCapability: capability,
      recommendedNextAction: "execute",
      fallbackAttempted: false,
    };
  }
  return {
    executionStatus: "not_executed",
    backend: null,
    complexity,
    automatic: true,
    reasonCode: "CLOSED_AI_REQUIRED_BACKEND_NOT_READY",
    requiredCapability: capability,
    recommendedNextAction: nextAction(snapshots, complexity),
    compatibleBackendIds: compatible,
    fallbackAttempted: false,
  };
}

export function selectClosedAIBackend(
  request: ClosedAgentTaskRequest,
  snapshots: ClosedAIBackendSnapshot[],
) {
  const route = resolveClosedAIRoute(request, snapshots, {
    preferredBackend: request.preferredBackend,
  });
  if (route.executionStatus === "routable") return route;
  throw Object.assign(
    new Error("The required closed AI capability is not ready."),
    {
      code: route.reasonCode,
      backendId: request.preferredBackend ?? null,
      status: "not_executed",
      complexity: route.complexity,
      requiredCapability: route.requiredCapability,
      recommendedNextAction: route.recommendedNextAction,
      fallbackAttempted: false,
      compatibleBackendIds: route.compatibleBackendIds,
      recommendedBackendId: route.compatibleBackendIds[0] ?? null,
    },
  );
}
