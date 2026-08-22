import type {
  InitProgressReport,
  WebWorkerMLCEngine,
} from "@mlc-ai/web-llm";
import {
  BROWSER_WEBLLM_MODELS,
  browserWebLLMAppConfig,
  browserWebLLMModel,
  chooseBrowserWebLLMCacheBackend,
  detectBrowserWebLLMDevice,
  type BrowserWebLLMCacheBackend,
  type BrowserWebLLMDeviceProfile,
  type BrowserWebLLMModelId,
} from "./webllm-model-registry";
import {
  browserPromptTokenBudgets,
  estimateBrowserTokens,
  fitBrowserPromptToTokenBudget,
  resolveBrowserAIPerformancePolicy,
  type BrowserAIPerformancePolicy,
} from "./browser-performance-policy";
import {
  inspectBrowserModelShardCache,
  verifyBrowserModelShards,
} from "./browser-model-installer";
import type { BrowserAiSetupDiagnosticAttempt } from "./browser-ai-setup-diagnostics";
import { BrowserGPUQueue } from "./browser-gpu-queue";
import { sha256Hex, stableStringify } from "../../closed-ai-cache";
import {
  createBrowserFinalModelContextInvocationProof,
  type BrowserContextAttestationRequirement,
  type BrowserFinalContextExpectation,
  type BrowserFinalModelContextInnerIndex,
  type BrowserFinalModelContextInnerStage,
  type BrowserFinalModelContextInvocationProof,
  type BrowserFinalModelContextPipelineKind,
} from "../../security/browser-final-model-context-proof";

const METADATA_DB = "novel-browser-webllm-v1";
const METADATA_STORE = "runtime-records";
const SELECTED_MODEL_KEY = "selected-model";
const BROWSER_WEBLLM_METADATA_SCHEMA_VERSION =
  "p24b-rc6.4-browser-webllm-model-metadata-v2" as const;
const BROWSER_WEBLLM_WORKER_RUNTIME_VERSION = "@mlc-ai/web-llm@0.2.84" as const;
const BROWSER_WEBLLM_WORKER_RUNTIME_DIGEST =
  "d13fc735398073a0e640047dcdf16c8806e98b24e6fc399725d30fb8012229ab" as const;

export const BROWSER_WEBLLM_BOUNDED_PROSE_RECOVERY_CONSTRAINT =
  "bounded-prose-recovery-v2" as const;
export const BROWSER_WEBLLM_BOUNDED_PROSE_RECOVERY_GRAMMAR =
  String.raw`root ::= [^\x00-\x1f\x7f]{259,319} "。"`;
export const BROWSER_WEBLLM_BOUNDED_PROSE_RECOVERY_SYSTEM_INSTRUCTION =
  "最後補救只輸出單一完整繁體中文正文段落，不得輸出 JSON、Markdown、標題、標籤或分析；全文最多 320 個字元，最後一字必須是句號。";

export type BrowserWebLLMOutputConstraint =
  typeof BROWSER_WEBLLM_BOUNDED_PROSE_RECOVERY_CONSTRAINT;

export type BrowserWebLLMInstallStatus =
  | "not_installed"
  | "installing"
  | "staged"
  | "ready"
  | "error";

export type BrowserWebLLMSetupOwnership = Readonly<{
  attemptId: string;
  epoch: number;
}>;

export type BrowserWebLLMSetupBoundary = Readonly<{
  modelId: BrowserWebLLMModelId;
  setupOwnership: BrowserWebLLMSetupOwnership;
  diagnostics?: BrowserAiSetupDiagnosticAttempt;
}>;

export type BrowserWebLLMSetupCancellationOutcome = Readonly<{
  code: "BROWSER_WEBLLM_SETUP_CANCELLED";
  cancellationAcknowledged: true;
  cacheRetained: true;
  metadataRollback: "restored" | "deleted" | "not_reached";
}>;

export type BrowserWebLLMModelMetadata = {
  schemaVersion?: typeof BROWSER_WEBLLM_METADATA_SCHEMA_VERSION;
  key: string;
  kind: "model";
  modelId: BrowserWebLLMModelId;
  modelDigest: string;
  sourceRevision: string;
  cacheBackend: BrowserWebLLMCacheBackend;
  installStatus: BrowserWebLLMInstallStatus;
  cacheVerified: boolean;
  shardIntegrityVerified: boolean;
  shardManifestDigest: string | null;
  manifestDigest?: string | null;
  shardVerifiedAt: string | null;
  verifiedShardCount: number;
  requiredShardCount?: number;
  installedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  setupAttemptId?: string | null;
  setupEpoch?: number | null;
  generationVerifiedAt?: string | null;
  verifiedAt?: string | null;
  generationVerified?: boolean;
  workerRuntimeVersion?: typeof BROWSER_WEBLLM_WORKER_RUNTIME_VERSION;
  workerRuntimeDigest?: string | null;
  engineGenerationDigest?: string | null;
  setupAttemptIdDigest?: string | null;
  metadataTransactionTokenDigest?: string | null;
  revision?: number;
  generationCount?: number;
  averageFirstTokenMs?: number | null;
  averageTokensPerSecond?: number | null;
};

type SelectedModelRecord = {
  key: typeof SELECTED_MODEL_KEY;
  kind: "setting";
  modelId: BrowserWebLLMModelId;
};

type MetadataRecord = BrowserWebLLMModelMetadata | SelectedModelRecord;

export type BrowserWebLLMProgress = {
  modelId: BrowserWebLLMModelId;
  phase: "checking" | "downloading" | "loading" | "verifying" | "ready" | "error";
  progress: number;
  text: string;
};

export type BrowserWebLLMFinishReason = "stop" | "length" | "tool_calls" | "abort";

const BROWSER_WEBLLM_FINISH_REASONS = new Set<BrowserWebLLMFinishReason>([
  "stop",
  "length",
  "tool_calls",
  "abort",
]);

export function normalizeBrowserWebLLMFinishReason(
  value: unknown,
): BrowserWebLLMFinishReason | null {
  return typeof value === "string"
    && BROWSER_WEBLLM_FINISH_REASONS.has(value as BrowserWebLLMFinishReason)
    ? value as BrowserWebLLMFinishReason
    : null;
}

export type BrowserWebLLMStreamTelemetry = {
  finishReason: BrowserWebLLMFinishReason | null;
  completionTokens: number | null;
};

export function observeBrowserWebLLMStreamTelemetry(
  state: BrowserWebLLMStreamTelemetry,
  input: { finishReason: unknown; completionTokens: unknown },
): BrowserWebLLMStreamTelemetry {
  const completionTokens = typeof input.completionTokens === "number"
    && Number.isFinite(input.completionTokens)
    && input.completionTokens >= 0
    ? Math.round(input.completionTokens)
    : null;
  return {
    finishReason: normalizeBrowserWebLLMFinishReason(input.finishReason)
      ?? state.finishReason,
    completionTokens: completionTokens ?? state.completionTokens,
  };
}

export function browserWebLLMGenerationOptions(input: {
  performancePolicy: BrowserAIPerformancePolicy;
  seed?: number;
}) {
  return {
    stream: true as const,
    stream_options: { include_usage: true },
    temperature: input.performancePolicy.temperature,
    top_p: input.performancePolicy.topP,
    max_tokens: input.performancePolicy.maxOutputTokens,
    repetition_penalty: input.performancePolicy.repetitionPenalty,
    seed: input.seed,
  };
}

export function browserWebLLMResponseFormat(input: {
  jsonMode?: boolean;
  jsonSchema?: Record<string, unknown>;
  outputConstraint?: BrowserWebLLMOutputConstraint;
}) {
  if (input.outputConstraint === BROWSER_WEBLLM_BOUNDED_PROSE_RECOVERY_CONSTRAINT) {
    return {
      type: "grammar" as const,
      grammar: BROWSER_WEBLLM_BOUNDED_PROSE_RECOVERY_GRAMMAR,
    };
  }
  if (input.jsonMode) {
    return {
      type: "json_object" as const,
      schema: JSON.stringify(input.jsonSchema ?? { type: "object" }),
    };
  }
  return { type: "text" as const };
}

/**
 * One canonical digest owner for the exact options sent to WebLLM. Product
 * proof verifiers call this same function, so seed, token cap and response
 * format cannot drift between the runtime proof and its application boundary.
 */
export async function digestBrowserWebLLMCallOptions(input: {
  model: string;
  responseFormat: ReturnType<typeof browserWebLLMResponseFormat>;
  generationOptions: ReturnType<typeof browserWebLLMGenerationOptions>;
}) {
  if (!input.model.trim() || input.model.length > 192) {
    throw runtimeError(
      "BROWSER_WEBLLM_GENERATION_FAILED",
      "The WebLLM call-options model identity is invalid.",
    );
  }
  return sha256Hex(stableStringify({
    domain: "browser-webllm-call-options-v3",
    model: input.model,
    responseFormat: input.responseFormat,
    generationOptions: input.generationOptions,
  }));
}

export function isBrowserWebLLMOutputConstraintBoundaryValid(input: {
  outputConstraint?: unknown;
  jsonMode?: boolean;
  trustedClosedPrompt?: boolean;
  contextAttestation?: BrowserContextAttestationRequirement;
  finalContextPipelineKind?: BrowserFinalModelContextPipelineKind;
  finalContextInnerStage?: BrowserFinalModelContextInnerStage;
  finalContextInnerIndex?: BrowserFinalModelContextInnerIndex;
  invocationRequestId?: string;
}) {
  if (input.outputConstraint === undefined) return true;
  return input.outputConstraint === BROWSER_WEBLLM_BOUNDED_PROSE_RECOVERY_CONSTRAINT
    && input.jsonMode !== true
    && input.trustedClosedPrompt === true
    && input.contextAttestation === "required"
    && (input.finalContextPipelineKind ?? "legacy-bounded-quality-v1")
      === "legacy-bounded-quality-v1"
    && input.finalContextInnerStage === "recovery"
    && input.finalContextInnerIndex === 2
    && Boolean(input.invocationRequestId?.endsWith(":bounded-fresh-recovery"));
}

