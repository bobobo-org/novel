import { z } from "zod";
import { createNovelProvider, ModelConfigurationError } from "@/lib/novel-ai/provider";
import { jsonError, timedRun } from "@/lib/novel-ai/http";
import { StoryContextSchema } from "@/lib/novel-ai/schemas";
import { buildContinuityContext } from "@/lib/novel-ai/memory";

export const runtime = "nodejs";
export const maxDuration = 60;

const InputSchema = z.object({
  context: StoryContextSchema,
  candidateText: z.string().min(1).max(8000),
});

export async function POST(req: Request) {
  let input;
  try {
    input = InputSchema.parse(await req.json());
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "輸入格式不正確。", 400, "VALIDATION_ERROR");
  }

  try {
    const builtContext = buildContinuityContext(input.context);
    const builtInput = { ...input, context: builtContext };
    const { result, aiRun } = await timedRun("continuity_review", builtContext.projectId, builtContext.chapterId, builtInput, () =>
      createNovelProvider().reviewContinuity(builtContext, input.candidateText),
    );
    return Response.json({ review: result, aiRunId: aiRun.id, contextSelection: builtContext.contextSelection || [] });
  } catch (error) {
    const status = error instanceof ModelConfigurationError ? 503 : 502;
    return jsonError(error instanceof Error ? error.message : "雲端 AI 一致性檢查失敗。", status, "MODEL_ERROR");
  }
}
