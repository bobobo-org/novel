import { AiProviderError } from "../provider-errors";
import type {
  ClosedAICacheInvalidation,
  ClosedAINamespace,
} from "../../closed-ai-cache";
import {
  clearClosedAITabSession,
  readClosedAITabSession,
  saveClosedAITabSession,
} from "../closed/tab-session-recovery";

export const LOCAL_BRIDGE_PROTOCOL = "novel-local-bridge/v1";
const DEFAULT_ENDPOINT = "http://127.0.0.1:3217";
const BRIDGE_CONTROL_TIMEOUT_MS = 5_000;
const CONTROL_CACHE_TTL_MS = 1_500;
const LOOPBACK_DIAGNOSTIC_ENDPOINTS = ["http://127.0.0.1:3217", "http://localhost:3217", "http://[::1]:3217"] as const;

export type LocalBridgeSession = { token: string; csrf: string; instanceId: string; expiresAt: string };
export type LocalBridgeEvent = { type: "started" | "token" | "metadata" | "completed" | "cancelled" | "failed"; requestId?: string; text?: string; errorCode?: string; [key: string]: unknown };
export type ReportedModelValue<T> = {
  value?: T;
  source?: "reported" | "derived" | "unknown" | string;
};

export type LocalTextModel = {
  modelId: string;
  modelDigest?: string | null;
  family?: ReportedModelValue<string | null>;
  parameterSize?: ReportedModelValue<string | null>;
  quantization?: ReportedModelValue<string | null>;
  contextLength?: ReportedModelValue<number | null>;
  diskSize?: ReportedModelValue<number | null>;
  modifiedAt?: ReportedModelValue<string | null>;
  capabilities?: {
    textGeneration?: ReportedModelValue<boolean>;
    chat?: ReportedModelValue<boolean>;
    embeddings?: ReportedModelValue<boolean>;
    toolUse?: ReportedModelValue<boolean>;
    structuredOutput?: ReportedModelValue<boolean>;
    vision?: ReportedModelValue<boolean>;
    streaming?: ReportedModelValue<boolean>;
  };
};
export type LocalModelInferenceProof = {
  proofVersion: "local-model-inference-proof-v1";
  state: "inference_verified";
  providerKind: "local_ollama";
  instanceId: string;
  modelId: string;
  modelDigest: string | null;
  verifiedAt: string;
  latencyMs: number;
  outputDigest: string;
  outputBytes: number;
  evalCount: number | null;
  externalRequest: false;
  dataLeftDevice: false;
};
type LocalBridgeBody = Record<string, unknown> & {
  errorCode?: string;
  message?: string;
  retryable?: boolean;
  models: LocalTextModel[];
  configuredOrigins: string[];
  bridgeProcessAlive?: boolean;
  pairingState?: string;
  ollamaReachable?: boolean;
  modelAvailable?: boolean;
  runtimeReady?: boolean;
  protocolVersion?: string;
  token?: string;
  csrf?: string;
  instanceId?: string;
  expiresAt?: string;
  proofVersion?: string;
  state?: string;
  providerKind?: string;
  modelId?: string;
  modelDigest?: string | null;
  verifiedAt?: string;
  latencyMs?: number;
  outputDigest?: string;
  outputBytes?: number;
  evalCount?: number | null;
  externalRequest?: boolean;
  dataLeftDevice?: boolean;
  cache?: { entries?: number; hits?: number; misses?: number };
  limits?: {
    maxPromptBytes?: number;
    maxOutputTokens?: number;
    maxConcurrent?: number;
    maxQueue?: number;
  };
  workload?: {
    active?: number;
    queued?: number;
    maxConcurrent?: number;
    maxQueue?: number;
  };
};

export function selectAvailableTextModel(models: LocalTextModel[], preferredModelId: string) {
  const available = models.filter((model) => model.capabilities?.textGeneration?.value === true);
  return available.find((model) => model.modelId === preferredModelId)?.modelId ?? available[0]?.modelId ?? null;
}

export function snapshotLocalModelForRequest(requestId: string, modelId: string) {
  if (!requestId || !modelId) throw new AiProviderError("OLLAMA_MODEL_NOT_FOUND", "A request requires an available model snapshot.", { retryable: false });
  return Object.freeze({ requestId, modelId });
}

