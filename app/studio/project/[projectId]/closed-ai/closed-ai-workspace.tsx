"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CLOSED_AI_BACKEND_IDS,
  ClosedAgentOS,
  type ClosedAIBackendId,
  type ClosedAIBackendSnapshot,
  type ClosedAgentExecutionResult,
} from "@/lib/novel-ai/closed-agent-os";
import type { ClosedAINamespace } from "@/lib/novel-ai/closed-ai-cache";
import {
  detectBrowserAI,
  getBrowserAIInferenceProof,
  verifyBrowserAI,
  type BrowserAICapability,
  type BrowserAIInferenceProof,
} from "@/lib/novel-ai/providers/browser-ai/browser-ai-provider";
import {
  LocalBridgeClient,
  configureLocalBridgeClient,
  configureLocalBridgeModel,
  selectAvailableTextModel,
  type LocalModelInferenceProof,
  type LocalTextModel,
} from "@/lib/novel-ai/providers/local-ollama/local-bridge-client";
import { resolveCurrentStudioOrigin } from "@/lib/novel-ai/providers/local-ollama/studio-origin";
import {
  PrivateHubClient,
  configurePrivateHubClient,
  configurePrivateHubModel,
  configurePrivateHubProject,
  type OfflinePreferenceModelArtifact,
  type PrivateHubInferenceProof,
} from "@/lib/novel-ai/providers/private-ai-hub/private-hub-client";
import type { PlatformTaskType } from "@/lib/novel-ai/router/platform-types";
import ProjectNavigation from "../project-navigation";
import styles from "./closed-ai.module.css";

type Dashboard = Awaited<ReturnType<ClosedAgentOS["dashboard"]>>;
type PairingRequest = { pairingId: string; code: string };
type PreferencePair = { id: string; chosen: string; rejected: string };

const TASKS: Array<{
  id: PlatformTaskType;
  label: string;
  complexity: "light" | "standard" | "heavy";
  hint: string;
}> = [
  { id: "story.summary", label: "章節摘要", complexity: "light", hint: "適合瀏覽器 AI" },
  { id: "character.dialogueConsistency", label: "角色對話檢查", complexity: "light", hint: "裝置內輕量檢查" },
  { id: "chapter.continue", label: "小說續寫", complexity: "standard", hint: "適合本機 Ollama" },
  { id: "chapter.rewrite", label: "段落改寫", complexity: "standard", hint: "適合本機 Ollama" },
  { id: "character.dialogue", label: "角色對話生成", complexity: "standard", hint: "適合本機 Ollama" },
  { id: "character.multiAgentSimulation", label: "多角色推演", complexity: "heavy", hint: "需要私有 AI Hub" },
];

const BACKEND_LABELS: Record<ClosedAIBackendId | "auto", string> = {
  auto: "依任務自動選定",
  "browser-ai": "瀏覽器 AI",
  "local-ollama": "個人本機 Ollama",
  "private-ai-hub": "私有 AI Hub",
};

function statusLabel(status: ClosedAIBackendSnapshot["status"]) {
  if (status === "ready") return "模型運作中";
  if (status === "contract_ready_runtime_not_connected") return "安全契約完成，算力未連線";
  if (status === "runtime_required") return "需要本機執行環境";
  if (status === "degraded") return "功能降級";
  return "已停用";
}

