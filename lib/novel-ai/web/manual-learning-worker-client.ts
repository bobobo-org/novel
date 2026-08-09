import {
  MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
  type ManualLearningBatchItem,
  type ManualLearningFilePreparer,
  type ManualLearningFileProgress,
  type ManualLearningPreparedFile,
  type ManualLearningPrepareFileOptions,
  type ManualLearningWorkerRequest,
  type ManualLearningWorkerResponse,
} from "./manual-learning-import-preparation";

type WorkerMessageListener = (event: MessageEvent<ManualLearningWorkerResponse>) => void;
type WorkerErrorListener = (event: ErrorEvent) => void;

export type ManualLearningWorkerLike = {
  postMessage(message: ManualLearningWorkerRequest): void;
  terminate(): void;
  addEventListener(type: "message", listener: WorkerMessageListener): void;
  addEventListener(type: "error", listener: WorkerErrorListener): void;
  removeEventListener(type: "message", listener: WorkerMessageListener): void;
  removeEventListener(type: "error", listener: WorkerErrorListener): void;
};

export type ManualLearningWorkerLifecycle = {
  schemaVersion: "manual-learning-worker-lifecycle-v1";
  requestId: string;
  phase: "created" | "running" | "cancelled" | "completed" | "failed" | "disposed";
  workerCreated: boolean;
  workerTerminated: boolean;
  fileReferencesReleased: boolean;
  temporaryResultsReleased: boolean;
  objectUrlsCreated: 0;
  objectUrlsRevoked: 0;
  lateResultsRejected: number;
  rawContentRetained: false;
  dataLeftDevice: false;
};

export type ManualLearningWorkerClientOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ManualLearningFileProgress) => void;
  workerFactory?: () => ManualLearningWorkerLike;
  onLifecycle?: (lifecycle: Readonly<ManualLearningWorkerLifecycle>) => void;
};

function workerError(code: string, message = code) {
  return Object.assign(new Error(message), { code });
}

function defaultWorkerFactory(): ManualLearningWorkerLike {
  return new Worker(
    new URL(
      "/generated/manual-learning-worker.js?v=manual-learning-worker-protocol-v2",
      globalThis.location.origin,
    ),
    { type: "module", name: "novel-manual-learning-parser" },
  ) as unknown as ManualLearningWorkerLike;
}

export class ManualLearningWorkerClient {
  private worker: ManualLearningWorkerLike | null = null;
  private files: readonly File[] | null = null;
  private resultItems: ManualLearningBatchItem[] | null = null;
  private preparedResult: ManualLearningPreparedFile | null = null;
  private operation: "extract" | "prepare" | null = null;
  private settled = false;
  private disposed = false;
  private resolve: ((items: ManualLearningBatchItem[]) => void) | null = null;
  private resolvePrepared: ((prepared: ManualLearningPreparedFile) => void) | null = null;
  private reject: ((error: Error) => void) | null = null;
  private removeAbortListener: (() => void) | null = null;
  private readonly workerFactory: () => ManualLearningWorkerLike;
  private readonly onLifecycle?: ManualLearningWorkerClientOptions["onLifecycle"];
  private readonly onProgress?: ManualLearningWorkerClientOptions["onProgress"];
  private readonly requestId: string;
  private lifecycle: ManualLearningWorkerLifecycle;

  constructor(
    requestId = `manual-learning:${crypto.randomUUID()}`,
    options: ManualLearningWorkerClientOptions = {},
  ) {
    this.requestId = requestId;
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.onLifecycle = options.onLifecycle;
    this.onProgress = options.onProgress;
    this.lifecycle = {
      schemaVersion: "manual-learning-worker-lifecycle-v1",
      requestId,
      phase: "created",
      workerCreated: false,
      workerTerminated: false,
      fileReferencesReleased: false,
      temporaryResultsReleased: false,
      objectUrlsCreated: 0,
      objectUrlsRevoked: 0,
      lateResultsRejected: 0,
      rawContentRetained: false,
      dataLeftDevice: false,
    };
    if (options.signal) {
      const abort = () => this.cancel("LEARNING_FILE_CANCELLED");
      options.signal.addEventListener("abort", abort, { once: true });
      this.removeAbortListener = () => options.signal?.removeEventListener("abort", abort);
      if (options.signal.aborted) abort();
    }
    this.publishLifecycle();
  }

  private publishLifecycle() {
    this.onLifecycle?.(structuredClone(this.lifecycle));
  }

  private updateLifecycle(patch: Partial<ManualLearningWorkerLifecycle>) {
    this.lifecycle = { ...this.lifecycle, ...patch };
    this.publishLifecycle();
  }

  private fail(code: string, message = code) {
    this.settled = true;
    this.updateLifecycle({ phase: "failed" });
    this.reject?.(workerError(code, message));
    this.dispose();
  }

