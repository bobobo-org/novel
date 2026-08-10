"use client";

import type { PersistenceFailure } from "@/lib/novel-ai/repository/persistence-recovery";

export default function PersistenceRecoveryNotice({
  failure,
  onRetry,
  retrying = false,
}: {
  failure: PersistenceFailure;
  onRetry: () => void | Promise<void>;
  retrying?: boolean;
}) {
  return (
    <section
      className="persistenceRecoveryNotice"
      role="alert"
      data-testid="indexeddb-recovery"
      data-persistence-backend={failure.backend}
      data-degraded="true"
      data-memory-fallback="false"
      data-database-error-code={failure.databaseErrorCode}
      data-fallback-reason={failure.fallbackReason}
      data-schema-version={failure.schemaVersion}
      data-migration-version={failure.migrationVersion}
      data-reason-code={failure.reasonCode}
      data-recovery-action={failure.recoveryAction}
    >
      <strong>本機作品庫已安全停止</strong>
      <p>{failure.userMessage}</p>
      <details>
        <summary>技術細節</summary>
        <dl>
          <div><dt>databaseErrorCode</dt><dd><code>{failure.databaseErrorCode}</code></dd></div>
          <div><dt>fallbackReason</dt><dd><code>{failure.fallbackReason}</code></dd></div>
          <div><dt>schemaVersion</dt><dd><code>{failure.schemaVersion}</code></dd></div>
          <div><dt>migrationVersion</dt><dd><code>{failure.migrationVersion}</code></dd></div>
        </dl>
      </details>
      <p>系統沒有建立 memory 替代庫，也沒有覆寫既有作品。</p>
      <div>
        <button type="button" disabled={retrying} onClick={() => void onRetry()}>
          {retrying ? "正在重新檢查…" : "重新檢查 IndexedDB"}
        </button>
        <button type="button" onClick={() => window.location.reload()}>
          安全重新載入
        </button>
      </div>
    </section>
  );
}
