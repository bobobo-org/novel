import { evaluateVoiceDrift } from "./voice-engine";
import type {
  CharacterActorContext,
  CharacterAgentProfile,
  CharacterAgentState,
  CharacterDialogueCandidate,
  CharacterGoalPlan,
  CharacterRelationshipEdge,
} from "./types";

function address(profile: CharacterAgentProfile, recipientName: string) {
  return profile.voiceProfile.preferredAddressTerms[0] || recipientName || "你";
}

function fitSentenceLength(profile: CharacterAgentProfile, message: string) {
  if (profile.voiceProfile.sentenceLength === "short") return message.split(/[，；]/u)[0] + "。";
  if (profile.voiceProfile.sentenceLength === "long") return `${message}；我需要你先說明目前能確認的部分，再決定下一步。`;
  return message;
}

export function planDialogueCandidates(input: {
  seed: string;
  actorContext: CharacterActorContext;
  profile: CharacterAgentProfile;
  state: CharacterAgentState;
  goalPlan: CharacterGoalPlan;
  relationships: CharacterRelationshipEdge[];
  recipients: Array<{ characterId: string; name: string }>;
  priorLines?: string[];
}): CharacterDialogueCandidate[] {
  const recipient = input.recipients[0];
  if (!recipient) return [];
  const relationship = input.relationships.find((edge) =>
    edge.fromCharacterId === input.profile.characterId
    && edge.toCharacterId === recipient.characterId
    && edge.canonContextId === input.actorContext.canonContext.canonContextId);
  const known = input.actorContext.allowedKnowledge[0];
  const goal = input.goalPlan.selectedGoal ?? "弄清楚現在的情況";
  const tone = relationship && relationship.trust < 0 ? "我不會先相信你的說法" : "我願意先聽你說";
  let line = fitSentenceLength(
    input.profile,
    `${address(input.profile, recipient.name)}，${tone}，但我只會依自己能確認的事實推進「${goal}」`,
  );
  for (const phrase of input.profile.voiceProfile.avoidedPhrases) line = line.replaceAll(phrase, "");
  if ((input.priorLines ?? []).includes(line)) line = fitSentenceLength(input.profile, `${address(input.profile, recipient.name)}，先換個方法確認現況`);
  const candidate: CharacterDialogueCandidate = {
    candidateId: `dialogue:${input.seed}:${input.profile.characterId}:${recipient.characterId}`,
    characterId: input.profile.characterId,
    recipientCharacterIds: [recipient.characterId],
    line,
    intention: known ? `依已知資訊 ${known.knowledgeId} 推進角色目標。` : "在資訊不足時保持不確定，不臆造秘密。",
    publicMessage: true,
    knowledgeIds: known ? [known.knowledgeId] : [],
    blockedKnowledgeIds: input.actorContext.informationFlowTrace.filter((trace) => !trace.allowed).map((trace) => trace.inputEntityId),
    relationshipImpact: { [recipient.characterId]: { trust: relationship && relationship.trust < 0 ? -1 : 1, conflict: relationship && relationship.conflict > 50 ? 2 : 0 } },
    voiceDrift: { score: 0, reason: "", conflictingEvidence: [], suggestedRevision: null },
    canonicalMutation: 0,
  };
  candidate.voiceDrift = evaluateVoiceDrift(input.profile, candidate.line);
  return [candidate];
}
