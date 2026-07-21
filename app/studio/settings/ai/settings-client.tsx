"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { detectBrowserAI } from "@/lib/novel-ai/providers/browser-ai/browser-ai-provider";
import { LocalBridgeClient, configureLocalBridgeClient, configureLocalBridgeModel, selectAvailableTextModel, snapshotLocalModelForRequest } from "@/lib/novel-ai/providers/local-ollama/local-bridge-client";
import { assertEnrollmentCommandMatchesPage, buildOriginEnrollmentCommand, resolveCurrentStudioOrigin } from "@/lib/novel-ai/providers/local-ollama/studio-origin";
import { LOCAL_MODEL_OUTPUT_UNRELIABLE, buildExtractionFingerprint, taskSystemInstruction, validateStudioTaskOutput } from "@/lib/novel-ai/providers/local-ollama/local-quality-guard";
import { LOCAL_MODEL_INSUFFICIENT_FOR_TASK, runLocalExtractionWithRetry } from "@/lib/novel-ai/providers/local-ollama/local-extraction-runtime";
import type { Chapter, NovelProject } from "@/lib/novel-ai/domain/index";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  approveLocalStoryBibleCandidate,
  listLocalStoryBibleReviewState,
  registerValidatedLocalStoryBibleCandidates,
  rejectLocalStoryBibleCandidate,
  type LocalStoryBibleCandidate,
} from "@/lib/novel-ai/repository/story-bible-approval";

type ModelOption = { modelId: string; parameterSize?: { value?: string | null }; quantization?: { value?: string | null }; capabilities?: { textGeneration?: { value?: boolean } } };
type Status = { browser: string; bridge: string; origin: string; pairing: string; ollama: string; model: string; generation: string; hub: string; privacy: string; external: boolean; error: string; errorCode: string };
type GenerationStatus = "idle" | "generating" | "cancelling" | "completed" | "cancelled" | "failed";

const taskOptions = [
  ["summary", "繁體中文摘要"], ["rewrite", "繁體中文改寫"], ["character.extract", "角色資料整理"], ["story.choices", "產生三個劇情選項"],
  ["scene.continue", "短場景續寫"], ["story-bible.continue", "依故事設定續寫"], ["continuity.review", "角色一致性檢查"], ["timeline.review", "時間線矛盾辨識"],
] as const;

const errorGuidance: Record<string, string> = {
  BRIDGE_PROCESS_UNREACHABLE: "瀏覽器沒有連到本機橋接服務。請確認服務已啟動，並確認目前網站已完成本機授權。",
  MIXED_CONTENT_BLOCKED: "瀏覽器阻擋了安全網站連往本機 HTTP 服務。請勿關閉瀏覽器安全功能，改用支援的本機連線方式。",
  PRIVATE_NETWORK_ACCESS_BLOCKED: "瀏覽器的私人網路保護阻擋了這次連線。請確認 Bridge 已授權此網站並支援私人網路預檢。",
  LOCAL_NETWORK_PERMISSION_DENIED: "你已拒絕這個網站存取本機網路。本機 AI 沒有連線，也不會改用外部 AI；請在瀏覽器網站權限中允許本機網路後再試。",
  CORS_PREFLIGHT_REJECTED: "本機橋接服務拒絕了瀏覽器預檢。請重新確認網站授權與 Bridge 版本。",
  HOST_VALIDATION_FAILED: "本機橋接服務拒絕了不安全的主機位址。請只使用 localhost 或 loopback 位址。",
  REQUEST_TIMEOUT: "瀏覽器在期限內沒有收到本機橋接服務回應。",
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
  LOCAL_EXTRACTION_RETRY_EXHAUSTED: "本機模型連續三次都未能提供可靠證據，這次內容不會進入正式資料。",
  LOCAL_EXTRACTION_CANCELLED: "角色資料整理已取消，後續重試也已停止。",
  LOCAL_EXTRACTION_TOTAL_TIMEOUT: "角色資料整理超過整體時間上限，已停止所有重試。",
  LOCAL_EXTRACTION_SOURCE_CHANGED: "整理期間原文已變更，舊結果已捨棄，請重新執行。",
  [LOCAL_MODEL_INSUFFICIENT_FOR_TASK]: "目前選用的本機模型無法在有限重試內完成可靠抽取。請改用較強的本機模型；未來也可改用 Private Hub。",
};

