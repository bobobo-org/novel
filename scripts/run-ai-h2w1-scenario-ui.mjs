import fs from "node:fs";
import { createHarness } from "./run-ai-h2w1-test-utils.mjs";

const t = createHarness("H2W1 scenario-ui");
const js = fs.readFileSync("public/legacy/novel-local-runtime-client.js", "utf8");

t.includes(js, "ADULT_SCENARIO_PACKS", "scenario packs defined");
const packBlock = js.slice(js.indexOf("const scenarioPacks"), js.indexOf("const ADULT_SCENARIO_PACKS"));
const scenarioCount = (packBlock.match(/^\s+\["/gm) ?? []).length;
t.equal(scenarioCount, 16, "sixteen scenario proposal packs available");
for (const text of ["Browse", "Search", "Preferred", "Fresh", "Surprise", "Favorites", "Hidden", "Generate Variation"]) {
  t.includes(js, text, `scenario control ${text}`);
}
for (const field of ["premise", "selectedTags", "roles", "requirements", "location", "tone", "setup", "stagePlan", "purpose", "consequence", "scores", "reasons", "policyStatus"]) {
  t.includes(js, field, `scenario field ${field}`);
}
t.includes(js, "scenario proposal only", "scenario panel is proposal-only");
t.includes(js, "H2P.3", "handoff to later state machine is explicit");
t.includes(js, "favoriteScenario", "favorite action exists");
t.includes(js, "hideScenario", "hide action exists");
t.includes(js, "variationScenario", "variation action exists");
t.includes(js, "scenarioSearch", "search input exists");
t.includes(js, "renderScenarioDiscovery", "scenario renderer exists");
t.includes(js, "scenarioDraft", "scenario variation draft exists");

t.finish();
