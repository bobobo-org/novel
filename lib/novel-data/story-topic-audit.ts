import type { StoryTopic } from "./story-library-types";

export const STORY_TOPIC_AUDIT_VERSION = "story-topic-structural-audit-v1" as const;

export type StoryTopicStructuralLink = {
  topicId: string;
  primaryEra: string;
  supportedEras: string[];
  worldSignals: string[];
  matchedSourceSignals: string[];
};

export type StoryTopicAuditPair = {
  leftTopicId: string;
  leftName: string;
  rightTopicId: string;
  rightName: string;
  nameSimilarity: number;
  contentSimilarity: number;
  score: number;
  recommendation: "merge-or-rewrite" | "review-distinction";
};

export type StoryTopicAuditInput = {
  topics: StoryTopic[];
  enabledPackIds: string[];
  enabledPlayModeIds: string[];
  structuralLinks: StoryTopicStructuralLink[];
  semanticOverlapThreshold?: number;
  mergeThreshold?: number;
};

function normalized(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function normalizedSet(values: readonly string[]) {
  return [...new Set(values.map(normalized).filter(Boolean))].sort();
}

function setKey(values: readonly string[]) {
  return normalizedSet(values).join("|");
}

function charBigrams(value: string) {
  const compact = normalized(value);
  const result = new Set<string>();
  if (compact.length < 2) {
    if (compact) result.add(compact);
    return result;
  }
  for (let index = 0; index < compact.length - 1; index += 1) {
    result.add(compact.slice(index, index + 2));
  }
  return result;
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  let intersection = 0;
  for (const entry of left) if (right.has(entry)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union ? intersection / union : 0;
}

function rounded(value: number) {
  return Number(value.toFixed(3));
}

function duplicateGroups(topics: readonly StoryTopic[], selector: (topic: StoryTopic) => string) {
  const groups = new Map<string, StoryTopic[]>();
  for (const topic of topics) {
    const key = selector(topic);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(topic);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.map((topic) => ({ topicId: topic.topicId, name: topic.name })));
}

function structuralSignature(topic: StoryTopic, link: StoryTopicStructuralLink) {
  return JSON.stringify({
    consumerGroupId: topic.consumerGroupId,
    packIds: [...topic.packIds].sort(),
    supportedPlayModes: [...topic.supportedPlayModes].sort(),
    subCategories: normalizedSet(topic.subCategories),
    tags: normalizedSet(topic.tags),
    primaryEra: link.primaryEra,
    supportedEras: [...link.supportedEras].sort(),
    worldSignals: normalizedSet(link.worldSignals),
  });
}

const EDITORIAL_REVIEW_PATTERN = /(?:功能|工具|分類|補漏|排行|平台|書庫|收益|簽約|合規|觀摩|載體|後台|熱門|爆款)/u;
const NARRATIVE_TITLE_MARKER = /(?:生存戰|命運|人生|冒險|情感|謎|懸疑|幻想|奇幻|科幻|成長|復仇|戀愛|末日|求生|重生|怪談|犯罪|世界)/u;

export function auditStoryTopics(input: StoryTopicAuditInput) {
  const topics = input.topics.filter((topic) => topic.enabled && topic.classic);
  const packIds = new Set(input.enabledPackIds);
  const playModeIds = new Set(input.enabledPlayModeIds);
  const links = new Map(input.structuralLinks.map((link) => [link.topicId, link] as const));
  const overlapThreshold = input.semanticOverlapThreshold ?? 0.32;
  const mergeThreshold = input.mergeThreshold ?? 0.6;

  const exactDuplicates = {
    names: duplicateGroups(topics, (topic) => normalized(topic.name)),
    descriptions: duplicateGroups(topics, (topic) => normalized(topic.description)),
    aliases: duplicateGroups(topics, (topic) => setKey(topic.legacyAliases)),
    subCategorySets: duplicateGroups(topics, (topic) => setKey(topic.subCategories)),
    tagSets: duplicateGroups(topics, (topic) => setKey(topic.tags)),
  };

  const highOverlapPairs: StoryTopicAuditPair[] = [];
  for (let leftIndex = 0; leftIndex < topics.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < topics.length; rightIndex += 1) {
      const left = topics[leftIndex]!;
      const right = topics[rightIndex]!;
      const nameSimilarity = jaccard(charBigrams(left.name), charBigrams(right.name));
      const leftContent = charBigrams([left.description, ...left.subCategories, ...left.tags].join("|"));
      const rightContent = charBigrams([right.description, ...right.subCategories, ...right.tags].join("|"));
      const contentSimilarity = jaccard(leftContent, rightContent);
      const score = 0.45 * nameSimilarity + 0.55 * contentSimilarity;
      if (score < overlapThreshold) continue;
      highOverlapPairs.push({
        leftTopicId: left.topicId,
        leftName: left.name,
        rightTopicId: right.topicId,
        rightName: right.name,
        nameSimilarity: rounded(nameSimilarity),
        contentSimilarity: rounded(contentSimilarity),
        score: rounded(score),
        recommendation: score >= mergeThreshold ? "merge-or-rewrite" : "review-distinction",
      });
    }
  }
  highOverlapPairs.sort((left, right) => right.score - left.score
    || left.leftTopicId.localeCompare(right.leftTopicId));

  const invalidLinks = topics.flatMap((topic) => {
    const link = links.get(topic.topicId);
    const reasons: string[] = [];
    if (!topic.supportedPlayModes.some((mode) => playModeIds.has(mode))) reasons.push("no-valid-native-play-mode");
    if (!topic.packIds.some((packId) => packIds.has(packId) && packId !== "pack-11")) reasons.push("no-specific-pack");
    if (normalizedSet(topic.subCategories).length < 3) reasons.push("insufficient-subcategory-signals");
    if (normalizedSet(topic.tags).length < 2) reasons.push("insufficient-tag-signals");
    if (!link) reasons.push("missing-world-era-contract");
    else if (!link.matchedSourceSignals.length) reasons.push("world-contract-only-uses-title");
    return reasons.length ? [{ topicId: topic.topicId, name: topic.name, reasons }] : [];
  });

  const signatures = new Map<string, StoryTopic[]>();
  for (const topic of topics) {
    const link = links.get(topic.topicId);
    if (!link) continue;
    const signature = structuralSignature(topic, link);
    const entries = signatures.get(signature) ?? [];
    entries.push(topic);
    signatures.set(signature, entries);
  }
  const structuralLinkCollisions = [...signatures.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.map((topic) => ({ topicId: topic.topicId, name: topic.name })));
  const editorialReviewCandidates = topics
    .filter((topic) => EDITORIAL_REVIEW_PATTERN.test(topic.name) && !NARRATIVE_TITLE_MARKER.test(topic.name))
    .map((topic) => ({ topicId: topic.topicId, name: topic.name }));
  const exactDuplicateGroupCount = Object.values(exactDuplicates)
    .reduce((total, groups) => total + groups.length, 0);

  return {
    auditVersion: STORY_TOPIC_AUDIT_VERSION,
    counts: {
      classicTopics: topics.length,
      validNativeModeLinks: topics.filter((topic) => topic.supportedPlayModes.some((mode) => playModeIds.has(mode))).length,
      validSpecificPackLinks: topics.filter((topic) => topic.packIds.some((packId) => packIds.has(packId) && packId !== "pack-11")).length,
      worldEraContracts: topics.filter((topic) => links.has(topic.topicId)).length,
      topicSpecificWorldLinks: topics.filter((topic) => (links.get(topic.topicId)?.matchedSourceSignals.length ?? 0) > 0).length,
      distinctStructuralLinkSignatures: signatures.size,
      exactDuplicateGroups: exactDuplicateGroupCount,
      highOverlapPairs: highOverlapPairs.length,
      mergeOrRewritePairs: highOverlapPairs.filter((pair) => pair.recommendation === "merge-or-rewrite").length,
      editorialReviewCandidates: editorialReviewCandidates.length,
    },
    integrity: {
      classic218: topics.length === 218,
      everyTopicHasNativeModeLink: topics.every((topic) => topic.supportedPlayModes.some((mode) => playModeIds.has(mode))),
      everyTopicHasSpecificPackLink: topics.every((topic) => topic.packIds.some((packId) => packIds.has(packId) && packId !== "pack-11")),
      everyTopicHasWorldEraContract: topics.every((topic) => links.has(topic.topicId)),
      everyWorldContractUsesTopicSignals: topics.every((topic) => (links.get(topic.topicId)?.matchedSourceSignals.length ?? 0) > 0),
      everyStructuralLinkIsDistinct: signatures.size === topics.length && structuralLinkCollisions.length === 0,
      noExactDuplicateFields: exactDuplicateGroupCount === 0,
    },
    exactDuplicates,
    invalidLinks,
    structuralLinkCollisions,
    highOverlapPairs,
    editorialReviewCandidates,
  };
}
