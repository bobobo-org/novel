import type { PlatformAIRequest, PlatformAIResult, PlatformProviderCapability, PlatformProviderSnapshot, PlatformRouterDecision } from "../../router/platform-types";
import { LocalBridgeClient, getConfiguredLocalBridgeClient, getConfiguredLocalBridgeModel } from "./local-bridge-client";

function bridgeClient(base?: string) {
  return getConfiguredLocalBridgeClient() ?? new LocalBridgeClient({ endpoint: base });
}

export async function probeLocalOllama(base?: string, signal?: AbortSignal): Promise<PlatformProviderSnapshot> {
  const started = performance.now();
  try {
    const client = bridgeClient(base);
    const health = await client.health(signal);
    let capabilities: PlatformProviderCapability[] = ["text", "streaming", "offline"];
    let modelId: string | null = null;
    if (health.runtimeReady && client.getSessionMetadata()) {
      const models = await client.models(signal);
      const preferredModel = getConfiguredLocalBridgeModel();
      const textModel = models.models?.find((model: { modelId?: string; capabilities?: { textGeneration?: { value?: boolean } } }) => model.modelId === preferredModel && model.capabilities?.textGeneration?.value === true)
        ?? models.models?.find((model: { capabilities?: { textGeneration?: { value?: boolean } } }) => model.capabilities?.textGeneration?.value === true);
      modelId = textModel?.modelId ?? null;
      if (models.models?.some((model: { capabilities?: { embeddings?: { value?: boolean } } }) => model.capabilities?.embeddings?.value === true)) capabilities = [...capabilities, "embedding"];
      if ((textModel?.contextLength?.value ?? 0) >= 16_384) capabilities = [...capabilities, "long-context"];
    }
    return { id: "local-ollama", status: health.runtimeReady && modelId ? "ready" : health.bridgeProcessAlive ? "runtime_not_installed" : "runtime_unavailable", capabilities, modelId, maxContext: modelId ? 32_768 : 0, local: true, requiresInternet: false, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { id: "local-ollama", status: "runtime_unavailable", capabilities: ["text", "streaming", "offline"], modelId: null, maxContext: 0, local: true, requiresInternet: false, latencyMs: Math.round(performance.now() - started) };
  }
}

export async function runLocalOllama(request: PlatformAIRequest, decision: PlatformRouterDecision, base?: string): Promise<PlatformAIResult> {
  const started = performance.now();
  const client = bridgeClient(base);
  let content = "";
  let completed = false;
  for await (const event of client.generate({ requestId: request.requestId, model: decision.modelId || "", prompt: [...request.context, request.input].join("\n\n"), systemInstruction: "Write in Traditional Chinese. Return only the requested candidate content.", taskType: request.taskType, timeoutMs: 120_000, signal: request.signal })) {
    if (event.type === "token") content += event.text ?? "";
    if (event.type === "completed") completed = true;
    if (event.type === "failed" || event.type === "cancelled") throw Object.assign(new Error(String(event.errorCode || event.type)), { code: event.errorCode || (event.type === "cancelled" ? "OLLAMA_CANCELLED" : "OLLAMA_STREAM_INTERRUPTED") });
  }
  if (!completed) throw Object.assign(new Error("Local Ollama stream did not complete."), { code: "OLLAMA_STREAM_INTERRUPTED" });
  return { requestId: request.requestId, providerId: "local-ollama", modelId: decision.modelId, content, candidateOnly: true, externalRequest: false, dataLeavesDevice: false, elapsedMs: Math.round(performance.now() - started), provenance: decision };
}
