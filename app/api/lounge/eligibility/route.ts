import { createPublicLoungeHttpHandlers } from "@/lib/novel-ai/public-lounge/http";
import { getPublicLoungeOwnerLifecycleGateway } from "@/lib/novel-ai/public-lounge/interactions.server";
import { getPublicLoungeServerService } from "@/lib/novel-ai/public-lounge/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createPublicLoungeHttpHandlers(
  getPublicLoungeServerService,
  undefined,
  undefined,
  getPublicLoungeOwnerLifecycleGateway,
);

export async function POST(request: Request) {
  return handlers.eligibility(request);
}
