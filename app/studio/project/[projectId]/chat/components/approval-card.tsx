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
  return (
    <span className={styles.approvalActions} data-testid="conversation-approval-actions" data-artifact-id={artifact.id}>
      <button className={styles.primaryAction} type="button" disabled={busy} onClick={() => onApprove(artifact)}>採用</button>
      {canRegenerate ? <button type="button" disabled={busy} onClick={() => onRegenerate(sourceMessage)}>重新產生</button> : null}
      <button type="button" disabled={busy} onClick={() => onReject(artifact)}>放棄</button>
    </span>
  );
}
