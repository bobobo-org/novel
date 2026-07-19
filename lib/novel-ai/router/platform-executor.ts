import { browserProviderSnapshot } from "../providers/browser-ai/browser-ai-provider";
import { deterministicProviderSnapshot, runDeterministicLocal } from "../providers/deterministic-local/platform-deterministic-provider";
import { probeLocalOllama, runLocalOllama } from "../providers/local-ollama/local-ollama-provider";
import { privateHubSnapshot } from "../providers/private-ai-hub/private-ai-hub";
import { resolvePlatformProvider } from "./platform-router";
import type { PlatformAIRequest, PlatformAIResult, PlatformProviderSnapshot } from "./platform-types";

export async function localProviderSnapshots(signal?: AbortSignal): Promise<PlatformProviderSnapshot[]> { return [await browserProviderSnapshot(), await probeLocalOllama(undefined, signal), privateHubSnapshot, deterministicProviderSnapshot()]; }

export async function executePlatformAI(request: PlatformAIRequest): Promise<PlatformAIResult> {
  const providers = await localProviderSnapshots(request.signal), decision = resolvePlatformProvider(request, providers);
  if (decision.providerId === "local-ollama") return runLocalOllama(request, decision);
  if (decision.providerId === "deterministic-local") return runDeterministicLocal(request, decision);
  throw Object.assign(new Error("選定的執行環境尚未連線。"), { code: "PROVIDER_RUNTIME_NOT_CONNECTED", providerId: decision.providerId });
}
