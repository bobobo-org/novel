import type { PlatformTaskType } from "../router/platform-types";
import { isCryptographicClosedAIModelDigest } from "../closed-agent-os/types";
import {
  detectBrowserAI,
  verifyBrowserAI,
  type BrowserAICapability,
} from "../providers/browser-ai/browser-ai-provider";
import {
  browserWebLLMRuntimeSnapshot,
  cancelBrowserWebLLMSetup,
  failBrowserWebLLMSetup,
  finalizeBrowserWebLLMSetup,
  installBrowserWebLLMModel,
  prewarmBrowserWebLLMModel,
  repairSelectedBrowserWebLLMCache,
  selectBrowserWebLLMModel,
  type BrowserWebLLMSetupBoundary,
} from "../providers/browser-ai/browser-webllm-runtime";
import {
  BROWSER_WEBLLM_MODELS,
  type BrowserWebLLMModelId,
} from "../providers/browser-ai/webllm-model-registry";
import {
  browserAiSetupDiagnosticController,
  type BrowserAiSetupDiagnosticAttempt,
  type BrowserAiSetupDiagnosticControllerHandle,
} from "../providers/browser-ai/browser-ai-setup-diagnostics";
import type {
  ClosedAIRuntimeCoordinator,
  ClosedAIRuntimeSnapshot,
} from "./closed-ai-runtime-coordinator";
import {
  resolveClosedAiConsumerReadiness,
  type ClosedAiConsumerReadiness,
} from "./closed-ai-consumer-readiness";
import {
  BrowserAiSetupStateMachine,
  type BrowserAiSetupAttemptOwnership,
  type BrowserAiSetupStateSnapshot,
} from "./browser-ai-setup-state-machine";

export const CLOSED_AI_BOOTSTRAP_SCHEMA_VERSION =
  "closed-ai-bootstrap-v1" as const;

export type ClosedAiBootstrapStep =
  | "capability_detect"
  | "model_catalog_resolve"
  | "storage_quota_check"
  | "model_availability_check"
  | "model_download"
  | "integrity_verify"
  | "runtime_initialize"
  | "warmup"
  | "health_probe"
  | "generation_verify"
  | "router_register";

export type ClosedAiBootstrapProgress = {
  step: ClosedAiBootstrapStep;
  percent: number;
  message: string;
};

export type ClosedAiBootstrapResult = {
  schemaVersion: typeof CLOSED_AI_BOOTSTRAP_SCHEMA_VERSION;
  status: "ready" | "setup_required" | "unsupported" | "failed";
  readiness: ClosedAiConsumerReadiness;
  runtime: ClosedAIRuntimeSnapshot;
  browserCapability: BrowserAICapability;
  selectedModelId: BrowserWebLLMModelId | null;
  setup: {
    estimatedDownloadBytes: number;
    alternatives: Array<"local-ollama" | "private-ai-hub">;
  };
  safeMessage: string;
};

export type ClosedAiBootstrapInput = {
  projectId: string;
  taskType?: PlatformTaskType;
  requestedModelId?: BrowserWebLLMModelId;
  signal?: AbortSignal;
  onProgress?: (progress: ClosedAiBootstrapProgress) => void;
};

type BrowserBootstrapDependencies = {
  detectCapability: typeof detectBrowserAI;
  runtimeSnapshot: typeof browserWebLLMRuntimeSnapshot;
  repairCache: typeof repairSelectedBrowserWebLLMCache;
  installModel: typeof installBrowserWebLLMModel;
  prewarmModel: typeof prewarmBrowserWebLLMModel;
  verifyGeneration: typeof verifyBrowserAI;
  finalizeSetup: typeof finalizeBrowserWebLLMSetup;
  cancelSetup: typeof cancelBrowserWebLLMSetup;
  failSetup: typeof failBrowserWebLLMSetup;
  selectModel: typeof selectBrowserWebLLMModel;
};

type ActiveBootstrapOperation = {
  kind: "bootstrap" | "prepare";
  projectId: string;
  taskType: PlatformTaskType;
  signal: AbortSignal | undefined;
  promise: Promise<ClosedAiBootstrapResult>;
};

