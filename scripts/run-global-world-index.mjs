import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  GLOBAL_WORLD_CLASSIFICATIONS,
  GLOBAL_WORLD_INDEX_CAPACITY,
  TOPIC_CLASS_COMPATIBILITY_MANIFEST,
  evaluateWorldTopicCompatibility,
  formatGlobalWorldId,
  globalIndexedWorldAt,
  globalIndexedWorldPage,
  globalIndexedWorldSummaryAt,
  globalWorldIndexDiagnostics,
} from "../lib/novel-ai/game/global-world-index.ts";

assert.equal(GLOBAL_WORLD_INDEX_CAPACITY, 100_000);
assert.equal(GLOBAL_WORLD_CLASSIFICATIONS.length, 11);
assert.equal(formatGlobalWorldId(1), "第000001世界");
assert.equal(formatGlobalWorldId(100_000), "第100000世界");
assert.throws(() => formatGlobalWorldId(0), /ORDINAL_INVALID/u);
assert.throws(() => formatGlobalWorldId(100_001), /ORDINAL_INVALID/u);

const first = globalIndexedWorldAt({ ordinal: 1 });
assert.deepEqual(first, globalIndexedWorldAt({ ordinal: 1 }), "canonical address must be stable");
assert.equal(first.displayId, "第000001世界");
assert.ok(first.compatibleTopicIds.includes(first.primaryTopic.topicId));
assert.ok(first.blueprint.canonRules.some((rule) => rule.includes("未經具名跨時代 Canon")));

const direct = evaluateWorldTopicCompatibility({
  worldEra: first.era,
  classificationId: first.classification.id,
  topicIdOrName: first.primaryTopic.topicId,
});
assert.equal(direct.allowed, true);
assert.equal(direct.reasonCode, "DIRECT_COMPATIBLE");

const crossEraWithoutCanon = evaluateWorldTopicCompatibility({
  worldEra: "cross-era",
  classificationId: first.classification.id,
  topicIdOrName: first.primaryTopic.topicId,
});
assert.equal(crossEraWithoutCanon.allowed, false, "cross-era must never be implicit");

const page = globalIndexedWorldPage({ offset: 99_988, limit: 24 });
assert.equal(page.items.length, 12);
assert.equal(page.items.at(-1)?.displayId, "第100000世界");
assert.equal(page.hasNextPage, false);

const startedAt = performance.now();
const ids = new Set();
const classIds = new Set();
const topicCounts = new Map();
for (let ordinal = 1; ordinal <= GLOBAL_WORLD_INDEX_CAPACITY; ordinal += 1) {
  const world = globalIndexedWorldSummaryAt(ordinal);
  ids.add(world.id);
  classIds.add(world.classification.id);
  topicCounts.set(world.primaryTopic.topicId, (topicCounts.get(world.primaryTopic.topicId) ?? 0) + 1);
  assert.ok(world.compatibleTopicCount > 0);
  assert.equal(world.guard.crossEraRequired, false);
}
const elapsedMs = performance.now() - startedAt;
assert.equal(ids.size, 100_000);
assert.equal(classIds.size, 11);
assert.equal(topicCounts.size, 218);
assert.ok([...topicCounts.values()].every((count) => count === 458 || count === 459));
assert.ok([...TOPIC_CLASS_COMPATIBILITY_MANIFEST.values()].every((ids) => ids.length > 0));

console.log(JSON.stringify({
  suite: "global-world-index",
  status: "PASS",
  diagnostics: globalWorldIndexDiagnostics(),
  sampledAllAddresses: ids.size,
  topicDistribution: [...new Set(topicCounts.values())].sort((a, b) => a - b),
  materializationMs: Number(elapsedMs.toFixed(2)),
}, null, 2));
