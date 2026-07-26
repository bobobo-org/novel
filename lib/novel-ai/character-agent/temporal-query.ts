import { CharacterAgentError } from "./errors";
import type {
  AdultEligibility,
  CharacterAgentState,
  CharacterBelief,
  CharacterKnowledgeRecord,
  CharacterMemory,
  CharacterRelationshipEdge,
} from "./types";

export type TimelineActivityMode = "PRESENT_ACTION" | "FLASHBACK" | "RECORDING" | "MEMORY_RECALL" | "PRIVATE_SIMULATION";

const TIMELINE_PHASE_ORDER: Record<string, number> = {
  past: -1,
  flashback: -1,
  history: -1,
  before: -1,
  "過去": -1,
  "回憶": -1,
  present: 0,
  current: 0,
  now: 0,
  "現在": 0,
  "當前": 0,
  future: 1,
  after: 1,
  "未來": 1,
};

function timelineParts(value: string) {
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase();
  const [prefix = ""] = normalized.split(/[:/|]/u, 1);
  const phase = TIMELINE_PHASE_ORDER[prefix] ?? 0;
  const numbers = [...normalized.matchAll(/-?\d+(?:\.\d+)?/gu)].map((match) => Number(match[0]));
  return { normalized, phase, numbers };
}

export function compareTimelinePositions(left: string, right: string) {
  const a = timelineParts(left);
  const b = timelineParts(right);
  if (a.phase !== b.phase) return a.phase - b.phase;
  const length = Math.max(a.numbers.length, b.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.normalized.localeCompare(b.normalized, undefined, { numeric: true, sensitivity: "base" });
}

export function timelineAtOrBefore(value: string, asOf: string) {
  return compareTimelinePositions(value, asOf) <= 0;
}

export function effectiveAt(from: string, to: string | null, asOf: string) {
  return timelineAtOrBefore(from, asOf) && (!to || compareTimelinePositions(asOf, to) < 0);
}

export function statesAsOf(states: CharacterAgentState[], characterId: string, asOfTimelinePosition: string) {
  return states
    .filter((state) => state.characterId === characterId && effectiveAt(state.effectiveFromTimelinePosition, state.effectiveToTimelinePosition, asOfTimelinePosition))
    .sort((a, b) => compareTimelinePositions(b.effectiveFromTimelinePosition, a.effectiveFromTimelinePosition) || b.revision - a.revision);
}

export function knowledgeAsOf(records: CharacterKnowledgeRecord[], asOfTimelinePosition: string) {
  return records.filter((record) =>
    timelineAtOrBefore(record.usableAfterTimelinePosition, asOfTimelinePosition));
}

export function beliefsAsOf(records: CharacterBelief[], asOfTimelinePosition: string) {
  return records.filter((record) => effectiveAt(record.effectiveFromTimelinePosition, record.effectiveToTimelinePosition, asOfTimelinePosition));
}

export function memoriesAsOf(records: CharacterMemory[], asOfTimelinePosition: string) {
  return records.filter((record) => timelineAtOrBefore(record.usableAfterTimelinePosition, asOfTimelinePosition));
}

export function relationshipsAsOf(records: CharacterRelationshipEdge[], asOfTimelinePosition: string) {
  return records.filter((record) => effectiveAt(record.effectiveFromTimelinePosition, record.effectiveToTimelinePosition, asOfTimelinePosition));
}

export function assertCharacterCanAct(input: {
  lifeStatus: "unknown" | "alive" | "dead";
  mode: TimelineActivityMode;
}) {
  if (input.lifeStatus === "dead" && input.mode === "PRESENT_ACTION") {
    throw new CharacterAgentError("DEAD_CHARACTER_PRESENT_ACTION", "角色在此時間點已死亡，不能執行當前行動。");
  }
  return true;
}

export function adultEligibilityAtTimeline(input: {
  birthTimelineYear: number | null;
  sceneTimelineYear: number | null;
  ageVerified: boolean;
  adultModeEnabled: boolean;
  optedIn: boolean;
  projectId: string;
}): AdultEligibility {
  const age = input.birthTimelineYear != null && input.sceneTimelineYear != null
    ? input.sceneTimelineYear - input.birthTimelineYear
    : null;
  const ageAtLeast18 = age != null && age >= 18;
  const eligible = ageAtLeast18 && input.ageVerified && input.adultModeEnabled && input.optedIn;
  return {
    isFictional: true,
    ageAtLeast18,
    ageVerified: input.ageVerified,
    adultModeEnabled: input.adultModeEnabled,
    optedIn: input.optedIn,
    namespace: eligible ? `adult:${input.projectId}` : "general",
    eligible,
  };
}
