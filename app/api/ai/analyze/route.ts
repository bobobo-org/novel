import { createNovelProvider, ModelConfigurationError } from "@/lib/novel-ai/provider";
import { jsonError, timedRun } from "@/lib/novel-ai/http";
import { StoryContextSchema } from "@/lib/novel-ai/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = StoryContextSchema.parse(await req.json());
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "輸入格式錯誤。", 400, "VALIDATION_ERROR");
  }

  try {
    const { result, aiRun } = await timedRun("story_analysis", parsed.projectId, parsed.chapterId, parsed, () =>
      createNovelProvider().analyzeStory(parsed),
    );
    return Response.json({ analysis: result, aiRunId: aiRun.id });
  } catch (error) {
    const status = error instanceof ModelConfigurationError ? 503 : 502;
    return jsonError(error instanceof Error ? error.message : "雲端 AI 分析失敗。", status, "MODEL_ERROR");
  }
}
