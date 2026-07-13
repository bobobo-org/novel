import { jsonError } from "@/lib/novel-ai/http";
import { listStoryBibleConflicts, StoryBibleListQuerySchema } from "@/lib/novel-ai/story-bible";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const query = StoryBibleListQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const conflicts = await listStoryBibleConflicts(query);
    return Response.json({ conflicts, count: conflicts.length });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Story Bible conflicts query failed.",
      400,
      "STORY_BIBLE_CONFLICTS_QUERY_ERROR",
    );
  }
}
