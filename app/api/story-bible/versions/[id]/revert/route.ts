import { requireAdmin } from "@/lib/novel-ai/admin";
import { jsonError } from "@/lib/novel-ai/http";
import { revertStoryBibleVersion, StoryBibleRevertError } from "@/lib/novel-ai/story-bible-revert";
import { z } from "zod";

export const runtime = "nodejs";

function revertError(error: unknown) {
  if (error instanceof StoryBibleRevertError) {
    return Response.json({
      errorCode: error.errorCode,
      stage: "revert",
      retryable: Boolean(error.details.retryable),
      userMessage: error.message,
      ...error.details,
    }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return Response.json({
      errorCode: "REVERT_REQUEST_INVALID",
      stage: "revert",
      retryable: false,
      userMessage: "Revert request is invalid.",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    }, { status: 400 });
  }
  return jsonError(error instanceof Error ? error.message : "Story Bible revert failed.", 500, "REVERT_FAILED");
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const denied = requireAdmin(req);
    if (denied) return denied;
    const { id } = await ctx.params;
    const result = await revertStoryBibleVersion(id, await req.json());
    return Response.json(result);
  } catch (error) {
    return revertError(error);
  }
}
