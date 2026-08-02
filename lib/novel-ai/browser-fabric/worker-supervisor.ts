export type BrowserFabricWorkerLike = {
  terminate(): void;
  postMessage(value: unknown): void;
  addEventListener(type: "message" | "error", listener: EventListener): void;
  removeEventListener(type: "message" | "error", listener: EventListener): void;
};

export class BrowserFabricWorkerSupervisor {
  private worker: BrowserFabricWorkerLike | null = null;
  private restartCount = 0;
  private heartbeatAt = 0;
  private readonly factory: () => BrowserFabricWorkerLike;
  private readonly maximumRestarts: number;

  constructor(
    factory: () => BrowserFabricWorkerLike,
    maximumRestarts = 1,
  ) {
    this.factory = factory;
    this.maximumRestarts = maximumRestarts;
  }

  start() {
    if (this.worker) return this.worker;
    this.worker = this.factory();
    this.heartbeatAt = Date.now();
    return this.worker;
  }

  heartbeat() {
    this.heartbeatAt = Date.now();
  }

  async recover(releaseGpuLock?: () => void | Promise<void>) {
    this.worker?.terminate();
    this.worker = null;
    await releaseGpuLock?.();
    if (this.restartCount >= this.maximumRestarts) {
      throw Object.assign(new Error("Browser worker recovery budget exhausted."), {
        code: "BROWSER_WORKER_RECOVERY_EXHAUSTED",
      });
    }
    this.restartCount += 1;
    return this.start();
  }

  stop() {
    this.worker?.terminate();
    this.worker = null;
  }

  snapshot() {
    return {
      running: Boolean(this.worker),
      restartCount: this.restartCount,
      heartbeatAgeMs: this.heartbeatAt ? Math.max(0, Date.now() - this.heartbeatAt) : null,
    };
  }
}
