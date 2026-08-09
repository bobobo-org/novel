import type { LocalAttachment } from "./conversation-types";
import styles from "../conversation.module.css";

export function AttachmentTray({
  attachments,
  busy,
  rightsConfirmed,
  onRightsConfirmedChange,
  onRetry,
  onRemove,
}: {
  attachments: LocalAttachment[];
  busy: boolean;
  rightsConfirmed: boolean;
  onRightsConfirmedChange: (confirmed: boolean) => void;
  onRetry: (localId: string) => void;
  onRemove: (localId: string) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div className={styles.attachmentStrip} data-testid="conversation-attachment-tray">
      {attachments.map((item) => (
        <span className={styles.attachmentPill} key={item.localId} data-attachment-id={item.localId}>
          <span title={item.errorCode
            ? `${item.errorCode}${item.errorCode === "OCR_REQUIRED" ? "：需先 OCR，或移除後重新選擇可解析檔案" : "：可重試，或移除後重新選擇檔案"}`
            : undefined}>
            {item.file.name} · {item.progress
              ? `${item.progress.phase} ${item.progress.current}/${item.progress.total}`
              : item.errorCode
                ? `${item.status} · ${item.errorCode}${item.errorCode === "OCR_REQUIRED" ? "（需先 OCR／可重選）" : "（可重試／重選）"}`
                : item.status}
          </span>
          {!busy && ["failed", "cancelled"].includes(item.status) ? (
            <button className={styles.quietButton} type="button" onClick={() => onRetry(item.localId)}>重試</button>
          ) : null}
          {!busy ? <button className={styles.iconButton} type="button" aria-label={`移除 ${item.file.name}`} onClick={() => onRemove(item.localId)}>×</button> : null}
        </span>
      ))}
      <label className={styles.rightsConfirm}>
        <input
          type="checkbox"
          checked={rightsConfirmed}
          disabled={busy}
          onChange={(event) => onRightsConfirmedChange(event.target.checked)}
        />
        我確認擁有或已獲授權分析這些作品；只有整份學習匯入會使用此確認
      </label>
    </div>
  );
}
