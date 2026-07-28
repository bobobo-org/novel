import crypto from "node:crypto";
import type { SovereignLearningEvent } from "../learning-events";
import { TRAINING_DATASET_SCHEMA_VERSION, type SealedTrainingDataset, type TrainingExample, type TrainingExampleType } from "./types";

const piiPatterns = [
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/,
  /\b(?:\+?886[- ]?)?09\d{2}[- ]?\d{3}[- ]?\d{3}\b/,
  /\b(?:sk|sbp|vcp)_[A-Za-z0-9_-]{12,}\b/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
];

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function exampleFromLearningEvent(event: SovereignLearningEvent, type: TrainingExampleType): TrainingExample {
  if (!event.trainingEligible || event.excludedFromTraining) throw Object.assign(new Error("學習事件未獲訓練授權。"), { code: "TRAINING_EVENT_NOT_ELIGIBLE" });
  if (!event.candidateText) throw Object.assign(new Error("學習事件沒有可用候選內容。"), { code: "TRAINING_EVENT_CONTENT_MISSING" });
  return {
    exampleId: `training_example_${hash(`${event.eventId}|${type}`).slice(0, 24)}`,
    type,
    sourceEventIds: [event.eventId],
    input: event.generatedPlan.join("\n"),
    output: event.candidateText,
    licenseIds: [],
    adultMode: event.adultMode,
    qualityScore: event.userRating == null ? 50 : event.userRating * 20,
    piiStatus: "pending",
    licenseStatus: "pending",
    hallucinationStatus: "pending",
    contaminationStatus: "pending",
    approvalStatus: "pending",
  };
}

export function validateTrainingExample(input: {
  example: TrainingExample;
  allowedLicenseIds: string[];
  hallucinationFree: boolean;
  contaminationFree: boolean;
}) {
  const text = `${input.example.input}\n${input.example.output}\n${input.example.rejectedOutput ?? ""}`;
  const piiStatus = piiPatterns.some((pattern) => pattern.test(text)) ? "failed" as const : "passed" as const;
  const licenseStatus = input.example.licenseIds.length > 0 && input.example.licenseIds.every((id) => input.allowedLicenseIds.includes(id)) ? "passed" as const : "failed" as const;
  return {
    ...input.example,
    piiStatus,
    licenseStatus,
    hallucinationStatus: input.hallucinationFree ? "passed" as const : "failed" as const,
    contaminationStatus: input.contaminationFree ? "passed" as const : "failed" as const,
  };
}

export function approveTrainingExample(example: TrainingExample, humanApproved: boolean) {
  const gatesPass = example.piiStatus === "passed"
    && example.licenseStatus === "passed"
    && example.hallucinationStatus === "passed"
    && example.contaminationStatus === "passed"
    && example.qualityScore >= 70;
  return { ...example, approvalStatus: humanApproved && gatesPass ? "approved" as const : "rejected" as const };
}

export function sealTrainingDataset(input: {
  datasetId: string;
  datasetVersion: number;
  examples: TrainingExample[];
  approvedBy: string;
}) {
  if (!input.examples.length || input.examples.some((example) => example.approvalStatus !== "approved")) {
    throw Object.assign(new Error("資料集仍含未核准範例。"), { code: "DATASET_UNAPPROVED_EXAMPLES" });
  }
  const adultValues = new Set(input.examples.map((example) => example.adultMode));
  if (adultValues.size > 1) throw Object.assign(new Error("成人與一般訓練資料必須分庫。"), { code: "DATASET_ADULT_NAMESPACE_MIXED" });
  const contentHashes = input.examples.map((example) => hash(`${example.input}\n${example.output}\n${example.rejectedOutput ?? ""}`));
  if (new Set(contentHashes).size !== contentHashes.length) throw Object.assign(new Error("資料集含重複範例。"), { code: "DATASET_DUPLICATE_EXAMPLES" });
  const sourceManifest = input.examples.map((example) => ({ exampleId: example.exampleId, sourceEventIds: example.sourceEventIds }));
  const licenseManifest = [...new Set(input.examples.flatMap((example) => example.licenseIds))];
  const averageQuality = input.examples.reduce((sum, example) => sum + example.qualityScore, 0) / input.examples.length;
  const base = {
    schemaVersion: TRAINING_DATASET_SCHEMA_VERSION,
    datasetId: input.datasetId,
    datasetVersion: input.datasetVersion,
    namespace: input.examples[0].adultMode ? "adult" as const : "general" as const,
    sourceManifest,
    licenseManifest,
    contentHashes,
    qualityReport: { examples: input.examples.length, averageQuality, rejected: 0 },
    approvalRecord: { approvedBy: input.approvedBy, approvedAt: new Date().toISOString() },
    status: "sealed" as const,
  };
  return { ...base, manifestHash: hash(JSON.stringify(base)) } satisfies SealedTrainingDataset;
}
