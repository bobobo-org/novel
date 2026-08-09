import {
  extractManualLearningFiles,
  type ManualLearningBatchItem,
  type ManualLearningFileProgress,
} from "./manual-learning-file";

export type ManualLearningWorkerRequest =
  | { type: "extract_batch"; requestId: string; files: File[] }
  | { type: "cancel"; requestId: string };

export type ManualLearningWorkerResponse =
  | { type: "progress"; requestId: string; progress: ManualLearningFileProgress }
  | { type: "completed"; requestId: string; items: ManualLearningBatchItem[]; rawContentRetained: false; dataLeftDevice: false }
  | { type: "failed"; requestId: string; errorCode: string; rawContentRetained: false; dataLeftDevice: false }
  | { type: "cancelled"; requestId: string; rawContentRetained: false; dataLeftDevice: false };

export class ManualLearningWorkerRuntime {
  private readonly controllers = new Map<string, AbortController>();

  async handle(
    message: ManualLearningWorkerRequest,
    post: (response: ManualLearningWorkerResponse) => void,
  ) {
    if (message.type === "cancel") {
      this.controllers.get(message.requestId)?.abort("user_cancelled");
      post({
        type: "cancelled",
        requestId: message.requestId,
        rawContentRetained: false,
        dataLeftDevice: false,
      });
      return;
    }
    if (this.controllers.has(message.requestId)) {
      post({
        type: "failed",
        requestId: message.requestId,
        errorCode: "LEARNING_WORKER_DUPLICATE_REQUEST",
        rawContentRetained: false,
        dataLeftDevice: false,
      });
      return;
    }
    const controller = new AbortController();
    this.controllers.set(message.requestId, controller);
    try {
      const items = await extractManualLearningFiles(message.files, {
        signal: controller.signal,
        onProgress: (progress) => post({
          type: "progress",
          requestId: message.requestId,
          progress,
        }),
      });
      post({
        type: controller.signal.aborted ? "cancelled" : "completed",
        requestId: message.requestId,
        ...(controller.signal.aborted ? {} : { items }),
        rawContentRetained: false,
        dataLeftDevice: false,
      } as ManualLearningWorkerResponse);
    } catch (error) {
      const errorCode = String((error as { code?: string })?.code ?? "LEARNING_WORKER_FAILED");
      post({
        type: errorCode === "LEARNING_FILE_CANCELLED" ? "cancelled" : "failed",
        requestId: message.requestId,
        ...(errorCode === "LEARNING_FILE_CANCELLED" ? {} : { errorCode }),
        rawContentRetained: false,
        dataLeftDevice: false,
      } as ManualLearningWorkerResponse);
    } finally {
      this.controllers.delete(message.requestId);
    }
  }

  activeRequestCount() {
    return this.controllers.size;
  }
}
