import fs from "node:fs";
import { createHash } from "node:crypto";
import releaseManifest from "../release-manifest.json" with { type: "json" };
import releaseProvenance from "../generated/release-provenance.json" with { type: "json" };
import { verifyReleaseProvenance } from "./generate-release-provenance.mjs";

const releaseTag = releaseManifest.releaseTag;
const releaseRevision = releaseManifest.releaseRevision;
const releaseBuild = releaseProvenance.releaseBuild;
const releaseProductCommit = releaseProvenance.releaseProductCommit;
const releaseBaseCommit = releaseManifest.releaseBaseCommit;
const releaseName = releaseManifest.releaseName;
const consumerRelease = releaseManifest.consumerRelease;
const architectureStage = releaseManifest.architectureStage;
const gitCommitSignature = releaseProvenance.gitCommitSignature;
const deploymentProvenance = "verified";
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
  "Continual Learning Status: ready_l0_l1_controlled",
  "Model Training Status: started",
  "LoRA Training Status: candidate_ready",
  "QLoRA Training Status: hardware_blocked_no_cuda",
  "Adapter Training Status: candidate_ready_not_activated",
  "Distillation Status: started",
  "H2 Local Story Intelligence",
];
const visibleUiBodyHash = createHash("sha256")
  .update(visibleUiRequiredStrings.join("\n"), "utf8")
  .digest("hex");

if (process.env.VERCEL !== "1" && process.env.NOVEL_STATIC_STAMP !== "1") {
  console.log("Skipping static release stamping outside deployment.");
  process.exit(0);
}

if (!verifyReleaseProvenance(releaseProvenance)) {
  throw new Error("BUILD_PROVENANCE_VALIDATION_FAILED");
}

const appCommit = releaseProvenance.appCommit;

const replacements = new Map([
  ["__NOVEL_STATIC_APP_COMMIT__", appCommit],
  ["__NOVEL_STATIC_RELEASE_TAG__", releaseTag],
  ["__NOVEL_STATIC_RELEASE_REVISION__", releaseRevision],
  ["__NOVEL_STATIC_RELEASE_BUILD__", releaseBuild],
  ["__NOVEL_STATIC_RELEASE_PRODUCT_COMMIT__", releaseProductCommit],
  ["__NOVEL_STATIC_RELEASE_BASE_COMMIT__", releaseBaseCommit],
  ["__NOVEL_STATIC_RELEASE_NAME__", releaseName],
  ["__NOVEL_STATIC_CONSUMER_RELEASE__", consumerRelease],
  ["__NOVEL_STATIC_ARCHITECTURE_STAGE__", architectureStage],
  ["__NOVEL_STATIC_GIT_COMMIT_SIGNATURE__", gitCommitSignature],
  ["__NOVEL_STATIC_DEPLOYMENT_PROVENANCE__", deploymentProvenance],
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
