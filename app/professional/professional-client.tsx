"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Chapter,
  Character,
  LoreEntry,
  NovelProject,
  ProjectBackup,
  StoryBible,
  StoryState,
  World,
} from "@/lib/novel-ai/domain";
import {
  resolveStoryPlayMode,
  storyPlayModeDashboardHref,
  STORY_PLAY_MODE_LABELS,
} from "@/lib/novel-ai/domain/play-mode";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  EXPLICIT_LEGACY_STUDIO_KEYS,
  migrateLegacyStudioProjects,
} from "@/lib/novel-ai/repository/migration/legacy-studio-migration";
import { discoverStudioClosedAI } from "@/lib/novel-ai/web/studio-closed-ai";
import {
  SOCIAL_WORLD_APPROVAL_VERSION,
  type SocialWorldApprovalJournal,
} from "@/lib/novel-ai/social-world-approval";
import CharacterRelationshipWorkbench from "../studio/project/[projectId]/character-relationship-workbench";
import SocialWorldLibrary from "../studio/project/[projectId]/social-world-library";

type ProjectSummary = {
  project: NovelProject;
  chapters: Chapter[];
  backups: ProjectBackup[];
  storyState: StoryState | null;
  characters: Character[];
  lore: LoreEntry[];
  approvalJournals: SocialWorldApprovalJournal[];
  storyBibles: StoryBible[];
  worlds: World[];
};

function formatTime(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "尚未記錄" : time.toLocaleString("zh-TW");
}

function wordCount(chapters: Chapter[]) {
  return chapters.reduce((sum, chapter) => sum + chapter.content.replace(/\s/gu, "").length, 0);
}

function readableProjectIdea(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const preferred = ["logline", "summary", "coreIdea", "opening", "goal"]
    .map((key) => record[key])
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim());
  if (preferred.length) return preferred.join("；");
  return Object.values(record)
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .slice(0, 6)
    .map((item) => item.trim())
    .join("；");
}

function isStoryIntent(intent: string): intent is "chat" | "write" | "play" {
  return intent === "chat" || intent === "write" || intent === "play";
}

function storyWorkspaceHref(projectId: string, intent: string) {
  const root = `/studio/project/${encodeURIComponent(projectId)}/chat`;
  return intent === "play" ? `${root}?mode=play` : root;
}

function coordinatorTaskHref(projectId: string, prompt: string) {
  const query = new URLSearchParams({
    prompt,
  });
  return `/studio/project/${encodeURIComponent(projectId)}/chat?${query.toString()}`;
}

function consistencyReviewHref(projectId: string) {
  return coordinatorTaskHref(
    projectId,
    "請檢查目前作品的角色、時間線、世界規則與章節因果，列出有證據的矛盾與可核准修正候選；不要直接修改 Canon。",
  );
}

function authorToolHref(projectId: string, tool: "breakdown" | "relay" | "batch" | "serial") {
  return `/studio/project/${encodeURIComponent(projectId)}/author-tools?tool=${tool}`;
}

