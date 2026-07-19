import type { PlatformProviderSnapshot } from "../../router/platform-types";
export type PrivateAIJobStatus = "queued" | "running" | "streaming" | "completed" | "failed" | "cancelled" | "expired";
export type PrivateAIJob = { jobId: string; ownerId: string; taskType: string; status: PrivateAIJobStatus; createdAt: string; updatedAt: string; expiresAt: string; result: string | null; error: string | null };
export const privateHubSnapshot: PlatformProviderSnapshot = { id: "private-ai-hub", status: "contract_ready", capabilities: ["text","structured","streaming","long-context"], modelId: null, maxContext: 0, local: false, requiresInternet: true };
