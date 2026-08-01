import "server-only";
import { isSupabaseConfigured } from "../storage/supabase/supabase-rest-client";
import {
  cloudStorageHealth,
  listStorageCloudProjects,
  pullStorageCloudProject,
  pushStorageCloudProject,
} from "./storage-backend";
import { createSupabaseCloudSyncStorageGateway } from "./supabase-storage-gateway";
import {
  CLOUD_SYNC_SCHEMA_VERSION,
  type CloudSyncHealth,
  type CloudSyncPushRequest,
} from "./types";

export function readCloudSyncOwnerId(request: Request) {
  const value = request.headers.get("x-novel-sync-owner")?.trim() ?? "";
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw Object.assign(new Error("請提供有效的雲端同步擁有者識別碼。"), {
      code: "CLOUD_SYNC_AUTH_REQUIRED",
      status: 401,
      retryable: false,
    });
  }
  return value;
}

function configurationRequiredHealth(): CloudSyncHealth {
  return {
    schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
    provider: "Supabase",
    storageBackend: "private-object-storage",
    encryption: "client-side-aes-gcm",
    canonicalAuthority: "IndexedDBFallback",
    authorityProtocol: "remote-revision-and-ciphertext-hash-v1",
    status: "configuration_required",
    migrationVersion: null,
    retryable: false,
  };
}

export async function cloudSyncServerHealth(): Promise<CloudSyncHealth> {
  if (!isSupabaseConfigured()) return configurationRequiredHealth();
  return cloudStorageHealth(createSupabaseCloudSyncStorageGateway());
}

export async function listCloudProjects(ownerId: string) {
  return listStorageCloudProjects(createSupabaseCloudSyncStorageGateway(), ownerId);
}

export async function pullCloudProject(ownerId: string, projectId: string) {
  return pullStorageCloudProject(
    createSupabaseCloudSyncStorageGateway(),
    ownerId,
    projectId,
  );
}

export async function pushCloudProject(
  ownerId: string,
  request: CloudSyncPushRequest,
) {
  return pushStorageCloudProject(
    createSupabaseCloudSyncStorageGateway(),
    ownerId,
    request,
  );
}
