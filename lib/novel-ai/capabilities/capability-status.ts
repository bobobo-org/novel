export type CapabilityStatus = "ready" | "started" | "partial" | "contract_only" | "contract_ready" | "client_dependent" | "runtime_unavailable" | "not_connected" | "unsupported" | "not_started" | "not_implemented" | "degraded" | "failed";

export type CapabilityReport = {
  id: string;
  contractStatus: CapabilityStatus;
  runtimeStatus: CapabilityStatus;
  effectiveStatus: CapabilityStatus;
  evidence: string[];
  limitations: string[];
  checkedAt: string;
};
