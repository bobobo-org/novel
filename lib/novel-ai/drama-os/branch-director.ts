import { makeDramaRecord } from "./record-factory";
import type { DramaBranchCandidate, DramaEpisode, DramaProjectionInput, NarrativeAnalysis } from "./types";

export function buildBranchCandidate(
  input: DramaProjectionInput,
  episode: DramaEpisode,
  analysis: NarrativeAnalysis,
): DramaBranchCandidate {
  const record = makeDramaRecord(input.storyId, input.providerId, input.requestId);
  const protagonist = analysis.primaryProtagonist.value ?? "主角";
  return {
    ...record,
    id: record.id,
    branchCandidateId: record.id,
    episodeId: episode.episodeId,
    sourceRevision: input.sourceRevision,
    choicePointId: crypto.randomUUID(),
    choices: [
      {
        key: "A",
        label: "正面承擔",
        action: `${protagonist}公開迎戰目前衝突。`,
        consequence: "立即提高風險，但可能換得信任與主導權。",
        effects: { characterGoal: "正面突破", relationshipState: "公開結盟", risk: 3, resource: -1, futureScene: "公開對峙", endingProbability: 0.42 },
      },
      {
        key: "B",
        label: "暗中布局",
        action: `${protagonist}暫時隱藏意圖，先取得關鍵證據。`,
        consequence: "短期降低衝突，卻增加被誤解與背叛的可能。",
        effects: { characterGoal: "取得證據", relationshipState: "保持距離", risk: 1, resource: 1, futureScene: "祕密調查", endingProbability: 0.35 },
      },
      {
        key: "C",
        label: "改變規則",
        action: `${protagonist}拒絕既有兩難，提出第三條路。`,
        consequence: "可能創造最大轉折，也最容易觸發世界規則衝突。",
        effects: { characterGoal: "重寫局面", relationshipState: "迫使重新站隊", risk: 5, resource: -2, futureScene: "規則翻轉", endingProbability: 0.23 },
      },
    ],
    predictedConsequences: ["角色目標分流", "下一集場景改變", "結局機率重新分配"],
    continuityRisks: analysis.adaptationRisks,
    mode: input.mode ?? "creator_candidate",
    status: input.mode === "private_simulation" ? "private_simulation" : "awaiting_approval",
    approvalTransactionId: null,
  };
}
