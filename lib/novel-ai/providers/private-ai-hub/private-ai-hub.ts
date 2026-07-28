import type { PlatformProviderSnapshot } from "../../router/platform-types";
export type PrivateAIJobStatus = "queued" | "running" | "streaming" | "completed" | "failed" | "cancelled" | "expired";
export type PrivateAIJob = { jobId: string; ownerId: string; taskType: string; status: PrivateAIJobStatus; createdAt: string; updatedAt: string; expiresAt: string; result: string | null; error: string | null };
export const privateHubSnapshot: PlatformProviderSnapshot = { id: "private-ai-hub", status: "contract_ready", capabilities: ["text","structured","streaming","long-context"], modelId: null, maxContext: 0, local: false, requiresInternet: true };

export const PRIVATE_AI_HUB_CONTRACT_VERSION = "private-ai-hub-contract-v1" as const;

export type PrivateHubScope = "story:read" | "candidate:write" | "job:cancel" | "audit:read";
export type PrivateHubRequest = {
  contractVersion: typeof PRIVATE_AI_HUB_CONTRACT_VERSION;
  requestId: string;
  ownerId: string;
  projectId: string;
  taskType: string;
  scopes: PrivateHubScope[];
  payloadHash: string;
  contextRefs: string[];
  quotaClass: "interactive" | "batch";
  stream: boolean;
  expiresAt: string;
};

export function validatePrivateHubRequest(value: PrivateHubRequest) {
  const errors: string[] = [];
  if (value.contractVersion !== PRIVATE_AI_HUB_CONTRACT_VERSION) errors.push("UNSUPPORTED_CONTRACT_VERSION");
  if (!value.requestId || !value.ownerId || !value.projectId) errors.push("IDENTITY_REQUIRED");
  if (!value.scopes.includes("story:read")) errors.push("STORY_READ_SCOPE_REQUIRED");
  if (!/^[a-f0-9]{64}$/i.test(value.payloadHash)) errors.push("PAYLOAD_HASH_INVALID");
  if (Date.parse(value.expiresAt) <= Date.now()) errors.push("REQUEST_EXPIRED");
  if (value.contextRefs.length > 500) errors.push("CONTEXT_REFERENCE_LIMIT");
  return { valid: errors.length === 0, errors };
}
