import { NextResponse } from "next/server";
import { previewStoryBibleExport } from "@/lib/novel-ai/story-bible-export";
import {
  StoryBibleExportError,
  StoryBibleExportPreviewSchema,
} from "@/lib/novel-ai/story-bible-export-schema";

export const runtime = "nodejs";

function errorResponse(error: unknown, fallbackStatus = 400) {
  const traceId = `export_preview_trace_${crypto.randomUUID()}`;
  if (error instanceof StoryBibleExportError) {
    return NextResponse.json({
      errorCode: error.errorCode,
      stage: error.details.stage || "preview",
      retryable: error.details.retryable ?? false,
      traceId,
      userMessage: error.message,
    }, {
      status: error.status,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
  return NextResponse.json({
    errorCode: "EXPORT_FAILED",
    stage: "preview",
    retryable: true,
    traceId,
    userMessage: "Story Bible export preview failed.",
    technicalMessage: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
  }, {
    status: fallbackStatus,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const options = StoryBibleExportPreviewSchema.parse(Object.fromEntries(url.searchParams.entries()));
    const preview = await previewStoryBibleExport({ ...options, pretty: false, download: false });
    return NextResponse.json(preview, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const options = StoryBibleExportPreviewSchema.parse(body);
    const preview = await previewStoryBibleExport({ ...options, pretty: false, download: false });
    return NextResponse.json(preview, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return errorResponse(error);
  }
}
