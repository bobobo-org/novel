"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { NovelProject } from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  EXPLICIT_LEGACY_STUDIO_KEYS,
  previewLegacyStudioProjects,
} from "@/lib/novel-ai/repository/migration/legacy-studio-migration";
import { readLocalClosedAITabSessionSummary } from "@/lib/novel-ai/providers/closed/tab-session-recovery";
import styles from "./frontdoor-luxury.module.css";

type FrontdoorProps = {
  release: Record<string, string>;
  packs: number;
  classicTopics: number;
};

type RecentProject = {
  id: string;
  title: string;
  updatedAt: string;
};

type ClosedAIStatus = "未設定" | "等待配對" | "已就緒";
type CloudStatus = "未設定" | "正常" | "暫停";

const STUDIO_SHELL_KEY = "novel_p12_studio_state";
const ACTIVE_PROJECT_KEY = "novel_p2_active_project_id";

function recentProjectFromShell(): RecentProject | null {
  try {
    const shell = JSON.parse(localStorage.getItem(STUDIO_SHELL_KEY) || "null");
    const projects = Array.isArray(shell?.projects) ? shell.projects : [];
    const active = projects.find((item: { id?: string }) => (
      item?.id && item.id === shell.activeProjectId
    ));
    const selected = active ?? [...projects].sort((left, right) => (
      Date.parse(String(right?.updatedAt || ""))
      - Date.parse(String(left?.updatedAt || ""))
    ))[0];
    if (!selected?.id) return null;
    return {
      id: String(selected.id),
      title: String(selected.title || "未命名作品"),
      updatedAt: String(selected.updatedAt || ""),
    };
  } catch {
    return null;
  }
}

function safeProjectId(value: string) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : "";
}

function MobileDockIcon({ kind }: { kind: "home" | "create" | "write" | "library" }) {
  const paths = {
    home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10.5V20h13v-9.5M9.5 20v-6h5v6" /></>,
    create: <><path d="M12 5v14M5 12h14" /><circle cx="12" cy="12" r="9" /></>,
    write: <><path d="m5 19 3.8-.9L19 7.9 16.1 5 5.9 15.2 5 19Z" /><path d="m14.8 6.3 2.9 2.9M4 21h16" /></>,
    library: <><path d="M4 5.5h6v14H4zM14 5.5h6v14h-6z" /><path d="M10 7.5h4M10 17.5h4" /></>,
  } as const;
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</svg>;
}

