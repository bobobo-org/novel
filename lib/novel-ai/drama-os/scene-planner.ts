import { adaptDialogue } from "./dialogue-adapter";
import { getDramaFormatProfile } from "./format-profiles";
import { makeDramaRecord } from "./record-factory";
import { createNovelToVideoDirectorPackage } from "../media-extension/director-doctrine";
import type { DramaBeat, DramaEpisode, DramaProjectionInput, DramaScene, NarrativeAnalysis } from "./types";

export function planScenes(
  input: DramaProjectionInput,
  episodes: DramaEpisode[],
  beats: DramaBeat[],
  analysis: NarrativeAnalysis,
): DramaScene[] {
  const profile = getDramaFormatProfile(input.formatProfile);
  const totalSceneBudget = Math.min(
    input.resourceBudget?.maxScenes ?? 48,
    profile.maximumSceneCount * episodes.length,
  );
  const scenes: DramaScene[] = [];
  for (const [episodeIndex, episode] of episodes.entries()) {
    if (scenes.length >= totalSceneBudget) break;
    const episodeBeats = beats.filter((beat) => beat.episodeId === episode.episodeId);
    const remainingBudget = totalSceneBudget - scenes.length;
    const remainingEpisodes = episodes.length - episodeIndex;
    const fairEpisodeBudget = Math.max(1, Math.floor(remainingBudget / Math.max(1, remainingEpisodes)));
    const sceneCount = Math.max(1, Math.min(profile.maximumSceneCount, episodeBeats.length, fairEpisodeBudget));
    for (let index = 0; index < sceneCount; index += 1) {
      const record = makeDramaRecord(input.storyId, input.providerId, input.requestId);
      const beatStart = Math.floor((index * episodeBeats.length) / sceneCount);
      const beatEnd = Math.floor(((index + 1) * episodeBeats.length) / sceneCount);
      const sceneBeats = episodeBeats.slice(beatStart, Math.max(beatStart + 1, beatEnd));
      const event = analysis.majorEvents.value?.[index % Math.max(1, analysis.majorEvents.value.length)] ?? episode.turningPoint;
      const location = input.characters.find((character) => character.locationId)?.locationId ?? null;
      const participatingCharacterIds = input.characters
        .slice(0, Math.max(1, Math.min(3, input.characters.length)))
        .map((character) => character.id);
      const sceneGoal = `把「${event}」轉成角色可見的行動。`;
      const storyFunction = sceneBeats.map((beat) => beat.beatType).join(" → ");
      const dialogueBlocks = adaptDialogue(input, analysis, sceneGoal);
      const continuityNotes = episode.continuityConstraints.map((constraint) => constraint.description);
      const baseAction = index === 0
        ? `先讓「${event}」以正在發生的異常或立即代價進入畫面，角色必須當場回應。`
        : `讓角色為「${event}」完成一個改變局面的主動作，並讓另一人以可見反應承受後果。`;
      const directorPackage = createNovelToVideoDirectorPackage({
        shotIndex: scenes.length,
        totalShots: totalSceneBudget,
        sceneGoal,
        conflict: episode.majorConflict,
        visualAction: baseAction,
        storyFunction,
        characterRefIds: participatingCharacterIds,
        locationId: location,
        continuityNotes,
        dialogueOrAudioCue: dialogueBlocks.map((block) => block.line).join("\n"),
      });
      const scene: DramaScene = {
        ...record,
        id: record.id,
        sceneId: record.id,
        episodeId: episode.episodeId,
        sceneNumber: index + 1,
        locationId: location,
        timelinePosition: input.timeline[index]?.storyTime ?? null,
        participatingCharacterIds,
        pointOfViewCharacterId: input.characters[0]?.id ?? null,
        sceneGoal,
        conflict: episode.majorConflict,
        visualAction: [
          baseAction,
          directorPackage.spatialBlocking[0],
          directorPackage.performanceDirection[0],
        ].join(" "),
        dialogueBlocks,
        emotionStart: sceneBeats[0]?.intensity ?? 35,
        emotionEnd: sceneBeats.at(-1)?.intensity ?? 65,
        storyFunction,
        sourceReferences: sceneBeats.flatMap((beat) => beat.sourceReferences),
        continuityConstraints: episode.continuityConstraints,
        status: input.mode === "private_simulation" ? "private_simulation" : "awaiting_approval",
      };
      scenes.push(scene);
      for (const beat of sceneBeats) beat.sceneId = scene.sceneId;
      episode.sceneIds.push(scene.sceneId);
    }
  }
  return scenes;
}
