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
  stageStudioTaskHandoff,
} from "@/lib/novel-ai/web/studio-task-session";

// 保留既有的二欄導覽契約；顯示細節另外附加，避免新增介面破壞舊版驗證。
const PROJECT_LINKS = [
  ["write","寫作"],
  ["ai","AI 創作"],
  ["closed-ai","閉端 AI 中心"],
  ["learning","閉端 AI 學習"],
  ["rpg","RPG 養成"],
  ["character-ai","角色 AI"],
  ["drama","小說轉短劇"],
  ["characters","角色"],
  ["world","世界"],
  ["timeline","時間線"],
  ["story-bible","故事記憶"],
  ["tasks","任務"],
  ["achievements","成就"],
  ["backups","備份"],
] as const;

const PROJECT_LINK_PRESENTATION: Record<(typeof PROJECT_LINKS)[number][0], {
  short: string;
  icon: string;
}> = {
  write: { short: "寫作", icon: "✦" },
  ai: { short: "AI 創作", icon: "AI" },
  "closed-ai": { short: "AI 中心", icon: "◉" },
  learning: { short: "AI 學習", icon: "↟" },
  rpg: { short: "RPG", icon: "◆" },
  "character-ai": { short: "角色 AI", icon: "♟" },
  drama: { short: "短劇", icon: "▶" },
  characters: { short: "角色", icon: "人" },
  world: { short: "世界", icon: "◎" },
  timeline: { short: "時間", icon: "⌁" },
  "story-bible": { short: "記憶", icon: "▤" },
  tasks: { short: "任務", icon: "✓" },
  achievements: { short: "成就", icon: "★" },
  backups: { short: "備份", icon: "↺" },
};

export default function ProjectNavigation({
  projectId,
  active,
  onNavigate,
}: {
  projectId: string;
  active: string;
  onNavigate?: (href: string, label: string) => void | Promise<void>;
}) {
  const [playMode, setPlayMode] = useState<StoryPlayModeId | null>(null);

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
      stageStudioTaskHandoff({
        projectId,
        sourceLabel: PROJECT_LINKS.find(([path]) => path === active)?.[1] ?? "作品功能",
        destinationLabel: label,
        destinationHref: href,
      });
      // Project sections already share the same canonical repository. A
      // completed handoff can therefore go straight to the selected section;
      // forcing an extra home-page stop only made the interface feel like a
      // different application and invited accidental second clicks.
      window.location.assign(href);
    } };
  }

  return (
    <nav className="p2ProjectNav" aria-label="作品功能">
      {playMode ? (
        <span className="p2LockedPlayMode" title="此作品的玩法已固定；要改用其他玩法，請複製為新作品。">
          固定玩法：{STORY_PLAY_MODE_LABELS[playMode]}
        </span>
      ) : null}
      <Link
        className="p2NavWorkbench"
        href={`/professional?projectId=${encodeURIComponent(projectId)}`}
        prefetch={false}
        {...guardedLink(`/professional?projectId=${encodeURIComponent(projectId)}`, "專業工作台")}
      >
        <span className="p2NavIcon" aria-hidden="true">⌂</span>
        <span className="p2NavLabel">專業工作台</span>
        <span className="p2NavShort">工作台</span>
      </Link>
      {PROJECT_LINKS.map(([path, label]) => {
        if (path === "rpg" && (!playMode || playMode === "general")) return null;
        const { icon, short } = PROJECT_LINK_PRESENTATION[path];
        const displayedLabel = path === "rpg" && playMode
          ? `${STORY_PLAY_MODE_LABELS[playMode]}儀表板`
          : label;
        const displayedShort = path === "rpg" && playMode
          ? STORY_PLAY_MODE_LABELS[playMode].replace("養成", "").replace("模擬", "")
          : short;
        const href = path === "ai"
          ? `/studio/project/${projectId}/write?assistant=advanced#writing-ai`
          : `/studio/project/${projectId}/${path}`;
        return (
          <Link
            key={path}
            className={active === path ? "active" : ""}
            href={href}
            aria-current={active === path ? "page" : undefined}
            {...(active === path ? {} : guardedLink(href, displayedLabel))}
          >
            <span className="p2NavIcon" aria-hidden="true">{icon}</span>
            <span className="p2NavLabel">{displayedLabel}</span>
            <span className="p2NavShort">{displayedShort}</span>
          </Link>
        );
      })}
      {playMode ? (
        <Link
          className="p2NavCloneMode"
          href={`/studio/create?cloneFrom=${encodeURIComponent(projectId)}`}
          prefetch={false}
          {...guardedLink(`/studio/create?cloneFrom=${encodeURIComponent(projectId)}`, "複製為其他玩法")}
        >
          <span className="p2NavIcon" aria-hidden="true">↗</span>
          <span className="p2NavLabel">複製為其他玩法</span>
          <span className="p2NavShort">複製玩法</span>
        </Link>
      ) : null}
    </nav>
  );
}
