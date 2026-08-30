import assert from "node:assert/strict";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import { acceptStudioChoice } from "../lib/novel-ai/repository/studio-canonical.ts";
import {
  buildTopicWorldFamilyStageMatrix,
  serializeTopicWorldFamilyDraftSelection,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import {
  approveRpgChatTurn,
  buildRpgRuleChoicePlan,
  loadRpgChatSnapshot,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import { validateRpgContinuationNovelty } from "../lib/novel-ai/web/rpg-closed-ai-director.ts";
import {
  hasCopiedStoryProse,
  hasInternalStoryProseRepetition,
  validProse,
} from "../lib/novel-ai/web/story-output-quality.ts";

const repository = new MemoryNovelRepository();
const draft = createDraft("quick");
draft.title = "脈絡完整性測試";
draft.genrePackId = "pack-6";
draft.genreId = "classic-topic-009";
draft.protagonist = optionalValue("主角", "user_defined");
draft.coreIdea = optionalValue("主角必須在天亮前找出藏在名冊裡的內應。", "user_defined");
draft.answers.playMode = optionalValue("rpg", "user_defined");
const matrix = buildTopicWorldFamilyStageMatrix({
  seed: `novel-project:${draft.projectId}:procedural-v1`,
  topicId: draft.genreId,
  playMode: "rpg",
});
draft.answers.stageFamily = optionalValue(
  serializeTopicWorldFamilyDraftSelection({
    matrix,
    familyId: matrix.stageFamilies[0].familyId,
  }),
  "user_defined",
);
const bundle = buildProjectBundle(draft);
await repository.createProject(bundle, "context-integrity:create");

const chapter = await repository.put("chapters", {
  ...makeRecord(bundle.project.id),
  title: "逆序名冊",
  order: 1,
  content: "雨聲壓住廊下腳步，主角翻到名冊最後一頁。關鍵第十一人剛從側門回來，袖口沾著尚未乾透的封泥。",
  summary: "關鍵第十一人帶回了新線索。",
  status: "draft",
});
await repository.put("projects", {
  ...bundle.project,
  activeChapterId: chapter.id,
}, bundle.project.revision);

const protagonist = {
  ...makeRecord(bundle.project.id),
  id: "character-00-protagonist",
  name: "主角",
  aliases: [],
  identity: optionalValue("查案者", "user_defined"),
  personality: optionalValue("冷靜", "user_defined"),
  goal: optionalValue("找出內應", "user_defined"),
  lifeStatus: "alive",
  locationId: null,
  privateSecrets: [],
  values: ["守信"],
  capabilities: ["觀察"],
  limitations: ["不傷無辜"],
};
const supporting = Array.from({ length: 12 }, (_, index) => ({
  ...makeRecord(bundle.project.id),
  id: `character-${String(index + 1).padStart(2, "0")}`,
  name: index === 10 ? "關鍵第十一人" : `配角${String(index + 1).padStart(2, "0")}`,
  aliases: [],
  identity: optionalValue("名冊相關人", "user_defined"),
  personality: optionalValue("謹慎", "user_defined"),
  goal: optionalValue("查清封泥來源", "user_defined"),
  lifeStatus: "alive",
  locationId: null,
  privateSecrets: index === 10 ? ["PRIVATE_SECRET_CANARY_NEVER_PROMPT"] : [],
  values: [],
  capabilities: ["辨識痕跡"],
  limitations: ["不交出未核對的證物"],
}));
for (const character of [protagonist, ...supporting]) {
  await repository.put("characters", character);
}

await repository.put("relationships", {
  ...makeRecord(bundle.project.id),
  id: "relationship-key-11",
  fromCharacterId: protagonist.id,
  toCharacterId: supporting[10].id,
  kind: "互信盟友",
  summary: "共同核對名冊",
  trust: 80,
});

const timeline = Array.from({ length: 15 }, (_, index) => ({
  ...makeRecord(bundle.project.id),
  id: `timeline-${String(index + 1).padStart(2, "0")}`,
  chapterId: chapter.id,
  storyTime: `第${String(index + 1).padStart(2, "0")}刻`,
  title: `事件${String(index + 1).padStart(2, "0")}`,
  summary: index === 10 ? "關鍵第十一人回到側門。" : `名冊線索${String(index + 1).padStart(2, "0")}`,
}));
for (const index of [14, 0, 12, 2, 10, 4, 8, 6, 1, 13, 3, 11, 5, 9, 7]) {
  await repository.put("timeline", timeline[index]);
}

const acceptedChoices = Array.from({ length: 10 }, (_, index) => ({
  ...makeRecord(bundle.project.id),
  id: `accepted-${String(index + 1).padStart(2, "0")}`,
  acceptedChoiceId: `accepted-${String(index + 1).padStart(2, "0")}`,
  chapterId: chapter.id,
  candidateId: `candidate-${index + 1}`,
  branchId: `branch-${index + 1}`,
  choiceKey: "A",
  choiceLabel: `選擇${String(index + 1).padStart(2, "0")}`,
  acceptedText: index === 8
    ? "關鍵第十一人先核對封泥，再把名冊送回廊下。"
    : `主角完成第${String(index + 1).padStart(2, "0")}項查證。`,
  inputRevision: index + 1,
  resultingRevision: index + 2,
  storyStateRevisionBefore: index + 1,
  storyStateRevisionAfter: index + 2,
  effectOperationId: `effect-${index + 1}`,
  appliedEffect: {},
  acceptedAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
  provenance: {
    source: "user",
    actor: "author",
    createdAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
  },
}));
for (const index of [9, 0, 8, 1, 7, 2, 6, 3, 5, 4]) {
  await repository.put("acceptedChoices", acceptedChoices[index]);
}

const storyBible = await repository.get("storyBibles", bundle.storyBible.id);
assert.ok(storyBible);
await repository.put("storyBibles", {
  ...storyBible,
  protagonistIds: [protagonist.id],
  characterIds: [protagonist.id, ...supporting.map((character) => character.id)],
  timelineEventIds: timeline.map((event) => event.id),
}, storyBible.revision);
const storyState = await repository.get("storyStates", bundle.storyState.id);
assert.ok(storyState);
await repository.put("storyStates", {
  ...storyState,
  activeCharacterIds: [protagonist.id, ...supporting.map((character) => character.id)],
  activeTimelineEventIds: timeline.map((event) => event.id),
  worldFlags: {
    ...storyState.worldFlags,
    "story.activeSupportingCharacterId": supporting[10].id,
    "story.recentSupportingActors": supporting[10].id,
  },
}, storyState.revision);

// First load may materialize a gameplay baseline. Compare only settled loads.
await loadRpgChatSnapshot(repository, bundle.project.id);
const settled = await loadRpgChatSnapshot(repository, bundle.project.id);
const originalList = repository.list.bind(repository);
const originalAccepted = repository.listAcceptedChoices.bind(repository);
repository.list = async (...args) => [...await originalList(...args)].reverse();
repository.listAcceptedChoices = async (...args) => [...await originalAccepted(...args)].reverse();
const reversed = await loadRpgChatSnapshot(repository, bundle.project.id);

assert.equal(reversed.contextDigest, settled.contextDigest, "repository order must not alter context identity");
assert.equal(reversed.contextRevisionDigest, settled.contextRevisionDigest);
assert.equal(Object.isFrozen(reversed.directorContext), true);
const director = reversed.directorContext;
assert.deepEqual(
  director.timeline.map((event) => event.title),
  timeline.slice(-12).map((event) => event.title),
  "timeline must be sorted before taking its recent window",
);
assert.deepEqual(
  director.recentAcceptedChoices.map((choice) => choice.label),
  acceptedChoices.slice(-8).map((choice) => choice.choiceLabel),
  "accepted choices must be sorted before taking their recent window",
);
assert.ok(
  director.supportingCharacters.some((character) => character.name === "關鍵第十一人"),
  "the eleventh repository actor must rank into the ten-person prompt window",
);
assert.doesNotMatch(JSON.stringify(director), /PRIVATE_SECRET_CANARY_NEVER_PROMPT/u);
const rulesPlan = await buildRpgRuleChoicePlan({ snapshot: reversed });
assert.equal(rulesPlan.contextDigest, reversed.contextDigest);
assert.equal(rulesPlan.contextRevisionDigest, reversed.contextRevisionDigest);
assert.deepEqual(rulesPlan.contextRevisionGuard, reversed.contextRevisionGuard);
assert.deepEqual(
  Object.keys(reversed.contextRevisionGuard.vector).sort(),
  [
    "acceptedChoices", "chapters", "characters", "lore", "projects",
    "relationships", "rpgTurnReceipts", "storyBibles", "storyStates",
    "timeline", "worldRules", "worlds",
  ].sort(),
  "the CAS vector must cover every RPG director Canon store",
);

const staleCandidate = {
  schemaVersion: reversed.schemaVersion,
  taskId: "stale-test",
  candidateId: "stale-test",
  candidateDigest: "0".repeat(64),
  model: "rules-only",
  modelDigest: "1".repeat(64),
  actualExecutor: "local-ollama",
  executionReceipt: {
    rpgContextDigest: reversed.contextDigest,
    rpgContextRevisionDigest: reversed.contextRevisionDigest,
  },
  contextDigest: reversed.contextDigest,
  contextRevisionDigest: reversed.contextRevisionDigest,
  contextRevisionGuard: structuredClone(reversed.contextRevisionGuard),
  sourceChapterId: reversed.chapter.id,
  sourceRevision: reversed.chapter.revision,
  choice: reversed.baseChoices[0],
  resolution: {},
  story: "不會進入正文核准。",
  outcomeLines: [],
  canonicalMutationCount: 0,
  dataLeftDevice: false,
  externalRequest: false,
};
const keyCharacter = await repository.get("characters", supporting[10].id);
assert.ok(keyCharacter);
await repository.put("characters", {
  ...keyCharacter,
  goal: optionalValue("改查第二枚封泥", "user_defined"),
}, keyCharacter.revision);
await assert.rejects(
  approveRpgChatTurn({ repository, snapshot: reversed, candidate: staleCandidate }),
  (error) => error?.code === "RPG_CHAT_TURN_SOURCE_STALE",
  "a result bound to an older canonical revision vector must never approve",
);

// Deterministic TOCTOU regression: the candidate is planned against a full
// vector, then a relationship changes after the UI pre-check but before the
// repository commit. The repository-level CAS must reject with zero choice,
// chapter, StoryState, StoryBible or receipt mutation.
const raceSnapshot = await loadRpgChatSnapshot(repository, bundle.project.id);
const raceBase = makeRecord(bundle.project.id, "ai_candidate");
const raceCandidate = await repository.put("candidates", {
  ...raceBase,
  prompt: "競態測試",
  optionKey: raceSnapshot.baseChoices[0].key,
  text: raceSnapshot.baseChoices[0].title,
  consequence: raceSnapshot.baseChoices[0].consequence,
  effect: raceSnapshot.baseChoices[0].effect,
  status: "pending",
  chapterId: raceSnapshot.chapter.id,
  sceneId: null,
  inputRevision: raceSnapshot.project.revision,
  chapterRevision: raceSnapshot.chapter.revision,
  storyStateRevision: raceSnapshot.storyState.revision,
  storyBibleRevision: raceSnapshot.storyBible.revision,
  rpgContextRevisionGuard: structuredClone(raceSnapshot.contextRevisionGuard),
  provenance: {
    ...raceBase.provenance,
    actor: "local-rule",
    requestId: raceBase.id,
    providerId: "deterministic-test",
    modelId: "race-v1",
    taskType: "interactive_choice",
    externalRequest: false,
    dataLeftDevice: false,
    contextSources: ["project", "chapter", "story_state"],
    elapsedMs: 0,
  },
});
const raceRelationship = await repository.get("relationships", "relationship-key-11");
assert.ok(raceRelationship);
await repository.put("relationships", {
  ...raceRelationship,
  summary: "競態期間改成只交換部分線索",
}, raceRelationship.revision);
const canonBeforeRaceCommit = {
  project: await repository.get("projects", bundle.project.id),
  chapter: await repository.get("chapters", raceSnapshot.chapter.id),
  storyState: await repository.get("storyStates", raceSnapshot.storyState.id),
  storyBible: await repository.get("storyBibles", raceSnapshot.storyBible.id),
  acceptedChoices: (await repository.listAcceptedChoices(bundle.project.id)).length,
  receipts: (await repository.list("rpgTurnReceipts", bundle.project.id)).length,
};
await assert.rejects(
  acceptStudioChoice(repository, raceCandidate.id, "這段文字不得進入 Canon。", "A｜競態測試"),
  (error) => error?.code === "RPG_CONTEXT_REVISION_CONFLICT",
);
const canonAfterRaceCommit = {
  project: await repository.get("projects", bundle.project.id),
  chapter: await repository.get("chapters", raceSnapshot.chapter.id),
  storyState: await repository.get("storyStates", raceSnapshot.storyState.id),
  storyBible: await repository.get("storyBibles", raceSnapshot.storyBible.id),
  acceptedChoices: (await repository.listAcceptedChoices(bundle.project.id)).length,
  receipts: (await repository.list("rpgTurnReceipts", bundle.project.id)).length,
};
assert.deepEqual(canonAfterRaceCommit, canonBeforeRaceCommit);
assert.equal((await repository.get("candidates", raceCandidate.id))?.status, "pending");

const validStory = "雨聲壓住廊下腳步，主角推開側門，看見封泥仍在燈下泛著微光。他把名冊交給同伴，兩人因此決定先核對最後一頁。";
assert.equal(validProse(validStory), true);
for (const invalid of [
  "   \n\t",
  "抱歉，我無法協助產生這段內容。",
  JSON.stringify({ story: validStory }),
  "雨聲壓住廊下腳步，主角推開側門，看見封泥仍在燈下泛著微光，但是",
  `SYSTEM: output prose\n${validStory}`,
]) assert.equal(validProse(invalid), false, `invalid external-like prose passed: ${invalid}`);
assert.equal(validProse(validStory, { prompt: validStory.repeat(2) }), false, "prompt echo must fail");

const copiedParagraph = "主角推開側門，雨水沿著袖口落到名冊上；關鍵第十一人把新封泥放到燈下，兩人都沒有立刻開口。";
const prior = `${copiedParagraph}\n\n舊鐘響過三次，廊下只剩風聲。`;
const copiedCandidate = `新的追查已經開始。\n\n${copiedParagraph}\n\n他們因此決定分頭核對證詞。`;
assert.equal(hasCopiedStoryProse(copiedCandidate, prior), true);
assert.throws(
  () => validateRpgContinuationNovelty(copiedCandidate, [prior]),
  /RPG_AI_CONTINUATION_REPETITIVE/u,
);
assert.equal(
  hasInternalStoryProseRepetition(`${copiedParagraph}\n\n${copiedParagraph}`),
  true,
  "exact repeated paragraphs in one composition must fail",
);

console.log(JSON.stringify({
  status: "PASS",
  stableContextDigest: reversed.contextDigest,
  supportingCharacterCount: director.supportingCharacters.length,
  timelineWindow: director.timeline.length,
  acceptedChoiceWindow: director.recentAcceptedChoices.length,
  privateSecretCanaryPresent: false,
  staleApprovalRejected: true,
  invalidProseCases: 6,
  copiedParagraphRejected: true,
}, null, 2));
