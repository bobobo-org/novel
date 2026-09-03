"use client";

import { useMemo, useRef, useState, type MutableRefObject } from "react";
import type { ClosedAgentCandidate, ClosedAIProgressEvent } from "@/lib/novel-ai/closed-agent-os";
import type {
  Chapter,
  ConversationArtifact,
  ConversationMessage,
  ConversationSession,
  ConversationToolInvocation,
  ExternalAttemptProvenance,
  NovelProject,
  StoryState,
} from "@/lib/novel-ai/domain";
import type { NovelRepository } from "@/lib/novel-ai/repository";
import type { SovereignLearningRepository } from "@/lib/novel-ai/sovereign-learning";
import { conversationContentDigest } from "@/lib/novel-ai/conversation/approval-transaction";
import { buildConversationClosedAgentCacheOriginProof } from "@/lib/novel-ai/conversation/closed-agent-cache-origin-proof";
import { sha256Hex, stableStringify } from "@/lib/novel-ai/closed-ai-cache";
import type { ConversationRepositoryService } from "@/lib/novel-ai/conversation/repository";
import { CONVERSATION_LOCAL_TOOL_IDS } from "@/lib/novel-ai/conversation/tool-registry";
import {
  isRpgLogicalTurnProviderTaskId,
  rpgLogicalTurnExternalGenerationTaskId,
  rpgLogicalTurnGenerationTaskId,
} from "@/lib/novel-ai/conversation/rpg-logical-turn";
import type { RpgChoice } from "@/lib/novel-ai/game/progression/rpg-progression";
import {
  normalizeRpgChoiceWireText,
  rpgChoiceWireText,
} from "@/lib/novel-ai/web/rpg-chat-wire";
import { isRpgChoiceStaleEvidenceInvocation } from "@/lib/novel-ai/conversation/rpg-choice-stale-evidence";
import type {
  RpgChatChoicePlan,
  RpgChatTurnCandidate,
} from "@/lib/novel-ai/web/rpg-chat-turn";
import type { ExternalRpgSingleRunIntent } from "@/lib/novel-ai/web/rpg-external-cascade";
import {
  verifyExternalRpgExecutionReceipt,
  verifyExternalRpgFailureLineage,
} from "@/lib/novel-ai/web/rpg-external-receipt";
import { verifyRpgAdultRuntimePolicyReceipt } from "@/lib/novel-ai/web/rpg-adult-runtime-receipt";
import type {
  ExternalAIProviderId,
  NovelAIExecutionMode,
} from "@/lib/novel-ai/providers/external/external-provider-contract";
import {
  parseRpgCandidate,
  parseRpgChoices,
  rpgCandidateApprovalState,
  rpgCandidateRequiresClosedReview,
  serializeRpgChoices,
} from "../components/conversation-presentation";
import type { DrawerPayload, RpgChoiceEnvelope } from "../components/conversation-types";
import { toExecutionReceipt } from "./use-conversation-operation";
import {
  friendlyConversationExecutionError,
  safeConversationRpgFailureDiagnostics,
} from "../components/execution-trace-model";
import { findRpgChoiceRecoveryTarget } from "../conversation-workspace-support";
import {
  assertRpgExecutionSourceCanGenerate,
  resolveRpgExecutionSourceBlock,
  type RpgExecutionSourceSnapshot,
} from "./rpg-execution-source-gate";

const loadRpgChatTurnRuntime = () => import("@/lib/novel-ai/web/rpg-chat-turn");

function assertRpgRuntimeLoadActive(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw Object.assign(new Error("RPG runtime loading was cancelled."), {
    code: "CONVERSATION_CANCELLED",
  });
}

function rpgErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "CONVERSATION_RPG_FAILED");
  }
  const messageCode = error instanceof Error ? error.message.trim() : "";
  if (/^(?:RPG|CONVERSATION|CLOSED_AI|CLOSED_AGENT|OLLAMA)_[A-Z0-9_]{1,100}$/u.test(messageCode)) {
    return messageCode;
  }
  if ((error as { name?: string })?.name === "AbortError") return "CONVERSATION_CANCELLED";
  return "CONVERSATION_RPG_FAILED";
}

const SAFE_RPG_ERROR_CODE = /^RPG_[A-Z0-9_]{1,100}$/u;

function safeRpgErrorCode(value: unknown) {
  return typeof value === "string" && SAFE_RPG_ERROR_CODE.test(value)
    ? value
    : null;
}

export function rpgLeafErrorCode(error: unknown) {
  let current = error;
  let leaf: string | null = null;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const source = current as {
      code?: unknown;
      reviewFailureLeafCode?: unknown;
      cause?: unknown;
    };
    // The fallback wrapper explicitly preserves the final review leaf. Prefer
    // it over a deeper generation cause, because it is the actual gate that
    // prevented this parent RPG turn from producing a candidate.
    const preservedLeaf = safeRpgErrorCode(source.reviewFailureLeafCode);
    if (preservedLeaf) return preservedLeaf;
    const code = safeRpgErrorCode(source.code);
    if (code) leaf = code;
    const message = current instanceof Error ? current.message.trim() : "";
    if (SAFE_RPG_ERROR_CODE.test(message)) leaf = message;
    current = source.cause;
  }
  return leaf ?? rpgErrorCode(error);
}

export function rpgSafeContinuityFailures(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 12 && current && typeof current === "object"; depth += 1) {
    const source = current as {
      reviewContinuityFailures?: unknown;
      generationContinuityFailures?: unknown;
      continuityFailures?: unknown;
      cause?: unknown;
    };
    const normalizedFailures = (rawFailures: unknown) => (
      Array.isArray(rawFailures)
      && rawFailures.every((failure) => (
        typeof failure === "string" && /^[a-z_]{1,40}$/u.test(failure)
      ))
        ? [...new Set(rawFailures)] as string[]
        : null
    );
    if (Object.prototype.hasOwnProperty.call(source, "reviewContinuityFailures")) {
      // The fallback wrapper owns the final review result. An empty array means
      // that review ended before an application-quality result existed; do not
      // misreport an older generation failure as the final review diagnosis.
      return normalizedFailures(source.reviewContinuityFailures) ?? [];
    }
    for (const rawFailures of [source.generationContinuityFailures, source.continuityFailures]) {
      const failures = normalizedFailures(rawFailures);
      if (
        failures
        && failures.length
      ) return failures;
    }
    current = source.cause;
  }
  return [];
}

function rpgErrorMessage(error: unknown) {
  const base = error instanceof Error && error.message
    ? error.message
    : "故事回合沒有完成；故事與數值均未寫入，原有內容維持不變。";
  const failures = rpgSafeContinuityFailures(error);
  return failures.length
    ? `${base} 安全檢查缺項：${failures.join("、")}。`
    : base;
}

function rpgProgressLabel(event: ClosedAIProgressEvent) {
  const generated = event.generatedCharacters ?? 0;
  return `${event.label}${generated ? ` · 已產生 ${generated} 字` : ""}`;
}

async function resolveRpgLogicalTurnExecutionTruth(candidate: RpgChatTurnCandidate) {
  const failureLineage = candidate.externalRequest
    ? null
    : await verifyExternalRpgFailureLineage(candidate);
  let externalAttempt: ExternalAttemptProvenance | undefined;
  if (failureLineage) {
    if (!failureLineage.receiptDigest) {
      throw Object.assign(new Error("外來 AI 失敗沿革缺少可驗證摘要。"), {
        code: "RPG_EXTERNAL_FAILURE_LINEAGE_INVALID",
      });
    }
    externalAttempt = {
      schemaVersion: "external-attempt-provenance-v1",
      attempted: failureLineage.attempted,
      providerId: failureLineage.providerId,
      dispatchState: failureLineage.dispatchState,
      dataLeftDevice: failureLineage.dataLeftDevice,
      failureCode: failureLineage.failureCode,
      receiptDigest: failureLineage.receiptDigest,
    };
  }
  return {
    externalRequest: candidate.externalRequest || Boolean(failureLineage?.attempted),
    dataLeftDevice: candidate.dataLeftDevice || failureLineage?.dataLeftDevice === true,
    externalAttempt,
  };
}

async function resolveRpgConversationClosedAgentProof(candidate: RpgChatTurnCandidate) {
  if (candidate.externalRequest || candidate.actualExecutor === "deterministic-rule-fallback") {
    return undefined;
  }
  const { getStudioClosedAgentOS } = await import("@/lib/novel-ai/web/closed-agent-os-service");
  const os = getStudioClosedAgentOS();
  const authoritative = await os.state.get<ClosedAgentCandidate>(candidate.candidateId);
  if (
    !authoritative
    || !await os.verifyCandidateIntegrity(candidate.candidateId)
    || authoritative.id !== candidate.candidateId
    || authoritative.taskId !== candidate.taskId
    || authoritative.contentDigest !== candidate.candidateDigest
    || authoritative.modelId !== candidate.model
    || authoritative.modelDigest !== candidate.modelDigest
  ) {
    throw Object.assign(new Error("RPG 候選缺少可驗證的閉端 AI 執行身分。"), {
      code: "RPG_CHAT_TURN_PROOF_MISSING",
    });
  }
  return {
    schemaVersion: authoritative.schemaVersion,
    backendId: authoritative.backendId,
    normalizationReceiptId: authoritative.traditionalChineseNormalization.receiptId,
    traditionalChineseNormalizerVersion:
      authoritative.traditionalChineseNormalization.normalizerVersion,
    cacheOrigin: await buildConversationClosedAgentCacheOriginProof(authoritative),
  };
}

