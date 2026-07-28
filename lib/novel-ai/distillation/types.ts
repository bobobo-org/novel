export const DISTILLATION_SCHEMA_VERSION = "p23-distillation-v1" as const;

export type TeacherModelDescriptor = {
  modelId: string;
  owner: "user" | "local_open_weight" | "private_hub";
  license: string;
  distillationPermitted: boolean;
  localOrPrivate: boolean;
  modelHash: string;
};

export type DistillationJob = {
  schemaVersion: typeof DISTILLATION_SCHEMA_VERSION;
  jobId: string;
  teacher: TeacherModelDescriptor;
  studentBaseModel: string;
  datasetVersion: string;
  sampleTaskIds: string[];
  status: "prepared" | "sampling" | "verifying" | "dataset_sealed" | "training_candidate" | "evaluating" | "approved" | "rejected" | "cancelled";
  demonstrationHashes: string[];
  benchmarkId: string | null;
  createdAt: string;
  updatedAt: string;
};
