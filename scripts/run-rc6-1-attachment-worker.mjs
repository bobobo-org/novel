import assert from "node:assert/strict";
import { File } from "node:buffer";
import {
  extractManualLearningFilesInWorker,
  ManualLearningWorkerClient,
  prepareManualLearningFileInWorker,
} from "../lib/novel-ai/web/manual-learning-worker-client.ts";
import { MANUAL_LEARNING_WORKER_PROTOCOL_VERSION } from "../lib/novel-ai/web/manual-learning-import-preparation.ts";

const mode = process.argv[2] ?? "all";
const results = [];

class FakeWorker {
  listeners = { message: new Set(), error: new Set() };
  retainedMessageListeners = new Set();
  posted = [];
  terminated = false;
  onPost = null;

  postMessage(message) {
    this.posted.push(structuredClone(message));
    this.onPost?.(message, this);
  }

  terminate() {
    this.terminated = true;
  }

  addEventListener(type, listener) {
    this.listeners[type].add(listener);
    if (type === "message") this.retainedMessageListeners.add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type].delete(listener);
  }

  emit(response, { late = false } = {}) {
    const listeners = late ? this.retainedMessageListeners : this.listeners.message;
    for (const listener of listeners) listener({ data: structuredClone(response) });
  }
}

function extraction(file) {
  return {
    fileName: file.name,
    safeSourceAlias: file.name,
    format: "text",
    documentFormat: "txt",
    mediaType: "text/plain",
    byteLength: file.size,
    contentHash: "a".repeat(64),
    text: "測試內容".repeat(80),
    pageCount: null,
    warnings: [],
    parsingStatus: "completed",
    localAnalysisOnly: true,
    rawContentRetained: false,
    dataLeftDevice: false,
  };
}

function prepared(file) {
  const parsed = extraction(file);
  const { text, ...metadata } = parsed;
  return {
    extraction: metadata,
    chunks: [{
      chunkIndex: 0,
      sourceSection: "document",
      boundary: "paragraph",
      text,
      contentHash: "b".repeat(64),
      previousOverlapDigest: null,
      nextOverlapDigest: null,
    }],
    semanticChunkingAlgorithm: "semantic-chunking-v1",
    rawContentRetained: false,
    dataLeftDevice: false,
  };
}

async function run(name, callback) {
  const startedAt = performance.now();
  try {
    await callback();
    results.push({ name, status: "PASS", elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100 });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error?.stack ?? String(error) });
  }
}

if (["all", "cancellation"].includes(mode)) {
  await run("cancel terminates the parsing worker and exposes the complete lifecycle", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const lifecycle = [];
    const client = new ManualLearningWorkerClient("cancel-case", {
      signal: controller.signal,
      workerFactory: () => worker,
      onLifecycle: (value) => lifecycle.push(value),
    });
    const pending = client.extract([
      new File(["取消測試".repeat(80)], "cancel.txt", { type: "text/plain" }),
    ]);
    controller.abort("user_cancelled");
    await assert.rejects(pending, (error) => error?.code === "LEARNING_FILE_CANCELLED");
    assert.equal(worker.terminated, true);
    assert.deepEqual(worker.posted.map((message) => message.type), ["extract_batch", "cancel"]);
    assert(lifecycle.some((value) => value.phase === "created"));
    assert(lifecycle.some((value) => value.phase === "running"));
    assert(lifecycle.some((value) => value.phase === "cancelled"));
    assert.equal(lifecycle.at(-1).phase, "disposed");
  });
}

