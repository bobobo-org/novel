"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NovelProject } from "@/lib/novel-ai/domain";
import { PrivateHubClient } from "@/lib/novel-ai/providers/private-ai-hub/private-hub-client";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  approveLearningRule,
  buildApprovedLearningContext,
  clearLearningSourceQuarantine,
  createSovereignLearningRepository,
  createSovereignLearningSnapshot,
  evaluateApprovedLearningCapability,
  generateNarrativeRecipes,
  getSovereignLearningDashboard,
  ingestDistilledWebKnowledge,
  ingestLearningSource,
  rejectLearningRule,
  replaceLearningRule,
  restoreSovereignLearningSnapshot,
  runAutonomousLearningPractice,
  revokeLearningSource,
  type AutonomousPracticeExperience,
  type LearningRightsBasis,
  type LearningSourceKind,
  type ControlledTeacherProvider,
  type DistilledWebKnowledgeBundle,
  type SovereignLearningSnapshot,
} from "@/lib/novel-ai/sovereign-learning";
import { runStudioClosedAI } from "@/lib/novel-ai/web/studio-closed-ai";
import ProjectNavigation from "../project-navigation";
import styles from "./learning.module.css";

type Dashboard = Awaited<ReturnType<typeof getSovereignLearningDashboard>>;
type RecipeResult = ReturnType<typeof generateNarrativeRecipes>;
type CapabilityReport = Awaited<ReturnType<typeof evaluateApprovedLearningCapability>>;
type ExternalProviderStatus = {
  id: string;
  label: string;
  configured: boolean;
  modelId: string;
};

type AutonomousSettings = {
  enabled: boolean;
  syncEnabled: boolean;
  intervalMinutes: number;
  installationId: string;
  consentId: string;
  lastRunAt: string | null;
  lastOutcome: string | null;
};

const AUTONOMOUS_SETTINGS_PREFIX = "novel-autonomous-learning-settings-v1";
const AUTONOMOUS_QUEUE_KEY = "novel-autonomous-learning-queue-v1";

const sourceKindOptions: Array<[LearningSourceKind, string]> = [
  ["article", "文章"],
  ["book_excerpt", "書籍節選"],
  ["ai_output", "其他 AI 的輸出"],
  ["personal_note", "自己的筆記"],
  ["public_domain_work", "公版作品"],
  ["licensed_material", "已授權資料"],
];

const rightsOptions: Array<[LearningRightsBasis, string]> = [
  ["lawful_private_reference", "合法取得，只供本機私人分析"],
  ["owned_by_user", "我擁有內容權利"],
  ["public_domain", "已確認為公版"],
  ["licensed_for_analysis", "已取得分析／衍生使用授權"],
  ["ai_output_authorized", "AI 輸出，已獲准供本機分析"],
];

const taskOptions = [
  ["continue_writing", "續寫"],
  ["rewrite", "改寫"],
  ["dialogue_generation", "對話"],
  ["scene_expansion", "擴寫場景"],
  ["outline_generation", "規劃大綱"],
] as const;

function errorMessage(error: unknown) {
  const code = String((error as { code?: string })?.code || "");
  if (code === "NO_CLOSED_PROVIDER_AVAILABLE" || code === "CLOSED_PROVIDER_UNAVAILABLE") {
    return "本機模型目前不可用；你可以取消「閉端 AI 深度抽象」，先使用本機統計規則分析。";
  }
  if (code === "LEARNING_CREDENTIAL_INPUT_BLOCKED") {
    return "內容中疑似含有登入權杖或 API 金鑰，已安全阻止匯入。請先移除敏感字串。";
  }
  return error instanceof Error ? error.message : "操作失敗，請稍後重試。";
}

function autonomousSettingsKey(projectId: string) {
  return `${AUTONOMOUS_SETTINGS_PREFIX}:${projectId}`;
}

function defaultAutonomousSettings(): AutonomousSettings {
  return {
    enabled: false,
    syncEnabled: false,
    intervalMinutes: 30,
    installationId: crypto.randomUUID(),
    consentId: crypto.randomUUID(),
    lastRunAt: null,
    lastOutcome: null,
  };
}

function readPracticeQueue() {
  try {
    const value = JSON.parse(localStorage.getItem(AUTONOMOUS_QUEUE_KEY) || "[]") as unknown;
    return Array.isArray(value) ? value.slice(-100) as AutonomousPracticeExperience[] : [];
  } catch {
    return [];
  }
}

function writePracticeQueue(queue: AutonomousPracticeExperience[]) {
  localStorage.setItem(AUTONOMOUS_QUEUE_KEY, JSON.stringify(queue.slice(-100)));
}

