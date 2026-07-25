import type { TaintEnvelope, TaintUsage } from "./taint-label";
import { evaluateTaintUsage } from "./trust-policy";

export const TAINT_AUDIT_SCHEMA_VERSION = "p23-taint-audit-v1" as const;

export function createTaintAudit(input: { requestId: string; stage: string; usage: TaintUsage; taint: TaintEnvelope }) {
  const decision = evaluateTaintUsage(input.taint, input.usage);
  return {
    schemaVersion: TAINT_AUDIT_SCHEMA_VERSION,
    requestId: input.requestId,
    stage: input.stage,
    usage: input.usage,
    sourceId: input.taint.sourceId,
    sourceRevision: input.taint.sourceRevision,
    contentHash: input.taint.contentHash,
    taintLabels: input.taint.taintLabels,
    sanitizationStatus: input.taint.sanitizationStatus,
    decision: decision.allowed ? "allowed" : "blocked",
    errorCode: decision.errorCode,
    createdAt: new Date().toISOString(),
  };
}
