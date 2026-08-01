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

export const CLOUD_SYNC_STORAGE_BUCKET = "novel-cloud-sync-e2ee";
export const CLOUD_SYNC_STORAGE_MARKER_PATH = `_system/${CLOUD_SYNC_MIGRATION_VERSION}.json`;

const MAX_CIPHERTEXT_CHARACTERS = 3_600_000;

export type CloudSyncStorageObject = { name: string };

export type CloudSyncStorageGateway = {
  bucketStatus(): Promise<{ exists: boolean; public: boolean }>;
  readJson<T>(path: string): Promise<T | null>;
  writeJson(
    path: string,
    value: unknown,
    options: { upsert: boolean },
  ): Promise<"stored" | "exists">;
  list(prefix: string, limit: number): Promise<CloudSyncStorageObject[]>;
};

type StorageMarker = {
  schemaVersion: typeof CLOUD_SYNC_SCHEMA_VERSION;
  migrationVersion: typeof CLOUD_SYNC_MIGRATION_VERSION;
  backend: "private-object-storage";
  public: false;
};

type StorageHead = {
  schemaVersion: typeof CLOUD_SYNC_SCHEMA_VERSION;
  migrationVersion: typeof CLOUD_SYNC_MIGRATION_VERSION;
  projectId: string;
  revision: number;
  payloadHash: string;
  encryptedBytes: number;
  operationId: string;
  snapshotPath: string;
  updatedAt: string;
};

type StorageSnapshot = StorageHead & {
  envelope: EncryptedCloudSnapshot;
};

type StorageLock = {
  schemaVersion: typeof CLOUD_SYNC_SCHEMA_VERSION;
  migrationVersion: typeof CLOUD_SYNC_MIGRATION_VERSION;
  projectId: string;
  operationId: string;
  expectedRevision: number;
  payloadHash: string;
  snapshotPath: string;
  createdAt: string;
};

function cloudSyncError(
  code: string,
  status: number,
  retryable: boolean,
  message: string,
) {
  return Object.assign(new Error(message), { code, status, retryable });
}

function headPrefix(ownerId: string) {
  return `owners/${ownerId}/heads`;
}

function headPath(ownerId: string, projectId: string) {
  return `${headPrefix(ownerId)}/${projectId}.json`;
}

function lockPath(ownerId: string, projectId: string, expectedRevision: number) {
  return `owners/${ownerId}/locks/${projectId}/${expectedRevision}.json`;
}

function snapshotPath(
  ownerId: string,
  projectId: string,
  revision: number,
  payloadHash: string,
) {
  return `owners/${ownerId}/snapshots/${projectId}/${String(revision).padStart(12, "0")}-${payloadHash}.json`;
}

function validProjectId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/u.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{8,160}$/u.test(value);
}

function validHead(value: unknown): value is StorageHead {
  if (!value || typeof value !== "object") return false;
  const head = value as Partial<StorageHead>;
  return head.schemaVersion === CLOUD_SYNC_SCHEMA_VERSION
    && head.migrationVersion === CLOUD_SYNC_MIGRATION_VERSION
    && validProjectId(head.projectId)
    && Number.isSafeInteger(head.revision)
    && Number(head.revision) > 0
    && validHash(head.payloadHash)
    && Number.isSafeInteger(head.encryptedBytes)
    && Number(head.encryptedBytes) > 0
    && validOperationId(head.operationId)
    && typeof head.snapshotPath === "string"
    && head.snapshotPath.length > 0
    && typeof head.updatedAt === "string"
    && Number.isFinite(Date.parse(head.updatedAt));
}

function validateEnvelope(request: CloudSyncPushRequest) {
  const { envelope } = request;
  if (
    !validProjectId(request.projectId)
    || request.projectId !== envelope?.projectId
    || envelope.schemaVersion !== CLOUD_SYNC_SCHEMA_VERSION
    || envelope.algorithm !== "AES-GCM-256"
    || !["gzip", "none"].includes(envelope.compression)
    || !/^[A-Za-z0-9_-]{16}$/u.test(envelope.iv)
    || !validHash(envelope.ciphertextHash)
    || !validHash(envelope.plaintextHash)
    || !Number.isSafeInteger(envelope.encryptedBytes)
    || envelope.encryptedBytes < 1
    || envelope.encryptedBytes > 2_700_000
    || envelope.ciphertext.length > MAX_CIPHERTEXT_CHARACTERS
    || !/^[A-Za-z0-9_-]+$/u.test(envelope.ciphertext)
  ) {
    throw cloudSyncError(
      "CLOUD_SYNC_ENVELOPE_INVALID",
      400,
      false,
      "雲端同步加密封包格式不正確。",
    );
  }
  if (!validOperationId(request.operationId)) {
    throw cloudSyncError(
      "CLOUD_SYNC_OPERATION_INVALID",
      400,
      false,
      "雲端同步操作識別碼不正確。",
    );
  }
  if (!Number.isSafeInteger(request.expectedRemoteRevision) || request.expectedRemoteRevision < 0) {
    throw cloudSyncError(
      "CLOUD_SYNC_REVISION_INVALID",
      400,
      false,
      "雲端同步版本號不正確。",
    );
  }
}

