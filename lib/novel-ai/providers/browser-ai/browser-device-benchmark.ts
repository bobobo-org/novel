import type {
  BrowserWebLLMDeviceProfile,
  BrowserWebLLMModelManifest,
} from "./webllm-model-registry";
import { browserWebLLMModel } from "./webllm-model-registry";

const BENCHMARK_DB = "novel-browser-device-benchmark-v1";
const BENCHMARK_STORE = "model-benchmarks";

export const BROWSER_DEVICE_BENCHMARK_VERSION =
  "browser-device-benchmark-v1" as const;

export type BrowserDeviceBenchmarkSample = {
  initializationMs: number;
  firstTokenMs: number;
  tokensPerSecond: number;
  peakEstimatedMemoryMB: number;
  workerCrashCount: number;
  gpuDeviceLostCount: number;
  outputFailureRate: number;
  structuredOutputSuccessRate: number;
  completedAt: string;
};

export type BrowserDeviceBenchmark = {
  schemaVersion: typeof BROWSER_DEVICE_BENCHMARK_VERSION;
  key: string;
  modelId: string;
  modelDigest: string;
  parameterLabel: BrowserWebLLMModelManifest["parameterLabel"];
  deviceTier: BrowserWebLLMDeviceProfile["tier"];
  sampleCount: number;
  initializationMs: number;
  firstTokenMs: number;
  tokensPerSecond: number;
  peakEstimatedMemoryMB: number;
  workerCrashCount: number;
  gpuDeviceLostCount: number;
  outputFailureRate: number;
  structuredOutputSuccessRate: number;
  benchmarkPassed: boolean;
  failureReasons: string[];
  measuredAt: string;
};

const LIMITS: Record<BrowserWebLLMModelManifest["parameterLabel"], {
  maxInitializationMs: number;
  maxFirstTokenMs: number;
  minTokensPerSecond: number;
  maxOutputFailureRate: number;
  minStructuredOutputSuccessRate: number;
}> = {
  "0.5B": {
    maxInitializationMs: 90_000,
    maxFirstTokenMs: 12_000,
    minTokensPerSecond: 1.5,
    maxOutputFailureRate: 0.1,
    minStructuredOutputSuccessRate: 0.9,
  },
  "1.5B": {
    maxInitializationMs: 150_000,
    maxFirstTokenMs: 18_000,
    minTokensPerSecond: 1,
    maxOutputFailureRate: 0.08,
    minStructuredOutputSuccessRate: 0.95,
  },
  "3B": {
    maxInitializationMs: 240_000,
    maxFirstTokenMs: 30_000,
    minTokensPerSecond: 0.6,
    maxOutputFailureRate: 0.08,
    minStructuredOutputSuccessRate: 0.95,
  },
};

const BENCHMARK_KEYS = [
  "benchmarkPassed",
  "deviceTier",
  "failureReasons",
  "firstTokenMs",
  "gpuDeviceLostCount",
  "initializationMs",
  "key",
  "measuredAt",
  "modelDigest",
  "modelId",
  "outputFailureRate",
  "parameterLabel",
  "peakEstimatedMemoryMB",
  "sampleCount",
  "schemaVersion",
  "structuredOutputSuccessRate",
  "tokensPerSecond",
  "workerCrashCount",
] as const;
const BENCHMARK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const BENCHMARK_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const DEVICE_TIER_RANK = {
  unsupported: 0,
  low: 1,
  standard: 2,
  high: 3,
} as const;
const BENCHMARK_FAILURE_REASONS = new Set([
  "device_not_supported",
  "no_valid_benchmark_sample",
  "initialization_too_slow",
  "first_token_too_slow",
  "throughput_below_model_gate",
  "worker_crash_observed",
  "gpu_device_lost_repeated",
  "output_failure_rate_too_high",
  "structured_output_success_too_low",
  "memory_budget_exceeded",
]);

function canonicalBenchmarkFailureReasons(input: {
  benchmark: BrowserDeviceBenchmark;
  model: BrowserWebLLMModelManifest;
  currentDeviceTier: BrowserWebLLMDeviceProfile["tier"];
}) {
  const { benchmark, model, currentDeviceTier } = input;
  const limits = LIMITS[model.parameterLabel];
  const reasons: string[] = [];
  if (
    DEVICE_TIER_RANK[benchmark.deviceTier] < DEVICE_TIER_RANK[model.tier]
    || DEVICE_TIER_RANK[currentDeviceTier] < DEVICE_TIER_RANK[model.tier]
  ) reasons.push("device_not_supported");
  if (benchmark.sampleCount < 1) reasons.push("no_valid_benchmark_sample");
  if (benchmark.initializationMs > limits.maxInitializationMs) {
    reasons.push("initialization_too_slow");
  }
  if (benchmark.firstTokenMs > limits.maxFirstTokenMs) {
    reasons.push("first_token_too_slow");
  }
  if (benchmark.tokensPerSecond < limits.minTokensPerSecond) {
    reasons.push("throughput_below_model_gate");
  }
  if (benchmark.workerCrashCount > 0) reasons.push("worker_crash_observed");
  if (benchmark.gpuDeviceLostCount > 1) {
    reasons.push("gpu_device_lost_repeated");
  }
  if (benchmark.outputFailureRate > limits.maxOutputFailureRate) {
    reasons.push("output_failure_rate_too_high");
  }
  if (
    benchmark.structuredOutputSuccessRate
      < limits.minStructuredOutputSuccessRate
  ) reasons.push("structured_output_success_too_low");
  if (benchmark.peakEstimatedMemoryMB > model.estimatedVramMB * 1.5) {
    reasons.push("memory_budget_exceeded");
  }
  return reasons;
}

