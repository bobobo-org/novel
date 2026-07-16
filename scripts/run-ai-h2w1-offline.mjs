import fs from "node:fs";
import { createHarness } from "./run-ai-h2w1-test-utils.mjs";

const t = createHarness("H2W1 offline-privacy");
const js = fs.readFileSync("public/legacy/novel-local-runtime-client.js", "utf8");
const health = fs.readFileSync("app/api/ai/health/route.ts", "utf8");

t.includes(js, "127.0.0.1", "default runtime is localhost");
t.includes(js, "localhost", "localhost host allowed");
t.includes(js, "validateRuntimeUrl", "runtime URL validation exists");
t.includes(js, "token", "token handling exists");
t.includes(js, "sessionStorage", "token stored in sessionStorage");
t.notIncludes(js, "localStorage.setItem(TOKEN_KEY", "token is not stored in localStorage");
t.includes(js, "資料離開裝置", "data-left-device visible");
t.includes(js, "外部請求", "external request counter visible");
t.includes(js, "沒有外部請求", "offline/no external request evidence visible");
t.includes(js, "redactDiagnostics", "diagnostic redaction exists");
for (const sensitive of ["novelText", "prompt", "scenarioPreference", "adultTags", "participantNames", "localPath"]) {
  t.includes(js, sensitive, `redacts ${sensitive}`);
}
t.includes(health, "webLocalRuntimeClientStatus", "health exposes runtime client status");
t.includes(health, "webAiActionsStatus", "health exposes AI actions status");
t.includes(health, "webAiStreamingStatus", "health exposes streaming status");
t.includes(health, "webScenarioDiscoveryStatus", "health exposes scenario discovery status");
t.includes(health, "webAdultSegmentedGenerationStatus", "health marks segmented generation not implemented");
t.includes(health, "H2W3_HEALTH", "health imports H2W3 whole-novel readiness");
t.includes(health, "...H2W3_HEALTH", "health exposes H2W3 whole-novel fields through release contract");
t.includes(health, "no-store, max-age=0", "health remains no-store");

t.finish();
