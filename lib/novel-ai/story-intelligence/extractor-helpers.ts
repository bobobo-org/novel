import type { ChapterInput, IntelligenceEntityType, StoryIntelligenceCandidate } from "./types";
import { sourceFromMatch, stableId } from "./evidence";

export function candidate(input: {
  chapter: ChapterInput;
  entityType: IntelligenceEntityType;
  entityId: string;
  field: string;
  value: StoryIntelligenceCandidate["value"];
  start: number;
  end: number;
  confidence?: number;
  factType?: StoryIntelligenceCandidate["factType"];
  needsReview?: boolean;
  reasons?: string[];
}): StoryIntelligenceCandidate {
  const now = new Date().toISOString();
  const sources = [sourceFromMatch(input.chapter, input.start, input.end)];
  const factType = input.factType ?? "explicit";
  return {
    factId: stableId("fact", {
      chapterId: input.chapter.chapterId,
      revision: input.chapter.sourceRevision,
      entityType: input.entityType,
      entityId: input.entityId,
      field: input.field,
      value: input.value,
      source: sources[0],
    }),
    entityType: input.entityType,
    entityId: input.entityId,
    field: input.field,
    value: input.value,
    factType,
    sources,
    confidence: input.confidence ?? 0.9,
    createdAt: now,
    updatedAt: now,
    candidateStatus: input.needsReview || factType !== "explicit" ? "needs_review" : "validated_candidate",
    validationReasons: input.reasons ?? [],
  };
}

export function entitySlug(value: string) {
  return value.trim().toLocaleLowerCase("zh-TW").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "unknown";
}
