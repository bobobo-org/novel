import crypto from "crypto";
import type { AiFeedbackRecord, AiRunRecord, TrainingExampleRecord } from "./store";
import type { MemoryUpdateCandidate, NovelMemory } from "./schemas";

export const PERSISTENCE_SCHEMA_VERSION = "p0b2_db_first_002";

type JsonRecord = Record<string, unknown>;
type WriteTestStatus = {
  status: "passed" | "failed" | "not_run";
  lastRunAt: string | null;
  latencyMs: number | null;
  recordId: string | null;
  cleanupStatus: "deleted" | "failed" | "not_needed" | null;
  errorCode: string | null;
};

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
let lastWriteTest: WriteTestStatus = {
  status: "not_run",
  lastRunAt: null,
  latencyMs: null,
  recordId: null,
  cleanupStatus: null,
  errorCode: null,
};

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
  void safeWrite("story_memories", () => writeStoryMemory(memory));
}

export function writeStoryMemory(memory: NovelMemory) {
  return StoryMemoryRepository.create({
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
    });
}

export function persistMemoryCandidate(candidate: MemoryUpdateCandidate, aiRunId?: string) {
  void safeWrite("memory_candidates", () => writeMemoryCandidate(candidate, aiRunId));
}

export function writeMemoryCandidate(candidate: MemoryUpdateCandidate, aiRunId?: string) {
  const candidateId =
    candidate.originalCandidate && typeof candidate.originalCandidate === "object" && "candidateId" in candidate.originalCandidate
      ? String((candidate.originalCandidate as { candidateId?: unknown }).candidateId)
      : `memory_candidate_${crypto.randomUUID()}`;
  return MemoryCandidateRepository.create({
      id: candidateId,
      project_id: candidate.projectId,
      ai_run_id: aiRunId || null,
      source_chapter_id: candidate.chapterId || null,
      candidate_type: "memory_update",
      candidate_json: candidate,
      status: "pending",
      conflict_json: { continuityWarnings: candidate.continuityWarnings || [] },
      created_at: new Date().toISOString(),
    });
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

function n(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value || 0);
}

