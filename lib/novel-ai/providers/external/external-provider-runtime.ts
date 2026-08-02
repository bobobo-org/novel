import { createHash } from "node:crypto";
import type {
  ExternalAIGenerationRequest,
  ExternalAIGenerationResult,
  ExternalAIProviderId,
  ExternalAIProviderPublicStatus,
  ExternalAIStreamEvent,
} from "./external-provider-contract";

const DEFAULT_SYSTEM_INSTRUCTION =
  "你是諸天萬界小說生成系統的外接寫作模型。請使用繁體中文，遵守作品設定、角色知識邊界與使用者指定章節。輸出只是一筆候選內容；未經作者核准不得宣稱已寫入 Canon、Memory 或 Learning。";
const EXTERNAL_AI_TIMEOUT_MS = 90_000;
const EXTERNAL_AI_VERIFICATION_TIMEOUT_MS = 8_000;
const EXTERNAL_AI_STREAM_BUFFER_LIMIT = 1_048_576;
const EXTERNAL_AI_GENERATED_TEXT_LIMIT = 2_000_000;
const VERIFIED_STATUS_TTL_MS = 5 * 60 * 1_000;
const FAILED_STATUS_TTL_MS = 15_000;

type ProviderConfig = ExternalAIProviderPublicStatus & { apiKey: string };
type JsonRecord = Record<string, unknown>;
type Usage = ExternalAIGenerationResult["usage"];
type Generated = { text: string; usage: Usage; generatedTokenEvents: number };
type StreamEmitter = (event: ExternalAIStreamEvent) => void | Promise<void>;
type VerificationCacheEntry = { expiresAt: number; status: ExternalAIProviderPublicStatus };
type VerificationGlobal = typeof globalThis & {
  __novelExternalAIProviderVerification?: {
    cache: Map<string, VerificationCacheEntry>;
    pending: Map<string, Promise<ExternalAIProviderPublicStatus>>;
  };
};

export class ExternalAIProviderError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ExternalAIProviderError";
    this.code = code;
    this.status = status;
  }
}

