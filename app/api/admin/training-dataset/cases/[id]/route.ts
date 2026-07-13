import { requireAdmin } from "@/lib/novel-ai/admin";
import { jsonError } from "@/lib/novel-ai/http";
import { TrainingReviewSchema } from "@/lib/novel-ai/schemas";
import { reviewTrainingExample } from "@/lib/novel-ai/store";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const input = TrainingReviewSchema.parse(await req.json());
    return Response.json(reviewTrainingExample(id, input));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "審核訓練案例失敗。", 400, "TRAINING_REVIEW_ERROR");
  }
}
