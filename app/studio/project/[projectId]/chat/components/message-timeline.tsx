"use client";

import { useMemo } from "react";
import type {
  ConversationArtifact,
  ConversationAttachment,
  ConversationMessage,
  ConversationToolInvocation,
} from "@/lib/novel-ai/domain";
import { useConversationTimelineWindow } from "../hooks/use-conversation-timeline-window";
import { useConversationApproval } from "../hooks/use-conversation-approval";
import { useConversationAttachments } from "../hooks/use-conversation-attachments";
import { useConversationBranch } from "../hooks/use-conversation-branch";
import type { ConversationMessageActions } from "./conversation-types";
import { MessageRow } from "./message-row";
import { ToolProgressCard } from "./tool-progress-card";
import styles from "../conversation.module.css";

export function MessageTimeline({
  projectId,
  sessionId,
  messages,
  artifacts,
  invocations,
  attachments,
  loading,
  busy,
  canStop,
  progress,
  safeError,
  retryAvailable,
  retryLabel,
  branchPendingMessageIds,
  actions,
  onStarter,
  onRetry,
}: {
  projectId: string;
  sessionId: string;
  messages: ConversationMessage[];
  artifacts: ConversationArtifact[];
  invocations: ConversationToolInvocation[];
  attachments: ConversationAttachment[];
  loading: boolean;
  busy: boolean;
  canStop: boolean;
  progress: string;
  safeError: { code: string; message: string } | null;
  retryAvailable: boolean;
  retryLabel: string;
  branchPendingMessageIds: ReadonlySet<string>;
  actions: ConversationMessageActions;
  onStarter: (starter: string) => void;
  onRetry: () => void;
}) {
  const { artifactsByMessage } = useConversationApproval(artifacts);
  const { attachmentsById } = useConversationAttachments(attachments);
  const { lineageByMessageId } = useConversationBranch(messages);
  const invocationsByMessage = useMemo(() => new Map(
    invocations.map((invocation) => [invocation.messageId, invocation]),
  ), [invocations]);
  const {
    containerRef,
    visibleMessages,
    hiddenMessageCount,
    renderedMessageCount,
    loadEarlier,
    onScroll,
    cancelSessionRestoreForInteraction,
  } = useConversationTimelineWindow({
    projectId,
    sessionId,
    messages,
    updateToken: `${artifacts.length}:${invocations.length}:${busy}:${progress}`,
  });

  return (
    <div
      className={styles.thread}
      aria-live="polite"
      ref={containerRef}
      onScroll={onScroll}
      onWheel={cancelSessionRestoreForInteraction}
      onTouchStart={cancelSessionRestoreForInteraction}
      onPointerDown={cancelSessionRestoreForInteraction}
      onKeyDown={cancelSessionRestoreForInteraction}
      data-testid="conversation-message-timeline"
      data-total-messages={messages.length}
      data-rendered-messages={renderedMessageCount}
    >
      <div className={styles.threadInner}>
        {!messages.length && !loading ? (
          <section className={styles.welcome}>
            <h2>把這部小說當成一個長期專案</h2>
            <p>直接說你要續寫、改寫、建立角色、檢查矛盾、分析檔案，或開始故事回合。AI 只建立候選；按下採用前，正式正文與 RPG 狀態不會改變。</p>
            <div className={styles.starterGrid}>
              {["接續目前章節，寫出一個有後果的新場景。", "檢查目前作品的設定矛盾。", "建立一名能推動主線的新角色。", "開始 RPG 故事回合並給我 A／B／C。"].map((starter) => (
                <button type="button" key={starter} onClick={() => onStarter(starter)}>{starter}</button>
              ))}
            </div>
          </section>
        ) : null}

        {hiddenMessageCount ? (
          <div className={styles.historyWindowNotice} role="status">
            <button type="button" className={styles.quietButton} onClick={loadEarlier}>
              載入較早訊息（尚有 {hiddenMessageCount} 則）
            </button>
          </div>
        ) : null}

        {visibleMessages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            allMessages={messages}
            allInvocations={invocations}
            artifactsByMessage={artifactsByMessage}
            invocationsByMessage={invocationsByMessage}
            attachmentsById={attachmentsById}
            busy={busy}
            canStop={canStop}
            progress={progress}
            branchPending={branchPendingMessageIds.has(message.id)}
            actions={actions}
            lineage={lineageByMessageId.get(message.id) ?? { rootId: message.id, depth: 0 }}
          />
        ))}
        {busy ? <ToolProgressCard progress={progress} canStop={canStop} onStop={actions.stopGeneration} label="停止生成" /> : null}
        {safeError ? <section className={styles.resultCard} role="alert"><strong>{safeError.code}</strong><p>{safeError.message}</p>{retryAvailable ? <button type="button" disabled={busy} onClick={onRetry}>{retryLabel}</button> : null}</section> : null}
        <div data-testid="conversation-timeline-end" />
      </div>
    </div>
  );
}
