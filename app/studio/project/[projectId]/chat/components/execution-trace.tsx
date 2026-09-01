import type { ConversationToolInvocation } from "@/lib/novel-ai/domain";
import { buildConversationExecutionTrace } from "./execution-trace-model";
import styles from "../conversation.module.css";

const STAGE_MARK: Record<string, string> = {
  complete: "✓",
  active: "…",
  used: "↳",
  skipped: "—",
  failed: "!",
};

export function ConversationExecutionTrace({
  invocations,
}: {
  invocations: readonly ConversationToolInvocation[];
}) {
  const trace = buildConversationExecutionTrace(invocations);
  if (!trace) return null;

  return (
    <section
      className={styles.executionTrace}
      aria-label="本回合閉端執行路徑"
      data-testid="conversation-execution-trace"
      data-trace-state={trace.invocation.status}
    >
      <header className={styles.executionTraceHeading}>
        <div><small>本回合執行路徑</small><strong>{trace.summary}</strong></div>
        <span data-state={trace.invocation.status}>{trace.badge}</span>
      </header>
      <ol className={styles.executionTraceStages}>
        {trace.stages.map((stage) => (
          <li key={stage.id} data-state={stage.state} data-stage={stage.id}>
            <span aria-hidden="true">{STAGE_MARK[stage.state]}</span>
            <div><b>{stage.label}</b><small>{stage.description}</small></div>
          </li>
        ))}
      </ol>
      <details className={styles.executionTraceDetails}>
        <summary>查看本機技術收據</summary>
        <dl>
          <div><dt>實際運算</dt><dd>{trace.executorLabel}</dd></div>
          <div><dt>模型／引擎</dt><dd>{trace.modelLabel}</dd></div>
          <div><dt>資料邊界</dt><dd>{trace.boundaryLabel}</dd></div>
          <div><dt>正式故事</dt><dd>{trace.canonLabel}</dd></div>
        </dl>
      </details>
    </section>
  );
}
