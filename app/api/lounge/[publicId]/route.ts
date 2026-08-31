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

type LoungeRouteContext = { params: Promise<{ publicId: string }> };

export async function GET(request: Request, context: LoungeRouteContext) {
  const { publicId } = await context.params;
  return handlers.get(request, publicId);
}

export async function PUT(request: Request, context: LoungeRouteContext) {
  const { publicId } = await context.params;
  return handlers.overwrite(request, publicId);
}

export async function DELETE(request: Request, context: LoungeRouteContext) {
  const { publicId } = await context.params;
  return handlers.retract(request, publicId);
}
