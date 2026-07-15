import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { effectivePrivacyMode, externalAllowed } from "../lib/novel-ai/router/privacy-policy.ts";
import { buildContextPlan } from "../lib/novel-ai/router/context-budget.ts";

const h = createHarness("H1 Privacy and Context");
const privacyCases = [
  ["sqlite local only", effectivePrivacyMode({ storageMode: "SQLITE_LOCAL" }) === "local_only"],
  ["full offline local only", effectivePrivacyMode({ storageMode: "SUPABASE_CLOUD", fullOfflineRequired: true }) === "local_only"],
  ["requested external", effectivePrivacyMode({ storageMode: "SUPABASE_CLOUD", requestedPrivacyMode: "external_allowed" }) === "external_allowed"],
  ["local only blocks external", externalAllowed("local_only", true) === false],
  ["local first blocks without explicit", externalAllowed("local_first", false) === false],
  ["external allowed permits", externalAllowed("external_allowed", true) === true],
];
for (const [name, ok] of privacyCases) h.assert(name, ok);

for (let i = 0; i < 19; i += 1) {
  const plan = buildContextPlan({
    chapterCharacters: 5000 + i * 200,
    recentContextCharacters: 1000,
    storyBibleCharacters: 3000,
    sourceExcerptCharacters: 500,
    modelContextWindow: i < 10 ? 4096 : 16000,
  });
  h.assert(`context plan:${i}`, plan.estimatedTokens <= plan.maxContextTokens || plan.summarizationRequired || plan.omittedSections.length > 0);
}

printAndExit(h.summary({ expectedPass: 25 }));
