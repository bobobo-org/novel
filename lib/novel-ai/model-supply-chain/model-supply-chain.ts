export const MODEL_SUPPLY_CHAIN_SCHEMA_VERSION = "p23-model-supply-chain-v1" as const;

export type ModelLifecycleStatus =
  | "discovered"
  | "quarantined"
  | "scanning"
  | "evaluating"
  | "approved"
  | "canary"
  | "active"
  | "rejected"
  | "retired";

export type ModelSupplyChainRecord = {
  schemaVersion: typeof MODEL_SUPPLY_CHAIN_SCHEMA_VERSION;
  modelId: string;
  modelName: string;
  source: string;
  downloadUrl: string | null;
  sourceType: "local_existing" | "approved_registry" | "unknown";
  digest: string;
  fileSize: number;
  format: "gguf" | "safetensors" | "onnx" | "unknown";
  quantization: string | null;
  baseModel: string | null;
  adapterBaseCompatibility: "compatible" | "incompatible" | "not_applicable" | "unknown";
  license: string | null;
  commercialUseAllowed: boolean;
  modificationAllowed: boolean;
  distillationAllowed: boolean;
  malwareScanStatus: "not_scanned" | "clean" | "suspicious" | "blocked";
  approvalStatus: ModelLifecycleStatus;
  createdAt: string;
};

export function validateModelSupplyChain(record: ModelSupplyChainRecord, observed: {
  digest: string;
  fileSize: number;
  archiveEntries?: string[];
}) {
  const errors: string[] = [];
  if (!/^(?:sha256:)?[a-f0-9]{64}$/i.test(record.digest) || record.digest.replace(/^sha256:/i, "") !== observed.digest.replace(/^sha256:/i, "")) errors.push("MODEL_DIGEST_MISMATCH");
  if (record.fileSize <= 0 || record.fileSize !== observed.fileSize) errors.push("MODEL_FILE_SIZE_MISMATCH");
  if (record.sourceType === "unknown" || !record.source) errors.push("MODEL_SOURCE_UNAPPROVED");
  if (record.format === "unknown") errors.push("MODEL_FORMAT_UNSUPPORTED");
  if (!record.license) errors.push("MODEL_LICENSE_MISSING");
  if (!record.commercialUseAllowed) errors.push("MODEL_COMMERCIAL_USE_FORBIDDEN");
  if (record.malwareScanStatus !== "clean") errors.push("MODEL_MALWARE_SCAN_NOT_CLEAN");
  if (record.adapterBaseCompatibility === "incompatible") errors.push("MODEL_ADAPTER_BASE_INCOMPATIBLE");
  if ((observed.archiveEntries ?? []).some((entry) => /\.(?:exe|dll|ps1|bat|cmd|scr)$/i.test(entry))) errors.push("MODEL_PACKAGE_EXECUTABLE_BLOCKED");
  return { valid: errors.length === 0, errors };
}

export function transitionModelStatus(record: ModelSupplyChainRecord, next: ModelLifecycleStatus, validationPassed: boolean) {
  const transitions: Record<ModelLifecycleStatus, ModelLifecycleStatus[]> = {
    discovered: ["quarantined", "rejected"],
    quarantined: ["scanning", "rejected"],
    scanning: ["evaluating", "rejected"],
    evaluating: ["approved", "rejected"],
    approved: ["canary", "retired"],
    canary: ["active", "rejected", "retired"],
    active: ["retired"],
    rejected: [],
    retired: [],
  };
  if (!transitions[record.approvalStatus].includes(next)) {
    throw Object.assign(new Error("Invalid model lifecycle transition."), { code: "MODEL_STATUS_TRANSITION_INVALID" });
  }
  if ((next === "approved" || next === "canary" || next === "active") && !validationPassed) {
    throw Object.assign(new Error("Unapproved model activation blocked."), { code: "UNAPPROVED_MODEL_ACTIVATION_BLOCKED" });
  }
  return { ...record, approvalStatus: next };
}
