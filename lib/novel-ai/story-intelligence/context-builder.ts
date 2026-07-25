import { rankMemories } from "./memory-ranker";
import { applyTokenBudget, estimateTokens } from "./token-budgeter";
import { KNOWLEDGE_AUTHORITY_ORDER, sanitizeRetrievedKnowledge } from "../security";
import {
  P22_STORY_INTELLIGENCE_VERSION,
  type RankedMemory,
  type StoryAccessScope,
  type StoryContext,
  type TraceableMemory,
} from "./types";

function uniqueSources(memories: RankedMemory[]) {
  const seen = new Set<string>();
  return memories.map((memory) => memory.source).filter((source) => {
    const key = `${source.sourceChapterId}:${source.sourceRevision}:${source.start}:${source.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function group(memories: RankedMemory[], kinds: TraceableMemory["kind"][]) {
  return memories.filter((memory) => kinds.includes(memory.kind));
}

export function filterMemoriesByAccessScope(memories: TraceableMemory[], scope: StoryAccessScope) {
  return memories.filter((memory) => {
    const metadata = memory.metadata;
    if (metadata.deleted || metadata.projectId !== scope.projectId) return false;
    if (metadata.userId && metadata.userId !== scope.userId) return false;
    if (metadata.workspaceId && metadata.workspaceId !== scope.workspaceId) return false;
    if (metadata.storyId && metadata.storyId !== scope.storyId) return false;
    if (metadata.adultNamespace && metadata.adultNamespace !== scope.adultNamespace) return false;
    if (metadata.branchId && !scope.approvedBranchIds.includes(metadata.branchId)) return false;
    return true;
  });
}

function sanitizeMemories(memories: TraceableMemory[]) {
  return memories.map<TraceableMemory>((memory) => {
    const sourceType = memory.metadata.sourceType
      ?? (memory.metadata.canonical ? "story_content" : "retrieved_knowledge");
    const isTrusted = sourceType === "system"
      || sourceType === "user_task"
      || sourceType === "story_bible"
      || memory.metadata.canonical === true;
    const boundary = sanitizeRetrievedKnowledge(memory.text, {
      sourceId: memory.metadata.sourceId ?? memory.memoryId,
      sourceRevision: memory.metadata.sourceRevision ?? memory.source.sourceRevision,
      sourceType: isTrusted ? "story_canonical" : "unknown",
      storyId: memory.metadata.storyId ?? memory.metadata.projectId,
      storyRevision: memory.metadata.storyRevision ?? memory.source.sourceRevision,
    });
    const detectedSignals = isTrusted ? [] : boundary.detectedInjectionSignals;
    const text = isTrusted ? memory.text : boundary.sanitizedText;
    return {
      ...memory,
      text,
      metadata: {
        ...memory.metadata,
        trustedLevel: memory.metadata.trustedLevel
          ?? (sourceType === "system"
            ? "system_defined"
            : sourceType === "user_task"
              ? "user_approved"
              : memory.metadata.canonical
                ? "story_canonical"
                : "untrusted"),
        sourceType,
        sourceId: memory.metadata.sourceId ?? memory.memoryId,
        sourceRevision: memory.metadata.sourceRevision ?? memory.source.sourceRevision,
        sanitizationStatus: isTrusted ? "unchanged" : boundary.sanitizationStatus,
        detectedInjectionSignals: detectedSignals,
        allowedUsage: isTrusted
          ? (["citation", "retrieval_context", "semantic_reference", "constraint"] as const)
          : (["citation", "retrieval_context", "semantic_reference"] as const),
        blockedUsage: isTrusted ? [] : boundary.blockedUsage,
        securityLabels: [...new Set([
          ...(memory.metadata.securityLabels ?? []),
          ...detectedSignals,
          ...(isTrusted ? [] : ["UNTRUSTED_DOCUMENT"]),
        ])],
      },
    };
  });
}

export function buildStoryContext(input: {
  task: string;
  authorInstruction: string;
  memories: TraceableMemory[];
  constraints?: string[];
  styleProfile?: string[];
  tokenLimit?: number;
  reservedOutput?: number;
  accessScope?: StoryAccessScope;
}): StoryContext {
  const scoped = input.accessScope
    ? filterMemoriesByAccessScope(input.memories, input.accessScope)
    : input.memories;
  const sanitized = sanitizeMemories(scoped);
  const ranked = rankMemories(
    `${input.task} ${input.authorInstruction}`,
    sanitized,
  );
  const fixedTokens = estimateTokens([
    input.task,
    input.authorInstruction,
    ...(input.constraints ?? []),
    ...(input.styleProfile ?? []),
  ].join("\n"));
  const { selected, budget } = applyTokenBudget(ranked, {
    limit: input.tokenLimit ?? 8192,
    reservedOutput: input.reservedOutput ?? 1800,
    fixedTokens,
  });
  return {
    schemaVersion: P22_STORY_INTELLIGENCE_VERSION,
    task: `${input.task}\n${input.authorInstruction}`.trim(),
    currentScene: group(selected, ["current_scene"]),
    recentContext: group(selected, ["recent_chapter", "accepted_choice"]),
    characterContext: group(selected, ["character", "relationship"]),
    worldContext: group(selected, ["world_rule"]),
    plotContext: group(selected, ["event", "plot_thread", "note"]),
    foreshadowingContext: group(selected, ["foreshadowing"]),
    constraints: input.constraints ?? [],
    styleProfile: input.styleProfile ?? [],
    tokenBudget: budget,
    sourceReferences: uniqueSources(selected),
    trustBoundary: {
      authorityOrder: KNOWLEDGE_AUTHORITY_ORDER,
      quarantinedMemoryIds: sanitized
        .filter((memory) => memory.metadata.sanitizationStatus === "quarantined")
        .map((memory) => memory.memoryId),
      sanitizedMemoryIds: sanitized
        .filter((memory) => memory.metadata.sanitizationStatus === "sanitized")
        .map((memory) => memory.memoryId),
      untrustedMemoryIds: sanitized
        .filter((memory) => memory.metadata.trustedLevel === "untrusted")
        .map((memory) => memory.memoryId),
    },
  };
}
