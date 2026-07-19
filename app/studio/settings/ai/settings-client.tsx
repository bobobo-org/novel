"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { detectBrowserAI } from "@/lib/novel-ai/providers/browser-ai/browser-ai-provider";
import { LocalBridgeClient, configureLocalBridgeClient, configureLocalBridgeModel, selectAvailableTextModel, snapshotLocalModelForRequest } from "@/lib/novel-ai/providers/local-ollama/local-bridge-client";
import { LOCAL_MODEL_OUTPUT_UNRELIABLE, taskSystemInstruction, validateStudioTaskOutput } from "@/lib/novel-ai/providers/local-ollama/local-quality-guard";

type ModelOption = { modelId: string; parameterSize?: { value?: string | null }; quantization?: { value?: string | null }; capabilities?: { textGeneration?: { value?: boolean } } };
type Status = { browser: string; bridge: string; pairing: string; ollama: string; model: string; hub: string; privacy: string; external: boolean; error: string };
type GenerationStatus = "idle" | "generating" | "cancelling" | "completed" | "cancelled" | "failed";

const taskOptions = [
  ["summary", "繁體中文摘要"], ["rewrite", "繁體中文改寫"], ["character.extract", "角色資料整理"], ["story.choices", "產生三個劇情選項"],
  ["scene.continue", "短場景續寫"], ["story-bible.continue", "依故事設定續寫"], ["continuity.review", "角色一致性檢查"], ["timeline.review", "時間線矛盾辨識"],
] as const;

const errorGuidance: Record<string, string> = {
  BRIDGE_NOT_PAIRED: "配對已失效，請重新進行安全配對。",
  BRIDGE_PAIRING_EXPIRED: "配對已過期，請重新發起配對。",
  BRIDGE_PAIRING_REVOKED: "配對已撤銷，請重新配對後再試。",
  BRIDGE_PROTOCOL_INCOMPATIBLE: "Studio 與本機橋接服務版本不相容，請更新較舊的一方後重新啟動。",
  OLLAMA_UNREACHABLE: "Ollama 尚未啟動，請啟動後按下重新檢查。",
  OLLAMA_MODEL_NOT_FOUND: "目前選定模型已不存在，請重新讀取並選擇已安裝模型。",
  OLLAMA_MODEL_LOAD_FAILED: "模型載入失敗，請確認記憶體是否足夠，或改選較小模型。",
  OLLAMA_TIMEOUT: "本機 AI 未在時間內完成。你可以縮短內容、延長執行上限後重試。",
  OLLAMA_CANCELLED: "本次生成已取消，可以修改內容後重新送出。",
  LOCAL_CONCURRENCY_LIMIT: "本機 AI 正在處理其他工作，請稍候再試。",
  LOCAL_DUPLICATE_REQUEST: "這個要求已送出，系統已阻止重複生成。",
  LOCAL_MODEL_OUTPUT_UNRELIABLE: "本機模型的結果缺少可驗證證據，這次內容不會進入正式資料。請縮短原文或重新嘗試。",
};

const initial: Status = { browser: "檢查中", bridge: "檢查中", pairing: "尚未配對", ollama: "檢查中", model: "尚未選用", hub: "檢查中", privacy: "strict-local", external: false, error: "" };

