import assert from "node:assert/strict";
import fs from "node:fs";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import { composeProjectContext } from "../lib/novel-ai/web/project-context-composer.ts";
import { BROWSER_SEMANTIC_MODEL } from "../lib/novel-ai/providers/browser-ai/browser-semantic-model-registry.ts";

const projectId = "browser-semantic-rag-project";
const now = "2026-08-01T00:00:00.000Z";
const repository = new MemoryNovelRepository();
await repository.put("projects", {
  id: projectId,
  projectId,
  title: "語意檢索測試作品",
  activeChapterId: null,
  storyBibleId: null,
  storyStateId: null,
  revision: 1,
  parentRevision: null,
  createdAt: now,
  updatedAt: now,
});

const baseInput = {
  repository,
  taskType: "chapter.continue",
  projectId,
  privacyLevel: "device_only",
  semanticQuery: "主角追查帳冊與失蹤證人",
  supplementalContext: [
    {
      id: "context:unrelated",
      kind: "memory",
      text: "午後甜點完成，眾人在花園喝茶。",
      visibility: "both",
      privacyLevel: "device_only",
      approved: true,
    },
    {
      id: "context:related",
      kind: "memory",
      text: "主角沿著帳冊上的暗號追查失蹤證人與密室線索。",
      visibility: "both",
      privacyLevel: "device_only",
      approved: true,
    },
  ],
};

let rankerCalls = 0;
const semantic = await composeProjectContext({
  ...baseInput,
  semanticRanker: async ({ query, items }) => {
    rankerCalls += 1;
    assert.match(query, /帳冊/u);
    assert.ok(items.some((item) => item.id === "context:related"));
    return {
      scores: items.map((item) => ({
        id: item.id,
        score: item.id === "context:related" ? 0.94 : item.id === "context:unrelated" ? 0.08 : 0.4,
      })),
      modelId: BROWSER_SEMANTIC_MODEL.modelId,
      modelDigest: BROWSER_SEMANTIC_MODEL.modelDigest,
      cacheHit: false,
      dataLeftDevice: false,
    };
  },
});

assert.equal(rankerCalls, 1);
assert.equal(semantic.contextSourceSummary.ranking.mode, "semantic");
assert.equal(semantic.contextSourceSummary.ranking.dataLeftDevice, false);
assert.equal(semantic.contextSourceSummary.ranking.modelDigest, BROWSER_SEMANTIC_MODEL.modelDigest);
assert.ok(
  semantic.context.findIndex((item) => item.id === "context:related")
    < semantic.context.findIndex((item) => item.id === "context:unrelated"),
  "semantic rank must order equally authoritative context by relevance",
);

const fallback = await composeProjectContext({
  ...baseInput,
  semanticRanker: async () => {
    throw Object.assign(new Error("not installed"), { code: "BROWSER_SEMANTIC_MODEL_NOT_INSTALLED" });
  },
});
assert.equal(fallback.contextSourceSummary.ranking.mode, "priority");
assert.equal(
  fallback.contextSourceSummary.ranking.fallbackReason,
  "BROWSER_SEMANTIC_MODEL_NOT_INSTALLED",
);
assert.ok(fallback.context.length > 0, "priority fallback must keep the local writing flow usable");

assert.equal(BROWSER_SEMANTIC_MODEL.sourceRevision.length, 40);
assert.equal(BROWSER_SEMANTIC_MODEL.files.length, 4);
assert.ok(BROWSER_SEMANTIC_MODEL.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256)));
assert.equal(BROWSER_SEMANTIC_MODEL.integrityScope.weightSha256, true);
assert.equal(BROWSER_SEMANTIC_MODEL.integrityScope.tokenizerSha256, true);

const runtimeSource = fs.readFileSync(
  new URL("../lib/novel-ai/providers/browser-ai/browser-semantic-runtime.ts", import.meta.url),
  "utf8",
);
const workerSource = fs.readFileSync(
  new URL("../lib/novel-ai/providers/browser-ai/browser-semantic-worker.ts", import.meta.url),
  "utf8",
);
const workspaceSource = fs.readFileSync(
  new URL("../app/studio/project/[projectId]/closed-ai/closed-ai-workspace.tsx", import.meta.url),
  "utf8",
);
assert.match(workerSource, /local_files_only:\s*!allowRemote/u);
assert.match(workerSource, /env\.allowLocalModels\s*=\s*!allowRemote/u);
assert.match(workerSource, /env\.allowRemoteModels\s*=\s*allowRemote/u);
assert.match(workerSource, /ensureTokenizerCallability/u);
assert.match(workerSource, /new BertTokenizer/u);
assert.match(workerSource, /loadPinnedJson\("tokenizer_config\.json"/u);
assert.match(workerSource, /explicit_callability_restored/u);
assert.match(runtimeSource, /semanticDeviceCandidates/u);
assert.match(runtimeSource, /validateSemanticInference/u);
assert.match(runtimeSource, /embedWithDeviceFallback/u);
assert.match(runtimeSource, /WebGPU 推理不相容，已自動切換 WASM/u);
assert.match(runtimeSource, /progress\.status === "ready"/u);
assert.match(runtimeSource, /BROWSER_SEMANTIC_RUNTIME_REVISION/u);
assert.match(runtimeSource, /clearSemanticModelCacheFiles/u);
assert.match(runtimeSource, /repairStaleBrowserSemanticRuntime/u);
assert.match(runtimeSource, /舊版或失敗快取檔/u);
assert.match(runtimeSource, /首次載入失敗，已自動清除/u);
assert.match(runtimeSource, /lastErrorCode/u);
assert.match(workspaceSource, /repairStaleBrowserSemanticRuntime/u);
assert.match(workspaceSource, /清除快取並重新安裝/u);
assert.match(runtimeSource, /rawTextStored:\s*false/u);
assert.match(runtimeSource, /candidateOnly:\s*true/u);
assert.match(runtimeSource, /canonicalMutation:\s*false/u);
assert.match(runtimeSource, /namespace:\s*input\.namespace/u);
assert.match(runtimeSource, /invalidateBrowserSemanticCache/u);

console.log(JSON.stringify({
  status: "PASS",
  semanticModel: BROWSER_SEMANTIC_MODEL.modelId,
  pinnedRevision: BROWSER_SEMANTIC_MODEL.sourceRevision,
  integrityFiles: BROWSER_SEMANTIC_MODEL.files.length,
  layeredRag: true,
  priorityFallback: true,
  dataLeftDevice: false,
  rawTextStored: false,
}, null, 2));
