import { NextResponse } from "next/server";
import { buildStoryBibleExportPackage, safeExportFilename } from "@/lib/novel-ai/story-bible-export";
import {
  STORY_BIBLE_EXPORT_MIME,
  StoryBibleExportError,
  StoryBibleExportQuerySchema,
} from "@/lib/novel-ai/story-bible-export-schema";

export const runtime = "nodejs";

function errorResponse(error: unknown, fallbackStatus = 400) {
  const traceId = `export_trace_${crypto.randomUUID()}`;
  if (error instanceof StoryBibleExportError) {
    return NextResponse.json({
      errorCode: error.errorCode,
      stage: error.details.stage || "export",
      projectIdHash: error.details.projectIdHash || null,
      fromVersion: error.details.fromVersion || null,
      toVersion: error.details.toVersion || null,
      retryable: error.details.retryable ?? false,
      traceId,
      userMessage: error.message,
    }, { status: error.status });
  }
  return NextResponse.json({
    errorCode: "EXPORT_FAILED",
    stage: "export",
    retryable: true,
    traceId,
    userMessage: "Story Bible export failed.",
    technicalMessage: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
  }, { status: fallbackStatus });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const options = StoryBibleExportQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const pkg = await buildStoryBibleExportPackage(options);
    const body = JSON.stringify(pkg, null, options.pretty ? 2 : 0);
    const headers = new Headers({
      "Content-Type": options.download ? STORY_BIBLE_EXPORT_MIME : "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    });
    if (options.download) {
      headers.set("Content-Disposition", `attachment; filename="${safeExportFilename(pkg.project.title, pkg.versionRange.exportedFromVersion, pkg.versionRange.exportedToVersion)}"`);
    }
    return new Response(body, { status: 200, headers });
  } catch (error) {
    return errorResponse(error);
  }
}
