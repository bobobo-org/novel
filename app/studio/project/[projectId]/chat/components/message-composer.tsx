import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import type { ConversationToolInvocation } from "@/lib/novel-ai/domain";
import type {
  ClosedAiBootstrapProgress,
  ClosedAiBootstrapResult,
} from "@/lib/novel-ai/web/closed-ai-bootstrap-coordinator";
import { BROWSER_WEBLLM_MODELS } from "@/lib/novel-ai/providers/browser-ai/webllm-model-registry";
import {
  EXTERNAL_AI_PROVIDER_IDS,
  EXTERNAL_AI_PROVIDER_LABELS,
  type ExternalAIProviderId,
  type ExternalAIProviderPublicStatus,
  type NovelAIExecutionMode,
} from "@/lib/novel-ai/providers/external/external-provider-contract";
import { useConversationComposer } from "../hooks/use-conversation-composer";
import type {
  ClosedAiSetupLifecycle,
  ClosedAiStartupState,
} from "../hooks/use-closed-ai-bootstrap";
import {
  CHAPTER_CONTINUE_SETUP_REQUIRED_MESSAGE,
  isClosedAiTaskRoutable,
} from "../closed-ai-task-readiness";
import { AttachmentTray } from "./attachment-tray";
import type { LocalAttachment } from "./conversation-types";
import styles from "../conversation.module.css";

