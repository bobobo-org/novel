import { adaptDialogue } from "./dialogue-adapter";
import { getDramaFormatProfile } from "./format-profiles";
import { makeDramaRecord } from "./record-factory";
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
  for (const episode of episodes) {
    if (scenes.length >= totalSceneBudget) break;
    const episodeBeats = beats.filter((beat) => beat.episodeId === episode.episodeId);
    const sceneCount = Math.max(1, Math.min(profile.maximumSceneCount, episodeBeats.length, totalSceneBudget - scenes.length));
    for (let index = 0; index < sceneCount; index += 1) {
      const record = makeDramaRecord(input.storyId, input.providerId, input.requestId);
      const sceneBeats = episodeBeats.filter((_, beatIndex) => beatIndex % sceneCount === index);
      const event = analysis.majorEvents.value?.[index % Math.max(1, analysis.majorEvents.value.length)] ?? episode.turningPoint;
      const location = input.characters.find((character) => character.locationId)?.locationId ?? null;
      const scene: DramaScene = {
        ...record,
        id: record.id,
        sceneId: record.id,
        episodeId: episode.episodeId,
        sceneNumber: index + 1,
        locationId: location,
        timelinePosition: input.timeline[index]?.storyTime ?? null,
        participatingCharacterIds: input.characters.slice(0, Math.max(1, Math.min(3, input.characters.length))).map((character) => character.id),
        pointOfViewCharacterId: input.characters[0]?.id ?? null,
        sceneGoal: `把「${event}」轉成角色可見的行動。`,
        conflict: episode.majorConflict,
        visualAction: index === 0
          ? "以角色正在承受的直接危機開場，不用旁白取代行動。"
          : "透過位置、道具與角色反應呈現局勢改變。",
        dialogueBlocks: adaptDialogue(input, analysis, `我要處理「${event}」。`),
        emotionStart: sceneBeats[0]?.intensity ?? 35,
        emotionEnd: sceneBeats.at(-1)?.intensity ?? 65,
        storyFunction: sceneBeats.map((beat) => beat.beatType).join(" → "),
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
