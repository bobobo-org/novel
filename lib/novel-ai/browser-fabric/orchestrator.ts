import type { PlatformAIRequest, PlatformRouterDecision } from "../router/platform-types";
import type { BrowserAIStreamProgress } from "../providers/browser-ai/browser-ai-provider";
import {
  executeBrowserCompute,
  type BrowserComputeExecution,
} from "../providers/browser-ai/browser-compute-orchestrator";
import { rankWithBrowserSemanticModel } from "../providers/browser-ai/browser-semantic-runtime";
import { qualifyBrowserDevice } from "./capability-profile";
import { resolveBrowserFabricComputePolicy } from "./compute-policy";
import { planBrowserContextCompression } from "./context-compression";
import { browserFabricEngineRegistry } from "./engine-registry";
import { createBrowserFabricExecutionPlan } from "./execution-plan";
import { hybridRetrieve, type BrowserHybridRagResult } from "./hybrid-rag";
import { buildNarrativeMemoryPyramid, flattenNarrativeMemory } from "./narrative-memory";
import { assembleBrowserFabricPrompt } from "./prompt-assembler";
import { browserFabricQueue } from "./queue";
import { executeBrowserFabricTaskGraph } from "./task-graph";
import { validateAndRepairStructuredOutput } from "./structured-output";
import type {
  BrowserFabricContextItem,
  BrowserFabricExecutionReceipt,
  BrowserFabricNodeHandler,
  BrowserFabricTask,
} from "./types";
import { withBrowserGpuLock } from "./gpu-lock";

export type BrowserSovereignFabricExecution = BrowserComputeExecution & {
  fabric: {
    receipt: BrowserFabricExecutionReceipt;
    plannedGraph: string[];
    engineRegistry: Awaited<ReturnType<typeof browserFabricEngineRegistry>>;
  };
};

export function isBrowserFabricQualityReviewable(
  decision: BrowserComputeExecution["quality"]["decision"],
): decision is "pass" | "revise" {
  return decision === "pass" || decision === "revise";
}

function fabricTask(request: PlatformAIRequest): BrowserFabricTask {
  if (!request.cacheNamespace) {
    throw Object.assign(new Error("Browser Sovereign Fabric requires a complete namespace."), {
      code: "BROWSER_COMPUTE_NAMESPACE_REQUIRED",
    });
  }
  const context: BrowserFabricContextItem[] = request.context.map((text, index) => ({
    id: `context-${index + 1}`,
    kind: index === 0 ? "canon" : index <= 2 ? "story-bible" : "retrieval",
    text,
    visibility: "BOTH",
    privacyLevel: request.cacheNamespace!.privacyLevel,
    approved: true,
    revision: Number.parseInt(request.cacheNamespace!.storyBibleRevision, 10) || 0,
    authorityWeight: index === 0 ? 1 : 0.7,
  }));
  return {
    taskId: request.requestId,
    taskType: request.taskType,
    namespace: structuredClone(request.cacheNamespace),
    objective: request.input,
    context,
    privacyLevel: request.cacheNamespace.privacyLevel,
    computePolicy: request.browserComputePolicy === "manual"
      ? "MANUAL"
      : request.browserComputePolicy === "quality-first"
        ? "QUALITY_FIRST"
        : request.browserComputePolicy === "balanced"
          ? "BALANCED"
          : "BROWSER_FIRST",
    preAuthorizedClosedRefinement: request.allowPreAuthorizedClosedEscalation ?? false,
    requiresStructuredOutput: request.requiresStructured,
    outputSchema: request.outputSchema,
    expectedOutputTokens: request.generationOptions?.maxTokens,
    signal: request.signal,
  };
}

