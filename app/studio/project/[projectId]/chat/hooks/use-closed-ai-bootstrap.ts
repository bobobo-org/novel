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
  getStudioClosedAIRuntimeCoordinator,
  prewarmStudioProjectAIState,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import { prewarmStudioInteractiveChoiceAI } from "@/lib/novel-ai/web/studio-closed-ai";
import { PASSWORDLESS_LOCAL_AI_ORIGINS } from "@/lib/novel-ai/providers/local-ollama/companion-release";
import type {
  ClosedAiBootstrapProgress,
  ClosedAiBootstrapResult,
} from "@/lib/novel-ai/web/closed-ai-bootstrap-coordinator";
import { raceClosedAiAutostartRoutes } from "@/lib/novel-ai/web/closed-ai-autostart-race";
import { isClosedAiTaskRoutable } from "../closed-ai-task-readiness";

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

export type ClosedAiStartupState =
  | "starting"
  | "ready"
  | "action_required"
  | "failed"
  | "timeout_fallback";

export function shouldAutostartStudioLocalAI(origin: string) {
  return PASSWORDLESS_LOCAL_AI_ORIGINS.includes(
    origin as (typeof PASSWORDLESS_LOCAL_AI_ORIGINS)[number],
  );
}

function closedAiAutostartErrorCode(error: unknown) {
  return String((error as { code?: unknown } | null)?.code ?? "");
}

const CLOSED_AI_AUTOSTART_TIMEOUT_CODES = new Set([
  "REQUEST_TIMEOUT",
  "OLLAMA_TIMEOUT",
]);
const CLOSED_AI_AUTOSTART_KNOWN_FAILURE_CODES = new Set([
  ...CLOSED_AI_AUTOSTART_TIMEOUT_CODES,
  "LOCAL_NETWORK_PERMISSION_DENIED",
  "OLLAMA_MODEL_NOT_FOUND",
  "LOCAL_PROVIDER_NOT_READY",
  "BRIDGE_PROCESS_UNREACHABLE",
]);

export function closedAiAutostartFailureState(
  error: unknown,
): Extract<ClosedAiStartupState, "failed" | "timeout_fallback"> {
  return CLOSED_AI_AUTOSTART_TIMEOUT_CODES.has(closedAiAutostartErrorCode(error))
    ? "timeout_fallback"
    : "failed";
}

