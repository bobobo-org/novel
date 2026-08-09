import { memo } from "react";
import type {
  ConversationArtifact,
  ConversationAttachment,
  ConversationMessage,
  ConversationToolInvocation,
} from "@/lib/novel-ai/domain";
import { useConversationRpg } from "../hooks/use-conversation-rpg";
import { CandidateCard } from "./candidate-card";
import {
  conversationMessageLabel,
  conversationStatusLabel,
  formatConversationTime,
} from "./conversation-presentation";
import type { ConversationMessageActions } from "./conversation-types";
import { AttachmentCard } from "./attachment-card";
import { RpgTurnCard } from "./rpg-turn-card";
import { ToolProgressCard } from "./tool-progress-card";
import styles from "../conversation.module.css";

export const MessageRow = memo(function MessageRow({
  message,
  allMessages,
  allInvocations,
  artifactsByMessage,
  invocationsByMessage,
  attachmentsById,
  busy,
  canStop,
  progress,
  branchPending,
  actions,
  lineage,
}: {
  message: ConversationMessage;
  allMessages: ConversationMessage[];
  allInvocations: ConversationToolInvocation[];
  artifactsByMessage: Map<string, ConversationArtifact[]>;
  invocationsByMessage: Map<string, ConversationToolInvocation>;
  attachmentsById: Map<string, ConversationAttachment>;
  busy: boolean;
  canStop: boolean;
  progress: string;
  branchPending: boolean;
  actions: ConversationMessageActions;
  lineage: { rootId: string; depth: number };
}) {
  const rpg = useConversationRpg({ message, messages: allMessages, artifactsByMessage });
  const rpgChoices = rpg.parsed;
  const rpgChoicesConsumed = rpg.consumed;
  const messageArtifacts = artifactsByMessage.get(message.id) ?? [];
  const invocation = invocationsByMessage.get(message.id);
  const messageInvocations = allInvocations.filter((item) => item.messageId === message.id);
  const retryParent = message.parentMessageId
    ? allMessages.find((candidate) => candidate.id === message.parentMessageId) ?? null
    : null;
  const retryNeedsAttachment = Boolean(retryParent?.attachmentIds.length);
  const canRegenerate = message.role === "assistant"
    && message.status === "completed"
    && !retryNeedsAttachment
    && messageInvocations.some((item) => item.toolId.startsWith("closed-agent-os:"))
    && !rpgChoices
    && !messageArtifacts.some((item) => ["rpg", "learning_rule"].includes(item.artifactType));
  const hasComparableCandidate = Boolean(
    message.sourceMessageId
    && messageArtifacts.some((artifact) => (
      (artifactsByMessage.get(message.sourceMessageId ?? "") ?? []).some((previous) => (
        previous.artifactType === artifact.artifactType
        && previous.targetStore === artifact.targetStore
        && previous.targetRecordId === artifact.targetRecordId
      ))
    )),
  );

  return (
    <article
      className={styles.message}
      data-role={message.role}
      data-status={message.status}
      data-message-id={message.id}
      data-parent-message-id={message.parentMessageId ?? undefined}
      data-source-message-id={message.sourceMessageId ?? undefined}
      data-lineage-root={lineage.rootId}
      data-lineage-depth={lineage.depth}
    >
      <div className={styles.messageMeta}>
        <strong>{conversationMessageLabel(message.role)}</strong>
        <span>{formatConversationTime(message.createdAt)}</span>
        <span>{conversationStatusLabel(message.status)}</span>
      </div>
      {rpgChoices ? (
        <RpgTurnCard
          parsed={rpgChoices}
          messageId={message.id}
          busy={busy}
          consumed={rpgChoicesConsumed}
          onChoose={(key) => {
            if (rpgChoices.envelope) actions.chooseRpgOption(rpgChoices.envelope, message.id, key);
          }}
        />
      ) : message.content ? (
        <div className={styles.messageBody}>{message.content}</div>
      ) : null}
      {message.attachmentIds.map((attachmentId) => {
        const attachment = attachmentsById.get(attachmentId);
        return attachment ? <AttachmentCard key={attachment.id} attachment={attachment} /> : null;
      })}
      {invocation && ["pending", "running"].includes(invocation.status) ? (
        <ToolProgressCard progress={invocation.safeProgress?.message ?? progress} canStop={canStop} onStop={actions.stopGeneration} />
      ) : null}
      {messageArtifacts.map((artifact) => (
        <CandidateCard
          key={artifact.id}
          artifact={artifact}
          sourceMessage={message}
          busy={busy}
          canRegenerate={canRegenerate}
          hasComparableCandidate={hasComparableCandidate}
          onOpen={actions.openArtifact}
          onApprove={actions.approveArtifact}
          onReject={actions.rejectArtifact}
          onRegenerate={actions.regenerateMessage}
        />
      ))}
      <div className={styles.candidateActions}>
        {message.role === "user" && message.status === "completed" ? (
          <button
            type="button"
            data-conversation-action="edit-branch"
            disabled={busy || branchPending}
            aria-busy={branchPending}
            onClick={() => actions.editMessage(message)}
          >
            {branchPending ? "建立編輯分支中……" : "編輯並分支"}
          </button>
        ) : null}
        {message.status === "completed" ? (
          <button
            type="button"
            data-conversation-action="branch"
            disabled={busy || branchPending}
            aria-busy={branchPending}
            onClick={() => actions.createBranch(message)}
          >
            {branchPending ? "建立分支中……" : "從這裡分支"}
          </button>
        ) : null}
        {branchPending ? <span className={styles.emptyNote} role="status">分支建立中，請稍候。</span> : null}
        {canRegenerate ? <button type="button" onClick={() => actions.regenerateMessage(message)}>重新產生</button> : null}
        {(["failed", "cancelled"].includes(message.status)) && !retryNeedsAttachment ? <button type="button" onClick={() => actions.retryMessage(retryParent?.content ?? "")}>重試</button> : null}
        {(["failed", "cancelled"].includes(message.status)) && retryNeedsAttachment ? <span className={styles.emptyNote}>請重新附加原檔後再試</span> : null}
      </div>
    </article>
  );
});