const defaultDependencies: BrowserBootstrapDependencies = {
  detectCapability: detectBrowserAI,
  runtimeSnapshot: browserWebLLMRuntimeSnapshot,
  repairCache: repairSelectedBrowserWebLLMCache,
  installModel: installBrowserWebLLMModel,
  prewarmModel: prewarmBrowserWebLLMModel,
  verifyGeneration: verifyBrowserAI,
  finalizeSetup: finalizeBrowserWebLLMSetup,
  cancelSetup: cancelBrowserWebLLMSetup,
  failSetup: failBrowserWebLLMSetup,
  selectModel: selectBrowserWebLLMModel,
};

function emit(
  input: ClosedAiBootstrapInput,
  step: ClosedAiBootstrapStep,
  percent: number,
  message: string,
) {
  input.onProgress?.({ step, percent, message });
}

function isAcknowledgedSetupCancellation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    code?: unknown;
    setupCancellationCode?: unknown;
    cancellationAcknowledged?: unknown;
  };
  return (
    value.code === "BROWSER_WEBLLM_SETUP_CANCELLED"
    || value.setupCancellationCode === "BROWSER_WEBLLM_SETUP_CANCELLED"
  )
    && value.cancellationAcknowledged === true;
}

function isNoResourceSetupCancellation(error: unknown) {
  return isAcknowledgedSetupCancellation(error)
    && (error as { metadataRollback?: unknown }).metadataRollback === "not_reached";
}

function setupAttemptPrefix() {
  const suffix = globalThis.crypto?.randomUUID?.();
  if (!suffix) {
    throw Object.assign(
      new Error("Secure randomness is required for Browser AI setup ownership."),
      { code: "BROWSER_AI_SETUP_SECURE_ID_UNAVAILABLE", retryable: false },
    );
  }
  return `browser-ai-setup-${suffix}`;
}

function noResourceSetupCancellation(cause: unknown) {
  return Object.assign(
    Object.assign(new Error(
      "Browser AI setup cancelled before model resources were claimed.",
    ), { name: "AbortError" }),
    {
      code: "BROWSER_WEBLLM_SETUP_CANCELLED",
      cancellationAcknowledged: true,
      cacheRetained: true,
      metadataRollback: "not_reached",
      cause,
    } as const,
  );
}

function lowestProductionModel(
  capability: BrowserAICapability,
  allowedModelIds: BrowserWebLLMModelId[],
) {
  if (!capability.webLlmSupported) return null;
  return BROWSER_WEBLLM_MODELS.find((model) => (
    model.productionQualified && allowedModelIds.includes(model.modelId)
  )) ?? null;
}

export class ClosedAiBootstrapCoordinator {
  private readonly runtime: ClosedAIRuntimeCoordinator;
  private readonly browser: BrowserBootstrapDependencies;
  private readonly browserAiSetupStateMachine: BrowserAiSetupStateMachine;
  private readonly browserAiSetupDiagnostics:
    | BrowserAiSetupDiagnosticControllerHandle
    | Promise<BrowserAiSetupDiagnosticControllerHandle | null>
    | null;
  private readonly abortControllerGenerations = new WeakMap<AbortSignal, string>();
  private previousBrowserAiSetupOwnership: BrowserAiSetupAttemptOwnership | null = null;
  private activeOperation: ActiveBootstrapOperation | null = null;
  private cancelledOperationSettlement: Promise<void> = Promise.resolve();

  constructor(
    runtime: ClosedAIRuntimeCoordinator,
    browser: BrowserBootstrapDependencies = defaultDependencies,
    options: {
      setupAttemptPrefix?: string;
      setupDiagnostics?:
        | BrowserAiSetupDiagnosticControllerHandle
        | Promise<BrowserAiSetupDiagnosticControllerHandle | null>
        | null;
    } = {},
  ) {
    this.runtime = runtime;
    this.browser = browser;
    this.browserAiSetupStateMachine = new BrowserAiSetupStateMachine({
      attemptIdPrefix: options.setupAttemptPrefix ?? setupAttemptPrefix(),
    });
    this.browserAiSetupDiagnostics = options.setupDiagnostics === undefined
      ? browserAiSetupDiagnosticController()
      : options.setupDiagnostics;
  }

