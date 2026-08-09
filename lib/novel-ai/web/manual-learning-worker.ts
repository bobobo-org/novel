import {
  extractManualLearningFiles,
  splitManualLearningDocumentSemantically,
} from "./manual-learning-file";
import type {
  ManualLearningBatchItem,
  ManualLearningPreparedFile,
  ManualLearningWorkerRequest,
  ManualLearningWorkerResponse,
} from "./manual-learning-import-preparation";
import { MANUAL_LEARNING_WORKER_PROTOCOL_VERSION } from "./manual-learning-import-preparation";
export type {
  ManualLearningWorkerRequest,
  ManualLearningWorkerResponse,
} from "./manual-learning-import-preparation";

export class ManualLearningWorkerRuntime {
  private readonly controllers = new Map<string, AbortController>();
  private readonly cancelledRequests = new Set<string>();

  async handle(
    message: ManualLearningWorkerRequest,
    post: (response: ManualLearningWorkerResponse) => void,
  ) {
    if (message.protocolVersion !== MANUAL_LEARNING_WORKER_PROTOCOL_VERSION) {
      post({
        type: "failed",
        protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        errorCode: "LEARNING_WORKER_PROTOCOL_MISMATCH",
        rawContentRetained: false,
        dataLeftDevice: false,
      });
      return;
    }
    if (message.type === "cancel") {
      this.cancelledRequests.add(message.requestId);
      this.controllers.get(message.requestId)?.abort("user_cancelled");
      post({
        type: "cancelled",
        protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        rawContentRetained: false,
        dataLeftDevice: false,
      });
      return;
    }
    if (this.cancelledRequests.has(message.requestId)) return;
    if (this.controllers.has(message.requestId)) {
      post({
        type: "failed",
        protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        errorCode: "LEARNING_WORKER_DUPLICATE_REQUEST",
        rawContentRetained: false,
        dataLeftDevice: false,
      });
      return;
    }
    const controller = new AbortController();
    this.controllers.set(message.requestId, controller);
    let files: File[] | null = message.type === "extract_batch"
      ? message.files
      : [message.file];
    let items: ManualLearningBatchItem[] | null = null;
    let prepared: ManualLearningPreparedFile | null = null;
    try {
      items = await extractManualLearningFiles(files, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (this.cancelledRequests.has(message.requestId)) return;
          if (message.type === "prepare_import_file" && progress.phase === "completed") return;
          post({
            type: "progress",
            protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
            requestId: message.requestId,
            progress,
          });
        },
      });
      if (message.type === "prepare_import_file") {
        const item = items[0];
        if (!item || item.status !== "completed") {
          throw Object.assign(new Error(item?.errorCode ?? "LEARNING_WORKER_EMPTY_RESULT"), {
            code: item?.errorCode ?? "LEARNING_WORKER_EMPTY_RESULT",
          });
        }
        if (controller.signal.aborted || this.cancelledRequests.has(message.requestId)) {
          throw Object.assign(new Error("LEARNING_FILE_CANCELLED"), { code: "LEARNING_FILE_CANCELLED" });
        }
        post({
          type: "progress",
          protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
          requestId: message.requestId,
          progress: {
            fileName: item.fileName,
            phase: "chunking",
            current: 0,
            total: 1,
            pageNumber: null,
            pageCount: item.extraction.pageCount,
          },
        });
        const { text, ...extraction } = item.extraction;
        const chunks = await splitManualLearningDocumentSemantically(
          text,
          message.maximumChunkCharacters,
        );
        if (controller.signal.aborted || this.cancelledRequests.has(message.requestId)) {
          throw Object.assign(new Error("LEARNING_FILE_CANCELLED"), { code: "LEARNING_FILE_CANCELLED" });
        }
        prepared = {
          extraction,
          chunks,
          semanticChunkingAlgorithm: "semantic-chunking-v1",
          rawContentRetained: false,
          dataLeftDevice: false,
        };
        post({
          type: "progress",
          protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
          requestId: message.requestId,
          progress: {
            fileName: item.fileName,
            phase: "chunking",
            current: 1,
            total: 1,
            pageNumber: null,
            pageCount: item.extraction.pageCount,
          },
        });
        if (!this.cancelledRequests.has(message.requestId)) {
          post({
            type: controller.signal.aborted ? "cancelled" : "prepared",
            protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
            requestId: message.requestId,
            ...(controller.signal.aborted ? {} : { prepared }),
            rawContentRetained: false,
            dataLeftDevice: false,
          } as ManualLearningWorkerResponse);
        }
        return;
      }
      if (!this.cancelledRequests.has(message.requestId)) {
        post({
          type: controller.signal.aborted ? "cancelled" : "completed",
          protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
          requestId: message.requestId,
          ...(controller.signal.aborted ? {} : { items }),
          rawContentRetained: false,
          dataLeftDevice: false,
        } as ManualLearningWorkerResponse);
      }
    } catch (error) {
      const errorCode = String((error as { code?: string })?.code ?? "LEARNING_WORKER_FAILED");
      if (!this.cancelledRequests.has(message.requestId)) {
        post({
          type: errorCode === "LEARNING_FILE_CANCELLED" ? "cancelled" : "failed",
          protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
          requestId: message.requestId,
          ...(errorCode === "LEARNING_FILE_CANCELLED" ? {} : { errorCode }),
          rawContentRetained: false,
          dataLeftDevice: false,
        } as ManualLearningWorkerResponse);
      }
    } finally {
      files = null;
      if (prepared) {
        for (const chunk of prepared.chunks) chunk.text = "";
        prepared.chunks.length = 0;
      }
      prepared = null;
      for (const item of items ?? []) {
        if (item.status === "completed") item.extraction.text = "";
      }
      items = null;
      this.controllers.delete(message.requestId);
      this.cancelledRequests.delete(message.requestId);
    }
  }

  activeRequestCount() {
    return this.controllers.size;
  }
}
