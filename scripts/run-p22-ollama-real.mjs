import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { OllamaProvider } from "../lib/novel-ai/providers/ollama/ollama-provider.ts";
import {
  ClosedStoryGenerationLoop,
  NovelProviderGenerationAdapter,
} from "../lib/novel-ai/generation-loop/index.ts";
import { buildStoryBibleIntelligence } from "../lib/novel-ai/story-intelligence/index.ts";
import { SHORT_URBAN_STORY } from "../tests/fixtures/p22-story-benchmarks.ts";

function source(chapter) {
  return {
    sourceChapterId: chapter.chapterId,
    sourceRevision: chapter.sourceRevision,
    evidenceExcerpt: chapter.content,
    start: 0,
    end: chapter.content.length,
  };
}

const provider = new OllamaProvider({ model: "qwen2.5:3b", timeoutMs: 180_000 });
const health = await provider.ping();
const adapter = new NovelProviderGenerationAdapter(provider);
const loop = new ClosedStoryGenerationLoop(adapter);
const bible = buildStoryBibleIntelligence("p22-real-ollama", SHORT_URBAN_STORY);
const started = Date.now();
let result;
let error = null;
try {
  result = await loop.run({
    requestId: `p22-real-${crypto.randomUUID()}`,
    projectId: "p22-real-ollama",
    branchId: "main",
    taskType: "continue_writing",
    authorInstruction: "林昭必須在午夜前取得監視器備份，但不能單獨違反對警方的承諾。續寫一個有因果與章尾線索的場景。",
    currentText: SHORT_URBAN_STORY[1].content,
    currentChapterId: SHORT_URBAN_STORY[1].chapterId,
    sourceRevision: SHORT_URBAN_STORY[1].sourceRevision,
    storyRevision: 2,
    memories: SHORT_URBAN_STORY.map((chapter, index) => ({
      memoryId: `p22-real-memory-${index}`,
      kind: index ? "current_scene" : "recent_chapter",
      text: chapter.content,
      source: source(chapter),
      metadata: { projectId: "p22-real-ollama", canonical: true, visibility: "project" },
      vectorScore: 0.8,
      recencyScore: index ? 1 : 0.7,
    })),
    canonicalFacts: bible.facts,
    constraints: ["不得違反監視器保留七天的規則", "不得讓林昭無視已答應警方的承諾"],
    styleProfile: ["繁體中文", "第三人稱限知", "都市懸疑"],
    expectedViewpoint: "third_person",
  });
} catch (caught) {
  error = caught instanceof Error ? { name: caught.name, message: caught.message, code: caught.code ?? null } : { message: String(caught) };
}

const candidate = result?.candidates?.[0] ?? null;
const assertions = {
  ollamaReady: health.runtimeStatus === "running" && Boolean(health.selectedModel),
  selectedModel: health.selectedModel === "qwen2.5:3b",
  resultCreated: Boolean(result),
  providerLocal: candidate?.provider === "local-ollama",
  externalRequestCountZero: result?.externalRequestCount === 0,
  canonicalMutationCountZero: result?.canonicalMutationCount === 0,
  finalCandidateNonEmpty: Boolean(candidate?.finalCandidate?.trim()),
  evaluationPresent: Boolean(candidate?.evaluation?.continuityReport),
  sourceReferencesPresent: Boolean(candidate?.retrievedMemory?.sourceReferences?.length),
  candidateAwaitingApproval: candidate?.status === "awaiting_approval",
};
const report = {
  suite: "P2.2 Real Ollama Generation Loop",
  runAt: new Date().toISOString(),
  elapsedMs: Date.now() - started,
  model: health.selectedModel,
  healthStatus: health.status,
  pass: Object.values(assertions).filter(Boolean).length,
  fail: Object.values(assertions).filter((value) => !value).length,
  skip: 0,
  assertions,
  error,
  result,
};
const outputDirectory = path.resolve("artifacts/p22");
fs.mkdirSync(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "ollama-real-generation.json");
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const sha = crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex");
fs.writeFileSync(path.join(outputDirectory, "ollama-real-generation.sha256"), `${sha}  ollama-real-generation.json\n`, "utf8");
console.log(JSON.stringify({
  suite: report.suite,
  elapsedMs: report.elapsedMs,
  model: report.model,
  pass: report.pass,
  fail: report.fail,
  skip: report.skip,
  candidateStatus: candidate?.status ?? null,
  continuityScore: candidate?.evaluation?.continuityReport?.score ?? null,
  error,
}, null, 2));
if (report.fail) process.exitCode = 1;
