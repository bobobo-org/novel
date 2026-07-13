import { exportApprovedJsonl } from "@/lib/novel-ai/store";

export const runtime = "nodejs";

export async function POST() {
  return new Response(exportApprovedJsonl(), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": 'attachment; filename="novel-ai-training-approved.jsonl"',
    },
  });
}
