import type { ReactNode } from "react";
import { rpgChoiceSelectionDisabled } from "./conversation-presentation";
import type { ParsedRpgChoices, RpgChoiceKey } from "./conversation-types";
import { RpgChoiceCard } from "./rpg-choice-card";
import styles from "../conversation.module.css";

export function RpgTurnCard({
  parsed,
  messageId,
  busy,
  consumed,
  abandoned,
  closedReviewRequired,
  closedAiReady,
  dashboard,
  onChoose,
}: {
  parsed: ParsedRpgChoices;
  messageId: string;
  busy: boolean;
  consumed: boolean;
  abandoned: boolean;
  closedReviewRequired: boolean;
  closedAiReady: boolean;
  dashboard: ReactNode;
  onChoose: (key: RpgChoiceKey) => void;
}) {
  const selectionDisabled = rpgChoiceSelectionDisabled({
    busy,
    consumed,
    abandoned,
    hasEnvelope: Boolean(parsed.envelope),
    closedReviewRequired,
    closedAiReady,
  });
  return (
    <section className={styles.turnDecision} data-testid="rpg-turn-decision">
      {dashboard}
      <header className={styles.turnDecisionHeading}>
        <div><small>NEXT TURN · 下一輪</small><h2>下一步抉擇</h2></div>
        <p>三條路線都會推進故事，但策略、收益、代價與風險不同。</p>
      </header>
      <div
        className={styles.choices}
        data-testid="rpg-inline-choices"
        data-message-id={messageId}
        role="group"
        aria-label="下一步三條故事路線"
      >
        {parsed.choices.map((choice) => (
          <RpgChoiceCard
            key={choice.key}
            choice={choice}
            disabled={selectionDisabled}
            onChoose={onChoose}
          />
        ))}
      </div>
      {consumed ? <p className={styles.emptyNote}>這張選擇卡已建立回合；請採用或放棄目前候選。</p> : null}
      {abandoned ? <p className={styles.emptyNote}>作品版本已變更；這張舊選擇卡已封存，請重新建立三選一。</p> : null}
      {closedReviewRequired ? (
        <p className={styles.emptyNote} role="status" data-testid="rpg-closed-review-status">
          {closedAiReady
            ? "舊版規則後備候選已放棄；閉端 AI 已就緒，可以回到原三選一重新選擇。"
            : "舊版規則後備候選已放棄，但閉端 AI 尚在準備；原三選一會先維持等待，就緒後才可重新選擇。"}
        </p>
      ) : null}
    </section>
  );
}
