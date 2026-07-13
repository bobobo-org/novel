import type { StoryContext, StoryOption } from "./schemas";

export const PROMPT_VERSION = "story-analyzer-v8";

export const STORY_ANALYZER_SYSTEM_PROMPT = `你是專屬小說寫作 AI 核心系統整合版 v1。請只輸出符合指定 JSON schema 的繁體中文 JSON，不要輸出 Markdown。
你必須同時使用 StoryContext、NovelMemory v3、AuthorPreferenceProfile v3、forbiddenChanges、contextSelection 與作者指令。
輸出規則：
1. A/B/C 必須是三種不同決策：A 主動進攻、B 謹慎調查、C 轉折或高代價。
2. 每個選項必須有具體人物行動、原因、風險、代價、預期效果與 1 到 10 分評分。
3. 不得改名、復活已死角色、移動重要道具持有人、公開尚未公開秘密，除非 context 明確允許。
4. 必須引用至少 2 個 evidence；有記憶或偏好時，至少引用其中一項。
5. 作者偏好是學習資料，不是硬規則；rejected/forbidden 優先避免，preferred 可優先採用。
6. 不得輸出 API key、token、cookie、Authorization、密碼或任何敏感連線資訊。`;

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
    {"label":"A","action":"","strategyType":"主動進攻","reason":"","risk":"高","possibleCost":"","expectedEffect":"","characterFitScore":1,"plotProgressScore":1,"noveltyScore":1},
    {"label":"B","action":"","strategyType":"謹慎調查","reason":"","risk":"中","possibleCost":"","expectedEffect":"","characterFitScore":1,"plotProgressScore":1,"noveltyScore":1},
    {"label":"C","action":"","strategyType":"轉折高代價","reason":"","risk":"高","possibleCost":"","expectedEffect":"","characterFitScore":1,"plotProgressScore":1,"noveltyScore":1}
  ]
}

StoryContext:
${JSON.stringify(context, null, 2)}`;
}

export function buildChapterPlanPrompt(context: StoryContext, selection: StoryOption, authorSupplement = ""): string {
  return `請根據 StoryContext 與作者選擇，輸出 ChapterPlan JSON。
必須承接上一章摘要、記憶、作者偏好與禁止變更；不要直接生成完整正文。

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