export type BrowserWebLLMRuntimeSnapshot = {
  runtime: "webllm-worker";
  supported: boolean;
  reason: string;
  device: BrowserWebLLMDeviceProfile;
  cacheBackend: BrowserWebLLMCacheBackend;
  selectedModelId: BrowserWebLLMModelId | null;
  activeModelId: BrowserWebLLMModelId | null;
  lastGeneration: {
    modelId: BrowserWebLLMModelId;
    modelDigest: string;
    completedAt: string;
    elapsedMs: number;
    firstTokenMs: number | null;
    generatedTokenEvents: number;
    tokensPerSecond: number | null;
    gpuVendor: string | null;
    estimatedVramMB: number;
    runtimeStats: string;
    inputCharacters: number;
    outputCharacters: number;
    omittedInputCharacters: number;
    queueWaitMs: number;
    engineReused: boolean;
    finishReason: BrowserWebLLMFinishReason | null;
    completionTokens: number | null;
    performancePolicy: BrowserAIPerformancePolicy;
    externalRequest: false;
    dataLeftDevice: false;
  } | null;
  performance: {
    engineWarm: boolean;
    activeGeneration: boolean;
    queuedGenerations: number;
    engineReuseCount: number;
    warmupCount: number;
    lastWarmupAt: string | null;
    lastWarmupMs: number | null;
    workerExecution: true;
    serialGeneration: true;
    workerRestartCount: number;
    workerGeneration: number;
    engineGeneration: number;
    metadataTransactionStartedCount: number;
    metadataTransactionCommittedCount: number;
    metadataTransactionAbortedCount: number;
    gpuDeviceLostCount: number;
    rejectedForBackpressure: number;
    activeMemoryBudgetMB: number;
  };
  models: Array<{
    modelId: BrowserWebLLMModelId;
    modelDigest: string;
    installStatus: BrowserWebLLMInstallStatus;
    cacheVerified: boolean;
    shardIntegrityVerified: boolean;
    shardManifestDigest: string | null;
    shardVerifiedAt: string | null;
    verifiedShardCount: number;
    cachedShardCount: number;
    expectedShardCount: number;
    cachedBytes: number;
    cachePresent: boolean;
    cacheComplete: boolean;
    selected: boolean;
    allowed: boolean;
    installedAt: string | null;
    generationVerified: boolean;
    metadataRevision: number;
    lastUsedAt: string | null;
    lastError: string | null;
    generationCount: number;
    averageFirstTokenMs: number | null;
    averageTokensPerSecond: number | null;
  }>;
};

export type BrowserWebLLMGenerationInput = {
  systemInstruction: string;
  prompt: string;
  trustedClosedPrompt?: boolean;
  jsonMode?: boolean;
  jsonSchema?: Record<string, unknown>;
  outputConstraint?: BrowserWebLLMOutputConstraint;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  repetitionPenalty?: number;
  seed?: number;
  /** Explicit queue retry budget. Candidate V2 pins zero; legacy callers keep their prior default. */
  retryBudget?: 0 | 1;
  contextAttestation?: BrowserContextAttestationRequirement;
  finalContextExpectations?: BrowserFinalContextExpectation[];
  finalContextOuterRequestId?: string;
  finalContextOuterTaskType?: string;
  finalContextOuterQualityPhase?: "draft" | "critic" | "revision";
  finalContextPipelineKind?: BrowserFinalModelContextPipelineKind;
  finalContextInnerStage?: BrowserFinalModelContextInnerStage;
  finalContextInnerIndex?: BrowserFinalModelContextInnerIndex;
  invocationRequestId?: string;
  setupVerification?: BrowserWebLLMSetupBoundary;
  expectedModelIdentity?: Readonly<{
    modelId: BrowserWebLLMModelId;
    modelDigest: string;
  }>;
  signal?: AbortSignal;
  onToken?: (event: {
    delta: string;
    content: string;
    generatedTokenEvents: number;
    elapsedMs: number;
  }) => void;
};

export type BrowserWebLLMGenerationResult = {
  content: string;
  modelId: BrowserWebLLMModelId;
  modelDigest: string;
  firstTokenMs: number | null;
  elapsedMs: number;
  generatedTokenEvents: number;
  runtimeStats: string;
  tokensPerSecond: number | null;
  gpuVendor: string | null;
  estimatedVramMB: number;
  inputCharacters: number;
  outputCharacters: number;
  omittedInputCharacters: number;
  queueWaitMs: number;
  engineReused: boolean;
  finishReason: BrowserWebLLMFinishReason | null;
  completionTokens: number | null;
  performancePolicy: BrowserAIPerformancePolicy;
  browserModelContextInvocationProof?: BrowserFinalModelContextInvocationProof;
  contextAttestation?: BrowserContextAttestationRequirement;
  externalRequest: false;
  dataLeftDevice: false;
};

let activeEngine: WebWorkerMLCEngine | null = null;
let activeWorker: Worker | null = null;
let activeModelId: BrowserWebLLMModelId | null = null;
let activeCacheBackend: BrowserWebLLMCacheBackend | null = null;
let activeSetupOwnership: BrowserWebLLMSetupOwnership | null = null;
let workerGeneration = 0;
let engineGeneration = 0;
let activeWorkerGeneration = 0;
let activeEngineGeneration = 0;
let metadataTransactionStartedCount = 0;
let metadataTransactionCommittedCount = 0;
let metadataTransactionAbortedCount = 0;
let currentProgress: BrowserWebLLMProgress | null = null;
let lastGeneration: BrowserWebLLMRuntimeSnapshot["lastGeneration"] = null;
let activeGeneration = false;
let engineReuseCount = 0;
let warmupCount = 0;
let lastWarmupAt: string | null = null;
let lastWarmupMs: number | null = null;
const progressListeners = new Set<(progress: BrowserWebLLMProgress) => void>();
const ENGINE_UNLOAD_TIMEOUT_MS = 2_000;
const METADATA_DB_OPEN_TIMEOUT_MS = 5_000;

function runtimeError(code: string, message: string, cause?: unknown) {
  return Object.assign(new Error(message), { code, retryable: true, cause });
}

export function browserWebLLMMaxAttempts(input: Pick<
  BrowserWebLLMGenerationInput,
  "contextAttestation" | "retryBudget"
>): 1 | 2 {
  if (input.retryBudget !== undefined && input.retryBudget !== 0 && input.retryBudget !== 1) {
    throw runtimeError(
      "BROWSER_WEBLLM_RETRY_BUDGET_INVALID",
      "Browser WebLLM retry budget must be zero or one.",
    );
  }
  if (input.contextAttestation === "required" && input.retryBudget === 1) {
    throw runtimeError(
      "BROWSER_WEBLLM_ATTESTED_RETRY_FORBIDDEN",
      "Attested Browser WebLLM generation cannot enable a queue retry.",
    );
  }
  return input.retryBudget === undefined
    ? input.contextAttestation === "required" ? 1 : 2
    : input.retryBudget === 0 ? 1 : 2;
}

function setupCancellationError(
  outcome: BrowserWebLLMSetupCancellationOutcome,
  cause: unknown,
) {
  return Object.assign(
    Object.assign(new Error("Browser AI setup cancelled after metadata rollback."), {
      name: "AbortError",
    }),
    outcome,
    { cause },
  );
}

function openMetadataDatabase(signal?: AbortSignal): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(runtimeError(
      "BROWSER_WEBLLM_INDEXEDDB_UNAVAILABLE",
      "IndexedDB 不可用，無法建立 Browser AI 模型索引。",
    ));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(METADATA_DB, 1);
    let settled = false;
    const finish = (
      callback: () => void,
      database?: IDBDatabase,
    ) => {
      if (settled) {
        database?.close();
        return;
      }
      settled = true;
      globalThis.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => reject(
      new DOMException("已取消開啟 Browser AI 模型索引。", "AbortError"),
    ));
    const timeoutId = globalThis.setTimeout(() => finish(() => reject(runtimeError(
      "BROWSER_WEBLLM_INDEXEDDB_OPEN_TIMEOUT",
      "開啟 Browser AI 模型索引逾時。",
    ))), METADATA_DB_OPEN_TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        database.createObjectStore(METADATA_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => finish(() => resolve(request.result), request.result);
    request.onerror = () => finish(() => reject(request.error ?? runtimeError(
      "BROWSER_WEBLLM_INDEXEDDB_OPEN_FAILED",
      "無法開啟 Browser AI 模型索引。",
    )));
    request.onblocked = () => finish(() => reject(runtimeError(
      "BROWSER_WEBLLM_INDEXEDDB_BLOCKED",
      "Browser AI 模型索引被另一個分頁的舊連線阻擋。",
    )));
  });
}

async function readMetadataRecords(): Promise<MetadataRecord[]> {
  const database = await openMetadataDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(METADATA_STORE, "readonly");
      const request = transaction.objectStore(METADATA_STORE).getAll();
      request.onsuccess = () => resolve(request.result as MetadataRecord[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function putMetadataRecord(record: MetadataRecord) {
  return putMetadataRecordsAtomically([record]);
}

async function putMetadataRecordsAtomically(
  records: readonly MetadataRecord[],
  deleteKeys: readonly string[] = [],
  signal?: AbortSignal,
) {
  if (signal?.aborted) {
    throw new DOMException("已取消模型 metadata transaction。", "AbortError");
  }
  const database = await openMetadataDatabase(signal);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(METADATA_STORE, "readwrite");
      metadataTransactionStartedCount += 1;
      let transactionOutcomeRecorded = false;
      const recordTransactionOutcome = (committed: boolean) => {
        if (transactionOutcomeRecorded) return;
        transactionOutcomeRecorded = true;
        if (committed) metadataTransactionCommittedCount += 1;
        else metadataTransactionAbortedCount += 1;
      };
      const store = transaction.objectStore(METADATA_STORE);
      const abort = () => {
        try {
          transaction.abort();
        } catch {
          // Completion won the race; the completion handler owns settlement.
        }
      };
      const finish = (callback: () => void) => {
        signal?.removeEventListener("abort", abort);
        callback();
      };
      signal?.addEventListener("abort", abort, { once: true });
      for (const key of deleteKeys) store.delete(key);
      for (const record of records) store.put(record);
      transaction.oncomplete = () => finish(() => {
        recordTransactionOutcome(true);
        resolve();
      });
      transaction.onerror = () => finish(() => {
        recordTransactionOutcome(false);
        reject(transaction.error);
      });
      transaction.onabort = () => finish(() => {
        recordTransactionOutcome(false);
        reject(
          signal?.aborted
            ? new DOMException("已取消模型 metadata transaction。", "AbortError")
            : transaction.error,
        );
      });
    });
  } finally {
    database.close();
  }
}

