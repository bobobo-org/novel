"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { resolveCapabilityCatalog, type CapabilityStatus } from "@/lib/novel-ai/capabilities";
import {
  CLOUD_SYNC_STATUS_EVENT,
  getCloudSyncManager,
  type CloudProjectRemoteSummary,
  type CloudSyncManagerSnapshot,
} from "@/lib/novel-ai/cloud-sync";
import { indexedDbCapability } from "@/lib/novel-ai/repository";

type DiagnosticState = {
  supported: boolean;
  usage: number | null;
  quota: number | null;
  journal: string;
  status: CapabilityStatus;
  modelTraining: CapabilityStatus;
  distillation: CapabilityStatus;
};

const CLOUD_STATUS_LABELS: Record<string, string> = {
  disabled: "尚未開啟",
  checking: "正在檢查",
  ready: "可同步",
  syncing: "同步中",
  synced: "已同步",
  offline: "離線，稍後自動重試",
  configuration_required: "雲端環境尚未設定",
  migration_required: "雲端儲存尚未完成",
  conflict: "需要你選擇版本",
  degraded: "暫停，作品仍在本機",
};

const AUTHORITY_LABELS: Record<string, string> = {
  Supabase: "Supabase（版本與雜湊已驗證）",
  PendingSync: "待同步（本機安全佇列）",
  ConflictReview: "版本衝突，等待你確認",
  IndexedDBFallback: "IndexedDB 本機備援",
};

