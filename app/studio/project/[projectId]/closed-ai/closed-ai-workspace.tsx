"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CLOSED_AI_BACKEND_IDS,
  ClosedAgentOS,
  type ClosedAIBackendId,
  type ClosedAIBackendSnapshot,
  type ClosedAgentExecutionResult,
} from "@/lib/novel-ai/closed-agent-os";
import type { ClosedAINamespace } from "@/lib/novel-ai/closed-ai-cache";
import type { PlatformTaskType } from "@/lib/novel-ai/router/platform-types";
import ProjectNavigation from "../project-navigation";
import styles from "./closed-ai.module.css";

type Dashboard = Awaited<ReturnType<ClosedAgentOS["dashboard"]>>;

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
  if (status === "ready") return "可執行";
  if (status === "contract_ready_runtime_not_connected") return "安全契約完成，算力未連線";
  if (status === "runtime_required") return "需要本機執行環境";
  if (status === "degraded") return "功能降級";
  return "已停用";
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
  const [snapshots, setSnapshots] = useState<ClosedAIBackendSnapshot[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [taskType, setTaskType] = useState<PlatformTaskType>("story.summary");
  const [backend, setBackend] = useState<ClosedAIBackendId | "auto">("auto");
  const [objective, setObjective] = useState("整理目前章節的角色、事件、衝突與未解線索。");
  const [storyContext, setStoryContext] = useState("");
  const [result, setResult] = useState<ClosedAgentExecutionResult | null>(null);
  const [status, setStatus] = useState("正在核對三個閉端 AI 與共用系統。");
  const [busy, setBusy] = useState(false);

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

  const refresh = useCallback(async (announce = true) => {
    const [nextSnapshots, nextDashboard] = await Promise.all([
      os.backendSnapshots(),
      os.dashboard(projectId),
    ]);
    setSnapshots(nextSnapshots);
    setDashboard(nextDashboard);
    if (announce) {
      setStatus("三閉端 AI 與共用 Closed Agent OS 已完成核對。");
    }
  }, [os, projectId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([os.backendSnapshots(), os.dashboard(projectId)])
      .then(([nextSnapshots, nextDashboard]) => {
        if (cancelled) return;
        setSnapshots(nextSnapshots);
        setDashboard(nextDashboard);
        setStatus("三閉端 AI 與共用 Closed Agent OS 已完成核對。");
      })
      .catch((error) => {
        if (!cancelled) setStatus(userMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [os, projectId]);

  async function runTask() {
    if (busy || !objective.trim()) return;
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
      });
      setResult(next);
      setStatus(`候選已由${BACKEND_LABELS[next.route.backendId]}完成，通過評估，等待你的核准。`);
      await refresh(false);
    } catch (error) {
      setStatus(userMessage(error));
    } finally {
      setBusy(false);
    }
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
      const count = await os.cache.invalidate({ projectId });
      setStatus(`已精準清除這個作品的 ${count} 筆 AI Cache；其他作品未受影響。`);
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
          <button type="button" disabled={busy} onClick={() => void refresh()}>重新檢查</button>
        </div>
      </header>

      <ProjectNavigation projectId={projectId} active="closed-ai" />
      <p className={styles.status} role="status" aria-live="polite">{status}</p>

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
                </dl>
              </article>
            ))}
          </div>
          <details>
            <summary>能力真相與限制</summary>
            <ul>
              <li>Browser AI 不承擔長篇推理或多代理工作。</li>
              <li>Local Ollama 需要本機 Bridge、配對與可用模型。</li>
              <li>Private AI Hub 的閘道契約已完成；目前沒有私有算力端點時，不宣稱已連線。</li>
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
          <button className={styles.primary} type="button" disabled={busy || !objective.trim()} onClick={() => void runTask()}>
            {busy ? "處理中…" : "建立候選"}
          </button>

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
            <h3>區塊鏈式可驗證機制</h3>
            <p>使用 Append-only、SHA-256 雜湊鏈、Merkle Tree、ECDSA 簽章與內容定址；不是公開區塊鏈，也沒有投票或資料複製。</p>
          </div>

          <details>
            <summary>技術狀態</summary>
            <ul>
              <li>模型訓練：not_started</li>
              <li>模型蒸餾：not_started</li>
              <li>L2 Adapter：contract_only</li>
              <li>Private Hub Runtime：contract_ready_runtime_not_connected</li>
              <li>思考鏈保存：false</li>
              <li>代理直接 Shell／DB／檔案／網路權限：false</li>
            </ul>
          </details>
        </section>
      </div>
    </main>
  );
}
