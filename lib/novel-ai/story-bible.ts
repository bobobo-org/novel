import crypto from "crypto";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { getStorageAdapterForProject } from "./storage/registry";
import {
  isSupabaseConfigured as isConfigured,
  queryValue,
  supabaseDeleteWhereProject as deleteWhereProject,
  supabaseInsertRows as insertRows,
  supabaseRest as rest,
  supabaseUpsert as upsert,
} from "./storage/supabase/supabase-rest-client";

export const STORY_BIBLE_SCHEMA_VERSION = "story-bible-v1";
export const STORY_BIBLE_MIGRATION_VERSION = "p0c_story_bible_003";
export const STORY_BIBLE_C2A_MIGRATION_VERSION = "p0c2a_conflict_engine_004";
export const STORY_BIBLE_C2B1_MIGRATION_VERSION = "p0c2b1_mutation_foundation_005";
export const STORY_BIBLE_C2B2_MIGRATION_VERSION = "p0c2b2_canonical_transaction_006";
export const STORY_BIBLE_C2C1_MIGRATION_VERSION = "p0c2c1_version_history_007";
export const STORY_BIBLE_C2C2A_MIGRATION_VERSION = "p0c2c2a_version_diff_008";
export const STORY_BIBLE_C2C2B_MIGRATION_VERSION = "p0c2c2b_integrity_chain_009";
export const STORY_BIBLE_C2C2C_MIGRATION_VERSION = "p0c2c2c_history_export_010";
export const STORY_BIBLE_C2C3_MIGRATION_VERSION = "p0c2c3_safe_revert_011";
export const STORY_BIBLE_L0A2D_MIGRATION_VERSION = "p0_l0a2d_atomic_extraction_rpc_012";
export const STORY_BIBLE_L0A2E_MIGRATION_VERSION = "p0_l0a2e_extraction_idempotency_dedup_013";
export const STORY_BIBLE_L0A2E2_MIGRATION_VERSION = "p0_l0a2e2_rollback_fixture_contract_014";
export const STORY_BIBLE_L0A2E2_SOURCE_NATURAL_KEY_MIGRATION_VERSION = "p0_l0a2e2_project_source_natural_key_015";
export const STORY_BIBLE_SOURCE_NATURAL_KEY_VERSION = "source-natural-key-v1";
export const STORY_BIBLE_EXTRACT_PROMPT_VERSION = "story-bible-extractor-v1.1";
export const STORY_BIBLE_CONFLICT_PROMPT_VERSION = "story-bible-conflict-review-v1";
export const STORY_BIBLE_SUMMARY_PROMPT_VERSION = "story-bible-summary-v1";

type JsonRecord = Record<string, unknown>;
type CandidateTrust = "cloud-validated" | "cloud-repaired" | "cloud-reduced" | "local-rule" | "invalid";
type CandidateReviewStatus = "pending" | "needs_review" | "approved" | "rejected" | "stale" | "superseded" | "failed";

export class StoryBibleMutationError extends Error {
  constructor(
    public errorCode: string,
    message: string,
    public status = 400,
    public details: JsonRecord = {},
  ) {
    super(message);
    this.name = "StoryBibleMutationError";
  }
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
      "sourceRef must contain only paragraphIndex and evidenceType. The server derives the exact excerpt.",
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
    outputContract: {
      candidates: [{
        entityType: "character | event | item | world_rule | foreshadowing | open_thread",
        temporaryEntityId: "lowercase_id",
        operation: "create | update | append | no-change",
        fieldPath: "one fieldPathExample",
        proposedValue: "scalar or short string array",
        confidence: "number 0..1",
        evidenceType: "direct_statement | dialogue | action | narration | object_transfer | world_rule | foreshadowing | promise | ambiguous",
        sourceRef: { paragraphIndex: "integer", evidenceType: "same allowed evidenceType" },
        reason: "short explanation",
      }],
      chapterSummaryCandidate: {
        summary: "required summary",
        endingState: "short ending state",
        newThreads: ["short thread"],
        newFacts: ["short fact"],
      },
      warnings: ["short warning"],
      confidence: "number 0..1",
    },
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

function sourceRefForExcerpt(
  input: StoryBibleExtractionInput,
  extractionRunId: string,
  ref: z.infer<typeof ModelSourceRefSchema> & { excerpt?: string },
) {
  const paragraphs = paragraphList(input.chapterText);
  const paragraph = paragraphs[ref.paragraphIndex] || "";
  const requestedExcerpt = clampText(ref.excerpt, 500);
  const excerpt = paragraph || requestedExcerpt || input.chapterText.slice(0, 300);
  let idx = excerpt ? input.chapterText.indexOf(excerpt) : -1;
  const sourceValid = Boolean(excerpt) && idx >= 0;
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
          sourceRef: { paragraphIndex: sourceRef.paragraphIndex || 0, evidenceType: "direct_statement" },
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
  const { text, usage } = await generateText({
    model: google(cfg.modelId),
    system: "You extract pending Story Bible candidates. Return only structured JSON matching the schema. No markdown. Do not invent facts.",
    prompt,
    temperature: 0.05,
    maxOutputTokens: 1600,
  });
  trace.providerElapsedMs = Date.now() - started;
  trace.outputChars = text.length;
  trace.rawOutputReceived = Boolean(text);
  trace.estimatedInputTokens = trace.estimatedInputTokens || Number(usage?.inputTokens || 0);
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizeJsonText(text));
  } catch {
    trace.jsonParseResult = "invalid";
    throw new Error(text.slice(0, 5000));
  }
  const strict = SimpleExtractionSchema.safeParse(parsed);
  if (strict.success) {
    trace.jsonParseResult = "valid";
    trace.finalSchemaValid = true;
    trace.fallbackUsed = "cloud-validated";
    trace.repairMethod = "none";
    return strict.data;
  }
  trace.jsonParseResult = "valid";
  trace.schemaValidationErrors = strict.error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
  throw new Error(text.slice(0, 5000));
}

