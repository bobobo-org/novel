"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { StoryState } from "@/lib/novel-ai/domain";
import {
  STORY_PLAY_MODE_LABELS,
  resolveStoryPlayMode,
  type StoryPlayModeId,
} from "@/lib/novel-ai/domain/play-mode";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  projectManagementHref,
  stageStudioTaskHandoff,
} from "@/lib/novel-ai/web/studio-task-session";
import { ProjectContextTabs } from "./project-context-tabs";

const PROJECT_LINKS = [
  ["people-world","人物與世界"],
  ["story-context","故事脈絡"],
  ["progress-hub","進度與目標"],
  ["ai-hub","AI 協調與學習"],
  ["drama","短劇改編"],
  ["author-tools","研究與作者工具"],
  ["data-safety","作品與安全"],
] as const;

const PROJECT_LINK_PRESENTATION: Record<(typeof PROJECT_LINKS)[number][0], {
  short: string;
  icon: string;
}> = {
  "people-world": { short: "人物世界", icon: "人" },
  "story-context": { short: "脈絡", icon: "⌁" },
  "progress-hub": { short: "任務成就", icon: "✓" },
  "ai-hub": { short: "AI 協調學習", icon: "◉" },
  drama: { short: "短劇", icon: "▶" },
  "author-tools": { short: "研究", icon: "⌕" },
  "data-safety": { short: "備份還原", icon: "↺" },
};

type ProjectLinkPath = (typeof PROJECT_LINKS)[number][0];

const PROJECT_LINK_ACTIVE_PATHS: Partial<Record<ProjectLinkPath, readonly string[]>> = {
  "ai-hub": ["ai-hub", "closed-ai", "learning"],
  "people-world": ["people-world", "characters", "character-ai", "world"],
  "story-context": ["story-context", "timeline", "story-bible"],
  "progress-hub": ["progress-hub", "tasks", "achievements"],
  "data-safety": ["data-safety", "backups"],
};

function projectLinkIsActive(path: ProjectLinkPath, active: string) {
  return path === active || PROJECT_LINK_ACTIVE_PATHS[path]?.includes(active) === true;
}

function projectLinkHref(projectId: string, path: ProjectLinkPath, active: string) {
  const encodedProjectId = encodeURIComponent(projectId);
  if (path === "ai-hub") {
    const view = ["closed-ai", "learning"].includes(active) ? active : "closed-ai";
    return `/studio/project/${encodedProjectId}/${view}`;
  }
  if (path === "people-world") {
    const view = ["characters", "character-ai", "world"].includes(active) ? active : "characters";
    return `/studio/project/${encodedProjectId}/people-world?view=${view}`;
  }
  if (path === "story-context") {
    const view = ["timeline", "story-bible"].includes(active) ? active : "timeline";
    return `/studio/project/${encodedProjectId}/story-context?view=${view}`;
  }
  if (path === "progress-hub") {
    const view = ["tasks", "achievements"].includes(active) ? active : "tasks";
    return `/studio/project/${encodedProjectId}/progress?view=${view}`;
  }
  if (path === "data-safety") {
    return `/studio/project/${encodedProjectId}/backups`;
  }
  return `/studio/project/${encodedProjectId}/${path}`;
}