export function rpgChoiceUserContent(
  choice: RpgChatChoicePlan["choices"][number] | RpgChoice,
) {
  return choice.key === "custom"
    ? `自訂行動：${choice.title}`
    : rpgChoiceWireText(choice);
}

export function rpgUserMessageMatchesChoice(
  message: ConversationMessage,
  choice: RpgChatChoicePlan["choices"][number] | RpgChoice,
) {
  const content = normalizeRpgChoiceWireText(message.content);
  if (content === normalizeRpgChoiceWireText(rpgChoiceUserContent(choice))) return true;
  if (choice.key === "custom") return false;
  return content.toUpperCase() === choice.key;
}

export function inspectRpgChoiceTurn(
  messages: ConversationMessage[],
  artifacts: ConversationArtifact[],
  choiceSourceMessageId: string,
  invocations: ConversationToolInvocation[] = [],
) {
  const attempts = messages.filter((message) => (
    message.role === "user" && message.sourceMessageId === choiceSourceMessageId
  ));
  const attemptIds = new Set(attempts.map((attempt) => attempt.id));
  const responses = messages.filter((message) => (
    message.role === "assistant"
    && Boolean(message.parentMessageId)
    && attemptIds.has(message.parentMessageId!)
  ));
  const responseIdsWithCandidate = new Set(artifacts
    .filter((artifact) => (
      artifact.artifactType === "rpg"
      && ["candidate", "approved"].includes(artifact.status)
    ))
    .map((artifact) => artifact.sourceMessageId));
  const responseIdsWithFinishedArtifact = new Set(artifacts
    .filter((artifact) => artifact.artifactType === "rpg")
    .map((artifact) => artifact.sourceMessageId));
  const settledAttemptIds = new Set(responses
    .filter((response) => (
      response.status === "completed"
      && responseIdsWithCandidate.has(response.id)
    ))
    .map((response) => response.parentMessageId!));
  const finishedAttemptIds = new Set(responses
    .filter((response) => (
      response.status === "completed"
      && responseIdsWithFinishedArtifact.has(response.id)
    ))
    .map((response) => response.parentMessageId!));
  const rejectedRuleFallbackResponseIds = new Set(artifacts
    .filter((artifact) => (
      artifact.artifactType === "rpg"
      && artifact.status === "rejected"
      && rpgCandidateRequiresClosedReview(artifact, invocations)
    ))
    .map((artifact) => artifact.sourceMessageId));
  const choiceCard = messages.find((message) => message.id === choiceSourceMessageId) ?? null;
  const abandoned = Boolean(choiceCard && invocations.some((invocation) => (
    invocation.messageId === choiceSourceMessageId
    && isRpgChoiceStaleEvidenceInvocation(invocation, choiceCard)
  )));
  const consumed = settledAttemptIds.size > 0;
  const closed = consumed || abandoned;
  const closedReviewRequired = responses.some((response) => (
    rejectedRuleFallbackResponseIds.has(response.id)
  ));
  return {
    attempts,
    responses,
    consumed,
    abandoned,
    closed,
    closedReviewRequired,
    recoverableUser: closed
      ? null
      : [...attempts]
        .reverse()
        .find((attempt) => (
          !["failed", "cancelled"].includes(attempt.status)
          && !finishedAttemptIds.has(attempt.id)
        )) ?? null,
  };
}

export function resolveRpgExecutionRecoveryMode(
  message: ConversationMessage | null,
  invocation: ConversationToolInvocation | null,
  expectedProviderRunIds?: string | readonly string[],
) {
  const acceptedProviderRunIds = typeof expectedProviderRunIds === "string"
    ? [expectedProviderRunIds]
    : expectedProviderRunIds;
  if (
    invocation?.status === "completed"
    && acceptedProviderRunIds?.length
    && !acceptedProviderRunIds.includes(invocation.executionReceipt?.providerRunId ?? "")
  ) return "start_attempt" as const;
  if (
    message
    && invocation?.status === "completed"
    && invocation.executionReceipt
    && ["pending", "streaming", "completed"].includes(message.status)
  ) return "resume_completed" as const;
  if (
    message
    && invocation
    && ["failed", "cancelled"].includes(message.status)
    && ["failed", "cancelled"].includes(invocation.status)
  ) return "retry_terminal" as const;
  return "start_attempt" as const;
}