async function repairWithModelJson(input: StoryBibleExtractionInput, trace: StoryBibleExtractionTrace, failureReason: string) {
  const cfg = modelConfig();
  if (!cfg.googleKey) return undefined;
  const prompt = [
    "Return compact JSON only. No markdown. No code fence.",
    "Root keys: candidates, chapterSummaryCandidate, warnings, confidence.",
    "Candidate keys: entityType, temporaryEntityId, operation, fieldPath, proposedValue, confidence, evidenceType, sourceRef, reason.",
    "Allowed entityType: character, event, item, world_rule, foreshadowing, open_thread.",
    "proposedValue must be string, number, boolean, or short string array. Never an object.",
    "sourceRef only: paragraphIndex, evidenceType. Do not return excerpt.",
    "If there is no new fact, return candidates: [].",
    `Previous schema failure: ${clampText(failureReason, 300)}`,
    buildModelPrompt(input),
  ].join("\n");
  const started = Date.now();
  const { text, usage } = await generateText({
    model: google(cfg.modelId),
    system: "You repair structured Story Bible extraction into strict JSON. Output JSON only.",
    prompt,
    temperature: 0.02,
    maxOutputTokens: 1400,
  });
  const repairStats = repairSimpleExtraction(text);
  trace.repairAttempted = true;
  trace.repairElapsedMs = Date.now() - started;
  trace.repairMethod = repairStats.value ? "model-json-repair-and-local-validate" : "model-json-repair-failed";
  trace.fieldsRemoved = repairStats.stats.fieldsRemoved;
  trace.fieldsCoerced = repairStats.stats.fieldsCoerced;
  trace.modelRepairUsed = true;
  trace.rawOutputReceived = Boolean(text);
  trace.outputChars = text.length;
  trace.providerElapsedMs += Date.now() - started;
  trace.estimatedInputTokens = trace.estimatedInputTokens || Number(usage?.inputTokens || 0);
  if (repairStats.value) {
    trace.finalSchemaValid = true;
    trace.jsonParseResult = "valid";
  }
  return repairStats.value;
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
    if (trace.schemaValidationErrors.length === 0) {
      trace.schemaValidationErrors = error instanceof z.ZodError
        ? error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message }))
        : [{ path: "model", code: "MODEL_OR_SCHEMA_ERROR", message: clampText(issueText, 500) }];
    }
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
      const modelRepaired = await repairWithModelJson(input, trace, issueText).catch((repairError) => {
        trace.schemaValidationErrors.push({
          path: "modelRepair",
          code: "MODEL_REPAIR_ERROR",
          message: clampText(repairError instanceof Error ? repairError.message : String(repairError), 500),
        });
        return undefined;
      });
      if (modelRepaired) {
        trust = "cloud-repaired";
        trace.fallbackUsed = trust;
        output = convertSimpleOutput(input, extractionRunId, modelRepaired, trust);
      } else {
        trust = "local-rule";
        trace.fallbackUsed = trust;
        output = localExtraction(input, extractionRunId, issueText);
        trace.finalSchemaValid = true;
      }
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

function candidateInitialStatus(candidate: z.infer<typeof StoryBibleCandidateSchema>): CandidateReviewStatus {
  if (candidate.candidateTrust === "invalid") return "failed";
  if (candidate.candidateTrust !== "cloud-validated") return "needs_review";
  if (!candidate.sourceValid || candidate.conflictRisk === "needs-review") return "needs_review";
  return "pending";
}

function canonicalTableFor(entityType: string) {
  switch (entityType) {
    case "character":
      return { table: "story_characters", idColumn: "character_id", jsonColumn: "character_json", titleColumn: "canonical_name" };
    case "event":
      return { table: "story_events", idColumn: "event_id", jsonColumn: "event_json", titleColumn: "title" };
    case "item":
      return { table: "story_items", idColumn: "item_id", jsonColumn: "item_json", titleColumn: "name" };
    case "world_rule":
      return { table: "story_world_rules", idColumn: "rule_id", jsonColumn: "rule_json", titleColumn: "title" };
    case "foreshadowing":
      return { table: "story_foreshadowing", idColumn: "foreshadow_id", jsonColumn: "foreshadow_json", titleColumn: "title" };
    case "open_thread":
      return { table: "story_open_threads", idColumn: "thread_id", jsonColumn: "thread_json", titleColumn: "title" };
    default:
      return undefined;
  }
}

function parseEntityType(value: unknown): z.infer<typeof SimpleEntityTypeSchema> | undefined {
  const parsed = SimpleEntityTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function fieldLeaf(fieldPath: string) {
  return fieldPath.split(".").pop() || "";
}

function canonicalValueFromRow(row: JsonRecord | undefined, entityType: string, fieldPath: string) {
  if (!row) return undefined;
  const adapter = canonicalTableFor(entityType);
  const leaf = fieldLeaf(fieldPath);
  const jsonValue = adapter ? row[adapter.jsonColumn] : undefined;
  if (jsonValue && typeof jsonValue === "object" && leaf in (jsonValue as JsonRecord)) return (jsonValue as JsonRecord)[leaf];
  if (adapter?.titleColumn && (leaf === "title" || leaf === "name" || leaf === "canonicalName")) return row[adapter.titleColumn];
  return undefined;
}

function arrayFromSnapshot(snapshot: unknown, keys: string[]) {
  if (!snapshot || typeof snapshot !== "object") return [];
  const source = snapshot as JsonRecord;
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value.filter((item): item is JsonRecord => Boolean(item && typeof item === "object")) as JsonRecord[];
  }
  return [];
}

function snapshotCanonicalForCandidate(input: StoryBibleExtractionInput, candidate: z.infer<typeof StoryBibleCandidateSchema>) {
  const text = `${candidate.evidence} ${candidate.reason} ${JSON.stringify(candidate.proposedValue)}`;
  const findBy = (rows: JsonRecord[], idKeys: string[], nameKeys: string[]) => {
    if (candidate.entityId) {
      const byId = rows.find((row) => idKeys.some((key) => row[key] === candidate.entityId));
      if (byId) return byId;
    }
    const matched = rows.find((row) => nameKeys.some((key) => row[key] && text.includes(String(row[key]))));
    if (matched) return matched;
    return rows.length === 1 ? rows[0] : undefined;
  };
  const snapshot = input.currentCanonicalSnapshot;
  switch (candidate.entityType) {
    case "character":
      return findBy(arrayFromSnapshot(snapshot, ["characters", "storyCharacters"]), ["characterId", "character_id", "id"], ["canonicalName", "canonical_name", "name"]);
    case "item":
      return findBy(arrayFromSnapshot(snapshot, ["items", "storyItems"]), ["itemId", "item_id", "id"], ["name", "title"]);
    case "world_rule":
      return findBy(arrayFromSnapshot(snapshot, ["worldRules", "world_rules", "rules"]), ["ruleId", "rule_id", "id"], ["title", "description"]);
    case "foreshadowing":
      return findBy(arrayFromSnapshot(snapshot, ["foreshadowing", "foreshadows"]), ["foreshadowId", "foreshadow_id", "id"], ["title", "description"]);
    case "open_thread":
      return findBy(arrayFromSnapshot(snapshot, ["openThreads", "open_threads"]), ["threadId", "thread_id", "id"], ["title", "description"]);
    case "event":
      return findBy(arrayFromSnapshot(snapshot, ["events", "storyEvents"]), ["eventId", "event_id", "id"], ["title", "description"]);
    default:
      return undefined;
  }
}

