import { clampScore, makeCharacterAgentRecord } from "./record-factory";
import type { CharacterBelief, CharacterKnowledgeRecord } from "./types";

export function proposeBeliefUpdates(input: {
  projectId: string;
  characterId: string;
  existingBeliefs: CharacterBelief[];
  observations: string[];
  allowedKnowledge: CharacterKnowledgeRecord[];
  timelinePosition: string;
  canonContextId: string;
}): CharacterBelief[] {
  const knownClaims = new Map(input.allowedKnowledge.map((record) => [record.claim.trim().toLocaleLowerCase(), record]));
  const existing = new Map(input.existingBeliefs
    .filter((belief) => belief.characterId === input.characterId && belief.projectId === input.projectId)
    .map((belief) => [belief.proposition.trim().toLocaleLowerCase(), belief]));
  return input.observations.filter(Boolean).map((observation) => {
    const key = observation.trim().toLocaleLowerCase();
    const prior = existing.get(key);
    const knowledge = knownClaims.get(key);
    const record = makeCharacterAgentRecord(input.projectId, "ai_candidate");
    const contradictions = knowledge?.canonicalTruthStatus === "FALSE" ? [knowledge.knowledgeId] : [];
    const support = knowledge && knowledge.canonicalTruthStatus !== "FALSE" ? [knowledge.knowledgeId] : [];
    const strength = clampScore((prior?.beliefStrength ?? 40) + (support.length ? 25 : contradictions.length ? -25 : 5), 0, 100);
    const beliefStatus: CharacterBelief["beliefStatus"] = contradictions.length
      ? strength <= 20 ? "DISPROVEN" : "SUSPICIOUS"
      : support.length ? "BELIEVED_TRUE" : strength >= 65 ? "BELIEVED_TRUE" : "UNCERTAIN";
    return {
      ...record,
      id: record.id,
      beliefId: record.id,
      characterId: input.characterId,
      canonContextId: input.canonContextId,
      proposition: observation.trim(),
      beliefStrength: strength,
      beliefStatus,
      supportingEvidenceIds: support,
      contradictingEvidenceIds: contradictions,
      beliefSource: knowledge ? "OBSERVATION" : "INFERENCE",
      formedAt: prior?.formedAt ?? new Date().toISOString(),
      effectiveFromTimelinePosition: input.timelinePosition,
      effectiveToTimelinePosition: null,
    };
  });
}

export function falseBelief(
  projectId: string,
  characterId: string,
  proposition: string,
  strength = 75,
  evidenceIds: string[] = [],
  canonContextId = "",
  timelinePosition = "0000",
): CharacterBelief {
  const record = makeCharacterAgentRecord(projectId, "user");
  return {
    ...record,
    id: record.id,
    beliefId: record.id,
    characterId,
    canonContextId,
    proposition,
    beliefStrength: clampScore(strength, 0, 100),
    beliefStatus: "BELIEVED_TRUE",
    supportingEvidenceIds: [...evidenceIds],
    contradictingEvidenceIds: [],
    beliefSource: "USER",
    formedAt: record.createdAt,
    effectiveFromTimelinePosition: timelinePosition,
    effectiveToTimelinePosition: null,
  };
}
