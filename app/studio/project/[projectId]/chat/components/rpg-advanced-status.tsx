import type { RpgDisplayChoice } from "./conversation-types";
import styles from "../conversation.module.css";

export default function RpgAdvancedStatus({ choice }: { choice: RpgDisplayChoice }) {
  return (
    <div data-testid={`rpg-advanced-status-${choice.key}`}>
      <span className={styles.choiceMeta}>風險 {choice.risk}/5 · {choice.displayedChanceBand}</span>
      <span className={styles.choiceMeta}>
        已知成本：{choice.knownCosts.map((cost) => cost.label).join("、") || "無"}
      </span>
      <span className={styles.choiceMeta}>{choice.consequenceTeaser}</span>
      {choice.irreversibleWarning ? <strong>不可逆警告：{choice.irreversibleWarning}</strong> : null}
    </div>
  );
}
