import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const library = JSON.parse(readFileSync(new URL("../data/story-library.json", import.meta.url), "utf8"));
const source = readFileSync(new URL("../app/studio/create/create-project-client.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

const classicTopics = library.topics.filter((topic) => topic.enabled && topic.classic && !topic.adultOnly);
assert.equal(classicTopics.length, 218, "the create catalog must expose exactly 218 enabled, classic, non-adult topics");

const transformationTopic = classicTopics.find((topic) => topic.topicId === "classic-topic-001");
assert.ok(transformationTopic, "the transformation/body-swap topic must be in the 218-topic catalog");
assert.match(source, /附身變身（男變女／女變男／靈魂交換）/u);
assert.match(source, /data-testid="story-topic-search"/u);
assert.match(source, /data-testid="story-topic-mode-filter"/u);
assert.match(source, /顯示 \{filteredTopics\.length\}／\{topics\.length\} 類/u);
assert.match(source, /listStoryTopics\(\)\.filter\(\(item\) => item\.classic && !item\.adultOnly\)/u);
assert.doesNotMatch(source, /playModeId:\s*currentPlayMode/u);
assert.doesNotMatch(source, /limit:\s*80/u);
assert.doesNotMatch(source, /topics\.slice\(0,\s*18\)/u);
assert.match(source, /data-topic-play-fit=/u, "every visible topic must disclose direct or adapted play-mode fit");

assert.match(source, /draft\.answers\.cast/u, "the supporting cast must use the canonical answers.cast field");
assert.match(
  source,
  /\[entry\.name, entry\.roleLabel, entry\.relationship, entry\.goal\]\.join\("｜"\)/u,
  "answers.cast must serialize each person as name, role, relationship, and goal",
);
assert.match(source, /姓名、角色定位、與主角關係及個人目標/u);
for (const role of ["核心同行者", "對立者", "事件推動者", "關鍵見證者"]) {
  assert.ok(source.includes(role), `missing required supporting role: ${role}`);
}
assert.match(source, /MIN_SUPPORTING_CAST\s*=\s*4/u);
assert.match(source, /data-testid="creation-foundation-setup"/u);
assert.match(source, /data-testid="creation-world"/u);
assert.match(source, /data-testid="creation-world-rule"/u);
assert.match(source, /data-testid="creation-cast-preview"/u);
assert.doesNotMatch(
  source,
  /repository\.put<Character>\("characters"/u,
  "createProject already persists the canonical supporting cast; the UI must not duplicate it",
);
assert.doesNotMatch(
  source,
  /repository\.put<StoryBible>\("storyBibles"/u,
  "the UI must not rewrite StoryBible character IDs after the atomic bundle is persisted",
);
assert.match(
  source,
  /const bundle = await repository\.createProject\([\s\S]*buildProjectBundle\(withSeed\)/u,
  "post-create work must use the idempotent canonical bundle returned by the repository",
);

for (const selector of [
  ".p2TopicCatalog",
  ".p2TopicTools",
  ".p2TopicGridLarge",
  ".p2FoundationSetup",
  ".p2WorldSuggestions",
  ".p2WorldContractPreview",
  ".p2CastSetup",
  ".p2CastPreview",
]) {
  assert.ok(styles.includes(selector), `missing responsive creation UI styling: ${selector}`);
}
assert.match(styles, /\.p2TopicGridLarge\{[^}]*repeat\(auto-fit,minmax\(210px,1fr\)\)/u);
assert.match(styles, /@media\(max-width:900px\)[^{]*\{[^}]*\.p2FoundationSetup>header/u);
assert.match(source, /data-testid="creation-topic-world-contract"/u);
assert.match(source, /世界種子 \{topicContract\.worldOrdinal \+ 1\}／1000/u);
assert.match(source, /組織、宗門與家族/u);
assert.match(source, /資源、寶物與取得條件/u);
assert.match(source, /const modeSteps = draft\.mode === "guided" \? 6/u);
assert.match(source, /draft\.step === 1 && !draft\.genreId/u, "every creation mode must choose a topic first");
assert.doesNotMatch(source, /draft\.mode === "blank" && draft\.step === 1 && !draft\.genreId/u);
assert.match(source, /function Guided\(\{ draft, set, setAnswer, topics \}/u);
assert.match(source, /if \(draft\.step === 1\)[\s\S]*?<TopicCatalog draft=\{draft\} set=\{set\} topics=\{topics\}/u);
assert.match(source, /answers: \{ \.\.\.draft\.answers, world: next \}/u);
assert.match(source, /answers: \{ \.\.\.draft\.answers, worldRule: next \}/u);
assert.doesNotMatch(
  source,
  /answers: \{ \.\.\.draft\.answers, worldRule: next \},\s*seedCandidate: \{ \.\.\.seed, world: next, worldRule: next \}/u,
  "story setting and immutable rules must not overwrite each other",
);
for (const requiredFamilyStageSurface of [
  "上場家族",
  "上場宗門",
  "上場派系",
  "四勢力",
  "資產控制",
  "一鍵核准",
]) {
  assert.ok(
    source.includes(requiredFamilyStageSurface),
    `missing family-stage creation UI contract: ${requiredFamilyStageSurface}`,
  );
}

console.log(JSON.stringify({
  ok: true,
  classicTopicCount: classicTopics.length,
  searchableTransformationTopic: transformationTopic.topicId,
  supportingCastMinimum: 4,
  canonicalCastField: "answers.cast",
  styledCreationSurfaces: 7,
}, null, 2));
