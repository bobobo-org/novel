import { trainingStats } from "@/lib/novel-ai/store";
import { requireAdmin } from "@/lib/novel-ai/admin";
import { dbTrainingStats, persistenceHealth } from "@/lib/novel-ai/persistence";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const memoryStats = trainingStats();
  const persistence = await persistenceHealth();
  if (persistence.persistenceStatus === "ok") {
    try {
      const stats = await dbTrainingStats(memoryStats.versions);
      return Response.json({ ...stats, metadata: { dataSource: "database", persistenceMode: "db-first", cacheHit: false, recoveredFromDatabase: true } });
    } catch (error) {
      return Response.json({
        ...memoryStats,
        metadata: {
          dataSource: "memory-fallback",
          persistenceMode: "db-first",
          cacheHit: false,
          recoveredFromDatabase: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  return Response.json({ ...memoryStats, metadata: { dataSource: "memory-fallback", persistenceMode: "memory", cacheHit: true, recoveredFromDatabase: false } });
}
