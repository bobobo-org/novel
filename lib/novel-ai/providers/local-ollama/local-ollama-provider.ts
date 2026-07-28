import type { PlatformAIRequest, PlatformAIResult, PlatformProviderCapability, PlatformProviderSnapshot, PlatformRouterDecision } from "../../router/platform-types";
import { normalizeTraditionalChinese } from "../../language/traditional-chinese";
import { LocalBridgeClient, getConfiguredLocalBridgeClient, getConfiguredLocalBridgeModel } from "./local-bridge-client";

function bridgeClient(base?: string) {
  return getConfiguredLocalBridgeClient() ?? new LocalBridgeClient({ endpoint: base });
}

export async function probeLocalOllama(base?: string, signal?: AbortSignal): Promise<PlatformProviderSnapshot> {
  const started = performance.now();
  if (!base && !getConfiguredLocalBridgeClient()) {
    return {
      id: "local-ollama",
      status: "runtime_unavailable",
      capabilities: ["text", "structured", "streaming", "offline"],
      modelId: null,
      maxContext: 0,
      local: true,
      requiresInternet: false,
      latencyMs: Math.round(performance.now() - started),
    };
  }
  try {
    const client = bridgeClient(base);
    const health = await client.health(signal);
    let capabilities: PlatformProviderCapability[] = ["text", "structured", "streaming", "offline"];
    let modelId: string | null = null;
    let modelDigest: string | null = null;
    let maxContext = 0;
    if (health.runtimeReady && client.getSessionMetadata()) {
      const models = await client.models(signal);
      const preferredModel = getConfiguredLocalBridgeModel();
      const textModel = models.models?.find((model: { modelId?: string; capabilities?: { textGeneration?: { value?: boolean } } }) => model.modelId === preferredModel && model.capabilities?.textGeneration?.value === true)
        ?? models.models?.find((model: { capabilities?: { textGeneration?: { value?: boolean } } }) => model.capabilities?.textGeneration?.value === true);
      modelId = textModel?.modelId ?? null;
      modelDigest = textModel?.modelDigest ?? null;
      maxContext = Number(textModel?.contextLength?.value) || 0;
      if (models.models?.some((model: { capabilities?: { embeddings?: { value?: boolean } } }) => model.capabilities?.embeddings?.value === true)) capabilities = [...capabilities, "embedding"];
      if ((textModel?.contextLength?.value ?? 0) >= 16_384) capabilities = [...capabilities, "long-context"];
    }
    const verification = modelId ? client.getModelVerification(modelId) : null;
    const verified = Boolean(
      verification
      && verification.instanceId === client.getSessionMetadata()?.instanceId
      && verification.modelDigest === modelDigest,
    );
    return {
      id: "local-ollama",
      status: health.runtimeReady && modelId && verified
        ? "ready"
        : health.runtimeReady && modelId
          ? "degraded"
          : health.bridgeProcessAlive
            ? "runtime_not_installed"
            : "runtime_unavailable",
      capabilities,
      modelId,
      modelDigest,
      maxContext,
      local: true,
      requiresInternet: false,
      latencyMs: Math.round(performance.now() - started),
      detail: health.runtimeReady && modelId && !verified
        ? "model_inference_not_verified"
        : verified
          ? "model_inference_verified"
          : String(health.pairingState || "runtime_required"),
    };
  } catch {
    return { id: "local-ollama", status: "runtime_unavailable", capabilities: ["text", "structured", "streaming", "offline"], modelId: null, maxContext: 0, local: true, requiresInternet: false, latencyMs: Math.round(performance.now() - started) };
  }
}

export async function runLocalOllama(request: PlatformAIRequest, decision: PlatformRouterDecision, base?: string): Promise<PlatformAIResult> {
  const started = performance.now();
  const client = bridgeClient(base);
  let content = "";
  let completed = false;
  for await (const event of client.generate({ requestId: request.requestId, model: decision.modelId || "", prompt: [...request.context, request.input].join("\n\n"), systemInstruction: "你是台灣繁體中文小說助手。全程只使用繁體中文（例如：著、遠、將、離、穩），禁止輸出簡體字。只輸出作者要求的候選內容，不要解釋。", taskType: request.taskType, timeoutMs: 120_000, cacheNamespace: request.cacheNamespace, signal: request.signal })) {
    if (event.type === "token") content += event.text ?? "";
    if (event.type === "completed") completed = true;
    if (event.type === "failed" || event.type === "cancelled") throw Object.assign(new Error(String(event.errorCode || event.type)), { code: event.errorCode || (event.type === "cancelled" ? "OLLAMA_CANCELLED" : "OLLAMA_STREAM_INTERRUPTED") });
  }
  if (!completed) throw Object.assign(new Error("Local Ollama stream did not complete."), { code: "OLLAMA_STREAM_INTERRUPTED" });
  return { requestId: request.requestId, providerId: "local-ollama", modelId: decision.modelId, modelDigest: decision.modelDigest ?? null, content: normalizeTraditionalChinese(content), candidateOnly: true, externalRequest: false, dataLeavesDevice: false, elapsedMs: Math.round(performance.now() - started), provenance: decision };
}
