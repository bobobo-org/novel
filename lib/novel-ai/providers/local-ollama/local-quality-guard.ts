import { z } from "zod";

export const LOCAL_QUALITY_SCHEMA_VERSION = "local-quality-guard-v1";
export const LOCAL_VALIDATION_VERSION = "local-validation-v1";
export const LOCAL_RULE_ENGINE_VERSION = "local-deterministic-rules-v1";
export const LOCAL_EVIDENCE_RESOLVER_VERSION = "local-evidence-resolver-v1";
export const LOCAL_MODEL_OUTPUT_UNRELIABLE = "LOCAL_MODEL_OUTPUT_UNRELIABLE";
export const MODEL_QUALITY_INSUFFICIENT = "MODEL_QUALITY_INSUFFICIENT";
export const SYSTEM_VALIDATION_FAILURE = "SYSTEM_VALIDATION_FAILURE";

export type FactType = "explicit" | "inferred" | "unknown" | "conflicted";
export type ConfidenceLevel = "high_confidence" | "medium_confidence" | "low_confidence" | "insufficient_evidence";
export type CandidateStage = "extracted_candidate" | "validated_candidate" | "user_confirmed" | "policy_approved" | "committed";
export type RejectionAudit = {
  requestId: string;
  modelId: string;
  taskType: string;
  rejectionReason: string;
  failureClass: typeof MODEL_QUALITY_INSUFFICIENT | typeof SYSTEM_VALIDATION_FAILURE;
  validatorVersion: string;
  ruleEngineVersion: string;
  evidenceResolverVersion: string;
  retryAttempt: number;
  finalDisposition: "retry" | "rejected";
};

export type SourceDocument = { chapterId: string; text: string };
export type EvidenceSpan = { sourceChapterId: string; start: number; end: number; text: string };
export type ExtractedFact = {
  entityId: string;
  field: string;
  value: string | number | boolean | null;
  factType: FactType;
  evidenceSpans: EvidenceSpan[];
  sourceChapterIds: string[];
  confidence: number;
  validatorStatus: "pending" | "valid" | "invalid" | "conflict";
  modelId: string;
  requestId: string;
  schemaVersion: string;
};

const EvidenceSpanSchema = z.object({
  sourceChapterId: z.string().min(1).max(160),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  text: z.string().min(1).max(500),
}).strict();

export const ExtractedFactSchema = z.object({
  entityId: z.string().min(1).max(160),
  field: z.string().min(1).max(120),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
  factType: z.enum(["explicit", "inferred", "unknown", "conflicted"]),
  evidenceSpans: z.array(EvidenceSpanSchema).max(5),
  sourceChapterIds: z.array(z.string().min(1).max(160)).max(5),
  confidence: z.number().min(0).max(1),
  validatorStatus: z.enum(["pending", "valid", "invalid", "conflict"]),
  modelId: z.string().min(1).max(160),
  requestId: z.string().min(1).max(160),
  schemaVersion: z.literal(LOCAL_QUALITY_SCHEMA_VERSION),
}).strict();

export const LocalExtractionEnvelopeSchema = z.object({
  schemaVersion: z.literal(LOCAL_QUALITY_SCHEMA_VERSION),
  facts: z.array(ExtractedFactSchema).max(40),
}).strict();

function normalizeChineseNumber(value: string) {
  const digits: Record<string, number> = { "零": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "十") return 10;
  const match = value.match(/^([一二兩三四五六七八九])?十([一二三四五六七八九])?$/);
  if (match) return (match[1] ? digits[match[1]] : 1) * 10 + (match[2] ? digits[match[2]] : 0);
  return null;
}

export function normalizeHighRiskValue(field: string, value: unknown) {
  if (value === null || value === undefined || value === "") return { status: "unknown" as const, value: null };
  const text = String(value).trim();
  if (field === "age") {
    const match = text.match(/([0-9]{1,3}|[一二兩三四五六七八九十]{1,3})\s*歲?/);
    const age = match ? normalizeChineseNumber(match[1]) : null;
    return age !== null && age >= 0 && age <= 150 ? { status: "normalized" as const, value: age } : { status: "unknown" as const, value: null };
  }
  if (field === "year") {
    const roc = text.match(/民國\s*(\d{1,3})\s*年?/);
    if (roc) return { status: "normalized" as const, value: Number(roc[1]) + 1911 };
    const ad = text.match(/(?:西元\s*)?(\d{4})\s*年?/);
    return ad ? { status: "normalized" as const, value: Number(ad[1]) } : { status: "unknown" as const, value: null };
  }
  if (["location", "lifeStatus", "identity", "owner", "injury", "abilityLimit", "worldRule"].includes(field)) {
    return { status: text ? "normalized" as const : "unknown" as const, value: text.toLocaleLowerCase("zh-TW") };
  }
  return { status: "normalized" as const, value: typeof value === "string" ? text : value };
}

