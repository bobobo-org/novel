export const TEACHER_PIPELINE_SCHEMA_VERSION = "teacher-pipeline-v1";
export type TeacherPipelineStatus = "generated" | "reviewed" | "approved" | "rejected" | "exported";
export type TeacherConsent = { trainingAllowed: boolean; sharedDatasetAllowed: boolean; grantedAt: string | null; withdrawnAt: string | null };
export type TeacherProvenance = { providerId: string; modelId: string; taskDefinitionVersion: string; sourceType: "synthetic" | "public_domain" | "licensed" | "private_user_content"; sourceReference: string | null; copyrightStatus: "cleared" | "restricted" | "unknown" };
export type TeacherPipelineRecord = {
  schemaVersion: typeof TEACHER_PIPELINE_SCHEMA_VERSION;
  recordId: string;
  workspace: "training";
  taskDefinition: string;
  inputSnapshot: string;
  teacherResponse: string;
  candidateOutputs: string[];
  evaluatorScores: Record<string, number>;
  ranking: string[];
  status: TeacherPipelineStatus;
  humanApproval: { reviewerId: string; reviewedAt: string; decision: "approved" | "rejected" } | null;
  provenance: TeacherProvenance;
  consent: TeacherConsent;
  retention: { expiresAt: string | null; policy: "delete_on_withdrawal" | "fixed_term" | "retain_approved" };
  datasetVersion: string | null;
  rejectionReason: string | null;
  trainingEligibility: boolean;
  exportEligibility: boolean;
  deletionRequestedAt: string | null;
  offlineBenchmarkLink: string | null;
};

export function validateTeacherPipelineRecord(value: TeacherPipelineRecord) {
  if (value.schemaVersion !== TEACHER_PIPELINE_SCHEMA_VERSION) return { valid: false, errorCode: "TEACHER_SCHEMA_UNSUPPORTED" };
  if (value.workspace !== "training") return { valid: false, errorCode: "TEACHER_STORAGE_BOUNDARY_INVALID" };
  if (!value.recordId || !value.provenance?.providerId) return { valid: false, errorCode: "TEACHER_PROVENANCE_REQUIRED" };
  if (value.provenance.sourceType === "private_user_content" && !value.consent.trainingAllowed) return { valid: false, errorCode: "TEACHER_PRIVATE_CONTENT_CONSENT_REQUIRED" };
  if (value.exportEligibility && (!value.trainingEligibility || value.status !== "approved" || !value.humanApproval)) return { valid: false, errorCode: "TEACHER_EXPORT_NOT_APPROVED" };
  if (value.provenance.sourceType === "private_user_content" && value.exportEligibility && !value.consent.sharedDatasetAllowed) return { valid: false, errorCode: "TEACHER_SHARED_DATASET_CONSENT_REQUIRED" };
  if (value.provenance.copyrightStatus !== "cleared" && value.exportEligibility) return { valid: false, errorCode: "TEACHER_COPYRIGHT_NOT_CLEARED" };
  return { valid: true, errorCode: null };
}

export function migrateTeacherPipelineRecord(value: Record<string, unknown>): TeacherPipelineRecord | null {
  if (value.schemaVersion === TEACHER_PIPELINE_SCHEMA_VERSION) return value as TeacherPipelineRecord;
  return null;
}
