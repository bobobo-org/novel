import { jsonError } from "@/lib/novel-ai/http";
import { listStoryBibleCandidateRows, StoryBibleListQuerySchema } from "@/lib/novel-ai/story-bible";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const query = StoryBibleListQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const candidates = await listStoryBibleCandidateRows(query);
    return Response.json({ candidates, count: candidates.length });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Story Bible candidates query failed.",
      400,
      "STORY_BIBLE_CANDIDATES_QUERY_ERROR",
    );
  }
}
