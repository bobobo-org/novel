import {
  resolveClosedAIRoute,
  taskComplexity,
  type ClosedAIBackendId,
  type ClosedAIBackendSnapshot,
  type ClosedAIExecutionReceipt,
  type ClosedAIRoutePolicy,
  type ClosedAIRouteResolution,
} from "../closed-agent-os";
import type { ClosedAINamespace } from "../closed-ai-cache";
import {
  detectBrowserAI,
  getBrowserAIInferenceProof,
  type BrowserAICapability,
} from "../providers/browser-ai/browser-ai-provider";
import {
  configureLocalBridgeClient,
  configureLocalBridgeModel,
  LocalBridgeClient,
  type LocalBridgeAutomaticConnection,
} from "../providers/local-ollama/local-bridge-client";
import {
  configurePrivateHubClient,
  configurePrivateHubModel,
  configurePrivateHubProject,
  PrivateHubClient,
  type PrivateHubAutomaticConnection,
} from "../providers/private-ai-hub/private-hub-client";
import type { PlatformTaskType } from "../router/platform-types";
import {
  FAST_LOCAL_WRITER_MODEL,
  RECOMMENDED_LOCAL_WRITER_MODEL,
} from "../model-orchestration/recommended-models";
import {
  resolveClosedAiConsumerReadiness,
  type ClosedAiConsumerReadiness,
} from "./closed-ai-consumer-readiness";

export const CLOSED_AI_RUNTIME_COORDINATOR_SCHEMA_VERSION =
  "closed-ai-runtime-coordinator-v1" as const;

export type ClosedAIRuntimeState =
  | "checking"
  | "permission_required"
  | "service_not_running"
  | "pairing_required"
  | "model_missing"
  | "model_verification_required"
  | "ready_light"
  | "ready_standard"
  | "ready_heavy"
  | "degraded"
  | "blocked";

export type ClosedAIAutomaticConnectionResult = {
  localOllama: PromiseSettledResult<LocalBridgeAutomaticConnection>;
  privateHub: PromiseSettledResult<PrivateHubAutomaticConnection>;
};

export type ClosedAIRuntimeReleaseStatus = {
  status: "verified" | "unverified" | "unreachable";
  appCommit: string | null;
  deploymentId: string | null;
  environment: string | null;
};

export type ClosedAIRuntimeSnapshot = {
  schemaVersion: typeof CLOSED_AI_RUNTIME_COORDINATOR_SCHEMA_VERSION;
  state: ClosedAIRuntimeState;
  checkedAt: string;
  releaseStatus: ClosedAIRuntimeReleaseStatus;
  browserTaskModel: {
    status: "ready" | "unavailable";
    generative: false;
    modelId: string | null;
    allowedTaskCount: number;
  };
  browserGenerativeModel: {
    status: "ready" | "available" | "setup_required" | "unavailable";
    generative: true;
    modelId: string | null;
    maximumComplexity: "standard";
  };
  localNetworkPermission: PermissionState | "unsupported";
  localBridge: {
    status: ClosedAIBackendSnapshot["status"];
    detailCode: string;
    paired: boolean;
    instanceId: string | null;
  };
  localOllama: {
    status: ClosedAIBackendSnapshot["status"];
    modelId: string | null;
    modelDigest: string | null;
    proofVerified: boolean;
  };
  privateHub: {
    status: ClosedAIBackendSnapshot["status"];
    modelId: string | null;
    modelDigest: string | null;
    proofVerified: boolean;
    paired: boolean;
  };
  plannedBackend: ClosedAIBackendId | null;
  plannedModel: string | null;
  plannedModelProof: "verified" | "not_verified" | "not_applicable";
  routeStatus: ClosedAIRouteResolution["executionStatus"];
  pairingExpiry: string | null;
  actualExecutor: ClosedAIBackendId | "not_executed";
  executionReceipt: ClosedAIExecutionReceipt | null;
  plannedDataBoundary: "device" | "private-infrastructure" | "none";
  lastError: {
    code: string;
    message: string;
  } | null;
  nextAction: ClosedAIRouteResolution["recommendedNextAction"];
  route: ClosedAIRouteResolution;
  backends: ClosedAIBackendSnapshot[];
  consumerReadiness: ClosedAiConsumerReadiness;
};

