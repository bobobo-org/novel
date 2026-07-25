import crypto from "node:crypto";

export const MODEL_REGISTRY_SCHEMA_VERSION = "p23-model-registry-v1" as const;
export type ModelStatus = "training" | "candidate" | "evaluating" | "approved" | "canary" | "active" | "retired" | "rejected" | "quarantined";

export type SovereignModelRecord = {
  schemaVersion: typeof MODEL_REGISTRY_SCHEMA_VERSION;
  modelId: string;
  baseModel: string;
  adapter: string | null;
  datasetVersion: string;
  trainingMethod: "base" | "sft" | "qlora" | "dpo" | "orpo" | "kto" | "distilled" | "rl";
  capabilities: string[];
  adultMode: boolean;
  benchmark: Record<string, number>;
  knownWeaknesses: string[];
  license: string;
  hash: string;
  createdAt: string;
  approvedAt: string | null;
  status: ModelStatus;
  previousApprovedModelId: string | null;
};

export class SovereignModelRegistry {
  private records = new Map<string, SovereignModelRecord>();
  private activeByNamespace = new Map<"general" | "adult", string>();

  register(input: Omit<SovereignModelRecord, "schemaVersion" | "modelId" | "createdAt" | "approvedAt" | "status">) {
    if (!input.license.trim() || !/^[a-f0-9]{64}$/i.test(input.hash)) throw Object.assign(new Error("模型授權或 hash 無效。"), { code: "MODEL_REGISTRY_PROVENANCE_INVALID" });
    const record: SovereignModelRecord = {
      schemaVersion: MODEL_REGISTRY_SCHEMA_VERSION,
      modelId: `model_${crypto.createHash("sha256").update(`${input.baseModel}|${input.hash}|${input.datasetVersion}`).digest("hex").slice(0, 24)}`,
      ...input,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      status: "candidate",
    };
    this.records.set(record.modelId, record);
    return structuredClone(record);
  }

  transition(modelId: string, status: ModelStatus, userApproved = false) {
    const current = this.records.get(modelId);
    if (!current) throw Object.assign(new Error("模型不存在。"), { code: "MODEL_NOT_FOUND" });
    if ((status === "approved" || status === "active") && !userApproved) throw Object.assign(new Error("模型切換需要使用者核准。"), { code: "MODEL_USER_APPROVAL_REQUIRED" });
    const updated = { ...current, status, approvedAt: status === "approved" || status === "active" ? new Date().toISOString() : current.approvedAt };
    this.records.set(modelId, updated);
    if (status === "active") {
      const namespace = updated.adultMode ? "adult" : "general";
      const previousId = this.activeByNamespace.get(namespace);
      if (previousId && previousId !== modelId) {
        const previous = this.records.get(previousId);
        if (previous) this.records.set(previousId, { ...previous, status: "retired" });
      }
      this.activeByNamespace.set(namespace, modelId);
    }
    return structuredClone(updated);
  }

  rollback(namespace: "general" | "adult", targetModelId: string, userApproved: boolean) {
    const target = this.records.get(targetModelId);
    if (!target || (target.adultMode ? "adult" : "general") !== namespace || !target.approvedAt) {
      throw Object.assign(new Error("回復目標不是同 namespace 的已核准模型。"), { code: "MODEL_ROLLBACK_TARGET_INVALID" });
    }
    return this.transition(targetModelId, "active", userApproved);
  }

  get(modelId: string) { const value = this.records.get(modelId); return value ? structuredClone(value) : null; }
  list() { return [...this.records.values()].map((value) => structuredClone(value)); }
  active(namespace: "general" | "adult") { const id = this.activeByNamespace.get(namespace); return id ? this.get(id) : null; }
}
