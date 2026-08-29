import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createGlobalWorld, createGlobalWorldRule } from "../lib/novel-ai/global-canon/factories.ts";
import { MemoryGlobalCanonRepository } from "../lib/novel-ai/global-canon/repository.ts";
import {
  FIRST_CUSTOM_GLOBAL_WORLD_NUMBER,
  attachGlobalWorldRule,
  formatGlobalWorldCatalogNumber,
  globalWorldRulesFor,
  nextCustomGlobalWorldNumber,
} from "../lib/novel-ai/global-canon/world-rule-workspace.ts";

const indexed = createGlobalWorld({
  name: "既有索引世界",
  classificationId: "historical-court",
  classificationLabel: "歷史宮廷",
  eraContext: "historical",
  eraLabel: "架空古代",
  catalogWorldNumber: 100_000,
}, { id: "indexed-world-100000" });
assert.equal(nextCustomGlobalWorldNumber([indexed]), FIRST_CUSTOM_GLOBAL_WORLD_NUMBER);
const unnumberedLegacyWorld = createGlobalWorld({
  name: "未編號舊世界",
  classificationId: "legacy-custom",
  classificationLabel: "舊自訂分類",
  eraContext: "other",
  eraLabel: "舊資料背景",
}, { id: "legacy-world-without-number" });
assert.equal(
  nextCustomGlobalWorldNumber([indexed, unnumberedLegacyWorld]),
  FIRST_CUSTOM_GLOBAL_WORLD_NUMBER,
  "legacy null catalog numbers remain readable and do not consume a new custom address",
);
assert.equal(formatGlobalWorldCatalogNumber(unnumberedLegacyWorld), "未編號舊資料");

const firstCustom = createGlobalWorld({
  name: "第一個自訂世界",
  classificationId: "mystery-justice",
  classificationLabel: "懸疑司法",
  eraContext: "modern",
  eraLabel: "2026 年臺北",
  catalogWorldNumber: FIRST_CUSTOM_GLOBAL_WORLD_NUMBER,
}, { id: "custom-world-100001" });
const laterCustom = createGlobalWorld({
  name: "既有較後自訂世界",
  classificationId: "deep-space-future",
  classificationLabel: "星際遠未來",
  eraContext: "future",
  eraLabel: "星曆 840 年",
  catalogWorldNumber: 100_004,
}, { id: "custom-world-100004" });
assert.equal(nextCustomGlobalWorldNumber([indexed, firstCustom, laterCustom]), 100_005);
assert.equal(formatGlobalWorldCatalogNumber(firstCustom), "第100001世界");

const legacyRule = createGlobalWorldRule({
  title: "證物守恆",
  description: "任何證物都必須有可追查來源。",
  immutable: true,
  eraContexts: ["historical"],
  appliesToGlobalWorldIds: [indexed.id],
}, { id: "world-rule-linked" });
const attached = attachGlobalWorldRule(legacyRule, firstCustom);
assert.deepEqual(attached.appliesToGlobalWorldIds, [indexed.id, firstCustom.id]);
assert.deepEqual(attached.eraContexts, ["historical", "modern"]);
assert.equal(globalWorldRulesFor([attached], firstCustom.id)[0]?.id, attached.id);
assert.throws(
  () => attachGlobalWorldRule(legacyRule, { id: " ", eraContext: "modern" }),
  /GLOBAL_WORLD_RULE_WORLD_REQUIRED/u,
);

const repository = new MemoryGlobalCanonRepository();
await repository.putBatch([
  { store: "worlds", record: firstCustom, expectedRevision: 0 },
  { store: "rules", record: attached, expectedRevision: 0 },
]);
const [savedWorld, savedRule] = await Promise.all([
  repository.get("worlds", firstCustom.id),
  repository.get("rules", attached.id),
]);
assert.equal(savedWorld?.catalogWorldNumber, 100_001);
assert.ok(savedRule?.appliesToGlobalWorldIds.includes(firstCustom.id));

const canonClientSource = await readFile(
  new URL("../app/canon/canon-client.tsx", import.meta.url),
  "utf8",
);
for (const marker of [
  'label: "十萬世界與世界規則"',
  "nextCustomGlobalWorldNumber(library.worlds)",
  "globalRepository.putBatch",
  "appliesToGlobalWorldIds",
  'data-testid="global-world-rule-editor"',
  'data-testid="global-world-rule-library"',
  "第一條世界規則",
  "小說類型／世界分類",
  "時空背景",
]) {
  assert.ok(canonClientSource.includes(marker), `combined world/rule UI is missing ${marker}`);
}
assert.ok(!canonClientSource.includes('{ id: "rules", label: "世界規則"'), "world rules must not remain a separate navigation tab");

console.log(JSON.stringify({
  suite: "global-world-rule-workspace",
  status: "PASS",
  firstCustomWorldNumber: FIRST_CUSTOM_GLOBAL_WORLD_NUMBER,
  nextCustomWorldNumber: nextCustomGlobalWorldNumber([firstCustom, laterCustom]),
  linkedWorldIds: attached.appliesToGlobalWorldIds,
  persistedAtomically: Boolean(savedWorld && savedRule),
}, null, 2));
