import { requireAdmin } from "@/lib/novel-ai/admin";
import { listFeedback, listTrainingExamples } from "@/lib/novel-ai/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || undefined;
  const limit = Number(url.searchParams.get("limit") || 20);
  return Response.json({
    trainingExamples: listTrainingExamples(status as never, limit),
    recentFeedback: listFeedback(limit),
  });
}
