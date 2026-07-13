import { trainingStats } from "@/lib/novel-ai/store";
import { requireAdmin } from "@/lib/novel-ai/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return Response.json(trainingStats());
}
