import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { decideAiProvider } from "../lib/novel-ai/router/ai-router.ts";

const h = createHarness("H1 Offline Matrix");
const providers = [
  { provider: "local-rule", status: "ready", models: ["local-rule-v1"], capabilities: ["text", "structured_json", "local_only", "story_bible", "consistency_check"], maxContextTokens: 4096, supportsAbort: false, supportsStreaming: false, dataLeavesDevice: false },
  { provider: "ollama-local", status: "ready", models: ["qwen2.5:7b"], capabilities: ["text", "structured_json", "streaming", "local_only", "story_bible", "generative_writing", "consistency_check"], maxContextTokens: 8192, supportsAbort: true, supportsStreaming: true, dataLeavesDevice: false },
  { provider: "google-gemini", status: "configured", models: ["gemini"], capabilities: ["text", "structured_json", "story_bible", "generative_writing"], maxContextTokens: 32768, supportsAbort: true, supportsStreaming: false, dataLeavesDevice: true },
];
for (let i = 0; i < 20; i += 1) {
  const decision = decideAiProvider({
    taskType: i % 2 ? "continue_writing" : "story_bible_extraction",
    storageMode: "SQLITE_LOCAL",
    fullOfflineRequired: true,
    internetAvailable: false,
    allowExternalProvider: false,
    availableProviders: providers,
    contextCharacters: { recent: 1000 + i },
  });
  h.assert(`offline no external:${i}`, decision.dataMayLeaveDevice === false && !decision.orderedFallbackChain.includes("google-gemini"));
}
printAndExit(h.summary({ expectedPass: 20 }));