function canonicalValueFromSnapshot(row: JsonRecord | undefined, fieldPath: string) {
  if (!row) return undefined;
  const leaf = fieldLeaf(fieldPath);
  if (leaf in row) return row[leaf];
  const aliases: Record<string, string[]> = {
    canonicalName: ["canonical_name", "name"],
    currentOwnerCharacterId: ["current_owner_character_id", "ownerId", "owner"],
    currentLocationId: ["current_location_id", "locationId", "location"],
    lifeStatus: ["life_status", "status"],
  };
  for (const key of aliases[leaf] || []) if (key in row) return row[key];
  const nested = row.json || row.character_json || row.item_json || row.rule_json || row.foreshadow_json || row.event_json || row.thread_json;
  if (nested && typeof nested === "object" && leaf in (nested as JsonRecord)) return (nested as JsonRecord)[leaf];
  return undefined;
}

async function loadCanonicalForCandidate(projectId: string, candidate: z.infer<typeof StoryBibleCandidateSchema>) {
  if (!candidate.entityId) return undefined;
  const adapter = canonicalTableFor(candidate.entityType);
  if (!adapter) return undefined;
  const rows = await rest<JsonRecord[]>(adapter.table, {
    query: `project_id=eq.${encodeURIComponent(projectId)}&${adapter.idColumn}=eq.${encodeURIComponent(candidate.entityId)}&select=*&limit=1`,
  });
  return rows[0];
}

async function buildConflictsForCandidate(args: {
  projectId: string;
  input: StoryBibleExtractionInput;
  extractionRunId: string;
  candidateId: string;
  candidate: z.infer<typeof StoryBibleCandidateSchema>;
}) {
  const { projectId, input, extractionRunId, candidateId, candidate } = args;
  const conflicts: JsonRecord[] = [];
  const now = nowIso();
  const push = (data: {
    severity: "info" | "warning" | "major" | "blocking";
    conflictType: string;
    explanation: string;
    suggestedResolution?: string;
    canonicalValue?: unknown;
    proposedValue?: unknown;
    autoResolvable?: boolean;
    confidence?: number;
  }) => {
    conflicts.push({
      id: `story_conflict_${crypto.randomUUID()}`,
      project_id: projectId,
      extraction_run_id: extractionRunId,
      candidate_id: candidateId,
      severity: data.severity,
      conflict_type: data.conflictType,
      canonical_entity_type: candidate.entityType,
      canonical_entity_id: candidate.entityId || candidate.temporaryEntityId || null,
      field_path: candidate.fieldPath,
      canonical_fact: data.canonicalValue == null ? null : { value: data.canonicalValue },
      candidate_fact: {
        entityType: candidate.entityType,
        fieldPath: candidate.fieldPath,
        proposedValue: data.proposedValue ?? candidate.proposedValue,
        trust: candidate.candidateTrust,
      },
      canonical_value: data.canonicalValue ?? null,
      proposed_value: data.proposedValue ?? candidate.proposedValue,
      source_refs: candidate.sourceRefs,
      explanation: data.explanation,
      suggested_resolution: data.suggestedResolution || null,
      auto_resolvable: Boolean(data.autoResolvable),
      confidence: data.confidence ?? candidate.confidence,
      status: "open",
      created_at: now,
    });
  };

  if (candidate.candidateTrust === "local-rule") {
    push({
      severity: "warning",
      conflictType: "low_trust_local_rule",
      explanation: "此候選由本地規則降級產生，只能作為低信心待審資料，不可自動核准。",
      suggestedResolution: "人工檢查原文與來源後，必要時建立新的高信心候選。",
      autoResolvable: false,
      confidence: 0.35,
    });
  } else if (candidate.candidateTrust === "cloud-repaired" || candidate.candidateTrust === "cloud-reduced") {
    push({
      severity: "info",
      conflictType: "cloud_output_repaired",
      explanation: "此候選經過結構化修復或縮減流程，需顯示修復痕跡並由作者確認。",
      suggestedResolution: "核對 source excerpt 與 proposed value 是否一致。",
      autoResolvable: false,
      confidence: Math.min(candidate.confidence, 0.8),
    });
  }

  if (!candidate.sourceValid || candidate.sourceRefs.some((ref) => ref.sourceValid === false)) {
    push({
      severity: "major",
      conflictType: "source_reference_invalid",
      explanation: "候選的 source excerpt 無法在章節正文中定位，不能作為高信心事實。",
      suggestedResolution: "重新抽取來源，或人工修正 excerpt 後再審核。",
      autoResolvable: false,
      confidence: Math.min(candidate.confidence, 0.45),
    });
  }

  const canonical = snapshotCanonicalForCandidate(input, candidate) || await loadCanonicalForCandidate(projectId, candidate);
  if (canonical) {
    const currentValue = canonicalValueFromSnapshot(canonical, candidate.fieldPath) ?? canonicalValueFromRow(canonical, candidate.entityType, candidate.fieldPath);
    const immutable = canonical.immutable === true || canonical.immutable === "true";
    if (candidate.entityType === "world_rule" && immutable && JSON.stringify(currentValue) !== JSON.stringify(candidate.proposedValue) && candidate.operation !== "no-change") {
      push({
        severity: "blocking",
        conflictType: "immutable_world_rule_change",
        canonicalValue: currentValue,
        proposedValue: candidate.proposedValue,
        explanation: "候選嘗試修改 immutable world rule。P0-C2A 僅能標記衝突，不能寫入 canonical。",
        suggestedResolution: "若確為例外，請在後續 conflict resolution 階段建立 exception，而非直接覆蓋規則。",
        autoResolvable: false,
        confidence: candidate.confidence,
      });
    }
    if (candidate.entityType === "item" && fieldLeaf(candidate.fieldPath) === "currentOwnerCharacterId" && currentValue !== undefined && JSON.stringify(currentValue) !== JSON.stringify(candidate.proposedValue)) {
      push({
        severity: "major",
        conflictType: "item_double_owner",
        canonicalValue: currentValue,
        proposedValue: candidate.proposedValue,
        explanation: "同一重要道具已有 canonical 持有人，候選提出另一位持有人，需確認是否為轉移事件或雙重持有錯誤。",
        suggestedResolution: "若為轉移，需補來源事件；否則保留 canonical 持有人。",
        autoResolvable: false,
        confidence: candidate.confidence,
      });
    }
    if (candidate.entityType === "character" && fieldLeaf(candidate.fieldPath) === "currentLocationId" && currentValue !== undefined && JSON.stringify(currentValue) !== JSON.stringify(candidate.proposedValue)) {
      push({
        severity: "major",
        conflictType: "timeline_location_conflict",
        canonicalValue: currentValue,
        proposedValue: candidate.proposedValue,
        explanation: "同一角色目前所在地與候選所在地不同，需確認是否有移動事件或時間差。",
        suggestedResolution: "補移動事件、調整時間點，或維持原所在地。",
        autoResolvable: false,
        confidence: candidate.confidence,
      });
    }
    if (candidate.entityType === "foreshadowing" && fieldLeaf(candidate.fieldPath) === "status" && currentValue === "paid" && candidate.proposedValue !== "paid") {
      push({
        severity: "major",
        conflictType: "paid_foreshadowing_reopened",
        canonicalValue: currentValue,
        proposedValue: candidate.proposedValue,
        explanation: "已回收伏筆被候選改回未回收狀態，可能造成長篇記憶倒退。",
        suggestedResolution: "除非作者明確重開伏筆，否則保留 paid 狀態。",
        autoResolvable: false,
        confidence: candidate.confidence,
      });
    }
    if (currentValue !== undefined && JSON.stringify(currentValue) !== JSON.stringify(candidate.proposedValue)) {
      push({
        severity: "major",
        conflictType: "canonical_value_mismatch",
        canonicalValue: currentValue,
        proposedValue: candidate.proposedValue,
        explanation: "候選值與目前 canonical 值不同，需人工判斷是更新、例外、誤抽取或舊資料過時。",
        suggestedResolution: "保留 canonical、接受候選、編輯候選或延後處理。",
        autoResolvable: false,
        confidence: candidate.confidence,
      });
    }
  }

  return conflicts;
}