export default function AISettingsClient() {
  const client = useMemo(() => new LocalBridgeClient({ origin: typeof window === "undefined" ? "http://localhost:3000" : window.location.origin }), []);
  const [status, setStatus] = useState<Status>(initial);
  const [pairingId, setPairingId] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [taskType, setTaskType] = useState("rewrite");
  const [prompt, setPrompt] = useState("請將這句話改寫得更有場景感：林昭推開圖書館的門，發現帳冊不見了。");
  const [output, setOutput] = useState("");
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>("idle");
  const [requestId, setRequestId] = useState("");
  const [activeModel, setActiveModel] = useState("");
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null);
  const [timeoutMs, setTimeoutMs] = useState(60_000);
  const generationController = useRef<AbortController | null>(null);
  const firstTokenSeen = useRef(false);

  const refresh = useCallback(async () => {
    const saved = JSON.parse(localStorage.getItem("novel_p2_ai_settings") || "null") || {};
    let healthError: unknown = null;
    const [browser, health, hub] = await Promise.all([
      detectBrowserAI(),
      client.health().catch((error) => { healthError = error; return null; }),
      fetch("/api/private-ai/health", { cache: "no-store" }).then((response) => response.json()).catch(() => ({ status: "unavailable" })),
    ]);
    const healthErrorCode = String((healthError as { code?: string })?.code || "");
    let refreshedModel = "";
    let modelError = "";
    if (health?.pairingState === "paired" && client.getSessionMetadata()) {
      try {
        const result = await client.models();
        const available = (result.models || []).filter((model: ModelOption) => model.capabilities?.textGeneration?.value === true);
        setModels(available);
        const savedModel = localStorage.getItem("novel_local_ai_model") || "";
        refreshedModel = selectAvailableTextModel(available, savedModel) || "";
        if (savedModel && savedModel !== refreshedModel) modelError = "原本選用的模型已不存在，請確認目前模型後再開始生成。";
        configureLocalBridgeClient(client);
        configureLocalBridgeModel(refreshedModel || null);
        if (refreshedModel) localStorage.setItem("novel_local_ai_model", refreshedModel);
      } catch (error) {
        const code = String((error as { code?: string })?.code || "");
        modelError = errorGuidance[code] || "目前無法讀取本機模型，請重新檢查 Ollama。";
      }
    }
    setStatus((value) => ({
      ...value,
      browser: browser.status === "runtime_not_installed" ? "裝置可支援，模型尚未安裝" : "目前裝置不支援",
      bridge: health?.bridgeProcessAlive ? "本機橋接服務已啟動" : "本機橋接服務尚未啟動",
      pairing: health?.pairingState === "paired" && client.getSessionMetadata() ? "已配對" : health?.pairingState === "paired" ? "頁面已重新載入，請重新配對" : "尚未配對",
      ollama: health?.ollamaReachable ? (health.modelAvailable ? "Ollama 與文字模型可用" : "Ollama 已啟動，尚無文字模型") : "Ollama 尚未啟動",
      model: refreshedModel || (health?.pairingState === "paired" ? value.model : "尚未選用"),
      hub: hub.status === "ready" ? "已連線" : "尚未連接執行環境",
      privacy: saved.privacy || "strict-local",
      external: Boolean(saved.external),
      error: healthErrorCode ? (errorGuidance[healthErrorCode] || "本機橋接服務目前無法連線，請確認服務已啟動後再試一次。") : modelError,
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
      const savedModel = localStorage.getItem("novel_local_ai_model") || "";
      const selected = selectAvailableTextModel(available, savedModel) || "";
      configureLocalBridgeModel(selected || null);
      if (selected) localStorage.setItem("novel_local_ai_model", selected);
      setStatus((value) => ({ ...value, pairing: "已配對", bridge: "本機橋接服務已啟動", ollama: available.length ? "Ollama 與文字模型可用" : "Ollama 已啟動，尚無文字模型", model: selected || "尚未選用" }));
      setPairingCode("");
    } catch (error) { setStatus((value) => ({ ...value, error: error instanceof Error ? error.message : "配對沒有成功。" })); }
    finally { setBusy(false); }
  };

  const revoke = async () => {
    setBusy(true);
    try { await client.revoke(); configureLocalBridgeClient(null); configureLocalBridgeModel(null); setPairingId(""); setPairingCode(""); setModels([]); setStatus((value) => ({ ...value, pairing: "已撤銷", model: "尚未選用", error: "" })); }
    catch (error) { setStatus((value) => ({ ...value, error: error instanceof Error ? error.message : "撤銷配對失敗。" })); }
    finally { setBusy(false); }
  };

  const runGeneration = async () => {
    if (!client.getSessionMetadata()) { setStatus((value) => ({ ...value, error: errorGuidance.BRIDGE_NOT_PAIRED })); return; }
    if (!status.model || status.model === "尚未選用") { setStatus((value) => ({ ...value, error: "請先選擇一個已安裝的文字模型。" })); return; }
    if (!prompt.trim()) { setStatus((value) => ({ ...value, error: "請先輸入要交給本機 AI 的內容。" })); return; }
    const controller = new AbortController();
    const currentRequestId = crypto.randomUUID();
    const modelForRequest = status.model;
    const requestModelSnapshot = snapshotLocalModelForRequest(currentRequestId, modelForRequest);
    const startedAt = performance.now();
    let generatedContent = "";
    let streamCompleted = false;
    generationController.current = controller;
    firstTokenSeen.current = false;
    setRequestId(currentRequestId); setActiveModel(modelForRequest); setOutput(""); setElapsedMs(null); setFirstTokenMs(null); setGenerationStatus("generating"); setStatus((value) => ({ ...value, error: "" }));
    try {
      for await (const event of client.generate({ requestId: requestModelSnapshot.requestId, model: requestModelSnapshot.modelId, prompt: prompt.trim(), systemInstruction: taskSystemInstruction(taskType), taskType, timeoutMs, options: { num_predict: taskType.includes("review") ? 256 : 512 }, signal: controller.signal })) {
        if (event.type === "token") {
          if (!firstTokenSeen.current) { firstTokenSeen.current = true; setFirstTokenMs(Math.round(performance.now() - startedAt)); }
          generatedContent += String(event.text || "");
          setOutput(generatedContent);
        }
        if (event.type === "completed") streamCompleted = true;
        if (event.type === "cancelled") setGenerationStatus("cancelled");
        if (event.type === "failed") throw Object.assign(new Error(String(event.errorCode || "OLLAMA_STREAM_INTERRUPTED")), { code: event.errorCode });
      }
      if (streamCompleted) {
        const validation = validateStudioTaskOutput({ taskType, prompt: prompt.trim(), output: generatedContent, modelId: modelForRequest, requestId: currentRequestId });
        if (validation.status === "reject") throw Object.assign(new Error(LOCAL_MODEL_OUTPUT_UNRELIABLE), { code: LOCAL_MODEL_OUTPUT_UNRELIABLE });
        setGenerationStatus("completed");
      }
    } catch (error) {
      if (controller.signal.aborted) setGenerationStatus("cancelled");
      else {
        const code = String((error as { code?: string })?.code || (error as Error)?.message || "");
        if (code === "BRIDGE_PAIRING_EXPIRED" || code === "BRIDGE_PAIRING_REVOKED" || code === "BRIDGE_NOT_PAIRED") {
          client.setSession(null);
          configureLocalBridgeClient(null);
          configureLocalBridgeModel(null);
          setPairingId("");
          setPairingCode("");
          setModels([]);
          setStatus((value) => ({ ...value, pairing: code === "BRIDGE_PAIRING_EXPIRED" ? "配對已過期" : "尚未配對", model: "尚未選用", error: errorGuidance[code] }));
        } else {
          setStatus((value) => ({ ...value, error: errorGuidance[code] || "本機 AI 沒有完成這次工作，請重新檢查連線後再試。" }));
        }
        setGenerationStatus("failed");
      }
    } finally {
      setElapsedMs(Math.round(performance.now() - startedAt));
      generationController.current = null;
    }
  };

  const cancelGeneration = () => {
    if (!generationController.current) return;
    setGenerationStatus("cancelling");
    generationController.current.abort();
  };

  return <main className="p2Settings">
    <header><Link href="/studio">← 返回創作中心</Link><h1>AI 使用方式</h1><p>預設只使用本機能力；跨出裝置前一定需要你的同意。</p></header>
    <section data-testid="local-ai-status"><h2>目前可用狀態</h2><dl>
      <div><dt>瀏覽器本機 AI</dt><dd>{status.browser}</dd></div><div><dt>本機橋接服務</dt><dd>{status.bridge}</dd></div><div><dt>安全配對</dt><dd>{status.pairing}</dd></div><div><dt>我的電腦 AI</dt><dd>{status.ollama}</dd></div><div><dt>目前模型</dt><dd>{status.model}</dd></div><div><dt>私有 AI 中樞</dt><dd>{status.hub}</dd></div>
    </dl>{status.error && <p role="alert">{status.error}</p>}<button type="button" disabled={busy} onClick={() => void refresh()}>重新檢查</button></section>
    <section><h2>連接我的電腦 AI</h2><p>先在這台電腦啟動 Local Bridge。配對碼只會顯示在本機 Bridge 視窗，授權不會寫入網址或瀏覽器儲存空間。</p>
      {!pairingId && <button data-testid="pair-start" type="button" disabled={busy} onClick={() => void requestPairing()}>開始安全配對</button>}
      {pairingId && status.pairing !== "已配對" && <><label>本機配對碼<input data-testid="pair-code" value={pairingCode} inputMode="numeric" autoComplete="off" onChange={(event) => setPairingCode(event.target.value)} /></label><button data-testid="pair-confirm" type="button" disabled={busy || pairingCode.length !== 6} onClick={() => void confirmPairing()}>確認配對</button></>}
      {status.pairing === "已配對" && <button type="button" disabled={busy} onClick={() => void revoke()}>撤銷配對</button>}
      {models.length > 0 && <label>本機模型<select data-testid="model-select" value={status.model} onChange={(event) => { configureLocalBridgeModel(event.target.value); localStorage.setItem("novel_local_ai_model", event.target.value); setStatus((value) => ({ ...value, model: event.target.value })); }}>{models.map((model) => <option key={model.modelId} value={model.modelId}>{model.modelId} {model.parameterSize?.value || ""} {model.quantization?.value || ""}</option>)}</select></label>}
    </section>
    <section data-testid="local-generation"><h2>測試本機 AI</h2><p>內容只會送到這台電腦的本機模型，結果是候選內容，不會直接寫入正式作品。</p>
      <label>工作類型<select data-testid="task-select" value={taskType} onChange={(event) => setTaskType(event.target.value)}>{taskOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>要處理的內容<textarea data-testid="generation-prompt" rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
      <label>執行上限<select data-testid="timeout-select" value={timeoutMs} onChange={(event) => setTimeoutMs(Number(event.target.value))}><option value={1000}>1 秒（連線測試）</option><option value={15000}>15 秒</option><option value={60000}>60 秒</option><option value={120000}>120 秒</option></select></label>
      <div className="localAiActions">
        <button data-testid="generate" type="button" disabled={generationStatus === "generating" || generationStatus === "cancelling"} onClick={() => void runGeneration()}>{generationStatus === "generating" ? "生成中……" : "開始生成"}</button>
        {(generationStatus === "generating" || generationStatus === "cancelling") && <button data-testid="cancel" type="button" onClick={cancelGeneration}>{generationStatus === "cancelling" ? "正在取消……" : "取消生成"}</button>}
        {(generationStatus === "completed" || generationStatus === "cancelled" || generationStatus === "failed") && <button data-testid="retry" type="button" onClick={() => void runGeneration()}>重新嘗試</button>}
      </div>
      <div className="localAiRunStatus" aria-live="polite"><strong>狀態：</strong><span data-testid="generation-status">{{ idle: "尚未開始", generating: "生成中", cancelling: "正在取消", completed: "已完成", cancelled: "已取消", failed: "未完成" }[generationStatus]}</span>{requestId && <><br /><strong>要求編號：</strong><code data-testid="request-id">{requestId}</code></>}{activeModel && <><br /><strong>本次模型：</strong><span data-testid="active-model">{activeModel}</span><br /><strong>執行來源：</strong><span data-testid="selected-provider">local_ollama</span></>}{firstTokenMs !== null && <><br /><strong>首段回應：</strong><span data-testid="first-token-ms">{firstTokenMs} ms</span></>}{elapsedMs !== null && <><br /><strong>耗時：</strong><span data-testid="elapsed-ms">{elapsedMs} ms</span></>}</div>
      <article data-testid="stream-output" className="localAiOutput">{output || "串流內容會顯示在這裡。"}</article>
    </section>
    <section><h2>隱私模式</h2>
      <label><input type="radio" checked={status.privacy === "strict-local"} onChange={() => savePrivacy({ ...status, privacy: "strict-local", external: false })} /> 完全留在本機</label>
      <label><input type="radio" checked={status.privacy === "private-hub-allowed"} onChange={() => savePrivacy({ ...status, privacy: "private-hub-allowed", external: false })} /> 可使用私有 AI 中樞</label>
      <label><input type="radio" checked={status.privacy === "external-allowed"} onChange={() => savePrivacy({ ...status, privacy: "external-allowed" })} /> 可在確認後使用外部 AI</label>
      <p>即使選擇外部輔助，每次跨越隱私邊界仍需明確同意，不會無聲回退。</p>
    </section>
  </main>;
}
