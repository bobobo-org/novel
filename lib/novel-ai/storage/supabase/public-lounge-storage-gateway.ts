import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  PublicLoungeStorageGateway,
  PublicLoungeStorageObject,
} from "../../public-lounge/storage";
import {
  PUBLIC_LOUNGE_STORAGE_BUCKET,
  PUBLIC_LOUNGE_STORAGE_MARKER_PATH,
  PUBLIC_LOUNGE_STORAGE_MIGRATION_VERSION,
  PUBLIC_LOUNGE_STORAGE_SCHEMA_VERSION,
} from "../../public-lounge/storage";
import { supabaseConfig } from "./supabase-rest-client";

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
  return statusCode(error) === 404 || /not[ _-]?found/iu.test(storageMessage(error));
}

function isAlreadyExists(error: unknown) {
  return [400, 409].includes(statusCode(error))
    && /already exists|duplicate|asset exists/iu.test(storageMessage(error));
}

function throwStorage(error: unknown): never {
  const status = statusCode(error);
  throw Object.assign(new Error(`SUPABASE_STORAGE_HTTP_${status || 500}`), {
    code: `SUPABASE_STORAGE_HTTP_${status || 500}`,
    status: status || 502,
  });
}

function throwEmptyStorageResponse(): never {
  throw Object.assign(new Error("SUPABASE_STORAGE_EMPTY_RESPONSE"), {
    code: "SUPABASE_STORAGE_EMPTY_RESPONSE",
    status: 502,
  });
}

function assertStoragePath(path: string) {
  if (!(
    /^public-lounge-v1\/(?:index|posts)\/novel_[a-z0-9_-]{12,80}\.json$/u.test(path)
    || /^public-lounge-v1\/eligibility\/(?:issued|consumed|attestations)\/[a-f0-9]{64}\.json$/u.test(path)
  )) {
    throw Object.assign(new Error("PUBLIC_LOUNGE_STORAGE_PATH_INVALID"), {
      code: "PUBLIC_LOUNGE_STORAGE_PATH_INVALID",
      status: 500,
    });
  }
  return path;
}

function clientFromEnvironment(): SupabaseClient {
  const config = supabaseConfig();
  if (!config.url || !config.key) {
    throw Object.assign(new Error("SUPABASE_STORAGE_NOT_CONFIGURED"), {
      code: "SUPABASE_STORAGE_NOT_CONFIGURED",
      status: 503,
    });
  }
  return createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: { "X-Client-Info": "novel-public-lounge-storage/1.0" },
    },
  });
}

export class SupabasePublicLoungeStorageGateway implements PublicLoungeStorageGateway {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient = clientFromEnvironment()) {
    this.client = client;
  }

  async bucketStatus() {
    const { data, error } = await this.client.storage.getBucket(PUBLIC_LOUNGE_STORAGE_BUCKET);
    if (error) {
      if (isNotFound(error)) return { exists: false, public: false, provisioned: false };
      throwStorage(error);
    }
    if (!data) throwEmptyStorageResponse();
    if (data.public) return { exists: true, public: true, provisioned: false };
    const markerDownload = await this.client.storage
      .from(PUBLIC_LOUNGE_STORAGE_BUCKET)
      .download(
        PUBLIC_LOUNGE_STORAGE_MARKER_PATH,
        { cacheNonce: `${Date.now()}-${crypto.randomUUID()}` },
        { cache: "no-store" },
      );
    if (markerDownload.error) {
      if (isNotFound(markerDownload.error)) {
        return { exists: true, public: false, provisioned: false };
      }
      throwStorage(markerDownload.error);
    }
    if (!markerDownload.data) throwEmptyStorageResponse();
    try {
      const marker = JSON.parse(await markerDownload.data.text()) as Record<string, unknown>;
      return {
        exists: true,
        public: false,
        provisioned: marker.schemaVersion === PUBLIC_LOUNGE_STORAGE_SCHEMA_VERSION
          && marker.migrationVersion === PUBLIC_LOUNGE_STORAGE_MIGRATION_VERSION
          && marker.backend === "private-object-storage"
          && marker.public === false,
      };
    } catch {
      return { exists: true, public: false, provisioned: false };
    }
  }

  async readJson<T>(path: string): Promise<T | null> {
    const { data, error } = await this.client.storage
      .from(PUBLIC_LOUNGE_STORAGE_BUCKET)
      .download(assertStoragePath(path), { cacheNonce: `${Date.now()}-${crypto.randomUUID()}` }, { cache: "no-store" });
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
      });
    }
  }

  async writeJson(path: string, value: unknown, options: { upsert: boolean }): Promise<"stored" | "exists"> {
    const body = new Blob([JSON.stringify(value)], { type: "application/json" });
    const { error } = await this.client.storage
      .from(PUBLIC_LOUNGE_STORAGE_BUCKET)
      .upload(assertStoragePath(path), body, {
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

  async deleteJson(paths: string[]) {
    if (paths.length === 0) return;
    const { error } = await this.client.storage
      .from(PUBLIC_LOUNGE_STORAGE_BUCKET)
      .remove(paths.map(assertStoragePath));
    if (error) throwStorage(error);
  }

  async list(prefix: string, options: { limit: number; offset: number }): Promise<PublicLoungeStorageObject[]> {
    if (prefix !== "public-lounge-v1/index") {
      throw Object.assign(new Error("PUBLIC_LOUNGE_STORAGE_PATH_INVALID"), {
        code: "PUBLIC_LOUNGE_STORAGE_PATH_INVALID",
        status: 500,
      });
    }
    const { data, error } = await this.client.storage
      .from(PUBLIC_LOUNGE_STORAGE_BUCKET)
      .list(prefix, {
        limit: Math.max(1, Math.min(200, Math.trunc(options.limit))),
        offset: Math.max(0, Math.trunc(options.offset)),
        sortBy: { column: "name", order: "asc" },
      }, { cache: "no-store" });
    if (error) throwStorage(error);
    if (!data) throwEmptyStorageResponse();
    return data.map((item) => ({ name: item.name }));
  }
}

export function createSupabasePublicLoungeStorageGateway() {
  return new SupabasePublicLoungeStorageGateway();
}
