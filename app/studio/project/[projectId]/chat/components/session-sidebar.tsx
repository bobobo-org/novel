import Link from "next/link";
import type { ConversationSession, NovelProject } from "@/lib/novel-ai/domain";
import { projectManagementHref } from "@/lib/novel-ai/web/studio-task-session";
import styles from "../conversation.module.css";

export function SessionSidebar({
  projectId,
  project,
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
      <div className={styles.sidebarUtilities}>
        <Link className={styles.managementLink} href={projectManagementHref(projectId)}>
          <strong>作品管理中心</strong>
          <span>章節、角色、世界、任務、備份、學習與 AI 設定都在這裡</span>
        </Link>
        <button className={styles.exportSummary} type="button" disabled={busy || !activeSessionId} onClick={onExportSummary}>
          匯出目前對話摘要
        </button>
      </div>
    </aside>
  );
}
