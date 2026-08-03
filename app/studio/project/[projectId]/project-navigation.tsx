"use client";

import Link from "next/link";
import {
  stageStudioTaskHandoff,
  studioHomeHref,
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
      window.location.assign(studioHomeHref(projectId));
    } };
  }

  return (
    <nav className="p2ProjectNav" aria-label="作品功能">
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
        const { icon, short } = PROJECT_LINK_PRESENTATION[path];
        return (
          <Link
            key={path}
            className={active === path ? "active" : ""}
            href={`/studio/project/${projectId}/${path}`}
            aria-current={active === path ? "page" : undefined}
            {...(active === path ? {} : guardedLink(`/studio/project/${projectId}/${path}`, label))}
          >
            <span className="p2NavIcon" aria-hidden="true">{icon}</span>
            <span className="p2NavLabel">{label}</span>
            <span className="p2NavShort">{short}</span>
          </Link>
        );
      })}
    </nav>
  );
}
