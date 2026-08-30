import type { ExternalAIProviderPublicStatus } from
  "@/lib/novel-ai/providers/external/external-provider-contract";

export type ConversationExternalProviderSnapshot = {
  providers?: ExternalAIProviderPublicStatus[];
  executionEnabled?: boolean;
};

type StatusFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const EXTERNAL_PROVIDER_STATUS_TIMEOUT_MS = 10_000;

let activeExternalProviderSnapshotRequest:
  Promise<ConversationExternalProviderSnapshot> | null = null;

export function requestConversationExternalProviderSnapshot(
  options: {
    fetchImpl?: StatusFetch;
    timeoutMs?: number;
  } = {},
) {
  if (activeExternalProviderSnapshotRequest) return activeExternalProviderSnapshotRequest;

  const controller = new AbortController();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1, options.timeoutMs ?? EXTERNAL_PROVIDER_STATUS_TIMEOUT_MS);
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort("EXTERNAL_PROVIDER_STATUS_TIMEOUT");
      reject(Object.assign(
        new Error("外來 AI 接點狀態讀取逾時，稍後會自動重新取得。"),
        { code: "EXTERNAL_PROVIDER_STATUS_TIMEOUT" },
      ));
    }, timeoutMs);
  });
  const remote = fetchImpl("/api/ai/external/providers", {
    cache: "no-store",
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) throw new Error("外來 AI 接點狀態暫時無法讀取。");
    return response.json() as Promise<ConversationExternalProviderSnapshot>;
  });
  const request = Promise.race([remote, timeout]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (activeExternalProviderSnapshotRequest === request) {
      activeExternalProviderSnapshotRequest = null;
    }
  });
  activeExternalProviderSnapshotRequest = request;
  return request;
}
