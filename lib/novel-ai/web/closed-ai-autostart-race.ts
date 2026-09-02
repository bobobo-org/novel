export type ClosedAiAutostartRoute = "browser" | "local";

export const CLOSED_AI_AUTOSTART_RACE_TIMEOUT_MS = 65_000;

export interface ClosedAiAutostartRaceResult<T> {
  winner: ClosedAiAutostartRoute | null;
  result: T | null;
  error: unknown | null;
}

interface ClosedAiAutostartBranchResult<T> {
  source: ClosedAiAutostartRoute;
  attempted: boolean;
  result: T | null;
  error: unknown | null;
}

/**
 * Races the safe Browser bootstrap against an already-running Local bridge.
 * Browser bootstrap never downloads weights; Local readiness is only accepted
 * after a fresh routed-state inspection. A failed or non-routable first branch
 * cannot hide a later verified route from the other branch.
 */
export async function raceClosedAiAutostartRoutes<T>(input: {
  browserBootstrap: Promise<T>;
  localConnection: Promise<unknown> | null;
  inspectAfterLocal: () => Promise<T>;
  isRoutable: (result: T | null | undefined) => boolean;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<ClosedAiAutostartRaceResult<T> | null> {
  let raceSettled = false;
  const browserBranch: Promise<ClosedAiAutostartBranchResult<T>> = input.browserBootstrap.then(
    (result) => ({
      source: "browser",
      attempted: true,
      result,
      error: null,
    }),
    (error: unknown) => ({
      source: "browser",
      attempted: true,
      result: null,
      error,
    }),
  );
  const localBranch: Promise<ClosedAiAutostartBranchResult<T>> = input.localConnection
    ? input.localConnection.then(async () => {
        if (input.signal.aborted || raceSettled) {
          return {
            source: "local" as const,
            attempted: true,
            result: null,
            error: null,
          };
        }
        try {
          return {
            source: "local" as const,
            attempted: true,
            result: await input.inspectAfterLocal(),
            error: null,
          };
        } catch (error) {
          return {
            source: "local" as const,
            attempted: true,
            result: null,
            error,
          };
        }
      }, (error: unknown) => ({
        source: "local" as const,
        attempted: true,
        result: null,
        error,
      }))
    : Promise.resolve({
        source: "local" as const,
        attempted: false,
        result: null,
        error: null,
      });

  return new Promise((resolve) => {
    const branches = new Map<ClosedAiAutostartRoute, ClosedAiAutostartBranchResult<T>>();
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (result: ClosedAiAutostartRaceResult<T> | null) => {
      if (raceSettled) return;
      raceSettled = true;
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
      input.signal.removeEventListener("abort", handleAbort);
      resolve(result);
    };
    const handleAbort = () => settle(null);
    const handleDeadline = () => {
      const browser = branches.get("browser");
      const local = branches.get("local");
      const knownError = (local?.attempted ? local.error : null) ?? browser?.error ?? null;
      settle({
        winner: null,
        result: local?.result ?? browser?.result ?? null,
        error: knownError ?? Object.assign(
          new Error("閉端 AI 自動啟動競速已明確逾時。"),
          { code: "REQUEST_TIMEOUT" },
        ),
      });
    };
    const handleBranch = (branch: ClosedAiAutostartBranchResult<T>) => {
      if (raceSettled || input.signal.aborted) return;
      branches.set(branch.source, branch);
      if (branch.result !== null && input.isRoutable(branch.result)) {
        settle({
          winner: branch.source,
          result: branch.result,
          error: null,
        });
        return;
      }
      if (branches.size < 2) return;
      const browser = branches.get("browser");
      const local = branches.get("local");
      // The post-connection Local inspection is the freshest combined router
      // snapshot. Prefer it when present, but prefer a Local connection error
      // on official origins because that is the actionable autostart failure.
      settle({
        winner: null,
        result: local?.result ?? browser?.result ?? null,
        error: (local?.attempted ? local.error : null) ?? browser?.error ?? null,
      });
    };

    if (input.signal.aborted) {
      settle(null);
      return;
    }
    input.signal.addEventListener("abort", handleAbort, { once: true });
    deadlineTimer = setTimeout(
      handleDeadline,
      input.timeoutMs ?? CLOSED_AI_AUTOSTART_RACE_TIMEOUT_MS,
    );
    void browserBranch.then(handleBranch);
    void localBranch.then(handleBranch);
  });
}
