export type BrowserGPUQueuePriority = "interactive" | "normal" | "background";

type QueueItem<T> = {
  id: string;
  priority: BrowserGPUQueuePriority;
  enqueuedAt: number;
  timeoutMs: number;
  maxAttempts: 1 | 2;
  memoryBudgetMB: number;
  signal?: AbortSignal;
  execute: (input: {
    attempt: 1 | 2;
    recovery: boolean;
    signal: AbortSignal;
  }) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

export type BrowserGPUQueueSnapshot = {
  activeJobId: string | null;
  queuedJobs: number;
  workerRestartCount: number;
  gpuDeviceLostCount: number;
  rejectedForBackpressure: number;
  activeMemoryBudgetMB: number;
};

type BrowserGPUQueueOptions = {
  maxQueuedJobs?: number;
  maxMemoryMB?: number;
  onRecover?: () => Promise<void> | void;
  onIdleRelease?: () => Promise<void> | void;
  idleReleaseMs?: number;
};

const PRIORITY_RANK: Record<BrowserGPUQueuePriority, number> = {
  interactive: 3,
  normal: 2,
  background: 1,
};

function isRecoverable(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  return [
    "GPU_DEVICE_LOST",
    "BROWSER_WEBLLM_GPU_DEVICE_LOST",
    "BROWSER_WEBLLM_WORKER_CRASHED",
    "BROWSER_WEBLLM_WORKER_MESSAGE_FAILED",
  ].includes(code);
}

export class BrowserGPUQueue {
  private readonly queue: QueueItem<unknown>[] = [];
  private activeJobId: string | null = null;
  private activeMemoryBudgetMB = 0;
  private workerRestartCount = 0;
  private gpuDeviceLostCount = 0;
  private rejectedForBackpressure = 0;
  private idleReleaseTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private readonly options: BrowserGPUQueueOptions;

  constructor(options: BrowserGPUQueueOptions = {}) {
    this.options = options;
  }

  snapshot(): BrowserGPUQueueSnapshot {
    return {
      activeJobId: this.activeJobId,
      queuedJobs: this.queue.length,
      workerRestartCount: this.workerRestartCount,
      gpuDeviceLostCount: this.gpuDeviceLostCount,
      rejectedForBackpressure: this.rejectedForBackpressure,
      activeMemoryBudgetMB: this.activeMemoryBudgetMB,
    };
  }

  enqueue<T>(input: {
    id: string;
    priority?: BrowserGPUQueuePriority;
    timeoutMs?: number;
    maxAttempts?: 1 | 2;
    memoryBudgetMB: number;
    signal?: AbortSignal;
    execute: (input: {
      attempt: 1 | 2;
      recovery: boolean;
      signal: AbortSignal;
    }) => Promise<T>;
  }): Promise<T> {
    this.clearIdleReleaseTimer();
    const maxQueuedJobs = this.options.maxQueuedJobs ?? 8;
    if (this.queue.length >= maxQueuedJobs) {
      this.rejectedForBackpressure += 1;
      return Promise.reject(Object.assign(
        new Error("Browser GPU queue is full."),
        { code: "BROWSER_GPU_QUEUE_BACKPRESSURE" },
      ));
    }
    if (input.memoryBudgetMB > (this.options.maxMemoryMB ?? Number.POSITIVE_INFINITY)) {
      return Promise.reject(Object.assign(
        new Error("The requested model exceeds the browser GPU memory budget."),
        { code: "BROWSER_GPU_MEMORY_BUDGET_EXCEEDED" },
      ));
    }
    if (input.signal?.aborted) {
      return Promise.reject(new DOMException("操作已取消。", "AbortError"));
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id: input.id,
        priority: input.priority ?? "normal",
        enqueuedAt: performance.now(),
        timeoutMs: input.timeoutMs ?? 120_000,
        maxAttempts: input.maxAttempts === 1 ? 1 : 2,
        memoryBudgetMB: input.memoryBudgetMB,
        signal: input.signal,
        execute: input.execute,
        resolve,
        reject,
      } as QueueItem<unknown>);
      this.queue.sort((left, right) => (
        PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority]
        || left.enqueuedAt - right.enqueuedAt
      ));
      void this.drain();
    });
  }

  private async drain() {
    if (this.activeJobId) return;
    const item = this.queue.shift();
    if (!item) {
      const delay = this.options.idleReleaseMs ?? 90_000;
      this.clearIdleReleaseTimer();
      this.idleReleaseTimer = globalThis.setTimeout(() => {
        this.idleReleaseTimer = null;
        if (!this.activeJobId && !this.queue.length) {
          void Promise.resolve(this.options.onIdleRelease?.()).catch(() => undefined);
        }
      }, delay);
      return;
    }
    this.clearIdleReleaseTimer();
    if (item.signal?.aborted) {
      item.reject(new DOMException("Browser GPU job was cancelled before execution.", "AbortError"));
      void this.drain();
      return;
    }
    this.activeJobId = item.id;
    this.activeMemoryBudgetMB = item.memoryBudgetMB;
    const executionController = new AbortController();
    let abortHandler: (() => void) | null = null;
    let publicAbortError: DOMException | null = null;
    let publicTimeoutError: (Error & { code: string }) | null = null;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const abortPromise = new Promise<never>((_, reject) => {
      if (!item.signal) return;
      abortHandler = () => {
        publicAbortError = new DOMException("操作已取消。", "AbortError");
        reject(publicAbortError);
        executionController.abort();
      };
      item.signal.addEventListener("abort", abortHandler, { once: true });
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        publicTimeoutError = Object.assign(
          new Error("Browser GPU job exceeded its deadline."),
          { code: "BROWSER_GPU_JOB_TIMEOUT" },
        );
        reject(publicTimeoutError);
        executionController.abort();
      }, item.timeoutMs);
    });
    try {
      let attempt: 1 | 2 = 1;
      let recovery = false;
      while (true) {
        try {
          const result = await Promise.race([
            item.execute({ attempt, recovery, signal: executionController.signal }),
            abortPromise,
            timeoutPromise,
          ]);
          item.resolve(result);
          break;
        } catch (error) {
          if (isRecoverable(error)) {
            const code = String((error as { code?: string }).code ?? "");
            if (code.includes("GPU_DEVICE_LOST")) this.gpuDeviceLostCount += 1;
            this.workerRestartCount += 1;
            const recoveryOperation = Promise.resolve().then(
              () => this.options.onRecover?.(),
            );
            if (attempt >= item.maxAttempts) {
              // Proof-bound Closed Browser calls may not add a transparent
              // fourth inference. Return the original failure, but keep the
              // queue lease fenced until the crashed worker has been reset.
              item.reject(error);
              try {
                await recoveryOperation;
              } catch {
                // The original recoverable failure remains the public result.
              }
              break;
            }
            try {
              await Promise.race([
                recoveryOperation,
                abortPromise,
                timeoutPromise,
              ]);
            } catch (recoveryError) {
              if (
                recoveryError === publicAbortError
                || recoveryError === publicTimeoutError
              ) {
                // The caller stops at its own deadline, but the active lease
                // remains fenced until the in-flight recovery has settled.
                item.reject(recoveryError);
                try {
                  await recoveryOperation;
                } catch {
                  // The timeout/cancellation remains the public result.
                }
                break;
              }
              item.reject(Object.assign(
                new Error("Browser GPU recovery failed."),
                { code: "BROWSER_GPU_RECOVERY_FAILED", cause: recoveryError },
              ));
              break;
            }
            attempt = 2;
            recovery = true;
            continue;
          }
          const code = String((error as { code?: string } | null)?.code ?? "");
          const aborted = error instanceof DOMException && error.name === "AbortError";
          if (code === "BROWSER_GPU_JOB_TIMEOUT" || aborted) {
            // Settle the public job before cleanup. A wedged WebLLM unload must
            // never extend the caller-visible timeout/cancellation deadline.
            // The queue remains occupied until recovery finishes, so the next
            // job cannot overlap the worker that is being force-reset.
            item.reject(error);
            try {
              await this.options.onRecover?.();
            } catch {
              // The original timeout/cancellation remains the user-visible result.
            }
            break;
          }
          item.reject(error);
          break;
        }
      }
    } finally {
      if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
      if (item.signal && abortHandler) {
        item.signal.removeEventListener("abort", abortHandler);
      }
      this.activeJobId = null;
      this.activeMemoryBudgetMB = 0;
      void this.drain();
    }
  }

  private clearIdleReleaseTimer() {
    if (this.idleReleaseTimer !== null) {
      globalThis.clearTimeout(this.idleReleaseTimer);
      this.idleReleaseTimer = null;
    }
  }
}