  browserAiSetupSnapshot(): BrowserAiSetupStateSnapshot {
    return this.browserAiSetupStateMachine.snapshot();
  }

  private abortControllerGenerationId(signal: AbortSignal | undefined) {
    if (signal) {
      const existing = this.abortControllerGenerations.get(signal);
      if (existing) return existing;
    }
    const generationId = globalThis.crypto?.randomUUID?.();
    if (!generationId) {
      throw Object.assign(
        new Error("Secure randomness is required for diagnostic abort identity."),
        { code: "BROWSER_AI_SETUP_SECURE_ID_UNAVAILABLE", retryable: false },
      );
    }
    if (signal) this.abortControllerGenerations.set(signal, generationId);
    return generationId;
  }

  private injectAuthorizedStaleCompletion(
    current: BrowserAiSetupAttemptOwnership,
    diagnostics: BrowserAiSetupDiagnosticAttempt,
  ) {
    const stale = this.previousBrowserAiSetupOwnership;
    if (!stale || stale === current) {
      throw Object.assign(
        new Error("A prior Browser AI setup ownership is required for stale injection."),
        {
          code: "BROWSER_AI_SETUP_DIAGNOSTIC_STALE_COMPLETION_PREREQUISITE_MISSING",
          retryable: false,
        },
      );
    }
    const before = this.browserAiSetupStateMachine.snapshot();
    try {
      this.browserAiSetupStateMachine.completeReady(stale);
      throw Object.assign(new Error("Stale completion was not rejected."), {
        code: "BROWSER_AI_SETUP_DIAGNOSTIC_STALE_COMPLETION_NOT_REJECTED",
        retryable: false,
      });
    } catch (error) {
      if (
        !error
        || typeof error !== "object"
        || (error as { code?: unknown }).code !== "BROWSER_AI_SETUP_STALE_COMPLETION"
      ) throw error;
    }
    diagnostics.recordStaleCompletion();
    const after = this.browserAiSetupStateMachine.snapshot();
    if (
      after.state !== before.state
      || after.activeAttemptId !== before.activeAttemptId
      || after.epoch !== before.epoch
      || after.transitions.length !== before.transitions.length
    ) {
      throw Object.assign(new Error("Stale completion changed current setup state."), {
        code: "BROWSER_AI_SETUP_DIAGNOSTIC_STALE_COMPLETION_STATE_CHANGED",
        retryable: false,
      });
    }
  }

