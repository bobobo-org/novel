import { createPublicLoungeInteractionHttpHandlers } from "@/lib/novel-ai/public-lounge/interactions-http";
import { getPublicLoungeInteractionGateway } from "@/lib/novel-ai/public-lounge/interactions.server";
import { getPublicLoungeServerService } from "@/lib/novel-ai/public-lounge/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createPublicLoungeInteractionHttpHandlers(
  getPublicLoungeInteractionGateway,
  getPublicLoungeServerService,
);

type RouteContext = { params: Promise<{ publicId: string }> };

export async function PUT(request: Request, context: RouteContext) {
  const { publicId } = await context.params;
  return handlers.vote(request, publicId);
}
