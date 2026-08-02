import { sha256Hex, stableStringify } from "../../closed-ai-cache";
import type {
  PlatformProviderId,
  PlatformTaskType,
} from "../../router/platform-types";

const OFFLOAD_DB = "novel-browser-offload-metrics-v1";
const OFFLOAD_STORE = "execution-receipts";
const inMemoryReceipts: BrowserExecutionReceipt[] = [];

export const BROWSER_EXECUTION_RECEIPT_VERSION =
  "browser-execution-receipt-v2" as const;

export type BrowserExecutionReceipt = {
  schemaVersion: typeof BROWSER_EXECUTION_RECEIPT_VERSION;
  receiptId: string;
  taskDigest: string;
  taskType: PlatformTaskType;
  plannedPipeline: string[];
  actualExecutor:
    | PlatformProviderId
    | "deterministic-browser"
    | "semantic-worker"
    | "webllm-worker"
    | "chromium-prompt-api"
    | "chromium-summarizer"
    | "browser-task-model";
  modelId: string | null;
  modelDigest: string | null;
  browserPrecomputeUsed: boolean;
  browserGenerationUsed: boolean;
  localOllamaUsed: boolean;
  privateHubUsed: boolean;
  externalAIUsed: boolean;
  dataLeftDevice: boolean;
  contextTokensBefore: number;
  contextTokensAfter: number;
  tokensSaved: number;
  remoteModelInputTokensSaved: number;
  remoteModelOutputRepairAvoided: number;
  remoteModelCallsAvoided: number;
  privateHubJobsAvoided: number;
  localOllamaCallsAvoided: number;
  elapsedMs: number;
  candidateOnly: true;
  canonicalMutationCount: 0;
  rawPromptStored: false;
  rawOutputStored: false;
  rawChainOfThoughtStored: false;
  completedAt: string;
};

export type BrowserOffloadSummary = {
  eligibleTaskCount: number;
  browserExecutedCount: number;
  browserOffloadRatio: number;
  localOllamaCallsAvoided: number;
  privateHubJobsAvoided: number;
  estimatedTokensSaved: number;
  estimatedComputeMinutesSaved: number;
  externalAIUsedCount: number;
  dataLeftDeviceCount: number;
};

const SENSITIVE_KEYS = new Set([
  "prompt",
  "input",
  "output",
  "content",
  "storyText",
  "authorization",
  "token",
  "cookie",
  "chainOfThought",
]);

function isSensitiveKey(key: string) {
  if (SENSITIVE_KEYS.has(key)) return true;
  const normalized = key.replace(/[^a-z0-9]/giu, "").toLocaleLowerCase("en-US");
  return [
    "prompt",
    "rawprompt",
    "input",
    "rawinput",
    "output",
    "rawoutput",
    "content",
    "storytext",
    "chainofthought",
    "rawchainofthought",
    "authorization",
    "authorizationheader",
    "cookie",
    "setcookie",
    "csrf",
    "csrftoken",
    "pairingcode",
    "password",
    "secret",
    "accesstoken",
    "refreshtoken",
    "apikey",
  ].includes(normalized);
}

function assertReceiptSafe(value: unknown, path = "receipt") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      throw Object.assign(new Error(`Sensitive field is forbidden in ${path}.${key}.`), {
        code: "BROWSER_OFFLOAD_SENSITIVE_FIELD_REJECTED",
      });
    }
    assertReceiptSafe(child, `${path}.${key}`);
  }
}

function openOffloadDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLOAD_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OFFLOAD_STORE)) {
        request.result.createObjectStore(OFFLOAD_STORE, { keyPath: "receiptId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function createBrowserExecutionReceipt(input: Omit<
  BrowserExecutionReceipt,
  | "schemaVersion"
  | "receiptId"
  | "taskDigest"
  | "candidateOnly"
  | "canonicalMutationCount"
  | "rawPromptStored"
  | "rawOutputStored"
  | "rawChainOfThoughtStored"
  | "completedAt"
> & { taskIdentity: string }): Promise<BrowserExecutionReceipt> {
  assertReceiptSafe(input);
  const completedAt = new Date().toISOString();
  const taskDigest = await sha256Hex(input.taskIdentity);
  const receiptId = await sha256Hex(stableStringify({
    taskDigest,
    taskType: input.taskType,
    actualExecutor: input.actualExecutor,
    modelDigest: input.modelDigest,
    completedAt,
  }));
  const { taskIdentity: _taskIdentity, ...safe } = input;
  void _taskIdentity;
  return {
    schemaVersion: BROWSER_EXECUTION_RECEIPT_VERSION,
    receiptId,
    taskDigest,
    ...safe,
    candidateOnly: true,
    canonicalMutationCount: 0,
    rawPromptStored: false,
    rawOutputStored: false,
    rawChainOfThoughtStored: false,
    completedAt,
  };
}

export async function recordBrowserExecutionReceipt(receipt: BrowserExecutionReceipt) {
  assertReceiptSafe(receipt);
  if (typeof indexedDB === "undefined") {
    inMemoryReceipts.push(structuredClone(receipt));
    return receipt;
  }
  const database = await openOffloadDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(OFFLOAD_STORE, "readwrite");
      transaction.objectStore(OFFLOAD_STORE).put(receipt);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
  return receipt;
}

export async function readBrowserExecutionReceipts(): Promise<BrowserExecutionReceipt[]> {
  if (typeof indexedDB === "undefined") return structuredClone(inMemoryReceipts);
  const database = await openOffloadDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(OFFLOAD_STORE, "readonly");
      const request = transaction.objectStore(OFFLOAD_STORE).getAll();
      request.onsuccess = () => resolve(request.result as BrowserExecutionReceipt[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export function summarizeBrowserOffload(
  receipts: BrowserExecutionReceipt[],
): BrowserOffloadSummary {
  const eligibleTaskCount = receipts.length;
  const browserExecutedCount = receipts.filter((receipt) => (
    receipt.browserGenerationUsed
    || receipt.actualExecutor === "deterministic-browser"
    || receipt.actualExecutor === "semantic-worker"
    || receipt.actualExecutor === "webllm-worker"
    || receipt.actualExecutor === "chromium-prompt-api"
    || receipt.actualExecutor === "chromium-summarizer"
    || receipt.actualExecutor === "browser-task-model"
  )).length;
  const estimatedTokensSaved = receipts.reduce(
    (sum, receipt) => sum + receipt.tokensSaved,
    0,
  );
  // Counterfactual savings are intentionally modeled from explicit avoided
  // calls. Browser elapsed time is work performed, not time saved.
  const estimatedComputeMinutesSaved = receipts.reduce((sum, receipt) => (
    sum
    + receipt.localOllamaCallsAvoided * 0.25
    + receipt.privateHubJobsAvoided * 1
    + receipt.remoteModelCallsAvoided * 0.2
    + receipt.remoteModelOutputRepairAvoided * 0.1
  ), 0);
  return {
    eligibleTaskCount,
    browserExecutedCount,
    browserOffloadRatio: eligibleTaskCount
      ? Math.round(browserExecutedCount / eligibleTaskCount * 10_000) / 10_000
      : 0,
    localOllamaCallsAvoided: receipts.reduce(
      (sum, receipt) => sum + receipt.localOllamaCallsAvoided,
      0,
    ),
    privateHubJobsAvoided: receipts.reduce(
      (sum, receipt) => sum + receipt.privateHubJobsAvoided,
      0,
    ),
    estimatedTokensSaved,
    estimatedComputeMinutesSaved: Math.round(estimatedComputeMinutesSaved * 100) / 100,
    externalAIUsedCount: receipts.filter((receipt) => receipt.externalAIUsed).length,
    dataLeftDeviceCount: receipts.filter((receipt) => receipt.dataLeftDevice).length,
  };
}
