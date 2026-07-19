import type { PlatformAIRequest, PlatformAIResult, PlatformProviderSnapshot, PlatformRouterDecision } from "../../router/platform-types";

export function deterministicProviderSnapshot(): PlatformProviderSnapshot { return { id: "deterministic-local", status: "ready", capabilities: ["text","structured","offline"], modelId: "traditional-chinese-story-rules-v1", maxContext: 12000, local: true, requiresInternet: false }; }

export async function runDeterministicLocal(request: PlatformAIRequest, decision: PlatformRouterDecision): Promise<PlatformAIResult> {
  const started = performance.now(), input = request.input.trim(), facts = request.context.filter(Boolean).slice(0, 4);
  const content = input || facts.length ? `本機故事建議：${input || "延續目前故事"}\n\n${facts.length ? `我會先遵守這些已知內容：${facts.join("；").slice(0, 480)}。` : "目前設定仍較少，可以先保持空白，或補充主角與核心想法。"}\n\n下一步應讓主角採取可見行動，讓選擇產生後果，並保留一個能延續到下一場的問題。` : "目前故事資料還不夠。你可以先保持空白，或補充主角與核心想法。";
  return { requestId: request.requestId, providerId: "deterministic-local", modelId: "traditional-chinese-story-rules-v1", content, candidateOnly: true, externalRequest: false, dataLeavesDevice: false, elapsedMs: Math.round(performance.now() - started), provenance: decision };
}
