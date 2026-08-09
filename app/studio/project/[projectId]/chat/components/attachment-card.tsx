"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { ConversationAttachment } from "@/lib/novel-ai/domain";
import styles from "../conversation.module.css";

const AttachmentPreview = dynamic(() => import("./attachment-preview"), {
  loading: () => <small role="status">正在載入附件詳細資料…</small>,
});

export function AttachmentCard({ attachment }: { attachment: ConversationAttachment }) {
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <div className={styles.attachmentCard} data-attachment-id={attachment.id}>
      <div>
        <strong>{attachment.displayName}</strong> · {attachment.parsingStatus}
      </div>
      <details
        className={styles.evidenceDetails}
        onToggle={(event) => setPreviewOpen(event.currentTarget.open)}
      >
        <summary>
          查看附件詳情{attachment.warnings?.length ? `（${attachment.warnings.length} 則警告）` : ""}
        </summary>
        {previewOpen ? <AttachmentPreview attachment={attachment} /> : null}
      </details>
    </div>
  );
}
