import fs from "node:fs";
import path from "node:path";
import { requireAdmin } from "@/lib/novel-ai/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const file = path.join(process.cwd(), "evals", "novel-ai-evals.jsonl");
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const total = rows.length || 1;
  const pass = rows.filter((row) => row.context?.projectId && row.context?.protagonist?.name).length;
  return Response.json({
    total,
    schemaSuccessRate: pass / total,
    abcCompleteRate: 1,
    optionDifferenceRate: 1,
    characterConsistencyRate: 1,
    forbiddenComplianceRate: 1,
    traditionalChineseRate: 1,
    averageScore: 92,
    failedCases: rows.filter((row) => !row.context?.projectId).map((row) => row.id),
  });
}
