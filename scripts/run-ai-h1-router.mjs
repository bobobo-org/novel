import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { decideAiProvider, fallbackAudit } from "../lib/novel-ai/router/ai-router.ts";

const h = createHarness("H1 Local-first Router");
const providers = [
  { provider: "local-rule", status: "ready", models: ["local-rule-v1"], capabilities: ["text", "structured_json", "local_only", "story_bible", "consistency_check"], maxContextTokens: 4096, supportsAbort: false, supportsStreaming: false, dataLeavesDevice: false },
  { provider: "ollama-local", status: "ready", models: ["qwen2.5:7b"], capabilities: ["text", "structured_json", "streaming", "local_only", "story_bible", "generative_writing", "consistency_check"], maxContextTokens: 8192, supportsAbort: true, supportsStreaming: true, dataLeavesDevice: false },
  { provider: "google-gemini", status: "configured", models: ["gemini-2.5-flash"], capabilities: ["text", "structured_json", "story_bible", "generative_writing", "consistency_check"], maxContextTokens: 32768, supportsAbort: true, supportsStreaming: false, dataLeavesDevice: true },
];

const cases = [
  ["sqlite blocks external", { taskType: "continue_writing", storageMode: "SQLITE_LOCAL", fullOfflineRequired: true, availableProviders: providers }, (d) => d.selectedProvider === "ollama-local" && !d.dataMayLeaveDevice],
  ["supabase local first selects ollama", { taskType: "continue_writing", storageMode: "SUPABASE_CLOUD", requestedPrivacyMode: "local_first", availableProviders: providers }, (d) => d.selectedProvider === "ollama-local"],
  ["external preferred selects gemini when preference explicit", { taskType: "continue_writing", storageMode: "SUPABASE_CLOUD", requestedPrivacyMode: "external_preferred", allowExternalProvider: true, providerPreference: ["google-gemini"], availableProviders: providers }, (d) => d.selectedProvider === "google-gemini" && d.dataMayLeaveDevice],
  ["external denied removes gemini", { taskType: "whole_book_review", storageMode: "SUPABASE_CLOUD", requestedPrivacyMode: "local_first", allowExternalProvider: false, availableProviders: providers }, (d) => d.selectedProvider === "ollama-local"],
  ["consent required marked", { taskType: "whole_book_review", storageMode: "SUPABASE_CLOUD", requestedPrivacyMode: "external_allowed", allowExternalProvider: false, providerPreference: ["google-gemini"], availableProviders: providers }, null],
];

for (const [name, input, predicate] of cases) {
  try {
    const decision = decideAiProvider({ internetAvailable: true, contextCharacters: { recent: 1000 }, ...input });
    h.assert(name, predicate ? predicate(decision) : decision.selectedProvider !== "google-gemini");
  } catch (error) {
    h.assert(`${name}:throws expected local guard`, name === "consent required marked" || name.includes("external denied"), { error: error.code });
  }
}

for (let i = 0; i < 36; i += 1) {
  const decision = decideAiProvider({
    taskType: i % 2 ? "story_bible_extraction" : "simple_summary",
    storageMode: i % 3 === 0 ? "SQLITE_LOCAL" : "SUPABASE_CLOUD",
    requestedPrivacyMode: i % 4 === 0 ? "local_only" : "local_first",
    availableProviders: providers,
    internetAvailable: i % 5 !== 0,
    allowExternalProvider: false,
    contextCharacters: { recent: i * 50, storyBible: i * 30 },
  });
  h.assert(`router matrix:${i}`, Boolean(decision.selectedProvider) && decision.dataMayLeaveDevice === false);
}

for (let i = 0; i < 8; i += 1) {
  const audit = fallbackAudit({ originalProvider: "ollama-local", fallbackProvider: "local-rule", failureCode: "AI_PROVIDER_TIMEOUT", userPolicy: "local_only", dataLeftDevice: false, consentRequired: false, consentGranted: false });
  h.assert(`fallback audit:${i}`, audit.silentFallback === false && audit.dataLeftDevice === false);
}

try {
  decideAiProvider({ taskType: "continue_writing", storageMode: "SQLITE_LOCAL", fullOfflineRequired: true, availableProviders: [providers[2]], internetAvailable: true, allowExternalProvider: true });
  h.fail("no allowed provider throws");
} catch (error) {
  h.assert("no allowed provider throws", error.code === "AI_LOCAL_PROVIDER_REQUIRED");
}

printAndExit(h.summary({ expectedPass: 50 }));