type SnapshotReader = (
  signal?: AbortSignal,
  namespace?: Pick<ClosedAINamespace, "projectId">,
) => Promise<ClosedAIBackendSnapshot[]>;

type ReleaseReader = (
  signal?: AbortSignal,
) => Promise<ClosedAIRuntimeReleaseStatus>;

export type ClosedAIRuntimeCoordinatorOptions = {
  origin: string;
  snapshotReader: SnapshotReader;
  localClient?: LocalBridgeClient;
  privateHubClient?: PrivateHubClient;
  releaseReader?: ReleaseReader;
  browserCapabilityReader?: () => Promise<BrowserAICapability>;
};

export type ClosedAIRuntimeRefreshInput = {
  projectId: string;
  taskType: PlatformTaskType;
  storyId?: string;
  canonId?: string;
  branchId?: string;
  characterId?: string;
  storyBibleRevision?: string | number;
  knowledgeScopeRevision?: string | number;
  policy?: ClosedAIRoutePolicy;
  signal?: AbortSignal;
};

function safeError(error: unknown) {
  return {
    code: String((error as { code?: string })?.code || "CLOSED_AI_RUNTIME_CHECK_FAILED"),
    message: error instanceof Error
      ? error.message
      : "Closed AI runtime check failed.",
  };
}

async function readReleaseIdentity(
  signal?: AbortSignal,
): Promise<ClosedAIRuntimeReleaseStatus> {
  if (typeof fetch !== "function") {
    return {
      status: "unreachable",
      appCommit: null,
      deploymentId: null,
      environment: null,
    };
  }
  try {
    const response = await fetch("/api/release/identity", {
      cache: "no-store",
      signal,
    });
    const body = await response.json() as {
      appCommit?: string;
      deploymentId?: string;
      environment?: string;
      provenanceStatus?: string;
    };
    return {
      status: response.ok && body.provenanceStatus === "verified"
        ? "verified"
        : "unverified",
      appCommit: body.appCommit ?? null,
      deploymentId: body.deploymentId ?? null,
      environment: body.environment ?? null,
    };
  } catch {
    return {
      status: "unreachable",
      appCommit: null,
      deploymentId: null,
      environment: null,
    };
  }
}

async function readLocalNetworkPermission(): Promise<
  PermissionState | "unsupported"
> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unsupported";
  }
  const states: PermissionState[] = [];
  for (const name of ["loopback-network", "local-network-access"]) {
    try {
      const result = await navigator.permissions.query({
        name,
      } as PermissionDescriptor);
      states.push(result.state);
    } catch {
      // Chromium exposes one of these names depending on its release channel.
    }
  }
  if (states.includes("granted")) return "granted";
  if (states.length && states.every((state) => state === "denied")) {
    return "denied";
  }
  return states.length ? "prompt" : "unsupported";
}

function localNetworkPermissionDeniedError() {
  return Object.assign(
    new Error("The browser denied Local Network Access for this site."),
    {
      code: "LOCAL_NETWORK_PERMISSION_DENIED",
      retryable: false,
      stage: "local-network-permission",
    },
  );
}

export function resolveEffectiveLocalNetworkPermission(input: {
  reported: PermissionState | "unsupported";
  localRuntimeReady: boolean;
  loopbackSessionEstablished: boolean;
}): PermissionState | "unsupported" {
  // A verified, origin-bound loopback session can only exist after the browser
  // successfully reached the local service. Some Chromium channels still
  // report a stale or alias-specific `denied` value through Permissions API;
  // do not show that value as truth after the real connection succeeded.
  if (input.localRuntimeReady && input.loopbackSessionEstablished) {
    return "granted";
  }
  return input.reported;
}