  private readonly onMessage: WorkerMessageListener = (event) => {
    const response = event.data;
    if (response.requestId !== this.requestId || this.disposed || this.settled) {
      this.updateLifecycle({ lateResultsRejected: this.lifecycle.lateResultsRejected + 1 });
      return;
    }
    if (response.protocolVersion !== MANUAL_LEARNING_WORKER_PROTOCOL_VERSION) {
      this.fail("LEARNING_WORKER_PROTOCOL_MISMATCH");
      return;
    }
    if (response.type === "progress") {
      this.onProgress?.(response.progress);
      return;
    }
    if (response.type === "completed") {
      if (this.operation !== "extract") {
        this.fail("LEARNING_WORKER_PROTOCOL_MISMATCH");
        return;
      }
      this.resultItems = response.items;
      this.settled = true;
      this.updateLifecycle({ phase: "completed" });
      this.resolve?.(response.items);
      this.dispose();
      return;
    }
    if (response.type === "prepared") {
      if (this.operation !== "prepare") {
        this.fail("LEARNING_WORKER_PROTOCOL_MISMATCH");
        return;
      }
      this.preparedResult = response.prepared;
      this.settled = true;
      this.updateLifecycle({ phase: "completed" });
      this.resolvePrepared?.(response.prepared);
      this.dispose();
      return;
    }
    if (response.type === "failed" || response.type === "cancelled") {
      this.settled = true;
      const code = response.type === "failed" ? response.errorCode : "LEARNING_FILE_CANCELLED";
      this.updateLifecycle({ phase: response.type === "cancelled" ? "cancelled" : "failed" });
      this.reject?.(workerError(code));
      this.dispose();
      return;
    }
    this.fail("LEARNING_WORKER_PROTOCOL_MISMATCH");
  };

  private readonly onError: WorkerErrorListener = (event) => {
    if (this.disposed || this.settled) {
      this.updateLifecycle({ lateResultsRejected: this.lifecycle.lateResultsRejected + 1 });
      return;
    }
    this.settled = true;
    this.updateLifecycle({ phase: "failed" });
    this.reject?.(workerError("LEARNING_WORKER_FAILED", event.message));
    this.dispose();
  };

  extract(files: readonly File[]) {
    if (this.disposed || this.settled || this.worker) {
      return Promise.reject(workerError("LEARNING_WORKER_CLIENT_NOT_REUSABLE"));
    }
    this.files = files;
    this.operation = "extract";
    this.worker = this.workerFactory();
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onError);
    this.updateLifecycle({ phase: "running", workerCreated: true });
    return new Promise<ManualLearningBatchItem[]>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.worker?.postMessage({
        type: "extract_batch",
        protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
        requestId: this.requestId,
        files: [...files],
      });
    });
  }

  prepare(file: File, maximumChunkCharacters?: number) {
    if (this.disposed || this.settled || this.worker) {
      return Promise.reject(workerError("LEARNING_WORKER_CLIENT_NOT_REUSABLE"));
    }
    this.files = [file];
    this.operation = "prepare";
    this.worker = this.workerFactory();
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onError);
    this.updateLifecycle({ phase: "running", workerCreated: true });
    return new Promise<ManualLearningPreparedFile>((resolve, reject) => {
      this.resolvePrepared = resolve;
      this.reject = reject;
      this.worker?.postMessage({
        type: "prepare_import_file",
        protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
        requestId: this.requestId,
        file,
        maximumChunkCharacters,
      });
    });
  }

  cancel(code = "LEARNING_FILE_CANCELLED") {
    if (this.disposed || this.settled) return;
    this.settled = true;
    this.worker?.postMessage({
      type: "cancel",
      protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
      requestId: this.requestId,
    });
    this.updateLifecycle({ phase: "cancelled" });
    this.reject?.(workerError(code));
    this.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.removeAbortListener?.();
    this.removeAbortListener = null;
    this.worker?.removeEventListener("message", this.onMessage);
    this.worker?.removeEventListener("error", this.onError);
    this.worker?.terminate();
    this.worker = null;
    this.files = null;
    this.resultItems = null;
    this.preparedResult = null;
    this.operation = null;
    this.resolve = null;
    this.resolvePrepared = null;
    this.reject = null;
    this.updateLifecycle({
      phase: "disposed",
      workerTerminated: true,
      fileReferencesReleased: true,
      temporaryResultsReleased: true,
    });
  }

  snapshot() {
    return structuredClone(this.lifecycle);
  }
}

export async function extractManualLearningFilesInWorker(
  files: readonly File[],
  options: ManualLearningWorkerClientOptions = {},
) {
  if (options.signal?.aborted) throw workerError("LEARNING_FILE_CANCELLED");
  const client = new ManualLearningWorkerClient(undefined, options);
  try {
    return await client.extract(files);
  } finally {
    client.dispose();
  }
}

export async function extractManualLearningFileInWorker(
  file: File,
  options: ManualLearningWorkerClientOptions = {},
) {
  const [item] = await extractManualLearningFilesInWorker([file], options);
  if (!item) throw workerError("LEARNING_WORKER_EMPTY_RESULT");
  if (item.status !== "completed") throw workerError(item.errorCode);
  return item.extraction;
}

export const prepareManualLearningFileInWorker: ManualLearningFilePreparer = async (
  file: File,
  options: ManualLearningPrepareFileOptions = {},
) => {
  if (options.signal?.aborted) throw workerError("LEARNING_FILE_CANCELLED");
  const client = new ManualLearningWorkerClient(undefined, options);
  try {
    return await client.prepare(file, options.maximumChunkCharacters);
  } finally {
    client.dispose();
  }
};