function normalizeBridgeEndpoint(value = DEFAULT_ENDPOINT) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "3217" || url.pathname !== "/" || url.search || url.hash) {
    throw new AiProviderError("LOCAL_SECURITY_POLICY_VIOLATION", "Local Bridge endpoint must be exactly http://127.0.0.1:3217", { retryable: false });
  }
  return url.origin;
}

function controlSignal(signal?: AbortSignal) {
  const timeoutSignal = AbortSignal.timeout(BRIDGE_CONTROL_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

type LocalNetworkPermissionState = PermissionState | "unsupported";
type PermissionStateReader = () => Promise<LocalNetworkPermissionState>;

const BRIDGE_EVENT_TYPES = new Set(["started", "token", "metadata", "completed", "cancelled", "failed"]);

export function parseLocalBridgeJson(text: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new AiProviderError("OLLAMA_INVALID_RESPONSE", "本機創作助手傳回的資料格式不正確，請重新啟動後再試。", { retryable: true, stage: "local-bridge-response" }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiProviderError("OLLAMA_INVALID_RESPONSE", "本機創作助手傳回的資料不完整，請重新嘗試。", { retryable: true, stage: "local-bridge-response" });
  }
  return value as Record<string, unknown>;
}

export function validateLocalBridgeEvent(
  value: unknown,
  expectedRequestId: string,
  state: { started: boolean; completed: boolean },
): LocalBridgeEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiProviderError("OLLAMA_INVALID_RESPONSE", "本機 AI 回應格式不正確，請重新嘗試。", { retryable: true, stage: "local-bridge-stream" });
  }
  const event = value as LocalBridgeEvent;
  if (!BRIDGE_EVENT_TYPES.has(String(event.type || ""))) {
    throw new AiProviderError("OLLAMA_INVALID_RESPONSE", "本機 AI 回應包含無法辨識的資料。", { retryable: true, stage: "local-bridge-stream" });
  }
  if (event.requestId && event.requestId !== expectedRequestId) {
    throw new AiProviderError("LOCAL_REQUEST_IDENTITY_MISMATCH", "本機 AI 回應與這次請求不一致，已停止套用結果。", { retryable: true, stage: "local-bridge-stream" });
  }
  if (state.completed) {
    throw new AiProviderError("OLLAMA_INVALID_RESPONSE", "本機 AI 傳回重複或過期的完成結果，已停止套用。", { retryable: true, stage: "local-bridge-stream" });
  }
  if (event.type === "started") {
    if (state.started) throw new AiProviderError("OLLAMA_INVALID_RESPONSE", "本機 AI 重複啟動同一項工作，已停止套用。", { retryable: true, stage: "local-bridge-stream" });
    state.started = true;
  } else if (!state.started) {
    throw new AiProviderError("OLLAMA_INVALID_RESPONSE", "本機 AI 回應順序不正確，已停止套用。", { retryable: true, stage: "local-bridge-stream" });
  }
  if (event.type === "completed" || event.type === "cancelled" || event.type === "failed") state.completed = true;
  return event;
}

export function assertLocalBridgeStreamCompleted(state: { started: boolean; completed: boolean }) {
  if (!state.started || !state.completed) {
    throw new AiProviderError("OLLAMA_STREAM_INTERRUPTED", "本機 AI 連線在完成前中斷，請重新嘗試。", { retryable: true, stage: "local-bridge-stream" });
  }
}

export function resolveLocalNetworkPermissionStates(
  supportedStates: readonly PermissionState[],
): LocalNetworkPermissionState {
  if (supportedStates.includes("granted")) return "granted";
  if (supportedStates.length && supportedStates.every((state) => state === "denied")) {
    return "denied";
  }
  return supportedStates.length ? "prompt" : "unsupported";
}

async function readLocalNetworkPermissionState(): Promise<LocalNetworkPermissionState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unsupported";
  const supportedStates: PermissionState[] = [];
  for (const name of ["loopback-network", "local-network-access"]) {
    try {
      const status = await navigator.permissions.query({ name } as PermissionDescriptor);
      supportedStates.push(status.state);
    } catch {
      // Chromium versions expose either the split permission or its legacy alias.
    }
  }
  return resolveLocalNetworkPermissionStates(supportedStates);
}

