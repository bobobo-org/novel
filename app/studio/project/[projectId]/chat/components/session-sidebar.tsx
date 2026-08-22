import Link from "next/link";
import type { Chapter, ConversationSession, NovelProject } from "@/lib/novel-ai/domain";
import styles from "../conversation.module.css";

export function SessionSidebar({
  projectId,
  project,
  chapters,
  sessions,
  activeSessionId,
  switchingSessionId,
  queuedSessionId,
  search,
  showArchived,
  busy,
  branchPending,
  open,
  onSearchChange,
  onToggleArchived,
  onNewSession,
  onChooseSession,
  onRenameSession,
  onArchiveSession,
  onDeleteSession,
  onExportSummary,
}: {
  projectId: string;
  project: NovelProject | null;
  chapters: Chapter[];
  sessions: ConversationSession[];
  activeSessionId: string;
  switchingSessionId: string | null;
  queuedSessionId: string | null;
  search: string;
  showArchived: boolean;
  busy: boolean;
  branchPending: boolean;
  open: boolean;
  onSearchChange: (value: string) => void;
  onToggleArchived: () => void;
  onNewSession: () => void;
  onChooseSession: (sessionId: string) => void;
  onRenameSession: (session: ConversationSession) => void;
  onArchiveSession: (session: ConversationSession) => void;
  onDeleteSession: (session: ConversationSession) => void;
  onExportSummary: () => void;
}) {
  return (
    <aside className={styles.sidebar} data-open={open} aria-label="小說專案欄" data-testid="conversation-session-sidebar">
      <div className={styles.brandRow}>
        <span className={styles.brandMark}>文</span>
        <div><strong>{project?.title ?? "載入中"}</strong><span>獨立作品記憶</span></div>
      </div>
      <button className={styles.newSession} type="button" onClick={onNewSession} disabled={busy}>＋ 新對話</button>
      {branchPending ? (
        <p className={styles.emptyNote} role="status" data-testid="conversation-branch-global-status">
          分支建立中。新對話、重新命名、封存與刪除已暫停；你仍可指定完成後要停留的對話。
        </p>
      ) : null}
      <input className={styles.searchInput} value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜尋對話" aria-label="搜尋對話" />
      <div className={styles.sidebarHeading}>
        <span>{showArchived ? "含封存對話" : "最近對話"}</span>
        <button className={styles.quietButton} type="button" disabled={busy} onClick={onToggleArchived}>{showArchived ? "隱藏封存" : "顯示封存"}</button>
      </div>
      <div className={styles.sessionList}>
        {sessions.map((session) => (
          <div className={styles.sessionRow} data-active={session.id === activeSessionId} data-switching={session.id === switchingSessionId} data-queued={session.id === queuedSessionId} key={session.id} data-session-id={session.id}>
            <button
              className={styles.sessionButton}
              type="button"
              disabled={(busy && !branchPending) || session.id === switchingSessionId || session.id === queuedSessionId}
              aria-busy={session.id === switchingSessionId || session.id === queuedSessionId}
              onClick={() => onChooseSession(session.id)}
            >
              {session.id === queuedSessionId
                ? "等待分支完成後切換……"
                : session.id === switchingSessionId
                  ? "切換中……"
                  : `${session.status === "archived" ? "〔封存〕" : ""}${session.title}`}
            </button>
            <span className={styles.sessionActions}>
              <button className={styles.iconButton} type="button" title="重新命名" disabled={busy} onClick={() => onRenameSession(session)}>✎</button>
              <button className={styles.iconButton} type="button" title="封存" disabled={busy} onClick={() => onArchiveSession(session)}>⌁</button>
              <button className={`${styles.iconButton} ${styles.danger}`} type="button" title="刪除" disabled={busy} onClick={() => onDeleteSession(session)}>×</button>
            </span>
          </div>
        ))}
      </div>
      <div className={styles.sidebarHeading}><span>專業工具</span></div>
      <p className={styles.emptyNote}>日常續寫、改寫、RPG 與 A／B／C 都留在故事工作台；只有要直接管理正式資料時才使用下列工具。</p>
      <div className={styles.projectLinks}>
        <Link href={`/studio/project/${encodeURIComponent(projectId)}/write`}>章節全文校訂</Link>
        <Link href={`/studio/project/${encodeURIComponent(projectId)}/story-bible`}>Story Bible</Link>
        <Link href={`/studio/project/${encodeURIComponent(projectId)}/characters`}>角色與關係</Link>
        <Link href={`/studio/project/${encodeURIComponent(projectId)}/world`}>世界規則</Link>
        <Link href={`/studio/project/${encodeURIComponent(projectId)}/timeline`}>時間線</Link>
        <Link href={`/studio/project/${encodeURIComponent(projectId)}/learning`}>閉端學習</Link>
        <Link href={`/studio/project/${encodeURIComponent(projectId)}/backups`}>備份與還原</Link>
        <button className={styles.quietButton} type="button" disabled={busy || !activeSessionId} onClick={onExportSummary}>匯出目前對話摘要</button>
      </div>
      <div className={styles.sidebarHeading}><span>最近章節</span></div>
      <div className={styles.recentChapters}>
        {[...chapters].slice(-4).reverse().map((chapter) => (
          <Link href={`/studio/project/${encodeURIComponent(projectId)}/write?chapterId=${encodeURIComponent(chapter.id)}`} key={chapter.id}>{chapter.title}</Link>
        ))}
      </div>
    </aside>
  );
}
