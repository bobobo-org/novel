import crypto from "node:crypto";
import { DISTILLATION_SCHEMA_VERSION, type DistillationJob, type TeacherModelDescriptor } from "./types";

function hash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }

export function prepareDistillationJob(input: {
  teacher: TeacherModelDescriptor;
  studentBaseModel: string;
  datasetVersion: string;
  sampleTaskIds: string[];
}) {
  if (!input.teacher.distillationPermitted || !input.teacher.localOrPrivate) {
    throw Object.assign(new Error("教師模型未授權蒸餾或不在受控環境。"), { code: "DISTILLATION_TEACHER_NOT_PERMITTED" });
  }
  if (!input.sampleTaskIds.length) throw Object.assign(new Error("蒸餾工作缺少任務樣本。"), { code: "DISTILLATION_TASKS_REQUIRED" });
  const now = new Date().toISOString();
  return {
    schemaVersion: DISTILLATION_SCHEMA_VERSION,
    jobId: `distill_${hash(`${input.teacher.modelHash}|${input.studentBaseModel}|${input.datasetVersion}|${Date.now()}`).slice(0, 24)}`,
    teacher: input.teacher,
    studentBaseModel: input.studentBaseModel,
    datasetVersion: input.datasetVersion,
    sampleTaskIds: input.sampleTaskIds,
    status: "prepared",
    demonstrationHashes: [],
    benchmarkId: null,
    createdAt: now,
    updatedAt: now,
  } satisfies DistillationJob;
}

export function attachVerifiedDemonstrations(job: DistillationJob, demonstrations: Array<{ taskId: string; output: string; deterministicVerified: boolean; qualityPassed: boolean }>) {
  if (job.status !== "prepared" && job.status !== "sampling") throw Object.assign(new Error("蒸餾工作狀態不允許封印示範。"), { code: "DISTILLATION_STATE_INVALID" });
  const accepted = demonstrations.filter((row) => row.deterministicVerified && row.qualityPassed);
  if (!accepted.length) throw Object.assign(new Error("沒有通過驗證的教師示範。"), { code: "DISTILLATION_NO_VERIFIED_DEMONSTRATION" });
  return {
    ...job,
    status: "dataset_sealed" as const,
    demonstrationHashes: accepted.map((row) => hash(`${row.taskId}|${row.output}`)),
    updatedAt: new Date().toISOString(),
  };
}

export function approveDistillationCandidate(job: DistillationJob, input: { benchmarkId: string; benchmarkPassed: boolean; userApproved: boolean }) {
  if (job.status !== "evaluating") throw Object.assign(new Error("蒸餾候選尚未進入評估。"), { code: "DISTILLATION_STATE_INVALID" });
  return {
    ...job,
    benchmarkId: input.benchmarkId,
    status: input.benchmarkPassed && input.userApproved ? "approved" as const : "rejected" as const,
    updatedAt: new Date().toISOString(),
  };
}
