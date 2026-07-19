import type { StoryBible } from "../domain/index";
import {
  LOCAL_EVIDENCE_RESOLVER_VERSION,
  LOCAL_QUALITY_SCHEMA_VERSION,
  LOCAL_RULE_ENGINE_VERSION,
  LOCAL_VALIDATION_VERSION,
  confidenceLevel,
  type ExtractedFact,
  verifyFormalWriteGate,
} from "../providers/local-ollama/local-quality-guard";
import type { NovelRepository } from "./contracts/index";

export const STUDIO_STORY_BIBLE_APPROVAL_VERSION = "studio-story-bible-approval-v1";
export const STORY_BIBLE_APPROVAL_ALREADY_COMMITTED = "ALREADY_COMMITTED";
export const STORY_BIBLE_APPROVAL_STALE = "STORY_BIBLE_SOURCE_REVISION_STALE";
export const STORY_BIBLE_APPROVAL_CONFLICT = "STORY_BIBLE_CONFLICT_REQUIRES_REVIEW";
export const STORY_BIBLE_APPROVAL_REJECTED = "STORY_BIBLE_WRITE_GATE_REJECTED";

export type LocalStoryBibleCandidate = {
  candidateId: string;
  storyId: string;
  chapterId: string;
  status: "validated_candidate" | "needs_review" | "committed" | "rejected";
  fact: ExtractedFact;
  sourceRevision: string;
  candidateFingerprint: string;
  extractionRequestId: string;
  modelRequestId: string;
  modelId: string;
  providerKind: "local_ollama";
  schemaVersion: string;
  validatorVersion: string;
  ruleVersion: string;
  evidenceResolverVersion: string;
  createdAt: string;
  committedAt?: string;
  rejectedAt?: string;
};

export type LocalStoryBibleApprovalEvent = {
  approvalEventId: string;
  idempotencyKey: string;
  requestId: string;
  candidateId: string;
  storyId: string;
  chapterId: string;
  sourceRevision: string;
  candidateFingerprint: string;
  modelId: string;
  providerKind: "local_ollama";
  schemaVersion: string;
  validatorVersion: string;
  ruleVersion: string;
  evidenceResolverVersion: string;
  approvedBy: "local_author";
  approvedAt: string;
};

export type LocalStoryBibleState = {
  schemaVersion: typeof STUDIO_STORY_BIBLE_APPROVAL_VERSION;
  candidates: LocalStoryBibleCandidate[];
  canonicalFacts: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  approvalEvents: LocalStoryBibleApprovalEvent[];
  audits: Array<Record<string, unknown>>;
  revisions: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
};

type StoryBibleWithLocalKnowledge = StoryBible & { localKnowledge?: LocalStoryBibleState };

function emptyState(): LocalStoryBibleState {
  return {
    schemaVersion: STUDIO_STORY_BIBLE_APPROVAL_VERSION,
    candidates: [],
    canonicalFacts: [],
    evidence: [],
    approvalEvents: [],
    audits: [],
    revisions: [],
    conflicts: [],
  };
}

function cloneState(storyBible: StoryBibleWithLocalKnowledge): LocalStoryBibleState {
  return structuredClone(storyBible.localKnowledge || emptyState());
}

function approvalError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

async function getStoryBible(repository: NovelRepository, projectId: string) {
  const rows = await repository.list<StoryBibleWithLocalKnowledge>("storyBibles", projectId);
  const storyBible = rows[0];
  if (!storyBible) throw approvalError("STORY_BIBLE_NOT_FOUND", "找不到這部作品的正式 Story Bible。");
  return storyBible;
}

function candidateStatus(fact: ExtractedFact): LocalStoryBibleCandidate["status"] {
  return fact.factType === "explicit" && fact.validatorStatus === "valid" && confidenceLevel(fact) === "high_confidence"
    ? "validated_candidate"
    : "needs_review";
}

export async function registerValidatedLocalStoryBibleCandidates(input: {
  repository: NovelRepository;
  projectId: string;
  chapterId: string;
  requestId: string;
  sourceRevision: string;
  candidateFingerprint: string;
  modelId: string;
  facts: ExtractedFact[];
}) {
  const storyBible = await getStoryBible(input.repository, input.projectId);
  const state = cloneState(storyBible);
  const now = new Date().toISOString();
  const candidates = input.facts.map((fact, index): LocalStoryBibleCandidate => ({
    candidateId: `${input.requestId}:fact:${index}`,
    storyId: storyBible.id,
    chapterId: input.chapterId,
    status: candidateStatus(fact),
    fact,
    sourceRevision: input.sourceRevision,
    candidateFingerprint: input.candidateFingerprint,
    extractionRequestId: input.requestId,
    modelRequestId: fact.requestId,
    modelId: input.modelId,
    providerKind: "local_ollama",
    schemaVersion: LOCAL_QUALITY_SCHEMA_VERSION,
    validatorVersion: LOCAL_VALIDATION_VERSION,
    ruleVersion: LOCAL_RULE_ENGINE_VERSION,
    evidenceResolverVersion: LOCAL_EVIDENCE_RESOLVER_VERSION,
    createdAt: now,
  }));
  const existingIds = new Set(state.candidates.map((candidate) => candidate.candidateId));
  state.candidates.push(...candidates.filter((candidate) => !existingIds.has(candidate.candidateId)));
  const updated = await input.repository.put<StoryBibleWithLocalKnowledge>(
    "storyBibles",
    { ...storyBible, localKnowledge: state },
    storyBible.revision,
  );
  return { storyBible: updated, candidates };
}

