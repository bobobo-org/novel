import type { NovelRepository } from "./contracts";
import { createNovelRepository } from "./index";

export const PERSISTENCE_RUNTIME_HEALTH_SCHEMA_VERSION =
  "persistence-runtime-health-v1" as const;

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
};

export type PersistenceRuntimeHealth = {
  schemaVersion: typeof PERSISTENCE_RUNTIME_HEALTH_SCHEMA_VERSION;
  mode: PersistenceRuntimeMode;
  localCanonicalStorage: {
    provider: "IndexedDB";
    status: "ready" | "blocked";
    repositoryKind: NovelRepository["kind"];
    errorCode: string | null;
  };
  cloudPersistence: CloudPersistenceSnapshot;
  localFeaturesAvailable: boolean;
  cloudSyncAvailable: boolean;
  canonicalAuthority: "IndexedDB";
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
  let localErrorCode: string | null = localReady
    ? null
    : "INDEXEDDB_UNAVAILABLE";
  if (localReady) {
    try {
      await repository.list("projects");
    } catch (error) {
      localReady = false;
      localErrorCode = String(
        (error as { code?: string })?.code
        || (error as Error)?.message
        || "INDEXEDDB_OPEN_FAILED",
      );
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
    mode,
    localCanonicalStorage: {
      provider: "IndexedDB",
      status: localReady ? "ready" : "blocked",
      repositoryKind: repository.kind,
      errorCode: localErrorCode,
    },
    cloudPersistence: cloud,
    localFeaturesAvailable: localReady,
    cloudSyncAvailable: mode === "LOCAL_PLUS_CLOUD",
    canonicalAuthority: "IndexedDB",
    silentMemoryFallback: false,
    checkedAt: new Date().toISOString(),
  };
}
