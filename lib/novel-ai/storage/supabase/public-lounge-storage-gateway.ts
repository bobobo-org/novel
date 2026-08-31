import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  PublicLoungeCatalogCandidatePage,
  PublicLoungeControlPlaneStatus,
  PublicLoungeRateReservation,
  PublicLoungeStorageGateway,
} from "../../public-lounge/storage";
import {
  PUBLIC_LOUNGE_CONTROL_PLANE_MIGRATION_VERSION,
  PUBLIC_LOUNGE_STORAGE_BUCKET,
  PUBLIC_LOUNGE_STORAGE_MARKER_PATH,
  PUBLIC_LOUNGE_STORAGE_MIGRATION_VERSION,
  PUBLIC_LOUNGE_STORAGE_SCHEMA_VERSION,
  isPublicLoungeImmutableStorageObjectPath,
  isPublicLoungeStorageObjectPath,
} from "../../public-lounge/storage";
import { supabaseConfig } from "./supabase-rest-client";

type StorageErrorShape = {
  message?: string;
  status?: number;
  statusCode?: number | string;
};

const PUBLIC_ID_PATTERN = /^novel_[a-z0-9_-]{12,80}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

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

function canonicalIsoTime(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function singleRpcRow(value: unknown) {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return value && typeof value === "object" ? value : null;
}

function assertStoragePath(path: string) {
  if (!isPublicLoungeStorageObjectPath(path)) {
    throw Object.assign(new Error("PUBLIC_LOUNGE_STORAGE_PATH_INVALID"), {
      code: "PUBLIC_LOUNGE_STORAGE_PATH_INVALID",
      status: 500,
    });
  }
  return path;
}

function assertImmutableWritePolicy(path: string, upsert: boolean) {
  if (upsert && isPublicLoungeImmutableStorageObjectPath(path)) {
    throw Object.assign(new Error("PUBLIC_LOUNGE_IMMUTABLE_OBJECT_UPSERT_FORBIDDEN"), {
      code: "PUBLIC_LOUNGE_IMMUTABLE_OBJECT_UPSERT_FORBIDDEN",
      status: 500,
    });
  }
}

function assertMutableDeletePath(path: string) {
  const valid = assertStoragePath(path);
  if (isPublicLoungeImmutableStorageObjectPath(valid)) {
    throw Object.assign(new Error("PUBLIC_LOUNGE_IMMUTABLE_OBJECT_DELETE_FORBIDDEN"), {
      code: "PUBLIC_LOUNGE_IMMUTABLE_OBJECT_DELETE_FORBIDDEN",
      status: 500,
    });
  }
  return valid;
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

  private async rpc(functionName: string, parameters: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(
      functionName as never,
      parameters as never,
    );
    if (error) throwStorage(error);
    return data as unknown;
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

  async controlPlaneStatus(): Promise<PublicLoungeControlPlaneStatus> {
    const row = singleRpcRow(await this.rpc(
      "novel_public_lounge_control_plane_status",
      {},
    )) as Record<string, unknown> | null;
    if (
      row?.migration_version !== PUBLIC_LOUNGE_CONTROL_PLANE_MIGRATION_VERSION
      || row.catalog_ready !== true
      || row.rate_ready !== true
    ) {
      throw Object.assign(new Error("PUBLIC_LOUNGE_CONTROL_PLANE_NOT_READY"), {
        code: "PUBLIC_LOUNGE_CONTROL_PLANE_NOT_READY",
        status: 503,
      });
    }
    return {
      migrationVersion: PUBLIC_LOUNGE_CONTROL_PLANE_MIGRATION_VERSION,
      catalogReady: true,
      rateReady: true,
    };
  }

  async listCatalogCandidates(options: {
    after: { publishedAt: string; publicId: string } | null;
    limit: number;
  }): Promise<PublicLoungeCatalogCandidatePage> {
    const limit = Math.trunc(options.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw Object.assign(new Error("PUBLIC_LOUNGE_CATALOG_LIMIT_INVALID"), {
        code: "PUBLIC_LOUNGE_CATALOG_LIMIT_INVALID",
        status: 500,
      });
    }
    if (options.after && (
      !PUBLIC_ID_PATTERN.test(options.after.publicId)
      || canonicalIsoTime(options.after.publishedAt) !== options.after.publishedAt
    )) {
      throw Object.assign(new Error("PUBLIC_LOUNGE_CATALOG_CURSOR_INVALID"), {
        code: "PUBLIC_LOUNGE_CATALOG_CURSOR_INVALID",
        status: 500,
      });
    }
    const data = await this.rpc("novel_public_lounge_catalog_list", {
      p_after_published_at: options.after?.publishedAt ?? null,
      p_after_public_id: options.after?.publicId ?? null,
      p_limit: limit,
    });
    if (!Array.isArray(data) || data.length > limit) throwEmptyStorageResponse();
    let hasMore = false;
    const items = data.map((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throwEmptyStorageResponse();
      const row = value as Record<string, unknown>;
      const publicId = typeof row.public_id === "string" ? row.public_id : "";
      const publishedAt = canonicalIsoTime(row.published_at);
      if (!PUBLIC_ID_PATTERN.test(publicId) || !publishedAt || typeof row.has_more !== "boolean") {
        throwEmptyStorageResponse();
      }
      if (index === 0) hasMore = row.has_more;
      else if (row.has_more !== hasMore) throwEmptyStorageResponse();
      return { publicId, publishedAt };
    });
    return { items, hasMore: items.length > 0 && hasMore };
  }

  async upsertCatalogAnchor(candidate: { publicId: string; publishedAt: string }) {
    if (
      !PUBLIC_ID_PATTERN.test(candidate.publicId)
      || canonicalIsoTime(candidate.publishedAt) !== candidate.publishedAt
    ) {
      throw Object.assign(new Error("PUBLIC_LOUNGE_CATALOG_ANCHOR_INVALID"), {
        code: "PUBLIC_LOUNGE_CATALOG_ANCHOR_INVALID",
        status: 500,
      });
    }
    const result = await this.rpc("novel_public_lounge_catalog_upsert", {
      p_public_id: candidate.publicId,
      p_published_at: candidate.publishedAt,
    });
    if (result !== true) throwEmptyStorageResponse();
  }

  async deactivateCatalogAnchor(publicId: string) {
    if (!PUBLIC_ID_PATTERN.test(publicId)) {
      throw Object.assign(new Error("PUBLIC_LOUNGE_CATALOG_ANCHOR_INVALID"), {
        code: "PUBLIC_LOUNGE_CATALOG_ANCHOR_INVALID",
        status: 500,
      });
    }
    const result = await this.rpc("novel_public_lounge_catalog_deactivate", {
      p_public_id: publicId,
    });
    if (typeof result !== "boolean") throwEmptyStorageResponse();
  }

  async reserveRate(options: {
    identityHash: string;
    scope: "read" | "eligibility" | "publish" | "management" | "work_mutation";
    now: string;
  }): Promise<PublicLoungeRateReservation> {
    if (!SHA256_PATTERN.test(options.identityHash)) {
      throw Object.assign(new Error("PUBLIC_LOUNGE_RATE_IDENTITY_INVALID"), {
        code: "PUBLIC_LOUNGE_RATE_IDENTITY_INVALID",
        status: 500,
      });
    }
    // Production quota time is deliberately owned by PostgreSQL.  The `now`
    // field exists only so deterministic in-memory gateways can test expiry.
    void options.now;
    const row = singleRpcRow(await this.rpc("novel_public_lounge_rate_reserve", {
      p_identity_hash: options.identityHash,
      p_scope: options.scope,
    })) as Record<string, unknown> | null;
    const quotaLimit = Number(row?.quota_limit);
    const remaining = Number(row?.remaining);
    const retryAfterSeconds = Number(row?.retry_after_seconds);
    if (
      typeof row?.allowed !== "boolean"
      || !Number.isInteger(quotaLimit)
      || quotaLimit < 1
      || !Number.isInteger(remaining)
      || remaining < 0
      || remaining > quotaLimit
      || !Number.isInteger(retryAfterSeconds)
      || retryAfterSeconds < 1
      || retryAfterSeconds > 60
    ) {
      throwEmptyStorageResponse();
    }
    return {
      allowed: row.allowed,
      limit: quotaLimit,
      remaining,
      retryAfterSeconds,
    };
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
    const validPath = assertStoragePath(path);
    assertImmutableWritePolicy(validPath, options.upsert);
    const body = new Blob([JSON.stringify(value)], { type: "application/json" });
    const { error } = await this.client.storage
      .from(PUBLIC_LOUNGE_STORAGE_BUCKET)
      .upload(validPath, body, {
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
      .remove(paths.map(assertMutableDeletePath));
    if (error) throwStorage(error);
  }

}

export function createSupabasePublicLoungeStorageGateway() {
  return new SupabasePublicLoungeStorageGateway();
}