export function validateEvidenceSpan(span: EvidenceSpan, sources: SourceDocument[]) {
  const source = sources.find((item) => item.chapterId === span.sourceChapterId);
  if (!source) return { valid: false, errorCode: "EVIDENCE_SOURCE_NOT_FOUND" };
  if (span.start < 0 || span.end <= span.start || span.end > source.text.length) return { valid: false, errorCode: "EVIDENCE_RANGE_INVALID" };
  if (source.text.slice(span.start, span.end) !== span.text) return { valid: false, errorCode: "EVIDENCE_TEXT_MISMATCH" };
  return { valid: true, errorCode: null };
}

export function validateExtractedFacts(facts: ExtractedFact[], sources: SourceDocument[]) {
  const rejected: Array<{ fact: ExtractedFact; reasons: string[] }> = [];
  const validated: ExtractedFact[] = [];
  for (const fact of facts) {
    const reasons: string[] = [];
    const spanResults = fact.evidenceSpans.map((span) => validateEvidenceSpan(span, sources));
    if (fact.factType === "explicit" && fact.evidenceSpans.length === 0) reasons.push("EXPLICIT_FACT_REQUIRES_EVIDENCE");
    if (spanResults.some((result) => !result.valid)) reasons.push(...spanResults.filter((result) => !result.valid).map((result) => String(result.errorCode)));
    if (fact.factType === "unknown" && fact.value !== null) reasons.push("UNKNOWN_FACT_MUST_HAVE_NULL_VALUE");
    const next = { ...fact, validatorStatus: reasons.length ? "invalid" as const : fact.factType === "conflicted" ? "conflict" as const : "valid" as const };
    if (reasons.length) rejected.push({ fact: next, reasons }); else validated.push(next);
  }
  return { validated, rejected, pass: rejected.length === 0 };
}

