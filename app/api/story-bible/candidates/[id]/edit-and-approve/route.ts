import { jsonError } from "@/lib/novel-ai/http";
import { requireAdmin } from "@/lib/novel-ai/admin";
import { StoryBibleMutationError, unsupportedStoryBibleMutation } from "@/lib/novel-ai/story-bible";
import { z } from "zod";

export const runtime = "nodejs";

function mutationError(error: unknown) {
  if (error instanceof StoryBibleMutationError) {
    return Response.json({
      errorCode: error.errorCode,
      stage: "edit-and-approve",
      retryable: Boolean(error.details.retryable),
      userMessage: error.message,
      ...error.details,
    }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return Response.json({
      errorCode: "INVALID_MUTATION_REQUEST",
      stage: "edit-and-approve",
      retryable: false,
      userMessage: "Edit-and-approve request 欄位不完整或格式錯誤。",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    }, { status: 400 });
  }
  return jsonError(error instanceof Error ? error.message : "Story Bible edit-and-approve failed.", 500, "STORY_BIBLE_EDIT_APPROVE_FAILED");
}

export async function POST(req: Request) {
  try {
    const denied = requireAdmin(req);
    if (denied) return denied;
    unsupportedStoryBibleMutation("edit-and-approve", await req.json());
  } catch (error) {
    return mutationError(error);
  }
}