export default function ProjectNavigation({
  projectId,
  active,
  activeHref,
  onNavigate,
}: {
  projectId: string;
  active: string;
  activeHref?: string;
  onNavigate?: (href: string, label: string) => void | Promise<void>;
}) {
  const [playMode, setPlayMode] = useState<StoryPlayModeId | null>(null);
  const projectHome = projectManagementHref(projectId);

  useEffect(() => {
    let activeRequest = true;
    void createNovelRepository().list<StoryState>("storyStates", projectId)
      .then((states) => {
        if (!activeRequest) return;
        const state = states[0];
        setPlayMode(state ? resolveStoryPlayMode(state) : "general");
      })
      .catch(() => {
        if (activeRequest) setPlayMode("general");
      });
    return () => { activeRequest = false; };
  }, [projectId]);

  function guardedLink(href: string, label: string) {
    return { onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (onNavigate) {
        void onNavigate(href, label);
        return;
      }
      try {
        stageStudioTaskHandoff({
          projectId,
          sourceLabel: PROJECT_LINKS.find(([path]) => projectLinkIsActive(path, active))?.[1] ?? "作品功能",
          destinationLabel: label,
          destinationHref: href,
        });
      } catch {
        // A privacy mode may block sessionStorage. The optional handoff receipt
        // must never turn a real feature link into a button that appears dead.
      } finally {
        // Project sections already share the same canonical repository. A
        // completed handoff can therefore go straight to the selected section;
        // forcing an extra home-page stop only made the interface feel like a
        // different application and invited accidental second clicks.
        window.location.assign(href);
      }
    } };
  }

  return (
    <>
    <nav className="p2ProjectNav p2UnifiedProjectNav" aria-label="作品導覽">
      {playMode ? (
        <span className="p2LockedPlayMode" title="此作品的玩法已固定；要改用其他玩法，請複製為新作品。">
          固定玩法：{STORY_PLAY_MODE_LABELS[playMode]}
        </span>
      ) : null}
      <Link
        href={projectHome}
        {...guardedLink(projectHome, "作品管理中心")}
      >
        <span className="p2NavIcon" aria-hidden="true">⌂</span>
        <span className="p2NavLabel">作品管理中心</span>
        <span className="p2NavShort">管理</span>
      </Link>
      <Link
        className={["chat", "ai", "rpg"].includes(active) ? "active" : ""}
        href={`/studio/project/${projectId}/chat`}
        aria-current={["chat", "ai", "rpg"].includes(active) ? "page" : undefined}
        {...(["chat", "ai", "rpg"].includes(active) ? {} : guardedLink(`/studio/project/${projectId}/chat`, "故事工作台"))}
      >
        <span className="p2NavIcon" aria-hidden="true">✦</span>
        <span className="p2NavLabel">故事工作台</span>
        <span className="p2NavShort">故事</span>
      </Link>
      <details className="p2ProjectTools">
        <summary>
          <span className="p2NavIcon" aria-hidden="true">⌘</span>
          <span className="p2NavLabel">全部作品功能</span>
          <span className="p2NavShort">功能</span>
        </summary>
        <p>人物與世界、故事脈絡只提供唯讀查詢與上場選擇；要修改正式角色、能力、世界、記憶或時間線，請開啟「正式設定管理（可編修）」。故事創作與 RPG 請回故事工作台。</p>
        <div className="p2ProjectToolGrid">
          {PROJECT_LINKS.map(([path, label]) => {
            const { icon, short } = PROJECT_LINK_PRESENTATION[path];
            const linkActive = projectLinkIsActive(path, active);
            const displayLabel = path === "people-world" || path === "story-context"
              ? `${label}（唯讀／上場選擇）`
              : label;
            const href = linkActive && activeHref
              ? activeHref
              : projectLinkHref(projectId, path, active);
            return (
              <Link
                key={path}
                className={linkActive ? "active" : ""}
                href={href}
                aria-current={linkActive ? "page" : undefined}
                {...(linkActive ? {} : guardedLink(href, displayLabel))}
              >
                <span className="p2NavIcon" aria-hidden="true">{icon}</span>
                <span className="p2NavLabel">{displayLabel}</span>
                <span className="p2NavShort">{short}</span>
              </Link>
            );
          })}
          <Link
            className="p2NavWorkbench"
            href={projectHome}
            prefetch={false}
            {...guardedLink(projectHome, "正式設定管理（可編修）")}
          >
            <span className="p2NavIcon" aria-hidden="true">▦</span>
            <span className="p2NavLabel">正式設定管理（可編修）</span>
            <span className="p2NavShort">資料</span>
          </Link>
          {playMode ? <Link
            className="p2NavCloneMode"
            href={`/studio/create?cloneFrom=${encodeURIComponent(projectId)}`}
            prefetch={false}
            {...guardedLink(`/studio/create?cloneFrom=${encodeURIComponent(projectId)}`, "複製為其他玩法")}
          >
            <span className="p2NavIcon" aria-hidden="true">↗</span>
            <span className="p2NavLabel">複製為其他玩法</span>
            <span className="p2NavShort">複製玩法</span>
          </Link> : null}
        </div>
      </details>
    </nav>
    {["closed-ai", "learning"].includes(active) ? (
      <ProjectContextTabs
        projectId={projectId}
        context="ai"
        active={active as "closed-ai" | "learning"}
      />
    ) : null}
    </>
  );
}