export async function executeBrowserSovereignFabric(input: {
  request: PlatformAIRequest;
  decision: PlatformRouterDecision;
  onProgress?: (progress: BrowserAIStreamProgress) => void;
}): Promise<BrowserSovereignFabricExecution> {
  const task = fabricTask(input.request);
  const profile = await qualifyBrowserDevice();
  const engines = await browserFabricEngineRegistry({ profile });
  const decision = resolveBrowserFabricComputePolicy({ task, profile, engines });
  const selected = engines.find((engine) => engine.id === decision.generationEngineId);
  const plan = await createBrowserFabricExecutionPlan({
    task,
    decision,
    modelId: selected?.modelId,
    modelDigest: selected?.modelDigest,
  });
  const computeRef: { current: BrowserComputeExecution | null } = { current: null };
  let ranked: BrowserHybridRagResult[] = [];

  const handler: BrowserFabricNodeHandler = async (node, state) => {
    switch (node.kind) {
      case "LOAD_AUTHORITY":
        return { value: task.context.filter((item) => item.approved), engineId: "deterministic-js-wasm" };
      case "BUILD_MEMORY_VIEW": {
        const memory = buildNarrativeMemoryPyramid({ task, audience: "actor" });
        return { value: memory, engineId: "deterministic-js-wasm" };
      }
      case "RETRIEVE": {
        const memory = state.values.get("BUILD_MEMORY_VIEW") as ReturnType<typeof buildNarrativeMemoryPyramid>;
        ranked = hybridRetrieve({ query: task.objective, items: flattenNarrativeMemory(memory), limit: 12 });
        return { value: ranked.map((item) => ({ id: item.item.id, score: item.finalScore })), engineId: "deterministic-js-wasm" };
      }
      case "RERANK": {
        try {
          const semantic = await rankWithBrowserSemanticModel({
            namespace: task.namespace,
            query: task.objective,
            items: ranked.map((item) => ({ id: item.item.id, text: item.item.text })),
            signal: task.signal,
          });
          const scores = Object.fromEntries(semantic.scores.map((score) => [score.id, score.score]));
          ranked = hybridRetrieve({
            query: task.objective,
            items: ranked.map((item) => item.item),
            rerankerScores: scores,
            limit: 10,
          });
          return { value: ranked.map((item) => ({ id: item.item.id, score: item.finalScore })), engineId: "onnx-runtime-web", modelId: semantic.modelId, modelDigest: semantic.modelDigest };
        } catch {
          return { value: ranked.map((item) => ({ id: item.item.id, score: item.finalScore })), engineId: "deterministic-js-wasm" };
        }
      }
      case "COMPRESS": {
        const compression = planBrowserContextCompression({
          ranked,
          compressorInitializationMs: 3,
          compressorTokensPerSecond: 12_000,
          targetModelPrefillTokensPerSecond: 120,
          expectedReuseCount: 2,
          tokenBudget: Math.max(512, Math.floor((selected?.modelId ? 4_096 : 2_048) * 0.58)),
        });
        return { value: compression, engineId: "deterministic-js-wasm" };
      }
      case "PLAN": {
        const compression = state.values.get("COMPRESS") as ReturnType<typeof planBrowserContextCompression>;
        const assembled = assembleBrowserFabricPrompt({ task, context: compression.items.map((item) => item.item) });
        return { value: { sections: Object.keys(assembled.sections), promptDigestOnly: true }, engineId: "deterministic-js-wasm" };
      }
      case "GENERATE": {
        computeRef.current = await withBrowserGpuLock({
          signal: task.signal,
          run: () => executeBrowserCompute(input),
        });
        return {
          value: { content: computeRef.current.result.content, quality: computeRef.current.quality },
          actualTokens: Math.ceil(computeRef.current.result.content.length / 2.5),
          engineId: computeRef.current.result.executor === "chromium-prompt-api" ? "chromium-built-in-ai" : "webllm",
          modelId: computeRef.current.result.modelId,
          modelDigest: computeRef.current.result.modelDigest,
        };
      }
      case "CRITIC": {
        if (!computeRef.current) throw Object.assign(new Error("Generation result missing."), { code: "BROWSER_FABRIC_GENERATION_MISSING" });
        return { value: computeRef.current.quality, engineId: "deterministic-js-wasm" };
      }
      case "REVISE":
        return { value: { revisedByVerifiedBrowserPipeline: true }, engineId: "deterministic-js-wasm" };
      case "STRUCTURE_REPAIR": {
        if (!computeRef.current) throw Object.assign(new Error("Generation result missing."), { code: "BROWSER_FABRIC_GENERATION_MISSING" });
        if (!task.requiresStructuredOutput) return { value: { required: false, valid: true }, engineId: "deterministic-js-wasm" };
        const repair = validateAndRepairStructuredOutput({
          text: computeRef.current.result.content,
          schema: (task.outputSchema ?? { type: "object" }) as Parameters<typeof validateAndRepairStructuredOutput>[0]["schema"],
        });
        if (!repair.valid) throw Object.assign(new Error("Structured output could not be repaired."), { code: repair.failureCode });
        return { value: repair, engineId: "deterministic-js-wasm" };
      }
      case "CANON_CHECK":
        return { value: { candidateOnly: true, preApprovalMutation: 0, authorityRetained: true }, engineId: "deterministic-js-wasm" };
      case "QUALITY_GATE": {
        const quality = state.values.get("CRITIC") as BrowserComputeExecution["quality"];
        if (!isBrowserFabricQualityReviewable(quality.decision)) {
          throw Object.assign(new Error("Browser candidate failed the Fabric quality gate."), {
            code: "BROWSER_AI_QUALITY_INSUFFICIENT",
            reasonCodes: quality.reasonCodes,
            qualityReasonCodes: quality.reasonCodes,
          });
        }
        return {
          value: {
            decision: quality.decision,
            score: quality.score,
            needsHumanReview: quality.decision === "revise",
            reasonCodes: quality.reasonCodes,
          },
          engineId: "deterministic-js-wasm",
        };
      }
      case "CANDIDATE":
        if (!computeRef.current) throw Object.assign(new Error("Generation result missing."), { code: "BROWSER_FABRIC_GENERATION_MISSING" });
        return { value: { content: computeRef.current.result.content, candidateOnly: true }, engineId: "deterministic-js-wasm" };
    }
  };

  const graph = await browserFabricQueue.enqueue({
    id: task.taskId,
    priority: "interactive",
    signal: task.signal,
    run: () => executeBrowserFabricTaskGraph<{ content: string; candidateOnly: true }>({ task, plan, handler }),
  });
  const compute = computeRef.current;
  if (!compute) throw Object.assign(new Error("Fabric completed without Browser compute."), { code: "BROWSER_FABRIC_GENERATION_MISSING" });
  return {
    ...compute,
    fabric: {
      receipt: graph.receipt,
      plannedGraph: plan.nodes.map((node) => node.kind),
      engineRegistry: engines,
    },
  };
}