if (["all", "memory-release"].includes(mode)) {
  await run("completion terminates the worker and releases internal file and result references", async () => {
    const worker = new FakeWorker();
    const file = new File(["完成測試".repeat(80)], "complete.txt", { type: "text/plain" });
    worker.onPost = (message, current) => {
      if (message.type !== "extract_batch") return;
      queueMicrotask(() => current.emit({
        type: "completed",
        protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        items: [{ fileName: file.name, fileIndex: 0, status: "completed", extraction: extraction(file), errorCode: null }],
        rawContentRetained: false,
        dataLeftDevice: false,
      }));
    };
    const lifecycle = [];
    const client = new ManualLearningWorkerClient("complete-case", {
      workerFactory: () => worker,
      onLifecycle: (value) => lifecycle.push(value),
    });
    const items = await client.extract([file]);
    assert.equal(items[0].status, "completed");
    const disposed = lifecycle.at(-1);
    assert.equal(disposed.phase, "disposed");
    assert.equal(disposed.workerTerminated, true);
    assert.equal(disposed.fileReferencesReleased, true);
    assert.equal(disposed.temporaryResultsReleased, true);
    assert.equal(disposed.objectUrlsCreated, 0);
    assert.equal(disposed.objectUrlsRevoked, 0);
    assert.equal(disposed.rawContentRetained, false);
    assert.equal(worker.terminated, true);
  });

  await run("prepared import resolves extraction and semantic chunks before disposing the worker", async () => {
    const worker = new FakeWorker();
    const file = new File(["摰?皜祈岫".repeat(80)], "prepare.txt", { type: "text/plain" });
    worker.onPost = (message, current) => {
      if (message.type !== "prepare_import_file") return;
      queueMicrotask(() => current.emit({
        type: "prepared",
        protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        prepared: prepared(file),
        rawContentRetained: false,
        dataLeftDevice: false,
      }));
    };
    const lifecycle = [];
    const client = new ManualLearningWorkerClient("prepare-case", {
      workerFactory: () => worker,
      onLifecycle: (value) => lifecycle.push(value),
    });
    const result = await client.prepare(file, 285_000);
    assert.equal(result.extraction.contentHash.length, 64);
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].contentHash.length, 64);
    assert.deepEqual(worker.posted.map((message) => message.type), ["prepare_import_file"]);
    assert.equal(lifecycle.at(-1).phase, "disposed");
    assert.equal(worker.terminated, true);
  });

  await run("operation and protocol mismatches reject instead of leaving a pending promise", async () => {
    const file = new File(["蝚砌?皜祈岫".repeat(80)], "mismatch.txt", { type: "text/plain" });
    const wrongOperationWorker = new FakeWorker();
    wrongOperationWorker.onPost = (message, current) => {
      if (message.type !== "prepare_import_file") return;
      queueMicrotask(() => current.emit({
        type: "completed",
        protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        items: [{ fileName: file.name, fileIndex: 0, status: "completed", extraction: extraction(file), errorCode: null }],
        rawContentRetained: false,
        dataLeftDevice: false,
      }));
    };
    const wrongOperationClient = new ManualLearningWorkerClient("wrong-operation", {
      workerFactory: () => wrongOperationWorker,
    });
    await assert.rejects(
      wrongOperationClient.prepare(file),
      (error) => error?.code === "LEARNING_WORKER_PROTOCOL_MISMATCH",
    );
    assert.equal(wrongOperationWorker.terminated, true);

    const reverseOperationWorker = new FakeWorker();
    reverseOperationWorker.onPost = (message, current) => {
      if (message.type !== "extract_batch") return;
      queueMicrotask(() => current.emit({
        type: "prepared",
        protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        prepared: prepared(file),
        rawContentRetained: false,
        dataLeftDevice: false,
      }));
    };
    const reverseOperationClient = new ManualLearningWorkerClient("reverse-operation", {
      workerFactory: () => reverseOperationWorker,
    });
    await assert.rejects(
      reverseOperationClient.extract([file]),
      (error) => error?.code === "LEARNING_WORKER_PROTOCOL_MISMATCH",
    );
    assert.equal(reverseOperationWorker.terminated, true);

    const wrongVersionWorker = new FakeWorker();
    wrongVersionWorker.onPost = (message, current) => {
      if (message.type !== "extract_batch") return;
      queueMicrotask(() => current.emit({
        type: "completed",
        protocolVersion: "manual-learning-worker-protocol-v1",
        requestId: message.requestId,
        items: [{ fileName: file.name, fileIndex: 0, status: "completed", extraction: extraction(file), errorCode: null }],
        rawContentRetained: false,
        dataLeftDevice: false,
      }));
    };
    const wrongVersionClient = new ManualLearningWorkerClient("wrong-version", {
      workerFactory: () => wrongVersionWorker,
    });
    await assert.rejects(
      wrongVersionClient.extract([file]),
      (error) => error?.code === "LEARNING_WORKER_PROTOCOL_MISMATCH",
    );
    assert.equal(wrongVersionWorker.terminated, true);

    const unknownResponseWorker = new FakeWorker();
    unknownResponseWorker.onPost = (message, current) => {
      if (message.type !== "extract_batch") return;
      queueMicrotask(() => current.emit({
        type: "legacy_success",
        protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
      }));
    };
    const unknownResponseClient = new ManualLearningWorkerClient("unknown-response", {
      workerFactory: () => unknownResponseWorker,
    });
    await assert.rejects(
      unknownResponseClient.extract([file]),
      (error) => error?.code === "LEARNING_WORKER_PROTOCOL_MISMATCH",
    );
    assert.equal(unknownResponseWorker.terminated, true);
  });

  await run("already-aborted exported operations fail before creating a Worker", async () => {
    const file = new File(["撱園皜祈岫".repeat(80)], "already-aborted.txt", { type: "text/plain" });
    const controller = new AbortController();
    controller.abort("user_cancelled");
    let workerFactoryCalls = 0;
    const options = {
      signal: controller.signal,
      workerFactory: () => {
        workerFactoryCalls += 1;
        return new FakeWorker();
      },
    };
    await assert.rejects(
      extractManualLearningFilesInWorker([file], options),
      (error) => error?.code === "LEARNING_FILE_CANCELLED",
    );
    await assert.rejects(
      prepareManualLearningFileInWorker(file, options),
      (error) => error?.code === "LEARNING_FILE_CANCELLED",
    );
    assert.equal(workerFactoryCalls, 0);
  });
}

if (["all", "late-result"].includes(mode)) {
  await run("late worker completion is rejected after cancellation and cannot reach a session writer", async () => {
    const worker = new FakeWorker();
    const file = new File(["延遲測試".repeat(80)], "late.txt", { type: "text/plain" });
    let sessionMutationCount = 0;
    const client = new ManualLearningWorkerClient("late-case", {
      workerFactory: () => worker,
    });
    const pending = client.extract([file]).then(() => { sessionMutationCount += 1; });
    client.cancel();
    await assert.rejects(pending, (error) => error?.code === "LEARNING_FILE_CANCELLED");
    worker.emit({
      type: "completed",
      protocolVersion: MANUAL_LEARNING_WORKER_PROTOCOL_VERSION,
      requestId: "late-case",
      items: [{ fileName: file.name, fileIndex: 0, status: "completed", extraction: extraction(file), errorCode: null }],
      rawContentRetained: false,
      dataLeftDevice: false,
    }, { late: true });
    assert.equal(sessionMutationCount, 0);
    assert.equal(client.snapshot().lateResultsRejected, 1);
    assert.equal(worker.terminated, true);
  });
}

if (!results.length) throw new Error(`Unknown mode: ${mode}`);
const failed = results.filter((result) => result.status === "FAIL");
console.log(JSON.stringify({
  schemaVersion: "rc6-1-attachment-worker-tests-v1",
  mode,
  pass: results.length - failed.length,
  fail: failed.length,
  blockingSkip: 0,
  results,
}, null, 2));
if (failed.length) process.exitCode = 1;
