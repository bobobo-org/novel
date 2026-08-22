"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isCryptographicClosedAIModelDigest,
  type ClosedAIBackendId,
  type ClosedAgentCandidate,
} from "@/lib/novel-ai/closed-agent-os";
import type { ConversationToolInvocation } from "@/lib/novel-ai/domain";
import { conversationContentDigest } from "@/lib/novel-ai/conversation/approval-transaction";
import {
  buildConversationClosedAgentCacheOriginProof,
  hasValidConversationClosedAgentCacheOriginProof,
} from "@/lib/novel-ai/conversation/closed-agent-cache-origin-proof";
import { CONVERSATION_LOCAL_TOOL_IDS } from "@/lib/novel-ai/conversation/tool-registry";
import { stableStringify } from "@/lib/novel-ai/closed-ai-cache";
import type { PlatformTaskType } from "@/lib/novel-ai/router/platform-types";
import {
  getStudioClosedAgentOS,
  getStudioClosedAIBootstrapCoordinator,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import type {
  ClosedAiBootstrapProgress,
  ClosedAiBootstrapResult,
} from "@/lib/novel-ai/web/closed-ai-bootstrap-coordinator";

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export type ClosedAiSetupLifecycle =
  | "inspecting"
  | "idle"
  | "preparing"
  | "cancelled"
  | "failed"
  | "ready";

const CLOSED_REGENERATION_BACKENDS = new Set<ClosedAIBackendId>([
  "browser-ai",
  "local-ollama",
  "private-ai-hub",
]);
const NORMALIZATION_RECEIPT = /^traditional-chinese-integrity:[a-f0-9]{64}$/u;

function verifiedConversationRegenerationBackend(
  invocation: ConversationToolInvocation | null,
): ClosedAIBackendId | null {
  const receipt = invocation?.executionReceipt;
  const backend = receipt?.closedAgentBackendId;
  const cacheOrigin = receipt?.closedAgentCacheOrigin;
  const freshExecutionVerified = Boolean(
    backend
    && invocation?.actualExecutor === backend
    && receipt?.providerRunId === invocation.taskId
    && cacheOrigin === undefined,
  );
  const cachedExecutionVerified = Boolean(
    backend
    && invocation?.actualExecutor === "not_executed"
    && receipt?.providerRunId === null
    && hasValidConversationClosedAgentCacheOriginProof(cacheOrigin)
    && cacheOrigin?.originBackendId === backend
    && cacheOrigin?.originModelId === invocation.modelId
    && cacheOrigin?.originModelDigest === invocation.modelDigest
    && cacheOrigin?.originContentDigest === receipt?.outputDigest
    && cacheOrigin?.originNormalizationReceiptId === receipt?.normalizationReceiptId
    && cacheOrigin?.originNormalizerVersion
      === receipt?.traditionalChineseNormalizerVersion,
  );
  if (
    !invocation
    || invocation.status !== "completed"
    || !invocation.completedAt
    || !backend
    || !CLOSED_REGENERATION_BACKENDS.has(backend)
    || invocation.toolId !== CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan
    || (!freshExecutionVerified && !cachedExecutionVerified)
    || !invocation.modelId?.trim()
    || !isCryptographicClosedAIModelDigest(invocation.modelDigest)
    || invocation.externalRequest
    || invocation.dataLeftDevice
    || invocation.canonicalMutationCount !== 0
    || !receipt?.receiptId.trim()
    || receipt.modelId !== invocation.modelId
    || receipt.modelDigest !== invocation.modelDigest
    || receipt.contextDigest !== invocation.contextDigest
    || !isCryptographicClosedAIModelDigest(receipt.contextDigest)
    || !isCryptographicClosedAIModelDigest(receipt.outputDigest)
    || receipt.externalRequest
    || receipt.dataLeftDevice
    || receipt.closedAgentSchemaVersion !== "closed-agent-os-v2"
    || !NORMALIZATION_RECEIPT.test(receipt.normalizationReceiptId ?? "")
    || receipt.traditionalChineseNormalizerVersion
      !== "opencc-js-1.4.1-cn-to-tw-single-pass-v1"
  ) return null;
  return backend;
}

export function useClosedAiBootstrap(projectId: string) {
  const [closedAiSetup, setClosedAiSetup] = useState<ClosedAiBootstrapResult | null>(null);
  const [closedAiSetupProgress, setClosedAiSetupProgress] = useState<ClosedAiBootstrapProgress | null>(null);
  const [closedAiSetupBusy, setClosedAiSetupBusy] = useState(false);
  const [closedAiSetupError, setClosedAiSetupError] = useState<string | null>(null);
  const [closedAiSetupLifecycle, setClosedAiSetupLifecycle] = useState<ClosedAiSetupLifecycle>("inspecting");
  const setupAbortRef = useRef<AbortController | null>(null);

  const inspectAfterFailure = useCallback(async (
    controller: AbortController,
    error: unknown,
  ) => {
    if (controller.signal.aborted) return;
    setClosedAiSetupProgress(null);
    setClosedAiSetupError(safeErrorMessage(error));
    setClosedAiSetupLifecycle("failed");
    const inspected = await getStudioClosedAIBootstrapCoordinator().inspect({
      projectId,
      taskType: "chapter.continue",
      signal: controller.signal,
    }).catch(() => null);
    if (!controller.signal.aborted && inspected) setClosedAiSetup(inspected);
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    setupAbortRef.current = controller;
    const timer = window.setTimeout(() => {
      if (controller.signal.aborted) return;
      setClosedAiSetupBusy(true);
      setClosedAiSetupError(null);
      setClosedAiSetupLifecycle("inspecting");
      void getStudioClosedAIBootstrapCoordinator().bootstrap({
        projectId,
        taskType: "chapter.continue",
        signal: controller.signal,
        onProgress: (next) => {
          if (!controller.signal.aborted) setClosedAiSetupProgress(next);
        },
      }).then((result) => {
        if (!controller.signal.aborted) {
          setClosedAiSetup(result);
          setClosedAiSetupLifecycle(result.status === "ready" ? "ready" : "idle");
        }
      }).catch((error) => inspectAfterFailure(controller, error)).finally(() => {
        if (setupAbortRef.current === controller) {
          setupAbortRef.current = null;
          setClosedAiSetupBusy(false);
        }
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort("CONVERSATION_CLOSED_AI_BOOTSTRAP_UNMOUNTED");
      if (setupAbortRef.current === controller) setupAbortRef.current = null;
    };
  }, [inspectAfterFailure, projectId]);

  const prepareClosedAi = useCallback(async () => {
    if (closedAiSetupBusy || setupAbortRef.current) return;
    const controller = new AbortController();
    setupAbortRef.current = controller;
    setClosedAiSetupBusy(true);
    setClosedAiSetupError(null);
    setClosedAiSetupLifecycle("preparing");
    setClosedAiSetupProgress({
      step: "capability_detect",
      percent: 1,
      message: "正在啟動閉端 AI 自動協調器準備流程。",
    });
    try {
      const result = await getStudioClosedAIBootstrapCoordinator().prepareBrowserAi({
        projectId,
        taskType: "chapter.continue",
        userInitiated: true,
        signal: controller.signal,
        onProgress: (next) => {
          if (!controller.signal.aborted) setClosedAiSetupProgress(next);
        },
      });
      if (!controller.signal.aborted) {
        setClosedAiSetup(result);
        setClosedAiSetupLifecycle(result.status === "ready" ? "ready" : "idle");
        setClosedAiSetupProgress(result.status === "ready"
          ? {
              step: "router_register",
              percent: 100,
              message: "自動協調器已完成真實生成實測，可開始創作。",
            }
          : null);
      }
    } catch (error) {
      await inspectAfterFailure(controller, error);
    } finally {
      if (setupAbortRef.current === controller) {
        setupAbortRef.current = null;
        setClosedAiSetupBusy(false);
      }
    }
  }, [closedAiSetupBusy, inspectAfterFailure, projectId]);

  const cancelClosedAiSetup = useCallback(() => {
    setupAbortRef.current?.abort("CONVERSATION_CLOSED_AI_SETUP_CANCELLED");
    setupAbortRef.current = null;
    setClosedAiSetupBusy(false);
    setClosedAiSetupProgress(null);
    setClosedAiSetupError("已取消自動協調器準備；未完成的模型不會標記為可用。你可以稍後重試。");
    setClosedAiSetupLifecycle("cancelled");
  }, []);

  const resolveRegenerationBackend = useCallback(async (input: {
    sourceInvocation: ConversationToolInvocation | null;
    sourceCandidateIds: string[];
    sourceMessageContent: string;
    sourceMessageContentDigest: string;
    taskType: PlatformTaskType;
    signal: AbortSignal;
  }) => {
    const closedCandidateIds = input.sourceCandidateIds.filter((candidateId) => (
      candidateId.startsWith("closed-agent-candidate:")
    ));
    const sourceCandidateId = closedCandidateIds.length === 1
      ? closedCandidateIds[0]
      : null;
    const sourceBackend = verifiedConversationRegenerationBackend(
      input.sourceInvocation,
    );
    const invocation = input.sourceInvocation;
    if (!sourceBackend || !sourceCandidateId || !invocation) {
      throw Object.assign(new Error("The source candidate has no verified closed execution proof."), {
        code: "CONVERSATION_REGENERATION_SOURCE_PROOF_INVALID",
        externalFallback: false,
      });
    }
    const candidate = await getStudioClosedAgentOS().state.get<ClosedAgentCandidate>(
      sourceCandidateId,
    );
    const invocationReceipt = invocation.executionReceipt;
    const normalizedSourceMessageDigest = await conversationContentDigest(
      input.sourceMessageContent,
    );
    const normalizedCandidateDigest = candidate
      ? await conversationContentDigest(candidate.content)
      : null;
    const expectedCacheOriginProof = candidate
      ? await buildConversationClosedAgentCacheOriginProof(candidate)
      : undefined;
    const freshCandidateProof = Boolean(
      candidate?.actualExecutor === sourceBackend
      && candidate.cacheOrigin === null
      && candidate.executionReceipt?.proofState === "verified"
      && candidate.executionReceipt.taskId === invocation.taskId
      && candidate.executionReceipt.backendId === sourceBackend
      && candidate.executionReceipt.actualExecutor === sourceBackend
      && candidate.executionReceipt.modelId === invocation.modelId
      && candidate.executionReceipt.modelDigest === invocation.modelDigest
      && candidate.executionReceipt.contentDigest === invocationReceipt?.outputDigest
      && candidate.executionReceipt.contextDigest === invocation.contextDigest
      && candidate.executionReceipt.externalRequest === false
      && candidate.executionReceipt.dataLeftDevice === false,
    );
    const cachedCandidateProof = Boolean(
      candidate?.actualExecutor === "not_executed"
      && candidate.executionReceipt === null
      && candidate.cacheOrigin
      && candidate.cacheOrigin.originExecutionReceipt.backendId === sourceBackend
      && candidate.cacheOrigin.originExecutionReceipt.modelId === invocation.modelId
      && candidate.cacheOrigin.originExecutionReceipt.modelDigest === invocation.modelDigest
      && candidate.cacheOrigin.originExecutionReceipt.contentDigest
        === invocationReceipt?.outputDigest
      && candidate.cacheOrigin.normalizationReceiptId
        === candidate.traditionalChineseNormalization.receiptId
      && stableStringify(invocationReceipt?.closedAgentCacheOrigin)
        === stableStringify(expectedCacheOriginProof),
    );
    const candidateIntegrityVerified = candidate
      ? await getStudioClosedAgentOS().verifyCandidateIntegrity(candidate.id)
      : false;
    if (
      !candidate
      || !invocationReceipt
      || !candidateIntegrityVerified
      || candidate.schemaVersion !== "closed-agent-os-v2"
      || candidate.projectId !== projectId
      || (candidate.status !== "awaiting-approval" && candidate.status !== "rejected")
      || candidate.taskId !== invocation.taskId
      || candidate.backendId !== sourceBackend
      || candidate.modelId !== invocation.modelId
      || candidate.modelDigest !== invocation.modelDigest
      || candidate.contentDigest !== invocationReceipt.outputDigest
      || normalizedSourceMessageDigest !== input.sourceMessageContentDigest
      || normalizedCandidateDigest !== input.sourceMessageContentDigest
      || candidate.contextDigest !== invocation.contextDigest
      || candidate.traditionalChineseNormalization.receiptId
        !== invocationReceipt.normalizationReceiptId
      || candidate.traditionalChineseNormalization.normalizerVersion
        !== invocationReceipt.traditionalChineseNormalizerVersion
      || (!freshCandidateProof && !cachedCandidateProof)
      || candidate.externalRequest
      || candidate.dataLeftDevice
      || candidate.canonicalMutationCount !== 0
    ) {
      throw Object.assign(new Error("The source candidate identity does not match its execution receipt."), {
        code: "CONVERSATION_REGENERATION_SOURCE_PROOF_INVALID",
        externalFallback: false,
      });
    }
    const inspected = await getStudioClosedAIBootstrapCoordinator().inspect({
      projectId,
      taskType: input.taskType,
      signal: input.signal,
    });
    const sourceBackendStillReady = inspected.readiness.backends.some((backend) => (
      backend.id === sourceBackend && backend.generationVerified
    ));
    if (!sourceBackendStillReady) {
      throw Object.assign(new Error("原候選使用的閉端算力已不可用；請先在自動協調器設定完成一次生成實測。"), {
        code: "CONVERSATION_REGENERATION_CLOSED_BACKEND_NOT_READY",
        externalFallback: false,
      });
    }
    return {
      backendId: sourceBackend,
      candidateId: candidate.id,
      taskId: candidate.taskId,
      candidateDigest: candidate.contentDigest,
      regenerationAttempt: (candidate.regeneration?.regenerationAttempt ?? 0) + 1,
    };
  }, [projectId]);

  return {
    closedAiSetup,
    closedAiSetupProgress,
    closedAiSetupBusy,
    closedAiSetupError,
    closedAiSetupLifecycle,
    prepareClosedAi,
    cancelClosedAiSetup,
    resolveRegenerationBackend,
  };
}
