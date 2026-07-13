import { createNovelProvider, ModelConfigurationError } from "@/lib/novel-ai/provider";
import { jsonError, timedRun } from "@/lib/novel-ai/http";
import { StoryContextSchema } from "@/lib/novel-ai/schemas";
import { buildStoryAnalysisContext } from "@/lib/novel-ai/memory";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = StoryContextSchema.parse(await req.json());
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "輸入格式不正確。", 400, "VALIDATION_ERROR");
  }

  try {
    const builtContext = buildStoryAnalysisContext(parsed);
    const { result, aiRun } = await timedRun("story_analysis", builtContext.projectId, builtContext.chapterId, builtContext, () =>
      createNovelProvider().analyzeStory(builtContext),
    );
    return Response.json({ analysis: result, aiRunId: aiRun.id, contextSelection: builtContext.contextSelection || [] });
  } catch (error) {
    const status = error instanceof ModelConfigurationError ? 503 : 502;
    return jsonError(error instanceof Error ? error.message : "雲端小說 AI 分析失敗。", status, "MODEL_ERROR");
  }
}
