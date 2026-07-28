import type {
  ClosedAIBackendSnapshot,
  ClosedBackendExecutionInput,
  ClosedBackendExecutionResult,
} from "../../closed-agent-os/types";
import type {
  ClosedAICacheInvalidation,
  ClosedAINamespace,
} from "../../closed-ai-cache";
import { normalizeTraditionalChinese } from "../../language/traditional-chinese";
import { AiProviderError } from "../provider-errors";
import {
  assertLocalBridgeStreamCompleted,
  parseLocalBridgeJson,
  validateLocalBridgeEvent,
  type LocalBridgeEvent,
  type LocalTextModel,
} from "../local-ollama/local-bridge-client";

export const PRIVATE_HUB_PROTOCOL = "novel-private-hub/v1";
const PRIVATE_HUB_ENDPOINT = "http://127.0.0.1:3227";
const CONTROL_TIMEOUT_MS = 5_000;

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

  constructor(options: {
    endpoint?: string;
    origin?: string;
    session?: PrivateHubSession;
  } = {}) {
    this.endpoint = endpoint(options.endpoint);
    this.origin = options.origin ?? "https://novel-orcin.vercel.app";
    this.session = options.session ?? null;
  }

  setSession(session: PrivateHubSession | null) {
    if (!session || session.instanceId !== this.session?.instanceId) {
      this.modelVerification = null;
      this.activeAdapters.clear();
    }
    this.session = session;
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
    } catch {
      throw new AiProviderError(
        signalWithTimeout.aborted ? "REQUEST_TIMEOUT" : "BRIDGE_PROCESS_UNREACHABLE",
        signalWithTimeout.aborted
          ? "Private Hub control request timed out."
          : "The browser could not reach the self-hosted Private Hub node.",
        { retryable: true, stage: "private-hub-connect" },
      );
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
    return this.parse(await this.fetchHub(
      "/health",
      { headers: this.headers(), cache: "no-store" },
      signal,
    ));
  }

  async requestPairing(signal?: AbortSignal) {
    return this.parse(await this.fetchHub(
      "/pair/request",
      {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: "{}",
      },
      signal,
    ));
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
    return result;
  }

  async models(signal?: AbortSignal) {
    const body = await this.parse(await this.fetchHub(
      "/models",
      { headers: this.headers(true), cache: "no-store" },
      signal,
    ));
    return { ...body, models: (body.models ?? []) as LocalTextModel[] };
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
    return { ...this.modelVerification };
  }

  async trainPreferenceModel(input: {
    projectId: string;
    baseModelId: string;
    datasetVersion?: string;
    samples: Array<{ chosen: string; rejected: string }>;
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
    return structuredClone(body as OfflinePreferenceModelArtifact);
  }

  async listPreferenceModels(projectId: string, signal?: AbortSignal) {
    const body = await this.parse(await this.fetchHub(
      "/training/list",
      {
        method: "POST",
        headers: { ...this.headers(true, true), "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      },
      signal,
    ));
    const models = Array.isArray(body.models)
      ? body.models.filter(validateTrainingArtifact)
      : [];
    const active = models.find((model) => model.status === "active") ?? null;
    if (active) this.activeAdapters.set(projectId, active);
    else this.activeAdapters.delete(projectId);
    return models;
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
  async snapshot(signal?: AbortSignal): Promise<ClosedAIBackendSnapshot> {
    const client = getConfiguredPrivateHubClient();
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
      const modelResponse = await client.models(signal);
      const textModels = modelResponse.models.filter(
        (model) => model.capabilities?.textGeneration?.value === true,
      );
      const model = textModels.find((item) => item.modelId === configuredModelId)
        ?? textModels[0]
        ?? null;
      const proof = model ? client.getModelVerification(model.modelId) : null;
      if (configuredProjectId) {
        await client.listPreferenceModels(configuredProjectId, signal);
      }
      const adapter = configuredProjectId
        ? client.getActiveAdapter(configuredProjectId)
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
    const snapshot = await this.snapshot(input.request.signal);
    if (snapshot.status !== "ready" || !snapshot.modelId || !snapshot.modelDigest) {
      throw Object.assign(new Error("Private Hub model is not inference-verified."), {
        code: "CLOSED_AI_SELECTED_BACKEND_NOT_READY",
      });
    }
    let content = "";
    let completed = false;
    let adapterId: string | null = null;
    let adapterDigest: string | null = null;
    const startedAt = performance.now();
    for await (const event of client.generate({
      requestId: input.request.taskId,
      projectId: input.request.namespace.projectId,
      model: snapshot.modelId,
      prompt: [
        ...input.actorContext.map((item) => item.text),
        ...input.toolResults.map((item) => JSON.stringify(item.value)),
        input.request.objective,
      ].join("\n\n"),
      systemInstruction: "你是台灣繁體中文小說助手。全程只使用繁體中文（例如：著、遠、將、離、穩），禁止輸出簡體字。只輸出可供作者核准的候選內容，不修改 Canon。",
      taskType: input.request.taskType,
      timeoutMs: 240_000,
      options: { num_predict: 2_048 },
      cacheNamespace: input.request.namespace,
      signal: input.request.signal,
    })) {
      if (event.type === "started") {
        adapterId = typeof event.adapterId === "string" ? event.adapterId : null;
        adapterDigest = typeof event.adapterDigest === "string"
          ? event.adapterDigest
          : null;
      }
      if (event.type === "token") content += event.text ?? "";
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
      modelId: snapshot.modelId,
      modelDigest: snapshot.modelDigest,
      adapterId,
      adapterDigest,
      content: normalizeTraditionalChinese(content),
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }
}