function firstEnvironmentValue(names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function providerConfigs(): Record<ExternalAIProviderId, ProviderConfig> {
  const geminiKey = firstEnvironmentValue(["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]);
  return {
    openai: {
      id: "openai",
      label: "OpenAI API（ChatGPT 系列）",
      configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      verification: process.env.OPENAI_API_KEY?.trim() ? "configured_unverified" : "not_configured",
      verificationCode: process.env.OPENAI_API_KEY?.trim() ? "PROBE_REQUIRED" : "NOT_CONFIGURED",
      verifiedAt: null,
      checkedAt: null,
      modelId: process.env.OPENAI_MODEL_ID?.trim() || "gpt-5.6-sol",
      keyEnvironmentVariable: "OPENAI_API_KEY",
      modelEnvironmentVariable: "OPENAI_MODEL_ID",
      apiStyle: "Responses API",
      dataLeavesDevice: true,
      serverSideCredentialOnly: true,
      apiKey: process.env.OPENAI_API_KEY?.trim() || "",
    },
    gemini: {
      id: "gemini",
      label: "Google Gemini",
      configured: Boolean(geminiKey),
      verification: geminiKey ? "configured_unverified" : "not_configured",
      verificationCode: geminiKey ? "PROBE_REQUIRED" : "NOT_CONFIGURED",
      verifiedAt: null,
      checkedAt: null,
      modelId: process.env.GEMINI_MODEL_ID?.trim() || "gemini-3.6-flash",
      keyEnvironmentVariable: "GEMINI_API_KEY（亦接受 GOOGLE_GENERATIVE_AI_API_KEY）",
      modelEnvironmentVariable: "GEMINI_MODEL_ID",
      apiStyle: "Generate Content（stateless）",
      dataLeavesDevice: true,
      serverSideCredentialOnly: true,
      apiKey: geminiKey,
    },
    grok: {
      id: "grok",
      label: "xAI Grok",
      configured: Boolean(process.env.XAI_API_KEY?.trim()),
      verification: process.env.XAI_API_KEY?.trim() ? "configured_unverified" : "not_configured",
      verificationCode: process.env.XAI_API_KEY?.trim() ? "PROBE_REQUIRED" : "NOT_CONFIGURED",
      verifiedAt: null,
      checkedAt: null,
      modelId: process.env.XAI_MODEL_ID?.trim() || "grok-4.5",
      keyEnvironmentVariable: "XAI_API_KEY",
      modelEnvironmentVariable: "XAI_MODEL_ID",
      apiStyle: "Chat Completions streaming",
      dataLeavesDevice: true,
      serverSideCredentialOnly: true,
      apiKey: process.env.XAI_API_KEY?.trim() || "",
    },
    claude: {
      id: "claude",
      label: "Anthropic Claude",
      configured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
      verification: process.env.ANTHROPIC_API_KEY?.trim() ? "configured_unverified" : "not_configured",
      verificationCode: process.env.ANTHROPIC_API_KEY?.trim() ? "PROBE_REQUIRED" : "NOT_CONFIGURED",
      verifiedAt: null,
      checkedAt: null,
      modelId: process.env.ANTHROPIC_MODEL_ID?.trim() || "claude-sonnet-5",
      keyEnvironmentVariable: "ANTHROPIC_API_KEY",
      modelEnvironmentVariable: "ANTHROPIC_MODEL_ID",
      apiStyle: "Messages API",
      dataLeavesDevice: true,
      serverSideCredentialOnly: true,
      apiKey: process.env.ANTHROPIC_API_KEY?.trim() || "",
    },
  };
}

export function listExternalAIProviderStatus(): ExternalAIProviderPublicStatus[] {
  return Object.values(providerConfigs()).map(({ apiKey, ...publicStatus }) => {
    void apiKey;
    return publicStatus;
  });
}

function textFromResponsesPayload(payload: JsonRecord) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as JsonRecord).content) ? ((item as JsonRecord).content as unknown[]) : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as JsonRecord).text;
      if (typeof text === "string") chunks.push(text);
    }
  }
  return chunks.join("").trim();
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function usageFromResponsesPayload(payload: JsonRecord): Usage {
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as JsonRecord : {};
  const inputTokens = numberOrNull(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = numberOrNull(usage.output_tokens ?? usage.completion_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: numberOrNull(usage.total_tokens) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
  };
}

function emptyUsage(): Usage {
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}

function mergeUsage(current: Usage, next: Partial<Usage>): Usage {
  const inputTokens = next.inputTokens ?? current.inputTokens;
  const outputTokens = next.outputTokens ?? current.outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens: next.totalTokens ?? current.totalTokens
      ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
  };
}

function normalizeProviderFailure(error: unknown, controller: AbortController) {
  if (error instanceof ExternalAIProviderError) return error;
  if (controller.signal.aborted) {
    const cancelled = controller.signal.reason !== "EXTERNAL_AI_TIMEOUT";
    return new ExternalAIProviderError(
      cancelled ? "EXTERNAL_AI_CANCELLED" : "EXTERNAL_AI_TIMEOUT",
      cancelled ? "外接 AI 已由使用者取消，沒有建立候選。" : "外接 AI 已逾時，沒有建立候選。",
      cancelled ? 499 : 504,
    );
  }
  return new ExternalAIProviderError("EXTERNAL_AI_NETWORK_FAILED", "無法連線到外接 AI。請檢查伺服器網路後重試。", 502);
}

function providerHttpError(status: number, operation: "generation" | "stream" | "verification") {
  const action = operation === "verification" ? "驗證" : operation === "stream" ? "串流生成" : "生成";
  if (status === 401 || status === 403) {
    return new ExternalAIProviderError(
      "EXTERNAL_PROVIDER_AUTH_FAILED",
      `外接 AI ${action}未通過提供者授權；請由管理者更新伺服器憑證。`,
      502,
    );
  }
  if (status === 404) {
    return new ExternalAIProviderError(
      "EXTERNAL_PROVIDER_MODEL_UNAVAILABLE",
      `外接 AI ${action}找不到指定模型，請由管理者確認模型 ID 與帳號權限。`,
      502,
    );
  }
  if (status === 408) {
    return new ExternalAIProviderError("EXTERNAL_PROVIDER_TIMEOUT", `外接 AI ${action}逾時，請稍後重試。`, 504);
  }
  if (status === 429) {
    return new ExternalAIProviderError("EXTERNAL_PROVIDER_RATE_LIMITED", `外接 AI ${action}已達提供者額度或速率上限，請稍後重試。`, 429);
  }
  if (status >= 500) {
    return new ExternalAIProviderError("EXTERNAL_PROVIDER_UNAVAILABLE", `外接 AI ${action}服務暫時不可用，請稍後重試。`, 503);
  }
  return new ExternalAIProviderError(
    "EXTERNAL_PROVIDER_REJECTED",
    `外接 AI 拒絕${action}要求；正式作品沒有變更。`,
    502,
  );
}