function runtimeError(error: unknown) {
  const code = String((error as { code?: string })?.code || "");
  const messages: Record<string, string> = {
    BRIDGE_PROCESS_UNREACHABLE: "本機執行服務尚未啟動，或瀏覽器無法存取 loopback。",
    BRIDGE_NOT_PAIRED: "目前頁面尚未與本機服務完成配對。",
    BRIDGE_PAIRING_EXPIRED: "一次性配對已過期，請重新發起。",
    BRIDGE_PAIRING_REVOKED: "本機配對已撤銷，請重新配對。",
    OLLAMA_UNREACHABLE: "Ollama 尚未啟動。",
    OLLAMA_MODEL_NOT_FOUND: "找不到選定的本機模型。",
    LOCAL_MODEL_INFERENCE_NOT_VERIFIED: "模型尚未完成真實推理驗證。",
    OFFLINE_TRAINING_SAMPLE_MINIMUM: "至少加入兩組喜歡／不採用的寫法。",
    OFFLINE_TRAINING_SAMPLE_INVALID: "每組文字需不同，且每段至少 8 個字元。",
    BROWSER_AI_UNSUPPORTED: "此裝置不支援瀏覽器內建 AI；其他閉端後端不受影響。",
    BROWSER_AI_MODEL_NOT_READY: "此裝置可支援瀏覽器 AI，但裝置模型尚未可用。",
  };
  return messages[code] ?? (error instanceof Error ? error.message : "本機執行操作失敗。");
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

function userMessage(error: unknown) {
  const code = String((error as { code?: string })?.code || "");
  const messages: Record<string, string> = {
    CLOSED_AI_REQUIRED_BACKEND_NOT_READY: "這項工作所需的閉端 AI 尚未就緒；系統沒有暗中換用其他 AI。",
    CLOSED_AI_SELECTED_BACKEND_NOT_READY: "你指定的閉端 AI 目前不能執行這項工作；系統已安全停止。",
    CLOSED_AGENT_PERMISSION_DENIED: "這項代理工作缺少必要權限，已安全停止。",
    CLOSED_AGENT_EVALUATION_BLOCKED: "候選未通過安全與品質評估，沒有進入核准區。",
    CONTROLLED_LEARNING_CONSENT_REQUIRED: "請先開啟這個作品的可控學習同意。",
    CONTROLLED_LEARNING_KILL_SWITCH_ENGAGED: "可控學習緊急停止目前已開啟。",
  };
  return messages[code] ?? (error instanceof Error ? error.message : "操作失敗。");
}

export default function ClosedAIWorkspace({ projectId }: { projectId: string }) {
  const os = useMemo(() => new ClosedAgentOS(), []);
  const [currentOrigin, setCurrentOrigin] = useState<string | null>(null);
  const localClient = useMemo(
    () => new LocalBridgeClient({
      origin: currentOrigin ?? "https://novel-orcin.vercel.app",
    }),
    [currentOrigin],
  );
  const hubClient = useMemo(
    () => new PrivateHubClient({
      origin: currentOrigin ?? "https://novel-orcin.vercel.app",
    }),
    [currentOrigin],
  );
  const [snapshots, setSnapshots] = useState<ClosedAIBackendSnapshot[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [taskType, setTaskType] = useState<PlatformTaskType>("chapter.continue");
  const [backend, setBackend] = useState<ClosedAIBackendId | "auto">("local-ollama");
  const [objective, setObjective] = useState("續寫一段約三百字的繁體中文小說場景，讓人物以行動面對新的選擇與代價。");
  const [storyContext, setStoryContext] = useState("");
  const [result, setResult] = useState<ClosedAgentExecutionResult | null>(null);
  const [status, setStatus] = useState("正在核對三個閉端 AI 與共用系統。");
  const [busy, setBusy] = useState(false);
  const taskController = useRef<AbortController | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState("正在檢查本機執行環境。");
  const [networkOnline, setNetworkOnline] = useState(true);
  const [offlineWorkerControlled, setOfflineWorkerControlled] = useState(false);
  const [browserCapability, setBrowserCapability] = useState<BrowserAICapability | null>(null);
  const [browserProof, setBrowserProof] = useState<BrowserAIInferenceProof | null>(null);
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
      taskController.current?.abort();
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
      promptProfileVersion: "closed-agent-prompt-v1",
      storyBibleRevision: "current",
      knowledgeScopeRevision: "current",
      privacyLevel,
    };
  }, [projectId, snapshots]);

  const namespace = useCallback((): ClosedAINamespace => {
    const complexity = TASKS.find((item) => item.id === taskType)?.complexity ?? "light";
    const automaticBackend: ClosedAIBackendId = complexity === "heavy"
      ? "private-ai-hub"
      : complexity === "standard"
        ? "local-ollama"
        : "browser-ai";
    return namespaceForBackend(backend === "auto" ? automaticBackend : backend);
  }, [backend, namespaceForBackend, taskType]);

  const refreshRuntimes = useCallback(async () => {
    if (!currentOrigin) return;
    setRuntimeStatus("正在檢查三個閉端 AI 的真實執行狀態。");
    const browser = await detectBrowserAI();
    setBrowserCapability(browser);
    setBrowserProof(getBrowserAIInferenceProof());

    let localReady = false;
    try {
      const health = await localClient.health();
      if (health.runtimeReady && localClient.getSessionMetadata()) {
        const response = await localClient.models();
        const available = response.models.filter(
          (model) => model.capabilities?.textGeneration?.value === true,
        );
        const selected = selectAvailableTextModel(
          available,
          localModelId || "qwen2.5:3b",
        ) || "";
        setLocalModels(available);
        setLocalModelId(selected);
        configureLocalBridgeClient(localClient);
        configureLocalBridgeModel(selected || null);
        const proof = selected ? localClient.getModelVerification(selected) : null;
        setLocalProof(proof);
        localReady = Boolean(proof);
      } else {
        setLocalModels([]);
        setLocalProof(null);
        configureLocalBridgeClient(null);
        configureLocalBridgeModel(null);
      }
    } catch {
      setLocalModels([]);
      setLocalProof(null);
      configureLocalBridgeClient(null);
      configureLocalBridgeModel(null);
    }

    let hubReady = false;
    try {
      const health = await hubClient.health();
      if (health.runtimeReady && hubClient.getSessionMetadata()) {
        const response = await hubClient.models();
        const available = response.models.filter(
          (model) => model.capabilities?.textGeneration?.value === true,
        );
        const selected = selectAvailableTextModel(
          available,
          hubModelId || "qwen2.5:3b",
        ) || "";
        setHubModels(available);
        setHubModelId(selected);
        configurePrivateHubClient(hubClient);
        configurePrivateHubModel(selected || null);
        configurePrivateHubProject(projectId);
        const proof = selected ? hubClient.getModelVerification(selected) : null;
        setHubProof(proof);
        const trained = await hubClient.listPreferenceModels(projectId);
        setTrainingModels(trained);
        hubReady = Boolean(proof);
      } else {
        setHubModels([]);
        setHubProof(null);
        setTrainingModels([]);
        configurePrivateHubClient(null);
        configurePrivateHubModel(null);
      }
    } catch {
      setHubModels([]);
      setHubProof(null);
      setTrainingModels([]);
      configurePrivateHubClient(null);
      configurePrivateHubModel(null);
    }
    const browserState = browser.status === "ready"
      ? getBrowserAIInferenceProof()
        ? "瀏覽器模型已實測"
        : "瀏覽器模型可用"
      : browser.status === "runtime_not_installed"
        ? "瀏覽器模型待下載"
        : "此裝置不支援瀏覽器 AI";
    setRuntimeStatus(
      `${browserState}；Local Bridge ${localReady ? "模型已實測" : "等待啟動／配對／實測"}；Private Hub ${hubReady ? "模型已實測" : "等待啟動／配對／實測"}；離線殼 ${offlineWorkerControlled ? "已接管" : "首次快取中"}。`,
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
    const [nextSnapshots, nextDashboard] = await Promise.all([
      os.backendSnapshots(),
      os.dashboard(projectId),
    ]);
    setSnapshots(nextSnapshots);
    setDashboard(nextDashboard);
    if (announce) {
      setStatus("三閉端 AI 與共用 Closed Agent OS 已完成核對。");
    }
  }, [os, projectId, refreshRuntimes]);

  useEffect(() => {
    if (!currentOrigin) return;
    const initialization = window.setTimeout(() => {
      void refresh().catch((error) => setStatus(userMessage(error)));
    }, 0);
    return () => window.clearTimeout(initialization);
  }, [currentOrigin, refresh]);

  async function verifyBrowserRuntime() {
    if (runtimeBusy) return;
    setRuntimeBusy(true);
    setRuntimeStatus("正在要求此裝置的瀏覽器模型實際完成摘要。");
    try {
      const proof = await verifyBrowserAI();
      setBrowserProof(proof);
      setRuntimeStatus(`瀏覽器 AI 已實際回答，耗時 ${proof.latencyMs} ms。`);
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
    configureLocalBridgeModel(null);
    setRuntimeStatus(`正在要求 ${modelId} 實際回答本機驗證題。`);
    const proof = await localClient.verifyModel(modelId);
    configureLocalBridgeClient(localClient);
    configureLocalBridgeModel(modelId);
    setLocalModelId(modelId);
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
      const selected = selectAvailableTextModel(available, "qwen2.5:3b") || "";
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

  async function selectLocalModel(modelId: string) {
    if (runtimeBusy) return;
    setRuntimeBusy(true);
    try {
      await verifyLocalModel(modelId);
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
    configurePrivateHubModel(null);
    setRuntimeStatus(`正在要求 Private Hub 的 ${modelId} 實際回答驗證題。`);
    const proof = await hubClient.verifyModel(modelId);
    configurePrivateHubClient(hubClient);
    configurePrivateHubModel(modelId);
    configurePrivateHubProject(projectId);
    setHubModelId(modelId);
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
      const selected = selectAvailableTextModel(available, "qwen2.5:3b") || "";
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

  async function selectHubModel(modelId: string) {
    if (runtimeBusy) return;
    setRuntimeBusy(true);
    try {
      await verifyHubModel(modelId);
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
    setPreferredExample("");
    setRejectedExample("");
    setRuntimeStatus("偏好對照只保留在目前頁面記憶中；送出訓練後，原文不會寫入模型成果。");
  }

  async function trainPreferenceModel() {
    if (runtimeBusy || preferencePairs.length < 2 || !hubProof || !hubModelId) return;
    setRuntimeBusy(true);
    setRuntimeStatus("正在本機訓練成對偏好模型；原始範例只在這次請求記憶中使用。");
    try {
      const artifact = await hubClient.trainPreferenceModel({
        projectId,
        baseModelId: hubModelId,
        datasetVersion: `author-approved-${new Date().toISOString().slice(0, 10)}`,
        samples: preferencePairs.map(({ chosen, rejected }) => ({ chosen, rejected })),
        hyperparameters: { epochs: 320, learningRate: 0.08, l2: 0.015 },
      });
      const verified = await hubClient.verifyPreferenceModel(projectId, artifact.modelId);
      setTrainingCandidate(verified);
      const trained = await hubClient.listPreferenceModels(projectId);
      setTrainingModels(trained);
      setPreferencePairs([]);
      setRuntimeStatus(
        `離線偏好模型已訓練並驗證：${verified.modelId}；準確率 ${Math.round((verified.metrics.allPairAccuracy ?? 0) * 100)}%，等待你啟用。`,
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

  async function runTask() {
    if (busy || !objective.trim()) return;
    const controller = new AbortController();
    taskController.current = controller;
    setBusy(true);
    setResult(null);
    setStatus("正在鎖定後端、建立計畫、執行並評估候選。");
    const task = TASKS.find((item) => item.id === taskType)!;
    try {
      const next = await os.execute({
        taskId: `closed-agent-${crypto.randomUUID()}`,
        namespace: namespace(),
        taskType,
        objective,
        context: storyContext.trim()
          ? [{
            id: `story-context:${projectId}`,
            kind: "story-bible",
            text: storyContext,
            visibility: "both",
            privacyLevel: namespace().privacyLevel,
            approved: true,
          }]
          : [],
        complexity: task.complexity,
        preferredBackend: backend === "auto" ? undefined : backend,
        allowedToolIds: [],
        permissionScopes: [
          "story:read",
          "story-bible:read",
          "candidate:write",
          "candidate:read",
          "evaluation:write",
          "character:read",
          "world:read",
        ],
        signal: controller.signal,
      });
      setResult(next);
      setStatus(`候選已由${BACKEND_LABELS[next.route.backendId]}完成，通過評估，等待你的核准。`);
      await refresh(false);
    } catch (error) {
      setStatus(controller.signal.aborted ? "這次閉端 AI 工作已取消；未建立候選，也未修改 Canon。" : userMessage(error));
    } finally {
      taskController.current = null;
      setBusy(false);
    }
  }

  function cancelTask() {
    taskController.current?.abort();
    setStatus("正在取消模型工作。");
  }

  async function approve() {
    if (!result || busy) return;
    setBusy(true);
    try {
      const approved = await os.approveCandidate({
        candidateId: result.candidate.id,
        approvedBy: "local-author",
        humanApproved: true,
      });
      setResult({
        ...result,
        candidate: approved.candidate,
      });
      setStatus("核准已簽章並寫入核准記憶；本頁未直接修改 Canon。");
      await refresh(false);
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!result || busy) return;
    setBusy(true);
    try {
      const candidate = await os.rejectCandidate(result.candidate.id);
      setResult({ ...result, candidate });
      setStatus("候選已拒絕，不會寫入記憶或 Canon。");
      await refresh(false);
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      setBusy(false);
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
      setStatus("三個閉端後端的可控學習同意已開啟；仍只接受通過隱私過濾與人工核准的 L0／L1 候選。");
      await refresh(false);
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
      await refresh(false);
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function clearProjectCache() {
    setBusy(true);
    try {
      const result = await os.invalidateCache({ projectId });
      const runtimeNote = result.unavailableBackends.length
        ? `；${result.unavailableBackends.length} 個未連線後端由 namespace 隔離阻止舊資料重用`
        : "";
      setStatus(`已精準清除這個作品的 ${result.totalInvalidated} 筆 AI Cache；其他作品未受影響${runtimeNote}。`);
      await refresh(false);
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function exportEvidence() {
    if (!result) {
      setStatus("請先完成一項任務，才能匯出該任務的不可變證據。");
      return;
    }
    setBusy(true);
    try {
      const evidence = await os.ledger.exportEvidence(
        `closed-agent:${projectId}:${result.task.id}`,
        projectId,
      );
      saveJson(`closed-agent-evidence-${result.task.id}.json`, evidence);
      setStatus("雜湊鏈、Merkle 與簽章驗證通過，證據已匯出。");
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      setBusy(false);
    }
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
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <small>單一系統 · 三個執行後端</small>
          <h1>閉端 AI 指揮中心</h1>
          <p>所有後端共用同一個 Router、Planner、權限、記憶、快取、學習與證據鏈。</p>
        </div>
        <div className={styles.headerActions}>
          <span data-ready={dashboard?.status === "ready"}>Closed Agent OS：{dashboard?.status === "ready" ? "就緒" : "核對中"}</span>
          <button type="button" disabled={busy || runtimeBusy} onClick={() => void refresh()}>重新檢查</button>
        </div>
      </header>

      <ProjectNavigation projectId={projectId} active="closed-ai" />
      <p className={styles.status} role="status" aria-live="polite">{status}</p>
      <p className={styles.runtimeStatus} role="status" aria-live="polite">{runtimeStatus}</p>

      <div className={styles.workspace}>
        <section className={styles.panel} aria-labelledby="backend-title">
          <div className={styles.panelHeading}>
            <div><small>執行層</small><h2 id="backend-title">三個閉端 AI</h2></div>
            <span>並存，不互相取代</span>
          </div>
          <div className={styles.backendList}>
            {snapshots.map((snapshot) => (
              <article key={snapshot.id} data-status={snapshot.status}>
                <div>
                  <strong>{snapshot.label}</strong>
                  <span>{statusLabel(snapshot.status)}</span>
                </div>
                <p>{snapshot.id === "browser-ai"
                  ? "免安裝的輕量摘要、分類與角色檢查。"
                  : snapshot.id === "local-ollama"
                    ? "裝置內續寫、對話、檢索與一般代理任務。"
                    : "私有算力的長上下文、重型與多代理任務。"}</p>
                <dl>
                  <div><dt>資料邊界</dt><dd>{snapshot.dataBoundary === "device" ? "本機裝置" : "私有基礎設施"}</dd></div>
                  <div><dt>最大工作</dt><dd>{snapshot.maximumComplexity}</dd></div>
                  <div><dt>模型</dt><dd>{snapshot.modelId ?? "執行環境未連線"}</dd></div>
                  <div><dt>真相碼</dt><dd>{snapshot.detailCode}</dd></div>
                </dl>
                {snapshot.id === "browser-ai" ? <div className={styles.runtimeControls}>
                  <p>
                    裝置能力：{browserCapability?.status === "ready"
                      ? "內建模型可用"
                      : browserCapability?.status === "runtime_not_installed"
                        ? "支援但模型尚未下載"
                        : "此裝置不支援"}
                  </p>
                  {browserProof ? <p className={styles.proof}>
                    實際推理 {browserProof.latencyMs} ms · <code>{browserProof.outputDigest.slice(0, 12)}…</code>
                  </p> : null}
                  <button
                    type="button"
                    disabled={runtimeBusy || browserCapability?.status !== "ready"}
                    onClick={() => void verifyBrowserRuntime()}
                  >
                    實際測試瀏覽器模型
                  </button>
                </div> : null}
                {snapshot.id === "local-ollama" ? <div className={styles.runtimeControls}>
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
                  </> : <>
                    {localModels.length ? <label>文字模型
                      <select value={localModelId} disabled={runtimeBusy} onChange={(event) => void selectLocalModel(event.target.value)}>
                        {localModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.modelId}</option>)}
                      </select>
                    </label> : null}
                    {localProof ? <p className={styles.proof}>
                      推理已驗證 {localProof.latencyMs} ms · <code>{localProof.outputDigest.slice(0, 12)}…</code>
                    </p> : <button type="button" disabled={runtimeBusy || !localModelId} onClick={() => void selectLocalModel(localModelId)}>
                      實際驗證模型
                    </button>}
                    <button className={styles.secondary} type="button" disabled={runtimeBusy} onClick={() => void revokeLocalPairing()}>
                      撤銷本頁配對
                    </button>
                  </>}
                </div> : null}
                {snapshot.id === "private-ai-hub" ? <div className={styles.runtimeControls}>
                  <p>自架型本機私有節點；與 Local Ollama 有獨立身分、配對、工作佇列與訓練模型。</p>
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
                  </> : <>
                    {hubModels.length ? <label>中樞模型
                      <select value={hubModelId} disabled={runtimeBusy} onChange={(event) => void selectHubModel(event.target.value)}>
                        {hubModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.modelId}</option>)}
                      </select>
                    </label> : null}
                    {hubProof ? <p className={styles.proof}>
                      中樞推理已驗證 {hubProof.latencyMs} ms · <code>{hubProof.outputDigest.slice(0, 12)}…</code>
                    </p> : <button type="button" disabled={runtimeBusy || !hubModelId} onClick={() => void selectHubModel(hubModelId)}>
                      實際驗證中樞模型
                    </button>}
                    <button className={styles.secondary} type="button" disabled={runtimeBusy} onClick={() => void revokeHubPairing()}>
                      撤銷本頁配對
                    </button>
                  </>}
                </div> : null}
              </article>
            ))}
          </div>
          <details>
            <summary>能力真相與限制</summary>
            <ul>
              <li>Browser AI 不承擔長篇推理或多代理工作。</li>
              <li>Local Ollama 需要本機 Bridge、配對與可用模型。</li>
              <li>Private AI Hub 可連接自架 loopback 私有節點；節點未啟動、未配對或未實測時，不宣稱已連線。</li>
              <li>後端一旦鎖定，失敗就停止；不會靜默改用其他 AI。</li>
            </ul>
          </details>
        </section>

        <section className={`${styles.panel} ${styles.taskPanel}`} aria-labelledby="task-title">
          <div className={styles.panelHeading}>
            <div><small>共用工作流</small><h2 id="task-title">交給 Closed Agent OS</h2></div>
            <span>候選先評估，再由你核准</span>
          </div>
          <div className={styles.formGrid}>
            <label>工作類型
              <select value={taskType} onChange={(event) => {
                const next = event.target.value as PlatformTaskType;
                setTaskType(next);
                const task = TASKS.find((item) => item.id === next);
                if (task?.complexity === "heavy") setBackend("private-ai-hub");
                else if (task?.complexity === "standard") setBackend("local-ollama");
                else if (task?.complexity === "light") setBackend("browser-ai");
              }}>
                {TASKS.map((task) => (
                  <option key={task.id} value={task.id}>{task.label} · {task.hint}</option>
                ))}
              </select>
            </label>
            <label>執行後端
              <select value={backend} onChange={(event) => setBackend(event.target.value as ClosedAIBackendId | "auto")}>
                {Object.entries(BACKEND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>
          <label>你要完成什麼？
            <textarea rows={4} value={objective} onChange={(event) => setObjective(event.target.value)} />
          </label>
          <label>已核准的故事脈絡（選填）
            <textarea rows={5} value={storyContext} onChange={(event) => setStoryContext(event.target.value)} placeholder="只貼入你允許 Actor 與 Evaluator 共同看見的故事資料。" />
          </label>
          <div className={styles.actions}>
            <button className={styles.primary} type="button" disabled={busy || !objective.trim()} onClick={() => void runTask()}>
              {busy ? "模型執行中…" : "建立真實模型候選"}
            </button>
            {busy ? <button className={styles.danger} type="button" onClick={cancelTask}>取消模型工作</button> : null}
          </div>

          <div className={styles.candidate} data-empty={!result}>
            {result ? <>
              <header>
                <div>
                  <small>{BACKEND_LABELS[result.candidate.backendId]} · 評分 {Math.round(result.candidate.evaluation.score * 100)}%</small>
                  <h3>{result.candidate.status === "awaiting-approval" ? "等待你的核准" : result.candidate.status}</h3>
                </div>
                <span>Canon 寫入：{result.candidate.canonicalMutationCount}</span>
              </header>
              <div className={styles.candidateText}>{result.candidate.content}</div>
              <div className={styles.actions}>
                {result.candidate.status === "awaiting-approval" ? <>
                  <button type="button" disabled={busy} onClick={() => void approve()}>簽章核准並寫入記憶</button>
                  <button className={styles.secondary} type="button" disabled={busy} onClick={() => void reject()}>拒絕</button>
                </> : null}
                <button className={styles.secondary} type="button" disabled={busy} onClick={() => void exportEvidence()}>匯出驗證證據</button>
              </div>
              <details>
                <summary>執行證明</summary>
                <dl>
                  <div><dt>後端鎖定</dt><dd>{result.route.locked ? "是" : "否"}</dd></div>
                  <div><dt>靜默切換</dt><dd>{result.route.fallbackAttempted ? "有" : "無"}</dd></div>
                  <div>
                    <dt>可控學習</dt>
                    <dd>{result.learning.applied
                      ? `已採用版本 ${result.learning.versionId}`
                      : `未套用（${result.learning.reasonCode ?? "沒有有效版本"}）`}</dd>
                  </div>
                  <div><dt>計畫雜湊</dt><dd>{result.plan.planDigest}</dd></div>
                  <div><dt>生成模型</dt><dd>{result.candidate.modelId}</dd></div>
                  <div><dt>模型雜湊</dt><dd>{result.candidate.modelDigest}</dd></div>
                  {result.candidate.adapterId ? <div><dt>偏好模型</dt><dd>{result.candidate.adapterId}</dd></div> : null}
                  {result.candidate.adapterDigest ? <div><dt>偏好雜湊</dt><dd>{result.candidate.adapterDigest}</dd></div> : null}
                  <div><dt>內容雜湊</dt><dd>{result.candidate.contentDigest}</dd></div>
                  <div><dt>證據鏈 Head</dt><dd>{result.ledgerHeadHash}</dd></div>
                </dl>
              </details>
            </> : <p>完成一項工作後，候選、評估、核准與證據會集中顯示在這裡。</p>}
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="system-title">
          <div className={styles.panelHeading}>
            <div><small>治理層</small><h2 id="system-title">Cache、學習與證據</h2></div>
            <span>三個後端共用</span>
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
            <div className={styles.actions}>
              <Link className={styles.secondaryLink} href={`/studio/project/${projectId}/learning`}>開啟規則學習中心</Link>
              <button type="button" disabled={busy} onClick={() => void enableLearning()}>開啟本作品學習同意</button>
              <button className={styles.danger} type="button" disabled={busy} onClick={() => void engageKillSwitch()}>緊急停止學習</button>
              <button className={styles.secondary} type="button" disabled={busy} onClick={() => void exportLearning()}>匯出</button>
              <button className={styles.secondary} type="button" disabled={busy} onClick={() => void deleteLearning()}>刪除</button>
            </div>
          </div>

          <div className={styles.systemGroup}>
            <h3>離線偏好模型訓練</h3>
            <p>這會在自架 Private Hub 節點訓練成對邏輯回歸風格模型，產出可驗證 Adapter；它會影響重型候選，但不會冒充未執行的 QLoRA／LLM 權重微調。</p>
            {!hubProof ? <p className={styles.warning}>先啟動、配對並實測 Private Hub 模型，才可訓練。</p> : <>
              <label>我喜歡的寫法
                <textarea rows={3} value={preferredExample} onChange={(event) => setPreferredExample(event.target.value)} placeholder="貼入你有權使用、且希望模型偏好的短例子。" />
              </label>
              <label>我不採用的寫法
                <textarea rows={3} value={rejectedExample} onChange={(event) => setRejectedExample(event.target.value)} placeholder="貼入同一目的但你不採用的寫法。" />
              </label>
              <div className={styles.actions}>
                <button className={styles.secondary} type="button" disabled={runtimeBusy} onClick={addPreferencePair}>加入偏好對照</button>
                <button type="button" disabled={runtimeBusy || preferencePairs.length < 2} onClick={() => void trainPreferenceModel()}>
                  訓練 {preferencePairs.length} 組對照
                </button>
              </div>
              {preferencePairs.length ? <ul className={styles.compactList}>
                {preferencePairs.map((pair, index) => <li key={pair.id}>
                  第 {index + 1} 組 · 喜歡 {pair.chosen.length} 字／不採用 {pair.rejected.length} 字
                  <button className={styles.inlineButton} type="button" disabled={runtimeBusy} onClick={() => setPreferencePairs((current) => current.filter((item) => item.id !== pair.id))}>移除</button>
                </li>)}
              </ul> : null}
            </>}
            {trainingCandidate ? <article className={styles.trainingArtifact}>
              <strong>已訓練候選：{trainingCandidate.modelId}</strong>
              <span>資料集 {trainingCandidate.datasetDigest.slice(0, 12)}… · 成果 {trainingCandidate.artifactDigest.slice(0, 12)}…</span>
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
            <p>這是一個 Closed Agent OS 管理三個算力後端；不是三個節點共同維護一條鏈，也不使用投票、重型共識、完整資料複製、公開帳本或每次生成的區塊鏈成本。</p>
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
              <li>QLoRA／LLM 權重訓練：hardware_gate_not_met（本機無 NVIDIA GPU，不宣稱已執行）</li>
              <li>模型蒸餾：not_started</li>
              <li>思考鏈保存：false</li>
              <li>代理直接 Shell／DB／檔案／網路權限：false</li>
            </ul>
          </details>
        </section>
      </div>
    </main>
  );
}
