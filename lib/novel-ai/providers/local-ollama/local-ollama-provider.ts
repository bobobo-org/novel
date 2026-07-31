import type { PlatformAIRequest, PlatformAIResult, PlatformProviderCapability, PlatformProviderSnapshot, PlatformRouterDecision } from "../../router/platform-types";
import {
  normalizeTraditionalChinesePreservingProperNouns,
} from "../../language/traditional-chinese";
import {
  buildClosedAIModelPrompt,
  getClosedAIModelProfile,
  type ClosedProviderGenerationProgress,
} from "../closed/task-profile";
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

export async function runLocalOllama(
  request: PlatformAIRequest,
  decision: PlatformRouterDecision,
  base?: string,
  onProgress?: (progress: ClosedProviderGenerationProgress) => void,
): Promise<PlatformAIResult> {
  const started = performance.now();
  const client = bridgeClient(base);
  const profile = getClosedAIModelProfile(request.taskType, "local-ollama");
  const smallLocalModel = /(?:^|[:_-])(?:1|2|3|4)b(?:$|[:_-])/iu.test(
    decision.modelId || "",
  );
  const outputTokenCap = request.qualityPreference === "fast"
    ? 256
    : smallLocalModel
      ? request.qualityPreference === "high"
        ? 640
        : 448
      : profile.options.num_predict;
  const effectiveProfile = {
    ...profile,
    maxInputCharacters: smallLocalModel
      ? Math.min(
        profile.maxInputCharacters,
        request.qualityPreference === "fast" ? 6_000 : 10_000,
      )
      : profile.maxInputCharacters,
    options: {
      ...profile.options,
      num_predict: Math.min(profile.options.num_predict, outputTokenCap),
      ...(request.generationOptions?.seed == null
        ? {}
        : { seed: request.generationOptions.seed }),
    },
  };
  const prompt = buildClosedAIModelPrompt({
    objective: request.input,
    context: request.context,
    profile: effectiveProfile,
    qualityPhase: request.qualityPhase,
    agentPlan: request.agentPlan,
    toolResults: request.toolResults,
    workingMaterials: request.workingMaterials,
  });
  let content = "";
  let completed = false;
  let firstTokenMs: number | null = null;
  let tokenEvents = 0;
  let lastReportedCharacters = 0;
  for await (const event of client.generate({
    requestId: request.requestId,
    model: decision.modelId || "",
    prompt: prompt.prompt,
    systemInstruction: effectiveProfile.systemInstruction,
    taskType: request.taskType,
    timeoutMs: effectiveProfile.timeoutMs,
    options: effectiveProfile.options,
    cacheNamespace: request.cacheNamespace,
    signal: request.signal,
  })) {
    if (event.type === "token") {
      const text = event.text ?? "";
      if (text && firstTokenMs === null) {
        firstTokenMs = Math.round(performance.now() - started);
      }
      content += text;
      tokenEvents += 1;
      if (
        onProgress
        && (content.length - lastReportedCharacters >= 48 || lastReportedCharacters === 0)
      ) {
        lastReportedCharacters = content.length;
        onProgress({
          generatedCharacters: content.length,
          firstTokenMs,
          tokenEvents,
        });
      }
    }
    if (event.type === "completed") completed = true;
    if (event.type === "failed" || event.type === "cancelled") throw Object.assign(new Error(String(event.errorCode || event.type)), { code: event.errorCode || (event.type === "cancelled" ? "OLLAMA_CANCELLED" : "OLLAMA_STREAM_INTERRUPTED") });
  }
  if (!completed) throw Object.assign(new Error("Local Ollama stream did not complete."), { code: "OLLAMA_STREAM_INTERRUPTED" });
  onProgress?.({
    generatedCharacters: content.length,
    firstTokenMs,
    tokenEvents,
  });
  return {
    requestId: request.requestId,
    providerId: "local-ollama",
    modelId: decision.modelId,
    modelDigest: decision.modelDigest ?? null,
    content: normalizeTraditionalChinesePreservingProperNouns(
      content,
      [request.input, ...request.context].join("\n"),
    ),
    candidateOnly: true,
    externalRequest: false,
    dataLeavesDevice: false,
    elapsedMs: Math.round(performance.now() - started),
    provenance: decision,
    profileId: `${profile.profileId}:${
      request.qualityPreference ?? "balanced"
    }-${effectiveProfile.options.num_predict}`,
    firstTokenMs,
    inputCharacters: prompt.inputCharacters,
    outputCharacters: content.length,
    generatedTokenEvents: tokenEvents,
    omittedInputCharacters: prompt.omittedCharacters,
  };
}
