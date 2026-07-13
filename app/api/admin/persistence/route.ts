import { requireAdmin } from "@/lib/novel-ai/admin";
import {
  AiRunRepository,
  EvaluationRepository,
  ModelErrorRepository,
  dualWriteAudit,
  listFeedbackFromDb,
  listMemoryCandidatesFromDb,
  listTrainingExamplesFromDb,
  persistenceHealth,
  runWriteProbe,
} from "@/lib/novel-ai/persistence";

export const runtime = "nodejs";

function elapsed(started: number) {
  return Date.now() - started;
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function timed<T>(name: string, fn: () => Promise<T>) {
  const started = Date.now();
  try {
    const result = await fn();
    return { name, ok: true, elapsedMs: elapsed(started), result };
  } catch (error) {
    return { name, ok: false, elapsedMs: elapsed(started), error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "overview";
  const projectId = url.searchParams.get("projectId") || "p0b2-recovery";
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 20)));

  if (action === "overview") {
    const [health, aiRuns, modelErrors, evaluations, feedback, training] = await Promise.all([
      persistenceHealth(),
      AiRunRepository.list(limit),
      ModelErrorRepository.list(limit),
      EvaluationRepository.list(limit),
      listFeedbackFromDb(limit),
      listTrainingExamplesFromDb(undefined, limit),
    ]);
    return Response.json({
      metadata: { dataSource: "database", persistenceMode: "db-first", cacheHit: false, recoveredFromDatabase: true },
      health,
      aiRuns,
      modelErrors,
      evaluations,
      feedback: feedback.rows,
      trainingExamples: training.rows,
    });
  }

  if (action === "audit") {
    return Response.json({
      metadata: { dataSource: "database", persistenceMode: "db-first", cacheHit: false, recoveredFromDatabase: true, projectId },
      audit: await dualWriteAudit(projectId),
    });
  }

  if (action === "write-test") {
    return Response.json({
      metadata: { dataSource: "database", persistenceMode: "db-first", cacheHit: false, recoveredFromDatabase: true },
      writeTest: await runWriteProbe(),
    });
  }

  if (action === "recovery-test") {
    const [aiRuns, feedback, training, candidates] = await Promise.all([
      AiRunRepository.findByProject(projectId, limit),
      listFeedbackFromDb(limit, projectId),
      listTrainingExamplesFromDb(undefined, limit, projectId),
      listMemoryCandidatesFromDb(projectId, limit),
    ]);
    return Response.json({
      projectId,
      metadata: { dataSource: "database", persistenceMode: "db-first", cacheHit: false, recoveredFromDatabase: true },
      recovered: {
        aiRuns: aiRuns.length,
        feedback: feedback.rows.length,
        trainingExamples: training.rows.length,
        memoryCandidates: candidates.length,
      },
      samples: {
        aiRunIds: aiRuns.map((x) => x.id).slice(0, 10),
        feedbackIds: feedback.rows.map((x) => x.id).slice(0, 10),
        trainingExampleIds: training.rows.map((x) => x.id).slice(0, 10),
        memoryCandidateIds: candidates.map((x) => x.id).slice(0, 10),
      },
    });
  }

  if (action === "perf-test") {
    const rounds = Math.max(1, Math.min(30, Number(url.searchParams.get("rounds") || 30)));
    const results = [];
    for (let i = 0; i < rounds; i++) {
      results.push(await timed("simple-read", () => AiRunRepository.list(1)));
      results.push(await timed("project-query", () => AiRunRepository.findByProject(projectId, 5)));
      results.push(await timed("recent-24h-stat", () => ModelErrorRepository.list(5)));
      results.push(await timed("memory-candidate-list", () => listMemoryCandidatesFromDb(projectId, 5)));
      results.push(await timed("write-probe", () => runWriteProbe()));
    }
    const latencies = results.map((x) => x.elapsedMs);
    return Response.json({
      rounds,
      operations: results.length,
      averageMs: Math.round(latencies.reduce((sum, x) => sum + x, 0) / Math.max(1, latencies.length)),
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      maxMs: latencies.length ? Math.max(...latencies) : null,
      errorRate: results.length ? results.filter((x) => !x.ok).length / results.length : null,
      results,
    });
  }

  return Response.json({ error: "Unknown persistence admin action." }, { status: 400 });
}