export async function approveLocalStoryBibleCandidate(input: {
  repository: NovelRepository;
  projectId: string;
  candidateId: string;
  approvalEventId: string;
  idempotencyKey: string;
  requestId: string;
  currentSourceRevision: () => string | Promise<string>;
  sourceText: string;
  injectFault?: boolean;
}) {
  const storyBible = await getStoryBible(input.repository, input.projectId);
  const state = cloneState(storyBible);
  const candidate = state.candidates.find((row) => row.candidateId === input.candidateId);
  if (!candidate) throw approvalError("STORY_BIBLE_CANDIDATE_NOT_FOUND", "找不到這筆待審建議。");
  const previousEvent = state.approvalEvents.find((event) => event.approvalEventId === input.approvalEventId || event.idempotencyKey === input.idempotencyKey);
  if (previousEvent) {
    if (previousEvent.candidateId !== input.candidateId || previousEvent.candidateFingerprint !== candidate.candidateFingerprint) throw approvalError("IDEMPOTENCY_KEY_CONFLICT", "這個核准識別碼已用於不同候選。");
    return { status: STORY_BIBLE_APPROVAL_ALREADY_COMMITTED, replayed: true, storyBible, candidate, approvalEvent: previousEvent };
  }
  if (candidate.status === "committed") return { status: STORY_BIBLE_APPROVAL_ALREADY_COMMITTED, replayed: true, storyBible, candidate };
  if (candidate.status !== "validated_candidate") throw approvalError(STORY_BIBLE_APPROVAL_REJECTED, "這筆建議尚未通過證據驗證，不能寫入正式 Story Bible。");
  const currentRevision = await input.currentSourceRevision();
  const gate = verifyFormalWriteGate({
    stage: "user_confirmed",
    metadata: {
      validationVersion: candidate.validatorVersion,
      ruleVersion: candidate.ruleVersion,
      schemaVersion: candidate.schemaVersion,
      sourceRevision: candidate.sourceRevision,
      fingerprint: candidate.candidateFingerprint,
    },
    currentSourceRevision: currentRevision,
  });
  if (!gate.allowed) throw approvalError(gate.errorCode === "LOCAL_SOURCE_REVISION_STALE" ? STORY_BIBLE_APPROVAL_STALE : STORY_BIBLE_APPROVAL_REJECTED, "來源章節已改版或驗證版本不一致，請重新抽取。");
  if (candidate.fact.requestId !== candidate.modelRequestId) throw approvalError(STORY_BIBLE_APPROVAL_REJECTED, "候選來源識別不一致。");
  if (candidate.fact.factType !== "explicit" || candidate.fact.validatorStatus !== "valid" || confidenceLevel(candidate.fact) !== "high_confidence") throw approvalError(STORY_BIBLE_APPROVAL_REJECTED, "只有明確、具證據且高可信的事實可以提交。");
  for (const span of candidate.fact.evidenceSpans) {
    if (span.sourceChapterId !== candidate.chapterId || input.sourceText.slice(span.start, span.end) !== span.text) throw approvalError(STORY_BIBLE_APPROVAL_REJECTED, "原始證據已不存在或位置不一致。");
  }
  const existing = state.canonicalFacts.find((fact) => fact.entityId === candidate.fact.entityId && fact.field === candidate.fact.field);
  if (existing && JSON.stringify(existing.value) !== JSON.stringify(candidate.fact.value)) {
    const conflict = {
      conflictId: crypto.randomUUID(),
      candidateId: candidate.candidateId,
      existingFact: existing,
      newCandidate: candidate.fact,
      evidenceForBoth: [...((existing.evidenceSpans as unknown[]) || []), ...candidate.fact.evidenceSpans],
      sourceChapters: [...new Set([...(existing.sourceChapterIds as string[] || []), ...candidate.fact.sourceChapterIds])],
      conflictType: `${candidate.fact.field}_mismatch`,
      confidence: candidate.fact.confidence,
      resolutionStatus: "unresolved",
      createdAt: new Date().toISOString(),
    };
    candidate.status = "needs_review";
    state.conflicts.push(conflict);
    const updated = await input.repository.put<StoryBibleWithLocalKnowledge>("storyBibles", { ...storyBible, localKnowledge: state }, storyBible.revision);
    return { status: STORY_BIBLE_APPROVAL_CONFLICT, replayed: false, storyBible: updated, candidate, conflict };
  }
  const now = new Date().toISOString();
  const approvalEvent: LocalStoryBibleApprovalEvent = {
    approvalEventId: input.approvalEventId,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    candidateId: candidate.candidateId,
    storyId: candidate.storyId,
    chapterId: candidate.chapterId,
    sourceRevision: candidate.sourceRevision,
    candidateFingerprint: candidate.candidateFingerprint,
    modelId: candidate.modelId,
    providerKind: candidate.providerKind,
    schemaVersion: candidate.schemaVersion,
    validatorVersion: candidate.validatorVersion,
    ruleVersion: candidate.ruleVersion,
    evidenceResolverVersion: candidate.evidenceResolverVersion,
    approvedBy: "local_author",
    approvedAt: now,
  };
  const canonicalFact = {
    factId: existing?.factId || crypto.randomUUID(),
    entityId: candidate.fact.entityId,
    field: candidate.fact.field,
    value: candidate.fact.value,
    factType: "explicit",
    sourceChapterIds: candidate.fact.sourceChapterIds,
    evidenceSpans: candidate.fact.evidenceSpans,
    sourceRevision: candidate.sourceRevision,
    candidateId: candidate.candidateId,
    updatedAt: now,
  };
  if (existing) Object.assign(existing, canonicalFact);
  else state.canonicalFacts.push(canonicalFact);
  state.evidence.push(...candidate.fact.evidenceSpans.map((span) => ({ evidenceId: crypto.randomUUID(), candidateId: candidate.candidateId, ...span, sourceRevision: candidate.sourceRevision, createdAt: now })));
  state.approvalEvents.push(approvalEvent);
  state.audits.push({ auditId: crypto.randomUUID(), action: "committed", candidateId: candidate.candidateId, approvalEventId: input.approvalEventId, requestId: input.requestId, sourceRevision: candidate.sourceRevision, createdAt: now });
  state.revisions.push({ revisionId: crypto.randomUUID(), revisionNumber: state.revisions.length + 1, candidateId: candidate.candidateId, approvalEventId: input.approvalEventId, sourceRevision: candidate.sourceRevision, createdAt: now });
  candidate.status = "committed";
  candidate.committedAt = now;
  if (input.injectFault) throw approvalError("INJECTED_STORY_BIBLE_TRANSACTION_FAULT", "測試注入：提交前中止。");
  if (await input.currentSourceRevision() !== candidate.sourceRevision) throw approvalError(STORY_BIBLE_APPROVAL_STALE, "來源章節在核准期間已改版，未寫入任何資料。");
  const updated = await input.repository.put<StoryBibleWithLocalKnowledge>("storyBibles", { ...storyBible, localKnowledge: state }, storyBible.revision);
  return { status: "committed", replayed: false, storyBible: updated, candidate, approvalEvent, canonicalFact };
}

