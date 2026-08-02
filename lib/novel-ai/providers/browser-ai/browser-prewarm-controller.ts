import type { BrowserComputePolicy } from "./browser-task-eligibility";
import {
  browserWebLLMRuntimeSnapshot,
  prewarmBrowserWebLLMModel,
} from "./browser-webllm-runtime";

type NavigatorWithPower = Navigator & {
  connection?: { saveData?: boolean; type?: string; effectiveType?: string };
  getBattery?: () => Promise<{ charging: boolean; level: number }>;
};

export type BrowserPrewarmDecision = {
  scheduled: boolean;
  reasonCode: string;
  cancel: () => void;
};

export async function scheduleBrowserModelPrewarm(input: {
  policy: BrowserComputePolicy;
  powerMode?: "normal" | "save";
  signal?: AbortSignal;
}): Promise<BrowserPrewarmDecision> {
  if (input.signal?.aborted) {
    return { scheduled: false, reasonCode: "PREWARM_ABORTED", cancel: () => {} };
  }
  if (input.policy !== "browser-first") {
    return { scheduled: false, reasonCode: "PREWARM_POLICY_DISABLED", cancel: () => {} };
  }
  if (input.powerMode === "save") {
    return { scheduled: false, reasonCode: "PREWARM_POWER_SAVE", cancel: () => {} };
  }
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { scheduled: false, reasonCode: "PREWARM_BROWSER_REQUIRED", cancel: () => {} };
  }
  if (document.visibilityState === "hidden") {
    return { scheduled: false, reasonCode: "PREWARM_TAB_HIDDEN", cancel: () => {} };
  }
  const current = navigator as NavigatorWithPower;
  if (current.connection?.saveData || current.connection?.type === "cellular") {
    return { scheduled: false, reasonCode: "PREWARM_METERED_CONNECTION", cancel: () => {} };
  }
  const battery = await current.getBattery?.().catch(() => null);
  if (battery && !battery.charging && battery.level < 0.3) {
    return { scheduled: false, reasonCode: "PREWARM_LOW_BATTERY", cancel: () => {} };
  }
  const snapshot = await browserWebLLMRuntimeSnapshot();
  if (input.signal?.aborted) {
    return { scheduled: false, reasonCode: "PREWARM_ABORTED", cancel: () => {} };
  }
  const selected = snapshot.models.find((model) => model.modelId === snapshot.selectedModelId);
  if (!selected || selected.installStatus !== "ready" || !selected.cacheVerified) {
    return { scheduled: false, reasonCode: "PREWARM_MODEL_NOT_INSTALLED", cancel: () => {} };
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  const run = () => {
    if (!controller.signal.aborted) {
      void prewarmBrowserWebLLMModel(controller.signal)
        .catch(() => undefined)
        .finally(() => input.signal?.removeEventListener("abort", abort));
    }
  };
  const scope = window as Window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  const usedIdleCallback = typeof scope.requestIdleCallback === "function";
  const idleHandle = usedIdleCallback
    ? scope.requestIdleCallback(run, { timeout: 4_000 })
    : window.setTimeout(run, 600);
  return {
    scheduled: true,
    reasonCode: "PREWARM_IDLE_SCHEDULED",
    cancel: () => {
      controller.abort();
      if (usedIdleCallback && scope.cancelIdleCallback) {
        scope.cancelIdleCallback(idleHandle);
      } else {
        window.clearTimeout(idleHandle);
      }
      input.signal?.removeEventListener("abort", abort);
    },
  };
}
