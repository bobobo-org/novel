"use client";

import { useCallback, type MutableRefObject } from "react";
import { flushSync } from "react-dom";
import type {
  ConversationClosedAgentCacheOriginProof,
  ConversationExecutionReceipt,
  ExternalAttemptProvenance,
  ConversationMessage,
  ConversationToolInvocation,
} from "@/lib/novel-ai/domain";
import type { NovelRepository } from "@/lib/novel-ai/repository";
import { conversationContentDigest } from "@/lib/novel-ai/conversation/approval-transaction";
import type { ConversationRepositoryService } from "@/lib/novel-ai/conversation/repository";
import { assertConversationPlannerToolAllowed } from "@/lib/novel-ai/conversation/tool-registry";

export function createConversationRequestCompletion(input: {
  runId: number;
  runRef: MutableRefObject<number>;
  operationLockRef: MutableRefObject<boolean>;
  abortRef: MutableRefObject<AbortController | null>;
  releaseLease: () => void;
  setCancellable: (value: boolean) => void;
  setBusy: (value: boolean) => void;
  projectMessage: (message: ConversationMessage) => boolean;
}) {
  let released = false;
  let completedMessage: ConversationMessage | null = null;
  const release = () => {
    if (released) return;
    released = true;
    input.operationLockRef.current = false;
    input.releaseLease();
    input.setCancellable(false);
    if (input.runRef.current === input.runId) {
      input.abortRef.current = null;
      input.setBusy(false);
    }
  };
  return {
    capture: (message: ConversationMessage) => { completedMessage = message; },
    revealAndRelease: () => flushSync(() => {
      if (completedMessage) input.projectMessage(completedMessage);
      release();
    }),
    release,
  };
}

export async function acquireConversationLease(projectId: string, sessionId: string) {
  if (typeof navigator === "undefined" || !navigator.locks) return () => undefined;
  const lockName = `novel:conversation-operation:${projectId}:${sessionId}`;
  return new Promise<(() => void) | null>((resolve) => {
    let resolved = false;
    void navigator.locks.request(
      lockName,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolved = true;
          resolve(null);
          return;
        }
        await new Promise<void>((release) => {
          let released = false;
          resolved = true;
          resolve(() => {
            if (released) return;
            released = true;
            release();
          });
        });
      },
    ).catch(() => {
      if (!resolved) resolve(null);
    });
  });
}

export function toExecutionReceipt(input: {
  taskId: string;
  modelId: string | null;
  modelDigest: string | null;
  contextDigest: string;
  outputDigest: string | null;
  externalRequest: boolean;
  dataLeftDevice: boolean;
  externalAttempt?: ExternalAttemptProvenance;
  receipt?: {
    startedAt?: string;
    completedAt?: string;
    browserComputeReceiptId?: string;
    browserFabricReceiptId?: string;
  } | null;
  closedAgentProof?: {
    schemaVersion: "closed-agent-os-v2";
    backendId: "browser-ai" | "local-ollama" | "private-ai-hub";
    normalizationReceiptId: string;
    traditionalChineseNormalizerVersion: string;
    cacheOrigin?: ConversationClosedAgentCacheOriginProof;
  } | null;
}): ConversationExecutionReceipt {
  const started = input.receipt?.startedAt ? Date.parse(input.receipt.startedAt) : Number.NaN;
  const completed = input.receipt?.completedAt ? Date.parse(input.receipt.completedAt) : Number.NaN;
  return {
    receiptId: input.receipt?.browserComputeReceiptId
      ?? input.receipt?.browserFabricReceiptId
      ?? `conversation-receipt:${input.taskId}`,
    modelId: input.modelId,
    modelDigest: input.modelDigest,
    providerRunId: input.closedAgentProof?.cacheOrigin ? null : input.taskId,
    contextDigest: input.contextDigest,
    outputDigest: input.outputDigest,
    externalRequest: input.externalRequest,
    dataLeftDevice: input.dataLeftDevice,
    ...(input.externalAttempt ? { externalAttempt: structuredClone(input.externalAttempt) } : {}),
    latencyMs: Number.isFinite(started) && Number.isFinite(completed)
      ? Math.max(0, completed - started)
      : null,
    ...(input.closedAgentProof ? {
      closedAgentSchemaVersion: input.closedAgentProof.schemaVersion,
      closedAgentBackendId: input.closedAgentProof.backendId,
      normalizationReceiptId: input.closedAgentProof.normalizationReceiptId,
      traditionalChineseNormalizerVersion:
        input.closedAgentProof.traditionalChineseNormalizerVersion,
      ...(input.closedAgentProof.cacheOrigin ? {
        closedAgentCacheOrigin: input.closedAgentProof.cacheOrigin,
      } : {}),
    } : {}),
  };
}

export type DeterministicConversationToolInput<T> = {
  sessionId: string;
  parentMessageId: string | null;
  sourceMessageId?: string | null;
  messageRole?: "assistant" | "tool";
  idPrefix: string;
  toolId: string;
  taskType: string;
  inputDigest: string;
  contextDigest: string;
  actualExecutor: string;
  modelId?: string | null;
  modelDigest?: string | null;
  runningMessage: string;
  completedMessage: string;
  signal: AbortSignal;
  execute: () => Promise<{ result: T; assistantContent: string; receiptOutput?: string }>;
};

