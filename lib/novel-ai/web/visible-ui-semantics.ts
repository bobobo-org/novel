import { createHash } from "node:crypto";

export const H2W3_VISIBLE_UI_SEMANTIC_VERSION = "h2w3-visible-ui-semantic-closure-v1";

export const H2W3_VISIBLE_UI_REQUIRED_STRINGS = [
  "三路閉端 AI 工作區",
  "三路閉端 AI 架構",
  "瀏覽器閉端 AI",
  "Ollama 本機 AI",
  "本機閉端 Runtime",
  "外部 AI 可選",
  "外部 AI：可選輔助",
  "回饋與未來學習資料",
  "匯出已核准樣本 JSONL",
  "執行品質基準測試",
  "Continual Learning Status: not_implemented",
  "Model Training Status: not_implemented",
  "H2 Local Story Intelligence",
] as const;

export const H2W3_VISIBLE_UI_FORBIDDEN_STRINGS = [
  "story-analyzer-v9",
  "可接外部 AI",
  "小型閉端AI",
  "專屬小說AI",
  "AI學習資料",
  "匯出訓練資料",
  "執行AI固定評測",
  "尚未讀取學習資料",
  "尚未檢查雲端AI狀態",
  "尚未產生雲端AI結果",
  "全書閉端 AI 工作區",
] as const;

export function normalizeVisibleSemanticSource(source: string | readonly string[]) {
  const raw = typeof source === "string" ? source : source.join("\n");
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function computeVisibleUiBodyHash(source: string | readonly string[]) {
  return createHash("sha256")
    .update(normalizeVisibleSemanticSource(source), "utf8")
    .digest("hex");
}

export function extractVisibleSemanticSourceFromBody(body: string) {
  return H2W3_VISIBLE_UI_REQUIRED_STRINGS
    .filter((item) => body.includes(item))
    .join("\n");
}

export const H2W3_VISIBLE_UI_BODY_HASH = computeVisibleUiBodyHash(H2W3_VISIBLE_UI_REQUIRED_STRINGS);
