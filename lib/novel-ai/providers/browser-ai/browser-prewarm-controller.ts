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
  /** Resolves after the real Worker warmup settles, not when idle work is queued. */
  completion: Promise<BrowserPrewarmCompletion>;
  /** Releases only this caller's lease. Shared work stops when no caller remains. */
  cancel: () => void;
};

export type BrowserPrewarmCompletion = {
  status: "warmed" | "already_warm" | "not_installed" | "failed" | "aborted";
  reasonCode: string;
};

type PrewarmLease = { signal?: AbortSignal; onAbort?: () => void };

type ActiveBrowserPrewarm = {
  key: string;
  controller: AbortController;
  leases: Map<symbol, PrewarmLease>;
  cancelIdle: () => void;
  settled: boolean;
  completion: Promise<BrowserPrewarmCompletion>;
  resolve: (value: BrowserPrewarmCompletion) => void;
};

let activeBrowserPrewarm: ActiveBrowserPrewarm | null = null;

export type BrowserPrewarmControllerDependencies = {
  browserAvailable: () => boolean;
  visibilityState: () => DocumentVisibilityState;
  navigator: () => NavigatorWithPower;
  snapshot: typeof browserWebLLMRuntimeSnapshot;
  prewarm: typeof prewarmBrowserWebLLMModel;
  scheduleIdle: (run: () => void) => () => void;
};