export type DeterministicConversationToolRunner = <T>(
  input: DeterministicConversationToolInput<T>,
) => Promise<{
  result: T;
  assistantContent: string;
  receiptOutput?: string;
  message: ConversationMessage;
  invocation: ConversationToolInvocation;
}>;

function operationErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "CONVERSATION_OPERATION_FAILED");
  }
  if ((error as { name?: string })?.name === "AbortError") return "CONVERSATION_CANCELLED";
  return "CONVERSATION_OPERATION_FAILED";
}

export function useConversationOperationController({
  projectId,
  repository,
  conversation,
}: {
  projectId: string;
  repository: NovelRepository;
  conversation: ConversationRepositoryService;
}) {
  const runDeterministicConversationTool = useCallback(async <T,>(
    input: DeterministicConversationToolInput<T>,
  ) => {
    assertConversationPlannerToolAllowed(input.toolId);
    const attemptId = crypto.randomUUID();
    let message: ConversationMessage | null = null;
    let invocation: ConversationToolInvocation | null = null;
    try {
      message = await conversation.appendMessage({
        projectId,
        sessionId: input.sessionId,
        messageId: `${input.idPrefix}:message:${attemptId}`,
        role: input.messageRole ?? "assistant",
        content: "",
        status: "streaming",
        parentMessageId: input.parentMessageId,
        sourceMessageId: input.sourceMessageId ?? null,
      });
      const taskId = `${input.idPrefix}:task:${attemptId}`;
      invocation = await conversation.saveToolInvocation({
        projectId,
        sessionId: input.sessionId,
        messageId: message.id,
        invocationId: `${input.idPrefix}:invocation:${attemptId}`,
        taskId,
        toolId: input.toolId,
        taskType: input.taskType,
        inputDigest: input.inputDigest,
        contextDigest: input.contextDigest,
        status: "running",
        actualExecutor: input.actualExecutor,
        modelId: input.modelId ?? null,
        modelDigest: input.modelDigest ?? null,
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "running", percent: 1, message: input.runningMessage },
      });
      if (input.signal.aborted) {
        throw Object.assign(new Error("Conversation operation cancelled."), {
          code: "CONVERSATION_CANCELLED",
        });
      }
      const executed = await input.execute();
      const outputDigest = await conversationContentDigest(
        executed.receiptOutput ?? executed.assistantContent,
      );
      invocation = await conversation.updateToolInvocationStatus({
        projectId,
        sessionId: input.sessionId,
        invocationId: invocation.id,
        expectedRevision: invocation.revision,
        status: "completed",
        actualExecutor: input.actualExecutor,
        modelId: input.modelId ?? null,
        modelDigest: input.modelDigest ?? null,
        executionReceipt: toExecutionReceipt({
          taskId: invocation.taskId,
          modelId: input.modelId ?? null,
          modelDigest: input.modelDigest ?? null,
          contextDigest: invocation.contextDigest,
          outputDigest,
          externalRequest: false,
          dataLeftDevice: false,
        }),
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "completed", percent: 100, message: input.completedMessage },
      });
      const currentMessage = await repository.get<ConversationMessage>("conversationMessages", message.id);
      if (!currentMessage) throw new Error("CONVERSATION_MESSAGE_MISSING");
      message = await conversation.updateMessageStatus({
        projectId,
        sessionId: input.sessionId,
        messageId: currentMessage.id,
        expectedRevision: currentMessage.revision,
        status: "completed",
        content: executed.assistantContent,
        toolInvocationIds: currentMessage.toolInvocationIds,
      });
      return { ...executed, message, invocation };
    } catch (error) {
      const status = input.signal.aborted ? "cancelled" as const : "failed" as const;
      if (message) {
        const currentMessage = await repository.get<ConversationMessage>("conversationMessages", message.id);
        if (currentMessage && ["pending", "streaming"].includes(currentMessage.status)) {
          await conversation.updateMessageStatus({
            projectId,
            sessionId: input.sessionId,
            messageId: currentMessage.id,
            expectedRevision: currentMessage.revision,
            status,
            content: `本機工具未完成：${operationErrorCode(error)}。Canon 維持原狀。`,
          }).catch(() => undefined);
        }
      }
      if (invocation) {
        const currentInvocation = await repository.get<ConversationToolInvocation>(
          "conversationToolInvocations",
          invocation.id,
        );
        if (currentInvocation && ["pending", "running"].includes(currentInvocation.status)) {
          await conversation.updateToolInvocationStatus({
            projectId,
            sessionId: input.sessionId,
            invocationId: currentInvocation.id,
            expectedRevision: currentInvocation.revision,
            status,
            safeErrorCode: operationErrorCode(error),
            canonicalMutationCount: 0,
          }).catch(() => undefined);
        }
      }
      throw error;
    }
  }, [conversation, projectId, repository]);

  return { runDeterministicConversationTool };
}
