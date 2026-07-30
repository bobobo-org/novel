import type {
  ClosedAIBackendSnapshot,
  ClosedBackendExecutionInput,
  ClosedBackendExecutionResult,
} from "../../closed-agent-os/types";
import type {
  ClosedAICacheInvalidation,
  ClosedAINamespace,
} from "../../closed-ai-cache";
import {
  normalizeTraditionalChinesePreservingProperNouns,
} from "../../language/traditional-chinese";
import { AiProviderError } from "../provider-errors";
import {
  buildClosedAIModelPrompt,
  getClosedAIModelProfile,
} from "../closed/task-profile";
import {
  assertLocalBridgeStreamCompleted,
  classifyBridgeConnectivityError,
  parseLocalBridgeJson,
  validateLocalBridgeEvent,
  type LocalBridgeEvent,
  type LocalTextModel,
} from "../local-ollama/local-bridge-client";
import type {
  FormalPreferenceDatasetManifest,
} from "../../training/formal-preference-dataset";
import {
  clearClosedAITabSession,
  readClosedAITabSession,
  saveClosedAITabSession,
} from "../closed/tab-session-recovery";

export const PRIVATE_HUB_PROTOCOL = "novel-private-hub/v1";
const PRIVATE_HUB_ENDPOINT = "http://127.0.0.1:3227";
const CONTROL_TIMEOUT_MS = 5_000;
const CONTROL_CACHE_TTL_MS = 1_500;

export type PrivateHubSession = {
  token: string;
  csrf: string;
  instanceId: string;
  expiresAt: string;
};