export async function rejectLocalStoryBibleCandidate(input: {
  repository: NovelRepository;
  projectId: string;
  candidateId: string;
  requestId: string;
  reason?: string;
}) {
  const storyBible = await getStoryBible(input.repository, input.projectId);
  const state = cloneState(storyBible);
  const candidate = state.candidates.find((row) => row.candidateId === input.candidateId);
  if (!candidate) throw approvalError("STORY_BIBLE_CANDIDATE_NOT_FOUND", "找不到這筆待審建議。");
  if (candidate.status === "committed") throw approvalError(STORY_BIBLE_APPROVAL_REJECTED, "已提交的事實不能由候選審核流程拒絕。");
  const now = new Date().toISOString();
  candidate.status = "rejected";
  candidate.rejectedAt = now;
  state.audits.push({ auditId: crypto.randomUUID(), action: "rejected", candidateId: candidate.candidateId, requestId: input.requestId, reason: input.reason || "author_rejected", createdAt: now });
  const updated = await input.repository.put<StoryBibleWithLocalKnowledge>("storyBibles", { ...storyBible, localKnowledge: state }, storyBible.revision);
  return { status: "rejected", storyBible: updated, candidate };
}

export async function listLocalStoryBibleReviewState(repository: NovelRepository, projectId: string) {
  const storyBible = await getStoryBible(repository, projectId);
  return { storyBible, state: cloneState(storyBible) };
}

export type { StoryBibleWithLocalKnowledge };
