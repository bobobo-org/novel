import {
  PUBLIC_LOUNGE_INTERACTIONS_HEALTH_SCHEMA_VERSION,
  publicLoungeInteractionsAvailability,
} from "@/lib/novel-ai/public-lounge/interactions-availability";
import { getPublicLoungeInteractionGateway } from "@/lib/novel-ai/public-lounge/interactions.server";
import { createPublicLoungeTrustedIpIdentity } from "@/lib/novel-ai/public-lounge/http";
import { getPublicLoungeServerService } from "@/lib/novel-ai/public-lounge/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

export async function GET(request: Request) {
  const unavailable = publicLoungeInteractionsAvailability();
  const preflightBlockers = unavailable.blockers.filter((blocker) => (
    blocker !== "live_rpc_status_not_verified"
  ));
  if (preflightBlockers.length > 0) {
    return Response.json(unavailable, { status: 503, headers: HEADERS });
  }
  try {
    const identity = createPublicLoungeTrustedIpIdentity({
      secret: process.env.PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY?.trim() ?? "",
    })(request);
    await getPublicLoungeServerService().reserveRequest(identity, "read");
    const live = await getPublicLoungeInteractionGateway().health();
    return Response.json({
      schemaVersion: PUBLIC_LOUNGE_INTERACTIONS_HEALTH_SCHEMA_VERSION,
      status: "ready",
      ready: true,
      identity: "supabase_auth_get_user",
      persistence: "postgres_rpc_live",
      migrationVersion: live.migrationVersion,
      counts: null,
      capabilities: {
        oneVotePerWork: true,
        comments: true,
        reports: true,
        authorCommentDeletion: true,
      },
      blockers: [],
    }, { headers: HEADERS });
  } catch {
    return Response.json(unavailable, { status: 503, headers: HEADERS });
  }
}
