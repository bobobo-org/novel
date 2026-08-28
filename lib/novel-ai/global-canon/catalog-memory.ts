import type { ProceduralTreasureRecord } from "../game/procedural-treasure-library";
import type {
  StoryOrganizationDirectoryEntry,
  StoryOrganizationEra,
  StoryOrganizationHierarchyNode,
} from "../social-matrix";
import { createGlobalMemory } from "./factories";
import type { GlobalCanonEraContext, GlobalMemory } from "./types";

function organizationEraContext(era: StoryOrganizationEra): GlobalCanonEraContext {
  if (era === "contemporary") return "modern";
  if (era === "historical") return "historical";
  if (era === "cultivation") return "cultivation";
  if (era === "future") return "future";
  if (era === "cross-era") return "cross-era";
  return "other";
}
function treasureEraContext(record: ProceduralTreasureRecord): GlobalCanonEraContext {
  if (record.era.isCrossEra) return "cross-era";
  if (record.era.sourceEra === "modern") return "modern";
  if (record.era.sourceEra === "future") return "future";
  return "historical";
}

function hierarchyLines(
  node: StoryOrganizationHierarchyNode,
  depth = 0,
): string[] {
  const indent = "  ".repeat(depth);
  const roles = node.roles.length ? `｜職位：${node.roles.join("、")}` : "";
  const assets = node.assets.length ? `｜資產：${node.assets.join("、")}` : "";
  return [
    `${indent}- ${node.label}｜在籍 ${node.currentMemberCount}／編制 ${node.memberCapacity}${roles}${assets}`,
    ...node.children.flatMap((child) => hierarchyLines(child, depth + 1)),
  ];
}

/**
 * Turns a deterministic organization directory entry into an editable Global
 * Memory record. The stable source id lets the UI update the same saved
 * candidate instead of silently creating duplicates.
 */
export function createGlobalOrganizationMemory(input: {
  organization: StoryOrganizationDirectoryEntry;
  organizationDirectory?: readonly StoryOrganizationDirectoryEntry[];
  catalogWorldId: string;
  catalogWorldLabel: string;
}): GlobalMemory {
  const { organization } = input;
  const organizationNames = new Map(
    input.organizationDirectory?.map((entry) => [entry.organizationId, entry.name]) ?? [],
  );
  return createGlobalMemory({
    kind: "faction",
    title: `${organization.kindLabel}｜${organization.name}`,
    eraContexts: [organizationEraContext(organization.era)],
    content: [
      "[全域組織目錄 v1]",
      `來源世界：${input.catalogWorldLabel}`,
      `組織識別：${organization.organizationId}`,
      `類型：${organization.kindLabel}／${organization.sizeLabel}`,
      `專業定位：${organization.specializationLabel}`,
      `時代：${organization.eraLabel}`,
      `據點：${organization.territory}`,
      `在籍：${organization.currentMemberCount}／容量上限：${organization.memberCapacity}（不超過 10,000 人）`,
      `內部準則：${organization.doctrine}`,
      `公開目標：${organization.publicGoal}`,
      `內部矛盾：${organization.hiddenConflict}`,
      "組織關係網：",
      ...organization.relationships.map((relationship) => {
        const sourceName = organizationNames.get(relationship.sourceOrganizationId)
          ?? relationship.sourceOrganizationId;
        const targetName = organizationNames.get(relationship.targetOrganizationId)
          ?? relationship.targetOrganizationId;
        const counterpartId = relationship.sourceOrganizationId === organization.organizationId
          ? relationship.targetOrganizationId
          : relationship.sourceOrganizationId;
        const perspective = relationship.directed
          ? relationship.sourceOrganizationId === organization.organizationId
            ? "本組織為作用發起方"
            : "本組織為作用承受方"
          : "雙向關係";
        return [
          `- ${relationship.kindLabel}｜對象：${organizationNames.get(counterpartId) ?? counterpartId}`,
          `  方向：${relationship.directed ? `${sourceName} → ${targetName}` : `${sourceName} ↔ ${targetName}`}｜本組織立場：${perspective}`,
          `  起因：${relationship.cause}`,
          `  歷史：${relationship.history}`,
          `  現況：${relationship.currentStatus}`,
          `  公開立場：${relationship.publicStance}`,
          `  幕後動機：${relationship.secretMotive}`,
          `  強度：${relationship.intensity}/100｜信任：${relationship.trust}/100｜${relationship.publiclyKnown ? "公開" : "未公開"}`,
        ].join("\n");
      }),
      "階層、房系與資產：",
      ...hierarchyLines(organization.hierarchy),
      "名冊規則：人物與家族祖譜依組織識別與固定世界種子按頁重現；不預先展開一萬筆資料。",
    ].join("\n"),
  }, {
    id: `global-organization:${organization.organizationId}`,
    provenance: {
      origin: "system_catalog",
      sourceLabel: `${input.catalogWorldLabel}／${organization.name}`,
      sourceId: `${input.catalogWorldId}:${organization.organizationId}`,
    },
  });
}

/** Creates an editable, copyable Global Memory snapshot from one catalog item. */
export function createGlobalTreasureMemory(input: {
  treasure: ProceduralTreasureRecord;
  catalogWorldId: string;
  catalogWorldLabel: string;
}): GlobalMemory {
  const { treasure } = input;
  return createGlobalMemory({
    kind: "item",
    title: `${treasure.kindLabel}｜${treasure.name}`,
    eraContexts: [treasureEraContext(treasure)],
    content: [
      "[全域寶物圖鑑 v1]",
      `來源世界：${input.catalogWorldLabel}`,
      `寶物索引：${treasure.ordinal + 1}／100,000`,
      `寶物識別：${treasure.id}`,
      `類型：${treasure.kindLabel}／${treasure.subtype}`,
      `時代：${treasure.era.sourceEraLabel}${treasure.era.isCrossEra ? "（明示跨時代）" : ""}`,
      `稀有度：${treasure.rarityLabel}／${treasure.visual.elementLabel}屬性`,
      `持有人：${treasure.holder.characterName}`,
      `持有組織：${treasure.holder.factionName}（${treasure.holder.factionKind}）`,
      `主要能力：${treasure.abilities[0].name}｜${treasure.abilities[0].effect}`,
      `輔助能力：${treasure.abilities[1].name}｜${treasure.abilities[1].effect}`,
      `限制：${treasure.limitation}`,
      `代價：${treasure.cost}`,
      `故事鉤子：${treasure.storyHook}`,
      `圖像資產：${treasure.visual.baseAsset}｜變體 ${treasure.visual.variant + 1}`,
    ].join("\n"),
  }, {
    id: `global-treasure:${treasure.id}`,
    provenance: {
      origin: "system_catalog",
      sourceLabel: `${input.catalogWorldLabel}／${treasure.name}`,
      sourceId: `${input.catalogWorldId}:${treasure.id}`,
    },
  });
}