function summary(head: StorageHead): CloudProjectRemoteSummary {
  return {
    projectId: head.projectId,
    revision: head.revision,
    payloadHash: head.payloadHash,
    encryptedBytes: head.encryptedBytes,
    updatedAt: head.updatedAt,
  };
}

function conflict(
  projectId: string,
  head: StorageHead | null,
): CloudSyncPushResult {
  return {
    status: "conflict",
    projectId,
    revision: head?.revision ?? 0,
    payloadHash: head?.payloadHash ?? "",
    updatedAt: head?.updatedAt ?? new Date(0).toISOString(),
  };
}

async function readHead(
  gateway: CloudSyncStorageGateway,
  ownerId: string,
  projectId: string,
) {
  const value = await gateway.readJson<unknown>(headPath(ownerId, projectId));
  if (value === null) return null;
  if (!validHead(value) || value.projectId !== projectId) {
    throw cloudSyncError(
      "CLOUD_SYNC_STORAGE_CORRUPT",
      502,
      true,
      "雲端同步索引完整性檢查失敗。",
    );
  }
  return value;
}

export async function cloudStorageHealth(
  gateway: CloudSyncStorageGateway,
): Promise<CloudSyncHealth> {
  const base = {
    schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
    provider: "Supabase" as const,
    storageBackend: "private-object-storage" as const,
    encryption: "client-side-aes-gcm" as const,
    canonicalAuthority: "IndexedDB" as const,
  };
  try {
    const bucket = await gateway.bucketStatus();
    if (!bucket.exists || bucket.public) {
      return {
        ...base,
        status: "migration_required",
        migrationVersion: null,
        retryable: false,
      };
    }
    const marker = await gateway.readJson<StorageMarker>(CLOUD_SYNC_STORAGE_MARKER_PATH);
    if (
      marker?.schemaVersion !== CLOUD_SYNC_SCHEMA_VERSION
      || marker.migrationVersion !== CLOUD_SYNC_MIGRATION_VERSION
      || marker.backend !== "private-object-storage"
      || marker.public !== false
    ) {
      return {
        ...base,
        status: "migration_required",
        migrationVersion: null,
        retryable: false,
      };
    }
    return {
      ...base,
      status: "ready",
      migrationVersion: CLOUD_SYNC_MIGRATION_VERSION,
      retryable: false,
    };
  } catch {
    return {
      ...base,
      status: "degraded",
      migrationVersion: null,
      retryable: true,
    };
  }
}

export async function listStorageCloudProjects(
  gateway: CloudSyncStorageGateway,
  ownerId: string,
): Promise<CloudProjectRemoteSummary[]> {
  const objects = await gateway.list(headPrefix(ownerId), 200);
  const heads = await Promise.all(objects
    .filter((item) => /^[A-Za-z0-9_-]{1,160}\.json$/u.test(item.name))
    .map(async (item) => {
      const projectId = item.name.slice(0, -5);
      return readHead(gateway, ownerId, projectId);
    }));
  return heads
    .filter((head): head is StorageHead => head !== null)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .map(summary);
}

export async function pullStorageCloudProject(
  gateway: CloudSyncStorageGateway,
  ownerId: string,
  projectId: string,
): Promise<CloudSyncPullResult> {
  if (!validProjectId(projectId)) {
    throw cloudSyncError(
      "CLOUD_SYNC_PROJECT_ID_INVALID",
      400,
      false,
      "作品識別碼格式不正確。",
    );
  }
  const head = await readHead(gateway, ownerId, projectId);
  if (!head) {
    throw cloudSyncError(
      "CLOUD_SYNC_PROJECT_NOT_FOUND",
      404,
      false,
      "雲端找不到這部作品。",
    );
  }
  const snapshot = await gateway.readJson<StorageSnapshot>(head.snapshotPath);
  if (
    !snapshot
    || !validHead(snapshot)
    || snapshot.projectId !== projectId
    || snapshot.revision !== head.revision
    || snapshot.payloadHash !== head.payloadHash
    || snapshot.envelope?.ciphertextHash !== head.payloadHash
    || snapshot.envelope.projectId !== projectId
  ) {
    throw cloudSyncError(
      "CLOUD_SYNC_STORAGE_CORRUPT",
      502,
      true,
      "雲端同步快照完整性檢查失敗。",
    );
  }
  return { ...summary(head), envelope: snapshot.envelope };
}

