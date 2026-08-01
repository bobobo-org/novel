import "server-only";
import { supabaseRest } from "../storage/supabase/supabase-rest-client";
import {
  CLOUD_SYNC_MIGRATION_VERSION,
  CLOUD_SYNC_SCHEMA_VERSION,
  type CloudProjectRemoteSummary,
  type CloudSyncHealth,
  type CloudSyncPullResult,
  type CloudSyncPushRequest,
  type CloudSyncPushResult,
  type EncryptedCloudSnapshot,
} from "./types";

const MAX_CIPHERTEXT_CHARACTERS = 3_600_000;

type SnapshotRow = {
  project_id: string;
  revision: number | string;
  payload_hash: string;
  encrypted_bytes: number | string;
  envelope_json?: EncryptedCloudSnapshot;
  updated_at: string;
};

function configAvailable() {
  return Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL)
    && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function readCloudSyncOwnerId(request: Request) {
  const value = request.headers.get("x-novel-sync-owner")?.trim() ?? "";
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw Object.assign(new Error("缺少有效的雲端同步復原金鑰。"), {
      code: "CLOUD_SYNC_AUTH_REQUIRED",
      status: 401,
      retryable: false,
    });
  }
  return value;
}

export async function cloudSyncServerHealth(): Promise<CloudSyncHealth> {
  const base = {
    schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
    provider: "Supabase" as const,
    encryption: "client-side-aes-gcm" as const,
    canonicalAuthority: "IndexedDB" as const,
  };
  if (!configAvailable()) {
    return {
      ...base,
      status: "configuration_required",
      migrationVersion: null,
      retryable: false,
    };
  }
  try {
    const [migrations] = await Promise.all([
      supabaseRest<Array<{ version: string }>>("schema_migrations", {
        query: `select=version&version=eq.${CLOUD_SYNC_MIGRATION_VERSION}&limit=1`,
      }),
      supabaseRest<SnapshotRow[]>("novel_cloud_snapshots", {
        query: "select=project_id&limit=1",
      }),
    ]);
    if (!migrations.some((row) => row.version === CLOUD_SYNC_MIGRATION_VERSION)) {
      return { ...base, status: "migration_required", migrationVersion: null, retryable: false };
    }
    return {
      ...base,
      status: "ready",
      migrationVersion: CLOUD_SYNC_MIGRATION_VERSION,
      retryable: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const migrationRequired = /(?:404|PGRST205|novel_cloud_snapshots|schema_migrations)/iu.test(message);
    return {
      ...base,
      status: migrationRequired ? "migration_required" : "degraded",
      migrationVersion: null,
      retryable: !migrationRequired,
    };
  }
}

function validateEnvelope(request: CloudSyncPushRequest) {
  const { envelope } = request;
  if (
    request.projectId !== envelope?.projectId
    || envelope.schemaVersion !== CLOUD_SYNC_SCHEMA_VERSION
    || envelope.algorithm !== "AES-GCM-256"
    || !["gzip", "none"].includes(envelope.compression)
    || !/^[A-Za-z0-9_-]{16}$/u.test(envelope.iv)
    || !/^[a-f0-9]{64}$/u.test(envelope.ciphertextHash)
    || !/^[a-f0-9]{64}$/u.test(envelope.plaintextHash)
    || !Number.isSafeInteger(envelope.encryptedBytes)
    || envelope.encryptedBytes < 1
    || envelope.ciphertext.length > MAX_CIPHERTEXT_CHARACTERS
    || !/^[A-Za-z0-9_-]+$/u.test(envelope.ciphertext)
  ) {
    throw Object.assign(new Error("雲端同步密文格式不正確。"), {
      code: "CLOUD_SYNC_ENVELOPE_INVALID",
      status: 400,
      retryable: false,
    });
  }
}

export async function listCloudProjects(ownerId: string): Promise<CloudProjectRemoteSummary[]> {
  const rows = await supabaseRest<SnapshotRow[]>("novel_cloud_snapshots", {
    query: `owner_id=eq.${ownerId}&select=project_id,revision,payload_hash,encrypted_bytes,updated_at&order=updated_at.desc&limit=200`,
  });
  return rows.map((row) => ({
    projectId: row.project_id,
    revision: Number(row.revision),
    payloadHash: row.payload_hash,
    encryptedBytes: Number(row.encrypted_bytes),
    updatedAt: row.updated_at,
  }));
}

export async function pullCloudProject(ownerId: string, projectId: string): Promise<CloudSyncPullResult> {
  const rows = await supabaseRest<SnapshotRow[]>("novel_cloud_snapshots", {
    query: `owner_id=eq.${ownerId}&project_id=eq.${encodeURIComponent(projectId)}&select=project_id,revision,payload_hash,encrypted_bytes,envelope_json,updated_at&limit=1`,
  });
  const row = rows[0];
  if (!row?.envelope_json) {
    throw Object.assign(new Error("雲端找不到這部作品。"), {
      code: "CLOUD_SYNC_PROJECT_NOT_FOUND",
      status: 404,
      retryable: false,
    });
  }
  return {
    projectId: row.project_id,
    revision: Number(row.revision),
    payloadHash: row.payload_hash,
    encryptedBytes: Number(row.encrypted_bytes),
    updatedAt: row.updated_at,
    envelope: row.envelope_json,
  };
}

export async function pushCloudProject(
  ownerId: string,
  request: CloudSyncPushRequest,
): Promise<CloudSyncPushResult> {
  validateEnvelope(request);
  if (!/^[A-Za-z0-9:_-]{8,160}$/u.test(request.operationId)) {
    throw Object.assign(new Error("同步操作身分不正確。"), {
      code: "CLOUD_SYNC_OPERATION_INVALID",
      status: 400,
      retryable: false,
    });
  }
  if (!Number.isSafeInteger(request.expectedRemoteRevision) || request.expectedRemoteRevision < 0) {
    throw Object.assign(new Error("同步版本不正確。"), {
      code: "CLOUD_SYNC_REVISION_INVALID",
      status: 400,
      retryable: false,
    });
  }
  const rows = await supabaseRest<Array<{
    result_status: CloudSyncPushResult["status"];
    result_revision: number | string;
    result_payload_hash: string;
    result_updated_at: string;
  }>>("rpc/novel_cloud_sync_push", {
    method: "POST",
    body: JSON.stringify({
      p_owner_id: ownerId,
      p_project_id: request.projectId,
      p_operation_id: request.operationId,
      p_expected_revision: request.expectedRemoteRevision,
      p_payload_hash: request.envelope.ciphertextHash,
      p_encrypted_bytes: request.envelope.encryptedBytes,
      p_envelope_json: request.envelope,
    }),
  });
  const row = rows[0];
  if (!row) throw Object.assign(new Error("雲端同步沒有回傳版本。"), {
    code: "CLOUD_SYNC_EMPTY_RESPONSE",
    status: 502,
    retryable: true,
  });
  return {
    status: row.result_status,
    projectId: request.projectId,
    revision: Number(row.result_revision),
    payloadHash: row.result_payload_hash,
    updatedAt: row.result_updated_at,
  };
}
