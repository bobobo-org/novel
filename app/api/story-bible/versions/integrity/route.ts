import { requireAdmin } from "@/lib/novel-ai/admin";
import { StoryBibleIntegrityError, verifyVersionChain } from "@/lib/novel-ai/story-bible-integrity";
import crypto from "crypto";
import { z } from "zod";

export const runtime = "nodejs";

function projectIdHash(projectId: string) {
  return projectId ? crypto.createHash("sha256").update(projectId).digest("hex").slice(0, 16) : null;
}

function traceId() {
  return `integrity_${crypto.randomUUID()}`;
}

function integrityError(error: unknown, projectId = "") {
  const id = traceId();
  if (error instanceof StoryBibleIntegrityError) {
    return Response.json({
      errorCode: error.errorCode,
      stage: "integrity",
      traceId: id,
      projectIdHash: projectIdHash(projectId),
      retryable: Boolean(error.details.retryable),
      userMessage: error.message,
      ...error.details,
    }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return Response.json({
      errorCode: "INTEGRITY_QUERY_INVALID",
      stage: "integrity",
      traceId: id,
      projectIdHash: projectIdHash(projectId),
      retryable: false,
      userMessage: "Integrity query is invalid.",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    }, { status: 400 });
  }
  return Response.json({
    errorCode: "INTEGRITY_CHECK_FAILED",
    stage: "integrity",
    traceId: id,
    projectIdHash: projectIdHash(projectId),
    retryable: true,
    userMessage: error instanceof Error ? error.message : "Story Bible integrity check failed.",
  }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId") || "";
    if (!projectId) {
      return Response.json({
        errorCode: "PROJECT_ID_REQUIRED",
        stage: "integrity",
        traceId: traceId(),
        projectIdHash: null,
        retryable: false,
        userMessage: "projectId is required.",
      }, { status: 400 });
    }
    if (url.searchParams.get("includeDetails") === "true") {
      const denied = requireAdmin(req);
      if (denied) return denied;
    }
    const result = await verifyVersionChain(Object.fromEntries(url.searchParams.entries()));
    return Response.json(result);
  } catch (error) {
    const projectId = (() => {
      try { return new URL(req.url).searchParams.get("projectId") || ""; } catch { return ""; }
    })();
    return integrityError(error, projectId);
  }
}
