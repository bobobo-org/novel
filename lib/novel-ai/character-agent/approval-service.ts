import type { DomainRecord } from "../domain";
import { CharacterAgentError } from "./errors";
import { makeCharacterAgentRecord, sha256, stableStringify } from "./record-factory";
import type {
  ApproveCharacterProposalInput,
  CharacterAgentApprovalRecord,
  CharacterAgentAuditEvent,
  CharacterAgentEvaluation,
  CharacterApprovalEffects,
  CharacterProposalEnvelope,
  RejectCharacterProposalInput,
} from "./types";

const ALLOWED_PATCH_FIELDS: Record<CharacterProposalEnvelope["canonicalPatch"]["entityType"], Set<string>> = {
  character: new Set(["identity", "personality", "goal", "lifeStatus", "locationId"]),
  relationship: new Set(["kind", "summary", "trust"]),
  drama_scene: new Set(["sceneGoal", "conflict", "visualAction", "dialogueBlocks", "emotionStart", "emotionEnd"]),
};

export async function characterProposalFingerprint(proposal: CharacterProposalEnvelope) {
  return sha256(stableStringify({
    proposalId: proposal.proposalId,
    proposalType: proposal.proposalType,
    projectId: proposal.projectId,
    canonContext: proposal.canonContext,
    sourceEntityIds: proposal.sourceEntityIds,
    generatedPayload: proposal.generatedPayload,
    detectedChanges: proposal.detectedChanges,
    canonicalPatch: proposal.canonicalPatch,
    approvalEffects: proposal.approvalEffects,
  }));
}

function validatePatch(proposal: CharacterProposalEnvelope) {
  const allowed = ALLOWED_PATCH_FIELDS[proposal.canonicalPatch.entityType];
  const unknown = Object.keys(proposal.canonicalPatch.changes).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new CharacterAgentError("CHARACTER_CANONICAL_PATCH_FIELD_BLOCKED", `不得更新 Canonical 欄位：${unknown.join("、")}`);
  }
  if (proposal.canonicalPatch.targetLayer === "NOVEL_CANON" && proposal.canonicalPatch.entityType === "drama_scene") {
    throw new CharacterAgentError("DRAMA_PATCH_CANNOT_TARGET_NOVEL", "短劇角色候選不得修改 Novel Canon。");
  }
  if (proposal.canonicalPatch.targetLayer === "DRAMA_ADAPTATION_CANON" && proposal.canonicalPatch.entityType !== "drama_scene") {
    throw new CharacterAgentError("NOVEL_PATCH_CANNOT_TARGET_DRAMA", "小說角色候選不得修改 Drama Adaptation Canon。");
  }
}

function promoteEffects(effects: CharacterApprovalEffects): CharacterApprovalEffects {
  for (const memory of effects.approvedMemories) {
    if (memory.originType === "PRIVATE_SIMULATION" || memory.approvalStatus === "PRIVATE_ONLY") {
      throw new CharacterAgentError("PRIVATE_MEMORY_CANON_PROMOTION_BLOCKED", "私人模擬記憶不得提升為正式角色記憶。");
    }
    if (memory.originType === "RUMOR" && memory.truthStatus === "TRUE" && memory.sourceEventIds.length === 0) {
      throw new CharacterAgentError("RUMOR_TRUE_WITHOUT_CANONICAL_EVIDENCE", "傳聞未經正式事件證實前不得標為 TRUE。");
    }
  }
  const now = new Date().toISOString();
  return {
    stateUpdate: effects.stateUpdate ? { ...effects.stateUpdate, status: "APPROVED", updatedAt: now } : null,
    approvedMemories: effects.approvedMemories.map((memory) => ({
      ...memory,
      approvalStatus: "APPROVED",
      updatedAt: now,
    })),
    relationshipEdge: effects.relationshipEdge ? { ...effects.relationshipEdge, updatedAt: now } : null,
    relationshipEvent: effects.relationshipEvent ? {
      ...effects.relationshipEvent,
      status: "APPROVED",
      canonicalImpact: 1,
      updatedAt: now,
    } : null,
    knowledgeAcquisition: effects.knowledgeAcquisition ? {
      ...effects.knowledgeAcquisition,
      status: "CURRENT",
      updatedAt: now,
    } : null,
    privateArcPromotion: effects.privateArcPromotion ? {
      ...effects.privateArcPromotion,
      status: "PROMOTED",
      updatedAt: now,
    } : null,
  };
}