  private async withBrowserAiSetupAttempt(
    input: ClosedAiBootstrapInput,
    operation: (
      ownership: BrowserAiSetupAttemptOwnership,
      markCompletionCommitted: () => void,
      diagnostics: BrowserAiSetupDiagnosticAttempt | null,
    ) => Promise<ClosedAiBootstrapResult>,
  ) {
    let completionCommitted = false;
    const acquisition = this.browserAiSetupStateMachine.acquire({
      kind: "prepare",
      projectId: input.projectId,
      taskType: input.taskType ?? "chapter.continue",
    });
    if (acquisition.disposition !== "started") {
      throw Object.assign(
        new Error("Browser AI setup single-flight lost its owning promise."),
        { code: "BROWSER_AI_SETUP_OWNERSHIP_CONFLICT", retryable: true },
      );
    }
    const { ownership } = acquisition;
    let diagnosticAttempt: BrowserAiSetupDiagnosticAttempt | null = null;
    const requestCancellation = () => {
      if (completionCommitted) return;
      if (this.browserAiSetupStateMachine.owns(ownership)) {
        this.browserAiSetupStateMachine.requestCancellation(ownership);
      }
    };
    input.signal?.addEventListener("abort", requestCancellation, { once: true });
    try {
      const diagnosticController = this.browserAiSetupDiagnostics
        ? await this.browserAiSetupDiagnostics
        : null;
      diagnosticAttempt = diagnosticController
        ? await diagnosticController.bindAttempt({
            ...ownership,
            abortControllerGenerationId:
              this.abortControllerGenerationId(input.signal),
          })
        : null;
      const result = await operation(ownership, () => {
        completionCommitted = true;
        try {
          this.browserAiSetupStateMachine.completeCommittedReady(ownership);
        } catch (error) {
          diagnosticAttempt?.recordStaleCompletion();
          throw error;
        }
      }, diagnosticAttempt);
      if (input.signal?.aborted && !completionCommitted) {
        throw noResourceSetupCancellation(input.signal.reason);
      }
      if (completionCommitted) {
        return result;
      }
      if (result.status === "ready") {
        try {
          this.browserAiSetupStateMachine.completeReady(ownership);
        } catch (error) {
          diagnosticAttempt?.recordStaleCompletion();
          throw error;
        }
      } else {
        try {
          this.browserAiSetupStateMachine.completeFailure(
            ownership,
            { code: `BROWSER_AI_SETUP_${result.status.toUpperCase()}` },
            "attempt-not-ready",
          );
        } catch (error) {
          diagnosticAttempt?.recordLateFailure();
          throw error;
        }
      }
      return result;
    } catch (error) {
      if (completionCommitted) {
        throw Object.assign(
          error instanceof Error ? error : new Error(String(error)),
          { setupCompletionCommitted: true },
        );
      }
      if (isAcknowledgedSetupCancellation(error)) {
        if (diagnosticAttempt && isNoResourceSetupCancellation(error)) {
          diagnosticAttempt.acknowledgeCleanup({
            engineOwnershipMatched: true,
            engineDetached: true,
            workerDisposeAcknowledged: true,
            metadataCleanupAcknowledged: true,
          });
        }
        if (this.browserAiSetupStateMachine.owns(ownership)) {
          this.browserAiSetupStateMachine.requestCancellation(ownership);
          this.browserAiSetupStateMachine.acknowledgeCancellation(ownership);
        } else {
          diagnosticAttempt?.recordLateFailure();
        }
      } else if (
        this.browserAiSetupStateMachine.owns(ownership)
        && this.browserAiSetupStateMachine.snapshot().state === "cancelling"
      ) {
        this.browserAiSetupStateMachine.failCancellation(ownership, error);
      } else if (this.browserAiSetupStateMachine.owns(ownership)) {
        this.browserAiSetupStateMachine.completeFailure(ownership, error);
      } else {
        diagnosticAttempt?.recordLateFailure();
      }
      throw error;
    } finally {
      if (!this.browserAiSetupStateMachine.owns(ownership)) {
        this.previousBrowserAiSetupOwnership = ownership;
      }
      input.signal?.removeEventListener("abort", requestCancellation);
    }
  }

  private transitionBrowserAiSetup(
    ownership: BrowserAiSetupAttemptOwnership,
    state: "downloading" | "verifying" | "initializing" | "warming" | "generation-verifying",
    input: ClosedAiBootstrapInput,
    step: ClosedAiBootstrapStep,
    percent: number,
    message: string,
  ) {
    this.browserAiSetupStateMachine.transition(ownership, state, step);
    emit(input, step, percent, message);
  }

  private reusableOperation(
    kind: ActiveBootstrapOperation["kind"],
    input: ClosedAiBootstrapInput,
  ) {
    const active = this.activeOperation;
    if (!active) return null;
    if (active.signal?.aborted) {
      this.cancelledOperationSettlement = active.promise.then(
        () => undefined,
        () => undefined,
      );
      return null;
    }
    const taskType = input.taskType ?? "chapter.continue";
    if (
      active.kind === kind
      && active.projectId === input.projectId
      && active.taskType === taskType
      && active.signal === input.signal
    ) {
      return active.promise;
    }
    throw Object.assign(new Error("另一個 Browser AI 準備作業仍在進行。"), {
      code: "BROWSER_AI_BOOTSTRAP_OPERATION_IN_PROGRESS",
      retryable: true,
    });
  }

  private trackOperation(
    kind: ActiveBootstrapOperation["kind"],
    input: ClosedAiBootstrapInput,
    promise: Promise<ClosedAiBootstrapResult>,
  ) {
    const active: ActiveBootstrapOperation = {
      kind,
      projectId: input.projectId,
      taskType: input.taskType ?? "chapter.continue",
      signal: input.signal,
      promise,
    };
    this.activeOperation = active;
    void promise.finally(() => {
      if (this.activeOperation === active) this.activeOperation = null;
    }).catch(() => undefined);
    return promise;
  }