export default function FrontdoorClient({ release, packs, classicTopics }: FrontdoorProps) {
  const [recentProject, setRecentProject] = useState<RecentProject | null>(null);
  const [projectCount, setProjectCount] = useState(0);
  const [closedAI, setClosedAI] = useState<ClosedAIStatus>("未設定");
  const [cloudSync, setCloudSync] = useState<CloudStatus>("未設定");
  const [legacyPreview, setLegacyPreview] = useState<ReturnType<
    typeof previewLegacyStudioProjects
  > | null>(null);
  const [showLegacyDetails, setShowLegacyDetails] = useState(false);
  const [dismissLegacy, setDismissLegacy] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      // Reading this tab-only summary is deliberately local: a public front door must never probe
      // loopback Companion ports or load the full Closed Agent runtime in the background.
      const closedAISummary = readLocalClosedAITabSessionSummary(window.location.origin);
      setClosedAI(
        closedAISummary === "inference_verified"
          ? "已就緒"
          : closedAISummary === "paired"
            ? "等待配對"
            : "未設定",
      );
      void (async () => {
        const shellRecent = recentProjectFromShell();
        let recent = shellRecent;
        let canonicalProjects: NovelProject[] = [];
        try {
          canonicalProjects = (await createNovelRepository().list<NovelProject>("projects"))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
          const activeProjectId = safeProjectId(localStorage.getItem(ACTIVE_PROJECT_KEY) || "");
          const preferred = canonicalProjects.find((item) => item.id === activeProjectId)
            ?? canonicalProjects.find((item) => item.id === shellRecent?.id)
            ?? canonicalProjects[0];
          if (preferred) {
            recent = {
              id: preferred.id,
              title: preferred.title,
              updatedAt: preferred.updatedAt,
            };
          }
        } catch {
          // The front door remains usable when IndexedDB is temporarily
          // unavailable; the canonical picker will show the recovery state.
        }
        const preview = previewLegacyStudioProjects(EXPLICIT_LEGACY_STUDIO_KEYS);
        if (!active) return;
        setRecentProject(recent);
        setProjectCount(canonicalProjects.length || (recent ? 1 : 0));
        setLegacyPreview(preview);
      })();
      void fetch(`/api/persistence/health?frontdoor=${Date.now()}`, {
        cache: "no-store",
      })
        .then(async (response) => {
          const body = await response.json() as {
            cloudPersistence?: { status?: string };
          };
          if (!active) return;
          const status = body.cloudPersistence?.status ?? "";
          setCloudSync(
            ["ready", "healthy", "online"].includes(status)
              ? "正常"
              : status
                ? "暫停"
                : "未設定",
          );
        })
        .catch(() => active && setCloudSync("暫停"));
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  const recentId = safeProjectId(recentProject?.id ?? "");
  const localAIHref = useMemo(() => {
    const returnTo = recentId
      ? `/studio/project/${encodeURIComponent(recentId)}/chat`
      : "/professional?intent=chat";
    return `/settings/local-ai?returnTo=${encodeURIComponent(returnTo)}`;
  }, [recentId]);
  const canonEditorHref = recentId
    ? `/professional?intent=library&projectId=${encodeURIComponent(recentId)}#character-world-memory-editor`
    : "/professional?intent=library";
  const directProjectHref = projectCount === 1 && recentId
    ? `/studio/project/${encodeURIComponent(recentId)}/chat`
    : "";
  const continueHref = projectCount > 0
    ? directProjectHref || "/professional?intent=chat"
    : "/professional?intent=chat";
  const primaryHref = recentProject ? continueHref : "/studio/create";
  const primaryLabel = recentProject
    ? `繼續《${recentProject.title}》`
    : "開始新故事";
  const recentUpdateLabel = useMemo(() => {
    const timestamp = Date.parse(recentProject?.updatedAt ?? "");
    if (!Number.isFinite(timestamp)) return "等待第一筆故事";
    return new Intl.DateTimeFormat("zh-TW", {
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(timestamp);
  }, [recentProject?.updatedAt]);
  const entries = [
    ["建立新作品", "選題材、世界與上場家族，從第一章正式開篇。", "/studio/create", "開"],
    ["選擇作品", projectCount > 0 ? `從 ${projectCount} 部正式作品中選擇；選定後直接進入該作品的故事工作台` : "查看作品庫；尚無作品時會引導你建立第一部故事。", continueHref, "續"],
  ] as const;

  return (
    <main
      className={`frontdoor ${styles.luxury}`}
      data-consumer-release={release.consumerRelease}
      data-app-commit={release.appCommit}
      data-testid="modern-consumer-frontdoor"
    >
      <header className="frontdoorNav">
        <Link prefetch={false} className="brandLockup" href="/" aria-label="諸天萬界小說生成系統首頁">
          <span className="brandSeal">創</span>
          <span><b>諸天萬界</b><small>小說生成系統</small></span>
        </Link>
        <nav aria-label="主要導覽">
          <Link prefetch={false} className="active" href="/">首頁</Link>
          <a href="/studio/create">建立世界</a>
          <a href={continueHref}>故事工作臺</a>
          <a href="/professional?intent=library">我的作品</a>
        </nav>
        <div className={styles.navActions}>
          <a
            className={styles.aiStatus}
            data-state={closedAI}
            href={localAIHref}
            aria-label={`本機 AI 設定，目前${closedAI}`}
          >
            <span aria-hidden="true" />
            本機 AI {closedAI}
          </a>
          <a className="navCta" href="/studio">進入創作中心</a>
        </div>
      </header>

      <section className="frontdoorHero">
        <div className={styles.heroAtmosphere} aria-hidden="true">
          <span /><span /><span /><span /><span />
        </div>
        <div className="heroCopy">
          <p className="eyebrow">THE TEN THOUSAND WORLDS · STORY FORGE</p>
          <h1><span>一念開天地，</span><span>落筆成萬界</span></h1>
          <p className="lead">把靈感鍛造成角色、世界與會記得你每次選擇的長篇故事。</p>
          <p className={styles.startingRule}>首頁只有兩個開始方式：建立新作品，或選擇既有作品繼續。</p>
          <div className="heroActions">
            <a
              className="primaryAction"
              data-testid="frontdoor-primary-action"
              href={primaryHref}
            >
              <span>{primaryLabel}</span><b aria-hidden="true">→</b>
            </a>
            {recentProject ? (
              <a className="secondaryAction" href="/studio/create">開始新故事</a>
            ) : (
              <a className="secondaryAction" href="/studio/create">探索 {classicTopics} 類題材</a>
            )}
          </div>
          {recentProject && recentId ? (
            <a
              className={styles.canonShortcut}
              data-testid="frontdoor-canon-editor"
              href={canonEditorHref}
            >
              <span>角色、世界與記憶</span>
              <b>編輯《{recentProject.title}》的正式設定</b>
              <i aria-hidden="true">→</i>
            </a>
          ) : null}
          <div className={styles.truthRow} aria-label="平台特色">
            <span><b>{classicTopics}</b> 類經典題材</span>
            <span><b>{packs}</b> 個世界分類</span>
            <span>作品<b>本機保存</b></span>
          </div>
        </div>
        <div className="worldPreview" aria-label="故事世界預覽">
          <div className={styles.cosmos} aria-hidden="true">
            <span className={styles.orbitOne}><i>人</i></span>
            <span className={styles.orbitTwo}><i>界</i></span>
            <span className={styles.orbitThree}><i>章</i></span>
            <span className={styles.storyCore}>續</span>
          </div>
          <div className="previewCaption">
            <span className={styles.previewEyebrow}>{recentProject ? "YOUR LATEST WORLD" : "A NEW WORLD AWAITS"}</span>
            <b>{recentProject?.title ?? "尚未命名的世界"}</b>
            <small>{recentProject ? `最後保存 · ${recentUpdateLabel}` : "從一個念頭開始，建立第一部作品"}</small>
            <span className={styles.previewMeta}>{projectCount ? `${projectCount} 部作品仍在延續` : "等待你的第一筆"}</span>
          </div>
        </div>
      </section>

      <section className="frontdoorRuntime" aria-label="目前執行狀態" data-testid="frontdoor-runtime">
        <span><b>閉端創作</b> Browser、本機 Ollama 與私有 Hub 由系統自動協調</span>
        <span><b>資料邊界</b> 正式作品保存在本機裝置</span>
        <span><b>雲端同步</b> {cloudSync}</span>
        <span><b>外部 AI</b> 預設未使用</span>
      </section>

      {legacyPreview?.found && legacyPreview.pending && !dismissLegacy ? (
        <section className="frontdoorLegacy" data-testid="legacy-migration-preview">
          <div>
            <span>舊作品匯入與相容功能</span>
            <h2>找到 {legacyPreview.projectCount} 部尚未確認遷移的作品</h2>
            <p>系統不會自動覆蓋新版作品。你可以先看預覽，再明確決定是否匯入。</p>
            {showLegacyDetails ? (
              <ul>{legacyPreview.titles.map((title) => <li key={title}>{title}</li>)}</ul>
            ) : null}
          </div>
          <div className="frontdoorLegacyActions">
            <button type="button" onClick={() => setShowLegacyDetails((value) => !value)}>
              {showLegacyDetails ? "收起遷移預覽" : "查看遷移預覽"}
            </button>
            <a data-testid="legacy-import-explicit" href="/professional?intent=library&legacyMigration=import">匯入到新版作品庫</a>
            <button type="button" onClick={() => setDismissLegacy(true)}>暫不匯入</button>
            <a href="/professional?intent=library">到統一作品管理中心</a>
          </div>
        </section>
      ) : null}

      <section className="frontdoorEntries" aria-labelledby="entryTitle">
        <div className="sectionTitle">
          <span>CHOOSE YOUR WAY IN</span>
          <h2 id="entryTitle">今天，從哪裡落筆？</h2>
        </div>
        <div className="entryGrid">
          {entries.map(([title, description, href, icon]) => (
            <a className="entryCard" href={href} key={title}>
              <span className="entryIndex">{icon}</span>
              <h3>{title}</h3>
              <p>{description}</p>
              <span className="entryArrow" aria-hidden="true">→</span>
            </a>
          ))}
        </div>
      </section>
      <nav className={styles.mobileDock} aria-label="手機主要導覽">
        <Link prefetch={false} href="/" aria-current="page"><MobileDockIcon kind="home" /><b>首頁</b></Link>
        <a href="/studio/create"><MobileDockIcon kind="create" /><b>新作品</b></a>
        <a href={continueHref}><MobileDockIcon kind="write" /><b>工作臺</b></a>
        <a href="/professional?intent=library"><MobileDockIcon kind="library" /><b>作品</b></a>
      </nav>
      <footer className="frontdoorFooter">
        <p>快速本機模式：速度較快，長篇品質有限。系統不會把 API online 顯示成 AI online。</p>
        <nav aria-label="精簡工具連結">
          <a href="/professional?intent=library">作品資料與工具</a>
          <a href={localAIHref}>閉端 AI 設定</a>
        </nav>
      </footer>
    </main>
  );
}
