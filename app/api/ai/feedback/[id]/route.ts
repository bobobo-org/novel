import { FeedbackPatchSchema } from "@/lib/novel-ai/schemas";
import { jsonError } from "@/lib/novel-ai/http";
import { patchFeedback } from "@/lib/novel-ai/store";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = FeedbackPatchSchema.parse(await req.json());
    return Response.json(patchFeedback(id, input));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "修改回饋失敗。", 400, "FEEDBACK_PATCH_ERROR");
  }
}
