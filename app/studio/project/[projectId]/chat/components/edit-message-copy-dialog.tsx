"use client";

import type { FormEvent, KeyboardEvent, MouseEvent } from "react";
import styles from "../conversation.module.css";

export function EditMessageCopyDialog({
  open,
  value,
  sourceContent,
  confirming,
  onChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  value: string;
  sourceContent: string;
  confirming: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirming && value.trim()) onConfirm();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && !confirming) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !confirming && value.trim()) {
      event.preventDefault();
      onConfirm();
    }
  };
  const cancelFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target && !confirming) onCancel();
  };

  return (
    <div
      className={styles.editCopyBackdrop}
      data-testid="conversation-edit-copy-dialog"
      onMouseDown={cancelFromBackdrop}
    >
      <section
        className={styles.editCopyDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversation-edit-copy-title"
        aria-describedby="conversation-edit-copy-description"
        aria-busy={confirming}
      >
        <header className={styles.editCopyHeader}>
          <div>
            <span>EDIT COPY · 修改副本</span>
            <h2 id="conversation-edit-copy-title">修改訊息並從這裡重試</h2>
          </div>
        </header>
        <form className={styles.editCopyForm} onSubmit={submit}>
          <p id="conversation-edit-copy-description">
            原訊息會留在原對話。確認後會建立一個副本，並從這則訊息自動繼續一次。
          </p>
          <label htmlFor="conversation-edit-copy-content">副本中的訊息</label>
          <textarea
            id="conversation-edit-copy-content"
            autoFocus
            value={value}
            disabled={confirming}
            rows={7}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <p className={styles.editCopyHint}>
            {value.trim() === sourceContent.trim()
              ? "內容未變更：確認後仍會建立一個重試副本。"
              : "已修改內容：原文不會被覆寫。"}
          </p>
          <footer className={styles.editCopyActions}>
            <button type="button" disabled={confirming} onClick={onCancel}>取消</button>
            <button
              className={styles.editCopyConfirm}
              type="submit"
              disabled={confirming || !value.trim()}
            >
              {confirming ? "正在建立副本……" : "確認並在副本重試"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
