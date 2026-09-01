"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import type {
  ConversationArtifact,
  ConversationToolInvocation,
} from "@/lib/novel-ai/domain";
import { isStoryWorkspaceForbiddenCanonicalTarget } from "@/lib/novel-ai/conversation/approval-transaction";
import { artifactStory, rpgCandidateRequiresClosedReview } from "./conversation-presentation";
import type { ArtifactView, DrawerPayload } from "./conversation-types";
import styles from "../conversation.module.css";

const TechnicalEvidencePanel = dynamic(() => import("./technical-evidence-panel"), {
  loading: () => <p className={styles.emptyNote}>正在載入技術證據……</p>,
});

export default function ArtifactDrawer({
  projectId,
  selectedArtifact,
  drawer,
  artifacts,
  artifactView,
  artifactBefore,
  artifactDraft,
  invocations,
  busy,
  onClose,
  onDraftChange,
  onOpenArtifact,
  onApprove,
  onReject,
}: {
  projectId: string;
  selectedArtifact: ConversationArtifact | null;
  drawer: DrawerPayload;
  artifacts: ConversationArtifact[];
  artifactView: ArtifactView;
  artifactBefore: string;
  artifactDraft: string;
  invocations: ConversationToolInvocation[];
  busy: boolean;
  onClose: () => void;
  onDraftChange: (value: string) => void;
  onOpenArtifact: (artifact: ConversationArtifact) => void;
  onApprove: (artifact: ConversationArtifact, editedContent?: string) => void;
  onReject: (artifact: ConversationArtifact) => void;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const selectedArtifactInvocations = selectedArtifact
    ? invocations.filter((invocation) => invocation.messageId === selectedArtifact.sourceMessageId)
    : [];
  const canonMutationForbidden = isStoryWorkspaceForbiddenCanonicalTarget(selectedArtifact?.targetStore);
  const closedReviewRequired = Boolean(
    selectedArtifact
    && selectedArtifact.status === "candidate"
    && rpgCandidateRequiresClosedReview(selectedArtifact, selectedArtifactInvocations),
  );
  const evidence = selectedArtifact ? {
    candidateDigest: selectedArtifact.candidateDigest,
    sourceRevision: selectedArtifact.sourceRevision,
    targetStore: selectedArtifact.targetStore,
    targetRecordId: selectedArtifact.targetRecordId,
    canonicalMutationCount: selectedArtifact.status === "approved" ? 1 : 0,
    toolInvocations: selectedArtifactInvocations.map((invocation) => ({
      taskId: invocation.taskId,
      toolId: invocation.toolId,
      taskType: invocation.taskType,
      status: invocation.status,
      actualExecutor: invocation.actualExecutor,
      modelId: invocation.modelId,
      modelDigest: invocation.modelDigest,
      inputDigest: invocation.inputDigest,
      contextDigest: invocation.contextDigest,
      executionReceipt: invocation.executionReceipt,
      externalRequest: invocation.externalRequest,
      dataLeftDevice: invocation.dataLeftDevice,
      canonicalMutationCount: invocation.canonicalMutationCount,
      safeErrorCode: invocation.safeErrorCode,
    })),
  } : null;

  return (
    <aside className={styles.artifactDrawer} aria-label="作品結果抽屜" data-testid="conversation-artifact-drawer">
      <header className={styles.artifactHeader}><strong>作品結果</strong><button className={styles.iconButton} type="button" aria-label="關閉作品結果" onClick={onClose}>×</button></header>
      <div className={styles.artifactList}>
        {selectedArtifact ? (
          <section className={styles.drawerCard} data-artifact-id={selectedArtifact.id}>
            <h3>{selectedArtifact.artifactType} · {selectedArtifact.status}</h3>
            {artifactView === "diff" || artifactView === "comparison" ? (
              <div className={styles.diffGrid} data-testid="artifact-diff">
                <section className={styles.diffPane} data-side="before">
                  <h4>{artifactView === "comparison" ? "上一個候選" : "修改前"}</h4>
                  <pre>{artifactBefore || (artifactView === "comparison" ? "（找不到上一個候選）" : "（目前尚無正式內容）")}</pre>
                </section>
                <section className={styles.diffPane} data-side="candidate">
                  <h4>{artifactView === "comparison" ? "新候選" : "候選內容"}</h4>
                  <pre>{artifactDraft || artifactStory(selectedArtifact)}</pre>
                </section>
              </div>
            ) : (
              <textarea className={styles.renameInput} rows={16} value={artifactDraft || artifactStory(selectedArtifact)} disabled={canonMutationForbidden || selectedArtifact.status !== "candidate" || ["rpg", "learning_rule"].includes(selectedArtifact.artifactType)} onChange={(event) => onDraftChange(event.target.value)} />
            )}
            <details className={styles.evidenceDetails} onToggle={(event) => setEvidenceOpen(event.currentTarget.open)}>
              <summary>技術證據</summary>
              {evidenceOpen ? <TechnicalEvidencePanel evidence={evidence} /> : null}
            </details>
            {canonMutationForbidden && selectedArtifact.status === "candidate" ? (
              <p className={styles.emptyNote} role="status" data-testid="story-canon-candidate-blocked">
                這是舊版人物／世界 Canon 候選。故事工作台不能採用；可放棄候選，或回首頁修改正式設定。
              </p>
            ) : null}
            {closedReviewRequired ? (
              <section
                className={styles.fallbackReviewNotice}
                role="status"
                data-testid="conversation-rpg-fallback-review-required"
              >
                <strong>這是舊版規則後備候選，尚未經閉端 AI 複核</strong>
                <p>為保護正文與 Canon，這份候選不能核准。放棄後會回到原本的三選一；閉端 AI 就緒後才能重新選擇。</p>
              </section>
            ) : null}
            {selectedArtifact.status === "candidate" ? (
              <div className={styles.candidateActions}>
                {!canonMutationForbidden && !closedReviewRequired ? <button className={styles.approvalPrimary} type="button" disabled={busy} onClick={() => onApprove(
                    selectedArtifact,
                    ["rpg", "learning_rule"].includes(selectedArtifact.artifactType)
                      ? undefined
                      : artifactDraft || artifactStory(selectedArtifact),
                  )}>{selectedArtifact.artifactType === "rpg"
                      ? "採用回合"
                      : selectedArtifact.artifactType === "learning_rule"
                        ? "採用整份學習規則"
                        : "修改後採用"}</button> : null}
                <button type="button" disabled={busy} onClick={() => onReject(selectedArtifact)}>
                  {closedReviewRequired ? "放棄舊候選，回到原三選一" : "放棄"}
                </button>
              </div>
            ) : null}
          </section>
        ) : drawer?.kind === "status" || drawer?.kind === "attachments" ? (
          <section className={styles.drawerCard}><h3>{drawer.title}</h3><p className={styles.drawerText}>{drawer.content}</p>{drawer.kind === "status" && drawer.title === "回復備份" ? <Link prefetch={false} href={`/studio/project/${encodeURIComponent(projectId)}/backups`}>前往備份工作區</Link> : null}</section>
        ) : artifacts.length ? (
          [...artifacts].reverse().map((artifact) => (
            <button className={styles.drawerCard} type="button" key={artifact.id} data-artifact-id={artifact.id} onClick={() => onOpenArtifact(artifact)}><h3>{artifact.artifactType} · {artifact.status}</h3><p className={styles.candidatePreview}>{artifactStory(artifact)}</p></button>
          ))
        ) : <p className={styles.emptyNote}>候選、Diff、RPG 狀態與附件分析會出現在這裡。</p>}
      </div>
    </aside>
  );
}
