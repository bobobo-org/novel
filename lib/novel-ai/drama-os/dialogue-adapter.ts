import type { DialogueBlock, DramaProjectionInput, EvidenceSupport, NarrativeAnalysis } from "./types";

export function adaptDialogue(input: DramaProjectionInput, analysis: NarrativeAnalysis, sceneGoal: string): DialogueBlock[] {
  const protagonist = input.characters.find((character) => character.name === analysis.primaryProtagonist.value) ?? input.characters[0];
  const secondary = input.characters.find((character) => character.id !== protagonist?.id);
  const support: EvidenceSupport = analysis.primaryProtagonist.support;
  return [
    {
      characterId: protagonist?.id ?? null,
      speakerName: protagonist?.name ?? "主角",
      line: `我不能再等了。${sceneGoal}`,
      intention: "明確表達當前行動與代價。",
      sourceSupport: support,
    },
    {
      characterId: secondary?.id ?? null,
      speakerName: secondary?.name ?? "對手",
      line: "你若現在踏出去，就沒有回頭路。",
      intention: "把抽象風險轉成可見衝突。",
      sourceSupport: secondary ? "INFERRED" : "UNKNOWN",
    },
  ];
}
