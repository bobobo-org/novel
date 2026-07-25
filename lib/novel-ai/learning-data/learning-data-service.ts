import crypto from "crypto";
import { P22_LEARNING_DATA_VERSION, type ControlledLearningRecord, type LearningConsent } from "./types";
import type { PersonaProfile } from "../persona";

const SECRET_PATTERNS = [
  /\b(?:sk|sbp|vcp)_[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~-]{12,}\b/gi,
  /\b(?:password|token|cookie|authorization)\s*[:=]\s*\S+/gi,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
];

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function redactLearningText(value: string) {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value);
}

export function createControlledLearningRecord(input: {
  projectId: string;
  candidateId: string;
  taskType: string;
  promptProfile: string;
  retrievedContextRefs: string[];
  candidateText?: string;
  accepted: boolean;
  rejected: boolean;
  userEdited?: boolean;
  editDiff?: string;
  rating?: number;
  reason?: string;
  provider: string;
  model: string;
  storyRevision: number;
  personaProfile?: PersonaProfile;
  directnessPreference?: number;
  languagePrecisionScore?: number;
  reasoningDepth?: number;
  adultMode?: boolean;
  adultLearningExcluded?: boolean;
  userAcceptedTone?: boolean;
  userEditedTone?: boolean;
  overRefusalDetected?: boolean;
  underExplanationDetected?: boolean;
  consent?: LearningConsent;
}): ControlledLearningRecord {
  const consent = input.consent ?? "private_inference_only";
  const adultMode = input.adultMode === true;
  const adultLearningExcluded = input.adultLearningExcluded ?? adultMode;
  return {
    schemaVersion: P22_LEARNING_DATA_VERSION,
    recordId: `learning_${crypto.randomUUID()}`,
    projectIdHash: hash(input.projectId),
    candidateId: input.candidateId,
    taskType: input.taskType,
    promptProfile: input.promptProfile,
    retrievedContextRefs: [...new Set(input.retrievedContextRefs)],
    candidateText: consent === "private_inference_only" ? null : redactLearningText(input.candidateText ?? ""),
    accepted: input.accepted,
    rejected: input.rejected,
    userEdited: input.userEdited ?? false,
    editDiff: consent === "private_inference_only" ? null : redactLearningText(input.editDiff ?? "") || null,
    rating: input.rating == null ? null : Math.max(1, Math.min(5, Math.round(input.rating))),
    reason: input.reason ? redactLearningText(input.reason) : null,
    provider: input.provider,
    model: input.model,
    storyRevision: input.storyRevision,
    personaProfile: input.personaProfile ?? null,
    directnessPreference: input.directnessPreference == null ? null : Math.max(0, Math.min(100, Math.round(input.directnessPreference))),
    languagePrecisionScore: input.languagePrecisionScore == null ? null : Math.max(0, Math.min(100, Math.round(input.languagePrecisionScore))),
    reasoningDepth: input.reasoningDepth == null ? null : Math.max(0, Math.min(100, Math.round(input.reasoningDepth))),
    adultMode,
    adultLearningExcluded,
    userAcceptedTone: input.userAcceptedTone ?? null,
    userEditedTone: input.userEditedTone ?? false,
    overRefusalDetected: input.overRefusalDetected ?? false,
    underExplanationDetected: input.underExplanationDetected ?? false,
    consent,
    exportEligible: consent === "shared_opt_in" && !(adultMode && adultLearningExcluded),
    retention: consent === "shared_opt_in" ? "until_revoked" : "project_lifetime",
    createdAt: new Date().toISOString(),
  };
}

export function assertLearningRecordPrivate(record: ControlledLearningRecord) {
  if (record.consent === "private_inference_only" && (record.candidateText !== null || record.editDiff !== null)) {
    throw Object.assign(new Error("私人推理資料不得保存正文或修改內容。"), { code: "LEARNING_PRIVATE_CONTENT_LEAK" });
  }
  if (record.exportEligible && record.consent !== "shared_opt_in") {
    throw Object.assign(new Error("未明確同意的資料不得進入共享資料集。"), { code: "LEARNING_EXPORT_CONSENT_REQUIRED" });
  }
  if (record.adultMode && record.adultLearningExcluded && record.exportEligible) {
    throw Object.assign(new Error("已排除的成人作品資料不得進入共享資料集。"), { code: "ADULT_LEARNING_EXPORT_BLOCKED" });
  }
}
