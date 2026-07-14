import { jsonError } from "@/lib/novel-ai/http";
import { listStoryBibleVersions } from "@/lib/novel-ai/story-bible-versions";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId") || "";
    if (!projectId) return jsonError("projectId is required.", 400, "PROJECT_ID_REQUIRED");
    const result = await listStoryBibleVersions(Object.fromEntries(url.searchParams.entries()));
    return Response.json(result);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Story Bible versions query failed.",
      400,
      "STORY_BIBLE_VERSIONS_QUERY_ERROR",
    );
  }
}
