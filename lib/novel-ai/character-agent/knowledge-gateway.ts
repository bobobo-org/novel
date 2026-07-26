import { canAccessKnowledge } from "../drama-os/knowledge-scope";
import { CharacterAgentError } from "./errors";
import { sha256, stableStringify } from "./record-factory";
import { timelineAtOrBefore } from "./temporal-query";
import type {
  CharacterKnowledgeRecord,
  CharacterPerspectiveContext,
  CharacterPerspectiveContextKind,
  KnowledgeDenialReason,
} from "./types";

export type CharacterKnowledgeGatewayInput = {
  projectId: string;
  characterId: string;
  kind: CharacterPerspectiveContextKind;
  timelinePosition: string;
  records: CharacterKnowledgeRecord[];
  factionIdsAtTimeline?: string[];
  revealedConditionIds?: string[];
  evaluatorAuthorized?: boolean;
  now?: string;
  canonContextId: string;
  sourceCanonContextId?: string | null;
};

function actorDecision(
  record: CharacterKnowledgeRecord,
  input: CharacterKnowledgeGatewayInput,
): { allowed: true; reason: "PUBLIC" | "AUTHORIZED" | "REVEAL_MET" } | { allowed: false; reason: KnowledgeDenialReason } {
  if (record.projectId !== input.projectId) return { allowed: false, reason: "PROJECT_SCOPE_MISMATCH" };
  if (record.canonContextId !== input.canonContextId && record.canonContextId !== input.sourceCanonContextId) {
    return { allowed: false, reason: "CANON_CONTEXT_MISMATCH" };
  }
  if (!timelineAtOrBefore(record.usableAfterTimelinePosition, input.timelinePosition)) {
    return { allowed: false, reason: "NOT_YET_AVAILABLE_AT_TIMELINE" };
  }
  if (record.status !== "CURRENT" || (record.expiresAt && Date.parse(record.expiresAt) <= Date.parse(input.now ?? new Date().toISOString()))) {
    return { allowed: false, reason: "EXPIRED" };
  }
  switch (record.scope) {
    case "PUBLIC":
      return { allowed: true, reason: "PUBLIC" };
    case "AUTHOR_ONLY":
      return { allowed: false, reason: "AUTHOR_ONLY" };
    case "CHARACTER_KNOWN":
      return canAccessKnowledge(
        { scope: record.scope, characterIds: record.authorizedCharacterIds },
        { characterId: input.characterId },
      )
        ? { allowed: true, reason: "AUTHORIZED" }
        : { allowed: false, reason: "CHARACTER_NOT_AUTHORIZED" };
    case "FACTION_KNOWN":
      return canAccessKnowledge(
        { scope: record.scope, factionIds: record.authorizedFactionIds },
        { characterId: input.characterId, factionIds: input.factionIdsAtTimeline ?? [] },
      )
        ? { allowed: true, reason: "AUTHORIZED" }
        : { allowed: false, reason: "FACTION_NOT_AUTHORIZED_AT_TIMELINE" };
    case "READER_KNOWN":
      return { allowed: false, reason: "READER_KNOWLEDGE_IS_NOT_CHARACTER_KNOWLEDGE" };
    case "FUTURE_REVEAL":
      return record.revealConditionId && (input.revealedConditionIds ?? []).includes(record.revealConditionId)
        ? { allowed: true, reason: "REVEAL_MET" }
        : { allowed: false, reason: "FUTURE_REVEAL_NOT_MET" };
  }
}

export async function buildKnowledgeScopedContext(input: CharacterKnowledgeGatewayInput): Promise<CharacterPerspectiveContext> {
  if (input.kind === "EVALUATOR" && input.evaluatorAuthorized !== true) {
    throw new CharacterAgentError("EVALUATOR_CONTEXT_NOT_AUTHORIZED", "全局檢查上下文需要明確授權。");
  }
  const allowedKnowledgeIds: string[] = [];
  const deniedKnowledgeIds: string[] = [];
  const denialReasons: Record<string, KnowledgeDenialReason> = {};
  const sourceReferences = [];
  const visibilityTrace: CharacterPerspectiveContext["visibilityTrace"] = [];
  const informationFlowTrace: CharacterPerspectiveContext["informationFlowTrace"] = [];
  for (const record of input.records) {
    const decision = input.kind === "EVALUATOR"
      ? record.projectId === input.projectId
        && (record.canonContextId === input.canonContextId || record.canonContextId === input.sourceCanonContextId)
        && record.status === "CURRENT"
        ? { allowed: true as const, reason: "EVALUATOR_AUTHORIZED" as const }
        : { allowed: false as const, reason: (record.projectId === input.projectId ? "EXPIRED" : "PROJECT_SCOPE_MISMATCH") as KnowledgeDenialReason }
      : actorDecision(record, input);
    if (decision.allowed) {
      allowedKnowledgeIds.push(record.knowledgeId);
      sourceReferences.push(...record.sourceReferences);
    } else {
      deniedKnowledgeIds.push(record.knowledgeId);
      denialReasons[record.knowledgeId] = decision.reason;
    }
    visibilityTrace.push({
      knowledgeId: record.knowledgeId,
      scope: record.scope,
      decision: decision.allowed ? "ALLOW" : "DENY",
      reason: decision.reason,
    });
    informationFlowTrace.push({
      inputEntityId: record.knowledgeId,
      sourceScope: record.scope,
      targetContext: input.kind,
      allowed: decision.allowed,
      reason: decision.reason,
      taintLabels: decision.allowed ? [] : ["DENIED_KNOWLEDGE", "EXTERNAL_TRANSFER_RESTRICTED", "TRAINING_EXCLUDED"],
      decisionHash: await sha256(stableStringify({
        inputEntityId: record.knowledgeId,
        sourceScope: record.scope,
        targetContext: input.kind,
        allowed: decision.allowed,
        reason: decision.reason,
      })),
    });
  }
  const scopeDecisionHash = await sha256(stableStringify({
    projectId: input.projectId,
    characterId: input.characterId,
    kind: input.kind,
    timelinePosition: input.timelinePosition,
    canonContextId: input.canonContextId,
    allowedKnowledgeIds,
    deniedKnowledgeIds,
    denialReasons,
  }));
  return {
    contextId: crypto.randomUUID(),
    projectId: input.projectId,
    characterId: input.characterId,
    kind: input.kind,
    timelinePosition: input.timelinePosition,
    allowedKnowledgeIds,
    deniedKnowledgeIds,
    denialReasons,
    sourceReferences,
    visibilityTrace,
    scopeDecisionHash,
    informationFlowTrace,
  };
}

export function selectAllowedKnowledge(
  context: CharacterPerspectiveContext,
  records: CharacterKnowledgeRecord[],
) {
  const allowed = new Set(context.allowedKnowledgeIds);
  return records.filter((record) => record.projectId === context.projectId && allowed.has(record.knowledgeId));
}

export function assertNoKnowledgeLeak(
  actorContext: CharacterPerspectiveContext,
  usedKnowledgeIds: string[],
) {
  const allowed = new Set(actorContext.allowedKnowledgeIds);
  const leakedKnowledgeIds = [...new Set(usedKnowledgeIds.filter((id) => !allowed.has(id)))];
  if (leakedKnowledgeIds.length) {
    throw new CharacterAgentError("CHARACTER_KNOWLEDGE_LEAK_BLOCKED", "角色候選使用了目前無權得知的資訊。");
  }
  return { leakedKnowledgeIds: [], blockedKnowledgeIds: [...actorContext.deniedKnowledgeIds], status: "PASS" as const };
}
