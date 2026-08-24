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
assert.match(source, /組織、陣營與關係網/u);
assert.match(source, /資源、物件與取得條件/u);
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
  "陣營／家族／宗門",
  "題材相符候選",
  "資產控制",
  "選擇這組上場群像",
]) {
  assert.ok(
    source.includes(requiredFamilyStageSurface),
    `missing family-stage creation UI contract: ${requiredFamilyStageSurface}`,
  );
}
assert.match(source, /data-testid="creation-stage-selection-route"/u);
assert.match(source, /系統不會代選第一組/u);
assert.match(source, /data-testid="creation-primary-next"/u);
assert.match(source, /下一步：選擇上場群像/u);
assert.doesNotMatch(source, /<span>\{language\}<\/span>/u, "language choices must not expose internal locale codes");

const mergeCoreCastStart = source.indexOf("function mergeCreationCoreCast");
const mergeCoreCastEnd = source.indexOf("function closedAISeedSource", mergeCoreCastStart);
const mergeCoreCastSource = source.slice(mergeCoreCastStart, mergeCoreCastEnd);
assert.ok(mergeCoreCastStart >= 0 && mergeCoreCastEnd > mergeCoreCastStart);
assert.doesNotMatch(
  mergeCoreCastSource,
  /firstFamily|applyStageFamilyToDraft|listTopicWorldFamilyStageCandidates/u,
  "AI or device fallback must never silently approve the first stage group",
);

const stageChooserIndex = source.indexOf('data-testid="creation-stage-family-candidates"');
const worldDetailsIndex = source.indexOf('data-testid="creation-world-foundation-details"');
assert.ok(stageChooserIndex >= 0, "the topic-matched stage chooser must be rendered");
assert.ok(worldDetailsIndex > stageChooserIndex, "stage candidates must appear before expandable world details");
assert.match(source, /data-testid=\{`creation-stage-family-details-/u, "each candidate keeps its long details collapsed");
assert.match(source, /data-testid="creation-materialization-truth"/u);
for (const truthField of [
  "capacity.materializedStageCharacters",
  "capacity.materializedStageAssets",
  "capacity.characters",
  "capacity.treasures",
  "capacity.relationshipScenarios",
]) {
  assert.ok(source.includes(truthField), `creation capacity truth is missing ${truthField}`);
}
assert.match(source, /其餘資料未預先建立或載入/u, "virtual procedural capacity must not be presented as materialized records");
assert.doesNotMatch(source, /宗門、修行家族、散修盟與坊市/u, "generic topics must not receive cultivation-only UI copy");
assert.doesNotMatch(source, /功法、丹藥、符籙、陣法、法器、靈草、秘境的資產控制/u);

console.log(JSON.stringify({
  ok: true,
  classicTopicCount: classicTopics.length,
  searchableTransformationTopic: transformationTopic.topicId,
  supportingCastMinimum: 4,
  canonicalCastField: "answers.cast",
  styledCreationSurfaces: 7,
  explicitStageSelection: true,
  materializationTruthVisible: true,
}, null, 2));