export function isCanonicalBrowserDeviceBenchmark(
  value: unknown,
  input: {
    model: BrowserWebLLMModelManifest;
    currentDeviceTier: BrowserWebLLMDeviceProfile["tier"];
    nowMs?: number;
  },
): value is BrowserDeviceBenchmark {
  try {
    if (!value || typeof value !== "object") return false;
    const prototype = Object.getPrototypeOf(value);
    const ownKeys = Reflect.ownKeys(value);
    if (
      prototype !== Object.prototype
      && prototype !== null
      || ownKeys.length !== BENCHMARK_KEYS.length
      || ownKeys.some((key) => typeof key !== "string")
      || [...BENCHMARK_KEYS].some((key) => !ownKeys.includes(key))
      || ownKeys.some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !descriptor || !("value" in descriptor) || !descriptor.enumerable;
      })
    ) return false;
    const benchmark = value as BrowserDeviceBenchmark;
    if (
      typeof benchmark.schemaVersion !== "string"
      || typeof benchmark.key !== "string"
      || typeof benchmark.modelId !== "string"
      || typeof benchmark.modelDigest !== "string"
      || typeof benchmark.parameterLabel !== "string"
      || typeof benchmark.deviceTier !== "string"
      || typeof benchmark.benchmarkPassed !== "boolean"
      || typeof benchmark.measuredAt !== "string"
      || !Array.isArray(benchmark.failureReasons)
      || Object.getOwnPropertySymbols(benchmark.failureReasons).length > 0
      || benchmark.failureReasons.some((reason) => typeof reason !== "string")
    ) return false;
    const measuredAtMs = Date.parse(benchmark.measuredAt);
    const nowMs = input.nowMs ?? Date.now();
    if (
      benchmark.schemaVersion !== BROWSER_DEVICE_BENCHMARK_VERSION
      || benchmark.key !== `${input.model.modelId}:${input.model.modelDigest}`
      || benchmark.modelId !== input.model.modelId
      || benchmark.modelDigest !== input.model.modelDigest
      || benchmark.parameterLabel !== input.model.parameterLabel
      || !input.model.productionQualified
      || input.model.usePolicy !== "production"
      || !(benchmark.deviceTier in DEVICE_TIER_RANK)
      || typeof input.currentDeviceTier !== "string"
      || !(input.currentDeviceTier in DEVICE_TIER_RANK)
      || !Number.isFinite(nowMs)
      || !Number.isSafeInteger(benchmark.sampleCount)
      || benchmark.sampleCount < 1
      || ![
        benchmark.initializationMs,
        benchmark.firstTokenMs,
        benchmark.tokensPerSecond,
        benchmark.peakEstimatedMemoryMB,
      ].every(finiteNonNegative)
      || !Number.isSafeInteger(benchmark.workerCrashCount)
      || benchmark.workerCrashCount < 0
      || !Number.isSafeInteger(benchmark.gpuDeviceLostCount)
      || benchmark.gpuDeviceLostCount < 0
      || !Number.isFinite(benchmark.outputFailureRate)
      || benchmark.outputFailureRate < 0
      || benchmark.outputFailureRate > 1
      || !Number.isFinite(benchmark.structuredOutputSuccessRate)
      || benchmark.structuredOutputSuccessRate < 0
      || benchmark.structuredOutputSuccessRate > 1
      || new Set(benchmark.failureReasons).size !== benchmark.failureReasons.length
      || benchmark.failureReasons.some((reason) => (
        !BENCHMARK_FAILURE_REASONS.has(reason)
      ))
      || !Number.isFinite(measuredAtMs)
      || new Date(measuredAtMs).toISOString() !== benchmark.measuredAt
      || measuredAtMs > nowMs + BENCHMARK_MAX_FUTURE_SKEW_MS
      || nowMs - measuredAtMs > BENCHMARK_MAX_AGE_MS
    ) return false;
    const canonicalReasons = canonicalBenchmarkFailureReasons({
      benchmark,
      model: input.model,
      currentDeviceTier: input.currentDeviceTier,
    });
    if (
      canonicalReasons.length !== benchmark.failureReasons.length
      || canonicalReasons.some((reason, index) => (
        benchmark.failureReasons[index] !== reason
      ))
    ) {
      return false;
    }
    return benchmark.benchmarkPassed === (
      canonicalReasons.length === 0 && benchmark.failureReasons.length === 0
    );
  } catch {
    return false;
  }
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function mean(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function evaluateBrowserDeviceBenchmark(input: {
  model: BrowserWebLLMModelManifest;
  device: BrowserWebLLMDeviceProfile;
  samples: BrowserDeviceBenchmarkSample[];
}): BrowserDeviceBenchmark {
  const { model, device } = input;
  const samples = input.samples.filter((sample) => (
    finiteNonNegative(sample.initializationMs)
    && finiteNonNegative(sample.firstTokenMs)
    && finiteNonNegative(sample.tokensPerSecond)
    && finiteNonNegative(sample.peakEstimatedMemoryMB)
    && Number.isSafeInteger(sample.workerCrashCount)
    && sample.workerCrashCount >= 0
    && Number.isSafeInteger(sample.gpuDeviceLostCount)
    && sample.gpuDeviceLostCount >= 0
    && sample.outputFailureRate >= 0
    && sample.outputFailureRate <= 1
    && sample.structuredOutputSuccessRate >= 0
    && sample.structuredOutputSuccessRate <= 1
    && typeof sample.completedAt === "string"
    && Number.isFinite(Date.parse(sample.completedAt))
    && new Date(Date.parse(sample.completedAt)).toISOString()
      === sample.completedAt
  ));
  const initializationMs = round(mean(samples.map((sample) => sample.initializationMs)));
  const firstTokenMs = round(mean(samples.map((sample) => sample.firstTokenMs)));
  const tokensPerSecond = round(mean(samples.map((sample) => sample.tokensPerSecond)));
  const peakEstimatedMemoryMB = round(Math.max(
    0,
    ...samples.map((sample) => sample.peakEstimatedMemoryMB),
  ));
  const workerCrashCount = samples.reduce(
    (sum, sample) => sum + sample.workerCrashCount,
    0,
  );
  const gpuDeviceLostCount = samples.reduce(
    (sum, sample) => sum + sample.gpuDeviceLostCount,
    0,
  );
  const outputFailureRate = round(mean(
    samples.map((sample) => sample.outputFailureRate),
  ), 4);
  const structuredOutputSuccessRate = round(mean(
    samples.map((sample) => sample.structuredOutputSuccessRate),
  ), 4);
  const measuredAt = samples
    .map((sample) => sample.completedAt)
    .sort()
    .at(-1) ?? new Date().toISOString();
  const benchmark: BrowserDeviceBenchmark = {
    schemaVersion: BROWSER_DEVICE_BENCHMARK_VERSION,
    key: `${model.modelId}:${model.modelDigest}`,
    modelId: model.modelId,
    modelDigest: model.modelDigest,
    parameterLabel: model.parameterLabel,
    deviceTier: device.tier,
    sampleCount: samples.length,
    initializationMs,
    firstTokenMs,
    tokensPerSecond,
    peakEstimatedMemoryMB,
    workerCrashCount,
    gpuDeviceLostCount,
    outputFailureRate,
    structuredOutputSuccessRate,
    benchmarkPassed: false,
    failureReasons: [],
    measuredAt,
  };
  const failureReasons = canonicalBenchmarkFailureReasons({
    benchmark,
    model,
    currentDeviceTier: device.tier,
  });
  return {
    ...benchmark,
    benchmarkPassed: failureReasons.length === 0,
    failureReasons,
  };
}

function openBenchmarkDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(Object.assign(
      new Error("IndexedDB is required to persist browser model benchmarks."),
      { code: "BROWSER_BENCHMARK_INDEXEDDB_UNAVAILABLE" },
    ));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BENCHMARK_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BENCHMARK_STORE)) {
        request.result.createObjectStore(BENCHMARK_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function persistBrowserDeviceBenchmark(
  benchmark: BrowserDeviceBenchmark,
  currentDeviceTier: BrowserWebLLMDeviceProfile["tier"],
) {
  const model = browserWebLLMModel(benchmark.modelId);
  if (
    !model
    || !isCanonicalBrowserDeviceBenchmark(benchmark, {
      model,
      currentDeviceTier,
    })
  ) {
    throw Object.assign(new Error("Browser benchmark evidence is invalid."), {
      code: "BROWSER_DEVICE_BENCHMARK_INVALID",
    });
  }
  const database = await openBenchmarkDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(BENCHMARK_STORE, "readwrite");
      transaction.objectStore(BENCHMARK_STORE).put(benchmark);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
  return benchmark;
}

export async function readBrowserDeviceBenchmark(
  modelId: string,
  modelDigest: string,
  currentDeviceTier: BrowserWebLLMDeviceProfile["tier"],
): Promise<BrowserDeviceBenchmark | null> {
  const database = await openBenchmarkDatabase();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(BENCHMARK_STORE, "readonly");
      const request = transaction.objectStore(BENCHMARK_STORE).get(
        `${modelId}:${modelDigest}`,
      );
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    const model = browserWebLLMModel(modelId);
    return model
      && model.modelDigest === modelDigest
      && isCanonicalBrowserDeviceBenchmark(value, {
        model,
        currentDeviceTier,
      })
      ? value
      : null;
  } finally {
    database.close();
  }
}
