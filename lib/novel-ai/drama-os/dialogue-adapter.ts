import type { DialogueBlock, DramaProjectionInput, EvidenceSupport, NarrativeAnalysis } from "./types";

function compact(value: string | null | undefined, fallback: string, limit = 28) {
  const normalized = value?.replace(/^[「『“"']+|[」』”"'。！？!?]+$/gu, "").replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, limit) : fallback;
}

export function adaptDialogue(input: DramaProjectionInput, analysis: NarrativeAnalysis, sceneGoal: string): DialogueBlock[] {
  const protagonist = input.characters.find((character) => character.name === analysis.primaryProtagonist.value) ?? input.characters[0];
  const secondary = input.characters.find((character) => character.id !== protagonist?.id);
  const support: EvidenceSupport = analysis.primaryProtagonist.support;
  const event = compact(sceneGoal.match(/「([^」]+)」/u)?.[1], "眼前這一步");
  const protagonistGoal = compact(
    (protagonist?.name ? analysis.characterGoals.value?.[protagonist.name] : null) ?? protagonist?.goal,
    `處理${event}`,
  );
  const secondaryGoal = compact(
    (secondary?.name ? analysis.characterGoals.value?.[secondary.name] : null) ?? secondary?.goal,
    "保住自己的選擇",
  );
  const variant = (protagonist?.name.length ?? 0) % 3;
  const protagonistLines = [
    `「先別動。」${protagonist?.name ?? "主角"}壓低聲音，「我要的是${protagonistGoal}。真出了事，我負責。」`,
    `「再給我一分鐘。」${protagonist?.name ?? "主角"}沒有移開視線，「${protagonistGoal}不能停在這裡。」`,
    `「現在退，前面就白走了。」${protagonist?.name ?? "主角"}說，「我先把${protagonistGoal}做完。」`,
  ];
  const secondaryLines = [
    `「你肯負責，不等於我得照你的路走。」${secondary?.name ?? "對手"}說，「我要先${secondaryGoal}。」`,
    `「一分鐘夠你冒險，不夠我收拾後果。」${secondary?.name ?? "對手"}沒有讓路，「先讓我${secondaryGoal}。」`,
    `「那就說清楚代價。」${secondary?.name ?? "對手"}看著他，「${secondaryGoal}以前，我不會點頭。」`,
  ];
  return [
    {
      characterId: protagonist?.id ?? null,
      speakerName: protagonist?.name ?? "主角",
      line: protagonistLines[variant],
      intention: "用當下動作和承擔表達目標，不把場景大綱念成台詞。",
      sourceSupport: support,
    },
    {
      characterId: secondary?.id ?? null,
      speakerName: secondary?.name ?? "對手",
      line: secondaryLines[variant],
      intention: "保留自己的目標與邊界，讓衝突來自立場而非警告模板。",
      sourceSupport: secondary ? "INFERRED" : "UNKNOWN",
    },
  ];
}