function buildStoryBibleRootRow(projectId: string, input: StoryBibleExtractionInput) {
  const now = nowIso();
  return {
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
  };
}

export function conflictFixtureSnapshot() {
  return {
    characters: [{
      characterId: "char_test_001",
      canonicalName: "林昭",
      age: 28,
      lifeStatus: "alive",
      currentLocationId: "loc_capital",
    }],
    worldRules: [{
      ruleId: "rule_test_001",
      title: "死者不可復生",
      description: "死者不可復生",
      immutable: true,
    }],
    items: [{
      itemId: "item_test_001",
      name: "赤霄劍",
      currentOwnerCharacterId: "char_test_001",
    }],
    foreshadowing: [{
      foreshadowId: "fs_test_001",
      title: "赤霄劍真主伏筆",
      status: "paid",
    }],
  };
}

export async function seedStoryBibleConflictFixtures(projectId: string) {
  const now = nowIso();
  await upsert("story_bibles", {
    project_id: projectId,
    schema_version: STORY_BIBLE_SCHEMA_VERSION,
    status: "active",
    core_json: { projectId, purpose: "p0c2a-conflict-fixture" },
    created_at: now,
    updated_at: now,
  }, "project_id");
  await upsert("story_characters", {
    id: `${projectId}_char_test_001`,
    project_id: projectId,
    character_id: "char_test_001",
    canonical_name: "林昭",
    character_json: { age: 28, lifeStatus: "alive", currentLocationId: "loc_capital" },
    confidence: 1,
    updated_at: now,
  });
  await upsert("story_world_rules", {
    id: `${projectId}_rule_test_001`,
    project_id: projectId,
    rule_id: "rule_test_001",
    title: "死者不可復生",
    rule_json: { description: "死者不可復生" },
    immutable: true,
    confidence: 1,
    updated_at: now,
  });
  await upsert("story_items", {
    id: `${projectId}_item_test_001`,
    project_id: projectId,
    item_id: "item_test_001",
    name: "赤霄劍",
    item_json: { currentOwnerCharacterId: "char_test_001" },
    updated_at: now,
  });
  await upsert("story_foreshadowing", {
    id: `${projectId}_fs_test_001`,
    project_id: projectId,
    foreshadow_id: "fs_test_001",
    title: "赤霄劍真主伏筆",
    status: "paid",
    foreshadow_json: { description: "赤霄劍真主伏筆" },
    updated_at: now,
  });
  return conflictFixtureSnapshot();
}

