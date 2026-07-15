import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { TASK_POLICIES } from "../lib/novel-ai/providers/provider-capabilities.ts";
import { LocalRuleProvider } from "../lib/novel-ai/providers/local-rule-provider.ts";
import { resetAiProviderRegistryForTests, registerAiProvider, listAiProviders, getAiProvider } from "../lib/novel-ai/providers/provider-registry.ts";

const h = createHarness("H1 Provider Contract");
const provider = new LocalRuleProvider();
resetAiProviderRegistryForTests();
registerAiProvider(provider);

const requiredMethods = ["analyzeStory", "extractStoryBible", "summarizeChapter", "checkConsistency", "continueWriting", "rewriteText", "brainstormPlot", "classifyTask", "ping", "getCapabilities", "estimateContext", "cancel"];
for (const method of requiredMethods) h.assert(`method:${method}`, typeof provider[method] === "function");

const capabilities = await provider.getCapabilities();
h.assert("local-rule data stays local", capabilities.dataLeavesDevice === false);
h.assert("local-rule supports structured json", capabilities.capabilities.includes("structured_json"));
h.assert("registry lists provider", listAiProviders().length === 1);
h.assert("registry lookup works", getAiProvider("local-rule")?.id === "local-rule");

const request = { requestId: "h1-provider", projectId: "project", taskType: "simple_summary", input: "第一章：林昭在雨夜發現赤霄劍。", privacyMode: "local_only" };
for (const taskType of ["simple_summary", "story_bible_extraction", "consistency_check", "continue_writing", "rewrite", "plot_brainstorm", "task_classification"]) {
  const typed = { ...request, taskType };
  const result = taskType === "simple_summary"
    ? await provider.summarizeChapter(typed)
    : taskType === "story_bible_extraction"
      ? await provider.extractStoryBible(typed)
      : taskType === "consistency_check"
        ? await provider.checkConsistency(typed)
        : taskType === "continue_writing"
          ? await provider.continueWriting(typed)
          : taskType === "rewrite"
            ? await provider.rewriteText(typed)
            : taskType === "plot_brainstorm"
              ? await provider.brainstormPlot(typed)
              : await provider.classifyTask(typed);
  h.assert(`result contract:${taskType}`, result.provider === "local-rule" && result.requestId === typed.requestId && result.dataLeftDevice === false && typeof result.latencyMs === "number");
}

for (const taskType of Object.keys(TASK_POLICIES).slice(0, 7)) h.assert(`task policy exists:${taskType}`, Boolean(TASK_POLICIES[taskType]));

for (let i = 0; i < 2; i += 1) {
  const health = await provider.ping();
  h.assert(`ping contract:${i}`, health.provider === "local-rule" && health.status === "ready");
}

printAndExit(h.summary({ expectedPass: 30 }));
