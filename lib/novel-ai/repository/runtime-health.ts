import type { NovelRepository } from "./contracts";
import { createNovelRepository } from "./index";
import {
  INDEXEDDB_MIGRATION_VERSION,
  INDEXEDDB_STORAGE_SCHEMA_VERSION,
  persistenceFailure,
  type PersistenceFailure,
} from "./persistence-recovery";

export const PERSISTENCE_RUNTIME_HEALTH_SCHEMA_VERSION =
  "persistence-runtime-health-v3" as const;

export type PersistenceRuntimeMode =
  | "LOCAL_ONLY"
  | "LOCAL_PLUS_CLOUD"
  | "CLOUD_DEGRADED"
  | "LOCAL_BLOCKED";

export type CloudPersistenceSnapshot = {
  provider: "Supabase";
  status: string;
  migrationStatus: string;
  writeProbeStatus: string | null;
  lastSuccessfulWriteAt: string | null;
  errorCategory: string | null;
  retryable: boolean;
  canonicalAuthority: "Supabase" | "IndexedDBFallback";
};

export type PersistenceRuntimeHealth = {
  schemaVersion: typeof PERSISTENCE_RUNTIME_HEALTH_SCHEMA_VERSION;
  migrationVersion: typeof INDEXEDDB_MIGRATION_VERSION;
  persistenceBackend: "indexeddb";
  degraded: boolean;
  memoryFallback: false;
  databaseErrorCode: PersistenceFailure["databaseErrorCode"] | null;
  fallbackReason: PersistenceFailure["fallbackReason"] | null;
  mode: PersistenceRuntimeMode;
  localCanonicalStorage: {
    schemaVersion: typeof INDEXEDDB_STORAGE_SCHEMA_VERSION;
    migrationVersion: typeof INDEXEDDB_MIGRATION_VERSION;
    provider: "IndexedDB";
    backend: "indexeddb";
    role: "materialized-replica-and-offline-outbox";
    status: "ready" | "blocked";
    degraded: boolean;
    memoryFallback: false;
    repositoryKind: NovelRepository["kind"];
    databaseErrorCode: PersistenceFailure["databaseErrorCode"] | null;
    fallbackReason: PersistenceFailure["fallbackReason"] | null;
    errorCode: PersistenceFailure["databaseErrorCode"] | null;
  };
  cloudPersistence: CloudPersistenceSnapshot;
  localFeaturesAvailable: boolean;
  cloudSyncAvailable: boolean;
  canonicalAuthority: "Supabase" | "IndexedDBFallback";
  canonApprovalAuthority: "human-approved-transactions";
  silentMemoryFallback: false;
  checkedAt: string;
};

export function derivePersistenceRuntimeMode(input: {
  localReady: boolean;
  cloudStatus: string;
}): PersistenceRuntimeMode {
  if (!input.localReady) return "LOCAL_BLOCKED";
  if (["ok", "healthy", "ready", "online"].includes(input.cloudStatus)) {
    return "LOCAL_PLUS_CLOUD";
  }
  if (
    input.cloudStatus === "not_configured"
    || input.cloudStatus === "missing_env"
  ) {
    return "LOCAL_ONLY";
  }
  return "CLOUD_DEGRADED";
}

async function readCloudPersistenceHealth(
  signal?: AbortSignal,
): Promise<CloudPersistenceSnapshot> {
  try {
    const response = await fetch("/api/persistence/health", {
      cache: "no-store",
      signal,
    });
    const body = await response.json() as {
      cloudPersistence?: Partial<CloudPersistenceSnapshot>;
    };
    const cloud = body.cloudPersistence ?? {};
    return {
      provider: "Supabase",
      status: String(cloud.status ?? (response.ok ? "unknown" : "error")),
      migrationStatus: String(cloud.migrationStatus ?? "unknown"),
      writeProbeStatus: cloud.writeProbeStatus === undefined
        ? null
        : String(cloud.writeProbeStatus),
      lastSuccessfulWriteAt: cloud.lastSuccessfulWriteAt ?? null,
      errorCategory: cloud.errorCategory ?? null,
      retryable: Boolean(cloud.retryable),
      canonicalAuthority: cloud.canonicalAuthority === "Supabase"
        ? "Supabase"
        : "IndexedDBFallback",
    };
  } catch {
    return {
      provider: "Supabase",
      status: "unreachable",
      migrationStatus: "unknown",
      writeProbeStatus: null,
      lastSuccessfulWriteAt: null,
      errorCategory: "connectivity",
      retryable: true,
      canonicalAuthority: "IndexedDBFallback",
    };
  }
}

export async function resolvePersistenceRuntimeHealth(options: {
  repository?: NovelRepository;
  cloudReader?: (
    signal?: AbortSignal,
  ) => Promise<CloudPersistenceSnapshot>;
  signal?: AbortSignal;
} = {}): Promise<PersistenceRuntimeHealth> {
  const repository = options.repository ?? createNovelRepository();
  let localReady = repository.kind === "indexeddb" && repository.isAvailable();
  let localFailure: PersistenceFailure | null = localReady
    ? null
    : persistenceFailure(new Error("INDEXEDDB_UNAVAILABLE"), "INDEXEDDB_UNAVAILABLE");
  if (localReady) {
    try {
      await repository.list("projects");
    } catch (error) {
      localReady = false;
      localFailure = persistenceFailure(error, "INDEXEDDB_OPEN_FAILED");
    }
  }
  const cloud = await (options.cloudReader ?? readCloudPersistenceHealth)(
    options.signal,
  );
  const mode = derivePersistenceRuntimeMode({
    localReady,
    cloudStatus: cloud.status,
  });
  return {
    schemaVersion: PERSISTENCE_RUNTIME_HEALTH_SCHEMA_VERSION,
    migrationVersion: INDEXEDDB_MIGRATION_VERSION,
    persistenceBackend: "indexeddb",
    degraded: !localReady,
    memoryFallback: false,
    databaseErrorCode: localFailure?.databaseErrorCode ?? null,
    fallbackReason: localFailure?.fallbackReason ?? null,
    mode,
    localCanonicalStorage: {
      schemaVersion: INDEXEDDB_STORAGE_SCHEMA_VERSION,
      migrationVersion: INDEXEDDB_MIGRATION_VERSION,
      provider: "IndexedDB",
      backend: "indexeddb",
      role: "materialized-replica-and-offline-outbox",
      status: localReady ? "ready" : "blocked",
      degraded: !localReady,
      memoryFallback: false,
      repositoryKind: repository.kind,
      databaseErrorCode: localFailure?.databaseErrorCode ?? null,
      fallbackReason: localFailure?.fallbackReason ?? null,
      errorCode: localFailure?.databaseErrorCode ?? null,
    },
    cloudPersistence: cloud,
    localFeaturesAvailable: localReady,
    cloudSyncAvailable: mode === "LOCAL_PLUS_CLOUD",
    canonicalAuthority: mode === "LOCAL_PLUS_CLOUD"
      ? "Supabase"
      : "IndexedDBFallback",
    canonApprovalAuthority: "human-approved-transactions",
    silentMemoryFallback: false,
    checkedAt: new Date().toISOString(),
  };
}
