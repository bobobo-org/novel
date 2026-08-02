export type BrowserFabricQueuePriority = "interactive" | "foreground" | "background";

type QueueItem<T> = {
  id: string;
  priority: number;
  enqueuedAt: number;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
};

const PRIORITY: Record<BrowserFabricQueuePriority, number> = {
  interactive: 3,
  foreground: 2,
  background: 1,
};

export class BrowserFabricQueue {
  private readonly pending: QueueItem<unknown>[] = [];
  private active = 0;
  private readonly concurrency: number;
  private readonly maxPending: number;

  constructor(
    concurrency = 1,
    maxPending = 24,
  ) {
    this.concurrency = concurrency;
    this.maxPending = maxPending;
  }

  get snapshot() {
    return { active: this.active, queued: this.pending.length };
  }

  enqueue<T>(input: {
    id: string;
    priority?: BrowserFabricQueuePriority;
    signal?: AbortSignal;
    run: () => Promise<T>;
  }): Promise<T> {
    if (this.pending.length >= this.maxPending) {
      return Promise.reject(Object.assign(new Error("Browser Fabric queue backpressure"), {
        code: "BROWSER_FABRIC_QUEUE_BACKPRESSURE",
      }));
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        id: input.id,
        priority: PRIORITY[input.priority ?? "foreground"],
        enqueuedAt: Date.now(),
        run: input.run,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal: input.signal,
      });
      this.pending.sort((left, right) => right.priority - left.priority || left.enqueuedAt - right.enqueuedAt);
      this.drain();
    });
  }

  cancel(id: string) {
    const index = this.pending.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const [item] = this.pending.splice(index, 1);
    item.reject(Object.assign(new DOMException("Aborted", "AbortError"), {
      code: "BROWSER_FABRIC_CANCELLED",
    }));
    return true;
  }

  private drain() {
    while (this.active < this.concurrency && this.pending.length) {
      const item = this.pending.shift()!;
      if (item.signal?.aborted) {
        item.reject(new DOMException("Aborted", "AbortError"));
        continue;
      }
      this.active += 1;
      item.run().then(item.resolve, item.reject).finally(() => {
        this.active -= 1;
        this.drain();
      });
    }
  }
}

export const browserFabricQueue = new BrowserFabricQueue(1, 24);