  async inspect(input: ClosedAiBootstrapInput): Promise<ClosedAiBootstrapResult> {
    emit(input, "capability_detect", 5, "正在檢查這台裝置的 Browser AI 能力。 ");
    const capability = await this.browser.detectCapability();
    emit(input, "model_catalog_resolve", 12, "已核對正式版可使用的裝置內模型。 ");
    const browserRuntime = await this.browser.runtimeSnapshot().catch(() => null);
    emit(input, "storage_quota_check", 18, "已檢查模型空間與本機儲存配額。 ");
    const requestedModel = input.requestedModelId
      ? BROWSER_WEBLLM_MODELS.find((model) => (
          model.modelId === input.requestedModelId
          && model.productionQualified
          && browserRuntime?.device.allowedModelIds.includes(model.modelId)
        )) ?? null
      : null;
    const selectedModel = requestedModel ?? (input.requestedModelId
      ? null
      : browserRuntime
      ? lowestProductionModel(
          capability,
          browserRuntime.device.allowedModelIds,
        )
      : null);
    const requestedRuntimeModel = requestedModel
      ? browserRuntime?.models?.find((model) => model.modelId === requestedModel.modelId)
      : null;
    const requestedModelReady = Boolean(
      requestedRuntimeModel?.selected
      && requestedRuntimeModel.installStatus === "ready"
      && requestedRuntimeModel.cacheVerified
      && requestedRuntimeModel.shardIntegrityVerified
      && requestedRuntimeModel.generationVerified,
    );
    emit(input, "model_availability_check", 25, "正在核對模型安裝與驗證狀態。 ");
    const runtime = await this.runtime.refresh({
      projectId: input.projectId,
      taskType: input.taskType ?? "chapter.continue",
      signal: input.signal,
    });
    const readiness = resolveClosedAiConsumerReadiness(
      runtime.backends,
      runtime.plannedBackend,
    );
    const browserBackend = runtime.backends.find((item) => item.id === "browser-ai");
    const status = input.requestedModelId && !requestedModel
      ? "unsupported" as const
      : input.requestedModelId
        ? requestedModelReady && readiness.generationVerifiedBackends > 0
          ? "ready" as const
          : "setup_required" as const
      : readiness.generationVerifiedBackends > 0
      ? "ready" as const
      : browserBackend?.status === "unsupported"
        ? "unsupported" as const
        : "setup_required" as const;
    const safeMessage = input.requestedModelId && !requestedModel
      ? "這台裝置無法使用所選 Browser AI 模型；請改選裝置支援的正式模型。"
      : status === "ready"
      ? `閉端 AI 已就緒：${readiness.activeBackend ?? "已驗證後端"}。`
      : status === "unsupported"
        ? "這台裝置無法使用 Browser AI；可改用 Local Ollama Companion 或 Private AI Hub。"
        : selectedModel
          ? `第一次使用需要準備 ${selectedModel.displayName}；完成後文章生成會留在此裝置。`
          : "請完成一個閉端後端的安裝、連線與真實生成實測。";
    return {
      schemaVersion: CLOSED_AI_BOOTSTRAP_SCHEMA_VERSION,
      status,
      readiness,
      runtime,
      browserCapability: capability,
      selectedModelId: selectedModel?.modelId ?? null,
      setup: {
        estimatedDownloadBytes: selectedModel?.estimatedDownloadBytes ?? 0,
        alternatives: ["local-ollama", "private-ai-hub"],
      },
      safeMessage,
    };
  }

