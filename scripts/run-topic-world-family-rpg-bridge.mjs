import assert from "node:assert/strict";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import {
  buildTopicWorldFamilyStageMatrix,
  serializeTopicWorldFamilyDraftSelection,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import {
  buildDeterministicRpgChatTurnCandidate,
  loadRpgChatSnapshot,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import { buildRpgResolutionDirectorPrompt } from "../lib/novel-ai/web/rpg-closed-ai-director.ts";

const INTERNAL_COPY = /核准規則|規則校準|關係張力|下一回合|下一輪可用|因果維度|世界契約|題材契約|所屬家族\s*ID|contractStatement|canonicalStatus|schemaVersion|VIRTUAL_CANDIDATE/iu;
const OPAQUE_FAMILY_ID = /social-(?:family|institution)-[^\s，。；、)）]+/iu;

const repository = new MemoryNovelRepository();
const draft = createDraft("quick");
draft.title = "家族宗門正文橋接測試";
draft.genreId = "classic-topic-009";
draft.answers.playMode = optionalValue("rpg", "user_defined");
const stageMatrix = buildTopicWorldFamilyStageMatrix({
  seed: `novel-project:${draft.projectId}:procedural-v1`,
  topicId: draft.genreId,
  playMode: "rpg",
});
draft.answers.stageFamily = optionalValue(
  serializeTopicWorldFamilyDraftSelection({
    matrix: stageMatrix,
    familyId: stageMatrix.stageFamilies[0].familyId,
  }),
  "user_defined",
);
const bundle = buildProjectBundle(draft);
await repository.createProject(bundle, "family-stage:rpg-bridge");

const cast = [bundle.protagonist, ...(bundle.cast ?? [])].filter(Boolean);
assert.ok(cast.length >= 6);
const protagonist = bundle.protagonist ?? cast[0];
const chapter = await repository.put("chapters", {
  ...makeRecord(bundle.project.id),
  title: "山門夜訊",
  order: 1,
  content: `${protagonist.name}在山門燈火將熄時收到密信；家族、宗門與坊市同時派人抵達，爭奪一件足以改變修行局勢的寶物。`,
  summary: "多方勢力在山門相遇。",
  status: "draft",
});
await repository.put("projects", {
  ...bundle.project,
  activeChapterId: chapter.id,
}, bundle.project.revision);

const snapshot = await loadRpgChatSnapshot(repository, bundle.project.id);
const context = snapshot.directorContext;
assert.ok(context.selectedStageFamily?.name);
assert.equal(context.stagedOrganizations.length, 4);
assert.equal(context.stagedAssets.length, 8);
assert.deepEqual(
  new Set(context.stagedOrganizations.map((organization) => organization.kind)),
  new Set(["宗門", "修行家族", "散修盟", "坊市"]),
);
for (const category of ["功法", "丹藥", "符籙", "陣法", "法器", "靈草", "秘境"]) {
  assert.ok(context.stagedAssets.some((asset) => asset.category === category), category);
}
const promptContextText = JSON.stringify({
  selectedStageFamily: context.selectedStageFamily,
  stagedOrganizations: context.stagedOrganizations,
  stagedAssets: context.stagedAssets,
  lore: context.lore,
});
assert.doesNotMatch(promptContextText, INTERNAL_COPY);
assert.doesNotMatch(promptContextText, OPAQUE_FAMILY_ID);
assert.ok(snapshot.baseChoices.some((choice) => (
  choice.description.includes(context.selectedStageFamily.name)
  || context.stagedOrganizations.some((organization) => choice.description.includes(organization.name))
  || context.stagedAssets.some((asset) => choice.description.includes(asset.name))
)));

const choice = snapshot.baseChoices.find((candidate) => !candidate.disabledReason);
assert.ok(choice);
const candidate = await buildDeterministicRpgChatTurnCandidate({
  snapshot,
  choice,
  failureReason: "FAMILY_STAGE_BRIDGE_TEST",
});
const activeAssetId = candidate.resolution.effect.worldFlags?.["story.activeStageAssetLoreId"];
assert.equal(typeof activeAssetId, "string");
const activeAsset = context.stagedAssets.find((asset) => {
  const lore = (bundle.lore ?? []).find((entry) => entry.id === activeAssetId);
  return lore?.title.endsWith(`｜${asset.name}`);
});
assert.ok(activeAsset);
assert.ok(candidate.story.includes(context.selectedStageFamily.name));
assert.ok(candidate.story.includes(activeAsset.name));
for (const actor of [activeAsset.controller, activeAsset.holder, activeAsset.claimant].filter(Boolean)) {
  assert.ok(candidate.story.includes(actor), actor);
}
assert.ok(cast.filter((character) => candidate.story.includes(character.name)).length >= 3);
assert.doesNotMatch(candidate.story, INTERNAL_COPY);
assert.doesNotMatch(candidate.story, OPAQUE_FAMILY_ID);

const prompt = buildRpgResolutionDirectorPrompt({
  context,
  choice,
  language: "zh-TW",
  resolution: {
    outcomeLabel: candidate.resolution.outcomeLabel,
    roll: candidate.resolution.roll,
    successChance: candidate.resolution.successChance,
    settlement: candidate.outcomeLines,
  },
});
assert.ok(prompt.includes(activeAsset.name));
assert.match(prompt, /修煉|宗門|家族|丹藥|符籙|陣法|法器|靈草/u);
const promptPayload = JSON.parse(prompt);
const serializedReaderContext = JSON.stringify({
  context: promptPayload.context,
  selectedChoice: promptPayload.selectedChoice,
  lockedResolution: promptPayload.lockedResolution,
});
assert.doesNotMatch(serializedReaderContext, INTERNAL_COPY);
assert.doesNotMatch(serializedReaderContext, OPAQUE_FAMILY_ID);

console.log(JSON.stringify({
  suite: "topic-world-family-rpg-bridge",
  status: "PASS",
  family: context.selectedStageFamily.name,
  organizations: context.stagedOrganizations.map((organization) => organization.name),
  activeAsset: activeAsset.name,
  namedActorsInStory: cast.filter((character) => candidate.story.includes(character.name)).map((character) => character.name),
}, null, 2));
