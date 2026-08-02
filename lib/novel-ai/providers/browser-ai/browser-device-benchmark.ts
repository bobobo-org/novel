import type {
  BrowserWebLLMDeviceProfile,
  BrowserWebLLMModelManifest,
} from "./webllm-model-registry";

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
    && finiteNonNegative(sample.workerCrashCount)
    && finiteNonNegative(sample.gpuDeviceLostCount)
    && sample.outputFailureRate >= 0
    && sample.outputFailureRate <= 1
    && sample.structuredOutputSuccessRate >= 0
    && sample.structuredOutputSuccessRate <= 1
  ));
  const limits = LIMITS[model.parameterLabel];
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
  const failureReasons: string[] = [];
  if (!device.supported) failureReasons.push("device_not_supported");
  if (!samples.length) failureReasons.push("no_valid_benchmark_sample");
  if (initializationMs > limits.maxInitializationMs) {
    failureReasons.push("initialization_too_slow");
  }
  if (firstTokenMs > limits.maxFirstTokenMs) {
    failureReasons.push("first_token_too_slow");
  }
  if (tokensPerSecond < limits.minTokensPerSecond) {
    failureReasons.push("throughput_below_model_gate");
  }
  if (workerCrashCount > 0) failureReasons.push("worker_crash_observed");
  if (gpuDeviceLostCount > 1) failureReasons.push("gpu_device_lost_repeated");
  if (outputFailureRate > limits.maxOutputFailureRate) {
    failureReasons.push("output_failure_rate_too_high");
  }
  if (structuredOutputSuccessRate < limits.minStructuredOutputSuccessRate) {
    failureReasons.push("structured_output_success_too_low");
  }
  if (
    device.deviceMemoryGB !== null
    && peakEstimatedMemoryMB > device.deviceMemoryGB * 1024 * 0.82
  ) {
    failureReasons.push("memory_budget_exceeded");
  }
  const measuredAt = samples
    .map((sample) => sample.completedAt)
    .sort()
    .at(-1) ?? new Date().toISOString();
  return {
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
    benchmarkPassed: failureReasons.length === 0,
    failureReasons,
    measuredAt,
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
) {
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
): Promise<BrowserDeviceBenchmark | null> {
  const database = await openBenchmarkDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(BENCHMARK_STORE, "readonly");
      const request = transaction.objectStore(BENCHMARK_STORE).get(
        `${modelId}:${modelDigest}`,
      );
      request.onsuccess = () => resolve(
        (request.result as BrowserDeviceBenchmark | undefined) ?? null,
      );
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}
