import type { ConversationAttachment } from "@/lib/novel-ai/domain";
import styles from "../conversation.module.css";

export default function AttachmentPreview({
  attachment,
}: {
  attachment: ConversationAttachment;
}) {
  return (
    <div data-testid="conversation-attachment-preview">
      <p>
        {attachment.format.toUpperCase()} · {Math.ceil(attachment.byteLength / 1024)} KB
      </p>
      <small>
        僅在裝置內解析 · 原始內容未保留 · 安全來源代號：{attachment.safeSourceAlias}
      </small>
      {attachment.warnings?.length ? (
        <section aria-label="附件解析警告">
          <h4>DOCX 解析警告（{attachment.warnings.length}）</h4>
          <ul>{attachment.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </section>
      ) : (
        <p className={styles.emptyNote}>未偵測到解析警告。</p>
      )}
    </div>
  );
}
