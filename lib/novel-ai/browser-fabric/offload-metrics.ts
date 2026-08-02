import { browserFabricDigest } from "./execution-receipt";

export type BrowserFabricOffloadMetrics = {
  schemaVersion: "browser-fabric-offload-v1";
  receiptId: string;
  eligibleTasks: number;
  browserExecutedTasks: number;
  browserOffloadRatio: number;
  localOllamaCallsAvoided: number;
  privateHubJobsAvoided: number;
  remoteInputTokensSaved: number;
  outputRepairCallsAvoided: number;
  browserComputeMinutes: number;
  rawContentPersisted: false;
};

export async function summarizeBrowserFabricOffload(input: {
  receiptId: string;
  eligibleTasks: number;
  browserExecutedTasks: number;
  localOllamaCallsAvoided: number;
  privateHubJobsAvoided: number;
  remoteInputTokensSaved: number;
  outputRepairCallsAvoided: number;
  browserComputeMs: number;
}): Promise<BrowserFabricOffloadMetrics> {
  const digest = await browserFabricDigest(input);
  return {
    schemaVersion: "browser-fabric-offload-v1",
    receiptId: `${input.receiptId}:${digest.slice(0, 12)}`,
    eligibleTasks: input.eligibleTasks,
    browserExecutedTasks: input.browserExecutedTasks,
    browserOffloadRatio: input.eligibleTasks
      ? input.browserExecutedTasks / input.eligibleTasks
      : 0,
    localOllamaCallsAvoided: input.localOllamaCallsAvoided,
    privateHubJobsAvoided: input.privateHubJobsAvoided,
    remoteInputTokensSaved: input.remoteInputTokensSaved,
    outputRepairCallsAvoided: input.outputRepairCallsAvoided,
    browserComputeMinutes: input.browserComputeMs / 60_000,
    rawContentPersisted: false,
  };
}
