import { z } from "zod";
import { requireAdmin } from "@/lib/novel-ai/admin";
import { jsonError } from "@/lib/novel-ai/http";
import { providerMeta } from "@/lib/novel-ai/provider";
import { trainingStats } from "@/lib/novel-ai/store";

export const runtime = "nodejs";

const OutputSchema = z.object({
  options: z.array(z.object({
    label: z.string().optional(),
    action: z.string().optional(),
    characterFitScore: z.number().optional(),
    plotProgressScore: z.number().optional(),
    noveltyScore: z.number().optional(),
  })).optional(),
  qualityGate: z.object({
    passed: z.boolean().optional(),
    warnings: z.array(z.string()).optional(),
  }).optional(),
  analysisEvidence: z.array(z.unknown()).optional(),
  analysisScores: z.record(z.string(), z.number()).optional(),
}).passthrough();

const CompareSchema = z.object({
  current: OutputSchema,
  candidate: OutputSchema,
});

function scoreOutput(value: z.infer<typeof OutputSchema>) {
  const options = value.options || [];
  const actionSet = new Set(options.map((x) => (x.action || "").trim()).filter(Boolean));
  const optionScore = options.length >= 3 && actionSet.size >= 3 ? 25 : options.length * 5;
  const scoreValues = options
    .flatMap((x) => [x.characterFitScore, x.plotProgressScore, x.noveltyScore])
    .filter((x): x is number => typeof x === "number");
  const averageOptionScore = scoreValues.length ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length : 0;
  const evidenceScore = Math.min(20, (value.analysisEvidence || []).length * 8);
  const gateScore = value.qualityGate?.passed ? 20 : Math.max(0, 12 - (value.qualityGate?.warnings || []).length * 2);
  const analysisScore = value.analysisScores
    ? Math.min(20, Object.values(value.analysisScores).reduce((a, b) => a + b, 0) / Math.max(1, Object.values(value.analysisScores).length) * 2)
    : 0;
  return Math.round(Math.min(100, optionScore + averageOptionScore * 3 + evidenceScore + gateScore + analysisScore));
}

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const input = CompareSchema.parse(await req.json());
    const stats = trainingStats();
    const currentScore = scoreOutput(input.current);
    const candidateScore = scoreOutput(input.candidate);
    return Response.json({
      provider: providerMeta().provider,
      model: providerMeta().model,
      versions: stats.versions,
      current: {
        score: currentScore,
        optionCount: input.current.options?.length || 0,
        warnings: input.current.qualityGate?.warnings || [],
      },
      candidate: {
        score: candidateScore,
        optionCount: input.candidate.options?.length || 0,
        warnings: input.candidate.qualityGate?.warnings || [],
      },
      winner: candidateScore > currentScore ? "candidate" : currentScore > candidateScore ? "current" : "tie",
      delta: candidateScore - currentScore,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Current/Candidate 比較失敗。", 400, "COMPARE_ERROR");
  }
}
