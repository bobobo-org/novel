import crypto from "crypto";
import type { AiFeedbackRecord, AiRunRecord, TrainingExampleRecord } from "./store";
import type { MemoryUpdateCandidate, NovelMemory } from "./schemas";

export const PERSISTENCE_SCHEMA_VERSION = "p0b_persistence_001";

type JsonRecord = Record<string, unknown>;

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url: url.replace(/\/$/, ""), key };
}

function isConfigured() {
  const cfg = supabaseConfig();
  return Boolean(cfg.url && cfg.key);
}

function databaseProjectRef() {
  const { url } = supabaseConfig();
  const match = url.match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return match?.[1] || "";
}

function toSnakeAiRun(row: AiRunRecord): JsonRecord {
  const output = (row.modelOutput || {}) as { trace?: { traceId?: string; fallbackUsed?: string; errors?: Array<{ stage?: string; errorType?: string; retryable?: boolean }> } };
  const firstError = output.trace?.errors?.[0];
  return {
    id: row.id,
    trace_id: output.trace?.traceId || row.id,
    project_id: row.projectId,
    task_type: row.taskType,
    mode: (row.inputContext as { mode?: string })?.mode || "FAST_ANALYSIS",
    provider: row.provider,
    model_id: row.model,
    prompt_version: row.promptVersion,
    schema_version: row.memoryVersion,
    input_token_count: row.inputTokens,
    output_token_count: row.outputTokens,
    elapsed_ms: row.latencyMs,
    provider_elapsed_ms: (output.trace as { totalElapsedMs?: number })?.totalElapsedMs,
    fallback_used: output.trace?.fallbackUsed,
    fallback_level: output.trace?.fallbackUsed,
    success: row.status === "completed",
    error_code: row.errorCode || firstError?.errorType,
    error_stage: firstError?.stage,
    retryable: firstError?.retryable,
    created_at: row.createdAt,
  };
}

function toSnakeFeedback(row: AiFeedbackRecord): JsonRecord {
  return {
    id: row.id,
    project_id: row.projectId,
    ai_run_id: row.aiRunId,
    rating: row.decision === "accepted" ? 5 : row.decision === "edited" ? 4 : 1,
    adopted: row.decision === "accepted" || row.decision === "edited",
    feedback_type: row.decision,
    comment: row.authorNote || (row.rejectionReasons || []).join("；"),
    original_output_hash: hashJson(row.originalOutput),
    edited_output_hash: row.editedOutput == null ? null : hashJson(row.editedOutput),
    created_at: row.createdAt,
  };
}

function toSnakeTraining(row: TrainingExampleRecord): JsonRecord {
  return {
    id: row.id,
    project_id: row.projectId,
    ai_run_id: null,
    status: row.qualityStatus,
    task_type: row.taskType,
    input_summary: summarize(row.userInput),
    output_summary: summarize(row.idealOutput),
    rejection_reason: row.qualityStatus === "rejected" ? row.reviewerNote : null,
    approved_by: row.qualityStatus === "approved" ? "local-reviewer" : null,
    approved_at: row.qualityStatus === "approved" ? row.reviewedAt : null,
    created_at: row.createdAt,
    updated_at: row.reviewedAt || row.createdAt,
  };
}

function summarize(value: unknown): string {
  return JSON.stringify(value || "").slice(0, 1200);
}

function hashJson(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value || null)).digest("hex");
}

async function rest<T>(table: string, init: RequestInit & { query?: string } = {}): Promise<T> {
  const cfg = supabaseConfig();
  if (!cfg.url || !cfg.key) throw new Error("PERSISTENCE_NOT_CONFIGURED");
  const query = init.query ? `?${init.query}` : "";
  const response = await fetch(`${cfg.url}/rest/v1/${table}${query}`, {
    ...init,
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      "content-type": "application/json",
      prefer: "return=representation,resolution=merge-duplicates",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`PERSISTENCE_HTTP_${response.status}:${text.slice(0, 300)}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function upsert(table: string, row: JsonRecord) {
  return rest(table, {
    method: "POST",
    query: "on_conflict=id",
    body: JSON.stringify(row),
  });
}

export class PersistentRepository {
  constructor(private table: string) {}

  create(row: JsonRecord) {
    return upsert(this.table, row);
  }

  findById(id: string) {
    return rest<JsonRecord[]>(this.table, { query: `id=eq.${encodeURIComponent(id)}&limit=1` });
  }

  findByProject(projectId: string, limit = 50) {
    return rest<JsonRecord[]>(this.table, { query: `project_id=eq.${encodeURIComponent(projectId)}&order=created_at.desc&limit=${limit}` });
  }

  list(limit = 50) {
    return rest<JsonRecord[]>(this.table, { query: `order=created_at.desc&limit=${limit}` });
  }

  updateStatus(id: string, status: string) {
    return rest(this.table, {
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(id)}`,
      body: JSON.stringify({ status }),
    });
  }

  softDelete(id: string) {
    return this.updateStatus(id, "deleted");
  }
}

