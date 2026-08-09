import type { ChangeEvent } from "react";
import type { ConversationToolInvocation } from "@/lib/novel-ai/domain";
import { useConversationComposer } from "../hooks/use-conversation-composer";
import { AttachmentTray } from "./attachment-tray";
import type { LocalAttachment } from "./conversation-types";
import styles from "../conversation.module.css";

export function MessageComposer({
  active,
  busy,
  busyReason,
  canStop,
  draft,
  localAttachments,
  rightsConfirmed,
  latestInvocation,
  onDraftChange,
  onFilesSelected,
  onRightsConfirmedChange,
  onRetryAttachment,
  onRemoveAttachment,
  onToggleArtifacts,
  onStop,
  onSend,
}: {
  active: boolean;
  busy: boolean;
  busyReason: string | null;
  canStop: boolean;
  draft: string;
  localAttachments: LocalAttachment[];
  rightsConfirmed: boolean;
  latestInvocation: ConversationToolInvocation | null;
  onDraftChange: (value: string) => void;
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onRightsConfirmedChange: (confirmed: boolean) => void;
  onRetryAttachment: (localId: string) => void;
  onRemoveAttachment: (localId: string) => void;
  onToggleArtifacts: () => void;
  onStop: () => void;
  onSend: () => void;
}) {
  const composer = useConversationComposer({
    active,
    busy,
    draft,
    attachmentCount: localAttachments.length,
    onSend,
  });
  return (
    <footer className={styles.composerWrap} data-testid="conversation-message-composer" aria-busy={busy}>
      <div className={styles.composer}>
        <AttachmentTray
          attachments={localAttachments}
          busy={busy}
          rightsConfirmed={rightsConfirmed}
          onRightsConfirmedChange={onRightsConfirmedChange}
          onRetry={onRetryAttachment}
          onRemove={onRemoveAttachment}
        />
        <textarea value={draft} disabled={busy || !active} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={composer.onKeyDown} placeholder="直接說你想對這部小說做什麼……" aria-label="小說專案訊息" />
        <div className={styles.composerActions}>
          <div className={styles.leftActions}>
            <label className={styles.quietButton} title="附加本機檔案">＋ 檔案<input className={styles.fileInput} type="file" multiple accept=".txt,.md,.markdown,.html,.htm,.json,.pdf,.docx" onChange={onFilesSelected} disabled={busy} /></label>
            <button className={styles.quietButton} type="button" onClick={onToggleArtifacts}>結果</button>
          </div>
          <div className={styles.rightActions}>
            {canStop ? <button className={styles.quietButton} type="button" onClick={onStop}>停止</button> : null}
            <button className={styles.sendButton} type="button" onClick={composer.submit} disabled={!composer.canSend}>送出</button>
          </div>
        </div>
      </div>
      {busyReason ? <p className={styles.emptyNote} role="status">{busyReason}</p> : null}
      <div className={styles.composerMeta}>
        <span>Enter 送出 · Shift＋Enter 換行</span>
        <span>·</span>
        <span className={styles.localBadge}>
          {latestInvocation?.actualExecutor ?? (busy ? "Closed Agent OS" : "Closed-only")}
          {latestInvocation?.modelId ? ` · ${latestInvocation.modelId}` : ""}
          {` · 資料${latestInvocation?.dataLeftDevice ? "已" : "未"}離開裝置`}
        </span>
      </div>
    </footer>
  );
}
