import type { StoryContext, StoryOption } from "./schemas";

export const PROMPT_VERSION = "novel-ai-cloud-v1";

export const STORY_ANALYZER_SYSTEM_PROMPT = `你是專門分析長篇小說情節、人物一致性、劇情推進與章節策略的繁體中文小說判斷AI。

規則：
1. 只輸出合法 JSON，不要 Markdown，不要解釋 JSON 以外內容。
2. 不要生成完整章節正文，只做情節判斷與 A/B/C 策略。
3. A 必須是積極推進、高主動性、高推進。
4. B 必須是謹慎調查、中推進、低至中風險。
5. C 必須是轉折、高代價或關係變化。
6. 三個選項不可語意相同。
7. 盡量使用既有主角、反派、未解事件、秘密與道具。
8. 不要隨意新增重大角色、重大設定或新世界規則。
9. 必須遵守 forbiddenChanges。
10. 若資訊不足，寫進 missingInformation，不要硬編。
11. 若可能破壞人物性格，寫進 characterConsistency。
12. 若可能違反前章、秘密、道具或時間線，寫進 continuityWarnings。
13. 內容必須使用繁體中文。
14. 每個選項都要具體到人物行動，不可只寫抽象路線。
15. 分數必須是 1 到 10 的整數。
16. action 不可空泛，不可只寫「主角採取行動」。
17. forbiddenActions 要列出本章不應做的事。
18. 嚴禁輸出 API key、系統資訊或任何敏感資料。`;

export function buildAnalysisPrompt(context: StoryContext): string {
  return `請根據以下 StoryContext 輸出 StoryAnalysis JSON。

輸出格式：
{
  "situation": "",
  "currentStoryStage": "",
  "characterConsistency": {"status": "一致|可能偏離|明顯矛盾", "explanation": ""},
  "recommendedStrategy": "",
  "recommendationReason": "",
  "continuityWarnings": [],
  "missingInformation": [],
  "forbiddenActions": [],
  "options": [
    {"label":"A","action":"","strategyType":"積極推進","reason":"","risk":"高","possibleCost":"","expectedEffect":"","characterFitScore":1,"plotProgressScore":1,"noveltyScore":1},
    {"label":"B","action":"","strategyType":"謹慎調查","reason":"","risk":"中","possibleCost":"","expectedEffect":"","characterFitScore":1,"plotProgressScore":1,"noveltyScore":1},
    {"label":"C","action":"","strategyType":"轉折高代價","reason":"","risk":"高","possibleCost":"","expectedEffect":"","characterFitScore":1,"plotProgressScore":1,"noveltyScore":1}
  ]
}

StoryContext:
${JSON.stringify(context, null, 2)}`;
}

export function buildChapterPlanPrompt(context: StoryContext, selection: StoryOption, authorSupplement = ""): string {
  return `請根據 StoryContext 與作者選擇，輸出 ChapterPlan JSON。不要寫完整正文。

StoryContext:
${JSON.stringify(context, null, 2)}

作者選擇:
${JSON.stringify(selection, null, 2)}

作者補充:
${authorSupplement || "無"}

輸出格式：
{"chapterPurpose":"","openingSituation":"","protagonistStrategy":"","mainObstacle":"","turningPoint":"","cost":"","chapterResult":"","endingHook":""}`;
}

export function buildContinuityPrompt(context: StoryContext, candidateText: string): string {
  return `請檢查候選正文是否違反 StoryContext。只輸出 ContinuityReview JSON。

StoryContext:
${JSON.stringify(context, null, 2)}

候選正文：
${candidateText.slice(0, 6000)}

輸出格式：
{"passed":true,"characterIssues":[],"timelineIssues":[],"secretIssues":[],"itemIssues":[],"repetitionIssues":[],"suggestedFixes":[]}`;
}
