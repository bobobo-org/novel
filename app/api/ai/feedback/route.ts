import { FeedbackSchema } from "@/lib/novel-ai/schemas";
import { jsonError } from "@/lib/novel-ai/http";
import { recordFeedback } from "@/lib/novel-ai/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const input = FeedbackSchema.parse(await req.json());
    return Response.json(recordFeedback(input));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "回饋資料格式錯誤。", 400, "VALIDATION_ERROR");
  }
}
