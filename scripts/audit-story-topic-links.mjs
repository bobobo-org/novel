import fs from "node:fs";
import path from "node:path";
import { auditStoryTopics } from "../lib/novel-data/story-topic-audit.ts";
import {
  sanitizeVisibleText,
  topicEraProfileAt,
} from "../lib/novel-ai/game/topic-era-ontology.ts";
import { topicWorldContractAt } from "../lib/novel-ai/game/topic-world-contract.ts";

const root = process.cwd();
const library = JSON.parse(fs.readFileSync(path.join(root, "data", "story-library.json"), "utf8"));
const classicTopics = library.topics.filter((topic) => topic.enabled && topic.classic);

function unique(values) {
  return [...new Set(values.map((value) => sanitizeVisibleText(value)).filter(Boolean))];
}

function structuralLinkFor(topic) {
  const era = topicEraProfileAt(topic.topicId);
  const contract = topicWorldContractAt({
    seed: "story-topic-structure-audit",
    topicId: topic.topicId,
    playMode: "general",
    worldOrdinal: 0,
  });
  const sourceSignals = unique([
    ...topic.subCategories,
    ...topic.tags,
    ...topic.recommendedWorlds,
  ]);
  const worldSignals = unique([
    ...era.settingTags,
    ...era.institutionTypes,
    ...era.occupations,
    ...era.resourceTypes,
    ...contract.canonRules,
    ...contract.institutions,
    ...contract.assets,
  ]);
  const visibleWorldContract = worldSignals.join("|");
  return {
    topicId: topic.topicId,
    primaryEra: era.primaryEra,
    supportedEras: era.supportedEras,
    worldSignals,
    matchedSourceSignals: sourceSignals.filter((signal) => visibleWorldContract.includes(signal)),
  };
}

const report = auditStoryTopics({
  topics: library.topics,
  enabledPackIds: library.packs.filter((pack) => pack.enabled).map((pack) => pack.packId),
  enabledPlayModeIds: library.playModes.filter((mode) => mode.enabled).map((mode) => mode.playModeId),
  structuralLinks: classicTopics.map(structuralLinkFor),
});

const output = {
  ...report,
  decision: {
    automaticMergePerformed: false,
    reason: "既有作品會儲存 topicId；高相似題材先列為 merge-or-rewrite 或 review-distinction，不在稽核程式中破壞性刪除 ID。",
    strongestPairs: report.highOverlapPairs.slice(0, 12),
  },
};

if (process.argv.includes("--write")) {
  const artifactPath = path.join(root, "artifacts", "story-topic-structural-audit.json");
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify(output, null, 2)}\n`);
}

console.log(JSON.stringify(output, null, 2));
if (Object.values(report.integrity).some((value) => !value) || report.invalidLinks.length) {
  process.exitCode = 1;
}
