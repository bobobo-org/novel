import {
  isCryptographicClosedAIModelDigest,
  type ClosedAIBackendSnapshot,
  type ClosedBackendExecutionInput,
  type ClosedBackendRawExecutionResult,
} from "../../closed-agent-os/types";
import { closedAIRegenerationPromptContext } from "../../closed-agent-os/regeneration-prompt";
/*
 * Keep Private Hub readiness bound to the same immutable model identity used
 * by Closed Agent OS receipts. A successful inference without that identity
 * is availability, not production verification.
 */
import type {
  ClosedAICacheInvalidation,
  ClosedAINamespace,
} from "../../closed-ai-cache";
import { AiProviderError } from "../provider-errors";
import {
  buildClosedAIModelPrompt,
  getClosedAIModelProfile,
} from "../closed/task-profile";
import {
  assertLocalBridgeStreamCompleted,
  classifyBridgeConnectivityError,
  parseLocalBridgeJson,
  selectAvailableTextModel,
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
import {
  evaluateLocalAIRuntimeVersion,
  LOCAL_AI_COMPANION_RELEASE,
} from "../local-ollama/companion-release";
import type {
  AutonomousPracticeExperience,
} from "../../sovereign-learning/autonomous-practice";

export const PRIVATE_HUB_PROTOCOL = "novel-private-hub/v1";
const PRIVATE_HUB_ENDPOINT = "http://127.0.0.1:3227";
export const PRIVATE_HUB_CONTROL_TIMEOUT_MS = 5_000;
export const PRIVATE_HUB_MODEL_VERIFICATION_TIMEOUT_MS = 60_000;
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
  modelDigest: string;
  verifiedAt: string;
  latencyMs: number;
  outputDigest: string;
  outputBytes: number;
  evalCount: number | null;
  externalRequest: false;
  dataLeftDevice: false;
};

export type PrivateHubAutomaticConnection = {
  state: "connected";
  mode: "existing-session" | "trusted-origin-auto";
  session: { instanceId: string; expiresAt: string };
  model: LocalTextModel;
  proof: PrivateHubInferenceProof;
};

