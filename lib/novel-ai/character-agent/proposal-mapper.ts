import type { CanonicalLayer } from "../drama-os/canon-layers";
import { makeCharacterAgentRecord } from "./record-factory";
import type {
  CharacterAgentEvaluation,
  CharacterApprovalEffects,
  CharacterCanonicalPatch,
  CharacterCanonContext,
  CharacterProposalEnvelope,
  CharacterProposalType,
  RelationshipMetrics,
} from "./types";

const EMPTY_EFFECTS: CharacterApprovalEffects = {
  stateUpdate: null,
  approvedMemories: [],
  relationshipEdge: null,
  relationshipEvent: null,
  knowledgeAcquisition: null,
  privateArcPromotion: null,
};

export function mapCharacterCandidateToProposal(input: {
  canonContext: CharacterCanonContext;
  proposalType: CharacterProposalType;
  characterIds: string[];
  sourceCharacterRevisions: Record<string, number>;
  sourceEntityIds: string[];
  generatedPayload: unknown;
  detectedChanges: string[];
  knowledgeScopeImpact?: string[];
  relationshipImpact?: Record<string, Partial<RelationshipMetrics>>;
  warnings?: string[];
  canonicalPatch: CharacterCanonicalPatch;
  evaluation: CharacterAgentEvaluation;
  approvalEffects?: Partial<CharacterApprovalEffects>;
}): CharacterProposalEnvelope {
  const record = makeCharacterAgentRecord(input.canonContext.projectId, "ai_candidate");
  const canonicalImpact: CanonicalLayer[] = [input.canonicalPatch.targetLayer];
  return {
    ...record,
    id: record.id,
    proposalId: record.id,
    proposalType: input.proposalType,
    projectId: input.canonContext.projectId,
    canonContext: structuredClone(input.canonContext),
    characterIds: [...new Set(input.characterIds)],
    sourceRevision: input.canonContext.novelRevision,
    sourceCharacterRevisions: { ...input.sourceCharacterRevisions },
    sourceStoryBibleVersion: input.canonContext.storyBibleVersion,
    sourceEntityIds: [...new Set(input.sourceEntityIds)],
    generatedPayload: structuredClone(input.generatedPayload),
    detectedChanges: [...new Set(input.detectedChanges)],
    knowledgeScopeImpact: [...new Set(input.knowledgeScopeImpact ?? [])],
    relationshipImpact: structuredClone(input.relationshipImpact ?? {}),
    storyBibleImpact: "NONE",
    canonicalImpact,
    canonicalPatch: structuredClone(input.canonicalPatch),
    warnings: [
      ...new Set([
        ...(input.warnings ?? []),
        ...(input.evaluation.blockingIssueCount ? ["發現阻擋性角色設定衝突，不能核准。"] : []),
      ]),
    ],
    status: "GENERATED",
    createdAt: record.createdAt,
    evaluationId: input.evaluation.evaluationId,
    freshnessStatus: "CURRENT",
    approvalEffects: {
      ...EMPTY_EFFECTS,
      ...(input.approvalEffects ?? {}),
      approvedMemories: [...(input.approvalEffects?.approvedMemories ?? [])],
    },
  };
}

export function proposalContainsRawReasoning(value: CharacterProposalEnvelope) {
  const serialized = JSON.stringify(value).toLocaleLowerCase();
  return [
    "chain-of-thought",
    "chain_of_thought",
    "hidden reasoning",
    "system prompt",
    "developer prompt",
    "raw prompt",
  ].some((needle) => serialized.includes(needle));
}