export type PrivateHubInferenceProof = {
  proofVersion: "private-hub-model-inference-proof-v1";
  state: "inference_verified";
  providerKind: "private_ai_hub";
  deploymentKind: "self_hosted_loopback_private_node";
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

export type OfflinePreferenceModelArtifact = {
  schemaVersion: "novel-offline-preference-model-v1";
  modelId: string;
  modelType: "pairwise-logistic-style-adapter";
  projectId: string;
  baseModelId: string;
  datasetVersion: string;
  datasetDigest: string;
  datasetManifestHash?: string | null;
  datasetGovernance?: "formal_manifest_verified" | "legacy_explicit_confirmation";
  trainingMethod: "offline_pairwise_logistic_gradient_descent";
  featureNames: string[];
  weights: number[];
  bias: number;
  hyperparameters: {
    epochs: number;
    learningRate: number;
    l2: number;
  };
  metrics: {
    trainingPairs: number;
    holdoutPairs: number;
    trainingPairAccuracy: number | null;
    holdoutPairAccuracy: number | null;
    allPairAccuracy: number | null;
    finalLoss: number;
  };
  privacy: {
    runsOffline: true;
    rawSamplesStored: false;
    rawSamplesReturned: false;
    externalRequest: false;
    dataLeftDevice: false;
  };
  createdAt: string;
  status: "candidate" | "active";
  artifactDigest: string;
  verified: boolean;
  trainingCompleted?: boolean;
  activationRequired?: boolean;
  elapsedMs?: number;
};

type PrivateHubBody = Record<string, unknown> & {
  errorCode?: string;
  message?: string;
  retryable?: boolean;
  models?: LocalTextModel[] | OfflinePreferenceModelArtifact[];
  hubProcessAlive?: boolean;
  pairingState?: string;
  modelRuntimeReachable?: boolean;
  modelAvailable?: boolean;
  runtimeReady?: boolean;
  protocolVersion?: string;
  instanceId?: string;
  deploymentKind?: string;
  token?: string;
  csrf?: string;
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

function endpoint(value = PRIVATE_HUB_ENDPOINT) {
  const url = new URL(value);
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || url.port !== "3227"
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new AiProviderError(
      "LOCAL_SECURITY_POLICY_VIOLATION",
      "Private Hub endpoint must be exactly http://127.0.0.1:3227",
      { retryable: false },
    );
  }
  return url.origin;
}

function boundedSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(CONTROL_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validateInferenceProof(
  body: PrivateHubBody,
  session: PrivateHubSession | null,
  modelId: string,
): body is PrivateHubBody & PrivateHubInferenceProof {
  return body.proofVersion === "private-hub-model-inference-proof-v1"
    && body.state === "inference_verified"
    && body.providerKind === "private_ai_hub"
    && body.deploymentKind === "self_hosted_loopback_private_node"
    && body.instanceId === session?.instanceId
    && body.modelId === modelId
    && typeof body.verifiedAt === "string"
    && typeof body.latencyMs === "number"
    && typeof body.outputDigest === "string"
    && /^[a-f0-9]{64}$/i.test(body.outputDigest)
    && typeof body.outputBytes === "number"
    && body.outputBytes > 0
    && body.externalRequest === false
    && body.dataLeftDevice === false;
}

function validateTrainingArtifact(value: unknown): value is OfflinePreferenceModelArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const artifact = value as Partial<OfflinePreferenceModelArtifact>;
  return artifact.schemaVersion === "novel-offline-preference-model-v1"
    && artifact.modelType === "pairwise-logistic-style-adapter"
    && typeof artifact.modelId === "string"
    && typeof artifact.projectId === "string"
    && typeof artifact.artifactDigest === "string"
    && /^[a-f0-9]{64}$/i.test(artifact.artifactDigest)
    && Array.isArray(artifact.weights)
    && artifact.weights.every((item) => Number.isFinite(item))
    && artifact.verified === true
    && artifact.privacy?.runsOffline === true
    && artifact.privacy.rawSamplesStored === false
    && artifact.privacy.externalRequest === false
    && artifact.privacy.dataLeftDevice === false;
}

export class PrivateHubClient {
  readonly endpoint: string;
  readonly origin: string;
  private session: PrivateHubSession | null = null;
  private modelVerification: PrivateHubInferenceProof | null = null;
  private activeAdapters = new Map<string, OfflinePreferenceModelArtifact>();
  private healthCache: { expiresAt: number; value: PrivateHubBody } | null = null;
  private modelsCache: { expiresAt: number; value: PrivateHubBody & { models: LocalTextModel[] } } | null = null;
  private preferenceCache = new Map<string, {
    expiresAt: number;
    value: OfflinePreferenceModelArtifact[];
  }>();
  private healthInFlight: Promise<PrivateHubBody> | null = null;
  private modelsInFlight: Promise<PrivateHubBody & { models: LocalTextModel[] }> | null = null;
  private preferenceInFlight = new Map<string, Promise<OfflinePreferenceModelArtifact[]>>();
  private cacheEpoch = 0;
  private rememberWithinTab = false;
  private readonly tabStorage: Storage | null | undefined;

  constructor(options: {
    endpoint?: string;
    origin?: string;
    session?: PrivateHubSession;
    tabStorage?: Storage | null;
    rememberWithinTab?: boolean;
  } = {}) {
    this.endpoint = endpoint(options.endpoint);
    this.origin = options.origin ?? "https://novel-orcin.vercel.app";
    this.session = options.session ?? null;
    this.tabStorage = options.tabStorage;
    this.rememberWithinTab = options.rememberWithinTab ?? false;
  }

  setSession(session: PrivateHubSession | null) {
    if (!session || session.instanceId !== this.session?.instanceId) {
      this.modelVerification = null;
      this.activeAdapters.clear();
    }
    this.session = session;
    this.clearControlPlaneCache();
  }

  getSessionMetadata() {
    return this.session
      ? { instanceId: this.session.instanceId, expiresAt: this.session.expiresAt }
      : null;
  }

  getModelVerification(modelId?: string) {
    if (!this.modelVerification || !this.session) return null;
    if (this.modelVerification.instanceId !== this.session.instanceId) return null;
    if (modelId && this.modelVerification.modelId !== modelId) return null;
    return { ...this.modelVerification };
  }

  getActiveAdapter(projectId: string) {
    const artifact = this.activeAdapters.get(projectId);
    return artifact ? structuredClone(artifact) : null;
  }

  setRememberWithinTab(enabled: boolean) {
    this.rememberWithinTab = enabled;
    if (!enabled) clearClosedAITabSession("private-ai-hub", this.tabStorage);
  }

  getRememberWithinTab() {
    return this.rememberWithinTab;
  }

  clearRememberedSession() {
    clearClosedAITabSession("private-ai-hub", this.tabStorage);
  }

  private saveRememberedSession(
    modelId: string | null = null,
    modelDigest: string | null = null,
  ) {
    if (!this.rememberWithinTab || !this.session) return false;
    return saveClosedAITabSession({
      schemaVersion: "closed-ai-tab-session-v1",
      backend: "private-ai-hub",
      protocolVersion: PRIVATE_HUB_PROTOCOL,
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
      backend: "private-ai-hub",
      protocolVersion: PRIVATE_HUB_PROTOCOL,
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
        health.protocolVersion !== PRIVATE_HUB_PROTOCOL
        || health.instanceId !== remembered.instanceId
      ) {
        throw new AiProviderError(
          "LOCAL_REQUEST_IDENTITY_MISMATCH",
          "Private Hub instance changed after the page was reloaded.",
          { retryable: false, stage: "private-session-recovery" },
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
          "No text model is available for the restored Private Hub session.",
          { retryable: true, stage: "private-session-recovery" },
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
          "The restored Private Hub model proof does not match the current model.",
          { retryable: false, stage: "private-session-recovery" },
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
    this.preferenceCache.clear();
    this.healthInFlight = null;
    this.modelsInFlight = null;
    this.preferenceInFlight.clear();
  }

  private headers(authenticated = false, write = false) {
    const headers: Record<string, string> = {
      "X-Private-Hub-Protocol": PRIVATE_HUB_PROTOCOL,
    };
    if (typeof window === "undefined") headers.Origin = this.origin;
    if (authenticated) {
      if (!this.session) {
        throw new AiProviderError(
          "BRIDGE_NOT_PAIRED",
          "Private Hub is not paired.",
          { retryable: false },
        );
      }
      headers.Authorization = `Bearer ${this.session.token}`;
      if (write) headers["X-Hub-CSRF"] = this.session.csrf;
    }
    return headers;
  }

  private async fetchHub(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ) {
    const signalWithTimeout = boundedSignal(signal);
    try {
      return await fetch(`${this.endpoint}${path}`, {
        ...init,
        signal: signalWithTimeout,
      });
    } catch (error) {
      throw await classifyBridgeConnectivityError(error, signalWithTimeout);
    }
  }

  private async parse(response: Response): Promise<PrivateHubBody> {
    const body = parseLocalBridgeJson(await response.text()) as PrivateHubBody;
    if (!response.ok) {
      throw new AiProviderError(
        (body.errorCode || "LOCAL_PROVIDER_NOT_READY") as AiProviderError["code"],
        String(body.message || `Private Hub HTTP ${response.status}`),
        {
          retryable: Boolean(body.retryable),
          stage: "private-hub",
        },
      );
    }
    return body;
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
    const operation = this.fetchHub(
      "/health",
      { headers: this.headers(), cache: "no-store" },
      signal,
    ).then((response) => this.parse(response));
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

  async requestPairing(signal?: AbortSignal) {
    const result = await this.parse(await this.fetchHub(
      "/pair/request",
      {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: "{}",
      },
      signal,
    ));
    this.clearControlPlaneCache();
    return result;
  }

  async confirmPairing(pairingId: string, code: string, signal?: AbortSignal) {
    const session = await this.parse(await this.fetchHub(
      "/pair/confirm",
      {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ pairingId, code }),
      },
      signal,
    )) as PrivateHubSession;
    this.modelVerification = null;
    this.activeAdapters.clear();
    this.session = session;
    this.clearControlPlaneCache();
    this.saveRememberedSession();
    return session;
  }

  async revoke(signal?: AbortSignal) {
    const result = await this.parse(await this.fetchHub(
      "/pair/revoke",
      {
        method: "POST",
        headers: { ...this.headers(true, true), "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      },
      signal,
    ));
    this.session = null;
    this.modelVerification = null;
    this.activeAdapters.clear();
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
    const operation = this.fetchHub(
      "/models",
      { headers: this.headers(true), cache: "no-store" },
      signal,
    ).then((response) => this.parse(response))
      .then((body) => ({
        ...body,
        models: (body.models ?? []) as LocalTextModel[],
      }));
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

  async verifyModel(modelId: string, signal?: AbortSignal) {
    const body = await this.parse(await this.fetchHub(
      "/model/verify",
      {
        method: "POST",
        headers: { ...this.headers(true, true), "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      },
      signal,
    ));
    if (!validateInferenceProof(body, this.session, modelId)) {
      throw new AiProviderError(
        "OLLAMA_INVALID_RESPONSE",
        "Private Hub model verification proof is incomplete.",
        { retryable: true, stage: "private-hub-model-verification" },
      );
    }
    this.modelVerification = body;
    this.saveRememberedSession(
      this.modelVerification.modelId,
      this.modelVerification.modelDigest,
    );
    return { ...this.modelVerification };
  }

  async trainPreferenceModel(input: {
    projectId: string;
    baseModelId: string;
    datasetVersion?: string;
    samples: Array<{ chosen: string; rejected: string }>;
    datasetManifest: FormalPreferenceDatasetManifest;
    hyperparameters?: {
      epochs?: number;
      learningRate?: number;
      l2?: number;
    };
  }, signal?: AbortSignal) {
    const body = await this.parse(await this.fetchHub(
      "/training/train",
      {
        method: "POST",
        headers: { ...this.headers(true, true), "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, confirmOfflineTraining: true }),
      },
      signal,
    ));
    if (!validateTrainingArtifact(body)) {
      throw new AiProviderError(
        "OLLAMA_INVALID_RESPONSE",
        "Offline training returned an invalid model artifact.",
        { retryable: false, stage: "offline-preference-training" },
      );
    }
    this.clearControlPlaneCache();
    return structuredClone(body as OfflinePreferenceModelArtifact);
  }

  async listPreferenceModels(projectId: string, signal?: AbortSignal) {
    const now = Date.now();
    const cached = this.preferenceCache.get(projectId);
    if (!signal && cached && cached.expiresAt > now) {
      return structuredClone(cached.value);
    }
    const pending = this.preferenceInFlight.get(projectId);
    if (!signal && pending) return structuredClone(await pending);
    const epoch = this.cacheEpoch;
    const operation = this.fetchHub(
      "/training/list",
      {
        method: "POST",
        headers: { ...this.headers(true, true), "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      },
      signal,
    ).then((response) => this.parse(response))
      .then((body) => Array.isArray(body.models)
        ? body.models.filter(validateTrainingArtifact)
        : []);
    if (!signal) this.preferenceInFlight.set(projectId, operation);
    try {
      const models = await operation;
      const active = models.find((model) => model.status === "active") ?? null;
      if (active) this.activeAdapters.set(projectId, active);
      else this.activeAdapters.delete(projectId);
      if (!signal && epoch === this.cacheEpoch) {
        this.preferenceCache.set(projectId, {
          expiresAt: Date.now() + CONTROL_CACHE_TTL_MS,
          value: structuredClone(models),
        });
      }
      return structuredClone(models);
    } finally {
      if (!signal && this.preferenceInFlight.get(projectId) === operation) {
        this.preferenceInFlight.delete(projectId);
      }
    }
  }

  async verifyPreferenceModel(
    projectId: string,
    modelId: string,
    signal?: AbortSignal,
  ) {
    const body = await this.parse(await this.fetchHub(
      "/training/verify",
      {
        method: "POST",
        headers: { ...this.headers(true, true), "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, modelId }),
      },
      signal,
    ));
    if (!validateTrainingArtifact(body)) {
      throw new AiProviderError(
        "OLLAMA_INVALID_RESPONSE",
        "Stored offline preference model failed verification.",
        { retryable: false, stage: "offline-preference-verification" },
      );
    }
    return structuredClone(body as OfflinePreferenceModelArtifact);
  }

  async activatePreferenceModel(
    projectId: string,
    modelId: string,
    signal?: AbortSignal,
  ) {
    const body = await this.parse(await this.fetchHub(
      "/training/activate",
      {
        method: "POST",
        headers: { ...this.headers(true, true), "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, modelId, confirmActivation: true }),
      },
      signal,
    ));
    this.clearControlPlaneCache();
    await this.listPreferenceModels(projectId, signal);
    return body;
  }

  async rollbackPreferenceModel(projectId: string, signal?: AbortSignal) {
    const body = await this.parse(await this.fetchHub(
      "/training/rollback",
      {
        method: "POST",
        headers: { ...this.headers(true, true), "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, confirmRollback: true }),
      },
      signal,
    ));
    this.clearControlPlaneCache();
    await this.listPreferenceModels(projectId, signal);
    return body;
  }

  async cancel(requestId: string, signal?: AbortSignal) {
    return this.parse(await this.fetchHub(
      "/cancel",
      {
        method: "POST",
        headers: { ...this.headers(true, true), "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      },
      signal,
    ));
  }

  async cacheStats(signal?: AbortSignal) {
    return this.parse(await this.fetchHub(
      "/cache/stats",
      { headers: this.headers(true), cache: "no-store" },
      signal,
    ));
  }

  async invalidateCache(
    invalidation: ClosedAICacheInvalidation,
    signal?: AbortSignal,
  ) {
    return this.parse(await this.fetchHub(
      "/cache/invalidate",
      {
        method: "POST",
        headers: { ...this.headers(true, true), "Content-Type": "application/json" },
        body: JSON.stringify(invalidation),
      },
      signal,
    ));
  }

  async *generate(input: {
    requestId: string;
    projectId: string;
    model: string;
    prompt: string;
    systemInstruction?: string;
    taskType: string;
    timeoutMs?: number;
    options?: Record<string, unknown>;
    cacheNamespace?: ClosedAINamespace;
    signal?: AbortSignal;
  }): AsyncGenerator<LocalBridgeEvent> {
    const abort = () => {
      void this.cancel(input.requestId).catch(() => undefined);
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      let response: Response;
      try {
        response = await fetch(`${this.endpoint}/generate`, {
          method: "POST",
          headers: {
            ...this.headers(true, true),
            "Content-Type": "application/json",
            "Idempotency-Key": input.requestId,
          },
          body: JSON.stringify(input),
          signal: input.signal,
        });
      } catch {
        throw new AiProviderError(
          input.signal?.aborted ? "OLLAMA_CANCELLED" : "BRIDGE_PROCESS_UNREACHABLE",
          input.signal?.aborted
            ? "Private Hub generation was cancelled."
            : "Private Hub generation endpoint is unreachable.",
          { retryable: true, stage: "private-hub-generation" },
        );
      }
      if (!response.ok) {
        await this.parse(response);
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new AiProviderError(
          "OLLAMA_INVALID_RESPONSE",
          "Private Hub returned no stream.",
          { retryable: true },
        );
      }
      const decoder = new TextDecoder();
      let buffer = "";
      const streamState = { started: false, completed: false };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) {
            yield validateLocalBridgeEvent(
              parseLocalBridgeJson(line),
              input.requestId,
              streamState,
            );
          }
        }
      }
      if (buffer.trim()) {
        yield validateLocalBridgeEvent(
          parseLocalBridgeJson(buffer),
          input.requestId,
          streamState,
        );
      }
      assertLocalBridgeStreamCompleted(streamState);
    } finally {
      input.signal?.removeEventListener("abort", abort);
    }
  }
}

let configuredClient: PrivateHubClient | null = null;
let configuredModelId: string | null = null;
let configuredProjectId: string | null = null;

export function configurePrivateHubClient(client: PrivateHubClient | null) {
  configuredClient = client;
}

export function getConfiguredPrivateHubClient() {
  return configuredClient;
}

export function configurePrivateHubModel(modelId: string | null) {
  configuredModelId = modelId;
}

export function configurePrivateHubProject(projectId: string | null) {
  configuredProjectId = projectId;
}

export class LoopbackPrivateHubTransport {
  async snapshot(
    signal?: AbortSignal,
    namespace?: Pick<ClosedAINamespace, "projectId">,
  ): Promise<ClosedAIBackendSnapshot> {
    const startedAt = performance.now();
    const client = getConfiguredPrivateHubClient();
    const projectId = namespace?.projectId ?? configuredProjectId;
    if (!client) {
      return {
        id: "private-ai-hub",
        label: "私有 AI Hub",
        status: "contract_ready_runtime_not_connected",
        modelId: null,
        modelDigest: null,
        local: true,
        dataBoundary: "private-infrastructure",
        maximumComplexity: "heavy",
        capabilities: ["text", "structured", "streaming", "long-context"],
        supportedTaskTypes: "all",
        detailCode: "self_hosted_private_node_not_connected",
      };
    }
    try {
      const health = await client.health(signal);
      if (!health.runtimeReady || !client.getSessionMetadata()) {
        return {
          id: "private-ai-hub",
          label: "私有 AI Hub",
          status: "runtime_required",
          modelId: null,
          modelDigest: null,
          local: true,
          dataBoundary: "private-infrastructure",
          maximumComplexity: "heavy",
          capabilities: ["text", "structured", "streaming", "long-context"],
          supportedTaskTypes: "all",
          detailCode: String(health.pairingState || "private_hub_pairing_required"),
        };
      }
      const [modelResponse] = await Promise.all([
        client.models(signal),
        projectId
          ? client.listPreferenceModels(projectId, signal)
          : Promise.resolve([]),
      ]);
      const textModels = modelResponse.models.filter(
        (model) => model.capabilities?.textGeneration?.value === true,
      );
      const model = textModels.find((item) => item.modelId === configuredModelId)
        ?? textModels[0]
        ?? null;
      const proof = model ? client.getModelVerification(model.modelId) : null;
      const adapter = projectId
        ? client.getActiveAdapter(projectId)
        : null;
      const compositeDigest = model
        ? await sha256Hex([
          model.modelDigest || "unknown-model-digest",
          adapter?.artifactDigest || "no-active-adapter",
        ].join("|"))
        : null;
      return {
        id: "private-ai-hub",
        label: "私有 AI Hub",
        status: model && proof ? "ready" : model ? "degraded" : "runtime_required",
        modelId: model?.modelId ?? null,
        modelDigest: compositeDigest,
        local: true,
        dataBoundary: "private-infrastructure",
        maximumComplexity: "heavy",
        capabilities: ["text", "structured", "streaming", "long-context"],
        supportedTaskTypes: "all",
        maxContext: Number(model?.contextLength?.value ?? 0),
        controlLatencyMs: Math.round(performance.now() - startedAt),
        detailCode: model && proof
          ? adapter
            ? `model_and_adapter_verified:${adapter.modelId}`
            : "model_inference_verified:no_active_adapter"
          : model
            ? "model_inference_not_verified"
            : "private_hub_model_not_available",
      };
    } catch {
      return {
        id: "private-ai-hub",
        label: "私有 AI Hub",
        status: "contract_ready_runtime_not_connected",
        modelId: null,
        modelDigest: null,
        local: true,
        dataBoundary: "private-infrastructure",
        maximumComplexity: "heavy",
        capabilities: ["text", "structured", "streaming", "long-context"],
        supportedTaskTypes: "all",
        detailCode: "self_hosted_private_node_unreachable",
      };
    }
  }

  async invalidateCache(
    invalidation: ClosedAICacheInvalidation,
    signal?: AbortSignal,
  ) {
    const client = getConfiguredPrivateHubClient();
    if (!client) return 0;
    const result = await client.invalidateCache(invalidation, signal);
    return Number(result.invalidatedEntries ?? 0);
  }

  async execute(
    input: ClosedBackendExecutionInput,
  ): Promise<ClosedBackendExecutionResult> {
    const client = getConfiguredPrivateHubClient();
    if (!client) {
      throw Object.assign(new Error("Private Hub runtime is not connected."), {
        code: "CLOSED_AI_SELECTED_BACKEND_NOT_READY",
      });
    }
    const routedModelId = input.request.namespace.modelId;
    const routedModelDigest = input.request.namespace.modelDigest;
    if (
      !routedModelId
      || routedModelId.endsWith(":runtime-managed")
      || !routedModelDigest
      || routedModelDigest.endsWith(":digest-runtime-managed")
    ) {
      throw Object.assign(
        new Error("Private Hub task has no verified routed model identity."),
        {
          code: "CLOSED_AI_SELECTED_BACKEND_NOT_READY",
        },
      );
    }
    let content = "";
    let completed = false;
    let adapterId: string | null = null;
    let adapterDigest: string | null = null;
    const startedAt = performance.now();
    const profile = getClosedAIModelProfile(
      input.request.taskType,
      "private-ai-hub",
    );
    const prompt = buildClosedAIModelPrompt({
      objective: input.request.objective,
      context: input.actorContext.map((item) => item.text),
      profile,
      qualityPhase: input.qualityPhase,
      agentPlan: {
        planDigest: input.plan.planDigest,
        roles: [...input.plan.roles],
        steps: input.plan.steps.map((step) => ({
          role: step.role,
          objective: step.objective,
        })),
      },
      toolResults: input.toolResults,
      workingMaterials: input.workingMaterials,
    });
    let firstTokenMs: number | null = null;
    let tokenEvents = 0;
    let lastReportedCharacters = 0;
    for await (const event of client.generate({
      requestId: input.request.taskId,
      projectId: input.request.namespace.projectId,
      model: routedModelId,
      prompt: prompt.prompt,
      systemInstruction: profile.systemInstruction,
      taskType: input.request.taskType,
      timeoutMs: profile.timeoutMs,
      options: profile.options,
      cacheNamespace: input.request.namespace,
      signal: input.request.signal,
    })) {
      if (event.type === "started") {
        adapterId = typeof event.adapterId === "string" ? event.adapterId : null;
        adapterDigest = typeof event.adapterDigest === "string"
          ? event.adapterDigest
          : null;
      }
      if (event.type === "token") {
        const text = event.text ?? "";
        if (text && firstTokenMs === null) {
          firstTokenMs = Math.round(performance.now() - startedAt);
        }
        content += text;
        tokenEvents += 1;
        if (
          content.length - lastReportedCharacters >= 48
          || lastReportedCharacters === 0
        ) {
          lastReportedCharacters = content.length;
          try {
            input.request.onProgress?.({
              taskId: input.request.taskId,
              phase: "generating",
              label: `Private Hub 串流中 · ${content.length} 字`,
              percent: Math.min(
                80,
                50 + Math.round(Math.sqrt(content.length) * 1.8),
              ),
              occurredAt: new Date().toISOString(),
              backendId: "private-ai-hub",
              generatedCharacters: content.length,
            });
          } catch {
            // Progress callbacks cannot affect a private generation transaction.
          }
        }
      }
      if (event.type === "completed") completed = true;
      if (event.type === "failed" || event.type === "cancelled") {
        throw Object.assign(new Error(String(event.errorCode || event.type)), {
          code: event.errorCode || (
            event.type === "cancelled"
              ? "OLLAMA_CANCELLED"
              : "OLLAMA_STREAM_INTERRUPTED"
          ),
        });
      }
    }
    if (!completed || !content.trim()) {
      throw Object.assign(new Error("Private Hub stream did not complete."), {
        code: "OLLAMA_STREAM_INTERRUPTED",
      });
    }
    return {
      backendId: "private-ai-hub",
      modelId: routedModelId,
      modelDigest: routedModelDigest,
      adapterId,
      adapterDigest,
      content: normalizeTraditionalChinesePreservingProperNouns(
        content,
        [
          input.request.objective,
          ...input.actorContext.map((item) => item.text),
        ].join("\n"),
      ),
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: Math.round(performance.now() - startedAt),
      profileId: profile.profileId,
      firstTokenMs,
      inputCharacters: prompt.inputCharacters,
      outputCharacters: content.length,
      generatedTokenEvents: tokenEvents,
      omittedInputCharacters: prompt.omittedCharacters,
      qualityMode: input.plan.qualityMode,
      qualityPasses: 1,
      draftDigest: null,
      criticDigest: null,
    };
  }
}