function namespaceForTask(
  input: ClosedAIRuntimeRefreshInput,
): ClosedAINamespace {
  const complexity = taskComplexity(input.taskType);
  return {
    tenantId: "local-tenant",
    userId: "local-author",
    projectId: input.projectId,
    storyId: input.storyId ?? input.projectId,
    canonId: input.canonId ?? `canon:${input.projectId}`,
    branchId: input.branchId ?? "main",
    characterId: input.characterId ?? "shared",
    agentRole: "closed-agent-os",
    modelId: "unrouted:runtime-managed",
    modelDigest: "unrouted:digest-runtime-managed",
    promptProfileVersion: "closed-ai-runtime-coordinator-v1",
    storyBibleRevision: String(input.storyBibleRevision ?? "current"),
    knowledgeScopeRevision: String(input.knowledgeScopeRevision ?? "current"),
    privacyLevel: complexity === "heavy"
      ? "private_infrastructure_only"
      : "device_only",
  };
}

function deriveState(
  route: ClosedAIRouteResolution,
  snapshots: ClosedAIBackendSnapshot[],
  permission: PermissionState | "unsupported",
): ClosedAIRuntimeState {
  if (route.executionStatus === "routable") {
    if (route.complexity === "heavy") return "ready_heavy";
    if (route.complexity === "standard") return "ready_standard";
    return "ready_light";
  }
  if (permission === "denied") return "permission_required";
  const relevant = route.complexity === "heavy"
    ? snapshots.find((item) => item.id === "private-ai-hub")
    : snapshots.find((item) => item.id === "local-ollama");
  if (relevant?.detailCode.includes("model_inference_not_verified")) {
    return "model_verification_required";
  }
  if (relevant?.detailCode.includes("model_not_available")) {
    return "model_missing";
  }
  if (
    relevant?.detailCode.includes("pair")
    || relevant?.status === "setup_required"
  ) {
    return "pairing_required";
  }
  if (
    relevant?.status === "unreachable"
    || relevant?.detailCode.includes("unreachable")
  ) {
    return "service_not_running";
  }
  if (snapshots.some((item) => item.status === "degraded")) return "degraded";
  return "blocked";
}

export class ClosedAIRuntimeCoordinator {
  readonly origin: string;
  readonly localClient: LocalBridgeClient;
  readonly privateHubClient: PrivateHubClient;
  private readonly snapshotReader: SnapshotReader;
  private readonly releaseReader: ReleaseReader;
  private readonly browserCapabilityReader: () => Promise<BrowserAICapability>;
  private readonly executionReceipts = new Map<string, ClosedAIExecutionReceipt>();
  private localRecoveryPromise: Promise<void> | null = null;
  private privateHubRecoveryPromise: Promise<void> | null = null;
  private localRecoveryError: ReturnType<typeof safeError> | null = null;
  private privateHubRecoveryError: ReturnType<typeof safeError> | null = null;

  constructor(options: ClosedAIRuntimeCoordinatorOptions) {
    this.origin = options.origin;
    this.snapshotReader = options.snapshotReader;
    this.releaseReader = options.releaseReader ?? readReleaseIdentity;
    this.browserCapabilityReader =
      options.browserCapabilityReader ?? detectBrowserAI;
    this.localClient = options.localClient ?? new LocalBridgeClient({
      origin: options.origin,
      rememberWithinTab: true,
    });
    this.privateHubClient = options.privateHubClient ?? new PrivateHubClient({
      origin: options.origin,
      rememberWithinTab: true,
    });
  }

  setRememberPairingWithinTab(enabled: boolean) {
    this.localClient.setRememberWithinTab(enabled);
    this.privateHubClient.setRememberWithinTab(enabled);
  }

  getRememberPairingWithinTab() {
    return this.localClient.getRememberWithinTab()
      && this.privateHubClient.getRememberWithinTab();
  }

  private executionReceiptKey(
    projectId: string,
    taskType: PlatformTaskType,
  ) {
    return `${projectId}\u0000${taskType}`;
  }

  beginExecution(
    projectId: string,
    taskType: PlatformTaskType,
  ) {
    this.executionReceipts.delete(
      this.executionReceiptKey(projectId, taskType),
    );
  }

