import {
  CLOSED_AI_BACKEND_IDS,
  hasVerifiedClosedAIGeneration,
  type ClosedAIBackendId,
  type ClosedAIBackendSnapshot,
} from "../closed-agent-os";

export const CLOSED_AI_CONSUMER_READINESS_SCHEMA_VERSION =
  "closed-ai-consumer-readiness-v1" as const;

export type ClosedAiConsumerReadiness = {
  schemaVersion: typeof CLOSED_AI_CONSUMER_READINESS_SCHEMA_VERSION;
  closedMode: true;
  status: "ready" | "setup_required" | "unavailable";
  totalBackends: 3;
  readyBackends: number;
  generationVerifiedBackends: number;
  activeBackend: ClosedAIBackendId | null;
  userActionRequired: boolean;
  externalFallback: false;
  silentExternalFallback: false;
  reasonCode:
    | "CLOSED_AI_CONSUMER_READY"
    | "CLOSED_AI_SETUP_REQUIRED"
    | "CLOSED_AI_BACKENDS_UNAVAILABLE";
  backends: Array<{
    id: ClosedAIBackendId;
    status: ClosedAIBackendSnapshot["status"] | "unreachable";
    generationVerified: boolean;
  }>;
};

function isProductionGenerationReady(snapshot: ClosedAIBackendSnapshot) {
  return hasVerifiedClosedAIGeneration(snapshot);
}

export function resolveClosedAiConsumerReadiness(
  snapshots: ClosedAIBackendSnapshot[],
  plannedBackend: ClosedAIBackendId | null = null,
): ClosedAiConsumerReadiness {
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const ready = CLOSED_AI_BACKEND_IDS
    .map((id) => byId.get(id))
    .filter((snapshot): snapshot is ClosedAIBackendSnapshot => (
      Boolean(snapshot) && isProductionGenerationReady(snapshot!)
    ));
  const activeBackend = plannedBackend
    && ready.some((snapshot) => snapshot.id === plannedBackend)
    ? plannedBackend
    : ready[0]?.id ?? null;
  const canPrepare = CLOSED_AI_BACKEND_IDS.some((id) => {
    const snapshot = byId.get(id);
    return snapshot
      ? ["available", "setup_required", "preparing", "degraded"].includes(
        snapshot.status,
      )
      : false;
  });
  const status = ready.length > 0
    ? "ready" as const
    : canPrepare
      ? "setup_required" as const
      : "unavailable" as const;
  return {
    schemaVersion: CLOSED_AI_CONSUMER_READINESS_SCHEMA_VERSION,
    closedMode: true,
    status,
    totalBackends: 3,
    readyBackends: ready.length,
    generationVerifiedBackends: ready.length,
    activeBackend,
    userActionRequired: ready.length === 0,
    externalFallback: false,
    silentExternalFallback: false,
    reasonCode: status === "ready"
      ? "CLOSED_AI_CONSUMER_READY"
      : status === "setup_required"
        ? "CLOSED_AI_SETUP_REQUIRED"
        : "CLOSED_AI_BACKENDS_UNAVAILABLE",
    backends: CLOSED_AI_BACKEND_IDS.map((id) => {
      const snapshot = byId.get(id);
      return {
        id,
        status: snapshot?.status ?? "unreachable",
        generationVerified: snapshot
          ? isProductionGenerationReady(snapshot)
          : false,
      };
    }),
  };
}

export function assertClosedAiConsumerReady(
  readiness: ClosedAiConsumerReadiness,
) {
  if (
    readiness.generationVerifiedBackends < 1
    || !readiness.activeBackend
    || readiness.externalFallback
  ) {
    throw Object.assign(
      new Error("請先完成一個閉端生成模型的裝置內實測。"),
      {
        code: readiness.reasonCode,
        userActionRequired: readiness.userActionRequired,
        externalFallback: false,
      },
    );
  }
  return readiness;
}
