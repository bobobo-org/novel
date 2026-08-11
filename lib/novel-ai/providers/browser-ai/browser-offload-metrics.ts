import { sha256Hex, stableStringify } from "../../closed-ai-cache";
import type {
  PlatformProviderId,
  PlatformTaskType,
} from "../../router/platform-types";
import {
  verifyBrowserFinalModelContextAttestation,
  type BrowserFinalModelContextAttestation,
} from "../../security/browser-final-model-context-proof";
import { BROWSER_TASK_MODEL } from "./browser-task-model";

const OFFLOAD_DB = "novel-browser-offload-metrics-v1";
const OFFLOAD_STORE = "execution-receipts";
const inMemoryReceipts: BrowserExecutionReceipt[] = [];

export const BROWSER_EXECUTION_RECEIPT_VERSION =
  "browser-execution-receipt-v3" as const;
export const BROWSER_EXECUTION_RECEIPT_LEGACY_VERSION =
  "browser-execution-receipt-v2" as const;

export type BrowserExecutionReceiptV2 = {
  schemaVersion: typeof BROWSER_EXECUTION_RECEIPT_LEGACY_VERSION;
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

type BrowserExecutionReceiptV3Base = Omit<
  BrowserExecutionReceiptV2,
  "schemaVersion" | "receiptId"
> & {
  schemaVersion: typeof BROWSER_EXECUTION_RECEIPT_VERSION;
  receiptId: string;
};

export type BrowserExecutionReceiptV3 = BrowserExecutionReceiptV3Base & (
  | {
    contextAttestation: "required";
    finalModelContextAttestation: BrowserFinalModelContextAttestation;
    outerRequestIdDigest: string;
  }
  | {
    contextAttestation: "not_required";
    finalModelContextAttestation: null;
    outerRequestIdDigest: string | null;
  }
);

export type BrowserExecutionReceipt =
  | BrowserExecutionReceiptV2
  | BrowserExecutionReceiptV3;

type BrowserExecutionReceiptInputBase = Omit<
  BrowserExecutionReceiptV2,
  | "schemaVersion"
  | "receiptId"
  | "taskDigest"
  | "candidateOnly"
  | "canonicalMutationCount"
  | "rawPromptStored"
  | "rawOutputStored"
  | "rawChainOfThoughtStored"
  | "completedAt"
> & {
  taskIdentity: string;
};

type BrowserExecutionReceiptInput = BrowserExecutionReceiptInputBase & (
  | {
    contextAttestation: "required";
    outerRequestId: string;
    finalModelContextAttestation: BrowserFinalModelContextAttestation;
  }
  | {
    contextAttestation: "not_required";
    outerRequestId?: string;
    finalModelContextAttestation?: null;
  }
);

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

function invalidReceipt(code = "BROWSER_EXECUTION_RECEIPT_INVALID") {
  return Object.assign(new Error(code), { code });
}

const BROWSER_EXECUTION_RECEIPT_V3_KEYS = [
  "actualExecutor",
  "browserGenerationUsed",
  "browserPrecomputeUsed",
  "candidateOnly",
  "canonicalMutationCount",
  "completedAt",
  "contextAttestation",
  "contextTokensAfter",
  "contextTokensBefore",
  "dataLeftDevice",
  "elapsedMs",
  "externalAIUsed",
  "finalModelContextAttestation",
  "localOllamaCallsAvoided",
  "localOllamaUsed",
  "modelDigest",
  "modelId",
  "outerRequestIdDigest",
  "plannedPipeline",
  "privateHubJobsAvoided",
  "privateHubUsed",
  "rawChainOfThoughtStored",
  "rawOutputStored",
  "rawPromptStored",
  "receiptId",
  "remoteModelCallsAvoided",
  "remoteModelInputTokensSaved",
  "remoteModelOutputRepairAvoided",
  "schemaVersion",
  "taskDigest",
  "taskType",
  "tokensSaved",
] as const;

async function assertBrowserExecutionReceiptV3(
  receipt: BrowserExecutionReceiptV3,
) {
  if (
    Object.keys(receipt).sort().join(",")
      !== [...BROWSER_EXECUTION_RECEIPT_V3_KEYS].sort().join(",")
    || receipt.schemaVersion !== BROWSER_EXECUTION_RECEIPT_VERSION
    || receipt.candidateOnly !== true
    || receipt.canonicalMutationCount !== 0
    || receipt.rawPromptStored !== false
    || receipt.rawOutputStored !== false
    || receipt.rawChainOfThoughtStored !== false
    || !/^[a-f0-9]{64}$/u.test(receipt.taskDigest)
    || !Number.isFinite(Date.parse(receipt.completedAt))
  ) throw invalidReceipt();
  const { receiptId, ...body } = receipt;
  if (
    receiptId !== await sha256Hex(stableStringify({
      domain: "browser-execution-receipt-v3",
      body,
    }))
  ) throw invalidReceipt();
  if (receipt.contextAttestation === "required") {
    const attestation = receipt.finalModelContextAttestation;
    if (
      receipt.actualExecutor !== "webllm-worker"
      || receipt.browserGenerationUsed !== true
      || !/^[a-f0-9]{64}$/u.test(receipt.outerRequestIdDigest)
      || !await verifyBrowserFinalModelContextAttestation(attestation)
      || receipt.outerRequestIdDigest !== attestation.outerRequestIdDigest
      || receipt.taskType !== attestation.outerTaskType
      || attestation.contributingCalls.some((call) => (
        call.modelId !== receipt.modelId || call.modelDigest !== receipt.modelDigest
      ))
    ) throw invalidReceipt();
    return;
  }
  if (
    receipt.contextAttestation !== "not_required"
    || receipt.actualExecutor === "webllm-worker"
    || receipt.actualExecutor === "chromium-prompt-api"
    || receipt.browserGenerationUsed !== false
    || receipt.finalModelContextAttestation !== null
    || receipt.outerRequestIdDigest !== null
      && !/^[a-f0-9]{64}$/u.test(receipt.outerRequestIdDigest)
    || receipt.actualExecutor === "browser-task-model" && (
      receipt.modelId !== BROWSER_TASK_MODEL.modelId
      || receipt.modelDigest !== BROWSER_TASK_MODEL.modelDigest
    )
  ) throw invalidReceipt();
}

export async function createBrowserExecutionReceipt(
  input: BrowserExecutionReceiptInput,
): Promise<BrowserExecutionReceiptV3> {
  assertReceiptSafe(input);
  const completedAt = new Date().toISOString();
  const taskDigest = await sha256Hex(input.taskIdentity);
  const contextAttestation = input.contextAttestation;
  const finalModelContextAttestation = contextAttestation === "required"
    ? input.finalModelContextAttestation
    : null;
  const outerRequestIdDigest = input.outerRequestId
    ? await sha256Hex(input.outerRequestId)
    : null;
  if (input.contextAttestation === "required") {
    const attestation = input.finalModelContextAttestation;
    if (
      !await verifyBrowserFinalModelContextAttestation(
        attestation,
      )
      || !outerRequestIdDigest
      || attestation.outerRequestIdDigest !== outerRequestIdDigest
      || attestation.outerTaskType !== input.taskType
      || attestation.contributingCalls.some((call) => (
        call.modelId !== input.modelId || call.modelDigest !== input.modelDigest
      ))
    ) {
      throw Object.assign(new Error("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH"), {
        code: "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH",
      });
    }
  }
  if (
    contextAttestation === "required"
      ? input.actualExecutor !== "webllm-worker"
        || input.browserGenerationUsed !== true
        || !outerRequestIdDigest
      : input.actualExecutor === "webllm-worker"
        || input.actualExecutor === "chromium-prompt-api"
        || input.browserGenerationUsed !== false
        || input.finalModelContextAttestation !== undefined
  ) {
    throw Object.assign(new Error("BROWSER_FINAL_CONTEXT_PROOF_REQUIRED"), {
      code: "BROWSER_FINAL_CONTEXT_PROOF_REQUIRED",
    });
  }
  const {
    taskIdentity: _taskIdentity,
    outerRequestId: _outerRequestId,
    finalModelContextAttestation: _inputAttestation,
    contextAttestation: _contextAttestation,
    ...safe
  } = input;
  void _taskIdentity;
  void _outerRequestId;
  void _inputAttestation;
  void _contextAttestation;
  const body = {
    schemaVersion: BROWSER_EXECUTION_RECEIPT_VERSION,
    taskDigest,
    ...safe,
    contextAttestation,
    finalModelContextAttestation: finalModelContextAttestation
      ? structuredClone(finalModelContextAttestation)
      : null,
    outerRequestIdDigest,
    candidateOnly: true as const,
    canonicalMutationCount: 0 as const,
    rawPromptStored: false as const,
    rawOutputStored: false as const,
    rawChainOfThoughtStored: false as const,
    completedAt,
  };
  const receipt = {
    ...body,
    receiptId: await sha256Hex(stableStringify({
      domain: "browser-execution-receipt-v3",
      body,
    })),
  } as BrowserExecutionReceiptV3;
  await assertBrowserExecutionReceiptV3(receipt);
  return receipt;
}

export async function recordBrowserExecutionReceipt(receipt: BrowserExecutionReceipt) {
  assertReceiptSafe(receipt);
  if (receipt.schemaVersion !== BROWSER_EXECUTION_RECEIPT_VERSION) {
    throw Object.assign(new Error("BROWSER_EXECUTION_RECEIPT_LEGACY_READ_ONLY"), {
      code: "BROWSER_EXECUTION_RECEIPT_LEGACY_READ_ONLY",
    });
  }
  await assertBrowserExecutionReceiptV3(receipt);
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
    const receipts = await new Promise<BrowserExecutionReceipt[]>((resolve, reject) => {
      const transaction = database.transaction(OFFLOAD_STORE, "readonly");
      const request = transaction.objectStore(OFFLOAD_STORE).getAll();
      request.onsuccess = () => resolve(request.result as BrowserExecutionReceipt[]);
      request.onerror = () => reject(request.error);
    });
    for (const receipt of receipts) {
      assertReceiptSafe(receipt);
      if (receipt.schemaVersion === BROWSER_EXECUTION_RECEIPT_LEGACY_VERSION) continue;
      if (receipt.schemaVersion !== BROWSER_EXECUTION_RECEIPT_VERSION) {
        throw Object.assign(new Error("BROWSER_EXECUTION_RECEIPT_INVALID"), {
          code: "BROWSER_EXECUTION_RECEIPT_INVALID",
        });
      }
      await assertBrowserExecutionReceiptV3(receipt);
    }
    return receipts;
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