export type PrivateHubLearningExperienceReceipt = {
  status: "durably_recorded";
  durable: true;
  deduplicated: boolean;
  sequence: number;
  receivedAt: string;
  experienceDigest: string;
  receiptDigest: string;
  ledgerHead: string;
  rawContentStored: false;
  canonicalMutationCount: 0;
  modelWeightMutationCount: 0;
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
  hubVersion?: string;
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
  durable?: boolean;
  deduplicated?: boolean;
  sequence?: number;
  experienceDigest?: string;
  receiptDigest?: string;
  ledgerHead?: string;
  rawContentStored?: boolean;
  canonicalMutationCount?: number;
  modelWeightMutationCount?: number;
  automaticConnection?: boolean;
  automaticSessionSupported?: boolean;
  sessionKind?: string;
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

function boundedSignal(
  signal?: AbortSignal,
  timeoutMs = PRIVATE_HUB_CONTROL_TIMEOUT_MS,
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function privateHubRoutedModelDigest(
  catalogModelDigest: unknown,
  adapterDigest?: unknown,
) {
  if (!isCryptographicClosedAIModelDigest(catalogModelDigest)) return null;
  if (adapterDigest === undefined || adapterDigest === null) {
    return catalogModelDigest;
  }
  if (!isCryptographicClosedAIModelDigest(adapterDigest)) return null;
  return sha256Hex(`${catalogModelDigest}|${adapterDigest}`);
}

function validPrivateHubVerificationTimestamp(value: unknown) {
  const verifiedAt = Date.parse(String(value ?? ""));
  return Number.isFinite(verifiedAt)
    && verifiedAt > 0
    && verifiedAt <= Date.now() + 60_000;
}

function validateInferenceProof(
  body: PrivateHubBody,
  session: PrivateHubSession | null,
  expected: { modelId: string; modelDigest: string },
): body is PrivateHubBody & PrivateHubInferenceProof {
  return body.proofVersion === "private-hub-model-inference-proof-v1"
    && body.state === "inference_verified"
    && body.providerKind === "private_ai_hub"
    && body.deploymentKind === "self_hosted_loopback_private_node"
    && body.instanceId === session?.instanceId
    && body.modelId === expected.modelId
    && body.modelDigest === expected.modelDigest
    && isCryptographicClosedAIModelDigest(body.modelDigest)
    && typeof body.verifiedAt === "string"
    && validPrivateHubVerificationTimestamp(body.verifiedAt)
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
  private automaticConnectionInFlight: Promise<PrivateHubAutomaticConnection> | null = null;
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

  hasActiveOrRememberedSession() {
    if (
      this.session
      && Date.parse(this.session.expiresAt) > Date.now()
    ) return true;
    return Boolean(readClosedAITabSession({
      backend: "private-ai-hub",
      protocolVersion: PRIVATE_HUB_PROTOCOL,
      origin: this.origin,
      endpoint: this.endpoint,
    }, this.tabStorage));
  }

  getModelVerification(modelId?: string, modelDigest?: string | null) {
    if (!this.modelVerification || !this.session) return null;
    if (this.modelVerification.instanceId !== this.session.instanceId) return null;
    if (!isCryptographicClosedAIModelDigest(this.modelVerification.modelDigest)) return null;
    if (!validPrivateHubVerificationTimestamp(this.modelVerification.verifiedAt)) return null;
    if (modelId && this.modelVerification.modelId !== modelId) return null;
    if (modelDigest !== undefined && this.modelVerification.modelDigest !== modelDigest) return null;
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

  async restoreRememberedControlSession(signal?: AbortSignal) {
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
      return {
        remembered,
        session: this.getSessionMetadata(),
      };
    } catch (error) {
      this.setSession(null);
      this.clearRememberedSession();
      throw error;
    }
  }

  async restoreRememberedSession(signal?: AbortSignal) {
    const restored = await this.restoreRememberedControlSession(signal);
    if (!restored) return null;
    const { remembered } = restored;
    try {
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
      const proof = await this.verifyModel(
        selected.modelId,
        signal,
        selected.modelDigest ?? null,
      );
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
    timeoutMs = PRIVATE_HUB_CONTROL_TIMEOUT_MS,
  ) {
    const signalWithTimeout = boundedSignal(signal, timeoutMs);
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

  async connectControlAutomatically(signal?: AbortSignal) {
    const health = await this.health(
      signal ?? AbortSignal.timeout(PRIVATE_HUB_CONTROL_TIMEOUT_MS),
    );
    const versionStatus = evaluateLocalAIRuntimeVersion({
      reportedVersion: health.hubVersion,
      minimumVersion: LOCAL_AI_COMPANION_RELEASE.minimumPrivateHubVersion,
      recommendedVersion: LOCAL_AI_COMPANION_RELEASE.recommendedPrivateHubVersion,
    });
    if (versionStatus === "unknown" || versionStatus === "incompatible") {
      throw new AiProviderError(
        "LOCAL_PROVIDER_NOT_READY",
        `Private Hub ${String(health.hubVersion ?? "unknown")} is not compatible with the current Studio release.`,
        { retryable: false, stage: "private-control-auto-session" },
      );
    }
    if (
      this.session
      && (
        this.session.instanceId !== health.instanceId
        || Date.parse(this.session.expiresAt) <= Date.now()
      )
    ) {
      this.setSession(null);
      this.clearRememberedSession();
    }
    if (this.session) {
      return {
        state: "connected" as const,
        mode: "existing-session" as const,
        session: this.getSessionMetadata()!,
      };
    }
    if (health.automaticSessionSupported !== true) {
      throw new AiProviderError(
        "LOCAL_PROVIDER_NOT_READY",
        "This Private Hub does not support trusted-origin automatic sessions.",
        { retryable: false, stage: "private-control-auto-session" },
      );
    }
    const body = await this.parse(await this.fetchHub(
      "/session/auto",
      {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "closed-ai-connect" }),
      },
      signal,
    ));
    if (
      typeof body.token !== "string"
      || body.token.length < 32
      || typeof body.csrf !== "string"
      || body.csrf.length < 24
      || typeof body.instanceId !== "string"
      || !body.instanceId
      || typeof body.expiresAt !== "string"
      || Date.parse(body.expiresAt) <= Date.now()
      || body.automaticConnection !== true
      || body.sessionKind !== "trusted_origin_auto"
    ) {
      throw new AiProviderError(
        "OLLAMA_INVALID_RESPONSE",
        "Private Hub did not return a valid origin-bound control session.",
        { retryable: true, stage: "private-control-auto-session" },
      );
    }
    this.setSession({
      token: body.token,
      csrf: body.csrf,
      instanceId: body.instanceId,
      expiresAt: body.expiresAt,
    });
    this.saveRememberedSession();
    return {
      state: "connected" as const,
      mode: "trusted-origin-auto" as const,
      session: this.getSessionMetadata()!,
    };
  }

  async connectAutomatically(
    preferredModelId = "qwen2.5:3b",
    signal?: AbortSignal,
  ): Promise<PrivateHubAutomaticConnection> {
    if (this.automaticConnectionInFlight) {
      return structuredClone(await this.automaticConnectionInFlight);
    }
    const operation = (async () => {
      const health = await this.health(
        signal ?? AbortSignal.timeout(PRIVATE_HUB_CONTROL_TIMEOUT_MS),
      );
      const versionStatus = evaluateLocalAIRuntimeVersion({
        reportedVersion: health.hubVersion,
        minimumVersion: LOCAL_AI_COMPANION_RELEASE.minimumPrivateHubVersion,
        recommendedVersion: LOCAL_AI_COMPANION_RELEASE.recommendedPrivateHubVersion,
      });
      if (versionStatus === "unknown" || versionStatus === "incompatible") {
        throw new AiProviderError(
          "LOCAL_PROVIDER_NOT_READY",
          `Private Hub ${String(health.hubVersion ?? "unknown")} is not compatible with the current Studio release.`,
          { retryable: false, stage: "private-automatic-connection" },
        );
      }
      if (
        this.session
        && (
          this.session.instanceId !== health.instanceId
          || Date.parse(this.session.expiresAt) <= Date.now()
        )
      ) {
        this.setSession(null);
        this.clearRememberedSession();
      }
      let automaticSessionIssued = false;
      const issueAutomaticSession = async () => {
        if (health.automaticSessionSupported !== true) {
          throw new AiProviderError(
            "LOCAL_PROVIDER_NOT_READY",
            "This Private Hub version does not support trusted-origin automatic sessions.",
            { retryable: false, stage: "private-automatic-connection" },
          );
        }
        const body = await this.parse(await this.fetchHub(
          "/session/auto",
          {
            method: "POST",
            headers: { ...this.headers(), "Content-Type": "application/json" },
            body: JSON.stringify({ intent: "closed-ai-connect" }),
          },
          signal,
        ));
        const validSession = typeof body.token === "string"
          && body.token.length >= 32
          && typeof body.csrf === "string"
          && body.csrf.length >= 24
          && typeof body.instanceId === "string"
          && body.instanceId.length > 0
          && typeof body.expiresAt === "string"
          && Date.parse(body.expiresAt) > Date.now()
          && body.automaticConnection === true
          && body.sessionKind === "trusted_origin_auto";
        if (!validSession) {
          throw new AiProviderError(
            "OLLAMA_INVALID_RESPONSE",
            "Private Hub did not return a valid origin-bound automatic session.",
            { retryable: true, stage: "private-automatic-connection" },
          );
        }
        this.setSession({
          token: body.token!,
          csrf: body.csrf!,
          instanceId: body.instanceId!,
          expiresAt: body.expiresAt!,
        });
        this.saveRememberedSession();
        automaticSessionIssued = true;
      };
      if (!this.session) await issueAutomaticSession();

      let modelResponse;
      try {
        modelResponse = await this.models(signal);
      } catch (error) {
        const code = String((error as { code?: string })?.code ?? "");
        if (!["BRIDGE_NOT_PAIRED", "BRIDGE_PAIRING_EXPIRED", "BRIDGE_PAIRING_REVOKED"].includes(code)) {
          throw error;
        }
        this.setSession(null);
        this.clearRememberedSession();
        await issueAutomaticSession();
        modelResponse = await this.models(signal);
      }
      const available = modelResponse.models.filter(
        (model) => model.capabilities?.textGeneration?.value === true,
      );
      const selectedId = selectAvailableTextModel(available, preferredModelId);
      const selected = available.find((model) => model.modelId === selectedId);
      if (!selected) {
        throw new AiProviderError(
          "OLLAMA_MODEL_NOT_FOUND",
          "Automatic Private Hub connection succeeded, but no text model is available.",
          { retryable: true, stage: "private-automatic-connection" },
        );
      }
      const proof = this.getModelVerification(
        selected.modelId,
        selected.modelDigest ?? null,
      ) ?? await this.verifyModel(
        selected.modelId,
        signal,
        selected.modelDigest ?? null,
      );
      const session = this.getSessionMetadata();
      if (!session) {
        throw new AiProviderError(
          "BRIDGE_NOT_PAIRED",
          "Automatic Private Hub session was lost during verification.",
          { retryable: true, stage: "private-automatic-connection" },
        );
      }
      return {
        state: "connected" as const,
        mode: automaticSessionIssued ? "trusted-origin-auto" as const : "existing-session" as const,
        session,
        model: structuredClone(selected),
        proof,
      };
    })();
    this.automaticConnectionInFlight = operation;
    try {
      return structuredClone(await operation);
    } finally {
      if (this.automaticConnectionInFlight === operation) {
        this.automaticConnectionInFlight = null;
      }
    }
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

  async verifyModel(
    modelId: string,
    signal?: AbortSignal,
    expectedModelDigest?: string | null,
  ) {
    let catalogDigest = expectedModelDigest;
    if (catalogDigest === undefined) {
      const catalog = await this.models(signal);
      catalogDigest = catalog.models.find((model) => (
        model.modelId === modelId
        && model.capabilities?.textGeneration?.value === true
      ))?.modelDigest ?? null;
    }
    if (!isCryptographicClosedAIModelDigest(catalogDigest)) {
      throw new AiProviderError(
        "LOCAL_REQUEST_IDENTITY_MISMATCH",
        "Private Hub catalog has no cryptographic model identity.",
        { retryable: false, stage: "private-hub-model-verification" },
      );
    }
    const body = await this.parse(await this.fetchHub(
      "/model/verify",
      {
        method: "POST",
        headers: { ...this.headers(true, true), "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      },
      signal,
      PRIVATE_HUB_MODEL_VERIFICATION_TIMEOUT_MS,
    ));
    if (!validateInferenceProof(body, this.session, {
      modelId,
      modelDigest: catalogDigest,
    })) {
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

  async storeLearningExperience(
    experience: AutonomousPracticeExperience,
    signal?: AbortSignal,
  ): Promise<PrivateHubLearningExperienceReceipt> {
    const body = await this.parse(await this.fetchHub(
      "/learning/experiences",
      {
        method: "POST",
        headers: { ...this.headers(true, true), "Content-Type": "application/json" },
        body: JSON.stringify(experience),
      },
      signal,
    ));
    if (
      body.status !== "durably_recorded"
      || body.durable !== true
      || typeof body.deduplicated !== "boolean"
      || !Number.isInteger(body.sequence)
      || typeof body.receivedAt !== "string"
      || body.experienceDigest !== experience.experienceDigest
      || !/^[a-f0-9]{64}$/iu.test(String(body.receiptDigest || ""))
      || !/^[a-f0-9]{64}$/iu.test(String(body.ledgerHead || ""))
      || body.rawContentStored !== false
      || body.canonicalMutationCount !== 0
      || body.modelWeightMutationCount !== 0
    ) {
      throw new AiProviderError(
        "AI_PROVIDER_INVALID_RESPONSE",
        "Private Hub learning ledger returned an invalid receipt.",
        { retryable: false, stage: "private-learning-ledger" },
      );
    }
    return body as PrivateHubBody & PrivateHubLearningExperienceReceipt;
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
        status: "unreachable",
        runtimeTruth: {
          installed: false,
          configured: false,
          reachable: false,
          modelAvailable: false,
          runtimeVerified: false,
          generationVerified: false,
          verificationSource: "none",
          verifiedAt: null,
        },
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
          status: "setup_required",
          runtimeTruth: {
            installed: true,
            configured: false,
            reachable: true,
            modelAvailable: false,
            runtimeVerified: false,
            generationVerified: false,
            verificationSource: "none",
            verifiedAt: null,
          },
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
      const adapter = projectId
        ? client.getActiveAdapter(projectId)
        : null;
      const catalogModelDigest = isCryptographicClosedAIModelDigest(
        model?.modelDigest,
      )
        ? model.modelDigest
        : null;
      const proof = model && catalogModelDigest
        ? client.getModelVerification(model.modelId, catalogModelDigest)
        : null;
      const routedModelDigest = model
        ? await privateHubRoutedModelDigest(
          catalogModelDigest,
          adapter?.artifactDigest,
        )
        : null;
      const generationIdentityVerified = Boolean(
        model
        && catalogModelDigest
        && routedModelDigest
        && proof
        && proof.modelId === model.modelId
        && proof.modelDigest === catalogModelDigest,
      );
      return {
        id: "private-ai-hub",
        label: "私有 AI Hub",
        status: generationIdentityVerified
          ? "ready"
          : model
            ? "degraded"
            : "setup_required",
        runtimeTruth: {
          installed: true,
          configured: Boolean(model),
          reachable: true,
          modelAvailable: Boolean(model && routedModelDigest),
          runtimeVerified: generationIdentityVerified,
          generationVerified: generationIdentityVerified,
          verificationSource: generationIdentityVerified
            ? "private-hub-generation"
            : "none",
          verifiedAt: generationIdentityVerified ? proof?.verifiedAt ?? null : null,
        },
        modelId: model?.modelId ?? null,
        modelDigest: routedModelDigest,
        local: true,
        dataBoundary: "private-infrastructure",
        maximumComplexity: "heavy",
        capabilities: ["text", "structured", "streaming", "long-context"],
        supportedTaskTypes: "all",
        maxContext: Number(model?.contextLength?.value ?? 0),
        controlLatencyMs: Math.round(performance.now() - startedAt),
        detailCode: generationIdentityVerified
          ? adapter
            ? `model_and_adapter_verified:${adapter.modelId}`
            : "model_inference_verified:no_active_adapter"
          : model
            ? catalogModelDigest
              ? "model_inference_not_verified"
              : "model_identity_not_verifiable"
            : "private_hub_model_not_available",
      };
    } catch {
      return {
        id: "private-ai-hub",
        label: "私有 AI Hub",
        status: "unreachable",
        runtimeTruth: {
          installed: false,
          configured: false,
          reachable: false,
          modelAvailable: false,
          runtimeVerified: false,
          generationVerified: false,
          verificationSource: "none",
          verifiedAt: null,
        },
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
  ): Promise<ClosedBackendRawExecutionResult> {
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
      || !isCryptographicClosedAIModelDigest(routedModelDigest)
    ) {
      throw Object.assign(
        new Error("Private Hub task has no verified routed model identity."),
        {
          code: "CLOSED_AI_SELECTED_BACKEND_NOT_READY",
        },
      );
    }
    const catalog = await client.models(input.request.signal);
    const catalogModel = catalog.models.find((model) => (
      model.modelId === routedModelId
      && model.capabilities?.textGeneration?.value === true
    )) ?? null;
    const catalogModelDigest = isCryptographicClosedAIModelDigest(
      catalogModel?.modelDigest,
    )
      ? catalogModel.modelDigest
      : null;
    const proof = catalogModelDigest
      ? client.getModelVerification(routedModelId, catalogModelDigest)
      : null;
    const activeAdapter = client.getActiveAdapter(
      input.request.namespace.projectId,
    );
    const expectedRoutedModelDigest = await privateHubRoutedModelDigest(
      catalogModelDigest,
      activeAdapter?.artifactDigest,
    );
    if (
      !catalogModel
      || !catalogModelDigest
      || !proof
      || proof.modelId !== routedModelId
      || proof.modelDigest !== catalogModelDigest
      || expectedRoutedModelDigest !== routedModelDigest
    ) {
      throw Object.assign(
        new Error("Private Hub routed model identity no longer matches its verified catalog proof."),
        {
          code: "CLOSED_AI_MODEL_IDENTITY_MISMATCH",
        },
      );
    }
    let content = "";
    let completed = false;
    let adapterId: string | null = null;
    let adapterDigest: string | null = null;
    const startedAt = performance.now();
    const generation = buildPrivateHubClosedGenerationRequest(input);
    const { profile, prompt, options } = generation;
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
      options,
      cacheNamespace: input.request.namespace,
      signal: input.request.signal,
    })) {
      if (event.type === "started") {
        adapterId = typeof event.adapterId === "string" ? event.adapterId : null;
        adapterDigest = typeof event.adapterDigest === "string"
          ? event.adapterDigest
          : null;
        if (
          adapterId !== (activeAdapter?.modelId ?? null)
          || adapterDigest !== (activeAdapter?.artifactDigest ?? null)
        ) {
          throw Object.assign(
            new Error("Private Hub generation started with a different adapter identity."),
            { code: "CLOSED_AI_MODEL_IDENTITY_MISMATCH" },
          );
        }
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
      content,
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

export function buildPrivateHubClosedGenerationRequest(
  input: ClosedBackendExecutionInput,
) {
  const profile = getClosedAIModelProfile(
    input.request.taskType,
    "private-ai-hub",
  );
  const regenerationContext = closedAIRegenerationPromptContext(
    input.request.regeneration,
  );
  const prompt = buildClosedAIModelPrompt({
    objective: input.request.objective,
    context: input.actorContext.map((item) => item.text),
    mandatoryInstruction: regenerationContext[0],
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
  return {
    profile,
    prompt,
    options: {
      ...profile.options,
      ...(input.request.regeneration
        ? { seed: input.request.regeneration.modelSeed }
        : {}),
    },
  };
}
