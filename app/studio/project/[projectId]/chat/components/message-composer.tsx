import Link from "next/link";
import type { ChangeEvent } from "react";
import type { ConversationToolInvocation } from "@/lib/novel-ai/domain";
import type {
  ClosedAiBootstrapProgress,
  ClosedAiBootstrapResult,
} from "@/lib/novel-ai/web/closed-ai-bootstrap-coordinator";
import { BROWSER_WEBLLM_MODELS } from "@/lib/novel-ai/providers/browser-ai/webllm-model-registry";
import { useConversationComposer } from "../hooks/use-conversation-composer";
import type { ClosedAiSetupLifecycle } from "../hooks/use-closed-ai-bootstrap";
import { AttachmentTray } from "./attachment-tray";
import type { LocalAttachment } from "./conversation-types";
import styles from "../conversation.module.css";

export function MessageComposer({
  active,
  projectId,
  busy,
  busyReason,
  canStop,
  draft,
  localAttachments,
  rightsConfirmed,
  latestInvocation,
  closedAiSetup,
  closedAiSetupProgress,
  closedAiSetupBusy,
  closedAiSetupError,
  closedAiSetupLifecycle,
  onDraftChange,
  onFilesSelected,
  onRightsConfirmedChange,
  onRetryAttachment,
  onRemoveAttachment,
  onToggleArtifacts,
  onStop,
  onSend,
  onPrepareClosedAi,
  onCancelClosedAiSetup,
}: {
  active: boolean;
  projectId: string;
  busy: boolean;
  busyReason: string | null;
  canStop: boolean;
  draft: string;
  localAttachments: LocalAttachment[];
  rightsConfirmed: boolean;
  latestInvocation: ConversationToolInvocation | null;
  closedAiSetup: ClosedAiBootstrapResult | null;
  closedAiSetupProgress: ClosedAiBootstrapProgress | null;
  closedAiSetupBusy: boolean;
  closedAiSetupError: string | null;
  closedAiSetupLifecycle: ClosedAiSetupLifecycle;
  onDraftChange: (value: string) => void;
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onRightsConfirmedChange: (confirmed: boolean) => void;
  onRetryAttachment: (localId: string) => void;
  onRemoveAttachment: (localId: string) => void;
  onToggleArtifacts: () => void;
  onStop: () => void;
  onSend: () => void;
  onPrepareClosedAi: () => void;
  onCancelClosedAiSetup: () => void;
}) {
  const composer = useConversationComposer({
    active,
    busy,
    draft,
    attachmentCount: localAttachments.length,
    onSend,
  });
  const selectedModel = BROWSER_WEBLLM_MODELS.find(
    (model) => model.modelId === closedAiSetup?.selectedModelId,
  );
  const showSetup = Boolean(
    closedAiSetup
    && closedAiSetup.status !== "ready",
  );
  const downloadMegabytes = closedAiSetup
    ? (closedAiSetup.setup.estimatedDownloadBytes / 1_000_000).toFixed(1)
    : "0.0";
  return (
    <footer
      className={styles.composerWrap}
      data-testid="conversation-message-composer"
      data-closed-ai-generation-verified-backends={closedAiSetup?.readiness.generationVerifiedBackends ?? 0}
      data-closed-ai-active-backend={closedAiSetup?.readiness.activeBackend ?? "none"}
      data-latest-closed-ai-executor={latestInvocation?.actualExecutor ?? "none"}
      data-closed-ai-setup-busy={closedAiSetupBusy}
      data-closed-ai-external-fallback={closedAiSetup?.readiness.externalFallback ?? false}
      data-closed-ai-silent-external-fallback={closedAiSetup?.readiness.silentExternalFallback ?? false}
      aria-busy={busy}
    >
      {showSetup ? (
        <section
          className={styles.closedAiSetupCard}
          data-testid="closed-ai-setup-card"
          data-status={closedAiSetup?.status}
          data-setup-lifecycle={closedAiSetupLifecycle}
          data-estimated-download-bytes={closedAiSetup?.setup.estimatedDownloadBytes ?? 0}
          aria-busy={closedAiSetupBusy}
        >
          <div>
            <small>第一次使用 · 閉端 AI 自動協調器</small>
            <h2>{closedAiSetup?.status === "unsupported"
              ? "目前沒有可用的閉端算力"
              : closedAiSetupLifecycle === "cancelled"
                ? "自動協調器準備已取消"
              : closedAiSetupBusy
                ? "正在準備自動協調器"
                : "準備閉端 AI 自動協調器"}</h2>
            <p>{closedAiSetupError
              ?? closedAiSetupProgress?.message
              ?? closedAiSetup?.safeMessage}</p>
          </div>
          {selectedModel ? (
            <dl className={styles.closedAiSetupFacts}>
              <div><dt>模型</dt><dd>{selectedModel.displayName}</dd></div>
              <div><dt>需要空間</dt><dd>約 {downloadMegabytes} MB 本機儲存（十進位 MB）</dd></div>
              <div><dt>執行位置</dt><dd>此瀏覽器／此裝置</dd></div>
              <div><dt>作品資料</dt><dd>不離開裝置</dd></div>
            </dl>
          ) : null}
          <div className={styles.closedAiSetupActions}>
            {closedAiSetup?.status !== "unsupported" ? (
              closedAiSetupBusy
                ? <button type="button" onClick={onCancelClosedAiSetup}>取消準備</button>
                : <button
                    className={styles.primaryAction}
                    type="button"
                    data-testid="closed-ai-prepare-browser"
                    onClick={onPrepareClosedAi}
                  >{closedAiSetupError ? "重試自動協調器" : "準備自動協調器"}</button>
            ) : null}
            <Link href={`/studio/project/${encodeURIComponent(projectId)}/closed-ai`}>
              自動協調器設定
            </Link>
          </div>
          <p className={styles.closedAiSetupTruth}>
            系統會自動核對現有的本機與私有算力，依目前任務選出已驗證資源。若需要在此裝置下載模型，只會在你按下準備後開始；不會改用外部 AI 或規則模板冒充。
          </p>
        </section>
      ) : null}
      <div className={styles.composer}>
        <AttachmentTray
          attachments={localAttachments}
          busy={busy}
          rightsConfirmed={rightsConfirmed}
          onRightsConfirmedChange={onRightsConfirmedChange}
          onRetry={onRetryAttachment}
          onRemove={onRemoveAttachment}
        />
        <textarea value={draft} disabled={busy || !active} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={composer.onKeyDown} placeholder="直接說你想對這部小說做什麼……" aria-label="小說專案訊息" />
        <div className={styles.composerActions}>
          <div className={styles.leftActions}>
            <label className={styles.quietButton} title="附加本機檔案">＋ 檔案<input className={styles.fileInput} type="file" multiple accept=".txt,.md,.markdown,.html,.htm,.json,.pdf,.docx" onChange={onFilesSelected} disabled={busy} /></label>
            <button className={styles.quietButton} type="button" onClick={onToggleArtifacts}>結果</button>
          </div>
          <div className={styles.rightActions}>
            {canStop ? <button className={styles.quietButton} type="button" onClick={onStop}>停止</button> : null}
            <button className={styles.sendButton} type="button" onClick={composer.submit} disabled={!composer.canSend}>送出</button>
          </div>
        </div>
      </div>
      {busyReason ? <p className={styles.emptyNote} role="status">{busyReason}</p> : null}
      <div className={styles.composerMeta}>
        <span>Enter 送出 · Shift＋Enter 換行</span>
        <span>·</span>
        <span className={styles.localBadge}>
          閉端 AI 自動協調器{busy ? " · 協調中" : ""}
          {` · 資料${latestInvocation?.dataLeftDevice ? "已" : "未"}離開裝置`}
        </span>
      </div>
    </footer>
  );
}
