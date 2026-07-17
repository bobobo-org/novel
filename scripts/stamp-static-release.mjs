import fs from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const releaseTag = "novel-ai-h2-complete-local-story-intelligence";
const visibleUiSemanticVersion = "h2w3-visible-ui-semantic-closure-v1";
const visibleUiRequiredStrings = [
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
];
const visibleUiBodyHash = createHash("sha256")
  .update(visibleUiRequiredStrings.join("\n"), "utf8")
  .digest("hex");

if (process.env.VERCEL !== "1" && process.env.NOVEL_STATIC_STAMP !== "1") {
  console.log("Skipping static release stamping outside deployment.");
  process.exit(0);
}

function resolveCommit() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  if (process.env.NOVEL_STATIC_APP_COMMIT) return process.env.NOVEL_STATIC_APP_COMMIT;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "local";
  }
}

const appCommit = resolveCommit();

const replacements = new Map([
  ["__NOVEL_STATIC_APP_COMMIT__", appCommit],
  ["__NOVEL_STATIC_RELEASE_TAG__", releaseTag],
  ["__NOVEL_VISIBLE_UI_SEMANTIC_VERSION__", visibleUiSemanticVersion],
  ["__NOVEL_VISIBLE_UI_BODY_HASH__", visibleUiBodyHash],
]);

for (const file of [
  "public/legacy/novel-system.html",
  "public/legacy/novel-whole-novel-workspace.js",
]) {
  let text = fs.readFileSync(file, "utf8");
  for (const [needle, value] of replacements) text = text.split(needle).join(value);
  fs.writeFileSync(file, text);
}
