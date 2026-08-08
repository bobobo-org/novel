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

export type LocalOllamaPerformanceBudget = {
  smallLocalModel: boolean;
  maxInputCharacters: number;
  maxOutputTokens: number;
};

const LOCAL_DIRECT_PROSE_TASKS = new Set<PlatformAIRequest["taskType"]>([
  "chapter.continue",
  "chapter.rewrite",
  "chapter.expand",
  "character.dialogue",
  "drama.dialogue",
]);

const COMPLETE_PROSE_BOUNDARIES = new Set([
  "。",
  "！",
  "？",
  "…",
  "」",
  "』",
  "）",
  "】",
]);

export type LocalProseCompletionBoundary = {
  content: string;
  repaired: boolean;
  removedCharacters: number;
};

/**
 * A small local model can consume its entire output budget while beginning one
 * final sentence. Keep the completed model-authored prose and remove only that
 * bounded, incomplete tail. This never invents text and intentionally leaves
 * short or substantially truncated answers untouched so the quality gate can
 * still reject them.
 */
export function repairLocalProseCompletionBoundary(input: {
  taskType: PlatformAIRequest["taskType"];
  content: string;
  generatedTokenEvents: number;
  maxOutputTokens: number;
  evaluatedTokens?: number | null;
  doneReason?: string | null;
}): LocalProseCompletionBoundary {
  const content = input.content.trimEnd();
  const exhaustedOutputBudget = input.doneReason === "length"
    || (typeof input.evaluatedTokens === "number"
      && Number.isFinite(input.evaluatedTokens)
      && input.evaluatedTokens >= input.maxOutputTokens)
    || input.generatedTokenEvents >= input.maxOutputTokens;
  if (
    !LOCAL_DIRECT_PROSE_TASKS.has(input.taskType)
    || !exhaustedOutputBudget
    || !content
    || COMPLETE_PROSE_BOUNDARIES.has(content.at(-1) ?? "")
  ) {
    return { content, repaired: false, removedCharacters: 0 };
  }

  let boundaryIndex = -1;
  for (let index = content.length - 1; index >= 0; index -= 1) {
    if (COMPLETE_PROSE_BOUNDARIES.has(content[index] ?? "")) {
      boundaryIndex = index;
      break;
    }
  }
  if (boundaryIndex < 0) {
    return { content, repaired: false, removedCharacters: 0 };
  }

  const completedContent = content.slice(0, boundaryIndex + 1).trimEnd();
  const removedCharacters = content.length - completedContent.length;
  const maximumTail = Math.max(48, Math.floor(content.length * 0.25));
  const retainsSubstantialAnswer = completedContent.length >= 48
    && completedContent.length / content.length >= 0.55;
  if (
    !retainsSubstantialAnswer
    || removedCharacters <= 0
    || removedCharacters > maximumTail
  ) {
    return { content, repaired: false, removedCharacters: 0 };
  }

  return {
    content: completedContent,
    repaired: true,
    removedCharacters,
  };
}

