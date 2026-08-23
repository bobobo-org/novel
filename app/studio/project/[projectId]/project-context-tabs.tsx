"use client";

import Link from "next/link";
import styles from "./project-context-tabs.module.css";

type StoryContextView = "timeline" | "story-bible";
type PeopleWorldView = "characters" | "character-ai" | "world";
type AIContextView = "closed-ai" | "learning";
type ProgressContextView = "tasks" | "achievements";

type ContextTab = {
  view: StoryContextView | PeopleWorldView | AIContextView | ProgressContextView;
  label: string;
  hint: string;
};

const CONTEXT_TABS: Record<"story" | "people-world" | "ai" | "progress", ContextTab[]> = {
  story: [
    { view: "timeline", label: "時間線", hint: "事件順序與章節連結" },
    { view: "story-bible", label: "故事記憶", hint: "伏筆、線索與 Canon" },
  ],
  "people-world": [
    { view: "characters", label: "角色資料", hint: "人物設定與能力" },
    { view: "character-ai", label: "角色視角 AI", hint: "私人思考與待核准候選" },
    { view: "world", label: "世界設定", hint: "背景與正式規則" },
  ],
  ai: [
    { view: "closed-ai", label: "AI 協調", hint: "模型連線、診斷與任務協調" },
    { view: "learning", label: "AI 學習", hint: "受控學習與知識庫" },
  ],
  progress: [
    { view: "tasks", label: "任務", hint: "目前目標、狀態與完成進度" },
    { view: "achievements", label: "成就", hint: "里程碑與已解鎖成果" },
  ],
};

function contextHref(
  projectId: string,
  context: "story" | "people-world" | "ai" | "progress",
  view: StoryContextView | PeopleWorldView | AIContextView | ProgressContextView,
) {
  if (context === "ai") {
    return `/studio/project/${encodeURIComponent(projectId)}/${view}`;
  }
  const base = context === "story"
    ? "story-context"
    : context === "progress"
      ? "progress"
      : "people-world";
  return `/studio/project/${encodeURIComponent(projectId)}/${base}?view=${encodeURIComponent(view)}`;
}

export function ProjectContextTabs({
  projectId,
  context,
  active,
}: {
  projectId: string;
  context: "story" | "people-world" | "ai" | "progress";
  active: StoryContextView | PeopleWorldView | AIContextView | ProgressContextView;
}) {
  const label = context === "story"
    ? "故事脈絡視角"
    : context === "people-world"
      ? "人物與世界視角"
      : context === "progress"
        ? "進度與目標視角"
        : "AI 協調與學習視角";
  return (
    <nav
      className={styles.tabs}
      aria-label={label}
      data-testid={`${context}-context-tabs`}
      data-active-view={active}
    >
      {CONTEXT_TABS[context].map((tab) => {
        const selected = tab.view === active;
        return (
          <Link
            key={tab.view}
            className={selected ? styles.active : undefined}
            href={contextHref(projectId, context, tab.view)}
            aria-current={selected ? "page" : undefined}
            data-context-view={tab.view}
          >
            <b>{tab.label}</b>
            <small>{tab.hint}</small>
          </Link>
        );
      })}
    </nav>
  );
}

export function ProjectContextSummary({
  items,
  notice,
}: {
  items: Array<{ label: string; value: string | number; detail: string }>;
  notice: string;
}) {
  return (
    <section className={styles.summary} data-testid="story-context-summary" aria-label="故事脈絡摘要">
      <div className={styles.summaryGrid}>
        {items.map((item) => (
          <article key={item.label}>
            <small>{item.label}</small>
            <b>{item.value}</b>
            <span>{item.detail}</span>
          </article>
        ))}
      </div>
      <p className={styles.notice} data-testid="story-context-canon-boundary">{notice}</p>
    </section>
  );
}
