import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildProjectBundle,
  createDraft,
} from "../lib/novel-ai/domain/creation.ts";
import { optionalValue } from "../lib/novel-ai/domain/index.ts";
import {
  buildTopicWorldFamilyStageMatrix,
  serializeTopicWorldFamilyDraftSelection,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import {
  createDeviceFallbackStorySeed,
  createCreationStorySeedRequestGate,
  creationStorySeedVariationSeed,
  creationStorySeedPrompt,
  mergeCreationStorySeed,
  parseCreationStorySeed,
  releaseCreationStorySeedRun,
  tryAcquireCreationStorySeedRun,
} from "../lib/novel-ai/web/creation-story-seed.ts";
import {
  classifyPreCreationProviderAvailability,
  probePreCreationProviderAvailability,
  runStudioPreCreationClosedAI,
} from "../lib/novel-ai/web/studio-closed-ai.ts";
import { prewarmClosedAIFromFrontdoor } from "../lib/novel-ai/web/frontdoor-closed-ai-prewarm.ts";
import { scheduleBrowserModelPrewarm } from
  "../lib/novel-ai/providers/browser-ai/browser-prewarm-controller.ts";
import {
  BROWSER_BACKGROUND_PREWARM_CONSENT_KEY,
  grantBrowserBackgroundPrewarmConsent,
  readBrowserBackgroundPrewarmConsent,
  revokeBrowserBackgroundPrewarmConsent,
} from "../lib/novel-ai/providers/browser-ai/browser-background-prewarm-consent.ts";
import { requestConversationExternalProviderSnapshot } from
  "../app/studio/project/[projectId]/chat/external-provider-status-request.ts";

const validModelOutput = `\`\`\`json
{
  "story": "失蹤者留下的鐘，逼一名修復師在月蝕前查出城市遺忘的名字。",
  "protagonist": {
    "name": "顧遙",
    "goal": "在月蝕前找回被抹除的妹妹",
    "weakness": "習慣獨自承擔而拒絕求助"
  },
  "world": {
    "setting": "一座每到午夜就交換居民記憶的山城",
    "rule": "取回一段記憶，必須交出另一段同等重要的記憶"
  },
  "conflict": {
    "main": "顧遙愈接近妹妹，愈可能忘記自己為何要救她",
    "opposition": "靠販賣記憶維持秩序的守鐘人"
  },
  "opening": "顧遙收到一只仍在走動、內側刻著妹妹名字的舊鐘。"
}
\`\`\``;

const parsed = parseCreationStorySeed(validModelOutput);
assert.ok(parsed, "JSON in a model fence should parse");
assert.equal(parsed.protagonist, "顧遙");
assert.match(parsed.worldRule, /取回一段記憶/u);
assert.equal(parseCreationStorySeed('{"story":"不完整"}'), null, "all five semantic groups are required");

const seedRequestGate = createCreationStorySeedRequestGate();
const supersededRequestController = new AbortController();
seedRequestGate.begin(supersededRequestController);
const replacementRequestController = new AbortController();
seedRequestGate.begin(replacementRequestController);
assert.equal(supersededRequestController.signal.aborted, true, "beginning a replacement aborts the old provider request");
assert.equal(supersededRequestController.signal.reason, "CREATE_STORY_SEED_SUPERSEDED");
assert.equal(replacementRequestController.signal.aborted, false);

const synchronousRunLock = { current: false };
let doubleClickExecutorCalls = 0;
let releaseDoubleClickExecutor;
const doubleClickExecutorPending = new Promise((resolve) => {
  releaseDoubleClickExecutor = resolve;
});
const handleSynchronousClick = async () => {
  if (!tryAcquireCreationStorySeedRun(synchronousRunLock)) return false;
  doubleClickExecutorCalls += 1;
  try {
    await doubleClickExecutorPending;
    return true;
  } finally {
    releaseCreationStorySeedRun(synchronousRunLock);
  }
};
const firstSynchronousClick = handleSynchronousClick();
const secondSynchronousClick = handleSynchronousClick();
assert.equal(doubleClickExecutorCalls, 1, "two synchronous clicks start only one provider executor");
assert.equal(await secondSynchronousClick, false, "the same-tick duplicate is rejected before provider work starts");
releaseDoubleClickExecutor();
assert.equal(await firstSynchronousClick, true);
assert.equal(synchronousRunLock.current, false, "the synchronous lock is released after the active request settles");

const staleRequestController = new AbortController();
const staleRequestRevision = seedRequestGate.begin(staleRequestController);
let resolveStaleSeed;
const staleSeedResult = new Promise((resolve) => {
  resolveStaleSeed = resolve;
});
const mergedSeedResults = [];
const staleMergeAttempt = staleSeedResult.then((value) => {
  if (seedRequestGate.isCurrent(staleRequestRevision)) mergedSeedResults.push(value);
});
seedRequestGate.invalidate("CREATE_STORY_SEED_CONTEXT_CHANGED"); // The author switches mode while the old model is still running.
assert.equal(staleRequestController.signal.aborted, true);
assert.equal(staleRequestController.signal.reason, "CREATE_STORY_SEED_CONTEXT_CHANGED");
resolveStaleSeed("old-rpg-seed");
await staleMergeAttempt;
assert.deepEqual(
  mergedSeedResults,
  [],
  "an in-flight seed from the previous mode must not merge after synchronous invalidation",
);
const currentRequestRevision = seedRequestGate.begin(new AbortController());
assert.equal(seedRequestGate.isCurrent(currentRequestRevision), true);
assert.equal(seedRequestGate.isCurrent(staleRequestRevision), false);

const draft = createDraft("quick");
draft.title = "作者保留值";
draft.coreIdea = optionalValue("作者自己寫的一句話故事", "user_defined");
draft.protagonist = optionalValue("作者命名的主角", "user_defined");
draft.answers = {
  language: optionalValue("zh-TW", "user_defined"),
  playMode: optionalValue("general", "user_defined"),
  conflict: optionalValue("作者自己寫的衝突", "user_defined"),
};

const merged = mergeCreationStorySeed(draft, parsed, "closed-ai");
assert.equal(merged.coreIdea.value, "作者自己寫的一句話故事", "AI must preserve authored core idea");
assert.equal(merged.protagonist.value, "作者命名的主角", "AI must preserve authored protagonist");
assert.equal(merged.answers.conflict?.value, "作者自己寫的衝突", "AI must preserve authored conflict");
assert.equal(merged.answers.opening?.value, parsed.opening, "AI fills empty fields");
assert.equal(merged.seedCandidate?.opening.status, "ai_suggested");
assert.equal(merged.seedCandidate?.opening.source, "ai_candidate");

const fallbackDraft = createDraft("quick");
const fallback = mergeCreationStorySeed(fallbackDraft, parsed, "device-fallback");
assert.equal(fallback.seedCandidate?.opening.status, "inferred");
assert.equal(fallback.seedCandidate?.opening.source, "system");

const fallbackVariationDraft = createDraft("quick");
fallbackVariationDraft.title = "三批後備變化測試";
fallbackVariationDraft.coreIdea = optionalValue("作者手寫核心，不可覆寫", "user_defined");
fallbackVariationDraft.answers = {
  ...fallbackVariationDraft.answers,
  conflict: optionalValue("作者手寫衝突，不可覆寫", "user_defined"),
};
const fallbackBatchNonce = "device-fallback-contract-batch";
const fallbackBatches = [1, 2, 3].map((batchOrdinal) => createDeviceFallbackStorySeed({
  batchNonce: fallbackBatchNonce,
  batchOrdinal,
  protagonist: null,
  topic: "懸疑",
  playMode: "general",
  fixedWorld: "一座受同一份正式世界合約約束的山城",
  fixedWorldRule: "每次查證都要留下公開紀錄",
}));
assert.equal(new Set(fallbackBatches.map((seed) => seed.logline)).size, 3, "three fallback batches rotate the core story");
assert.equal(new Set(fallbackBatches.map((seed) => seed.world)).size, 3, "three fallback batches rotate the stage focus while keeping canon");
assert.equal(new Set(fallbackBatches.map((seed) => seed.opening)).size, 3, "three fallback batches rotate the opening event");
let fallbackVariationMerged = fallbackVariationDraft;
for (const seed of fallbackBatches) {
  fallbackVariationMerged = mergeCreationStorySeed(fallbackVariationMerged, seed, "device-fallback");
  assert.equal(fallbackVariationMerged.coreIdea.value, "作者手寫核心，不可覆寫");
  assert.equal(fallbackVariationMerged.answers.conflict?.value, "作者手寫衝突，不可覆寫");
}
assert.equal(
  fallbackVariationMerged.answers.opening?.value,
  fallbackBatches[2].opening,
  "a later device batch replaces only the earlier generated candidate",
);
assert.equal(
  creationStorySeedVariationSeed({ batchNonce: fallbackBatchNonce, batchOrdinal: 1 }),
  creationStorySeedVariationSeed({ batchNonce: fallbackBatchNonce, batchOrdinal: 1 }),
  "a recorded batch seed is deterministic",
);

assert.equal(classifyPreCreationProviderAvailability([
  { id: "browser-ai", status: "runtime_not_installed", capabilities: ["text"], modelId: null, maxContext: 0, local: true, requiresInternet: false, detail: "browser_hybrid_runtime_webllm_preparing" },
  { id: "local-ollama", status: "runtime_unavailable", capabilities: ["text"], modelId: null, maxContext: 0, local: true, requiresInternet: false },
]), "loading", "a browser model still preparing is not treated as absent");
assert.equal(classifyPreCreationProviderAvailability([
  { id: "browser-ai", status: "runtime_unavailable", capabilities: ["text"], modelId: null, maxContext: 0, local: true, requiresInternet: false },
  { id: "local-ollama", status: "runtime_unavailable", capabilities: ["text"], modelId: null, maxContext: 0, local: true, requiresInternet: false },
]), "unavailable", "only a proven two-provider absence allows immediate fallback");
assert.equal(
  classifyPreCreationProviderAvailability([]),
  "unknown",
  "an empty or failed provider probe is not proof that both providers are absent",
);
assert.equal(classifyPreCreationProviderAvailability([
  { id: "browser-ai", status: "degraded", capabilities: ["text"], modelId: null, maxContext: 0, local: true, requiresInternet: false, detail: "transient_probe_failure" },
  { id: "local-ollama", status: "runtime_unavailable", capabilities: ["text"], modelId: null, maxContext: 0, local: true, requiresInternet: false },
]), "unknown", "a transient degraded browser probe must keep the 60-second coordinator alive");
assert.equal(classifyPreCreationProviderAvailability([
  { id: "browser-ai", status: "runtime_unavailable", capabilities: ["text"], modelId: null, maxContext: 0, local: true, requiresInternet: false },
]), "unknown", "one terminal provider without the second provider remains unknown");
assert.deepEqual(
  await probePreCreationProviderAvailability(undefined, async () => {
    throw new Error("transient snapshot transport failure");
  }),
  { availability: "unknown", snapshots: [] },
  "snapshot transport failures keep coordination alive instead of enabling immediate fallback",
);

const canonicalDraft = createDraft("quick");
canonicalDraft.title = "單一建立資料契約";
canonicalDraft.genrePackId = "pack-01";
canonicalDraft.genreId = "classic-topic-001";
canonicalDraft.protagonist = optionalValue("沈星河", "user_defined");
canonicalDraft.answers = {
  ...canonicalDraft.answers,
  playMode: optionalValue("rpg", "user_defined"),
  worldRule: optionalValue("每次取得力量都會留下可追查的代價。", "user_defined"),
  cast: optionalValue([
    "蘇見月｜核心同行者｜與主角互補但會反對冒進｜找回失蹤的宗門弟子",
    "陸沉霄｜對立者｜與主角競逐同一份傳承｜證明自己的道路才是正統",
    "謝知微｜事件推動者｜掌握第一幕的關鍵消息｜查清封山背後的交易",
    "顧青禾｜關鍵見證者｜知道主角過去的一部分真相｜保住證據並選擇公開時機",
    "葉星辭｜家族後勤主事｜與主角有舊日恩義但不盲從｜守住家族撤退與補給線",
  ].join("\n"), "user_defined"),
};
const canonicalMatrix = buildTopicWorldFamilyStageMatrix({
  seed: `novel-project:${canonicalDraft.projectId}:procedural-v1`,
  topicId: canonicalDraft.genreId,
  playMode: "rpg",
});
const canonicalFamily = canonicalMatrix.stageFamilies[0];
const canonicalProtagonist = canonicalFamily.members.find((member) => member.stageRole === "男主角候選");
canonicalDraft.answers.stageFamily = optionalValue(
  serializeTopicWorldFamilyDraftSelection({
    matrix: canonicalMatrix,
    familyId: canonicalFamily.familyId,
    selectedProtagonistId: canonicalProtagonist.characterId,
  }),
  "user_defined",
);
const canonicalBundle = buildProjectBundle(canonicalDraft);
assert.equal(canonicalBundle.protagonist.name, "沈星河", "the selected family protagonist keeps the author-edited name");
assert.equal(canonicalBundle.protagonist.id, canonicalProtagonist.characterId, "renaming never loses the stable selected-person ID");
assert.equal(canonicalBundle.cast.length, 5, "the atomic project bundle owns the full selected-family supporting cast");
assert.deepEqual(
  canonicalBundle.cast.map((character) => character.name),
  ["蘇見月", "陸沉霄", "謝知微", "顧青禾", "葉星辭"],
  "all five author-edited family members remain in the canonical bundle",
);
assert.equal(canonicalBundle.relationships.length, 7, "the atomic bundle keeps the selected family's complete relationship graph");
assert.ok(canonicalBundle.relationships.some((relationship) => /與主角互補但會反對冒進/u.test(relationship.kind)));
assert.deepEqual(
  canonicalBundle.storyBible.characterIds,
  [canonicalBundle.protagonist.id, ...canonicalBundle.cast.map((character) => character.id)],
  "StoryBible character IDs come from the same atomic bundle",
);
assert.deepEqual(
  canonicalBundle.storyBible.relationshipIds,
  canonicalBundle.relationships.map((relationship) => relationship.id),
  "StoryBible relationship IDs come from the same atomic bundle",
);
assert.deepEqual(
  Object.keys(canonicalBundle.storyState.relationships).sort(),
  [canonicalBundle.protagonist.id, ...canonicalBundle.cast.map((character) => character.id)].sort(),
  "StoryState relationship keys use the same full-family character IDs",
);

const prompt = creationStorySeedPrompt({
  title: "測試作品",
  language: "zh-TW",
  playModeLabel: "一般章節寫作",
  topic: "懸疑",
  existing: merged.seedCandidate,
});
assert.match(prompt, /五個頂層欄位/u);
assert.match(prompt, /不得覆寫/u);

const client = await readFile(new URL("../app/studio/create/create-project-client.tsx", import.meta.url), "utf8");
assert.match(client, /CREATION_AI_DEADLINE_MS = 60_000/u, "creation AI has a 60 second hard deadline");
assert.match(client, /runStudioPreCreationClosedAI\(\{/u, "the create page uses the context-free pre-creation Closed AI route");
assert.doesNotMatch(client, /runStudioClosedAI\(\{/u, "creation must not request canonical context for a project that does not exist yet");
assert.match(client, /browserComputePolicy: "balanced"/u, "backend routing remains automatic");
assert.match(client, /這不是逾時/u, "an unavailable model is not mislabeled as a timeout");
assert.match(client, /等待滿 60 秒/u, "the timeout message is reserved for the actual deadline");
assert.match(client, /coordinationBudgetMs: CREATION_AI_DEADLINE_MS/u, "the full deadline is passed into browser-to-Ollama coordination");
assert.match(client, /taskId: `\$\{coordinationTaskIdBase\}-output-\$\{outputRepairAttempt \+ 1\}`/u, "each bounded output stage keeps a stable task identity");
assert.match(client, /create-ai-story-seed-batch/u, "the visible result identifies its candidate batch");
assert.match(client, /createDeviceFallbackStorySeed\(\{/u, "device fallback uses a nonce-driven varied batch");
assert.match(client, /if \(!tryAcquireCreationStorySeedRun\(seedAssistantBusyRef\)\) return;/u, "the click handler takes a synchronous ref lock before provider work");
assert.match(client, /releaseCreationStorySeedRun\(seedAssistantBusyRef\)/u, "the synchronous ref lock is released after the active request settles");
assert.doesNotMatch(client, /if \(seedAssistantBusy\) return;/u, "deferred React state is not the duplicate-request lock");
assert.match(client, /data-testid="cancel-create-ai-story-seed"/u, "generation is cancellable");
assert.match(client, /mergeCreationStorySeed\(current, suggestion, "closed-ai"\)/u);
assert.match(client, /mergeCreationStorySeed\([\s\S]*"device-fallback"/u, "device template is only an explicit fallback");
assert.doesNotMatch(client, /立即產生裝置亂數雛形/u, "the old non-AI primary action is removed");
assert.doesNotMatch(client, /await finish\(\)/u, "AI assistance must not auto-create the project");
assert.match(client, /玩法尚未選定；目前只固定題材、時代、制度與不可變世界規則/u);
assert.match(client, /filter\(\(line\) => !\/本作採用\|採用「一般章節寫作」\/u\.test\(line\)\)/u);
assert.match(client, /if \(currentPlayMode !== mode\) invalidateAssistedSeedForContextChange\(\)/u);
assert.match(client, /if \(playStructure !== structure\) invalidateAssistedSeedForContextChange\(\)/u);
assert.match(client, /CREATE_STORY_SEED_CONTEXT_CHANGED/u);
assert.match(client, /!seedAssistantRequestGateRef\.current\.isCurrent\(requestRevision\)[\s\S]{0,40}\) return/u);

let routedRequest = null;
const preCreationProgress = [];
const preCreationResult = await runStudioPreCreationClosedAI({
  projectId: "unpersisted-creation-draft",
  task: "story_seed",
  input: "建立多人故事雛形",
  browserComputePolicy: "balanced",
  onProgress: (event) => preCreationProgress.push(event),
}, async (request) => {
  routedRequest = request;
  return {
    requestId: request.requestId,
    providerId: "local-ollama",
    modelId: "qwen2.5:3b",
    modelDigest: "sha256:precreation-test",
    content: validModelOutput,
    candidateOnly: true,
    externalRequest: false,
    dataLeavesDevice: false,
    elapsedMs: 1,
    provenance: {
      providerId: "local-ollama",
      modelId: "qwen2.5:3b",
      privacyMode: "strict-local",
      reason: "pre-creation test executor",
      contextSources: [],
      externalRequest: false,
      dataLeavesDevice: false,
      fallbackChain: [],
      warnings: [],
    },
  };
});
assert.equal(routedRequest.projectId, "unpersisted-creation-draft");
assert.equal(routedRequest.taskType, "creation.storySeed");
assert.deepEqual(routedRequest.context, [], "pre-creation inference never tries to load missing canonical project context");
assert.equal(routedRequest.closedOnly, true);
assert.equal(routedRequest.externalConsent, false);
assert.equal(preCreationResult.candidateId, null);
assert.equal(preCreationResult.canonicalMutationCount, 0);
assert.equal(preCreationResult.dataLeftDevice, false);
assert.equal(preCreationResult.externalRequest, false);
assert.equal(preCreationResult.status, "completed");
assert.deepEqual(
  preCreationProgress.map((event) => event.phase),
  ["routing", "evaluating"],
  "the context-free platform path reports the progress milestones it can verify",
);
assert.equal(
  new Set(preCreationProgress.map((event) => event.taskId)).size,
  1,
  "pre-creation progress keeps one task identity",
);
assert.equal(preCreationProgress.at(-1)?.backendId, "local-ollama");

const fallbackRequests = [];
const localRetryProgress = [];
const localRetryResult = await runStudioPreCreationClosedAI({
  projectId: "unpersisted-local-retry-draft",
  task: "story_seed",
  input: "建立可修改的多人故事雛形",
  browserComputePolicy: "balanced",
  coordinationBudgetMs: 60_000,
  onProgress: (event) => localRetryProgress.push(event),
}, async (request) => {
  fallbackRequests.push(request);
  if (fallbackRequests.length === 1) {
    throw Object.assign(new Error("Browser AI requested Local Ollama"), {
      code: "BROWSER_AI_ESCALATE_LOCAL_OLLAMA",
      retryable: true,
    });
  }
  assert.equal(request.preferredProvider, "local-ollama");
  return {
    requestId: request.requestId,
    providerId: "local-ollama",
    modelId: "qwen2.5:3b",
    modelDigest: "sha256:precreation-local-retry",
    content: validModelOutput,
    candidateOnly: true,
    externalRequest: false,
    dataLeavesDevice: false,
    elapsedMs: 2,
    provenance: {
      providerId: "local-ollama",
      modelId: "qwen2.5:3b",
      privacyMode: "strict-local",
      reason: "pre-creation browser-to-local retry",
      contextSources: [],
      externalRequest: false,
      dataLeavesDevice: false,
      fallbackChain: [],
      warnings: [],
    },
  };
});
assert.equal(fallbackRequests.length, 2, "Browser escalation retries exactly once on Local Ollama");
assert.deepEqual(fallbackRequests[1].context, [], "the local retry keeps the pre-creation empty-context boundary");
assert.equal(localRetryResult.provider, "local-ollama");
assert.equal(localRetryResult.canonicalMutationCount, 0);
assert.ok(
  localRetryProgress.some((event) => event.backendId === "local-ollama" && /同一個 60 秒預算內轉交本機 Ollama/u.test(event.label)),
  "the Browser AI escalation is reported as an in-budget Local Ollama handoff, not a device fallback",
);

let terminalExecutorCalls = 0;
await assert.rejects(
  runStudioPreCreationClosedAI({
    projectId: "terminal-precreation-draft",
    task: "story_seed",
    input: "不可重試的設定錯誤必須立即停止",
    browserComputePolicy: "balanced",
  }, async () => {
    terminalExecutorCalls += 1;
    throw Object.assign(new Error("invalid request contract"), {
      code: "CLOSED_AI_BOUNDARY_VIOLATION",
      retryable: false,
    });
  }),
  (error) => error?.code === "CLOSED_AI_BOUNDARY_VIOLATION",
  "terminal Closed AI errors are never converted into polling",
);
assert.equal(terminalExecutorCalls, 1, "a terminal error runs the generator exactly once");

const waitingController = new AbortController();
let waitingExecutorCalls = 0;
let waitingSnapshotReads = 0;
await assert.rejects(
  runStudioPreCreationClosedAI({
    projectId: "unknown-provider-wait-draft",
    task: "story_seed",
    input: "模型暫時未就緒時只等待狀態",
    browserComputePolicy: "balanced",
    coordinationBudgetMs: 10_000,
    signal: waitingController.signal,
  }, async () => {
    waitingExecutorCalls += 1;
    throw Object.assign(new Error("browser model is still preparing"), {
      code: "BROWSER_AI_MODEL_NOT_READY",
      retryable: true,
    });
  }, {
    readSnapshots: async () => {
      waitingSnapshotReads += 1;
      return [];
    },
    wait: async (_delayMs, signal) => {
      waitingController.abort("CREATE_STORY_SEED_TEST_STOP");
      if (signal?.aborted) throw signal.reason;
    },
  }),
  (error) => error === "CREATE_STORY_SEED_TEST_STOP",
  "the waiting coordinator remains cancellable",
);
assert.equal(waitingExecutorCalls, 1, "unknown/loading polling never resends a full generation");
assert.equal(waitingSnapshotReads, 1, "the coordinator checks status before its backoff wait");

let recoveredNow = 0;
let recoveredSnapshotReads = 0;
const recoveredRequests = [];
const recoveredResult = await runStudioPreCreationClosedAI({
  projectId: "provider-recovers-draft",
  task: "story_seed",
  input: "同一個模型從載入中轉成已就緒",
  browserComputePolicy: "balanced",
  coordinationBudgetMs: 10_000,
}, async (request) => {
  recoveredRequests.push(request);
  if (recoveredRequests.length === 1) {
    throw Object.assign(new Error("browser model is warming"), {
      code: "BROWSER_AI_MODEL_NOT_READY",
      retryable: true,
    });
  }
  return {
    requestId: request.requestId,
    providerId: "browser-ai",
    modelId: "browser-test-model",
    modelDigest: "sha256:precreation-browser-recovered",
    content: validModelOutput,
    candidateOnly: true,
    externalRequest: false,
    dataLeavesDevice: false,
    elapsedMs: 2,
    provenance: {
      providerId: "browser-ai",
      modelId: "browser-test-model",
      privacyMode: "strict-local",
      reason: "pre-creation loading-to-ready recovery",
      contextSources: [],
      externalRequest: false,
      dataLeavesDevice: false,
      fallbackChain: [],
      warnings: [],
    },
  };
}, {
  now: () => recoveredNow,
  wait: async (delayMs) => {
    recoveredNow += delayMs;
  },
  readSnapshots: async () => {
    recoveredSnapshotReads += 1;
    return recoveredSnapshotReads === 1
      ? [
          { id: "browser-ai", status: "runtime_not_installed", capabilities: ["text"], modelId: null, maxContext: 0, local: true, requiresInternet: false, detail: "browser_hybrid_runtime_webllm_preparing" },
          { id: "local-ollama", status: "runtime_unavailable", capabilities: ["text"], modelId: null, maxContext: 0, local: true, requiresInternet: false },
        ]
      : [
          { id: "browser-ai", status: "ready", capabilities: ["text"], modelId: "browser-test-model", maxContext: 4096, local: true, requiresInternet: false },
          { id: "local-ollama", status: "runtime_unavailable", capabilities: ["text"], modelId: null, maxContext: 0, local: true, requiresInternet: false },
        ];
  },
});
assert.equal(recoveredResult.provider, "browser-ai");
assert.equal(recoveredRequests.length, 2, "loading-to-ready transition permits one bounded recovery attempt");
assert.equal(recoveredSnapshotReads, 2, "readiness is observed before the recovery attempt");
assert.equal(
  new Set(recoveredRequests.map((request) => request.requestId)).size,
  1,
  "all recovery work preserves one taskId and one candidate batch",
);

const internalDeadlineStartedAt = performance.now();
await assert.rejects(
  runStudioPreCreationClosedAI({
    projectId: "internal-deadline-draft",
    task: "story_seed",
    input: "即使 provider 忽略 signal，協調器本身也必須截止",
    browserComputePolicy: "balanced",
    coordinationBudgetMs: 1_000,
  }, async () => new Promise(() => {})),
  (error) => error?.code === "PRECREATION_COORDINATION_TIMEOUT",
  "the coordinator owns a hard deadline even without a caller AbortSignal",
);
assert.ok(
  performance.now() - internalDeadlineStartedAt < 1_500,
  "the internal deadline settles a hanging provider promptly",
);

let hangingSnapshotExecutorCalls = 0;
const hangingSnapshotStartedAt = performance.now();
await assert.rejects(
  runStudioPreCreationClosedAI({
    projectId: "hanging-snapshot-deadline-draft",
    task: "story_seed",
    input: "狀態查詢不回應也必須由同一硬期限停止",
    browserComputePolicy: "balanced",
    coordinationBudgetMs: 1_000,
  }, async () => {
    hangingSnapshotExecutorCalls += 1;
    throw Object.assign(new Error("provider temporarily unavailable"), {
      code: "BROWSER_AI_MODEL_NOT_READY",
      retryable: true,
    });
  }, {
    readSnapshots: async () => new Promise(() => {}),
  }),
  (error) => error?.code === "PRECREATION_COORDINATION_TIMEOUT",
  "a snapshot reader that ignores AbortSignal cannot hang the coordinator",
);
assert.equal(hangingSnapshotExecutorCalls, 1, "a hanging status probe never causes another generation");
assert.ok(
  performance.now() - hangingSnapshotStartedAt < 1_500,
  "the hard deadline covers provider status probes as well as generation",
);

let frontdoorBrowserSchedules = 0;
let frontdoorLocalWarmups = 0;

const readyBrowserSnapshot = (overrides = {}) => ({
  selectedModelId: "browser-prewarm-test-model",
  activeModelId: null,
  performance: { engineWarm: false },
  models: [{
    modelId: "browser-prewarm-test-model",
    modelDigest: "a".repeat(64),
    metadataRevision: 7,
    installStatus: "ready",
    cacheVerified: true,
    shardIntegrityVerified: true,
    cacheComplete: true,
    allowed: true,
    generationVerified: true,
  }],
  ...overrides,
});
const prewarmEnvironment = {
  browserAvailable: () => true,
  visibilityState: () => "visible",
  navigator: () => ({}),
};
let scheduledIdleJobs = [];
let browserPrewarmCalls = 0;
const sharedPrewarmDependencies = {
  ...prewarmEnvironment,
  snapshot: async () => readyBrowserSnapshot(),
  prewarm: async () => {
    browserPrewarmCalls += 1;
    return {};
  },
  scheduleIdle: (run) => {
    const job = { run, cancelled: false };
    scheduledIdleJobs.push(job);
    return () => { job.cancelled = true; };
  },
};
const firstScheduledWarm = await scheduleBrowserModelPrewarm(
  { policy: "browser-first" },
  sharedPrewarmDependencies,
);
const joinedScheduledWarm = await scheduleBrowserModelPrewarm(
  { policy: "browser-first" },
  sharedPrewarmDependencies,
);
assert.equal(scheduledIdleJobs.length, 1, "concurrent callers must share one idle handle");
scheduledIdleJobs[0].run();
assert.equal((await firstScheduledWarm.completion).status, "warmed");
assert.equal((await joinedScheduledWarm.completion).status, "warmed");
assert.equal(browserPrewarmCalls, 1, "concurrent callers must share one real Browser preload");

scheduledIdleJobs = [];
browserPrewarmCalls = 0;
let resolveSharedPrewarm;
const sharedPendingPrewarm = new Promise((resolve) => { resolveSharedPrewarm = resolve; });
const firstLeaseController = new AbortController();
const secondLeaseController = new AbortController();
const leaseDependencies = {
  ...sharedPrewarmDependencies,
  prewarm: async () => {
    browserPrewarmCalls += 1;
    await sharedPendingPrewarm;
    return {};
  },
};
const firstLeaseWarm = await scheduleBrowserModelPrewarm(
  { policy: "browser-first", signal: firstLeaseController.signal },
  leaseDependencies,
);
const secondLeaseWarm = await scheduleBrowserModelPrewarm(
  { policy: "browser-first", signal: secondLeaseController.signal },
  leaseDependencies,
);
scheduledIdleJobs[0].run();
firstLeaseController.abort("FIRST_STRICT_MODE_LEASE_RELEASED");
assert.equal((await firstLeaseWarm.completion).status, "aborted");
resolveSharedPrewarm();
assert.equal((await secondLeaseWarm.completion).status, "warmed");
assert.equal(browserPrewarmCalls, 1, "one caller abort must not duplicate or kill another lease");

let alreadyWarmIdleSchedules = 0;
const alreadyWarmDecision = await scheduleBrowserModelPrewarm(
  { policy: "browser-first" },
  {
    ...sharedPrewarmDependencies,
    snapshot: async () => readyBrowserSnapshot({
      activeModelId: "browser-prewarm-test-model",
      performance: { engineWarm: true },
    }),
    scheduleIdle: () => {
      alreadyWarmIdleSchedules += 1;
      return () => {};
    },
  },
);
assert.equal((await alreadyWarmDecision.completion).status, "already_warm");
assert.equal(alreadyWarmIdleSchedules, 0, "an already warm matching engine must not schedule idle work");

let incompletePrewarmCalls = 0;
const incompleteModelDecision = await scheduleBrowserModelPrewarm(
  { policy: "browser-first" },
  {
    ...sharedPrewarmDependencies,
    snapshot: async () => readyBrowserSnapshot({
      models: [{
        ...readyBrowserSnapshot().models[0],
        shardIntegrityVerified: false,
        cacheComplete: false,
      }],
    }),
    prewarm: async () => { incompletePrewarmCalls += 1; return {}; },
  },
);
assert.equal((await incompleteModelDecision.completion).status, "not_installed");
assert.equal(incompletePrewarmCalls, 0, "an incomplete or unverified cache must never be preloaded");

const frontdoorInstalledResult = await prewarmClosedAIFromFrontdoor({
  browserBackgroundPrewarmAuthorized: true,
  rememberedLocalInferenceVerified: true,
  signal: new AbortController().signal,
}, {
  scheduleBrowser: async () => {
    frontdoorBrowserSchedules += 1;
    return {
      scheduled: true,
      reasonCode: "PREWARM_IDLE_SCHEDULED",
      completion: Promise.resolve({ status: "warmed", reasonCode: "PREWARM_WARMED" }),
      cancel: () => {},
    };
  },
  prewarmLocal: async () => {
    frontdoorLocalWarmups += 1;
    return true;
  },
});
assert.equal(frontdoorInstalledResult.browser, "PREWARM_WARMED");
assert.equal(frontdoorBrowserSchedules, 1, "the front door schedules an installed Browser model once");
assert.equal(frontdoorLocalWarmups, 0, "a scheduled Browser model does not also wake Local Ollama");

const frontdoorLocalResult = await prewarmClosedAIFromFrontdoor({
  browserBackgroundPrewarmAuthorized: true,
  rememberedLocalInferenceVerified: true,
  signal: new AbortController().signal,
}, {
  scheduleBrowser: async () => ({
    scheduled: false,
    reasonCode: "PREWARM_MODEL_NOT_INSTALLED",
    completion: Promise.resolve({
      status: "not_installed",
      reasonCode: "PREWARM_MODEL_NOT_INSTALLED",
    }),
    cancel: () => {},
  }),
  prewarmLocal: async () => {
    frontdoorLocalWarmups += 1;
    return true;
  },
});
assert.equal(frontdoorLocalResult.local, "warmed");
assert.equal(frontdoorLocalWarmups, 1, "only a previously verified Local session receives one fallback warmup");

const frontdoorHiddenResult = await prewarmClosedAIFromFrontdoor({
  browserBackgroundPrewarmAuthorized: true,
  rememberedLocalInferenceVerified: true,
  signal: new AbortController().signal,
}, {
  scheduleBrowser: async () => ({
    scheduled: false,
    reasonCode: "PREWARM_TAB_HIDDEN",
    completion: Promise.resolve({ status: "aborted", reasonCode: "PREWARM_TAB_HIDDEN" }),
    cancel: () => {},
  }),
  prewarmLocal: async () => {
    frontdoorLocalWarmups += 1;
    return true;
  },
});
assert.equal(frontdoorHiddenResult.local, "not_needed");
assert.equal(frontdoorLocalWarmups, 1, "a hidden/power-limited front door never wakes another runtime");

const frontdoorUnauthorizedResult = await prewarmClosedAIFromFrontdoor({
  browserBackgroundPrewarmAuthorized: false,
  rememberedLocalInferenceVerified: false,
  signal: new AbortController().signal,
}, {
  scheduleBrowser: async () => {
    frontdoorBrowserSchedules += 1;
    throw new Error("UNAUTHORISED_BROWSER_PREWARM_MUST_NOT_RUN");
  },
  prewarmLocal: async () => {
    frontdoorLocalWarmups += 1;
    return true;
  },
});
assert.equal(frontdoorUnauthorizedResult.browser, "PREWARM_NOT_AUTHORIZED");
assert.equal(frontdoorUnauthorizedResult.local, "not_verified");
assert.equal(frontdoorBrowserSchedules, 1, "the front door never inspects or schedules Browser AI without persisted consent");
assert.equal(frontdoorLocalWarmups, 1, "an unverified Local runtime is not woken as a substitute");

const consentValues = new Map();
const consentStorage = {
  getItem: (key) => consentValues.get(key) ?? null,
  setItem: (key, value) => consentValues.set(key, value),
  removeItem: (key) => consentValues.delete(key),
};
assert.equal(readBrowserBackgroundPrewarmConsent(consentStorage), false);
assert.equal(grantBrowserBackgroundPrewarmConsent(consentStorage), true);
assert.equal(consentValues.get(BROWSER_BACKGROUND_PREWARM_CONSENT_KEY), "granted");
assert.equal(readBrowserBackgroundPrewarmConsent(consentStorage), true);
assert.equal(revokeBrowserBackgroundPrewarmConsent(consentStorage), true);
assert.equal(readBrowserBackgroundPrewarmConsent(consentStorage), false);

let providerStatusFetchCalls = 0;
await assert.rejects(
  requestConversationExternalProviderSnapshot({
    timeoutMs: 20,
    fetchImpl: async () => {
      providerStatusFetchCalls += 1;
      return new Promise(() => {});
    },
  }),
  (error) => error?.code === "EXTERNAL_PROVIDER_STATUS_TIMEOUT",
  "a provider-status request that ignores AbortSignal still reaches its own deadline",
);
const recoveredProviderStatus = await requestConversationExternalProviderSnapshot({
  timeoutMs: 100,
  fetchImpl: async () => {
    providerStatusFetchCalls += 1;
    return new Response(JSON.stringify({ providers: [], executionEnabled: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});
assert.equal(providerStatusFetchCalls, 2, "the timed-out shared request is cleared so a later refresh can retry");
assert.deepEqual(recoveredProviderStatus.providers, []);
assert.equal(recoveredProviderStatus.executionEnabled, false);

const abortedBeforeStart = new AbortController();
abortedBeforeStart.abort("CREATE_STORY_SEED_PRE_ABORTED");
let preAbortedExecutorCalled = false;
await assert.rejects(
  runStudioPreCreationClosedAI({
    projectId: "pre-aborted-creation-draft",
    task: "story_seed",
    input: "這次操作在開始前已取消",
    browserComputePolicy: "balanced",
    signal: abortedBeforeStart.signal,
  }, async () => {
    preAbortedExecutorCalled = true;
    throw new Error("PRE_ABORTED_EXECUTOR_MUST_NOT_RUN");
  }),
  (error) => error === "CREATE_STORY_SEED_PRE_ABORTED",
  "a pre-aborted caller never starts provider work",
);
assert.equal(preAbortedExecutorCalled, false);

let markHangingExecutorStarted;
const hangingExecutorStarted = new Promise((resolve) => {
  markHangingExecutorStarted = resolve;
});
const deadlineController = new AbortController();
const callerFacingOperation = runStudioPreCreationClosedAI({
  projectId: "caller-deadline-creation-draft",
  task: "story_seed",
  input: "模擬不尊重此次 signal 的共用連線或 provider promise",
  browserComputePolicy: "balanced",
  signal: deadlineController.signal,
}, async () => {
  markHangingExecutorStarted();
  return new Promise(() => {});
});
await hangingExecutorStarted;
const abortedAt = performance.now();
deadlineController.abort("CREATE_STORY_SEED_TIMEOUT");
await assert.rejects(
  callerFacingOperation,
  (error) => error === "CREATE_STORY_SEED_TIMEOUT",
  "caller abort reason is preserved",
);
assert.ok(
  performance.now() - abortedAt < 250,
  "caller-facing pre-creation work must settle without waiting for a shared hanging promise",
);

console.log(JSON.stringify({
  suite: "create-story-seed-ai",
  passed: 95,
  coordinator: "unified-automatic",
  hardDeadlineMs: 60_000,
  retryStormPrevented: true,
  stableCoordinationTaskId: true,
  frontdoorConditionalPrewarm: true,
  fallbackDistinctBatches: fallbackBatches.length,
  callerAbortRace: true,
  progressMilestones: preCreationProgress.length,
  authoredValuesPreserved: true,
  automaticProjectCreation: false,
  staleModeSeedMergePrevented: true,
}, null, 2));
