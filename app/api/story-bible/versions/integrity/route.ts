import { requireAdmin } from "@/lib/novel-ai/admin";
import { jsonError } from "@/lib/novel-ai/http";
import { StoryBibleIntegrityError, verifyVersionChain } from "@/lib/novel-ai/story-bible-integrity";
import { z } from "zod";

export const runtime = "nodejs";

function integrityError(error: unknown) {
  if (error instanceof StoryBibleIntegrityError) {
    return Response.json({
      errorCode: error.errorCode,
      stage: "integrity",
      retryable: Boolean(error.details.retryable),
      userMessage: error.message,
      ...error.details,
    }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return Response.json({
      errorCode: "INTEGRITY_QUERY_INVALID",
      stage: "integrity",
      retryable: false,
      userMessage: "Integrity query is invalid.",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    }, { status: 400 });
  }
  return jsonError(error instanceof Error ? error.message : "Story Bible integrity check failed.", 500, "INTEGRITY_CHECK_FAILED");
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId") || "";
    if (!projectId) return jsonError("projectId is required.", 400, "PROJECT_ID_REQUIRED");
    if (url.searchParams.get("includeDetails") === "true") {
      const denied = requireAdmin(req);
      if (denied) return denied;
    }
    const result = await verifyVersionChain(Object.fromEntries(url.searchParams.entries()));
    return Response.json(result);
  } catch (error) {
    return integrityError(error);
  }
}
