import { jsonError } from "@/lib/novel-ai/http";
import { requireAdmin } from "@/lib/novel-ai/admin";
import { rejectStoryBibleCandidate, StoryBibleMutationError } from "@/lib/novel-ai/story-bible";
import { z } from "zod";

export const runtime = "nodejs";

function mutationError(error: unknown) {
  if (error instanceof StoryBibleMutationError) {
    return Response.json({
      errorCode: error.errorCode,
      stage: "reject",
      retryable: Boolean(error.details.retryable),
      userMessage: error.message,
      ...error.details,
    }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return Response.json({
      errorCode: "INVALID_MUTATION_REQUEST",
      stage: "reject",
      retryable: false,
      userMessage: "Reject request 欄位不完整或格式錯誤。",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    }, { status: 400 });
  }
  return jsonError(
    error instanceof Error ? error.message : "Story Bible reject failed.",
    500,
    "STORY_BIBLE_REJECT_FAILED",
  );
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const denied = requireAdmin(req);
    if (denied) return denied;
    const { id } = await ctx.params;
    const result = await rejectStoryBibleCandidate(id, await req.json());
    return Response.json(result);
  } catch (error) {
    return mutationError(error);
  }
}