const DEFAULT_DEPENDENCIES: BrowserPrewarmControllerDependencies = {
  browserAvailable: () => typeof window !== "undefined" && typeof navigator !== "undefined",
  visibilityState: () => document.visibilityState,
  navigator: () => navigator as NavigatorWithPower,
  snapshot: browserWebLLMRuntimeSnapshot,
  prewarm: prewarmBrowserWebLLMModel,
  scheduleIdle: (run) => {
    const scope = idleScope();
    const usedIdleCallback = typeof scope.requestIdleCallback === "function";
    const handle = usedIdleCallback
      ? scope.requestIdleCallback!(run, { timeout: 4_000 })
      : window.setTimeout(run, 600);
    return () => {
      if (usedIdleCallback && scope.cancelIdleCallback) scope.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  },
};

function immediateDecision(
  reasonCode: string,
  status: BrowserPrewarmCompletion["status"],
): BrowserPrewarmDecision {
  return {
    scheduled: false,
    reasonCode,
    completion: Promise.resolve({ status, reasonCode }),
    cancel: () => {},
  };
}

function idleScope() {
  return window as Window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
}

function finishBrowserPrewarm(
  record: ActiveBrowserPrewarm,
  completion: BrowserPrewarmCompletion,
) {
  if (record.settled) return;
  record.settled = true;
  for (const lease of record.leases.values()) {
    if (lease.signal && lease.onAbort) {
      lease.signal.removeEventListener("abort", lease.onAbort);
    }
  }
  record.leases.clear();
  record.resolve(completion);
  if (activeBrowserPrewarm === record) activeBrowserPrewarm = null;
}

function cancelScheduledIdle(record: ActiveBrowserPrewarm) {
  record.cancelIdle();
}

function stopBrowserPrewarm(record: ActiveBrowserPrewarm, reasonCode: string) {
  if (record.settled) return;
  cancelScheduledIdle(record);
  record.controller.abort(reasonCode);
  finishBrowserPrewarm(record, { status: "aborted", reasonCode });
}

function releaseLease(record: ActiveBrowserPrewarm, token: symbol) {
  const lease = record.leases.get(token);
  if (!lease) return;
  if (lease.signal && lease.onAbort) {
    lease.signal.removeEventListener("abort", lease.onAbort);
  }
  record.leases.delete(token);
  if (!record.settled && record.leases.size === 0) {
    stopBrowserPrewarm(record, "PREWARM_NO_ACTIVE_CONSUMERS");
  }
}

function decisionForActive(
  record: ActiveBrowserPrewarm,
  signal?: AbortSignal,
  reasonCode = "PREWARM_ALREADY_SCHEDULED",
): BrowserPrewarmDecision {
  if (signal?.aborted) return immediateDecision("PREWARM_ABORTED", "aborted");
  const token = Symbol("browser-prewarm-consumer");
  const lease: PrewarmLease = { signal };
  let resolveLeaseAbort!: (value: BrowserPrewarmCompletion) => void;
  const leaseAbort = new Promise<BrowserPrewarmCompletion>((resolve) => {
    resolveLeaseAbort = resolve;
  });
  let leaseReleased = false;
  const onAbort = () => {
    if (leaseReleased) return;
    leaseReleased = true;
    resolveLeaseAbort({ status: "aborted", reasonCode: "PREWARM_ABORTED" });
    releaseLease(record, token);
  };
  lease.onAbort = onAbort;
  record.leases.set(token, lease);
  signal?.addEventListener("abort", onAbort, { once: true });
  return {
    scheduled: true,
    reasonCode,
    completion: Promise.race([record.completion, leaseAbort]),
    cancel: onAbort,
  };
}

export async function scheduleBrowserModelPrewarm(input: {
  policy: BrowserComputePolicy;
  powerMode?: "normal" | "save";
  signal?: AbortSignal;
}, dependencies: BrowserPrewarmControllerDependencies = DEFAULT_DEPENDENCIES): Promise<BrowserPrewarmDecision> {
  if (input.signal?.aborted) return immediateDecision("PREWARM_ABORTED", "aborted");
  if (input.policy !== "browser-first") {
    return immediateDecision("PREWARM_POLICY_DISABLED", "aborted");
  }
  if (input.powerMode === "save") {
    return immediateDecision("PREWARM_POWER_SAVE", "aborted");
  }
  if (!dependencies.browserAvailable()) {
    return immediateDecision("PREWARM_BROWSER_REQUIRED", "aborted");
  }
  if (dependencies.visibilityState() === "hidden") {
    return immediateDecision("PREWARM_TAB_HIDDEN", "aborted");
  }
  const current = dependencies.navigator();
  if (current.connection?.saveData || current.connection?.type === "cellular") {
    return immediateDecision("PREWARM_METERED_CONNECTION", "aborted");
  }
  const battery = await current.getBattery?.().catch(() => null);
  if (battery && !battery.charging && battery.level < 0.3) {
    return immediateDecision("PREWARM_LOW_BATTERY", "aborted");
  }
  const snapshot = await dependencies.snapshot();
  if (input.signal?.aborted) {
    return immediateDecision("PREWARM_ABORTED", "aborted");
  }
  const selected = snapshot.models.find((model) => model.modelId === snapshot.selectedModelId);
  if (
    !selected
    || selected.installStatus !== "ready"
    || !selected.cacheVerified
    || !selected.shardIntegrityVerified
    || !selected.cacheComplete
    || !selected.allowed
    || !selected.generationVerified
  ) {
    return immediateDecision("PREWARM_MODEL_NOT_INSTALLED", "not_installed");
  }
  if (snapshot.performance.engineWarm && snapshot.activeModelId === selected.modelId) {
    return immediateDecision("PREWARM_ALREADY_WARM", "already_warm");
  }

  const key = `${selected.modelId}:${selected.modelDigest}:${selected.metadataRevision}`;
  if (activeBrowserPrewarm?.key === key && !activeBrowserPrewarm.settled) {
    return decisionForActive(activeBrowserPrewarm, input.signal);
  }
  if (activeBrowserPrewarm && !activeBrowserPrewarm.settled) {
    stopBrowserPrewarm(activeBrowserPrewarm, "PREWARM_MODEL_IDENTITY_CHANGED");
  }

  let resolveCompletion!: (value: BrowserPrewarmCompletion) => void;
  const completion = new Promise<BrowserPrewarmCompletion>((resolve) => {
    resolveCompletion = resolve;
  });
  const controller = new AbortController();
  const record: ActiveBrowserPrewarm = {
    key,
    controller,
    leases: new Map(),
    cancelIdle: () => {},
    settled: false,
    completion,
    resolve: resolveCompletion,
  };
  activeBrowserPrewarm = record;
  const decision = decisionForActive(record, input.signal, "PREWARM_IDLE_SCHEDULED");
  const run = () => {
    if (record.controller.signal.aborted || record.settled) return;
    void dependencies.prewarm(record.controller.signal)
      .then(() => finishBrowserPrewarm(record, {
        status: "warmed",
        reasonCode: "PREWARM_WARMED",
      }))
      .catch(() => finishBrowserPrewarm(record, {
        status: record.controller.signal.aborted ? "aborted" : "failed",
        reasonCode: record.controller.signal.aborted
          ? "PREWARM_ABORTED"
          : "PREWARM_BROWSER_FAILED",
      }));
  };
  record.cancelIdle = dependencies.scheduleIdle(run);
  return decision;
}
