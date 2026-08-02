import { browserFabricDigest, browserFabricTokenEstimate } from "./execution-receipt";
import { createBrowserFabricTaskNode } from "./task-node";
import type {
  BrowserFabricExecutionPlan,
  BrowserFabricNodeKind,
  BrowserFabricTask,
} from "./types";
import type { BrowserFabricPolicyDecision } from "./compute-policy";

const TIMEOUTS: Record<BrowserFabricNodeKind, number> = {
  LOAD_AUTHORITY: 5_000,
  BUILD_MEMORY_VIEW: 5_000,
  RETRIEVE: 12_000,
  RERANK: 20_000,
  COMPRESS: 12_000,
  PLAN: 30_000,
  GENERATE: 180_000,
  CRITIC: 30_000,
  REVISE: 60_000,
  STRUCTURE_REPAIR: 10_000,
  CANON_CHECK: 10_000,
  QUALITY_GATE: 10_000,
  CANDIDATE: 5_000,
};

export async function createBrowserFabricExecutionPlan(input: {
  task: BrowserFabricTask;
  decision: BrowserFabricPolicyDecision;
  modelId?: string | null;
  modelDigest?: string | null;
}): Promise<BrowserFabricExecutionPlan> {
  const kinds: BrowserFabricNodeKind[] = [
    "LOAD_AUTHORITY",
    "BUILD_MEMORY_VIEW",
    "RETRIEVE",
    "RERANK",
    "COMPRESS",
    "PLAN",
    "GENERATE",
    "CRITIC",
    "REVISE",
    "STRUCTURE_REPAIR",
    "CANON_CHECK",
    "QUALITY_GATE",
    "CANDIDATE",
  ];
  const nodes = kinds.map((kind, index) => {
    const previous = index === 0 ? [] : [`${input.task.taskId}:${String(index).padStart(2, "0")}:${kinds[index - 1]}`];
    const engineId = kind === "GENERATE" || kind === "PLAN" || kind === "REVISE"
      ? input.decision.generationEngineId
      : kind === "RETRIEVE" || kind === "RERANK" || kind === "COMPRESS" || kind === "CRITIC"
        ? "onnx-runtime-web" as const
        : "deterministic-js-wasm" as const;
    return createBrowserFabricTaskNode({
      taskId: input.task.taskId,
      kind,
      index,
      dependsOn: previous,
      engineId,
      modelTier: kind === "GENERATE" || kind === "REVISE"
        ? input.decision.allowedModelTiers.at(-1) ?? "MICRO"
        : kind === "PLAN"
          ? "MICRO"
          : null,
      modelId: engineId === input.decision.generationEngineId ? input.modelId ?? null : null,
      modelDigest: engineId === input.decision.generationEngineId ? input.modelDigest ?? null : null,
      timeoutMs: TIMEOUTS[kind],
      cachePolicy: input.task.regeneration && ["PLAN", "GENERATE", "CRITIC", "REVISE"].includes(kind)
        ? "bypass"
        : ["LOAD_AUTHORITY", "CANON_CHECK", "CANDIDATE"].includes(kind)
          ? "none"
          : "read-through",
      estimatedTokens: kind === "GENERATE"
        ? input.task.expectedOutputTokens ?? 512
        : browserFabricTokenEstimate(input.task.objective),
    });
  });
  const createdAt = new Date().toISOString();
  return {
    schemaVersion: "browser-sovereign-ai-fabric-rc5-v1",
    planId: await browserFabricDigest({
      taskId: input.task.taskId,
      policy: input.decision.policy,
      nodes: nodes.map(({ kind, engineId, modelTier }) => ({ kind, engineId, modelTier })),
      createdAt,
    }),
    taskId: input.task.taskId,
    policy: input.decision.policy,
    nodes,
    allowedBrowserModelTiers: input.decision.allowedModelTiers,
    preAuthorizedClosedRefinement: input.decision.preAuthorizedClosedRefinement,
    externalFallbackAllowed: false,
    canonicalMutationAllowed: false,
    createdAt,
  };
}
