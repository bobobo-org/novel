import { browserFabricDigest } from "./execution-receipt";
import type {
  BrowserDeviceBenchmarkResult,
  BrowserDeviceQualificationProfile,
} from "./types";

type ProbeResult = {
  initializationMs?: number;
  coldFirstTokenMs?: number | null;
  warmFirstTokenMs?: number | null;
  prefillTokensPerSecond?: number | null;
  decodeTokensPerSecond?: number | null;
  structuredOutputSuccess?: boolean;
  peakEstimatedMemoryMB?: number | null;
  workerCrashCount?: number;
  gpuDeviceLostCount?: number;
  cacheReopenMs?: number;
};

export async function benchmarkBrowserFabricDevice(input: {
  profile: BrowserDeviceQualificationProfile;
  runProbe: () => Promise<ProbeResult>;
}): Promise<BrowserDeviceBenchmarkResult> {
  const started = performance.now();
  const failures: string[] = [];
  let result: ProbeResult = {};
  try {
    result = await input.runProbe();
  } catch (error) {
    failures.push((error as { code?: string })?.code ?? "BROWSER_DEVICE_BENCHMARK_FAILED");
  }
  const initializationMs = result.initializationMs ?? Math.round(performance.now() - started);
  if (!input.profile.worker) failures.push("WORKER_REQUIRED");
  if (!input.profile.indexedDb) failures.push("INDEXEDDB_REQUIRED");
  if (result.structuredOutputSuccess === false) failures.push("STRUCTURED_OUTPUT_FAILED");
  if ((result.workerCrashCount ?? 0) > 1) failures.push("WORKER_RECOVERY_FAILED");
  if ((result.gpuDeviceLostCount ?? 0) > 1) failures.push("GPU_DEVICE_LOST_RECOVERY_FAILED");
  const profileDigest = await browserFabricDigest(input.profile);
  const measuredAt = new Date().toISOString();
  return {
    schemaVersion: "browser-device-benchmark-v1",
    benchmarkId: await browserFabricDigest({ profileDigest, measuredAt, result }),
    profileDigest,
    initializationMs,
    coldFirstTokenMs: result.coldFirstTokenMs ?? null,
    warmFirstTokenMs: result.warmFirstTokenMs ?? null,
    prefillTokensPerSecond: result.prefillTokensPerSecond ?? null,
    decodeTokensPerSecond: result.decodeTokensPerSecond ?? null,
    structuredOutputSuccess: result.structuredOutputSuccess ?? false,
    peakEstimatedMemoryMB: result.peakEstimatedMemoryMB ?? null,
    workerCrashCount: result.workerCrashCount ?? 0,
    gpuDeviceLostCount: result.gpuDeviceLostCount ?? 0,
    cacheReopenMs: result.cacheReopenMs ?? 0,
    measuredAt,
    benchmarkPassed: failures.length === 0,
    failureCodes: failures,
  };
}
