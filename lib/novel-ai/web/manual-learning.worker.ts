/// <reference lib="webworker" />

import {
  ManualLearningWorkerRuntime,
  type ManualLearningWorkerRequest,
} from "./manual-learning-worker";

const runtime = new ManualLearningWorkerRuntime();
const workerScope = globalThis as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<ManualLearningWorkerRequest>) => void): void;
  postMessage(message: unknown): void;
};

workerScope.addEventListener("message", (event) => {
  void runtime.handle(event.data, (response) => workerScope.postMessage(response));
});
