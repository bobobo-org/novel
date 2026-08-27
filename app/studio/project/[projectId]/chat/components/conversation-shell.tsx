"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { projectManagementHref } from "@/lib/novel-ai/web/studio-task-session";
import { MobileProjectDrawer } from "./mobile-project-drawer";
import styles from "../conversation.module.css";

export function ConversationShell({
  projectId,
  projectTitle,
  sessionTitle,
  chapterTitle,
  playModeLabel,
  sidebarOpen,
  artifactOpen,
  loading,
  sidebar,
  storyStage,
  timeline,
  composer,
  artifactDrawer,
  onOpenSidebar,
  onToggleSidebar,
  onOpenArtifacts,
  onToggleArtifacts,
  onCloseDrawers,
}: {
  projectId: string;
  projectTitle: string;
  sessionTitle: string;
  chapterTitle: string | null;
  playModeLabel: string;
  sidebarOpen: boolean;
  artifactOpen: boolean;
  loading: boolean;
  sidebar: ReactNode;
  storyStage: ReactNode;
  timeline: ReactNode;
  composer: ReactNode;
  artifactDrawer: ReactNode;
  onOpenSidebar: () => void;
  onToggleSidebar: () => void;
  onOpenArtifacts: () => void;
  onToggleArtifacts: () => void;
  onCloseDrawers: () => void;
}) {
  const shellRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    const documentOverflow = document.documentElement.style.overflow;
    const bodyOverflow = document.body.style.overflow;
    const syncVisualViewport = () => {
      const shell = shellRef.current;
      if (!shell) return;
      if (shell.scrollTop !== 0 || shell.scrollLeft !== 0) shell.scrollTo(0, 0);
      if (window.matchMedia("(max-width: 900px)").matches) {
        document.documentElement.style.overflow = "hidden";
        document.body.style.overflow = "hidden";
        if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
      }
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      shell.style.setProperty("--conversation-visual-height", `${Math.max(1, Math.round(height))}px`);
      shell.style.setProperty("--conversation-visual-top", `${Math.max(0, Math.round(offsetTop))}px`);
      shell.dataset.visualViewport = viewport ? "bound" : "layout-fallback";
    };

    syncVisualViewport();
    viewport?.addEventListener("resize", syncVisualViewport);
    viewport?.addEventListener("scroll", syncVisualViewport);
    window.addEventListener("resize", syncVisualViewport);
    window.addEventListener("scroll", syncVisualViewport, { passive: true });
    const shell = shellRef.current;
    shell?.addEventListener("scroll", syncVisualViewport, { passive: true });
    return () => {
      viewport?.removeEventListener("resize", syncVisualViewport);
      viewport?.removeEventListener("scroll", syncVisualViewport);
      window.removeEventListener("resize", syncVisualViewport);
      window.removeEventListener("scroll", syncVisualViewport);
      shell?.removeEventListener("scroll", syncVisualViewport);
      document.documentElement.style.overflow = documentOverflow;
      document.body.style.overflow = bodyOverflow;
    };
  }, []);

  return (
    <main ref={shellRef} className={styles.shell} data-testid="conversation-first-workspace">
      <MobileProjectDrawer
        title={projectTitle}
        sidebarOpen={sidebarOpen}
        artifactOpen={artifactOpen}
        onOpenSidebar={onOpenSidebar}
        onOpenArtifacts={onOpenArtifacts}
        onClose={onCloseDrawers}
      />
      <div
        className={styles.workspace}
        data-artifact-open={artifactOpen}
        data-sidebar-open={sidebarOpen}
      >
        {sidebar}
        <section className={styles.main}>
          <header className={styles.threadHeader}>
            <div className={styles.threadIdentity}>
              <button
                className={styles.sidebarToggle}
                type="button"
                data-testid="conversation-sidebar-toggle"
                aria-expanded={sidebarOpen}
                aria-controls="conversation-session-sidebar"
                onClick={onToggleSidebar}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
                <span>專案／對話</span>
              </button>
              <div>
                <h1>{sessionTitle}</h1>
                <p>{chapterTitle ? `目前章節：${chapterTitle}` : "尚未指定章節"} · 玩法：{playModeLabel}</p>
              </div>
            </div>
            <div className={styles.rightActions}>
              <Link className={styles.quietButton} href="/">系統首頁</Link>
              <Link className={styles.quietButton} href={projectManagementHref(projectId)}>作品管理中心</Link>
              <button className={styles.quietButton} type="button" onClick={onToggleArtifacts}>候選與核准</button>
            </div>
          </header>
          {storyStage}
          {timeline}
          {composer}
        </section>
        {artifactDrawer}
      </div>
      {loading ? <p className={styles.emptyNote}>正在載入對話……</p> : null}
    </main>
  );
}
