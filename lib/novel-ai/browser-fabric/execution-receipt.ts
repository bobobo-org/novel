import type {
  BrowserFabricExecutionPlan,
  BrowserFabricExecutionReceipt,
  BrowserFabricNodeReceipt,
  BrowserFabricTask,
  BrowserFabricTaskNode,
} from "./types";
import { BROWSER_SOVEREIGN_FABRIC_VERSION } from "./types";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  }
  return value;
}

export async function browserFabricDigest(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(stable(value)));
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function browserFabricTokenEstimate(value: unknown) {
  const length = typeof value === "string"
    ? value.length
    : JSON.stringify(value ?? null).length;
  return Math.max(0, Math.ceil(length / 2.5));
}

export async function createQueuedNodeReceipt(input: {
  task: BrowserFabricTask;
  node: BrowserFabricTaskNode;
  value: unknown;
}): Promise<BrowserFabricNodeReceipt> {
  const now = new Date().toISOString();
  return {
    nodeId: input.node.nodeId,
    taskId: input.task.taskId,
    engineId: input.node.engineId,
    modelId: input.node.modelId,
    modelDigest: input.node.modelDigest,
    inputDigest: await browserFabricDigest(input.value),
    outputDigest: null,
    privacyLevel: input.task.privacyLevel,
    cachePolicy: input.node.cachePolicy,
    timeoutMs: input.node.timeoutMs,
    estimatedTokens: input.node.estimatedTokens,
    actualTokens: 0,
    startedAt: now,
    completedAt: null,
    status: "queued",
    retryCount: 0,
    failureCode: null,
    dataLeftDevice: false,
    canonicalMutationCount: 0,
  };
}

export async function finalizeNodeReceipt(input: {
  receipt: BrowserFabricNodeReceipt;
  output: unknown;
  actualTokens?: number;
  engineId?: BrowserFabricNodeReceipt["engineId"];
  modelId?: string | null;
  modelDigest?: string | null;
}): Promise<BrowserFabricNodeReceipt> {
  return {
    ...input.receipt,
    engineId: input.engineId ?? input.receipt.engineId,
    modelId: input.modelId === undefined ? input.receipt.modelId : input.modelId,
    modelDigest: input.modelDigest === undefined
      ? input.receipt.modelDigest
      : input.modelDigest,
    outputDigest: await browserFabricDigest(input.output),
    actualTokens: input.actualTokens ?? browserFabricTokenEstimate(input.output),
    completedAt: new Date().toISOString(),
    status: "succeeded",
  };
}

export function failNodeReceipt(
  receipt: BrowserFabricNodeReceipt,
  failureCode: string,
  status: "failed" | "cancelled" = "failed",
): BrowserFabricNodeReceipt {
  return {
    ...receipt,
    completedAt: new Date().toISOString(),
    status,
    failureCode,
  };
}

export async function createFabricReceipt(input: {
  task: BrowserFabricTask;
  plan: BrowserFabricExecutionPlan;
  nodes: BrowserFabricNodeReceipt[];
  candidate: unknown;
  startedAt: string;
  status: BrowserFabricExecutionReceipt["status"];
  failureCode?: string | null;
}): Promise<BrowserFabricExecutionReceipt> {
  const generation = [...input.nodes]
    .reverse()
    .find((node) => node.status === "succeeded" && node.modelId);
  return {
    schemaVersion: BROWSER_SOVEREIGN_FABRIC_VERSION,
    receiptId: await browserFabricDigest({
      taskId: input.task.taskId,
      planId: input.plan.planId,
      completedAt: new Date().toISOString(),
    }),
    planId: input.plan.planId,
    taskId: input.task.taskId,
    taskType: input.task.taskType,
    namespaceDigest: await browserFabricDigest(input.task.namespace),
    plannedNodeCount: input.plan.nodes.length,
    completedNodeCount: input.nodes.filter((node) => node.status === "succeeded").length,
    nodeReceipts: input.nodes,
    actualExecutor: generation?.engineId ?? null,
    modelId: generation?.modelId ?? null,
    modelDigest: generation?.modelDigest ?? null,
    candidateDigest: input.status === "succeeded"
      ? await browserFabricDigest(input.candidate)
      : null,
    candidateOnly: true,
    externalRequest: false,
    dataLeftDevice: false,
    preApprovalMutation: 0,
    rawStoryTextPersisted: false,
    rawPromptPersisted: false,
    rawChainOfThoughtPersisted: false,
    startedAt: input.startedAt,
    completedAt: new Date().toISOString(),
    status: input.status,
    failureCode: input.failureCode ?? null,
  };
}
