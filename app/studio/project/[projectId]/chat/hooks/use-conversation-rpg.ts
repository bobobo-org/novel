"use client";

import { useMemo, useRef, useState, type MutableRefObject } from "react";
import type { ClosedAIProgressEvent } from "@/lib/novel-ai/closed-agent-os";
import type {
  ConversationArtifact,
  ConversationMessage,
  ConversationSession,
  ConversationToolInvocation,
} from "@/lib/novel-ai/domain";
import type { NovelRepository } from "@/lib/novel-ai/repository";
import type { SovereignLearningRepository } from "@/lib/novel-ai/sovereign-learning";
import { conversationContentDigest } from "@/lib/novel-ai/conversation/approval-transaction";
import type { ConversationRepositoryService } from "@/lib/novel-ai/conversation/repository";
import { CONVERSATION_LOCAL_TOOL_IDS } from "@/lib/novel-ai/conversation/tool-registry";
import { rejectStudioClosedAgentCandidate } from "@/lib/novel-ai/web/closed-agent-os-service";
import {
  buildRpgRuleChoicePlan,
  buildRpgChatCustomAction,
  generateRpgChatTurnCandidate,
  loadLearningAwareRpgChatSnapshot,
  planRpgChatChoices,
  type RpgChatChoicePlan,
} from "@/lib/novel-ai/web/rpg-chat-turn";
import { parseRpgChoices, serializeRpgChoices } from "../components/conversation-presentation";
import type { DrawerPayload, RpgChoiceEnvelope } from "../components/conversation-types";
import { toExecutionReceipt } from "./use-conversation-operation";
import { friendlyConversationExecutionError } from "../components/execution-trace-model";

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

