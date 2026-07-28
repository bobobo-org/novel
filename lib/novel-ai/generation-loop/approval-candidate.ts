import { makeRecord, type ChoiceCandidate, type StoryChoiceEffect } from "../domain";
import type { GenerationCandidate } from "./types";

const EMPTY_EFFECT: StoryChoiceEffect = {
  statChanges: {},
  relationshipChanges: {},
  resourceChanges: {},
  moneyChange: 0,
  worldFlags: {},
  questProgress: {},
  achievementProgress: {},
  timelineEvents: [],
};

const OPTION_BY_INTENT = {
  steady_continuation: "A",
  conflict_escalation: "B",
  unexpected_turn: "C",
} as const;

export function packageGenerationCandidateForApproval(input: {
  candidate: GenerationCandidate;
  chapterId: string;
  chapterRevision: number;
  storyStateRevision: number;
  storyBibleRevision: number;
  effect?: StoryChoiceEffect;
}): ChoiceCandidate {
  if (input.candidate.status !== "awaiting_approval") {
    throw Object.assign(new Error("未通過品質門檻的候選不能送入核准流程。"), { code: "GENERATION_CANDIDATE_NOT_APPROVABLE" });
  }
  const record = makeRecord(input.candidate.projectId, "ai_candidate");
  return {
    ...record,
    id: input.candidate.candidateId,
    provenance: {
      ...record.provenance,
      actor: input.candidate.provider === "local-ollama" ? "local-ollama" : input.candidate.provider === "browser-ai" ? "browser-ai" : input.candidate.provider === "private-ai-hub" ? "private-ai-hub" : "local-rule",
      providerId: input.candidate.provider,
      modelId: input.candidate.model,
      taskType: input.candidate.taskType,
      externalRequest: false,
      dataLeftDevice: false,
      contextSources: input.candidate.retrievedMemory.sourceReferences.map((source) => `${source.sourceChapterId}@${source.sourceRevision}:${source.start}-${source.end}`),
      elapsedMs: input.candidate.latency,
      requestId: input.candidate.requestId,
    },
    prompt: input.candidate.retrievedMemory.task,
    optionKey: OPTION_BY_INTENT[input.candidate.intent],
    text: input.candidate.finalCandidate,
    consequence: input.candidate.revisionNotes.join("；"),
    effect: input.effect ?? EMPTY_EFFECT,
    status: "pending",
    chapterId: input.chapterId,
    sceneId: null,
    inputRevision: input.candidate.storyRevision,
    chapterRevision: input.chapterRevision,
    storyStateRevision: input.storyStateRevision,
    storyBibleRevision: input.storyBibleRevision,
  };
}