async function deleteMetadataRecord(key: string) {
  const database = await openMetadataDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(METADATA_STORE, "readwrite");
      transaction.objectStore(METADATA_STORE).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function modelMetadataKey(modelId: BrowserWebLLMModelId) {
  return `model:${modelId}`;
}

function metadataOwnedBySetup(
  record: MetadataRecord | undefined,
  ownership: BrowserWebLLMSetupOwnership,
): record is BrowserWebLLMModelMetadata {
  return record?.kind === "model"
    && record.setupAttemptId === ownership.attemptId
    && record.setupEpoch === ownership.epoch;
}

function sameSetupOwnership(
  left: BrowserWebLLMSetupOwnership | null,
  right: BrowserWebLLMSetupOwnership | null,
) {
  return left?.attemptId === right?.attemptId && left?.epoch === right?.epoch;
}

async function mutateSetupMetadataAtomically(
  modelId: BrowserWebLLMModelId,
  ownership: BrowserWebLLMSetupOwnership,
  mutation: (
    store: IDBObjectStore,
    current: BrowserWebLLMModelMetadata,
  ) => void,
  signal?: AbortSignal,
  diagnostics?: BrowserAiSetupDiagnosticAttempt,
) {
  if (signal?.aborted) {
    throw new DOMException("已取消模型 metadata transaction。", "AbortError");
  }
  const database = await openMetadataDatabase(signal);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(METADATA_STORE, "readwrite");
      metadataTransactionStartedCount += 1;
      let transactionOutcomeRecorded = false;
      const recordTransactionOutcome = (committed: boolean) => {
        if (transactionOutcomeRecorded) return;
        transactionOutcomeRecorded = true;
        if (committed) metadataTransactionCommittedCount += 1;
        else metadataTransactionAbortedCount += 1;
      };
      const store = transaction.objectStore(METADATA_STORE);
      let explicitError: unknown = null;
      const abort = () => {
        if (!explicitError && signal?.aborted) {
          explicitError = new DOMException(
            "已取消模型 metadata transaction。",
            "AbortError",
          );
        }
        try {
          transaction.abort();
        } catch {
          // Completion won the race; the transaction handlers own settlement.
        }
      };
      const finish = (callback: () => void) => {
        signal?.removeEventListener("abort", abort);
        callback();
      };
      signal?.addEventListener("abort", abort, { once: true });
      const request = store.get(modelMetadataKey(modelId));
      request.onerror = () => {
        explicitError = request.error;
        abort();
      };
      request.onsuccess = () => {
        const current = request.result as MetadataRecord | undefined;
        if (!metadataOwnedBySetup(current, ownership)) {
          explicitError = runtimeError(
            "BROWSER_WEBLLM_SETUP_STALE_ATTEMPT",
            "舊的 Browser AI 準備程序不可改寫目前模型狀態。",
          );
          abort();
          return;
        }
        const applyMutation = () => {
          try {
            mutation(store, current);
          } catch (error) {
            explicitError = error;
            abort();
          }
        };
        if (!diagnostics) {
          applyMutation();
          return;
        }
        let checkpointSettled = false;
        let checkpointError: unknown = null;
        let checkpointFault: "metadata-transaction-abort" | null = null;
        void diagnostics.checkpoint("metadata-transaction", {
          workerGeneration: activeWorkerGeneration,
          engineGeneration: activeEngineGeneration,
          ordering: "inside-open-readwrite-transaction-before-writes",
        }).then((outcome) => {
          checkpointFault = outcome.fault === "metadata-transaction-abort"
            ? outcome.fault
            : null;
          checkpointSettled = true;
        }, (error) => {
          checkpointError = error;
          checkpointSettled = true;
        });
        const keepTransactionAlive = () => {
          let keepAliveRequest: IDBRequest;
          try {
            keepAliveRequest = store.get(modelMetadataKey(modelId));
          } catch (error) {
            explicitError = error;
            abort();
            return;
          }
          keepAliveRequest.onerror = () => {
            explicitError = keepAliveRequest.error;
            abort();
          };
          keepAliveRequest.onsuccess = () => {
            if (!checkpointSettled) {
              keepTransactionAlive();
              return;
            }
            if (checkpointError) {
              explicitError = checkpointError;
              abort();
              return;
            }
            if (checkpointFault === "metadata-transaction-abort") {
              explicitError = runtimeError(
                "BROWSER_AI_SETUP_DIAGNOSTIC_METADATA_TRANSACTION_ABORT",
                "The authorized Browser AI setup diagnostic aborted its metadata transaction.",
              );
              abort();
              return;
            }
            applyMutation();
          };
        };
        keepTransactionAlive();
      };
      transaction.oncomplete = () => finish(() => {
        recordTransactionOutcome(true);
        resolve();
      });
      transaction.onerror = () => finish(() => {
        recordTransactionOutcome(false);
        reject(
        explicitError ?? transaction.error,
        );
      });
      transaction.onabort = () => finish(() => {
        recordTransactionOutcome(false);
        reject(
        explicitError ?? transaction.error,
        );
      });
    });
  } finally {
    database.close();
  }
}

async function claimSetupMetadataAtomically(
  installing: BrowserWebLLMModelMetadata,
  ownership: BrowserWebLLMSetupOwnership,
  signal?: AbortSignal,
) {
  if (signal?.aborted) {
    throw new DOMException("已取消模型 metadata transaction。", "AbortError");
  }
  const database = await openMetadataDatabase(signal);
  let previous: BrowserWebLLMModelMetadata | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(METADATA_STORE, "readwrite");
      metadataTransactionStartedCount += 1;
      let transactionOutcomeRecorded = false;
      const recordTransactionOutcome = (committed: boolean) => {
        if (transactionOutcomeRecorded) return;
        transactionOutcomeRecorded = true;
        if (committed) metadataTransactionCommittedCount += 1;
        else metadataTransactionAbortedCount += 1;
      };
      const store = transaction.objectStore(METADATA_STORE);
      let explicitError: unknown = null;
      const abort = () => {
        if (!explicitError && signal?.aborted) {
          explicitError = new DOMException(
            "已取消模型 metadata transaction。",
            "AbortError",
          );
        }
        try {
          transaction.abort();
        } catch {
          // Completion won the race; the transaction handlers own settlement.
        }
      };
      const finish = (callback: () => void) => {
        signal?.removeEventListener("abort", abort);
        callback();
      };
      signal?.addEventListener("abort", abort, { once: true });
      const request = store.get(installing.key);
      request.onerror = () => {
        explicitError = request.error;
        abort();
      };
      request.onsuccess = () => {
        const current = request.result as MetadataRecord | undefined;
        if (
          current?.kind === "model"
          && current.installStatus === "ready"
          && typeof current.generationVerifiedAt === "string"
          && current.generationVerified === true
          && current.schemaVersion === BROWSER_WEBLLM_METADATA_SCHEMA_VERSION
        ) {
          explicitError = runtimeError(
            "BROWSER_WEBLLM_SETUP_ALREADY_READY",
            "模型已由另一個 Browser AI 準備程序完成。",
          );
          abort();
          return;
        }
        if (
          current?.kind === "model"
          && (current.installStatus === "installing" || current.installStatus === "staged")
          && !metadataOwnedBySetup(current, ownership)
        ) {
          explicitError = runtimeError(
            "BROWSER_WEBLLM_SETUP_OPERATION_IN_PROGRESS",
            "另一個分頁正在準備相同的 Browser AI 模型。",
          );
          abort();
          return;
        }
        previous = current?.kind === "model" ? { ...current } : undefined;
        store.put({
          ...installing,
          installedAt: previous?.installedAt ?? installing.installedAt,
          lastUsedAt: previous?.lastUsedAt ?? installing.lastUsedAt,
          generationCount: previous?.generationCount ?? installing.generationCount,
          averageFirstTokenMs: previous?.averageFirstTokenMs ?? installing.averageFirstTokenMs,
          averageTokensPerSecond: previous?.averageTokensPerSecond
            ?? installing.averageTokensPerSecond,
          revision: (previous?.revision ?? 0) + 1,
        } satisfies BrowserWebLLMModelMetadata);
      };
      transaction.oncomplete = () => finish(() => {
        recordTransactionOutcome(true);
        resolve();
      });
      transaction.onerror = () => finish(() => {
        recordTransactionOutcome(false);
        reject(
        explicitError ?? transaction.error,
        );
      });
      transaction.onabort = () => finish(() => {
        recordTransactionOutcome(false);
        reject(
        explicitError ?? transaction.error,
        );
      });
    });
  } finally {
    database.close();
  }
  return previous;
}

async function updateGenerationMetadataAtomically(
  modelId: BrowserWebLLMModelId,
  modelDigest: string,
  setupVerification: BrowserWebLLMSetupBoundary | undefined,
  metrics: { firstTokenMs: number | null; tokensPerSecond: number | null },
) {
  const database = await openMetadataDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(METADATA_STORE, "readwrite");
      metadataTransactionStartedCount += 1;
      let transactionOutcomeRecorded = false;
      const recordTransactionOutcome = (committed: boolean) => {
        if (transactionOutcomeRecorded) return;
        transactionOutcomeRecorded = true;
        if (committed) metadataTransactionCommittedCount += 1;
        else metadataTransactionAbortedCount += 1;
      };
      const store = transaction.objectStore(METADATA_STORE);
      let explicitError: unknown = null;
      const abort = (error: unknown) => {
        explicitError = error;
        try {
          transaction.abort();
        } catch {
          // Completion owns settlement if it already won the race.
        }
      };
      const update = (current: BrowserWebLLMModelMetadata) => {
        const generationCount = (current.generationCount ?? 0) + 1;
        const rolling = (previous: number | null | undefined, next: number | null) => {
          if (next === null) return previous ?? null;
          if (previous === null || previous === undefined) return next;
          return Math.round(
            ((previous * (generationCount - 1)) + next) / generationCount * 100,
          ) / 100;
        };
        store.put({
          ...current,
          lastUsedAt: new Date().toISOString(),
          generationCount,
          averageFirstTokenMs: rolling(current.averageFirstTokenMs, metrics.firstTokenMs),
          averageTokensPerSecond: rolling(
            current.averageTokensPerSecond,
            metrics.tokensPerSecond,
          ),
          revision: (current.revision ?? 0) + 1,
        } satisfies BrowserWebLLMModelMetadata);
      };
      const modelRequest = store.get(modelMetadataKey(modelId));
      modelRequest.onerror = () => abort(modelRequest.error);
      modelRequest.onsuccess = () => {
        const current = modelRequest.result as MetadataRecord | undefined;
        if (
          current?.kind !== "model"
          || current.modelId !== modelId
          || current.modelDigest !== modelDigest
        ) {
          abort(runtimeError(
            "BROWSER_WEBLLM_GENERATION_METADATA_STALE",
            "Browser AI generation metadata no longer matches the executing model.",
          ));
          return;
        }
        if (setupVerification) {
          if (
            current.installStatus !== "staged"
            || !metadataOwnedBySetup(current, setupVerification.setupOwnership)
          ) {
            abort(runtimeError(
              "BROWSER_WEBLLM_SETUP_STALE_ATTEMPT",
              "A stale Browser AI setup cannot publish generation telemetry.",
            ));
            return;
          }
          update(current);
          return;
        }
        if (
          current.installStatus !== "ready"
          || typeof current.generationVerifiedAt !== "string"
          || current.generationVerified !== true
          || typeof current.engineGenerationDigest !== "string"
          || typeof current.metadataTransactionTokenDigest !== "string"
        ) {
          abort(runtimeError(
            "BROWSER_WEBLLM_GENERATION_METADATA_STALE",
            "Browser AI generation requires verified ready metadata.",
          ));
          return;
        }
        const selectedRequest = store.get(SELECTED_MODEL_KEY);
        selectedRequest.onerror = () => abort(selectedRequest.error);
        selectedRequest.onsuccess = () => {
          const selected = selectedRequest.result as MetadataRecord | undefined;
          if (selected?.kind !== "setting" || selected.modelId !== modelId) {
            abort(runtimeError(
              "BROWSER_WEBLLM_GENERATION_SELECTION_STALE",
              "Browser AI model selection changed before telemetry commit.",
            ));
            return;
          }
          update(current);
        };
      };
      transaction.oncomplete = () => {
        recordTransactionOutcome(true);
        resolve();
      };
      transaction.onerror = () => {
        recordTransactionOutcome(false);
        reject(explicitError ?? transaction.error);
      };
      transaction.onabort = () => {
        recordTransactionOutcome(false);
        reject(explicitError ?? transaction.error);
      };
    });
  } finally {
    database.close();
  }
}