function createLinkedController(signal?: AbortSignal, timeoutMs = EXTERNAL_AI_TIMEOUT_MS) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason || "EXTERNAL_AI_CANCELLED");
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort("EXTERNAL_AI_TIMEOUT"), timeoutMs);
  return {
    controller,
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

function publicProviderStatus(
  config: ProviderConfig,
  overrides: Partial<ExternalAIProviderPublicStatus> = {},
): ExternalAIProviderPublicStatus {
  const { apiKey, ...status } = config;
  void apiKey;
  return { ...status, ...overrides };
}

function providerVerificationState() {
  const target = globalThis as VerificationGlobal;
  target.__novelExternalAIProviderVerification ??= {
    cache: new Map(),
    pending: new Map(),
  };
  return target.__novelExternalAIProviderVerification;
}

function providerVerificationKey(config: ProviderConfig) {
  const credentialDigest = createHash("sha256").update(config.apiKey).digest("hex");
  return `${config.id}:${config.modelId}:${credentialDigest}`;
}

function providerVerificationRequest(config: ProviderConfig): { url: string; headers: HeadersInit } {
  if (config.id === "openai") {
    return {
      url: `https://api.openai.com/v1/models/${encodeURIComponent(config.modelId)}`,
      headers: { Authorization: `Bearer ${config.apiKey}` },
    };
  }
  if (config.id === "grok") {
    return {
      url: `https://api.x.ai/v1/models/${encodeURIComponent(config.modelId)}`,
      headers: { Authorization: `Bearer ${config.apiKey}` },
    };
  }
  if (config.id === "gemini") {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.modelId)}`,
      headers: { "x-goog-api-key": config.apiKey },
    };
  }
  return {
    url: `https://api.anthropic.com/v1/models/${encodeURIComponent(config.modelId)}`,
    headers: { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
  };
}

function verifiedModelIdentifier(config: ProviderConfig, payload: JsonRecord) {
  if (config.id === "gemini") {
    const supported = Array.isArray(payload.supportedGenerationMethods)
      ? payload.supportedGenerationMethods
      : [];
    if (!supported.includes("generateContent")) return "";
    return typeof payload.name === "string" ? payload.name : "";
  }
  return typeof payload.id === "string" ? payload.id : "";
}

