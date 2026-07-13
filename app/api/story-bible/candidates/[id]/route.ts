import { jsonError } from "@/lib/novel-ai/http";
import { getStoryBibleCandidate } from "@/lib/novel-ai/story-bible";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId") || "";
    if (!projectId) return jsonError("projectId is required.", 400, "PROJECT_ID_REQUIRED");
    const candidate = await getStoryBibleCandidate(projectId, id);
    if (!candidate) return jsonError("Candidate not found for this project.", 404, "CANDIDATE_NOT_FOUND");
    return Response.json(candidate);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Story Bible candidate query failed.",
      400,
      "STORY_BIBLE_CANDIDATE_QUERY_ERROR",
    );
  }
}
