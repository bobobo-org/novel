import type {
  CloudProjectRemoteSummary,
  CloudSyncHealth,
  CloudSyncPullResult,
  CloudSyncPushRequest,
  CloudSyncPushResult,
} from "./types";
import { cloudSyncOwnerId } from "./crypto";

type Fetcher = typeof fetch;

function apiError(code: string, message: string, status: number, retryable: boolean) {
  return Object.assign(new Error(message), { code, status, retryable });
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as {
    errorCode?: string;
    message?: string;
  } & T;
  if (!response.ok) {
    throw apiError(
      body.errorCode ?? `CLOUD_SYNC_HTTP_${response.status}`,
      body.message ?? "雲端同步暫時無法完成，本機資料不受影響。",
      response.status,
      response.status >= 500 || response.status === 408 || response.status === 429,
    );
  }
  return body;
}

export class CloudSyncApiClient {
  private readonly fetcher: Fetcher;
  private readonly basePath: string;

  constructor(
    fetcher: Fetcher = fetch,
    basePath = "/api/persistence/sync",
  ) {
    this.fetcher = fetcher;
    this.basePath = basePath;
  }

  health(signal?: AbortSignal) {
    return this.fetcher(`${this.basePath}/health?probe=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
      signal,
    }).then(async (response) => {
      const body = await response.json().catch(() => null) as CloudSyncHealth | null;
      if (body?.schemaVersion && body.provider === "Supabase") return body;
      throw apiError(
        `CLOUD_SYNC_HTTP_${response.status}`,
        "雲端同步健康檢查回傳了無法辨識的結果。",
        response.status,
        response.status >= 500,
      );
    });
  }

  async list(syncKey: string, signal?: AbortSignal) {
    const ownerId = await cloudSyncOwnerId(syncKey);
    return this.fetcher(this.basePath, {
      cache: "no-store",
      credentials: "omit",
      headers: { "x-novel-sync-owner": ownerId },
      signal,
    }).then((response) => parseResponse<{ projects: CloudProjectRemoteSummary[] }>(response));
  }

  async pull(syncKey: string, projectId: string, signal?: AbortSignal) {
    const ownerId = await cloudSyncOwnerId(syncKey);
    return this.fetcher(`${this.basePath}?projectId=${encodeURIComponent(projectId)}`, {
      cache: "no-store",
      credentials: "omit",
      headers: { "x-novel-sync-owner": ownerId },
      signal,
    }).then((response) => parseResponse<CloudSyncPullResult>(response));
  }

  async push(syncKey: string, request: CloudSyncPushRequest, signal?: AbortSignal) {
    const ownerId = await cloudSyncOwnerId(syncKey);
    return this.fetcher(this.basePath, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
        "x-novel-sync-owner": ownerId,
      },
      body: JSON.stringify(request),
      signal,
    }).then((response) => parseResponse<CloudSyncPushResult>(response));
  }
}
