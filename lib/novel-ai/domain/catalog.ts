import { STORY_LIBRARY } from "@/lib/novel-data/story-library";

export type CatalogIssue = { code: string; path: string; message: string };

export function validateCatalog(): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const packIds = new Set<string>();
  const topicIds = new Set<string>();
  for (const [index, pack] of STORY_LIBRARY.packs.entries()) {
    if (!pack.packId || packIds.has(pack.packId)) issues.push({ code: "DUPLICATE_OR_EMPTY_ID", path: `packs[${index}]`, message: "分類包 ID 空白或重複" });
    if (!pack.name.trim()) issues.push({ code: "MISSING_ZH_NAME", path: `packs[${index}].name`, message: "缺少繁體中文名稱" });
    packIds.add(pack.packId);
  }
  for (const [index, topic] of STORY_LIBRARY.topics.entries()) {
    if (!topic.topicId || topicIds.has(topic.topicId)) issues.push({ code: "DUPLICATE_OR_EMPTY_ID", path: `topics[${index}]`, message: "題材 ID 空白或重複" });
    if (!topic.name.trim()) issues.push({ code: "MISSING_ZH_NAME", path: `topics[${index}].name`, message: "缺少繁體中文名稱" });
    if (!topic.packIds.length || topic.packIds.some((id) => !packIds.has(id))) issues.push({ code: "ORPHAN_PARENT", path: `topics[${index}].packIds`, message: "題材缺少有效分類包" });
    topicIds.add(topic.topicId);
  }
  return issues;
}

export const CATALOG_SUMMARY = { schemaVersion: STORY_LIBRARY.schemaVersion, packCount: STORY_LIBRARY.packs.filter((x) => x.enabled).length, topicCount: STORY_LIBRARY.topics.filter((x) => x.enabled && x.classic).length };
