export const TRAINING_DATASET_SCHEMA_VERSION = "p23-training-dataset-v1" as const;

export type TrainingExampleType =
  | "sft"
  | "preference_pair"
  | "critique_revision"
  | "planning"
  | "tool_use"
  | "story_continuity"
  | "adult_fiction"
  | "reasoning_demonstration"
  | "verifier";

export type TrainingExample = {
  exampleId: string;
  type: TrainingExampleType;
  sourceEventIds: string[];
  input: string;
  output: string;
  rejectedOutput?: string;
  licenseIds: string[];
  adultMode: boolean;
  qualityScore: number;
  piiStatus: "pending" | "passed" | "failed";
  licenseStatus: "pending" | "passed" | "failed";
  hallucinationStatus: "pending" | "passed" | "failed";
  contaminationStatus: "pending" | "passed" | "failed";
  approvalStatus: "pending" | "approved" | "rejected";
};

export type SealedTrainingDataset = {
  schemaVersion: typeof TRAINING_DATASET_SCHEMA_VERSION;
  datasetId: string;
  datasetVersion: number;
  namespace: "general" | "adult";
  sourceManifest: Array<{ exampleId: string; sourceEventIds: string[] }>;
  licenseManifest: string[];
  contentHashes: string[];
  qualityReport: { examples: number; averageQuality: number; rejected: number };
  approvalRecord: { approvedBy: string; approvedAt: string };
  manifestHash: string;
  status: "sealed";
};
