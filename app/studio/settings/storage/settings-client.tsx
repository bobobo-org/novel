"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { resolveCapabilityCatalog, type CapabilityStatus } from "@/lib/novel-ai/capabilities";
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

export default function StorageSettingsClient() {
  const [state, setState] = useState<DiagnosticState>({
    supported: false,
    usage: null,
    quota: null,
    journal: "尚未執行",
    status: "client_dependent",
    modelTraining: "not_started",
    distillation: "not_started",
  });

  useEffect(() => {
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
    })();
  }, []);

  return (
    <main className="p2Settings">
      <header>
        <Link href="/studio">← 返回創作中心</Link>
        <h1>作品儲存</h1>
        <p>作品優先保存在這個瀏覽器，建議定期下載備份。</p>
      </header>
      <section>
        <dl>
          <div><dt>本機作品資料庫</dt><dd>{state.supported && state.status === "ready" ? "可用" : "此瀏覽器不支援"}</dd></div>
          <div><dt>已使用空間</dt><dd>{state.usage === null ? "無法取得" : `${Math.round(state.usage / 1024)} KB`}</dd></div>
          <div><dt>可用上限</dt><dd>{state.quota === null ? "由瀏覽器管理" : `${Math.round(state.quota / 1024 / 1024)} MB`}</dd></div>
          <div><dt>舊作品轉換</dt><dd>{state.journal}</dd></div>
        </dl>
      </section>
      <section aria-labelledby="capability-truth-heading">
        <h2 id="capability-truth-heading">能力真實狀態</h2>
        <dl>
          <div><dt>模型訓練</dt><dd data-capability-id="modelTraining">{state.modelTraining}</dd></div>
          <div><dt>模型蒸餾</dt><dd data-capability-id="distillation">{state.distillation}</dd></div>
        </dl>
        <p>not_started 表示已列入架構路線，但產品實作、模型產製與可呼叫 Runtime 均尚未開始。</p>
      </section>
      <section>
        <h2>資料安全</h2>
        <p>舊版瀏覽器資料不會在遷移後立刻刪除。新資料寫入失敗時，原有作品保持不變。</p>
        <Link className="secondaryAction" href="/studio?screen=backup">前往備份中心</Link>
      </section>
    </main>
  );
}
