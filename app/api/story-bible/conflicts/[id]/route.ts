import { jsonError } from "@/lib/novel-ai/http";
import { getStoryBibleConflict } from "@/lib/novel-ai/story-bible";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId") || "";
    if (!projectId) return jsonError("projectId is required.", 400, "PROJECT_ID_REQUIRED");
    const conflict = await getStoryBibleConflict(projectId, id);
    if (!conflict) return jsonError("Conflict not found for this project.", 404, "CONFLICT_NOT_FOUND");
    return Response.json(conflict);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Story Bible conflict query failed.",
      400,
      "STORY_BIBLE_CONFLICT_QUERY_ERROR",
    );
  }
}
