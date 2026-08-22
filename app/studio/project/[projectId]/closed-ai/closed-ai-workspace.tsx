"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CLOSED_AI_BACKEND_IDS,
  closedAgentQualityReasonCodes,
  hasVerifiedClosedAIGeneration,
  resolveClosedAIRoute,
  type ClosedAgentOS,
  type ClosedAIBackendId,
  type ClosedAIBackendSnapshot,
} from "@/lib/novel-ai/closed-agent-os";
import type {
  AcceptedChoice,
  Achievement,
  Chapter,
  Character,
  CharacterRelationship,
  NovelProject,
  StoryBible,
  StoryBranch,
  StoryState,
  TimelineEvent,
  WorldRule,
  WritingTask,
} from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  getStudioClosedAgentOS,
  getStudioClosedAIBootstrapCoordinator,
  getStudioClosedAIRuntimeCoordinator,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import type { ClosedAINamespace } from "@/lib/novel-ai/closed-ai-cache";
import {
  detectBrowserAI,
  getBrowserAIInferenceProof,
  verifyBrowserAI,
  type BrowserAICapability,
  type BrowserAIInferenceProof,
} from "@/lib/novel-ai/providers/browser-ai/browser-ai-provider";
import {
  browserWebLLMRuntimeSnapshot,
  deleteBrowserWebLLMModel,
  prewarmBrowserWebLLMModel,
  repairSelectedBrowserWebLLMCache,
  selectBrowserWebLLMModel,
  subscribeBrowserWebLLMProgress,
  type BrowserWebLLMProgress,
  type BrowserWebLLMRuntimeSnapshot,
} from "@/lib/novel-ai/providers/browser-ai/browser-webllm-runtime";
import {
  BROWSER_WEBLLM_MODELS,
  type BrowserWebLLMModelId,
} from "@/lib/novel-ai/providers/browser-ai/webllm-model-registry";
import { scheduleBrowserModelPrewarm } from "@/lib/novel-ai/providers/browser-ai/browser-prewarm-controller";
import {
  browserSemanticRuntimeSnapshot,
  deleteBrowserSemanticModel,
  installBrowserSemanticModel,
  invalidateBrowserSemanticCache,
  rankWithBrowserSemanticModel,
  repairStaleBrowserSemanticRuntime,
  subscribeBrowserSemanticProgress,
  type BrowserSemanticProgress,
  type BrowserSemanticRuntimeSnapshot,
} from "@/lib/novel-ai/providers/browser-ai/browser-semantic-runtime";
import {
  updateBrowserSemanticIndex,
  type BrowserSemanticIndexResult,
} from "@/lib/novel-ai/providers/browser-ai/browser-semantic-index";
import { buildBrowserSemanticProjectSources } from "@/lib/novel-ai/providers/browser-ai/browser-semantic-project-index";
import {
  BROWSER_SEMANTIC_MODEL,
} from "@/lib/novel-ai/providers/browser-ai/browser-semantic-model-registry";
import {
  readBrowserExecutionReceipts,
  summarizeBrowserOffload,
  type BrowserExecutionReceipt,
  type BrowserOffloadSummary,
} from "@/lib/novel-ai/providers/browser-ai/browser-offload-metrics";
import {
  configureLocalBridgeClient,
  configureLocalBridgeModel,
  selectAvailableTextModel,
  type LocalModelInferenceProof,
  type LocalTextModel,
} from "@/lib/novel-ai/providers/local-ollama/local-bridge-client";
import {
  evaluateLocalAIRuntimeVersion,
  LOCAL_AI_COMPANION_RELEASE,
  PASSWORDLESS_LOCAL_AI_ORIGINS,
} from "@/lib/novel-ai/providers/local-ollama/companion-release";
import { resolveCurrentStudioOrigin } from "@/lib/novel-ai/providers/local-ollama/studio-origin";
import {
  configurePrivateHubClient,
  configurePrivateHubModel,
  configurePrivateHubProject,
  type OfflinePreferenceModelArtifact,
  type PrivateHubInferenceProof,
} from "@/lib/novel-ai/providers/private-ai-hub/private-hub-client";
import type {
  BrowserComputePolicy,
  PlatformTaskType,
} from "@/lib/novel-ai/router/platform-types";
import {
  describePrivateModelRole,
  rankPrivateModels,
  type PrivateModelFleetProfile,
} from "@/lib/novel-ai/model-orchestration/private-model-fleet";
import {
  FAST_LOCAL_WRITER_MODEL,
  RECOMMENDED_LOCAL_WRITER_MODEL,
} from "@/lib/novel-ai/model-orchestration/recommended-models";
import { createSovereignLearningRepository } from "@/lib/novel-ai/sovereign-learning";
import {
  sealFormalPreferenceDataset,
  verifyFormalPreferenceDataset,
  type FormalPreferenceDatasetManifest,
} from "@/lib/novel-ai/training/formal-preference-dataset";
import ProjectNavigation from "../project-navigation";
import styles from "./closed-ai.module.css";

type Dashboard = Awaited<ReturnType<ClosedAgentOS["dashboard"]>>;
type PairingRequest = { pairingId: string; code: string };
type PreferencePair = { id: string; chosen: string; rejected: string };
type ContextInventory = {
  repository: "indexeddb" | "memory" | "unavailable";
  projectPresent: boolean;
  chapters: number;
  characters: number;
  storyStates: number;
  tasks: number;
  achievements: number;
};
type RuntimeTelemetry = {
  controlLatencyMs: number;
  active: number;
  queued: number;
  maxConcurrent: number;
  maxQueue: number;
  cacheEntries: number;
  maxPromptBytes: number;
};

const COORDINATOR_DIAGNOSTIC_TASK: PlatformTaskType = "story.consistencyCheck";
const COORDINATOR_DIAGNOSTIC_COMPLEXITY = "light" as const;

const BACKEND_LABELS: Record<ClosedAIBackendId | "auto", string> = {
  auto: "依任務自動選定",
  "browser-ai": "瀏覽器 AI",
  "local-ollama": "個人本機 Ollama",
  "private-ai-hub": "私有 AI Hub",
};

function statusLabel(status: ClosedAIBackendSnapshot["status"]) {
  if (status === "ready") return "真實生成已實測";
  if (status === "available") return "Runtime 可用，等待生成實測";
  if (status === "setup_required") return "需要完成設定";
  if (status === "preparing") return "模型準備中";
  if (status === "degraded") return "功能降級";
  if (status === "unreachable") return "目前無法連線";
  if (status === "failed") return "驗證失敗";
  return "此裝置不支援";
}

function runtimeError(error: unknown) {
  const code = String((error as { code?: string })?.code || "");
  const messages: Record<string, string> = {
    BRIDGE_PROCESS_UNREACHABLE: "本機執行服務尚未啟動，或瀏覽器無法存取 loopback。",
    LOCAL_NETWORK_PERMISSION_DENIED: "瀏覽器已拒絕本機網路權限。請在網址列的網站權限中允許「本機網路存取」，再按一次實際驗證模型。",
    BRIDGE_NOT_PAIRED: "目前頁面尚未取得本機短期工作階段，請重新自動連線。",
    BRIDGE_PAIRING_EXPIRED: "本機短期工作階段已過期，請重新自動連線。",
    BRIDGE_PAIRING_REVOKED: "這個網站的本機連線已撤銷；重新啟動 Companion 後才能再次自動連線。",
    OLLAMA_UNREACHABLE: "Ollama 尚未啟動。",
    OLLAMA_MODEL_NOT_FOUND: "找不到選定的本機模型。",
    LOCAL_MODEL_INFERENCE_NOT_VERIFIED: "模型尚未完成真實推理驗證。",
    OFFLINE_TRAINING_SAMPLE_MINIMUM: "至少加入兩組喜歡／不採用的寫法。",
    OFFLINE_TRAINING_SAMPLE_INVALID: "每組文字需不同，且每段至少 8 個字元。",
    OFFLINE_TRAINING_MANIFEST_REQUIRED: "必須先封印正式訓練資料清單。",
    OFFLINE_TRAINING_MANIFEST_INVALID: "訓練資料清單與目前對照不一致，已安全停止。",
    TRAINING_RIGHTS_CONFIRMATION_REQUIRED: "請先確認訓練文字是你擁有或已獲明確授權的內容。",
    TRAINING_CREDENTIAL_INPUT_BLOCKED: "訓練文字疑似包含憑證或密鑰，已安全阻擋。",
    DATASET_DUPLICATE_EXAMPLES: "訓練資料集中有重複對照，請移除後再封印。",
    BROWSER_AI_UNSUPPORTED: "此裝置不支援瀏覽器內建算力；協調器仍會核對其他閉端算力來源。",
    BROWSER_AI_MODEL_NOT_READY: "此裝置可支援瀏覽器 AI，但裝置模型尚未可用。",
    BROWSER_WEBLLM_DEVICE_GATE_FAILED: "這個模型未通過目前裝置的 WebGPU、記憶體或儲存空間檢查。",
    BROWSER_WEBLLM_INSTALL_FAILED: "Browser AI 模型未安裝完成；請確認網路與可用空間後重試。",
    BROWSER_WEBLLM_INFERENCE_FAILED: "已安裝的 Browser AI 模型未通過真實推理，沒有用模板冒充成功。",
    BROWSER_WEBLLM_MODEL_NOT_INSTALLED: "請先安裝並驗證一個 Browser AI 生成模型。",
  };
  return messages[code] ?? (error instanceof Error ? error.message : "本機執行操作失敗。");
}

function automaticConnectionFailure(error: unknown, label: string) {
  const code = String((error as { code?: string })?.code ?? "");
  if (code === "BRIDGE_PROCESS_UNREACHABLE" || code === "REQUEST_TIMEOUT") {
    return `${label} 尚未在這台電腦啟動`;
  }
  if (code === "LOCAL_NETWORK_PERMISSION_DENIED") {
    return `${label} 等待瀏覽器允許本機網路`;
  }
  if (code === "BRIDGE_PAIRING_REVOKED") {
    return `${label} 的自動連線已被使用者撤銷`;
  }
  if (code === "BRIDGE_ORIGIN_NOT_ALLOWED") {
    return `${label} 不允許目前網址免配對碼連線`;
  }
  if (code === "LOCAL_PROVIDER_NOT_READY") {
    return `${label} 版本過舊，請更新 Companion`;
  }
  return `${label} 尚未就緒（${code || "連線失敗"}）`;
}

function saveJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatBytes(bytes: number | null | undefined) {
  if (!Number.isFinite(bytes) || !bytes) return "未知";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function userMessage(error: unknown) {
  const code = String((error as { code?: string })?.code || "");
  const qualityReasonCodes = closedAgentQualityReasonCodes(error);
  const recommendedBackendId = (error as { recommendedBackendId?: ClosedAIBackendId | null })
    ?.recommendedBackendId;
  const messages: Record<string, string> = {
    CLOSED_AI_REQUIRED_BACKEND_NOT_READY: "這項工作所需的閉端 AI 尚未就緒；系統沒有暗中換用其他 AI。",
    CLOSED_AI_SELECTED_BACKEND_NOT_READY: "這次已鎖定的閉端算力目前不能執行；協調器已安全停止。",
    CLOSED_AGENT_PERMISSION_DENIED: "這項代理工作缺少必要權限，已安全停止。",
    CLOSED_AGENT_EVALUATION_BLOCKED: "候選未通過安全與品質評估，沒有進入核准區。",
    CONTROLLED_LEARNING_CONSENT_REQUIRED: "請先開啟這個作品的可控學習同意。",
    CONTROLLED_LEARNING_KILL_SWITCH_ENGAGED: "可控學習緊急停止目前已開啟。",
    BROWSER_AI_QUALITY_INSUFFICIENT: "真實瀏覽器模型已完成生成，但內容未通過小說品質檢查；沒有建立候選或修改 Canon。",
  };
  const message = messages[code] ?? (error instanceof Error ? error.message : "操作失敗。");
  const routedMessage = recommendedBackendId
    ? `${message} 自動協調器建議先完成 ${BACKEND_LABELS[recommendedBackendId]} 的連線與實測。`
    : message;
  return qualityReasonCodes.length
    ? `${routedMessage} 品質原因：${qualityReasonCodes.join("、")}。`
    : routedMessage;
}

function runtimeTelemetry(
  health: {
    cache?: { entries?: number };
    limits?: { maxPromptBytes?: number; maxConcurrent?: number; maxQueue?: number };
    workload?: {
      active?: number;
      queued?: number;
      maxConcurrent?: number;
      maxQueue?: number;
    };
  },
  startedAt: number,
): RuntimeTelemetry {
  return {
    controlLatencyMs: Math.round(performance.now() - startedAt),
    active: Number(health.workload?.active ?? 0),
    queued: Number(health.workload?.queued ?? 0),
    maxConcurrent: Number(
      health.workload?.maxConcurrent ?? health.limits?.maxConcurrent ?? 0,
    ),
    maxQueue: Number(health.workload?.maxQueue ?? health.limits?.maxQueue ?? 0),
    cacheEntries: Number(health.cache?.entries ?? 0),
    maxPromptBytes: Number(health.limits?.maxPromptBytes ?? 0),
  };
}

function formatModelSize(bytes: number | null) {
  if (!bytes || bytes <= 0) return "容量未回報";
  const gib = bytes / 1024 / 1024 / 1024;
  return gib >= 1 ? `${gib.toFixed(gib >= 10 ? 0 : 1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`;
}

function modelSummary(profile: PrivateModelFleetProfile) {
  const roles = profile.roles.length
    ? profile.roles.map(describePrivateModelRole).join("／")
    : "能力待辨識";
  return `${profile.parameterLabel} · ${profile.quantization} · ${roles}`;
}

export default function ClosedAIWorkspace({ projectId }: { projectId: string }) {
  const os = useMemo(() => getStudioClosedAgentOS(), []);
  const [currentOrigin, setCurrentOrigin] = useState<string | null>(null);
  const runtimeCoordinator = useMemo(
    () => getStudioClosedAIRuntimeCoordinator(
      currentOrigin ?? "https://novel-orcin.vercel.app",
    ),
    [currentOrigin],
  );
  const localClient = runtimeCoordinator.localClient;
  const hubClient = runtimeCoordinator.privateHubClient;
  const [snapshots, setSnapshots] = useState<ClosedAIBackendSnapshot[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const taskType = COORDINATOR_DIAGNOSTIC_TASK;
  const computePolicy: BrowserComputePolicy = "browser-first";
  const [storyBibleRevision, setStoryBibleRevision] = useState("current");
  const [knowledgeScopeRevision, setKnowledgeScopeRevision] = useState("current");
  const [status, setStatus] = useState("正在啟動統合閉端 AI 自動協調器。");
  const [busy, setBusy] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [rememberPairing, setRememberPairing] = useState(true);
  const [runtimeStatus, setRuntimeStatus] = useState("正在檢查本機執行環境。");
  const [networkOnline, setNetworkOnline] = useState(true);
  const [offlineWorkerControlled, setOfflineWorkerControlled] = useState(false);
  const [browserCapability, setBrowserCapability] = useState<BrowserAICapability | null>(null);
  const [browserProof, setBrowserProof] = useState<BrowserAIInferenceProof | null>(null);
  const [browserWebLlm, setBrowserWebLlm] = useState<BrowserWebLLMRuntimeSnapshot | null>(null);
  const [browserWebLlmProgress, setBrowserWebLlmProgress] = useState<BrowserWebLLMProgress | null>(null);
  const browserModelInstallController = useRef<AbortController | null>(null);
  const [browserModelOperation, setBrowserModelOperation] = useState<"install" | "prewarm" | null>(null);
  const [browserSemantic, setBrowserSemantic] = useState<BrowserSemanticRuntimeSnapshot | null>(null);
  const [browserSemanticProgress, setBrowserSemanticProgress] = useState<BrowserSemanticProgress | null>(null);
  const browserSemanticInstallController = useRef<AbortController | null>(null);
  const [browserSemanticOperation, setBrowserSemanticOperation] = useState<"install" | null>(null);
  const [browserSemanticIndex, setBrowserSemanticIndex] = useState<BrowserSemanticIndexResult | null>(null);
  const [browserSemanticIndexError, setBrowserSemanticIndexError] = useState<string | null>(null);
  const [browserSemanticIndexRefresh, setBrowserSemanticIndexRefresh] = useState(0);
  const [browserOffload, setBrowserOffload] = useState<BrowserOffloadSummary | null>(null);
  const [lastBrowserExecutionReceipt, setLastBrowserExecutionReceipt] =
    useState<BrowserExecutionReceipt | null>(null);
  const [localPairing, setLocalPairing] = useState<PairingRequest | null>(null);
  const [localModels, setLocalModels] = useState<LocalTextModel[]>([]);
  const [localModelId, setLocalModelId] = useState("");
  const [localProof, setLocalProof] = useState<LocalModelInferenceProof | null>(null);
  const [hubPairing, setHubPairing] = useState<PairingRequest | null>(null);
  const [hubModels, setHubModels] = useState<LocalTextModel[]>([]);
  const [hubModelId, setHubModelId] = useState("");
  const [hubProof, setHubProof] = useState<PrivateHubInferenceProof | null>(null);
  const [preferencePairs, setPreferencePairs] = useState<PreferencePair[]>([]);
  const [preferredExample, setPreferredExample] = useState("");
  const [rejectedExample, setRejectedExample] = useState("");
  const [trainingModels, setTrainingModels] = useState<OfflinePreferenceModelArtifact[]>([]);
  const [trainingCandidate, setTrainingCandidate] = useState<OfflinePreferenceModelArtifact | null>(null);
  const [trainingRightsConfirmed, setTrainingRightsConfirmed] = useState(false);
  const [trainingManifest, setTrainingManifest] =
    useState<FormalPreferenceDatasetManifest | null>(null);
  const [localTelemetry, setLocalTelemetry] = useState<RuntimeTelemetry | null>(null);
  const [hubTelemetry, setHubTelemetry] = useState<RuntimeTelemetry | null>(null);
  const [localRuntimeVersion, setLocalRuntimeVersion] = useState<string | null>(null);
  const [hubRuntimeVersion, setHubRuntimeVersion] = useState<string | null>(null);
  const [contextInventory, setContextInventory] = useState<ContextInventory | null>(null);
  const automaticConnectionOrigin = useRef<string | null>(null);
  const automaticConnectionRunning = useRef(false);
  const automaticConnectionCheckedAt = useRef(0);
  const selectedBrowserModel = browserWebLlm?.models.find((item) => item.selected);
  const browserPrewarmKey = selectedBrowserModel?.installStatus === "ready"
    && selectedBrowserModel.cacheVerified
    && selectedBrowserModel.shardIntegrityVerified
    ? `${selectedBrowserModel.modelId}:${selectedBrowserModel.modelDigest}`
    : null;

  useEffect(() => {
    const unsubscribeWebLlm = subscribeBrowserWebLLMProgress(setBrowserWebLlmProgress);
    const unsubscribeSemantic = subscribeBrowserSemanticProgress(setBrowserSemanticProgress);
    return () => {
      unsubscribeWebLlm();
      unsubscribeSemantic();
      browserModelInstallController.current?.abort();
      browserSemanticInstallController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!browserPrewarmKey) return;
    const controller = new AbortController();
    let cancelScheduled = () => {};
    void scheduleBrowserModelPrewarm({
      policy: computePolicy,
      powerMode: "normal",
      signal: controller.signal,
    }).then((decision) => {
      if (controller.signal.aborted) decision.cancel();
      else cancelScheduled = decision.cancel;
    }).catch(() => undefined);
    return () => {
      controller.abort();
      cancelScheduled();
    };
  }, [browserPrewarmKey, computePolicy]);

  useEffect(() => {
    const query = new URL(window.location.href).searchParams;
    const requestedTask = query.get("task")?.trim() ?? "";
    const handoffId = query.get("handoff")?.trim() ?? "";
    let prompt = query.get("objective")?.trim() ?? "";
    if (!prompt && /^[A-Za-z0-9-]{16,128}$/.test(handoffId)) {
      try {
        const rawHandoff = window.sessionStorage.getItem(`novel_closed_ai_handoff:${handoffId}`);
        const handoff = rawHandoff
          ? JSON.parse(rawHandoff) as {
            schemaVersion?: string;
            projectId?: string;
            objective?: string;
            createdAt?: string;
          }
          : null;
        const age = Date.now() - Date.parse(handoff?.createdAt ?? "");
        if (
          handoff?.schemaVersion === "novel-closed-ai-handoff-v1"
          && handoff.projectId === projectId
          && typeof handoff.objective === "string"
          && Number.isFinite(age)
          && age >= 0
          && age <= 30 * 60 * 1000
        ) {
          prompt = handoff.objective.trim();
        }
      } catch {
        // Invalid handoffs never restore story text into the management page.
      }
    }
    if (!requestedTask && !prompt && !handoffId) return;

    const storyWorkspace = new URL(`/studio/project/${projectId}/chat`, window.location.origin);
    if (requestedTask.startsWith("game.") || /rpg/i.test(requestedTask)) {
      storyWorkspace.searchParams.set("mode", "play");
    }
    if (prompt) storyWorkspace.searchParams.set("prompt", prompt.slice(0, 4000));
    window.location.replace(`${storyWorkspace.pathname}${storyWorkspace.search}`);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    const semanticIndexController = new AbortController();
    void (async () => {
      const repository = createNovelRepository();
      const learningRepository = createSovereignLearningRepository();
      const [
        project,
        chapters,
        characters,
        rules,
        timeline,
        storyBibles,
        storyStates,
        writingTasks,
        achievements,
        relationships,
        acceptedChoices,
        storyBranches,
        learningRules,
      ] = await Promise.all([
        repository.get<NovelProject>("projects", projectId),
        repository.list<Chapter>("chapters", projectId),
        repository.list<Character>("characters", projectId),
        repository.list<WorldRule>("worldRules", projectId),
        repository.list<TimelineEvent>("timeline", projectId),
        repository.list<StoryBible>("storyBibles", projectId),
        repository.list<StoryState>("storyStates", projectId),
        repository.list<WritingTask>("tasks", projectId),
        repository.list<Achievement>("achievements", projectId),
        repository.list<CharacterRelationship>("relationships", projectId),
        repository.listAcceptedChoices(projectId),
        repository.listStoryBranches(projectId),
        learningRepository.listRules(projectId).catch(() => []),
      ]);
      if (cancelled) return;
      const referencedStoryState = project?.storyStateId
        ? await repository.get<StoryState>("storyStates", project.storyStateId)
        : null;
      if (cancelled) return;
      const storyBible = storyBibles.find((item) => item.id === project?.storyBibleId)
        ?? storyBibles[0]
        ?? null;
      const storyState = referencedStoryState
        ?? storyStates.find((item) => item.id === project?.storyStateId)
        ?? storyStates[0]
        ?? null;
      setContextInventory({
        repository: repository.kind,
        projectPresent: Boolean(project),
        chapters: chapters.length,
        characters: characters.length,
        storyStates: storyState ? Math.max(1, storyStates.length) : 0,
        tasks: writingTasks.length,
        achievements: achievements.length,
      });
      setStoryBibleRevision(String(storyBible?.revision ?? "none"));
      const maximumRevision = Math.max(
        0,
        ...chapters.map((item) => item.revision),
        ...characters.map((item) => item.revision),
        ...rules.map((item) => item.revision),
        ...timeline.map((item) => item.revision),
        ...storyBibles.map((item) => item.revision),
        ...storyStates.map((item) => item.revision),
        ...writingTasks.map((item) => item.revision),
        ...achievements.map((item) => item.revision),
        ...relationships.map((item) => item.revision),
        ...acceptedChoices.map((item: AcceptedChoice) => item.revision),
        ...storyBranches.map((item: StoryBranch) => item.revision),
        ...learningRules.map((item) => item.revision),
      );
      setKnowledgeScopeRevision(String(maximumRevision));

      void (async () => {
        const semanticRuntime = await browserSemanticRuntimeSnapshot().catch(() => null);
        if (cancelled) return;
        if (!project) {
          setBrowserSemanticIndex(null);
          setBrowserSemanticIndexError("BROWSER_SEMANTIC_INDEX_PROJECT_NOT_FOUND");
          return;
        }
        if (!semanticRuntime?.model.cacheVerified) {
          setBrowserSemanticIndex(null);
          setBrowserSemanticIndexError("BROWSER_SEMANTIC_MODEL_NOT_READY");
          return;
        }
        const activeBranch = [...storyBranches]
          .filter((item) => item.status === "active")
          .sort((left, right) => right.revision - left.revision)[0];
        const indexed = await updateBrowserSemanticIndex({
          namespace: {
            tenantId: "local-tenant",
            userId: "local-author",
            projectId,
            storyId: projectId,
            canonId: `canon:${projectId}`,
            branchId: activeBranch?.branchId ?? "main",
            characterId: "shared",
            agentRole: "closed-agent-os",
            modelId: BROWSER_SEMANTIC_MODEL.modelId,
            modelDigest: BROWSER_SEMANTIC_MODEL.modelDigest,
            promptProfileVersion: "browser-semantic-index-rc5",
            storyBibleRevision: String(storyBible?.revision ?? "none"),
            knowledgeScopeRevision: String(maximumRevision),
            privacyLevel: "device_only",
          },
          sources: buildBrowserSemanticProjectSources({
            project,
            chapters,
            characters,
            relationships,
            worldRules: rules,
            timeline,
            storyBibles,
            storyStates,
            acceptedChoices,
            storyBranches,
            writingTasks,
            achievements,
            approvedLearningRules: learningRules.filter((item) => item.status === "approved"),
          }),
          signal: semanticIndexController.signal,
        });
        if (cancelled) return;
        setBrowserSemanticIndex(indexed);
        setBrowserSemanticIndexError(indexed.errorCode);
      })().catch((error) => {
        if (cancelled) return;
        setBrowserSemanticIndex(null);
        setBrowserSemanticIndexError(String(
          (error as { code?: unknown } | null)?.code ?? "BROWSER_SEMANTIC_INDEX_FAILED",
        ));
      });

    })().catch((error) => {
      if (!cancelled) {
        setBrowserSemanticIndex(null);
        setBrowserSemanticIndexError(String((error as { code?: unknown } | null)?.code ?? "BROWSER_SEMANTIC_INDEX_FAILED"));
        setStatus(`作品脈絡載入失敗：${runtimeError(error)}`);
      }
    });
    return () => {
      cancelled = true;
      semanticIndexController.abort();
    };
  }, [browserSemanticIndexRefresh, projectId]);

  useEffect(() => {
    const resolved = resolveCurrentStudioOrigin(window.location);
    const updateNetwork = () => setNetworkOnline(navigator.onLine);
    const updateWorker = () => setOfflineWorkerControlled(Boolean(navigator.serviceWorker?.controller));
    const initialization = window.setTimeout(() => {
      setCurrentOrigin(resolved.ready ? resolved.origin : null);
      updateNetwork();
      updateWorker();
    }, 0);
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    navigator.serviceWorker?.addEventListener("controllerchange", updateWorker);
    return () => {
      window.clearTimeout(initialization);
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
      navigator.serviceWorker?.removeEventListener("controllerchange", updateWorker);
    };
  }, []);

  useEffect(() => {
    configurePrivateHubProject(projectId);
    return () => {
      configurePrivateHubProject(null);
    };
  }, [projectId]);

  const namespaceForBackend = useCallback((backendId: ClosedAIBackendId): ClosedAINamespace => {
    const selected = snapshots.find((snapshot) => snapshot.id === backendId);
    const privacyLevel = backendId === "private-ai-hub"
      ? "private_infrastructure_only"
      : "device_only";
    return {
      tenantId: "local-tenant",
      userId: "local-author",
      projectId,
      storyId: projectId,
      canonId: `canon:${projectId}`,
      branchId: "main",
      characterId: "shared",
      agentRole: "closed-agent-os",
      modelId: selected?.modelId ?? `${backendId}:runtime-managed`,
      modelDigest: selected?.modelDigest ?? `${backendId}:digest-runtime-managed`,
      promptProfileVersion: "closed-agent-prompt-v3",
      storyBibleRevision,
      knowledgeScopeRevision,
      privacyLevel,
    };
  }, [knowledgeScopeRevision, projectId, snapshots, storyBibleRevision]);

  const routingNamespace = useMemo<ClosedAINamespace>(() => ({
    ...namespaceForBackend("local-ollama"),
    modelId: "unrouted:runtime-managed",
    modelDigest: "unrouted:digest-runtime-managed",
    privacyLevel: "device_only",
  }), [namespaceForBackend]);
  const runtimeRoute = useMemo(() => resolveClosedAIRoute({
    taskType,
    namespace: routingNamespace,
    complexity: COORDINATOR_DIAGNOSTIC_COMPLEXITY,
    browserComputePolicy: computePolicy,
  }, snapshots), [computePolicy, routingNamespace, snapshots, taskType]);
  const executionBackendId: ClosedAIBackendId =
    runtimeRoute.executionStatus === "routable"
      ? runtimeRoute.backend.id
      : "browser-ai";
  const fleetRequest = useMemo(() => ({
    taskType,
    complexity: COORDINATOR_DIAGNOSTIC_COMPLEXITY,
    preferLatency: true,
  }), [taskType]);
  const localFleet = useMemo(
    () => rankPrivateModels(localModels, fleetRequest),
    [fleetRequest, localModels],
  );
  const hubFleet = useMemo(
    () => rankPrivateModels(hubModels, fleetRequest),
    [fleetRequest, hubModels],
  );
  const recommendedFleetModel = executionBackendId === "private-ai-hub"
    ? hubFleet[0] ?? null
    : executionBackendId === "local-ollama"
      ? localFleet[0] ?? null
      : null;
  const passwordlessConnectionEnabled = Boolean(
    currentOrigin
    && PASSWORDLESS_LOCAL_AI_ORIGINS.includes(
      currentOrigin as (typeof PASSWORDLESS_LOCAL_AI_ORIGINS)[number],
    ),
  );
  const localVersionStatus = evaluateLocalAIRuntimeVersion({
    reportedVersion: localRuntimeVersion,
    minimumVersion: LOCAL_AI_COMPANION_RELEASE.minimumBridgeVersion,
    recommendedVersion: LOCAL_AI_COMPANION_RELEASE.recommendedBridgeVersion,
  });
  const hubVersionStatus = evaluateLocalAIRuntimeVersion({
    reportedVersion: hubRuntimeVersion,
    minimumVersion: LOCAL_AI_COMPANION_RELEASE.minimumPrivateHubVersion,
    recommendedVersion: LOCAL_AI_COMPANION_RELEASE.recommendedPrivateHubVersion,
  });

  const refreshRuntimes = useCallback(async () => {
    if (!currentOrigin) return;
    setRuntimeStatus("正在檢查自動協調器的全部閉端算力與資料邊界。");
    const browserProbe = Promise.all([
      detectBrowserAI(),
      repairSelectedBrowserWebLLMCache({
        onProgress: setBrowserWebLlmProgress,
      }).catch(() => browserWebLLMRuntimeSnapshot().catch(() => null)),
      repairStaleBrowserSemanticRuntime({
        onProgress: setBrowserSemanticProgress,
      }).catch(() => browserSemanticRuntimeSnapshot().catch(() => null)),
    ]).then(([browser, webLlm, semantic]) => {
      setBrowserCapability(browser);
      setBrowserWebLlm(webLlm);
      setBrowserSemantic(semantic);
      setBrowserProof(getBrowserAIInferenceProof());
      return { browser, semantic };
    });
    const localProbe = (async (): Promise<{ ready: boolean; detail: string }> => {
      const startedAt = performance.now();
      const probeSignal = AbortSignal.timeout(15_000);
      try {
        const health = await localClient.health(probeSignal);
        setLocalRuntimeVersion(health.bridgeVersion ?? null);
        setLocalTelemetry(runtimeTelemetry(health, startedAt));
        if (!health.runtimeReady) {
          setLocalModels([]);
          setLocalProof(null);
          configureLocalBridgeClient(null);
          configureLocalBridgeModel(null);
          return { ready: false, detail: "Ollama 尚未啟動或沒有可用模型" };
        }
        if (!localClient.getSessionMetadata()) {
          setLocalModels([]);
          setLocalProof(null);
          configureLocalBridgeClient(null);
          configureLocalBridgeModel(null);
          return { ready: false, detail: "尚未取得此網站的短期工作階段" };
        }
        const response = await localClient.models(probeSignal);
        const available = response.models.filter(
          (model) => model.capabilities?.textGeneration?.value === true,
        );
        const verifiedModelId = localClient.getModelVerification()?.modelId ?? "";
        const selected = selectAvailableTextModel(
          available,
          verifiedModelId || localModelId || FAST_LOCAL_WRITER_MODEL,
        ) || "";
        setLocalModels(available);
        setLocalModelId(selected);
        configureLocalBridgeClient(localClient);
        configureLocalBridgeModel(selected || null);
        const proof = selected ? localClient.getModelVerification(selected) : null;
        setLocalProof(proof);
        return proof
          ? { ready: true, detail: `${selected} 已完成真實推理` }
          : {
            ready: false,
            detail: selected
              ? `${selected} 尚未保留真實推理證明`
              : "未找到文字生成模型",
          };
      } catch (error) {
        setLocalRuntimeVersion(null);
        setLocalModels([]);
        setLocalProof(null);
        setLocalTelemetry(null);
        configureLocalBridgeClient(null);
        configureLocalBridgeModel(null);
        return {
          ready: false,
          detail: automaticConnectionFailure(error, "Local Ollama"),
        };
      }
    })();
    const hubProbe = (async (): Promise<{ ready: boolean; detail: string }> => {
      const startedAt = performance.now();
      const probeSignal = AbortSignal.timeout(10_000);
      try {
        const health = await hubClient.health(probeSignal);
        setHubRuntimeVersion(health.hubVersion ?? null);
        setHubTelemetry(runtimeTelemetry(health, startedAt));
        if (!health.runtimeReady || !hubClient.getSessionMetadata()) {
          setHubModels([]);
          setHubProof(null);
          setTrainingModels([]);
          configurePrivateHubClient(null);
          configurePrivateHubModel(null);
          return {
            ready: false,
            detail: health.runtimeReady
              ? "尚未取得此網站的短期工作階段"
              : "Private Hub 尚未啟動",
          };
        }
        const response = await hubClient.models(probeSignal);
        const available = response.models.filter(
          (model) => model.capabilities?.textGeneration?.value === true,
        );
        const verifiedModelId = hubClient.getModelVerification()?.modelId ?? "";
        const selected = selectAvailableTextModel(
          available,
          verifiedModelId || hubModelId || RECOMMENDED_LOCAL_WRITER_MODEL,
        ) || "";
        setHubModels(available);
        setHubModelId(selected);
        configurePrivateHubClient(hubClient);
        configurePrivateHubModel(selected || null);
        configurePrivateHubProject(projectId);
        const proof = selected ? hubClient.getModelVerification(selected) : null;
        setHubProof(proof);
        const trained = await hubClient.listPreferenceModels(projectId, probeSignal);
        setTrainingModels(trained);
        return proof
          ? { ready: true, detail: `${selected} 已完成真實推理` }
          : {
            ready: false,
            detail: selected
              ? `${selected} 尚未保留真實推理證明`
              : "未找到文字生成模型",
          };
      } catch (error) {
        setHubRuntimeVersion(null);
        setHubModels([]);
        setHubProof(null);
        setTrainingModels([]);
        setHubTelemetry(null);
        configurePrivateHubClient(null);
        configurePrivateHubModel(null);
        return {
          ready: false,
          detail: automaticConnectionFailure(error, "Private Hub"),
        };
      }
    })();
    const [browserResult, localResult, hubResult] = await Promise.all([
      browserProbe,
      localProbe,
      hubProbe,
    ]);
    const browser = browserResult.browser;
    const browserState = browser.status === "ready"
      ? getBrowserAIInferenceProof()
        ? "瀏覽器模型已實測"
        : "瀏覽器模型可用"
      : browser.status === "runtime_not_installed"
        ? "瀏覽器模型待下載"
        : "此裝置不支援瀏覽器 AI";
    setRuntimeStatus(
      `${browserState}；語意檢索 ${browserResult.semantic?.model.cacheVerified ? "已驗證" : "等待安裝／驗證"}；Local Bridge ${localResult.ready ? "模型已實測" : localResult.detail}；Private Hub ${hubResult.ready ? "模型已實測" : hubResult.detail}；離線殼 ${offlineWorkerControlled ? "已接管" : "首次快取中"}。`,
    );
  }, [
    currentOrigin,
    hubClient,
    hubModelId,
    localClient,
    localModelId,
    offlineWorkerControlled,
    projectId,
  ]);

  const refresh = useCallback(async (announce = true) => {
    await refreshRuntimes();
    const runtime = await runtimeCoordinator.refresh({
      projectId,
      taskType,
      storyBibleRevision,
      knowledgeScopeRevision,
      policy: {},
    });
    const nextSnapshots = runtime.backends;
    const [nextDashboard, receipts] = await Promise.all([
      os.dashboard(projectId, nextSnapshots),
      readBrowserExecutionReceipts().catch(() => []),
    ]);
    setSnapshots(nextSnapshots);
    setDashboard(nextDashboard);
    setBrowserOffload(summarizeBrowserOffload(receipts));
    setLastBrowserExecutionReceipt(
      [...receipts].sort((left, right) =>
        Date.parse(right.completedAt) - Date.parse(left.completedAt))[0] ?? null,
    );
    if (announce) {
      setStatus("統合閉端 AI 自動協調器已完成算力、知識與治理核對。");
    }
  }, [
    knowledgeScopeRevision,
    os,
    projectId,
    refreshRuntimes,
    runtimeCoordinator,
    storyBibleRevision,
    taskType,
  ]);

  const refreshDashboardOnly = useCallback(async () => {
    const nextDashboard = await os.dashboard(projectId, snapshots);
    setDashboard(nextDashboard);
    return nextDashboard;
  }, [os, projectId, snapshots]);

  const connectRuntimesAutomatically = useCallback(async () => {
    if (automaticConnectionRunning.current) return;
    automaticConnectionRunning.current = true;
    setRuntimeBusy(true);
    setRuntimeStatus("正在直接連接這台電腦的閉端 AI；不需要輸入密碼或配對碼。");
    try {
      const messages: string[] = [];
      // Connect the two loopback services in sequence. They can share the same
      // Ollama process, so simultaneous verification only creates avoidable
      // contention and rate-limit failures on smaller computers.
      const localResult = await runtimeCoordinator.connectLocalAutomatically().then(
        (value) => ({ status: "fulfilled", value } as const),
        (reason: unknown) => ({ status: "rejected", reason } as const),
      );
      if (localResult.status === "fulfilled") {
        setLocalPairing(null);
        setLocalModelId(localResult.value.model.modelId);
        setLocalProof(localResult.value.proof);
        // Publish the verified Local route immediately. The full dashboard
        // refresh also probes an optional Private Hub and must not make a
        // ready loopback model look unavailable while that probe finishes.
        setSnapshots((current) => {
          const previous = current.find((item) => item.id === "local-ollama");
          const readyLocal: ClosedAIBackendSnapshot = {
            id: "local-ollama",
            label: previous?.label ?? "個人本機 Ollama",
            status: "ready",
            runtimeTruth: {
              installed: true,
              configured: true,
              reachable: true,
              modelAvailable: true,
              runtimeVerified: true,
              generationVerified: true,
              verificationSource: "local-bridge-generation",
              verifiedAt: localResult.value.proof.verifiedAt,
            },
            modelId: localResult.value.model.modelId,
            modelDigest: localResult.value.proof.modelDigest
              ?? localResult.value.model.modelDigest
              ?? null,
            local: true,
            dataBoundary: "device",
            maximumComplexity: "standard",
            capabilities: ["text", "structured", "streaming", "offline"],
            supportedTaskTypes: "all",
            detailCode: "model_inference_verified",
            maxContext: Number(
              localResult.value.model.contextLength?.value ?? 0,
            ),
            controlLatencyMs: localResult.value.proof.latencyMs,
            qualityClass: "standard",
          };
          return [
            ...current.filter((item) => item.id !== "local-ollama"),
            readyLocal,
          ];
        });
        messages.push(`Local Ollama 已直接連線（${localResult.value.model.modelId}）`);
      } else {
        messages.push(automaticConnectionFailure(localResult.reason, "Local Ollama"));
      }
      setRuntimeStatus(`${messages.join("；")}。Private Hub 正在自動連線。`);
      const privateHubResult = await runtimeCoordinator
        .connectPrivateHubAutomatically()
        .then(
          (value) => ({ status: "fulfilled", value } as const),
          (reason: unknown) => ({ status: "rejected", reason } as const),
        );
      if (privateHubResult.status === "fulfilled") {
        setHubPairing(null);
        setHubModelId(privateHubResult.value.model.modelId);
        setHubProof(privateHubResult.value.proof);
        messages.push(`Private Hub 已直接連線（${privateHubResult.value.model.modelId}）`);
      } else {
        messages.push(automaticConnectionFailure(privateHubResult.reason, "Private Hub"));
      }
      setRuntimeStatus(`${messages.join("；")}。正在同步自動協調器的算力真相。`);
      try {
        await refresh(false);
        setRuntimeStatus(`${messages.join("；")}。Browser AI 會依裝置能力直接使用。`);
      } catch (error) {
        setRuntimeStatus(
          `${messages.join("；")}。算力真相同步失敗：${runtimeError(error)}`,
        );
      }
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      automaticConnectionCheckedAt.current = Date.now();
      automaticConnectionRunning.current = false;
      setRuntimeBusy(false);
    }
  }, [refresh, runtimeCoordinator]);

  useEffect(() => {
    runtimeCoordinator.setRememberPairingWithinTab(rememberPairing);
  }, [rememberPairing, runtimeCoordinator]);

  useEffect(() => {
    if (!currentOrigin) return;
    if (automaticConnectionOrigin.current === currentOrigin) return;
    automaticConnectionOrigin.current = currentOrigin;
    const initialization = window.setTimeout(() => {
      void connectRuntimesAutomatically();
    }, 0);
    return () => window.clearTimeout(initialization);
  }, [connectRuntimesAutomatically, currentOrigin]);

  useEffect(() => {
    if (!currentOrigin) return;
    const reconnectAfterResume = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - automaticConnectionCheckedAt.current < 60_000) return;
      void connectRuntimesAutomatically();
    };
    window.addEventListener("focus", reconnectAfterResume);
    window.addEventListener("online", reconnectAfterResume);
    document.addEventListener("visibilitychange", reconnectAfterResume);
    return () => {
      window.removeEventListener("focus", reconnectAfterResume);
      window.removeEventListener("online", reconnectAfterResume);
      document.removeEventListener("visibilitychange", reconnectAfterResume);
    };
  }, [connectRuntimesAutomatically, currentOrigin]);

  async function verifyBrowserRuntime() {
    if (runtimeBusy) return;
    setRuntimeBusy(true);
    setRuntimeStatus("正在要求此裝置的瀏覽器模型實際完成摘要。");
    try {
      const proof = await verifyBrowserAI();
      setBrowserProof(proof);
      setRuntimeStatus(
        proof.inferenceMode === "generative-model"
          ? `瀏覽器裝置內生成模型已實際回答，耗時 ${proof.latencyMs} ms；可承擔一般創作工作。`
          : `瀏覽器輕量任務模型已實際回答，耗時 ${proof.latencyMs} ms；它只負責摘要與分類，不會冒充長篇生成模型。`,
      );
      await refresh(false);
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function installBrowserModel(modelId: BrowserWebLLMModelId) {
    if (runtimeBusy) return;
    const manifest = BROWSER_WEBLLM_MODELS.find((item) => item.modelId === modelId);
    if (!manifest) return;
    const current = browserWebLlm?.models.find((item) => item.modelId === modelId);
    const cacheAction = current?.cacheComplete
      ? "只會驗證此裝置已保留的完整快取，不會重新下載。"
      : current?.cachePresent
        ? `會保留已有的 ${current.cachedShardCount}/${current.expectedShardCount} 個分片，只取得缺少檔案。`
        : "第一次安裝需要連網；完成快取驗證後，文章推理可留在此裝置。";
    const approved = window.confirm(
      `${current?.cacheComplete ? "即將驗證" : "即將準備"} ${manifest.displayName}（完整模型約 ${formatBytes(manifest.estimatedDownloadBytes)}）。\n\n`
      + `授權：${manifest.license}\n版本：${manifest.sourceRevision.slice(0, 12)}…\n\n`
      + `${cacheAction}是否繼續？`,
    );
    if (!approved) return;
    const controller = new AbortController();
    browserModelInstallController.current = controller;
    setBrowserModelOperation("install");
    setRuntimeBusy(true);
    setRuntimeStatus(`正在安裝 ${manifest.displayName}；可隨時停止，未完成的模型不會標記為可用。`);
    try {
      await getStudioClosedAIBootstrapCoordinator().prepareBrowserAi({
        projectId,
        taskType: "chapter.continue",
        requestedModelId: modelId,
        userInitiated: true,
        signal: controller.signal,
      });
      const snapshot = await browserWebLLMRuntimeSnapshot();
      setBrowserWebLlm(snapshot);
      setRuntimeStatus(`${manifest.displayName} 已安裝，並完成離線快取驗證。`);
      await refresh(false);
    } catch (error) {
      if (controller.signal.aborted) {
        setRuntimeStatus("已停止 Browser AI 模型安裝；未完成的快取不會冒充可用模型。");
      } else {
        setRuntimeStatus(runtimeError(error));
      }
      setBrowserWebLlm(await browserWebLLMRuntimeSnapshot().catch(() => null));
    } finally {
      if (browserModelInstallController.current === controller) {
        browserModelInstallController.current = null;
      }
      setBrowserModelOperation(null);
      setRuntimeBusy(false);
    }
  }

  function stopBrowserModelInstall() {
    browserModelInstallController.current?.abort();
  }

  async function prewarmBrowserModel() {
    if (runtimeBusy) return;
    const controller = new AbortController();
    browserModelInstallController.current = controller;
    setBrowserModelOperation("prewarm");
    setRuntimeBusy(true);
    setRuntimeStatus("正在從離線快取預熱 Browser AI Worker；不會送出作品內容。");
    try {
      const warmed = await prewarmBrowserWebLLMModel(controller.signal);
      setBrowserWebLlm(warmed.snapshot);
      setRuntimeStatus(
        warmed.engineReused
          ? `${warmed.modelId} 已在記憶體中，可直接生成。`
          : `${warmed.modelId} 已在 ${warmed.warmupMs} ms 內從離線快取完成預熱。`,
      );
    } catch (error) {
      setRuntimeStatus(controller.signal.aborted ? "已停止 Browser AI 預熱。" : runtimeError(error));
    } finally {
      if (browserModelInstallController.current === controller) browserModelInstallController.current = null;
      setBrowserModelOperation(null);
      setRuntimeBusy(false);
    }
  }

  async function chooseBrowserModel(modelId: BrowserWebLLMModelId) {
    if (runtimeBusy) return;
    setRuntimeBusy(true);
    try {
      const snapshot = await selectBrowserWebLLMModel(modelId);
      setBrowserWebLlm(snapshot);
      setRuntimeStatus(`已選用 ${BROWSER_WEBLLM_MODELS.find((item) => item.modelId === modelId)?.displayName ?? modelId}。`);
      await refresh(false);
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function removeBrowserModel(modelId: BrowserWebLLMModelId) {
    if (runtimeBusy) return;
    const manifest = BROWSER_WEBLLM_MODELS.find((item) => item.modelId === modelId);
    if (!window.confirm(`確定從此裝置刪除 ${manifest?.displayName ?? modelId} 的模型快取？`)) return;
    setRuntimeBusy(true);
    try {
      const snapshot = await deleteBrowserWebLLMModel(modelId, { userConfirmed: true });
      setBrowserWebLlm(snapshot);
      setBrowserProof(null);
      setRuntimeStatus(`${manifest?.displayName ?? modelId} 已從此裝置刪除。`);
      await refresh(false);
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function installSemanticModel() {
    if (runtimeBusy) return;
    const approved = window.confirm(
      `即將下載 ${BROWSER_SEMANTIC_MODEL.displayName}（約 ${formatBytes(BROWSER_SEMANTIC_MODEL.estimatedDownloadBytes)}）。\n\n`
      + `用途：${BROWSER_SEMANTIC_MODEL.purpose}\n授權：${BROWSER_SEMANTIC_MODEL.license}\n版本：${BROWSER_SEMANTIC_MODEL.sourceRevision.slice(0, 12)}…\n\n`
      + "安裝時會連線 Hugging Face；權重與 tokenizer 會逐一核對 SHA-256，之後檢索可完全留在裝置。是否繼續？",
    );
    if (!approved) return;
    const controller = new AbortController();
    browserSemanticInstallController.current = controller;
    setBrowserSemanticOperation("install");
    setRuntimeBusy(true);
    setRuntimeStatus("正在安裝與驗證 Browser AI 語意模型；未完成前不會標記為可用。");
    try {
      const snapshot = await installBrowserSemanticModel({
        signal: controller.signal,
        onProgress: setBrowserSemanticProgress,
      });
      setBrowserSemantic(snapshot);
      setBrowserSemanticIndexRefresh((current) => current + 1);
      setRuntimeStatus("語意模型已完成 SHA-256 與離線載入驗證；小說 RAG 與 Semantic Cache 可用。");
      await refresh(false);
    } catch (error) {
      setRuntimeStatus(controller.signal.aborted
        ? "已停止語意模型安裝；不完整快取不會被使用。"
        : runtimeError(error));
      setBrowserSemantic(await browserSemanticRuntimeSnapshot().catch(() => null));
    } finally {
      if (browserSemanticInstallController.current === controller) {
        browserSemanticInstallController.current = null;
      }
      setBrowserSemanticOperation(null);
      setRuntimeBusy(false);
    }
  }

  function stopSemanticModelInstall() {
    browserSemanticInstallController.current?.abort();
  }

  async function testSemanticModel() {
    if (runtimeBusy) return;
    setRuntimeBusy(true);
    setRuntimeStatus("正在以真實向量測試多語語意排序；內容不離開此裝置。");
    try {
      const ranked = await rankWithBrowserSemanticModel({
        namespace: namespaceForBackend("browser-ai"),
        query: "主角追查失蹤帳冊背後的秘密線索",
        items: [
          { id: "related", text: "主角暗中調查帳本由誰交出，逐步逼近被隱藏的真相。", priority: 80 },
          { id: "unrelated", text: "午後天空晴朗，廚房正在準備一盤新鮮水果。", priority: 80 },
        ],
      });
      if (ranked.scores[0]?.id !== "related") {
        throw Object.assign(new Error("語意模型未把相關小說線索排在前面。"), {
          code: "BROWSER_SEMANTIC_RELEVANCE_CHECK_FAILED",
        });
      }
      setBrowserSemantic(await browserSemanticRuntimeSnapshot());
      setRuntimeStatus(
        `語意檢索實測通過：${ranked.device.toUpperCase()} · ${ranked.elapsedMs} ms · ${ranked.cacheHit ? "Semantic Cache 命中" : "真實向量推理"} · 資料未離開裝置。`,
      );
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function testBrowserPipeline() {
    if (runtimeBusy) return;
    setRuntimeBusy(true);
    setRuntimeStatus("正在完整實測 Browser LLM、串流 Worker、分層 RAG 與 Semantic Cache。");
    try {
      const proof = await verifyBrowserAI();
      const selected = browserWebLlm?.models.find((item) => item.selected && item.installStatus === "ready" && item.cacheVerified);
      if (selected && proof.modelId !== selected.modelId) {
        throw Object.assign(new Error("實際執行模型與目前選用的 WebLLM 模型不一致。"), {
          code: "BROWSER_WEBLLM_EXECUTOR_IDENTITY_MISMATCH",
        });
      }
      let semanticDetail = "語意模型未安裝，已略過 RAG 向量實測";
      if (browserSemantic?.model.cacheVerified) {
        const ranked = await rankWithBrowserSemanticModel({
          namespace: namespaceForBackend("browser-ai"),
          query: "角色為了保護同伴而隱瞞重要真相",
          items: [
            { id: "related", text: "她沒有說出密函的內容，只因不願讓同伴捲入危險。", priority: 80 },
            { id: "unrelated", text: "市場今天新增三種季節水果。", priority: 80 },
          ],
        });
        if (ranked.scores[0]?.id !== "related") {
          throw Object.assign(new Error("分層 RAG 的語意排序實測失敗。"), {
            code: "BROWSER_SEMANTIC_RELEVANCE_CHECK_FAILED",
          });
        }
        semanticDetail = `${ranked.device.toUpperCase()} 語意排序 ${ranked.elapsedMs} ms`;
      }
      setBrowserProof(proof);
      setBrowserWebLlm(await browserWebLLMRuntimeSnapshot());
      setBrowserSemantic(await browserSemanticRuntimeSnapshot());
      setRuntimeStatus(
        `Browser AI 完整實測通過：${proof.modelId} 真實推理 ${proof.latencyMs} ms；${semanticDetail}；文章資料未送往外部 API。`,
      );
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function removeSemanticModel() {
    if (runtimeBusy) return;
    if (!window.confirm(`確定刪除 ${BROWSER_SEMANTIC_MODEL.displayName}、模型快取與其語意排序 Cache？`)) return;
    setRuntimeBusy(true);
    try {
      setBrowserSemantic(await deleteBrowserSemanticModel());
      setBrowserSemanticIndex(null);
      setBrowserSemanticIndexError("BROWSER_SEMANTIC_MODEL_NOT_READY");
      setRuntimeStatus("語意模型與專屬 Semantic Cache 已從此裝置刪除；Canon、Memory 與作品內容未受影響。");
      await refresh(false);
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function requestLocalPairing() {
    if (runtimeBusy) return;
    setRuntimeBusy(true);
    try {
      const request = await localClient.requestPairing();
      setLocalPairing({
        pairingId: String(request.pairingId || ""),
        code: "",
      });
      setRuntimeStatus("Local Bridge 已產生一次性配對要求；請從本機 Launcher 讀取六位數配對碼。");
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function verifyLocalModel(modelId: string) {
    if (!modelId) return;
    setLocalProof(null);
    setLocalModelId(modelId);
    configureLocalBridgeModel(null);
    setRuntimeStatus(`正在要求 ${modelId} 實際回答本機驗證題。`);
    const proof = await localClient.verifyModel(modelId);
    configureLocalBridgeClient(localClient);
    configureLocalBridgeModel(modelId);
    setLocalProof(proof);
    setRuntimeStatus(`Local Bridge 與 ${modelId} 已通過真實推理，耗時 ${proof.latencyMs} ms。`);
  }

  async function confirmLocalPairing() {
    if (runtimeBusy || !localPairing) return;
    setRuntimeBusy(true);
    try {
      await localClient.confirmPairing(localPairing.pairingId, localPairing.code);
      configureLocalBridgeClient(localClient);
      const response = await localClient.models();
      const available = response.models.filter(
        (model) => model.capabilities?.textGeneration?.value === true,
      );
      const selected = selectAvailableTextModel(available, FAST_LOCAL_WRITER_MODEL) || "";
      setLocalModels(available);
      if (!selected) throw Object.assign(new Error("沒有可生成文字的本機模型。"), {
        code: "OLLAMA_MODEL_NOT_FOUND",
      });
      await verifyLocalModel(selected);
      setLocalPairing(null);
      await refresh(false);
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function revokeLocalPairing() {
    if (runtimeBusy) return;
    setRuntimeBusy(true);
    try {
      await localClient.revoke();
      configureLocalBridgeClient(null);
      configureLocalBridgeModel(null);
      setLocalPairing(null);
      setLocalModels([]);
      setLocalModelId("");
      setLocalProof(null);
      setRuntimeStatus("Local Bridge 配對已撤銷；模型與作品資料沒有被刪除。");
      await refresh(false);
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function requestHubPairing() {
    if (runtimeBusy) return;
    setRuntimeBusy(true);
    try {
      const request = await hubClient.requestPairing();
      setHubPairing({
        pairingId: String(request.pairingId || ""),
        code: "",
      });
      setRuntimeStatus("Private Hub 本機節點已產生一次性配對要求；請從 Private Hub Launcher 讀取配對碼。");
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function verifyHubModel(modelId: string) {
    if (!modelId) return;
    setHubProof(null);
    setHubModelId(modelId);
    configurePrivateHubModel(null);
    setRuntimeStatus(`正在要求 Private Hub 的 ${modelId} 實際回答驗證題。`);
    const proof = await hubClient.verifyModel(modelId);
    configurePrivateHubClient(hubClient);
    configurePrivateHubModel(modelId);
    configurePrivateHubProject(projectId);
    setHubProof(proof);
    const trained = await hubClient.listPreferenceModels(projectId);
    setTrainingModels(trained);
    setRuntimeStatus(`Private Hub 與 ${modelId} 已通過真實推理，耗時 ${proof.latencyMs} ms。`);
  }

  async function confirmHubPairing() {
    if (runtimeBusy || !hubPairing) return;
    setRuntimeBusy(true);
    try {
      await hubClient.confirmPairing(hubPairing.pairingId, hubPairing.code);
      configurePrivateHubClient(hubClient);
      configurePrivateHubProject(projectId);
      const response = await hubClient.models();
      const available = response.models.filter(
        (model) => model.capabilities?.textGeneration?.value === true,
      );
      const selected = selectAvailableTextModel(available, RECOMMENDED_LOCAL_WRITER_MODEL) || "";
      setHubModels(available);
      if (!selected) throw Object.assign(new Error("Private Hub 沒有可生成文字的模型。"), {
        code: "OLLAMA_MODEL_NOT_FOUND",
      });
      await verifyHubModel(selected);
      setHubPairing(null);
      await refresh(false);
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function revokeHubPairing() {
    if (runtimeBusy) return;
    setRuntimeBusy(true);
    try {
      await hubClient.revoke();
      configurePrivateHubClient(null);
      configurePrivateHubModel(null);
      setHubPairing(null);
      setHubModels([]);
      setHubModelId("");
      setHubProof(null);
      setTrainingModels([]);
      setTrainingCandidate(null);
      setRuntimeStatus("Private Hub 本機節點配對已撤銷；訓練模型成果仍保存在本機節點。");
      await refresh(false);
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  function addPreferencePair() {
    const chosen = preferredExample.trim();
    const rejected = rejectedExample.trim();
    if (chosen.length < 8 || rejected.length < 8 || chosen === rejected) {
      setRuntimeStatus("喜歡與不採用的寫法必須不同，且每段至少 8 個字元。");
      return;
    }
    setPreferencePairs((current) => [
      ...current,
      { id: crypto.randomUUID(), chosen, rejected },
    ]);
    setTrainingManifest(null);
    setPreferredExample("");
    setRejectedExample("");
    setRuntimeStatus("偏好對照只保留在目前頁面記憶中；送出訓練後，原文不會寫入模型成果。");
  }

  async function sealTrainingDataset() {
    if (runtimeBusy || preferencePairs.length < 2 || !hubModelId) return;
    setRuntimeBusy(true);
    try {
      const manifest = await sealFormalPreferenceDataset({
        projectId,
        baseModelId: hubModelId,
        datasetVersion: `author-approved-${new Date().toISOString().slice(0, 10)}`,
        samples: preferencePairs.map(({ chosen, rejected }) => ({ chosen, rejected })),
        rightsConfirmed: trainingRightsConfirmed,
      });
      setTrainingManifest(manifest);
      setRuntimeStatus(
        `正式訓練資料已封印：${manifest.sampleCount} 組、manifest ${manifest.manifestHash.slice(0, 12)}…；原文仍只留在目前頁面記憶中。`,
      );
    } catch (error) {
      setTrainingManifest(null);
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function trainPreferenceModel() {
    if (
      runtimeBusy
      || preferencePairs.length < 2
      || !hubProof
      || !hubModelId
      || !trainingManifest
    ) return;
    setRuntimeBusy(true);
    setRuntimeStatus("正在驗證正式資料清單，並於 Private Hub 本機訓練偏好模型。");
    try {
      const samples = preferencePairs.map(({ chosen, rejected }) => ({ chosen, rejected }));
      if (!await verifyFormalPreferenceDataset(trainingManifest, samples)) {
        throw Object.assign(new Error("正式訓練資料清單與目前內容不一致。"), {
          code: "OFFLINE_TRAINING_MANIFEST_INVALID",
        });
      }
      const artifact = await hubClient.trainPreferenceModel({
        projectId,
        baseModelId: hubModelId,
        datasetVersion: trainingManifest.datasetVersion,
        samples,
        datasetManifest: trainingManifest,
        hyperparameters: { epochs: 320, learningRate: 0.08, l2: 0.015 },
      });
      const verified = await hubClient.verifyPreferenceModel(projectId, artifact.modelId);
      setTrainingCandidate(verified);
      const trained = await hubClient.listPreferenceModels(projectId);
      setTrainingModels(trained);
      setPreferencePairs([]);
      setTrainingManifest(null);
      setTrainingRightsConfirmed(false);
      setRuntimeStatus(
        `離線偏好模型已訓練並驗證：${verified.modelId}；正式資料集 ${verified.datasetDigest.slice(0, 12)}…；準確率 ${Math.round((verified.metrics.allPairAccuracy ?? 0) * 100)}%，等待你啟用。`,
      );
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function activatePreferenceModel(model: OfflinePreferenceModelArtifact) {
    if (runtimeBusy) return;
    if (!window.confirm(`啟用 ${model.modelId} 作為本作品的離線偏好模型？可再回滾。`)) return;
    setRuntimeBusy(true);
    try {
      await hubClient.activatePreferenceModel(projectId, model.modelId);
      const trained = await hubClient.listPreferenceModels(projectId);
      setTrainingModels(trained);
      setTrainingCandidate(null);
      setRuntimeStatus(`偏好模型 ${model.modelId} 已啟用，之後的 Private Hub 候選會帶入此模型的偏好方向。`);
      await refresh(false);
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function rollbackPreferenceModel() {
    if (runtimeBusy) return;
    if (!window.confirm("把本作品的偏好模型回滾到上一個已啟用版本？")) return;
    setRuntimeBusy(true);
    try {
      await hubClient.rollbackPreferenceModel(projectId);
      const trained = await hubClient.listPreferenceModels(projectId);
      setTrainingModels(trained);
      setRuntimeStatus("偏好模型已回滾，模型雜湊與作用中的 Cache 命名空間會隨版本更新。");
      await refresh(false);
    } catch (error) {
      setRuntimeStatus(runtimeError(error));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function enableLearning() {
    setBusy(true);
    try {
      await Promise.all(CLOSED_AI_BACKEND_IDS.map((backendId) =>
        os.learning.setConsent({
          namespace: namespaceForBackend(backendId),
          enabled: true,
        })));
      await os.learning.setKillSwitch(projectId, false);
      setStatus("統合閉端 AI 的可控學習同意已開啟；仍只接受通過隱私過濾與人工核准的 L0／L1 候選。");
      await refreshDashboardOnly();
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function engageKillSwitch() {
    setBusy(true);
    try {
      await os.learning.setKillSwitch(projectId, true, "USER_ENGAGED");
      setStatus("可控學習已緊急停止；生成與既有記憶不受影響。");
      await refreshDashboardOnly();
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function clearProjectCache() {
    setBusy(true);
    try {
      const [result, semantic] = await Promise.all([
        os.invalidateCache({ projectId }),
        invalidateBrowserSemanticCache({ projectId }).catch(() => ({ invalidated: 0, remaining: 0 })),
      ]);
      const runtimeNote = result.unavailableBackends.length
        ? `；${result.unavailableBackends.length} 個未連線後端由 namespace 隔離阻止舊資料重用`
        : "";
      setStatus(`已精準清除這個作品的 ${result.totalInvalidated} 筆 AI Cache 與 ${semantic.invalidated} 筆 Browser 語意排序 Cache；其他作品未受影響${runtimeNote}。`);
      await refresh(false);
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function exportGovernanceEvidence() {
    saveJson(`closed-ai-governance-${projectId}.json`, {
      schemaVersion: "novel-closed-ai-governance-evidence-v1",
      exportedAt: new Date().toISOString(),
      projectId,
      dashboard,
      backends: snapshots,
      browserOffload,
      lastBrowserExecutionReceipt,
      canonicalMutationFromThisPage: 0,
    });
    setStatus("自動協調器的狀態、算力證明與治理摘要已匯出；不包含故事正文。");
  }

  async function exportLearning() {
    setBusy(true);
    try {
      saveJson(`controlled-learning-${projectId}.json`, await os.learning.exportProject(projectId));
      setStatus("可控學習資料已匯出；檔案不含原文、生成全文或思考鏈。");
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteLearning() {
    if (!window.confirm("確定刪除這個作品的全部可控學習紀錄？生成內容與 Canon 不會被刪除。")) return;
    setBusy(true);
    try {
      await os.learning.deleteProject(projectId);
      setStatus("這個作品的可控學習紀錄已刪除。");
      await refresh(false);
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell} data-testid="closed-ai-workspace">
      <header className={styles.header}>
        <div>
          <small>PRIVATE NOVEL INTELLIGENCE · CLOSED AGENT FABRIC</small>
          <h1>閉端 AI 自動協調器</h1>
          <p>這裡只管理同一個小說閉端 AI 的算力、知識索引、Cache、學習與證據；故事工作一律從故事工作台開始。</p>
        </div>
        <div className={styles.headerActions}>
          <span data-ready={dashboard?.status === "ready"}>Closed Agent OS：{dashboard?.status === "ready" ? "就緒" : "核對中"}</span>
          <Link href={`/studio/project/${projectId}/chat`}>返回故事工作台</Link>
          <Link href="/settings/local-ai">本機 AI 安裝精靈</Link>
          <button type="button" disabled={busy || runtimeBusy} onClick={() => void connectRuntimesAutomatically()}>
            重新連線／檢查
          </button>
        </div>
      </header>

      <ProjectNavigation projectId={projectId} active="closed-ai" />
      <section className={styles.commandDeck} aria-label="閉端 AI 核心狀態">
        <div className={styles.aiCore} aria-hidden="true">
          <span className={styles.corePulse}>OS</span>
          <span className={`${styles.coreNode} ${styles.browserNode}`}>B</span>
          <span className={`${styles.coreNode} ${styles.localNode}`}>L</span>
          <span className={`${styles.coreNode} ${styles.hubNode}`}>H</span>
        </div>
        <div className={styles.deckCopy}>
          <small>NOVEL DOMAIN SUPER-AGENT</small>
          <h2>自動協調器設定與治理中心</h2>
          <p>故事工作台提出任務後，Planner、Actor、Critic 與 Evaluator 才會依序工作；本頁只呈現連線、狀態與治理證據。</p>
          <div className={styles.deckMetrics}>
            <span><strong>1</strong> 個故事工作入口</span>
            <span><strong>{localModels.length + hubModels.length}</strong> 個已偵測私有模型</span>
            <span><strong>{snapshots.filter(hasVerifiedClosedAIGeneration).length}/3</strong> 內部算力來源已實測</span>
            <span><strong>{trainingModels.length}</strong> 個偏好模型成果</span>
          </div>
        </div>
        <div className={styles.truthPanel}>
          <span>目前能力真相</span>
          <strong>{recommendedFleetModel
            ? `${recommendedFleetModel.modelId} · 適配 ${recommendedFleetModel.score}%`
            : "等待本機服務自動連線"}</strong>
          <p>{recommendedFleetModel
            ? recommendedFleetModel.reasons.slice(0, 2).join("；")
            : "架構已支援多模型；實際能力仍取決於已安裝、已驗證的模型與硬體。"}</p>
        </div>
      </section>
      <p className={styles.status} data-testid="closed-ai-task-status" role="status" aria-live="polite">{status}</p>
      <p
        className={styles.runtimeStatus}
        data-testid="closed-ai-auto-connect-status"
        role="status"
        aria-live="polite"
      >{runtimeStatus}</p>

      <section className={styles.panel} data-testid="browser-offload-dashboard">
        <div className={styles.panelHeading}>
          <div>
            <small>UNIFIED CLOSED AI · DIGEST/COUNT ONLY</small>
            <h2>自動協調器執行、知識與治理真相</h2>
          </div>
          <span>任務前自動分派 · 執行中不靜默切換</span>
        </div>
        <div className={styles.metricGrid}>
          <article>
            <small>Browser AI</small>
            <strong>{snapshots.find((item) => item.id === "browser-ai")?.status === "ready" ? "READY" : "RUNTIME"}</strong>
            <span>{browserWebLlm?.models.find((item) => item.selected)?.modelId ?? browserCapability?.generativeRuntime ?? browserCapability?.modelId ?? "等待裝置偵測"}</span>
          </article>
          <article>
            <small>GPU／模型完整性</small>
            <strong>{browserWebLlm?.device.webGpu ? "WebGPU" : "WASM／規則"}</strong>
            <span>{browserWebLlm?.models.find((item) => item.selected)?.shardIntegrityVerified ? "所有權重分片 SHA-256 已驗證" : "等待安裝與逐片驗證"}</span>
          </article>
          <article>
            <small>Semantic Index</small>
            <strong>{browserSemanticIndex?.status === "ready" ? "READY" : browserSemanticIndexError ? "WAITING" : "NOT BUILT"}</strong>
            <span>{browserSemanticIndex?.status === "ready"
              ? `${browserSemanticIndex.documentCount} 筆 · IndexedDB metadata · OPFS vectors`
              : browserSemanticIndexError ?? "等待完整作品索引"}</span>
          </article>
          <article>
            <small>正式作品脈絡</small>
            <strong>{contextInventory?.projectPresent ? "READY" : "WAITING"}</strong>
            <span>{contextInventory
              ? `${contextInventory.chapters} 章 · ${contextInventory.characters} 角色 · ${contextInventory.storyStates} StoryState`
              : "等待作品資料索引"}</span>
          </article>
          <article>
            <small>GPU Queue</small>
            <strong>{browserWebLlm?.performance.activeGeneration ? "ACTIVE" : "IDLE"}</strong>
            <span>等待 {browserWebLlm?.performance.queuedGenerations ?? 0} · Worker 重啟 {browserWebLlm?.performance.workerRestartCount ?? 0} · Device lost {browserWebLlm?.performance.gpuDeviceLostCount ?? 0}</span>
          </article>
          <article>
            <small>Browser Offload</small>
            <strong>{Math.round((browserOffload?.browserOffloadRatio ?? 0) * 100)}%</strong>
            <span>{browserOffload?.browserExecutedCount ?? 0}/{browserOffload?.eligibleTaskCount ?? 0} 筆已記錄任務</span>
          </article>
          <article>
            <small>模型工作節省</small>
            <strong>{(browserOffload?.estimatedTokensSaved ?? 0).toLocaleString()} tokens</strong>
            <span>Local 避免 {browserOffload?.localOllamaCallsAvoided ?? 0} · Hub 避免 {browserOffload?.privateHubJobsAvoided ?? 0}</span>
          </article>
          <article>
            <small>最近實際執行器</small>
            <strong>{lastBrowserExecutionReceipt?.actualExecutor
              ?? "尚未執行"}</strong>
            <span>{lastBrowserExecutionReceipt
              ? lastBrowserExecutionReceipt.dataLeftDevice
                ? "資料離開裝置"
                : "資料留在裝置"
              : "尚無執行紀錄"}</span>
          </article>
          <article>
            <small>核准邊界</small>
            <strong>LOCKED</strong>
            <span>本管理頁 Canon mutation = 0</span>
          </article>
        </div>
      </section>

      <div className={styles.workspace}>
        <section className={`${styles.panel} ${styles.coordinatorPanel}`} aria-labelledby="backend-title">
          <div className={styles.panelHeading}>
            <div><small>單一入口 · 執行與治理融合</small><h2 id="backend-title">閉端 AI 自動協調器</h2></div>
            <span>依任務自動分派，不需選擇 AI</span>
          </div>
          <label className={styles.sessionPreference}>
            <input
              type="checkbox"
              checked={rememberPairing}
              onChange={(event) => setRememberPairing(event.target.checked)}
            />
            自動連線只在目前分頁保留短期工作階段；不需密碼或配對碼，關閉分頁即失效，也不寫入 localStorage 或作品備份。
          </label>
          <div className={styles.backendList}>
            {snapshots.map((snapshot) => (
              <article key={snapshot.id} data-status={snapshot.status}>
                <div>
                  <strong>{snapshot.id === "browser-ai"
                    ? "裝置內瀏覽器算力"
                    : snapshot.id === "local-ollama"
                      ? "個人本機算力"
                      : "私有中樞算力"}</strong>
                  <span>{statusLabel(snapshot.status)}</span>
                </div>
                <p>{snapshot.id === "browser-ai"
                  ? browserCapability?.generativeModelReady
                    ? "裝置內生成模型已就緒，可執行一般續寫、對話與分析。"
                    : "免安裝的輕量摘要、分類與角色檢查；目前不是長篇生成模型。"
                  : snapshot.id === "local-ollama"
                    ? "裝置內續寫、對話、檢索與一般代理任務。"
                    : "私有算力的長上下文、重型與多代理任務。"}</p>
                <dl>
                  <div><dt>資料邊界</dt><dd>{snapshot.dataBoundary === "device" ? "本機裝置" : "私有基礎設施"}</dd></div>
                  <div><dt>最大工作</dt><dd>{snapshot.maximumComplexity}</dd></div>
                  <div><dt>模型</dt><dd>{snapshot.modelId ?? "執行環境未連線"}</dd></div>
                  <div><dt>模型雜湊</dt><dd>{snapshot.modelDigest ? `${snapshot.modelDigest.slice(0, 16)}…` : "等待驗證"}</dd></div>
                  <div><dt>上下文</dt><dd>{snapshot.maxContext ? `${snapshot.maxContext.toLocaleString()} tokens` : "依裝置／模型"}</dd></div>
                  <div><dt>探測耗時</dt><dd>{typeof snapshot.controlLatencyMs === "number" ? `${snapshot.controlLatencyMs} ms` : "—"}</dd></div>
                  <div><dt>真相碼</dt><dd>{snapshot.detailCode}</dd></div>
                </dl>
                {snapshot.id === "browser-ai" ? <div className={styles.runtimeControls}>
                  <p>
                    裝置能力：{browserCapability?.status === "ready"
                      ? browserCapability.generativeModelReady
                        ? "裝置內生成模型可用"
                        : browserCapability.reason.includes("native_summary")
                        ? "混合模型可用（內建摘要加速）"
                        : browserCapability.reason.includes("download_required")
                          ? "生成模型可下載；目前只有輕量任務模型"
                          : "封裝式摘要／分類模型可用（非生成式 LLM）"
                      : browserCapability?.status === "runtime_not_installed"
                        ? "支援但模型尚未下載"
                        : "此裝置不支援"}
                  </p>
                  {browserWebLlm ? <div className={styles.browserModelManager} data-testid="browser-webllm-model-manager">
                    <div className={styles.browserDeviceSummary}>
                      <strong>WebLLM 離線生成引擎</strong>
                      <span>裝置等級 {browserWebLlm.device.tier} · {browserWebLlm.cacheBackend.toUpperCase()} 快取</span>
                      <small>
                        WebGPU {browserWebLlm.device.webGpu ? "可用" : "不可用"} · 記憶體 {browserWebLlm.device.deviceMemoryGB ? `${browserWebLlm.device.deviceMemoryGB} GB` : "瀏覽器未提供"} · {browserWebLlm.device.hardwareConcurrency ?? "—"} 核心 · 可用空間 {formatBytes(browserWebLlm.device.storageAvailable)}
                      </small>
                    </div>
                    <p className={styles.browserModelTruth}>
                      第一次安裝會連網且只由你明確啟動；完成後會逐一核對每個權重分片的大小與 SHA-256。任一分片不符即刪除並禁止啟用，驗證完成後推理可留在裝置。
                    </p>
                    {browserWebLlm.models.some((item) => item.selected && item.installStatus === "ready" && item.cacheVerified) ? <div className={styles.modelActions}>
                      <button type="button" disabled={runtimeBusy} onClick={() => void prewarmBrowserModel()}>
                        {browserWebLlm.performance.engineWarm ? "模型已預熱" : "從離線快取預熱"}
                      </button>
                      {runtimeBusy && browserModelOperation ? <button type="button" onClick={stopBrowserModelInstall}>停止</button> : null}
                    </div> : null}
                    <div className={styles.browserModelList}>
                      {BROWSER_WEBLLM_MODELS.map((manifest) => {
                        const state = browserWebLlm.models.find((item) => item.modelId === manifest.modelId);
                        const progress = browserWebLlmProgress?.modelId === manifest.modelId
                          ? browserWebLlmProgress
                          : null;
                        const ready = state?.installStatus === "ready" && state.cacheVerified;
                        const researchOnly = manifest.usePolicy === "research-only";
                        const statusText = ready
                          ? state?.selected ? "使用中" : "已安裝"
                          : researchOnly
                            ? state?.cachePresent ? "研究版快取已保留" : "正式版未啟用"
                            : state?.cacheComplete
                              ? "完整快取待驗證"
                              : state?.cachePresent
                                ? `已保留 ${state.cachedShardCount}/${state.expectedShardCount} 分片`
                                : state?.installStatus === "error" ? "需重試" : "未安裝";
                        return <div
                          className={styles.browserModelCard}
                          data-selected={state?.selected || undefined}
                          data-testid={`browser-webllm-model-${manifest.parameterLabel}`}
                          key={manifest.modelId}
                        >
                          <div>
                            <strong>{manifest.displayName}</strong>
                            <span>{statusText}</span>
                          </div>
                          <small>
                            約 {formatBytes(manifest.estimatedDownloadBytes)} · 顯存約 {Math.round(manifest.estimatedVramMB)} MB · {manifest.license}
                          </small>
                          <code title={manifest.modelDigest}>digest {manifest.modelDigest.slice(0, 16)}…</code>
                          <small title={manifest.sourceRevision}>版本 {manifest.sourceRevision.slice(0, 12)}… · 4,096 tokens</small>
                          <small>
                            分片完整性：{state?.shardIntegrityVerified
                              ? `${state.verifiedShardCount} 個分片已驗證`
                              : "尚未驗證"}
                          </small>
                          <small data-testid={`browser-webllm-cache-${manifest.parameterLabel}`}>
                            裝置快取：{state?.cachePresent
                              ? `${formatBytes(state.cachedBytes)} · ${state.cachedShardCount}/${state.expectedShardCount} 分片`
                              : "尚無權重快取"}。切換模型只釋放顯存，不會刪除權重。
                          </small>
                          {researchOnly ? <small className={styles.modelError}>
                            此模型使用 Qwen Research License，正式版不會啟用；
                            <a href={manifest.licenseUrl} target="_blank" rel="noreferrer">查看官方授權</a>。
                          </small> : null}
                          {state?.generationCount ? <small>
                            已完成 {state.generationCount} 次 · 平均首字 {state.averageFirstTokenMs ?? "—"} ms · 平均 {state.averageTokensPerSecond?.toFixed(2) ?? "—"} tokens/s
                          </small> : null}
                          {progress && progress.phase !== "ready" ? <div className={styles.modelProgress}>
                            <progress max={1} value={progress.progress} />
                            <small>{Math.round(progress.progress * 100)}% · {progress.text}</small>
                          </div> : null}
                          {state?.lastError ? <small className={styles.modelError}>{state.lastError}</small> : null}
                          <div className={styles.modelActions}>
                            {!ready && !researchOnly ? <button
                              type="button"
                              disabled={runtimeBusy || !state?.allowed}
                              title={!state?.allowed ? "此模型未通過目前裝置 Gate" : undefined}
                              onClick={() => void installBrowserModel(manifest.modelId)}
                            >
                              {state?.cacheComplete
                                ? "驗證本機快取"
                                : state?.cachePresent
                                  ? "繼續缺少檔案"
                                  : state?.installStatus === "error" ? "重新安裝" : "安裝模型"}
                            </button> : ready ? <>
                              <button
                                type="button"
                                disabled={runtimeBusy || state?.selected || !state?.allowed}
                                onClick={() => void chooseBrowserModel(manifest.modelId)}
                              >
                                {state?.selected ? "目前使用" : "選用"}
                              </button>
                              <button
                                type="button"
                                disabled={runtimeBusy}
                                onClick={() => void removeBrowserModel(manifest.modelId)}
                              >刪除</button>
                            </> : state?.cachePresent ? <button
                              type="button"
                              disabled={runtimeBusy}
                              onClick={() => void removeBrowserModel(manifest.modelId)}
                            >刪除研究版快取</button> : null}
                            {runtimeBusy && progress && browserModelOperation === "install" ? <button
                              type="button"
                              onClick={stopBrowserModelInstall}
                            >停止安裝</button> : null}
                          </div>
                        </div>;
                      })}
                    </div>
                    {browserWebLlm.lastGeneration ? <p className={styles.runtimeMetrics} data-testid="browser-webllm-last-generation">
                      最近真實推理：{browserWebLlm.lastGeneration.modelId} · 首字 {browserWebLlm.lastGeneration.firstTokenMs ?? "—"} ms · {browserWebLlm.lastGeneration.tokensPerSecond?.toFixed(2) ?? "—"} tokens/s · 排隊 {browserWebLlm.lastGeneration.queueWaitMs} ms · {browserWebLlm.lastGeneration.engineReused ? "重用預熱引擎" : "新載入引擎"} · 脈絡省略 {browserWebLlm.lastGeneration.omittedInputCharacters} 字 · {Math.round(browserWebLlm.lastGeneration.estimatedVramMB)} MB · 資料未離開裝置
                    </p> : null}
                    <p className={styles.runtimeMetrics} data-testid="browser-gpu-queue-status">
                      GPU Queue：{browserWebLlm.performance.activeGeneration ? "執行中" : "閒置"} · 等待 {browserWebLlm.performance.queuedGenerations} · Worker 重啟 {browserWebLlm.performance.workerRestartCount} · Device lost {browserWebLlm.performance.gpuDeviceLostCount}
                    </p>
                    <p className={styles.runtimeMetrics} data-testid="browser-webllm-performance-policy">
                      效能策略：Web Worker 單列生成 · 引擎重用 {browserWebLlm.performance.engineReuseCount} 次 · 等待工作 {browserWebLlm.performance.queuedGenerations} · 預熱 {browserWebLlm.performance.warmupCount} 次
                    </p>
                  </div> : null}
                  {browserSemantic ? <div className={styles.browserModelManager} data-testid="browser-semantic-model-manager">
                    <div className={styles.browserDeviceSummary}>
                      <strong>Transformers.js 小說語意引擎</strong>
                      <span>{(browserSemantic.model.device ?? browserSemantic.device.device)?.toUpperCase() ?? "不支援"} · CacheStorage＋IndexedDB</span>
                      <small>
                        分層 RAG、Semantic Cache、Story Bible／角色／章節檢索排序；不負責冒充生成式 LLM。
                      </small>
                    </div>
                    <div
                      className={styles.browserModelCard}
                      data-selected={browserSemantic.model.cacheVerified || undefined}
                      data-testid="browser-semantic-model"
                    >
                      <div>
                        <strong>{BROWSER_SEMANTIC_MODEL.displayName}</strong>
                        <span>{browserSemantic.model.cacheVerified
                          ? "已驗證"
                          : browserSemantic.model.installStatus === "error"
                            ? "需重試"
                            : browserSemantic.model.installStatus === "installing"
                              ? "安裝中"
                              : "未安裝"}</span>
                      </div>
                      <small>
                        約 {formatBytes(BROWSER_SEMANTIC_MODEL.estimatedDownloadBytes)} · {BROWSER_SEMANTIC_MODEL.embeddingDimensions} 維 · {BROWSER_SEMANTIC_MODEL.dtype.toUpperCase()} · {BROWSER_SEMANTIC_MODEL.license}
                      </small>
                      <code title={BROWSER_SEMANTIC_MODEL.modelDigest}>digest {BROWSER_SEMANTIC_MODEL.modelDigest.slice(0, 16)}…</code>
                      <small title={BROWSER_SEMANTIC_MODEL.sourceRevision}>
                        不可變版本 {BROWSER_SEMANTIC_MODEL.sourceRevision.slice(0, 12)}… · 權重與 tokenizer SHA-256
                      </small>
                      {browserSemanticProgress && browserSemanticProgress.phase !== "ready" ? <div className={styles.modelProgress}>
                        <progress max={1} value={browserSemanticProgress.progress} />
                        <small>{Math.round(browserSemanticProgress.progress * 100)}% · {browserSemanticProgress.text}</small>
                      </div> : null}
                      {browserSemantic.model.lastError ? <small className={styles.modelError}>{browserSemantic.model.lastError}</small> : null}
                      <div className={styles.modelActions}>
                        {!browserSemantic.model.cacheVerified ? <button
                          type="button"
                          disabled={runtimeBusy || !browserSemantic.supported}
                          title={!browserSemantic.supported ? browserSemantic.reason : undefined}
                          onClick={() => void installSemanticModel()}
                        >
                          {browserSemantic.model.installStatus === "error" ? "清除快取並重新安裝" : "安裝語意模型"}
                        </button> : <>
                          <button type="button" disabled={runtimeBusy} onClick={() => void testSemanticModel()}>
                            實際測試語意排序
                          </button>
                          <button type="button" disabled={runtimeBusy} onClick={() => void removeSemanticModel()}>
                            刪除
                          </button>
                        </>}
                        {runtimeBusy && browserSemanticOperation === "install" ? <button
                          type="button"
                          onClick={stopSemanticModelInstall}
                        >停止安裝</button> : null}
                      </div>
                      {browserSemantic.lastRanking ? <p className={styles.runtimeMetrics} data-testid="browser-semantic-last-ranking">
                        最近檢索：{browserSemantic.lastRanking.device.toUpperCase()} · {browserSemantic.lastRanking.elapsedMs} ms · {browserSemantic.lastRanking.items} 筆 · {browserSemantic.lastRanking.cacheHit ? "Cache 命中" : "向量推理"} · 資料未離開裝置
                      </p> : null}
                      <small>
                        Semantic Cache {browserSemantic.cache.entries} 筆；只存分數與雜湊，不存原文，不會寫入 Memory、Learning 或 Canon。
                      </small>
                    </div>
                  </div> : null}
                  {browserProof ? <p className={styles.proof}>
                    {browserProof.inferenceMode === "generative-model"
                      ? "生成模型實測"
                      : "輕量任務模型實測"} {browserProof.latencyMs} ms · <code>{browserProof.outputDigest.slice(0, 12)}…</code>
                  </p> : null}
                  <button
                    type="button"
                    disabled={runtimeBusy || browserCapability?.status !== "ready"}
                    onClick={() => void verifyBrowserRuntime()}
                  >
                    實際測試瀏覽器模型
                  </button>
                  <button
                    type="button"
                    disabled={runtimeBusy || browserCapability?.status !== "ready"}
                    onClick={() => void testBrowserPipeline()}
                  >
                    一鍵實測 Browser AI 全管線
                  </button>
                </div> : null}
                {snapshot.id === "local-ollama" ? <div className={styles.runtimeControls}>
                  {passwordlessConnectionEnabled ? <>
                    <p className={localClient.getSessionMetadata() ? styles.proof : styles.warning} data-testid="local-ai-direct-connection">
                      {localClient.getSessionMetadata()
                        ? "免密碼自動連線已完成；本頁使用 Origin 綁定的短期工作階段。"
                        : "尚未偵測到 Local Bridge；安裝並啟動 Companion 後，本頁會直接連線。"}
                    </p>
                    <p
                      className={localVersionStatus === "current" ? styles.proof : styles.warning}
                      data-testid="local-ai-version-status"
                    >
                      Local Bridge：{localRuntimeVersion ?? "未偵測"} · 建議版本 {LOCAL_AI_COMPANION_RELEASE.recommendedBridgeVersion}
                      {localVersionStatus === "current"
                        ? " · 已是相容最新版"
                        : localVersionStatus === "incompatible"
                          ? " · 版本不相容，必須更新"
                          : localVersionStatus === "update_available"
                            ? " · 有新版可更新"
                            : " · 啟動後會自動核對版本"}
                    </p>
                    {localVersionStatus !== "current" ? <a
                      className={styles.secondaryLink}
                      data-testid="local-ai-companion-update"
                      download={LOCAL_AI_COMPANION_RELEASE.filename}
                      href={LOCAL_AI_COMPANION_RELEASE.downloadPath}
                    >
                      下載／更新本機 AI Companion {LOCAL_AI_COMPANION_RELEASE.version}
                    </a> : null}
                    {!localClient.getSessionMetadata() ? <button
                      type="button"
                      data-testid="local-ai-auto-connect"
                      disabled={runtimeBusy}
                      onClick={() => void connectRuntimesAutomatically()}
                    >
                      重新自動連線
                    </button> : null}
                  </> : <>
                    <code>node local-ai/bridge/launcher.mjs start</code>
                    {!localClient.getSessionMetadata() ? <>
                      {!localPairing ? <button type="button" disabled={runtimeBusy} onClick={() => void requestLocalPairing()}>
                        開始 Local Bridge 配對
                      </button> : <>
                        <code>node local-ai/bridge/launcher.mjs pair</code>
                        <label>六位數一次性配對碼
                          <input
                            value={localPairing.code}
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={6}
                            onChange={(event) => setLocalPairing({
                              ...localPairing,
                              code: event.target.value.replace(/\D/g, "").slice(0, 6),
                            })}
                          />
                        </label>
                        <button type="button" disabled={runtimeBusy || localPairing.code.length !== 6} onClick={() => void confirmLocalPairing()}>
                          配對並實測模型
                        </button>
                      </>}
                    </> : null}
                  </>}
                  {localClient.getSessionMetadata() ? <>
                    {localModelId ? <p className={styles.proof}>
                      自動選定模型：{localModelId}；協調器只會採用已通過真實推理與模型雜湊驗證的版本。
                    </p> : null}
                    {localProof ? <p className={styles.proof}>
                      推理已驗證 {localProof.latencyMs} ms · <code>{localProof.outputDigest.slice(0, 12)}…</code>
                    </p> : <p className={styles.warning}>自動協調器正在等待本機模型完成真實推理驗證。</p>}
                    {localTelemetry ? <p className={styles.runtimeMetrics}>
                      控制面 {localTelemetry.controlLatencyMs} ms · 執行 {localTelemetry.active}/{localTelemetry.maxConcurrent} · 排隊 {localTelemetry.queued}/{localTelemetry.maxQueue} · Cache {localTelemetry.cacheEntries}
                    </p> : null}
                    <button className={styles.secondary} type="button" disabled={runtimeBusy} onClick={() => void revokeLocalPairing()}>
                      撤銷這個網站的本機連線
                    </button>
                  </> : null}
                </div> : null}
                {snapshot.id === "private-ai-hub" ? <div className={styles.runtimeControls}>
                  <p>自架型本機私有節點；與 Local Ollama 有獨立身分、短期工作階段、工作佇列與訓練模型。</p>
                  {passwordlessConnectionEnabled ? <>
                    <p className={hubClient.getSessionMetadata() ? styles.proof : styles.warning} data-testid="private-hub-direct-connection">
                      {hubClient.getSessionMetadata()
                        ? "免密碼自動連線已完成；Private Hub 使用獨立的 Origin 綁定短期工作階段。"
                        : "尚未偵測到 Private Hub；啟動 Companion 後，本頁會直接連線。"}
                    </p>
                    <p
                      className={hubVersionStatus === "current" ? styles.proof : styles.warning}
                      data-testid="private-hub-version-status"
                    >
                      Private Hub：{hubRuntimeVersion ?? "未偵測"} · 建議版本 {LOCAL_AI_COMPANION_RELEASE.recommendedPrivateHubVersion}
                      {hubVersionStatus === "current"
                        ? " · 已是相容最新版"
                        : hubVersionStatus === "incompatible"
                          ? " · 版本不相容，必須更新"
                          : hubVersionStatus === "update_available"
                            ? " · 有新版可更新"
                            : " · 啟動後會自動核對版本"}
                    </p>
                    {!hubClient.getSessionMetadata() ? <button
                      type="button"
                      data-testid="private-hub-auto-connect"
                      disabled={runtimeBusy}
                      onClick={() => void connectRuntimesAutomatically()}
                    >
                      重新自動連線
                    </button> : null}
                  </> : <>
                    <code>node local-ai/private-hub/launcher.mjs start</code>
                    {!hubClient.getSessionMetadata() ? <>
                      {!hubPairing ? <button type="button" disabled={runtimeBusy} onClick={() => void requestHubPairing()}>
                        開始 Private Hub 配對
                      </button> : <>
                        <code>node local-ai/private-hub/launcher.mjs pair</code>
                        <label>六位數一次性配對碼
                          <input
                            value={hubPairing.code}
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={6}
                            onChange={(event) => setHubPairing({
                              ...hubPairing,
                              code: event.target.value.replace(/\D/g, "").slice(0, 6),
                            })}
                          />
                        </label>
                        <button type="button" disabled={runtimeBusy || hubPairing.code.length !== 6} onClick={() => void confirmHubPairing()}>
                          配對並實測中樞模型
                        </button>
                      </>}
                    </> : null}
                  </>}
                  {hubClient.getSessionMetadata() ? <>
                    {hubModelId ? <p className={styles.proof}>
                      自動選定中樞模型：{hubModelId}；重型任務只使用已驗證且授權允許的版本。
                    </p> : null}
                    {hubProof ? <p className={styles.proof}>
                      中樞推理已驗證 {hubProof.latencyMs} ms · <code>{hubProof.outputDigest.slice(0, 12)}…</code>
                    </p> : <p className={styles.warning}>自動協調器正在等待中樞模型完成真實推理驗證。</p>}
                    {hubTelemetry ? <p className={styles.runtimeMetrics}>
                      控制面 {hubTelemetry.controlLatencyMs} ms · 執行 {hubTelemetry.active}/{hubTelemetry.maxConcurrent} · 排隊 {hubTelemetry.queued}/{hubTelemetry.maxQueue} · 加密 Cache {hubTelemetry.cacheEntries}
                    </p> : null}
                    <button className={styles.secondary} type="button" disabled={runtimeBusy} onClick={() => void revokeHubPairing()}>
                      撤銷這個網站的中樞連線
                    </button>
                  </> : null}
                </div> : null}
              </article>
            ))}
          </div>
          <div className={styles.fleetBoard}>
            <div className={styles.fleetHeading}>
              <div>
                <small>AUTOMATIC MODEL FLEET</small>
                <h3>協調器內部模型排序</h3>
              </div>
              <span>自動依任務、證明與資料邊界選定</span>
            </div>
            {localFleet.length || hubFleet.length ? (
              <div className={styles.fleetList}>
                {[...new Map(
                  [...localFleet, ...hubFleet].map((profile) => [profile.modelId, profile]),
                ).values()].slice(0, 5).map((profile, index) => (
                  <article key={profile.modelId} data-recommended={profile.modelId === recommendedFleetModel?.modelId}>
                    <div>
                      <span>{profile.modelId === recommendedFleetModel?.modelId ? "推薦" : `#${index + 1}`}</span>
                      <strong>{profile.modelId}</strong>
                      <b>{profile.score}%</b>
                    </div>
                    <p>{modelSummary(profile)}</p>
                    <small>{profile.contextLength
                      ? `${profile.contextLength.toLocaleString()} tokens`
                      : "上下文未回報"} · {formatModelSize(profile.diskSizeBytes)}</small>
                  </article>
                ))}
              </div>
            ) : <p className={styles.fleetEmpty}>連線 Local Bridge 或 Private Hub 後，協調器會依工作難度、參數量、上下文、授權與真實推理證明自動選定已安裝模型。</p>}
          </div>
          <details>
            <summary>能力真相與限制</summary>
            <ul>
              <li>Browser AI 不承擔長篇推理或多代理工作。</li>
              <li>Local Ollama 需要本機 Bridge、配對與可用模型。</li>
              <li>Private AI Hub 可連接自架 loopback 私有節點；節點未啟動、未配對或未實測時，不宣稱已連線。</li>
              <li>協調器會在執行前自動選定可用算力；後端與模型一旦鎖定，失敗就停止，不在執行中暗中切換。</li>
              <li>Cache、學習、證據、回滾與 Canon 核准由同一協調器治理，但各資料範圍仍維持隔離。</li>
            </ul>
          </details>
        </section>

        <section className={`${styles.panel} ${styles.taskPanel}`} aria-labelledby="story-entry-title" data-testid="closed-ai-story-route">
          <div className={styles.panelHeading}>
            <div><small>唯一故事入口</small><h2 id="story-entry-title">故事創作請回故事工作台</h2></div>
            <span>本頁只管理自動協調器</span>
          </div>
          <p>續寫、改寫、章節分析、RPG 與 A／B／C 都由故事工作台呼叫同一個閉端 AI 自動協調器。</p>
          <p data-testid="closed-ai-management-boundary">本頁不建立故事候選、不核准正文，也不直接寫入 Canon；只提供算力設定、狀態、證據、Cache 與學習治理。</p>
          <div className={styles.actions}>
            <Link className={styles.primary} data-testid="closed-ai-open-story-workspace" href={`/studio/project/${projectId}/chat`}>前往唯一故事工作台</Link>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.coordinatorGovernance}`} aria-labelledby="system-title">
          <div className={styles.panelHeading}>
            <div><small>同一自動協調器 · 治理職能</small><h2 id="system-title">Cache、學習、證據與回滾</h2></div>
            <span>供故事工作台共用，資料範圍仍隔離</span>
          </div>
          <div className={styles.metricGrid}>
            <article><small>AI Cache</small><strong>{dashboard?.cache.entries ?? 0}</strong><span>筆本機候選</span></article>
            <article><small>待核准</small><strong>{dashboard?.queue.awaitingApproval ?? 0}</strong><span>項工作</span></article>
            <article><small>已核准記憶</small><strong>{dashboard?.approvedMemoryRecords ?? 0}</strong><span>筆</span></article>
            <article><small>學習候選</small><strong>{dashboard?.learning.candidates ?? 0}</strong><span>筆</span></article>
          </div>

          <div className={styles.systemGroup}>
            <h3>六層 AI Cache</h3>
            <div className={styles.chips}>
              {["精確", "語意", "檢索", "代理計畫", "工具結果", "模型工作階段"].map((label) => <span key={label}>{label}</span>)}
            </div>
            <p>Cache 不是記憶，也不會直接改 Canon；所有項目都綁定完整命名空間。</p>
            <button className={styles.secondary} type="button" disabled={busy} onClick={() => void clearProjectCache()}>只清除此作品快取</button>
          </div>

          <div className={styles.systemGroup}>
            <h3>可控自我學習</h3>
            <p>文章與 AI 輸出先在規則中心抽象並逐條核准；本區只套用通過版本化、A/B 與回滾治理的 L0／L1 設定。</p>
            <p data-testid="controlled-learning-consent-status">
              {dashboard?.learning.consentEnabled && !dashboard.learning.killSwitchEngaged
                ? "本作品學習已開啟；核准資料才會形成可回滾的 L0／L1 候選。"
                : dashboard?.learning.killSwitchEngaged
                  ? "本作品學習目前已停止。"
                  : "本作品學習尚未開啟。"}
            </p>
            <div className={styles.actions}>
              <Link className={styles.secondaryLink} href={`/studio/project/${projectId}/learning`}>開啟規則學習中心</Link>
              <button
                type="button"
                disabled={busy || Boolean(dashboard?.learning.consentEnabled && !dashboard.learning.killSwitchEngaged)}
                onClick={() => void enableLearning()}
              >
                {dashboard?.learning.consentEnabled && !dashboard.learning.killSwitchEngaged
                  ? "本作品學習已開啟"
                  : dashboard?.learning.killSwitchEngaged
                    ? "重新開啟本作品學習"
                    : "開啟本作品學習同意"}
              </button>
              <button className={styles.danger} type="button" disabled={busy} onClick={() => void engageKillSwitch()}>緊急停止學習</button>
              <button className={styles.secondary} type="button" disabled={busy} onClick={() => void exportLearning()}>匯出</button>
              <button className={styles.secondary} type="button" disabled={busy} onClick={() => void deleteLearning()}>刪除</button>
            </div>
          </div>

          <div className={styles.systemGroup} id="training">
            <h3>正式私有訓練資料與偏好模型</h3>
            <p>先封印權利、範圍、隱私、樣本雜湊與品質 Gate，再由 Private Hub 驗證清單並訓練可回滾 Adapter。這不會冒充尚未完成的大型 LLM 權重微調。</p>
            {!hubProof ? <p className={styles.warning}>先啟動、配對並實測 Private Hub 模型，才可訓練。</p> : <>
              <label>我喜歡的寫法
                <textarea rows={3} value={preferredExample} onChange={(event) => setPreferredExample(event.target.value)} placeholder="貼入你有權使用、且希望模型偏好的短例子。" />
              </label>
              <label>我不採用的寫法
                <textarea rows={3} value={rejectedExample} onChange={(event) => setRejectedExample(event.target.value)} placeholder="貼入同一目的但你不採用的寫法。" />
              </label>
              <div className={styles.actions}>
                <button className={styles.secondary} type="button" disabled={runtimeBusy} onClick={addPreferencePair}>加入偏好對照</button>
                <button className={styles.secondary} type="button" disabled={runtimeBusy || preferencePairs.length < 2 || !trainingRightsConfirmed} onClick={() => void sealTrainingDataset()}>
                  封印正式資料集
                </button>
                <button type="button" disabled={runtimeBusy || !trainingManifest} onClick={() => void trainPreferenceModel()}>
                  驗證清單並訓練
                </button>
              </div>
              <label className={styles.rightsCheck}>
                <input
                  type="checkbox"
                  checked={trainingRightsConfirmed}
                  onChange={(event) => {
                    setTrainingRightsConfirmed(event.target.checked);
                    setTrainingManifest(null);
                  }}
                />
                <span>我確認這些訓練文字由我擁有或已獲明確授權，只供此作品的私有個人化使用。</span>
              </label>
              {preferencePairs.length ? <ul className={styles.compactList}>
                {preferencePairs.map((pair, index) => <li key={pair.id}>
                  第 {index + 1} 組 · 喜歡 {pair.chosen.length} 字／不採用 {pair.rejected.length} 字
                  <button className={styles.inlineButton} type="button" disabled={runtimeBusy} onClick={() => {
                    setPreferencePairs((current) => current.filter((item) => item.id !== pair.id));
                    setTrainingManifest(null);
                  }}>移除</button>
                </li>)}
              </ul> : null}
              {trainingManifest ? <article className={styles.datasetManifest}>
                <div><span>SEALED DATASET</span><strong>{trainingManifest.datasetId}</strong></div>
                <p>{trainingManifest.sampleCount} 組 · 專案私有 · 權利已確認 · 憑證掃描通過</p>
                <code>{trainingManifest.manifestHash}</code>
                <small>只封印雜湊、血緣與治理資料；模型成果不保存或回傳原始範例。</small>
              </article> : null}
            </>}
            {trainingCandidate ? <article className={styles.trainingArtifact}>
              <strong>已訓練候選：{trainingCandidate.modelId}</strong>
              <span>資料集 {trainingCandidate.datasetDigest.slice(0, 12)}… · 成果 {trainingCandidate.artifactDigest.slice(0, 12)}…</span>
              <span>資料治理：{trainingCandidate.datasetGovernance === "formal_manifest_verified" ? "正式清單已由 Private Hub 驗證" : "舊版明確確認流程"}</span>
              <span>全部對照準確率 {Math.round((trainingCandidate.metrics.allPairAccuracy ?? 0) * 100)}% · loss {trainingCandidate.metrics.finalLoss}</span>
              <button type="button" disabled={runtimeBusy} onClick={() => void activatePreferenceModel(trainingCandidate)}>人工確認並啟用</button>
            </article> : null}
            {trainingModels.length ? <div className={styles.trainingModels}>
              {trainingModels.map((model) => <article key={model.modelId} data-active={model.status === "active"}>
                <strong>{model.modelId}</strong>
                <span>{model.status === "active" ? "目前作用中" : "候選"} · {model.createdAt}</span>
                <span>artifact <code>{model.artifactDigest.slice(0, 12)}…</code></span>
                {model.status !== "active" ? <button className={styles.secondary} type="button" disabled={runtimeBusy} onClick={() => void activatePreferenceModel(model)}>啟用此版本</button> : null}
              </article>)}
              {trainingModels.length > 1 && trainingModels.some((model) => model.status === "active") ? <button className={styles.secondary} type="button" disabled={runtimeBusy} onClick={() => void rollbackPreferenceModel()}>回滾上一個偏好模型</button> : null}
            </div> : null}
          </div>

          <div className={styles.systemGroup}>
            <h3>區塊鏈式可驗證機制</h3>
            <p>Blockchain-inspired verifiable architecture：使用 Append-only Audit Log、SHA-256 雜湊鏈、Merkle Tree、ECDSA 核准簽章、範圍隔離的內容定址、不可竄改證據與資料血緣追蹤。</p>
            <p>這是單一閉端 AI 自動協調器管理多種內部算力資源；不是多個 AI 或多個節點共同維護一條鏈，也不使用投票、重型共識、完整資料複製、公開帳本或每次生成的區塊鏈成本。</p>
            <button className={styles.secondary} type="button" disabled={busy} onClick={exportGovernanceEvidence}>匯出治理證據</button>
          </div>

          <details>
            <summary>技術狀態</summary>
            <ul>
              <li>Local Bridge Model：{localProof ? "inference_verified" : "runtime_or_pairing_required"}</li>
              <li>Browser AI：{browserCapability?.status ?? "device_probe_required"}{browserProof ? " / inference_verified" : ""}</li>
              <li>Private Hub Runtime：{hubProof ? "self_hosted_private_node_ready" : "contract_ready_runtime_not_connected"}</li>
              <li>網際網路：{networkOnline ? "online" : "offline"}；離線 Service Worker：{offlineWorkerControlled ? "controlled" : "installing_or_reload_required"}</li>
              <li>離線偏好模型訓練：{trainingModels.length ? "trained_artifact_available" : "implementation_ready_no_approved_dataset"}</li>
              <li>L2 Preference Adapter：{trainingModels.some((model) => model.status === "active") ? "active" : "candidate_or_not_trained"}</li>
              <li>LLM 權重訓練：started／full_weight_smoke_verified／LoRA candidate_ready</li>
              <li>模型蒸餾：started／local_qwen_teacher_to_smol_lora_student</li>
              <li>QLoRA：hardware_blocked_no_cuda（本機無 NVIDIA GPU，不冒充 CPU LoRA）</li>
              <li>思考鏈保存：false</li>
              <li>代理直接 Shell／DB／檔案／網路權限：false</li>
            </ul>
          </details>
        </section>
      </div>
    </main>
  );
}
