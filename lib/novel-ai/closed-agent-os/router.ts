import { BROWSER_AI_LIGHT_TASKS, taskComplexity } from "./backend-manifest";
import { learningPreferredBackend } from "../controlled-learning-os";
import type {
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
  request: ClosedAgentTaskRequest,
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
  request: ClosedAgentTaskRequest,
  complexity: ClosedAITaskComplexity,
) {
  return snapshots
    .filter((snapshot) => supports(snapshot, request, complexity))
    .map((snapshot) => snapshot.id);
}

export function selectClosedAIBackend(
  request: ClosedAgentTaskRequest,
  snapshots: ClosedAIBackendSnapshot[],
) {
  const complexity = request.complexity ?? taskComplexity(request.taskType);
  if (request.preferredBackend) {
    const selected = snapshots.find((snapshot) => snapshot.id === request.preferredBackend);
    if (!selected) {
      throw Object.assign(new Error("The selected closed AI backend is unknown."), {
        code: "CLOSED_AI_SELECTED_BACKEND_UNKNOWN",
        backendId: request.preferredBackend,
      });
    }
    if (!supports(selected, request, complexity)) {
      const compatible = compatibleBackendIds(snapshots, request, complexity);
      throw Object.assign(new Error("The selected closed AI backend cannot run this task."), {
        code: "CLOSED_AI_SELECTED_BACKEND_NOT_READY",
        backendId: selected.id,
        status: selected.status,
        complexity,
        fallbackAttempted: false,
        compatibleBackendIds: compatible,
        recommendedBackendId: compatible[0] ?? null,
      });
    }
    return {
      backend: selected,
      complexity,
      automatic: false,
      reasonCode: "USER_SELECTED_BACKEND_LOCKED",
      fallbackAttempted: false as const,
    };
  }

  const learnedBackendId = learningPreferredBackend(request.learningConfiguration);
  if (learnedBackendId) {
    const learned = snapshots.find((snapshot) => snapshot.id === learnedBackendId);
    if (learned && supports(learned, request, complexity)) {
      return {
        backend: learned,
        complexity,
        automatic: true,
        reasonCode: `LEARNED_L0_ROUTE_${learnedBackendId.toUpperCase().replaceAll("-", "_")}`,
        fallbackAttempted: false as const,
        learnedPreferenceApplied: true as const,
      };
    }
  }

  const requiredId = complexity === "heavy"
    ? "private-ai-hub"
    : complexity === "standard"
      ? "local-ollama"
      : BROWSER_AI_LIGHT_TASKS.includes(request.taskType)
        ? "browser-ai"
        : "local-ollama";
  const selected = snapshots.find((snapshot) => snapshot.id === requiredId);
  if (!selected || !supports(selected, request, complexity)) {
    const compatible = compatibleBackendIds(snapshots, request, complexity);
    throw Object.assign(new Error("The required closed AI backend is not ready."), {
      code: "CLOSED_AI_REQUIRED_BACKEND_NOT_READY",
      backendId: requiredId,
      status: selected?.status ?? "missing",
      complexity,
      fallbackAttempted: false,
      compatibleBackendIds: compatible,
      recommendedBackendId: compatible[0] ?? null,
    });
  }
  return {
    backend: selected,
    complexity,
    automatic: true,
    reasonCode: `AUTO_SELECTED_${requiredId.toUpperCase().replaceAll("-", "_")}`,
    fallbackAttempted: false as const,
    learnedPreferenceApplied: false as const,
  };
}
