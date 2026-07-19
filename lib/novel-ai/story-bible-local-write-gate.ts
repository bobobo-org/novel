import crypto from "crypto";
import type { ExtractedFact, ConflictRecord, CandidateStage, WriteGateMetadata } from "./providers/local-ollama/local-quality-guard";
import { confidenceLevel, verifyFormalWriteGate } from "./providers/local-ollama/local-quality-guard";
import type { JsonRecord, StoryBibleStorageAdapter } from "./storage/types";

export const STORY_BIBLE_WRITE_GATE_REJECTED = "STORY_BIBLE_WRITE_GATE_REJECTED";
export const STORY_BIBLE_SOURCE_REVISION_STALE = "STORY_BIBLE_SOURCE_REVISION_STALE";
export const STORY_BIBLE_LOCAL_WRITE_GATE_VERSION = "local-story-bible-write-gate-v1";

export type LocalStoryBibleCommitInput = {
  adapter: StoryBibleStorageAdapter;
  projectId: string;
  candidateId: string;
  stage: Extract<CandidateStage, "user_confirmed" | "policy_approved">;
  fact: ExtractedFact;
  metadata: WriteGateMetadata & { evidenceResolverVersion: string; modelId: string; requestId: string };
  currentSourceRevision: () => string | Promise<string>;
  sourceRows: JsonRecord[];
  conflict?: ConflictRecord | null;
  injectFailureAt?: "canonical" | "source" | "audit" | "version";
};

export async function recordValidatedLocalStoryBibleConflict(input: {
  adapter: StoryBibleStorageAdapter;
  projectId: string;
  candidateId: string;
  conflict: ConflictRecord;
  requestId: string;
  existingSourceRevision: string;
  candidateSourceRevision: string;
}) {
  if (input.conflict.resolutionStatus !== "unresolved") throw gateError(STORY_BIBLE_WRITE_GATE_REJECTED, "Only unresolved conflict records use this review path.");
  return input.adapter.transaction(async (tx) => {
    const stored = await input.adapter.createConflict({
      id: `conflict_${crypto.randomUUID()}`, projectId: input.projectId, project_id: input.projectId, candidateId: input.candidateId,
      canonicalEntityType: input.conflict.entityId.split(":", 1)[0] || "character", canonicalEntityId: input.conflict.entityId,
      fieldPath: input.conflict.field, conflictType: input.conflict.conflictType, severity: "major", existingFact: input.conflict.existingFact,
      newCandidate: input.conflict.newCandidate, evidenceForBoth: input.conflict.evidenceForBoth, sourceChapters: input.conflict.sourceChapters,
      existingSourceRevision: input.existingSourceRevision, candidateSourceRevision: input.candidateSourceRevision, confidence: input.conflict.confidence,
      resolutionStatus: "unresolved", status: "open", requestId: input.requestId, transactionId: tx.transactionId,
    });
    await input.adapter.updateCandidateStatus(input.projectId, input.candidateId, "needs_review", { conflictId: stored.id, conflictStatus: "unresolved" });
    return { status: "needs_review", conflict: stored, transactionId: tx.transactionId };
  });
}

