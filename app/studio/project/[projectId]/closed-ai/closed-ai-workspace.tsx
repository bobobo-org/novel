"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CLOSED_AI_BACKEND_IDS,
  resolveClosedAIRoute,
  type ClosedAgentOS,
  type ClosedAIBackendId,
  type ClosedAIBackendSnapshot,
  type ClosedAIProgressEvent,
  type ClosedAIQualityMode,
  type ClosedAgentCandidate,
  type ClosedAgentExecutionResult,
} from "@/lib/novel-ai/closed-agent-os";
import type {
  Achievement,
  Chapter,
  Character,
  NovelProject,
  StoryBible,
  StoryState,
  TimelineEvent,
  WorldRule,
  WritingTask,
} from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import { commitStudioCandidateToChapter } from "@/lib/novel-ai/web/studio-canonical-approval";
import {
  executeStudioClosedAgent,
  getStudioClosedAgentOS,
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
  installBrowserWebLLMModel,
  prewarmBrowserWebLLMModel,
  selectBrowserWebLLMModel,
  subscribeBrowserWebLLMProgress,
  type BrowserWebLLMProgress,
  type BrowserWebLLMRuntimeSnapshot,
} from "@/lib/novel-ai/providers/browser-ai/browser-webllm-runtime";
import {
  BROWSER_WEBLLM_MODELS,
  type BrowserWebLLMModelId,
} from "@/lib/novel-ai/providers/browser-ai/webllm-model-registry";
import {
  browserSemanticRuntimeSnapshot,
  deleteBrowserSemanticModel,
  installBrowserSemanticModel,
  invalidateBrowserSemanticCache,
  rankWithBrowserSemanticModel,
  subscribeBrowserSemanticProgress,
  type BrowserSemanticProgress,
  type BrowserSemanticRuntimeSnapshot,
} from "@/lib/novel-ai/providers/browser-ai/browser-semantic-runtime";
import {
  BROWSER_SEMANTIC_MODEL,
} from "@/lib/novel-ai/providers/browser-ai/browser-semantic-model-registry";
import {
  configureLocalBridgeClient,
  configureLocalBridgeModel,
  selectAvailableTextModel,
  type LocalModelInferenceProof,
  type LocalTextModel,
} from "@/lib/novel-ai/providers/local-ollama/local-bridge-client";
import { resolveCurrentStudioOrigin } from "@/lib/novel-ai/providers/local-ollama/studio-origin";
import {
  configurePrivateHubClient,
  configurePrivateHubModel,
  configurePrivateHubProject,
  type OfflinePreferenceModelArtifact,
  type PrivateHubInferenceProof,
} from "@/lib/novel-ai/providers/private-ai-hub/private-hub-client";
import type { PlatformTaskType } from "@/lib/novel-ai/router/platform-types";
import {
  describePrivateModelRole,
  rankPrivateModels,
  type PrivateModelFleetProfile,
} from "@/lib/novel-ai/model-orchestration/private-model-fleet";
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

type TaskGroup =
  | "assistant"
  | "writing"
  | "analysis"
  | "character"
  | "world"
  | "game"
  | "learning";

type ClosedAITaskOption = {
  id: PlatformTaskType;
  label: string;
  complexity: "light" | "standard" | "heavy";
  hint: string;
  group: TaskGroup;
  defaultObjective: string;
};

const TASK_GROUP_LABELS: Record<TaskGroup, string> = {
  assistant: "GPT 類通用助理",
  writing: "正文與章節創作",
  analysis: "全書分析與編輯",
  character: "角色與關係",
  world: "世界與規則",
  game: "RPG 三選一與養成",
  learning: "學習與長上下文",
};