function cloudMessage(error: unknown) {
  const code = String((error as { code?: string })?.code || "");
  const messages: Record<string, string> = {
    CLOUD_SYNC_KEY_INVALID: "復原金鑰格式不正確，沒有變更目前設定。",
    CLOUD_SYNC_CREDENTIAL_BLOCKED: "作品含疑似憑證，已安全停止上傳；請先移除敏感內容。",
    CLOUD_SYNC_PAYLOAD_TOO_LARGE: "作品超過目前單次雲端快照上限，請先下載本機備份。",
    CLOUD_SYNC_REVISION_CONFLICT: "雲端與本機都有更新，請選擇保留本機、套用雲端或另存副本。",
    CLOUD_SYNC_DECRYPT_FAILED: "無法解密；請核對復原金鑰。",
  };
  return messages[code] ?? (error instanceof Error ? error.message : "雲端同步操作失敗。作品仍安全保留在本機。");
}
export default function StorageSettingsClient() {
  const [state, setState] = useState<DiagnosticState>({
    supported: false,
    usage: null,
    quota: null,
    journal: "尚未執行",
    status: "client_dependent",
    modelTraining: "started",
    distillation: "started",
  });
  const [cloud, setCloud] = useState<CloudSyncManagerSnapshot | null>(null);
  const [remoteProjects, setRemoteProjects] = useState<CloudProjectRemoteSummary[]>([]);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [importKey, setImportKey] = useState("");
  const [message, setMessage] = useState("雲端同步採端對端加密；伺服器不會取得作品明文。");
  const [busy, setBusy] = useState("");

  const refresh = useCallback(async () => {
    const manager = getCloudSyncManager();
    setCloud(await manager.snapshot());
  }, []);

  useEffect(() => {
    const manager = getCloudSyncManager();
    const listener = (event: Event) => {
      setCloud((event as CustomEvent<CloudSyncManagerSnapshot>).detail);
    };
    window.addEventListener(CLOUD_SYNC_STATUS_EVENT, listener);
    void (async () => {
      const capability = indexedDbCapability();
      const catalog = resolveCapabilityCatalog({
        "indexedDb.core": capability.supported ? "ready" : "runtime_unavailable",
      });
      const estimate = await navigator.storage?.estimate?.() || {};
      const journal = localStorage.getItem("novel_p2_legacy_migration_journal");
      setState({
        supported: capability.supported,
        usage: estimate.usage ?? null,
        quota: estimate.quota ?? null,
        journal: journal ? "已保留舊資料並完成遷移紀錄" : "等待首次建立或載入作品",
        status: catalog["indexedDb.core"].effectiveStatus,
        modelTraining: catalog.modelTraining.effectiveStatus,
        distillation: catalog.distillation.effectiveStatus,
      });
      await manager.probe();
      await refresh();
    })().catch((error) => setMessage(cloudMessage(error)));
    return () => window.removeEventListener(CLOUD_SYNC_STATUS_EVENT, listener);
  }, [refresh]);

  const run = useCallback(async (name: string, operation: () => Promise<void>) => {
    setBusy(name);
    try {
      await operation();
      await refresh();
    } catch (error) {
      setMessage(cloudMessage(error));
    } finally {
      setBusy("");
    }
  }, [refresh]);

  const enable = () => run("enable", async () => {
    const result = await getCloudSyncManager().enable();
    if (result.recoveryKey) {
      setRecoveryKey(result.recoveryKey);
      setMessage("雲端同步已開啟。請立即保存復原金鑰；遺失後無法解密雲端作品。");
    } else {
      setMessage("雲端同步已開啟，系統會在本機變更後自動排程同步。");
    }
  });

  const syncNow = () => run("sync", async () => {
    await getCloudSyncManager().syncAll();
    setMessage("已完成可用作品的同步檢查；離線或暫時失敗項目會保留在 Outbox 自動重試。");
  });

  const importRecovery = () => run("import", async () => {
    const projects = await getCloudSyncManager().importRecoveryKey(importKey);
    setImportKey("");
    setRemoteProjects(projects);
    setMessage(projects.length
      ? "已連上既有加密空間。為避免覆蓋，本機同名作品會先標示衝突，請逐項選擇。"
      : "已採用復原金鑰；此加密空間目前沒有作品。");
  });

  const loadRemote = () => run("remote", async () => {
    const projects = await getCloudSyncManager().listRemoteProjects();
    setRemoteProjects(projects);
    setMessage(projects.length ? `找到 ${projects.length} 部加密雲端作品。` : "雲端目前沒有作品快照。");
  });

  const copyRecoveryKey = async () => {
    if (!recoveryKey) return;
    await navigator.clipboard.writeText(recoveryKey);
    setMessage("復原金鑰已複製。請保存到可信任的密碼管理器，不要貼到聊天或公開頁面。");
  };

  const conflictProjects = cloud?.projects.filter((project) => project.status === "conflict") ?? [];

  return (
    <main className="p2Settings">
      <header>
        <Link href="/studio">← 返回創作中心</Link>
        <h1>作品儲存與加密雲端同步</h1>
        <p>同步成功且版本／密文雜湊回讀一致時，由 Supabase 保存正式版本；IndexedDB 是本機工作副本與離線 Outbox。內容仍須經使用者核准才會進入 Canon。</p>
      </header>

      <section>
        <h2>本機作品庫</h2>
        <dl>
          <div><dt>本機作品資料庫</dt><dd>{state.supported && state.status === "ready" ? "可用" : "此瀏覽器不支援"}</dd></div>
          <div><dt>已使用空間</dt><dd>{state.usage === null ? "無法取得" : `${Math.round(state.usage / 1024)} KB`}</dd></div>
          <div><dt>可用上限</dt><dd>{state.quota === null ? "由瀏覽器管理" : `${Math.round(state.quota / 1024 / 1024)} MB`}</dd></div>
          <div><dt>舊作品轉換</dt><dd>{state.journal}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="cloud-sync-heading" data-cloud-status={cloud?.status ?? "checking"}>
        <div className="cloudSyncHeading">
          <div>
            <span className="eyebrow">CLOUD-VERIFIED · E2EE</span>
            <h2 id="cloud-sync-heading">雲端同步</h2>
          </div>
          <strong className="cloudSyncBadge">{CLOUD_STATUS_LABELS[cloud?.status ?? "checking"]}</strong>
        </div>
        <dl>
          <div><dt>同步功能</dt><dd>{cloud?.config.enabled ? "已開啟" : "等待你開啟"}</dd></div>
          <div><dt>雲端後端</dt><dd>{cloud?.health ? CLOUD_STATUS_LABELS[cloud.health.status] : "檢查中"}</dd></div>
          <div><dt>待傳 Outbox</dt><dd>{cloud?.outboxCount ?? 0} 筆</dd></div>
          <div><dt>目前資料權威</dt><dd>{AUTHORITY_LABELS[cloud?.canonicalAuthority ?? "IndexedDBFallback"]}</dd></div>
          <div><dt>已驗證雲端作品</dt><dd>{cloud?.verifiedRemoteProjectCount ?? 0} 部</dd></div>
          <div><dt>加密</dt><dd>AES-GCM 256 · 瀏覽器內完成</dd></div>
          <div><dt>不離開裝置</dt><dd>憑證、AUTHOR_ONLY、私人推演與裝置限定資料</dd></div>
        </dl>
        <p className="localAiRunStatus" role="status">{message}</p>
        <div className="localAiActions">
          {!cloud?.config.enabled ? (
            <button type="button" disabled={Boolean(busy)} onClick={enable}>開啟加密雲端同步</button>
          ) : (
            <>
              <button type="button" disabled={Boolean(busy)} onClick={syncNow}>{busy === "sync" ? "同步中…" : "立即同步全部作品"}</button>
              <button type="button" disabled={Boolean(busy)} onClick={loadRemote}>查看雲端作品</button>
              <button type="button" disabled={Boolean(busy)} onClick={() => run("disable", async () => {
                await getCloudSyncManager().disable();
                setMessage("已停止自動同步；本機與既有雲端密文都保留。復原金鑰未刪除。");
              })}>暫停自動同步</button>
            </>
          )}
        </div>

        {recoveryKey ? (
          <div className="cloudRecoveryKey" role="alert">
            <h3>只顯示這次：同步復原金鑰</h3>
            <p>任何取得此金鑰的人都能下載並解密你的同步作品。請保存到密碼管理器。</p>
            <textarea readOnly rows={2} value={recoveryKey} aria-label="雲端同步復原金鑰" />
            <button type="button" onClick={() => void copyRecoveryKey()}>複製到剪貼簿</button>
            <button type="button" onClick={() => setRecoveryKey("")}>我已安全保存</button>
          </div>
        ) : null}

        <details className="cloudImportKey">
          <summary>在另一台裝置接回既有作品</summary>
          <label>
            輸入你自己保存的復原金鑰
            <input type="password" autoComplete="off" value={importKey} onChange={(event) => setImportKey(event.target.value)} placeholder="ncs_…" />
          </label>
          <button type="button" disabled={Boolean(busy) || !importKey.trim()} onClick={importRecovery}>安全連接並先檢查衝突</button>
        </details>
      </section>

      {conflictProjects.length ? (
        <section className="cloudConflicts" aria-labelledby="cloud-conflicts-heading">
          <h2 id="cloud-conflicts-heading">需要你決定的版本</h2>
          <p>系統不會自動覆蓋。每部作品都可以保留本機、套用雲端，或把雲端另存成副本。</p>
          {conflictProjects.map((project) => (
            <article key={project.projectId}>
              <div><b>{project.projectId}</b><small>雲端版本 {project.conflictRemoteRevision ?? project.remoteRevision}</small></div>
              <div className="localAiActions">
                <button type="button" disabled={Boolean(busy)} onClick={() => run(`local:${project.projectId}`, async () => {
                  await getCloudSyncManager().keepLocal(project.projectId);
                  setMessage("已依你的選擇，以本機版本建立新的雲端版本。");
                })}>保留本機</button>
                <button type="button" disabled={Boolean(busy)} onClick={() => run(`remote:${project.projectId}`, async () => {
                  await getCloudSyncManager().pullProject(project.projectId, "replace");
                  setMessage("已先建立安全備份，再套用雲端版本。");
                })}>套用雲端</button>
                <button type="button" disabled={Boolean(busy)} onClick={() => run(`copy:${project.projectId}`, async () => {
                  await getCloudSyncManager().pullProject(project.projectId, "copy");
                  setMessage("雲端版本已另存成新作品，本機原作未變更。");
                })}>雲端另存副本</button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {remoteProjects.length ? (
        <section aria-labelledby="remote-project-heading">
          <h2 id="remote-project-heading">加密雲端作品</h2>
          <div className="cloudRemoteList">
            {remoteProjects.map((project) => (
              <article key={project.projectId}>
                <b>{project.projectId}</b>
                <small>版本 {project.revision} · {Math.max(1, Math.round(project.encryptedBytes / 1024))} KB · {new Date(project.updatedAt).toLocaleString("zh-TW")}</small>
                <button type="button" disabled={Boolean(busy)} onClick={() => run(`pull:${project.projectId}`, async () => {
                  await getCloudSyncManager().pullProject(project.projectId, "copy");
                  setMessage("雲端作品已解密並另存成本機副本。");
                })}>下載為本機副本</button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="capability-truth-heading">
        <h2 id="capability-truth-heading">能力真實狀態</h2>
        <dl>
          <div><dt>模型訓練</dt><dd data-capability-id="modelTraining">{state.modelTraining}</dd></div>
          <div><dt>模型蒸餾</dt><dd data-capability-id="distillation">{state.distillation}</dd></div>
        </dl>
        <p>started 表示已有可驗證訓練執行與候選模型；候選仍須通過評估與獨立核准，才可啟用或推進 Production。</p>
      </section>

      <section>
        <h2>資料安全</h2>
        <p>同步失敗時，新變更會明確標成 PendingSync，不會假裝已提交；舊版資料不會在遷移後立刻刪除。套用雲端前會先建立本機安全備份。</p>
        <Link className="secondaryAction" href="/studio?screen=backup">前往備份中心</Link>
      </section>
    </main>
  );
}
