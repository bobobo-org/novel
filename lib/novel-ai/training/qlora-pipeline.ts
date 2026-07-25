import crypto from "node:crypto";

export const QLORA_PIPELINE_SCHEMA_VERSION = "p23-qlora-pipeline-v1" as const;
export const QLORA_ACTIONS = ["prepare", "train", "pause", "resume", "cancel", "evaluate", "export-adapter", "merge-adapter", "quantize", "register-model", "rollback"] as const;
export type QloraAction = typeof QLORA_ACTIONS[number];

export type QloraTrainingJob = {
  schemaVersion: typeof QLORA_PIPELINE_SCHEMA_VERSION;
  jobId: string;
  baseModel: string;
  baseModelLicense: string;
  datasetVersion: string;
  hyperparameters: Record<string, number | string | boolean>;
  seed: number;
  hardwareProfile: string;
  status: "prepared" | "running" | "paused" | "cancelled" | "failed" | "evaluating" | "candidate" | "approved" | "rolled_back";
  trainingLogs: Array<{ at: string; level: "info" | "warning" | "error"; code: string }>;
  evaluationResults: Record<string, number>;
  adapterHash: string | null;
  mergedModelHash: string | null;
  approvalStatus: "pending" | "approved" | "rejected";
  previousApprovedModelId: string | null;
};

export type PrivateTrainingBackend = {
  backendId: string;
  private: true;
  available(): Promise<boolean>;
  execute(job: QloraTrainingJob, action: QloraAction, signal?: AbortSignal): Promise<Partial<QloraTrainingJob>>;
};

export function prepareQloraJob(input: Omit<QloraTrainingJob, "schemaVersion" | "jobId" | "status" | "trainingLogs" | "evaluationResults" | "adapterHash" | "mergedModelHash" | "approvalStatus">) {
  if (!input.baseModelLicense.trim()) throw Object.assign(new Error("基礎模型缺少授權紀錄。"), { code: "QLORA_BASE_MODEL_LICENSE_REQUIRED" });
  return {
    schemaVersion: QLORA_PIPELINE_SCHEMA_VERSION,
    jobId: `qlora_${crypto.createHash("sha256").update(`${input.baseModel}|${input.datasetVersion}|${input.seed}|${Date.now()}`).digest("hex").slice(0, 24)}`,
    ...input,
    status: "prepared",
    trainingLogs: [],
    evaluationResults: {},
    adapterHash: null,
    mergedModelHash: null,
    approvalStatus: "pending",
  } satisfies QloraTrainingJob;
}

export async function executeQloraAction(job: QloraTrainingJob, action: QloraAction, backend: PrivateTrainingBackend | null, signal?: AbortSignal) {
  if (!backend || !await backend.available()) {
    throw Object.assign(new Error("私有訓練 backend 尚未連線。"), { code: "PRIVATE_TRAINING_BACKEND_NOT_CONNECTED" });
  }
  if (!backend.private) throw Object.assign(new Error("訓練 backend 不是私有環境。"), { code: "TRAINING_BACKEND_PRIVACY_VIOLATION" });
  const update = await backend.execute(job, action, signal);
  return { ...job, ...update };
}

export function approveQloraCandidate(job: QloraTrainingJob, input: { benchmarkPassed: boolean; userApproved: boolean }) {
  if (job.status !== "candidate" && job.status !== "evaluating") throw Object.assign(new Error("訓練工作尚未形成候選。"), { code: "QLORA_CANDIDATE_REQUIRED" });
  if (!job.adapterHash) throw Object.assign(new Error("候選缺少 adapter hash。"), { code: "QLORA_ADAPTER_HASH_REQUIRED" });
  return {
    ...job,
    status: input.benchmarkPassed && input.userApproved ? "approved" as const : "failed" as const,
    approvalStatus: input.benchmarkPassed && input.userApproved ? "approved" as const : "rejected" as const,
  };
}