function gateError(code: string, message: string, details: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function assertCommittable(input: LocalStoryBibleCommitInput, currentRevision: string) {
  const gate = verifyFormalWriteGate({ stage: input.stage, metadata: input.metadata, currentSourceRevision: currentRevision });
  if (!gate.allowed) {
    const code = gate.errorCode === "LOCAL_SOURCE_REVISION_STALE" ? STORY_BIBLE_SOURCE_REVISION_STALE : STORY_BIBLE_WRITE_GATE_REJECTED;
    throw gateError(code, "The Story Bible candidate did not pass the formal write gate.", { causeCode: gate.errorCode });
  }
  if (input.fact.requestId !== input.metadata.requestId || input.fact.modelId !== input.metadata.modelId || input.fact.schemaVersion !== input.metadata.schemaVersion) throw gateError(STORY_BIBLE_WRITE_GATE_REJECTED, "Candidate provenance does not match write metadata.");
  if (input.fact.factType !== "explicit" || input.fact.validatorStatus !== "valid" || confidenceLevel(input.fact) !== "high_confidence") throw gateError(STORY_BIBLE_WRITE_GATE_REJECTED, "Only high-confidence validated explicit facts can be committed.");
  if (input.conflict?.resolutionStatus === "unresolved") throw gateError(STORY_BIBLE_WRITE_GATE_REJECTED, "Unresolved conflicts cannot be committed.");
  if (!input.sourceRows.length || input.fact.evidenceSpans.length === 0) throw gateError(STORY_BIBLE_WRITE_GATE_REJECTED, "Validated source evidence is required.");
  for (const span of input.fact.evidenceSpans) {
    const source = input.sourceRows.find((row) => String(row.chapterId || row.chapter_id || "") === span.sourceChapterId);
    const chapterText = String(source?.chapterText || source?.chapter_text || "");
    if (!source || !chapterText || chapterText.slice(span.start, span.end) !== span.text) throw gateError(STORY_BIBLE_WRITE_GATE_REJECTED, "Source evidence no longer matches the chapter text.");
  }
}

export async function commitValidatedLocalStoryBibleCandidate(input: LocalStoryBibleCommitInput) {
  const initialRevision = await input.currentSourceRevision();
  assertCommittable(input, initialRevision);
  const candidate = await input.adapter.getCandidate(input.projectId, input.candidateId);
  if (!candidate) throw gateError(STORY_BIBLE_WRITE_GATE_REJECTED, "Candidate was not found in this project.");
  if (!["validated_candidate", "user_confirmed", "policy_approved"].includes(String(candidate.status || ""))) throw gateError(STORY_BIBLE_WRITE_GATE_REJECTED, "Candidate has not completed validation.");

  return input.adapter.transaction(async (tx) => {
    const currentRevision = await input.currentSourceRevision();
    if (currentRevision !== input.metadata.sourceRevision) throw gateError(STORY_BIBLE_SOURCE_REVISION_STALE, "The source revision changed before commit.");
    const now = new Date().toISOString();
    await input.adapter.beginMutationRequest({ requestId: input.metadata.requestId, projectId: input.projectId, project_id: input.projectId, operation: "local-ai-approved-candidate", candidateIds: [input.candidateId], fingerprint: input.metadata.fingerprint, status: "running", createdAt: now });
    const entityType = input.fact.entityId.split(":", 1)[0] || "character";
    const entityId = input.fact.entityId;
    const existing = await input.adapter.getCanonicalEntity(input.projectId, entityType, entityId);
    const canonicalPatch = { projectId: input.projectId, project_id: input.projectId, entityId, entity_id: entityId, [input.fact.field]: input.fact.value, sourceRevision: input.metadata.sourceRevision, source_revision: input.metadata.sourceRevision, updatedAt: now };
    const canonical = existing
      ? await input.adapter.updateCanonicalEntity(input.projectId, entityType, entityId, canonicalPatch)
      : await input.adapter.createCanonicalEntity(entityType, canonicalPatch);
    if (input.injectFailureAt === "canonical") throw new Error("INJECTED_CANONICAL_FAILURE");

    const relations: JsonRecord[] = [];
    for (const sourceRow of input.sourceRows) {
      const persistedSourceRow = { ...sourceRow };
      delete persistedSourceRow.chapterText;
      delete persistedSourceRow.chapter_text;
      const source = await input.adapter.createSource({ ...persistedSourceRow, projectId: input.projectId, project_id: input.projectId, sourceRevision: input.metadata.sourceRevision });
      relations.push(await input.adapter.createCanonicalSourceRelation({ projectId: input.projectId, project_id: input.projectId, entityType, entityId, sourceId: source.id, candidateId: input.candidateId, relationType: "evidence", transactionId: tx.transactionId }));
    }
    if (input.injectFailureAt === "source") throw new Error("INJECTED_SOURCE_FAILURE");

    if (input.conflict) await input.adapter.createConflict({ ...input.conflict, id: `conflict_${crypto.randomUUID()}`, projectId: input.projectId, project_id: input.projectId, candidateId: input.candidateId, requestId: input.metadata.requestId, sourceRevision: input.metadata.sourceRevision, status: "open" });
    const audit = await input.adapter.saveCandidateAudit({ id: `candidate_audit_${crypto.randomUUID()}`, projectId: input.projectId, project_id: input.projectId, candidateId: input.candidateId, action: "committed", requestId: input.metadata.requestId, modelId: input.metadata.modelId, fingerprint: input.metadata.fingerprint, gateVersion: STORY_BIBLE_LOCAL_WRITE_GATE_VERSION, sourceRevision: input.metadata.sourceRevision, createdAt: now });
    if (input.injectFailureAt === "audit") throw new Error("INJECTED_AUDIT_FAILURE");

    const currentVersion = await input.adapter.getCurrentVersion(input.projectId);
    const version = await input.adapter.createVersion({ id: `version_${crypto.randomUUID()}`, projectId: input.projectId, project_id: input.projectId, versionNumber: Number(currentVersion?.versionNumber || currentVersion?.version_number || 0) + 1, operationType: "local-ai-approved-candidate", candidateIds: [input.candidateId], approvedCandidateIds: [input.candidateId], entityType, entityId, fieldPath: input.fact.field, requestId: input.metadata.requestId, sourceRevision: input.metadata.sourceRevision, changes: [{ entityType, entityId, fieldPath: input.fact.field, previousValue: existing?.[input.fact.field] ?? null, newValue: input.fact.value }] });
    if (input.injectFailureAt === "version") throw new Error("INJECTED_VERSION_FAILURE");

    if (await input.currentSourceRevision() !== input.metadata.sourceRevision) throw gateError(STORY_BIBLE_SOURCE_REVISION_STALE, "The source revision changed during commit.");

    await input.adapter.updateCandidateStatus(input.projectId, input.candidateId, "committed", { committedAt: now, committedVersionId: version.id, sourceRevision: input.metadata.sourceRevision, gateVersion: STORY_BIBLE_LOCAL_WRITE_GATE_VERSION });
    await input.adapter.completeMutationRequest(input.metadata.requestId, { status: "committed", candidateId: input.candidateId, versionId: version.id, transactionId: tx.transactionId });
    return { status: "committed", projectId: input.projectId, candidateId: input.candidateId, canonical, relations, audit, version, transactionId: tx.transactionId };
  });
}
