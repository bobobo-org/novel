import type { StoryOutcomeParityResult, StoryOutcomeSnapshot } from "./story-version-types";

function missingFrom(source: string[], target: string[]) {
  const targetSet = new Set(target.map((value) => value.toLowerCase()));
  return source.filter((value) => !targetSet.has(value.toLowerCase()));
}

function changed(source: string, target: string) {
  if (!source || !target) return [];
  return source.trim().toLowerCase() === target.trim().toLowerCase() ? [] : [`sceneOutcome changed: ${source} -> ${target}`];
}

export function validateOutcomeParity(source: StoryOutcomeSnapshot, target: StoryOutcomeSnapshot): StoryOutcomeParityResult {
  const missingOutcomes = [
    ...missingFrom(source.requiredEvents, target.requiredEvents).map((item) => `requiredEvent:${item}`),
    ...missingFrom(source.characterChanges, target.characterChanges).map((item) => `characterChange:${item}`),
    ...missingFrom(source.relationshipChanges, target.relationshipChanges).map((item) => `relationshipChange:${item}`),
    ...missingFrom(source.plotConsequences, target.plotConsequences).map((item) => `plotConsequence:${item}`),
  ];
  const unsupportedFacts = missingFrom(source.canonicalFactsReferenced, target.canonicalFactsReferenced).map((item) => `canonicalFact:${item}`);
  const changedOutcomes = changed(source.sceneOutcome, target.sceneOutcome);
  const matchedOutcomes = [
    ...source.requiredEvents.filter((item) => !missingFrom([item], target.requiredEvents).length).map((item) => `requiredEvent:${item}`),
    ...source.plotConsequences.filter((item) => !missingFrom([item], target.plotConsequences).length).map((item) => `plotConsequence:${item}`),
  ];
  const severe = missingOutcomes.some((item) => item.startsWith("requiredEvent:")) || unsupportedFacts.length > 0;
  const parityStatus = severe ? "failed" : missingOutcomes.length || changedOutcomes.length ? "warning" : "passed";
  const severity = severe ? "major" : parityStatus === "warning" ? "minor" : "none";
  return {
    parityStatus,
    matchedOutcomes,
    missingOutcomes,
    changedOutcomes,
    unsupportedFacts,
    severity,
    recommendedFixes: [
      ...missingOutcomes.map((item) => `Restore ${item} in target version.`),
      ...unsupportedFacts.map((item) => `Keep referenced canonical fact: ${item}.`),
      ...changedOutcomes.map(() => "Align target scene outcome with source branch identity."),
    ],
  };
}

