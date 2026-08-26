import { NextResponse } from "next/server";
import { BytePlusSeedanceError } from "@/lib/novel-ai/media-extension/server/byteplus-seedance-protocol";
import { VideoRuntimeError } from "@/lib/novel-ai/media-extension/server/video-job-service";
import { ExternalAIRequestGuardError } from "@/lib/novel-ai/providers/external/external-request-guard.server";

export const VIDEO_SAFE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export function videoRouteError(error: unknown) {
  if (error instanceof ExternalAIRequestGuardError) {
    return NextResponse.json(
      { code: error.code, message: error.message, retryable: false },
      { status: error.status, headers: { ...VIDEO_SAFE_RESPONSE_HEADERS, ...error.headers } },
    );
  }
  if (error instanceof VideoRuntimeError) {
    return NextResponse.json(
      { code: error.code, message: error.message, retryable: error.retryable },
      { status: error.status, headers: VIDEO_SAFE_RESPONSE_HEADERS },
    );
  }
  if (error instanceof BytePlusSeedanceError) {
    return NextResponse.json(
      { code: error.code, message: error.message, retryable: error.retryable },
      {
        status: error.status,
        headers: {
          ...VIDEO_SAFE_RESPONSE_HEADERS,
          ...(error.retryAfterSeconds !== null ? { "Retry-After": String(error.retryAfterSeconds) } : {}),
        },
      },
    );
  }
  return NextResponse.json(
    { code: "VIDEO_RUNTIME_UNAVAILABLE", message: "影片工作目前無法執行。", retryable: false },
    { status: 503, headers: VIDEO_SAFE_RESPONSE_HEADERS },
  );
}