const initial: Status = { browser: "檢查中", bridge: "檢查中", origin: "尚未確認", pairing: "尚未配對", ollama: "檢查中", model: "尚未選用", generation: "尚未就緒", hub: "檢查中", privacy: "strict-local", external: false, error: "", errorCode: "" };

export default function AISettingsClient() {
  const [currentOrigin, setCurrentOrigin] = useState<string | null>(null);
  const client = useMemo(() => new LocalBridgeClient({ origin: currentOrigin ?? "https://novel-orcin.vercel.app" }), [currentOrigin]);
  const repository = useMemo(() => createNovelRepository(), []);
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
  const [timeoutMs, setTimeoutMs] = useState(120_000);
  const generationController = useRef<AbortController | null>(null);
  const firstTokenSeen = useRef(false);
  const [projects, setProjects] = useState<NovelProject[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedChapterId, setSelectedChapterId] = useState("");
  const [reviewCandidates, setReviewCandidates] = useState<LocalStoryBibleCandidate[]>([]);
  const [reviewStatus, setReviewStatus] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [connectionDiagnostics, setConnectionDiagnostics] = useState<Array<{ endpoint: string; reachable: boolean; status: number | null; errorCode: string | null; elapsedMs: number }>>([]);
  const [originCommandCopied, setOriginCommandCopied] = useState(false);
  const originEnrollmentCommand = currentOrigin ? buildOriginEnrollmentCommand(currentOrigin) : null;

  useEffect(() => {
    const resolved = resolveCurrentStudioOrigin(window.location);
    setCurrentOrigin(resolved.ready ? resolved.origin : null);
  }, []);

  const loadReviewState = useCallback(async (projectId: string) => {
    if (!projectId) { setReviewCandidates([]); return; }
    try {
      const { state } = await listLocalStoryBibleReviewState(repository, projectId);
      setReviewCandidates(state.candidates);
    } catch {
      setReviewCandidates([]);
    }
  }, [repository]);

  useEffect(() => {
    void repository.list<NovelProject>("projects").then((rows) => {
      setProjects(rows);
      setSelectedProjectId((current) => current || rows[0]?.id || "");
    }).catch(() => setReviewStatus("無法讀取作品，請重新整理後再試。"));
  }, [repository]);

  useEffect(() => {
    if (!selectedProjectId) { setChapters([]); setSelectedChapterId(""); return; }
    void Promise.all([
      repository.list<Chapter>("chapters", selectedProjectId),
      loadReviewState(selectedProjectId),
    ]).then(([rows]) => {
      const ordered = [...rows].sort((left, right) => left.order - right.order);
      setChapters(ordered);
      setSelectedChapterId((current) => ordered.some((row) => row.id === current) ? current : ordered[0]?.id || "");
    }).catch(() => setReviewStatus("無法讀取章節與待審建議。"));
  }, [loadReviewState, repository, selectedProjectId]);

  const refresh = useCallback(async () => {
    if (!currentOrigin) return;
    const saved = JSON.parse(localStorage.getItem("novel_p2_ai_settings") || "null") || {};
    let healthError: unknown = null;
    const [browser, health, hub] = await Promise.all([
      detectBrowserAI(),
      client.health().catch((error) => { healthError = error; return null; }),
      fetch("/api/private-ai/health", { cache: "no-store" }).then((response) => response.json()).catch(() => ({ status: "unavailable" })),
    ]);
    const healthErrorCode = String((healthError as { code?: string })?.code || "");
    const diagnostic = health ? null : await client.diagnoseConnectivity().catch(() => null);
    setConnectionDiagnostics(diagnostic?.results || []);
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
      origin: health?.configuredOrigins?.includes(currentOrigin) ? "目前網站已授權" : health ? "目前網站尚未授權" : "無法確認授權狀態",
      pairing: health?.pairingState === "paired" && client.getSessionMetadata() ? "已配對" : health?.pairingState === "paired" ? "頁面已重新載入，請重新配對" : "尚未配對",
      ollama: health?.ollamaReachable ? (health.modelAvailable ? "Ollama 與文字模型可用" : "Ollama 已啟動，尚無文字模型") : "Ollama 尚未啟動",
      model: refreshedModel || (health?.pairingState === "paired" ? value.model : "尚未選用"),
      generation: health?.runtimeReady && refreshedModel ? "可以生成" : "尚未就緒",
      hub: hub.status === "ready" ? "已連線" : "尚未連接執行環境",
      privacy: saved.privacy || "strict-local",
      external: Boolean(saved.external),
      error: healthErrorCode ? (errorGuidance[healthErrorCode] || "本機橋接服務目前無法連線，請確認服務已啟動後再試一次。") : modelError,
      errorCode: healthErrorCode,
    }));
  }, [client, currentOrigin]);

  useEffect(() => { void refresh(); return () => { configureLocalBridgeClient(null); configureLocalBridgeModel(null); }; }, [refresh]);

  const savePrivacy = (next: Status) => {
    setStatus(next);
    localStorage.setItem("novel_p2_ai_settings", JSON.stringify({ privacy: next.privacy, external: next.external }));
  };

  const requestPairing = async () => {
    setBusy(true); setStatus((value) => ({ ...value, error: "", errorCode: "" }));
    try {
      const request = await client.requestPairing();
      setPairingId(String(request.pairingId));
      setStatus((value) => ({ ...value, pairing: "等待輸入本機配對碼" }));
    } catch (error) { const code = String((error as { code?: string })?.code || ""); setStatus((value) => ({ ...value, error: errorGuidance[code] || (error instanceof Error ? error.message : "無法要求配對。"), errorCode: code })); }
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
      setStatus((value) => ({ ...value, pairing: "已配對", bridge: "本機橋接服務已啟動", origin: "目前網站已授權", ollama: available.length ? "Ollama 與文字模型可用" : "Ollama 已啟動，尚無文字模型", model: selected || "尚未選用", generation: selected ? "可以生成" : "尚未就緒" }));
      setPairingCode("");
    } catch (error) { setStatus((value) => ({ ...value, error: error instanceof Error ? error.message : "配對沒有成功。" })); }
    finally { setBusy(false); }
  };

  const revoke = async () => {
    setBusy(true);
    try { await client.revoke(); configureLocalBridgeClient(null); configureLocalBridgeModel(null); setPairingId(""); setPairingCode(""); setModels([]); setStatus((value) => ({ ...value, pairing: "已撤銷", model: "尚未選用", generation: "尚未就緒", error: "", errorCode: "" })); }
    catch (error) { setStatus((value) => ({ ...value, error: error instanceof Error ? error.message : "撤銷配對失敗。" })); }
    finally { setBusy(false); }
  };

  const runGeneration = async () => {
    const selectedChapter = chapters.find((chapter) => chapter.id === selectedChapterId) || null;
    if (taskType === "character.extract" && (!selectedProjectId || !selectedChapter)) {
      setStatus((value) => ({ ...value, error: "請先選擇要抽取人物事實的正式作品與章節。" }));
      return;
    }
    if (!client.getSessionMetadata()) { setStatus((value) => ({ ...value, error: errorGuidance.BRIDGE_NOT_PAIRED })); return; }
    if (!status.model || status.model === "尚未選用") { setStatus((value) => ({ ...value, error: "請先選擇一個已安裝的文字模型。" })); return; }
    if (taskType !== "character.extract" && !prompt.trim()) { setStatus((value) => ({ ...value, error: "請先輸入要交給本機 AI 的內容。" })); return; }
    const controller = new AbortController();
    const currentRequestId = crypto.randomUUID();
    const modelForRequest = status.model;
    const requestModelSnapshot = snapshotLocalModelForRequest(currentRequestId, modelForRequest);
    const submittedPrompt = taskType === "character.extract" ? String(selectedChapter?.content || "") : prompt.trim();
    const sourceChapterId = taskType === "character.extract" ? String(selectedChapter?.id || "") : "studio-input";
    const sourceRevision = taskType === "character.extract"
      ? `${sourceChapterId}:revision-${selectedChapter?.revision || 0}`
      : buildExtractionFingerprint({ sourceRevision: "studio-current", taskType, modelId: modelForRequest, schemaVersion: "local-quality-guard-v1", sourceText: submittedPrompt });
    const startedAt = performance.now();
    let generatedContent = "";
    let streamCompleted = false;
    generationController.current = controller;
    firstTokenSeen.current = false;
    setRequestId(currentRequestId); setActiveModel(modelForRequest); setOutput(""); setElapsedMs(null); setFirstTokenMs(null); setGenerationStatus("generating"); setStatus((value) => ({ ...value, error: "" }));
    try {
      const collectAttempt = async (attempt: { attemptId: string; modelId: string; prompt: string; systemInstruction: string; signal: AbortSignal; timeoutMs?: number; maxOutputTokens?: number }) => {
        let content = ""; let completed = false;
        for await (const event of client.generate({ requestId: attempt.attemptId, model: attempt.modelId, prompt: attempt.prompt, systemInstruction: attempt.systemInstruction, taskType, timeoutMs: attempt.timeoutMs ?? timeoutMs, options: { num_predict: attempt.maxOutputTokens ?? 512, temperature: taskType === "character.extract" ? 0 : undefined }, signal: attempt.signal })) {
          if (event.type === "token") { if (!firstTokenSeen.current) { firstTokenSeen.current = true; setFirstTokenMs(Math.round(performance.now() - startedAt)); } content += String(event.text || ""); setOutput(content); }
          if (event.type === "completed") completed = true;
          if (event.type === "failed") throw Object.assign(new Error(String(event.errorCode || "OLLAMA_STREAM_INTERRUPTED")), { code: event.errorCode });
        }
        if (!completed) throw Object.assign(new Error("OLLAMA_STREAM_INTERRUPTED"), { code: "OLLAMA_STREAM_INTERRUPTED" });
        return content;
      };
      if (taskType === "character.extract") {
        const result = await runLocalExtractionWithRetry({
          logicalRequestId: currentRequestId,
          taskType,
          modelId: requestModelSnapshot.modelId,
          sourceRevision,
          sources: [{ chapterId: sourceChapterId, text: submittedPrompt }],
          totalTimeoutMs: timeoutMs,
          signal: controller.signal,
          getCurrentSourceRevision: async () => {
            const current = await repository.get<Chapter>("chapters", sourceChapterId);
            return current ? `${current.id}:revision-${current.revision}` : "SOURCE_REMOVED";
          },
          executeAttempt: collectAttempt,
        });
        generatedContent = JSON.stringify({ schemaVersion: result.versions.schemaVersion, facts: result.facts }, null, 2);
        setOutput(generatedContent);
        const registered = await registerValidatedLocalStoryBibleCandidates({
          repository,
          projectId: selectedProjectId,
          chapterId: sourceChapterId,
          requestId: currentRequestId,
          sourceRevision,
          candidateFingerprint: result.fingerprint,
          modelId: result.modelId,
          facts: result.facts,
        });
        setReviewCandidates((current) => [...current.filter((row) => !registered.candidates.some((candidate) => candidate.candidateId === row.candidateId)), ...registered.candidates]);
        setReviewStatus(result.facts.length ? "抽取結果已通過格式與原文證據驗證，請逐項確認。" : "本章沒有找到可驗證的新人物事實。");
        streamCompleted = true;
      } else {
        generatedContent = await collectAttempt({ attemptId: requestModelSnapshot.requestId, modelId: requestModelSnapshot.modelId, prompt: submittedPrompt, systemInstruction: taskSystemInstruction(taskType), signal: controller.signal });
        streamCompleted = true;
      }
      if (streamCompleted) {
        const validation = taskType === "character.extract"
          ? { status: "accept" as const }
          : validateStudioTaskOutput({ taskType, prompt: submittedPrompt, output: generatedContent, modelId: modelForRequest, requestId: currentRequestId });
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

  const approveCandidate = async (candidate: LocalStoryBibleCandidate) => {
    if (reviewBusy) return;
    setReviewBusy(true);
    setReviewStatus("正在重新核對章節版本與原文證據……");
    try {
      const chapter = await repository.get<Chapter>("chapters", candidate.chapterId);
      if (!chapter) throw new Error("來源章節已不存在，請重新抽取。");
      const result = await approveLocalStoryBibleCandidate({
        repository,
        projectId: selectedProjectId,
        candidateId: candidate.candidateId,
        approvalEventId: `approval:${candidate.candidateId}`,
        idempotencyKey: `approval:${candidate.candidateFingerprint}`,
        requestId: `approval-request:${candidate.candidateId}`,
        currentSourceRevision: async () => {
          const current = await repository.get<Chapter>("chapters", candidate.chapterId);
          return current ? `${current.id}:revision-${current.revision}` : "SOURCE_REMOVED";
        },
        sourceText: chapter.content,
      });
      setReviewStatus(result.status === "committed"
        ? "已寫入正式 Story Bible，並保存證據、核准紀錄與版本。"
        : result.status === "ALREADY_COMMITTED"
          ? "這筆建議先前已經核准，沒有重複寫入。"
          : "這筆建議與既有事實衝突，已保留供你處理，沒有覆蓋舊資料。");
      await loadReviewState(selectedProjectId);
    } catch (error) {
      const code = String((error as { code?: string })?.code || "");
      setReviewStatus(code === "STORY_BIBLE_SOURCE_REVISION_STALE"
        ? "來源章節已修改，這筆舊建議沒有寫入；請重新抽取。"
        : `核准失敗：${error instanceof Error ? error.message : "請重試"}`);
    } finally {
      setReviewBusy(false);
    }
  };

  const rejectCandidate = async (candidate: LocalStoryBibleCandidate) => {
    if (reviewBusy) return;
    setReviewBusy(true);
    try {
      await rejectLocalStoryBibleCandidate({ repository, projectId: selectedProjectId, candidateId: candidate.candidateId, requestId: `reject:${crypto.randomUUID()}` });
      setReviewStatus("已拒絕這筆建議，正式 Story Bible 沒有改變。");
      await loadReviewState(selectedProjectId);
    } catch (error) {
      setReviewStatus(`拒絕失敗：${error instanceof Error ? error.message : "請重試"}`);
    } finally {
      setReviewBusy(false);
    }
  };

  return <main className="p2Settings">
    <header><Link href="/studio">← 返回創作中心</Link><h1>AI 使用方式</h1><p>預設只使用本機能力；跨出裝置前一定需要你的同意。</p></header>
    <section data-testid="local-ai-status"><h2>目前可用狀態</h2><dl>
      <div><dt>瀏覽器本機 AI</dt><dd>{status.browser}</dd></div><div><dt>Bridge process reachable</dt><dd>{status.bridge}</dd></div><div><dt>Origin authorized</dt><dd>{status.origin}</dd></div><div><dt>Bridge paired</dt><dd>{status.pairing}</dd></div><div><dt>Ollama reachable</dt><dd>{status.ollama}</dd></div><div><dt>Model available</dt><dd>{status.model}</dd></div><div><dt>Generation ready</dt><dd>{status.generation}</dd></div><div><dt>私有 AI 中樞</dt><dd>{status.hub}</dd></div>
    </dl>{status.error && <><p role="alert">{status.error}</p>{status.errorCode && <details><summary>查看連線分類</summary><code>{status.errorCode}</code></details>}</>}<button type="button" disabled={busy} onClick={() => void refresh()}>重新檢查</button></section>
    <section><h2>連接我的電腦 AI</h2><p>先在這台電腦啟動 Local Bridge。配對碼只會顯示在本機 Bridge 視窗，授權不會寫入網址或瀏覽器儲存空間。</p>
      {status.origin !== "目前網站已授權" && <div data-testid="origin-enrollment-help"><ol><li>確認 Bridge 已啟動。</li><li>確認目前網站 origin 已獲授權。</li><li>複製下方安全授權指令。</li><li>在本機 Launcher 明確確認完整網址。</li><li>回到這裡重新檢查。</li></ol>{currentOrigin && originEnrollmentCommand ? <><p>目前網站：<code data-testid="current-studio-origin">{currentOrigin}</code></p><code data-testid="origin-enrollment-command">{originEnrollmentCommand}</code><button type="button" onClick={() => { try { const exactOrigin = assertEnrollmentCommandMatchesPage(currentOrigin, window.location.origin); const command = buildOriginEnrollmentCommand(exactOrigin); void navigator.clipboard.writeText(command).then(() => setOriginCommandCopied(true)).catch(() => setStatus((value) => ({ ...value, error: "無法自動複製，請手動選取指令。" }))); } catch { setStatus((value) => ({ ...value, error: "授權網址與目前網站不一致，請重新整理後再試。", errorCode: "ORIGIN_COMMAND_MISMATCH" })); } }}>{originCommandCopied ? "已複製" : "複製安全授權指令"}</button></> : <p data-testid="origin-hydration-pending">正在確認目前網站網址，確認完成前不會產生授權指令。</p>}<p>系統不會自動授權 Preview、不會開放區域網路，也不會要求關閉瀏覽器安全功能。</p></div>}
      {connectionDiagnostics.length > 0 && <details><summary>查看 loopback 偵測結果</summary><ul>{connectionDiagnostics.map((row) => <li key={row.endpoint}><code>{row.endpoint}</code>：{row.reachable ? `可連線（HTTP ${row.status}）` : `未連線（${row.errorCode || "未知原因"}）`}，{row.elapsedMs} ms</li>)}</ul></details>}
      {!pairingId && <button data-testid="pair-start" type="button" disabled={busy} onClick={() => void requestPairing()}>開始安全配對</button>}
      {pairingId && status.pairing !== "已配對" && <><label>本機配對碼<input data-testid="pair-code" value={pairingCode} inputMode="numeric" autoComplete="off" onChange={(event) => setPairingCode(event.target.value)} /></label><button data-testid="pair-confirm" type="button" disabled={busy || pairingCode.length !== 6} onClick={() => void confirmPairing()}>確認配對</button></>}
      {status.pairing === "已配對" && <button type="button" disabled={busy} onClick={() => void revoke()}>撤銷配對</button>}
      {models.length > 0 && <label>本機模型<select data-testid="model-select" value={status.model} onChange={(event) => { configureLocalBridgeModel(event.target.value); localStorage.setItem("novel_local_ai_model", event.target.value); setStatus((value) => ({ ...value, model: event.target.value, generation: event.target.value ? "可以生成" : "尚未就緒" })); }}>{models.map((model) => <option key={model.modelId} value={model.modelId}>{model.modelId} {model.parameterSize?.value || ""} {model.quantization?.value || ""}</option>)}</select></label>}
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
    {taskType === "character.extract" && <section data-testid="story-bible-review">
      <h2>Story Bible 人物事實審核</h2>
      <div data-testid="story-bible-source-selection">
        <label>正式作品
          <select data-testid="story-project-select" value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
            <option value="">請選擇作品</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
        </label>
        <label>證據章節
          <select data-testid="story-chapter-select" value={selectedChapterId} onChange={(event) => setSelectedChapterId(event.target.value)}>
            <option value="">請選擇章節</option>
            {chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
          </select>
        </label>
        <p>人物事實只會從選定的正式章節抽取；核准前會再次核對章節版本與原文位置。</p>
      </div>
      <p aria-live="polite">{reviewStatus || "抽取完成後，這裡會顯示可核對原文的候選事實。"}</p>
      {reviewCandidates.length === 0 ? <p>目前沒有待審或已處理的建議。</p> : reviewCandidates.map((candidate) => <article key={candidate.candidateId} data-candidate-status={candidate.status}>
        <h3>{candidate.fact.entityId} · {candidate.fact.field}</h3>
        <p><strong>建議內容：</strong>{String(candidate.fact.value ?? "資訊不足")}</p>
        <p><strong>事實類型：</strong>{{ explicit: "原文明確記載", inferred: "推論", unknown: "資訊不足", conflicted: "存在衝突" }[candidate.fact.factType]}</p>
        <p><strong>可信度：</strong>{Math.round(candidate.fact.confidence * 100)}% · <strong>狀態：</strong>{candidate.status}</p>
        <details><summary>查看原文證據</summary>{candidate.fact.evidenceSpans.length ? candidate.fact.evidenceSpans.map((span, index) => <blockquote key={`${candidate.candidateId}:${index}`}>{span.text}<footer>{span.sourceChapterId} · {span.start}-{span.end}</footer></blockquote>) : <p>沒有可定位的原文證據，因此不能核准。</p>}</details>
        {candidate.status === "validated_candidate" && <div><button type="button" disabled={reviewBusy} onClick={() => void approveCandidate(candidate)}>核准並寫入 Story Bible</button><button type="button" disabled={reviewBusy} onClick={() => void rejectCandidate(candidate)}>拒絕</button></div>}
        {candidate.status === "needs_review" && <div><p>這筆建議需要進一步處理，系統不會自動覆蓋既有事實。</p><button type="button" disabled={reviewBusy} onClick={() => void rejectCandidate(candidate)}>拒絕這筆建議</button></div>}
        {candidate.status === "committed" && <p>已由作者核准並保存版本紀錄。</p>}
        {candidate.status === "rejected" && <p>已拒絕，正式資料未改變。</p>}
      </article>)}
    </section>}
  </main>;
}
