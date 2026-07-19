import { CAPABILITY_REGISTRY } from "./capability-registry";
import type { CapabilityReport, CapabilityStatus } from "./capability-status";

const effective = (contract: CapabilityStatus, runtime: CapabilityStatus): CapabilityStatus => {
  if (["failed", "degraded", "not_implemented", "unsupported"].includes(contract)) return contract;
  if (runtime === "ready") return contract === "ready" ? "ready" : contract;
  if (runtime === "client_dependent" && contract === "ready") return "client_dependent";
  return runtime;
};

export function resolveCapabilityCatalog(runtimeOverrides: Record<string, CapabilityStatus> = {}): Record<string, CapabilityReport> {
  const checkedAt = new Date().toISOString();
  return Object.fromEntries(CAPABILITY_REGISTRY.map((definition) => {
    const runtimeStatus = runtimeOverrides[definition.id] ?? definition.runtimeStatus;
    return [definition.id, { id: definition.id, contractStatus: definition.contractStatus, runtimeStatus, effectiveStatus: effective(definition.contractStatus, runtimeStatus), evidence: [...definition.evidence], limitations: [...(definition.limitations ?? [])], checkedAt } satisfies CapabilityReport];
  }));
}

export function capabilityStatus(catalog: Record<string, CapabilityReport>, id: string) {
  return catalog[id]?.effectiveStatus ?? "not_implemented";
}
