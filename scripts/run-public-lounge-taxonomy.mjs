import assert from "node:assert/strict";
import rawStoryLibrary from "../data/story-library.json" with { type: "json" };
import {
  listPublicLoungeShelves,
  migrateLegacyPublicLoungeCategory,
  normalizePublicLoungeTopicIds,
  PublicLoungeTaxonomyError,
} from "../lib/novel-ai/public-lounge/taxonomy.ts";

const STORY_LIBRARY = rawStoryLibrary;

function expectTaxonomyError(code, run) {
  assert.throws(run, (error) => (
    error instanceof PublicLoungeTaxonomyError && error.code === code
  ));
}

const shelves = listPublicLoungeShelves();
assert.deepEqual(
  shelves.map((shelf) => [shelf.shelfId, shelf.name]),
  [
    ["group-1", "幻想冒險"],
    ["group-2", "都市現實"],
    ["group-3", "情感關係"],
    ["group-4", "歷史權謀"],
    ["group-5", "懸疑驚悚"],
    ["group-6", "科幻未來"],
    ["group-7", "互動實驗"],
    ["group-8", "文化地域"],
  ],
);
assert.ok(shelves.every((shelf, index) => shelf.order === index + 1));

const classicTopics = STORY_LIBRARY.topics.filter((topic) => topic.enabled && topic.classic && !topic.adultOnly);
assert.equal(classicTopics.length, 218);
const [primary, secondary, tertiary] = classicTopics;
const normalized = normalizePublicLoungeTopicIds([
  ` ${primary.topicId} `,
  secondary.topicId,
  tertiary.topicId,
]);
assert.deepEqual(normalized.topicIds, [primary.topicId, secondary.topicId, tertiary.topicId]);
assert.equal(normalized.primaryTopicId, primary.topicId);
assert.equal(normalized.shelfId, primary.consumerGroupId);
assert.equal(normalized.storyLibrarySchemaVersion, STORY_LIBRARY.schemaVersion);

const crossShelfTopic = classicTopics.find((topic) => topic.consumerGroupId !== primary.consumerGroupId);
assert.ok(crossShelfTopic);
assert.equal(
  normalizePublicLoungeTopicIds([primary.topicId, crossShelfTopic.topicId]).shelfId,
  primary.consumerGroupId,
);

expectTaxonomyError("PUBLIC_LOUNGE_TOPIC_IDS_INVALID", () => normalizePublicLoungeTopicIds("classic-topic-001"));
expectTaxonomyError("PUBLIC_LOUNGE_TOPIC_IDS_INVALID", () => normalizePublicLoungeTopicIds([" "]));
expectTaxonomyError("PUBLIC_LOUNGE_TOPIC_COUNT_INVALID", () => normalizePublicLoungeTopicIds([]));
expectTaxonomyError("PUBLIC_LOUNGE_TOPIC_COUNT_INVALID", () => normalizePublicLoungeTopicIds([
  classicTopics[0].topicId,
  classicTopics[1].topicId,
  classicTopics[2].topicId,
  classicTopics[3].topicId,
]));
expectTaxonomyError("PUBLIC_LOUNGE_TOPIC_DUPLICATE", () => normalizePublicLoungeTopicIds([
  primary.topicId,
  primary.topicId,
]));
expectTaxonomyError("PUBLIC_LOUNGE_TOPIC_NOT_PUBLIC", () => normalizePublicLoungeTopicIds(["classic-topic-999"]));

const adultTopics = STORY_LIBRARY.topics.filter((topic) => topic.enabled && topic.adultOnly);
assert.equal(adultTopics.length, 7);
for (const adultTopic of adultTopics) {
  expectTaxonomyError("PUBLIC_LOUNGE_TOPIC_NOT_PUBLIC", () => normalizePublicLoungeTopicIds([adultTopic.topicId]));
}
const adultTopic = adultTopics[0];

const disabledTopic = classicTopics[4];
const originalEnabled = disabledTopic.enabled;
try {
  disabledTopic.enabled = false;
  expectTaxonomyError("PUBLIC_LOUNGE_TOPIC_NOT_PUBLIC", () => normalizePublicLoungeTopicIds([disabledTopic.topicId]));
} finally {
  disabledTopic.enabled = originalEnabled;
}

const idMigration = migrateLegacyPublicLoungeCategory(primary.topicId);
assert.equal(idMigration.status, "migrated");
assert.equal(idMigration.matchedBy, "topicId");
assert.equal(idMigration.selection.primaryTopicId, primary.topicId);

const nameMigration = migrateLegacyPublicLoungeCategory(primary.name);
assert.equal(nameMigration.status, "migrated");
assert.equal(nameMigration.matchedBy, "name");
assert.equal(nameMigration.selection.primaryTopicId, primary.topicId);

const legacyAlias = primary.legacyAliases.find((alias) => alias !== primary.name);
assert.ok(legacyAlias);
const aliasMigration = migrateLegacyPublicLoungeCategory(legacyAlias);
assert.equal(aliasMigration.status, "migrated");
assert.equal(aliasMigration.matchedBy, "legacyAlias");
assert.equal(aliasMigration.selection.primaryTopicId, primary.topicId);

const ambiguousAlias = "legacy-category-ambiguous-test";
try {
  primary.legacyAliases.push(ambiguousAlias);
  secondary.legacyAliases.push(ambiguousAlias);
  assert.deepEqual(migrateLegacyPublicLoungeCategory(ambiguousAlias), {
    status: "unmapped",
    sourceCategory: ambiguousAlias,
    reason: "ambiguous",
  });
} finally {
  primary.legacyAliases.pop();
  secondary.legacyAliases.pop();
}

assert.deepEqual(migrateLegacyPublicLoungeCategory("  "), {
  status: "unmapped",
  sourceCategory: null,
  reason: "empty",
});
assert.deepEqual(migrateLegacyPublicLoungeCategory("不存在的分類"), {
  status: "unmapped",
  sourceCategory: "不存在的分類",
  reason: "unknown",
});
assert.deepEqual(migrateLegacyPublicLoungeCategory(adultTopic.topicId), {
  status: "unmapped",
  sourceCategory: adultTopic.topicId,
  reason: "ineligible",
});

console.log(JSON.stringify({
  ok: true,
  schemaVersion: normalized.storyLibrarySchemaVersion,
  shelves: shelves.length,
  classicTopics: classicTopics.length,
  maxTopicTags: 3,
  legacyMigration: [idMigration.matchedBy, nameMigration.matchedBy, aliasMigration.matchedBy],
}, null, 2));