export async function cleanupStoryBibleProject(projectId: string) {
  for (const table of [
    "story_bible_mutation_requests",
    "story_canonical_sources",
    "story_fact_sources",
    "story_fact_conflicts",
    "story_fact_candidates",
    "story_chapter_summaries",
    "story_bible_extraction_runs",
    "story_characters",
    "story_relationships",
    "story_world_rules",
    "story_locations",
    "story_factions",
    "story_items",
    "story_events",
    "story_timeline",
    "story_foreshadowing",
    "story_open_threads",
    "story_bible_versions",
    "story_bibles",
  ]) {
    await deleteWhereProject(table, projectId).catch(() => undefined);
  }
  return { projectId, cleaned: true };
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
  const inputHash = hashText(JSON.stringify({
    projectId: input.projectId,
    chapterId: input.chapterId,
    chapterNumber: input.chapterNumber,
    chapterTitle: input.chapterTitle,
    chapterTextHash: hashText(input.chapterText),
    currentCanonicalSnapshotHash: hashText(JSON.stringify(input.currentCanonicalSnapshot || {})),
  }));
  const extractionRunRow = {
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
    };
  const allCandidates = [...output.candidateFacts, ...output.candidateUpdates, ...output.candidateDeletions];
  const candidatePairs = allCandidates.map((candidate) => {
    const id = `story_candidate_${crypto.randomUUID()}`;
    const status = candidateInitialStatus(candidate);
    return {
      candidate,
      row: {
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
        previous_status: null,
        candidate_trust: candidate.candidateTrust,
        source_valid: candidate.sourceValid,
        status_updated_at: nowIso(),
        created_at: nowIso(),
      },
    };
  });
  const generatedConflicts = (await Promise.all(candidatePairs.map((pair) =>
    buildConflictsForCandidate({
      projectId: input.projectId,
      input,
      extractionRunId,
      candidateId: pair.row.id,
      candidate: pair.candidate,
    })
  ))).flat();
  const conflictCandidateIds = new Set(generatedConflicts
    .filter((conflict) => ["warning", "major", "blocking"].includes(String(conflict.severity)))
    .map((conflict) => String(conflict.candidate_id)));
  for (const pair of candidatePairs) {
    if (conflictCandidateIds.has(String(pair.row.id))) pair.row.status = "needs_review";
  }
  const candidateRows = candidatePairs.map((pair) => pair.row);
  const modelConflicts = output.candidateConflicts.map((conflict, index) => ({
    id: conflict.conflictId || `story_conflict_${crypto.randomUUID()}`,
    project_id: input.projectId,
    extraction_run_id: extractionRunId,
    candidate_id: candidateRows[index]?.id || null,
    severity: conflict.severity,
    conflict_type: conflict.conflictType,
    canonical_entity_type: candidateRows[index]?.entity_type || null,
    canonical_entity_id: candidateRows[index]?.entity_id || candidateRows[index]?.temporary_entity_id || null,
    field_path: candidateRows[index]?.field_path || null,
    canonical_fact: conflict.canonicalFact ?? null,
    candidate_fact: conflict.candidateFact,
    canonical_value: conflict.canonicalFact ?? null,
    proposed_value: conflict.candidateFact,
    source_refs: conflict.sourceRefs,
    explanation: conflict.explanation,
    suggested_resolution: conflict.suggestedResolution || null,
    auto_resolvable: conflict.autoResolvable,
    confidence: conflict.confidence,
    status: "open",
    created_at: nowIso(),
  }));
  const conflicts = [...modelConflicts, ...generatedConflicts];
  const sourceRows = candidatePairs.flatMap((pair) => pair.candidate.sourceRefs.map((ref) => ({
    id: `story_source_${crypto.randomUUID()}`,
    project_id: input.projectId,
    extraction_run_id: extractionRunId,
    candidate_id: pair.row.id,
    chapter_id: ref.chapterId || input.chapterId,
    scene_id: ref.sceneId || null,
    paragraph_index: ref.paragraphIndex ?? null,
    text_start: ref.textStart ?? null,
    text_end: ref.textEnd ?? null,
    excerpt_hash: ref.excerptHash,
    excerpt: ref.excerpt || input.chapterText.slice(ref.textStart || 0, Math.min(input.chapterText.length, ref.textEnd || (ref.textStart || 0) + 500)).slice(0, 500),
    created_at: nowIso(),
  })));
  const chapterSummaryRow = {
    id: `story_chapter_summary_${input.projectId}_${input.chapterId}`,
    project_id: input.projectId,
    chapter_id: input.chapterId,
    chapter_number: input.chapterNumber ?? null,
    title: output.chapterSummaryCandidate.title || input.chapterTitle,
    summary: output.chapterSummaryCandidate.summary,
    summary_json: output.chapterSummaryCandidate,
    source_hash: output.chapterSummaryCandidate.sourceHash,
    updated_at: nowIso(),
  };
  const adapter = getStorageAdapterForProject(input.projectId);
  await adapter.transaction((tx) => tx.extractionPersistence.persistRows({
    projectId: input.projectId,
    storyBibleRow: buildStoryBibleRootRow(input.projectId, input),
    extractionRunRow,
    candidateRows,
    conflictRows: conflicts,
    sourceRows,
    chapterSummaryRow,
  }));
  return { extractionRunId, candidateCount: candidateRows.length, conflictCount: conflicts.length, sourceRefCount: sourceRows.length };
}

