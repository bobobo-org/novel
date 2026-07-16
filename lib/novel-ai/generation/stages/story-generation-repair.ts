import type { StoryStageGenerationOutput } from "./story-stage-context";

function stripFence(text: string) {
  return text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

export function repairStoryGenerationOutput(raw: string, meta: { provider: string; model: string }): StoryStageGenerationOutput {
  const cleaned = stripFence(raw);
  let parsed: Partial<StoryStageGenerationOutput> | undefined;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0].replace(/,\s*([}\]])/g, "$1")); } catch { parsed = undefined; }
    }
  }
  const draftText = typeof parsed?.draftText === "string" && parsed.draftText.trim() ? parsed.draftText.trim() : cleaned.trim();
  const output: StoryStageGenerationOutput = {
    draftText,
    stageSummary: typeof parsed?.stageSummary === "string" && parsed.stageSummary.trim() ? parsed.stageSummary.trim() : draftText.slice(0, 160),
    continuityChanges: typeof parsed?.continuityChanges === "object" && parsed.continuityChanges && !Array.isArray(parsed.continuityChanges) ? parsed.continuityChanges : {},
    characterStateChanges: Array.isArray(parsed?.characterStateChanges) ? parsed!.characterStateChanges : [],
    relationshipChanges: Array.isArray(parsed?.relationshipChanges) ? parsed!.relationshipChanges : [],
    plotProgress: typeof parsed?.plotProgress === "string" ? parsed.plotProgress : "stage-progress",
    newlyIntroducedFacts: Array.isArray(parsed?.newlyIntroducedFacts) ? parsed!.newlyIntroducedFacts : [],
    possibleCandidates: Array.isArray(parsed?.possibleCandidates) ? parsed!.possibleCandidates : [],
    unresolvedActions: Array.isArray(parsed?.unresolvedActions) ? parsed!.unresolvedActions.map(String) : [],
    nextStageRequirements: Array.isArray(parsed?.nextStageRequirements) ? parsed!.nextStageRequirements.map(String) : [],
    warnings: Array.isArray(parsed?.warnings) ? parsed!.warnings.map(String) : parsed ? [] : ["LOCAL_JSON_REPAIR_WRAPPED_RAW_TEXT"],
    usedContextIds: Array.isArray(parsed?.usedContextIds) ? parsed!.usedContextIds.map(String) : [],
    provider: meta.provider,
    model: meta.model,
    externalRequestCount: 0,
    dataLeftDevice: false,
  };
  return output;
}
