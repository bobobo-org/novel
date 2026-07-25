import { makeDramaRecord } from "./record-factory";
import type { DramaBeat, DramaBeatType, DramaFormatProfile, DramaProjectionInput, DramaSourceReference, NarrativeAnalysis } from "./types";

const BEAT_SEQUENCE: DramaBeatType[] = [
  "OPENING_HOOK",
  "SETUP",
  "INCITING_INCIDENT",
  "PRESSURE",
  "ESCALATION",
  "REVELATION",
  "REVERSAL",
  "CHOICE",
  "PAYOFF",
  "CONSEQUENCE",
  "CLIFFHANGER",
  "ENDING",
];

export function buildBeatSheet(
  input: DramaProjectionInput,
  analysis: NarrativeAnalysis,
  profile: DramaFormatProfile,
  episodeId: string,
): DramaBeat[] {
  const [minimum, maximum] = profile.recommendedBeatRange;
  const beatCount = Math.min(maximum, Math.max(minimum, Math.ceil(profile.targetDurationSeconds / profile.conflictIntervalSeconds) + 3));
  const eventValues = analysis.majorEvents.value ?? [];
  const sourceReferences: DramaSourceReference[] = analysis.majorEvents.sourceReferences;

  return Array.from({ length: beatCount }, (_, index) => {
    const record = makeDramaRecord(input.storyId, input.providerId, input.requestId);
    const event = eventValues[index % Math.max(1, eventValues.length)] ?? input.chapters[index % input.chapters.length]?.title ?? "故事壓力升高";
    const type = index === beatCount - 1 && profile.cliffhangerRequired
      ? "CLIFFHANGER"
      : BEAT_SEQUENCE[Math.min(index, BEAT_SEQUENCE.length - 1)];
    return {
      ...record,
      id: record.id,
      beatId: record.id,
      episodeId,
      sceneId: null,
      beatType: type,
      setup: index === 0 ? `以「${event}」直接切入。` : `承接上一節拍的後果。`,
      pressure: `讓角色必須回應：${event}`,
      trigger: `新的資訊或行動迫使局面改變。`,
      payoff: type === "PAYOFF" || type === "ENDING" ? `兌現目前最重要的承諾：${event}` : "保留回報空間。",
      consequence: `角色的選擇改變下一個場景的風險。`,
      futureHook: type === "CLIFFHANGER" ? "在答案揭露前切斷，留下可追蹤的未解問題。" : "推向下一個衝突。",
      intensity: Math.min(100, Math.round(35 + (index / Math.max(1, beatCount - 1)) * 65)),
      sourceReferences: sourceReferences.slice(index % Math.max(1, sourceReferences.length), (index % Math.max(1, sourceReferences.length)) + 1),
    };
  });
}