async function verifyProvider(config: ProviderConfig): Promise<ExternalAIProviderPublicStatus> {
  const checkedAt = new Date().toISOString();
  const linked = createLinkedController(undefined, EXTERNAL_AI_VERIFICATION_TIMEOUT_MS);
  try {
    const request = providerVerificationRequest(config);
    const response = await fetch(request.url, {
      method: "GET",
      headers: request.headers,
      signal: linked.controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw providerHttpError(response.status, "verification");
    const payload = await response.json().catch(() => null) as JsonRecord | null;
    if (!payload || typeof payload !== "object" || !verifiedModelIdentifier(config, payload)) {
      throw new ExternalAIProviderError(
        "EXTERNAL_PROVIDER_VERIFICATION_INVALID_RESPONSE",
        "外接 AI 模型驗證回應不完整。",
        502,
      );
    }
    return publicProviderStatus(config, {
      verification: "verified",
      verificationCode: "MODEL_ACCESS_VERIFIED",
      verifiedAt: checkedAt,
      checkedAt,
    });
  } catch (error) {
    const normalized = normalizeProviderFailure(error, linked.controller);
    return publicProviderStatus(config, {
      verification: "failed",
      verificationCode: normalized.code === "EXTERNAL_AI_TIMEOUT"
        ? "EXTERNAL_PROVIDER_VERIFICATION_TIMEOUT"
        : normalized.code,
      verifiedAt: null,
      checkedAt,
    });
  } finally {
    linked.cleanup();
  }
}

export async function verifyExternalAIProviderStatus(
  providerIds: ExternalAIProviderId[] = ["openai", "gemini", "grok", "claude"],
): Promise<ExternalAIProviderPublicStatus[]> {
  const selected = new Set(providerIds);
  const current = providerVerificationState();
  const configs = Object.values(providerConfigs()).filter((config) => selected.has(config.id));
  return Promise.all(configs.map(async (config) => {
    if (!config.apiKey) return publicProviderStatus(config);
    const key = providerVerificationKey(config);
    const cached = current.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.status;
    const alreadyPending = current.pending.get(key);
    if (alreadyPending) return alreadyPending;
    const pending = verifyProvider(config).then((status) => {
      current.cache.set(key, {
        status,
        expiresAt: Date.now() + (status.verification === "verified" ? VERIFIED_STATUS_TTL_MS : FAILED_STATUS_TTL_MS),
      });
      return status;
    }).finally(() => current.pending.delete(key));
    current.pending.set(key, pending);
    return pending;
  }));
}

export function resetExternalAIProviderVerificationCacheForTests() {
  const target = globalThis as VerificationGlobal;
  delete target.__novelExternalAIProviderVerification;
}

async function postJson(url: string, init: RequestInit, signal?: AbortSignal) {
  const linked = createLinkedController(signal);
  try {
    const response = await fetch(url, { ...init, signal: linked.controller.signal, cache: "no-store" });
    if (!response.ok) throw providerHttpError(response.status, "generation");
    const payload = await response.json().catch(() => null) as JsonRecord | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new ExternalAIProviderError("EXTERNAL_PROVIDER_INVALID_RESPONSE", "外接 AI 回傳格式不完整，正式作品沒有變更。", 502);
    }
    return payload;
  } catch (error) {
    throw normalizeProviderFailure(error, linked.controller);
  } finally {
    linked.cleanup();
  }
}

async function postEventStream(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  onFrame: (eventName: string, payload: JsonRecord) => void | Promise<void>,
) {
  const linked = createLinkedController(signal);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const response = await fetch(url, { ...init, signal: linked.controller.signal, cache: "no-store" });
    if (!response.ok) throw providerHttpError(response.status, "stream");
    if (!response.body) {
      throw new ExternalAIProviderError("EXTERNAL_AI_STREAM_UNAVAILABLE", "外接 AI 沒有提供可讀取的串流。", 502);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (contentType && !contentType.includes("text/event-stream")) {
      throw new ExternalAIProviderError("EXTERNAL_AI_STREAM_INVALID", "外接 AI 沒有回傳有效的事件串流。", 502);
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const processFrame = async (frame: string) => {
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      const data = dataLines.join("\n").trim();
      if (!data || data === "[DONE]") return;
      let payload: JsonRecord;
      try {
        payload = JSON.parse(data) as JsonRecord;
      } catch {
        throw new ExternalAIProviderError("EXTERNAL_AI_STREAM_INVALID", "外接 AI 回傳了無法解析的串流資料。", 502);
      }
      await onFrame(eventName, payload);
      if (linked.controller.signal.aborted) throw linked.controller.signal.reason;
    };
    while (true) {
      if (linked.controller.signal.aborted) throw linked.controller.signal.reason;
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > EXTERNAL_AI_STREAM_BUFFER_LIMIT) {
        throw new ExternalAIProviderError("EXTERNAL_AI_STREAM_TOO_LARGE", "外接 AI 串流框架超過安全上限，已停止本次工作。", 502);
      }
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || "";
      for (const frame of frames) await processFrame(frame);
      if (done) break;
    }
    if (buffer.trim()) await processFrame(buffer);
  } catch (error) {
    throw normalizeProviderFailure(error, linked.controller);
  } finally {
    linked.cleanup();
    if (reader) await reader.cancel().catch(() => undefined);
  }
}

async function runResponsesProvider(config: ProviderConfig, request: ExternalAIGenerationRequest, baseUrl: string) {
  const payload = await postJson(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.modelId,
      instructions: request.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION,
      input: [{ role: "user", content: request.prompt }],
      store: false,
      max_output_tokens: request.maxOutputTokens,
      ...(config.id === "openai" && request.safetyIdentifier
        ? { safety_identifier: request.safetyIdentifier }
        : {}),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    }),
  }, request.signal);
  return { text: textFromResponsesPayload(payload), usage: usageFromResponsesPayload(payload), generatedTokenEvents: 1 };
}

