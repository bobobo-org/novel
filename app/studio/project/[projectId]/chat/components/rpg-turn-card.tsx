import type { ReactNode } from "react";
import type { ParsedRpgChoices, RpgChoiceKey } from "./conversation-types";
import { RpgChoiceCard } from "./rpg-choice-card";
import styles from "../conversation.module.css";

export function RpgTurnCard({
  parsed,
  messageId,
  busy,
  consumed,
  dashboard,
  onChoose,
}: {
  parsed: ParsedRpgChoices;
  messageId: string;
  busy: boolean;
  consumed: boolean;
  dashboard: ReactNode;
  onChoose: (key: RpgChoiceKey) => void;
}) {
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
            disabled={busy || consumed || !parsed.envelope}
            onChoose={onChoose}
          />
        ))}
      </div>
      {consumed ? <p className={styles.emptyNote}>這張選擇卡已建立回合；請採用或放棄目前候選。</p> : null}
    </section>
  );
}