export default function ProfessionalClient({
  initialProjectId = "",
  intent = "library",
  legacyMigration = "",
}: {
  initialProjectId?: string;
  intent?: "write" | "play" | "library" | string;
  legacyMigration?: "import" | "";
}) {
  const router = useRouter();
  const repository = useMemo(() => createNovelRepository(), []);
  const [projects, setProjects] = useState<NovelProject[]>([]);
  const [selectedId, setSelectedId] = useState(initialProjectId);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("正在開啟同一份正式作品庫……");
  const [aiStatus, setAIStatus] = useState("能力狀態讀取中（不連接本機服務）");
  const [error, setError] = useState("");
  const [socialLibraryOpen, setSocialLibraryOpen] = useState(false);
  const aiDiscoveryController = useRef<AbortController | null>(null);

  const loadSummary = useCallback(async (projectId: string) => {
    if (!projectId) {
      setSummary(null);
      return;
    }
    const [project, chapters, backups, storyStates, characters, lore, operationJournals, storyBibles, worlds] = await Promise.all([
      repository.get<NovelProject>("projects", projectId),
      repository.list<Chapter>("chapters", projectId),
      repository.list<ProjectBackup>("backups", projectId),
      repository.list<StoryState>("storyStates", projectId),
      repository.list<Character>("characters", projectId),
      repository.list<LoreEntry>("lore", projectId),
      repository.list<SocialWorldApprovalJournal>("operationJournal", projectId),
      repository.list<StoryBible>("storyBibles", projectId),
      repository.list<World>("worlds", projectId),
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
      characters,
      lore,
      approvalJournals: operationJournals.filter((journal) => journal.operationType === SOCIAL_WORLD_APPROVAL_VERSION),
      storyBibles,
      worlds,
    });
  }, [repository]);

  const load = useCallback(async (preferredProjectId: string) => {
    setLoading(true);
    setError("");
    try {
      // Professional 舊工具與 Studio 曾使用不同存放層。這裡只做非覆蓋匯入，
      // 之後所有閱讀、寫作、管理與備份都只讀正式 IndexedDB repository。
      const migration = legacyMigration === "import"
        ? await migrateLegacyStudioProjects(repository, {
            sourceKeys: EXPLICIT_LEGACY_STUDIO_KEYS,
            overwriteExisting: false,
          })
        : { migrated: 0, skippedExisting: 0 };
      const nextProjects = (await repository.list<NovelProject>("projects"))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      setProjects(nextProjects);
      const explicitProject = nextProjects.some((item) => item.id === preferredProjectId);
      const requestedProjectMissing = Boolean(preferredProjectId) && !explicitProject;
      const mustChoose = requestedProjectMissing || (!explicitProject
        && nextProjects.length > 1
        && (isStoryIntent(intent) || intent === "library"));
      const nextId = explicitProject
        ? preferredProjectId
        : mustChoose
          ? ""
          : nextProjects[0]?.id ?? "";
      setSelectedId(nextId);
      if (nextId && isStoryIntent(intent)) {
        localStorage.setItem("novel_p2_active_project_id", nextId);
        setStatus("已選定作品，正在進入唯一故事工作台……");
        router.replace(storyWorkspaceHref(nextId, intent));
        return;
      }
      await loadSummary(nextId);
      setStatus(requestedProjectMissing
        ? "網址指定的作品不在這個瀏覽器的正式作品庫中。系統已停止自動切換，請明確選擇作品；沒有載入其他作品代替。"
        : mustChoose
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
  }, [intent, legacyMigration, loadSummary, repository, router]);

  const refreshAIStatus = useCallback(async () => {
    aiDiscoveryController.current?.abort("PROFESSIONAL_AI_DISCOVERY_REPLACED");
    const controller = new AbortController();
    aiDiscoveryController.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort("PROFESSIONAL_AI_DISCOVERY_TIMEOUT");
    }, 7_000);
    setAIStatus("能力狀態讀取中（不連接本機服務）");
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
        setAIStatus(timedOut ? "能力狀態讀取逾時（不影響作品）" : "可在寫作頁明確連接閉端 AI");
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
    localStorage.setItem("novel_p2_active_project_id", projectId);
    if (isStoryIntent(intent)) {
      setStatus("已選定作品，正在進入唯一故事工作台……");
      router.push(storyWorkspaceHref(projectId, intent));
      return;
    }
    setLoading(true);
    try {
      await loadSummary(projectId);
      setStatus("已切換作品；閱讀、設定、管理與備份仍使用同一份正式資料。");
    } finally {
      setLoading(false);
    }
  }

  const project = summary?.project ?? null;
  const projectRoot = project ? `/studio/project/${encodeURIComponent(project.id)}` : "";
  const playMode = summary?.storyState ? resolveStoryPlayMode(summary.storyState) : "general";
  const primaryWorkspace = project ? storyPlayModeDashboardHref(project.id, playMode) : "";
  const localAIHref = project
    ? `/settings/local-ai?returnTo=${encodeURIComponent(primaryWorkspace)}`
    : "/settings/local-ai";
  const projectIdea = readableProjectIdea(project?.coreIdea.value)
    || "尚未設定核心想法；可在作品設定或故事工作台中補上。";
  const projectIdeaPreview = projectIdea.length > 220
    ? `${projectIdea.slice(0, 220).trimEnd()}……`
    : projectIdea;

  return (
    <main className="professionalModern" data-testid="professional-canonical-workbench">
      <header className="professionalModernHeader">
        <div>
          <small>PROJECT MANAGEMENT · ONE CANONICAL WORKSPACE</small>
          <h1>作品管理中心</h1>
          <p>舊工作台的所有功能都已重新分配到這裡；章節、角色、世界、進度、備份、學習與 AI 設定共用同一份正式作品資料。</p>
        </div>
        <div className="professionalModernStatus">
          <span>正式作品庫：{error ? "需要檢查" : loading ? "讀取中" : "已統一"}</span>
          <span>AI 與執行狀態：{aiStatus}</span>
        </div>
      </header>

      <nav className="professionalModernTop" aria-label="作品管理中心主要入口">
        <Link href="/">系統首頁</Link>
        <Link className="primary" href="/studio/create">建立新作品</Link>
        {project ? <Link href={primaryWorkspace}>繼續目前玩法</Link> : null}
        {project ? <Link href={`/studio/read/${encodeURIComponent(project.id)}`}>閱讀作品</Link> : null}
      </nav>

      {project ? (
        <nav className="professionalMobileQuick" aria-label="手機快速操作">
          <Link prefetch={false} className="primary" href={primaryWorkspace}><span aria-hidden="true">寫</span>繼續創作</Link>
          <Link href="#character-world-memory-home"><span aria-hidden="true">人</span>角色世界</Link>
          <Link href="#professional-all-tools"><span aria-hidden="true">具</span>全部工具</Link>
        </nav>
      ) : null}

      <p className="professionalModernNotice" role={error ? "alert" : "status"} data-error={Boolean(error)}>
        {error ? `讀取失敗：${error}。${status}` : status}
      </p>

      {projects.length > 0 && !isStoryIntent(intent) ? (
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
          <section className="professionalProjectHero" id="professional-project-overview">
            <div>
              <small>PROJECT DATA & TOOLS</small>
              <h2>{project.title}</h2>
              <p className="professionalProjectIdeaPreview">{projectIdeaPreview}</p>
              {projectIdea.length > 220 ? (
                <details className="professionalProjectIdeaFull">
                  <summary>閱讀完整故事核心</summary>
                  <p>{projectIdea}</p>
                </details>
              ) : null}
              <div className="professionalHeroActions">
                <Link prefetch={false} className="primary" href={primaryWorkspace}>繼續{STORY_PLAY_MODE_LABELS[playMode]}</Link>
                <Link prefetch={false} href={`/studio/read/${encodeURIComponent(project.id)}`}>閱讀全文</Link>
                <Link href={`/studio/create?cloneFrom=${encodeURIComponent(project.id)}`}>複製種子，改用其他玩法</Link>
              </div>
            </div>
            <dl>
              <div><dt>章節</dt><dd>{summary.chapters.length}</dd></div>
              <div><dt>總字數</dt><dd>{wordCount(summary.chapters)}</dd></div>
              <div><dt>正式備份</dt><dd>{summary.backups.length}</dd></div>
              <div><dt>固定玩法</dt><dd>{STORY_PLAY_MODE_LABELS[playMode]}</dd></div>
              <div><dt>最近更新</dt><dd>{formatTime(project.updatedAt)}</dd></div>
            </dl>
          </section>

          <CharacterRelationshipWorkbench
            project={project}
            compact
            onChanged={() => loadSummary(project.id)}
          />

          <details
            className="professionalSocialLibrary"
            data-testid="professional-social-world-library"
            open={socialLibraryOpen}
            onToggle={(event) => setSocialLibraryOpen(event.currentTarget.open)}
          >
            <summary>完整宗門、家族、企業、人物、寶物與世界資料庫</summary>
            <p>在首頁可核准與編修正式設定；進入故事後，同一資料庫只提供搜尋與選擇上場內容。家族使用祖譜，宗門與企業使用組織樹。</p>
            {socialLibraryOpen ? <SocialWorldLibrary
              mode="home-edit"
              project={project}
              approvedCharacters={summary.characters}
              approvedLore={summary.lore}
              approvalJournals={summary.approvalJournals}
              storyBibles={summary.storyBibles}
              approvedWorlds={summary.worlds}
              storyStarted={Boolean(summary.storyState || summary.chapters.some((chapter) => chapter.content.trim()))}
              onChanged={() => loadSummary(project.id)}
            /> : null}
          </details>

          <section className="professionalActionGroups" id="professional-all-tools" aria-label="作品全部功能">
            <article id="story-and-chapters">
              <small>STORY & CHAPTERS</small><h2>故事與章節</h2>
              <p>創作、RPG 與三選一在故事工作台進行；已採用正文則在校訂頁精修。</p>
              <Link prefetch={false} href={primaryWorkspace}>繼續目前玩法</Link>
              <Link href={`${projectRoot}/write`}>章節全文校訂</Link>
              <Link prefetch={false} href={`/studio/read/${encodeURIComponent(project.id)}`}>閱讀全文</Link>
            </article>
            <article id="world-and-characters">
              <small>CANON & WORLD</small><h2>角色、世界與記憶</h2>
              <p>正式人物、能力、世界與 Story Bible 直接在上方首頁編修；故事進行中則選擇目前上場的人物、規則與記憶。</p>
              <Link href="#character-world-memory-home">在首頁編修正式角色、世界與記憶</Link>
              <Link href={`${projectRoot}/characters`}>故事內選擇上場人物（唯讀）</Link>
              <Link href={`${projectRoot}/character-ai`}>角色視角模擬（非正式 Canon）</Link>
              <Link href={`${projectRoot}/world`}>故事內選擇上場世界與規則（唯讀）</Link>
              <Link href={`${projectRoot}/story-bible`}>故事內選擇上場記憶（唯讀）</Link>
              <Link href={`${projectRoot}/timeline`}>故事內選擇上場時間線（唯讀）</Link>
            </article>
            <article id="progress-and-review">
              <small>PROGRESS & REVIEW</small><h2>任務、成就與檢查</h2>
              <p>追蹤目前作品的目標與里程碑；一致性檢查會回到同一故事工作台建立候選。</p>
              <Link href={`${projectRoot}/tasks`}>任務與進度</Link>
              <Link href={`${projectRoot}/achievements`}>成就與里程碑</Link>
              <Link href={consistencyReviewHref(project.id)}>檢查作品一致性</Link>
            </article>
            <article id="data-and-safety">
              <small>DATA & SAFETY</small><h2>作品、存檔與備份</h2>
              <p>切換作品、完整備份、還原與儲存設定集中管理，不再回到舊版首頁。</p>
              <Link href="/professional?intent=library">我的作品</Link>
              <Link href={`${projectRoot}/backups`}>備份、還原與匯出</Link>
              <Link href="/studio/settings/storage">本機儲存與雲端同步</Link>
              <Link href={`/studio/create?cloneFrom=${encodeURIComponent(project.id)}`}>複製為其他玩法</Link>
            </article>
            <article id="ai-and-learning">
              <small>AI & LEARNING</small><h2>自動協調器與學習</h2>
              <p>管理閉端算力、共享學習規則、資料邊界與本機模型；正文仍只在故事工作台產生。</p>
              <Link href={`${projectRoot}/closed-ai`}>閉端 AI 自動協調器</Link>
              <Link href={`${projectRoot}/learning`}>閉端 AI 規則學習</Link>
              <Link href="/studio/settings/ai">AI 使用方式與資料邊界</Link>
              <Link href={localAIHref}>本機 AI 安裝與連線</Link>
            </article>
            <article id="extended-creation">
              <small>EXTENDED CREATION</small><h2>小說轉短劇</h2>
              <p>短劇改編保持候選／核准邊界，不會直接覆寫原作；角色視角模擬已合併回「角色、世界與記憶」。</p>
              <Link href={`${projectRoot}/drama`}>小說轉短劇</Link>
            </article>
            <article id="video-production">
              <small>VIDEO RUNTIME STATUS</small><h2>影片生成（尚未連接）</h2>
              <p>目前沒有可執行的影片模型、工作佇列或 MP4 產物；JSON 交接資料不算影片。連接供應商、成本上限與外送同意後才會開放真正生成。</p>
              <Link href={`${projectRoot}/drama#video-production`}>查看影片能力狀態</Link>
              <Link href={`${projectRoot}/drama`}>先整理短劇改編</Link>
            </article>
            <article id="research-and-legacy-tools">
              <small>RESEARCH & AUTHOR TOOLS</small><h2>研究與作者輔助</h2>
              <p>四項工具都直接讀取目前作品的正式資料、在各自頁面產生結果；不再跳回聊天或誤用最近更新的其他作品。</p>
              <Link href={authorToolHref(project.id, "breakdown")}>書籍與作品拆解</Link>
              <Link href={authorToolHref(project.id, "relay")}>續寫接力提示</Link>
              <Link href={authorToolHref(project.id, "batch")}>多章批量規劃</Link>
              <Link href={authorToolHref(project.id, "serial")}>連載、讀者與 IP 研究</Link>
            </article>
          </section>
        </>
      ) : loading ? (
        <section className="professionalModernEmpty"><h2>正在讀取作品</h2><p>不會建立第二份資料。</p></section>
      ) : projects.length ? (
        <section className="professionalProjectChoices" data-testid="canonical-project-picker">
          <header>
            <small>CHOOSE ONE CANONICAL PROJECT</small>
            <h2>{intent === "play" ? "選擇要繼續遊玩的作品" : "選擇要繼續創作的作品"}</h2>
            <p>選定後會直接進入該作品唯一的故事工作台；不會載入、覆蓋或混合其他作品的章節。</p>
          </header>
          <div>
            {projects.map((item) => (
              <button type="button" key={item.id} onClick={() => void selectProject(item.id)}>
                <strong>{item.title}</strong>
                <span>最後保存：{formatTime(item.updatedAt)}</span>
                <small>{intent === "play" ? "選擇後直接進入故事工作台的 RPG 模式" : "選擇後直接進入該作品的故事工作台"}</small>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="professionalModernEmpty">
          <div className="professionalEmptyGlyphs" aria-hidden="true"><span data-icon="character">人</span><span data-icon="world">界</span><span data-icon="story">章</span></div>
          <h2>目前沒有正式作品</h2>
          <p>快速建立、引導建立與完整故事庫都放在新作品流程的第一步。</p>
          <Link className="primary" href="/studio/create">建立第一部作品</Link>
        </section>
      )}

    </main>
  );
}