  recordExecutionReceipt(
    projectId: string,
    taskType: PlatformTaskType,
    receipt: ClosedAIExecutionReceipt,
  ) {
    const startedAt = Date.parse(receipt.startedAt);
    const completedAt = Date.parse(receipt.completedAt);
    const valid =
      receipt.taskId.trim().length > 0
      && ["browser-ai", "local-ollama", "private-ai-hub"].includes(
        receipt.backendId,
      )
      && receipt.modelId.trim().length > 0
      && receipt.modelDigest.trim().length > 0
      && Number.isFinite(startedAt)
      && Number.isFinite(completedAt)
      && completedAt >= startedAt
      && Number.isInteger(receipt.generatedTokenEvents)
      && receipt.generatedTokenEvents >= 0
      && Number.isInteger(receipt.outputCharacters)
      && receipt.outputCharacters > 0
      && /^[a-f0-9]{64}$/i.test(receipt.contentDigest)
      && /^[a-f0-9]{64}$/i.test(receipt.contextDigest)
      && receipt.proofState === "verified"
      && typeof receipt.dataLeftDevice === "boolean"
      && typeof receipt.externalRequest === "boolean";
    const key = this.executionReceiptKey(projectId, taskType);
    if (!valid) {
      this.executionReceipts.delete(key);
      throw Object.assign(
        new Error("Closed AI execution receipt failed validation."),
        { code: "CLOSED_AI_EXECUTION_RECEIPT_INVALID" },
      );
    }
    this.executionReceipts.set(key, structuredClone(receipt));
  }

  private async restoreLocalPairing(signal?: AbortSignal) {
    if (!this.localRecoveryPromise) {
      const recovery = (async () => {
        try {
          const local = await this.localClient.restoreRememberedSession(signal);
          if (local) {
            configureLocalBridgeClient(this.localClient);
            configureLocalBridgeModel(local.model.modelId);
          }
          this.localRecoveryError = null;
        } catch (error) {
          this.localRecoveryError = safeError(error);
          if (signal?.aborted) {
            throw signal.reason ?? error;
          }
          // A stale tab session is recoverable. The automatic exact-origin
          // connection below must still get an opportunity to create a new one.
        }
      })();
      this.localRecoveryPromise = recovery;
    }
    const recovery = this.localRecoveryPromise;
    try {
      await recovery;
    } catch (error) {
      if (this.localRecoveryPromise === recovery) {
        this.localRecoveryPromise = null;
      }
      throw error;
    }
  }

  private async restorePrivateHubPairing(signal?: AbortSignal) {
    if (!this.privateHubRecoveryPromise) {
      const recovery = (async () => {
        try {
          const privateHub = await this.privateHubClient.restoreRememberedSession(
            signal,
          );
          if (privateHub) {
            configurePrivateHubClient(this.privateHubClient);
            configurePrivateHubModel(privateHub.model.modelId);
          }
          this.privateHubRecoveryError = null;
        } catch (error) {
          this.privateHubRecoveryError = safeError(error);
          if (signal?.aborted) {
            throw signal.reason ?? error;
          }
          // Private Hub is optional for standard local writing. Its stale
          // session cannot block Local Ollama or the Browser AI fabric.
        }
      })();
      this.privateHubRecoveryPromise = recovery;
    }
    const recovery = this.privateHubRecoveryPromise;
    try {
      await recovery;
    } catch (error) {
      if (this.privateHubRecoveryPromise === recovery) {
        this.privateHubRecoveryPromise = null;
      }
      throw error;
    }
  }

  async connectAutomatically(
    signal?: AbortSignal,
  ): Promise<ClosedAIAutomaticConnectionResult> {
    // Chromium logs every blocked loopback fetch as a console/network error.
    // Read the native permission first so a denied site does not repeatedly
    // probe both Companion ports while React surfaces rediscover capabilities.
    // A later user permission change is picked up because every explicit or
    // automatic reconnect queries the live browser permission again.
    if (await readLocalNetworkPermission() === "denied") {
      return {
        localOllama: {
          status: "rejected",
          reason: localNetworkPermissionDeniedError(),
        },
        privateHub: {
          status: "rejected",
          reason: localNetworkPermissionDeniedError(),
        },
      };
    }
    const [localOllama, privateHub] = await Promise.allSettled([
      this.connectLocalAutomatically(signal),
      this.connectPrivateHubAutomatically(signal),
    ]);
    return { localOllama, privateHub };
  }

