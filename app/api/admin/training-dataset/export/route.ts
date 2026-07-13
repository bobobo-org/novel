import { exportApprovedJsonl } from "@/lib/novel-ai/store";
import { requireAdmin } from "@/lib/novel-ai/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 12);
  return new Response(exportApprovedJsonl(), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": `attachment; filename="novel-ai-training-${stamp}.jsonl"`,
    },
  });
}