const TASKS: ClosedAITaskOption[] = [
  { id: "assistant.general", label: "通用小說助理", complexity: "standard", hint: "問答、規劃、整理", group: "assistant", defaultObjective: "根據已核准的作品資料，直接回答我的小說創作問題；資料不足時指出缺口並提供可執行的下一步。" },
  { id: "assistant.brainstorm", label: "創意腦力激盪", complexity: "standard", hint: "三個真正不同方向", group: "assistant", defaultObjective: "針對目前作品提出三個彼此不同的創意方向；每個方向說明衝突、人物選擇、代價與風險。" },
  { id: "assistant.critique", label: "批判編輯", complexity: "standard", hint: "優點、問題、修法", group: "assistant", defaultObjective: "以專業小說編輯角度審查目前內容，列出亮點、具體問題、讀者影響與優先修正方案。" },
  { id: "assistant.transform", label: "文字整理與轉換", complexity: "standard", hint: "不改動既有事實", group: "assistant", defaultObjective: "整理目前文字，使結構與表達更清楚；保留所有既有事實、角色關係與因果，不新增 Canon。" },
  { id: "chapter.continue", label: "小說續寫", complexity: "standard", hint: "可核准套用章節", group: "writing", defaultObjective: "續寫一段約三百字的繁體中文小說場景，讓人物以行動面對新的選擇與代價。" },
  { id: "chapter.rewrite", label: "段落改寫", complexity: "standard", hint: "可核准取代章節", group: "writing", defaultObjective: "在不改變既有事實與角色意圖的前提下，重寫目前章節，使動作、感官與潛台詞更有張力。" },
  { id: "chapter.expand", label: "場景擴寫", complexity: "standard", hint: "可核准追加章節", group: "writing", defaultObjective: "把目前片段擴寫成完整場景，補足空間、感官、行動、對話潛台詞與可見後果。" },
  { id: "chapter.compress", label: "章節精簡", complexity: "light", hint: "瀏覽器 AI 可離線執行", group: "writing", defaultObjective: "刪除重複、空泛與不推進場景的文字，保留必要事件、角色聲音、因果、伏筆與情緒轉折，產生可核准的精簡候選。" },
  { id: "chapter.outline", label: "章節大綱", complexity: "standard", hint: "場景節拍與章尾鉤子", group: "writing", defaultObjective: "規劃下一章的可執行大綱，包含開場狀態、場景節拍、衝突升級、選擇、代價與章尾鉤子。" },
  { id: "story.plotCandidate", label: "三條劇情分支", complexity: "standard", hint: "互斥候選與長期代價", group: "writing", defaultObjective: "提出三個都符合 Canon、但彼此互斥的後續分支，說明觸發事件、短期結果、長期代價與回接主線方式。" },
  { id: "story.endingPlan", label: "結局規劃", complexity: "standard", hint: "衝突、弧線與伏筆", group: "writing", defaultObjective: "提出一份可執行的結局方案，處理核心衝突、角色弧線、伏筆、主題回聲與最後代價。" },
  { id: "drama.episodePlan", label: "短劇深度改編", complexity: "heavy", hint: "Private Hub 多階段規劃", group: "writing", defaultObjective: "把目前作品整理成可執行的短劇單集規劃，逐集列出開場 Hook、衝突、人物選擇、轉折、代價、連續性與結尾懸念。" },
  { id: "story.summary", label: "章節摘要", complexity: "light", hint: "瀏覽器 AI 可離線執行", group: "analysis", defaultObjective: "摘要目前章節，保留人物、事件、地點、衝突、因果、選擇、代價與未解線索。" },
  { id: "story.chapterReview", label: "完整章節審稿", complexity: "light", hint: "瀏覽器 AI 可離線審稿", group: "analysis", defaultObjective: "完整審查目前章節：摘要、亮點、一致性、角色、節奏、敘事視角、語言問題與優先修訂清單。" },
  { id: "story.consistencyCheck", label: "全書一致性檢查", complexity: "light", hint: "瀏覽器 AI 可離線掃描", group: "analysis", defaultObjective: "檢查已核准資料的設定、因果、時序、物件狀態與視角矛盾；逐項附證據、影響與最小修法。" },
  { id: "story.timelineCheck", label: "時間線檢查", complexity: "light", hint: "瀏覽器 AI 可離線掃描", group: "analysis", defaultObjective: "重建並檢查事件順序、時間跨度、先後關係、旅行時間與章節連結；不確定處標示待確認。" },
  { id: "story.characterCheck", label: "角色一致性檢查", complexity: "light", hint: "瀏覽器 AI 可離線掃描", group: "analysis", defaultObjective: "逐角檢查目標、知識邊界、能力、情緒、語氣與行為因果，列出偏離證據與最小修法。" },
  { id: "story.worldRuleCheck", label: "世界規則檢查", complexity: "light", hint: "瀏覽器 AI 可離線掃描", group: "analysis", defaultObjective: "逐條對照世界規則與正文，區分明確違反、可能衝突與資訊不足，提出不改規則的修正候選。" },
  { id: "story.foreshadowingCheck", label: "伏筆回收檢查", complexity: "light", hint: "瀏覽器 AI 可離線掃描", group: "analysis", defaultObjective: "盤點伏筆的已知證據、預期回收窗口、逾期風險與不劇透的回收候選。" },
  { id: "story.plotAnalysis", label: "劇情因果分析", complexity: "light", hint: "瀏覽器 AI 可離線分析", group: "analysis", defaultObjective: "拆解目前劇情的因果鏈、動機、阻力、升級、轉折、高潮與結果，指出斷鏈與候選修法。" },
  { id: "story.pacingCheck", label: "節奏檢查", complexity: "light", hint: "瀏覽器 AI 可離線分析", group: "analysis", defaultObjective: "逐場景檢查功能、資訊密度、速度、重複與停滯，提出精準的刪減、擴寫、換序或增壓建議。" },
  { id: "story.themeAnalysis", label: "主題與母題分析", complexity: "standard", hint: "證據與推測分離", group: "analysis", defaultObjective: "從已核准內容分析主題、母題、價值衝突與人物弧線呼應，清楚區分文字證據與推測。" },
  { id: "story.originalityCheck", label: "原創性自檢", complexity: "light", hint: "瀏覽器 AI 內部相似度掃描", group: "analysis", defaultObjective: "檢查目前內容內部的套路重複、表達相似與辨識度，提出保留核心但改變機制、視角、代價與意象的方案。" },
  { id: "character.create", label: "角色候選", complexity: "standard", hint: "身分、矛盾與劇情功能", group: "character", defaultObjective: "建立一名適合目前作品的角色候選，包含目標、需求、能力、限制、恐懼、矛盾、語氣、關係鉤子與劇情功能。" },
  { id: "character.dialogue", label: "角色對話生成", complexity: "standard", hint: "可核准追加章節", group: "character", defaultObjective: "根據角色知識邊界、目標、語氣與關係狀態，產生一段以動作和停頓呈現潛台詞的候選對話。" },
  { id: "character.dialogueConsistency", label: "角色對話檢查", complexity: "light", hint: "裝置內輕量檢查", group: "character", defaultObjective: "比較目前對話與角色聲音基準，列出一致與偏離證據；沒有足夠資料時明確標示。" },
  { id: "character.relationshipAnalysis", label: "人物關係分析", complexity: "standard", hint: "張力、權力與信任", group: "character", defaultObjective: "分析人物關係的公開狀態、私人張力、權力、信任、債務、衝突與可能轉折，區分事實和推論。" },
  { id: "world.create", label: "世界設定候選", complexity: "standard", hint: "秩序、資源與成本", group: "world", defaultObjective: "建立符合目前作品的世界候選，包含時代、地理、社會秩序、資源、限制、日常生活與衝突成本。" },
  { id: "world.ruleCandidate", label: "世界規則候選", complexity: "standard", hint: "可測試規則", group: "world", defaultObjective: "提出三條可測試的世界規則候選；每條列觸發條件、效果、限制、例外、代價與正文例子。" },
  { id: "game.questCandidate", label: "RPG 任務候選", complexity: "standard", hint: "目標、風險、報酬與分支", group: "game", defaultObjective: "根據目前作品設計一個可玩的 RPG 任務候選，包含觸發條件、目標、三條解法、能力檢定、風險、代價、獎勵與失敗後仍可推進的結果。" },
  { id: "game.stateEvaluation", label: "RPG 狀態評估", complexity: "light", hint: "能力與分支檢查", group: "game", defaultObjective: "檢查目前角色能力、資源、關係、任務與成就是否一致，指出異常值、斷裂分支與最小修正候選；不得自行寫入狀態。" },
  { id: "game.rewardCandidate", label: "養成獎勵候選", complexity: "standard", hint: "平衡且有故事代價", group: "game", defaultObjective: "依目前章節與角色成長設計三個平衡的獎勵候選，分別偏向能力、關係與世界資源；每個都列出獲得條件、數值影響、故事意義與防止失衡的限制。" },
  { id: "game.achievementCandidate", label: "成就候選", complexity: "standard", hint: "隱藏、進度與解鎖條件", group: "game", defaultObjective: "設計五個符合目前作品的 RPG 成就候選，包含名稱、可見或隱藏、進度公式、解鎖條件、稀有度與不破壞劇情的獎勵。" },
  { id: "learning.preferenceReview", label: "學習偏好檢查", complexity: "standard", hint: "只產生 L0／L1 候選", group: "learning", defaultObjective: "從已核准的使用者訊號中萃取可回滾的 L0／L1 偏好候選，不保存原文、秘密或思考鏈。" },
  { id: "story.storyBibleCandidate", label: "Story Bible 候選", complexity: "heavy", hint: "Private Hub 長上下文", group: "learning", defaultObjective: "整理全書 Story Bible 候選，分成已核准事實、待確認、矛盾、角色、世界、時間線、伏筆與禁改項。" },
  { id: "character.multiAgentSimulation", label: "多角色推演", complexity: "heavy", hint: "Private Hub 知識隔離", group: "learning", defaultObjective: "依各角色知識邊界推演一場多角色互動，只輸出外顯行動與對話，不洩露角色私人內部推演。" },
];

const BACKEND_LABELS: Record<ClosedAIBackendId | "auto", string> = {
  auto: "依任務自動選定",
  "browser-ai": "瀏覽器 AI",
  "local-ollama": "個人本機 Ollama",
  "private-ai-hub": "私有 AI Hub",
};

