import { NextResponse } from "next/server";
import { persistenceHealth } from "@/lib/novel-ai/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorCategory(status: string, databaseStatus: string) {
  if (status === "ok") return null;
  if (databaseStatus === "missing_env") return "configuration";
  if (status === "migration_required") return "migration";
  return "connectivity";
}

export async function GET() {
  const cloud = await persistenceHealth();
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
      status: cloud.persistenceStatus,
      migrationStatus: cloud.migrationVersion
        ? "current"
        : cloud.persistenceStatus === "not_configured"
          ? "not_configured"
          : "required_or_unknown",
      writeProbeStatus,
      lastSuccessfulWriteAt: cloud.lastSuccessfulWriteAt,
      errorCategory: errorCategory(
        cloud.persistenceStatus,
        cloud.databaseStatus,
      ),
      retryable: cloud.databaseStatus === "error",
    },
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Novel-Runtime-Surface": "persistence",
    },
  });
}
