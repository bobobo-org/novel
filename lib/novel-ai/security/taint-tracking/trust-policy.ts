import type { TaintEnvelope, TaintUsage } from "./taint-label";

const PRIVILEGED_USAGES = new Set<TaintUsage>([
  "tool_request",
  "provider_selection",
  "external_transfer",
  "approval",
  "canonical_mutation",
  "training",
]);

export function evaluateTaintUsage(taint: TaintEnvelope, usage: TaintUsage) {
  if (taint.blockedUsages.includes(usage)) return { allowed: false, errorCode: `TAINT_USAGE_BLOCKED_${usage.toUpperCase()}` };
  if (PRIVILEGED_USAGES.has(usage) && ["candidate", "untrusted"].includes(taint.trustLevel)) {
    return { allowed: false, errorCode: "UNTRUSTED_CONTENT_PRIVILEGE_ESCALATION_BLOCKED" };
  }
  return { allowed: true, errorCode: null };
}

export function assertTaintUsage(taint: TaintEnvelope, usage: TaintUsage) {
  const decision = evaluateTaintUsage(taint, usage);
  if (!decision.allowed) throw Object.assign(new Error(`Tainted content cannot be used for ${usage}.`), decision);
  return decision;
}