export async function storyBibleHealth() {
  if (!isConfigured()) {
    return {
      storyBibleStatus: "not_configured",
      storyBibleSchemaVersion: STORY_BIBLE_SCHEMA_VERSION,
      storyBibleExtractionStatus: "not_configured",
      storyBibleMigrationVersion: "",
      extractionAtomicTransactionStatus: "not_configured",
      extractionAtomicRpcVersion: "",
      extractionIdempotencyStatus: "not_configured",
      extractionSourceDedupStatus: "not_configured",
      extractionRollbackMatrixStatus: "not_configured",
      extractionFaultInjectionStatus: "not_configured",
      extractionConcurrencyStatus: "not_configured",
    };
  }
  try {
    const migrationRows = await rest<Array<{ version: string }>>("schema_migrations", {
      query: `select=version&version=in.(${STORY_BIBLE_MIGRATION_VERSION},${STORY_BIBLE_C2A_MIGRATION_VERSION},${STORY_BIBLE_C2B1_MIGRATION_VERSION},${STORY_BIBLE_C2B2_MIGRATION_VERSION},${STORY_BIBLE_C2C1_MIGRATION_VERSION},${STORY_BIBLE_C2C2A_MIGRATION_VERSION},${STORY_BIBLE_C2C2B_MIGRATION_VERSION},${STORY_BIBLE_C2C2C_MIGRATION_VERSION},${STORY_BIBLE_C2C3_MIGRATION_VERSION},${STORY_BIBLE_L0A2D_MIGRATION_VERSION},${STORY_BIBLE_L0A2E_MIGRATION_VERSION},${STORY_BIBLE_L0A2E2_MIGRATION_VERSION},${STORY_BIBLE_L0A2E2_SOURCE_NATURAL_KEY_MIGRATION_VERSION})`,
    });
    const migrationOk = migrationRows.some((row) => row.version === STORY_BIBLE_MIGRATION_VERSION);
    const c2aOk = migrationRows.some((row) => row.version === STORY_BIBLE_C2A_MIGRATION_VERSION);
    const c2b1Ok = migrationRows.some((row) => row.version === STORY_BIBLE_C2B1_MIGRATION_VERSION);
    const c2b2Ok = migrationRows.some((row) => row.version === STORY_BIBLE_C2B2_MIGRATION_VERSION);
    const c2c1Ok = migrationRows.some((row) => row.version === STORY_BIBLE_C2C1_MIGRATION_VERSION);
    const c2c2aOk = migrationRows.some((row) => row.version === STORY_BIBLE_C2C2A_MIGRATION_VERSION);
    const c2c2bOk = migrationRows.some((row) => row.version === STORY_BIBLE_C2C2B_MIGRATION_VERSION);
    const c2c2cOk = migrationRows.some((row) => row.version === STORY_BIBLE_C2C2C_MIGRATION_VERSION);
    const c2c3Ok = migrationRows.some((row) => row.version === STORY_BIBLE_C2C3_MIGRATION_VERSION);
    const l0a2dOk = migrationRows.some((row) => row.version === STORY_BIBLE_L0A2D_MIGRATION_VERSION);
    const l0a2eOk = migrationRows.some((row) => row.version === STORY_BIBLE_L0A2E_MIGRATION_VERSION);
    const l0a2e2Ok = migrationRows.some((row) => row.version === STORY_BIBLE_L0A2E2_MIGRATION_VERSION);
    const l0a2e2SourceOk = migrationRows.some((row) => row.version === STORY_BIBLE_L0A2E2_SOURCE_NATURAL_KEY_MIGRATION_VERSION);
    const runs = migrationOk
      ? await rest<Array<JsonRecord>>("story_bible_extraction_runs", { query: "select=id,status,created_at&order=created_at.desc&limit=10" })
      : [];
    return {
      storyBibleStatus: migrationOk ? "ready" : "migration_required",
      storyBibleSchemaVersion: STORY_BIBLE_SCHEMA_VERSION,
      storyBibleExtractionStatus: runs[0]?.status || "not_run",
      storyBibleMigrationVersion: [
        migrationOk ? STORY_BIBLE_MIGRATION_VERSION : "",
        c2aOk ? STORY_BIBLE_C2A_MIGRATION_VERSION : "",
        c2b1Ok ? STORY_BIBLE_C2B1_MIGRATION_VERSION : "",
        c2b2Ok ? STORY_BIBLE_C2B2_MIGRATION_VERSION : "",
        c2c1Ok ? STORY_BIBLE_C2C1_MIGRATION_VERSION : "",
        c2c2aOk ? STORY_BIBLE_C2C2A_MIGRATION_VERSION : "",
        c2c2bOk ? STORY_BIBLE_C2C2B_MIGRATION_VERSION : "",
        c2c2cOk ? STORY_BIBLE_C2C2C_MIGRATION_VERSION : "",
        c2c3Ok ? STORY_BIBLE_C2C3_MIGRATION_VERSION : "",
        l0a2dOk ? STORY_BIBLE_L0A2D_MIGRATION_VERSION : "",
        l0a2eOk ? STORY_BIBLE_L0A2E_MIGRATION_VERSION : "",
        l0a2e2Ok ? STORY_BIBLE_L0A2E2_MIGRATION_VERSION : "",
        l0a2e2SourceOk ? STORY_BIBLE_L0A2E2_SOURCE_NATURAL_KEY_MIGRATION_VERSION : "",
      ].filter(Boolean).join(","),
      storyBibleRecentExtractionAt: runs[0]?.created_at || null,
      storyBibleApprovalStatus: c2b2Ok ? "ready" : c2b1Ok ? "partial" : c2aOk ? "not_implemented" : "unavailable",
      storyBibleVersioningStatus: c2c3Ok ? "ready" : c2c1Ok ? "partial" : c2b2Ok ? "partial" : c2aOk ? "schema_ready" : "unavailable",
      storyBibleConflictEngineStatus: c2aOk ? "ready" : "unavailable",
      storyBibleProvenanceStatus: c2c3Ok ? "ready" : c2c1Ok ? "partial" : "unavailable",
      storyBibleDiffStatus: c2c2aOk ? "ready" : "unavailable",
      storyBibleIntegrityStatus: c2c2bOk ? "ready" : c2c2aOk ? "partial" : "unavailable",
      storyBibleExportStatus: c2c2cOk ? "ready" : c2c2bOk ? "partial" : "not_implemented",
      storyBibleRevertStatus: c2c3Ok ? "ready" : "not_implemented",
      extractionAtomicTransactionStatus: l0a2dOk ? "ready" : "not_implemented",
      extractionAtomicRpcVersion: l0a2e2SourceOk ? STORY_BIBLE_L0A2E2_SOURCE_NATURAL_KEY_MIGRATION_VERSION : l0a2e2Ok ? STORY_BIBLE_L0A2E2_MIGRATION_VERSION : l0a2eOk ? STORY_BIBLE_L0A2E_MIGRATION_VERSION : l0a2dOk ? STORY_BIBLE_L0A2D_MIGRATION_VERSION : "",
      extractionIdempotencyStatus: l0a2e2Ok ? "state_contract_ready" : l0a2eOk ? "ready" : "not_implemented",
      extractionSourceDedupStatus: l0a2e2SourceOk ? "ready" : l0a2eOk ? "retry_safe" : "not_implemented",
      sourceNaturalKeyVersion: l0a2e2SourceOk ? STORY_BIBLE_SOURCE_NATURAL_KEY_VERSION : "",
      sourceDedupScope: l0a2e2SourceOk ? "project" : l0a2eOk ? "request" : "none",
      sourceDedupConcurrencyStatus: l0a2e2SourceOk ? "ready" : l0a2e2Ok ? "partial" : "not_implemented",
      supabaseExtractionRuntimeContractStatus: l0a2e2SourceOk ? "ready" : "partial",
      memoryExtractionRuntimeContractStatus: l0a2e2SourceOk ? "ready" : "partial",
      extractionContractParityStatus: l0a2e2SourceOk ? "ready" : "partial",
      extractionRollbackMatrixStatus: l0a2e2Ok ? "fault_fixture_ready" : "not_implemented",
      extractionFaultInjectionStatus: l0a2e2Ok ? "service_role_fixture_only" : "not_implemented",
      extractionConcurrencyStatus: l0a2e2Ok ? "partial" : "not_implemented",
    };
  } catch (error) {
    return {
      storyBibleStatus: "error",
      storyBibleSchemaVersion: STORY_BIBLE_SCHEMA_VERSION,
      storyBibleExtractionStatus: "error",
      storyBibleMigrationVersion: "",
      storyBibleApprovalStatus: "unavailable",
      storyBibleVersioningStatus: "unavailable",
      storyBibleConflictEngineStatus: "unavailable",
      storyBibleProvenanceStatus: "unavailable",
      storyBibleDiffStatus: "unavailable",
      storyBibleIntegrityStatus: "unavailable",
      storyBibleExportStatus: "unavailable",
      storyBibleRevertStatus: "not_implemented",
      extractionAtomicTransactionStatus: "unavailable",
      extractionAtomicRpcVersion: "",
      extractionIdempotencyStatus: "unavailable",
      extractionSourceDedupStatus: "unavailable",
      sourceNaturalKeyVersion: "",
      sourceDedupScope: "unavailable",
      sourceDedupConcurrencyStatus: "unavailable",
      supabaseExtractionRuntimeContractStatus: "unavailable",
      memoryExtractionRuntimeContractStatus: "unavailable",
      extractionContractParityStatus: "unavailable",
      extractionRollbackMatrixStatus: "unavailable",
      extractionFaultInjectionStatus: "unavailable",
      extractionConcurrencyStatus: "unavailable",
      storyBibleError: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
    };
  }
}

export async function listStoryBibleCandidates(projectId: string, limit = 20) {
  return rest<Array<JsonRecord>>("story_fact_candidates", {
    query: `project_id=eq.${encodeURIComponent(projectId)}&select=*&order=created_at.desc&limit=${Math.max(1, Math.min(100, limit))}`,
  });
}

