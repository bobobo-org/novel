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
      status: sync.status === "ready" ? "ready" : cloud.persistenceStatus,
      migrationStatus: sync.status === "ready"
        ? "current"
        : cloud.migrationVersion
          ? "base_current_sync_required"
          : cloud.persistenceStatus === "not_configured"
            ? "not_configured"
            : "required_or_unknown",
      syncProtocolStatus: sync.status,
      syncMigrationVersion: sync.migrationVersion,
      encryption: sync.encryption,
      canonicalAuthority: sync.canonicalAuthority,
      writeProbeStatus,
      lastSuccessfulWriteAt: cloud.lastSuccessfulWriteAt,
      errorCategory: sync.status === "ready"
        ? null
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
