import crypto from "node:crypto";

export const TAINT_TRACKING_SCHEMA_VERSION = "p23-taint-tracking-v1" as const;
export const TAINT_LABELS = [
  "UNTRUSTED_DOCUMENT",
  "UNTRUSTED_WEB_CONTENT",
  "USER_AUTHORED_CONTENT",
  "STORY_CANONICAL",
  "STORY_CANDIDATE",
  "SYSTEM_DEFINED",
  "ADULT_CONTENT",
  "EXTERNAL_TRANSFER_RESTRICTED",
  "TRAINING_EXCLUDED",
  "PROMPT_INJECTION_SUSPECTED",
] as const;

export type TaintLabel = (typeof TAINT_LABELS)[number];
export type TaintTrustLevel = "system" | "user_approved" | "canonical" | "candidate" | "untrusted";
export type TaintUsage =
  | "citation"
  | "retrieval"
  | "generation_context"
  | "evaluation"
  | "tool_request"
  | "provider_selection"
  | "external_transfer"
  | "approval"
  | "canonical_mutation"
  | "training";

export type TaintEnvelope = {
  schemaVersion: typeof TAINT_TRACKING_SCHEMA_VERSION;
  sourceId: string;
  sourceType: string;
  sourceRevision: string;
  contentHash: string;
  trustLevel: TaintTrustLevel;
  taintLabels: TaintLabel[];
  sanitizationStatus: "unchanged" | "sanitized" | "quarantined";
  detectedSignals: string[];
  allowedUsages: TaintUsage[];
  blockedUsages: TaintUsage[];
};

export function taintContentHash(content: string) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function createTaintEnvelope(input: {
  sourceId: string;
  sourceType: string;
  sourceRevision?: string;
  content: string;
  trustLevel: TaintTrustLevel;
  taintLabels?: TaintLabel[];
  sanitizationStatus?: TaintEnvelope["sanitizationStatus"];
  detectedSignals?: string[];
}): TaintEnvelope {
  const privileged = ["system", "user_approved", "canonical"].includes(input.trustLevel);
  return {
    schemaVersion: TAINT_TRACKING_SCHEMA_VERSION,
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    sourceRevision: input.sourceRevision ?? "unversioned",
    contentHash: taintContentHash(input.content),
    trustLevel: input.trustLevel,
    taintLabels: [...new Set(input.taintLabels ?? [])],
    sanitizationStatus: input.sanitizationStatus ?? "unchanged",
    detectedSignals: [...new Set(input.detectedSignals ?? [])],
    allowedUsages: ["citation", "retrieval", "generation_context", "evaluation"],
    blockedUsages: privileged
      ? []
      : ["tool_request", "provider_selection", "external_transfer", "approval", "canonical_mutation", "training"],
  };
}

export function validateTaintEnvelope(value: TaintEnvelope) {
  if (value.schemaVersion !== TAINT_TRACKING_SCHEMA_VERSION) return { valid: false, errorCode: "TAINT_SCHEMA_UNSUPPORTED" };
  if (!value.sourceId || !value.sourceType || !value.sourceRevision || !/^[a-f0-9]{64}$/.test(value.contentHash)) {
    return { valid: false, errorCode: "TAINT_SOURCE_IDENTITY_INVALID" };
  }
  if (value.taintLabels.some((label) => !TAINT_LABELS.includes(label))) return { valid: false, errorCode: "TAINT_LABEL_INVALID" };
  return { valid: true, errorCode: null };
}
