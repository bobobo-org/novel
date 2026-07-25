import { summarizeChapter } from "./chapter-summarizer";
import { extractCharacterStates } from "./character-state-extractor";
import { extractForeshadowing } from "./foreshadowing-extractor";
import { extractPlotThreads } from "./plot-thread-extractor";
import { extractRelationships } from "./relationship-extractor";
import { extractTimeline } from "./timeline-extractor";
import type { ChapterInput, ChapterIntelligence, StoryBibleIntelligence, StoryIntelligenceCandidate } from "./types";
import { P22_STORY_INTELLIGENCE_VERSION } from "./types";
import { validateSource } from "./evidence";
import { extractWorldRules } from "./world-rule-extractor";

function deduplicate(candidates: StoryIntelligenceCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = JSON.stringify([item.entityType, item.entityId, item.field, item.value, item.sources]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function analyzeChapter(chapter: ChapterInput): ChapterIntelligence {
  const candidates = deduplicate([
    ...extractCharacterStates(chapter),
    ...extractRelationships(chapter),
    ...extractWorldRules(chapter),
    ...extractTimeline(chapter),
    ...extractPlotThreads(chapter),
    ...extractForeshadowing(chapter),
  ]);
  const warnings: string[] = [];
  for (const item of candidates) {
    if (item.sources.some((source) => !validateSource(source, chapter))) {
      item.candidateStatus = "rejected";
      item.validationReasons.push("來源片段無法在原始章節中定位");
      warnings.push(`${item.factId}: invalid evidence`);
    }
  }
  return {
    schemaVersion: P22_STORY_INTELLIGENCE_VERSION,
    chapterId: chapter.chapterId,
    sourceRevision: chapter.sourceRevision,
    summary: summarizeChapter(chapter),
    candidates,
    warnings,
    createdAt: new Date().toISOString(),
  };
}

export function buildStoryBibleIntelligence(projectId: string, chapters: ChapterInput[]): StoryBibleIntelligence {
  const analyses = chapters.map(analyzeChapter);
  const acceptedFacts = analyses.flatMap((analysis) => analysis.candidates)
    .filter((candidate) => candidate.candidateStatus === "validated_candidate");
  const grouped = new Map<string, typeof acceptedFacts>();
  for (const fact of acceptedFacts) {
    const key = `${fact.entityType}:${fact.entityId}:${fact.field}`;
    grouped.set(key, [...(grouped.get(key) ?? []), fact]);
  }
  const facts = [...grouped.values()].flatMap((rows) => {
    const values = new Set(rows.map((row) => JSON.stringify(row.value)));
    if (values.size === 1) {
      const [first] = rows;
      return [{ ...first, sources: rows.flatMap((row) => row.sources), confidence: Math.max(...rows.map((row) => row.confidence)) }];
    }
    return rows.map((row) => ({ ...row, factType: "conflicted" as const, confidence: Math.min(row.confidence, 0.6) }));
  });
  return {
    schemaVersion: P22_STORY_INTELLIGENCE_VERSION,
    projectId,
    facts,
    chapterSummaries: analyses.map((analysis, index) => ({
      chapterId: analysis.chapterId,
      sourceRevision: analysis.sourceRevision,
      summary: analysis.summary,
      sources: [{
        sourceChapterId: analysis.chapterId,
        sourceRevision: analysis.sourceRevision,
        evidenceExcerpt: chapters[index].content,
        start: 0,
        end: chapters[index].content.length,
      }],
    })),
    forbiddenContradictions: facts
      .filter((fact) => fact.entityType === "world_rule" && fact.factType === "explicit")
      .map((fact) => String(fact.value)),
    updatedAt: new Date().toISOString(),
  };
}
