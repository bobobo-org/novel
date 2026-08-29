"use client";

import type { ConversationArtifact, ConversationMessage } from "@/lib/novel-ai/domain";
import styles from "../conversation.module.css";

export function ApprovalCard({
  artifact,
  sourceMessage,
  busy,
  canRegenerate,
  onApprove,
  onReject,
  onRegenerate,
}: {
  artifact: ConversationArtifact;
  sourceMessage: ConversationMessage;
  busy: boolean;
  canRegenerate: boolean;
  onApprove: (artifact: ConversationArtifact) => void;
  onReject: (artifact: ConversationArtifact) => void;
  onRegenerate: (message: ConversationMessage) => void;
}) {
  if (artifact.status !== "candidate") return null;
  if (artifact.targetStore === "none") {
    return (
      <span className={styles.approvalActions} data-testid="conversation-reference-candidate-actions" data-artifact-id={artifact.id}>
        <small>已保存為參考候選，不寫入 Canon</small>
        <button type="button" disabled={busy} onClick={() => onReject(artifact)}>放棄</button>
      </span>
    );
  }
  const approveLabel = artifact.artifactType === "rpg"
    ? "核准寫入正文、狀態與收據"
    : artifact.artifactType === "learning_rule"
      ? "核准共享抽象規則"
      : "核准寫入正文";
  return (
    <span className={styles.approvalActions} data-testid="conversation-approval-actions" data-artifact-id={artifact.id}>
      <button
        className={styles.approvalPrimary}
        type="button"
        data-testid="conversation-approve-candidate"
        disabled={busy}
        onClick={() => onApprove(artifact)}
      >{approveLabel}</button>
      {canRegenerate ? <button type="button" disabled={busy} onClick={() => onRegenerate(sourceMessage)}>重新產生</button> : null}
      <button type="button" disabled={busy} onClick={() => onReject(artifact)}>放棄</button>
    </span>
  );
}
