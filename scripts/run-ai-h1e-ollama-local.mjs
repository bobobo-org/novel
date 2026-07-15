import { createHarness } from "./h1-test-utils.mjs";
import { checkOllamaHealth } from "../lib/novel-ai/providers/ollama/ollama-health.ts";
import { OllamaProvider } from "../lib/novel-ai/providers/ollama/ollama-provider.ts";

const h = createHarness("H1E Ollama Real Integration");
const health = await checkOllamaHealth();
if (health.status !== "configured" || !health.selectedModel) {
  console.log(JSON.stringify({
    ...h.summary({ notRun: true }),
    reason: "No local Ollama runtime/model detected. Do not mark ollamaStatus=ready or fullOfflineAIStatus=partial_ready.",
    health: { status: health.status, modelCount: health.modelCount, lastErrorCode: health.lastErrorCode },
  }, null, 2));
  process.exit(0);
}
const provider = new OllamaProvider({ model: health.selectedModel });
const request = { requestId: "h1e-real", projectId: "h1e", taskType: "simple_summary", input: "林昭在雨夜握住赤霄劍。", privacyMode: "local_only" };
const summary = await provider.summarizeChapter(request);
h.assert("summary", summary.content.length > 0 && summary.dataLeftDevice === false);
const extraction = await provider.extractStoryBible({ ...request, taskType: "story_bible_extraction" });
h.assert("extraction", extraction.content.length > 0);
const consistency = await provider.checkConsistency({ ...request, taskType: "consistency_check" });
h.assert("consistency", consistency.content.length > 0);
const cont = await provider.continueWriting({ ...request, taskType: "continue_writing" });
h.assert("continue", cont.content.length > 0);
const rewrite = await provider.rewriteText({ ...request, taskType: "rewrite" });
h.assert("rewrite", rewrite.content.length > 0);
const brainstorm = await provider.brainstormPlot({ ...request, taskType: "plot_brainstorm" });
h.assert("brainstorm", brainstorm.content.length > 0);
console.log(JSON.stringify(h.summary({ notRun: false, selectedModel: health.selectedModel }), null, 2));
if (h.summary().fail > 0) process.exit(1);
