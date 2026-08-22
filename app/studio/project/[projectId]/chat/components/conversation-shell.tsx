import Link from "next/link";
import type { ReactNode } from "react";
import { studioHomeHref } from "@/lib/novel-ai/web/studio-task-session";
import { MobileProjectDrawer } from "./mobile-project-drawer";
import styles from "../conversation.module.css";

export function ConversationShell({
  projectId,
  projectTitle,
  sessionTitle,
  chapterTitle,
  sidebarOpen,
  artifactOpen,
  loading,
  sidebar,
  timeline,
  composer,
  artifactDrawer,
  onOpenSidebar,
  onOpenArtifacts,
  onToggleArtifacts,
  onCloseDrawers,
}: {
  projectId: string;
  projectTitle: string;
  sessionTitle: string;
  chapterTitle: string | null;
  sidebarOpen: boolean;
  artifactOpen: boolean;
  loading: boolean;
  sidebar: ReactNode;
  timeline: ReactNode;
  composer: ReactNode;
  artifactDrawer: ReactNode;
  onOpenSidebar: () => void;
  onOpenArtifacts: () => void;
  onToggleArtifacts: () => void;
  onCloseDrawers: () => void;
}) {
  return (
    <main className={styles.shell} data-testid="conversation-first-workspace">
      <MobileProjectDrawer
        title={projectTitle}
        sidebarOpen={sidebarOpen}
        artifactOpen={artifactOpen}
        onOpenSidebar={onOpenSidebar}
        onOpenArtifacts={onOpenArtifacts}
        onClose={onCloseDrawers}
      />
      <div className={styles.workspace} data-artifact-open={artifactOpen}>
        {sidebar}
        <section className={styles.main}>
          <header className={styles.threadHeader}>
            <div><h1>{sessionTitle}</h1><p>{chapterTitle ? `目前章節：${chapterTitle}` : "尚未指定章節"}</p></div>
            <div className={styles.rightActions}>
              <Link className={styles.quietButton} href={studioHomeHref(projectId)}>作品首頁</Link>
              <button className={styles.quietButton} type="button" onClick={onToggleArtifacts}>候選與核准</button>
              <Link className={styles.quietButton} href={`/studio/project/${encodeURIComponent(projectId)}/write`}>章節全文校訂</Link>
            </div>
          </header>
          {timeline}
          {composer}
        </section>
        {artifactDrawer}
      </div>
      {loading ? <p className={styles.emptyNote}>正在載入對話……</p> : null}
    </main>
  );
}
