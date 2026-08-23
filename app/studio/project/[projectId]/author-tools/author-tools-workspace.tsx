"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  Chapter,
  Character,
  CharacterRelationship,
  NovelProject,
  StoryBible,
  StoryState,
  TimelineEvent,
  WorldRule,
} from "@/lib/novel-ai/domain";
import {
  AUTHOR_TOOL_IDS,
  buildBatchPlan,
  buildRelayPrompt,
  buildSerialResearch,
  buildWorkBreakdown,
  type AuthorToolId,
  type AuthorToolSnapshot,
} from "@/lib/novel-ai/author-tools";
import { createNovelRepository } from "@/lib/novel-ai/repository";
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

  useEffect(() => {
    let active = true;
    void Promise.all([
      repository.get<NovelProject>("projects", projectId),
      repository.list<Chapter>("chapters", projectId),
      repository.list<Character>("characters", projectId),
      repository.list<CharacterRelationship>("relationships", projectId),
      repository.list<WorldRule>("worldRules", projectId),
      repository.list<StoryBible>("storyBibles", projectId),
      repository.list<StoryState>("storyStates", projectId),
      repository.list<TimelineEvent>("timeline", projectId),
    ]).then(([project, chapters, characters, relationships, worldRules, storyBibles, storyStates, timeline]) => {
      if (!active) return;
      if (!project) {
        setStatus("找不到指定作品；沒有改用其他作品代替。請回作品管理中心重新選擇。");
        return;
      }
      setSnapshot({
        project,
        chapters,
        characters,
        relationships,
        worldRules,
        storyBible: storyBibles.find((item) => item.id === project.storyBibleId) ?? storyBibles[0] ?? null,
        storyState: storyStates.find((item) => item.id === project.storyStateId) ?? storyStates[0] ?? null,
        timeline,
      });
      setStatus(`已載入《${project.title}》；四個工具共用同一份正式 Canon，但只產生可複製結果。`);
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
          <p>四項工具都在這部作品內完成各自工作，不再用預填提示跳回故事對話。</p>
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
    </main>
  );
}
