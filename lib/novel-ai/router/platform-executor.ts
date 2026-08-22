import { browserProviderSnapshot, runBrowserAI } from "../providers/browser-ai/browser-ai-provider";
import {
  BROWSER_PROSE_CANDIDATE_V2_IDENTITY,
  BROWSER_PROSE_CANDIDATE_V2_PROMPT_PROFILE_VERSION,
} from "../providers/browser-ai/browser-prose-candidate-v2";
import { parseBrowserProseCandidateV2Context } from "../providers/browser-ai/browser-prose-candidate-v2-context";
import { executeBrowserProseCandidateV2Runtime } from "../providers/browser-ai/browser-prose-candidate-v2-runtime";
import {
  assertBrowserProseTierProductionQualified,
  browserProseRouterRuntimeIdentityError,
  isBrowserFullProseTask,
} from "../providers/browser-ai/browser-prose-capability-policy";
import { browserWebLLMModel } from "../providers/browser-ai/webllm-model-registry";
import { deterministicProviderSnapshot, runDeterministicLocal } from "../providers/deterministic-local/platform-deterministic-provider";
import { probeLocalOllama, runLocalOllama } from "../providers/local-ollama/local-ollama-provider";
import { privateHubSnapshot } from "../providers/private-ai-hub/private-ai-hub";
import { resolvePlatformProvider } from "./platform-router";
import type { PlatformAIRequest, PlatformAIResult, PlatformProviderSnapshot, PlatformRouterDecision } from "./platform-types";

export async function localProviderSnapshots(signal?: AbortSignal): Promise<PlatformProviderSnapshot[]> { return [await browserProviderSnapshot(), await probeLocalOllama(undefined, signal), privateHubSnapshot, deterministicProviderSnapshot()]; }

export type BrowserProseCandidateV2ProductDependencies = Readonly<Partial<{
  parseContext: typeof parseBrowserProseCandidateV2Context;
  executeRuntime: typeof executeBrowserProseCandidateV2Runtime;
}>>;

export async function executeBrowserProseCandidateV2Product(
  request: PlatformAIRequest,
  decision: PlatformRouterDecision,
  dependencies: BrowserProseCandidateV2ProductDependencies = {},
): Promise<PlatformAIResult> {
  const selectedModel = browserWebLLMModel(decision.modelId);
  const qualificationReceipt = assertBrowserProseTierProductionQualified({
    taskType: request.taskType,
    selectedModelTier: selectedModel?.parameterLabel ?? null,
    selectedModelId: decision.modelId,
    selectedModelDigest: decision.modelDigest,
    executor: "webllm-worker",
  });
  if (
    decision.providerId !== "browser-ai"
    || decision.modelId !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId
    || decision.modelDigest !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest
  ) {
    throw browserProseRouterRuntimeIdentityError(qualificationReceipt);
  }
  const started = performance.now();
  const parsedContext = await (
    dependencies.parseContext ?? parseBrowserProseCandidateV2Context
  )({
    composerAuthority: "project-context-composer-v1",
    context: request.context,
    nextActionGoal: request.input,
  });
  const runtime = await (
    dependencies.executeRuntime ?? executeBrowserProseCandidateV2Runtime
  )({
    outerRequest: request,
    decision,
    parsedContext,
    fixtureId: `product-${request.requestId}`,
    partition: "product",
    executionMode: "product",
  });
  return {
    requestId: request.requestId,
    providerId: "browser-ai",
    modelId: runtime.candidateIdentity.modelId,
    modelDigest: runtime.candidateIdentity.modelDigest,
    content: runtime.content,
    candidateOnly: true,
    externalRequest: false,
    dataLeavesDevice: false,
    elapsedMs: Math.round(performance.now() - started),
    provenance: {
      ...decision,
      warnings: [
        ...decision.warnings,
        "Candidate V2 product path used the qualified three-segment on-device runtime.",
      ],
    },
    profileId: BROWSER_PROSE_CANDIDATE_V2_PROMPT_PROFILE_VERSION,
    outputCharacters: runtime.content.length,
    executor: "webllm-worker",
    generationFinishReason: "stop",
  };
}

export async function executePlatformAI(request: PlatformAIRequest): Promise<PlatformAIResult> {
  const providers = await localProviderSnapshots(request.signal), decision = resolvePlatformProvider(request, providers);
  if (decision.providerId === "browser-ai" && isBrowserFullProseTask(request.taskType)) {
    return executeBrowserProseCandidateV2Product(request, decision);
  }
  if (decision.providerId === "browser-ai") return runBrowserAI(request, decision);
  if (decision.providerId === "local-ollama") return runLocalOllama(request, decision);
  if (decision.providerId === "deterministic-local") return runDeterministicLocal(request, decision);
  throw Object.assign(new Error("選定的執行環境尚未連線。"), { code: "PROVIDER_RUNTIME_NOT_CONNECTED", providerId: decision.providerId });
}