export const AiRunRepository = new PersistentRepository("ai_runs");
export const FeedbackRepository = new PersistentRepository("feedback");
export const TrainingExampleRepository = new PersistentRepository("training_examples");
export const EvaluationRepository = new PersistentRepository("evaluation_runs");
export const ModelErrorRepository = new PersistentRepository("model_errors");
export const StoryMemoryRepository = new PersistentRepository("story_memories");
export const MemoryCandidateRepository = new PersistentRepository("memory_candidates");

let lastSuccessfulWriteAt = "";
let lastDatabaseError = "";
let dualWriteStatus: "not_configured" | "ok" | "degraded" = "not_configured";

async function safeWrite(name: string, fn: () => Promise<unknown>) {
  if (!isConfigured()) {
    dualWriteStatus = "not_configured";
    return;
  }
  try {
    await fn();
    lastSuccessfulWriteAt = new Date().toISOString();
    lastDatabaseError = "";
    dualWriteStatus = "ok";
  } catch (error) {
    lastDatabaseError = `${name}: ${error instanceof Error ? error.message : String(error)}`;
    dualWriteStatus = "degraded";
  }
}

export function persistAiRun(row: AiRunRecord) {
  void safeWrite("ai_runs", async () => {
    await AiRunRepository.create(toSnakeAiRun(row));
    const output = (row.modelOutput || {}) as { trace?: { traceId?: string; errors?: Array<Record<string, unknown>>; provider?: string; modelId?: string } };
    const errors = output.trace?.errors?.length
      ? output.trace.errors
      : row.status === "failed" || row.errorCode
        ? [{
            errorType: row.errorCode || "AI_RUN_FAILED",
            stage: "recordAiRun",
            message: row.errorCode || "AI run failed without provider trace.",
            retryable: true,
            elapsedMs: row.latencyMs,
          }]
        : [];
    for (const err of errors) {
      await ModelErrorRepository.create({
        id: `model_error_${crypto.randomUUID()}`,
        trace_id: output.trace?.traceId || row.id,
        project_id: row.projectId,
        provider: row.provider,
        model_id: row.model,
        task_type: row.taskType,
        error_code: String(err.errorType || row.errorCode || "MODEL_ERROR"),
        error_stage: String(err.stage || "unknown"),
        technical_message: String(err.message || ""),
        retryable: Boolean(err.retryable),
        elapsed_ms: Number(err.elapsedMs || row.latencyMs || 0),
        metadata_json: err,
        created_at: new Date().toISOString(),
      });
    }
  });
}

export function persistFeedback(row: AiFeedbackRecord) {
  void safeWrite("feedback", () => FeedbackRepository.create(toSnakeFeedback(row)));
}

export function persistTrainingExample(row: TrainingExampleRecord) {
  void safeWrite("training_examples", () => TrainingExampleRepository.create(toSnakeTraining(row)));
}

export function persistStoryMemory(memory: NovelMemory) {
  void safeWrite("story_memories", () =>
    StoryMemoryRepository.create({
      id: `story_memory_${memory.projectId}`,
      project_id: memory.projectId,
      memory_version: `novel-memory-v${memory.version}`,
      status: "approved",
      memory_json: memory,
      source_chapter_ids: (memory.chapterSummaries || []).map((x) => x.chapterId),
      created_by: "system",
      confirmed_at: memory.updatedAt || new Date().toISOString(),
      created_at: memory.updatedAt || new Date().toISOString(),
      updated_at: memory.updatedAt || new Date().toISOString(),
    }),
  );
}