  /**
   * Safe automatic bootstrap: it may repair/initialize an already downloaded
   * model and run a tiny health generation, but never downloads model weights.
   */
  async bootstrap(input: ClosedAiBootstrapInput): Promise<ClosedAiBootstrapResult> {
    const reusable = this.reusableOperation("bootstrap", input);
    if (reusable) return reusable;
    const operation = (async () => {
      let inspected = await this.inspect(input);
      if (inspected.status === "ready" || inspected.status === "unsupported") {
        return inspected;
      }
      if (!inspected.browserCapability.generativeModelReady) return inspected;
      emit(input, "integrity_verify", 42, "正在驗證已下載模型的完整性。 ");
      await this.browser.repairCache().catch(() => undefined);
      emit(input, "runtime_initialize", 54, "正在初始化裝置內生成 runtime。 ");
      if (inspected.browserCapability.webLlmInstalled) {
        emit(input, "warmup", 65, "正在從本機快取預熱 Browser AI。 ");
        await this.browser.prewarmModel(input.signal);
      }
      emit(input, "health_probe", 75, "正在執行 Browser AI 健康檢查。 ");
      emit(input, "generation_verify", 86, "正在做最小真實生成實測。 ");
      const proof = await this.browser.verifyGeneration(input.signal);
      if (
        proof.inferenceMode !== "generative-model"
        || !isCryptographicClosedAIModelDigest(proof.modelDigest)
      ) {
        throw Object.assign(
          new Error("這台裝置目前只有輕量任務工具，尚未完成生成模型實測。"),
          { code: "BROWSER_GENERATIVE_VERIFICATION_REQUIRED" },
        );
      }
      emit(input, "router_register", 96, "正在把已驗證模型註冊到 Closed Agent OS。 ");
      inspected = await this.inspect(input);
      if (inspected.readiness.generationVerifiedBackends < 1) {
        throw Object.assign(
          new Error("Browser AI 已回應，但生成證明未通過路由器驗證。"),
          { code: "CLOSED_AI_GENERATION_PROOF_REJECTED" },
        );
      }
      return inspected;
    })();
    return this.trackOperation("bootstrap", input, operation);
  }

