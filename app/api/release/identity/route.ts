import { NextResponse } from "next/server";
import {
  RELEASE_IDENTITY_HEADERS,
  releaseIdentity,
} from "@/lib/novel-ai/runtime-truth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const identity = releaseIdentity();
  return NextResponse.json(identity, {
    headers: {
      ...RELEASE_IDENTITY_HEADERS,
      "X-Novel-App-Commit": identity.appCommit,
      "X-Novel-Deployment-Id": identity.deploymentId,
      "X-Novel-Runtime-Surface": "release",
    },
  });
}