const QUALITY_LABELS: Record<ClosedAIQualityMode | "auto", string> = {
  auto: "智慧自動（輕量 1／標準 2／深度 3 階段）",
  fast: "快速（1 階段）",
  balanced: "平衡（草稿＋修訂）",
  deep: "深度（草稿＋反方檢查＋修訂）",
};

function statusLabel(status: ClosedAIBackendSnapshot["status"]) {
  if (status === "ready") return "模型運作中";
  if (status === "contract_ready_runtime_not_connected") return "安全契約完成，算力未連線";
  if (status === "runtime_required") return "需要本機執行環境";
  if (status === "degraded") return "功能降級";
  return "已停用";
}

function candidateStatusLabel(status: ClosedAgentCandidate["status"]) {
  const labels: Record<ClosedAgentCandidate["status"], string> = {
    "awaiting-approval": "等待你的核准",
    approved: "已核准到記憶",
    rejected: "已拒絕",
    committed: "已核准並套用",
    "rolled-back": "已回滾",
  };
  return labels[status];
}

const COMPLEXITY_RANK = { light: 1, standard: 2, heavy: 3 } as const;
const CHAPTER_COMMIT_TASKS = new Set<PlatformTaskType>([
  "assistant.transform",
  "story.summary",
  "chapter.continue",
  "chapter.rewrite",
  "chapter.expand",
  "chapter.compress",
  "character.dialogue",
]);

function backendCanRun(
  snapshot: ClosedAIBackendSnapshot | undefined,
  task: (typeof TASKS)[number] | undefined,
) {
  if (!snapshot || !task || snapshot.status !== "ready") return false;
  if (COMPLEXITY_RANK[snapshot.maximumComplexity] < COMPLEXITY_RANK[task.complexity]) {
    return false;
  }
  return snapshot.supportedTaskTypes === "all"
    || snapshot.supportedTaskTypes.includes(task.id);
}

