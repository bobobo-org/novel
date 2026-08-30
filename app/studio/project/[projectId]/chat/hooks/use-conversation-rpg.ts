"use client";

import { useMemo, useRef, useState, type MutableRefObject } from "react";
import type { ClosedAIProgressEvent } from "@/lib/novel-ai/closed-agent-os";
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
import { sha256Hex, stableStringify } from "@/lib/novel-ai/closed-ai-cache";
import type { ConversationRepositoryService } from "@/lib/novel-ai/conversation/repository";
import { CONVERSATION_LOCAL_TOOL_IDS } from "@/lib/novel-ai/conversation/tool-registry";
import {
  isRpgLogicalTurnProviderTaskId,
} from "@/lib/novel-ai/conversation/rpg-logical-turn";
import { rejectStudioClosedAgentCandidate } from "@/lib/novel-ai/web/closed-agent-os-service";
import {
  buildRpgRuleChoicePlan,
  buildRpgChatCustomAction,
  generateRpgChatTurnCandidate,
  loadLearningAwareRpgChatSnapshot,
  normalizeRpgChoiceWireText,
  planRpgChatChoices,
  resolveRpgChatTurnLockedResult,
  rpgChoiceWireText,
  validateRpgStoryCandidateBeforePersistence,
  type RpgChatChoicePlan,
  type RpgChatTurnCandidate,
} from "@/lib/novel-ai/web/rpg-chat-turn";
import {
  generateRpgChatTurnCandidateWithExternalCascade,
  type ExternalRpgSingleRunIntent,
} from "@/lib/novel-ai/web/rpg-external-cascade";
import {
  verifyExternalRpgExecutionReceipt,
  verifyExternalRpgFailureLineage,
} from "@/lib/novel-ai/web/rpg-external-receipt";
import { verifyRpgAdultRuntimePolicyReceipt } from "@/lib/novel-ai/web/rpg-adult-runtime-receipt";
import type {
  ExternalAIProviderId,
  NovelAIExecutionMode,
} from "@/lib/novel-ai/providers/external/external-provider-contract";
import { settleApprovedRpgTurnClosedAgent } from "@/lib/novel-ai/web/rpg-approval-settlement";
import {
  parseRpgCandidate,
  parseRpgChoices,
  serializeRpgChoices,
} from "../components/conversation-presentation";
import type { DrawerPayload, RpgChoiceEnvelope } from "../components/conversation-types";
import { toExecutionReceipt } from "./use-conversation-operation";
import { friendlyConversationExecutionError } from "../components/execution-trace-model";
import { findRpgChoiceRecoveryTarget } from "../conversation-workspace-support";
import {
  assertRpgExecutionSourceCanGenerate,
  resolveRpgExecutionSourceBlock,
  type RpgExecutionSourceSnapshot,
} from "./rpg-execution-source-gate";

function rpgErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "CONVERSATION_RPG_FAILED");
  }
  if ((error as { name?: string })?.name === "AbortError") return "CONVERSATION_CANCELLED";
  return "CONVERSATION_RPG_FAILED";
}

function rpgErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "故事回合沒有完成；故事與數值均未寫入，原有內容維持不變。";
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

export function rpgChoiceUserContent(
  choice: RpgChatChoicePlan["choices"][number] | ReturnType<typeof buildRpgChatCustomAction>,
) {
  return choice.key === "custom"
    ? `自訂行動：${choice.title}`
    : rpgChoiceWireText(choice);
}

