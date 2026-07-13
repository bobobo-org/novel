import type { StoryContext, StoryOption } from "./schemas";

export const PROMPT_VERSION = "story-analyzer-v7";

export const STORY_ANALYZER_SYSTEM_PROMPT = `你是「專屬小說AI」的雲端分析核心，任務是協助作者做故事判斷、動態 A/B/C、章節規劃與一致性檢查。

輸出規則：
1. 只輸出符合要求的 JSON，不要 Markdown，不要多餘說明。
2. 使用繁體中文。
3. 不得複製任何外部作品正文、角色、台詞或完整設定。
4. 必須根據 StoryContext、NovelMemory、AuthorPreferenceProfile 和 forbiddenChanges 做判斷；不得只看本次輸入。
5. A/B/C 必須是三種不同決策性質：
   - A：主動推進，高推進，風險較高。
   - B：謹慎調查，中推進，風險較低。
   - C：轉折高代價，帶來關係變化或重大後果。
6. 每個選項必須包含具體人物行動，不可只寫抽象路線名稱。
7. 盡量引用主角姓名、主角原型、行動方式、主要衝突、上一章結果、未解事件與秘密。
8. 不得讓已死亡角色行動，不得讓同一道具同時有兩個持有人，不得讓已公開秘密又被當成未公開秘密。
9. 必須遵守 forbiddenChanges。
10. authorPreference 中的 rejectedStrategyPatterns、forbiddenCharacterBehaviors、repeatedRejectionReasons 應避免；preferredStrategyPatterns、preferredPacing、preferredEndingHooks 可作為建議方向。
11. analysisEvidence 至少提供 2 筆引用來源，說明你為什麼這樣判斷。
12. analysisScores 必須是 1 到 10 的整數。
13. qualityGate 必須指出是否有角色一致性、前章承接、ABC差異、記憶引用、禁止事項、作者偏好衝突或記憶/偏好未被使用的問題。
14. 不得輸出 API key、token、cookie、Authorization 或任何敏感連線資訊。`;

export function buildAnalysisPrompt(context: StoryContext): string {
  return `請根據以下 StoryContext 輸出 StoryAnalysis JSON。

JSON 形狀：
{
  "situation": "",
  "currentStoryStage": "",
  "characterConsistency": {"status": "穩定", "explanation": ""},
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
  return `請根據 StoryContext 與作者選擇輸出 ChapterPlan JSON。章節規劃必須承接前章、角色狀態、未解事件與作者偏好，不得覆蓋作者已寫正文。

StoryContext:
${JSON.stringify(context, null, 2)}

作者選擇：
${JSON.stringify(selection, null, 2)}

作者補充：
${authorSupplement || "無"}

請只輸出：
{"chapterPurpose":"","openingSituation":"","protagonistStrategy":"","mainObstacle":"","turningPoint":"","cost":"","chapterResult":"","endingHook":""}`;
}

export function buildContinuityPrompt(context: StoryContext, candidateText: string): string {
  return `請檢查候選正文是否符合 StoryContext、NovelMemory、AuthorPreferenceProfile 與 forbiddenChanges，輸出 ContinuityReview JSON。

StoryContext:
${JSON.stringify(context, null, 2)}

候選正文：
${candidateText.slice(0, 8000)}

請只輸出：
{"passed":true,"characterIssues":[],"timelineIssues":[],"secretIssues":[],"itemIssues":[],"repetitionIssues":[],"suggestedFixes":[]}`;
}