async function runGemini(config: ProviderConfig, request: ExternalAIGenerationRequest) {
  const payload = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.modelId)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: {
          maxOutputTokens: request.maxOutputTokens,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        },
      }),
    },
    request.signal,
  );
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const text = candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const content = (candidate as JsonRecord).content;
    if (!content || typeof content !== "object") return [];
    const parts = Array.isArray((content as JsonRecord).parts) ? (content as JsonRecord).parts as unknown[] : [];
    return parts.flatMap((part) => part && typeof part === "object" && typeof (part as JsonRecord).text === "string" ? [(part as JsonRecord).text as string] : []);
  }).join("").trim();
  const metadata = payload.usageMetadata && typeof payload.usageMetadata === "object" ? payload.usageMetadata as JsonRecord : {};
  return {
    text,
    usage: {
      inputTokens: numberOrNull(metadata.promptTokenCount),
      outputTokens: numberOrNull(metadata.candidatesTokenCount),
      totalTokens: numberOrNull(metadata.totalTokenCount),
    },
    generatedTokenEvents: 1,
  };
}

async function runClaude(config: ProviderConfig, request: ExternalAIGenerationRequest) {
  const payload = await postJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.modelId,
      max_tokens: request.maxOutputTokens || 2048,
      system: request.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION,
      messages: [{ role: "user", content: request.prompt }],
    }),
  }, request.signal);
  const content = Array.isArray(payload.content) ? payload.content : [];
  const text = content.flatMap((part) => part && typeof part === "object" && typeof (part as JsonRecord).text === "string" ? [(part as JsonRecord).text as string] : []).join("").trim();
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as JsonRecord : {};
  const inputTokens = numberOrNull(usage.input_tokens);
  const outputTokens = numberOrNull(usage.output_tokens);
  return {
    text,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null },
    generatedTokenEvents: 1,
  };
}

function normalizedExternalRequest(request: ExternalAIGenerationRequest) {
  if (request.executionMode === "closed-only") {
    throw new ExternalAIProviderError("EXTERNAL_AI_BLOCKED_BY_MODE", "目前是全閉端模式，系統不會送出任何外接 AI 要求。", 409);
  }
  if (!request.externalConsent) {
    throw new ExternalAIProviderError("EXTERNAL_AI_CONSENT_REQUIRED", "送出內容前必須明確同意資料離開裝置。", 403);
  }
  const prompt = request.prompt.trim();
  if (!prompt) throw new ExternalAIProviderError("EXTERNAL_AI_PROMPT_REQUIRED", "請輸入要交給外接 AI 的內容。", 400);
  if (prompt.length > 120_000) throw new ExternalAIProviderError("EXTERNAL_AI_PROMPT_TOO_LARGE", "外接內容超過 120,000 字元，請先縮小範圍。", 413);
  if ((request.systemInstruction?.length || 0) > 12_000) throw new ExternalAIProviderError("EXTERNAL_AI_SYSTEM_TOO_LARGE", "系統指示超過 12,000 字元。", 413);
  if (request.signal?.aborted) {
    throw new ExternalAIProviderError("EXTERNAL_AI_CANCELLED", "外接 AI 已由使用者取消，沒有建立候選。", 499);
  }
  const config = providerConfigs()[request.providerId];
  if (!config.apiKey) {
    throw new ExternalAIProviderError("EXTERNAL_AI_NOT_CONFIGURED", `${config.label} 尚未在伺服器設定 ${config.keyEnvironmentVariable}。`, 503);
  }
  return {
    config,
    request: {
      ...request,
      prompt,
      requestId: request.requestId?.trim().slice(0, 128) || undefined,
      safetyIdentifier: request.safetyIdentifier
        ?.replace(/[^A-Za-z0-9_.:-]/gu, "_")
        .slice(0, 64),
      maxOutputTokens: Math.max(64, Math.min(8192, Math.round(request.maxOutputTokens || 2048))),
      temperature: request.temperature === undefined ? undefined : Math.max(0, Math.min(2, request.temperature)),
    },
  };
}

