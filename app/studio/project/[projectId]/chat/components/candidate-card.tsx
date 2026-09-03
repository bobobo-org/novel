import type {
  ConversationArtifact,
  ConversationMessage,
  ConversationToolInvocation,
} from "@/lib/novel-ai/domain";
import {
  artifactStory,
  parseRpgCandidate,
  rpgCandidateApprovalState,
  rpgCandidateRequiresClosedReview,
} from "./conversation-presentation";
import type { ArtifactView } from "./conversation-types";
import { ApprovalCard } from "./approval-card";
import styles from "../conversation.module.css";

export function CandidateCard({
  artifact,
  sourceMessage,
  busy,
  canRegenerate,
  invocations,
  closedAiReady,
  hasComparableCandidate,
  onOpen,
  onApprove,
  onReject,
  onRegenerate,
}: {
  artifact: ConversationArtifact;
  sourceMessage: ConversationMessage;
  busy: boolean;
  canRegenerate: boolean;
  invocations: readonly ConversationToolInvocation[];
  closedAiReady: boolean;
  hasComparableCandidate: boolean;
  onOpen: (artifact: ConversationArtifact, view: ArtifactView) => void;
  onApprove: (artifact: ConversationArtifact) => void;
  onReject: (artifact: ConversationArtifact) => void;
  onRegenerate: (message: ConversationMessage) => void;
}) {
  const rpgCandidate = parseRpgCandidate(artifact);
  const rpgApprovalState = artifact.status === "candidate"
    ? rpgCandidateApprovalState(artifact, invocations)
    : "ready";
  const receiptSettling = Boolean(rpgCandidate) && (
    rpgApprovalState === "settling"
    || sourceMessage.status !== "completed"
  );
  const closedReviewRequired = rpgApprovalState === "closed_review_required"
    && rpgCandidateRequiresClosedReview(artifact, invocations);
  const statusLabel = artifact.status === "candidate"
    ? artifact.targetStore === "none"
      ? "參考候選（不寫入 Canon）"
      : receiptSettling
        ? "候選已保存，等待完成本機收據"
      : closedReviewRequired
        ? "等待閉端 AI 複核"
        : "等待你核准"
    : artifact.status === "approved"
      ? "已核准並同步"
      : artifact.status;
  return (
    <section className={styles.candidateCard} key={artifact.id} data-status={artifact.status} data-artifact-id={artifact.id} data-artifact-type={artifact.artifactType}>
      <h3>{artifact.artifactType === "rpg"
        ? "本回合結果"
        : artifact.targetStore === "none"
          ? "意見候選"
          : "Canon 候選"} · {statusLabel}</h3>
      {!rpgCandidate ? <p className={styles.candidatePreview}>{artifactStory(artifact)}</p> : null}
      {rpgCandidate ? (
        <details
          className={`${styles.rpgOutcomeSummary} ${styles.outcomeDetails}`}
          aria-label="本回合結果與數值變化"
        >
          <summary>行動結果與數值變化（預設收合）</summary>
          <small>{artifact.status === "approved" ? "正文、狀態與回合收據已同步" : "這些變化在你核准前不會寫入正式故事"}</small>
          <ul>{rpgCandidate.outcomeLines.map((line) => <li key={line}>{line}</li>)}</ul>
        </details>
      ) : null}
      <div className={styles.candidateActions}>
        <button type="button" onClick={() => onOpen(artifact, "candidate")}>查看完整候選</button>
        <button type="button" onClick={() => onOpen(artifact, "diff")}>查看 Diff</button>
        {hasComparableCandidate ? <button type="button" onClick={() => onOpen(artifact, "comparison")}>比較候選</button> : null}
        {!closedReviewRequired && !receiptSettling ? (
          <ApprovalCard
            artifact={artifact}
            sourceMessage={sourceMessage}
            busy={busy}
            canRegenerate={canRegenerate}
            onApprove={onApprove}
            onReject={onReject}
            onRegenerate={onRegenerate}
          />
        ) : null}
        {receiptSettling ? (
          <button
            className={styles.approvalPrimary}
            type="button"
            data-testid="conversation-settle-and-approve-candidate"
            disabled={busy}
            onClick={() => onApprove(artifact)}
          >補完本機收據並核准寫入正文、狀態與收據</button>
        ) : null}
      </div>
      {receiptSettling ? (
        <section
          className={styles.fallbackReviewNotice}
          role="status"
          data-testid="conversation-rpg-candidate-settling"
        >
          <strong>正文候選已安全保存，本機執行收據尚待補完</strong>
          <p>按下補完並核准後，只會重驗既有候選、完成收據並執行一次 Canon 交易；不會重新執行模型。</p>
        </section>
      ) : null}
      {closedReviewRequired ? (
        <section
          className={styles.fallbackReviewNotice}
          role="status"
          data-testid="conversation-rpg-fallback-review-required"
        >
          <strong>這是舊版規則後備候選，尚未經閉端 AI 複核</strong>
          <p>為保護正文與 Canon，這份候選不能核准。你可以安全放棄它，回到原本的三選一重新生成。</p>
          <p>{closedAiReady
            ? "閉端 AI 已就緒；放棄後可立即重新選擇。"
            : "閉端 AI 尚在準備；可先安全放棄，原三選一會等待就緒後才重新開放。"}</p>
          <button type="button" disabled={busy} onClick={() => onReject(artifact)}>
            放棄舊候選，回到原三選一
          </button>
        </section>
      ) : null}
    </section>
  );
}
