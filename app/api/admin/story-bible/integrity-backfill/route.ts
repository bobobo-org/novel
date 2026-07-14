import { requireAdmin } from "@/lib/novel-ai/admin";
import { jsonError } from "@/lib/novel-ai/http";
import { backfillStoryBibleIntegrity, StoryBibleIntegrityError } from "@/lib/novel-ai/story-bible-integrity";
import { z } from "zod";

export const runtime = "nodejs";

function integrityError(error: unknown) {
  if (error instanceof StoryBibleIntegrityError) {
    return Response.json({
      errorCode: error.errorCode,
      stage: "integrity-backfill",
      retryable: Boolean(error.details.retryable),
      userMessage: error.message,
      ...error.details,
    }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return Response.json({
      errorCode: "INTEGRITY_BACKFILL_REQUEST_INVALID",
      stage: "integrity-backfill",
      retryable: false,
      userMessage: "Integrity backfill request is invalid.",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    }, { status: 400 });
  }
  return jsonError(error instanceof Error ? error.message : "Integrity backfill failed.", 500, "INTEGRITY_BACKFILL_FAILED");
}

export async function POST(req: Request) {
  try {
    const denied = requireAdmin(req);
    if (denied) return denied;
    const result = await backfillStoryBibleIntegrity(await req.json());
    return Response.json(result);
  } catch (error) {
    return integrityError(error);
  }
}
