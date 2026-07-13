import { requireAdmin } from "@/lib/novel-ai/admin";
import { listFeedback, listTrainingExamples } from "@/lib/novel-ai/store";
import { listFeedbackFromDb, listTrainingExamplesFromDb, persistenceHealth } from "@/lib/novel-ai/persistence";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || undefined;
  const limit = Number(url.searchParams.get("limit") || 20);
  const projectId = url.searchParams.get("projectId") || undefined;
  const persistence = await persistenceHealth();
  if (persistence.persistenceStatus === "ok") {
    try {
      const [trainingExamples, recentFeedback] = await Promise.all([
        listTrainingExamplesFromDb(status, limit, projectId),
        listFeedbackFromDb(limit, projectId),
      ]);
      return Response.json({
        trainingExamples: trainingExamples.rows,
        recentFeedback: recentFeedback.rows,
        metadata: { dataSource: "database", persistenceMode: "db-first", cacheHit: false, recoveredFromDatabase: true, projectScoped: Boolean(projectId) },
      });
    } catch (error) {
      return Response.json({
        trainingExamples: listTrainingExamples(status as never, limit),
        recentFeedback: listFeedback(limit),
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
  return Response.json({
    trainingExamples: listTrainingExamples(status as never, limit),
    recentFeedback: listFeedback(limit),
    metadata: { dataSource: "memory-fallback", persistenceMode: "memory", cacheHit: true, recoveredFromDatabase: false },
  });
}
