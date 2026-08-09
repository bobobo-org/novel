import styles from "../conversation.module.css";

export function ToolProgressCard({
  progress,
  canStop,
  onStop,
  label = "停止",
}: {
  progress: string;
  canStop: boolean;
  onStop: () => void;
  label?: string;
}) {
  return (
    <div className={styles.progressCard} role="status">
      <span className={styles.pulse} />
      <span>{progress}</span>
      {canStop ? <button className={styles.quietButton} type="button" onClick={onStop}>{label}</button> : null}
    </div>
  );
}
