"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  ClosedAIBackendId,
  ClosedAIProgressEvent,
  ClosedAgentExecutionResult,
} from "@/lib/novel-ai/closed-agent-os";
import type {
  Chapter,
  Character,
  CharacterRelationship,
  NovelProject,
  StoryBible,
  StoryState,
  TimelineEvent,
  World,
  WorldRule,
} from "@/lib/novel-ai/domain";
import {
  AUTHOR_TOOL_IDS,
  buildBatchPlan,
  buildClosedAuthorSuggestionHandoff,
  buildClosedAuthorSuggestionObjective,
  buildRelayPrompt,
  buildSerialResearch,
  buildWorkBreakdown,
  stageAuthorToolSnapshot,
  validateClosedAuthorSuggestion,
  type AuthorToolId,
  type AuthorToolSnapshot,
} from "@/lib/novel-ai/author-tools";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  executeStudioClosedAgent,
  rejectStudioClosedAgentCandidate,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import { stageStoryWorkspaceHandoff } from "@/lib/novel-ai/web/story-workspace-handoff";
import ProjectNavigation from "../project-navigation";
import styles from "./author-tools.module.css";

const TOOL_COPY: Record<AuthorToolId, { title: string; summary: string; action: string }> = {
  breakdown: {
    title: "書籍與作品拆解",
    summary: "從本作品的正式章節、角色、關係、世界規則與 Story Bible 產生可核對的結構報告。",
    action: "執行作品拆解",
  },
  relay: {
    title: "續寫接力提示",
    summary: "建立可複製的 Canon 接力包；只有你主動貼出時，外部工具才會看到其中內容。",
    action: "建立接力包",
  },
  batch: {
    title: "多章批量規劃",
    summary: "依目前章節位置、人物目標與未解線索建立逐章候選，不會直接新增或覆蓋正式章節。",
    action: "產生多章規劃",
  },
  serial: {
    title: "連載、讀者與 IP 研究",
    summary: "用本機可驗證的作品結構檢查節奏、章尾鉤子與改編準備度；不冒充平台流量數據。",
    action: "執行連載研究",
  },
};

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/gu, "-").slice(0, 80) || "作品";
}

function closedAIErrorMessage(cause: unknown) {
  const code = String((cause as { code?: unknown })?.code ?? "");
  if ([
    "CLOSED_AI_BROWSER_UNSUPPORTED_SETUP_REQUIRED",
    "CLOSED_AI_SETUP_REQUIRED",
    "CLOSED_AI_SELECTED_BACKEND_NOT_READY",
    "CLOSED_AI_REQUIRED_BACKEND_NOT_READY",
    "NO_PROVIDER_AVAILABLE",
    "PROVIDER_RUNTIME_NOT_CONNECTED",
  ].includes(code)) {
    return "選定的真實閉端 AI 後端尚未就緒。本次沒有產生候選，也沒有改用規則報告或外部 AI；請先完成啟動、配對與實測。";
  }
  if (code === "CLOSED_AGENT_TASK_CANCELLED" || code === "OLLAMA_CANCELLED") {
    return "閉端 AI 工作已取消；沒有候選，也沒有修改 Canon。";
  }
  if (code === "AUTHOR_ADVISOR_CANDIDATE_INCOMPLETE") {
    return "真實閉端模型有回應，但缺少完整分析或可閱讀示範正文；不完整輸出已擋下，沒有用模板補成候選。";
  }
  return cause instanceof Error
    ? `閉端 AI 候選失敗：${cause.message}`
    : "閉端 AI 候選失敗；沒有修改 Canon。";
}

function hasVerifiedClosedModelResult(
  result: ClosedAgentExecutionResult,
  expectedBackend: Extract<ClosedAIBackendId, "local-ollama" | "private-ai-hub">,
) {
  const candidate = result.candidate;
  const receipt = candidate.executionReceipt
    ?? candidate.cacheOrigin?.originExecutionReceipt
    ?? null;
  return candidate.backendId === expectedBackend
    && candidate.candidateOnly === true
    && candidate.canonicalMutationCount === 0
    && candidate.status === "awaiting-approval"
    && Boolean(candidate.content.trim())
    && receipt?.proofState === "verified"
    && receipt.backendId === expectedBackend
    && receipt.actualExecutor === expectedBackend
    && receipt.modelId === candidate.modelId
    && receipt.modelDigest === candidate.modelDigest
    && receipt.contentDigest === candidate.contentDigest
    && receipt.outputCharacters > 0;
}

