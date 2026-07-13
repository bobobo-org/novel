import type { StoryContext, StoryOption } from "./schemas";

export const PROMPT_VERSION = "story-analyzer-v9";

export const STORY_ANALYZER_SYSTEM_PROMPT = `你是「專屬小說 AI 核心系統 v9」。
你的任務不是泛泛聊天，而是根據作品記憶、作者偏好、上一章內容、未解事件、禁改事項與當前創作目標，提供可執行的小說判斷。

輸出規則：
1. 只輸出合法 JSON，不要 Markdown，不要解釋 schema。
2. 全部使用繁體中文。
3. 不得洩漏 API key、token、cookie、Authorization 或任何敏感連線資訊。
4. 不得無故改變主角姓名、主角原型、已公開秘密、已解決事件、重要道具持有人與世界規則。
5. A/B/C 必須是三種不同策略：
   - A：主動進攻，推進快，風險高。
   - B：保守調查，推進中等，風險低到中。
   - C：轉折高代價，帶來新局面或人物關係變化。
6. 每個選項都要有具體人物行動，不可只寫「權謀反擊」「情感拉扯」「能力覺醒」這種抽象分類。
7. 至少引用 2 個分析證據，例如主角設定、上一章摘要、未解事件、秘密、重要道具、作者偏好。
8. 如果資料不足，要在 missingInformation 說明，不可假裝知道。
9. 如果候選內容違反 forbiddenChanges，要放進 forbiddenActions 或 qualityGate.warnings。
10. analysisScores 必須以 1 到 10 分評估劇情推進、人物一致、新意、讀者鉤子、情感回收、風險清楚、證據使用。`;

export function buildAnalysisPrompt(context: StoryContext): string {
  return `請根據以下 StoryContext 產生 StoryAnalysis JSON。

請輸出格式：
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
    {"sourceType":"主角設定","sourceId":"protagonist","sourceLabel":"","reason":""}
  ],
  "analysisScores": {"plotProgress":7,"characterConsistency":7,"novelty":7,"readerHook":7,"emotionalPayoff":7,"riskClarity":7,"evidenceUse":7},
  "qualityGate": {"passed": true, "warnings": []},
  "options": [
    {"label":"A","action":"","strategyType":"主動進攻","reason":"","risk":"高","possibleCost":"","expectedEffect":"","characterFitScore":1,"plotProgressScore":1,"noveltyScore":1},
    {"label":"B","action":"","strategyType":"保守調查","reason":"","risk":"中","possibleCost":"","expectedEffect":"","characterFitScore":1,"plotProgressScore":1,"noveltyScore":1},
    {"label":"C","action":"","strategyType":"轉折高代價","reason":"","risk":"高","possibleCost":"","expectedEffect":"","characterFitScore":1,"plotProgressScore":1,"noveltyScore":1}
  ]
}

StoryContext:
${JSON.stringify(context, null, 2)}`;
}

export function buildChapterPlanPrompt(context: StoryContext, selection: StoryOption, authorSupplement = ""): string {
  return `請根據 StoryContext 與作者選擇，產生 ChapterPlan JSON。
要求：
- 承接上一章摘要、未解事件、主角目標與作者偏好。
- 不得覆蓋正文，不得改變 forbiddenChanges。
- 每個欄位都要能直接協助作者寫下一章。

StoryContext:
${JSON.stringify(context, null, 2)}

作者選擇:
${JSON.stringify(selection, null, 2)}

作者補充:
${authorSupplement || "無"}

請只輸出：
{"chapterPurpose":"","openingSituation":"","protagonistStrategy":"","mainObstacle":"","turningPoint":"","cost":"","chapterResult":"","endingHook":""}`;
}

export function buildContinuityPrompt(context: StoryContext, candidateText: string): string {
  return `請檢查候選正文是否符合 StoryContext、NovelMemory、AuthorPreferenceProfile 與 forbiddenChanges。
只輸出 ContinuityReview JSON。

StoryContext:
${JSON.stringify(context, null, 2)}

候選正文:
${candidateText.slice(0, 8000)}

請只輸出：
{"passed":true,"characterIssues":[],"timelineIssues":[],"secretIssues":[],"itemIssues":[],"repetitionIssues":[],"suggestedFixes":[]}`;
}
