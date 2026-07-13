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

function average(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function optionSimilarity(a: string, b: string): boolean {
  const left = new Set(a.replace(/[^\p{L}\p{N}]/gu, "").split(""));
  const right = new Set(b.replace(/[^\p{L}\p{N}]/gu, "").split(""));
  const overlap = [...left].filter((x) => right.has(x)).length;
  return overlap / Math.max(left.size, right.size, 1) > 0.82;
}

function scoreOutput(value: z.infer<typeof OutputSchema>) {
  const options = value.options || [];
  const actions = options.map((x) => (x.action || "").trim()).filter(Boolean);
  const actionSet = new Set(actions);
  const hasThreeDifferentOptions = options.length >= 3 && actionSet.size >= 3 && !optionSimilarity(actions[0] || "", actions[1] || "") && !optionSimilarity(actions[0] || "", actions[2] || "") && !optionSimilarity(actions[1] || "", actions[2] || "");
  const optionStructureScore = hasThreeDifferentOptions ? 25 : Math.min(20, options.length * 5 + actionSet.size * 2);
  const scoreValues = options
    .flatMap((x) => [x.characterFitScore, x.plotProgressScore, x.noveltyScore])
    .filter((x): x is number => typeof x === "number");
  const averageOptionScore = average(scoreValues);
  const evidenceCount = (value.analysisEvidence || []).length;
  const evidenceScore = Math.min(20, evidenceCount * 8);
  const gateWarnings = value.qualityGate?.warnings || [];
  const gateScore = value.qualityGate?.passed ? 20 : Math.max(0, 12 - gateWarnings.length * 2);
  const analysisScore = value.analysisScores ? Math.min(20, average(Object.values(value.analysisScores)) * 2) : 0;
  const total = Math.round(Math.min(100, optionStructureScore + averageOptionScore * 3 + evidenceScore + gateScore + analysisScore));
  return {
    total,
    optionStructureScore,
    averageOptionScore: Math.round(averageOptionScore * 10) / 10,
    evidenceScore,
    gateScore,
    analysisScore: Math.round(analysisScore),
    evidenceCount,
    hasThreeDifferentOptions,
    warnings: gateWarnings,
  };
}

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const input = CompareSchema.parse(await req.json());
    const stats = trainingStats();
    const currentScore = scoreOutput(input.current);
    const candidateScore = scoreOutput(input.candidate);
    const delta = candidateScore.total - currentScore.total;
    return Response.json({
      provider: providerMeta().provider,
      model: providerMeta().model,
      versions: {
        ...stats.versions,
        currentAnalyzerVersion: "story-analyzer-v8",
        candidateAnalyzerVersion: "story-analyzer-v9",
      },
      current: {
        label: "Current",
        analyzerVersion: "story-analyzer-v8",
        score: currentScore.total,
        optionCount: input.current.options?.length || 0,
        qualityGatePassed: Boolean(input.current.qualityGate?.passed),
        breakdown: currentScore,
      },
      candidate: {
        label: "Candidate",
        analyzerVersion: "story-analyzer-v9",
        score: candidateScore.total,
        optionCount: input.candidate.options?.length || 0,
        qualityGatePassed: Boolean(input.candidate.qualityGate?.passed),
        breakdown: candidateScore,
      },
      winner: candidateScore.total > currentScore.total ? "candidate" : currentScore.total > candidateScore.total ? "current" : "tie",
      delta,
      promotionReady: candidateScore.total >= currentScore.total && candidateScore.hasThreeDifferentOptions && candidateScore.evidenceCount >= 2 && candidateScore.warnings.length === 0,
      recommendation: delta > 0
        ? "Candidate 較適合進入下一輪實測。"
        : delta < 0
          ? "Current 仍較穩定，Candidate 需要修正。"
          : "兩者分數相同，請以作者實測回饋決定。",
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Current/Candidate 比較失敗。", 400, "COMPARE_ERROR");
  }
}
