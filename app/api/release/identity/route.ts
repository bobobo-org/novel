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
      "X-Novel-Release-Product-Commit": identity.releaseProductCommit,
      "X-Novel-Release-Revision": identity.releaseRevision,
      "X-Novel-Release-Build": identity.releaseBuild,
      "X-Novel-Deployment-Id": identity.deploymentId,
      "X-Novel-Git-Commit-Signature": identity.gitCommitSignature,
      "X-Novel-Deployment-Provenance": identity.deploymentProvenance,
      "X-Novel-Runtime-Surface": "release",
    },
  });
}