export function closedAiAutostartFailureMessage(error: unknown) {
  const code = closedAiAutostartErrorCode(error);
  if (code === "LOCAL_NETWORK_PERMISSION_DENIED") {
    return "瀏覽器未允許這個正式網址存取本機網路；請允許本機網路存取後重試。";
  }
  if (CLOSED_AI_AUTOSTART_TIMEOUT_CODES.has(code)) {
    return "等待本機閉端 AI 連線已明確逾時；RPG 規則後備現在只會以明確標示的後備路徑待命，不會冒充閉端 AI 成功。網站無法自行啟動電腦上的 Ollama；若要產生並複核完整正文，請先啟動 Novel Local AI Companion 與 Ollama，再重試。";
  }
  if (code === "OLLAMA_MODEL_NOT_FOUND") {
    return "已找到本機橋接程式，但沒有可生成正文的 Ollama 模型。請先在本機完成模型安裝。";
  }
  if (code === "LOCAL_PROVIDER_NOT_READY") {
    return "已找到本機橋接程式，但版本或執行狀態尚未符合這個正式站；請更新並重新啟動 Novel Local AI Companion。";
  }
  if (code === "BRIDGE_PROCESS_UNREACHABLE") {
    return "找不到已啟動的本機閉端 AI 服務。一般網站無法自行啟動電腦上的 Ollama；請先啟動 Novel Local AI Companion 與 Ollama。";
  }
  return "閉端 AI 自動啟動未完成。請確認 Novel Local AI Companion 與 Ollama 已啟動，或改在此裝置明確準備 Browser AI。";
}

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
  const [closedAiStartupState, setClosedAiStartupState] = useState<ClosedAiStartupState>("starting");
  const setupAbortRef = useRef<AbortController | null>(null);

  const inspectAfterFailure = useCallback(async (
    controller: AbortController,
    error: unknown,
  ) => {
    if (controller.signal.aborted) return;
    setClosedAiSetupProgress(null);
    setClosedAiSetupError(CLOSED_AI_AUTOSTART_KNOWN_FAILURE_CODES.has(
      closedAiAutostartErrorCode(error),
    ) ? closedAiAutostartFailureMessage(error) : safeErrorMessage(error));
    setClosedAiSetupLifecycle("failed");
    setClosedAiStartupState(closedAiAutostartFailureState(error));
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
      setClosedAiStartupState("starting");
      setClosedAiSetupProgress({
        step: "capability_detect",
        percent: 1,
        message: "正在連接已啟動的本機閉端 AI，並核對此裝置可用的 Browser AI。",
      });
      const bootstrapCoordinator = getStudioClosedAIBootstrapCoordinator();
      const runtimeCoordinator = getStudioClosedAIRuntimeCoordinator();
      // Keep the bounded Local Bridge discovery alive across React Strict Mode's
      // mount -> unmount -> remount probe. The bridge client already owns a
      // 45-second timeout and de-duplicates this request; binding the shared
      // promise to the first mount's AbortSignal would poison the remount.
      const localConnection = shouldAutostartStudioLocalAI(window.location.origin)
        ? runtimeCoordinator.connectLocalAutomatically()
        : null;
      let autostartSettled = false;
      const browserBootstrap = bootstrapCoordinator.bootstrap({
        projectId,
        taskType: "chapter.continue",
        signal: controller.signal,
        onProgress: (next) => {
          if (!controller.signal.aborted && !autostartSettled) {
            setClosedAiSetupProgress(next);
          }
        },
      });
      void (async () => {
        const outcome = await raceClosedAiAutostartRoutes({
          browserBootstrap,
          localConnection,
          inspectAfterLocal: () => bootstrapCoordinator.inspect({
            projectId,
            taskType: "chapter.continue",
            signal: controller.signal,
          }),
          isRoutable: isClosedAiTaskRoutable,
          signal: controller.signal,
        });
        autostartSettled = true;
        if (!outcome || controller.signal.aborted) return;
        const inspected = outcome.result;
        if (!inspected) {
          throw outcome.error ?? new Error("閉端 AI 自動啟動沒有回傳可驗證狀態。");
        }
        if (controller.signal.aborted) return;
        const routable = isClosedAiTaskRoutable(inspected);
        setClosedAiSetup(inspected);
        const autostartFailed = Boolean(outcome.error);
        const autostartFailureState = autostartFailed
          ? closedAiAutostartFailureState(outcome.error)
          : "action_required";
        setClosedAiSetupLifecycle(routable ? "ready" : autostartFailed ? "failed" : "idle");
        setClosedAiStartupState(routable ? "ready" : autostartFailureState);
        setClosedAiSetupError(routable ? null : autostartFailed
          ? closedAiAutostartFailureMessage(outcome.error)
          : null);
        if (routable) {
          setClosedAiSetupProgress({
            step: "router_register",
            percent: 100,
            message: "閉端 AI 已連線並完成真實生成實測，可開始創作。",
          });
          void Promise.allSettled([
            prewarmStudioProjectAIState({
              projectId,
              taskTypes: ["chapter.abcChoices", "chapter.continue"],
              signal: controller.signal,
            }),
            prewarmStudioInteractiveChoiceAI(controller.signal),
          ]);
        } else {
          setClosedAiSetupProgress(null);
        }
      })().catch((error) => inspectAfterFailure(controller, error)).finally(() => {
        autostartSettled = true;
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
    const retryingLocal = closedAiStartupState === "failed"
      || closedAiStartupState === "timeout_fallback";
    const controller = new AbortController();
    setupAbortRef.current = controller;
    setClosedAiSetupBusy(true);
    setClosedAiSetupError(null);
    setClosedAiSetupLifecycle("preparing");
    setClosedAiStartupState("starting");
    setClosedAiSetupProgress({
      step: "capability_detect",
      percent: 1,
      message: "正在啟動閉端 AI 自動協調器準備流程。",
    });
    try {
      const bootstrapCoordinator = getStudioClosedAIBootstrapCoordinator();
      const retryLocalOnOfficialOrigin = retryingLocal
        && shouldAutostartStudioLocalAI(window.location.origin);
      const result = retryLocalOnOfficialOrigin
        ? await (async () => {
            setClosedAiSetupProgress({
              step: "capability_detect",
              percent: 10,
              message: "正在重新連線這台電腦上已啟動的 Novel Local AI Companion 與 Ollama。",
            });
            await getStudioClosedAIRuntimeCoordinator().connectLocalAutomatically(
              controller.signal,
            );
            const inspected = await bootstrapCoordinator.inspect({
              projectId,
              taskType: "chapter.continue",
              signal: controller.signal,
            });
            if (!isClosedAiTaskRoutable(inspected)) {
              throw Object.assign(new Error("本機閉端 AI 已連線，但仍未取得可生成正文的驗證路由。"), {
                code: "LOCAL_PROVIDER_NOT_READY",
              });
            }
            return inspected;
          })()
        : await bootstrapCoordinator.prepareBrowserAi({
            projectId,
            taskType: "chapter.continue",
            userInitiated: true,
            signal: controller.signal,
            onProgress: (next) => {
              if (!controller.signal.aborted) setClosedAiSetupProgress(next);
            },
          });
      if (!controller.signal.aborted) {
        const routable = isClosedAiTaskRoutable(result);
        setClosedAiSetup(result);
        setClosedAiSetupLifecycle(routable ? "ready" : "idle");
        setClosedAiStartupState(routable ? "ready" : "action_required");
        setClosedAiSetupProgress(routable
          ? {
              step: "router_register",
              percent: 100,
              message: "自動協調器已完成真實生成實測，可開始創作。",
            }
          : null);
        if (routable) {
          void Promise.allSettled([
            prewarmStudioProjectAIState({
              projectId,
              taskTypes: ["chapter.abcChoices", "chapter.continue"],
              signal: controller.signal,
            }),
            prewarmStudioInteractiveChoiceAI(controller.signal),
          ]);
        }
      }
    } catch (error) {
      await inspectAfterFailure(controller, error);
    } finally {
      if (setupAbortRef.current === controller) {
        setupAbortRef.current = null;
        setClosedAiSetupBusy(false);
      }
    }
  }, [closedAiSetupBusy, closedAiStartupState, inspectAfterFailure, projectId]);

  const cancelClosedAiSetup = useCallback(() => {
    setupAbortRef.current?.abort("CONVERSATION_CLOSED_AI_SETUP_CANCELLED");
    setupAbortRef.current = null;
    setClosedAiSetupBusy(false);
    setClosedAiSetupProgress(null);
    setClosedAiSetupError("已取消自動協調器準備；未完成的模型不會標記為可用。你可以稍後重試。");
    setClosedAiSetupLifecycle("cancelled");
    setClosedAiStartupState("action_required");
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
    closedAiStartupState,
    prepareClosedAi,
    cancelClosedAiSetup,
    resolveRegenerationBackend,
  };
}