export function rpgUserMessageMatchesChoice(
  message: ConversationMessage,
  choice: RpgChatChoicePlan["choices"][number] | ReturnType<typeof buildRpgChatCustomAction>,
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
  return {
    attempts,
    responses,
    consumed: settledAttemptIds.size > 0,
    recoverableUser: [...attempts]
      .reverse()
      .find((attempt) => !finishedAttemptIds.has(attempt.id)) ?? null,
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
  setRetryAvailable: (value: boolean) => void;
  setRetryLabel: (value: string) => void;
  setCancellable: (value: boolean) => void;
  setBusy: (value: boolean) => void;
  setSafeError: (error: { code: string; message: string } | null) => void;
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

  const loadSnapshot = (signal?: AbortSignal) => loadLearningAwareRpgChatSnapshot({
    repository,
    projectId,
    learningRepository,
    ensureSharedLearningReady,
    signal,
  });

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
      ...inspectRpgChoiceTurn(sessionMessages, sessionArtifacts, choiceSourceMessageId),
      messages: sessionMessages,
      artifacts: sessionArtifacts,
      invocations: sessionInvocations,
    };
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
        plan = await planRpgChatChoices({
          snapshot,
          signal: planningController.signal,
          onProgress: (event) => setProgress(`${rpgProgressLabel(event)} · 最長等待 180 秒`),
        });
        if (userRequestedFallback) {
          if (plan.actualExecutor !== "deterministic-rule-fallback") {
            await rejectStudioClosedAgentCandidate(plan.candidateId).catch(() => undefined);
          }
          const fallbackPlan = await buildRpgRuleChoicePlan({
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
    choice: RpgChatChoicePlan["choices"][number] | ReturnType<typeof buildRpgChatCustomAction>;
    choicePlanCandidateId: string;
    choiceSourceMessageId: string;
    expectedChapterId: string;
    expectedChapterRevision: number;
    expectedStoryStateRevision: number;
    expectedContextRevisionDigest: string;
    userMessage?: ConversationMessage;
    signal: AbortSignal;
  }) {
    return withRpgTurnLock(
      `${input.sessionId}:${input.choiceSourceMessageId}:${input.choicePlanCandidateId}`,
      async () => {
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
        if (turnState.consumed) {
          throw Object.assign(new Error("這張故事選擇卡已經建立過回合。"), {
            code: "RPG_CHAT_TURN_ALREADY_CREATED",
          });
        }
        const recoverableUser = turnState.recoverableUser;
        if (
          recoverableUser
          && input.userMessage
          && recoverableUser.id !== input.userMessage.id
        ) {
          throw Object.assign(new Error("這張選擇卡已有一筆尚未完成的選擇；必須先恢復同一回合。"), {
            code: "RPG_CHAT_TURN_CHOICE_CONFLICT",
          });
        }
        const userMessage = input.userMessage ?? recoverableUser ?? await (async () => {
          const last = turnState.messages.at(-1) ?? null;
          const attemptNumber = turnState.attempts.length + 1;
          return conversation.appendMessage({
            projectId,
            sessionId: input.sessionId,
            messageId: `conversation-rpg-choice:${input.sessionId}:${input.choiceSourceMessageId}:${attemptNumber}`,
            role: "user",
            content: rpgChoiceUserContent(input.choice),
            parentMessageId: last?.id ?? null,
            sourceMessageId: input.choiceSourceMessageId,
          });
        })();
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
        await maybeUpdateRollingSummary(input.sessionId);
        turnState = await readRpgChoiceTurnState(
          input.sessionId,
          input.choiceSourceMessageId,
          true,
        );
        if (turnState.consumed) {
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
          const expectedResolution = resolveRpgChatTurnLockedResult(snapshot, input.choice);
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
          if (await sha256Hex(parsed.story.normalize("NFKC")) !== parsed.candidateDigest) {
            throw Object.assign(new Error("已保存的 RPG 候選摘要不一致；不會重新執行模型。"), {
              code: "RPG_EXTERNAL_DURABLE_ARTIFACT_INVALID",
            });
          }
          const recoveredStory = await validateRpgStoryCandidateBeforePersistence({
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
              setProgress("已依本次單次同意優先交由指定外來 AI 產生完整小說正文；失敗後才啟動閉端 AI 的獨立 180 秒，必要時再追加最多 60 秒隱藏後備複核。");
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
                resumeProviderTaskId: invocationCompleted
                  ? invocation.executionReceipt?.providerRunId ?? undefined
                  : undefined,
                signal: input.signal,
                onProgress: (event) => setProgress(`${rpgProgressLabel(event)} · 閉端正文階段最長 180 秒；若進入隱藏後備複核，最多另加 60 秒`),
                onCascadeProgress: setProgress,
              });
            } else {
              setProgress("閉端 AI 正在依你選定的 A／B／C 分支產生完整小說正文；正文階段完整等待 180 秒。若仍無有效正文，才會在背景建立三份不可見草稿，並追加最多 60 秒閉端複核；複核通過才會顯示候選。");
              candidate = await generateRpgChatTurnCandidate({
                snapshot,
                choice: input.choice,
                logicalTurnId: userMessage.id,
                resumeProviderTaskId: invocationCompleted
                  ? invocation.executionReceipt?.providerRunId ?? undefined
                  : undefined,
                signal: input.signal,
                onProgress: (event) => setProgress(`${rpgProgressLabel(event)} · 正文階段最長 180 秒；若進入隱藏後備複核，最多另加 60 秒`),
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
          await rejectStudioClosedAgentCandidate(input.choicePlanCandidateId).catch(() => undefined);
          setDrawer({ kind: "artifact", artifactId: artifact.id });
          return { artifact, message: completedMessage };
        } catch (error) {
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
          if (
            currentAssistant
            && !durableCompletion
            && !hasDurableCandidateArtifact
            && ["pending", "streaming"].includes(currentAssistant.status)
          ) {
            await conversation.updateMessageStatus({
              projectId,
              sessionId: input.sessionId,
              messageId: currentAssistant.id,
              expectedRevision: currentAssistant.revision,
              status: input.signal.aborted ? "cancelled" : "failed",
              content: `${friendlyError.title}。${friendlyError.message}`,
            }).catch(() => undefined);
          }
          if (
            durableInvocation
            && !hasDurableCandidateArtifact
            && ["pending", "running"].includes(durableInvocation.status)
          ) {
            await conversation.updateToolInvocationStatus({
              projectId,
              sessionId: input.sessionId,
              invocationId: durableInvocation.id,
              expectedRevision: durableInvocation.revision,
              status: input.signal.aborted ? "cancelled" : "failed",
              safeErrorCode: rpgErrorCode(error),
              canonicalMutationCount: 0,
            }).catch(() => undefined);
          }
          throw error;
        }
      },
    );
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
    try {
      const snapshot = await loadSnapshot(controller.signal);
      if (
        snapshot.chapter.id !== envelope.chapterId
        || snapshot.chapter.revision !== envelope.chapterRevision
        || snapshot.storyState.revision !== envelope.storyStateRevision
        || snapshot.contextRevisionDigest !== envelope.contextRevisionDigest
        || envelope.plan.contextRevisionDigest !== envelope.contextRevisionDigest
        || envelope.plan.contextRevisionGuard.digest !== envelope.contextRevisionDigest
      ) {
        throw Object.assign(new Error("作品狀態已改變，請重新產生本回合選項。"), {
          code: "RPG_CHAT_CHOICES_STALE",
        });
      }
      const turnState = await readRpgChoiceTurnState(sessionId, sourceMessageId, true);
      if (turnState.consumed) {
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
      await executeRpgChoice({
        sessionId,
        choice,
        choicePlanCandidateId: envelope.plan.candidateId,
        choiceSourceMessageId: sourceMessageId,
        expectedChapterId: envelope.chapterId,
        expectedChapterRevision: envelope.chapterRevision,
        expectedStoryStateRevision: envelope.storyStateRevision,
        expectedContextRevisionDigest: envelope.contextRevisionDigest,
        userMessage: existingUser ?? undefined,
        signal: controller.signal,
      });
      await loadWorkspace(sessionId);
    } catch (error) {
      setSafeError({ code: rpgErrorCode(error), message: rpgErrorMessage(error) });
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

      // The conversation artifact and Canon can commit atomically before a
      // tab closes or the ClosedAgentOS approval batch reaches its own state
      // store. Finish that replay-safe settlement before exposing a new turn;
      // this callback can only replay the already-journaled Canon operation.
      await settleApprovedRpgTurnClosedAgent({
        repository,
        projectId,
        sessionId,
        artifactId: recoveryTarget.sourceArtifactId,
      });

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

      setProgress("上一回合 Canon 已保留；正在安全地重新建立下一組三選一，不會重複寫入正文或數值。");
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
          ? "已停止建立下一組三選一；上一回合 Canon 仍完整保留，可再次重試。"
          : "上一回合已核准並完整保留，只有下一組三選一尚未完成；請重新建立，不會重複寫入 Canon。",
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
    chooseRpgOption,
    recoverRpgChoices,
    requestRpgChoiceFallback,
    rpgChoicePlanning,
  };
}

export function useConversationRpg({
  message,
  messages,
  artifactsByMessage,
}: {
  message: ConversationMessage;
  messages: ConversationMessage[];
  artifactsByMessage: Map<string, ConversationArtifact[]>;
}) {
  return useMemo(() => {
    const parsed = parseRpgChoices(message.content);
    if (!parsed) return { parsed: null, consumed: false };
    const artifacts = [...artifactsByMessage.values()].flat();
    const consumed = inspectRpgChoiceTurn(messages, artifacts, message.id).consumed;
    return { parsed, consumed };
  }, [artifactsByMessage, message, messages]);
}
