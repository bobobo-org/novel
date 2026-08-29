import { analyzeNarrative, assertEvidenceSpans, validateProjectionInput } from "./narrative-analyzer";
import { buildBranchCandidate } from "./branch-director";
import { evaluateDramaProject } from "./drama-evaluator";
import { DramaOsError, throwIfCancelled } from "./errors";
import { getDramaFormatProfile } from "./format-profiles";
import { sha256, stableStringify } from "./ids";
import { planEpisodes } from "./episode-planner";
import { makeDramaRecord } from "./record-factory";
import { planScenes } from "./scene-planner";
import { findStaleUpstreamReferenceIds } from "./upstream-references";
import type {
  DramaCandidateStatus,
  DramaProject,
  DramaProjectionInput,
  DramaProjectionPackage,
  DramaSeason,
  NarrativeCanonLink,
} from "./types";

function validateRevisions(input: DramaProjectionInput): void {
  if (input.currentStoryRevision !== undefined && input.currentStoryRevision !== input.sourceRevision) {
    throw new DramaOsError("DRAMA_SOURCE_REVISION_STALE", "小說內容已更新，請重新建立短劇候選。");
  }
  if (input.currentStoryBibleVersion !== undefined && input.currentStoryBibleVersion !== input.storyBibleVersion) {
    throw new DramaOsError("DRAMA_STORY_BIBLE_STALE", "角色與世界設定已更新，請重新建立短劇候選。");
  }
}

export async function projectNovelToDrama(input: DramaProjectionInput): Promise<DramaProjectionPackage> {
  const startedAt = Date.now();
  validateProjectionInput(input);
  validateRevisions(input);
  throwIfCancelled(input.signal);
  const profile = getDramaFormatProfile(input.formatProfile);
  const analysis = analyzeNarrative(input);
  assertEvidenceSpans(input, [
    ...analysis.primaryProtagonist.sourceReferences,
    ...analysis.majorEvents.sourceReferences,
    ...analysis.stakes.sourceReferences,
  ]);

  const projectRecord = makeDramaRecord(input.storyId, input.providerId, input.requestId);
  const seasonRecord = makeDramaRecord(input.storyId, input.providerId, input.requestId);
  const { episodes: plannedEpisodes, beats } = planEpisodes(input, seasonRecord.id, analysis);
  const plannedScenes = planScenes(input, plannedEpisodes, beats, analysis);
  const plannedBranchCandidates = plannedEpisodes.map((episode) => buildBranchCandidate(input, episode, analysis));
  const staleReferenceIds = findStaleUpstreamReferenceIds(input, input.currentReferenceRevisions);
  const status: DramaCandidateStatus = input.mode === "private_simulation"
    ? "private_simulation"
    : staleReferenceIds.length
      ? "stale"
      : "awaiting_approval";
  const episodes = plannedEpisodes.map((episode) => ({ ...episode, status }));
  const scenes = plannedScenes.map((scene) => ({ ...scene, status }));
  const branchCandidates = plannedBranchCandidates.map((branch) => ({ ...branch, status }));
  const outputHash = await sha256(stableStringify({
    profile,
    analysis,
    episodes,
    scenes,
    beats,
    branchCandidates,
  }));
  const trace = {
    storyId: input.storyId,
    sourceRevision: input.sourceRevision,
    sourceChapterIds: input.chapters.map((chapter) => chapter.id),
    sourceChunkIds: input.sourceChunkIds,
    storyBibleVersion: input.storyBibleVersion,
    retrievalTraceId: input.retrievalTraceId,
    contextCompositionId: input.contextCompositionId,
    providerRunId: input.providerRunId,
    providerId: input.providerId,
    promptHash: input.promptHash,
    outputHash,
    taintTraceId: `taint:${input.requestId}`,
  };
  const project: DramaProject = {
    ...projectRecord,
    id: projectRecord.id,
    dramaProjectId: projectRecord.id,
    dramaOsSchemaVersion: "drama-os-v1",
    storyId: input.storyId,
    sourceStoryRevision: input.sourceRevision,
    sourceStoryBibleVersion: input.storyBibleVersion,
    title: `${input.storyTitle}：${profile.targetDurationSeconds < 600 ? "短劇" : "戲劇"}改編候選`,
    formatProfile: profile.id,
    seasonIds: [seasonRecord.id],
    canonicalAdaptationRevision: 0,
    status,
    projectionTrace: trace,
    ...(input.creationPreferenceRef ? { creationPreferenceRef: input.creationPreferenceRef } : {}),
    ...(input.storyBlueprintRef ? { storyBlueprintRef: input.storyBlueprintRef } : {}),
    ...(input.worldStateRefs ? { worldStateRefs: input.worldStateRefs } : {}),
    ...(input.characterStateRefs ? { characterStateRefs: input.characterStateRefs } : {}),
    ...(input.narrativePlanRef ? { narrativePlanRef: input.narrativePlanRef } : {}),
  };
  const season: DramaSeason = {
    ...seasonRecord,
    id: seasonRecord.id,
    seasonId: seasonRecord.id,
    dramaProjectId: project.dramaProjectId,
    seasonNumber: 1,
    sourceChapterIds: input.chapters.map((chapter) => chapter.id),
    episodeIds: episodes.map((episode) => episode.episodeId),
    seasonGoal: analysis.characterGoals.value ? Object.values(analysis.characterGoals.value)[0] ?? "完成核心角色弧線" : "完成核心角色弧線",
    mainConflict: analysis.stakes.value?.[0] ?? "角色必須為選擇付出代價。",
    characterArcs: Object.fromEntries(input.characters.map((character) => [character.id, `${character.name}從被動回應轉為主動選擇。`])),
    openingPromise: episodes[0].openingHook.text,
    midpointShift: episodes[Math.floor(episodes.length / 2)].turningPoint,
    finalPayoff: episodes.at(-1)!.payoff.payoff,
    endingHook: episodes.at(-1)!.cliffhanger.text,
    status,
  };
  const canonRecord = makeDramaRecord(input.storyId, input.providerId, input.requestId);
  const canonLink: NarrativeCanonLink = {
    ...canonRecord,
    id: canonRecord.id,
    canonLinkId: canonRecord.id,
    dramaProjectId: project.dramaProjectId,
    sourceStoryRevision: input.sourceRevision,
    sourceStoryBibleVersion: input.storyBibleVersion,
    dramaAdaptationRevision: 0,
    sourceChapterIds: input.chapters.map((chapter) => chapter.id),
    episodeIds: episodes.map((episode) => episode.episodeId),
    projectionStatus: staleReferenceIds.length ? "stale" : "current",
    staleReason: staleReferenceIds.length
      ? `UPSTREAM_REFERENCE_REVISION_STALE:${staleReferenceIds.join(",")}`
      : null,
    approvedBy: null,
    approvedAt: null,
  };
  const evaluation = evaluateDramaProject(input, project.dramaProjectId, episodes, beats, analysis);
  throwIfCancelled(input.signal);
  if (Date.now() - startedAt > (input.resourceBudget?.timeoutMs ?? 30_000)) {
    throw new DramaOsError("DRAMA_PROVIDER_TIMEOUT", "短劇規劃超過本次時間上限。");
  }
  return {
    project,
    seasons: [season],
    episodes,
    scenes,
    beats,
    branchCandidates,
    evaluations: [evaluation],
    canonLinks: [canonLink],
    analysis,
    canonicalMutation: 0,
  };
}