export async function buildCharacterApprovalRecords(input: {
  request: ApproveCharacterProposalInput;
  proposal: CharacterProposalEnvelope;
  evaluation: CharacterAgentEvaluation;
  canonicalRecord: DomainRecord;
}) {
  const { request, proposal, evaluation, canonicalRecord } = input;
  if (proposal.projectId !== request.projectId || canonicalRecord.projectId !== request.projectId) {
    throw new CharacterAgentError("CHARACTER_PROPOSAL_SCOPE_MISMATCH", "候選與 Canonical 記錄不屬於同一作品。");
  }
  if (proposal.status !== "GENERATED" && proposal.status !== "REVIEWING") {
    throw new CharacterAgentError("CHARACTER_PROPOSAL_NOT_APPROVABLE", "這份角色候選目前不能核准。");
  }
  if (proposal.freshnessStatus !== "CURRENT") {
    throw new CharacterAgentError("CHARACTER_PROPOSAL_STALE", "候選來源版本已更新，請重新產生。");
  }
  if (proposal.revision !== request.expectedProposalRevision) {
    throw new CharacterAgentError("CHARACTER_PROPOSAL_REVISION_STALE", "候選版本已更新，請重新載入。");
  }
  if (proposal.canonContext.canonContextId !== request.expectedCanonContextId) {
    throw new CharacterAgentError("CHARACTER_PROPOSAL_CANON_CONTEXT_STALE", "候選 Canon Context 已更新，請重新產生。");
  }
  if (proposal.sourceRevision !== request.expectedSourceRevision
    || proposal.sourceStoryBibleVersion !== request.expectedSourceStoryBibleVersion) {
    throw new CharacterAgentError("CHARACTER_PROPOSAL_SOURCE_STALE", "作品或 Story Bible 版本已更新，請重新產生。");
  }
  if (evaluation.evaluationId !== proposal.evaluationId || evaluation.blockingIssueCount > 0) {
    throw new CharacterAgentError("CHARACTER_PROPOSAL_EVALUATION_BLOCKED", "角色候選存在阻擋性檢查結果。");
  }
  const actualFingerprint = await characterProposalFingerprint(proposal);
  if (actualFingerprint !== request.payloadFingerprint) {
    throw new CharacterAgentError("CHARACTER_PROPOSAL_PAYLOAD_MISMATCH", "候選內容指紋不一致。");
  }
  validatePatch(proposal);
  const now = new Date().toISOString();
  const canonicalChanges = proposal.canonicalPatch.changes;
  const canonicalRecordUpdated: DomainRecord = Object.keys(canonicalChanges).length
    ? {
        ...canonicalRecord,
        ...structuredClone(canonicalChanges),
        parentRevision: canonicalRecord.revision,
        revision: canonicalRecord.revision + 1,
        updatedAt: now,
      }
    : structuredClone(canonicalRecord);
  const acceptedProposal: CharacterProposalEnvelope = {
    ...proposal,
    status: "ACCEPTED",
    parentRevision: proposal.revision,
    revision: proposal.revision + 1,
    updatedAt: now,
  };
  const approvalRecord = makeCharacterAgentRecord(request.projectId, "system");
  const approval: CharacterAgentApprovalRecord = {
    ...approvalRecord,
    id: approvalRecord.id,
    approvalId: approvalRecord.id,
    proposalId: proposal.proposalId,
    idempotencyKey: request.idempotencyKey,
    idempotencyScope: `${request.projectId}:${request.idempotencyKey}`,
    payloadFingerprint: request.payloadFingerprint,
    expectedProposalRevision: request.expectedProposalRevision,
    expectedSourceRevision: request.expectedSourceRevision,
    expectedSourceStoryBibleVersion: request.expectedSourceStoryBibleVersion,
    targetLayer: proposal.canonicalPatch.targetLayer,
    canonContextId: proposal.canonContext.canonContextId,
    canonicalEntityId: canonicalRecord.id,
    resultingCanonicalRevision: canonicalRecordUpdated.revision,
    approvedChanges: structuredClone(canonicalChanges),
    approvedBy: request.approvedBy,
    approvedAt: now,
    status: "COMMITTED",
  };
  const auditRecord = makeCharacterAgentRecord(request.projectId, "system");
  const effects = promoteEffects(proposal.approvalEffects);
  const audit: CharacterAgentAuditEvent = {
    ...auditRecord,
    id: auditRecord.id,
    auditEventId: auditRecord.id,
    eventType: "PROPOSAL_APPROVED",
    proposalId: proposal.proposalId,
    approvalId: approval.approvalId,
    canonContextId: proposal.canonContext.canonContextId,
    actor: request.approvedBy,
    affectedEntityIds: [
      canonicalRecord.id,
      ...effects.approvedMemories.map((memory) => memory.id),
      ...(effects.relationshipEdge ? [effects.relationshipEdge.id] : []),
      ...(effects.relationshipEvent ? [effects.relationshipEvent.id] : []),
      ...(effects.knowledgeAcquisition ? [effects.knowledgeAcquisition.id] : []),
      ...(effects.privateArcPromotion ? [effects.privateArcPromotion.id] : []),
    ],
    decisionSummary: "使用者核准角色候選；只套用白名單欄位與明列的核准效果。",
    sourceReferenceIds: proposal.sourceEntityIds,
  };
  return { proposal: acceptedProposal, approval, canonicalRecord: canonicalRecordUpdated, effects, audit };
}

export function buildCharacterRejectionRecords(input: {
  request: RejectCharacterProposalInput;
  proposal: CharacterProposalEnvelope;
}) {
  const { request, proposal } = input;
  if (proposal.projectId !== request.projectId
    || proposal.revision !== request.expectedProposalRevision
    || proposal.canonContext.canonContextId !== request.expectedCanonContextId) {
    throw new CharacterAgentError("CHARACTER_PROPOSAL_REJECTION_STALE", "候選版本已更新，無法放棄。");
  }
  if (proposal.status === "ACCEPTED") {
    throw new CharacterAgentError("CHARACTER_PROPOSAL_ALREADY_ACCEPTED", "已核准候選不能再放棄。");
  }
  const now = new Date().toISOString();
  const rejected: CharacterProposalEnvelope = {
    ...proposal,
    status: "REJECTED",
    parentRevision: proposal.revision,
    revision: proposal.revision + 1,
    updatedAt: now,
  };
  const auditRecord = makeCharacterAgentRecord(request.projectId, "system");
  const audit: CharacterAgentAuditEvent = {
    ...auditRecord,
    id: auditRecord.id,
    auditEventId: auditRecord.id,
    eventType: "PROPOSAL_REJECTED",
    proposalId: proposal.proposalId,
    approvalId: null,
    canonContextId: proposal.canonContext.canonContextId,
    actor: request.rejectedBy,
    affectedEntityIds: [proposal.proposalId],
    decisionSummary: "使用者放棄角色候選；Canonical mutation = 0。",
    sourceReferenceIds: proposal.sourceEntityIds,
  };
  return { proposal: rejected, audit };
}
