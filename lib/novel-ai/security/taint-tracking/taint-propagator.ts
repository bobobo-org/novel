import { createTaintEnvelope, type TaintEnvelope, type TaintLabel } from "./taint-label";

const TRUST_ORDER: TaintEnvelope["trustLevel"][] = ["system", "user_approved", "canonical", "candidate", "untrusted"];

export function propagateTaint(input: {
  stage: string;
  content: string;
  parents: TaintEnvelope[];
  additionalLabels?: TaintLabel[];
  detectedSignals?: string[];
}): TaintEnvelope {
  if (!input.parents.length) throw Object.assign(new Error("Taint propagation requires a source envelope."), { code: "TAINT_PARENT_REQUIRED" });
  const trustLevel = input.parents.reduce<TaintEnvelope["trustLevel"]>(
    (least, parent) => TRUST_ORDER.indexOf(parent.trustLevel) > TRUST_ORDER.indexOf(least) ? parent.trustLevel : least,
    "system",
  );
  const blockedUsages = [...new Set(input.parents.flatMap((parent) => parent.blockedUsages))];
  const propagated = createTaintEnvelope({
    sourceId: input.parents.map((parent) => parent.sourceId).sort().join("+"),
    sourceType: input.stage,
    sourceRevision: input.parents.map((parent) => parent.sourceRevision).sort().join("+"),
    content: input.content,
    trustLevel,
    taintLabels: [...new Set([...input.parents.flatMap((parent) => parent.taintLabels), ...(input.additionalLabels ?? [])])],
    sanitizationStatus: input.parents.some((parent) => parent.sanitizationStatus === "quarantined")
      ? "quarantined"
      : input.parents.some((parent) => parent.sanitizationStatus === "sanitized")
        ? "sanitized"
        : "unchanged",
    detectedSignals: [...input.parents.flatMap((parent) => parent.detectedSignals), ...(input.detectedSignals ?? [])],
  });
  propagated.blockedUsages = blockedUsages;
  propagated.allowedUsages = propagated.allowedUsages.filter((usage) => !blockedUsages.includes(usage));
  return propagated;
}
