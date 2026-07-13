import { FeedbackSchema } from "@/lib/novel-ai/schemas";
import { jsonError } from "@/lib/novel-ai/http";
import { recordFeedback } from "@/lib/novel-ai/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const input = FeedbackSchema.parse(await req.json());
    return Response.json(recordFeedback(input));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "AI 回饋保存失敗，但作品正文與原有 AI 結果仍然安全。", 400, "FEEDBACK_SAVE_ERROR");
  }
}
