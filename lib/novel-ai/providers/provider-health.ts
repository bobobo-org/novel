import type { AiProviderId, AiProviderHealthStatus } from "./provider-types";

export type AiProviderHealth = {
  provider: AiProviderId;
  status: AiProviderHealthStatus;
  latencyMs?: number;
  modelCount?: number;
  selectedModel?: string;
  lastErrorCode?: string | null;
  checkedAt: string;
};