export async function classifyBridgeConnectivityError(
  error: unknown,
  signal: AbortSignal,
  readPermissionState: PermissionStateReader = readLocalNetworkPermissionState,
) {
  if (await readPermissionState() === "denied") {
    return new AiProviderError("LOCAL_NETWORK_PERMISSION_DENIED", "The user denied Local Network Access for this site.", { retryable: false, stage: "local-network-permission" });
  }
  if (signal.aborted) return new AiProviderError("REQUEST_TIMEOUT", "Local Bridge request timed out before a response was received.", { retryable: true, stage: "local-bridge-connect" });
  if (error instanceof AiProviderError) return error;
  return new AiProviderError("BRIDGE_PROCESS_UNREACHABLE", "The browser could not reach the Local Bridge loopback endpoint.", { retryable: true, stage: "local-bridge-connect" });
}

export class LocalBridgeClient {
  readonly endpoint: string;
  readonly origin: string;
  private session: LocalBridgeSession | null = null;
  private modelVerification: LocalModelInferenceProof | null = null;
  private healthCache: { expiresAt: number; value: LocalBridgeBody } | null = null;
  private modelsCache: { expiresAt: number; value: LocalBridgeBody } | null = null;
  private healthInFlight: Promise<LocalBridgeBody> | null = null;
  private modelsInFlight: Promise<LocalBridgeBody> | null = null;
  private cacheEpoch = 0;
  private rememberWithinTab = false;
  private readonly tabStorage: Storage | null | undefined;

  constructor(options: {
    endpoint?: string;
    origin?: string;
    session?: LocalBridgeSession;
    tabStorage?: Storage | null;
    rememberWithinTab?: boolean;
  } = {}) {
    this.endpoint = normalizeBridgeEndpoint(options.endpoint);
    this.origin = options.origin ?? "https://novel-orcin.vercel.app";
    this.session = options.session ?? null;
    this.tabStorage = options.tabStorage;
    this.rememberWithinTab = options.rememberWithinTab ?? false;
  }

  setSession(session: LocalBridgeSession | null) {
    if (!session || session.instanceId !== this.session?.instanceId) this.modelVerification = null;
    this.session = session;
    this.clearControlPlaneCache();
  }
  getSessionMetadata() { return this.session ? { instanceId: this.session.instanceId, expiresAt: this.session.expiresAt } : null; }
  getModelVerification(modelId?: string) {
    if (!this.modelVerification || !this.session) return null;
    if (this.modelVerification.instanceId !== this.session.instanceId) return null;
    if (modelId && this.modelVerification.modelId !== modelId) return null;
    return { ...this.modelVerification };
  }

  setRememberWithinTab(enabled: boolean) {
    this.rememberWithinTab = enabled;
    if (!enabled) clearClosedAITabSession("local-ollama", this.tabStorage);
  }

  getRememberWithinTab() {
    return this.rememberWithinTab;
  }

  clearRememberedSession() {
    clearClosedAITabSession("local-ollama", this.tabStorage);
  }

  private saveRememberedSession(
    modelId: string | null = null,
    modelDigest: string | null = null,
  ) {
    if (!this.rememberWithinTab || !this.session) return false;
    return saveClosedAITabSession({
      schemaVersion: "closed-ai-tab-session-v1",
      backend: "local-ollama",
      protocolVersion: LOCAL_BRIDGE_PROTOCOL,
      origin: this.origin,
      endpoint: this.endpoint,
      instanceId: this.session.instanceId,
      expiresAt: this.session.expiresAt,
      session: {
        token: this.session.token,
        csrf: this.session.csrf,
      },
      modelId,
      modelDigest,
      savedAt: new Date().toISOString(),
    }, this.tabStorage);
  }

