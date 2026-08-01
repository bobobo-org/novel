import { NextResponse } from "next/server";
import { persistenceHealth } from "@/lib/novel-ai/persistence";
import { cloudSyncServerHealth } from "@/lib/novel-ai/cloud-sync/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorCategory(status: string, databaseStatus: string) {
  if (status === "ok") return null;
  if (databaseStatus === "missing_env") return "configuration";
  if (status === "migration_required") return "migration";
  return "connectivity";
}

export async function GET() {
  const [cloud, sync] = await Promise.all([
    persistenceHealth(),
    cloudSyncServerHealth(),
  ]);
  const effectiveCloudStatus = sync.status === "ready"
    ? "ready"
    : sync.status === "migration_required"
      ? "migration_required"
      : cloud.persistenceStatus;
  const writeProbe = cloud.writeTestStatus;
  const writeProbeStatus = writeProbe && typeof writeProbe === "object"
    ? writeProbe.status
    : writeProbe;

  return NextResponse.json({
    localCanonicalStorage: {
      provider: "IndexedDB",
      scope: "client",
      runtimeStatus: "client_probe_required",
    },
    cloudPersistence: {
      provider: "Supabase",
      status: effectiveCloudStatus,
      migrationStatus: sync.status === "ready"
        ? "current"
        : sync.status === "migration_required"
          ? "sync_required"
        : cloud.migrationVersion
          ? "base_current_sync_required"
          : cloud.persistenceStatus === "not_configured"
            ? "not_configured"
            : "required_or_unknown",
      syncProtocolStatus: sync.status,
      syncMigrationVersion: sync.migrationVersion,
      syncStorageBackend: sync.storageBackend,
      encryption: sync.encryption,
      canonicalAuthority: sync.canonicalAuthority,
      writeProbeStatus,
      lastSuccessfulWriteAt: cloud.lastSuccessfulWriteAt,
      errorCategory: sync.status === "ready"
        ? null
        : sync.status === "migration_required"
          ? "migration"
          : errorCategory(cloud.persistenceStatus, cloud.databaseStatus),
      retryable: sync.retryable || cloud.databaseStatus === "error",
    },
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Novel-Runtime-Surface": "persistence",
    },
  });
}
