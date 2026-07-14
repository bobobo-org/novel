import { jsonError } from "@/lib/novel-ai/http";
import { getStoryBibleFieldHistory } from "@/lib/novel-ai/story-bible-versions";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ entityType: string; entityId: string }> }) {
  try {
    const { entityType, entityId } = await ctx.params;
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId") || "";
    const fieldPath = url.searchParams.get("fieldPath") || "";
    if (!projectId) return jsonError("projectId is required.", 400, "PROJECT_ID_REQUIRED");
    if (!fieldPath) return jsonError("fieldPath is required.", 400, "FIELD_PATH_REQUIRED");
    const history = await getStoryBibleFieldHistory(projectId, entityType, entityId, fieldPath);
    return Response.json(history);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Story Bible field history query failed.",
      400,
      "STORY_BIBLE_FIELD_HISTORY_ERROR",
    );
  }
}
