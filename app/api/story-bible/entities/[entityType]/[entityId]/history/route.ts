import { jsonError } from "@/lib/novel-ai/http";
import { getStoryBibleEntityHistory } from "@/lib/novel-ai/story-bible-versions";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ entityType: string; entityId: string }> }) {
  try {
    const { entityType, entityId } = await ctx.params;
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId") || "";
    if (!projectId) return jsonError("projectId is required.", 400, "PROJECT_ID_REQUIRED");
    const history = await getStoryBibleEntityHistory(projectId, entityType, entityId);
    return Response.json(history);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Story Bible entity history query failed.",
      400,
      "STORY_BIBLE_ENTITY_HISTORY_ERROR",
    );
  }
}