  async restoreRememberedSession(signal?: AbortSignal) {
    const remembered = readClosedAITabSession({
      backend: "local-ollama",
      protocolVersion: LOCAL_BRIDGE_PROTOCOL,
      origin: this.origin,
      endpoint: this.endpoint,
    }, this.tabStorage);
    if (!remembered) return null;
    this.rememberWithinTab = true;
    this.setSession({
      token: remembered.session.token,
      csrf: remembered.session.csrf,
      instanceId: remembered.instanceId,
      expiresAt: remembered.expiresAt,
    });
    try {
      const health = await this.health(signal);
      if (
        health.protocolVersion !== LOCAL_BRIDGE_PROTOCOL
        || health.instanceId !== remembered.instanceId
      ) {
        throw new AiProviderError(
          "LOCAL_REQUEST_IDENTITY_MISMATCH",
          "Local Bridge instance changed after the page was reloaded.",
          { retryable: false, stage: "local-session-recovery" },
        );
      }
      const modelResponse = await this.models(signal);
      const models = modelResponse.models ?? [];
      const selected = models.find((model) =>
        model.modelId === remembered.modelId
        && model.modelDigest === remembered.modelDigest
        && model.capabilities?.textGeneration?.value === true)
        ?? models.find((model) =>
          model.capabilities?.textGeneration?.value === true)
        ?? null;
      if (!selected) {
        throw new AiProviderError(
          "OLLAMA_MODEL_NOT_FOUND",
          "No text model is available for the restored Local Bridge session.",
          { retryable: true, stage: "local-session-recovery" },
        );
      }
      const proof = await this.verifyModel(selected.modelId, signal);
      if (
        proof.instanceId !== remembered.instanceId
        || proof.modelId !== selected.modelId
        || proof.modelDigest !== (selected.modelDigest ?? null)
      ) {
        throw new AiProviderError(
          "LOCAL_REQUEST_IDENTITY_MISMATCH",
          "The restored Local Bridge model proof does not match the current model.",
          { retryable: false, stage: "local-session-recovery" },
        );
      }
      this.saveRememberedSession(
        selected.modelId,
        selected.modelDigest ?? null,
      );
      return {
        session: this.getSessionMetadata(),
        model: structuredClone(selected),
        proof,
      };
    } catch (error) {
      this.setSession(null);
      this.clearRememberedSession();
      throw error;
    }
  }

  clearControlPlaneCache() {
    this.cacheEpoch += 1;
    this.healthCache = null;
    this.modelsCache = null;
    this.healthInFlight = null;
    this.modelsInFlight = null;
  }

  private headers(authenticated = false, write = false) {
    const headers: Record<string, string> = { "X-Bridge-Protocol": LOCAL_BRIDGE_PROTOCOL };
    if (typeof window === "undefined") headers.Origin = this.origin;
    if (authenticated) {
      if (!this.session) throw new AiProviderError("BRIDGE_NOT_PAIRED", "Local Bridge is not paired.", { retryable: false });
      headers.Authorization = `Bearer ${this.session.token}`;
      if (write) headers["X-Bridge-CSRF"] = this.session.csrf;
    }
    return headers;
  }

  private async fetchBridge(url: string, init: RequestInit = {}, signal?: AbortSignal) {
    const boundedSignal = controlSignal(signal);
    try { return await fetch(url, { ...init, signal: boundedSignal }); }
    catch (error) { throw await classifyBridgeConnectivityError(error, boundedSignal); }
  }

  private async parse(response: Response): Promise<LocalBridgeBody> {
    const body = parseLocalBridgeJson(await response.text()) as LocalBridgeBody;
    if (!response.ok) throw new AiProviderError((body.errorCode || "LOCAL_PROVIDER_NOT_READY") as AiProviderError["code"], String(body.message || `Local Bridge HTTP ${response.status}`), { retryable: Boolean(body.retryable), stage: "local-bridge" });
    return body;
  }

  private async fetchHealth(signal?: AbortSignal) {
    try {
      return this.parse(await this.fetchBridge(`${this.endpoint}/health`, { headers: this.headers(), cache: "no-store" }, signal));
    } catch (error) {
      if (signal?.aborted || !(error instanceof AiProviderError) || !error.retryable) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return this.parse(await this.fetchBridge(`${this.endpoint}/health`, { headers: this.headers(), cache: "no-store" }, signal));
    }
  }

  async health(signal?: AbortSignal) {
    const now = Date.now();
    if (!signal && this.healthCache && this.healthCache.expiresAt > now) {
      return structuredClone(this.healthCache.value);
    }
    if (!signal && this.healthInFlight) {
      return structuredClone(await this.healthInFlight);
    }
    const epoch = this.cacheEpoch;
    const operation = this.fetchHealth(signal);
    if (!signal) this.healthInFlight = operation;
    try {
      const value = await operation;
      if (!signal && epoch === this.cacheEpoch) {
        this.healthCache = {
          expiresAt: Date.now() + CONTROL_CACHE_TTL_MS,
          value: structuredClone(value),
        };
      }
      return structuredClone(value);
    } finally {
      if (!signal && this.healthInFlight === operation) this.healthInFlight = null;
    }
  }