export async function pushStorageCloudProject(
  gateway: CloudSyncStorageGateway,
  ownerId: string,
  request: CloudSyncPushRequest,
): Promise<CloudSyncPushResult> {
  validateEnvelope(request);
  const expectedRevision = request.expectedRemoteRevision;
  const nextRevision = expectedRevision + 1;
  const payloadHash = request.envelope.ciphertextHash;
  const immutableSnapshotPath = snapshotPath(
    ownerId,
    request.projectId,
    nextRevision,
    payloadHash,
  );
  const revisionLockPath = lockPath(ownerId, request.projectId, expectedRevision);
  let head = await readHead(gateway, ownerId, request.projectId);
  let lock = await gateway.readJson<StorageLock>(revisionLockPath);

  if (lock) {
    if (
      lock.operationId !== request.operationId
      || lock.projectId !== request.projectId
      || lock.expectedRevision !== expectedRevision
      || lock.payloadHash !== payloadHash
    ) {
      if ((head?.revision ?? 0) !== expectedRevision) return conflict(request.projectId, head);
      throw cloudSyncError(
        "CLOUD_SYNC_WRITE_IN_PROGRESS",
        503,
        true,
        "另一個雲端同步操作正在完成，稍後會自動重試。",
      );
    }
    if (
      head?.revision === nextRevision
      && head.operationId === request.operationId
      && head.payloadHash === payloadHash
    ) {
      return { ...summary(head), status: "idempotent" };
    }
  } else if ((head?.revision ?? 0) !== expectedRevision) {
    return conflict(request.projectId, head);
  }

  const now = new Date().toISOString();
  const snapshot: StorageSnapshot = {
    schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
    migrationVersion: CLOUD_SYNC_MIGRATION_VERSION,
    projectId: request.projectId,
    revision: nextRevision,
    payloadHash,
    encryptedBytes: request.envelope.encryptedBytes,
    operationId: request.operationId,
    snapshotPath: immutableSnapshotPath,
    updatedAt: now,
    envelope: request.envelope,
  };
  const snapshotWrite = await gateway.writeJson(
    immutableSnapshotPath,
    snapshot,
    { upsert: false },
  );
  if (snapshotWrite === "exists") {
    const existing = await gateway.readJson<StorageSnapshot>(immutableSnapshotPath);
    if (
      !existing
      || existing.projectId !== request.projectId
      || existing.revision !== nextRevision
      || existing.payloadHash !== payloadHash
      || existing.envelope?.ciphertextHash !== payloadHash
    ) {
      throw cloudSyncError(
        "CLOUD_SYNC_IDEMPOTENCY_MISMATCH",
        409,
        false,
        "相同版本已有不同的加密快照。",
      );
    }
  }

  if (!lock) {
    const proposedLock: StorageLock = {
      schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
      migrationVersion: CLOUD_SYNC_MIGRATION_VERSION,
      projectId: request.projectId,
      operationId: request.operationId,
      expectedRevision,
      payloadHash,
      snapshotPath: immutableSnapshotPath,
      createdAt: now,
    };
    const lockWrite = await gateway.writeJson(
      revisionLockPath,
      proposedLock,
      { upsert: false },
    );
    lock = lockWrite === "stored"
      ? proposedLock
      : await gateway.readJson<StorageLock>(revisionLockPath);
    if (
      !lock
      || lock.operationId !== request.operationId
      || lock.payloadHash !== payloadHash
    ) {
      head = await readHead(gateway, ownerId, request.projectId);
      if ((head?.revision ?? 0) !== expectedRevision) return conflict(request.projectId, head);
      throw cloudSyncError(
        "CLOUD_SYNC_WRITE_IN_PROGRESS",
        503,
        true,
        "另一個雲端同步操作正在完成，稍後會自動重試。",
      );
    }
  }

  head = await readHead(gateway, ownerId, request.projectId);
  if (
    head?.revision === nextRevision
    && head.operationId === request.operationId
    && head.payloadHash === payloadHash
  ) {
    return { ...summary(head), status: "idempotent" };
  }
  if ((head?.revision ?? 0) !== expectedRevision) return conflict(request.projectId, head);

  const nextHead: StorageHead = {
    schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
    migrationVersion: CLOUD_SYNC_MIGRATION_VERSION,
    projectId: request.projectId,
    revision: nextRevision,
    payloadHash,
    encryptedBytes: request.envelope.encryptedBytes,
    operationId: request.operationId,
    snapshotPath: immutableSnapshotPath,
    updatedAt: now,
  };
  await gateway.writeJson(
    headPath(ownerId, request.projectId),
    nextHead,
    { upsert: true },
  );
  const verified = await readHead(gateway, ownerId, request.projectId);
  if (
    !verified
    || verified.revision !== nextRevision
    || verified.operationId !== request.operationId
    || verified.payloadHash !== payloadHash
  ) {
    throw cloudSyncError(
      "CLOUD_SYNC_STORAGE_VERIFY_FAILED",
      502,
      true,
      "雲端同步寫入後驗證失敗。",
    );
  }
  return { ...summary(verified), status: "stored" };
}