  // A missing Private Hub must never delay a ready Local Ollama route.
  async connectLocalAutomatically(
    signal?: AbortSignal,
  ): Promise<LocalBridgeAutomaticConnection> {
    await this.restoreLocalPairing(signal);
    const localOllama = await this.localClient.connectAutomatically(
      FAST_LOCAL_WRITER_MODEL,
      signal,
    );
    configureLocalBridgeClient(this.localClient);
    configureLocalBridgeModel(localOllama.model.modelId);
    return localOllama;
  }

  async connectPrivateHubAutomatically(
    signal?: AbortSignal,
  ): Promise<PrivateHubAutomaticConnection> {
    await this.restorePrivateHubPairing(signal);
    const privateHub = await this.privateHubClient.connectAutomatically(
      RECOMMENDED_LOCAL_WRITER_MODEL,
      signal,
    );
    configurePrivateHubClient(this.privateHubClient);
    configurePrivateHubModel(privateHub.model.modelId);
    return privateHub;
  }

  async refresh(
    input: ClosedAIRuntimeRefreshInput,
  ): Promise<ClosedAIRuntimeSnapshot> {
    configurePrivateHubProject(input.projectId);
    await this.restoreLocalPairing(input.signal);
    // Restore the optional heavy-compute backend only when this request can
    // actually use it. Waking a remembered 7B Hub model during a standard
    // Local Ollama request can contend for the same CPU/RAM and make the
    // foreground 3B generation exceed its deadline.
    const shouldRestorePrivateHub =
      input.policy?.preferredBackend === "private-ai-hub" ||
      taskComplexity(input.taskType) === "heavy";
    if (shouldRestorePrivateHub) {
      void this.restorePrivateHubPairing(input.signal).catch(() => undefined);
    }
    const namespace = namespaceForTask(input);
    const [releaseStatus, browserCapability, localNetworkPermission, backends] =
      await Promise.all([
        this.releaseReader(input.signal),
        this.browserCapabilityReader(),
        readLocalNetworkPermission(),
        this.snapshotReader(input.signal, namespace),
      ]);
    const route = resolveClosedAIRoute({
      taskType: input.taskType,
      namespace,
      complexity: taskComplexity(input.taskType),
    }, backends, input.policy);
    const local = backends.find((item) => item.id === "local-ollama") ?? {
      id: "local-ollama" as const,
      label: "Local Ollama",
      status: "unreachable" as const,
      runtimeTruth: {
        installed: false,
        configured: false,
        reachable: false,
        modelAvailable: false,
        runtimeVerified: false,
        generationVerified: false,
        verificationSource: "none" as const,
        verifiedAt: null,
      },
      modelId: null,
      modelDigest: null,
      local: true,
      dataBoundary: "device" as const,
      maximumComplexity: "standard" as const,
      capabilities: [],
      supportedTaskTypes: "all" as const,
      detailCode: "runtime_required",
    };
    const privateHub = backends.find((item) => item.id === "private-ai-hub") ?? {
      id: "private-ai-hub" as const,
      label: "Private Hub",
      status: "unreachable" as const,
      runtimeTruth: {
        installed: false,
        configured: false,
        reachable: false,
        modelAvailable: false,
        runtimeVerified: false,
        generationVerified: false,
        verificationSource: "none" as const,
        verifiedAt: null,
      },
      modelId: null,
      modelDigest: null,
      local: true,
      dataBoundary: "private-infrastructure" as const,
      maximumComplexity: "heavy" as const,
      capabilities: [],
      supportedTaskTypes: "all" as const,
      detailCode: "self_hosted_private_node_not_connected",
    };
    const browser = backends.find((item) => item.id === "browser-ai");
    const selected = route.executionStatus === "routable"
      ? route.backend
      : null;
    const localSession = this.localClient.getSessionMetadata();
    const privateSession = this.privateHubClient.getSessionMetadata();
    const selectedProof = selected?.id === "local-ollama"
      ? this.localClient.getModelVerification(selected.modelId ?? undefined)
      : selected?.id === "private-ai-hub"
        ? this.privateHubClient.getModelVerification(selected.modelId ?? undefined)
        : getBrowserAIInferenceProof();
    const executionReceipt = this.executionReceipts.get(
      this.executionReceiptKey(input.projectId, input.taskType),
    ) ?? null;
    const effectiveLocalNetworkPermission = resolveEffectiveLocalNetworkPermission({
      reported: localNetworkPermission,
      localRuntimeReady: local.status === "ready",
      loopbackSessionEstablished: Boolean(localSession),
    });
    const consumerReadiness = resolveClosedAiConsumerReadiness(
      backends,
      selected?.id ?? null,
    );
    return {
      schemaVersion: CLOSED_AI_RUNTIME_COORDINATOR_SCHEMA_VERSION,
      state: deriveState(route, backends, effectiveLocalNetworkPermission),
      checkedAt: new Date().toISOString(),
      releaseStatus,
      browserTaskModel: {
        status: browser?.status === "ready" ? "ready" : "unavailable",
        generative: false,
        modelId: browserCapability.generativeModelReady
          ? null
          : browserCapability.modelId,
        allowedTaskCount: browser?.supportedTaskTypes === "all"
          ? 0
          : browser?.supportedTaskTypes.length ?? 0,
      },
      browserGenerativeModel: {
        status: browser?.runtimeTruth?.generationVerified
          ? "ready"
          : browserCapability.generativeModelReady
            ? "available"
            : browser?.status === "unsupported"
              ? "unavailable"
              : "setup_required",
        generative: true,
        modelId: browserCapability.generativeModelReady
          ? browserCapability.modelId
          : null,
        maximumComplexity: "standard",
      },
      localNetworkPermission: effectiveLocalNetworkPermission,
      localBridge: {
        status: local.status,
        detailCode: local.detailCode,
        paired: Boolean(localSession),
        instanceId: localSession?.instanceId ?? null,
      },
      localOllama: {
        status: local.status,
        modelId: local.modelId,
        modelDigest: local.modelDigest,
        proofVerified: Boolean(
          local.modelId
          && this.localClient.getModelVerification(local.modelId),
        ),
      },
      privateHub: {
        status: privateHub.status,
        modelId: privateHub.modelId,
        modelDigest: privateHub.modelDigest,
        proofVerified: Boolean(
          privateHub.modelId
          && this.privateHubClient.getModelVerification(privateHub.modelId),
        ),
        paired: Boolean(privateSession),
      },
      plannedBackend: selected?.id ?? null,
      plannedModel: selected?.modelId ?? null,
      plannedModelProof: selected?.id === "browser-ai"
        ? browser?.runtimeTruth?.generationVerified
          ? "verified"
          : browserCapability.generativeModelReady
            ? "not_verified"
            : "not_applicable"
        : selectedProof
          ? "verified"
          : "not_verified",
      routeStatus: route.executionStatus,
      pairingExpiry: selected?.id === "local-ollama"
        ? localSession?.expiresAt ?? null
        : selected?.id === "private-ai-hub"
          ? privateSession?.expiresAt ?? null
          : null,
      actualExecutor: executionReceipt?.backendId ?? "not_executed",
      executionReceipt: executionReceipt
        ? structuredClone(executionReceipt)
        : null,
      plannedDataBoundary: selected?.dataBoundary ?? "none",
      lastError: selected?.id === "private-ai-hub"
        ? this.privateHubRecoveryError
        : selected?.id === "local-ollama"
          ? this.localRecoveryError
          : this.localRecoveryError ?? this.privateHubRecoveryError,
      nextAction: route.recommendedNextAction,
      route,
      backends,
      consumerReadiness,
    };
  }
}
