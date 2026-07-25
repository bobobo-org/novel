import type { ContinuityConstraint, DramaProjectionInput, NarrativeAnalysis } from "./types";

export function buildContinuityConstraints(input: DramaProjectionInput, analysis: NarrativeAnalysis): ContinuityConstraint[] {
  const constraints: ContinuityConstraint[] = [];
  for (const character of input.characters) {
    if (character.lifeStatus === "dead" && input.chapters.some((chapter) => chapter.content.includes(character.name))) {
      constraints.push({
        kind: "character",
        description: `${character.name}已標記死亡；若在改編中行動，必須有回憶、幻覺或復生規則證據。`,
        sourceReferenceIds: analysis.primaryProtagonist.sourceReferences.map((reference) => `${reference.chapterId}:${reference.textStart}`),
        severity: "blocking",
      });
    }
  }
  for (const rule of input.worldRules.filter((value) => value.immutable)) {
    constraints.push({
      kind: "world_rule",
      description: `不可違反固定世界規則「${rule.title}」。`,
      sourceReferenceIds: [],
      severity: "info",
    });
  }
  for (const issue of input.storyBible.forbiddenContradictions) {
    constraints.push({ kind: "source", description: issue, sourceReferenceIds: [], severity: "blocking" });
  }
  return constraints;
}
