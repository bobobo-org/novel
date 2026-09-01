"use client";

import { sha256Hex, stableStringify } from "../closed-ai-cache";
import { createExternalRpgConsentAssertion } from "../providers/external/external-rpg-consent-contract";
import {
  generateExternalAICandidateClient,
  type ExternalAIClientError,
} from "../providers/external/external-provider-client";
import type {
  ExternalAIGenerationResult,
  ExternalAIProviderId,
  NovelAIExecutionMode,
} from "../providers/external/external-provider-contract";
import {
  buildRpgOutcomeLines,
  generateRpgChatTurnCandidate,
  resolveRpgChatTurnLockedResult,
  validateRpgOutcomeNarrative,
  validateRpgStoryCandidateBeforePersistence,
  type RpgChatSnapshot,
  type RpgChatTurnCandidate,
} from "./rpg-chat-turn";
import type { RpgChoice } from "../game/progression/rpg-progression";
import { buildExternalRpgPromptBinding } from "./rpg-external-public-context";
import {
  sealExternalRpgExecutionReceipt,
  sealExternalRpgFailureLineage,
} from "./rpg-external-receipt";
import type { ClosedAIProgressEvent } from "../closed-agent-os";
import { rpgLogicalTurnExternalGenerationTaskId } from "../conversation/rpg-logical-turn";

export type ExternalRpgSingleRunIntent = {
  intentId: string;
  providerId: ExternalAIProviderId;
  grantedAt: string;
  expiresAt: string;
};

type ExternalInvoker = (
  request: Parameters<typeof generateExternalAICandidateClient>[0],
  options: Parameters<typeof generateExternalAICandidateClient>[1],
) => Promise<ExternalAIGenerationResult>;

function externalFailureCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as ExternalAIClientError).code || "EXTERNAL_RPG_PROVIDER_FAILED");
  }
  return error instanceof Error && error.name === "AbortError"
    ? "EXTERNAL_AI_CANCELLED"
    : "EXTERNAL_RPG_PROVIDER_FAILED";
}

function assertLiveIntent(input: {
  intent: ExternalRpgSingleRunIntent | null;
  providerId: ExternalAIProviderId;
}) {
  const { intent } = input;
  if (
    !intent
    || intent.providerId !== input.providerId
    || !Number.isFinite(Date.parse(intent.grantedAt))
    || Date.parse(intent.expiresAt) <= Date.now()
  ) {
    throw Object.assign(new Error("本次外送同意已失效；沒有外送，也不會在未同意下改走其他來源。"), {
      code: "CONVERSATION_EXTERNAL_SINGLE_RUN_CONSENT_REQUIRED",
    });
  }
  return intent;
}

