import type { ConversationArtifact, ConversationMessage } from "@/lib/novel-ai/domain";
import { artifactStory, parseRpgCandidate } from "./conversation-presentation";
import type { ArtifactView } from "./conversation-types";
import { ApprovalCard } from "./approval-card";
import styles from "../conversation.module.css";

export function CandidateCard({
  artifact,
  sourceMessage,
  busy,
  canRegenerate,
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
  hasComparableCandidate: boolean;
  onOpen: (artifact: ConversationArtifact, view: ArtifactView) => void;
  onApprove: (artifact: ConversationArtifact) => void;
  onReject: (artifact: ConversationArtifact) => void;
  onRegenerate: (message: ConversationMessage) => void;
}) {
  const rpgCandidate = parseRpgCandidate(artifact);
  return (
    <section className={styles.candidateCard} key={artifact.id} data-status={artifact.status} data-artifact-id={artifact.id}>
      <h3>{artifact.artifactType === "rpg" ? "故事回合候選" : "Canon 候選"} · {artifact.status === "candidate" ? "等待採用" : artifact.status}</h3>
      <p className={styles.candidatePreview}>{artifactStory(artifact)}</p>
      {rpgCandidate ? (
        <details className={styles.outcomeDetails}>
          <summary>行動結果與數值變化（預設收合）</summary>
          <ul>{rpgCandidate.outcomeLines.map((line) => <li key={line}>{line}</li>)}</ul>
        </details>
      ) : null}
      <div className={styles.candidateActions}>
        <button type="button" onClick={() => onOpen(artifact, "candidate")}>查看完整候選</button>
        <button type="button" onClick={() => onOpen(artifact, "diff")}>查看 Diff</button>
        {hasComparableCandidate ? <button type="button" onClick={() => onOpen(artifact, "comparison")}>比較候選</button> : null}
        <ApprovalCard
          artifact={artifact}
          sourceMessage={sourceMessage}
          busy={busy}
          canRegenerate={canRegenerate}
          onApprove={onApprove}
          onReject={onReject}
          onRegenerate={onRegenerate}
        />
      </div>
    </section>
  );
}