  async diagnoseConnectivity(signal?: AbortSignal) {
    const results: Array<{ endpoint: string; reachable: boolean; status: number | null; errorCode: string | null; elapsedMs: number }> = [];
    for (const endpoint of LOOPBACK_DIAGNOSTIC_ENDPOINTS) {
      const startedAt = performance.now();
      const probeTimeout = AbortSignal.timeout(1_500);
      const probeSignal = signal ? AbortSignal.any([signal, probeTimeout]) : probeTimeout;
      try {
        const response = await this.fetchBridge(`${endpoint}/health`, { headers: this.headers(), cache: "no-store" }, probeSignal);
        const body = await response.json().catch(() => ({}));
        results.push({ endpoint, reachable: response.ok, status: response.status, errorCode: response.ok ? null : String(body.errorCode || "LOCAL_PROVIDER_NOT_READY"), elapsedMs: Math.round(performance.now() - startedAt) });
      } catch (error) {
        results.push({ endpoint, reachable: false, status: null, errorCode: String((error as { code?: string })?.code || "BRIDGE_PROCESS_UNREACHABLE"), elapsedMs: Math.round(performance.now() - startedAt) });
      }
    }
    return { origin: this.origin, securePage: typeof window !== "undefined" ? window.isSecureContext : null, results };
  }

  async requestPairing(signal?: AbortSignal) {
    const result = await this.parse(await this.fetchBridge(`${this.endpoint}/pair/request`, { method: "POST", headers: { ...this.headers(), "Content-Type": "application/json" }, body: "{}" }, signal));
    this.clearControlPlaneCache();
    return result;
  }

  async confirmPairing(pairingId: string, code: string, signal?: AbortSignal) {
    const session = await this.parse(await this.fetchBridge(`${this.endpoint}/pair/confirm`, { method: "POST", headers: { ...this.headers(), "Content-Type": "application/json" }, body: JSON.stringify({ pairingId, code }) }, signal)) as LocalBridgeSession;
    this.modelVerification = null;
    this.session = session;
    this.clearControlPlaneCache();
    this.saveRememberedSession();
    return session;
  }

