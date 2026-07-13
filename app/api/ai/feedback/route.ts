import { FeedbackSchema } from "@/lib/novel-ai/schemas";
import { jsonError } from "@/lib/novel-ai/http";
import { recordFeedback } from "@/lib/novel-ai/store";
import { persistFeedbackFromDbAiRun, persistenceHealth } from "@/lib/novel-ai/persistence";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const input = FeedbackSchema.parse(await req.json());
    try {
      return Response.json({
        ...recordFeedback(input),
        metadata: { dataSource: "memory-cache", persistenceMode: "db-first", cacheHit: true, recoveredFromDatabase: false },
      });
    } catch (memoryError) {
      const persistence = await persistenceHealth();
      if (persistence.persistenceStatus === "ok") {
        return Response.json(await persistFeedbackFromDbAiRun(input));
      }
      throw memoryError;
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "AI 回饋儲存失敗。", 400, "FEEDBACK_SAVE_ERROR");
  }
}
