"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  configureLocalBridgeClient,
  configureLocalBridgeModel,
  selectAvailableTextModel,
  type LocalModelInferenceProof,
  type LocalTextModel,
} from "@/lib/novel-ai/providers/local-ollama/local-bridge-client";
import { LOCAL_AI_COMPANION_RELEASE } from "@/lib/novel-ai/providers/local-ollama/companion-release";
import {
  classifyClosedAIModelTier,
  modelTierLabel,
} from "@/lib/novel-ai/model-orchestration/model-tiers";
import {
  getStudioClosedAIRuntimeCoordinator,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import type { ClosedAIRuntimeSnapshot } from "@/lib/novel-ai/web/closed-ai-runtime-coordinator";
import styles from "./setup-wizard.module.css";

type PairingRequest = {
  pairingId: string;
  code: string;
};

function runtimeMessage(error: unknown) {
  const code = String((error as { code?: string })?.code || "");
  const messages: Record<string, string> = {
    LOCAL_NETWORK_PERMISSION_DENIED:
      "瀏覽器已拒絕本機網路權限。請在此網站的權限設定允許本機網路，再重新檢查。",
    BRIDGE_PROCESS_UNREACHABLE:
      "尚未連到 Local Bridge。請先解壓 Companion，執行 diagnose 與 start。",
    CORS_PREFLIGHT_REJECTED:
      "Local Bridge 尚未授權目前這個精確網址，請執行畫面上的 origin 指令後 restart。",
    BRIDGE_NOT_PAIRED:
      "Local Bridge 已啟動，但此分頁尚未安全配對。",
    BRIDGE_PAIRING_EXPIRED:
      "六位數配對要求已過期，請重新開始配對。",
    OLLAMA_UNREACHABLE:
      "Local Bridge 可連線，但 Ollama 尚未啟動。",
    OLLAMA_MODEL_NOT_FOUND:
      "Ollama 目前沒有可生成文字的模型。",
    LOCAL_MODEL_INFERENCE_NOT_VERIFIED:
      "模型存在，但尚未完成真實推理驗證。",
  };
  return messages[code]
    ?? (error instanceof Error ? error.message : "本機 AI 檢查未完成。");
}

function safeStudioReturnTo(value: string | null) {
  if (!value || !value.startsWith("/studio") || value.startsWith("//")) {
    return "/studio";
  }
  if (value.includes("\\") || /[\r\n]/.test(value)) return "/studio";
  return value;
}

export default function LocalAISetupWizard() {
  const [origin, setOrigin] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState("/studio");
  const coordinator = useMemo(
    () => getStudioClosedAIRuntimeCoordinator(
      origin ?? "https://novel-orcin.vercel.app",
    ),
    [origin],
  );
  const client = coordinator.localClient;
  const [runtime, setRuntime] = useState<ClosedAIRuntimeSnapshot | null>(null);
  const [pairing, setPairing] = useState<PairingRequest | null>(null);
  const [models, setModels] = useState<LocalTextModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [proof, setProof] = useState<LocalModelInferenceProof | null>(null);
  const [rememberWithinTab, setRememberWithinTab] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("正在檢查這台裝置。");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOrigin(window.location.origin);
      setReturnTo(
        safeStudioReturnTo(
          new URLSearchParams(window.location.search).get("returnTo"),
        ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    coordinator.setRememberPairingWithinTab(rememberWithinTab);
  }, [coordinator, rememberWithinTab]);

  const refresh = useCallback(async () => {
    if (!origin) return;
    setBusy(true);
    try {
      // First-time setup must probe the exact-origin loopback client before a
      // pairing session exists; otherwise no browser LNA request is issued.
      configureLocalBridgeClient(client);
      const snapshot = await coordinator.refresh({
        projectId: "local-ai-setup",
        taskType: "chapter.continue",
      });
      setRuntime(snapshot);
      if (client.getSessionMetadata()) {
        const response = await client.models();
        const available = response.models.filter(
          (model) => model.capabilities?.textGeneration?.value === true,
        );
        const selected = selectAvailableTextModel(
          available,
          selectedModel || "qwen2.5:3b",
        ) ?? "";
        setModels(available);
        setSelectedModel(selected);
        setProof(selected ? client.getModelVerification(selected) : null);
      } else {
        setModels([]);
        setSelectedModel("");
        setProof(null);
      }
      setMessage(
        snapshot.localOllama.status === "ready"
        && snapshot.localOllama.proofVerified
          ? "Local Bridge、Ollama 與模型推理已通過，可開始使用。"
          : snapshot.localNetworkPermission === "denied"
            ? "需要允許此網站存取本機網路。"
            : "依序完成下載、啟動、配對與模型實測。",
      );
    } catch (error) {
      setMessage(runtimeMessage(error));
    } finally {
      setBusy(false);
    }
  }, [client, coordinator, origin, selectedModel]);

  useEffect(() => {
    if (!origin) return;
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [origin, refresh]);

  async function copy(name: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(name);
    } catch {
      setMessage("瀏覽器無法自動複製，請手動選取完整指令。");
    }
  }

  async function startPairing() {
    if (busy) return;
    setBusy(true);
    try {
      const request = await client.requestPairing();
      setPairing({
        pairingId: String(request.pairingId ?? ""),
        code: "",
      });
      setMessage("配對要求已建立。請在本機 PowerShell 執行 pair，將顯示的六位數碼輸入下方。");
    } catch (error) {
      setMessage(runtimeMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmPairing() {
    if (!pairing || pairing.code.length !== 6 || busy) return;
    setBusy(true);
    try {
      await client.confirmPairing(pairing.pairingId, pairing.code);
      configureLocalBridgeClient(client);
      const response = await client.models();
      const available = response.models.filter(
        (model) => model.capabilities?.textGeneration?.value === true,
      );
      const selected = selectAvailableTextModel(
        available,
        "qwen2.5:3b",
      ) ?? "";
      setModels(available);
      setSelectedModel(selected);
      setPairing(null);
      if (!selected) {
        throw Object.assign(new Error("找不到可生成文字的 Ollama 模型。"), {
          code: "OLLAMA_MODEL_NOT_FOUND",
        });
      }
      setMessage(`已配對，正在要求 ${selected} 完成真實推理驗證。`);
      const verified = await client.verifyModel(selected);
      configureLocalBridgeModel(selected);
      setProof(verified);
      await refresh();
    } catch (error) {
      setMessage(runtimeMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function verifyModel(modelId: string) {
    if (!modelId || busy) return;
    setBusy(true);
    setSelectedModel(modelId);
    setProof(null);
    configureLocalBridgeModel(null);
    try {
      const verified = await client.verifyModel(modelId);
      configureLocalBridgeClient(client);
      configureLocalBridgeModel(modelId);
      setProof(verified);
      setMessage(
        `${modelId} 已完成真實推理，耗時 ${verified.latencyMs} ms。`,
      );
      await refresh();
    } catch (error) {
      setMessage(runtimeMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const launcher = String.raw`$launcher = ".\bridge\novel-local-ai.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher diagnose
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher status`;
  const pairCommand = String.raw`powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\bridge\novel-local-ai.ps1" pair`;
  const originCommand = origin
    ? String.raw`$origin = "${origin}"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\bridge\novel-local-ai.ps1" origin add $origin --confirm $origin
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\bridge\novel-local-ai.ps1" restart`
    : "";
  const hashCommand =
    `Get-FileHash .\\${LOCAL_AI_COMPANION_RELEASE.filename} -Algorithm SHA256`;
  const ready = Boolean(
    proof
    && runtime?.localOllama.status === "ready"
    && runtime.localOllama.modelId === proof.modelId,
  );

  return (
    <main
      className={styles.shell}
      data-testid="local-ai-setup"
      data-runtime-state={runtime?.state ?? "checking"}
    >
      <header className={styles.hero}>
        <div>
          <small>LOCAL AI SETUP</small>
          <h1>把真正的閉端 AI 接到這台電腦</h1>
          <p>
            精靈只連接這台電腦，不開放區域網路、不改防火牆、不安裝軟體，
            也不要求任何 Vercel、GitHub 或雲端 Token。
          </p>
        </div>
        <div
          className={styles.state}
          data-testid="local-ai-runtime-state"
          data-ready={ready}
        >
          <span>{ready ? "READY" : runtime?.state ?? "CHECKING"}</span>
          <strong>{ready ? "本機模型可執行" : "尚待完成設定"}</strong>
          <small>{message}</small>
        </div>
      </header>

      <nav className={styles.topNav}>
        <Link href={returnTo}>返回原本的創作畫面</Link>
        <Link href="/studio/settings/ai">進階診斷</Link>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          重新檢查
        </button>
      </nav>

      <section className={styles.truthGrid} aria-label="執行真相">
        <article>
          <span>本機網路權限</span>
          <strong>{runtime?.localNetworkPermission ?? "checking"}</strong>
        </article>
        <article>
          <span>Local Bridge</span>
          <strong>{runtime?.localBridge.status ?? "checking"}</strong>
        </article>
        <article>
          <span>Ollama／模型</span>
          <strong>{runtime?.localOllama.status ?? "checking"}</strong>
        </article>
        <article>
          <span>實際執行器</span>
          <strong data-testid="local-ai-actual-executor">
            {runtime?.actualExecutor ?? "not_executed"}
          </strong>
        </article>
      </section>

      <section className={styles.steps}>
        <article>
          <span className={styles.stepNumber}>1</span>
          <div>
            <h2>允許這個網站使用本機 AI</h2>
            <p>
              按下重新檢查；若 Edge 詢問是否允許存取本機網路，請核對網址後按「允許」。
              沒有出現詢問也沒關係，系統會直接顯示目前狀態。
            </p>
            <div className={styles.actions}>
              <button type="button" disabled={busy} onClick={() => void refresh()}>
                檢查本機網路權限
              </button>
            </div>
            <p className={runtime?.localNetworkPermission === "denied" ? "" : styles.success}>
              目前狀態：{runtime?.localNetworkPermission ?? "檢查中"}
            </p>
            <details>
              <summary>技術說明</summary>
              <p>
                網頁只會連線到這台電腦的 loopback 位址，不會開放區域網路，
                也不會修改防火牆。授權只適用於目前精確 Origin。
              </p>
            </details>
          </div>
        </article>

        <article>
          <span className={styles.stepNumber}>2</span>
          <div>
            <h2>準備這台電腦的 AI 服務</h2>
            <p>
              如果狀態不是「可連線」，展開下方設定說明，依序下載、解壓、啟動；
              完成後再按重新檢查。
            </p>
            <p>目前狀態：{runtime?.localBridge.status ?? "檢查中"}</p>
            <details>
              <summary>第一次設定／技術指令</summary>
              <p>
                Companion 版本 {LOCAL_AI_COMPANION_RELEASE.version}；套件可用
                SHA-256 驗證，目前未簽章。組織政策若禁止未簽章程式，請勿繞過政策。
              </p>
              <div className={styles.actions}>
                <a
                  className={styles.primary}
                  href={LOCAL_AI_COMPANION_RELEASE.downloadPath}
                  download
                  data-testid="local-ai-companion-download"
                >
                  下載 Windows Companion ZIP
                </a>
                <a
                  href={LOCAL_AI_COMPANION_RELEASE.downloadPath.replace(/\.zip$/, ".sha256")}
                  download
                >
                  下載 SHA-256
                </a>
                <a href="https://nodejs.org/en/download">Node.js 官方下載</a>
                <a href="https://ollama.com/download/windows">Ollama 官方下載</a>
              </div>
              <code className={styles.hash}>{LOCAL_AI_COMPANION_RELEASE.sha256}</code>
              <Command
                label="驗證下載內容"
                value={hashCommand}
                copied={copied === "hash"}
                onCopy={() => void copy("hash", hashCommand)}
              />
              <p>
                需要 Node.js {LOCAL_AI_COMPANION_RELEASE.minimumNodeMajor}+ 與已啟動的
                Ollama。快速模型範例：<code>ollama pull qwen2.5:3b</code>。
              </p>
              <Command
                label="診斷、啟動與狀態"
                value={launcher}
                copied={copied === "launcher"}
                onCopy={() => void copy("launcher", launcher)}
              />
              {origin && origin !== "https://novel-orcin.vercel.app" ? (
                <>
                <p>
                  目前是 Preview／其他精確 Origin。Bridge 不會自動信任，
                  請在本機明確加入後重啟：
                </p>
                <Command
                  label={`授權 ${origin}`}
                  value={originCommand}
                  copied={copied === "origin"}
                  onCopy={() => void copy("origin", originCommand)}
                />
                </>
              ) : null}
            </details>
          </div>
        </article>

        <article>
          <span className={styles.stepNumber}>3</span>
          <div>
            <h2>一次性安全配對</h2>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={rememberWithinTab}
                onChange={(event) =>
                  setRememberWithinTab(event.target.checked)}
              />
              僅在目前分頁記住短期配對；關閉分頁、服務重啟、網站網址
              改變或期限到達即失效。
            </label>
            {!client.getSessionMetadata() ? (
              pairing ? (
                <div className={styles.pairBox}>
                  <Command
                    label="在本機讀取六位數碼"
                    value={pairCommand}
                    copied={copied === "pair"}
                    onCopy={() => void copy("pair", pairCommand)}
                  />
                  <label>
                    六位數配對碼
                    <input
                      data-testid="local-ai-pairing-code"
                      value={pairing.code}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={6}
                      onChange={(event) => setPairing({
                        ...pairing,
                        code: event.target.value.replace(/\D/g, "").slice(0, 6),
                      })}
                    />
                  </label>
                  <button
                    type="button"
                    data-testid="local-ai-confirm-pairing"
                    disabled={busy || pairing.code.length !== 6}
                    onClick={() => void confirmPairing()}
                  >
                    確認配對並實測模型
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="local-ai-start-pairing"
                  disabled={busy}
                  onClick={() => void startPairing()}
                >
                  開始安全配對
                </button>
              )
            ) : (
              <p className={styles.success}>
                已配對至 instance：
                <code>{client.getSessionMetadata()?.instanceId}</code>
              </p>
            )}
          </div>
        </article>

        <article>
          <span className={styles.stepNumber}>4</span>
          <div>
            <h2>選擇模型並做一次實際測試</h2>
            {models.length ? (
              <label>
                Ollama 文字模型
                <select
                  value={selectedModel}
                  disabled={busy}
                  onChange={(event) => void verifyModel(event.target.value)}
                >
                  {models.map((model) => (
                    <option key={model.modelId} value={model.modelId}>
                      {model.modelId}
                      {` · ${modelTierLabel(model)}`}
                      {model.parameterSize?.value
                        ? ` · ${model.parameterSize.value}`
                        : ""}
                      {model.quantization?.value
                        ? ` · ${model.quantization.value}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p>配對完成後，這裡才會列出 Ollama 真正回報的文字模型。</p>
            )}
            {proof ? (
              <>
                <p className={styles.success} data-testid="local-ai-model-proof">
                  模型已實際回覆，耗時 {proof.latencyMs} ms；資料未離開這台裝置。
                </p>
                <details>
                  <summary>查看技術證明</summary>
                  <dl className={styles.proof}>
                    <div><dt>狀態</dt><dd>{proof.state}</dd></div>
                    <div><dt>模型</dt><dd>{proof.modelId}</dd></div>
                    <div><dt>Model Digest</dt><dd>{proof.modelDigest ?? "runtime-managed"}</dd></div>
                    <div><dt>耗時</dt><dd>{proof.latencyMs} ms</dd></div>
                    <div><dt>Output Digest</dt><dd>{proof.outputDigest}</dd></div>
                    <div><dt>離開裝置</dt><dd>{proof.dataLeftDevice ? "是" : "否"}</dd></div>
                  </dl>
                </details>
              </>
            ) : null}
            {selectedModel ? (() => {
              const model = models.find((item) => item.modelId === selectedModel);
              if (!model) return null;
              const tier = classifyClosedAIModelTier(model);
              return (
                <aside className={styles.modelTruth}>
                  <strong>{tier.tier}｜{tier.role}</strong>
                  <span>適合：{tier.suitableFor.join("、")}</span>
                  <span>限制：{tier.limitations.join("；")}</span>
                </aside>
              );
            })() : null}
          </div>
        </article>

        <article data-complete={ready}>
          <span className={styles.stepNumber}>5</span>
          <div>
            <h2>{ready ? "設定完成" : "等待前面步驟完成"}</h2>
            <p>
              快速本機模式：速度較快，長篇品質有限。完成後會回到你剛才的創作畫面，
              作品與任務不會被清除。
            </p>
            <details>
              <summary>完成條件</summary>
              <p>
                只有真實模型推理 Proof、Model ID、Model Digest 與目前 Bridge
                Instance 一致時，系統才會標記可執行。
              </p>
            </details>
            <div className={styles.actions}>
              <Link className={styles.primary} href={returnTo}>
                回到原本的創作畫面
              </Link>
              <Link href="/studio/settings/ai">開啟進階實測</Link>
            </div>
          </div>
        </article>
      </section>

      <aside className={styles.mobileNote}>
        手機瀏覽器無法連到桌機自己的 <code>127.0.0.1</code>。手機可使用
        瀏覽器裝置能力；Local Bridge 與 Ollama 配對請在同一台桌機完成。
      </aside>
    </main>
  );
}

function Command({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className={styles.command}>
      <span>{label}</span>
      <pre>{value}</pre>
      <button type="button" onClick={onCopy}>
        {copied ? "已複製" : "複製"}
      </button>
    </div>
  );
}
