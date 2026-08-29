import { createPublicLoungeHttpHandlers } from "@/lib/novel-ai/public-lounge/http";
import { getPublicLoungeServerService } from "@/lib/novel-ai/public-lounge/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createPublicLoungeHttpHandlers(getPublicLoungeServerService);

export async function POST(request: Request) {
  return handlers.eligibility(request);
}