function buildResult(
  request: ExternalAIGenerationRequest,
  config: ProviderConfig,
  generated: Generated,
  requestId: string,
  startedAt: number,
): ExternalAIGenerationResult {
  const text = generated.text.trim();
  if (!text) {
    throw new ExternalAIProviderError("EXTERNAL_AI_EMPTY_RESPONSE", "外接 AI 沒有回傳可用文字，正式作品沒有變更。", 502);
  }
  if (text.length > EXTERNAL_AI_GENERATED_TEXT_LIMIT) {
    throw new ExternalAIProviderError("EXTERNAL_AI_OUTPUT_TOO_LARGE", "外接 AI 輸出超過安全上限，正式作品沒有變更。", 502);
  }
  return {
    requestId,
    providerId: request.providerId,
    modelId: config.modelId,
    text,
    candidateOnly: true,
    dataLeavesDevice: true,
    externalRequest: true,
    serverStoredByApplication: false,
    elapsedMs: Date.now() - startedAt,
    generatedTokenEvents: generated.generatedTokenEvents,
    usage: generated.usage,
  };
}

export async function generateExternalAICandidate(request: ExternalAIGenerationRequest): Promise<ExternalAIGenerationResult> {
  const normalized = normalizedExternalRequest(request);
  const startedAt = Date.now();
  const generated = request.providerId === "openai"
    ? await runResponsesProvider(normalized.config, normalized.request, "https://api.openai.com")
    : request.providerId === "grok"
      ? await runResponsesProvider(normalized.config, normalized.request, "https://api.x.ai")
      : request.providerId === "gemini"
        ? await runGemini(normalized.config, normalized.request)
        : await runClaude(normalized.config, normalized.request);
  return buildResult(normalized.request, normalized.config, generated, normalized.request.requestId || crypto.randomUUID(), startedAt);
}

async function emitDelta(
  delta: string,
  state: { text: string; generatedTokenEvents: number },
  emit: StreamEmitter,
) {
  if (!delta) return;
  if (state.text.length + delta.length > EXTERNAL_AI_GENERATED_TEXT_LIMIT) {
    throw new ExternalAIProviderError("EXTERNAL_AI_OUTPUT_TOO_LARGE", "外接 AI 輸出超過安全上限，已停止本次工作。", 502);
  }
  state.text += delta;
  state.generatedTokenEvents += 1;
  await emit({ type: "delta", delta, generatedTokenEvents: state.generatedTokenEvents });
}

async function streamOpenAI(
  config: ProviderConfig,
  request: ExternalAIGenerationRequest,
  emit: StreamEmitter,
): Promise<Generated> {
  const state = { text: "", generatedTokenEvents: 0 };
  let usage = emptyUsage();
  await postEventStream("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.modelId,
      instructions: request.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION,
      input: [{ role: "user", content: request.prompt }],
      store: false,
      stream: true,
      max_output_tokens: request.maxOutputTokens,
      ...(request.safetyIdentifier ? { safety_identifier: request.safetyIdentifier } : {}),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    }),
  }, request.signal, async (_eventName, payload) => {
    if (payload.type === "response.output_text.delta" && typeof payload.delta === "string") {
      await emitDelta(payload.delta, state, emit);
    } else if (payload.type === "response.completed") {
      const response = payload.response && typeof payload.response === "object" ? payload.response as JsonRecord : {};
      usage = mergeUsage(usage, usageFromResponsesPayload(response));
    } else if (payload.type === "response.failed" || payload.type === "error") {
      throw new ExternalAIProviderError("EXTERNAL_PROVIDER_STREAM_FAILED", "OpenAI 串流未完成，沒有建立候選。", 502);
    }
  });
  return { ...state, usage };
}

async function streamGrok(
  config: ProviderConfig,
  request: ExternalAIGenerationRequest,
  emit: StreamEmitter,
): Promise<Generated> {
  const state = { text: "", generatedTokenEvents: 0 };
  let usage = emptyUsage();
  await postEventStream("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.modelId,
      messages: [
        { role: "system", content: request.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION },
        { role: "user", content: request.prompt },
      ],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: request.maxOutputTokens,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    }),
  }, request.signal, async (_eventName, payload) => {
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = choices[0] && typeof choices[0] === "object" ? choices[0] as JsonRecord : {};
    const delta = first.delta && typeof first.delta === "object" ? first.delta as JsonRecord : {};
    if (typeof delta.content === "string") await emitDelta(delta.content, state, emit);
    if (payload.usage && typeof payload.usage === "object") usage = mergeUsage(usage, usageFromResponsesPayload(payload));
  });
  return { ...state, usage };
}

