import { CharacterAgentError } from "./errors";
import { clampScore, makeCharacterAgentRecord } from "./record-factory";
import type {
  CharacterCanonContext,
  CharacterRelationshipEdge,
  CharacterRelationshipEvent,
  CharacterRelationshipEventType,
  CharacterSourceReference,
  RelationshipMetrics,
} from "./types";

const METRICS: Array<keyof RelationshipMetrics> = [
  "trust", "affection", "attraction", "fear", "resentment",
  "loyalty", "debt", "dependency", "conflict", "powerBalance",
];
const MAJOR_EVENTS = new Set<CharacterRelationshipEventType>(["BETRAYAL", "RESCUE", "RELATIONSHIP_BREAK", "SECRET_DISCOVERED"]);

export function emptyRelationshipMetrics(): RelationshipMetrics {
  return { trust: 0, affection: 0, attraction: 0, fear: 0, resentment: 0, loyalty: 0, debt: 0, dependency: 0, conflict: 0, powerBalance: 0 };
}

export function createCharacterRelationshipEdge(input: {
  canonContext: CharacterCanonContext;
  fromCharacterId: string;
  toCharacterId: string;
  relationshipTypes: string[];
  metrics?: Partial<RelationshipMetrics>;
  publicStatus?: string;
  privateStatus?: string;
  knownByCharacterIds?: string[];
  sourceReferences: CharacterSourceReference[];
}): CharacterRelationshipEdge {
  if (input.fromCharacterId === input.toCharacterId) throw new CharacterAgentError("RELATIONSHIP_SELF_EDGE_BLOCKED", "關係邊必須連接兩個不同角色。");
  const record = makeCharacterAgentRecord(input.canonContext.projectId, "user");
  const values = Object.fromEntries(METRICS.map((key) => [key, clampScore(input.metrics?.[key] ?? 0)])) as unknown as RelationshipMetrics;
  return {
    ...record,
    ...values,
    id: record.id,
    relationshipId: record.id,
    canonContextId: input.canonContext.canonContextId,
    fromCharacterId: input.fromCharacterId,
    toCharacterId: input.toCharacterId,
    relationshipTypes: [...new Set(input.relationshipTypes)],
    publicStatus: input.publicStatus ?? "尚未公開定義",
    privateStatus: input.privateStatus ?? "尚未建立私人判斷",
    knownByCharacterIds: [...new Set(input.knownByCharacterIds ?? [input.fromCharacterId])],
    sourceReferences: [...input.sourceReferences],
    effectiveFromTimelinePosition: input.canonContext.timelinePosition,
    effectiveToTimelinePosition: null,
  };
}

export function createRelationshipEventCandidate(input: {
  edge: CharacterRelationshipEdge;
  canonContext: CharacterCanonContext;
  idempotencyKey: string;
  sourceEventId: string;
  sourceChapterId?: string | null;
  sourceSceneId?: string | null;
  timelinePosition: string;
  eventType: CharacterRelationshipEventType;
  requestedDelta: Partial<RelationshipMetrics>;
  cause: string;
  evidence: CharacterSourceReference[];
  evaluatorReason?: string;
}): { event: CharacterRelationshipEvent; projectedEdge: CharacterRelationshipEdge } {
  if (input.edge.canonContextId !== input.canonContext.canonContextId) throw new CharacterAgentError("STALE_RELATIONSHIP_REVISION", "關係資料不屬於目前 Canon Context。");
  if (!input.idempotencyKey || !input.sourceEventId || !input.cause.trim() || !input.evidence.length) {
    throw new CharacterAgentError("EVIDENCE_FREE_RELATIONSHIP_CHANGE", "關係變化必須有來源事件、原因與證據。");
  }
  const maximumAllowedDelta = MAJOR_EVENTS.has(input.eventType) ? 35 : 12;
  if (MAJOR_EVENTS.has(input.eventType) && !input.evaluatorReason?.trim()) {
    throw new CharacterAgentError("MAJOR_RELATIONSHIP_EVALUATOR_REASON_REQUIRED", "重大關係變化需要 Evaluator 理由。");
  }
  const delta = Object.fromEntries(METRICS
    .filter((key) => input.requestedDelta[key] !== undefined)
    .map((key) => [key, clampScore(input.requestedDelta[key] ?? 0, -maximumAllowedDelta, maximumAllowedDelta)])) as Partial<RelationshipMetrics>;
  const afterSnapshot = Object.fromEntries(METRICS.map((key) => [
    key,
    clampScore(input.edge[key] + (delta[key] ?? 0)),
  ])) as RelationshipMetrics;
  const record = makeCharacterAgentRecord(input.edge.projectId, "ai_candidate");
  const event: CharacterRelationshipEvent = {
    ...record,
    id: record.id,
    eventId: record.id,
    relationshipId: input.edge.relationshipId,
    canonContextId: input.canonContext.canonContextId,
    sourceChapterId: input.sourceChapterId ?? null,
    sourceSceneId: input.sourceSceneId ?? null,
    timelinePosition: input.timelinePosition,
    eventType: input.eventType,
    beforeSnapshot: Object.fromEntries(METRICS.map((key) => [key, input.edge[key]])) as RelationshipMetrics,
    delta,
    afterSnapshot,
    cause: input.cause,
    evidence: [...input.evidence],
    status: "CANDIDATE",
    idempotencyKey: input.idempotencyKey,
    idempotencyScope: `${input.edge.projectId}:${input.edge.relationshipId}:${input.idempotencyKey}`,
    sourceEventId: input.sourceEventId,
    sourceEventScope: `${input.edge.projectId}:${input.edge.relationshipId}:${input.sourceEventId}`,
    beforeRevision: input.edge.revision,
    afterRevision: input.edge.revision + 1,
    deltaReason: input.evaluatorReason?.trim() || input.cause,
    evidenceIds: input.evidence.map((item) => item.referenceId),
    maximumAllowedDelta,
    requiresApproval: true,
    canonicalImpact: 0,
    freshnessStatus: "CURRENT",
  };
  return {
    event,
    projectedEdge: {
      ...input.edge,
      ...afterSnapshot,
      parentRevision: input.edge.revision,
      revision: input.edge.revision + 1,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function assertRelationshipEventUnique(
  events: CharacterRelationshipEvent[],
  candidate: CharacterRelationshipEvent,
) {
  const duplicate = events.find((event) =>
    event.projectId === candidate.projectId
    && event.relationshipId === candidate.relationshipId
    && (event.idempotencyKey === candidate.idempotencyKey || event.sourceEventId === candidate.sourceEventId));
  if (duplicate) {
    if (
      duplicate.sourceEventId !== candidate.sourceEventId
      || JSON.stringify(duplicate.delta) !== JSON.stringify(candidate.delta)
    ) throw new CharacterAgentError("RELATIONSHIP_IDEMPOTENCY_PAYLOAD_MISMATCH", "相同關係事件 key 的內容不一致。");
    return duplicate;
  }
  return null;
}
