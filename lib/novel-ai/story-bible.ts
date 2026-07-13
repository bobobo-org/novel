import crypto from "crypto";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

export const STORY_BIBLE_SCHEMA_VERSION = "story-bible-v1";
export const STORY_BIBLE_MIGRATION_VERSION = "p0c_story_bible_003";
export const STORY_BIBLE_EXTRACT_PROMPT_VERSION = "story-bible-extractor-v1.1";
export const STORY_BIBLE_CONFLICT_PROMPT_VERSION = "story-bible-conflict-review-v1";
export const STORY_BIBLE_SUMMARY_PROMPT_VERSION = "story-bible-summary-v1";

type JsonRecord = Record<string, unknown>;
type CandidateTrust = "cloud-validated" | "cloud-repaired" | "cloud-reduced" | "local-rule" | "invalid";

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
  return rest<JsonRecord[]>(table, { method: "POST", body: JSON.stringify(rows) });
}

function hashText(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function clampText(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function estimateTokensFromText(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

const EvidenceTypeSchema = z.enum([
  "direct_statement",
  "dialogue",
  "action",
  "narration",
  "object_transfer",
  "world_rule",
  "foreshadowing",
  "promise",
  "ambiguous",
]);

const SimpleEntityTypeSchema = z.enum(["character", "event", "item", "world_rule", "foreshadowing", "open_thread"]);
const CandidateOperationSchema = z.enum(["create", "update", "append", "no-change"]);
const PrimitiveValueSchema = z.union([
  z.string().max(800),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(10),
]);

export const ModelSourceRefSchema = z.strictObject({
  paragraphIndex: z.number().int().min(0).max(200),
  excerpt: z.string().min(2).max(500),
  evidenceType: EvidenceTypeSchema,
});

export const ModelCandidateSchema = z.strictObject({
  entityType: SimpleEntityTypeSchema,
  temporaryEntityId: z.string().min(3).max(80).regex(/^[a-z][a-z0-9_-]{2,79}$/),
  operation: CandidateOperationSchema,
  fieldPath: z.string().min(3).max(160).regex(/^(characters|events|items|worldRules|foreshadowing|openThreads)\[\]\.[a-zA-Z0-9_.-]+$/),
  proposedValue: PrimitiveValueSchema,
  confidence: z.number().min(0).max(1),
  evidenceType: EvidenceTypeSchema,
  sourceRef: ModelSourceRefSchema,
  reason: z.string().min(2).max(200),
});

export const SimpleExtractionSchema = z.strictObject({
  candidates: z.array(ModelCandidateSchema).max(20).default([]),
  chapterSummaryCandidate: z.strictObject({
    summary: z.string().min(2).max(1200),
    endingState: z.string().max(500).default(""),
    newThreads: z.array(z.string().max(160)).max(10).default([]),
    newFacts: z.array(z.string().max(160)).max(20).default([]),
  }),
  warnings: z.array(z.string().max(200)).max(12).default([]),
  confidence: z.number().min(0).max(1),
});

export const SourceRefSchema = z.object({
  projectId: z.string().min(1).max(120),
  chapterId: z.string().max(120).optional(),
  sceneId: z.string().max(120).optional(),
  paragraphIndex: z.number().int().min(0).optional(),
  textStart: z.number().int().min(0).optional(),
  textEnd: z.number().int().min(0).optional(),
  excerptHash: z.string().min(8).max(128),
  extractionRunId: z.string().max(160).optional(),
  excerpt: z.string().max(500).optional(),
  evidenceType: EvidenceTypeSchema.optional(),
  sourceValid: z.boolean().optional(),
});

export const StoryBibleCandidateSchema = z.object({
  entityType: SimpleEntityTypeSchema,
  entityId: z.string().max(160).optional(),
  temporaryEntityId: z.string().max(160).optional(),
  operation: CandidateOperationSchema,
  fieldPath: z.string().min(1).max(300),
  previousValue: z.unknown().optional(),
  proposedValue: z.unknown(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(1200),
  evidenceType: EvidenceTypeSchema.default("ambiguous"),
  sourceRefs: z.array(SourceRefSchema).max(8).default([]),
  reason: z.string().max(800),
  conflictRisk: z.enum(["low", "medium", "high", "needs-review"]).default("low"),
  candidateTrust: z.enum(["cloud-validated", "cloud-repaired", "cloud-reduced", "local-rule", "invalid"]).default("cloud-validated"),
  sourceValid: z.boolean().default(true),
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
type SimpleExtraction = z.infer<typeof SimpleExtractionSchema>;
type ModelCandidate = z.infer<typeof ModelCandidateSchema>;

export type StoryBibleExtractionTrace = {
  traceId: string;
  modelId: string;
  promptVersion: string;
  schemaVersion: string;
  inputChars: number;
  estimatedInputTokens: number;
  outputChars: number;
  providerElapsedMs: number;
  rawOutputReceived: boolean;
  jsonParseResult: "valid" | "invalid" | "not_needed";
  schemaValidationErrors: Array<{ path: string; code: string; message: string }>;
  repairAttempted: boolean;
  repairElapsedMs: number;
  repairMethod: string;
  fieldsRemoved: string[];
  fieldsCoerced: string[];
  modelRepairUsed: boolean;
  finalSchemaValid: boolean;
  fallbackUsed: CandidateTrust;
};

function modelConfig() {
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
  const requestedModel = process.env.AI_MODEL || "";
  return {
    provider: "google",
    googleKey,
    modelId: requestedModel && requestedModel !== "gemini-flash-latest" ? requestedModel : "gemini-3.1-flash-lite",
  };
}

function paragraphList(text: string) {
  return text
    .split(/\n{2,}|\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 200);
}

function buildModelPrompt(input: StoryBibleExtractionInput) {
  const paragraphs = paragraphList(input.chapterText).map((text, index) => ({ paragraphIndex: index, text }));
  return JSON.stringify({
    task: "story_bible_candidate_extraction_v1_1",
    language: "Traditional Chinese",
    rules: [
      "Extract candidates only. Do not mark anything as canonical.",
      "Allowed entityType only: character, event, item, world_rule, foreshadowing, open_thread.",
      "Use direct text evidence only. Lies, rumors, dreams, hallucinations, and memories must be marked as low confidence or open_thread, not objective event facts.",
      "If a paragraph has no new story fact, do not invent a candidate.",
      "sourceRef.excerpt must be an exact substring from the provided paragraph.",
      "proposedValue must be a scalar string, number, boolean, or short string array; never return an object.",
      "No markdown, no code fence, no extra keys.",
    ],
    fieldPathExamples: [
      "characters[].canonicalName",
      "characters[].age",
      "events[].title",
      "items[].currentOwner",
      "worldRules[].description",
      "foreshadowing[].description",
      "openThreads[].description",
    ],
    chapter: {
      projectId: input.projectId,
      chapterId: input.chapterId,
      chapterNumber: input.chapterNumber,
      chapterTitle: input.chapterTitle,
      previousChapterSummary: input.previousChapterSummary.slice(0, 800),
      paragraphs,
    },
  });
}

function normalizeJsonText(text: string) {
  return text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function repairCandidate(raw: unknown, index: number, stats: { fieldsRemoved: string[]; fieldsCoerced: string[] }): ModelCandidate | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as JsonRecord;
  const allowed = new Set(["entityType", "temporaryEntityId", "operation", "fieldPath", "proposedValue", "confidence", "evidenceType", "sourceRef", "reason"]);
  for (const key of Object.keys(source)) if (!allowed.has(key)) stats.fieldsRemoved.push(`candidates[${index}].${key}`);
  const entity = String(source.entityType || "").replace(/worldRule/i, "world_rule").replace(/openThread/i, "open_thread");
  let proposed: z.infer<typeof PrimitiveValueSchema>;
  if (Array.isArray(source.proposedValue)) {
    proposed = source.proposedValue.slice(0, 10).map((item) => clampText(item, 200));
  } else if (typeof source.proposedValue === "string" || typeof source.proposedValue === "number" || typeof source.proposedValue === "boolean") {
    proposed = source.proposedValue;
  } else if (source.proposedValue && typeof source.proposedValue === "object") {
    stats.fieldsCoerced.push(`candidates[${index}].proposedValue`);
    proposed = JSON.stringify(source.proposedValue).slice(0, 800);
  } else {
    stats.fieldsCoerced.push(`candidates[${index}].proposedValue`);
    proposed = "";
  }
  const sourceRef = source.sourceRef && typeof source.sourceRef === "object" ? source.sourceRef as JsonRecord : {};
  const repaired = {
    entityType: entity,
    temporaryEntityId: String(source.temporaryEntityId || `temp_${entity || "fact"}_${index}`).toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80),
    operation: source.operation || "create",
    fieldPath: String(source.fieldPath || `${entity === "world_rule" ? "worldRules" : entity === "open_thread" ? "openThreads" : `${entity}s`}[].description`),
    proposedValue: proposed,
    confidence: Number(source.confidence ?? 0.5),
    evidenceType: source.evidenceType || sourceRef.evidenceType || "ambiguous",
    sourceRef: {
      paragraphIndex: Number(sourceRef.paragraphIndex ?? 0),
      excerpt: clampText(sourceRef.excerpt || source.evidence || "", 500),
      evidenceType: sourceRef.evidenceType || source.evidenceType || "ambiguous",
    },
    reason: clampText(source.reason || "model candidate", 200),
  };
  const parsed = ModelCandidateSchema.safeParse(repaired);
  return parsed.success ? parsed.data : undefined;
}

function repairSimpleExtraction(value: unknown) {
  const started = Date.now();
  const stats = {
    repairAttempted: true,
    repairElapsedMs: 0,
    repairMethod: "local-json-normalize-and-field-prune",
    fieldsRemoved: [] as string[],
    fieldsCoerced: [] as string[],
    modelRepairUsed: false,
  };
  let source: JsonRecord | undefined;
  try {
    source = typeof value === "string" ? JSON.parse(normalizeJsonText(value)) as JsonRecord : value as JsonRecord;
  } catch {
    stats.repairElapsedMs = Date.now() - started;
    return { value: undefined, stats };
  }
  if (!source || typeof source !== "object") {
    stats.repairElapsedMs = Date.now() - started;
    return { value: undefined, stats };
  }
  const rootAllowed = new Set(["candidates", "chapterSummaryCandidate", "warnings", "confidence"]);
  for (const key of Object.keys(source)) if (!rootAllowed.has(key)) stats.fieldsRemoved.push(key);
  const candidates = Array.isArray(source.candidates)
    ? source.candidates.map((candidate, index) => repairCandidate(candidate, index, stats)).filter(Boolean)
    : [];
  if (!Array.isArray(source.candidates)) stats.fieldsCoerced.push("candidates");
  const summaryRaw = source.chapterSummaryCandidate && typeof source.chapterSummaryCandidate === "object"
    ? source.chapterSummaryCandidate as JsonRecord
    : {};
  const repaired = {
    candidates,
    chapterSummaryCandidate: {
      summary: clampText(summaryRaw.summary || source.summary || "", 1200) || "本章沒有足夠可抽取的新事實。",
      endingState: clampText(summaryRaw.endingState || "", 500),
      newThreads: Array.isArray(summaryRaw.newThreads) ? summaryRaw.newThreads.map((x) => clampText(x, 160)).slice(0, 10) : [],
      newFacts: Array.isArray(summaryRaw.newFacts) ? summaryRaw.newFacts.map((x) => clampText(x, 160)).slice(0, 20) : [],
    },
    warnings: Array.isArray(source.warnings) ? source.warnings.map((x) => clampText(x, 200)).slice(0, 12) : [],
    confidence: Number(source.confidence ?? 0.5),
  };
  stats.repairElapsedMs = Date.now() - started;
  const parsed = SimpleExtractionSchema.safeParse(repaired);
  return { value: parsed.success ? parsed.data : undefined, stats };
}

function sourceRefForExcerpt(input: StoryBibleExtractionInput, extractionRunId: string, ref: z.infer<typeof ModelSourceRefSchema>) {
  const paragraphs = paragraphList(input.chapterText);
  const paragraph = paragraphs[ref.paragraphIndex] || "";
  let idx = ref.excerpt ? input.chapterText.indexOf(ref.excerpt) : -1;
  if (idx < 0 && paragraph) idx = input.chapterText.indexOf(paragraph);
  const sourceValid = ref.excerpt ? idx >= 0 : false;
  const excerpt = sourceValid ? ref.excerpt : (paragraph || input.chapterText).slice(0, 300);
  const textStart = idx >= 0 ? idx : Math.max(0, input.chapterText.indexOf(excerpt));
  const start = textStart >= 0 ? textStart : 0;
  return {
    projectId: input.projectId,
    chapterId: input.chapterId,
    paragraphIndex: ref.paragraphIndex,
    textStart: start,
    textEnd: Math.min(input.chapterText.length, start + excerpt.length),
    excerptHash: hashText(excerpt),
    extractionRunId,
    excerpt,
    evidenceType: ref.evidenceType,
    sourceValid,
  };
}

function convertSimpleOutput(input: StoryBibleExtractionInput, extractionRunId: string, simple: SimpleExtraction, trust: CandidateTrust): StoryBibleExtractionOutput {
  const perType = new Map<string, number>();
  const candidates = simple.candidates.filter((candidate) => {
    const count = perType.get(candidate.entityType) || 0;
    if (count >= 5) return false;
    perType.set(candidate.entityType, count + 1);
    return true;
  }).map((candidate) => {
    const sourceRef = sourceRefForExcerpt(input, extractionRunId, candidate.sourceRef);
    const sourceValid = Boolean(sourceRef.sourceValid);
    const confidence = sourceValid ? candidate.confidence : Math.min(candidate.confidence, 0.45);
    const risk = sourceValid && trust !== "local-rule" ? "low" : "needs-review";
    return StoryBibleCandidateSchema.parse({
      entityType: candidate.entityType,
      temporaryEntityId: candidate.temporaryEntityId,
      operation: candidate.operation,
      fieldPath: candidate.fieldPath,
      proposedValue: candidate.proposedValue,
      confidence,
      evidence: sourceRef.excerpt || candidate.reason,
      evidenceType: candidate.evidenceType,
      sourceRefs: [sourceRef],
      reason: candidate.reason,
      conflictRisk: risk,
      candidateTrust: trust,
      sourceValid,
    });
  });
  return StoryBibleExtractionOutputSchema.parse({
    candidateFacts: candidates,
    candidateUpdates: [],
    candidateDeletions: [],
    candidateConflicts: [],
    chapterSummaryCandidate: {
      chapterId: input.chapterId,
      chapterNumber: input.chapterNumber,
      title: input.chapterTitle,
      summary: simple.chapterSummaryCandidate.summary,
      characterChanges: [],
      worldChanges: [],
      newFacts: simple.chapterSummaryCandidate.newFacts,
      resolvedThreads: [],
      newThreads: simple.chapterSummaryCandidate.newThreads,
      plantedForeshadowing: candidates.filter((x) => x.entityType === "foreshadowing").map((x) => clampText(x.evidence, 200)),
      paidForeshadowing: [],
      endingState: simple.chapterSummaryCandidate.endingState,
      sourceHash: hashText(input.chapterText),
    },
    extractionWarnings: simple.warnings,
    confidence: simple.confidence,
  });
}

function localExtraction(input: StoryBibleExtractionInput, extractionRunId: string, reason: string): StoryBibleExtractionOutput {
  const text = input.chapterText;
  const markerMatch = text.match(/\b[A-Z][A-Z0-9_]{4,}\b/);
  const candidateText = markerMatch?.[0] || text.slice(0, 120);
  const sourceRef = sourceRefForExcerpt(input, extractionRunId, { paragraphIndex: 0, excerpt: candidateText, evidenceType: "direct_statement" });
  const simple: SimpleExtraction = {
    candidates: candidateText.trim()
      ? [{
          entityType: "event",
          temporaryEntityId: `temp_event_${hashText(candidateText).slice(0, 8)}`,
          operation: "create",
          fieldPath: "events[].title",
          proposedValue: clampText(input.chapterTitle || candidateText || "candidate event", 300),
          confidence: 0.35,
          evidenceType: "direct_statement",
          sourceRef: { paragraphIndex: sourceRef.paragraphIndex || 0, excerpt: sourceRef.excerpt || candidateText, evidenceType: "direct_statement" },
          reason: "本地規則只保留明確可定位文字，需人工確認。",
        }]
      : [],
    chapterSummaryCandidate: {
      summary: clampText(text, 1000) || "本章沒有足夠可抽取的新事實。",
      endingState: clampText(text.slice(-500), 500),
      newThreads: [],
      newFacts: [],
    },
    warnings: [`local-rule fallback: ${clampText(reason, 160)}`],
    confidence: 0.35,
  };
  return convertSimpleOutput(input, extractionRunId, simple, "local-rule");
}

async function extractWithModel(input: StoryBibleExtractionInput, extractionRunId: string, trace: StoryBibleExtractionTrace) {
  const cfg = modelConfig();
  if (!cfg.googleKey) throw new Error("MODEL_NOT_CONFIGURED");
  const prompt = buildModelPrompt(input);
  trace.inputChars = prompt.length;
  trace.estimatedInputTokens = estimateTokensFromText(prompt);
  const started = Date.now();
  const { object, usage } = await generateObject({
    model: google(cfg.modelId),
    schema: SimpleExtractionSchema,
    schemaName: "StoryBibleReducedExtraction",
    schemaDescription: "Reduced Story Bible candidate extraction result. No canonical writes.",
    system: "You extract pending Story Bible candidates. Return only structured JSON matching the schema. No markdown. Do not invent facts.",
    prompt,
    temperature: 0.05,
    maxOutputTokens: 1600,
  });
  trace.providerElapsedMs = Date.now() - started;
  trace.outputChars = JSON.stringify(object).length;
  trace.rawOutputReceived = true;
  trace.jsonParseResult = "valid";
  trace.finalSchemaValid = true;
  trace.fallbackUsed = "cloud-validated";
  trace.repairMethod = "none";
  trace.estimatedInputTokens = trace.estimatedInputTokens || Number(usage?.inputTokens || 0);
  return object;
}

export async function extractStoryBibleCandidates(input: StoryBibleExtractionInput) {
  const extractionRunId = `story_extract_${crypto.randomUUID()}`;
  const traceId = crypto.randomUUID();
  const cfg = modelConfig();
  const started = Date.now();
  const trace: StoryBibleExtractionTrace = {
    traceId,
    modelId: cfg.modelId,
    promptVersion: STORY_BIBLE_EXTRACT_PROMPT_VERSION,
    schemaVersion: STORY_BIBLE_SCHEMA_VERSION,
    inputChars: 0,
    estimatedInputTokens: 0,
    outputChars: 0,
    providerElapsedMs: 0,
    rawOutputReceived: false,
    jsonParseResult: "not_needed",
    schemaValidationErrors: [],
    repairAttempted: false,
    repairElapsedMs: 0,
    repairMethod: "none",
    fieldsRemoved: [],
    fieldsCoerced: [],
    modelRepairUsed: false,
    finalSchemaValid: false,
    fallbackUsed: "invalid",
  };
  let output: StoryBibleExtractionOutput;
  let trust: CandidateTrust = "cloud-validated";
  try {
    const simple = await extractWithModel(input, extractionRunId, trace);
    output = convertSimpleOutput(input, extractionRunId, simple, "cloud-validated");
  } catch (error) {
    const issueText = error instanceof z.ZodError
      ? error.issues.map((issue) => `${issue.path.join(".")}:${issue.code}:${issue.message}`).join("; ")
      : error instanceof Error ? error.message : String(error);
    trace.schemaValidationErrors = error instanceof z.ZodError
      ? error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message }))
      : [{ path: "model", code: "MODEL_OR_SCHEMA_ERROR", message: clampText(issueText, 500) }];
    const repaired = repairSimpleExtraction(error instanceof Error ? error.message : String(error));
    trace.repairAttempted = repaired.stats.repairAttempted;
    trace.repairElapsedMs = repaired.stats.repairElapsedMs;
    trace.repairMethod = repaired.stats.repairMethod;
    trace.fieldsRemoved = repaired.stats.fieldsRemoved;
    trace.fieldsCoerced = repaired.stats.fieldsCoerced;
    trace.modelRepairUsed = repaired.stats.modelRepairUsed;
    if (repaired.value) {
      trust = "cloud-repaired";
      trace.finalSchemaValid = true;
      trace.fallbackUsed = trust;
      output = convertSimpleOutput(input, extractionRunId, repaired.value, trust);
    } else {
      trust = "local-rule";
      trace.fallbackUsed = trust;
      output = localExtraction(input, extractionRunId, issueText);
      trace.finalSchemaValid = true;
    }
  }
  await persistStoryBibleExtraction({
    input,
    output,
    extractionRunId,
    traceId,
    modelId: cfg.modelId,
    fallbackLevel: trust,
    elapsedMs: Date.now() - started,
    trace,
  });
  return {
    ...output,
    candidates: output.candidateFacts,
    sourceRefs: collectSourceRefs(output),
    modelId: cfg.modelId,
    promptVersion: STORY_BIBLE_EXTRACT_PROMPT_VERSION,
    schemaVersion: STORY_BIBLE_SCHEMA_VERSION,
    confidence: output.confidence,
    traceId,
    extractionRunId,
    fallbackLevel: trust,
    elapsedMs: Date.now() - started,
    trace,
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
  fallbackLevel: CandidateTrust | string;
  elapsedMs: number;
  trace?: StoryBibleExtractionTrace;
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
      trace: args.trace,
    },
    created_at: nowIso(),
  });
  const allCandidates = [...output.candidateFacts, ...output.candidateUpdates, ...output.candidateDeletions];
  const candidateRows = allCandidates.map((candidate) => {
    const id = `story_candidate_${crypto.randomUUID()}`;
    const status = candidate.candidateTrust === "local-rule" || !candidate.sourceValid || candidate.conflictRisk === "needs-review"
      ? "needs-review"
      : "pending";
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
      status,
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
    excerpt: ref.excerpt || input.chapterText.slice(ref.textStart || 0, Math.min(input.chapterText.length, ref.textEnd || (ref.textStart || 0) + 500)).slice(0, 500),
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
