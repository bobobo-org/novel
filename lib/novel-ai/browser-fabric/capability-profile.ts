import type { BrowserDeviceQualificationProfile } from "./types";

type BrowserNavigator = Navigator & {
  deviceMemory?: number;
  gpu?: {
    requestAdapter(): Promise<{
      features?: ReadonlySet<string>;
      limits?: { maxStorageBufferBindingSize?: number };
    } | null>;
  };
  ml?: unknown;
  connection?: { saveData?: boolean; effectiveType?: string };
  storage?: StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
};

type BrowserBuiltinGlobal = typeof globalThis & {
  LanguageModel?: {
    availability?: (options?: { expectedInputs?: Array<{ type: string; languages: string[] }> }) => Promise<string>;
  };
  ai?: { languageModel?: unknown };
};

function browserIdentity(userAgent: string) {
  const match = userAgent.match(/Edg\/(\d+(?:\.\d+)*)/u)
    ?? userAgent.match(/Chrome\/(\d+(?:\.\d+)*)/u)
    ?? userAgent.match(/Firefox\/(\d+(?:\.\d+)*)/u)
    ?? userAgent.match(/Version\/(\d+(?:\.\d+)*).*Safari/u);
  const browser = /Edg\//u.test(userAgent)
    ? "Microsoft Edge"
    : /Chrome\//u.test(userAgent)
      ? "Google Chrome"
      : /Firefox\//u.test(userAgent)
        ? "Mozilla Firefox"
        : /Safari\//u.test(userAgent)
          ? "Apple Safari"
          : "Unknown";
  return { browser, browserVersion: match?.[1] ?? "unknown" };
}

function operatingSystem(userAgent: string) {
  if (/Windows NT/u.test(userAgent)) return "Windows";
  if (/Android/u.test(userAgent)) return "Android";
  if (/iPhone|iPad|iPod/u.test(userAgent)) return "iOS/iPadOS";
  if (/Mac OS X/u.test(userAgent)) return "macOS";
  if (/Linux/u.test(userAgent)) return "Linux";
  return "Unknown";
}

async function chromeBuiltinLanguages(): Promise<string[]> {
  const root = globalThis as BrowserBuiltinGlobal;
  if (!root.LanguageModel?.availability) return [];
  const supported: string[] = [];
  for (const language of ["en", "zh", "zh-Hant"] as const) {
    try {
      const availability = await root.LanguageModel.availability({
        expectedInputs: [{ type: "text", languages: [language] }],
      });
      if (["available", "readily", "after-download", "downloadable"].includes(availability)) {
        supported.push(language);
      }
    } catch {
      // A rejected language probe is a truthful unsupported result.
    }
  }
  return supported;
}

export async function qualifyBrowserDevice(): Promise<BrowserDeviceQualificationProfile> {
  const now = new Date().toISOString();
  if (typeof navigator === "undefined") {
    return {
      schemaVersion: "browser-device-qualification-v1",
      browser: "server",
      browserVersion: "not-applicable",
      operatingSystem: "server",
      mobile: false,
      webGpu: false,
      webAssembly: typeof WebAssembly !== "undefined",
      worker: false,
      indexedDb: false,
      opfs: false,
      storageQuota: null,
      storageAvailable: null,
      hardwareConcurrency: null,
      deviceMemory: null,
      maxStorageBufferBindingSize: null,
      shaderF16: false,
      subgroups: false,
      timestampQuery: false,
      webNn: false,
      chromeBuiltinAi: false,
      chromeBuiltinLanguages: [],
      saveData: false,
      effectiveConnectionType: null,
      qualifiedAt: now,
    };
  }

  const current = navigator as BrowserNavigator;
  const identity = browserIdentity(current.userAgent);
  const estimate = current.storage?.estimate
    ? await current.storage.estimate().catch(() => ({} as StorageEstimate))
    : {} as StorageEstimate;
  let adapter: Awaited<ReturnType<NonNullable<BrowserNavigator["gpu"]>["requestAdapter"]>> = null;
  try {
    adapter = await current.gpu?.requestAdapter() ?? null;
  } catch {
    adapter = null;
  }
  const features = adapter?.features ?? new Set<string>();
  const builtInLanguages = await chromeBuiltinLanguages();
  const builtinRoot = globalThis as BrowserBuiltinGlobal;
  const quota = estimate.quota ?? null;
  const usage = estimate.usage ?? null;
  return {
    schemaVersion: "browser-device-qualification-v1",
    ...identity,
    operatingSystem: operatingSystem(current.userAgent),
    mobile: /Android|iPhone|iPad|iPod|Mobile/iu.test(current.userAgent),
    webGpu: Boolean(adapter),
    webAssembly: typeof WebAssembly !== "undefined",
    worker: typeof Worker !== "undefined",
    indexedDb: typeof indexedDB !== "undefined",
    opfs: typeof current.storage?.getDirectory === "function",
    storageQuota: quota,
    storageAvailable: quota === null || usage === null ? null : Math.max(0, quota - usage),
    hardwareConcurrency: Number.isFinite(current.hardwareConcurrency)
      ? current.hardwareConcurrency
      : null,
    deviceMemory: Number.isFinite(current.deviceMemory) ? Number(current.deviceMemory) : null,
    maxStorageBufferBindingSize: Number(adapter?.limits?.maxStorageBufferBindingSize ?? 0) || null,
    shaderF16: features.has("shader-f16"),
    subgroups: features.has("subgroups"),
    timestampQuery: features.has("timestamp-query"),
    webNn: Boolean(current.ml),
    chromeBuiltinAi: Boolean(builtinRoot.LanguageModel ?? builtinRoot.ai?.languageModel),
    chromeBuiltinLanguages: builtInLanguages,
    saveData: Boolean(current.connection?.saveData),
    effectiveConnectionType: current.connection?.effectiveType ?? null,
    qualifiedAt: now,
  };
}