function stripCodeFence(raw: string) {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

export function parseAndValidateModelExtraction(raw: string, sources: SourceDocument[]) {
  let parsed: unknown;
  try { parsed = JSON.parse(stripCodeFence(raw)); }
  catch { return { status: "reject" as const, errorCode: LOCAL_MODEL_OUTPUT_UNRELIABLE, schemaValid: false, validated: [], rejected: [] }; }
  const schema = LocalExtractionEnvelopeSchema.safeParse(parsed);
  if (!schema.success) return { status: "reject" as const, errorCode: LOCAL_MODEL_OUTPUT_UNRELIABLE, schemaValid: false, schemaErrors: schema.error.issues, validated: [], rejected: [] };
  const evidence = validateExtractedFacts(schema.data.facts, sources);
  return { status: evidence.pass ? "accept" as const : "reject" as const, errorCode: evidence.pass ? null : LOCAL_MODEL_OUTPUT_UNRELIABLE, schemaValid: true, ...evidence };
}

export function buildRejectionAudit(input: { requestId: string; modelId: string; taskType: string; rejectionReason: string; retryAttempt: number; systemFailure?: boolean }): RejectionAudit {
  const rejectionReason = /^[A-Z0-9_:-]{1,160}$/.test(input.rejectionReason)
    ? input.rejectionReason
    : input.systemFailure ? "VALIDATION_COMPONENT_FAILURE" : "MODEL_OUTPUT_REJECTED";
  return {
    requestId: input.requestId,
    modelId: input.modelId,
    taskType: input.taskType,
    rejectionReason,
    failureClass: input.systemFailure ? SYSTEM_VALIDATION_FAILURE : MODEL_QUALITY_INSUFFICIENT,
    validatorVersion: LOCAL_VALIDATION_VERSION,
    ruleEngineVersion: LOCAL_RULE_ENGINE_VERSION,
    evidenceResolverVersion: LOCAL_EVIDENCE_RESOLVER_VERSION,
    retryAttempt: input.retryAttempt,
    finalDisposition: input.retryAttempt < retryStrategies.length ? "retry" : "rejected",
  };
}

export function buildExtractionFingerprint(input: { sourceRevision: string; taskType: string; modelId: string; schemaVersion: string; sourceText: string }) {
  const value = `${input.sourceRevision}\u0000${input.taskType}\u0000${input.modelId}\u0000${input.schemaVersion}\u0000${input.sourceText}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function deterministicExtract(sources: SourceDocument[], modelId: string, requestId: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  for (const source of sources) {
    const agePattern = /([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9·]{0,20})[，, ]*(?:今年)?([0-9]{1,3}|[一二兩三四五六七八九十]{1,3})歲/gu;
    for (const match of source.text.matchAll(agePattern)) {
      const age = normalizeChineseNumber(match[2]);
      if (age === null) continue;
      const start = match.index ?? 0;
      facts.push({ entityId: `character:${match[1]}`, field: "age", value: age, factType: "explicit", evidenceSpans: [{ sourceChapterId: source.chapterId, start, end: start + match[0].length, text: match[0] }], sourceChapterIds: [source.chapterId], confidence: 0.99, validatorStatus: "valid", modelId, requestId, schemaVersion: LOCAL_QUALITY_SCHEMA_VERSION });
    }
    const locationPattern = /([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9·]{0,20})(?:目前|此刻|當時)?(?:位於|在|抵達)([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9·]{0,30})/gu;
    for (const match of source.text.matchAll(locationPattern)) {
      const start = match.index ?? 0;
      facts.push({ entityId: `character:${match[1]}`, field: "location", value: match[2], factType: "explicit", evidenceSpans: [{ sourceChapterId: source.chapterId, start, end: start + match[0].length, text: match[0] }], sourceChapterIds: [source.chapterId], confidence: 0.95, validatorStatus: "valid", modelId, requestId, schemaVersion: LOCAL_QUALITY_SCHEMA_VERSION });
    }
  }
  return facts;
}

export type ConflictRecord = {
  entityId: string;
  field: string;
  existingFact: ExtractedFact;
  newCandidate: ExtractedFact;
  evidenceForBoth: EvidenceSpan[];
  sourceChapters: string[];
  conflictType: string;
  confidence: number;
  resolutionStatus: "unresolved";
};

export function crossSourceConsistencyCheck(facts: ExtractedFact[]) {
  const conflicts: ConflictRecord[] = [];
  const grouped = new Map<string, ExtractedFact[]>();
  for (const fact of facts.filter((item) => item.factType === "explicit" && item.validatorStatus === "valid")) {
    const key = `${fact.entityId}:${fact.field}`;
    grouped.set(key, [...(grouped.get(key) || []), fact]);
  }
  for (const rows of grouped.values()) {
    for (let index = 1; index < rows.length; index += 1) {
      const existing = rows[0]; const candidate = rows[index];
      const left = normalizeHighRiskValue(existing.field, existing.value); const right = normalizeHighRiskValue(candidate.field, candidate.value);
      if (left.status === "normalized" && right.status === "normalized" && left.value !== right.value) {
        conflicts.push({ entityId: candidate.entityId, field: candidate.field, existingFact: existing, newCandidate: { ...candidate, factType: "conflicted", validatorStatus: "conflict" }, evidenceForBoth: [...existing.evidenceSpans, ...candidate.evidenceSpans], sourceChapters: [...new Set([...existing.sourceChapterIds, ...candidate.sourceChapterIds])], conflictType: `${candidate.field}_mismatch`, confidence: Math.min(existing.confidence, candidate.confidence), resolutionStatus: "unresolved" });
      }
    }
  }
  return conflicts;
}

export function deterministicContinuityGuard(existing: ExtractedFact[], candidates: ExtractedFact[]) {
  const all = [...existing, ...candidates];
  const conflicts = crossSourceConsistencyCheck(all);
  return { conflicts, deterministicResultWins: true, pass: conflicts.length === 0 };
}

export function confidenceLevel(fact: ExtractedFact): ConfidenceLevel {
  if (fact.factType === "unknown" || fact.evidenceSpans.length === 0) return "insufficient_evidence";
  if (fact.validatorStatus === "invalid" || fact.confidence < 0.5) return "low_confidence";
  if (fact.validatorStatus === "conflict" || fact.confidence < 0.85) return "medium_confidence";
  return "high_confidence";
}

export const retryStrategies = [
  { attempt: 1, strategy: "normal_structured_extraction" },
  { attempt: 2, strategy: "evidence_only_extraction" },
  { attempt: 3, strategy: "constrained_field_by_field_extraction" },
] as const;

export function nextCandidateStage(current: CandidateStage, requested: CandidateStage): CandidateStage {
  const allowed: Record<CandidateStage, CandidateStage[]> = {
    extracted_candidate: ["validated_candidate"],
    validated_candidate: ["user_confirmed", "policy_approved"],
    user_confirmed: ["committed"],
    policy_approved: ["committed"],
    committed: [],
  };
  if (!allowed[current].includes(requested)) throw Object.assign(new Error("Candidate cannot skip the formal write gate."), { code: "LOCAL_FORMAL_WRITE_GATE_REJECTED" });
  return requested;
}

export type WriteGateMetadata = {
  validationVersion: string;
  ruleVersion: string;
  schemaVersion: string;
  sourceRevision: string;
  fingerprint: string;
};

export function verifyFormalWriteGate(input: { stage: CandidateStage; metadata: WriteGateMetadata; currentSourceRevision: string }) {
  if (!['user_confirmed', 'policy_approved'].includes(input.stage)) return { allowed: false, errorCode: "LOCAL_FORMAL_WRITE_GATE_REJECTED" };
  if (input.metadata.validationVersion !== LOCAL_VALIDATION_VERSION || input.metadata.ruleVersion !== LOCAL_RULE_ENGINE_VERSION || input.metadata.schemaVersion !== LOCAL_QUALITY_SCHEMA_VERSION) {
    return { allowed: false, errorCode: SYSTEM_VALIDATION_FAILURE };
  }
  if (input.metadata.sourceRevision !== input.currentSourceRevision) return { allowed: false, errorCode: "LOCAL_SOURCE_REVISION_STALE" };
  if (!input.metadata.fingerprint) return { allowed: false, errorCode: SYSTEM_VALIDATION_FAILURE };
  return { allowed: true, errorCode: null };
}

export const local3BTaskMatrix = {
  direct: ["summary", "rewrite", "simple_field_extraction", "classification", "short_text_comparison"],
  guarded: ["character.extract", "timeline.review", "continuity.review", "story-bible.update", "relationship.infer"],
  strongerModel: ["whole_novel_reasoning", "multi_chapter_implicit_causality", "large_cast_politics", "automatic_canonical_write"],
} as const;

export function resolveLocalTaskRisk(taskType: string, modelParameterBillions: number) {
  if ((local3BTaskMatrix.strongerModel as readonly string[]).includes(taskType)) return { action: "stronger_local_or_private_hub", allowed: false };
  if ((local3BTaskMatrix.guarded as readonly string[]).includes(taskType)) return modelParameterBillions <= 3 ? { action: "local_with_deterministic_guard", allowed: true } : { action: "local_structured", allowed: true };
  return { action: "local_direct", allowed: true };
}

export function taskSystemInstruction(taskType: string) {
  if (taskType === "character.extract") return `Return JSON only. Use schemaVersion ${LOCAL_QUALITY_SCHEMA_VERSION}. Return {"schemaVersion":"${LOCAL_QUALITY_SCHEMA_VERSION}","facts":[]} and include exact evidenceSpans from the source. Never invent facts; use factType unknown with null value when evidence is missing.`;
  if (taskType === "continuity.review" || taskType === "timeline.review") return "Use Traditional Chinese. Deterministic conflicts supplied by the client are authoritative. Explain them and suggest repairs; do not dismiss or overwrite them.";
  return "Use Traditional Chinese. Follow the supplied story facts. Return candidate content only.";
}

export function validateStudioTaskOutput(input: { taskType: string; prompt: string; output: string; modelId: string; requestId: string }) {
  if (input.taskType !== "character.extract") return { status: "accept" as const, errorCode: null, quality: "not_structured_task" };
  const source = { chapterId: "studio-input", text: input.prompt };
  return parseAndValidateModelExtraction(input.output, [source]);
}