function runtimeError(error: unknown) {
  const code = String((error as { code?: string })?.code || "");
  const messages: Record<string, string> = {
    BRIDGE_PROCESS_UNREACHABLE: "本機執行服務尚未啟動，或瀏覽器無法存取 loopback。",
    LOCAL_NETWORK_PERMISSION_DENIED: "瀏覽器已拒絕本機網路權限。請在網址列的網站權限中允許「本機網路存取」，再按一次實際驗證模型。",
    BRIDGE_NOT_PAIRED: "目前頁面尚未與本機服務完成配對。",
    BRIDGE_PAIRING_EXPIRED: "一次性配對已過期，請重新發起。",
    BRIDGE_PAIRING_REVOKED: "本機配對已撤銷，請重新配對。",
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
    BROWSER_AI_UNSUPPORTED: "此裝置不支援瀏覽器內建 AI；其他閉端後端不受影響。",
    BROWSER_AI_MODEL_NOT_READY: "此裝置可支援瀏覽器 AI，但裝置模型尚未可用。",
    BROWSER_WEBLLM_DEVICE_GATE_FAILED: "這個模型未通過目前裝置的 WebGPU、記憶體或儲存空間檢查。",
    BROWSER_WEBLLM_INSTALL_FAILED: "Browser AI 模型未安裝完成；請確認網路與可用空間後重試。",
    BROWSER_WEBLLM_INFERENCE_FAILED: "已安裝的 Browser AI 模型未通過真實推理，沒有用模板冒充成功。",
    BROWSER_WEBLLM_MODEL_NOT_INSTALLED: "請先安裝並驗證一個 Browser AI 生成模型。",
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
  const recommendedBackendId = (error as { recommendedBackendId?: ClosedAIBackendId | null })
    ?.recommendedBackendId;
  const messages: Record<string, string> = {
    CLOSED_AI_REQUIRED_BACKEND_NOT_READY: "這項工作所需的閉端 AI 尚未就緒；系統沒有暗中換用其他 AI。",
    CLOSED_AI_SELECTED_BACKEND_NOT_READY: "你指定的閉端 AI 目前不能執行這項工作；系統已安全停止。",
    CLOSED_AGENT_PERMISSION_DENIED: "這項代理工作缺少必要權限，已安全停止。",
    CLOSED_AGENT_EVALUATION_BLOCKED: "候選未通過安全與品質評估，沒有進入核准區。",
    CONTROLLED_LEARNING_CONSENT_REQUIRED: "請先開啟這個作品的可控學習同意。",
    CONTROLLED_LEARNING_KILL_SWITCH_ENGAGED: "可控學習緊急停止目前已開啟。",
  };
  const message = messages[code] ?? (error instanceof Error ? error.message : "操作失敗。");
  return recommendedBackendId
    ? `${message} 可由你手動改選：${BACKEND_LABELS[recommendedBackendId]}。`
    : message;
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
  const [taskType, setTaskType] = useState<PlatformTaskType>("chapter.continue");
  const [backend, setBackend] = useState<ClosedAIBackendId | "auto">("auto");
  const [qualityMode, setQualityMode] = useState<ClosedAIQualityMode | "auto">("auto");
  const [objective, setObjective] = useState(
    TASKS.find((task) => task.id === "chapter.continue")!.defaultObjective,
  );
  const [storyContext, setStoryContext] = useState("");
  const [storyBibleRevision, setStoryBibleRevision] = useState("current");
  const [knowledgeScopeRevision, setKnowledgeScopeRevision] = useState("current");
  const [result, setResult] = useState<ClosedAgentExecutionResult | null>(null);
  const [status, setStatus] = useState("正在核對三個閉端 AI 與共用系統。");
  const [busy, setBusy] = useState(false);
  const taskController = useRef<AbortController | null>(null);
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
  const [progressEvents, setProgressEvents] = useState<ClosedAIProgressEvent[]>([]);
  const [contextInventory, setContextInventory] = useState<ContextInventory | null>(null);

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
    let cancelled = false;
    void (async () => {
      const repository = createNovelRepository();
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
      const activeChapter = chapters.find((item) => item.id === project?.activeChapterId)
        ?? chapters.sort((left, right) => left.order - right.order).at(-1)
        ?? null;
      const taskProgress = writingTasks.length
        ? Math.round(
          writingTasks.reduce(
            (total, item) => total + (item.target > 0 ? (item.progress / item.target) * 100 : 0),
            0,
          ) / writingTasks.length,
        )
        : null;
      const achievementProgress = achievements.length
        ? Math.round(
          achievements.reduce(
            (total, item) => total + (item.target > 0 ? (item.progress / item.target) * 100 : 0),
            0,
          ) / achievements.length,
        )
        : null;
      const rpgContext = storyState ? [
        "【RPG StoryState｜正式狀態】",
        ...Object.entries(storyState.protagonistStats)
          .filter(([, value]) => Number.isFinite(value))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key}: ${value}`),
        ...Object.entries(storyState.resources)
          .filter(([, value]) => Number.isFinite(value))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value], index) => `resource.${index + 1}: ${value}（${key}）`),
        ...Object.entries(storyState.relationships)
          .filter(([, value]) => Number.isFinite(value))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value], index) => `relationship.${index + 1}: ${value}（${key}）`),
        ...Object.entries(storyState.worldFlags)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value], index) => `worldFlag.${index + 1}: ${String(value)}（${key}）`),
        storyState.money === null ? "" : `money: ${storyState.money}`,
        storyState.reputation === null ? "" : `reputation: ${storyState.reputation}`,
        taskProgress === null ? "" : `任務進度: ${taskProgress}`,
        achievementProgress === null ? "" : `成就進度: ${achievementProgress}`,
        storyState.locationState ? `目前位置：${storyState.locationState}` : "",
        storyState.timeState ? `目前時間：${storyState.timeState}` : "",
        `StoryState ID：${storyState.id}`,
        `StoryState Revision：${storyState.revision}`,
      ].filter(Boolean).join("\n") : "";
      const approvedContext = [
        project?.coreIdea.value ? `【作品核心】${project.coreIdea.value}` : "",
        activeChapter?.content.trim()
          ? `【目前章節：${activeChapter.title}】\n${activeChapter.content}`
          : "",
        characters.length
          ? `【角色】\n${characters.map((item) => [
            item.name,
            item.identity.value ? `身分：${item.identity.value}` : "",
            item.personality.value ? `性格：${item.personality.value}` : "",
            item.goal.value ? `目標：${item.goal.value}` : "",
            item.portrait?.visualDescription ? `核准外觀：${item.portrait.visualDescription}` : "",
            item.portrait?.traits.length ? `外觀特徵：${item.portrait.traits.join("、")}` : "",
            item.rpgProfile ? `RPG 初始能力：${Object.entries(item.rpgProfile.stats).map(([key, value]) => `${key}=${value}`).join("、")}` : "",
            item.dynamicsProfile ? `核准角色動態：${item.dynamicsProfile.archetypeLabel}／${item.dynamicsProfile.socialRole}；特質 ${item.dynamicsProfile.personalityTraits.join("、")}；行動傾向 ${item.dynamicsProfile.behavioralTendencies.join("、")}` : "",
          ].filter(Boolean).join("；")).join("\n")}`
          : "",
        rules.length
          ? `【世界規則】\n${rules.map((item) => `${item.title}：${item.description}`).join("\n")}`
          : "",
        timeline.length
          ? `【時間線】\n${timeline.map((item) => `${item.storyTime ?? "未定時間"}｜${item.title}：${item.summary}`).join("\n")}`
          : "",
        storyBible ? [
          "【Story Bible】",
          storyBible.theme.value ? `主題：${storyBible.theme.value}` : "",
          storyBible.style.value ? `風格：${storyBible.style.value}` : "",
          storyBible.foreshadowing.length ? `伏筆：${storyBible.foreshadowing.join("；")}` : "",
          storyBible.unresolvedThreads.length ? `未解線索：${storyBible.unresolvedThreads.join("；")}` : "",
          storyBible.forbiddenContradictions.length ? `禁止矛盾：${storyBible.forbiddenContradictions.join("；")}` : "",
        ].filter(Boolean).join("\n") : "",
        rpgContext,
      ].filter(Boolean).join("\n\n");
      setStoryContext((current) => {
        if (!current.trim()) return approvedContext;
        const isGeneratedContext = current.includes("【目前章節：")
          && current.includes("【Story Bible】");
        if (rpgContext && isGeneratedContext && !current.includes("【RPG StoryState｜正式狀態】")) {
          return `${current.trim()}\n\n${rpgContext}`;
        }
        return current;
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
      );
      setKnowledgeScopeRevision(String(maximumRevision));

      const query = new URL(location.href).searchParams;
      const requestedTask = query.get("task") as PlatformTaskType | null;
      if (requestedTask && TASKS.some((item) => item.id === requestedTask)) {
        setTaskType(requestedTask);
        const requested = TASKS.find((item) => item.id === requestedTask)!;
        setObjective(requested.defaultObjective);
        setBackend("auto");
      }
      const requestedObjective = query.get("objective")?.trim();
      if (requestedObjective) setObjective(requestedObjective.slice(0, 4000));
      const handoffId = query.get("handoff")?.trim() ?? "";
      if (/^[A-Za-z0-9-]{16,128}$/.test(handoffId)) {
        try {
          const rawHandoff = window.sessionStorage.getItem(`novel_closed_ai_handoff:${handoffId}`);
          const handoff = rawHandoff
            ? JSON.parse(rawHandoff) as {
              schemaVersion?: string;
              projectId?: string;
              taskType?: string;
              objective?: string;
              createdAt?: string;
            }
            : null;
          const createdAt = Date.parse(handoff?.createdAt ?? "");
          const age = Date.now() - createdAt;
          const validTask = TASKS.some((item) => item.id === handoff?.taskType);
          if (
            handoff?.schemaVersion === "novel-closed-ai-handoff-v1"
            && handoff.projectId === projectId
            && handoff.taskType === requestedTask
            && validTask
            && typeof handoff.objective === "string"
            && handoff.objective.trim()
            && Number.isFinite(age)
            && age >= 0
            && age <= 30 * 60 * 1000
          ) {
            setObjective(handoff.objective.trim().slice(0, 4000));
          }
        } catch {
          // 安全交接失敗時保留任務預設文字，不從不可信 URL 還原正文。
        }
      }
    })().catch((error) => {
      if (!cancelled) setStatus(`作品脈絡載入失敗：${runtimeError(error)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
      promptProfileVersion: "closed-agent-prompt-v3",
      storyBibleRevision,
      knowledgeScopeRevision,
      privacyLevel,
    };
  }, [knowledgeScopeRevision, projectId, snapshots, storyBibleRevision]);

  const namespace = useCallback((): ClosedAINamespace => {
    const task = TASKS.find((item) => item.id === taskType);
    const backendId = backend === "auto"
      ? task?.complexity === "heavy"
        ? "private-ai-hub"
        : task?.complexity === "standard"
          ? "local-ollama"
          : "browser-ai"
      : backend;
    return namespaceForBackend(backendId);
  }, [backend, namespaceForBackend, taskType]);

  const selectedTask = useMemo(
    () => TASKS.find((item) => item.id === taskType),
    [taskType],
  );
  const routingNamespace = useMemo<ClosedAINamespace>(() => ({
    ...namespaceForBackend(
      selectedTask?.complexity === "heavy"
        ? "private-ai-hub"
        : "local-ollama",
    ),
    modelId: "unrouted:runtime-managed",
    modelDigest: "unrouted:digest-runtime-managed",
    privacyLevel: selectedTask?.complexity === "heavy"
      ? "private_infrastructure_only"
      : "device_only",
  }), [namespaceForBackend, selectedTask?.complexity]);
  const runtimeRoute = useMemo(() => resolveClosedAIRoute({
    taskType,
    namespace: routingNamespace,
    complexity: selectedTask?.complexity,
  }, snapshots, {
    preferredBackend: backend === "auto" ? undefined : backend,
  }), [backend, routingNamespace, selectedTask?.complexity, snapshots, taskType]);
  const executionBackendId: ClosedAIBackendId =
    runtimeRoute.executionStatus === "routable"
      ? runtimeRoute.backend.id
      : backend !== "auto"
        ? backend
        : selectedTask?.complexity === "heavy"
          ? "private-ai-hub"
          : selectedTask?.complexity === "standard"
            ? "local-ollama"
            : "browser-ai";
  const executionSnapshot = snapshots.find(
    (snapshot) => snapshot.id === executionBackendId,
  );
  const executionReady = runtimeRoute.executionStatus === "routable";
  const fleetRequest = useMemo(() => ({
    taskType,
    complexity: selectedTask?.complexity ?? "light",
    preferLatency: qualityMode === "fast",
  }), [qualityMode, selectedTask?.complexity, taskType]);
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
  const selectedRuntimeModelId = executionBackendId === "private-ai-hub"
    ? hubModelId
    : executionBackendId === "local-ollama"
      ? localModelId
      : null;

  const refreshRuntimes = useCallback(async () => {
    if (!currentOrigin) return;
    setRuntimeStatus("正在檢查三個閉端 AI 的真實執行狀態。");
    await runtimeCoordinator.refresh({
      projectId,
      taskType,
      storyBibleRevision,
      knowledgeScopeRevision,
      policy: {
        preferredBackend: backend === "auto" ? undefined : backend,
      },
    });
    const browserProbe = Promise.all([
      detectBrowserAI(),
      browserWebLLMRuntimeSnapshot().catch(() => null),
      browserSemanticRuntimeSnapshot().catch(() => null),
    ]).then(([browser, webLlm, semantic]) => {
      setBrowserCapability(browser);
      setBrowserWebLlm(webLlm);
      setBrowserSemantic(semantic);
      setBrowserProof(getBrowserAIInferenceProof());
      return { browser, semantic };
    });
    const localProbe = (async () => {
      const startedAt = performance.now();
      try {
        const health = await localClient.health();
        setLocalTelemetry(runtimeTelemetry(health, startedAt));
        if (!health.runtimeReady || !localClient.getSessionMetadata()) {
          setLocalModels([]);
          setLocalProof(null);
          configureLocalBridgeClient(null);
          configureLocalBridgeModel(null);
          return false;
        }
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
        return Boolean(proof);
      } catch {
        setLocalModels([]);
        setLocalProof(null);
        setLocalTelemetry(null);
        configureLocalBridgeClient(null);
        configureLocalBridgeModel(null);
        return false;
      }
    })();
    const hubProbe = (async () => {
      const startedAt = performance.now();
      try {
        const health = await hubClient.health();
        setHubTelemetry(runtimeTelemetry(health, startedAt));
        if (!health.runtimeReady || !hubClient.getSessionMetadata()) {
          setHubModels([]);
          setHubProof(null);
          setTrainingModels([]);
          configurePrivateHubClient(null);
          configurePrivateHubModel(null);
          return false;
        }
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
        return Boolean(proof);
      } catch {
        setHubModels([]);
        setHubProof(null);
        setTrainingModels([]);
        setHubTelemetry(null);
        configurePrivateHubClient(null);
        configurePrivateHubModel(null);
        return false;
      }
    })();
    const [browserResult, localReady, hubReady] = await Promise.all([
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
      `${browserState}；語意檢索 ${browserResult.semantic?.model.cacheVerified ? "已驗證" : "等待安裝／驗證"}；Local Bridge ${localReady ? "模型已實測" : "等待啟動／配對／實測"}；Private Hub ${hubReady ? "模型已實測" : "等待啟動／配對／實測"}；離線殼 ${offlineWorkerControlled ? "已接管" : "首次快取中"}。`,
    );
  }, [
    backend,
    currentOrigin,
    hubClient,
    hubModelId,
    knowledgeScopeRevision,
    localClient,
    localModelId,
    offlineWorkerControlled,
    projectId,
    runtimeCoordinator,
    storyBibleRevision,
    taskType,
  ]);

  const refresh = useCallback(async (announce = true) => {
    await refreshRuntimes();
    const runtime = await runtimeCoordinator.refresh({
      projectId,
      taskType,
      storyBibleRevision,
      knowledgeScopeRevision,
      policy: {
        preferredBackend: backend === "auto" ? undefined : backend,
      },
    });
    const nextSnapshots = runtime.backends;
    const nextDashboard = await os.dashboard(projectId, nextSnapshots);
    setSnapshots(nextSnapshots);
    setDashboard(nextDashboard);
    if (announce) {
      setStatus("三閉端 AI 與共用 Closed Agent OS 已完成核對。");
    }
  }, [
    backend,
    knowledgeScopeRevision,
    os,
    projectId,
    refreshRuntimes,
    runtimeCoordinator,
    storyBibleRevision,
    taskType,
  ]);

  useEffect(() => {
    runtimeCoordinator.setRememberPairingWithinTab(rememberPairing);
  }, [rememberPairing, runtimeCoordinator]);

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
    const approved = window.confirm(
      `即將下載 ${manifest.displayName}（約 ${formatBytes(manifest.estimatedDownloadBytes)}）。\n\n`
      + `授權：${manifest.license}\n版本：${manifest.sourceRevision.slice(0, 12)}…\n\n`
      + "第一次安裝需要連網；完成快取驗證後，文章推理可留在此裝置。是否繼續？",
    );
    if (!approved) return;
    const controller = new AbortController();
    browserModelInstallController.current = controller;
    setBrowserModelOperation("install");
    setRuntimeBusy(true);
    setRuntimeStatus(`正在安裝 ${manifest.displayName}；可隨時停止，未完成的模型不會標記為可用。`);
    try {
      const snapshot = await installBrowserWebLLMModel(modelId, {
        signal: controller.signal,
        onProgress: setBrowserWebLlmProgress,
      });
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
      const snapshot = await deleteBrowserWebLLMModel(modelId);
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

  function recordProgress(event: ClosedAIProgressEvent) {
    setProgressEvents((current) => {
      const previous = current.at(-1);
      if (previous?.phase === event.phase) {
        return [...current.slice(0, -1), event];
      }
      return [...current, event].slice(-12);
    });
    setStatus(event.label);
  }

  async function runTask() {
    if (busy || !objective.trim()) return;
    const controller = new AbortController();
    taskController.current = controller;
    setBusy(true);
    setResult(null);
    setProgressEvents([]);
    setStatus("正在鎖定後端、建立計畫、執行並評估候選。");
    try {
      const runNamespace = namespace();
      const repository = createNovelRepository();
      const currentProject = await repository.get<NovelProject>("projects", projectId);
      const sourceChapter = currentProject?.activeChapterId
        ? await repository.get<Chapter>("chapters", currentProject.activeChapterId)
        : null;
      const next = await executeStudioClosedAgent({
        taskId: `closed-agent-${crypto.randomUUID()}`,
        projectId,
        taskType,
        objective,
        context: storyContext.trim()
          ? [{
            id: `story-context:${projectId}`,
            kind: "story-bible",
            text: storyContext,
            visibility: "both",
            privacyLevel: runNamespace.privacyLevel,
            approved: true,
          }]
          : [],
        qualityMode: qualityMode === "auto" ? undefined : qualityMode,
        preferredBackend: backend === "auto" ? undefined : backend,
        storyBibleRevision,
        knowledgeScopeRevision,
        sourceChapterId: sourceChapter?.id,
        sourceRevision: sourceChapter?.revision,
        signal: controller.signal,
        onProgress: recordProgress,
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

  async function approve(applyToChapter = false) {
    if (!result || busy) return;
    setBusy(true);
    try {
      const canonicalCommit = applyToChapter
        ? async ({
          candidate,
          idempotencyKey,
        }: {
          candidate: typeof result.candidate;
          idempotencyKey: string;
        }) => {
          const repository = createNovelRepository();
          if (!candidate.sourceChapterId || candidate.sourceRevision == null) {
            throw Object.assign(new Error("The generated candidate has no canonical source chapter."), {
              code: "CLOSED_AGENT_CANONICAL_CHAPTER_REQUIRED",
            });
          }
          const taskType = result.task.taskType;
          const committed = await commitStudioCandidateToChapter({
            repository,
            projectId,
            chapterId: candidate.sourceChapterId,
            sourceRevision: candidate.sourceRevision,
            taskId: candidate.taskId,
            idempotencyKey,
            content: candidate.content,
            mode: taskType === "story.summary"
              ? "summary"
              : taskType === "chapter.rewrite" || taskType === "chapter.compress" || taskType === "assistant.transform"
                ? "replace"
                : "append",
          });
          return {
            commitId: committed.commitId,
            storyBibleRevision,
          };
        }
        : undefined;
      const approved = await os.approveCandidate({
        candidateId: result.candidate.id,
        approvedBy: "local-author",
        humanApproved: true,
        canonicalCommit,
      });
      setResult({
        ...result,
        candidate: approved.candidate,
      });
      setStatus(
        applyToChapter
          ? "核准已簽章，候選已寫入目前章節並建立可驗證 Canon commit。"
          : "核准已簽章並寫入核准記憶；本頁未修改 Canon。",
      );
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
    <main className={styles.shell} data-testid="closed-ai-workspace">
      <header className={styles.header}>
        <div>
          <small>PRIVATE NOVEL INTELLIGENCE · CLOSED AGENT FABRIC</small>
          <h1>閉端 AI 指揮中心</h1>
          <p>一個小說專用 Agent OS，協調三個私有算力後端、模型艦隊、記憶、工具、訓練與證據鏈。</p>
        </div>
        <div className={styles.headerActions}>
          <span data-ready={dashboard?.status === "ready"}>Closed Agent OS：{dashboard?.status === "ready" ? "就緒" : "核對中"}</span>
          <Link href="/settings/local-ai">本機 AI 安裝精靈</Link>
          <button type="button" disabled={busy || runtimeBusy} onClick={() => void refresh()}>重新檢查</button>
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
          <h2>讓每個模型各自做最擅長的工作</h2>
          <p>Planner 拆解、Actor 生成、Critic 反方檢查、Evaluator 評分；候選經人工核准後，才可進入記憶或 Canon。</p>
          <div className={styles.deckMetrics}>
            <span><strong>{TASKS.length}</strong> 種小說任務</span>
            <span><strong>{localModels.length + hubModels.length}</strong> 個已偵測私有模型</span>
            <span><strong>{snapshots.filter((item) => item.status === "ready").length}/3</strong> 後端已實測</span>
            <span><strong>{trainingModels.length}</strong> 個偏好模型成果</span>
          </div>
        </div>
        <div className={styles.truthPanel}>
          <span>目前能力真相</span>
          <strong>{recommendedFleetModel
            ? `${recommendedFleetModel.modelId} · 適配 ${recommendedFleetModel.score}%`
            : "等待私有模型配對"}</strong>
          <p>{recommendedFleetModel
            ? recommendedFleetModel.reasons.slice(0, 2).join("；")
            : "架構已支援多模型；實際能力仍取決於已安裝、已驗證的模型與硬體。"}</p>
        </div>
      </section>
      <p className={styles.status} data-testid="closed-ai-task-status" role="status" aria-live="polite">{status}</p>
      <p className={styles.runtimeStatus} role="status" aria-live="polite">{runtimeStatus}</p>

      <div className={styles.workspace}>
        <section className={styles.panel} aria-labelledby="backend-title">
          <div className={styles.panelHeading}>
            <div><small>執行層</small><h2 id="backend-title">三個閉端 AI</h2></div>
            <span>並存，不互相取代</span>
          </div>
          <label className={styles.sessionPreference}>
            <input
              type="checkbox"
              checked={rememberPairing}
              onChange={(event) => setRememberPairing(event.target.checked)}
            />
            僅在目前分頁記住已驗證配對；關閉分頁即失效，不寫入 localStorage 或作品備份。
          </label>
          <div className={styles.backendList}>
            {snapshots.map((snapshot) => (
              <article key={snapshot.id} data-status={snapshot.status}>
                <div>
                  <strong>{snapshot.label}</strong>
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
                      第一次安裝會連網；快取驗證後，文章生成可留在裝置。模型來源與執行檔固定版本並驗證雜湊；上游權重分片目前以不可變 revision 鎖定，未宣稱逐分片 SRI。
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
                        return <div
                          className={styles.browserModelCard}
                          data-selected={state?.selected || undefined}
                          data-testid={`browser-webllm-model-${manifest.parameterLabel}`}
                          key={manifest.modelId}
                        >
                          <div>
                            <strong>{manifest.displayName}</strong>
                            <span>{ready ? state?.selected ? "使用中" : "已安裝" : state?.installStatus === "error" ? "需重試" : "未安裝"}</span>
                          </div>
                          <small>
                            約 {formatBytes(manifest.estimatedDownloadBytes)} · 顯存約 {Math.round(manifest.estimatedVramMB)} MB · {manifest.license}
                          </small>
                          <code title={manifest.modelDigest}>digest {manifest.modelDigest.slice(0, 16)}…</code>
                          <small title={manifest.sourceRevision}>版本 {manifest.sourceRevision.slice(0, 12)}… · 4,096 tokens</small>
                          {state?.generationCount ? <small>
                            已完成 {state.generationCount} 次 · 平均首字 {state.averageFirstTokenMs ?? "—"} ms · 平均 {state.averageTokensPerSecond?.toFixed(2) ?? "—"} tokens/s
                          </small> : null}
                          {progress && progress.phase !== "ready" ? <div className={styles.modelProgress}>
                            <progress max={1} value={progress.progress} />
                            <small>{Math.round(progress.progress * 100)}% · {progress.text}</small>
                          </div> : null}
                          {state?.lastError ? <small className={styles.modelError}>{state.lastError}</small> : null}
                          <div className={styles.modelActions}>
                            {!ready ? <button
                              type="button"
                              disabled={runtimeBusy || !state?.allowed}
                              title={!state?.allowed ? "此模型未通過目前裝置 Gate" : undefined}
                              onClick={() => void installBrowserModel(manifest.modelId)}
                            >
                              {state?.installStatus === "error" ? "重新安裝" : "安裝模型"}
                            </button> : <>
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
                            </>}
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
                    <p className={styles.runtimeMetrics} data-testid="browser-webllm-performance-policy">
                      效能策略：Web Worker 單列生成 · 引擎重用 {browserWebLlm.performance.engineReuseCount} 次 · 等待工作 {browserWebLlm.performance.queuedGenerations} · 預熱 {browserWebLlm.performance.warmupCount} 次
                    </p>
                  </div> : null}
                  {browserSemantic ? <div className={styles.browserModelManager} data-testid="browser-semantic-model-manager">
                    <div className={styles.browserDeviceSummary}>
                      <strong>Transformers.js 小說語意引擎</strong>
                      <span>{browserSemantic.device.device?.toUpperCase() ?? "不支援"} · CacheStorage＋IndexedDB</span>
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
                          {browserSemantic.model.installStatus === "error" ? "重新安裝" : "安裝語意模型"}
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
                        {localModels.map((model) => {
                          const profile = localFleet.find((item) => item.modelId === model.modelId);
                          return <option key={model.modelId} value={model.modelId}>
                            {model.modelId}{profile ? ` · ${profile.parameterLabel} · 適配 ${profile.score}%` : ""}
                          </option>;
                        })}
                      </select>
                    </label> : null}
                    {localProof ? <p className={styles.proof}>
                      推理已驗證 {localProof.latencyMs} ms · <code>{localProof.outputDigest.slice(0, 12)}…</code>
                    </p> : <button type="button" disabled={runtimeBusy || !localModelId} onClick={() => void selectLocalModel(localModelId)}>
                      實際驗證模型
                    </button>}
                    {localTelemetry ? <p className={styles.runtimeMetrics}>
                      控制面 {localTelemetry.controlLatencyMs} ms · 執行 {localTelemetry.active}/{localTelemetry.maxConcurrent} · 排隊 {localTelemetry.queued}/{localTelemetry.maxQueue} · Cache {localTelemetry.cacheEntries}
                    </p> : null}
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
                        {hubModels.map((model) => {
                          const profile = hubFleet.find((item) => item.modelId === model.modelId);
                          return <option key={model.modelId} value={model.modelId}>
                            {model.modelId}{profile ? ` · ${profile.parameterLabel} · 適配 ${profile.score}%` : ""}
                          </option>;
                        })}
                      </select>
                    </label> : null}
                    {hubProof ? <p className={styles.proof}>
                      中樞推理已驗證 {hubProof.latencyMs} ms · <code>{hubProof.outputDigest.slice(0, 12)}…</code>
                    </p> : <button type="button" disabled={runtimeBusy || !hubModelId} onClick={() => void selectHubModel(hubModelId)}>
                      實際驗證中樞模型
                    </button>}
                    {hubTelemetry ? <p className={styles.runtimeMetrics}>
                      控制面 {hubTelemetry.controlLatencyMs} ms · 執行 {hubTelemetry.active}/{hubTelemetry.maxConcurrent} · 排隊 {hubTelemetry.queued}/{hubTelemetry.maxQueue} · 加密 Cache {hubTelemetry.cacheEntries}
                    </p> : null}
                    <button className={styles.secondary} type="button" disabled={runtimeBusy} onClick={() => void revokeHubPairing()}>
                      撤銷本頁配對
                    </button>
                  </>}
                </div> : null}
              </article>
            ))}
          </div>
          <div className={styles.fleetBoard}>
            <div className={styles.fleetHeading}>
              <div>
                <small>MODEL FLEET ROUTER</small>
                <h3>私有模型艦隊</h3>
              </div>
              <span>依目前任務即時計分</span>
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
            ) : <p className={styles.fleetEmpty}>配對 Local Bridge 或 Private Hub 後，這裡會依工作難度、參數量、上下文與角色能力推薦已安裝模型。</p>}
          </div>
          <details>
            <summary>能力真相與限制</summary>
            <ul>
              <li>Browser AI 不承擔長篇推理或多代理工作。</li>
              <li>Local Ollama 需要本機 Bridge、配對與可用模型。</li>
              <li>Private AI Hub 可連接自架 loopback 私有節點；節點未啟動、未配對或未實測時，不宣稱已連線。</li>
              <li>後端一旦鎖定，失敗就停止；系統不會暗中換用別的 AI。</li>
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
              <select data-testid="closed-ai-task-type" value={taskType} onChange={(event) => {
                const next = event.target.value as PlatformTaskType;
                const previous = TASKS.find((item) => item.id === taskType);
                const task = TASKS.find((item) => item.id === next);
                setTaskType(next);
                if (
                  task
                  && (!objective.trim() || objective.trim() === previous?.defaultObjective)
                ) {
                  setObjective(task.defaultObjective);
                }
                setBackend("auto");
              }}>
                {(Object.keys(TASK_GROUP_LABELS) as TaskGroup[]).map((group) => (
                  <optgroup key={group} label={TASK_GROUP_LABELS[group]}>
                    {TASKS.filter((task) => task.group === group).map((task) => (
                      <option key={task.id} value={task.id}>{task.label} · {task.hint}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>執行後端
              <select data-testid="closed-ai-backend" value={backend} onChange={(event) => setBackend(event.target.value as ClosedAIBackendId | "auto")}>
                {Object.entries(BACKEND_LABELS).map(([value, label]) => {
                  const backendId = value as ClosedAIBackendId | "auto";
                  const snapshot = backendId === "auto"
                    ? undefined
                    : snapshots.find((item) => item.id === backendId);
                  const runnable = backendId === "auto"
                    || backendCanRun(snapshot, selectedTask);
                  return (
                    <option key={value} value={value} disabled={!runnable}>
                      {label}{backendId === "auto" ? "" : ` · ${snapshot ? statusLabel(snapshot.status) : "核對中"}`}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>品質模式
              <select
                data-testid="closed-ai-quality"
                value={qualityMode}
                onChange={(event) =>
                  setQualityMode(event.target.value as ClosedAIQualityMode | "auto")}
              >
                {Object.entries(QUALITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.executionReadiness} data-testid="closed-ai-execution-readiness" data-ready={executionReady}>
            <div>
              <strong>{executionReady ? "可執行" : "尚未就緒"}</strong>
              <span>
                {backend === "auto" ? "自動選定：" : ""}
                {BACKEND_LABELS[executionBackendId]} · {executionSnapshot?.modelId ?? "等待模型身分"}
              </span>
            </div>
            <p>{executionReady
              ? "按下執行後才會鎖定這個已就緒後端；執行途中失敗不會偷換模型。"
              : selectedTask?.complexity === "heavy"
                ? "這是重型工作，請先配對並實測 Private Hub。"
                : selectedTask?.complexity === "standard"
                  ? "續寫與一般代理工作需要配對 Local Ollama；若桌面瀏覽器有 Prompt API，系統也會自動採用其裝置內生成模型。"
                  : "請先完成可執行後端的實際模型測試。"}</p>
            {!executionReady ? <button
              type="button"
              className={styles.secondary}
              onClick={() => document.getElementById("backend-title")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              })}
            >
              前往連接真實 AI
            </button> : null}
          </div>
          {recommendedFleetModel ? <div className={styles.modelRecommendation}>
            <div>
              <small>此任務的模型路由建議</small>
              <strong>{recommendedFleetModel.modelId} · 適配 {recommendedFleetModel.score}%</strong>
              <span>{recommendedFleetModel.reasons.slice(0, 3).join("；")}</span>
            </div>
            {recommendedFleetModel.modelId !== selectedRuntimeModelId ? <button
              type="button"
              className={styles.secondary}
              disabled={runtimeBusy}
              onClick={() => {
                if (executionBackendId === "private-ai-hub") {
                  void selectHubModel(recommendedFleetModel.modelId);
                } else if (executionBackendId === "local-ollama") {
                  void selectLocalModel(recommendedFleetModel.modelId);
                }
              }}
            >
              實測並採用建議模型
            </button> : <span className={styles.activeModel}>目前已採用</span>}
          </div> : null}
          <label>你要完成什麼？
            <textarea data-testid="closed-ai-objective" rows={4} value={objective} onChange={(event) => setObjective(event.target.value)} />
          </label>
          <label>已核准的故事脈絡（選填）
            <textarea rows={5} value={storyContext} onChange={(event) => setStoryContext(event.target.value)} placeholder="只貼入你允許 Actor 與 Evaluator 共同看見的故事資料。" />
          </label>
          {contextInventory ? <small
            className={styles.contextInventory}
            data-testid="closed-ai-context-inventory"
            data-project-ready={contextInventory.projectPresent}
            data-story-state-ready={contextInventory.storyStates > 0}
          >
            正式脈絡：{contextInventory.repository === "indexeddb" ? "IndexedDB" : "工作階段記憶"}
            {" · "}{contextInventory.chapters} 章
            {" · "}{contextInventory.characters} 角色
            {" · "}{contextInventory.storyStates} StoryState
            {" · "}{contextInventory.tasks} 任務
            {" · "}{contextInventory.achievements} 成就
          </small> : null}
          <div className={styles.actions}>
            <button data-testid="closed-ai-run" className={styles.primary} type="button" disabled={busy || !objective.trim() || !executionReady} onClick={() => void runTask()}>
              {busy ? "模型執行中…" : "建立真實模型候選"}
            </button>
            {busy ? <button className={styles.danger} type="button" onClick={cancelTask}>取消模型工作</button> : null}
          </div>
          {progressEvents.length ? <div className={styles.progressPanel} aria-label="閉端 AI 執行進度">
            <div className={styles.progressTrack}>
              <span style={{ width: `${progressEvents.at(-1)?.percent ?? 0}%` }} />
            </div>
            <ol>
              {progressEvents.map((event) => <li key={`${event.phase}:${event.occurredAt}`} data-current={event === progressEvents.at(-1)}>
                <strong>{event.percent}%</strong>
                <span>{event.label}</span>
                {typeof event.generatedCharacters === "number" ? <small>{event.generatedCharacters} 字</small> : null}
              </li>)}
            </ol>
          </div> : null}

          <div className={styles.candidate} data-testid="closed-ai-candidate" data-empty={!result}>
            {result ? <>
              <header>
                <div>
                  <small>{BACKEND_LABELS[result.candidate.backendId]} · 評分 {Math.round(result.candidate.evaluation.score * 100)}%</small>
                  <h3 data-testid="closed-ai-candidate-status">{candidateStatusLabel(result.candidate.status)}</h3>
                </div>
                <span data-testid="closed-ai-canonical-mutation-count">Canon 寫入：{result.candidate.canonicalMutationCount}</span>
              </header>
              <div className={styles.candidateText}>{result.candidate.content}</div>
              <div className={styles.actions}>
                {result.candidate.status === "awaiting-approval" ? <>
                  {CHAPTER_COMMIT_TASKS.has(result.task.taskType) ? (
                    <button data-testid="closed-ai-approve-canon" type="button" disabled={busy} onClick={() => void approve(true)}>核准並套用目前章節</button>
                  ) : null}
                  <button data-testid="closed-ai-approve-memory" className={styles.secondary} type="button" disabled={busy} onClick={() => void approve(false)}>只核准到記憶</button>
                  <button data-testid="closed-ai-reject" className={styles.secondary} type="button" disabled={busy} onClick={() => void reject()}>拒絕</button>
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
                  <div><dt>實際執行器</dt><dd data-testid="closed-ai-actual-executor">{result.candidate.actualExecutor}</dd></div>
                  <div><dt>生成模型</dt><dd data-testid="closed-ai-model-id">{result.candidate.modelId}</dd></div>
                  <div><dt>模型雜湊</dt><dd>{result.candidate.modelDigest}</dd></div>
                  <div><dt>脈絡雜湊</dt><dd data-testid="closed-ai-context-digest">{result.candidate.contextDigest ?? "舊候選未記錄"}</dd></div>
                  <div><dt>脈絡來源摘要</dt><dd data-testid="closed-ai-context-source-summary">{result.candidate.contextSourceSummary ?? "舊候選未記錄"}</dd></div>
                  <div><dt>資料離開裝置</dt><dd data-testid="closed-ai-data-left-device">{result.candidate.dataLeftDevice ? "是" : "否"}</dd></div>
                  <div><dt>外部請求</dt><dd data-testid="closed-ai-external-request">{result.candidate.externalRequest ? "是" : "否"}</dd></div>
                  {result.candidate.generationTelemetry ? <>
                    <div><dt>任務設定</dt><dd>{result.candidate.generationTelemetry.profileId}</dd></div>
                    <div><dt>品質管線</dt><dd>{QUALITY_LABELS[result.candidate.generationTelemetry.qualityMode]} · {result.candidate.generationTelemetry.qualityPasses} 次真實推理</dd></div>
                    <div><dt>模型耗時</dt><dd>{result.candidate.generationTelemetry.elapsedMs} ms</dd></div>
                    <div><dt>首字延遲</dt><dd>{result.candidate.generationTelemetry.firstTokenMs === null ? "整批回應" : `${result.candidate.generationTelemetry.firstTokenMs} ms`}</dd></div>
                    <div><dt>真實生成事件</dt><dd data-testid="closed-ai-generated-token-events">{result.candidate.generationTelemetry.generatedTokenEvents}</dd></div>
                    <div><dt>輸入／輸出</dt><dd>{result.candidate.generationTelemetry.inputCharacters}／{result.candidate.generationTelemetry.outputCharacters} 字</dd></div>
                    <div><dt>預算省略</dt><dd>{result.candidate.generationTelemetry.omittedInputCharacters} 字</dd></div>
                    {result.candidate.generationTelemetry.draftDigest ? <div><dt>暫存草稿雜湊</dt><dd>{result.candidate.generationTelemetry.draftDigest}</dd></div> : null}
                    {result.candidate.generationTelemetry.criticDigest ? <div><dt>反方檢查雜湊</dt><dd>{result.candidate.generationTelemetry.criticDigest}</dd></div> : null}
                  </> : null}
                  <div><dt>候選快取</dt><dd>{result.cache.candidateHit ? "命中" : "未命中"}</dd></div>
                  <div><dt>計畫快取</dt><dd>{result.cache.planHit ? "命中" : "未命中"}</dd></div>
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
