export const CLOUD_SYNC_MUTATION_EVENT = "novel:cloud-sync-mutation";
export const CLOUD_SYNC_STATUS_EVENT = "novel:cloud-sync-status";

export type CloudSyncMutationDetail = {
  projectId: string;
  source: string;
  occurredAt: string;
};

export function notifyCloudSyncMutation(projectId: string, source: string) {
  if (typeof window === "undefined" || !projectId) return;
  window.dispatchEvent(new CustomEvent<CloudSyncMutationDetail>(
    CLOUD_SYNC_MUTATION_EVENT,
    { detail: { projectId, source, occurredAt: new Date().toISOString() } },
  ));
}