export const StoryBibleListQuerySchema = z.object({
  projectId: z.string().min(1).max(120),
  status: z.string().max(40).optional(),
  entityType: z.string().max(60).optional(),
  candidateId: z.string().max(160).optional(),
  chapterId: z.string().max(120).optional(),
  extractionRunId: z.string().max(160).optional(),
  conflictSeverity: z.string().max(40).optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listStoryBibleCandidateRows(query: z.infer<typeof StoryBibleListQuerySchema>) {
  const adapter = getStorageAdapterForProject(query.projectId);
  let candidates = await adapter.listCandidates(query.projectId, query.limit);
  if (query.status) candidates = candidates.filter((candidate) => String(candidate.status || "") === query.status);
  if (query.candidateId) candidates = candidates.filter((candidate) => String(candidate.id || "") === query.candidateId);
  if (query.entityType) candidates = candidates.filter((candidate) => String(candidate.entity_type || candidate.entityType || "") === query.entityType);
  if (query.extractionRunId) candidates = candidates.filter((candidate) => String(candidate.extraction_run_id || candidate.extractionRunId || "") === query.extractionRunId);
  if (query.minConfidence != null) candidates = candidates.filter((candidate) => Number(candidate.confidence || 0) >= Number(query.minConfidence));
  if (!query.chapterId) return candidates;
  const sources = await adapter.listSources(query.projectId, 1000);
  const ids = new Set(sources
    .filter((row) => String(row.chapter_id || row.chapterId || "") === query.chapterId)
    .map((row) => row.candidate_id || row.candidateId)
    .filter(Boolean));
  return candidates.filter((candidate) => ids.has(candidate.id));
}

export async function getStoryBibleCandidate(projectId: string, candidateId: string) {
  const adapter = getStorageAdapterForProject(projectId);
  const candidate = await adapter.getCandidate(projectId, candidateId);
  if (!candidate) return null;
  const [allSources, allConflicts] = await Promise.all([
    adapter.listSources(projectId, 1000),
    adapter.listConflicts(projectId, 1000),
  ]);
  const sourceRefs = allSources.filter((row) => String(row.candidate_id || row.candidateId || "") === candidateId);
  const conflicts = allConflicts.filter((row) => String(row.candidate_id || row.candidateId || "") === candidateId);
  const entityType = parseEntityType(candidate.entity_type);
  const candidateEntityId = candidate.entity_id ? String(candidate.entity_id) : "";
  const currentCanonicalValue = entityType && candidateEntityId ? await adapter.getCanonicalEntity(projectId, entityType, candidateEntityId) : undefined;
  return {
    candidate,
    sourceRefs,
    conflicts,
    extractionProvenance: null,
    currentCanonicalValue: currentCanonicalValue ? canonicalValueFromRow(currentCanonicalValue, String(candidate.entity_type), String(candidate.field_path)) : null,
    basedOnVersion: {
      versionId: candidate.based_on_version_id || null,
      versionNumber: candidate.based_on_version_number || null,
    },
    staleStatus: candidate.status === "stale" ? "stale" : "current",
  };
}

export async function listStoryBibleConflicts(query: z.infer<typeof StoryBibleListQuerySchema>) {
  const adapter = getStorageAdapterForProject(query.projectId);
  let conflicts = await adapter.listConflicts(query.projectId, query.limit);
  if (query.status) conflicts = conflicts.filter((conflict) => String(conflict.status || "") === query.status);
  if (query.candidateId) conflicts = conflicts.filter((conflict) => String(conflict.candidate_id || conflict.candidateId || "") === query.candidateId);
  if (query.conflictSeverity) conflicts = conflicts.filter((conflict) => String(conflict.severity || "") === query.conflictSeverity);
  if (query.extractionRunId) conflicts = conflicts.filter((conflict) => String(conflict.extraction_run_id || conflict.extractionRunId || "") === query.extractionRunId);
  if (query.entityType) conflicts = conflicts.filter((conflict) => String(conflict.canonical_entity_type || conflict.canonicalEntityType || "") === query.entityType);
  if (query.minConfidence != null) conflicts = conflicts.filter((conflict) => Number(conflict.confidence || 0) >= Number(query.minConfidence));
  return conflicts;
}

export async function getStoryBibleConflict(projectId: string, conflictId: string) {
  const adapter = getStorageAdapterForProject(projectId);
  const conflict = await adapter.getConflict(projectId, conflictId);
  if (!conflict) return null;
  const candidateId = conflict.candidate_id ? String(conflict.candidate_id) : "";
  const candidate = candidateId ? await getStoryBibleCandidate(projectId, candidateId) : null;
  return { conflict, candidate };
}

export const StoryBibleRejectRequestSchema = z.strictObject({
  projectId: z.string().min(1).max(120),
  reviewerId: z.string().min(1).max(120),
  requestId: z.string().min(8).max(160),
  expectedCandidateStatus: z.enum(["pending", "needs_review"]),
  expectedStoryBibleVersion: z.number().int().min(0),
  reviewReason: z.string().min(2).max(1000),
});

export const StoryBibleUnsupportedMutationRequestSchema = StoryBibleRejectRequestSchema.extend({
  editedValue: z.unknown().optional(),
  editReason: z.string().max(1000).optional(),
  sourceMode: z.enum(["ai-supported", "author-declared"]).optional(),
});

type RejectRequest = z.infer<typeof StoryBibleRejectRequestSchema>;

function mutationTraceId() {
  return `story_mutation_trace_${crypto.randomUUID()}`;
}

function mutationRequestHash(input: unknown) {
  return hashText(JSON.stringify(input || null));
}

async function getMutationRequest(requestId: string) {
  const rows = await rest<Array<JsonRecord>>("story_bible_mutation_requests", {
    query: `request_id=eq.${queryValue(requestId)}&select=*&limit=1`,
  });
  return rows[0] || null;
}

async function createMutationRequest(input: {
  requestId: string;
  projectId: string;
  operation: string;
  candidateId: string;
  requestHash: string;
  reviewerId: string;
  expectedCandidateStatus: string;
  expectedStoryBibleVersion: number;
}) {
  const now = nowIso();
  return insertRows("story_bible_mutation_requests", [{
    request_id: input.requestId,
    project_id: input.projectId,
    operation: input.operation,
    candidate_ids: [input.candidateId],
    status: "running",
    request_hash: input.requestHash,
    response_hash: input.requestHash,
    reviewer_id: input.reviewerId,
    expected_candidate_status: input.expectedCandidateStatus,
    expected_story_bible_version: input.expectedStoryBibleVersion,
    created_at: now,
  }]);
}

async function completeMutationRequest(requestId: string, response: JsonRecord, status = "completed", errorCode: string | null = null) {
  const now = nowIso();
  return rest("story_bible_mutation_requests", {
    method: "PATCH",
    query: `request_id=eq.${queryValue(requestId)}`,
    body: JSON.stringify({
      status,
      response_json: response,
      error_code: errorCode,
      result_version_id: response.versionId || null,
      completed_at: now,
    }),
  });
}

export async function currentStoryBibleVersion(projectId: string) {
  const rows = await rest<Array<JsonRecord>>("story_bible_versions", {
    query: `project_id=eq.${queryValue(projectId)}&select=id,version_number&order=version_number.desc&limit=1`,
  });
  const latest = rows[0];
  return {
    versionId: latest?.id ? String(latest.id) : null,
    versionNumber: latest?.version_number == null ? 0 : Number(latest.version_number),
  };
}

async function updateCandidateReviewStatus(input: {
  projectId: string;
  candidateId: string;
  status: CandidateReviewStatus;
  previousStatus: string;
  reviewerId: string;
  reviewReason: string;
  requestId: string;
}) {
  const rows = await rest<Array<JsonRecord>>("story_fact_candidates", {
    method: "PATCH",
    query: `project_id=eq.${queryValue(input.projectId)}&id=eq.${queryValue(input.candidateId)}&select=*`,
    body: JSON.stringify({
      status: input.status,
      previous_status: input.previousStatus,
      reviewer_id: input.reviewerId,
      review_reason: input.reviewReason,
      request_id: input.requestId,
      reviewed_at: nowIso(),
      status_updated_at: nowIso(),
    }),
  });
  return rows[0] || null;
}

export async function rejectStoryBibleCandidate(candidateId: string, body: unknown) {
  const traceId = mutationTraceId();
  const parsed = StoryBibleRejectRequestSchema.parse(body);
  const requestHash = mutationRequestHash({ operation: "reject", candidateId, ...parsed });
  const existingRequest = await getMutationRequest(parsed.requestId);
  if (existingRequest) {
    if (existingRequest.request_hash !== requestHash && existingRequest.response_hash !== requestHash) {
      throw new StoryBibleMutationError("IDEMPOTENCY_KEY_REUSED", "同一 requestId 不可搭配不同 payload 重複使用。", 409, {
        traceId,
        requestId: parsed.requestId,
        retryable: false,
      });
    }
    if (existingRequest.status === "completed" && existingRequest.response_json) {
      return { ...(existingRequest.response_json as JsonRecord), idempotentReplay: true, traceId };
    }
  } else {
    await createMutationRequest({
      requestId: parsed.requestId,
      projectId: parsed.projectId,
      operation: "reject",
      candidateId,
      requestHash,
      reviewerId: parsed.reviewerId,
      expectedCandidateStatus: parsed.expectedCandidateStatus,
      expectedStoryBibleVersion: parsed.expectedStoryBibleVersion,
    });
  }

  try {
    const candidateDetail = await getStoryBibleCandidate(parsed.projectId, candidateId);
    if (!candidateDetail) {
      throw new StoryBibleMutationError("CANDIDATE_NOT_FOUND", "找不到此 project 內的候選資料。", 404, {
        traceId,
        projectIdHash: hashText(parsed.projectId).slice(0, 12),
        candidateId,
        requestId: parsed.requestId,
        retryable: false,
      });
    }
    const candidate = candidateDetail.candidate as JsonRecord;
    const currentStatus = String(candidate.status || "");
    if (currentStatus !== parsed.expectedCandidateStatus) {
      throw new StoryBibleMutationError("CANDIDATE_STATUS_MISMATCH", "候選狀態已改變，請重新讀取後再審核。", 409, {
        traceId,
        candidateId,
        requestId: parsed.requestId,
        currentStatus,
        expectedStatus: parsed.expectedCandidateStatus,
        retryable: true,
      });
    }
    if (!["pending", "needs_review"].includes(currentStatus)) {
      throw new StoryBibleMutationError("CANDIDATE_NOT_REVIEWABLE", "此候選目前不可執行 Reject。", 409, {
        traceId,
        candidateId,
        requestId: parsed.requestId,
        currentStatus,
        retryable: false,
      });
    }
    const currentVersion = await currentStoryBibleVersion(parsed.projectId);
    if (currentVersion.versionNumber !== parsed.expectedStoryBibleVersion) {
      throw new StoryBibleMutationError("STORY_BIBLE_VERSION_MISMATCH", "Story Bible 版本已變更，請重新讀取候選資料。", 409, {
        traceId,
        candidateId,
        requestId: parsed.requestId,
        currentVersion: currentVersion.versionNumber,
        expectedVersion: parsed.expectedStoryBibleVersion,
        candidateBasedOnVersion: candidate.based_on_version_number ?? null,
        staleReason: "expectedStoryBibleVersion differs from currentStoryBibleVersion",
        retryable: true,
      });
    }
    const updated = await updateCandidateReviewStatus({
      projectId: parsed.projectId,
      candidateId,
      status: "rejected",
      previousStatus: currentStatus,
      reviewerId: parsed.reviewerId,
      reviewReason: parsed.reviewReason,
      requestId: parsed.requestId,
    });
    const response = {
      ok: true,
      operation: "reject",
      traceId,
      requestId: parsed.requestId,
      candidateId,
      projectId: parsed.projectId,
      previousStatus: currentStatus,
      status: updated?.status || "rejected",
      reviewerId: parsed.reviewerId,
      reviewReason: parsed.reviewReason,
      reviewedAt: updated?.reviewed_at || null,
      versionId: null,
      storyBibleVersion: currentVersion.versionNumber,
      canonicalChanged: false,
      sourceChanged: false,
      conflictChanged: false,
    };
    await completeMutationRequest(parsed.requestId, response);
    return response;
  } catch (error) {
    const err = error instanceof StoryBibleMutationError
      ? error
      : new StoryBibleMutationError("STORY_BIBLE_REJECT_FAILED", error instanceof Error ? error.message : "Reject failed.", 500, { traceId, retryable: true });
    await completeMutationRequest(parsed.requestId, {
      ok: false,
      operation: "reject",
      traceId,
      requestId: parsed.requestId,
      candidateId,
      errorCode: err.errorCode,
      userMessage: err.message,
      ...err.details,
    }, "failed", err.errorCode).catch(() => undefined);
    throw err;
  }
}

export function unsupportedStoryBibleMutation(operation: "approve" | "edit-and-approve", body: unknown) {
  const parsed = StoryBibleUnsupportedMutationRequestSchema.parse(body);
  throw new StoryBibleMutationError("MUTATION_NOT_IMPLEMENTED", `${operation} 尚未在 P0-C2B1 開放；本階段只支援 Reject。`, 501, {
    operation,
    projectIdHash: hashText(parsed.projectId).slice(0, 12),
    requestId: parsed.requestId,
    retryable: false,
  });
}