export default function LearningWorkspace({ projectId }: { projectId: string }) {
  const learningRepository = useMemo(() => createSovereignLearningRepository(), []);
  const projectRepository = useMemo(() => createNovelRepository(), []);
  const [projectTitle, setProjectTitle] = useState("目前作品");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [status, setStatus] = useState("正在讀取本機學習庫。");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [sourceKind, setSourceKind] = useState<LearningSourceKind>("article");
  const [rightsBasis, setRightsBasis] = useState<LearningRightsBasis>("lawful_private_reference");
  const [rightsEvidence, setRightsEvidence] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [deepExtraction, setDeepExtraction] = useState(true);
  const [content, setContent] = useState("");
  const [recipeTask, setRecipeTask] = useState("continue_writing");
  const [recipeSeed, setRecipeSeed] = useState("第一組");
  const [recipes, setRecipes] = useState<RecipeResult | null>(null);
  const [webUrl, setWebUrl] = useState("");
  const [webRightsBasis, setWebRightsBasis] = useState<LearningRightsBasis>("lawful_private_reference");
  const [webRightsEvidence, setWebRightsEvidence] = useState("");
  const [webRightsConfirmed, setWebRightsConfirmed] = useState(false);
  const [externalConsent, setExternalConsent] = useState(false);
  const [teacherProviders, setTeacherProviders] = useState<ControlledTeacherProvider[]>(["openai", "grok"]);
  const [providerStatuses, setProviderStatuses] = useState<ExternalProviderStatus[]>([]);
  const [capabilityReport, setCapabilityReport] = useState<CapabilityReport | null>(null);
  const [autonomousSettings, setAutonomousSettings] = useState<AutonomousSettings | null>(null);
  const [autonomousBusy, setAutonomousBusy] = useState(false);
  const [practiceQueueCount, setPracticeQueueCount] = useState(0);
  const [autonomousStatus, setAutonomousStatus] = useState("自動練習尚未啟用。");
  const autonomousRunningRef = useRef(false);
  const autonomousExecuteRef = useRef<(announce?: boolean) => Promise<void>>(async () => undefined);

  const load = useCallback(async (announce = true) => {
    const next = await getSovereignLearningDashboard(learningRepository, projectId);
    setDashboard(next);
    if (announce) setStatus("本機學習庫已就緒。");
  }, [learningRepository, projectId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getSovereignLearningDashboard(learningRepository, projectId),
      projectRepository.get<NovelProject>("projects", projectId),
    ]).then(([next, project]) => {
      if (cancelled) return;
      setDashboard(next);
      setStatus("本機學習庫已就緒。");
      if (project?.title) setProjectTitle(project.title);
    }).catch((error) => {
      if (!cancelled) setStatus(errorMessage(error));
    });
    return () => {
      cancelled = true;
    };
  }, [learningRepository, projectId, projectRepository]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ai/external/providers", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("無法讀取外接教師狀態。");
        return response.json() as Promise<{ providers?: ExternalProviderStatus[] }>;
      })
      .then((payload) => {
        if (cancelled) return;
        const supported = (payload.providers ?? []).filter((provider) => provider.id === "openai" || provider.id === "grok");
        setProviderStatuses(supported);
        const configured = supported.filter((provider) => provider.configured).map((provider) => provider.id as ControlledTeacherProvider);
        if (configured.length) setTeacherProviders(configured);
      })
      .catch(() => {
        if (!cancelled) setProviderStatuses([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const fallback = defaultAutonomousSettings();
        const stored = JSON.parse(localStorage.getItem(autonomousSettingsKey(projectId)) || "null") as Partial<AutonomousSettings> | null;
        const settings: AutonomousSettings = {
          ...fallback,
          ...(stored ?? {}),
          intervalMinutes: Math.max(15, Math.min(1_440, Number(stored?.intervalMinutes) || 30)),
          installationId: stored?.installationId || fallback.installationId,
          consentId: stored?.consentId || fallback.consentId,
        };
        setAutonomousSettings(settings);
        setPracticeQueueCount(readPracticeQueue().length);
        setAutonomousStatus(settings.enabled
          ? "自動練習已啟用；網頁開啟期間會定期執行，重新開啟時會補跑逾期工作。"
          : "自動練習尚未啟用。");
      } catch {
        const settings = defaultAutonomousSettings();
        setAutonomousSettings(settings);
        setPracticeQueueCount(0);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [projectId]);

  useEffect(() => {
    if (!autonomousSettings) return;
    localStorage.setItem(autonomousSettingsKey(projectId), JSON.stringify(autonomousSettings));
  }, [autonomousSettings, projectId]);

  useEffect(() => {
    autonomousExecuteRef.current = executeAutonomousPractice;
  });

  useEffect(() => {
    if (!autonomousSettings?.enabled) return;
    const due = () => {
      const last = autonomousSettings.lastRunAt ? Date.parse(autonomousSettings.lastRunAt) : 0;
      return !last || Date.now() - last >= autonomousSettings.intervalMinutes * 60_000;
    };
    if (due()) void autonomousExecuteRef.current(false);
    const timer = window.setInterval(() => {
      if (due()) void autonomousExecuteRef.current(false);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [autonomousSettings?.enabled, autonomousSettings?.intervalMinutes, autonomousSettings?.lastRunAt]);

  async function analyze() {
    if (busy) return;
    setBusy(true);
    setStatus("正在檢查來源、授權與敏感資料。");
    try {
      const result = await ingestLearningSource(learningRepository, {
        projectId,
        title,
        author,
        sourceReference,
        sourceKind,
        rightsBasis,
        rightsEvidence,
        userConfirmedRights: rightsConfirmed,
        content,
        deepExtractor: deepExtraction
          ? async ({ prompt }) => {
            const result = await runStudioClosedAI({
              projectId,
              task: "knowledge_rule_extraction",
              input: prompt,
            });
            return {
              content: result.content,
              provider: result.provider,
              model: result.model,
              externalRequest: result.externalRequest,
              dataLeftDevice: result.dataLeftDevice,
            };
          }
          : undefined,
        onProgress: ({ phase, current, total }) => {
          const labels = {
            validating: "正在檢查來源與安全邊界",
            deterministic: "正在計算文章敘事 DNA",
            deep_extraction: "閉端 AI 正在抽象創作規則",
            persisting: "正在寫入本機候選規則",
          };
          setStatus(`${labels[phase]}${total > 1 ? `（${current}/${total}）` : ""}。`);
        },
      });
      setStatus(
        result.duplicate
          ? `這份來源已分析過，沿用 ${result.rules.length} 條既有規則。`
          : `分析完成：建立 ${result.rules.length} 條規則候選；原文未保存。${result.deepExtractionFailures ? ` 有 ${result.deepExtractionFailures} 段深度抽象失敗，已保留本機統計結果。` : ""}`,
      );
      setContent("");
      setRightsConfirmed(false);
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function researchWeb() {
    if (busy) return;
    setBusy(true);
    setStatus("正在驗證 HTTPS、公開 DNS、robots 規則與提示注入風險。");
    try {
      const response = await fetch("/api/ai/learning/web-distill", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          url: webUrl,
          rightsBasis: webRightsBasis,
          rightsEvidence: webRightsEvidence,
          userConfirmedRights: webRightsConfirmed,
          externalConsent,
          providerIds: teacherProviders,
        }),
      });
      const payload = await response.json() as DistilledWebKnowledgeBundle & {
        error?: string;
        code?: string;
        detailCodes?: string[];
      };
      if (!response.ok) {
        throw Object.assign(new Error(payload.error || "受控網路蒸餾失敗。"), {
          code: payload.code,
          detailCodes: payload.detailCodes,
        });
      }
      setStatus("教師已完成抽象；正在驗證封包雜湊、非抄寫指標與候選邊界。");
      const result = await ingestDistilledWebKnowledge(learningRepository, {
        projectId,
        bundle: payload,
        rightsBasis: webRightsBasis,
        rightsEvidence: webRightsEvidence,
        userConfirmedRights: webRightsConfirmed,
        externalConsent,
      });
      setStatus(
        result.duplicate
          ? `此網路來源已研究過，沿用 ${result.rules.length} 條既有規則。`
          : `受控研究完成：${result.externalRequestCount} 個教師建立 ${result.rules.length} 條候選。原文與教師完整輸出均未保存；正式能力尚未變更。`,
      );
      setWebUrl("");
      setWebRightsConfirmed(false);
      setExternalConsent(false);
      setCapabilityReport(null);
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function runCapabilitySelfCheck() {
    if (busy) return;
    setBusy(true);
    setStatus("正在執行核准規則 A/B 整合測試與來源血緣檢查。");
    try {
      const report = await evaluateApprovedLearningCapability({
        repository: learningRepository,
        projectId,
      });
      setCapabilityReport(report);
      setStatus(
        report.status === "passed"
          ? `能力自我檢查通過：${report.selectedRuleIds.length} 條核准規則已進入執行期，整合分數提升 ${report.scores.capabilityDelta}。`
          : report.interpretation,
      );
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function flushPracticeQueue(queueInput?: AutonomousPracticeExperience[]) {
    const queue = queueInput ?? readPracticeQueue();
    if (!autonomousSettings?.syncEnabled || !queue.length) {
      setPracticeQueueCount(queue.length);
      return {
        remaining: queue,
        forwarded: 0,
        serverReceived: false,
        destination: null as "local_private_hub" | "server_private_hub" | null,
      };
    }
    const remaining = [...queue];
    let forwarded = 0;
    let serverReceived = false;
    let localHubReady: boolean | null = null;
    let destination: "local_private_hub" | "server_private_hub" | null = null;
    const localHub = new PrivateHubClient({
      origin: window.location.origin,
      rememberWithinTab: true,
    });
    const batchSize = Math.min(5, remaining.length);
    for (let index = 0; index < batchSize; index += 1) {
      const experience = remaining[0];
      let durable = false;
      if (localHubReady !== false) {
        try {
          if (localHubReady === null) {
            const restored = await localHub.restoreRememberedControlSession();
            if (!restored) await localHub.connectControlAutomatically();
            localHubReady = true;
          }
          if (localHubReady) {
            const receipt = await localHub.storeLearningExperience(experience);
            durable = receipt.durable;
            destination = "local_private_hub";
          }
        } catch {
          localHubReady = false;
        }
      }
      if (!durable && navigator.onLine) {
        try {
          const response = await fetch("/api/ai/learning/experience-sync", {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(experience),
          });
          const receipt = await response.json() as { forwarded?: boolean; durable?: boolean };
          if (response.ok || response.status === 202) serverReceived = true;
          if (receipt.forwarded && receipt.durable) {
            durable = true;
            destination = "server_private_hub";
          }
        } catch {
          // Keep the de-identified experience in the local queue for a later retry.
        }
      }
      if (!durable) break;
      remaining.shift();
      forwarded += 1;
    }
    writePracticeQueue(remaining);
    setPracticeQueueCount(remaining.length);
    return { remaining, forwarded, serverReceived, destination };
  }

  async function retryPracticeQueue() {
    setAutonomousBusy(true);
    setAutonomousStatus("正在驗證去識別化摘要並嘗試交付 Private Hub。");
    try {
      const sync = await flushPracticeQueue();
      setAutonomousStatus(
        sync.forwarded > 0
          ? `${sync.forwarded} 筆去識別化經驗已由${sync.destination === "local_private_hub" ? "本機" : "伺服器"} Private Hub 追加式帳本永久接收。`
          : sync.serverReceived
            ? "應用伺服器已驗證摘要；Private Hub 尚未連線，因此摘要仍安全保留在本機佇列。"
            : navigator.onLine
              ? `${sync.remaining.length} 筆安全摘要仍在本機佇列，稍後可重試。`
              : "目前離線；安全摘要仍保留在本機，恢復連線後可重試。",
      );
    } catch (error) {
      setAutonomousStatus(errorMessage(error));
    } finally {
      setAutonomousBusy(false);
    }
  }

  async function executeAutonomousPractice(announce = true) {
    if (!autonomousSettings || autonomousRunningRef.current) return;
    autonomousRunningRef.current = true;
    setAutonomousBusy(true);
    if (announce) setAutonomousStatus("正在沙盒中自動練習與評估；正式作品不會被修改。");
    try {
      const result = await runAutonomousLearningPractice({
        repository: learningRepository,
        projectId,
        installationId: autonomousSettings.installationId,
        consentId: autonomousSettings.consentId,
      });
      const queue = [...readPracticeQueue().filter((item) => item.experienceDigest !== result.experience.experienceDigest), result.experience].slice(-100);
      writePracticeQueue(queue);
      setCapabilityReport(result.capability);
      const sync = await flushPracticeQueue(queue);
      setAutonomousSettings((current) => current ? {
        ...current,
        lastRunAt: result.experience.createdAt,
        lastOutcome: result.experience.outcome,
      } : current);
      setAutonomousStatus(
        sync.forwarded > 0
          ? `自動練習完成，${sync.forwarded} 筆去識別化經驗已由${sync.destination === "local_private_hub" ? "本機" : "伺服器"} Private Hub 追加式帳本永久接收。`
          : sync.serverReceived
            ? "自動練習完成；應用伺服器已驗證經驗，但 Private Hub 尚未連線，安全摘要保留在本機佇列。"
            : `自動練習完成（${result.experience.outcome}）；${sync.remaining.length} 筆安全摘要等待回傳。`,
      );
    } catch (error) {
      setAutonomousStatus(errorMessage(error));
    } finally {
      autonomousRunningRef.current = false;
      setAutonomousBusy(false);
    }
  }

  function setAutonomousEnabled(enabled: boolean) {
    setAutonomousSettings((current) => current ? {
      ...current,
      enabled,
      consentId: enabled ? crypto.randomUUID() : current.consentId,
      lastRunAt: enabled ? null : current.lastRunAt,
    } : current);
    setAutonomousStatus(enabled
      ? "已建立本機持續同意；即將開始第一輪自動練習。"
      : "自動練習已停止；既有安全摘要仍可由你保留或清除。");
  }

  function clearPracticeQueue() {
    writePracticeQueue([]);
    setPracticeQueueCount(0);
    setAutonomousStatus("尚未回傳的自動練習摘要已從本機清除。");
  }

  function toggleTeacher(provider: ControlledTeacherProvider, checked: boolean) {
    setTeacherProviders((current) => checked
      ? [...new Set([...current, provider])]
      : current.filter((value) => value !== provider));
  }

  async function approve(ruleId: string) {
    setBusy(true);
    try {
      await approveLearningRule(learningRepository, projectId, ruleId);
      setCapabilityReport(null);
      setStatus("規則已核准，之後的閉端 AI 生成會把它列入可用規則。");
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function reject(ruleId: string) {
    setBusy(true);
    try {
      await rejectLearningRule(learningRepository, projectId, ruleId);
      setStatus("規則已拒絕，不會進入生成上下文。");
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function replace(ruleId: string) {
    setBusy(true);
    try {
      const result = await replaceLearningRule(learningRepository, projectId, ruleId);
      setCapabilityReport(null);
      setStatus(`新規則已核准，並取代 ${result.superseded.length} 條衝突規則。`);
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function clearQuarantine(sourceId: string) {
    if (!window.confirm("你已人工檢查這份來源中的可疑指令，確定只把它當資料分析嗎？")) return;
    setBusy(true);
    try {
      await clearLearningSourceQuarantine(
        learningRepository,
        projectId,
        sourceId,
        true,
      );
      setStatus("來源已解除隔離；規則仍是候選，必須逐條核准。");
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(sourceId: string) {
    if (!window.confirm("撤銷後，這個來源的所有規則會立即停止影響 AI。確定繼續？")) return;
    setBusy(true);
    try {
      await revokeLearningSource(learningRepository, projectId, sourceId);
      setCapabilityReport(null);
      setStatus("來源與其規則已撤銷，不再參與任何組合或生成。");
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function buildRecipes() {
    setBusy(true);
    try {
      const context = await buildApprovedLearningContext({
        repository: learningRepository,
        projectId,
        taskType: recipeTask,
        maximumRules: 12,
      });
      const result = generateNarrativeRecipes({
        rules: context.rules,
        taskType: recipeTask,
        count: 3,
        seed: recipeSeed,
      });
      setRecipes(result);
      setStatus(
        result.recipes.length
          ? `已從核准規則建立 ${result.recipes.length} 組原創配方。`
          : "目前沒有足夠的已核准規則；請先核准候選。",
      );
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function exportSnapshot() {
    setBusy(true);
    try {
      const snapshot = await createSovereignLearningSnapshot(
        learningRepository,
        projectId,
      );
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${projectTitle}-閉端AI學習庫.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("學習庫快照已匯出；快照不含來源原文。");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function importSnapshot(file: File) {
    if (!window.confirm("還原會取代這個作品目前的閉端 AI 學習庫。確定繼續？")) return;
    setBusy(true);
    try {
      const snapshot = JSON.parse(await file.text()) as SovereignLearningSnapshot;
      await restoreSovereignLearningSnapshot(
        learningRepository,
        snapshot,
        projectId,
      );
      setStatus("學習庫快照雜湊驗證通過，已完成還原。");
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const candidateRules = dashboard?.rules.filter((rule) =>
    rule.status === "candidate" || rule.status === "quarantined") ?? [];
  const approvedRules = dashboard?.rules.filter((rule) => rule.status === "approved") ?? [];

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link href="/studio">返回作品</Link>
        <div>
          <small>{projectTitle}</small>
          <h1>閉端 AI 規則學習中心</h1>
          <p>吸收敘事機制，不保存原文、不模仿原句；所有規則先成為候選，經你核准才生效。</p>
        </div>
        <span className={styles.localBadge}>本機主權＋選用外接教師</span>
      </header>
      <ProjectNavigation projectId={projectId} active="learning" />

      <section className={styles.statusGrid} aria-label="學習狀態">
        <article><small>有效來源</small><strong>{dashboard?.counts.activeSources ?? 0}</strong></article>
        <article><small>待核准規則</small><strong>{dashboard?.counts.candidateRules ?? 0}</strong></article>
        <article><small>已核准規則</small><strong>{dashboard?.counts.approvedRules ?? 0}</strong></article>
        <article><small>有效組合空間</small><strong>{dashboard?.combinationSpace.display ?? "0"}</strong></article>
      </section>

      <p className={styles.status} role="status" aria-live="polite">{status}</p>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><small>受控知識蒸餾</small><h2>從指定公開來源抽象方法，不複製內容</h2></div>
          <span>HTTPS／SSRF／robots／提示注入防護</span>
        </div>
        <div className={styles.webResearchGrid}>
          <div>
            <label>公開來源網址
              <input type="url" value={webUrl} onChange={(event) => setWebUrl(event.target.value)} placeholder="https://example.com/你有權分析的文章" />
            </label>
            <div className={styles.twoColumns}>
              <label>權利依據
                <select value={webRightsBasis} onChange={(event) => setWebRightsBasis(event.target.value as LearningRightsBasis)}>
                  {rightsOptions.filter(([value]) => value !== "ai_output_authorized").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>授權／公版／合法私人分析依據
                <input value={webRightsEvidence} onChange={(event) => setWebRightsEvidence(event.target.value)} placeholder="請填條款、年份、作者授權或取得方式" />
              </label>
            </div>
          </div>
          <div className={styles.teacherBox}>
            <strong>選擇外接教師</strong>
            {(["openai", "grok"] as const).map((providerId) => {
              const provider = providerStatuses.find((item) => item.id === providerId);
              return <label className={styles.check} key={providerId}>
                <input
                  type="checkbox"
                  checked={teacherProviders.includes(providerId)}
                  disabled={!provider?.configured}
                  onChange={(event) => toggleTeacher(providerId, event.target.checked)}
                />
                {provider?.label ?? (providerId === "openai" ? "OpenAI（ChatGPT 系列）" : "xAI Grok")}
                <span>{provider?.configured ? `${provider.modelId} · 已設定` : "伺服器尚未設定"}</span>
              </label>;
            })}
            <p className={styles.note}>雙教師會交叉比對；單一教師也可執行。教師只能提出候選，不能自行核准。</p>
          </div>
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={webRightsConfirmed} onChange={(event) => setWebRightsConfirmed(event.target.checked)} />
          我確認有權分析這個指定來源；系統不會自行遍歷整個網站，也不會保存來源原文
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={externalConsent} onChange={(event) => setExternalConsent(event.target.checked)} />
          我同意把安全清理後的來源暫時送給所選教師 AI；原文、教師完整回覆與憑證不會寫入學習庫
        </label>
        <button
          type="button"
          disabled={
            busy
            || !webUrl.trim()
            || !webRightsEvidence.trim()
            || !webRightsConfirmed
            || !externalConsent
            || !teacherProviders.some((id) => providerStatuses.some((provider) => provider.id === id && provider.configured))
          }
          onClick={() => void researchWeb()}
        >
          {busy ? "處理中…" : "安全抓取並建立規則候選"}
        </button>
        <p className={styles.note}>這不是「把全網灌進模型」：每次只處理你指定且有權分析的來源，抽象後仍須逐條核准，並可隨時撤銷回滾。</p>
      </section>

      <div className={styles.columns}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div><small>步驟 1</small><h2>匯入並抽象規則</h2></div>
            <span>原文分析後丟棄</span>
          </div>
          <label>來源標題<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：某篇節奏分析文章" /></label>
          <div className={styles.twoColumns}>
            <label>來源類型
              <select value={sourceKind} onChange={(event) => {
                const kind = event.target.value as LearningSourceKind;
                setSourceKind(kind);
                if (kind === "ai_output") setRightsBasis("ai_output_authorized");
              }}>
                {sourceKindOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>權利依據
              <select value={rightsBasis} onChange={(event) => setRightsBasis(event.target.value as LearningRightsBasis)}>
                {rightsOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <div className={styles.twoColumns}>
            <label>作者／提供者<input value={author} onChange={(event) => setAuthor(event.target.value)} /></label>
            <label>來源網址或識別資料<input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} /></label>
          </div>
          <label>授權證據或備註<input value={rightsEvidence} onChange={(event) => setRightsEvidence(event.target.value)} placeholder="公版年份、授權條款或取得方式" /></label>
          <label>貼上文章或 AI 輸出
            <textarea rows={12} value={content} onChange={(event) => setContent(event.target.value)} placeholder="原文只用於這次本機分析，不會寫入學習庫。" />
          </label>
          <label className={styles.fileLabel}>或載入本機文字檔
            <input type="file" accept=".txt,.md,.html,.json,text/plain,text/markdown,text/html,application/json" onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then((text) => {
                setContent(text);
                setTitle((current) => current || file.name);
              }).catch((error) => setStatus(errorMessage(error)));
            }} />
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={deepExtraction} onChange={(event) => setDeepExtraction(event.target.checked)} />
            若本機 Ollama／瀏覽器閉端 AI 可用，進行深度規則抽象
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} />
            我確認有權在自己的裝置上分析此內容，並了解來源文字不會被當成系統指令
          </label>
          <button type="button" disabled={busy || !content.trim() || !title.trim() || !rightsConfirmed} onClick={() => void analyze()}>
            {busy ? "處理中…" : "分析並建立規則候選"}
          </button>
          <p className={styles.note}>若偵測到密鑰、提示注入或隱藏指令，系統會阻擋或隔離；不會偷偷抓取網站，也不會把作品送到外部 AI。</p>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div><small>步驟 2</small><h2>逐條核准候選</h2></div>
            <span>{candidateRules.length} 條</span>
          </div>
          <div className={styles.ruleList}>
            {candidateRules.length === 0 ? <p className={styles.empty}>目前沒有待處理候選。</p> : candidateRules.map((rule) => (
              <article className={styles.ruleCard} key={rule.id} data-status={rule.status}>
                <header>
                  <span>{rule.family} / {rule.dimension}</span>
                  <b>{rule.status === "quarantined" ? "隔離中" : `${Math.round(rule.confidence * 100)}%`}</b>
                </header>
                <h3>{rule.statement}</h3>
                <dl>
                  <div><dt>適用</dt><dd>{rule.recipe.when}</dd></div>
                  <div><dt>操作</dt><dd>{rule.recipe.operation}</dd></div>
                  <div><dt>限制</dt><dd>{rule.recipe.constraint}</dd></div>
                  <div><dt>檢查</dt><dd>{rule.recipe.evaluate}</dd></div>
                </dl>
                <p>抽象度 {Math.round(rule.abstractionScore * 100)}% · 來源連續比對 {rule.longestSourceMatch} 字 · {rule.extractorKind === "external_teacher_ai" ? `外接教師候選（${rule.extractorProvider}）` : rule.extractorKind === "local_closed_ai" ? "閉端 AI" : "本機統計"}</p>
                {rule.status === "candidate" ? <div className={styles.actions}>
                  <button type="button" disabled={busy} onClick={() => void approve(rule.id)}>核准</button>
                  {rule.conflictRuleIds.length ? <button type="button" disabled={busy} onClick={() => void replace(rule.id)}>取代衝突規則</button> : null}
                  <button type="button" className={styles.secondary} disabled={busy} onClick={() => void reject(rule.id)}>拒絕</button>
                </div> : <p className={styles.warning}>來源仍在安全隔離；先到來源紀錄人工確認。</p>}
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><small>步驟 3</small><h2>測試規則排列與組合</h2></div>
          <span>不窮舉無效組合</span>
        </div>
        <div className={styles.recipeToolbar}>
          <label>用途
            <select value={recipeTask} onChange={(event) => setRecipeTask(event.target.value)}>
              {taskOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>變化種子<input value={recipeSeed} onChange={(event) => setRecipeSeed(event.target.value)} /></label>
          <button type="button" disabled={busy || approvedRules.length === 0} onClick={() => void buildRecipes()}>建立三組配方</button>
        </div>
        <div className={styles.recipeGrid}>
          {recipes?.recipes.map((recipe) => (
            <article key={recipe.recipeId}>
              <h3>{recipe.recipeId}</h3>
              <ol>{recipe.steps.map((step, index) => <li key={`${recipe.recipeId}:step:${index}`}>{step}</li>)}</ol>
              <details><summary>限制與驗收</summary>
                <ul>{recipe.constraints.map((item, index) => <li key={`${recipe.recipeId}:constraint:${index}`}>{item}</li>)}</ul>
                <ul>{recipe.evaluation.map((item, index) => <li key={`${recipe.recipeId}:evaluation:${index}`}>{item}</li>)}</ul>
              </details>
            </article>
          ))}
        </div>
        <div className={styles.capabilityCheck}>
          <div>
            <h3>能力自我檢查</h3>
            <p>比較沒有學習規則的 Control 與已核准規則的 Treatment，驗證規則是否真的被執行期選取、形成完整配方並保有來源血緣。</p>
          </div>
          <button type="button" disabled={busy} onClick={() => void runCapabilitySelfCheck()}>執行能力自我檢查</button>
          {capabilityReport ? <article data-status={capabilityReport.status}>
            <strong>{capabilityReport.status === "passed" ? "PASS" : capabilityReport.status}</strong>
            <span>Control {capabilityReport.scores.control} → Treatment {capabilityReport.scores.treatment}（Δ {capabilityReport.scores.capabilityDelta}）</span>
            <span>已套用 {capabilityReport.selectedRuleIds.length} 條規則 · 任務覆蓋 {Math.round(capabilityReport.scores.taskCoverage * 100)}%</span>
            <code>{capabilityReport.evidenceDigest}</code>
            <small>{capabilityReport.interpretation}</small>
          </article> : null}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><small>可控自我學習</small><h2>自動練習與隱私安全經驗回傳</h2></div>
          <span>{practiceQueueCount} 筆等待 Private Hub</span>
        </div>
        {autonomousSettings ? <>
          <div className={styles.autonomousGrid}>
            <label className={styles.check}>
              <input type="checkbox" checked={autonomousSettings.enabled} onChange={(event) => setAutonomousEnabled(event.target.checked)} />
              開啟自動練習模式（啟用一次後，不必逐次手動啟動）
            </label>
            <label>練習間隔
              <select value={autonomousSettings.intervalMinutes} onChange={(event) => setAutonomousSettings((current) => current ? {
                ...current,
                intervalMinutes: Math.max(15, Math.min(1_440, Number(event.target.value) || 30)),
              } : current)}>
                <option value={15}>每 15 分鐘</option>
                <option value={30}>每 30 分鐘</option>
                <option value={60}>每小時</option>
                <option value={360}>每 6 小時</option>
                <option value={1440}>每天</option>
              </select>
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={autonomousSettings.syncEnabled} onChange={(event) => setAutonomousSettings((current) => current ? {
                ...current,
                syncEnabled: event.target.checked,
              } : current)} />
              同意把去識別化練習指標回傳應用伺服器／Private Hub
            </label>
            <div className={styles.practiceStats}>
              <span>上次：{autonomousSettings.lastRunAt ? new Date(autonomousSettings.lastRunAt).toLocaleString("zh-TW") : "尚未執行"}</span>
              <span>結果：{autonomousSettings.lastOutcome ?? "—"}</span>
              <span>佇列：{practiceQueueCount}</span>
            </div>
          </div>
          <p className={styles.status} role="status">{autonomousStatus}</p>
          <div className={styles.actions}>
            <button type="button" disabled={autonomousBusy} onClick={() => void executeAutonomousPractice(true)}>{autonomousBusy ? "練習中…" : "立即執行一輪"}</button>
            <button type="button" className={styles.secondary} disabled={autonomousBusy || !autonomousSettings.syncEnabled || practiceQueueCount === 0} onClick={() => void retryPracticeQueue()}>重試回傳佇列</button>
            <button type="button" className={styles.secondary} disabled={autonomousBusy || practiceQueueCount === 0} onClick={clearPracticeQueue}>清除待傳摘要</button>
          </div>
          <ul className={styles.truthList}>
            <li>自動練習只使用已核准規則，在沙盒中比較 Control／Treatment；未核准候選不參與。</li>
            <li>回傳內容只有雜湊、規則數、任務覆蓋與評分；不含作品原文、提示、生成全文、AUTHOR_ONLY、憑證或 chain-of-thought。</li>
            <li>Private Hub 執行中時會以正式站精確 Origin 自動建立短期工作階段，摘要優先寫入本機追加式雜湊鏈帳本，不要求密碼或配對碼。</li>
            <li>自動練習不修改 Canon、Memory 或模型權重；Private Hub 必須另行完成資料集審查、A/B Gate 與版本採用。</li>
            <li>瀏覽器關閉時不宣稱能持續執行；再次開啟本頁時會自動補跑逾期工作。</li>
          </ul>
        </> : <p className={styles.empty}>正在載入本機自動練習設定。</p>}
      </section>

      <div className={styles.columns}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><small>來源治理</small><h2>來源與撤銷</h2></div></div>
          <div className={styles.sourceList}>
            {dashboard?.sources.length ? dashboard.sources.map((source) => (
              <article key={source.id}>
                <div><strong>{source.title}</strong><span>{source.status} · {source.sourceKind}</span></div>
                <p>{source.language} · 信任分數 {Math.round(source.trustScore * 100)}% · 原文保存：否</p>
                {source.webProvenance ? <p>
                  <a href={source.webProvenance.finalUrl} target="_blank" rel="noreferrer">查看來源</a>
                  {` · robots ${source.webProvenance.robotsPolicy} · 外接 ${source.externalRequestCount ?? 0} 次 · 教師 ${source.teacherEvidence?.map((teacher) => `${teacher.provider}/${teacher.model}`).join("、") || "無"}`}
                </p> : null}
                {source.warningCodes.length ? <details><summary>{source.warningCodes.length} 項安全紀錄</summary><code>{source.warningCodes.join("\n")}</code></details> : null}
                <div className={styles.actions}>
                  {source.status === "quarantined" ? <button type="button" disabled={busy} onClick={() => void clearQuarantine(source.id)}>人工檢查後解除隔離</button> : null}
                  {source.status !== "revoked" ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void revoke(source.id)}>撤銷來源</button> : null}
                </div>
              </article>
            )) : <p className={styles.empty}>尚未匯入來源。</p>}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><small>復原與真相</small><h2>備份、還原與能力邊界</h2></div></div>
          <ul className={styles.truthList}>
            <li>已實作：本機規則抽象、候選核准、來源撤銷、規則組合、回饋偏好與防抄指紋。</li>
            <li>深度抽象：透過 Closed Agent OS 鎖定 Local Ollama；未配對時明確失敗，不會改用外部 AI。</li>
            <li>受控網路蒸餾：只讀取指定 HTTPS 來源，檢查公開 DNS、robots、重新導向、內容大小與提示注入；OpenAI／Grok 只提供候選。</li>
            <li>能力驗證：核准後用 Control／Treatment 比較規則是否真正進入執行期；分數代表整合完整度，不冒充模型權重品質。</li>
            <li>自我學習方式：核准規則＋本機 RAG／提示偏好，不會在背景偷偷改模型權重。</li>
            <li>L2 離線偏好模型：Private Hub 已可訓練、人工啟用與回滾；資料仍限定此作品。</li>
            <li>權重工作真相：LoRA／QLoRA 候選與蒸餾流程已開始；實際 QLoRA 訓練仍因本機沒有 CUDA 而受阻，不會假裝完成。</li>
            <li>來源原文與生成全文均不寫入學習紀錄，只保存雜湊、指紋與抽象規則。</li>
          </ul>
          <div className={styles.actions}>
            <Link href={`/studio/project/${projectId}/closed-ai#training`}>前往偏好模型訓練／啟用／回滾</Link>
            <button type="button" disabled={busy} onClick={() => void exportSnapshot()}>匯出學習庫快照</button>
            <label className={styles.importButton}>還原快照
              <input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importSnapshot(file);
                event.target.value = "";
              }} />
            </label>
          </div>
        </section>
      </div>
    </main>
  );
}