export function resolveLocalOllamaPerformanceBudget(input: {
  taskType: PlatformAIRequest["taskType"];
  modelId: string;
  qualityPreference?: PlatformAIRequest["qualityPreference"];
  requestedMaxTokens?: number;
  profileMaxTokens: number;
  profileMaxInputCharacters: number;
  boundedQualityRepair?: boolean;
}): LocalOllamaPerformanceBudget {
  const smallLocalModel = /(?:^|[:_-])(?:1|2|3|4)b(?:$|[:_-])/iu.test(
    input.modelId,
  );
  const fastLocalMode = input.qualityPreference === "fast";
  const structuredAbcChoices = input.taskType === "chapter.abcChoices";
  const directProseTask = input.taskType === "chapter.continue"
    || input.taskType === "chapter.rewrite"
    || input.taskType === "chapter.expand"
    || input.taskType === "character.dialogue"
    || input.taskType === "drama.dialogue";
  const explicitRequestedMaxTokens = typeof input.requestedMaxTokens === "number"
    && Number.isFinite(input.requestedMaxTokens)
    ? input.requestedMaxTokens
    : null;
  const explicitFastDirectProse = fastLocalMode
    && directProseTask
    && explicitRequestedMaxTokens !== null
    && explicitRequestedMaxTokens > 160;
  const explicitDirectProseCap = directProseTask
    && explicitRequestedMaxTokens !== null
    ? fastLocalMode
      ? 640
      : input.qualityPreference === "high"
        ? 1_024
        : 768
    : null;
  const qualityTokenCap = structuredAbcChoices
    ? input.profileMaxTokens
    : input.boundedQualityRepair && smallLocalModel
      ? directProseTask ? 512 : 360
      : smallLocalModel && explicitDirectProseCap !== null
        ? explicitDirectProseCap
      : fastLocalMode
        ? explicitFastDirectProse ? 640 : 160
        : smallLocalModel
          ? input.qualityPreference === "high" ? 256 : 192
          : input.profileMaxTokens;
  const requestedOutputTokenCap = explicitRequestedMaxTokens !== null
    ? Math.max(32, Math.min(4_096, Math.floor(explicitRequestedMaxTokens)))
    : Number.POSITIVE_INFINITY;
  const smallModelInputCap = fastLocalMode
    ? 4_000
    : input.qualityPreference === "high"
      ? 8_000
      : 6_000;

  return {
    smallLocalModel,
    maxInputCharacters: smallLocalModel
      ? Math.min(input.profileMaxInputCharacters, smallModelInputCap)
      : input.profileMaxInputCharacters,
    maxOutputTokens: Math.min(
      input.profileMaxTokens,
      qualityTokenCap,
      requestedOutputTokenCap,
    ),
  };
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
  runtimeOptions?: { boundedQualityRepair?: boolean },
): Promise<PlatformAIResult> {
  const started = performance.now();
  const client = bridgeClient(base);
  const profile = getClosedAIModelProfile(request.taskType, "local-ollama");
  const performanceBudget = resolveLocalOllamaPerformanceBudget({
    taskType: request.taskType,
    modelId: decision.modelId || "",
    qualityPreference: request.qualityPreference,
    requestedMaxTokens: request.generationOptions?.maxTokens,
    profileMaxTokens: profile.options.num_predict,
    profileMaxInputCharacters: profile.maxInputCharacters,
    boundedQualityRepair: runtimeOptions?.boundedQualityRepair,
  });
  const requestedTemperatureOption = request.generationOptions?.temperature;
  const requestedTemperature = typeof requestedTemperatureOption === "number"
    && Number.isFinite(requestedTemperatureOption)
    ? Math.max(0, Math.min(2, requestedTemperatureOption))
    : profile.options.temperature;
  const requestedTopPOption = request.generationOptions?.topP;
  const requestedTopP = typeof requestedTopPOption === "number"
    && Number.isFinite(requestedTopPOption)
    ? Math.max(0.05, Math.min(1, requestedTopPOption))
    : profile.options.top_p;
  const requestedRepetitionPenaltyOption = request.generationOptions?.repetitionPenalty;
  const requestedRepetitionPenalty = typeof requestedRepetitionPenaltyOption === "number"
    && Number.isFinite(requestedRepetitionPenaltyOption)
    ? Math.max(
      0.5,
      Math.min(2, requestedRepetitionPenaltyOption),
    )
    : profile.options.repeat_penalty;
  const effectiveProfile = {
    ...profile,
    maxInputCharacters: performanceBudget.maxInputCharacters,
    options: {
      ...profile.options,
      num_predict: performanceBudget.maxOutputTokens,
      temperature: requestedTemperature,
      top_p: requestedTopP,
      repeat_penalty: requestedRepetitionPenalty,
      num_ctx: performanceBudget.smallLocalModel && request.qualityPreference === "fast"
        ? Math.min(profile.options.num_ctx, 4_096)
        : profile.options.num_ctx,
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
  let evaluatedTokens: number | null = null;
  let doneReason: string | null = null;
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
    if (event.type === "metadata") {
      evaluatedTokens = typeof event.evalCount === "number"
        && Number.isFinite(event.evalCount)
        ? event.evalCount
        : evaluatedTokens;
      doneReason = typeof event.doneReason === "string"
        ? event.doneReason
        : doneReason;
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
  const normalizedContent = normalizeTraditionalChinesePreservingProperNouns(
    content,
    [request.input, ...request.context].join("\n"),
  );
  const completionBoundary = repairLocalProseCompletionBoundary({
    taskType: request.taskType,
    content: normalizedContent,
    generatedTokenEvents: tokenEvents,
    maxOutputTokens: effectiveProfile.options.num_predict,
    evaluatedTokens,
    doneReason,
  });
  return {
    requestId: request.requestId,
    providerId: "local-ollama",
    modelId: decision.modelId,
    modelDigest: decision.modelDigest ?? null,
    content: completionBoundary.content,
    candidateOnly: true,
    externalRequest: false,
    dataLeavesDevice: false,
    elapsedMs: Math.round(performance.now() - started),
    provenance: decision,
    profileId: `${profile.profileId}:${
      request.qualityPreference ?? "balanced"
    }-${effectiveProfile.options.num_predict}${
      completionBoundary.repaired ? ":completion-boundary-repaired" : ""
    }${
      runtimeOptions?.boundedQualityRepair ? ":bounded-quality-repair" : ""
    }`,
    firstTokenMs,
    inputCharacters: prompt.inputCharacters,
    outputCharacters: completionBoundary.content.length,
    generatedTokenEvents: tokenEvents,
    omittedInputCharacters: prompt.omittedCharacters,
    runtimeStats: [
      evaluatedTokens === null ? null : `ollama-eval-count=${evaluatedTokens}`,
      doneReason ? `ollama-done-reason=${doneReason}` : null,
      completionBoundary.repaired ? "completion-boundary-repaired=1" : null,
    ].filter(Boolean).join("; "),
  };
}