export function MessageComposer({
  active,
  projectId,
  busy,
  busyReason,
  busyReasonTestId,
  canStop,
  stopLabel,
  draft,
  localAttachments,
  rightsConfirmed,
  latestInvocation,
  closedAiSetup,
  closedAiSetupProgress,
  closedAiSetupBusy,
  closedAiSetupError,
  closedAiSetupLifecycle,
  closedAiStartupState,
  aiExecutionMode,
  hybridAiSource,
  externalProviderId,
  externalProviderStatuses,
  externalProviderStatusError,
  externalExecutionEnabled,
  externalRunConsent,
  externalSelected,
  externalProviderConfigured,
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
  onAiExecutionModeChange,
  onHybridAiSourceChange,
  onExternalProviderChange,
  onExternalRunConsentChange,
}: {
  active: boolean;
  projectId: string;
  busy: boolean;
  busyReason: string | null;
  busyReasonTestId?: string;
  canStop: boolean;
  stopLabel: string;
  draft: string;
  localAttachments: LocalAttachment[];
  rightsConfirmed: boolean;
  latestInvocation: ConversationToolInvocation | null;
  closedAiSetup: ClosedAiBootstrapResult | null;
  closedAiSetupProgress: ClosedAiBootstrapProgress | null;
  closedAiSetupBusy: boolean;
  closedAiSetupError: string | null;
  closedAiSetupLifecycle: ClosedAiSetupLifecycle;
  closedAiStartupState: ClosedAiStartupState;
  aiExecutionMode: NovelAIExecutionMode;
  hybridAiSource: "closed" | "external";
  externalProviderId: ExternalAIProviderId;
  externalProviderStatuses: ExternalAIProviderPublicStatus[];
  externalProviderStatusError: string | null;
  externalExecutionEnabled: boolean;
  externalRunConsent: boolean;
  externalSelected: boolean;
  externalProviderConfigured: boolean;
  onDraftChange: (value: string) => void;
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onRightsConfirmedChange: (confirmed: boolean) => void;
  onRetryAttachment: (localId: string) => void;
  onRemoveAttachment: (localId: string) => void;
  onToggleArtifacts: () => void;
  onStop: () => void;
  onSend: (onAccepted?: () => void) => void;
  onPrepareClosedAi: () => void;
  onCancelClosedAiSetup: () => void;
  onAiExecutionModeChange: (mode: NovelAIExecutionMode) => void;
  onHybridAiSourceChange: (source: "closed" | "external") => void;
  onExternalProviderChange: (providerId: ExternalAIProviderId) => void;
  onExternalRunConsentChange: (consent: boolean) => void;
}) {
  const [sourceControlsOpen, setSourceControlsOpen] = useState(false);
  const collapseSourceControls = () => setSourceControlsOpen(false);
  const submitRequest = () => {
    // Keep the panel open when validation rejects the request. The workspace
    // invokes this callback only after it has persisted the user message, so a
    // failed or blocked send leaves the source settings visible for repair.
    onSend(collapseSourceControls);
  };
  const externalBlocked = externalSelected && (
    !externalRunConsent
    || localAttachments.length > 0
  );
  const taskRoutable = isClosedAiTaskRoutable(closedAiSetup);
  const effectiveClosedAiStartupState: ClosedAiStartupState =
    closedAiStartupState === "ready" && !taskRoutable
      ? "action_required"
      : closedAiStartupState;
  const closedAiStarting = !externalSelected
    && effectiveClosedAiStartupState === "starting";
  const rulesFallbackReady = !externalSelected
    && effectiveClosedAiStartupState === "timeout_fallback";
  const composer = useConversationComposer({
    active,
    busy,
    draft,
    attachmentCount: localAttachments.length,
    blocked: externalBlocked,
    onSend: submitRequest,
  });
  const selectedModel = BROWSER_WEBLLM_MODELS.find(
    (model) => model.modelId === closedAiSetup?.selectedModelId,
  );
  const showSetup = !externalSelected && effectiveClosedAiStartupState !== "ready";
  const externalSourceStatus = !externalExecutionEnabled
    ? "公開執行未開放"
    : !externalProviderConfigured
      ? "供應商未設定"
      : !externalRunConsent
        ? "等待本次同意"
        : "本次已同意";
  const downloadMegabytes = closedAiSetup
    ? (closedAiSetup.setup.estimatedDownloadBytes / 1_000_000).toFixed(1)
    : "0.0";
  const activeClosedBackend = closedAiSetup?.runtime.plannedBackend
    ?? closedAiSetup?.readiness.activeBackend;
  const activeClosedBackendLabel = activeClosedBackend === "browser-ai"
    ? "Browser AI"
    : activeClosedBackend === "local-ollama"
      ? "本機 Ollama"
      : activeClosedBackend === "private-ai-hub"
        ? "Private AI Hub"
        : "已驗證本機算力";
  const closedAiSourceLabel = effectiveClosedAiStartupState === "ready"
    ? `閉端 AI · 已啟動（${activeClosedBackendLabel}）· 不外傳`
    : effectiveClosedAiStartupState === "starting"
      ? "閉端 AI · 正在連線既有本機算力"
      : effectiveClosedAiStartupState === "timeout_fallback"
        ? "閉端 AI · 連線明確逾時 · 規則後備待命"
      : effectiveClosedAiStartupState === "failed"
        ? "閉端 AI · 自動啟動未完成"
        : "閉端 AI · 需要完成本機準備";
  const closedAiSetupTitle = effectiveClosedAiStartupState === "starting"
    ? "正在啟動閉端 AI"
    : effectiveClosedAiStartupState === "timeout_fallback"
      ? "閉端 AI 連線已明確逾時"
    : effectiveClosedAiStartupState === "failed"
      ? "閉端 AI 自動啟動未完成"
      : closedAiSetup?.status === "unsupported"
        ? "目前沒有可用的閉端算力"
        : closedAiSetupLifecycle === "cancelled"
          ? "自動協調器準備已取消"
          : "完整小說正文尚未可用";
  const closedAiSetupMessage = closedAiSetupError
    ?? closedAiSetupProgress?.message
    ?? (effectiveClosedAiStartupState === "starting"
      ? "正在連接這台電腦上已啟動的閉端 AI，並核對已安裝的 Browser AI。"
      : closedAiSetup?.safeMessage ?? CHAPTER_CONTINUE_SETUP_REQUIRED_MESSAGE);
  return (
    <footer
      className={styles.composerWrap}
      data-testid="conversation-message-composer"
      data-closed-ai-generation-verified-backends={closedAiSetup?.readiness.generationVerifiedBackends ?? 0}
      data-closed-ai-active-backend={closedAiSetup?.readiness.activeBackend ?? "none"}
      data-closed-ai-task-routable={taskRoutable}
      data-closed-ai-planned-backend={closedAiSetup?.runtime.plannedBackend ?? "none"}
      data-latest-closed-ai-executor={latestInvocation?.actualExecutor ?? "none"}
      data-closed-ai-setup-busy={closedAiSetupBusy}
      data-closed-ai-startup-state={effectiveClosedAiStartupState}
      data-closed-ai-rules-fallback-ready={rulesFallbackReady}
      data-closed-ai-external-fallback={closedAiSetup?.readiness.externalFallback ?? false}
      data-closed-ai-silent-external-fallback={closedAiSetup?.readiness.silentExternalFallback ?? false}
      aria-busy={busy || closedAiStarting}
    >
      <div className={styles.composerSettings} data-testid="conversation-composer-settings">
        <section
          className={styles.aiSourceCard}
          data-testid="conversation-ai-source-controls"
          data-open={sourceControlsOpen}
          data-execution-mode={aiExecutionMode}
          data-selected-source={externalSelected ? "external" : "closed"}
          data-external-provider-configured={externalProviderConfigured}
          data-external-execution-enabled={externalExecutionEnabled}
          data-closed-ai-startup-state={effectiveClosedAiStartupState}
        >
        <button
          type="button"
          className={styles.aiSourceSummary}
          data-testid="conversation-ai-source-toggle"
          aria-expanded={sourceControlsOpen}
          aria-controls="conversation-ai-source-controls-panel"
          onClick={() => setSourceControlsOpen((open) => !open)}
        >
          <span className={styles.aiSourceSummaryCopy}>
            <small>AI 執行來源</small>
            <strong>
              {externalSelected
                ? `${EXTERNAL_AI_PROVIDER_LABELS[externalProviderId]} 外來候選 · ${externalSourceStatus}`
                : closedAiSourceLabel}
            </strong>
          </span>
          <span className={styles.aiSourceToggle}>{sourceControlsOpen ? "收合" : "重新設定"}</span>
        </button>
        <div
          id="conversation-ai-source-controls-panel"
          className={styles.aiSourceBody}
          hidden={!sourceControlsOpen}
        >
          <div className={styles.aiSourceHeading}>
            <div>
              <small>候選來源設定</small>
              <strong>{externalSelected ? "外來 AI · 只建立候選" : closedAiSourceLabel}</strong>
            </div>
            <label>
              模式
              <select
                value={aiExecutionMode}
                disabled={busy}
                onChange={(event) => {
                  onAiExecutionModeChange(event.target.value as NovelAIExecutionMode);
                }}
              >
                <option value="closed-only">閉端 AI（預設）</option>
                <option value="hybrid">混合模式（本次選來源）</option>
                <option value="external-only">外來 AI 候選</option>
              </select>
            </label>
          </div>
          {aiExecutionMode === "hybrid" ? (
            <label>
              本次執行來源
              <select
                value={hybridAiSource}
                disabled={busy}
                onChange={(event) => {
                  onHybridAiSourceChange(event.target.value as "closed" | "external");
                }}
              >
                <option value="closed">閉端 AI</option>
                <option value="external">外來 AI</option>
              </select>
            </label>
          ) : null}
          {externalSelected ? (
            <div className={styles.externalAiControls}>
              <label>
                外來供應商
                <select
                  value={externalProviderId}
                  disabled={busy}
                  onChange={(event) => {
                    onExternalProviderChange(event.target.value as ExternalAIProviderId);
                  }}
                >
                  {EXTERNAL_AI_PROVIDER_IDS.map((providerId) => {
                    const status = externalProviderStatuses.find((item) => item.id === providerId);
                    return (
                      <option key={providerId} value={providerId}>
                        {EXTERNAL_AI_PROVIDER_LABELS[providerId]} · {status?.configured ? "已設定" : "未設定"}
                      </option>
                    );
                  })}
                </select>
              </label>
              <p className={styles.externalBoundary} role="status">
                {!externalExecutionEnabled
                  ? "公開外來 AI 執行尚未開放，內容不會送出；RPG 會留下未外送紀錄後改由閉端 AI 最長 360 秒處理，一般要求則停止。"
                  : externalProviderStatusError
                  ?? (externalProviderConfigured
                    ? "接點已設定；RPG 會優先使用這個外來 AI。若呼叫失敗或正文無效，才交給閉端 AI 最長 360 秒，必要時再進入獨立 360 秒隱藏複核。"
                    : "此供應商尚未在伺服器設定；RPG 會留下未外送的真實失敗紀錄，再交給閉端 AI 最長 360 秒。瀏覽器不會顯示或保存 API 金鑰。")}
              </p>
              <label className={styles.externalConsent}>
                <input
                  type="checkbox"
                  checked={externalRunConsent}
                  disabled={busy || localAttachments.length > 0}
                  onChange={(event) => {
                    onExternalRunConsentChange(event.target.checked);
                  }}
                />
                <span>
                  我逐次同意把本次內容送到 {EXTERNAL_AI_PROVIDER_LABELS[externalProviderId]}。一般要求只送上方訊息欄目前的 {draft.trim().length.toLocaleString("zh-TW")} 字；若是 RPG 回合，最多另送最近章節尾 3,600 字、所選行動、12 名公開角色摘要、16 條公開關係、12 條世界規則、10 條非秘密 Lore、10 條時間線與 10 條未解伏筆。附件、API 金鑰、privateSecrets、隱藏動機與完整作品永不外送；同意只綁本專案、本次請求、這個供應商與內容摘要，使用一次或逾時即清除。
                </span>
              </label>
              {localAttachments.length > 0 ? (
                <p className={styles.externalBoundary}>附件維持本機分析邊界；若要使用外來 AI，請先移除附件。</p>
              ) : null}
            </div>
          ) : (
            <p className={styles.externalBoundary}>閉端 AI 保持預設；失敗時不會靜默轉送任何外來供應商。</p>
          )}
        </div>
        </section>
        {showSetup ? (
          <section
            className={styles.closedAiSetupCard}
            data-testid="closed-ai-setup-card"
            data-status="setup_required"
            data-startup-state={effectiveClosedAiStartupState}
            data-rules-fallback-ready={rulesFallbackReady}
            data-setup-lifecycle={closedAiSetupLifecycle}
            data-estimated-download-bytes={closedAiSetup?.setup.estimatedDownloadBytes ?? 0}
            aria-busy={closedAiSetupBusy || closedAiStarting}
          >
          <div>
            <small>第一次使用 · 閉端 AI 自動協調器</small>
            <h2>{closedAiSetupTitle}</h2>
            <p>{closedAiSetupMessage}</p>
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
            {closedAiSetupBusy
              ? closedAiSetupLifecycle === "preparing"
                ? <button type="button" onClick={onCancelClosedAiSetup}>取消準備</button>
                : null
              : effectiveClosedAiStartupState !== "starting"
                && closedAiSetup?.status !== "unsupported"
                ? <button
                    className={styles.primaryAction}
                    type="button"
                    data-testid="closed-ai-prepare-browser"
                    onClick={onPrepareClosedAi}
                  >{effectiveClosedAiStartupState === "failed"
                    || effectiveClosedAiStartupState === "timeout_fallback"
                    ? "重新連線本機閉端 AI"
                    : "準備 Browser AI"}</button>
                : null}
            <Link prefetch={false} href={`/studio/project/${encodeURIComponent(projectId)}/closed-ai`}>
              自動協調器設定
            </Link>
          </div>
          <p className={styles.closedAiSetupTruth}>
            網站只會連線這台電腦上已啟動的 Novel Local AI Companion 與 Ollama，不能自行啟動或安裝 Ollama。Browser AI 模型也不會自動下載；只有你按下「準備 Browser AI」後，系統才會在本裝置下載並驗證。服務不存在或一般啟動失敗時不會自動開啟後備；自動規則後備只有在連線明確逾時後才會以獨立標示的待命狀態出現。你仍可明確選擇提早改用規則後備，兩者都不會冒充閉端 AI 成功。
          </p>
          </section>
        ) : null}
      </div>
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
            {canStop ? <button className={styles.quietButton} type="button" onClick={onStop} aria-label={`停止生成：${stopLabel}`}>{stopLabel}</button> : null}
            <button className={styles.sendButton} type="button" onClick={composer.submit} disabled={!composer.canSend}>送出</button>
          </div>
        </div>
      </div>
      {busyReason ? (
        <p className={styles.emptyNote} role="status" data-testid={busyReasonTestId}>
          {busyReason}
        </p>
      ) : null}
      <div className={styles.composerMeta}>
        <span>Enter 送出 · Shift＋Enter 換行</span>
        <span>·</span>
        <span className={styles.localBadge}>
          {externalSelected ? `${EXTERNAL_AI_PROVIDER_LABELS[externalProviderId]} 外來候選` : closedAiSourceLabel}{busy ? " · 協調中" : ""}
          {` · 資料${latestInvocation?.dataLeftDevice ? "已" : "未"}離開裝置`}
        </span>
      </div>
    </footer>
  );
}
