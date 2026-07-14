import { jsonError } from "@/lib/novel-ai/http";
import { getStoryBibleVersionDiff, StoryBibleDiffError } from "@/lib/novel-ai/story-bible-diff";
import { z } from "zod";

export const runtime = "nodejs";

function diffError(error: unknown) {
  if (error instanceof StoryBibleDiffError) {
    return Response.json({
      errorCode: error.errorCode,
      stage: "version-diff",
      retryable: Boolean(error.details.retryable),
      userMessage: error.message,
      ...error.details,
    }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return Response.json({
      errorCode: "VERSION_DIFF_QUERY_INVALID",
      stage: "version-diff",
      retryable: false,
      userMessage: "Version diff query is invalid.",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    }, { status: 400 });
  }
  return jsonError(error instanceof Error ? error.message : "Story Bible version diff failed.", 500, "VERSION_DIFF_FAILED");
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId") || "";
    if (!projectId) return jsonError("projectId is required.", 400, "PROJECT_ID_REQUIRED");
    const result = await getStoryBibleVersionDiff(Object.fromEntries(url.searchParams.entries()));
    return Response.json(result);
  } catch (error) {
    return diffError(error);
  }
}
