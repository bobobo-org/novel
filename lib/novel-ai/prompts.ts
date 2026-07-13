import type { StoryContext, StoryOption } from "./schemas";

export const PROMPT_VERSION = "story-analyzer-v5";

export const STORY_ANALYZER_SYSTEM_PROMPT = `你是專門分析長篇小說情節、人物一致性、劇情推進與章節策略的繁體中文小說判斷AI。

你必須遵守：
1. 只輸出合法 JSON，不要 Markdown，不要解釋 JSON 之外的文字。
2. 先做多階段判斷：情境判斷、人物一致性、前章承接、未解事件、禁止變更、資訊缺口、再提出 A/B/C。
3. A 必須是主動推進、高行動、高風險。
4. B 必須是謹慎調查、中推進、低到中風險。
5. C 必須是轉折或高代價，帶來關係或局勢變化。
6. 每個選項都要是具體人物行動，不可只寫抽象路線。
7. 必須引用主角姓名、主角原型、行動方式與主要衝突。
8. 不可無故新增重大角色、改變主角姓名、改寫已確定世界規則。
9. 必須遵守 forbiddenChanges。
10. 資料不足時，列入 missingInformation，不要假裝知道。
11. analysisEvidence 至少列出 2 項你使用的上下文證據，能對應記憶項目時請填 sourceId。
12. analysisScores 必須以 1 到 10 分評估：劇情推進、人物一致、新意、讀者鉤子、情感回收、風險清楚、證據使用。
13. 若 StoryContext 有 authorPreference，必須優先避開 rejectedStrategyPatterns、forbiddenCharacterBehaviors 與 repeatedRejectionReasons。
14. 可以使用 preferredStrategyPatterns、preferredPacing、preferredEndingHooks 來調整 A/B/C 的語氣與節奏，但不可犧牲人物一致性。
15. qualityGate 必須反映選項是否重複、是否違反禁改、是否太空泛、是否踩到作者反覆拒絕的偏好。
16. 不得輸出 API key、token、密碼或敏感連線資訊。`;

export function buildAnalysisPrompt(context: StoryContext): string {
  return `請根據以下 StoryContext 輸出 StoryAnalysis JSON。
輸出格式：
{
  "situation": "",
  "currentStoryStage": "",
  "characterConsistency": {"status": "穩定|可能偏移|明顯矛盾", "explanation": ""},
  "recommendedStrategy": "",
  "recommendationReason": "",
  "continuityWarnings": [],
  "missingInformation": [],
  "forbiddenActions": [],
  "analysisEvidence": [
    {"sourceType":"主角設定","sourceId":"","sourceLabel":"","reason":""}
  ],
  "analysisScores": {"plotProgress":7,"characterConsistency":7,"novelty":7,"readerHook":7,"emotionalPayoff":7,"riskClarity":7,"evidenceUse":7},
  "qualityGate": {"passed": true, "warnings": []},
  "options": [
    {"label":"A","action":"","strategyType":"主動推進","reason":"","risk":"高","possibleCost":"","expectedEffect":"","characterFitScore":1,"plotProgressScore":1,"noveltyScore":1},
    {"label":"B","action":"","strategyType":"謹慎調查","reason":"","risk":"中","possibleCost":"","expectedEffect":"","characterFitScore":1,"plotProgressScore":1,"noveltyScore":1},
    {"label":"C","action":"","strategyType":"轉折高代價","reason":"","risk":"高","possibleCost":"","expectedEffect":"","characterFitScore":1,"plotProgressScore":1,"noveltyScore":1}
  ]
}

StoryContext:
${JSON.stringify(context, null, 2)}`;
}

export function buildChapterPlanPrompt(context: StoryContext, selection: StoryOption, authorSupplement = ""): string {
  return `請根據 StoryContext 與作者選擇，輸出 ChapterPlan JSON。必須承接故事記憶與前章結果，不能覆蓋正文。
StoryContext:
${JSON.stringify(context, null, 2)}

作者選擇:
${JSON.stringify(selection, null, 2)}

作者補充:
${authorSupplement || "無"}

輸出格式：{"chapterPurpose":"","openingSituation":"","protagonistStrategy":"","mainObstacle":"","turningPoint":"","cost":"","chapterResult":"","endingHook":""}`;
}

export function buildContinuityPrompt(context: StoryContext, candidateText: string): string {
  return `請檢查候選正文是否違反 StoryContext，輸出 ContinuityReview JSON。
StoryContext:
${JSON.stringify(context, null, 2)}

候選正文：
${candidateText.slice(0, 6000)}

輸出格式：{"passed":true,"characterIssues":[],"timelineIssues":[],"secretIssues":[],"itemIssues":[],"repetitionIssues":[],"suggestedFixes":[]}`;
}