export function persistMemoryCandidate(candidate: MemoryUpdateCandidate, aiRunId?: string) {
  const candidateId =
    candidate.originalCandidate && typeof candidate.originalCandidate === "object" && "candidateId" in candidate.originalCandidate
      ? String((candidate.originalCandidate as { candidateId?: unknown }).candidateId)
      : `memory_candidate_${crypto.randomUUID()}`;
  void safeWrite("memory_candidates", () =>
    MemoryCandidateRepository.create({
      id: candidateId,
      project_id: candidate.projectId,
      ai_run_id: aiRunId || null,
      source_chapter_id: candidate.chapterId || null,
      candidate_type: "memory_update",
      candidate_json: candidate,
      status: "pending",
      conflict_json: { continuityWarnings: candidate.continuityWarnings || [] },
      created_at: new Date().toISOString(),
    }),
  );
}

export function markMemoryCandidateReviewed(candidate: MemoryUpdateCandidate, status: "approved" | "rejected" | "superseded") {
  const candidateId =
    candidate.originalCandidate && typeof candidate.originalCandidate === "object" && "candidateId" in candidate.originalCandidate
      ? String((candidate.originalCandidate as { candidateId?: unknown }).candidateId)
      : "";
  if (!candidateId) return;
  void safeWrite("memory_candidates", () =>
    rest("memory_candidates", {
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(candidateId)}`,
      body: JSON.stringify({ status, reviewed_at: new Date().toISOString() }),
    }),
  );
}

export function persistEvaluationRun(input: JsonRecord) {
  void safeWrite("evaluation_runs", () =>
    EvaluationRepository.create({
      id: String(input.id || `eval_${crypto.randomUUID()}`),
      benchmark_version: String(input.benchmarkVersion || "unknown"),
      analyzer_version: String(input.analyzerVersion || "unknown"),
      provider: String(input.provider || "unknown"),
      model_id: String(input.modelId || "unknown"),
      evaluation_type: String(input.evaluationType || "fixed"),
      total_cases: Number(input.totalCases || 0),
      passed_cases: Number(input.passedCases || 0),
      average_score: Number(input.averageScore || 0),
      p50_ms: input.p50Ms == null ? null : Number(input.p50Ms),
      p95_ms: input.p95Ms == null ? null : Number(input.p95Ms),
      json_valid_rate: input.jsonValidRate == null ? null : Number(input.jsonValidRate),
      schema_valid_rate: input.schemaValidRate == null ? null : Number(input.schemaValidRate),
      fallback_rate: input.fallbackRate == null ? null : Number(input.fallbackRate),
      result_json: input.resultJson || {},
      created_at: new Date().toISOString(),
    }),
  );
}

export async function persistenceHealth() {
  const started = Date.now();
  if (!isConfigured()) {
    return {
      storeType: "memory",
      persistenceStatus: "not_configured",
      databaseStatus: "missing_env",
      databaseProjectRef: databaseProjectRef(),
      databaseLatencyMs: 0,
      migrationVersion: "",
      writeTestStatus: "skipped",
      lastSuccessfulWriteAt,
      lastDatabaseError,
      dualWriteStatus,
    };
  }
  try {
    const rows = await rest<Array<{ version: string }>>("schema_migrations", {
      query: `select=version&version=eq.${PERSISTENCE_SCHEMA_VERSION}&limit=1`,
    });
    const migrationOk = rows.some((x) => x.version === PERSISTENCE_SCHEMA_VERSION);
    return {
      storeType: migrationOk ? "persistent" : "memory",
      persistenceStatus: migrationOk ? "ok" : "migration_required",
      databaseStatus: "reachable",
      databaseProjectRef: databaseProjectRef(),
      databaseLatencyMs: Date.now() - started,
      migrationVersion: migrationOk ? PERSISTENCE_SCHEMA_VERSION : "",
      writeTestStatus: migrationOk ? "available" : "skipped",
      lastSuccessfulWriteAt,
      lastDatabaseError,
      dualWriteStatus: migrationOk ? (dualWriteStatus === "not_configured" ? "ok" : dualWriteStatus) : "degraded",
    };
  } catch (error) {
    return {
      storeType: "memory",
      persistenceStatus: "degraded",
      databaseStatus: "error",
      databaseProjectRef: databaseProjectRef(),
      databaseLatencyMs: Date.now() - started,
      migrationVersion: "",
      writeTestStatus: "failed",
      lastSuccessfulWriteAt,
      lastDatabaseError: error instanceof Error ? error.message : String(error),
      dualWriteStatus: "degraded",
    };
  }
}