async function streamGemini(
  config: ProviderConfig,
  request: ExternalAIGenerationRequest,
  emit: StreamEmitter,
): Promise<Generated> {
  const state = { text: "", generatedTokenEvents: 0 };
  let usage = emptyUsage();
  await postEventStream(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.modelId)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: {
          maxOutputTokens: request.maxOutputTokens,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        },
      }),
    },
    request.signal,
    async (_eventName, payload) => {
      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") continue;
        const content = (candidate as JsonRecord).content;
        if (!content || typeof content !== "object") continue;
        const parts = Array.isArray((content as JsonRecord).parts) ? (content as JsonRecord).parts as unknown[] : [];
        for (const part of parts) {
          if (part && typeof part === "object" && typeof (part as JsonRecord).text === "string") {
            await emitDelta((part as JsonRecord).text as string, state, emit);
          }
        }
      }
      const metadata = payload.usageMetadata && typeof payload.usageMetadata === "object" ? payload.usageMetadata as JsonRecord : {};
      usage = mergeUsage(usage, {
        inputTokens: numberOrNull(metadata.promptTokenCount),
        outputTokens: numberOrNull(metadata.candidatesTokenCount),
        totalTokens: numberOrNull(metadata.totalTokenCount),
      });
    },
  );
  return { ...state, usage };
}

async function streamClaude(
  config: ProviderConfig,
  request: ExternalAIGenerationRequest,
  emit: StreamEmitter,
): Promise<Generated> {
  const state = { text: "", generatedTokenEvents: 0 };
  let usage = emptyUsage();
  await postEventStream("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.modelId,
      max_tokens: request.maxOutputTokens || 2048,
      system: request.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION,
      messages: [{ role: "user", content: request.prompt }],
      stream: true,
    }),
  }, request.signal, async (eventName, payload) => {
    const type = typeof payload.type === "string" ? payload.type : eventName;
    if (type === "content_block_delta") {
      const delta = payload.delta && typeof payload.delta === "object" ? payload.delta as JsonRecord : {};
      if (delta.type === "text_delta" && typeof delta.text === "string") await emitDelta(delta.text, state, emit);
    } else if (type === "message_start") {
      const message = payload.message && typeof payload.message === "object" ? payload.message as JsonRecord : {};
      const startUsage = message.usage && typeof message.usage === "object" ? message.usage as JsonRecord : {};
      usage = mergeUsage(usage, { inputTokens: numberOrNull(startUsage.input_tokens) });
    } else if (type === "message_delta") {
      const deltaUsage = payload.usage && typeof payload.usage === "object" ? payload.usage as JsonRecord : {};
      usage = mergeUsage(usage, { outputTokens: numberOrNull(deltaUsage.output_tokens) });
    } else if (type === "error") {
      throw new ExternalAIProviderError("EXTERNAL_PROVIDER_STREAM_FAILED", "Claude 串流未完成，沒有建立候選。", 502);
    }
  });
  return { ...state, usage };
}

export async function streamExternalAICandidate(
  request: ExternalAIGenerationRequest,
  emit: StreamEmitter,
): Promise<ExternalAIGenerationResult> {
  const normalized = normalizedExternalRequest(request);
  const requestId = normalized.request.requestId || crypto.randomUUID();
  const startedAt = Date.now();
  await emit({ type: "start", requestId, providerId: request.providerId, modelId: normalized.config.modelId });
  const generated = request.providerId === "openai"
    ? await streamOpenAI(normalized.config, normalized.request, emit)
    : request.providerId === "grok"
      ? await streamGrok(normalized.config, normalized.request, emit)
      : request.providerId === "gemini"
        ? await streamGemini(normalized.config, normalized.request, emit)
        : await streamClaude(normalized.config, normalized.request, emit);
  const result = buildResult(normalized.request, normalized.config, generated, requestId, startedAt);
  await emit({ type: "complete", result });
  return result;
}
