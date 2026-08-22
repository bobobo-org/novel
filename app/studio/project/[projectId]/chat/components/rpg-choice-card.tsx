"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { RpgChoiceKey, RpgDisplayChoice } from "./conversation-types";
import styles from "../conversation.module.css";

const RpgAdvancedStatus = dynamic(() => import("./rpg-advanced-status"), {
  loading: () => <span role="status">正在載入進階狀態…</span>,
});

export function RpgChoiceCard({
  choice,
  disabled,
  onChoose,
}: {
  choice: RpgDisplayChoice;
  disabled: boolean;
  onChoose: (key: RpgChoiceKey) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div data-rpg-choice={choice.key}>
      <button
        className={styles.choiceCard}
        type="button"
        aria-label={`選項 ${choice.key}：${choice.title}；${choice.strategyLabel}`}
        title={choice.disabledReason ?? undefined}
        disabled={disabled || Boolean(choice.disabledReason)}
        onClick={() => onChoose(choice.key)}
        data-choice-key={choice.key}
        data-testid={`rpg-choice-${choice.key}`}
      >
        <span className={styles.choiceKey}>{choice.key} · {choice.strategyLabel}</span>
        <h3>{choice.title}</h3>
        <p>{choice.description}</p>
        {choice.disabledReason ? <span role="status">目前不可選：{choice.disabledReason}</span> : null}
      </button>
      <details
        className={styles.evidenceDetails}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary>風險、成本與進階狀態</summary>
        {advancedOpen ? <RpgAdvancedStatus choice={choice} /> : null}
      </details>
    </div>
  );
}
