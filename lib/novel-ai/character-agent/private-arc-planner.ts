import { makeCharacterAgentRecord } from "./record-factory";
import type { CharacterAgentProfile, CharacterCanonContext, CharacterPrivateArc, CharacterRelationshipEdge } from "./types";

export function planPrivateCharacterArc(input: {
  canonContext: CharacterCanonContext;
  profile: CharacterAgentProfile;
  relationships: CharacterRelationshipEdge[];
  title?: string;
  privateGoal?: string;
  hiddenMotivation?: string;
  secret?: string;
}): CharacterPrivateArc {
  const record = makeCharacterAgentRecord(input.canonContext.projectId, "ai_candidate");
  const supportedGoals = input.profile.goals.support === "SUPPORTED" ? (input.profile.goals.value ?? []) : [];
  const inferredMotives = input.profile.motives.value ?? [];
  const privateGoal = input.privateGoal?.trim() || supportedGoals[0] || "在不改變正式故事的前提下探索角色選擇";
  return {
    ...record,
    id: record.id,
    privateArcId: record.id,
    characterId: input.profile.characterId,
    canonContextId: input.canonContext.canonContextId,
    title: input.title?.trim() || `${input.profile.name}的私人可能性`,
    privateGoal,
    hiddenMotivation: input.hiddenMotivation?.trim() || inferredMotives[0] || "尚未由正式來源確認",
    secret: input.secret?.trim() || "未設定",
    plan: [
      `在私人模擬中觀察「${privateGoal}」如何影響角色選擇。`,
      "檢查知識邊界、角色一致性與關係後果。",
      "只有使用者轉為候選並核准後，才可寫入指定 Canon 層。",
    ],
    milestones: ["形成可檢查的選擇", "完成一致性評估", "等待使用者決定"],
    risk: inferredMotives.length ? 45 : 65,
    relatedRelationshipIds: input.relationships
      .filter((relationship) => relationship.fromCharacterId === input.profile.characterId)
      .map((relationship) => relationship.relationshipId),
    sourceRevision: input.canonContext.novelRevision,
    status: "PRIVATE_SIMULATION",
    visibility: "PRIVATE_SIMULATION",
    canonicalMutation: 0,
    freshnessStatus: "CURRENT",
  };
}