  /** Model download is only reachable from an explicit setup-card click. */
  async prepareBrowserAi(
    input: ClosedAiBootstrapInput & { userInitiated: true },
  ): Promise<ClosedAiBootstrapResult> {
    if (input.userInitiated !== true) {
      throw Object.assign(new Error("模型準備需要使用者明確操作。"), {
        code: "BROWSER_MODEL_EXPLICIT_INSTALL_REQUIRED",
      });
    }
    const reusable = this.reusableOperation("prepare", input);
    if (reusable) return reusable;
    const operation = (async () => {
      await this.cancelledOperationSettlement;
      if (input.signal?.aborted) {
        throw noResourceSetupCancellation(input.signal.reason);
      }
      return this.withBrowserAiSetupAttempt(input, async (
        ownership,
        markCompletionCommitted,
        diagnostics,
      ) => {
        let setupBoundary: BrowserWebLLMSetupBoundary | null = null;
        let setupFinalized = false;
        try {
          const inspected = await this.inspect(input);
          if (inspected.status === "ready") return inspected;
          if (inspected.status === "unsupported") return inspected;
        const requestedRuntimeModel = input.requestedModelId
          ? (await this.browser.runtimeSnapshot()).models?.find(
              (model) => model.modelId === input.requestedModelId,
            )
          : null;
        const requestedModelCacheReady = Boolean(
          requestedRuntimeModel?.installStatus === "ready"
          && requestedRuntimeModel.cacheVerified
          && requestedRuntimeModel.shardIntegrityVerified
          && requestedRuntimeModel.generationVerified,
        );
        if (
          input.requestedModelId
          && requestedModelCacheReady
          && requestedRuntimeModel?.selected !== true
        ) {
          await this.browser.selectModel(input.requestedModelId);
        }
        if (
          (input.requestedModelId
            ? !requestedModelCacheReady
            : !inspected.browserCapability.generativeModelReady)
          && inspected.selectedModelId
        ) {
          setupBoundary = {
            modelId: inspected.selectedModelId,
            setupOwnership: {
              attemptId: ownership.attemptId,
              epoch: ownership.epoch,
            },
            ...(diagnostics ? { diagnostics } : {}),
          };
          this.transitionBrowserAiSetup(
            ownership,
            "downloading",
            input,
            "model_download",
            34,
            "正在下載裝置內模型；作品內容不會上傳。 ",
          );
          await this.browser.installModel(inspected.selectedModelId, {
            userInitiated: true,
            signal: input.signal,
            setupOwnership: setupBoundary.setupOwnership,
            ...(diagnostics ? { diagnostics } : {}),
            onProgress: (progress) => {
              const verifying = progress.phase === "verifying";
              this.transitionBrowserAiSetup(
                ownership,
                verifying ? "verifying" : "downloading",
                input,
                verifying ? "integrity_verify" : "model_download",
                34 + Math.round(progress.progress * 34),
                progress.text,
              );
            },
          });
        }
        this.transitionBrowserAiSetup(
          ownership,
          "verifying",
          input,
          "integrity_verify",
          70,
          "模型快取與不可變分片已完成驗證。 ",
        );
        const refreshedCapability = await this.browser.detectCapability();
        if (setupBoundary || refreshedCapability.webLlmInstalled) {
          this.transitionBrowserAiSetup(
            ownership,
            "initializing",
            input,
            "runtime_initialize",
            76,
            "正在初始化 Browser AI Worker。 ",
          );
          this.transitionBrowserAiSetup(
            ownership,
            "warming",
            input,
            "warmup",
            81,
            "正在預熱裝置內模型。 ",
          );
          await this.browser.prewarmModel(input.signal, setupBoundary ?? undefined);
        }
        this.transitionBrowserAiSetup(
          ownership,
          "warming",
          input,
          "health_probe",
          86,
          "正在檢查 Browser AI runtime。 ",
        );
        this.transitionBrowserAiSetup(
          ownership,
          "generation-verifying",
          input,
          "generation_verify",
          91,
          "正在執行最小真實生成實測。 ",
        );
        if (diagnostics) {
          const diagnosticRuntime = await this.browser.runtimeSnapshot();
          const diagnosticOutcome = await diagnostics.checkpoint(
            "before-generation-verification",
            {
              workerGeneration:
                diagnosticRuntime.performance?.workerGeneration ?? null,
              engineGeneration:
                diagnosticRuntime.performance?.engineGeneration ?? null,
            },
          );
          if (diagnosticOutcome.fault === "stale-completion") {
            this.injectAuthorizedStaleCompletion(ownership, diagnostics);
          }
        }
        const proof = await this.browser.verifyGeneration(
          input.signal,
          setupBoundary ?? undefined,
        );
        if (
          proof.inferenceMode !== "generative-model"
          || !isCryptographicClosedAIModelDigest(proof.modelDigest)
        ) {
          throw Object.assign(
            new Error("模型只完成輕量任務，沒有通過生成實測。"),
            { code: "BROWSER_GENERATIVE_VERIFICATION_REQUIRED" },
          );
        }
        if (setupBoundary) {
          await this.browser.finalizeSetup(setupBoundary, {
            signal: input.signal,
            generationModelId: proof.modelId as BrowserWebLLMModelId,
            generationModelDigest: proof.modelDigest,
            onCommitted: () => {
              setupFinalized = true;
              markCompletionCommitted();
            },
          });
          if (!setupFinalized) {
            throw Object.assign(
              new Error("Browser AI metadata finalizer did not acknowledge its commit."),
              { code: "BROWSER_WEBLLM_SETUP_COMMIT_ACK_REQUIRED" },
            );
          }
        }
        emit(input, "router_register", 98, "正在註冊已驗證 Browser AI。 ");
        const ready = await this.inspect({ ...input, signal: undefined });
        if (ready.readiness.generationVerifiedBackends < 1) {
          throw Object.assign(new Error("生成證明未通過 Closed Agent OS 驗證。"), {
            code: "CLOSED_AI_GENERATION_PROOF_REJECTED",
          });
        }
          return ready;
        } catch (error) {
          if (setupFinalized) {
            throw Object.assign(
              error instanceof Error ? error : new Error(String(error)),
              { setupCompletionCommitted: true },
            );
          }
          if (!setupBoundary) {
            if (input.signal?.aborted) throw noResourceSetupCancellation(error);
            throw error;
          }
          if (isAcknowledgedSetupCancellation(error)) throw error;
          if (input.signal?.aborted) {
            const outcome = await this.browser.cancelSetup(setupBoundary);
            throw Object.assign(
              Object.assign(new Error(
                "Browser AI setup cancelled after metadata rollback.",
              ), { name: "AbortError" }),
              outcome,
              { setupCancellationCode: "BROWSER_WEBLLM_SETUP_CANCELLED" },
              { cause: error },
            );
          }
          await this.browser.failSetup(setupBoundary, error);
          throw error;
        }
      });
    })();
    return this.trackOperation("prepare", input, operation);
  }
}
