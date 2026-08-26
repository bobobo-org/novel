import { NextResponse } from "next/server";
import { publicBytePlusSeedanceHealth } from "@/lib/novel-ai/media-extension/server/byteplus-seedance.server";
import { VIDEO_SAFE_RESPONSE_HEADERS } from "../video-route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(publicBytePlusSeedanceHealth(), {
    headers: VIDEO_SAFE_RESPONSE_HEADERS,
  });
}