export default function AuthorToolsWorkspace({
  projectId,
  initialTool,
}: {
  projectId: string;
  initialTool: AuthorToolId;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const repository = useMemo(() => createNovelRepository(), []);
  const [tool, setTool] = useState<AuthorToolId>(initialTool);
  const [snapshot, setSnapshot] = useState<AuthorToolSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("正在讀取這部作品的正式資料……");
  const [output, setOutput] = useState("");
  const [relayTarget, setRelayTarget] = useState("ChatGPT／Grok／Gemini（通用）");
  const [chapterCount, setChapterCount] = useState(5);
  const [objective, setObjective] = useState("");
  const [cadence, setCadence] = useState("每週 3 更");
  const advisorAbortRef = useRef<AbortController | null>(null);
  const [advisorQuestion, setAdvisorQuestion] = useState("請檢查目前章尾的承接、人物動機與伏筆，提出能提高閱讀張力但不破壞 Canon 的修訂方向。");
  const [advisorBackend, setAdvisorBackend] = useState<Extract<ClosedAIBackendId, "local-ollama" | "private-ai-hub">>("local-ollama");
  const [advisorRunning, setAdvisorRunning] = useState(false);
  const [advisorStatus, setAdvisorStatus] = useState("等待作者提出目標；只有通過真實閉端模型執行證明與內容 Gate 的候選才會顯示。");
  const [advisorProgress, setAdvisorProgress] = useState<ClosedAIProgressEvent[]>([]);
  const [advisorResult, setAdvisorResult] = useState<ClosedAgentExecutionResult | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      repository.get<NovelProject>("projects", projectId),
      repository.list<Chapter>("chapters", projectId),
      repository.list<Character>("characters", projectId),
      repository.list<CharacterRelationship>("relationships", projectId),
      repository.list<World>("worlds", projectId),
      repository.list<WorldRule>("worldRules", projectId),
      repository.list<StoryBible>("storyBibles", projectId),
      repository.list<StoryState>("storyStates", projectId),
      repository.list<TimelineEvent>("timeline", projectId),
    ]).then(([project, chapters, characters, relationships, worlds, worldRules, storyBibles, storyStates, timeline]) => {
      if (!active) return;
      if (!project) {
        setStatus("找不到指定作品；沒有改用其他作品代替。請回作品管理中心重新選擇。");
        return;
      }
      setSnapshot(stageAuthorToolSnapshot({
        project,
        chapters,
        characters,
        relationships,
        worlds,
        worldRules,
        storyBible: storyBibles.find((item) => item.id === project.storyBibleId) ?? storyBibles[0] ?? null,
        storyState: storyStates.find((item) => item.id === project.storyStateId) ?? storyStates[0] ?? null,
        timeline,
      }));
      setStatus(`已載入《${project.title}》；四個本機報告與閉端 AI 作者顧問共用同一份正式 Canon，但只產生可複製候選。`);
    }).catch((cause) => {
      if (active) setStatus(cause instanceof Error ? `作品資料讀取失敗：${cause.message}` : "作品資料目前無法讀取");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [projectId, repository]);

  function selectTool(next: AuthorToolId) {
    setTool(next);
    setOutput("");
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tool", next);
    router.replace(`?${nextParams.toString()}`, { scroll: false });
    setStatus(snapshot ? `已切換到「${TOOL_COPY[next].title}」；作品仍是《${snapshot.project.title}》。` : "正在等候作品資料。");
  }

  function run() {
    if (!snapshot) {
      setStatus("尚未載入作品，沒有執行分析。");
      return;
    }
    const nextOutput = tool === "breakdown"
      ? buildWorkBreakdown(snapshot)
      : tool === "relay"
        ? buildRelayPrompt(snapshot, relayTarget)
        : tool === "batch"
          ? buildBatchPlan(snapshot, chapterCount, objective)
          : buildSerialResearch(snapshot, cadence);
    setOutput(nextOutput);
    setStatus(`「${TOOL_COPY[tool].title}」已在本機完成；沒有跳回聊天，也沒有修改正文。`);
  }

  async function copyOutput() {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setStatus("結果已複製。只有你主動貼到外部服務時，內容才會離開本機。");
    } catch {
      setStatus("瀏覽器拒絕剪貼簿權限；結果仍完整顯示，可手動選取複製。");
    }
  }

  function downloadOutput() {
    if (!output || !snapshot) return;
    const blob = new Blob([output], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${safeFilename(snapshot.project.title)}-${tool}.md`;
    anchor.click();
    URL.revokeObjectURL(href);
    setStatus("已下載 Markdown 結果；正式作品與 Canon 維持原狀。");
  }

  async function runClosedAuthorAdvisor() {
    if (!snapshot || advisorRunning || !advisorQuestion.trim()) return;
    const controller = new AbortController();
    advisorAbortRef.current = controller;
    setAdvisorRunning(true);
    setAdvisorProgress([]);
    setAdvisorResult(null);
    setAdvisorStatus("真實閉端模型正在核對本作品 Canon、章尾、人物聲線與伏筆；不會使用規則 fallback 補字。");
    try {
      const activeChapter = snapshot.chapters.find((chapter) =>
        chapter.id === snapshot.project.activeChapterId)
        ?? [...snapshot.chapters].sort((left, right) => left.order - right.order).at(-1)
        ?? null;
      const result = await executeStudioClosedAgent({
        projectId,
        taskType: "assistant.critique",
        objective: buildClosedAuthorSuggestionObjective(snapshot, advisorQuestion),
        preferredBackend: advisorBackend,
        qualityMode: "balanced",
        browserComputePolicy: "manual",
        sourceChapterId: activeChapter?.id,
        sourceRevision: activeChapter?.revision,
        storyBibleRevision: snapshot.storyBible?.revision ?? "current",
        knowledgeScopeRevision: Math.max(
          snapshot.project.revision,
          activeChapter?.revision ?? 0,
          snapshot.storyBible?.revision ?? 0,
          snapshot.storyState?.revision ?? 0,
          ...snapshot.characters.map((character) => character.revision),
          ...snapshot.worldRules.map((rule) => rule.revision),
          ...snapshot.timeline.map((event) => event.revision),
        ),
        promptProfileVersion: "author-tools-closed-advisor-v1",
        generationOptions: {
          temperature: 0.72,
          topP: 0.9,
          maxTokens: 1_800,
          repetitionPenalty: 1.08,
        },
        signal: controller.signal,
        onProgress: (event) => setAdvisorProgress((items) => [...items, event].slice(-16)),
      });
      const validation = validateClosedAuthorSuggestion(result.candidate.content, snapshot);
      if (!hasVerifiedClosedModelResult(result, advisorBackend) || !validation.passed) {
        await rejectStudioClosedAgentCandidate(result.candidate.id).catch(() => undefined);
        throw Object.assign(new Error(`AUTHOR_ADVISOR_CANDIDATE_INCOMPLETE:${validation.missing.join(",")}`), {
          code: "AUTHOR_ADVISOR_CANDIDATE_INCOMPLETE",
        });
      }
      setAdvisorResult(result);
      setAdvisorStatus("閉端 AI 作者候選已完成：含分析與可直接閱讀的繁中示範；Canon 寫入仍為 0，需由你決定是否採用。");
    } catch (cause) {
      setAdvisorStatus(closedAIErrorMessage(cause));
    } finally {
      advisorAbortRef.current = null;
      setAdvisorRunning(false);
    }
  }

  async function copyAdvisorCandidate() {
    const content = advisorResult?.candidate.content;
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setAdvisorStatus("閉端 AI 候選已複製；正式正文與 Canon 都沒有變更。");
    } catch {
      setAdvisorStatus("瀏覽器拒絕剪貼簿權限；候選仍完整顯示，可手動選取複製。");
    }
  }

  function handoffAdvisorCandidate() {
    if (!snapshot || !advisorResult) return;
    try {
      const { href } = stageStoryWorkspaceHandoff({
        projectId,
        source: "author-tools",
        prompt: buildClosedAuthorSuggestionHandoff(
          snapshot,
          advisorQuestion,
          advisorResult.candidate.content,
        ),
      });
      window.location.assign(href);
    } catch {
      setAdvisorStatus(
        "瀏覽器阻擋同分頁安全交接；候選沒有放進網址，也沒有遺失。請先複製候選，或允許工作階段儲存後重試。",
      );
    }
  }

  async function discardAdvisorCandidate() {
    if (!advisorResult || advisorRunning) return;
    const candidateId = advisorResult.candidate.id;
    try {
      await rejectStudioClosedAgentCandidate(candidateId);
      setAdvisorResult(null);
      setAdvisorStatus("閉端 AI 候選已捨棄；沒有寫入 Canon。");
    } catch (cause) {
      setAdvisorStatus(closedAIErrorMessage(cause));
    }
  }

  const copy = TOOL_COPY[tool];
  return (
    <main className={styles.root}>
      <ProjectNavigation
        projectId={projectId}
        active="author-tools"
        activeHref={`/studio/project/${encodeURIComponent(projectId)}/author-tools?tool=${encodeURIComponent(tool)}`}
      />
      <header>
        <div>
          <span>RESEARCH & AUTHOR TOOLS</span>
          <h1>研究與作者輔助</h1>
          <p>四項本機可驗證報告保留原樣；需要真正小說判斷時，再使用下方閉端 AI 作者顧問。</p>
        </div>
        <strong>{snapshot?.project.title ?? "尚未載入作品"}</strong>
      </header>

      <p className={styles.status} role="status">{loading ? "正在載入……" : status}</p>

      <nav className={styles.tools} aria-label="研究工具">
        {AUTHOR_TOOL_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={tool === id ? styles.active : ""}
            aria-pressed={tool === id}
            onClick={() => selectTool(id)}
          >
            <b>{TOOL_COPY[id].title}</b>
            <span>{TOOL_COPY[id].summary}</span>
          </button>
        ))}
      </nav>

      <section className={styles.workbench}>
        <div>
          <small>目前工具</small>
          <h2>{copy.title}</h2>
          <p>{copy.summary}</p>
        </div>

        {tool === "relay" ? (
          <label>
            接力目標
            <select value={relayTarget} onChange={(event) => setRelayTarget(event.target.value)}>
              <option>ChatGPT／Grok／Gemini（通用）</option>
              <option>ChatGPT</option>
              <option>Grok</option>
              <option>Gemini</option>
              <option>Claude</option>
              <option>其他文字 AI</option>
            </select>
          </label>
        ) : null}

        {tool === "batch" ? (
          <div className={styles.inputs}>
            <label>
              規劃章數（2–20）
              <input type="number" min={2} max={20} value={chapterCount} onChange={(event) => setChapterCount(Number(event.target.value))} />
            </label>
            <label>
              這一批的目標（可留白）
              <input value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="例如：在五章內揭露失蹤案真相，但保留幕後主使" />
            </label>
          </div>
        ) : null}

        {tool === "serial" ? (
          <label>
            預計發布節奏
            <select value={cadence} onChange={(event) => setCadence(event.target.value)}>
              <option>每日 1 更</option>
              <option>每週 3 更</option>
              <option>每週 1 更</option>
              <option>完成一卷後發布</option>
            </select>
          </label>
        ) : null}

        <button type="button" className={styles.primary} disabled={loading || !snapshot} onClick={run}>
          {copy.action}
        </button>
      </section>

      <section className={styles.result} aria-live="polite">
        <header>
          <div>
            <small>實際結果</small>
            <h2>{output ? `${copy.title}完成` : "尚未執行"}</h2>
          </div>
          <div className={styles.resultActions}>
            <button type="button" disabled={!output} onClick={() => void copyOutput()}>複製結果</button>
            <button type="button" disabled={!output} onClick={downloadOutput}>下載 .md</button>
          </div>
        </header>
        {output ? <pre>{output}</pre> : <p>按下「{copy.action}」後，這裡會顯示獨立結果；不會建立聊天訊息或切換作品。</p>}
      </section>

      <section className={styles.advisor} aria-labelledby="closed-author-advisor-title">
        <header>
          <div>
            <small>TRUE CLOSED AI · CANDIDATE ONLY</small>
            <h2 id="closed-author-advisor-title">閉端 AI 作者顧問</h2>
            <p>輸入你真正想解決的寫作問題。候選必須同時交付節奏、角色動機、伏筆、連載鉤子，以及承接最新章尾的繁中示範正文；不完整就誠實失敗。</p>
          </div>
          <strong>Canon 寫入：0</strong>
        </header>

        <div className={styles.advisorControls}>
          <label>
            作者目標／問題
            <textarea
              value={advisorQuestion}
              onChange={(event) => setAdvisorQuestion(event.target.value)}
              maxLength={4_000}
              placeholder="例如：這一章衝突有事件卻沒有人物代價，請找出斷點並示範如何續接。"
            />
          </label>
          <label>
            真實閉端執行者
            <select
              value={advisorBackend}
              onChange={(event) => setAdvisorBackend(event.target.value as typeof advisorBackend)}
            >
              <option value="local-ollama">個人本機 Ollama</option>
              <option value="private-ai-hub">私有 AI Hub</option>
            </select>
          </label>
          <div className={styles.advisorActions}>
            <button
              type="button"
              className={styles.primary}
              disabled={loading || !snapshot || advisorRunning || !advisorQuestion.trim()}
              onClick={() => void runClosedAuthorAdvisor()}
            >
              {advisorRunning ? "閉端 AI 正在閱讀與寫作……" : "請閉端 AI 提出建議與示範"}
            </button>
            {advisorRunning ? (
              <button type="button" onClick={() => advisorAbortRef.current?.abort()}>取消</button>
            ) : null}
            <Link href={`/studio/project/${encodeURIComponent(projectId)}/closed-ai`}>啟動／配對／實測閉端 AI</Link>
          </div>
        </div>

        <p className={styles.advisorStatus} role="status">{advisorStatus}</p>
        {advisorProgress.length ? (
          <ol className={styles.progress} aria-label="閉端 AI 執行進度">
            {advisorProgress.map((event, index) => (
              <li key={`${event.occurredAt}-${index}`}>
                <strong>{event.percent}%</strong>
                <span>{event.label}</span>
              </li>
            ))}
          </ol>
        ) : null}

        {advisorResult ? (
          <article className={styles.advisorCandidate} data-testid="closed-author-advisor-candidate">
            <header>
              <div>
                <small>等待作者採用的候選</small>
                <h3>小說分析＋示範正文</h3>
              </div>
              <span>{Math.round(advisorResult.candidate.evaluation.score * 100)} 分</span>
            </header>
            <pre>{advisorResult.candidate.content}</pre>
            <div className={styles.advisorActions}>
              <button type="button" onClick={() => void copyAdvisorCandidate()}>複製候選</button>
              <button type="button" className={styles.primary} onClick={handoffAdvisorCandidate}>一鍵帶到故事工作台</button>
              <button type="button" onClick={() => void discardAdvisorCandidate()}>捨棄候選</button>
            </div>
            <details>
              <summary>模型與本機驗證證據</summary>
              <p>
                後端：{advisorResult.candidate.backendId}；
                實際執行器：{advisorResult.candidate.actualExecutor}；
                模型：{advisorResult.candidate.modelId}；
                模型雜湊：{advisorResult.candidate.modelDigest}；
                內容雜湊：{advisorResult.candidate.contentDigest}；
                脈絡雜湊：{advisorResult.candidate.contextDigest ?? "未記錄"}；
                資料離開裝置：{advisorResult.candidate.dataLeftDevice ? "是" : "否"}；
                Canon 寫入：{advisorResult.candidate.canonicalMutationCount}
              </p>
            </details>
          </article>
        ) : null}
      </section>
    </main>
  );
}
