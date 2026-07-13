import { z } from "zod";
import { createNovelProvider, ModelConfigurationError } from "@/lib/novel-ai/provider";
import { jsonError, timedRun } from "@/lib/novel-ai/http";
import { StoryContextSchema, StoryOptionSchema } from "@/lib/novel-ai/schemas";
import { buildChapterPlanContext } from "@/lib/novel-ai/memory";

export const runtime = "nodejs";
export const maxDuration = 60;

const InputSchema = z.object({
  context: StoryContextSchema,
  selection: StoryOptionSchema,
  authorSupplement: z.string().max(1200).optional(),
});

export async function POST(req: Request) {
  let input;
  try {
    input = InputSchema.parse(await req.json());
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "輸入格式不正確。", 400, "VALIDATION_ERROR");
  }

  try {
    const builtContext = buildChapterPlanContext(input.context);
    const builtInput = { ...input, context: builtContext };
    const { result, aiRun } = await timedRun("chapter_plan", builtContext.projectId, builtContext.chapterId, builtInput, () =>
      createNovelProvider().generateChapterPlan(builtContext, input.selection, input.authorSupplement),
    );
    return Response.json({ chapterPlan: result, aiRunId: aiRun.id, contextSelection: builtContext.contextSelection || [] });
  } catch (error) {
    const status = error instanceof ModelConfigurationError ? 503 : 502;
    return jsonError(error instanceof Error ? error.message : "雲端小說 AI 章節規劃失敗。", status, "MODEL_ERROR");
  }
}
