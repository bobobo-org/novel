"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { detectBrowserAI } from "@/lib/novel-ai/providers/browser-ai/browser-ai-provider";
import { LocalBridgeClient, configureLocalBridgeClient, configureLocalBridgeModel } from "@/lib/novel-ai/providers/local-ollama/local-bridge-client";

type ModelOption = { modelId: string; parameterSize?: { value?: string | null }; quantization?: { value?: string | null }; capabilities?: { textGeneration?: { value?: boolean } } };
type Status = { browser: string; bridge: string; pairing: string; ollama: string; model: string; hub: string; privacy: string; external: boolean; error: string };

const initial: Status = { browser: "檢查中", bridge: "檢查中", pairing: "尚未配對", ollama: "檢查中", model: "尚未選用", hub: "檢查中", privacy: "strict-local", external: false, error: "" };

export default function AISettingsClient() {
  const client = useMemo(() => new LocalBridgeClient({ origin: typeof window === "undefined" ? "http://localhost:3000" : window.location.origin }), []);
  const [status, setStatus] = useState<Status>(initial);
  const [pairingId, setPairingId] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const saved = JSON.parse(localStorage.getItem("novel_p2_ai_settings") || "null") || {};
    const [browser, health, hub] = await Promise.all([
      detectBrowserAI(),
      client.health().catch(() => null),
      fetch("/api/private-ai/health", { cache: "no-store" }).then((response) => response.json()).catch(() => ({ status: "unavailable" })),
    ]);
    setStatus((value) => ({
      ...value,
      browser: browser.status === "runtime_not_installed" ? "裝置可支援，模型尚未安裝" : "目前裝置不支援",
      bridge: health?.bridgeProcessAlive ? "本機橋接服務已啟動" : "本機橋接服務尚未啟動",
      pairing: health?.pairingState === "paired" && client.getSessionMetadata() ? "已配對" : "尚未配對",
      ollama: health?.ollamaReachable ? (health.modelAvailable ? "Ollama 與文字模型可用" : "Ollama 已啟動，尚無文字模型") : "Ollama 尚未啟動",
      hub: hub.status === "ready" ? "已連線" : "尚未連接執行環境",
      privacy: saved.privacy || "strict-local",
      external: Boolean(saved.external),
      error: "",
    }));
  }, [client]);

  useEffect(() => { void refresh(); return () => { configureLocalBridgeClient(null); configureLocalBridgeModel(null); }; }, [refresh]);

  const savePrivacy = (next: Status) => {
    setStatus(next);
    localStorage.setItem("novel_p2_ai_settings", JSON.stringify({ privacy: next.privacy, external: next.external }));
  };

  const requestPairing = async () => {
    setBusy(true); setStatus((value) => ({ ...value, error: "" }));
    try {
      const request = await client.requestPairing();
      setPairingId(String(request.pairingId));
      setStatus((value) => ({ ...value, pairing: "等待輸入本機配對碼" }));
    } catch (error) { setStatus((value) => ({ ...value, error: error instanceof Error ? error.message : "無法要求配對。" })); }
    finally { setBusy(false); }
  };

  const confirmPairing = async () => {
    setBusy(true); setStatus((value) => ({ ...value, error: "" }));
    try {
      await client.confirmPairing(pairingId, pairingCode);
      configureLocalBridgeClient(client);
      const result = await client.models();
      const available = (result.models || []).filter((model: ModelOption) => model.capabilities?.textGeneration?.value === true);
      setModels(available);
      const selected = available[0]?.modelId || "";
      configureLocalBridgeModel(selected || null);
      setStatus((value) => ({ ...value, pairing: "已配對", bridge: "本機橋接服務已啟動", ollama: available.length ? "Ollama 與文字模型可用" : "Ollama 已啟動，尚無文字模型", model: selected || "尚未選用" }));
      setPairingCode("");
    } catch (error) { setStatus((value) => ({ ...value, error: error instanceof Error ? error.message : "配對沒有成功。" })); }
    finally { setBusy(false); }
  };

  const revoke = async () => {
    setBusy(true);
    try { await client.revoke(); configureLocalBridgeClient(null); configureLocalBridgeModel(null); setModels([]); setStatus((value) => ({ ...value, pairing: "已撤銷", model: "尚未選用", error: "" })); }
    catch (error) { setStatus((value) => ({ ...value, error: error instanceof Error ? error.message : "撤銷配對失敗。" })); }
    finally { setBusy(false); }
  };

  return <main className="p2Settings">
    <header><Link href="/studio">← 返回創作中心</Link><h1>AI 使用方式</h1><p>預設只使用本機能力；跨出裝置前一定需要你的同意。</p></header>
    <section><h2>目前可用狀態</h2><dl>
      <div><dt>瀏覽器本機 AI</dt><dd>{status.browser}</dd></div><div><dt>本機橋接服務</dt><dd>{status.bridge}</dd></div><div><dt>安全配對</dt><dd>{status.pairing}</dd></div><div><dt>我的電腦 AI</dt><dd>{status.ollama}</dd></div><div><dt>目前模型</dt><dd>{status.model}</dd></div><div><dt>私有 AI 中樞</dt><dd>{status.hub}</dd></div>
    </dl>{status.error && <p role="alert">{status.error}</p>}<button type="button" disabled={busy} onClick={() => void refresh()}>重新檢查</button></section>
    <section><h2>連接我的電腦 AI</h2><p>先在這台電腦啟動 Local Bridge。配對碼只會顯示在本機 Bridge 視窗，授權不會寫入網址或瀏覽器儲存空間。</p>
      {!pairingId && <button type="button" disabled={busy} onClick={() => void requestPairing()}>開始安全配對</button>}
      {pairingId && status.pairing !== "已配對" && <><label>本機配對碼<input value={pairingCode} inputMode="numeric" autoComplete="off" onChange={(event) => setPairingCode(event.target.value)} /></label><button type="button" disabled={busy || pairingCode.length !== 6} onClick={() => void confirmPairing()}>確認配對</button></>}
      {status.pairing === "已配對" && <button type="button" disabled={busy} onClick={() => void revoke()}>撤銷配對</button>}
      {models.length > 0 && <label>本機模型<select value={status.model} onChange={(event) => { configureLocalBridgeModel(event.target.value); setStatus((value) => ({ ...value, model: event.target.value })); }}>{models.map((model) => <option key={model.modelId} value={model.modelId}>{model.modelId} {model.parameterSize?.value || ""} {model.quantization?.value || ""}</option>)}</select></label>}
    </section>
    <section><h2>隱私模式</h2>
      <label><input type="radio" checked={status.privacy === "strict-local"} onChange={() => savePrivacy({ ...status, privacy: "strict-local", external: false })} /> 完全留在本機</label>
      <label><input type="radio" checked={status.privacy === "private-hub-allowed"} onChange={() => savePrivacy({ ...status, privacy: "private-hub-allowed", external: false })} /> 可使用私有 AI 中樞</label>
      <label><input type="radio" checked={status.privacy === "external-allowed"} onChange={() => savePrivacy({ ...status, privacy: "external-allowed" })} /> 可在確認後使用外部 AI</label>
      <p>即使選擇外部輔助，每次跨越隱私邊界仍需明確同意，不會無聲回退。</p>
    </section>
  </main>;
}
