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
assert.match(client, /data-testid="cancel-create-ai-story-seed"/u, "generation is cancellable");
assert.match(client, /mergeCreationStorySeed\(current, suggestion, "closed-ai"\)/u);
assert.match(client, /mergeCreationStorySeed\([\s\S]*"device-fallback"/u, "device template is only an explicit fallback");
assert.doesNotMatch(client, /立即產生裝置亂數雛形/u, "the old non-AI primary action is removed");
assert.doesNotMatch(client, /await finish\(\)/u, "AI assistance must not auto-create the project");

let routedRequest = null;
const preCreationResult = await runStudioPreCreationClosedAI({
  projectId: "unpersisted-creation-draft",
  task: "story_seed",
  input: "建立多人故事雛形",
  browserComputePolicy: "balanced",
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

console.log(JSON.stringify({
  suite: "create-story-seed-ai",
  passed: 34,
  coordinator: "unified-automatic",
  hardDeadlineMs: 24_000,
  authoredValuesPreserved: true,
  automaticProjectCreation: false,
}, null, 2));
