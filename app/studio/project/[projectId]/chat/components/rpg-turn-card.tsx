import type { ParsedRpgChoices, RpgChoiceKey } from "./conversation-types";
import { RpgChoiceCard } from "./rpg-choice-card";
import styles from "../conversation.module.css";

export function RpgTurnCard({
  parsed,
  messageId,
  busy,
  consumed,
  onChoose,
}: {
  parsed: ParsedRpgChoices;
  messageId: string;
  busy: boolean;
  consumed: boolean;
  onChoose: (key: RpgChoiceKey) => void;
}) {
  return (
    <>
      <div className={styles.choices} data-testid="rpg-inline-choices" data-message-id={messageId}>
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
    </>
  );
}
