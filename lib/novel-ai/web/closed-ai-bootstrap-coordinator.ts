import type { PlatformTaskType } from "../router/platform-types";
import { isCryptographicClosedAIModelDigest } from "../closed-agent-os/types";
import {
  detectBrowserAI,
  verifyBrowserAI,
  type BrowserAICapability,
} from "../providers/browser-ai/browser-ai-provider";
import {
  browserWebLLMRuntimeSnapshot,
  installBrowserWebLLMModel,
  prewarmBrowserWebLLMModel,
  repairSelectedBrowserWebLLMCache,
} from "../providers/browser-ai/browser-webllm-runtime";
import {
  BROWSER_WEBLLM_MODELS,
  type BrowserWebLLMModelId,
} from "../providers/browser-ai/webllm-model-registry";
import type {
  ClosedAIRuntimeCoordinator,
  ClosedAIRuntimeSnapshot,
} from "./closed-ai-runtime-coordinator";
import {
  resolveClosedAiConsumerReadiness,
  type ClosedAiConsumerReadiness,
} from "./closed-ai-consumer-readiness";

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
};

function emit(
  input: ClosedAiBootstrapInput,
  step: ClosedAiBootstrapStep,
  percent: number,
  message: string,
) {
  input.onProgress?.({ step, percent, message });
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
  private activeOperation: ActiveBootstrapOperation | null = null;

  constructor(
    runtime: ClosedAIRuntimeCoordinator,
    browser: BrowserBootstrapDependencies = defaultDependencies,
  ) {
    this.runtime = runtime;
    this.browser = browser;
  }

  private reusableOperation(
    kind: ActiveBootstrapOperation["kind"],
    input: ClosedAiBootstrapInput,
  ) {
    const active = this.activeOperation;
    if (!active) return null;
    if (active.signal?.aborted) {
      this.activeOperation = null;
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
    const selectedModel = browserRuntime
      ? lowestProductionModel(
        capability,
        browserRuntime.device.allowedModelIds,
      )
      : null;
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
    const status = readiness.generationVerifiedBackends > 0
      ? "ready" as const
      : browserBackend?.status === "unsupported"
        ? "unsupported" as const
        : "setup_required" as const;
    const safeMessage = status === "ready"
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
      const inspected = await this.inspect(input);
      if (inspected.status === "ready") return inspected;
      if (inspected.status === "unsupported") return inspected;
      if (
        !inspected.browserCapability.generativeModelReady
        && inspected.selectedModelId
      ) {
        emit(input, "model_download", 34, "正在下載裝置內模型；作品內容不會上傳。 ");
        await this.browser.installModel(inspected.selectedModelId, {
          userInitiated: true,
          signal: input.signal,
          onProgress: (progress) => emit(
            input,
            progress.phase === "verifying" ? "integrity_verify" : "model_download",
            34 + Math.round(progress.progress * 34),
            progress.text,
          ),
        });
      }
      emit(input, "integrity_verify", 70, "模型快取與不可變分片已完成驗證。 ");
      const refreshedCapability = await this.browser.detectCapability();
      if (refreshedCapability.webLlmInstalled) {
        emit(input, "runtime_initialize", 76, "正在初始化 Browser AI Worker。 ");
        emit(input, "warmup", 81, "正在預熱裝置內模型。 ");
        await this.browser.prewarmModel(input.signal);
      }
      emit(input, "health_probe", 86, "正在檢查 Browser AI runtime。 ");
      emit(input, "generation_verify", 91, "正在執行最小真實生成實測。 ");
      const proof = await this.browser.verifyGeneration(input.signal);
      if (
        proof.inferenceMode !== "generative-model"
        || !isCryptographicClosedAIModelDigest(proof.modelDigest)
      ) {
        throw Object.assign(
          new Error("模型只完成輕量任務，沒有通過生成實測。"),
          { code: "BROWSER_GENERATIVE_VERIFICATION_REQUIRED" },
        );
      }
      emit(input, "router_register", 98, "正在註冊已驗證 Browser AI。 ");
      const ready = await this.inspect(input);
      if (ready.readiness.generationVerifiedBackends < 1) {
        throw Object.assign(new Error("生成證明未通過 Closed Agent OS 驗證。"), {
          code: "CLOSED_AI_GENERATION_PROOF_REJECTED",
        });
      }
      return ready;
    })();
    return this.trackOperation("prepare", input, operation);
  }
}
