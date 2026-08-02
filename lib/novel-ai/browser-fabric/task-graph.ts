import {
  createFabricReceipt,
  createQueuedNodeReceipt,
  failNodeReceipt,
  finalizeNodeReceipt,
} from "./execution-receipt";
import { classifyBrowserFabricFailure } from "./failure-classifier";
import { assertNodeDependencies } from "./task-node";
import type {
  BrowserFabricEphemeralState,
  BrowserFabricExecutionPlan,
  BrowserFabricExecutionResult,
  BrowserFabricNodeHandler,
  BrowserFabricNodeKind,
  BrowserFabricNodeReceipt,
  BrowserFabricTask,
} from "./types";

function deadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const resolveOnce = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      const error = Object.assign(new DOMException("Aborted", "AbortError"), {
        code: "BROWSER_FABRIC_CANCELLED",
      });
      controller.abort(signal?.reason ?? error);
      rejectOnce(error);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => {
      const error = Object.assign(new Error("Browser Fabric node timed out"), {
        code: "BROWSER_FABRIC_NODE_TIMEOUT",
      });
      controller.abort(error);
      rejectOnce(error);
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(() => run(controller.signal))
      .then(resolveOnce, rejectOnce);
  });
}

export async function executeBrowserFabricTaskGraph<TCandidate>(input: {
  task: BrowserFabricTask;
  plan: BrowserFabricExecutionPlan;
  handler: BrowserFabricNodeHandler;
}): Promise<BrowserFabricExecutionResult<TCandidate>> {
  const startedAt = new Date().toISOString();
  const receipts: BrowserFabricNodeReceipt[] = [];
  const state: BrowserFabricEphemeralState = {
    task: input.task,
    values: new Map<BrowserFabricNodeKind, unknown>(),
  };
  const completed = new Set<string>();

  for (const node of input.plan.nodes) {
    assertNodeDependencies(node, completed);
    const dependencyValues = node.dependsOn.map((dependency) => {
      const kind = input.plan.nodes.find((candidate) => candidate.nodeId === dependency)?.kind;
      return kind ? state.values.get(kind) : null;
    });
    let receipt = await createQueuedNodeReceipt({
      task: input.task,
      node,
      value: { kind: node.kind, dependencyValues },
    });
    receipt = { ...receipt, status: "running", startedAt: new Date().toISOString() };
    try {
      const result = await deadline(
        (nodeSignal) => input.handler(node, state, nodeSignal),
        node.timeoutMs,
        input.task.signal,
      );
      state.values.set(node.kind, result.value);
      receipt = await finalizeNodeReceipt({
        receipt,
        output: result.value,
        actualTokens: result.actualTokens,
        engineId: result.engineId,
        modelId: result.modelId,
        modelDigest: result.modelDigest,
      });
      receipts.push(receipt);
      completed.add(node.nodeId);
    } catch (error) {
      const classified = classifyBrowserFabricFailure(error);
      receipt = failNodeReceipt(
        receipt,
        classified.code,
        classified.category === "cancelled" ? "cancelled" : "failed",
      );
      receipts.push(receipt);
      if (node.optional) {
        state.values.set(node.kind, null);
        completed.add(node.nodeId);
        continue;
      }
      const fabricReceipt = await createFabricReceipt({
        task: input.task,
        plan: input.plan,
        nodes: receipts,
        candidate: null,
        startedAt,
        status: classified.category === "cancelled" ? "cancelled" : "failed",
        failureCode: classified.code,
      });
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        code: classified.code,
        browserFabricReceipt: fabricReceipt,
      });
    }
  }

  const candidate = state.values.get("CANDIDATE") as TCandidate;
  const receipt = await createFabricReceipt({
    task: input.task,
    plan: input.plan,
    nodes: receipts,
    candidate,
    startedAt,
    status: "succeeded",
  });
  return { plan: input.plan, receipt, candidate };
}
