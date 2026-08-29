import { NextResponse } from "next/server";
import { serverVideoJobDependencies } from "@/lib/novel-ai/media-extension/server/byteplus-seedance.server";
import { cancelVideoGenerationJob } from "@/lib/novel-ai/media-extension/server/video-job-service";
import { assertExternalAIRequestOrigin } from "@/lib/novel-ai/providers/external/external-request-guard.server";
import { VIDEO_SAFE_RESPONSE_HEADERS, videoRouteError } from "../../../video-route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    assertExternalAIRequestOrigin(request);
    const { jobId } = await context.params;
    const job = await cancelVideoGenerationJob(jobId, serverVideoJobDependencies());
    return NextResponse.json(job, { status: 202, headers: VIDEO_SAFE_RESPONSE_HEADERS });
  } catch (error) {
    return videoRouteError(error);
  }
}
