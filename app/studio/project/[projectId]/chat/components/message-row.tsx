import { memo } from "react";
import type { ReactNode } from "react";
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
import { ConversationExecutionTrace } from "./execution-trace";
import {
  friendlyConversationExecutionError,
  friendlyFailedAssistantContent,
} from "./execution-trace-model";
import { closedRegenerationProofStatus } from "./conversation-regeneration-proof";
import {
  selectClosedAgentFailureEvidenceInvocation,
} from "@/lib/novel-ai/closed-agent-os/safe-runtime-diagnostics";
import styles from "../conversation.module.css";

export const MessageRow = memo(function MessageRow({
  message,
  allMessages,
  allInvocations,
  artifactsByMessage,
  invocationsByMessage,
  attachmentsById,
  busy,
  regenerationReady,
  canStop,
  progress,
  branchPending,
  actions,
  lineage,
  playDashboard,
  playDashboardPlacement,
}: {
  message: ConversationMessage;
  allMessages: ConversationMessage[];
  allInvocations: ConversationToolInvocation[];
  artifactsByMessage: Map<string, ConversationArtifact[]>;
  invocationsByMessage: Map<string, ConversationToolInvocation>;
  attachmentsById: Map<string, ConversationAttachment>;
  busy: boolean;
  regenerationReady: boolean;
  canStop: boolean;
  progress: string;
  branchPending: boolean;
  actions: ConversationMessageActions;
  lineage: { rootId: string; depth: number };
  playDashboard: ReactNode;
  playDashboardPlacement: "choices" | "afterCandidate" | null;
}) {
  const rpg = useConversationRpg({ message, messages: allMessages, artifactsByMessage });
  const rpgChoices = rpg.parsed;
  const rpgChoicesConsumed = rpg.consumed;
  const messageArtifacts = artifactsByMessage.get(message.id) ?? [];
  const messageInvocations = allInvocations.filter((item) => item.messageId === message.id);
  const invocation = invocationsByMessage.get(message.id);
  const persistedFailure = selectClosedAgentFailureEvidenceInvocation(
    messageInvocations,
    message.id,
  );
  const failureInvocation = persistedFailure?.invocation ?? null;
  const failureEvidence = persistedFailure?.evidence ?? null;
  const visibleFailure = failureInvocation && failureEvidence
    ? friendlyConversationExecutionError(
        failureInvocation.safeErrorCode ?? failureEvidence.safeCode,
        failureInvocation.safeProgress?.message,
      )
    : null;
  const retryParent = message.parentMessageId
    ? allMessages.find((candidate) => candidate.id === message.parentMessageId) ?? null
    : null;
  const retryNeedsAttachment = Boolean(retryParent?.attachmentIds.length);
  const closedProofStatus = closedRegenerationProofStatus({
    message,
    invocations: messageInvocations,
    artifacts: messageArtifacts,
  });
  const hasVerifiedClosedInvocation = closedProofStatus === "verified";
  const canRegenerate = message.role === "assistant"
    && message.status === "completed"
    && regenerationReady
    && !retryNeedsAttachment
    && hasVerifiedClosedInvocation
    && !rpgChoices
    && !messageArtifacts.some((item) => (
      ["rpg", "learning_rule"].includes(item.artifactType)
      || item.status === "approved"
      || item.status === "superseded"
    ));
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
      data-rpg-choices={rpgChoices ? "true" : undefined}
      data-rpg-story={messageArtifacts.some((artifact) => artifact.artifactType === "rpg") || undefined}
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
          dashboard={playDashboardPlacement === "choices" ? playDashboard : null}
          onChoose={(key) => {
            if (rpgChoices.envelope) actions.chooseRpgOption(rpgChoices.envelope, message.id, key);
          }}
        />
      ) : message.content ? (
        <div className={styles.messageBody}>{message.role === "assistant" && ["failed", "cancelled"].includes(message.status)
          ? friendlyFailedAssistantContent(
              message.content,
              failureInvocation?.safeErrorCode ?? invocation?.safeErrorCode,
            )
          : message.content}</div>
      ) : null}
      {message.role === "assistant" ? <ConversationExecutionTrace invocations={messageInvocations} /> : null}
      {message.attachmentIds.map((attachmentId) => {
        const attachment = attachmentsById.get(attachmentId);
        return attachment ? <AttachmentCard key={attachment.id} attachment={attachment} /> : null;
      })}
      {invocation && ["pending", "running"].includes(invocation.status) ? (
        <ToolProgressCard progress={invocation.safeProgress?.message ?? progress} canStop={canStop} onStop={actions.stopGeneration} />
      ) : null}
      {failureInvocation && failureEvidence && visibleFailure ? (
        <section
          className={styles.resultCard}
          role="alert"
          data-testid="conversation-closed-agent-failure-evidence"
          data-failure-evidence-schema={failureEvidence.schemaVersion}
          data-failure-evidence={failureInvocation.safeProgress?.message}
          data-invocation-id={failureInvocation.id}
          data-task-id={failureInvocation.taskId}
        >
          <strong>{visibleFailure.title}</strong>
          <p>{visibleFailure.message} 未完成內容與 Canon 均未修改。</p>
        </section>
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
      {playDashboardPlacement === "afterCandidate" ? playDashboard : null}
      <div className={styles.candidateActions}>
        {message.role === "user" && message.status === "completed" ? (
          <button
            type="button"
            data-conversation-action="edit-message-copy"
            disabled={busy || branchPending}
            aria-busy={branchPending}
            onClick={() => actions.editMessage(message)}
          >
            {branchPending ? "正在準備修改副本……" : "修改此訊息（保留原文）"}
          </button>
        ) : null}
        {branchPending ? <span className={styles.emptyNote} role="status">正在準備修改副本，請稍候。</span> : null}
        {canRegenerate ? (
          <button
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => actions.regenerateMessage(message)}
          >
            {busy ? "產生中…" : "重新產生"}
          </button>
        ) : null}
        {message.role === "assistant"
          && message.status === "completed"
          && closedProofStatus === "legacy_v1_unverifiable" ? (
            <span
              className={styles.emptyNote}
              role="status"
              data-conversation-regeneration-disabled-reason="legacy_v1_unverifiable"
            >
              舊候選缺少 RC6.2 完整性記錄，請建立新候選。
            </span>
          ) : null}
        {(["failed", "cancelled"].includes(message.status)) && !retryNeedsAttachment ? <button type="button" onClick={() => actions.retryMessage(retryParent?.content ?? "")}>重試</button> : null}
        {(["failed", "cancelled"].includes(message.status)) && retryNeedsAttachment ? <span className={styles.emptyNote}>請重新附加原檔後再試</span> : null}
      </div>
    </article>
  );
});
