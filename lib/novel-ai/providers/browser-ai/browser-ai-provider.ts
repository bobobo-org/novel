import type { PlatformAIRequest, PlatformAIResult, PlatformProviderSnapshot, PlatformRouterDecision } from "../../router/platform-types";

export type BrowserAIManifest = { id: string; version: string; files: Array<{ url: string; bytes: number; sha256: string }>; minMemoryGb: number; requiresWebGpu: boolean };
export type BrowserAICapability = { webGpu: boolean; wasm: boolean; worker: boolean; storageQuota: number | null; storageUsage: number | null; status: PlatformProviderSnapshot["status"]; reason: string };

export async function detectBrowserAI(): Promise<BrowserAICapability> {
  if (typeof window === "undefined") return { webGpu: false, wasm: false, worker: false, storageQuota: null, storageUsage: null, status: "runtime_unavailable", reason: "browser_required" };
  const webGpu = "gpu" in navigator, wasm = typeof WebAssembly !== "undefined", worker = typeof Worker !== "undefined", estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
  return { webGpu, wasm, worker, storageQuota: estimate.quota ?? null, storageUsage: estimate.usage ?? null, status: webGpu || wasm ? "runtime_not_installed" : "runtime_unavailable", reason: webGpu || wasm ? "model_runtime_not_installed" : "device_not_supported" };
}

export async function browserProviderSnapshot(): Promise<PlatformProviderSnapshot> { const capability = await detectBrowserAI(); return { id: "browser-ai", status: capability.status, capabilities: ["text","structured","streaming","offline"], modelId: null, maxContext: 0, local: true, requiresInternet: false }; }

export class BrowserAIProvider {
  async generate(_request: PlatformAIRequest, _decision: PlatformRouterDecision): Promise<PlatformAIResult> { throw Object.assign(new Error("瀏覽器 AI 模型尚未安裝。"), { code: "BROWSER_AI_RUNTIME_NOT_INSTALLED", retryable: true }); }
}
