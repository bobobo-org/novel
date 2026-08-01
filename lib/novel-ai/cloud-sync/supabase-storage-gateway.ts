import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "../storage/supabase/supabase-rest-client";
import {
  CLOUD_SYNC_STORAGE_BUCKET,
  type CloudSyncStorageGateway,
  type CloudSyncStorageObject,
} from "./storage-backend";

type StorageErrorShape = {
  message?: string;
  status?: number;
  statusCode?: number | string;
};

function statusCode(error: unknown) {
  const candidate = error as StorageErrorShape;
  return Number(candidate?.statusCode ?? candidate?.status ?? 0);
}

function storageMessage(error: unknown) {
  return String((error as StorageErrorShape)?.message ?? "SUPABASE_STORAGE_ERROR");
}

function isNotFound(error: unknown) {
  return statusCode(error) === 404 || /not[ _-]?found/i.test(storageMessage(error));
}

function isAlreadyExists(error: unknown) {
  return [400, 409].includes(statusCode(error))
    && /already exists|duplicate|asset exists/i.test(storageMessage(error));
}

function throwStorage(error: unknown) {
  const status = statusCode(error);
  throw Object.assign(new Error(`SUPABASE_STORAGE_HTTP_${status || 500}`), {
    code: `SUPABASE_STORAGE_HTTP_${status || 500}`,
    status: status || 502,
    retryable: status === 0 || status >= 500 || status === 408 || status === 429,
  });
}

function throwEmptyStorageResponse(): never {
  throw Object.assign(new Error("SUPABASE_STORAGE_EMPTY_RESPONSE"), {
    code: "SUPABASE_STORAGE_EMPTY_RESPONSE",
    status: 502,
    retryable: true,
  });
}

function clientFromEnvironment(): SupabaseClient {
  const config = supabaseConfig();
  if (!config.url || !config.key) {
    throw Object.assign(new Error("SUPABASE_STORAGE_NOT_CONFIGURED"), {
      code: "SUPABASE_STORAGE_NOT_CONFIGURED",
      status: 503,
      retryable: false,
    });
  }
  return createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: { "X-Client-Info": "novel-cloud-sync-storage/1.0" },
    },
  });
}

export class SupabaseCloudSyncStorageGateway implements CloudSyncStorageGateway {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient = clientFromEnvironment()) {
    this.client = client;
  }

  async bucketStatus() {
    const { data, error } = await this.client.storage.getBucket(CLOUD_SYNC_STORAGE_BUCKET);
    if (error) {
      if (isNotFound(error)) return { exists: false, public: false };
      throwStorage(error);
    }
    if (!data) throwEmptyStorageResponse();
    return { exists: true, public: Boolean(data.public) };
  }

  async readJson<T>(path: string): Promise<T | null> {
    const { data, error } = await this.client.storage
      .from(CLOUD_SYNC_STORAGE_BUCKET)
      .download(path, { cacheNonce: `${Date.now()}-${crypto.randomUUID()}` }, { cache: "no-store" });
    if (error) {
      if (isNotFound(error)) return null;
      throwStorage(error);
    }
    if (!data) throwEmptyStorageResponse();
    try {
      return JSON.parse(await data.text()) as T;
    } catch {
      throw Object.assign(new Error("SUPABASE_STORAGE_JSON_INVALID"), {
        code: "SUPABASE_STORAGE_JSON_INVALID",
        status: 502,
        retryable: true,
      });
    }
  }

  async writeJson(
    path: string,
    value: unknown,
    options: { upsert: boolean },
  ): Promise<"stored" | "exists"> {
    const body = new Blob([JSON.stringify(value)], { type: "application/json" });
    const { error } = await this.client.storage
      .from(CLOUD_SYNC_STORAGE_BUCKET)
      .upload(path, body, {
        cacheControl: "0",
        contentType: "application/json",
        upsert: options.upsert,
      });
    if (error) {
      if (!options.upsert && isAlreadyExists(error)) return "exists";
      throwStorage(error);
    }
    return "stored";
  }

  async list(prefix: string, limit: number): Promise<CloudSyncStorageObject[]> {
    const { data, error } = await this.client.storage
      .from(CLOUD_SYNC_STORAGE_BUCKET)
      .list(prefix, {
        limit,
        offset: 0,
        sortBy: { column: "updated_at", order: "desc" },
      }, { cache: "no-store" });
    if (error) throwStorage(error);
    if (!data) throwEmptyStorageResponse();
    return data.map((item) => ({ name: item.name }));
  }
}

export function createSupabaseCloudSyncStorageGateway() {
  return new SupabaseCloudSyncStorageGateway();
}
