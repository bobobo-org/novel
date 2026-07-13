import crypto from "crypto";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

export const STORY_BIBLE_SCHEMA_VERSION = "story-bible-v1";
export const STORY_BIBLE_MIGRATION_VERSION = "p0c_story_bible_003";
export const STORY_BIBLE_EXTRACT_PROMPT_VERSION = "story-bible-extractor-v1";
export const STORY_BIBLE_CONFLICT_PROMPT_VERSION = "story-bible-conflict-review-v1";
export const STORY_BIBLE_SUMMARY_PROMPT_VERSION = "story-bible-summary-v1";

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

async function rest<T>(table: string, init: RequestInit & { query?: string } = {}): Promise<T> {
  const cfg = supabaseConfig();
  if (!cfg.url || !cfg.key) throw new Error("STORY_BIBLE_PERSISTENCE_NOT_CONFIGURED");
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
    throw new Error(`STORY_BIBLE_HTTP_${response.status}:${text.slice(0, 300)}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function upsert(table: string, row: JsonRecord, onConflict = "id") {
  return rest<JsonRecord[]>(table, {
    method: "POST",
    query: `on_conflict=${encodeURIComponent(onConflict)}`,
    body: JSON.stringify(row),
  });
}

async function insertRows(table: string, rows: JsonRecord[]) {
  if (rows.length === 0) return [];
  return rest<JsonRecord[]>(table, {
    method: "POST",
    body: JSON.stringify(rows),
  });
}

function hashText(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function clampText(value: unknown, max = 1200) {
  return String(value ?? "").trim().slice(0, max);
}

function nowIso() {
  return new Date().toISOString();
}

export const SourceRefSchema = z.object({
  projectId: z.string().min(1).max(120),
  chapterId: z.string().max(120).optional(),
  sceneId: z.string().max(120).optional(),
  paragraphIndex: z.number().int().min(0).optional(),
  textStart: z.number().int().min(0).optional(),
  textEnd: z.number().int().min(0).optional(),
  excerptHash: z.string().min(8).max(128),
  extractionRunId: z.string().max(160).optional(),
});

const CandidateOperationSchema = z.enum(["create", "update", "append", "remove", "supersede", "no-change"]);

export const StoryBibleCandidateSchema = z.object({
  entityType: z.enum([
    "project",
    "character",
    "relationship",
    "worldRule",
    "location",
    "faction",
    "item",
    "event",
    "timeline",
    "foreshadowing",
    "openThread",
    "chapterSummary",
  ]),
  entityId: z.string().max(160).optional(),
  temporaryEntityId: z.string().max(160).optional(),
  operation: CandidateOperationSchema,
  fieldPath: z.string().min(1).max(300),
  previousValue: z.unknown().optional(),
  proposedValue: z.unknown(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(1200),
  sourceRefs: z.array(SourceRefSchema).max(8).default([]),
  reason: z.string().max(800),
  conflictRisk: z.enum(["low", "medium", "high", "needs-review"]).default("low"),
});

export const StoryBibleConflictSchema = z.object({
  conflictId: z.string().max(160).optional(),
  severity: z.enum(["info", "warning", "major", "blocking"]),
  conflictType: z.string().min(1).max(160),
  canonicalFact: z.unknown().optional(),
  candidateFact: z.unknown(),
  sourceRefs: z.array(SourceRefSchema).max(8).default([]),
  explanation: z.string().min(1).max(1000),
  suggestedResolution: z.string().max(1000).optional(),
  autoResolvable: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
});

export const ChapterSummaryCandidateSchema = z.object({
  chapterId: z.string().max(120),
  chapterNumber: z.number().int().min(0).optional(),
  title: z.string().max(200).optional(),
  summary: z.string().max(1600),
  characterChanges: z.array(z.string().max(300)).max(20).default([]),
  worldChanges: z.array(z.string().max(300)).max(20).default([]),
  newFacts: z.array(z.string().max(300)).max(30).default([]),
  resolvedThreads: z.array(z.string().max(200)).max(20).default([]),
  newThreads: z.array(z.string().max(200)).max(20).default([]),
  plantedForeshadowing: z.array(z.string().max(200)).max(20).default([]),
  paidForeshadowing: z.array(z.string().max(200)).max(20).default([]),
  endingState: z.string().max(800).default(""),
  sourceHash: z.string().max(128),
});

export const StoryBibleExtractionInputSchema = z.object({
  projectId: z.string().min(1).max(120),
  chapterId: z.string().min(1).max(120),
  chapterNumber: z.number().int().min(0).optional(),
  chapterTitle: z.string().max(200).default(""),
  chapterText: z.string().min(1).max(30000),
  previousChapterSummary: z.string().max(2000).default(""),
  currentCanonicalSnapshot: z.unknown().optional(),
  extractionMode: z.enum(["chapter-new", "chapter-edited", "rebuild-single-chapter"]).default("chapter-new"),
});

export const StoryBibleExtractionOutputSchema = z.object({
  candidateFacts: z.array(StoryBibleCandidateSchema).max(40).default([]),
  candidateUpdates: z.array(StoryBibleCandidateSchema).max(40).default([]),
  candidateDeletions: z.array(StoryBibleCandidateSchema).max(20).default([]),
  candidateConflicts: z.array(StoryBibleConflictSchema).max(20).default([]),
  chapterSummaryCandidate: ChapterSummaryCandidateSchema,
  extractionWarnings: z.array(z.string().max(300)).max(20).default([]),
  confidence: z.number().min(0).max(1),
});

export type StoryBibleExtractionInput = z.infer<typeof StoryBibleExtractionInputSchema>;
export type StoryBibleExtractionOutput = z.infer<typeof StoryBibleExtractionOutputSchema>;

function modelConfig() {
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
  const requestedModel = process.env.AI_MODEL || "";
  return {
    provider: "google",
    googleKey,
    modelId: requestedModel && requestedModel !== "gemini-flash-latest" ? requestedModel : "gemini-3.1-flash-lite",
  };
}

function buildSourceRefs(input: StoryBibleExtractionInput, extractionRunId: string) {
  const paragraphs = input.chapterText
    .split(/\n{2,}|\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 80);
  let cursor = 0;
  return paragraphs.map((paragraph, index) => {
    const textStart = input.chapterText.indexOf(paragraph, cursor);
    const safeStart = textStart >= 0 ? textStart : cursor;
    const textEnd = safeStart + paragraph.length;
    cursor = textEnd;
    return {
      projectId: input.projectId,
      chapterId: input.chapterId,
      paragraphIndex: index,
      textStart: safeStart,
      textEnd,
      excerptHash: hashText(paragraph),
      extractionRunId,
      excerpt: paragraph.slice(0, 500),
    };
  });
}

function sourceRefForText(input: StoryBibleExtractionInput, extractionRunId: string, text: string, fallbackIndex = 0) {
  const idx = text ? input.chapterText.indexOf(text.slice(0, Math.min(40, text.length))) : -1;
  const excerpt = idx >= 0 ? input.chapterText.slice(idx, Math.min(input.chapterText.length, idx + Math.max(80, text.length))) : input.chapterText.slice(0, 240);
  return {
    projectId: input.projectId,
    chapterId: input.chapterId,
    paragraphIndex: fallbackIndex,
    textStart: idx >= 0 ? idx : 0,
    textEnd: idx >= 0 ? idx + excerpt.length : Math.min(input.chapterText.length, excerpt.length),
    excerptHash: hashText(excerpt),
    extractionRunId,
  };
}

function localExtraction(input: StoryBibleExtractionInput, extractionRunId: string, reason: string): StoryBibleExtractionOutput {
  const text = input.chapterText;
  const sourceRef = sourceRefForText(input, extractionRunId, text.slice(0, 120), 0);
  const possibleNames = Array.from(new Set((text.match(/[\u4e00-\u9fff]{2,4}/g) || []).filter((x) => !/[的是了在與和也就都而及或]/.test(x)).slice(0, 8)));
  const candidates: z.infer<typeof StoryBibleCandidateSchema>[] = [];
  for (const name of possibleNames.slice(0, 3)) {
    candidates.push({
      entityType: "character",
      temporaryEntityId: `temp_character_${hashText(name).slice(0, 8)}`,
      operation: "create",
      fieldPath: "characters[].canonicalName",
      proposedValue: { canonicalName: name, note: "本地規則從章節文字偵測到可能人物名稱，需作者確認。" },
      confidence: 0.45,
      evidence: `章節中出現「${name}」。`,
      sourceRefs: [sourceRef],
      reason: "local-rule-basic-extraction name heuristic",
      conflictRisk: "needs-review",
    });
  }
  candidates.push({
    entityType: "event",
    temporaryEntityId: `temp_event_${hashText(text).slice(0, 8)}`,
    operation: "create",
    fieldPath: "events[].title",
    proposedValue: { title: input.chapterTitle || `第${input.chapterNumber || 0}章事件`, description: text.slice(0, 500) },
    confidence: 0.5,
    evidence: text.slice(0, 500),
    sourceRefs: [sourceRef],
    reason,
    conflictRisk: "needs-review",
  });
  const hookMatch = text.match(/(?:然而|但是|忽然|下一刻|沒想到|卻)([^。！？]{8,80}[。！？]?)/);
  if (hookMatch?.[0]) {
    candidates.push({
      entityType: "openThread",
      temporaryEntityId: `temp_thread_${hashText(hookMatch[0]).slice(0, 8)}`,
      operation: "create",
      fieldPath: "openThreads[].description",
      proposedValue: { title: "章尾或中段懸念", description: hookMatch[0], status: "open" },
      confidence: 0.42,
      evidence: hookMatch[0],
      sourceRefs: [sourceRefForText(input, extractionRunId, hookMatch[0], 0)],
      reason: "local-rule-basic-extraction hook heuristic",
      conflictRisk: "needs-review",
    });
  }
  return {
    candidateFacts: candidates,
    candidateUpdates: [],
    candidateDeletions: [],
    candidateConflicts: [],
    chapterSummaryCandidate: {
      chapterId: input.chapterId,
      chapterNumber: input.chapterNumber,
      title: input.chapterTitle,
      summary: text.slice(0, 1000),
      characterChanges: [],
      worldChanges: [],
      newFacts: candidates.map((x) => clampText(x.evidence, 160)),
      resolvedThreads: [],
      newThreads: candidates.filter((x) => x.entityType === "openThread").map((x) => clampText((x.proposedValue as JsonRecord).description, 180)),
      plantedForeshadowing: [],
      paidForeshadowing: [],
      endingState: text.slice(-500),
      sourceHash: hashText(text),
    },
    extractionWarnings: [`已使用本地規則降級抽取：${reason}`],
    confidence: 0.45,
  };
}

function buildExtractionPrompt(input: StoryBibleExtractionInput, extractionRunId: string) {
  return JSON.stringify({
    task: "STORY_BIBLE_CANDIDATE_EXTRACTION",
    schemaVersion: STORY_BIBLE_SCHEMA_VERSION,
    promptVersion: STORY_BIBLE_EXTRACT_PROMPT_VERSION,
    rules: [
      "只抽取候選資料，不得直接宣稱為正式 Canonical Fact。",
      "所有候選必須有 evidence 與 sourceRefs。",
      "若不確定，conflictRisk 使用 needs-review，confidence 降低。",
      "不要輸出 Markdown，只輸出 JSON。",
      "不要輸出 API key、token、connection string 或任何敏感資料。",
    ],
    outputShape: {
      candidateFacts: "StoryBibleCandidate[] <= 40",
      candidateUpdates: "StoryBibleCandidate[] <= 40",
      candidateDeletions: "StoryBibleCandidate[] <= 20",
      candidateConflicts: "StoryBibleConflict[] <= 20",
      chapterSummaryCandidate: "ChapterSummaryCandidate",
      extractionWarnings: "string[]",
      confidence: "number 0-1",
    },
    sourceRefTemplate: {
      projectId: input.projectId,
      chapterId: input.chapterId,
      paragraphIndex: 0,
      textStart: 0,
      textEnd: 0,
      excerptHash: "use provided paragraph hash when possible",
      extractionRunId,
    },
    currentCanonicalSnapshot: input.currentCanonicalSnapshot || {},
    chapter: {
      projectId: input.projectId,
      chapterId: input.chapterId,
      chapterNumber: input.chapterNumber,
      chapterTitle: input.chapterTitle,
      previousChapterSummary: input.previousChapterSummary,
      chapterText: input.chapterText.slice(0, 12000),
    },
  });
}

async function extractWithModel(input: StoryBibleExtractionInput, extractionRunId: string) {
  const cfg = modelConfig();
  if (!cfg.googleKey) throw new Error("MODEL_NOT_CONFIGURED");
  const prompt = buildExtractionPrompt(input, extractionRunId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("STORY_BIBLE_EXTRACT_TIMEOUT")), 18_000);
  try {
    const { text } = await generateText({
      model: google(cfg.modelId),
      system: "你是長篇小說 Story Bible 抽取器。只輸出符合指定 schema 的繁體中文 JSON，不要寫 Markdown，不得把候選當成正式記憶。",
      prompt,
      temperature: 0.15,
      maxOutputTokens: 2200,
      abortSignal: controller.signal,
    });
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text);
    return StoryBibleExtractionOutputSchema.parse(parsed);
  } finally {
    clearTimeout(timer);
  }
}

function withRunSourceRefs(output: StoryBibleExtractionOutput, input: StoryBibleExtractionInput, extractionRunId: string) {
  const fix = (candidate: z.infer<typeof StoryBibleCandidateSchema>, index: number) => {
    const refs = candidate.sourceRefs.length ? candidate.sourceRefs : [sourceRefForText(input, extractionRunId, candidate.evidence, index)];
    return { ...candidate, sourceRefs: refs.map((ref) => ({ ...ref, projectId: input.projectId, chapterId: ref.chapterId || input.chapterId, extractionRunId })) };
  };
  return StoryBibleExtractionOutputSchema.parse({
    ...output,
    candidateFacts: output.candidateFacts.map(fix),
    candidateUpdates: output.candidateUpdates.map(fix),
    candidateDeletions: output.candidateDeletions.map(fix),
    candidateConflicts: output.candidateConflicts.map((conflict, index) => ({
      ...conflict,
      sourceRefs: (conflict.sourceRefs.length ? conflict.sourceRefs : [sourceRefForText(input, extractionRunId, conflict.explanation, index)])
        .map((ref) => ({ ...ref, projectId: input.projectId, chapterId: ref.chapterId || input.chapterId, extractionRunId })),
    })),
    chapterSummaryCandidate: {
      ...output.chapterSummaryCandidate,
      chapterId: input.chapterId,
      chapterNumber: input.chapterNumber,
      title: output.chapterSummaryCandidate.title || input.chapterTitle,
      sourceHash: output.chapterSummaryCandidate.sourceHash || hashText(input.chapterText),
    },
  });
}

export async function extractStoryBibleCandidates(input: StoryBibleExtractionInput) {
  const extractionRunId = `story_extract_${crypto.randomUUID()}`;
  const traceId = crypto.randomUUID();
  const cfg = modelConfig();
  const started = Date.now();
  let fallbackLevel: "cloud-full" | "local-rule-basic-extraction" = "cloud-full";
  let warning = "";
  let output: StoryBibleExtractionOutput;
  try {
    output = await extractWithModel(input, extractionRunId);
  } catch (error) {
    fallbackLevel = "local-rule-basic-extraction";
    warning = error instanceof Error ? error.message : String(error);
    output = localExtraction(input, extractionRunId, warning);
  }
  const normalized = withRunSourceRefs(output, input, extractionRunId);
  await persistStoryBibleExtraction({
    input,
    output: normalized,
    extractionRunId,
    traceId,
    modelId: cfg.modelId,
    fallbackLevel,
    elapsedMs: Date.now() - started,
  });
  return {
    ...normalized,
    sourceRefs: collectSourceRefs(normalized),
    modelId: cfg.modelId,
    promptVersion: STORY_BIBLE_EXTRACT_PROMPT_VERSION,
    schemaVersion: STORY_BIBLE_SCHEMA_VERSION,
    confidence: normalized.confidence,
    traceId,
    extractionRunId,
    fallbackLevel,
    elapsedMs: Date.now() - started,
  };
}

function collectSourceRefs(output: StoryBibleExtractionOutput) {
  const refs = [
    ...output.candidateFacts.flatMap((x) => x.sourceRefs),
    ...output.candidateUpdates.flatMap((x) => x.sourceRefs),
    ...output.candidateDeletions.flatMap((x) => x.sourceRefs),
    ...output.candidateConflicts.flatMap((x) => x.sourceRefs),
  ];
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.extractionRunId}:${ref.chapterId}:${ref.excerptHash}:${ref.textStart}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function ensureStoryBible(projectId: string, input: StoryBibleExtractionInput) {
  const now = nowIso();
  await upsert("story_bibles", {
    project_id: projectId,
    schema_version: STORY_BIBLE_SCHEMA_VERSION,
    status: "active",
    core_json: {
      projectId,
      title: "",
      genre: "",
      currentStoryStage: "",
      lastExtractedChapterId: input.chapterId,
    },
    created_at: now,
    updated_at: now,
  }, "project_id");
}

export async function persistStoryBibleExtraction(args: {
  input: StoryBibleExtractionInput;
  output: StoryBibleExtractionOutput;
  extractionRunId: string;
  traceId: string;
  modelId: string;
  fallbackLevel: string;
  elapsedMs: number;
}) {
  if (!isConfigured()) throw new Error("STORY_BIBLE_PERSISTENCE_NOT_CONFIGURED");
  const { input, output, extractionRunId, traceId, modelId, fallbackLevel } = args;
  await ensureStoryBible(input.projectId, input);
  const inputHash = hashText(JSON.stringify({
    projectId: input.projectId,
    chapterId: input.chapterId,
    chapterNumber: input.chapterNumber,
    chapterTitle: input.chapterTitle,
    chapterTextHash: hashText(input.chapterText),
    currentCanonicalSnapshotHash: hashText(JSON.stringify(input.currentCanonicalSnapshot || {})),
  }));
  await upsert("story_bible_extraction_runs", {
    id: extractionRunId,
    project_id: input.projectId,
    chapter_id: input.chapterId,
    chapter_number: input.chapterNumber ?? null,
    extraction_mode: input.extractionMode,
    schema_version: STORY_BIBLE_SCHEMA_VERSION,
    prompt_version: STORY_BIBLE_EXTRACT_PROMPT_VERSION,
    model_id: modelId,
    fallback_level: fallbackLevel,
    status: "completed",
    confidence: output.confidence,
    warnings: output.extractionWarnings,
    input_hash: inputHash,
    output_json: {
      candidateFacts: output.candidateFacts.length,
      candidateUpdates: output.candidateUpdates.length,
      candidateDeletions: output.candidateDeletions.length,
      candidateConflicts: output.candidateConflicts.length,
      elapsedMs: args.elapsedMs,
      traceId,
    },
    created_at: nowIso(),
  });
  const allCandidates = [
    ...output.candidateFacts,
    ...output.candidateUpdates,
    ...output.candidateDeletions,
  ];
  const candidateRows = allCandidates.map((candidate) => {
    const id = `story_candidate_${crypto.randomUUID()}`;
    return {
      id,
      project_id: input.projectId,
      extraction_run_id: extractionRunId,
      entity_type: candidate.entityType,
      entity_id: candidate.entityId || null,
      temporary_entity_id: candidate.temporaryEntityId || null,
      operation: candidate.operation,
      field_path: candidate.fieldPath,
      previous_value: candidate.previousValue ?? null,
      proposed_value: candidate.proposedValue,
      confidence: candidate.confidence,
      evidence: candidate.evidence,
      source_refs: candidate.sourceRefs,
      reason: candidate.reason,
      conflict_risk: candidate.conflictRisk,
      status: candidate.conflictRisk === "needs-review" ? "needs-review" : "pending",
      created_at: nowIso(),
    };
  });
  await insertRows("story_fact_candidates", candidateRows);
  const conflicts = output.candidateConflicts.map((conflict, index) => ({
    id: conflict.conflictId || `story_conflict_${crypto.randomUUID()}`,
    project_id: input.projectId,
    extraction_run_id: extractionRunId,
    candidate_id: candidateRows[index]?.id || null,
    severity: conflict.severity,
    conflict_type: conflict.conflictType,
    canonical_fact: conflict.canonicalFact ?? null,
    candidate_fact: conflict.candidateFact,
    source_refs: conflict.sourceRefs,
    explanation: conflict.explanation,
    suggested_resolution: conflict.suggestedResolution || null,
    auto_resolvable: conflict.autoResolvable,
    confidence: conflict.confidence,
    status: "open",
    created_at: nowIso(),
  }));
  await insertRows("story_fact_conflicts", conflicts);
  const sourceRows = collectSourceRefs(output).map((ref) => ({
    id: `story_source_${crypto.randomUUID()}`,
    project_id: input.projectId,
    extraction_run_id: extractionRunId,
    candidate_id: null,
    chapter_id: ref.chapterId || input.chapterId,
    scene_id: ref.sceneId || null,
    paragraph_index: ref.paragraphIndex ?? null,
    text_start: ref.textStart ?? null,
    text_end: ref.textEnd ?? null,
    excerpt_hash: ref.excerptHash,
    excerpt: input.chapterText.slice(ref.textStart || 0, Math.min(input.chapterText.length, ref.textEnd || (ref.textStart || 0) + 500)).slice(0, 500),
    created_at: nowIso(),
  }));
  await insertRows("story_fact_sources", sourceRows);
  await upsert("story_chapter_summaries", {
    id: `story_chapter_summary_${input.projectId}_${input.chapterId}`,
    project_id: input.projectId,
    chapter_id: input.chapterId,
    chapter_number: input.chapterNumber ?? null,
    title: output.chapterSummaryCandidate.title || input.chapterTitle,
    summary: output.chapterSummaryCandidate.summary,
    summary_json: output.chapterSummaryCandidate,
    source_hash: output.chapterSummaryCandidate.sourceHash,
    updated_at: nowIso(),
  });
  return { extractionRunId, candidateCount: candidateRows.length, conflictCount: conflicts.length, sourceRefCount: sourceRows.length };
}

export async function storyBibleHealth() {
  if (!isConfigured()) {
    return {
      storyBibleStatus: "not_configured",
      storyBibleSchemaVersion: STORY_BIBLE_SCHEMA_VERSION,
      storyBibleExtractionStatus: "not_configured",
      storyBibleMigrationVersion: "",
    };
  }
  try {
    const migrationRows = await rest<Array<{ version: string }>>("schema_migrations", {
      query: `select=version&version=eq.${STORY_BIBLE_MIGRATION_VERSION}&limit=1`,
    });
    const migrationOk = migrationRows.some((row) => row.version === STORY_BIBLE_MIGRATION_VERSION);
    const runs = migrationOk
      ? await rest<Array<JsonRecord>>("story_bible_extraction_runs", { query: "select=id,status,created_at&order=created_at.desc&limit=10" })
      : [];
    return {
      storyBibleStatus: migrationOk ? "ready" : "migration_required",
      storyBibleSchemaVersion: STORY_BIBLE_SCHEMA_VERSION,
      storyBibleExtractionStatus: runs[0]?.status || "not_run",
      storyBibleMigrationVersion: migrationOk ? STORY_BIBLE_MIGRATION_VERSION : "",
      storyBibleRecentExtractionAt: runs[0]?.created_at || null,
    };
  } catch (error) {
    return {
      storyBibleStatus: "error",
      storyBibleSchemaVersion: STORY_BIBLE_SCHEMA_VERSION,
      storyBibleExtractionStatus: "error",
      storyBibleMigrationVersion: "",
      storyBibleError: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
    };
  }
}

export async function listStoryBibleCandidates(projectId: string, limit = 20) {
  return rest<Array<JsonRecord>>("story_fact_candidates", {
    query: `project_id=eq.${encodeURIComponent(projectId)}&select=*&order=created_at.desc&limit=${Math.max(1, Math.min(100, limit))}`,
  });
}