export async function generateRpgChatTurnCandidateWithExternalCascade(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  logicalTurnId: string;
  providerId: ExternalAIProviderId;
  executionMode: NovelAIExecutionMode;
  consentIntent: ExternalRpgSingleRunIntent | null;
  publicExecutionEnabled: boolean;
  providerConfigured: boolean;
  providerStatusError?: string | null;
  resumeProviderTaskId?: string;
  signal?: AbortSignal;
  onProgress?: (event: ClosedAIProgressEvent) => void;
  onCascadeProgress?: (message: string) => void;
  externalInvoker?: ExternalInvoker;
  closedInvoker?: typeof generateRpgChatTurnCandidate;
  adultNarrativeRuntime?: Parameters<typeof generateRpgChatTurnCandidate>[0]["adultNarrativeRuntime"];
  adultNarrativeRuntimeClock?: Parameters<typeof generateRpgChatTurnCandidate>[0]["adultNarrativeRuntimeClock"];
}): Promise<RpgChatTurnCandidate> {
  const closedInvoker = input.closedInvoker ?? generateRpgChatTurnCandidate;
  const invokeClosed = async (lineage: Awaited<ReturnType<typeof sealExternalRpgFailureLineage>>) => {
    input.onCascadeProgress?.("外來 AI 未完成；閉端 AI 現在取得完整正文時限，必要時再進入獨立 360 秒隱藏複核。");
    const candidate = await closedInvoker({
      snapshot: input.snapshot,
      choice: input.choice,
      logicalTurnId: input.logicalTurnId,
      resumeProviderTaskId: input.resumeProviderTaskId,
      signal: input.signal,
      onProgress: input.onProgress,
      adultNarrativeRuntime: input.adultNarrativeRuntime,
      adultNarrativeRuntimeClock: input.adultNarrativeRuntimeClock,
    });
    const receipt = candidate.executionReceipt && typeof candidate.executionReceipt === "object"
      ? candidate.executionReceipt as Record<string, unknown>
      : { upstreamReceipt: candidate.executionReceipt ?? null };
    return {
      ...candidate,
      executionReceipt: { ...receipt, externalAttemptFailure: lineage },
    };
  };

  if (input.snapshot.project.adultMode) {
    return invokeClosed(await sealExternalRpgFailureLineage({
      schemaVersion: "external-rpg-failure-lineage-v1",
      attempted: false,
      providerId: input.providerId,
      logicalRequestId: input.logicalTurnId,
      dispatchState: "policy-blocked",
      dataLeftDevice: false,
      publicContextDigest: null,
      promptDigest: null,
      fieldManifestDigest: null,
      failureCode: "EXTERNAL_RPG_ADULT_CONTENT_LOCAL_ONLY",
    }));
  }

  const intent = assertLiveIntent({ intent: input.consentIntent, providerId: input.providerId });
  const externalTaskId = await rpgLogicalTurnExternalGenerationTaskId(input.logicalTurnId);

  const resolution = resolveRpgChatTurnLockedResult(input.snapshot, input.choice);
  const outcomeLines = buildRpgOutcomeLines(input.choice, resolution);
  const binding = await buildExternalRpgPromptBinding({
    snapshot: input.snapshot,
    choice: input.choice,
    resolution,
    outcomeLines,
  });
  if (!input.publicExecutionEnabled || !input.providerConfigured || input.providerStatusError) {
    return invokeClosed(await sealExternalRpgFailureLineage({
      schemaVersion: "external-rpg-failure-lineage-v1",
      attempted: true,
      providerId: input.providerId,
      logicalRequestId: input.logicalTurnId,
      dispatchState: "preflight-unavailable",
      dataLeftDevice: false,
      publicContextDigest: binding.contextDigest,
      promptDigest: binding.promptDigest,
      fieldManifestDigest: binding.fieldManifestDigest,
      failureCode: input.providerStatusError
        ? "EXTERNAL_RPG_PROVIDER_STATUS_UNAVAILABLE"
        : !input.publicExecutionEnabled
          ? "EXTERNAL_AI_EXECUTION_DISABLED"
          : "EXTERNAL_RPG_PROVIDER_NOT_CONFIGURED",
    }));
  }

  const assertion = createExternalRpgConsentAssertion({
    projectId: input.snapshot.project.id,
    logicalRequestId: input.logicalTurnId,
    providerId: input.providerId,
    promptDigest: binding.promptDigest,
    fieldManifestDigest: binding.fieldManifestDigest,
  }, {
    grantId: intent.intentId,
    now: Date.parse(intent.grantedAt),
  });
  const externalInvoker = input.externalInvoker ?? generateExternalAICandidateClient;
  input.onCascadeProgress?.("已依單次同意送出受限公開 RPG 上下文；外來 AI 正在優先產生完整候選。");
  let dispatched = false;
  let resultReceived = false;
  try {
    dispatched = true;
    const result = await externalInvoker({
      executionMode: input.executionMode,
      providerId: input.providerId,
      externalConsent: true,
      operation: "rpg-turn",
      rpgConsentAssertion: assertion,
      rpgProjectId: input.snapshot.project.id,
      rpgFieldManifestDigest: binding.fieldManifestDigest,
      rpgPublicPayload: binding.payload,
      prompt: binding.prompt,
      requestId: input.logicalTurnId,
      maxOutputTokens: 1_792,
      temperature: 0.68,
    }, { signal: input.signal });
    resultReceived = true;
    if (
      result.requestId !== input.logicalTurnId
      || result.providerId !== input.providerId
      || result.candidateOnly !== true
      || result.externalRequest !== true
      || result.dataLeavesDevice !== true
      || result.serverStoredByApplication !== false
    ) {
      throw Object.assign(new Error("外來 AI 回傳的身分或外送事實不一致。"), {
        code: "EXTERNAL_RPG_RESULT_IDENTITY_MISMATCH",
      });
    }
    const story = await validateRpgStoryCandidateBeforePersistence({
      rawStory: result.text,
      snapshot: input.snapshot,
      choice: input.choice,
      resolution,
      prompt: binding.prompt,
    });
    validateRpgOutcomeNarrative(story, resolution, input.snapshot.language, input.choice);
    const candidateDigest = await sha256Hex(story.normalize("NFKC"));
    const modelDigest = await sha256Hex(`external:${result.providerId}:${result.modelId}`);
    const candidateId = `external-rpg-candidate:${candidateDigest.slice(0, 24)}`;
    const receipt = await sealExternalRpgExecutionReceipt({
      schemaVersion: "external-rpg-execution-receipt-v1",
      requestId: result.requestId,
      providerId: result.providerId,
      modelId: result.modelId,
      candidateId,
      candidateDigest,
      modelDigest,
      projectId: input.snapshot.project.id,
      logicalRequestId: input.logicalTurnId,
      sourceChapterId: input.snapshot.chapter.id,
      sourceRevision: input.snapshot.chapter.revision,
      rpgContextDigest: input.snapshot.contextDigest,
      rpgContextRevisionDigest: input.snapshot.contextRevisionDigest,
      publicContextDigest: binding.contextDigest,
      promptDigest: binding.promptDigest,
      fieldManifestDigest: binding.fieldManifestDigest,
      choiceKey: input.choice.key,
      lockedOutcome: resolution.outcome,
      lockedEffectDigest: await sha256Hex(stableStringify(resolution.effect)),
      elapsedMs: result.elapsedMs,
      generatedTokenEvents: result.generatedTokenEvents,
      usage: result.usage,
      candidateOnly: true,
      externalRequest: true,
      dataLeftDevice: true,
      serverStoredByApplication: false,
    });
    return {
      schemaVersion: "rpg-chat-turn-v1",
      taskId: externalTaskId,
      candidateId,
      candidateDigest,
      storyDigest: candidateDigest,
      model: result.modelId,
      modelDigest,
      actualExecutor: `external:${result.providerId}`,
      executionReceipt: receipt,
      contextDigest: input.snapshot.contextDigest,
      contextRevisionDigest: input.snapshot.contextRevisionDigest,
      contextRevisionGuard: structuredClone(input.snapshot.contextRevisionGuard),
      sourceChapterId: input.snapshot.chapter.id,
      sourceRevision: input.snapshot.chapter.revision,
      choice: input.choice,
      resolution,
      story,
      outcomeLines,
      canonicalMutationCount: 0,
      dataLeftDevice: true,
      externalRequest: true,
    };
  } catch (error) {
    if (input.signal?.aborted || externalFailureCode(error) === "EXTERNAL_AI_CANCELLED") throw error;
    return invokeClosed(await sealExternalRpgFailureLineage({
      schemaVersion: "external-rpg-failure-lineage-v1",
      attempted: true,
      providerId: input.providerId,
      logicalRequestId: input.logicalTurnId,
      dispatchState: resultReceived
        ? "provider-result-invalid"
        : dispatched
          ? "provider-request-failed"
          : "preflight-unavailable",
      dataLeftDevice: dispatched,
      publicContextDigest: binding.contextDigest,
      promptDigest: binding.promptDigest,
      fieldManifestDigest: binding.fieldManifestDigest,
      failureCode: externalFailureCode(error),
    }));
  }
}
