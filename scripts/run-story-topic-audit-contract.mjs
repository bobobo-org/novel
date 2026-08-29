import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { auditStoryTopics } from "../lib/novel-data/story-topic-audit.ts";
import {
  filterStoryTopicsByPlayMode,
  storyTopicPlayFit,
} from "../lib/novel-data/story-topic-mode-filter.ts";
import {
  sanitizeVisibleText,
  topicEraProfileAt,
} from "../lib/novel-ai/game/topic-era-ontology.ts";
import { topicWorldContractAt } from "../lib/novel-ai/game/topic-world-contract.ts";

const library = JSON.parse(readFileSync(new URL("../data/story-library.json", import.meta.url), "utf8"));
const createSource = readFileSync(new URL("../app/studio/create/create-project-client.tsx", import.meta.url), "utf8");
const topics = library.topics.filter((topic) => topic.enabled && topic.classic);

const modeFixtures = [
  { supportedPlayModes: ["general"] },
  { supportedPlayModes: ["rpg"] },
  { supportedPlayModes: ["general", "rpg"] },
  { supportedPlayModes: [] },
];
assert.equal(filterStoryTopicsByPlayMode(modeFixtures, "all", null).length, 4);
assert.equal(filterStoryTopicsByPlayMode(modeFixtures, "native", null).length, 3);
assert.equal(filterStoryTopicsByPlayMode(modeFixtures, "native", "rpg").length, 2);
assert.equal(storyTopicPlayFit(modeFixtures[0], null), "unselected");
assert.equal(storyTopicPlayFit(modeFixtures[1], "rpg"), "direct");
assert.equal(storyTopicPlayFit(modeFixtures[0], "rpg"), "adapted");
assert.doesNotMatch(createSource, /<option value="native" disabled=/u);
assert.match(createSource, /data-testid="story-topic-mode-unselected-hint"/u);
assert.match(createSource, /系統不會替你選玩法/u);
assert.match(createSource, /data-topic-play-fit=\{playFit\}/u);

function unique(values) {
  return [...new Set(values.map((value) => sanitizeVisibleText(value)).filter(Boolean))];
}

const structuralLinks = topics.map((topic) => {
  const era = topicEraProfileAt(topic.topicId);
  const contract = topicWorldContractAt({
    seed: "story-topic-audit-contract-test",
    topicId: topic.topicId,
    playMode: "general",
    worldOrdinal: 0,
  });
  const sourceSignals = unique([...topic.subCategories, ...topic.tags, ...topic.recommendedWorlds]);
  const worldSignals = unique([
    ...era.settingTags,
    ...era.institutionTypes,
    ...era.occupations,
    ...era.resourceTypes,
    ...contract.canonRules,
    ...contract.institutions,
    ...contract.assets,
  ]);
  const contractText = worldSignals.join("|");
  return {
    topicId: topic.topicId,
    primaryEra: era.primaryEra,
    supportedEras: era.supportedEras,
    worldSignals,
    matchedSourceSignals: sourceSignals.filter((signal) => contractText.includes(signal)),
  };
});

const report = auditStoryTopics({
  topics: library.topics,
  enabledPackIds: library.packs.filter((pack) => pack.enabled).map((pack) => pack.packId),
  enabledPlayModeIds: library.playModes.filter((mode) => mode.enabled).map((mode) => mode.playModeId),
  structuralLinks,
});

assert.equal(report.counts.classicTopics, 218);
assert.equal(report.counts.validNativeModeLinks, 218);
assert.equal(report.counts.validSpecificPackLinks, 218);
assert.equal(report.counts.worldEraContracts, 218);
assert.equal(report.counts.topicSpecificWorldLinks, 218);
assert.equal(report.counts.distinctStructuralLinkSignatures, 218);
assert.equal(report.counts.exactDuplicateGroups, 0);
assert.equal(report.invalidLinks.length, 0);
assert.equal(report.structuralLinkCollisions.length, 0);
assert.ok(Object.values(report.integrity).every(Boolean));
assert.equal(report.counts.highOverlapPairs, 3);
assert.equal(report.counts.mergeOrRewritePairs, 0);
assert.ok(report.highOverlapPairs.some((pair) =>
  pair.leftTopicId === "classic-topic-055"
  && pair.rightTopicId === "classic-topic-125"
  && pair.recommendation === "review-distinction"));
assert.ok(report.highOverlapPairs.every((pair) =>
  !["classic-topic-121", "classic-topic-130"].includes(pair.leftTopicId)
  && !["classic-topic-121", "classic-topic-130"].includes(pair.rightTopicId)));

const topic217 = topics.find((topic) => topic.topicId === "classic-topic-217");
const topic218 = topics.find((topic) => topic.topicId === "classic-topic-218");
const topic121 = topics.find((topic) => topic.topicId === "classic-topic-121");
const topic130 = topics.find((topic) => topic.topicId === "classic-topic-130");
assert.equal(topic121?.name, "數位遺產與死後人格");
assert.equal(topic130?.name, "氣候正義CliFi");
assert.ok(topic121?.legacyAliases.includes("AI未來新題"));
assert.ok(topic130?.legacyAliases.includes("氣候科幻CliFi"));
assert.equal(topic217?.name, "創作者平台生存戰");
assert.equal(topic218?.name, "全民投票改寫命運");
assert.ok(topic217?.legacyAliases.includes("網站平台功能包"));
assert.ok(topic218?.legacyAliases.includes("讀者成長系統"));
assert.ok(topic217?.supportedPlayModes.includes("management"));
assert.ok(topic218?.supportedPlayModes.includes("interactive"));
assert.ok(topic217?.subCategories.every((entry) => !/首頁探索牆|分類書庫篩選|手機閱讀優化/u.test(entry)));
assert.ok(topic218?.subCategories.every((entry) => !/閱讀足跡回訪|相似題材推薦|新書入庫曝光/u.test(entry)));

console.log(JSON.stringify({
  ok: true,
  counts: report.counts,
  strongestOverlapPairs: report.highOverlapPairs.slice(0, 12),
  correctedNarrativeTopics: [topic217?.name, topic218?.name],
  modeFilterWithoutAuthorSelection: filterStoryTopicsByPlayMode(topics, "native", null).length,
}, null, 2));
