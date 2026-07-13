import { trainingStats } from "@/lib/novel-ai/store";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(trainingStats());
}