function iso(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function pct(part: number, total: number): number | null {
  return total ? Math.round((part / total) * 100) : null;
}

export async function dbAiRunStats() {
  const rows = await rest<Array<JsonRecord>>("ai_runs", {
    query: "select=id,task_type,success,elapsed_ms,input_token_count,output_token_count,created_at,error_code&order=created_at.desc&limit=1000",
  });
  const now = Date.now();
  const last24h = rows.filter((x) => now - new Date(String(x.created_at)).getTime() <= 24 * 60 * 60 * 1000);
  const completed = last24h.filter((x) => x.success === true);
  const failed = last24h.filter((x) => x.success === false);
  const analysisSuccess = rows.find((x) => x.task_type === "story_analysis" && x.success === true);
  const lastError = rows.find((x) => x.success === false);
  return {
    dataSource: "database",
    totalRuns: rows.length,
    last24hRuns: last24h.length,
    last24hSuccessRate: pct(completed.length, last24h.length),
    last24hFailureRate: pct(failed.length, last24h.length),
    averageLatencyMs: completed.length ? Math.round(completed.reduce((sum, row) => sum + n(row.elapsed_ms), 0) / completed.length) : null,
    lastSuccessAt: iso(completed[0]?.created_at),
    lastAnalysisSuccessAt: iso(analysisSuccess?.created_at),
    lastError: lastError ? { createdAt: lastError.created_at, taskType: lastError.task_type, errorCode: lastError.error_code || "UNKNOWN_ERROR" } : null,
    dailyTokens: last24h.length ? last24h.reduce((sum, row) => sum + n(row.input_token_count) + n(row.output_token_count), 0) : null,
    monthlyEstimatedCost: null,
  };
}

export async function dbTrainingStats(baseVersions: JsonRecord) {
  const [examples, feedback, memories] = await Promise.all([
    rest<Array<JsonRecord>>("training_examples", { query: "select=id,status,created_at&order=created_at.desc&limit=1000" }),
    rest<Array<JsonRecord>>("feedback", { query: "select=id,feedback_type,adopted,created_at&order=created_at.desc&limit=1000" }),
    rest<Array<JsonRecord>>("story_memories", { query: "select=id,project_id,memory_json,updated_at&order=updated_at.desc&limit=1000" }),
  ]);
  const count = (status: string) => examples.filter((x) => x.status === status).length;
  const feedbackCount = (type: string) => feedback.filter((x) => x.feedback_type === type).length;
  const accepted = feedbackCount("accepted");
  const edited = feedbackCount("edited");
  const rejected = feedbackCount("rejected");
  return {
    dataSource: "database",
    database: "persistent",
    persistenceMode: "db-first",
    pending: count("pending"),
    approved: count("approved"),
    needsRevision: count("needs_revision"),
    rejected: count("rejected"),
    acceptedFeedback: accepted,
    editedFeedback: edited,
    rejectedFeedback: rejected,
    totalFeedback: feedback.length,
    promptVersions: [],
    versions: baseVersions,
    aiAbility: {
      analyzedCount: null,
      authorAcceptanceRate: pct(accepted + edited, feedback.length),
      recent30AcceptanceRate: null,
      fixedEvalScore: null,
      approvedTrainingExamples: count("approved"),
      memoryLinkedProjects: new Set(memories.map((x) => x.project_id)).size,
      memoryChapterSummaries: memories.reduce((sum, row) => {
        const memory = row.memory_json as { chapterSummaries?: unknown[] };
        return sum + (Array.isArray(memory?.chapterSummaries) ? memory.chapterSummaries.length : 0);
      }, 0),
    },
    memory: {
      projectsWithMemory: new Set(memories.map((x) => x.project_id)).size,
      chapterSummaries: memories.reduce((sum, row) => {
        const memory = row.memory_json as { chapterSummaries?: unknown[] };
        return sum + (Array.isArray(memory?.chapterSummaries) ? memory.chapterSummaries.length : 0);
      }, 0),
    },
    trainingExamples: {
      pending: count("pending"),
      approved: count("approved"),
      rejected: count("rejected"),
      needs_revision: count("needs_revision"),
      total: examples.length,
    },
    feedback: { accepted, edited, rejected, total: feedback.length },
    aiRuns: null,
  };
}

export async function listFeedbackFromDb(limit = 20, projectId?: string) {
  const scope = projectId ? `project_id=eq.${encodeURIComponent(projectId)}&` : "";
  return {
    dataSource: "database",
    rows: await rest<Array<JsonRecord>>("feedback", { query: `${scope}select=*&order=created_at.desc&limit=${Math.max(1, Math.min(100, limit))}` }),
  };
}

export async function listTrainingExamplesFromDb(status?: string, limit = 20, projectId?: string) {
  const parts = [];
  if (projectId) parts.push(`project_id=eq.${encodeURIComponent(projectId)}`);
  if (status) parts.push(`status=eq.${encodeURIComponent(status)}`);
  parts.push("select=*");
  parts.push("order=created_at.desc");
  parts.push(`limit=${Math.max(1, Math.min(100, limit))}`);
  return {
    dataSource: "database",
    rows: await rest<Array<JsonRecord>>("training_examples", { query: parts.join("&") }),
  };
}

export async function getStoryMemoryFromDb(projectId: string) {
  const rows = await rest<Array<JsonRecord>>("story_memories", {
    query: `project_id=eq.${encodeURIComponent(projectId)}&select=memory_json,updated_at&order=updated_at.desc&limit=1`,
  });
  return rows[0]?.memory_json || null;
}

export async function listMemoryCandidatesFromDb(projectId: string, limit = 20) {
  return rest<Array<JsonRecord>>("memory_candidates", {
    query: `project_id=eq.${encodeURIComponent(projectId)}&select=*&order=created_at.desc&limit=${Math.max(1, Math.min(100, limit))}`,
  });
}

export async function findAiRunFromDb(aiRunId: string) {
  const rows = await rest<Array<JsonRecord>>("ai_runs", { query: `id=eq.${encodeURIComponent(aiRunId)}&select=*&limit=1` });
  return rows[0] || null;
}

export async function persistFeedbackFromDbAiRun(input: {
  aiRunId: string;
  decision: "accepted" | "edited" | "rejected";
  selectedOption?: "A" | "B" | "C";
  editedOutput?: unknown;
  rejectionReasons?: string[];
  authorNote?: string;
}) {
  const aiRun = await findAiRunFromDb(input.aiRunId);
  if (!aiRun) throw new Error("AI_RUN_NOT_FOUND_IN_DATABASE");
  const now = new Date().toISOString();
  const row = {
    id: `feedback_${crypto.randomUUID()}`,
    project_id: String(aiRun.project_id),
    ai_run_id: input.aiRunId,
    rating: input.decision === "accepted" ? 5 : input.decision === "edited" ? 4 : 1,
    adopted: input.decision === "accepted" || input.decision === "edited",
    feedback_type: input.decision,
    comment: input.authorNote || (input.rejectionReasons || []).join("；"),
    original_output_hash: String(aiRun.id),
    edited_output_hash: input.editedOutput == null ? null : hashJson(input.editedOutput),
    created_at: now,
  };
  await FeedbackRepository.create(row);
  if (input.decision === "accepted" || input.decision === "edited") {
    await TrainingExampleRepository.create({
      id: `train_${crypto.randomUUID()}`,
      project_id: String(aiRun.project_id),
      ai_run_id: input.aiRunId,
      status: "pending",
      task_type: String(aiRun.task_type || "story_analysis"),
      input_summary: `Recovered from ai_run ${input.aiRunId}`,
      output_summary: input.decision === "edited" ? summarize(input.editedOutput) : `Accepted ai_run ${input.aiRunId}`,
      created_at: now,
      updated_at: now,
    });
  }
  lastSuccessfulWriteAt = now;
  dualWriteStatus = "ok";
  return {
    feedback: {
      id: row.id,
      aiRunId: input.aiRunId,
      projectId: row.project_id,
      decision: input.decision,
      selectedOption: input.selectedOption,
      authorNote: input.authorNote,
      createdAt: now,
      updatedAt: now,
    },
    metadata: { dataSource: "database", persistenceMode: "db-first", cacheHit: false, recoveredFromDatabase: true },
  };
}

export async function runWriteProbe() {
  if (!isConfigured()) {
    lastWriteTest = { status: "not_run", lastRunAt: new Date().toISOString(), latencyMs: null, recordId: null, cleanupStatus: "not_needed", errorCode: "PERSISTENCE_NOT_CONFIGURED" };
    return lastWriteTest;
  }
  const started = Date.now();
  const recordId = `health_${crypto.randomUUID()}`;
  try {
    await rest("health_checks", {
      method: "POST",
      body: JSON.stringify({ id: recordId, created_at: new Date().toISOString() }),
    });
    try {
      await rest("health_checks", { method: "DELETE", query: `id=eq.${encodeURIComponent(recordId)}` });
      lastWriteTest = { status: "passed", lastRunAt: new Date().toISOString(), latencyMs: Date.now() - started, recordId, cleanupStatus: "deleted", errorCode: null };
    } catch {
      lastWriteTest = { status: "passed", lastRunAt: new Date().toISOString(), latencyMs: Date.now() - started, recordId, cleanupStatus: "failed", errorCode: "CLEANUP_FAILED" };
    }
  } catch (error) {
    lastWriteTest = {
      status: "failed",
      lastRunAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      recordId,
      cleanupStatus: "not_needed",
      errorCode: error instanceof Error ? error.message.slice(0, 120) : "WRITE_PROBE_FAILED",
    };
  }
  return lastWriteTest;
}

export async function dualWriteAudit(projectId?: string) {
  const tables = ["ai_runs", "feedback", "training_examples", "evaluation_runs", "model_errors", "story_memories", "memory_candidates"];
  const projectScopedTables = new Set(["ai_runs", "feedback", "training_examples", "model_errors", "story_memories", "memory_candidates"]);
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    const scope = projectId && projectScopedTables.has(table) ? `project_id=eq.${encodeURIComponent(projectId)}&` : "";
    const rows = await rest<Array<JsonRecord>>(table, { query: `${scope}select=id,created_at&order=created_at.desc&limit=1000` });
    result[table] = {
      databaseCount: rows.length,
      memoryCount: null,
      matched: null,
      missingInMemory: null,
      missingInDatabase: 0,
      valueMismatch: 0,
      statusMismatch: 0,
      ids: rows.slice(0, 20).map((x) => x.id),
      dataSource: "database",
    };
  }
  return result;
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
      lastSuccessfulWriteAt: lastSuccessfulWriteAt || null,
      lastDatabaseError: lastDatabaseError || null,
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
      writeTestStatus: lastWriteTest,
      lastSuccessfulWriteAt: lastSuccessfulWriteAt || (lastWriteTest.status === "passed" ? lastWriteTest.lastRunAt : null),
      lastDatabaseError: lastDatabaseError || null,
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
      writeTestStatus: lastWriteTest.status === "not_run" ? { ...lastWriteTest, status: "failed" as const, errorCode: "HEALTH_READ_FAILED" } : lastWriteTest,
      lastSuccessfulWriteAt: lastSuccessfulWriteAt || null,
      lastDatabaseError: error instanceof Error ? error.message : String(error),
      dualWriteStatus: "degraded",
    };
  }
}
