import { jsonError } from "@/lib/novel-ai/http";
import { getStoryBibleVersionDetail } from "@/lib/novel-ai/story-bible-versions";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId") || "";
    if (!projectId) return jsonError("projectId is required.", 400, "PROJECT_ID_REQUIRED");
    const detail = await getStoryBibleVersionDetail(projectId, id);
    if (!detail) return jsonError("Version not found for this project.", 404, "VERSION_NOT_FOUND");
    return Response.json(detail);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Story Bible version detail query failed.",
      400,
      "STORY_BIBLE_VERSION_DETAIL_ERROR",
    );
  }
}
