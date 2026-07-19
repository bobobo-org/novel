export type CapabilityStatus = "ready" | "partial" | "contract_ready" | "client_dependent" | "runtime_unavailable" | "not_connected" | "unsupported" | "not_implemented" | "degraded" | "failed";

export type CapabilityReport = {
  id: string;
  contractStatus: CapabilityStatus;
  runtimeStatus: CapabilityStatus;
  effectiveStatus: CapabilityStatus;
  evidence: string[];
  limitations: string[];
  checkedAt: string;
};
