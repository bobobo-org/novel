export type BrowserFabricResidentModel = {
  modelId: string;
  engineId: string;
  estimatedMemoryMB: number;
  heavy: boolean;
  inUse: boolean;
  lastUsedAt: number;
};

export class BrowserFabricMemoryManager {
  private readonly residents = new Map<string, BrowserFabricResidentModel>();
  private readonly budgetMB: number;

  constructor(budgetMB: number) {
    this.budgetMB = budgetMB;
  }

  register(model: BrowserFabricResidentModel) {
    const otherHeavy = [...this.residents.values()].find((candidate) =>
      candidate.heavy && candidate.inUse && candidate.modelId !== model.modelId);
    if (model.heavy && model.inUse && otherHeavy) {
      throw Object.assign(new Error("Only one heavy browser model may be active."), {
        code: "BROWSER_FABRIC_HEAVY_MODEL_BUSY",
        activeModelId: otherHeavy.modelId,
      });
    }
    this.residents.set(model.modelId, { ...model });
  }

  release(modelId: string) {
    const model = this.residents.get(modelId);
    if (model) this.residents.set(modelId, { ...model, inUse: false, lastUsedAt: Date.now() });
  }

  evictionPlan(requiredMB: number) {
    const current = [...this.residents.values()].reduce((sum, item) => sum + item.estimatedMemoryMB, 0);
    if (current + requiredMB <= this.budgetMB) return [];
    let reclaim = current + requiredMB - this.budgetMB;
    const plan: BrowserFabricResidentModel[] = [];
    for (const candidate of [...this.residents.values()]
      .filter((item) => !item.inUse)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)) {
      plan.push(candidate);
      reclaim -= candidate.estimatedMemoryMB;
      if (reclaim <= 0) break;
    }
    return plan;
  }

  confirmEviction(modelIds: string[], userConfirmed: boolean) {
    if (!userConfirmed && modelIds.length) {
      throw Object.assign(new Error("Model eviction requires explicit user confirmation."), {
        code: "BROWSER_MODEL_EVICTION_CONFIRMATION_REQUIRED",
      });
    }
    for (const modelId of modelIds) this.residents.delete(modelId);
  }

  snapshot() {
    return {
      budgetMB: this.budgetMB,
      usedMB: [...this.residents.values()].reduce((sum, item) => sum + item.estimatedMemoryMB, 0),
      residents: [...this.residents.values()].map((item) => ({ ...item })),
    };
  }
}