function reportProgress(progress: BrowserWebLLMProgress) {
  currentProgress = progress;
  for (const listener of progressListeners) {
    try {
      listener(progress);
    } catch {
      // Progress observers never participate in the model transaction.
    }
  }
}

function installProgressPhase(report: InitProgressReport): BrowserWebLLMProgress["phase"] {
  const text = report.text.toLowerCase();
  if (report.progress >= 1) return "ready";
  if (/from cache|cache\[/u.test(text)) return "loading";
  if (/fetch|download/u.test(text)) return "downloading";
  return "loading";
}

export function browserWebLLMProgressText(report: Pick<InitProgressReport, "text">) {
  if (/from cache|cache\[/iu.test(report.text)) {
    return `正在從此裝置快取載入顯存（不重新下載）· ${report.text}`;
  }
  if (/fetch|download/iu.test(report.text)) {
    return `正在下載缺少的模型檔案 · ${report.text}`;
  }
  return report.text;
}

function parseTokensPerSecond(runtimeStats: string) {
  const matches = [...runtimeStats.matchAll(/(\d+(?:\.\d+)?)\s*(?:tokens?\s*\/\s*s|tokens?\s*per\s*second)/giu)];
  if (!matches.length) return null;
  return Number(matches.at(-1)?.[1] ?? 0) || null;
}

function terminateWorker(worker: Worker | null) {
  try {
    worker?.terminate();
    return true;
  } catch {
    return false;
  }
}

async function unloadEngineWithinDeadline(engine: WebWorkerMLCEngine | null) {
  if (!engine) return;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const unloadOperation = Promise.resolve().then(() => engine.unload());
  try {
    await Promise.race([
      unloadOperation,
      new Promise<void>((resolve) => {
        timeoutId = globalThis.setTimeout(resolve, ENGINE_UNLOAD_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
  }
}

async function releaseActiveEngine(options: { force?: boolean } = {}) {
  const engine = activeEngine;
  const worker = activeWorker;
  activeEngine = null;
  activeWorker = null;
  activeModelId = null;
  activeCacheBackend = null;
  activeSetupOwnership = null;
  activeWorkerGeneration = 0;
  activeEngineGeneration = 0;
  let workerDisposeAcknowledged = options.force ? terminateWorker(worker) : true;
  try {
    await unloadEngineWithinDeadline(engine);
  } finally {
    workerDisposeAcknowledged = terminateWorker(worker) && workerDisposeAcknowledged;
  }
  return Object.freeze({
    engineDetached: activeEngine === null && activeWorker === null,
    workerDisposeAcknowledged,
  });
}

async function releaseSetupEngine(
  ownership: BrowserWebLLMSetupOwnership,
  options: { force?: boolean } = {},
) {
  if (!sameSetupOwnership(activeSetupOwnership, ownership)) {
    const noEngineResources = activeSetupOwnership === null
      && activeEngine === null
      && activeWorker === null;
    return Object.freeze({
      // Absence is a successful ownership check: no foreign engine exists and
      // this attempt has no remaining worker dispose operation to acknowledge.
      engineOwnershipMatched: noEngineResources,
      engineDetached: noEngineResources,
      workerDisposeAcknowledged: true,
    });
  }
  const release = await releaseActiveEngine(options);
  return Object.freeze({
    engineOwnershipMatched: true,
    ...release,
  });
}

function forceReleaseActiveEngine() {
  // releaseActiveEngine detaches all shared references and terminates the
  // worker synchronously before its bounded cleanup promise is returned.
  return releaseActiveEngine({ force: true }).then(() => undefined);
}

function createGPUQueue() {
  return new BrowserGPUQueue({
    maxQueuedJobs: 8,
    maxMemoryMB: 4_096,
    // Keep the selected 0.5B/1.5B engine warm long enough for a writing
    // session. Switching models still unloads GPU memory immediately, while
    // CacheStorage remains untouched.
    idleReleaseMs: 600_000,
    onRecover: forceReleaseActiveEngine,
    onIdleRelease: () => releaseActiveEngine().then(() => undefined),
  });
}

let gpuQueue = createGPUQueue();

async function createEngine(
  modelId: BrowserWebLLMModelId,
  cacheBackend: BrowserWebLLMCacheBackend,
  onProgress?: (progress: BrowserWebLLMProgress) => void,
  signal?: AbortSignal,
  setupOwnership?: BrowserWebLLMSetupOwnership,
  diagnostics?: BrowserAiSetupDiagnosticAttempt,
) {
  if (
    activeEngine
    && activeModelId === modelId
    && activeCacheBackend === cacheBackend
    && (
      !setupOwnership
      || sameSetupOwnership(activeSetupOwnership, setupOwnership)
    )
  ) {
    return activeEngine;
  }
  await releaseActiveEngine();
  if (diagnostics) {
    await diagnostics.checkpoint("before-first-immutable-request", {
      ordering: "before-worker-construction",
    });
  }
  const webllm = await import("@mlc-ai/web-llm");
  const worker = new Worker(
    new URL("./browser-webllm-worker.ts", import.meta.url),
    { type: "module", name: "novel-browser-webllm" },
  );
  const nextWorkerGeneration = ++workerGeneration;
  if (diagnostics) {
    const diagnosticOutcome = await diagnostics.checkpoint(
      "worker-engine-initialize",
      {
        workerGeneration: nextWorkerGeneration,
        ordering: "worker-created-before-engine-created",
      },
    );
    if (diagnosticOutcome.fault === "worker-crash") {
      worker.terminate();
      throw runtimeError(
        "BROWSER_AI_SETUP_DIAGNOSTIC_WORKER_CRASH",
        "The authorized Browser AI setup diagnostic terminated its worker.",
      );
    }
  }
  if (signal?.aborted) {
    worker.terminate();
    throw new DOMException("已取消模型載入。", "AbortError");
  }
  const publish = (report: InitProgressReport) => {
    const progress: BrowserWebLLMProgress = {
      modelId,
      phase: installProgressPhase(report),
      progress: Math.max(0, Math.min(1, report.progress)),
      text: browserWebLLMProgressText(report),
    };
    reportProgress(progress);
    onProgress?.(progress);
  };
  let rejectAbort: ((reason: DOMException) => void) | null = null;
  const abort = () => {
    worker.terminate();
    rejectAbort?.(new DOMException("已取消模型載入。", "AbortError"));
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const createOperation = webllm.CreateWebWorkerMLCEngine(
      worker,
      modelId,
      {
        appConfig: browserWebLLMAppConfig(cacheBackend),
        initProgressCallback: publish,
        logLevel: "WARN",
      },
    );
    const abortOperation = signal
      ? new Promise<never>((_, reject) => {
        rejectAbort = reject;
      })
      : null;
    const engine = await (abortOperation
      ? Promise.race([createOperation, abortOperation])
      : createOperation);
    if (signal?.aborted) {
      worker.terminate();
      throw new DOMException("已取消模型載入。", "AbortError");
    }
    activeEngine = engine;
    activeWorker = worker;
    activeModelId = modelId;
    activeCacheBackend = cacheBackend;
    activeSetupOwnership = setupOwnership ?? null;
    activeWorkerGeneration = nextWorkerGeneration;
    activeEngineGeneration = ++engineGeneration;
    return engine;
  } catch (error) {
    worker.terminate();
    throw error;
  } finally {
    rejectAbort = null;
    signal?.removeEventListener("abort", abort);
  }
}

export function subscribeBrowserWebLLMProgress(
  listener: (progress: BrowserWebLLMProgress) => void,
) {
  progressListeners.add(listener);
  if (currentProgress) listener(currentProgress);
  return () => progressListeners.delete(listener);
}

export function getBrowserWebLLMProgress() {
  return currentProgress ? { ...currentProgress } : null;
}

export async function browserWebLLMRuntimeSnapshot(): Promise<BrowserWebLLMRuntimeSnapshot> {
  const device = await detectBrowserWebLLMDevice();
  const cacheBackend = chooseBrowserWebLLMCacheBackend(device);
  let records: MetadataRecord[] = [];
  if (device.indexedDb) {
    records = await readMetadataRecords().catch(() => []);
  }
  const selected = records.find((record): record is SelectedModelRecord => (
    record.kind === "setting" && record.key === SELECTED_MODEL_KEY
  ));
  const persistedModel = browserWebLLMModel(selected?.modelId);
  const selectedModelId = persistedModel?.productionQualified
    && device.allowedModelIds.includes(persistedModel.modelId)
    ? persistedModel.modelId
    : device.recommendedModelId;
  const modelRecords = new Map(
    records
      .filter((record): record is BrowserWebLLMModelMetadata => record.kind === "model")
      .map((record) => [record.modelId, record]),
  );
  const cacheInspections = new Map(
    await Promise.all(
      BROWSER_WEBLLM_MODELS.map(async (model) => [
        model.modelId,
        await inspectBrowserModelShardCache(model.modelId).catch(() => ({
          modelId: model.modelId,
          shardCount: 0,
          cachedShardCount: 0,
          totalBytes: 0,
          cachedBytes: 0,
          complete: false,
        })),
      ] as const),
    ),
  );
  const queue = gpuQueue.snapshot();
  return {
    runtime: "webllm-worker",
    supported: device.supported,
    reason: device.reason,
    device,
    cacheBackend,
    selectedModelId,
    activeModelId,
    lastGeneration: lastGeneration ? { ...lastGeneration } : null,
    performance: {
      engineWarm: Boolean(activeEngine && activeModelId),
      activeGeneration: Boolean(queue.activeJobId) || activeGeneration,
      queuedGenerations: queue.queuedJobs,
      engineReuseCount,
      warmupCount,
      lastWarmupAt,
      lastWarmupMs,
      workerExecution: true,
      serialGeneration: true,
      workerRestartCount: queue.workerRestartCount,
      workerGeneration,
      engineGeneration,
      metadataTransactionStartedCount,
      metadataTransactionCommittedCount,
      metadataTransactionAbortedCount,
      gpuDeviceLostCount: queue.gpuDeviceLostCount,
      rejectedForBackpressure: queue.rejectedForBackpressure,
      activeMemoryBudgetMB: queue.activeMemoryBudgetMB,
    },
    models: BROWSER_WEBLLM_MODELS.map((model) => {
      const record = modelRecords.get(model.modelId);
      const cache = cacheInspections.get(model.modelId)!;
      const verifiedForCurrentCache = Boolean(
        record?.cacheVerified
        && record.cacheBackend === cacheBackend
        && record.shardIntegrityVerified
        && cache.complete,
      );
      return {
        modelId: model.modelId,
        modelDigest: model.modelDigest,
        installStatus: record?.installStatus === "ready"
          && verifiedForCurrentCache
          && typeof record.generationVerifiedAt === "string"
          && record.generationVerified === true
          && record.schemaVersion === BROWSER_WEBLLM_METADATA_SCHEMA_VERSION
          && record.requiredShardCount === record.verifiedShardCount
          && record.manifestDigest === record.shardManifestDigest
          && typeof record.workerRuntimeDigest === "string"
          && typeof record.engineGenerationDigest === "string"
          && typeof record.setupAttemptIdDigest === "string"
          && typeof record.metadataTransactionTokenDigest === "string"
          ? "ready"
          : record?.installStatus === "staged"
            && verifiedForCurrentCache
            ? "staged"
          : record?.installStatus === "installing"
            ? "installing"
            : record?.installStatus === "error"
              ? "error"
              : "not_installed",
        cacheVerified: verifiedForCurrentCache,
        shardIntegrityVerified: Boolean(record?.shardIntegrityVerified),
        shardManifestDigest: record?.shardManifestDigest ?? null,
        shardVerifiedAt: record?.shardVerifiedAt ?? null,
        verifiedShardCount: record?.verifiedShardCount ?? 0,
        cachedShardCount: cache.cachedShardCount,
        expectedShardCount: cache.shardCount,
        cachedBytes: cache.cachedBytes,
        cachePresent: cache.cachedShardCount > 0,
        cacheComplete: cache.complete,
        selected: selectedModelId === model.modelId,
        allowed: device.allowedModelIds.includes(model.modelId),
        installedAt: record?.installedAt ?? null,
        generationVerified: Boolean(
          record?.generationVerified === true
          && typeof record.generationVerifiedAt === "string"
          && typeof record.engineGenerationDigest === "string"
        ),
        metadataRevision: record?.revision ?? 0,
        lastUsedAt: record?.lastUsedAt ?? null,
        lastError: record?.lastError ?? null,
        generationCount: record?.generationCount ?? 0,
        averageFirstTokenMs: record?.averageFirstTokenMs ?? null,
        averageTokensPerSecond: record?.averageTokensPerSecond ?? null,
      };
    }),
  };
}

export async function selectBrowserWebLLMModel(modelId: BrowserWebLLMModelId) {
  const model = browserWebLLMModel(modelId);
  if (!model) throw runtimeError("BROWSER_WEBLLM_MODEL_UNKNOWN", "未知的 Browser AI 模型。");
  const device = await detectBrowserWebLLMDevice();
  if (!model.productionQualified || !device.allowedModelIds.includes(modelId)) {
    throw runtimeError(
      "BROWSER_WEBLLM_DEVICE_GATE_FAILED",
      model.usePolicy === "research-only"
        ? "此模型授權僅限研究，正式版不會啟用。"
        : "此模型未通過目前裝置 Gate。",
    );
  }
  const record = (await readMetadataRecords()).find(
    (candidate): candidate is BrowserWebLLMModelMetadata => (
      candidate.kind === "model" && candidate.modelId === modelId
    ),
  );
  if (
    record?.installStatus !== "ready"
    || !record.cacheVerified
    || !record.shardIntegrityVerified
    || typeof record.generationVerifiedAt !== "string"
    || record.generationVerified !== true
    || record.schemaVersion !== BROWSER_WEBLLM_METADATA_SCHEMA_VERSION
    || record.requiredShardCount !== record.verifiedShardCount
    || record.manifestDigest !== record.shardManifestDigest
  ) {
    throw runtimeError(
      "BROWSER_WEBLLM_MODEL_NOT_VERIFIED",
      "Browser AI model selection requires a verified generation-ready model.",
    );
  }
  await putMetadataRecord({ key: SELECTED_MODEL_KEY, kind: "setting", modelId });
  return browserWebLLMRuntimeSnapshot();
}

/**
 * Repairs legacy metadata from a complete local cache. This path performs no
 * download and is therefore safe to run automatically on page startup.
 */
export async function repairSelectedBrowserWebLLMCache(options: {
  onProgress?: (progress: BrowserWebLLMProgress) => void;
} = {}) {
  const snapshot = await browserWebLLMRuntimeSnapshot();
  const modelId = snapshot.selectedModelId;
  const state = snapshot.models.find((item) => item.modelId === modelId);
  const model = browserWebLLMModel(modelId);
  if (
    !modelId
    || !model
    || !model.productionQualified
    || !state?.allowed
    || state.installStatus === "ready"
    || !state.cacheComplete
  ) {
    return snapshot;
  }
  const cacheBackend = snapshot.cacheBackend;
  const webllm = await import("@mlc-ai/web-llm");
  if (!await webllm.hasModelInCache(
    modelId,
    browserWebLLMAppConfig(cacheBackend),
  )) {
    return snapshot;
  }
  const checking: BrowserWebLLMProgress = {
    modelId,
    phase: "verifying",
    progress: 0,
    text: "偵測到完整本機快取，正在一次性恢復驗證（不重新下載）。",
  };
  reportProgress(checking);
  options.onProgress?.(checking);
  const verification = await verifyBrowserModelShards({
    modelId,
    onProgress: (progress) => {
      const update: BrowserWebLLMProgress = {
        modelId,
        phase: "verifying",
        progress: progress.verifiedShardCount / progress.shardCount,
        text: `從本機快取驗證 ${progress.verifiedShardCount}/${progress.shardCount}（0 網路下載）`,
      };
      reportProgress(update);
      options.onProgress?.(update);
    },
  });
  if (!verification.verified) return browserWebLLMRuntimeSnapshot();
  // This verifies reusable bytes only. It deliberately does not publish a
  // ready record: readiness belongs to the attempt-owned transaction after a
  // true generation proof.
  const verified: BrowserWebLLMProgress = {
    modelId,
    phase: "verifying",
    progress: 1,
    text: "本機模型快取已恢復並通過完整性驗證；不需重新下載。",
  };
  reportProgress(verified);
  options.onProgress?.(verified);
  return browserWebLLMRuntimeSnapshot();
}

export async function installBrowserWebLLMModel(
  modelId: BrowserWebLLMModelId,
  options: {
    userInitiated: true;
    signal?: AbortSignal;
    onProgress?: (progress: BrowserWebLLMProgress) => void;
    setupOwnership: BrowserWebLLMSetupOwnership;
    diagnostics?: BrowserAiSetupDiagnosticAttempt;
  },
) {
  if (options.userInitiated !== true) {
    throw Object.assign(new Error("Browser model installation requires an explicit user action."), {
      code: "BROWSER_MODEL_EXPLICIT_INSTALL_REQUIRED",
      automaticDownloadAllowed: false,
    });
  }
  const model = browserWebLLMModel(modelId);
  if (!model) throw runtimeError("BROWSER_WEBLLM_MODEL_UNKNOWN", "未知的 Browser AI 模型。");
  const device = await detectBrowserWebLLMDevice();
  if (!device.supported || !device.allowedModelIds.includes(modelId)) {
    throw runtimeError(
      "BROWSER_WEBLLM_DEVICE_GATE_FAILED",
      "此模型未通過目前裝置的 WebGPU、記憶體與儲存空間 Gate。",
    );
  }
  if (options.signal?.aborted) {
    throw setupCancellationError({
      code: "BROWSER_WEBLLM_SETUP_CANCELLED",
      cancellationAcknowledged: true,
      cacheRetained: true,
      metadataRollback: "not_reached",
    }, options.signal.reason);
  }
  const cacheBackend = chooseBrowserWebLLMCacheBackend(device);
  let previous = (await readMetadataRecords()).find(
    (record): record is BrowserWebLLMModelMetadata => (
      record.kind === "model" && record.modelId === modelId
    ),
  );
  await navigator.storage?.persist?.().catch(() => false);
  const installing: BrowserWebLLMModelMetadata = {
    schemaVersion: BROWSER_WEBLLM_METADATA_SCHEMA_VERSION,
    key: modelMetadataKey(modelId),
    kind: "model",
    modelId,
    modelDigest: model.modelDigest,
    sourceRevision: model.sourceRevision,
    cacheBackend,
    installStatus: "installing",
    cacheVerified: false,
    shardIntegrityVerified: false,
    shardManifestDigest: null,
    manifestDigest: null,
    shardVerifiedAt: null,
    verifiedShardCount: 0,
    requiredShardCount: 0,
    installedAt: previous?.installedAt ?? null,
    lastUsedAt: previous?.lastUsedAt ?? null,
    lastError: null,
    setupAttemptId: options.setupOwnership.attemptId,
    setupEpoch: options.setupOwnership.epoch,
    generationVerifiedAt: null,
    verifiedAt: null,
    generationVerified: false,
    workerRuntimeVersion: BROWSER_WEBLLM_WORKER_RUNTIME_VERSION,
    workerRuntimeDigest: BROWSER_WEBLLM_WORKER_RUNTIME_DIGEST,
    engineGenerationDigest: null,
    setupAttemptIdDigest: null,
    metadataTransactionTokenDigest: null,
    revision: (previous?.revision ?? 0) + 1,
    generationCount: previous?.generationCount ?? 0,
    averageFirstTokenMs: previous?.averageFirstTokenMs ?? null,
    averageTokensPerSecond: previous?.averageTokensPerSecond ?? null,
  };
  if (options.signal?.aborted) {
    throw setupCancellationError({
      code: "BROWSER_WEBLLM_SETUP_CANCELLED",
      cancellationAcknowledged: true,
      cacheRetained: true,
      metadataRollback: "not_reached",
    }, options.signal.reason);
  }
  try {
    previous = await claimSetupMetadataAtomically(
      installing,
      options.setupOwnership,
      options.signal,
    );
  } catch (error) {
    if (options.signal?.aborted) {
      throw setupCancellationError({
        code: "BROWSER_WEBLLM_SETUP_CANCELLED",
        cancellationAcknowledged: true,
        cacheRetained: true,
        metadataRollback: "not_reached",
      }, error);
    }
    throw error;
  }
  reportProgress({
    modelId,
    phase: "checking",
    progress: 0,
    text: "正在檢查模型快取與裝置相容性。",
  });
  try {
    const engine = await createEngine(
      modelId,
      cacheBackend,
      options.onProgress,
      options.signal,
      options.setupOwnership,
      options.diagnostics,
    );
    if (options.signal?.aborted) {
      engine.interruptGenerate();
      throw new DOMException("已取消模型安裝。", "AbortError");
    }
    const webllm = await import("@mlc-ai/web-llm");
    const cacheVerified = await webllm.hasModelInCache(
      modelId,
      browserWebLLMAppConfig(cacheBackend),
    );
    if (!cacheVerified) {
      throw runtimeError(
        "BROWSER_WEBLLM_CACHE_INCOMPLETE",
        "模型已載入，但離線權重快取尚未完整，未標記為可離線使用。",
      );
    }
    reportProgress({
      modelId,
      phase: "verifying",
      progress: 0.96,
      text: "正在逐一驗證不可變模型權重分片。",
    });
    if (options.diagnostics) {
      await options.diagnostics.checkpoint(
        "all-shards-before-integrity-verify",
        {
          workerGeneration: activeWorkerGeneration,
          engineGeneration: activeEngineGeneration,
          ordering: "engine-created-before-custom-integrity",
        },
      );
    }
    const shardVerification = await verifyBrowserModelShards({
      modelId,
      signal: options.signal,
      onProgress: (progress) => {
        const diagnosticCheckpoint = progress.verifiedShardCount === 1
          && options.diagnostics
          ? options.diagnostics.checkpoint("integrity-verify", {
            workerGeneration: activeWorkerGeneration,
            engineGeneration: activeEngineGeneration,
            ordering: "engine-created-before-custom-integrity",
          })
          : null;
        const publish = () => {
        const update: BrowserWebLLMProgress = {
          modelId,
          phase: "verifying",
          progress: Math.min(
            0.999,
            0.96 + (progress.verifiedShardCount / progress.shardCount) * 0.039,
          ),
          text: `驗證 ${progress.shardPath}（${progress.verifiedShardCount}/${progress.shardCount}）`,
        };
        reportProgress(update);
        options.onProgress?.(update);
        };
        if (diagnosticCheckpoint) return diagnosticCheckpoint.then(publish);
        publish();
      },
    });
    if (!shardVerification.verified) {
      await releaseActiveEngine();
      await webllm.deleteModelAllInfoInCache(
        modelId,
        browserWebLLMAppConfig(cacheBackend),
      );
      throw Object.assign(
        new Error("模型權重分片完整性驗證失敗，失敗快取已隔離並刪除。"),
        {
          code: "MODEL_INTEGRITY_FAILED",
          failures: shardVerification.failures.map((failure) => ({
            path: failure.path,
            reason: failure.reason,
          })),
        },
      );
    }
    const installedAt = new Date().toISOString();
    const verifiedMetadata: BrowserWebLLMModelMetadata = {
      ...installing,
      installStatus: "staged",
      cacheVerified: true,
      shardIntegrityVerified: true,
      shardManifestDigest: shardVerification.manifestDigest,
      manifestDigest: shardVerification.manifestDigest,
      shardVerifiedAt: shardVerification.verifiedAt,
      verifiedShardCount: shardVerification.verifiedShardCount,
      requiredShardCount: shardVerification.shardCount,
      installedAt,
      revision: (installing.revision ?? 0) + 1,
    };
    await mutateSetupMetadataAtomically(
      modelId,
      options.setupOwnership,
      (store, current) => store.put({
        ...verifiedMetadata,
        revision: (current.revision ?? 0) + 1,
      } satisfies BrowserWebLLMModelMetadata),
      options.signal,
    );
    reportProgress({
      modelId,
      phase: "verifying",
      progress: 1,
      text: "模型快取已驗證；正在等待預熱與最小真實生成驗證。",
    });
    return browserWebLLMRuntimeSnapshot();
  } catch (error) {
    const cancelled = options.signal?.aborted === true;
    if (cancelled) {
      const engineCleanup = await releaseSetupEngine(
        options.setupOwnership,
        { force: true },
      ).catch(() => Object.freeze({
        engineOwnershipMatched: false,
        engineDetached: activeEngine === null && activeWorker === null,
        workerDisposeAcknowledged: false,
      }));
      await mutateSetupMetadataAtomically(
        modelId,
        options.setupOwnership,
        (store) => {
          if (previous) store.put(previous);
          else store.delete(modelMetadataKey(modelId));
        },
      ).catch((rollbackError) => {
        throw runtimeError(
          "BROWSER_WEBLLM_SETUP_CANCELLATION_CLEANUP_FAILED",
          "取消模型準備後無法確認 metadata 已安全回復。",
          rollbackError,
        );
      });
      const cleanupReceipt = options.diagnostics?.acknowledgeCleanup({
        ...engineCleanup,
        metadataCleanupAcknowledged: true,
      });
      if (cleanupReceipt && !cleanupReceipt.cleanupAcknowledged) {
        throw runtimeError(
          "BROWSER_WEBLLM_SETUP_CANCELLATION_CLEANUP_FAILED",
          "Browser AI diagnostic cleanup was not fully acknowledged.",
        );
      }
      reportProgress({
        modelId,
        phase: "error",
        progress: 0,
        text: "模型準備已取消；已下載的安全快取會留在此裝置供下次續用。",
      });
      throw setupCancellationError({
        code: "BROWSER_WEBLLM_SETUP_CANCELLED",
        cancellationAcknowledged: true,
        cacheRetained: true,
        metadataRollback: previous ? "restored" : "deleted",
      }, error);
    }
    const engineCleanup = await releaseSetupEngine(
      options.setupOwnership,
      { force: true },
    ).catch(() => Object.freeze({
      engineOwnershipMatched: false,
      engineDetached: activeEngine === null && activeWorker === null,
      workerDisposeAcknowledged: false,
    }));
    const message = error instanceof Error ? error.message : String(error);
    const failureMetadata: BrowserWebLLMModelMetadata = {
      ...installing,
      installStatus: "error",
      lastError: message.slice(0, 300),
    };
    let metadataCleanupAcknowledged = true;
    await mutateSetupMetadataAtomically(
      modelId,
      options.setupOwnership,
      (store) => store.put(failureMetadata),
    ).catch(() => {
      metadataCleanupAcknowledged = false;
    });
    options.diagnostics?.acknowledgeCleanup({
      ...engineCleanup,
      metadataCleanupAcknowledged,
    });
    reportProgress({ modelId, phase: "error", progress: 0, text: message });
    const errorCode = (error as { code?: unknown } | null)?.code;
    if (
      errorCode === "MODEL_INTEGRITY_FAILED"
      || errorCode === "BROWSER_AI_SETUP_DIAGNOSTIC_WORKER_CRASH"
    ) {
      throw error;
    }
    throw runtimeError("BROWSER_WEBLLM_INSTALL_FAILED", "Browser AI 模型安裝失敗。", error);
  }
}

export async function deleteBrowserWebLLMModel(
  modelId: BrowserWebLLMModelId,
  options: { userConfirmed: true },
) {
  if (options.userConfirmed !== true) {
    throw Object.assign(new Error("Browser model deletion requires explicit user confirmation."), {
      code: "BROWSER_MODEL_DELETION_CONFIRMATION_REQUIRED",
    });
  }
  const model = browserWebLLMModel(modelId);
  if (!model) throw runtimeError("BROWSER_WEBLLM_MODEL_UNKNOWN", "未知的 Browser AI 模型。");
  const snapshot = await browserWebLLMRuntimeSnapshot();
  if (activeModelId === modelId) await releaseActiveEngine();
  const webllm = await import("@mlc-ai/web-llm");
  await webllm.deleteModelAllInfoInCache(
    modelId,
    browserWebLLMAppConfig(snapshot.cacheBackend),
  );
  await deleteMetadataRecord(modelMetadataKey(modelId));
  if (snapshot.selectedModelId === modelId) {
    await deleteMetadataRecord(SELECTED_MODEL_KEY);
  }
  if (lastGeneration?.modelId === modelId) lastGeneration = null;
  currentProgress = null;
  return browserWebLLMRuntimeSnapshot();
}

export function cancelBrowserWebLLMGeneration() {
  activeEngine?.interruptGenerate();
}

async function assertExpectedGenerationModelIdentity(
  expected: BrowserWebLLMGenerationInput["expectedModelIdentity"],
) {
  if (!expected) return;
  const snapshot = await browserWebLLMRuntimeSnapshot();
  const state = snapshot.models.find(
    (model) => model.modelId === expected.modelId,
  );
  const manifest = browserWebLLMModel(expected.modelId);
  if (
    snapshot.selectedModelId !== expected.modelId
    || state?.selected !== true
    || state.modelDigest !== expected.modelDigest
    || manifest?.modelDigest !== expected.modelDigest
  ) {
    throw runtimeError(
      "BROWSER_PROSE_ROUTER_RUNTIME_IDENTITY_MISMATCH",
      "The selected Browser prose model identity changed before execution.",
    );
  }
}

async function readyModel(
  signal?: AbortSignal,
  setupVerification?: BrowserWebLLMSetupBoundary,
  expectedModelIdentity?: BrowserWebLLMGenerationInput["expectedModelIdentity"],
) {
  const snapshot = await browserWebLLMRuntimeSnapshot();
  const modelId = setupVerification?.modelId
    ?? expectedModelIdentity?.modelId
    ?? snapshot.selectedModelId;
  const state = snapshot.models.find((model) => model.modelId === modelId);
  const stagedSetupValid = Boolean(
    setupVerification
    && state?.installStatus === "staged"
    && state.cacheVerified
    && state.shardIntegrityVerified,
  );
  if (
    !modelId
    || !state
    || (state?.installStatus !== "ready" && !stagedSetupValid)
    || !state?.cacheVerified
    || !state?.shardIntegrityVerified
    || !state?.allowed
  ) {
    throw runtimeError(
      "BROWSER_WEBLLM_MODEL_NOT_INSTALLED",
      "尚未安裝可離線使用的 Browser AI 生成模型。",
    );
  }
  if (setupVerification) {
    const metadata = (await readMetadataRecords()).find(
      (record): record is BrowserWebLLMModelMetadata => (
        record.kind === "model" && record.modelId === modelId
      ),
    );
    if (!metadataOwnedBySetup(metadata, setupVerification.setupOwnership)) {
      throw runtimeError(
        "BROWSER_WEBLLM_SETUP_STALE_ATTEMPT",
        "舊的 Browser AI 準備程序不可使用目前模型狀態。",
      );
    }
  }
  const model = browserWebLLMModel(modelId)!;
  if (
    expectedModelIdentity
    && model.modelDigest !== expectedModelIdentity.modelDigest
  ) {
    throw runtimeError(
      "BROWSER_PROSE_ROUTER_RUNTIME_IDENTITY_MISMATCH",
      "The selected Browser prose model identity changed before execution.",
    );
  }
  const engineReused = Boolean(
    activeEngine
    && activeModelId === modelId
    && activeCacheBackend === snapshot.cacheBackend,
  );
  const engine = await createEngine(
    modelId,
    snapshot.cacheBackend,
    undefined,
    signal,
    setupVerification?.setupOwnership,
    setupVerification?.diagnostics,
  );
  return { snapshot, model, engine, engineReused };
}

export async function prewarmBrowserWebLLMModel(
  signal?: AbortSignal,
  setupVerification?: BrowserWebLLMSetupBoundary,
) {
  const started = performance.now();
  if (setupVerification?.diagnostics) {
    await setupVerification.diagnostics.checkpoint("warmup", {
      workerGeneration: activeWorkerGeneration,
      engineGeneration: activeEngineGeneration,
    });
  }
  const { model, engineReused } = await readyModel(signal, setupVerification);
  if (signal?.aborted) throw new DOMException("已取消模型預熱。", "AbortError");
  lastWarmupMs = Math.round(performance.now() - started);
  lastWarmupAt = new Date().toISOString();
  warmupCount += 1;
  if (engineReused) engineReuseCount += 1;
  return {
    modelId: model.modelId,
    engineReused,
    warmupMs: lastWarmupMs,
    snapshot: await browserWebLLMRuntimeSnapshot(),
  };
}

export async function finalizeBrowserWebLLMSetup(
  boundary: BrowserWebLLMSetupBoundary,
  options: {
    signal?: AbortSignal;
    generationModelId: BrowserWebLLMModelId;
    generationModelDigest: string;
    onCommitted: () => void;
  },
) {
  const model = browserWebLLMModel(boundary.modelId);
  if (
    !model
    || options.generationModelId !== model.modelId
    || options.generationModelDigest !== model.modelDigest
  ) {
    throw runtimeError(
      "BROWSER_WEBLLM_SETUP_GENERATION_PROOF_MISMATCH",
      "最小真實生成證明與 staged Browser AI 模型不一致。",
    );
  }
  if (
    !activeEngine
    || activeModelId !== boundary.modelId
    || !sameSetupOwnership(activeSetupOwnership, boundary.setupOwnership)
    || activeWorkerGeneration < 1
    || activeEngineGeneration < 1
  ) {
    throw runtimeError(
      "BROWSER_WEBLLM_SETUP_RUNTIME_OWNERSHIP_STALE",
      "Browser AI Worker 或 Engine 已不再由目前的準備程序擁有。",
    );
  }
  const runtimeGeneration = Object.freeze({
    workerGeneration: activeWorkerGeneration,
    engineGeneration: activeEngineGeneration,
  });
  const setupAttemptIdDigest = await sha256Hex(
    `p24b-rc6.4-browser-ai-setup-attempt-v1\n${boundary.setupOwnership.attemptId}`,
  );
  const engineGenerationDigest = await sha256Hex(stableStringify({
    domain: "p24b-rc6.4-browser-ai-engine-generation-v1",
    modelDigest: model.modelDigest,
    setupAttemptIdDigest,
    setupEpoch: boundary.setupOwnership.epoch,
    ...runtimeGeneration,
  }));
  const metadataTransactionTokenDigest = await sha256Hex(stableStringify({
    domain: "p24b-rc6.4-browser-ai-metadata-transaction-v1",
    engineGenerationDigest,
    modelDigest: model.modelDigest,
    setupEpoch: boundary.setupOwnership.epoch,
  }));
  if (
    !sameSetupOwnership(activeSetupOwnership, boundary.setupOwnership)
    || activeWorkerGeneration !== runtimeGeneration.workerGeneration
    || activeEngineGeneration !== runtimeGeneration.engineGeneration
  ) {
    throw runtimeError(
      "BROWSER_WEBLLM_SETUP_RUNTIME_OWNERSHIP_STALE",
      "Browser AI runtime generation changed before metadata commit.",
    );
  }
  if (boundary.diagnostics) {
    await boundary.diagnostics.checkpoint(
      "before-verified-metadata-transaction",
      {
        workerGeneration: runtimeGeneration.workerGeneration,
        engineGeneration: runtimeGeneration.engineGeneration,
      },
    );
  }
  const generationVerifiedAt = new Date().toISOString();
  await mutateSetupMetadataAtomically(
    boundary.modelId,
    boundary.setupOwnership,
    (store, current) => {
      if (
        current.installStatus !== "staged"
        || !current.cacheVerified
        || !current.shardIntegrityVerified
        || current.verifiedShardCount < 1
        || current.requiredShardCount !== current.verifiedShardCount
        || typeof current.manifestDigest !== "string"
        || current.manifestDigest !== current.shardManifestDigest
      ) {
        throw runtimeError(
          "BROWSER_WEBLLM_SETUP_NOT_STAGED",
          "Browser AI 模型尚未完成 staged 快取驗證。",
        );
      }
      store.put({
        ...current,
        installStatus: "ready",
        installedAt: current.installedAt ?? generationVerifiedAt,
        generationVerifiedAt,
        verifiedAt: generationVerifiedAt,
        generationVerified: true,
        workerRuntimeVersion: BROWSER_WEBLLM_WORKER_RUNTIME_VERSION,
        workerRuntimeDigest: BROWSER_WEBLLM_WORKER_RUNTIME_DIGEST,
        engineGenerationDigest,
        setupAttemptIdDigest,
        metadataTransactionTokenDigest,
        revision: (current.revision ?? 0) + 1,
        lastError: null,
      } satisfies BrowserWebLLMModelMetadata);
      store.put({
        key: SELECTED_MODEL_KEY,
        kind: "setting",
        modelId: boundary.modelId,
      } satisfies SelectedModelRecord);
    },
    options.signal,
    boundary.diagnostics,
  );
  if (sameSetupOwnership(activeSetupOwnership, boundary.setupOwnership)) {
    activeSetupOwnership = null;
  }
  // The IDB transaction above is the linearization point. Notify the
  // coordinator synchronously before any progress callback or snapshot read
  // can throw, so a durable ready+selected commit can never be rolled back as
  // though finalization had not completed.
  options.onCommitted();
  reportProgress({
    modelId: boundary.modelId,
    phase: "ready",
    progress: 1,
    text: "模型已通過快取、預熱與最小真實生成驗證。",
  });
  return browserWebLLMRuntimeSnapshot();
}

export async function cancelBrowserWebLLMSetup(
  boundary: BrowserWebLLMSetupBoundary,
): Promise<BrowserWebLLMSetupCancellationOutcome> {
  const engineCleanup = await releaseSetupEngine(
    boundary.setupOwnership,
    { force: true },
  ).catch(() => Object.freeze({
    engineOwnershipMatched: false,
    engineDetached: activeEngine === null && activeWorker === null,
    workerDisposeAcknowledged: false,
  }));
  await mutateSetupMetadataAtomically(
    boundary.modelId,
    boundary.setupOwnership,
    (store) => store.delete(modelMetadataKey(boundary.modelId)),
  ).catch((error) => {
    throw runtimeError(
      "BROWSER_WEBLLM_SETUP_CANCELLATION_CLEANUP_FAILED",
      "取消模型準備後無法確認 metadata 已安全回復。",
      error,
    );
  });
  const cleanupReceipt = boundary.diagnostics?.acknowledgeCleanup({
    ...engineCleanup,
    metadataCleanupAcknowledged: true,
  });
  if (cleanupReceipt && !cleanupReceipt.cleanupAcknowledged) {
    throw runtimeError(
      "BROWSER_WEBLLM_SETUP_CANCELLATION_CLEANUP_FAILED",
      "Browser AI diagnostic cleanup was not fully acknowledged.",
    );
  }
  return Object.freeze({
    code: "BROWSER_WEBLLM_SETUP_CANCELLED" as const,
    cancellationAcknowledged: true as const,
    cacheRetained: true as const,
    metadataRollback: "deleted" as const,
  });
}

export async function failBrowserWebLLMSetup(
  boundary: BrowserWebLLMSetupBoundary,
  failure: unknown,
) {
  const engineCleanup = await releaseSetupEngine(
    boundary.setupOwnership,
    { force: true },
  ).catch(() => Object.freeze({
    engineOwnershipMatched: false,
    engineDetached: activeEngine === null && activeWorker === null,
    workerDisposeAcknowledged: false,
  }));
  const safeCode = failure && typeof failure === "object" && "code" in failure
    && typeof (failure as { code?: unknown }).code === "string"
    ? (failure as { code: string }).code
    : "BROWSER_WEBLLM_SETUP_FAILED";
  await mutateSetupMetadataAtomically(
    boundary.modelId,
    boundary.setupOwnership,
    (store, current) => store.put({
      ...current,
      installStatus: "error",
      lastError: safeCode.slice(0, 120),
      generationVerifiedAt: null,
      verifiedAt: null,
      generationVerified: false,
      engineGenerationDigest: null,
      metadataTransactionTokenDigest: null,
      revision: (current.revision ?? 0) + 1,
    } satisfies BrowserWebLLMModelMetadata),
  ).catch((error) => {
    throw runtimeError(
      "BROWSER_WEBLLM_SETUP_FAILURE_CLEANUP_FAILED",
      "模型準備失敗後無法安全提交 failure metadata。",
      error,
    );
  });
  const cleanupReceipt = boundary.diagnostics?.acknowledgeCleanup({
    ...engineCleanup,
    metadataCleanupAcknowledged: true,
  });
  if (cleanupReceipt && !cleanupReceipt.cleanupAcknowledged) {
    throw runtimeError(
      "BROWSER_WEBLLM_SETUP_FAILURE_CLEANUP_FAILED",
      "Browser AI diagnostic cleanup was not fully acknowledged.",
    );
  }
}

async function runBrowserWebLLMGeneration(
  input: BrowserWebLLMGenerationInput,
  queueWaitMs: number,
): Promise<BrowserWebLLMGenerationResult> {
  const started = performance.now();
  const boundedProseRecovery =
    input.outputConstraint === BROWSER_WEBLLM_BOUNDED_PROSE_RECOVERY_CONSTRAINT;
  if (!isBrowserWebLLMOutputConstraintBoundaryValid(input)) {
    throw runtimeError(
      "BROWSER_WEBLLM_GENERATION_FAILED",
      "The Browser AI output constraint is invalid for this invocation boundary.",
    );
  }
  const finalContextFields = [
    input.finalContextExpectations,
    input.finalContextOuterRequestId,
    input.finalContextOuterTaskType,
    input.finalContextOuterQualityPhase,
    input.finalContextPipelineKind,
    input.finalContextInnerStage,
    input.finalContextInnerIndex,
    input.invocationRequestId,
  ];
  const hasFinalContextBoundary = finalContextFields.some(
    (value) => value !== undefined,
  );
  if (
    input.contextAttestation === "required"
    && (
      input.trustedClosedPrompt !== true
      || input.finalContextExpectations === undefined
      || !input.finalContextOuterRequestId
      || !input.finalContextOuterTaskType
      || !input.finalContextOuterQualityPhase
      || !input.finalContextInnerStage
      || input.finalContextInnerIndex === undefined
      || !input.invocationRequestId
    )
  ) {
    throw runtimeError(
      "BROWSER_FINAL_CONTEXT_PROOF_REQUIRED",
      "The required final-model context boundary is incomplete.",
    );
  }
  const proofFreeBoundaryInvalid = input.contextAttestation === "not_required"
    && (
      hasFinalContextBoundary
      || input.prompt.includes("[[CTX3:")
      || input.prompt.includes("<approved-model-context>")
    );
  if (
    proofFreeBoundaryInvalid
    || input.contextAttestation === undefined && hasFinalContextBoundary
  ) {
    throw runtimeError(
      "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH",
      "The final-model context boundary does not match its declared requirement.",
    );
  }
  const { snapshot, model, engine, engineReused } = await readyModel(
    input.signal,
    input.setupVerification,
    input.expectedModelIdentity,
  );
  if (input.signal?.aborted) throw new DOMException("已取消生成。", "AbortError");
  if (engineReused) engineReuseCount += 1;
  const previousTelemetry = snapshot.models.find((item) => item.modelId === model.modelId);
  const performancePolicy = resolveBrowserAIPerformancePolicy({
    device: snapshot.device,
    model,
    mode: typeof document !== "undefined" && document.visibilityState === "hidden"
      ? "ECO"
      : undefined,
    requestedMaxTokens: input.maxTokens,
    requestedTemperature: input.temperature,
    requestedTopP: input.topP,
    requestedRepetitionPenalty: input.repetitionPenalty,
    previousTokensPerSecond: previousTelemetry?.averageTokensPerSecond,
  });
  const structuredInstruction = boundedProseRecovery
    ? `\n\n${BROWSER_WEBLLM_BOUNDED_PROSE_RECOVERY_SYSTEM_INSTRUCTION}`
    : input.jsonMode
      ? `\n\nReturn one JSON value only. It must satisfy this JSON Schema:\n${JSON.stringify(input.jsonSchema ?? { type: "object" })}`
      : "";
  const systemMessage = `${input.systemInstruction}${structuredInstruction}`;
  const systemTokens = estimateBrowserTokens(systemMessage);
  const promptBudgets = browserPromptTokenBudgets({
    performancePolicy,
    systemTokens,
  });
  if (promptBudgets.protectedContextHardLimitTokens < 1) {
    const code = input.contextAttestation === "required"
      ? "BROWSER_FINAL_CONTEXT_BUDGET_EXCEEDED"
      : "BROWSER_AI_MANDATORY_PROMPT_BUDGET_EXCEEDED";
    throw runtimeError(code, "The system and output reserves exhaust the model context window.");
  }
  const fittedPrompt = fitBrowserPromptToTokenBudget(
    input.prompt,
    promptBudgets.promptBudgetTokens,
    {
    trustedClosedPrompt: input.trustedClosedPrompt === true,
    protectedContextHardLimitTokens: input.contextAttestation === "required"
      ? promptBudgets.protectedContextHardLimitTokens
      : undefined,
    },
  );
  const interrupt = () => engine.interruptGenerate();
  input.signal?.addEventListener("abort", interrupt, { once: true });
  let content = "";
  let generatedTokenEvents = 0;
  let firstTokenMs: number | null = null;
  let finishReason: BrowserWebLLMFinishReason | null = null;
  let completionTokens: number | null = null;
  try {
    const messages = [
      {
        role: "system" as const,
        content: systemMessage,
      },
      { role: "user" as const, content: fittedPrompt.prompt },
    ];
    const responseFormat = browserWebLLMResponseFormat(input);
    const generationOptions = browserWebLLMGenerationOptions({
      performancePolicy,
      seed: input.seed,
    });
    const browserModelContextInvocationProof = input.contextAttestation === "required"
      ? await createBrowserFinalModelContextInvocationProof({
        outerRequestId: input.finalContextOuterRequestId ?? "",
        invocationRequestId: input.invocationRequestId ?? "",
        outerTaskType: input.finalContextOuterTaskType ?? "",
        outerQualityPhase: input.finalContextOuterQualityPhase ?? "draft",
        pipelineKind: input.finalContextPipelineKind,
        innerStage: input.finalContextInnerStage ?? "initial",
        innerIndex: input.finalContextInnerIndex ?? 0,
        modelId: model.modelId,
        modelDigest: model.modelDigest,
        callOptionsDigest: await digestBrowserWebLLMCallOptions({
          model: model.modelId,
          responseFormat,
          generationOptions,
        }),
        systemMessage: messages[0].content,
        userMessage: messages[1].content,
        expectations: input.finalContextExpectations!,
        omittedCharacters: fittedPrompt.omittedCharacters,
      })
      : undefined;
    // No await occurs between this final identity recheck and the engine call,
    // so a selection change cannot swap the production model after authority.
    await assertExpectedGenerationModelIdentity(input.expectedModelIdentity);
    const chunks = await engine.chat.completions.create({
      model: model.modelId,
      messages,
      response_format: responseFormat,
      ...generationOptions,
    });
    for await (const chunk of chunks) {
      if (input.signal?.aborted) {
        engine.interruptGenerate();
        throw new DOMException("已取消生成。", "AbortError");
      }
      const choice = chunk.choices[0];
      const telemetry = observeBrowserWebLLMStreamTelemetry(
        { finishReason, completionTokens },
        {
          finishReason: choice?.finish_reason,
          completionTokens: chunk.usage?.completion_tokens,
        },
      );
      finishReason = telemetry.finishReason;
      completionTokens = telemetry.completionTokens;
      const delta = choice?.delta?.content ?? "";
      if (!delta) continue;
      if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - started);
      content += delta;
      generatedTokenEvents += 1;
      input.onToken?.({
        delta,
        content,
        generatedTokenEvents,
        elapsedMs: Math.round(performance.now() - started),
      });
    }
    const trimmed = content.trim();
    if (!trimmed) {
      throw runtimeError("BROWSER_WEBLLM_EMPTY_RESPONSE", "Browser AI 沒有產生可用內容。");
    }
    const [runtimeStats, gpuVendor] = await Promise.all([
      engine.runtimeStatsText(model.modelId).catch(() => ""),
      engine.getGPUVendor().catch(() => ""),
    ]);
    await updateGenerationMetadataAtomically(
      model.modelId,
      model.modelDigest,
      input.setupVerification,
      {
        firstTokenMs,
        tokensPerSecond: parseTokensPerSecond(runtimeStats),
      },
    );
    const result: BrowserWebLLMGenerationResult = {
      content: trimmed,
      modelId: model.modelId,
      modelDigest: model.modelDigest,
      firstTokenMs,
      elapsedMs: Math.round(performance.now() - started),
      generatedTokenEvents,
      runtimeStats,
      tokensPerSecond: parseTokensPerSecond(runtimeStats),
      gpuVendor: gpuVendor || null,
      estimatedVramMB: model.estimatedVramMB,
      inputCharacters: input.systemInstruction.length + structuredInstruction.length + fittedPrompt.prompt.length,
      outputCharacters: trimmed.length,
      omittedInputCharacters: fittedPrompt.omittedCharacters,
      queueWaitMs,
      engineReused,
      finishReason,
      completionTokens,
      performancePolicy,
      browserModelContextInvocationProof,
      contextAttestation: input.contextAttestation,
      externalRequest: false,
      dataLeftDevice: false,
    };
    lastGeneration = {
      modelId: result.modelId,
      modelDigest: result.modelDigest,
      completedAt: new Date().toISOString(),
      elapsedMs: result.elapsedMs,
      firstTokenMs: result.firstTokenMs,
      generatedTokenEvents: result.generatedTokenEvents,
      tokensPerSecond: result.tokensPerSecond,
      gpuVendor: result.gpuVendor,
      estimatedVramMB: result.estimatedVramMB,
      runtimeStats: result.runtimeStats,
      inputCharacters: result.inputCharacters,
      outputCharacters: result.outputCharacters,
      omittedInputCharacters: result.omittedInputCharacters,
      queueWaitMs: result.queueWaitMs,
      engineReused: result.engineReused,
      finishReason: result.finishReason,
      completionTokens: result.completionTokens,
      performancePolicy: result.performancePolicy,
      externalRequest: false,
      dataLeftDevice: false,
    };
    return result;
  } finally {
    input.signal?.removeEventListener("abort", interrupt);
  }
}

export async function generateWithBrowserWebLLM(
  input: BrowserWebLLMGenerationInput,
): Promise<BrowserWebLLMGenerationResult> {
  const enqueuedAt = performance.now();
  const maxAttempts = browserWebLLMMaxAttempts(input);
  await assertExpectedGenerationModelIdentity(input.expectedModelIdentity);
  const snapshot = await browserWebLLMRuntimeSnapshot();
  if (
    input.expectedModelIdentity
    && snapshot.selectedModelId !== input.expectedModelIdentity.modelId
  ) {
    throw runtimeError(
      "BROWSER_PROSE_ROUTER_RUNTIME_IDENTITY_MISMATCH",
      "The selected Browser prose model identity changed before enqueue.",
    );
  }
  const selected = BROWSER_WEBLLM_MODELS.find(
    (model) => model.modelId === (
      input.setupVerification?.modelId
      ?? input.expectedModelIdentity?.modelId
      ?? snapshot.selectedModelId
    ),
  );
  if (!selected) {
    throw runtimeError(
      "BROWSER_WEBLLM_MODEL_NOT_SELECTED",
      "尚未選擇可執行的 Browser AI 模型。",
    );
  }
  return gpuQueue.enqueue({
    id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `browser-generation-${Date.now()}`,
    priority: typeof document !== "undefined" && document.visibilityState === "hidden"
      ? "background"
      : "interactive",
    timeoutMs: 180_000,
    maxAttempts,
    memoryBudgetMB: selected.estimatedVramMB,
    signal: input.signal,
    execute: async ({ signal }) => {
      activeGeneration = true;
      try {
        if (signal.aborted) {
          throw new DOMException("已取消生成。", "AbortError");
        }
        return await runBrowserWebLLMGeneration(
          { ...input, signal },
          Math.round(performance.now() - enqueuedAt),
        );
      } finally {
        activeGeneration = false;
      }
    },
  });
}

export async function resetBrowserWebLLMForTests() {
  await releaseActiveEngine();
  currentProgress = null;
  lastGeneration = null;
  gpuQueue = createGPUQueue();
  activeGeneration = false;
  engineReuseCount = 0;
  warmupCount = 0;
  lastWarmupAt = null;
  lastWarmupMs = null;
  progressListeners.clear();
}