  async revoke(signal?: AbortSignal) {
    const result = await this.parse(await this.fetchBridge(`${this.endpoint}/pair/revoke`, { method: "POST", headers: { ...this.headers(true, true), "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) }, signal));
    this.session = null;
    this.modelVerification = null;
    this.clearControlPlaneCache();
    this.clearRememberedSession();
    return result;
  }

  async models(signal?: AbortSignal) {
    const now = Date.now();
    if (!signal && this.modelsCache && this.modelsCache.expiresAt > now) {
      return structuredClone(this.modelsCache.value);
    }
    if (!signal && this.modelsInFlight) {
      return structuredClone(await this.modelsInFlight);
    }
    const epoch = this.cacheEpoch;
    const operation = this.fetchBridge(
      `${this.endpoint}/models`,
      { headers: this.headers(true), cache: "no-store" },
      signal,
    ).then((response) => this.parse(response));
    if (!signal) this.modelsInFlight = operation;
    try {
      const value = await operation;
      if (!signal && epoch === this.cacheEpoch) {
        this.modelsCache = {
          expiresAt: Date.now() + CONTROL_CACHE_TTL_MS,
          value: structuredClone(value),
        };
      }
      return structuredClone(value);
    } finally {
      if (!signal && this.modelsInFlight === operation) this.modelsInFlight = null;
    }
  }

  async inspectModel(modelId: string, signal?: AbortSignal) {
    return this.parse(await this.fetchBridge(`${this.endpoint}/models/${encodeURIComponent(modelId)}`, { headers: this.headers(true), cache: "no-store" }, signal));
  }

  async verifyModel(modelId: string, signal?: AbortSignal): Promise<LocalModelInferenceProof> {
    const requestVerification = () => this.fetchBridge(
      `${this.endpoint}/model/verify`,
      {
        method: "POST",
        headers: {
          ...this.headers(true, true),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: modelId }),
      },
      signal,
    );
    let response: Response;
    try {
      response = await requestVerification();
    } catch (error) {
      if (
        signal?.aborted
        || !(error instanceof AiProviderError)
        || !error.retryable
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
      response = await requestVerification();
    }
    const body = await this.parse(response);
    const valid = body.proofVersion === "local-model-inference-proof-v1"
      && body.state === "inference_verified"
      && body.providerKind === "local_ollama"
      && body.instanceId === this.session?.instanceId
      && body.modelId === modelId
      && typeof body.verifiedAt === "string"
      && typeof body.latencyMs === "number"
      && typeof body.outputDigest === "string"
      && /^[a-f0-9]{64}$/i.test(body.outputDigest)
      && typeof body.outputBytes === "number"
      && body.outputBytes > 0
      && body.externalRequest === false
      && body.dataLeftDevice === false;
    if (!valid) {
      throw new AiProviderError("OLLAMA_INVALID_RESPONSE", "本機模型驗證證明不完整，不能標示為運作中。", {
        retryable: true,
        stage: "local-model-verification",
      });
    }
    this.modelVerification = body as LocalModelInferenceProof;
    this.saveRememberedSession(
      this.modelVerification.modelId,
      this.modelVerification.modelDigest,
    );
    return { ...this.modelVerification };
  }

  async cancel(requestId: string, signal?: AbortSignal) {
    return this.parse(await this.fetchBridge(`${this.endpoint}/cancel`, { method: "POST", headers: { ...this.headers(true, true), "Content-Type": "application/json" }, body: JSON.stringify({ requestId }) }, signal));
  }

  async cacheStats(signal?: AbortSignal) {
    return this.parse(await this.fetchBridge(`${this.endpoint}/cache/stats`, {
      headers: this.headers(true),
      cache: "no-store",
    }, signal));
  }

  async invalidateCache(
    invalidation: ClosedAICacheInvalidation,
    signal?: AbortSignal,
  ) {
    return this.parse(await this.fetchBridge(`${this.endpoint}/cache/invalidate`, {
      method: "POST",
      headers: {
        ...this.headers(true, true),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(invalidation),
    }, signal));
  }

  async *generate(input: { requestId: string; model: string; prompt?: string; messages?: Array<{ role: string; content: string }>; systemInstruction?: string; taskType: string; timeoutMs?: number; options?: Record<string, unknown>; cacheNamespace?: ClosedAINamespace; signal?: AbortSignal }): AsyncGenerator<LocalBridgeEvent> {
    const abort = () => { void this.cancel(input.requestId).catch(() => undefined); };
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      let response: Response;
      try { response = await fetch(`${this.endpoint}/generate`, { method: "POST", headers: { ...this.headers(true, true), "Content-Type": "application/json", "Idempotency-Key": input.requestId }, body: JSON.stringify(input), signal: input.signal }); }
      catch (error) { throw await classifyBridgeConnectivityError(error, input.signal ?? new AbortController().signal); }
      if (!response.ok) { await this.parse(response); return; }
      const reader = response.body?.getReader();
      if (!reader) throw new AiProviderError("OLLAMA_INVALID_RESPONSE", "Local Bridge returned no stream.", { retryable: true });
      const decoder = new TextDecoder();
      let buffer = "";
      const streamState = { started: false, completed: false };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) if (line.trim()) yield validateLocalBridgeEvent(parseLocalBridgeJson(line), input.requestId, streamState);
      }
      if (buffer.trim()) yield validateLocalBridgeEvent(parseLocalBridgeJson(buffer), input.requestId, streamState);
      assertLocalBridgeStreamCompleted(streamState);
    } finally { input.signal?.removeEventListener("abort", abort); }
  }
}

let configuredClient: LocalBridgeClient | null = null;
let configuredModelId: string | null = null;
export function configureLocalBridgeClient(client: LocalBridgeClient | null) { configuredClient = client; }
export function getConfiguredLocalBridgeClient() { return configuredClient; }
export function configureLocalBridgeModel(modelId: string | null) { configuredModelId = modelId; }
export function getConfiguredLocalBridgeModel() { return configuredModelId; }