export function useConversationRpgController({
  projectId,
  repository,
  learningRepository,
  ensureSharedLearningReady,
  conversation,
  activeSession,
  busy,
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
}: {
  projectId: string;
  repository: NovelRepository;
  learningRepository: SovereignLearningRepository;
  ensureSharedLearningReady: (signal?: AbortSignal) => Promise<unknown>;
  conversation: ConversationRepositoryService;
  activeSession: ConversationSession | null;
  busy: boolean;
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
}) {
  const rpgTurnLocksRef = useRef(new Set<string>());
  const rpgChoiceFallbackRequestRef = useRef<(() => void) | null>(null);
  const [rpgChoicePlanning, setRpgChoicePlanning] = useState(false);

  const loadSnapshot = (signal?: AbortSignal) => loadLearningAwareRpgChatSnapshot({
    repository,
    projectId,
    learningRepository,
    ensureSharedLearningReady,
    signal,
  });

  async function createRpgChoicesMessage(input: {
    sessionId: string;
    parentMessageId: string;
    signal: AbortSignal;
  }) {
    const placeholder = await conversation.appendMessage({
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
    let invocation = await conversation.saveToolInvocation({
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
    try {
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
          plan = await buildRpgRuleChoicePlan({
            snapshot,
            fallbackReason: "USER_REQUESTED_RULE_FALLBACK",
          });
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
        plan,
      };
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
      await conversation.updateMessageStatus({
        projectId,
        sessionId: input.sessionId,
        messageId: updated.id,
        expectedRevision: updated.revision,
        status: "completed",
        content: serializeRpgChoices(envelope),
        candidateIds: [plan.candidateId],
        toolInvocationIds: updated.toolInvocationIds,
      });
      return { placeholder, plan, invocation };
    } catch (error) {
      const friendlyError = friendlyConversationExecutionError(
        rpgErrorCode(error),
        rpgErrorMessage(error),
      );
      const currentMessage = await repository.get<ConversationMessage>("conversationMessages", placeholder.id);
      if (currentMessage) {
        await conversation.updateMessageStatus({
          projectId,
          sessionId: input.sessionId,
          messageId: currentMessage.id,
          expectedRevision: currentMessage.revision,
          status: input.signal.aborted ? "cancelled" : "failed",
          content: `${friendlyError.title}。${friendlyError.message}`,
        }).catch(() => undefined);
      }
      await conversation.updateToolInvocationStatus({
        projectId,
        sessionId: input.sessionId,
        invocationId: invocation.id,
        expectedRevision: invocation.revision,
        status: input.signal.aborted ? "cancelled" : "failed",
        safeErrorCode: rpgErrorCode(error),
        canonicalMutationCount: 0,
      }).catch(() => undefined);
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
        ) {
          throw Object.assign(new Error("作品狀態已改變，請重新產生本回合選項。"), {
            code: "RPG_CHAT_CHOICES_STALE",
          });
        }
        const sessionMessages = await conversation.listMessages(projectId, input.sessionId);
        const sessionArtifacts = await conversation.listArtifacts(projectId, input.sessionId);
        const choiceAttempts = sessionMessages.filter((message) =>
          message.role === "user" && message.sourceMessageId === input.choiceSourceMessageId);
        const existingChoiceMessage = choiceAttempts.find((attempt) => {
          if (attempt.id === input.userMessage?.id) return false;
          const response = sessionMessages.filter((message) =>
            message.role === "assistant" && message.parentMessageId === attempt.id).at(-1);
          if (!response || ["pending", "streaming"].includes(response.status)) return true;
          if (["failed", "cancelled"].includes(response.status)) return false;
          const responseArtifacts = sessionArtifacts.filter((artifact) =>
            artifact.sourceMessageId === response.id && artifact.artifactType === "rpg");
          return responseArtifacts.some((artifact) => ["candidate", "approved"].includes(artifact.status));
        });
        if (existingChoiceMessage) {
          throw Object.assign(new Error("這張故事選擇卡已經建立過回合。"), {
            code: "RPG_CHAT_TURN_ALREADY_CREATED",
          });
        }
        const userMessage = input.userMessage ?? await (async () => {
          const last = sessionMessages.at(-1) ?? null;
          const attemptNumber = choiceAttempts.length + 1;
          return conversation.appendMessage({
            projectId,
            sessionId: input.sessionId,
            messageId: `conversation-rpg-choice:${input.sessionId}:${input.choiceSourceMessageId}:${attemptNumber}`,
            role: "user",
            content: input.choice.key === "custom"
              ? `自訂行動：${input.choice.title}`
              : `選擇 ${input.choice.key}｜${input.choice.title}`,
            parentMessageId: last?.id ?? null,
            sourceMessageId: input.choiceSourceMessageId,
          });
        })();
        await maybeUpdateRollingSummary(input.sessionId);
        const assistantId = `conversation-rpg-turn:${input.sessionId}:${userMessage.id}`;
        const existingAssistant = await repository.get<ConversationMessage>("conversationMessages", assistantId);
        if (
          existingAssistant
          && (
            existingAssistant.projectId !== projectId
            || existingAssistant.sessionId !== input.sessionId
            || existingAssistant.parentMessageId !== userMessage.id
            || !["failed", "cancelled"].includes(existingAssistant.status)
          )
        ) {
          throw Object.assign(new Error("RPG 回合重試來源不一致。"), {
            code: "RPG_CHAT_RETRY_SOURCE_MISMATCH",
          });
        }
        let assistant: ConversationMessage;
        let taskId: string;
        let invocation: ConversationToolInvocation;
        if (existingAssistant) {
          const sourceInvocation = (await conversation.listToolInvocations(projectId, input.sessionId))
            .filter((item) => item.messageId === existingAssistant.id)
            .at(-1);
          if (!sourceInvocation) throw new Error("CONVERSATION_RETRY_TOOL_SOURCE_MISSING");
          const retry = await conversation.prepareToolInvocationRetry({
            projectId,
            sessionId: input.sessionId,
            sourceMessageId: existingAssistant.id,
            sourceInvocationId: sourceInvocation.id,
            expectedMessageRevision: existingAssistant.revision,
            expectedInvocationRevision: sourceInvocation.revision,
          });
          assistant = retry.message;
          taskId = retry.taskId;
          invocation = retry.invocation;
        } else {
          assistant = await conversation.appendMessage({
            projectId,
            sessionId: input.sessionId,
            messageId: assistantId,
            role: "assistant",
            content: "",
            status: "streaming",
            parentMessageId: userMessage.id,
          });
          taskId = `conversation-rpg-turn-task:${input.sessionId}:${userMessage.id}`;
          invocation = await conversation.saveToolInvocation({
            projectId,
            sessionId: input.sessionId,
            messageId: assistant.id,
            invocationId: `conversation-rpg-invocation:${input.sessionId}:${userMessage.id}`,
            taskId,
            toolId: CONVERSATION_LOCAL_TOOL_IDS.rpgTurn,
            taskType: "chapter.continue",
            inputDigest: userMessage.contentDigest,
            contextDigest: userMessage.contentDigest,
            status: "running",
            canonicalMutationCount: 0,
          });
        }
        let invocationCompleted = false;
        try {
          const candidate = await generateRpgChatTurnCandidate({
            snapshot,
            choice: input.choice,
            signal: input.signal,
            onProgress: (event) => setProgress(rpgProgressLabel(event)),
          });
          if (input.signal.aborted) {
            throw Object.assign(new Error("RPG turn cancelled."), { code: "CONVERSATION_CANCELLED" });
          }
          const currentAssistant = await repository.get<ConversationMessage>("conversationMessages", assistant.id);
          if (!currentAssistant) throw new Error("CONVERSATION_MESSAGE_MISSING");
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
              externalRequest: false,
              dataLeftDevice: false,
              receipt: candidate.executionReceipt as Parameters<typeof toExecutionReceipt>[0]["receipt"],
            }),
            externalRequest: false,
            dataLeftDevice: false,
            canonicalMutationCount: 0,
            safeProgress: { stage: "candidate", percent: 100, message: "完整故事回合已成為候選" },
          });
          invocationCompleted = true;
          await conversation.updateMessageStatus({
            projectId,
            sessionId: input.sessionId,
            messageId: currentAssistant.id,
            expectedRevision: currentAssistant.revision,
            status: "completed",
            content: candidate.story,
            candidateIds: [candidate.candidateId],
            toolInvocationIds: currentAssistant.toolInvocationIds,
          });
          const artifact = await conversation.saveArtifact({
            projectId,
            sessionId: input.sessionId,
            sourceMessageId: assistant.id,
            artifactId: `conversation-rpg-artifact:${input.sessionId}:${assistant.id}`,
            artifactType: "rpg",
            targetStore: "chapters",
            targetRecordId: snapshot.chapter.id,
            sourceRevision: snapshot.chapter.revision,
            candidateContent: JSON.stringify({
              schemaVersion: "conversation-rpg-candidate-v1",
              candidate,
            }),
          });
          await rejectStudioClosedAgentCandidate(input.choicePlanCandidateId).catch(() => undefined);
          setDrawer({ kind: "artifact", artifactId: artifact.id });
          return artifact;
        } catch (error) {
          const friendlyError = friendlyConversationExecutionError(
            rpgErrorCode(error),
            rpgErrorMessage(error),
          );
          const currentAssistant = await repository.get<ConversationMessage>("conversationMessages", assistant.id);
          if (currentAssistant) {
            await conversation.updateMessageStatus({
              projectId,
              sessionId: input.sessionId,
              messageId: currentAssistant.id,
              expectedRevision: currentAssistant.revision,
              status: input.signal.aborted ? "cancelled" : "failed",
              content: `${friendlyError.title}。${friendlyError.message}`,
            }).catch(() => undefined);
          }
          if (!invocationCompleted) {
            await conversation.updateToolInvocationStatus({
              projectId,
              sessionId: input.sessionId,
              invocationId: invocation.id,
              expectedRevision: invocation.revision,
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
      ) {
        throw Object.assign(new Error("作品狀態已改變，請重新產生本回合選項。"), {
          code: "RPG_CHAT_CHOICES_STALE",
        });
      }
      const sessionMessages = await conversation.listMessages(projectId, sessionId);
      const sessionArtifacts = await conversation.listArtifacts(projectId, sessionId);
      const attempts = sessionMessages.filter((message) =>
        message.role === "user" && message.sourceMessageId === sourceMessageId);
      const responseFor = (attempt: ConversationMessage) => sessionMessages.filter((message) =>
        message.role === "assistant" && message.parentMessageId === attempt.id).at(-1) ?? null;
      const existingUser = attempts.find((attempt) => {
        const response = responseFor(attempt);
        return attempt.content.includes(choice.title)
          && Boolean(response && ["failed", "cancelled"].includes(response.status));
      }) ?? null;
      const consumed = attempts.some((attempt) => {
        const response = responseFor(attempt);
        if (!response || ["pending", "streaming"].includes(response.status)) return true;
        if (["failed", "cancelled"].includes(response.status)) return false;
        const responseArtifacts = sessionArtifacts.filter((artifact) =>
          artifact.sourceMessageId === response.id && artifact.artifactType === "rpg");
        return responseArtifacts.some((artifact) => ["candidate", "approved"].includes(artifact.status));
      });
      if (consumed) {
        throw Object.assign(new Error("這組選項已經建立過回合。"), {
          code: "RPG_CHAT_TURN_ALREADY_CREATED",
        });
      }
      await executeRpgChoice({
        sessionId,
        choice,
        choicePlanCandidateId: envelope.plan.candidateId,
        choiceSourceMessageId: sourceMessageId,
        expectedChapterId: envelope.chapterId,
        expectedChapterRevision: envelope.chapterRevision,
        expectedStoryStateRevision: envelope.storyStateRevision,
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

  return {
    createRpgChoicesMessage,
    executeRpgChoice,
    chooseRpgOption,
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
    const attempts = messages.filter((candidate) =>
      candidate.role === "user" && candidate.sourceMessageId === message.id);
    const consumed = attempts.some((attempt) => {
      const response = messages.filter((candidate) =>
        candidate.role === "assistant" && candidate.parentMessageId === attempt.id).at(-1);
      if (!response || ["pending", "streaming"].includes(response.status)) return true;
      if (["failed", "cancelled"].includes(response.status)) return false;
      return (artifactsByMessage.get(response.id) ?? []).some((artifact) =>
        artifact.artifactType === "rpg" && ["candidate", "approved"].includes(artifact.status));
    });
    return { parsed, consumed };
  }, [artifactsByMessage, message, messages]);
}
