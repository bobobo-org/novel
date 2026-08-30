import type {
  scheduleBrowserModelPrewarm,
  BrowserPrewarmDecision,
} from "../providers/browser-ai/browser-prewarm-controller";
import type { prewarmRememberedLocalClosedAI } from "./studio-closed-ai";

export type FrontdoorClosedAIPrewarmResult = {
  browser: BrowserPrewarmDecision["reasonCode"];
  local: "warmed" | "not_verified" | "not_needed" | "failed";
};

type FrontdoorPrewarmDependencies = {
  scheduleBrowser: typeof scheduleBrowserModelPrewarm;
  prewarmLocal: typeof prewarmRememberedLocalClosedAI;
};

const DEFAULT_DEPENDENCIES: FrontdoorPrewarmDependencies = {
  scheduleBrowser: async (input) => {
    const { scheduleBrowserModelPrewarm } = await import(
      "../providers/browser-ai/browser-prewarm-controller"
    );
    return scheduleBrowserModelPrewarm(input);
  },
  prewarmLocal: async (signal) => {
    const { prewarmRememberedLocalClosedAI } = await import("./studio-closed-ai");
    return prewarmRememberedLocalClosedAI(signal);
  },
};

/**
 * Warms only an already-installed, already-authorised Closed AI runtime.
 * It never installs a model, never opens Private Hub, and never retries.  The
 * caller owns visibility/page-lifecycle cancellation.
 */
export function prewarmClosedAIFromFrontdoor(
  input: {
    browserBackgroundPrewarmAuthorized: boolean;
    rememberedLocalInferenceVerified: boolean;
    signal: AbortSignal;
  },
  dependencies: FrontdoorPrewarmDependencies = DEFAULT_DEPENDENCIES,
) {
  if (input.signal.aborted) {
    return Promise.resolve<FrontdoorClosedAIPrewarmResult>({
      browser: "PREWARM_ABORTED",
      local: "not_needed",
    });
  }
  return (async (): Promise<FrontdoorClosedAIPrewarmResult> => {
    let browserReason = input.browserBackgroundPrewarmAuthorized
      ? "PREWARM_BROWSER_FAILED"
      : "PREWARM_NOT_AUTHORIZED";
    if (input.browserBackgroundPrewarmAuthorized) {
      try {
        const decision = await dependencies.scheduleBrowser({
          policy: "browser-first",
          signal: input.signal,
        });
        browserReason = decision.reasonCode;
        if (input.signal.aborted) {
          return { browser: "PREWARM_ABORTED", local: "not_needed" };
        }
        const completion = await decision.completion;
        browserReason = completion.reasonCode;
        if (completion.status === "warmed" || completion.status === "already_warm") {
          return { browser: browserReason, local: "not_needed" };
        }
        if (completion.status === "aborted") {
          return { browser: browserReason, local: "not_needed" };
        }
      } catch {
        if (input.signal.aborted) {
          return { browser: "PREWARM_ABORTED", local: "not_needed" };
        }
      }
    }

    // Power, metered-network, hidden-tab and explicit abort decisions apply to
    // the whole front-door warmup.  Local verification is attempted only when
    // Browser AI is actually absent/failed and this tab already owns a verified
    // Local Ollama inference session.
    const mayTryVerifiedLocal = browserReason === "PREWARM_MODEL_NOT_INSTALLED"
      || browserReason === "PREWARM_BROWSER_FAILED"
      || browserReason === "PREWARM_NOT_AUTHORIZED";
    if (!mayTryVerifiedLocal) {
      return { browser: browserReason, local: "not_needed" };
    }
    if (!input.rememberedLocalInferenceVerified) {
      return { browser: browserReason, local: "not_verified" };
    }
    const localWarmed = await dependencies.prewarmLocal(input.signal);
    return {
      browser: browserReason,
      local: localWarmed ? "warmed" : "failed",
    };
  })();
}
