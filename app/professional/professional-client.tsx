"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chapter, NovelProject, ProjectBackup, StoryState } from "@/lib/novel-ai/domain";
import {
  resolveStoryPlayMode,
  STORY_PLAY_MODE_LABELS,
  storyPlayModeDashboardHref,
} from "@/lib/novel-ai/domain/play-mode";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  EXPLICIT_LEGACY_STUDIO_KEYS,
  migrateLegacyStudioProjects,
} from "@/lib/novel-ai/repository/migration/legacy-studio-migration";
import { discoverStudioClosedAI } from "@/lib/novel-ai/web/studio-closed-ai";

type ProjectSummary = {
  project: NovelProject;
  chapters: Chapter[];
  backups: ProjectBackup[];
  storyState: StoryState | null;
};

function formatTime(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "尚未記錄" : time.toLocaleString("zh-TW");
}

function wordCount(chapters: Chapter[]) {
  return chapters.reduce((sum, chapter) => sum + chapter.content.replace(/\s/gu, "").length, 0);
}

export default function ProfessionalClient({
  initialProjectId = "",
  intent = "library",
}: {
  initialProjectId?: string;
  intent?: "write" | "play" | "library" | string;
}) {
  const repository = useMemo(() => createNovelRepository(), []);
  const [projects, setProjects] = useState<NovelProject[]>([]);
  const [selectedId, setSelectedId] = useState(initialProjectId);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("正在開啟同一份正式作品庫……");
  const [aiStatus, setAIStatus] = useState("背景偵測中（不影響作品）");
  const [error, setError] = useState("");
  const aiDiscoveryController = useRef<AbortController | null>(null);

  const loadSummary = useCallback(async (projectId: string) => {
    if (!projectId) {
      setSummary(null);
      return;
    }
    const [project, chapters, backups, storyStates] = await Promise.all([
      repository.get<NovelProject>("projects", projectId),
      repository.list<Chapter>("chapters", projectId),
      repository.list<ProjectBackup>("backups", projectId),
      repository.list<StoryState>("storyStates", projectId),
    ]);
    if (!project) {
      setSummary(null);
      return;
    }
    setSummary({
      project,
      chapters: chapters.sort((left, right) => left.order - right.order),
      backups: backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      storyState: storyStates.find((item) => item.id === project.storyStateId) ?? storyStates[0] ?? null,
    });
  }, [repository]);

  const load = useCallback(async (preferredProjectId: string) => {
    setLoading(true);
    setError("");
    try {
      // Professional 舊工具與 Studio 曾使用不同存放層。這裡只做非覆蓋匯入，
      // 之後所有閱讀、寫作、管理與備份都只讀正式 IndexedDB repository。
      const migration = await migrateLegacyStudioProjects(repository, {
        sourceKeys: EXPLICIT_LEGACY_STUDIO_KEYS,
        overwriteExisting: false,
      });
      const nextProjects = (await repository.list<NovelProject>("projects"))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      setProjects(nextProjects);
      const explicitProject = nextProjects.some((item) => item.id === preferredProjectId);
      const mustChoose = !explicitProject
        && nextProjects.length > 1
        && (intent === "write" || intent === "play");
      const nextId = explicitProject
        ? preferredProjectId
        : mustChoose
          ? ""
          : nextProjects[0]?.id ?? "";
      setSelectedId(nextId);
      await loadSummary(nextId);
      setStatus(mustChoose
        ? `找到 ${nextProjects.length} 部正式作品。請先選擇一部，再繼續；系統不會自行猜測或混用章節。`
        : migration.migrated
        ? `已將 ${migration.migrated} 部舊版作品非覆蓋地接到正式作品庫；原始資料仍保留。`
        : "專業工具與簡易版現在共用同一份正式作品、章節與備份資料。");
      // 保留健康診斷入口的可觀測性；失敗不阻擋本機作品。
      void fetch("/api/ai/health", { cache: "no-store" }).catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "正式作品庫目前無法讀取");
      setStatus("沒有修改任何作品資料。請重新檢查本機作品庫。");
    } finally {
      setLoading(false);
    }
  }, [intent, loadSummary, repository]);

  const refreshAIStatus = useCallback(async () => {
    aiDiscoveryController.current?.abort("PROFESSIONAL_AI_DISCOVERY_REPLACED");
    const controller = new AbortController();
    aiDiscoveryController.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort("PROFESSIONAL_AI_DISCOVERY_TIMEOUT");
    }, 7_000);
    setAIStatus("背景偵測中（不影響作品）");
    try {
      const snapshot = await discoverStudioClosedAI(controller.signal);
      if (controller.signal.aborted) return;
      setAIStatus(snapshot.status === "ollama_ready"
        ? "Local Ollama 已連線"
        : snapshot.status === "browser_ready"
          ? "Browser AI 已就緒"
          : snapshot.status === "auth_required"
            ? "本機 AI 等待授權（不影響作品）"
            : "未連線（寫作與作品庫仍可使用）");
    } catch {
      if (!controller.signal.aborted || timedOut) {
        setAIStatus(timedOut ? "背景偵測逾時（不影響作品）" : "可在寫作頁重試實際執行器");
      }
    } finally {
      window.clearTimeout(timeout);
      if (aiDiscoveryController.current === controller) aiDiscoveryController.current = null;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(initialProjectId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialProjectId, load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshAIStatus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      aiDiscoveryController.current?.abort("PROFESSIONAL_UNMOUNTED");
    };
  }, [refreshAIStatus]);

  async function selectProject(projectId: string) {
    setSelectedId(projectId);
    setLoading(true);
    try {
      await loadSummary(projectId);
      localStorage.setItem("novel_p2_active_project_id", projectId);
      setStatus("已切換作品；寫作、閱讀、管理與備份仍使用同一份正式資料。");
    } finally {
      setLoading(false);
    }
  }

  const project = summary?.project ?? null;
  const projectRoot = project ? `/studio/project/${encodeURIComponent(project.id)}` : "";
  const activeChapter = summary?.chapters.find((item) => item.id === project?.activeChapterId)
    ?? summary?.chapters.at(-1)
    ?? null;
  const playMode = summary?.storyState ? resolveStoryPlayMode(summary.storyState) : "general";
  const primaryWorkspace = project ? storyPlayModeDashboardHref(project.id, playMode) : "";

  return (
    <main className="professionalModern" data-testid="professional-canonical-workbench">
      <header className="professionalModernHeader">
        <div>
          <small>PROFESSIONAL · CANONICAL WORKBENCH</small>
          <h1>諸天創作中心</h1>
          <p>專業工具與簡易版共用同一份正式作品庫；切換畫面不會複製、隱藏或遺失章節。</p>
        </div>
        <div className="professionalModernStatus">
          <span>正式作品庫：{error ? "需要檢查" : loading ? "讀取中" : "已統一"}</span>
          <span>AI 與執行狀態：{aiStatus}</span>
        </div>
      </header>

      <nav className="professionalModernTop" aria-label="專業工作台主要入口">
        <Link href="/studio">首頁</Link>
        <Link className="primary" href="/studio/create">建立新作品</Link>
        {project ? <Link href={`${projectRoot}/write`}>繼續寫作</Link> : null}
        {project ? <Link href={`/studio/read/${encodeURIComponent(project.id)}`}>閱讀作品</Link> : null}
      </nav>

      <p className="professionalModernNotice" role={error ? "alert" : "status"} data-error={Boolean(error)}>
        {error ? `讀取失敗：${error}。${status}` : status}
      </p>

      {projects.length ? (
        <section className="professionalProjectPicker" aria-label="選擇正式作品">
          <strong>目前作品</strong>
          <select value={selectedId} disabled={loading} onChange={(event) => void selectProject(event.target.value)}>
            {!selectedId ? <option value="">請先選擇要繼續的作品</option> : null}
            {projects.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}
          </select>
          <span>{projects.length} 部作品，共用正式 IndexedDB</span>
        </section>
      ) : null}

      {project && summary ? (
        <>
          <section className="professionalProjectHero">
            <div>
              <small>CONTINUE THIS STORY</small>
              <h2>{project.title}</h2>
              <p>{project.coreIdea.value || "尚未設定核心想法；可在作品設定或寫作小精靈中補上。"}</p>
              <div className="professionalHeroActions">
                <Link className="primary" href={primaryWorkspace}>{playMode === "general" ? `繼續「${activeChapter?.title || "目前章節"}」` : `繼續${STORY_PLAY_MODE_LABELS[playMode]}`}</Link>
                <Link href={`${projectRoot}/write?assistant=advanced#writing-ai`}>在寫作頁開啟 AI 助手</Link>
                <Link href={`/studio/read/${encodeURIComponent(project.id)}`}>閱讀全文</Link>
                <Link href={`/studio/create?cloneFrom=${encodeURIComponent(project.id)}`}>複製種子，改用其他玩法</Link>
              </div>
            </div>
            <dl>
              <div><dt>章節</dt><dd>{summary.chapters.length}</dd></div>
              <div><dt>總字數</dt><dd>{wordCount(summary.chapters)}</dd></div>
              <div><dt>正式備份</dt><dd>{summary.backups.length}</dd></div>
              <div><dt>最近更新</dt><dd>{formatTime(project.updatedAt)}</dd></div>
            </dl>
          </section>

          <section className="professionalActionGroups">
            <article>
              <small>WRITE</small><h2>創作與 AI</h2>
              <p>正文、候選與核准留在同一個寫作視窗，不必先跳到 AI 中心。</p>
              <Link href={`${projectRoot}/write`}>章節寫作</Link>
              <Link href={`${projectRoot}/write?assistant=advanced#writing-ai`}>AI 續寫／改寫候選</Link>
              <Link href={`${projectRoot}/story-bible`}>故事記憶</Link>
            </article>
            <article>
              <small>READ & MANAGE</small><h2>閱讀與資料管理</h2>
              <p>閱讀、作品清單與備份全部指向 Canonical repository，不再跳回 Legacy 存檔槽。</p>
              <Link href={`/studio/read/${encodeURIComponent(project.id)}`}>閱讀作品</Link>
              <Link href={`/professional?intent=library&projectId=${encodeURIComponent(project.id)}`}>作品管理</Link>
              <Link href={`${projectRoot}/backups`}>存檔／備份／匯出</Link>
            </article>
            <article>
              <small>WORLD & PLAY</small><h2>角色、世界與固定玩法</h2>
              <p>目前固定為「{STORY_PLAY_MODE_LABELS[playMode]}」。同一作品不會在寫作途中切換玩法；需要另一種方式時會建立獨立副本。</p>
              <Link href={`${projectRoot}/characters`}>角色管理</Link>
              <Link href={`${projectRoot}/world`}>世界設定</Link>
              {playMode !== "general" ? <Link href={primaryWorkspace}>開啟{STORY_PLAY_MODE_LABELS[playMode]}儀表板</Link> : null}
              <Link href={`/studio/create?cloneFrom=${encodeURIComponent(project.id)}`}>複製為其他玩法</Link>
              <Link href={`${projectRoot}/drama`}>小說轉短劇</Link>
            </article>
            <article>
              <small>INTELLIGENCE</small><h2>模型與治理</h2>
              <p>模型連線、學習與系統檢查仍是專業功能，但不承擔正文編輯。</p>
              <Link href={`${projectRoot}/closed-ai`}>閉端 AI 狀態</Link>
              <Link href={`${projectRoot}/learning`}>閉端 AI 學習</Link>
              <Link href={`${projectRoot}/timeline`}>時間線檢查</Link>
            </article>
          </section>
        </>
      ) : loading ? (
        <section className="professionalModernEmpty"><h2>正在讀取作品</h2><p>不會建立第二份資料。</p></section>
      ) : projects.length ? (
        <section className="professionalProjectChoices" data-testid="canonical-project-picker">
          <header>
            <small>CHOOSE ONE CANONICAL PROJECT</small>
            <h2>{intent === "play" ? "選擇要繼續遊玩的作品" : "選擇要繼續寫作的作品"}</h2>
            <p>每個按鈕都綁定獨立 projectId；選擇前不會載入、覆蓋或混合任何章節。</p>
          </header>
          <div>
            {projects.map((item) => (
              <button type="button" key={item.id} onClick={() => void selectProject(item.id)}>
                <strong>{item.title}</strong>
                <span>最後保存：{formatTime(item.updatedAt)}</span>
                <small>{intent === "play" ? "選擇後開啟固定玩法儀表板" : "選擇後顯示章節與續寫入口"}</small>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="professionalModernEmpty">
          <h2>目前沒有正式作品</h2>
          <p>快速建立、引導建立與完整故事庫都放在新作品流程的第一步。</p>
          <Link className="primary" href="/studio/create">建立第一部作品</Link>
        </section>
      )}

      <details className="professionalLegacyTools">
        <summary>Legacy 相容工具（書籍拆解、接力提示等）</summary>
        <p>這些是舊版輔助工具，不再作為作品、章節或備份的正式資料來源。</p>
        <a href="/legacy/novel-system.html?mode=professional&view=breakdown">開啟相容工具</a>
      </details>
    </main>
  );
}
