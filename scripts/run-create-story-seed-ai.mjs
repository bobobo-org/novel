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
  createCreationStorySeedRequestGate,
  creationStorySeedPrompt,
  mergeCreationStorySeed,
  parseCreationStorySeed,
} from "../lib/novel-ai/web/creation-story-seed.ts";
import { runStudioPreCreationClosedAI } from "../lib/novel-ai/web/studio-closed-ai.ts";

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
assert.match(client, /CREATION_AI_DEADLINE_MS = 24_000/u, "creation AI has a hard deadline");
assert.match(client, /runStudioPreCreationClosedAI\(\{/u, "the create page uses the context-free pre-creation Closed AI route");
assert.doesNotMatch(client, /runStudioClosedAI\(\{/u, "creation must not request canonical context for a project that does not exist yet");
assert.match(client, /browserComputePolicy: "balanced"/u, "backend routing remains automatic");
assert.match(client, /這不是逾時/u, "an unavailable model is not mislabeled as a timeout");
assert.match(client, /等待滿 24 秒/u, "the timeout message is reserved for the actual deadline");
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
const localRetryResult = await runStudioPreCreationClosedAI({
  projectId: "unpersisted-local-retry-draft",
  task: "story_seed",
  input: "建立可修改的多人故事雛形",
  browserComputePolicy: "balanced",
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
  passed: 64,
  coordinator: "unified-automatic",
  hardDeadlineMs: 24_000,
  callerAbortRace: true,
  progressMilestones: preCreationProgress.length,
  authoredValuesPreserved: true,
  automaticProjectCreation: false,
  staleModeSeedMergePrevented: true,
}, null, 2));
