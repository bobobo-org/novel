import type {
  BrowserFabricEngineId,
  BrowserFabricModelTier,
  BrowserFabricNodeKind,
  BrowserFabricTaskNode,
} from "./types";

export function createBrowserFabricTaskNode(input: {
  taskId: string;
  kind: BrowserFabricNodeKind;
  index: number;
  dependsOn?: string[];
  engineId: BrowserFabricEngineId;
  modelTier?: BrowserFabricModelTier | null;
  modelId?: string | null;
  modelDigest?: string | null;
  timeoutMs?: number;
  cachePolicy?: BrowserFabricTaskNode["cachePolicy"];
  estimatedTokens?: number;
  optional?: boolean;
}): BrowserFabricTaskNode {
  return {
    nodeId: `${input.taskId}:${String(input.index + 1).padStart(2, "0")}:${input.kind}`,
    kind: input.kind,
    dependsOn: input.dependsOn ?? [],
    engineId: input.engineId,
    modelTier: input.modelTier ?? null,
    modelId: input.modelId ?? null,
    modelDigest: input.modelDigest ?? null,
    timeoutMs: input.timeoutMs ?? 15_000,
    cachePolicy: input.cachePolicy ?? "read-through",
    estimatedTokens: input.estimatedTokens ?? 0,
    optional: input.optional ?? false,
  };
}

export function assertNodeDependencies(
  node: BrowserFabricTaskNode,
  completedNodeIds: ReadonlySet<string>,
) {
  const missing = node.dependsOn.filter((dependency) => !completedNodeIds.has(dependency));
  if (missing.length) {
    throw Object.assign(new Error(`Browser Fabric DAG dependency missing: ${missing.join(", ")}`), {
      code: "BROWSER_FABRIC_DAG_DEPENDENCY_MISSING",
      missing,
      nodeId: node.nodeId,
    });
  }
}
