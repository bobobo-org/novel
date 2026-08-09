"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { NovelProject } from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  EXPLICIT_LEGACY_STUDIO_KEYS,
  previewLegacyStudioProjects,
} from "@/lib/novel-ai/repository/migration/legacy-studio-migration";
import { PASSWORDLESS_LOCAL_AI_ORIGINS } from "@/lib/novel-ai/providers/local-ollama/companion-release";
import { getStudioClosedAIRuntimeCoordinator } from "@/lib/novel-ai/web/closed-agent-os-service";

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

function isExplicitLegacyRoute(href: string) {
  return href === "/professional"
    || href.startsWith("/professional?")
    || href.startsWith("/legacy/");
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
      void (async () => {
        const shellRecent = recentProjectFromShell();
        let recent = shellRecent;
        let canonicalProjects: NovelProject[] = [];
        try {
          canonicalProjects = (await createNovelRepository().list<NovelProject>("projects"))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
          const preferred = canonicalProjects.find((item) => item.id === shellRecent?.id)
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
        const origin = window.location.origin;
        const coordinator = getStudioClosedAIRuntimeCoordinator(origin);
        const session = coordinator.localClient.getSessionMetadata();
        const proof = coordinator.localClient.getModelVerification();
        if (!active) return;
        setRecentProject(recent);
        setProjectCount(canonicalProjects.length || (recent ? 1 : 0));
        setLegacyPreview(preview);
        setClosedAI(proof ? "已就緒" : session ? "等待配對" : "未設定");
        if (PASSWORDLESS_LOCAL_AI_ORIGINS.includes(
          origin as (typeof PASSWORDLESS_LOCAL_AI_ORIGINS)[number],
        )) {
          try {
            const result = await coordinator.connectAutomatically();
            if (!active) return;
            const ready = result.localOllama.status === "fulfilled"
              || result.privateHub.status === "fulfilled";
            const hasSession = Boolean(
              coordinator.localClient.getSessionMetadata()
              || coordinator.privateHubClient.getSessionMetadata(),
            );
            setClosedAI(ready ? "已就緒" : hasSession ? "等待配對" : "未設定");
          } catch {
            if (!active) return;
            const hasSession = Boolean(
              coordinator.localClient.getSessionMetadata()
              || coordinator.privateHubClient.getSessionMetadata(),
            );
            setClosedAI(hasSession ? "等待配對" : "未設定");
          }
        }
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
  const continueHref = projectCount === 1 && recentId
    ? `/studio/project/${encodeURIComponent(recentId)}/chat`
    : projectCount > 0
      ? "/professional?intent=chat"
      : "/studio/create";
  const localAIHref = useMemo(() => {
    const returnTo = recentId
      ? `/studio/project/${encodeURIComponent(recentId)}/chat`
      : "/professional?intent=chat";
    return `/settings/local-ai?returnTo=${encodeURIComponent(returnTo)}`;
  }, [recentId]);
  const entries = [
    ["開始新故事", "先命名、固定玩法，再建立人物、世界與故事起點。", "/studio/create", "✦"],
    ["繼續小說專案", projectCount > 1 ? `從 ${projectCount} 部正式作品中選擇，不會誤開別部作品。` : recentProject ? `回到《${recentProject.title}》的對話。` : "尚無作品時會引導你建立第一部小說。", continueHref, "↗"],
    ["小說專案助手", "用自然語言續寫、改寫、分析、匯入檔案或進行故事回合。", continueHref, "AI"],
    ["互動故事／RPG", "先選正式作品，再進入該作品已鎖定的單一玩法。", "/professional?intent=play", "ABC"],
    ["角色與世界", "先選作品，再管理人物、關係、世界與 Story Bible。", "/professional?intent=library", "角"],
    ["我的作品", "選擇作品並查看寫作、閱讀、版本與備份。", "/professional?intent=library", "冊"],
    ["本機 AI 設定", "正式網址會直接連接；也可查看 Local Bridge、Private Hub 與模型實測狀態。", localAIHref, "⌁"],
    ["進階工具", "開啟 Legacy 完整工具與技術診斷。", "/professional", "⚙"],
  ] as const;

  return (
    <main
      className="frontdoor"
      data-consumer-release={release.consumerRelease}
      data-app-commit={release.appCommit}
      data-testid="modern-consumer-frontdoor"
    >
      <header className="frontdoorNav">
        <Link className="brandLockup" href="/" aria-label="諸天萬界小說生成系統首頁">
          <span className="brandSeal">創</span>
          <span><b>諸天萬界</b><small>小說生成系統</small></span>
        </Link>
        <nav aria-label="主要導覽">
          <Link className="active" href="/">首頁</Link>
          <Link href="/studio/create">創作</Link>
          <Link href={continueHref}>AI 助手</Link>
          <Link href="/professional?intent=play">互動故事</Link>
          <Link href="/professional?intent=library">我的作品</Link>
        </nav>
        <Link className="navCta" href="/studio">進入創作中心</Link>
      </header>

      <section className="frontdoorHero">
        <div className="heroCopy">
          <p className="eyebrow">本機優先・每一步由你確認</p>
          <h1>諸天萬界小說生成系統</h1>
          <p className="lead">創作、互動、養成與經營的閉端 AI 故事平台</p>
          <h2>今天想創作什麼樣的故事？</h2>
          <div className="heroActions">
            <Link className="primaryAction" href="/studio/create">開始新故事</Link>
            <Link className="secondaryAction" href={continueHref}>{projectCount > 1 ? "選擇作品繼續" : "繼續最近作品"}</Link>
          </div>
        </div>
        <div className="worldPreview" aria-label="故事世界預覽">
          <span className="moon" />
          <span className="mountain mountainBack" />
          <span className="mountain mountainFront" />
          <div className="previewCaption"><small>目前模式</small><b>作品留在裝置・AI 候選需核准</b></div>
        </div>
      </section>

      <section className="frontdoorRuntime" aria-label="目前執行狀態">
        <Link className="frontdoorRuntimeCard" href="/studio/settings/storage"><span>作品儲存</span><strong>本機裝置</strong><small>IndexedDB 是正式作品庫</small></Link>
        <article data-state={closedAI}><span>閉端 AI</span><strong>{closedAI}</strong><small>不會暗中切換外部 AI</small></article>
        <Link className="frontdoorRuntimeCard" data-state={cloudSync} href="/studio/settings/storage"><span>雲端同步</span><strong>{cloudSync}</strong><small>端對端加密・異常不阻擋創作</small></Link>
        <article><span>外部 AI</span><strong>預設未使用</strong><small>只有明確同意才可呼叫</small></article>
      </section>

      {legacyPreview?.found && legacyPreview.pending && !dismissLegacy ? (
        <section className="frontdoorLegacy" data-testid="legacy-migration-preview">
          <div>
            <span>發現舊版作品</span>
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
            <Link data-testid="legacy-import-explicit" href="/studio?legacyMigration=import">匯入到新版作品庫</Link>
            <button type="button" onClick={() => setDismissLegacy(true)}>暫不匯入</button>
            <a href="/legacy/novel-system.html">繼續使用舊版</a>
          </div>
        </section>
      ) : null}

      <section className="frontdoorEntries" aria-labelledby="entryTitle">
        <div className="sectionTitle">
          <span>{packs} 個分類包・{classicTopics} 類經典題材</span>
          <h2 id="entryTitle">所有功能都從首頁直接找到</h2>
        </div>
        <div className="entryGrid">
          {entries.map(([title, description, href, icon]) => {
            const content = <>
              <span className="entryIndex">{icon}</span><h3>{title}</h3><p>{description}</p>
              <span className="entryArrow" aria-hidden="true">→</span>
            </>;
            return isExplicitLegacyRoute(href) ? (
              <a className="entryCard" href={href} key={title}>{content}</a>
            ) : (
              <Link className="entryCard" href={href} key={title}>{content}</Link>
            );
          })}
        </div>
      </section>
      <footer className="frontdoorFooter">
        <p>快速本機模式：速度較快，長篇品質有限。系統不會把 API online 顯示成 AI online。</p>
        <a href="/legacy/novel-system.html">Legacy 進階工具</a>
      </footer>
    </main>
  );
}