export function useConversationRpgController({
  projectId,
  repository,
  learningRepository,
  ensureSharedLearningReady,
  conversation,
  activeSession,
  busy,
  executionSourceSnapshot,
  externalProviderId,
  externalExecutionMode,
  consumeExternalRunConsentIntent,
  operationLockRef,
  retryActionRef,
  runRef,
  abortRef,
  acquireLease,
  maybeUpdateRollingSummary,
  loadWorkspace,
  projectMessageIntoActiveSession,
  projectInvocationIntoActiveSession,
  setRetryAvailable,
  setRetryLabel,
  setCancellable,
  setBusy,
  setSafeError,
  setProgress,
  setDrawer,
  onRpgGenerationStarted,
}: {
  projectId: string;
  repository: NovelRepository;
  learningRepository: SovereignLearningRepository;
  ensureSharedLearningReady: (signal?: AbortSignal) => Promise<unknown>;
  conversation: ConversationRepositoryService;
  activeSession: ConversationSession | null;
  busy: boolean;
  executionSourceSnapshot: RpgExecutionSourceSnapshot;
  externalProviderId: ExternalAIProviderId;
  externalExecutionMode: NovelAIExecutionMode;
  consumeExternalRunConsentIntent: () => ExternalRpgSingleRunIntent | null;
  operationLockRef: MutableRefObject<boolean>;
  retryActionRef: MutableRefObject<(() => void) | null>;
  runRef: MutableRefObject<number>;
  abortRef: MutableRefObject<AbortController | null>;
  acquireLease: (projectId: string, sessionId: string) => Promise<(() => void) | null>;
  maybeUpdateRollingSummary: (sessionId: string) => Promise<unknown>;
  loadWorkspace: (preferredSessionId?: string) => Promise<boolean>;
  projectMessageIntoActiveSession: (sessionId: string, message: ConversationMessage) => boolean;
  projectInvocationIntoActiveSession: (
    sessionId: string,
    invocation: ConversationToolInvocation,
  ) => boolean;
  setRetryAvailable: (value: boolean) => void;
  setRetryLabel: (value: string) => void;
  setCancellable: (value: boolean) => void;
  setBusy: (value: boolean) => void;
  setSafeError: (error: {
    code: string;
    message: string;
    leafCode?: string;
    continuityFailures?: string[];
  } | null) => void;
  setProgress: (message: string) => void;
  setDrawer: (value: DrawerPayload) => void;
  onRpgGenerationStarted: () => void;
}) {
  const rpgTurnLocksRef = useRef(new Set<string>());
  const rpgChoiceFallbackRequestRef = useRef<(() => void) | null>(null);
  const [rpgChoicePlanning, setRpgChoicePlanning] = useState(false);

  function blockUnsupportedExecutionSource() {
    const block = resolveRpgExecutionSourceBlock(executionSourceSnapshot);
    if (!block) return false;
    retryActionRef.current = null;
    setRetryAvailable(false);
    setSafeError({ code: block.code, message: block.message });
    setProgress(block.progress);
    return true;
  }

  const loadSnapshot = async (signal?: AbortSignal) => {
    const runtime = await loadRpgChatTurnRuntime();
    assertRpgRuntimeLoadActive(signal);
    return runtime.loadLearningAwareRpgChatSnapshot({
      repository,
      projectId,
      learningRepository,
      ensureSharedLearningReady,
      signal,
    });
  };

  async function assertRpgChoiceEnvelopeBaselineCurrent(
    envelope: RpgChoiceEnvelope,
    signal: AbortSignal,
  ) {
    assertRpgRuntimeLoadActive(signal);
    if (
      envelope.plan.contextRevisionDigest !== envelope.contextRevisionDigest
      || envelope.plan.contextRevisionGuard.digest !== envelope.contextRevisionDigest
    ) {
      throw Object.assign(new Error("這組故事選項的版本證據不完整，請重新產生。"), {
        code: "RPG_CHAT_CHOICES_STALE",
      });
    }
    const project = await repository.get<NovelProject>("projects", projectId);
    assertRpgRuntimeLoadActive(signal);
    if (
      !project
      || project.deletedAt
      || project.activeChapterId !== envelope.chapterId
      || !project.storyStateId
    ) {
      throw Object.assign(new Error("作品狀態已改變，請重新產生本回合選項。"), {
        code: "RPG_CHAT_CHOICES_STALE",
      });
    }
    const [chapter, storyState] = await Promise.all([
      repository.get<Chapter>("chapters", envelope.chapterId),
      repository.get<StoryState>("storyStates", project.storyStateId),
    ]);
    assertRpgRuntimeLoadActive(signal);
    if (
      !chapter
      || chapter.projectId !== projectId
      || chapter.revision !== envelope.chapterRevision
      || !storyState
      || storyState.projectId !== projectId
      || storyState.revision !== envelope.storyStateRevision
    ) {
      throw Object.assign(new Error("作品狀態已改變，請重新產生本回合選項。"), {
        code: "RPG_CHAT_CHOICES_STALE",
      });
    }
  }

  async function readRpgChoiceTurnState(
    sessionId: string,
    choiceSourceMessageId: string,
    convergeInterrupted: boolean,
  ) {
    let [sessionMessages, sessionArtifacts, sessionInvocations] = await Promise.all([
      conversation.listMessages(projectId, sessionId),
      conversation.listArtifacts(projectId, sessionId),
      conversation.listToolInvocations(projectId, sessionId),
    ]);
    if (convergeInterrupted) {
      const turn = inspectRpgChoiceTurn(
        sessionMessages,
        sessionArtifacts,
        choiceSourceMessageId,
        sessionInvocations,
      );
      const responseIds = new Set(turn.responses.map((response) => response.id));
      const durableCandidateResponseIds = new Set(sessionArtifacts
        .filter((artifact) => (
          artifact.artifactType === "rpg"
          && ["candidate", "approved"].includes(artifact.status)
        ))
        .map((artifact) => artifact.sourceMessageId));
      const interruptedInvocations = sessionInvocations.filter((invocation) => (
        responseIds.has(invocation.messageId)
        && !durableCandidateResponseIds.has(invocation.messageId)
        && invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.rpgTurn
        && ["pending", "running"].includes(invocation.status)
      ));
      if (interruptedInvocations.length) {
        await Promise.all(interruptedInvocations.map((invocation) => (
          conversation.updateToolInvocationStatus({
            projectId,
            sessionId,
            invocationId: invocation.id,
            expectedRevision: invocation.revision,
            status: "failed",
            safeErrorCode: "CONVERSATION_RELOAD_INTERRUPTED",
            canonicalMutationCount: 0,
            safeProgress: {
              stage: "interrupted",
              percent: 0,
              message: "上一次回合在完成前中斷；已保留同一選擇供安全恢復。",
            },
          }).catch(() => invocation)
        )));
        sessionInvocations = await conversation.listToolInvocations(projectId, sessionId);
      }
      const responseById = new Map(turn.responses.map((response) => [response.id, response]));
      const completedInvocationMessageIds = new Set((await Promise.all(sessionInvocations
        .filter((invocation) => (
          responseIds.has(invocation.messageId)
          && invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.rpgTurn
          && invocation.status === "completed"
          && Boolean(invocation.executionReceipt)
        ))
        .map(async (invocation) => {
          const logicalTurnId = responseById.get(invocation.messageId)?.parentMessageId;
          if (!logicalTurnId) return null;
          return await isRpgLogicalTurnProviderTaskId(
            logicalTurnId,
            invocation.executionReceipt?.providerRunId,
          )
            ? invocation.messageId
            : null;
        }))).filter((messageId): messageId is string => Boolean(messageId)));
      const interruptedMessages = turn.responses.filter((message) => (
        ["pending", "streaming"].includes(message.status)
        && !durableCandidateResponseIds.has(message.id)
        && !completedInvocationMessageIds.has(message.id)
      ));
      if (interruptedMessages.length) {
        await Promise.all(interruptedMessages.map((message) => (
          conversation.updateMessageStatus({
            projectId,
            sessionId,
            messageId: message.id,
            expectedRevision: message.revision,
            status: "cancelled",
            content: "上一次回合在完成前中斷；已保留原選擇，可安全重試。",
          }).catch(() => message)
        )));
      }
      if (interruptedInvocations.length || interruptedMessages.length) {
        [sessionMessages, sessionArtifacts, sessionInvocations] = await Promise.all([
          conversation.listMessages(projectId, sessionId),
          conversation.listArtifacts(projectId, sessionId),
          conversation.listToolInvocations(projectId, sessionId),
        ]);
      }
    }
    return {
      ...inspectRpgChoiceTurn(
        sessionMessages,
        sessionArtifacts,
        choiceSourceMessageId,
        sessionInvocations,
      ),
      messages: sessionMessages,
      artifacts: sessionArtifacts,
      invocations: sessionInvocations,
    };
  }

  async function abandonStaleRpgChoiceCard(input: {
    sessionId: string;
    choiceSourceMessageId: string;
    message: ConversationMessage | null;
  }) {
    const staleEvidence = await conversation.saveRpgChoiceStaleEvidence({
      projectId,
      sessionId: input.sessionId,
      choiceCardMessageId: input.choiceSourceMessageId,
    });
    const sealedChoiceCard = await repository.get<ConversationMessage>(
      "conversationMessages",
      input.choiceSourceMessageId,
    );
    if (sealedChoiceCard) projectMessageIntoActiveSession(input.sessionId, sealedChoiceCard);
    projectInvocationIntoActiveSession(input.sessionId, staleEvidence);
    if (input.message?.status === "pending") {
      const cancelled = await conversation.updateMessageStatus({
        projectId,
        sessionId: input.sessionId,
        messageId: input.message.id,
        expectedRevision: input.message.revision,
        status: "cancelled",
      }).catch(() => null);
      if (cancelled) projectMessageIntoActiveSession(input.sessionId, cancelled);
    }
  }

  async function createRpgChoicesMessage(input: {
    sessionId: string;
    parentMessageId: string;
    signal: AbortSignal;
  }) {
    assertRpgExecutionSourceCanGenerate(executionSourceSnapshot);
    let placeholder: ConversationMessage | null = null;
    let invocation: ConversationToolInvocation | null = null;
    try {
      placeholder = await conversation.appendMessage({
        projectId,
        sessionId: input.sessionId,
        role: "assistant",
        content: "",
        status: "streaming",
        parentMessageId: input.parentMessageId,
      });
      const taskId = `conversation-rpg-plan:${crypto.randomUUID()}`;
      const planningDigest = await conversationContentDigest(
        `rpg-plan:${projectId}:${input.parentMessageId}`,
      );
      invocation = await conversation.saveToolInvocation({
        projectId,
        sessionId: input.sessionId,
        messageId: placeholder.id,
        taskId,
        toolId: CONVERSATION_LOCAL_TOOL_IDS.rpgChoicePlan,
        taskType: "chapter.abcChoices",
        inputDigest: planningDigest,
        contextDigest: planningDigest,
        status: "running",
        canonicalMutationCount: 0,
      });
      onRpgGenerationStarted();
      const snapshot = await loadSnapshot(input.signal);
      const planningController = new AbortController();
      let userRequestedFallback = false;
      const relayOuterAbort = () => planningController.abort(input.signal.reason);
      if (input.signal.aborted) relayOuterAbort();
      else input.signal.addEventListener("abort", relayOuterAbort, { once: true });
      rpgChoiceFallbackRequestRef.current = () => {
        if (planningController.signal.aborted) return;
        userRequestedFallback = true;
        setProgress("已停止等待閉端 AI；正在依既有故事、人物與上一回合後果建立後備三選一。");
        planningController.abort("USER_REQUESTED_RULE_FALLBACK");
      };
      setRpgChoicePlanning(true);
      setProgress("閉端 AI 正在承接上一回合設計三條故事路線；最長等待 180 秒。你可隨時改用後備選項。");
      let plan: RpgChatChoicePlan;
      try {
        const runtime = await loadRpgChatTurnRuntime();
        assertRpgRuntimeLoadActive(planningController.signal);
        plan = await runtime.planRpgChatChoices({
          snapshot,
          signal: planningController.signal,
          onProgress: (event) => setProgress(`${rpgProgressLabel(event)} · 最長等待 180 秒`),
        });
        if (userRequestedFallback) {
          if (plan.actualExecutor !== "deterministic-rule-fallback") {
            const { rejectStudioClosedAgentCandidate } = await import("@/lib/novel-ai/web/closed-agent-os-service");
            await rejectStudioClosedAgentCandidate(plan.candidateId).catch(() => undefined);
          }
          const fallbackPlan = await runtime.buildRpgRuleChoicePlan({
            snapshot,
            fallbackReason: "USER_REQUESTED_RULE_FALLBACK",
          });
          plan = fallbackPlan;
        }
      } finally {
        input.signal.removeEventListener("abort", relayOuterAbort);
        rpgChoiceFallbackRequestRef.current = null;
        setRpgChoicePlanning(false);
      }
      if (input.signal.aborted) {
        throw Object.assign(new Error("RPG choices cancelled."), { code: "CONVERSATION_CANCELLED" });
      }
      const envelope: RpgChoiceEnvelope = {
        schemaVersion: "conversation-rpg-choices-v1",
        chapterId: snapshot.chapter.id,
        chapterRevision: snapshot.chapter.revision,
        storyStateRevision: snapshot.storyState.revision,
        contextRevisionDigest: snapshot.contextRevisionDigest,
        plan,
      };
      if (!placeholder || !invocation) throw new Error("CONVERSATION_RPG_CHOICE_PLAN_START_MISSING");
      const updated = await repository.get<ConversationMessage>("conversationMessages", placeholder.id);
      if (!updated) throw new Error("CONVERSATION_MESSAGE_MISSING");
      invocation = await conversation.updateToolInvocationStatus({
        projectId,
        sessionId: input.sessionId,
        invocationId: invocation.id,
        expectedRevision: invocation.revision,
        status: "completed",
        actualExecutor: plan.actualExecutor,
        modelId: plan.model,
        modelDigest: plan.modelDigest,
        executionReceipt: toExecutionReceipt({
          taskId: plan.taskId,
          modelId: plan.model,
          modelDigest: plan.modelDigest,
          contextDigest: plan.contextDigest ?? invocation.contextDigest,
          outputDigest: plan.contentDigest,
          externalRequest: false,
          dataLeftDevice: false,
        }),
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "completed", percent: 100, message: "三條故事路線已完成" },
      });
      const completedMessage = await conversation.updateMessageStatus({
        projectId,
        sessionId: input.sessionId,
        messageId: updated.id,
        expectedRevision: updated.revision,
        status: "completed",
        content: serializeRpgChoices(envelope),
        candidateIds: [plan.candidateId],
        toolInvocationIds: updated.toolInvocationIds,
      });
      return { placeholder: completedMessage, plan, invocation };
    } catch (error) {
      const friendlyError = friendlyConversationExecutionError(
        rpgErrorCode(error),
        rpgErrorMessage(error),
      );
      const currentMessage = placeholder
        ? await repository.get<ConversationMessage>("conversationMessages", placeholder.id)
        : null;
      if (currentMessage && ["pending", "streaming"].includes(currentMessage.status)) {
        await conversation.updateMessageStatus({
          projectId,
          sessionId: input.sessionId,
          messageId: currentMessage.id,
          expectedRevision: currentMessage.revision,
          status: input.signal.aborted ? "cancelled" : "failed",
          content: `${friendlyError.title}。${friendlyError.message}`,
        }).catch(() => undefined);
      }
      const placeholderId = placeholder?.id ?? null;
      const invocationCandidate = invocation ?? (placeholderId
        ? (await conversation.listToolInvocations(projectId, input.sessionId).catch(() => []))
          .find((item) => (
            item.messageId === placeholderId
            && item.toolId === CONVERSATION_LOCAL_TOOL_IDS.rpgChoicePlan
            && ["pending", "running"].includes(item.status)
          )) ?? null
        : null);
      const interruptedInvocation = invocationCandidate
        ? await repository.get<ConversationToolInvocation>(
            "conversationToolInvocations",
            invocationCandidate.id,
          ).catch(() => null)
        : null;
      if (interruptedInvocation && ["pending", "running"].includes(interruptedInvocation.status)) {
        await conversation.updateToolInvocationStatus({
          projectId,
          sessionId: input.sessionId,
          invocationId: interruptedInvocation.id,
          expectedRevision: interruptedInvocation.revision,
          status: input.signal.aborted ? "cancelled" : "failed",
          safeErrorCode: rpgErrorCode(error),
          canonicalMutationCount: 0,
        }).catch(() => undefined);
      }
      throw error;
    }
  }

  function requestRpgChoiceFallback() {
    const requestFallback = rpgChoiceFallbackRequestRef.current;
    if (!requestFallback) return false;
    requestFallback();
    return true;
  }

  async function withRpgTurnLock<T>(turnKey: string, action: () => Promise<T>) {
    const lockName = `novel:rpg-turn:${projectId}:${turnKey}`;
    if (rpgTurnLocksRef.current.has(lockName)) {
      throw Object.assign(new Error("這張故事選擇卡正在處理，不能重複建立回合。"), {
        code: "RPG_CHAT_TURN_ALREADY_RUNNING",
      });
    }
    rpgTurnLocksRef.current.add(lockName);
    try {
      if (typeof navigator !== "undefined" && navigator.locks) {
        return await navigator.locks.request(
          lockName,
          { mode: "exclusive", ifAvailable: true },
          async (lock) => {
            if (!lock) {
              throw Object.assign(new Error("另一個頁面正在處理同一故事回合。"), {
                code: "RPG_CHAT_TURN_ALREADY_RUNNING",
              });
            }
            return action();
          },
        );
      }
      return await action();
    } finally {
      rpgTurnLocksRef.current.delete(lockName);
    }
  }

  async function executeRpgChoice(input: {
    sessionId: string;
    choice: RpgChatChoicePlan["choices"][number] | RpgChoice;
    choicePlanCandidateId: string;
    choiceSourceMessageId: string;
    expectedChapterId: string;
    expectedChapterRevision: number;
    expectedStoryStateRevision: number;
    expectedContextRevisionDigest: string;
    userMessage: ConversationMessage;
    signal: AbortSignal;
  }) {
    return withRpgTurnLock(
      `${input.sessionId}:${input.choiceSourceMessageId}:${input.choicePlanCandidateId}`,
      async () => {
        const rpgRuntime = await loadRpgChatTurnRuntime();
        assertRpgRuntimeLoadActive(input.signal);
        const snapshot = await loadSnapshot(input.signal);
        if (
          snapshot.chapter.id !== input.expectedChapterId
          || snapshot.chapter.revision !== input.expectedChapterRevision
          || snapshot.storyState.revision !== input.expectedStoryStateRevision
          || snapshot.contextRevisionDigest !== input.expectedContextRevisionDigest
        ) {
          throw Object.assign(new Error("作品狀態已改變，請重新產生本回合選項。"), {
            code: "RPG_CHAT_CHOICES_STALE",
          });
        }
        let turnState = await readRpgChoiceTurnState(
          input.sessionId,
          input.choiceSourceMessageId,
          true,
        );
        let resumingUnsettledDurableCandidate = turnState.artifacts.some((artifact) => (
          artifact.id === `conversation-rpg-artifact:${input.sessionId}:${input.userMessage.id}`
          && artifact.artifactType === "rpg"
          && artifact.status === "candidate"
          && rpgCandidateApprovalState(artifact, turnState.invocations) === "settling"
        ));
        if (turnState.closed && !resumingUnsettledDurableCandidate) {
          throw Object.assign(new Error("這張故事選擇卡已經建立過回合。"), {
            code: "RPG_CHAT_TURN_ALREADY_CREATED",
          });
        }
        const recoverableUser = turnState.recoverableUser;
        if (recoverableUser && recoverableUser.id !== input.userMessage.id) {
          throw Object.assign(new Error("這張選擇卡已有一筆尚未完成的選擇；必須先恢復同一回合。"), {
            code: "RPG_CHAT_TURN_CHOICE_CONFLICT",
          });
        }
        let userMessage = await repository.get<ConversationMessage>(
          "conversationMessages",
          input.userMessage.id,
        ) ?? input.userMessage;
        if (
          userMessage.projectId !== projectId
          || userMessage.sessionId !== input.sessionId
          || userMessage.role !== "user"
          || userMessage.sourceMessageId !== input.choiceSourceMessageId
          || !rpgUserMessageMatchesChoice(userMessage, input.choice)
        ) {
          throw Object.assign(new Error("已保存的選擇與本次重試不一致；不會建立第二筆選擇。"), {
            code: "RPG_CHAT_TURN_CHOICE_CONFLICT",
          });
        }
        if (userMessage.status === "pending") {
          userMessage = await conversation.updateMessageStatus({
            projectId,
            sessionId: input.sessionId,
            messageId: userMessage.id,
            expectedRevision: userMessage.revision,
            status: "completed",
          });
        } else if (userMessage.status !== "completed") {
          throw Object.assign(new Error("這筆選擇已經終止，不能沿用為新的故事回合。"), {
            code: "RPG_CHAT_TURN_CHOICE_CONFLICT",
          });
        }
        projectMessageIntoActiveSession(input.sessionId, userMessage);
        await maybeUpdateRollingSummary(input.sessionId);
        turnState = await readRpgChoiceTurnState(
          input.sessionId,
          input.choiceSourceMessageId,
          true,
        );
        resumingUnsettledDurableCandidate = turnState.artifacts.some((artifact) => (
          artifact.id === `conversation-rpg-artifact:${input.sessionId}:${userMessage.id}`
          && artifact.artifactType === "rpg"
          && artifact.status === "candidate"
          && rpgCandidateApprovalState(artifact, turnState.invocations) === "settling"
        ));
        if (turnState.closed && !resumingUnsettledDurableCandidate) {
          throw Object.assign(new Error("這張故事選擇卡已經建立過回合。"), {
            code: "RPG_CHAT_TURN_ALREADY_CREATED",
          });
        }
        const durableArtifactId = `conversation-rpg-artifact:${input.sessionId}:${userMessage.id}`;
        const durableArtifact = turnState.artifacts.find((artifact) => (
          artifact.id === durableArtifactId
          && artifact.artifactType === "rpg"
          && artifact.status === "candidate"
        )) ?? null;
        let durableCandidate: RpgChatTurnCandidate | null = null;
        if (durableArtifact) {
          const parsed = parseRpgCandidate(durableArtifact);
          if (!parsed || parsed.externalRequest !== parsed.dataLeftDevice) {
            throw Object.assign(new Error("已保存的 RPG 候選證據不完整；為避免重複執行，本回合已停止。"), {
              code: "RPG_EXTERNAL_DURABLE_ARTIFACT_INVALID",
            });
          }
          const externalReceipt = parsed.externalRequest
            ? await verifyExternalRpgExecutionReceipt(parsed)
            : null;
          const externalFailureLineage = parsed.externalRequest
            ? null
            : await verifyExternalRpgFailureLineage(parsed);
          await verifyRpgAdultRuntimePolicyReceipt({
            candidate: parsed,
            snapshot,
          });
          const expectedResolution = rpgRuntime.resolveRpgChatTurnLockedResult(snapshot, input.choice);
          if (
            (externalReceipt && externalReceipt.projectId !== projectId)
            || (externalReceipt && externalReceipt.logicalRequestId !== userMessage.id)
            || (externalFailureLineage && externalFailureLineage.logicalRequestId !== userMessage.id)
            || parsed.contextDigest !== snapshot.contextDigest
            || parsed.contextRevisionDigest !== snapshot.contextRevisionDigest
            || stableStringify(parsed.contextRevisionGuard) !== stableStringify(snapshot.contextRevisionGuard)
            || parsed.choice.key !== input.choice.key
            || parsed.choice.title !== input.choice.title
            || parsed.choice.description !== input.choice.description
            || stableStringify(parsed.resolution) !== stableStringify(expectedResolution)
          ) {
            throw Object.assign(new Error("已保存的 RPG 候選與原選擇或目前作品版本不一致；不會重新外送或重跑模型。"), {
              code: "RPG_EXTERNAL_DURABLE_ARTIFACT_STALE",
            });
          }
          const recoveredStoryDigest = await sha256Hex(parsed.story.normalize("NFKC"));
          if (
            parsed.storyDigest !== undefined
              ? recoveredStoryDigest !== parsed.storyDigest
              : parsed.externalRequest && recoveredStoryDigest !== parsed.candidateDigest
          ) {
            throw Object.assign(new Error("已保存的 RPG 候選摘要不一致；不會重新執行模型。"), {
              code: "RPG_EXTERNAL_DURABLE_ARTIFACT_INVALID",
            });
          }
          const recoveredStory = await rpgRuntime.validateRpgStoryCandidateBeforePersistence({
            snapshot,
            choice: input.choice,
            resolution: expectedResolution,
            rawStory: parsed.story,
          });
          if (recoveredStory !== parsed.story) {
            throw Object.assign(new Error("已保存的 RPG 正文沒有通過內容身分重驗；不會重新外送或重跑模型。"), {
              code: "RPG_EXTERNAL_DURABLE_ARTIFACT_INVALID",
            });
          }
          durableCandidate = parsed;
        } else {
          assertRpgExecutionSourceCanGenerate(executionSourceSnapshot);
        }
        const assistantId = `conversation-rpg-turn:${input.sessionId}:${userMessage.id}`;
        const responseAttempts = turnState.responses.filter((message) => message.parentMessageId === userMessage.id);
        const durableAssistant = durableArtifact
          ? turnState.messages.find((message) => message.id === durableArtifact.sourceMessageId) ?? null
          : null;
        const existingAssistant = durableAssistant ?? responseAttempts.at(-1)
          ?? await repository.get<ConversationMessage>("conversationMessages", assistantId);
        if (existingAssistant && (
          existingAssistant.projectId !== projectId
          || existingAssistant.sessionId !== input.sessionId
          || existingAssistant.parentMessageId !== userMessage.id
        )) {
          throw Object.assign(new Error("RPG 回合重試來源不一致。"), {
            code: "RPG_CHAT_RETRY_SOURCE_MISMATCH",
          });
        }
        const sourceInvocation = existingAssistant
          ? turnState.invocations
            .filter((item) => (
              item.messageId === existingAssistant.id
              && item.toolId === CONVERSATION_LOCAL_TOOL_IDS.rpgTurn
            ))
            .at(-1) ?? null
          : null;
        if (durableCandidate && (!existingAssistant || !sourceInvocation)) {
          throw Object.assign(new Error("已保存的 RPG 候選缺少原始訊息或執行記錄；為避免重複執行，本回合已停止。"), {
            code: "RPG_EXTERNAL_DURABLE_ARTIFACT_INVALID",
          });
        }
        let assistant: ConversationMessage;
        let invocation: ConversationToolInvocation;
        const completedProviderRunId = sourceInvocation?.executionReceipt?.providerRunId ?? "";
        const completedProviderRunAccepted = await isRpgLogicalTurnProviderTaskId(
          userMessage.id,
          completedProviderRunId,
        );
        const recoveryMode = durableCandidate
          ? "resume_durable_candidate" as const
          : resolveRpgExecutionRecoveryMode(
          existingAssistant ?? null,
          sourceInvocation,
          completedProviderRunAccepted
            ? completedProviderRunId
            : "__invalid_rpg_logical_turn_provider_task__",
          );
        let invocationCompleted = recoveryMode === "resume_completed";
        let explicitRetryProviderTaskId: string | undefined;

        const startExecutionAttempt = async (attemptNumber: number) => {
          const initial = attemptNumber === 1;
          const nextAssistantId = initial ? assistantId : `${assistantId}:resume:${attemptNumber}`;
          const nextInvocationId = initial
            ? `conversation-rpg-invocation:${input.sessionId}:${userMessage.id}`
            : `conversation-rpg-invocation:${input.sessionId}:${userMessage.id}:resume:${attemptNumber}`;
          const nextTaskId = initial
            ? `conversation-rpg-turn-task:${input.sessionId}:${userMessage.id}`
            : `conversation-rpg-turn-task:${input.sessionId}:${userMessage.id}:resume:${attemptNumber}`;
          const nextAssistant = await conversation.appendMessage({
            projectId,
            sessionId: input.sessionId,
            messageId: nextAssistantId,
            role: "assistant",
            content: "",
            status: "streaming",
            parentMessageId: userMessage.id,
          });
          try {
            const nextInvocation = await conversation.saveToolInvocation({
              projectId,
              sessionId: input.sessionId,
              messageId: nextAssistant.id,
              invocationId: nextInvocationId,
              taskId: nextTaskId,
              toolId: CONVERSATION_LOCAL_TOOL_IDS.rpgTurn,
              taskType: "chapter.continue",
              inputDigest: userMessage.contentDigest,
              contextDigest: userMessage.contentDigest,
              status: "running",
              canonicalMutationCount: 0,
              safeProgress: {
                stage: "logical-turn",
                percent: 0,
                message: `恢復同一 RPG logical turn：${userMessage.id}`,
              },
            });
            return { assistant: nextAssistant, invocation: nextInvocation };
          } catch (error) {
            const durableInvocation = await repository.get<ConversationToolInvocation>(
              "conversationToolInvocations",
              nextInvocationId,
            );
            if (
              durableInvocation
              && durableInvocation.projectId === projectId
              && durableInvocation.sessionId === input.sessionId
              && durableInvocation.messageId === nextAssistant.id
              && durableInvocation.taskId === nextTaskId
              && durableInvocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.rpgTurn
              && ["pending", "running"].includes(durableInvocation.status)
            ) {
              return { assistant: nextAssistant, invocation: durableInvocation };
            }
            const durableMessage = await repository.get<ConversationMessage>(
              "conversationMessages",
              nextAssistant.id,
            );
            if (durableMessage && ["pending", "streaming"].includes(durableMessage.status)) {
              await conversation.updateMessageStatus({
                projectId,
                sessionId: input.sessionId,
                messageId: durableMessage.id,
                expectedRevision: durableMessage.revision,
                status: input.signal.aborted ? "cancelled" : "failed",
                content: "RPG 回合在建立執行記錄前中斷；原選擇已保留。",
              }).catch(() => undefined);
            }
            throw error;
          }
        };

        if (recoveryMode === "resume_durable_candidate" && existingAssistant && sourceInvocation) {
          assistant = existingAssistant;
          invocation = sourceInvocation;
          invocationCompleted = sourceInvocation.status === "completed";
        } else if (recoveryMode === "resume_completed" && existingAssistant && sourceInvocation) {
          assistant = existingAssistant;
          invocation = sourceInvocation;
        } else if (recoveryMode === "retry_terminal" && existingAssistant && sourceInvocation) {
          const attemptNumber = responseAttempts.length + 1;
          explicitRetryProviderTaskId = executionSourceSnapshot.externalSelected
            ? await rpgLogicalTurnExternalGenerationTaskId(userMessage.id, attemptNumber)
            : await rpgLogicalTurnGenerationTaskId(userMessage.id, attemptNumber);
          const retry = await conversation.prepareToolInvocationRetry({
            projectId,
            sessionId: input.sessionId,
            sourceMessageId: existingAssistant.id,
            sourceInvocationId: sourceInvocation.id,
            expectedMessageRevision: existingAssistant.revision,
            expectedInvocationRevision: sourceInvocation.revision,
            messageId: `${assistantId}:resume:${attemptNumber}`,
            invocationId: `conversation-rpg-invocation:${input.sessionId}:${userMessage.id}:resume:${attemptNumber}`,
            taskId: `conversation-rpg-turn-task:${input.sessionId}:${userMessage.id}:resume:${attemptNumber}`,
          });
          assistant = retry.message;
          invocation = retry.invocation;
        } else {
          const started = await startExecutionAttempt(responseAttempts.length + 1);
          assistant = started.assistant;
          invocation = started.invocation;
          invocationCompleted = false;
        }
        try {
          let candidate = durableCandidate;
          if (!candidate) {
            onRpgGenerationStarted();
            if (executionSourceSnapshot.externalSelected) {
              setProgress("已依本次單次同意優先交由指定外來 AI 產生完整小說正文；失敗後才啟動閉端 AI 的獨立 360 秒，必要時再追加最多 360 秒隱藏後備複核；只有白名單內的嚴格內容門檻要求安全修正重試時，才會再加最多 360 秒，而且只重試一次。");
              const { generateRpgChatTurnCandidateWithExternalCascade } = await import("@/lib/novel-ai/web/rpg-external-cascade");
              assertRpgRuntimeLoadActive(input.signal);
              candidate = await generateRpgChatTurnCandidateWithExternalCascade({
                snapshot,
                choice: input.choice,
                logicalTurnId: userMessage.id,
                providerId: externalProviderId,
                executionMode: externalExecutionMode,
                consentIntent: consumeExternalRunConsentIntent(),
                publicExecutionEnabled: executionSourceSnapshot.publicExecutionEnabled,
                providerConfigured: executionSourceSnapshot.providerConfigured,
                providerStatusError: executionSourceSnapshot.providerStatusError,
                resumeProviderTaskId: explicitRetryProviderTaskId ?? (invocationCompleted
                  ? invocation.executionReceipt?.providerRunId ?? undefined
                  : undefined),
                signal: input.signal,
                onProgress: (event) => setProgress(`${rpgProgressLabel(event)} · 閉端正文階段最長 360 秒；若進入隱藏後備複核，最多另加 360 秒；只有白名單內的嚴格內容門檻要求安全修正重試時，才會再加最多 360 秒，而且只重試一次`),
                onCascadeProgress: setProgress,
              });
            } else {
              setProgress("閉端 AI 正在依你選定的 A／B／C 分支產生完整小說正文；CPU 小模型會分段補完，正文階段最長 360 秒。若仍無有效正文，才會在背景建立三份不可見草稿，並追加最多 360 秒閉端獨立合成複核；只有白名單內的嚴格內容門檻要求安全修正重試時，才會再加最多 360 秒，而且只重試一次。複核通過才會顯示候選。");
              candidate = await rpgRuntime.generateRpgChatTurnCandidate({
                snapshot,
                choice: input.choice,
                logicalTurnId: userMessage.id,
                resumeProviderTaskId: explicitRetryProviderTaskId ?? (invocationCompleted
                  ? invocation.executionReceipt?.providerRunId ?? undefined
                  : undefined),
                signal: input.signal,
                onProgress: (event) => setProgress(`${rpgProgressLabel(event)} · 正文階段最長 360 秒；若進入隱藏後備複核，最多另加 360 秒；只有白名單內的嚴格內容門檻要求安全修正重試時，才會再加最多 360 秒，而且只重試一次`),
              });
            }
          } else {
            setProgress("已從本機保存的 RPG 候選證據恢復同一回合；不會再次外送，也不會重複執行模型。");
          }
          if (input.signal.aborted) {
            throw Object.assign(new Error("RPG turn cancelled."), { code: "CONVERSATION_CANCELLED" });
          }
          await verifyRpgAdultRuntimePolicyReceipt({ candidate, snapshot });
          const executionTruth = await resolveRpgLogicalTurnExecutionTruth(candidate);
          const closedAgentProof = await resolveRpgConversationClosedAgentProof(candidate);
          const artifact = durableArtifact ?? await conversation.saveArtifact({
            projectId,
            sessionId: input.sessionId,
            sourceMessageId: assistant.id,
            artifactId: `conversation-rpg-artifact:${input.sessionId}:${userMessage.id}`,
            artifactType: "rpg",
            targetStore: "chapters",
            targetRecordId: snapshot.chapter.id,
            sourceRevision: snapshot.chapter.revision,
            candidateContent: JSON.stringify({
              schemaVersion: "conversation-rpg-candidate-v1",
              candidate,
            }),
          });
          setProgress(`${candidate.externalRequest ? "外來 AI" : "閉端 AI"} 已完成並通過小說品質檢查（${candidate.model}）；仍是候選，尚未寫入 Canon。`);
          const currentAssistant = await repository.get<ConversationMessage>("conversationMessages", assistant.id);
          if (!currentAssistant) throw new Error("CONVERSATION_MESSAGE_MISSING");
          if (invocationCompleted) {
            if (
              invocation.status !== "completed"
              || !invocation.executionReceipt
              || invocation.executionReceipt.providerRunId !== candidate.taskId
              || invocation.executionReceipt.outputDigest !== candidate.candidateDigest
              || invocation.modelId !== candidate.model
              || invocation.modelDigest !== candidate.modelDigest
              || invocation.actualExecutor !== candidate.actualExecutor
              || invocation.externalRequest !== executionTruth.externalRequest
              || invocation.dataLeftDevice !== executionTruth.dataLeftDevice
              || stableStringify(invocation.executionReceipt.externalAttempt ?? null)
                !== stableStringify(executionTruth.externalAttempt ?? null)
              || invocation.canonicalMutationCount !== 0
            ) {
              throw Object.assign(new Error("RPG 回合恢復候選與已完成收據不一致。"), {
                code: "RPG_CHAT_RECOVERY_RECEIPT_MISMATCH",
              });
            }
          }
          const completedMessage = ["pending", "streaming"].includes(currentAssistant.status)
            ? await conversation.updateMessageStatus({
                projectId,
                sessionId: input.sessionId,
                messageId: currentAssistant.id,
                expectedRevision: currentAssistant.revision,
                status: "completed",
                content: candidate.story,
                candidateIds: [
                  ...currentAssistant.candidateIds,
                  artifact.id,
                  candidate.candidateId,
                ],
                toolInvocationIds: currentAssistant.toolInvocationIds,
              })
            : currentAssistant;
          if (
            completedMessage.status !== "completed"
            || completedMessage.content !== candidate.story
            || !completedMessage.candidateIds.includes(candidate.candidateId)
            || !completedMessage.candidateIds.includes(artifact.id)
            || !completedMessage.toolInvocationIds.includes(invocation.id)
          ) {
            throw Object.assign(new Error("RPG 回合恢復訊息與候選證據不一致。"), {
              code: "RPG_CHAT_RECOVERY_MESSAGE_MISMATCH",
            });
          }
          if (!invocationCompleted) {
            invocation = await conversation.updateToolInvocationStatus({
              projectId,
              sessionId: input.sessionId,
              invocationId: invocation.id,
              expectedRevision: invocation.revision,
              status: "completed",
              actualExecutor: candidate.actualExecutor,
              modelId: candidate.model,
              modelDigest: candidate.modelDigest,
              executionReceipt: toExecutionReceipt({
                taskId: candidate.taskId,
                modelId: candidate.model,
                modelDigest: candidate.modelDigest,
                contextDigest: candidate.contextDigest ?? invocation.contextDigest,
                outputDigest: candidate.candidateDigest,
                externalRequest: executionTruth.externalRequest,
                dataLeftDevice: executionTruth.dataLeftDevice,
                externalAttempt: executionTruth.externalAttempt,
                receipt: candidate.executionReceipt as Parameters<typeof toExecutionReceipt>[0]["receipt"],
                closedAgentProof,
              }),
              externalRequest: executionTruth.externalRequest,
              dataLeftDevice: executionTruth.dataLeftDevice,
              canonicalMutationCount: 0,
              safeProgress: {
                stage: "candidate",
                percent: 100,
                message: candidate.externalRequest
                  ? "外來 AI 完整故事回合已成為候選"
                  : "完整故事回合已成為候選",
              },
            });
            invocationCompleted = true;
          }
          const { rejectStudioClosedAgentCandidate } = await import("@/lib/novel-ai/web/closed-agent-os-service");
          await rejectStudioClosedAgentCandidate(input.choicePlanCandidateId).catch(() => undefined);
          setDrawer({ kind: "artifact", artifactId: artifact.id });
          return { artifact, message: completedMessage };
        } catch (error) {
          const safeContinuityFailures = rpgSafeContinuityFailures(error);
          const friendlyError = friendlyConversationExecutionError(
            rpgErrorCode(error),
            rpgErrorMessage(error),
          );
          const durableInvocation = await repository.get<ConversationToolInvocation>(
            "conversationToolInvocations",
            invocation.id,
          );
          const durableCompletion = durableInvocation?.status === "completed"
            && Boolean(durableInvocation.executionReceipt);
          const durableCandidateArtifact = await repository.get<ConversationArtifact>(
            "conversationArtifacts",
            `conversation-rpg-artifact:${input.sessionId}:${userMessage.id}`,
          );
          const hasDurableCandidateArtifact = Boolean(
            durableCandidateArtifact
            && durableCandidateArtifact.artifactType === "rpg"
            && durableCandidateArtifact.status === "candidate",
          );
          const currentAssistant = await repository.get<ConversationMessage>("conversationMessages", assistant.id);
          let terminalAssistant: ConversationMessage | null = currentAssistant
            && ["failed", "cancelled"].includes(currentAssistant.status)
            ? currentAssistant
            : null;
          if (
            currentAssistant
            && !durableCompletion
            && !hasDurableCandidateArtifact
            && ["pending", "streaming"].includes(currentAssistant.status)
          ) {
            terminalAssistant = await conversation.updateMessageStatus({
              projectId,
              sessionId: input.sessionId,
              messageId: currentAssistant.id,
              expectedRevision: currentAssistant.revision,
              status: input.signal.aborted ? "cancelled" : "failed",
              content: `${friendlyError.title}。${friendlyError.message}`,
            }).catch(() => null);
          }
          if (terminalAssistant) {
            projectMessageIntoActiveSession(input.sessionId, terminalAssistant);
          }
          let terminalInvocation: ConversationToolInvocation | null = durableInvocation
            && ["failed", "cancelled"].includes(durableInvocation.status)
            ? durableInvocation
            : null;
          if (
            durableInvocation
            && !hasDurableCandidateArtifact
            && ["pending", "running"].includes(durableInvocation.status)
          ) {
            terminalInvocation = await conversation.updateToolInvocationStatus({
              projectId,
              sessionId: input.sessionId,
              invocationId: durableInvocation.id,
              expectedRevision: durableInvocation.revision,
              status: input.signal.aborted ? "cancelled" : "failed",
              safeErrorCode: rpgLeafErrorCode(error),
              canonicalMutationCount: 0,
              safeProgress: safeContinuityFailures.length
                ? {
                    stage: "failed-quality",
                    percent: 100,
                    message: `連貫性安全檢查缺項：${safeContinuityFailures.join("、")}`,
                  }
                : undefined,
            }).catch(() => null);
          }
          if (terminalInvocation) {
            projectInvocationIntoActiveSession(input.sessionId, terminalInvocation);
          }
          throw error;
        }
      },
    );
  }

  async function settleRpgCandidateEvidence(artifact: ConversationArtifact) {
    if (!activeSession || artifact.sessionId !== activeSession.id) {
      throw Object.assign(new Error("目前對話尚未準備完成，不能補完候選收據。"), {
        code: "CONVERSATION_APPROVAL_SESSION_NOT_READY",
      });
    }
    const currentArtifact = await repository.get<ConversationArtifact>(
      "conversationArtifacts",
      artifact.id,
    );
    const candidate = currentArtifact ? parseRpgCandidate(currentArtifact) : null;
    if (
      !currentArtifact
      || currentArtifact.projectId !== projectId
      || currentArtifact.sessionId !== activeSession.id
      || currentArtifact.status !== "candidate"
      || !candidate
    ) {
      throw Object.assign(new Error("已保存的 RPG 候選不存在或已不是待核准狀態。"), {
        code: "RPG_EXTERNAL_DURABLE_ARTIFACT_INVALID",
      });
    }
    const assistantMessage = await repository.get<ConversationMessage>(
      "conversationMessages",
      currentArtifact.sourceMessageId,
    );
    const userMessage = assistantMessage?.parentMessageId
      ? await repository.get<ConversationMessage>(
          "conversationMessages",
          assistantMessage.parentMessageId,
        )
      : null;
    const choiceSourceMessage = userMessage?.sourceMessageId
      ? await repository.get<ConversationMessage>(
          "conversationMessages",
          userMessage.sourceMessageId,
        )
      : null;
    const parsedChoices = choiceSourceMessage
      ? parseRpgChoices(choiceSourceMessage.content)
      : null;
    const envelope = parsedChoices?.envelope ?? null;
    if (
      !assistantMessage
      || !userMessage
      || !choiceSourceMessage
      || !envelope
      || assistantMessage.projectId !== projectId
      || assistantMessage.sessionId !== activeSession.id
      || userMessage.projectId !== projectId
      || userMessage.sessionId !== activeSession.id
      || userMessage.sourceMessageId !== choiceSourceMessage.id
      || !rpgUserMessageMatchesChoice(userMessage, candidate.choice)
    ) {
      throw Object.assign(new Error("已保存的 RPG 候選缺少可驗證的原始選擇。"), {
        code: "RPG_EXTERNAL_DURABLE_ARTIFACT_INVALID",
      });
    }
    const controller = new AbortController();
    return executeRpgChoice({
      sessionId: activeSession.id,
      choice: candidate.choice,
      choicePlanCandidateId: envelope.plan.candidateId,
      choiceSourceMessageId: choiceSourceMessage.id,
      expectedChapterId: envelope.chapterId,
      expectedChapterRevision: envelope.chapterRevision,
      expectedStoryStateRevision: envelope.storyStateRevision,
      expectedContextRevisionDigest: envelope.contextRevisionDigest,
      userMessage,
      signal: controller.signal,
    });
  }

  async function chooseRpgOption(
    envelope: RpgChoiceEnvelope,
    sourceMessageId: string,
    key: "A" | "B" | "C",
  ) {
    if (!activeSession || busy || operationLockRef.current) return;
    const sessionId = activeSession.id;
    const choice = envelope.plan.choices.find((item) => item.key === key);
    if (!choice) return;
    retryActionRef.current = () => { void chooseRpgOption(envelope, sourceMessageId, key); };
    setRetryAvailable(true);
    setRetryLabel("重試");
    operationLockRef.current = true;
    const releaseLease = await acquireLease(projectId, sessionId);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({
        code: "CONVERSATION_OPERATION_ALREADY_RUNNING",
        message: "另一個分頁正在執行這個對話，請稍後再試。",
      });
      return;
    }
    const controller = new AbortController();
    const runId = runRef.current + 1;
    runRef.current = runId;
    abortRef.current = controller;
    setCancellable(true);
    setBusy(true);
    setSafeError(null);
    let optimisticUserMessage: ConversationMessage | null = null;
    try {
      await assertRpgChoiceEnvelopeBaselineCurrent(envelope, controller.signal);
      const turnState = await readRpgChoiceTurnState(sessionId, sourceMessageId, true);
      if (turnState.closed) {
        throw Object.assign(new Error("這組選項已經建立過回合。"), {
          code: "RPG_CHAT_TURN_ALREADY_CREATED",
        });
      }
      const existingUser = turnState.recoverableUser;
      if (existingUser && !rpgUserMessageMatchesChoice(existingUser, choice)) {
        throw Object.assign(new Error("這組選項已保存另一個選擇；為避免重複結算，只能恢復原回合。"), {
          code: "RPG_CHAT_TURN_CHOICE_CONFLICT",
        });
      }
      const hasDurableCandidate = Boolean(existingUser && turnState.artifacts.some((artifact) => (
        artifact.id === `conversation-rpg-artifact:${sessionId}:${existingUser.id}`
        && artifact.artifactType === "rpg"
        && artifact.status === "candidate"
      )));
      if (!hasDurableCandidate && blockUnsupportedExecutionSource()) return;
      const userMessage = existingUser ?? await conversation.appendMessage({
        projectId,
        sessionId,
        messageId: `conversation-rpg-choice:${sessionId}:${sourceMessageId}:${turnState.attempts.length + 1}`,
        role: "user",
        content: rpgChoiceUserContent(choice),
        status: "pending",
        parentMessageId: turnState.messages.at(-1)?.id ?? null,
        sourceMessageId,
      });
      optimisticUserMessage = userMessage;
      if (
        userMessage.projectId !== projectId
        || userMessage.sessionId !== sessionId
        || userMessage.role !== "user"
        || userMessage.sourceMessageId !== sourceMessageId
        || !rpgUserMessageMatchesChoice(userMessage, choice)
      ) {
        throw Object.assign(new Error("已保存的選擇與本次重試不一致；不會建立第二筆選擇。"), {
          code: "RPG_CHAT_TURN_CHOICE_CONFLICT",
        });
      }
      projectMessageIntoActiveSession(sessionId, userMessage);
      await executeRpgChoice({
        sessionId,
        choice,
        choicePlanCandidateId: envelope.plan.candidateId,
        choiceSourceMessageId: sourceMessageId,
        expectedChapterId: envelope.chapterId,
        expectedChapterRevision: envelope.chapterRevision,
        expectedStoryStateRevision: envelope.storyStateRevision,
        expectedContextRevisionDigest: envelope.contextRevisionDigest,
        userMessage,
        signal: controller.signal,
      });
      await loadWorkspace(sessionId);
    } catch (error) {
      if (rpgErrorCode(error) === "RPG_CHAT_CHOICES_STALE") {
        let staleUserMessage = optimisticUserMessage
          ? await repository.get<ConversationMessage>(
              "conversationMessages",
              optimisticUserMessage.id,
            ).catch(() => null)
          : null;
        if (!staleUserMessage) {
          staleUserMessage = (await readRpgChoiceTurnState(
            sessionId,
            sourceMessageId,
            false,
          ).catch(() => null))?.recoverableUser ?? null;
        }
        try {
          await abandonStaleRpgChoiceCard({
            sessionId,
            choiceSourceMessageId: sourceMessageId,
            message: staleUserMessage,
          });
        } catch (abandonmentError) {
          setRetryLabel("重試封存失效選項");
          setSafeError({
            code: rpgErrorCode(abandonmentError),
            message: "失效選項尚未安全封存；系統已停止，不會重試舊分支。請再按一次重試。",
          });
          return;
        }
        retryActionRef.current = () => { void recoverRpgChoices(); };
        setRetryAvailable(true);
        setRetryLabel("重新建立三選一");
      }
      const safeFailure = safeConversationRpgFailureDiagnostics({
        leafCode: rpgLeafErrorCode(error),
        continuityFailures: rpgSafeContinuityFailures(error),
      });
      setSafeError({
        code: rpgErrorCode(error),
        message: rpgErrorMessage(error),
        ...(safeFailure ?? {}),
      });
    } finally {
      operationLockRef.current = false;
      releaseLease();
      setCancellable(false);
      if (runRef.current === runId) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  async function recoverRpgChoices() {
    if (!activeSession) {
      setSafeError({
        code: "RPG_NEXT_CHOICES_RECOVERY_SESSION_NOT_READY",
        message: "目前故事對話尚未準備完成，請稍後再按一次重新建立三選一。",
      });
      return;
    }
    if (blockUnsupportedExecutionSource()) return;
    if (busy || operationLockRef.current) {
      retryActionRef.current = () => { void recoverRpgChoices(); };
      setRetryAvailable(true);
      setRetryLabel("重新建立三選一");
      setSafeError({
        code: "CONVERSATION_OPERATION_ALREADY_RUNNING",
        message: "上一個故事操作尚未完成；上一回合 Canon 已保留，請稍後重新建立三選一。",
      });
      return;
    }

    const sessionId = activeSession.id;
    retryActionRef.current = () => { void recoverRpgChoices(); };
    setRetryAvailable(true);
    setRetryLabel("重新建立三選一");
    operationLockRef.current = true;
    const releaseLease = await acquireLease(projectId, sessionId);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({
        code: "CONVERSATION_OPERATION_ALREADY_RUNNING",
        message: "另一個分頁正在處理這個故事，請稍後再重新建立三選一。",
      });
      return;
    }

    const controller = new AbortController();
    const runId = runRef.current + 1;
    runRef.current = runId;
    abortRef.current = controller;
    setCancellable(true);
    setBusy(true);
    setSafeError(null);
    try {
      const [loadedMessages, loadedArtifacts, loadedInvocations, currentProject] = await Promise.all([
        conversation.listMessages(projectId, sessionId),
        conversation.listArtifacts(projectId, sessionId),
        conversation.listToolInvocations(projectId, sessionId),
        repository.get<NovelProject>("projects", projectId),
      ]);
      let sessionMessages = loadedMessages;
      let sessionArtifacts = loadedArtifacts;
      let sessionInvocations = loadedInvocations;
      const interruptedChoiceInvocations = sessionInvocations.filter((invocation) => (
        invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.rpgChoicePlan
        && ["pending", "running"].includes(invocation.status)
      ));
      if (interruptedChoiceInvocations.length) {
        await Promise.all(interruptedChoiceInvocations.map((invocation) => (
          conversation.updateToolInvocationStatus({
            projectId,
            sessionId,
            invocationId: invocation.id,
            expectedRevision: invocation.revision,
            status: "failed",
            safeErrorCode: "CONVERSATION_RELOAD_INTERRUPTED",
            canonicalMutationCount: 0,
            safeProgress: {
              stage: "interrupted",
              percent: 0,
              message: "上一次三選一規劃在完成前中斷；可安全重建。",
            },
          }).catch(() => invocation)
        )));
        const interruptedChoiceMessageIds = new Set(interruptedChoiceInvocations
          .map((invocation) => invocation.messageId));
        await Promise.all(sessionMessages
          .filter((message) => (
            interruptedChoiceMessageIds.has(message.id)
            && ["pending", "streaming"].includes(message.status)
          ))
          .map((message) => conversation.updateMessageStatus({
            projectId,
            sessionId,
            messageId: message.id,
            expectedRevision: message.revision,
            status: "cancelled",
            content: "上一次三選一規劃在完成前中斷；上一回合 Canon 已保留。",
          }).catch(() => message)));
        [sessionMessages, sessionArtifacts, sessionInvocations] = await Promise.all([
          conversation.listMessages(projectId, sessionId),
          conversation.listArtifacts(projectId, sessionId),
          conversation.listToolInvocations(projectId, sessionId),
        ]);
      }
      const currentStoryState = currentProject
        ? await repository.get<StoryState>("storyStates", currentProject.storyStateId)
        : null;
      const currentChapterId = currentProject?.activeChapterId ?? activeSession.activeChapterId;
      const currentChapter = currentChapterId
        ? await repository.get<Chapter>("chapters", currentChapterId)
        : null;
      const recoveryTarget = findRpgChoiceRecoveryTarget(
        sessionMessages,
        sessionArtifacts,
        {
          chapter: currentChapter,
          storyState: currentStoryState,
        },
        sessionInvocations,
      );
      if (!recoveryTarget) {
        retryActionRef.current = null;
        setRetryAvailable(false);
        setProgress("下一組三選一已存在，或目前仍有故事候選等待你採用；已重新整理對話。");
        await loadWorkspace(sessionId);
        return;
      }

      // A visibly stale card is not safe to replace until the original card
      // has a durable terminal marker.  Otherwise the replacement can render
      // beside an older A/B/C card that is still clickable after reload.
      if (recoveryTarget.reason === "stale_choice_card") {
        if (!recoveryTarget.choiceCardMessageId) {
          throw new Error("RPG_STALE_CHOICE_RECOVERY_SOURCE_MISSING");
        }
        await abandonStaleRpgChoiceCard({
          sessionId,
          choiceSourceMessageId: recoveryTarget.choiceCardMessageId,
          message: null,
        });
      }

      // The conversation artifact and Canon can commit atomically before a
      // tab closes or the ClosedAgentOS approval batch reaches its own state
      // store. Finish that replay-safe settlement before exposing a new turn;
      // this callback can only replay the already-journaled Canon operation.
      if (recoveryTarget.sourceArtifactId) {
        const { settleApprovedRpgTurnClosedAgent } = await import("@/lib/novel-ai/web/rpg-approval-settlement");
        await settleApprovedRpgTurnClosedAgent({
          repository,
          projectId,
          sessionId,
          artifactId: recoveryTarget.sourceArtifactId,
        });
      }

      const orphanChoicePlaceholders = sessionMessages.filter((message) => (
        message.role === "assistant"
        && message.parentMessageId === recoveryTarget.parentMessageId
        && ["pending", "streaming"].includes(message.status)
      ));
      if (orphanChoicePlaceholders.length) {
        await Promise.all(orphanChoicePlaceholders.map((message) => (
          conversation.updateMessageStatus({
            projectId,
            sessionId,
            messageId: message.id,
            expectedRevision: message.revision,
            status: "cancelled",
            content: "上一次三選一規劃在完成前中斷；上一回合 Canon 已保留。",
          }).catch(() => message)
        )));
      }

      setProgress(recoveryTarget.reason === "stale_choice_card"
        ? "舊選擇卡已封存；正在依目前人物、世界與章節版本重新建立三選一。"
        : "上一回合 Canon 已保留；正在安全地重新建立下一組三選一，不會重複寫入正文或數值。");
      await createRpgChoicesMessage({
        sessionId,
        parentMessageId: recoveryTarget.parentMessageId,
        signal: controller.signal,
      });
      retryActionRef.current = null;
      setRetryAvailable(false);
      setProgress("下一組 A／B／C 已建立；上一回合 Canon 未重複寫入。");
      await loadWorkspace(sessionId);
    } catch {
      await loadWorkspace(sessionId).catch(() => undefined);
      retryActionRef.current = () => { void recoverRpgChoices(); };
      setRetryAvailable(true);
      setRetryLabel("重新建立三選一");
      setSafeError({
        code: "RPG_NEXT_CHOICES_RECOVERY_FAILED",
        message: controller.signal.aborted
          ? "已停止建立下一組三選一；既有故事與封存記錄仍完整保留，可再次重試。"
          : "既有故事與失效選項的封存記錄均已保留，只有新的三選一尚未完成；請重新建立，不會重複寫入 Canon。",
      });
    } finally {
      operationLockRef.current = false;
      releaseLease();
      setCancellable(false);
      if (runRef.current === runId) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  return {
    createRpgChoicesMessage,
    executeRpgChoice,
    settleRpgCandidateEvidence,
    chooseRpgOption,
    abandonStaleRpgChoiceCard,
    recoverRpgChoices,
    requestRpgChoiceFallback,
    rpgChoicePlanning,
  };
}

export function useConversationRpg({
  message,
  messages,
  artifactsByMessage,
  invocations,
}: {
  message: ConversationMessage;
  messages: ConversationMessage[];
  artifactsByMessage: Map<string, ConversationArtifact[]>;
  invocations: ConversationToolInvocation[];
}) {
  return useMemo(() => {
    const parsed = parseRpgChoices(message.content);
    if (!parsed) return {
      parsed: null,
      consumed: false,
      abandoned: false,
      closed: false,
      closedReviewRequired: false,
    };
    const artifacts = [...artifactsByMessage.values()].flat();
    const state = inspectRpgChoiceTurn(messages, artifacts, message.id, invocations);
    return {
      parsed,
      consumed: state.consumed,
      abandoned: state.abandoned,
      closed: state.closed,
      closedReviewRequired: state.closedReviewRequired,
    };
  }, [artifactsByMessage, invocations, message, messages]);
}
