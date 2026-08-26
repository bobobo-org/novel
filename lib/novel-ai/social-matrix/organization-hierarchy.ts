import type { ProceduralStoryContext } from "../game/procedural-story-library";
import type { CharacterCultivationProfile } from "../domain";
import {
  DeterministicSocialMatrix,
  socialMatrixHash,
  type SocialMatrixInstitutionProfile,
} from "./social-matrix";
import type {
  SocialInstitution,
  SocialInstitutionKind,
  SocialMatrixCharacter,
  SocialMatrixPage,
} from "./types";

export const STORY_ORGANIZATION_DIRECTORY_SIZE = 10;
export const STORY_ORGANIZATION_MEMBER_CAPACITY = 10_000;

export type StoryOrganizationEra =
  | "cultivation"
  | "historical"
  | "contemporary"
  | "future"
  | "cross-era"
  | "timeless-fantasy";

export type StoryOrganizationArchetype =
  | "sect"
  | "family"
  | "enterprise"
  | "government"
  | "academy"
  | "guild";

export type StoryOrganizationSetting = {
  era: StoryOrganizationEra;
  eraLabel: string;
  backgroundLabel: string;
  allowsCrossEra: boolean;
  signal: string;
  sourceWorldId: string | null;
};

export type StoryOrganizationBlueprint = SocialMatrixInstitutionProfile & {
  ordinal: number;
  archetype: StoryOrganizationArchetype;
  kindLabel: string;
  era: StoryOrganizationEra;
  eraLabel: string;
};

export type StoryOrganizationHierarchyNode = {
  nodeId: string;
  label: string;
  kind: "root" | "command" | "branch" | "rank" | "asset";
  memberCapacity: number;
  currentMemberCount: number;
  roles: string[];
  assets: string[];
  children: StoryOrganizationHierarchyNode[];
};

export type StoryOrganizationDirectoryEntry = {
  organizationId: string;
  institutionIndex: number;
  archetype: StoryOrganizationArchetype;
  kindLabel: string;
  name: string;
  era: StoryOrganizationEra;
  eraLabel: string;
  backgroundLabel: string;
  sizeLabel: "微型" | "小型" | "中型" | "大型" | "巨型";
  memberCapacity: number;
  currentMemberCount: number;
  territory: string;
  doctrine: string;
  publicGoal: string;
  hiddenConflict: string;
  hierarchy: StoryOrganizationHierarchyNode;
};

export type StoryOrganizationMembership = {
  hierarchyNodeId: string;
  hierarchyPathIds: string[];
  hierarchyPathLabels: string[];
  organizationUnit: string;
  organizationRank: string;
  organizationFaction: string;
};

export type StoryOrganizationMember = SocialMatrixCharacter & StoryOrganizationMembership;

export type StoryOrganizationWorldSource = {
  id: string;
  name?: string | null;
  era?: string | null;
  summary?: string | null;
};

const ERA_LABELS: Record<StoryOrganizationEra, string> = {
  cultivation: "修行時代",
  historical: "歷史／古代",
  contemporary: "現代",
  future: "未來",
  "cross-era": "跨時代",
  "timeless-fantasy": "架空幻想",
};

const ARCHETYPE_ORDER: Record<StoryOrganizationEra, readonly StoryOrganizationArchetype[]> = {
  cultivation: ["sect", "family", "sect", "enterprise", "academy", "guild", "sect", "family", "enterprise", "guild"],
  historical: ["family", "government", "academy", "enterprise", "family", "guild", "government", "family", "enterprise", "academy"],
  contemporary: ["enterprise", "family", "government", "academy", "enterprise", "guild", "family", "enterprise", "government", "academy"],
  future: ["enterprise", "government", "academy", "guild", "enterprise", "family", "government", "academy", "enterprise", "guild"],
  "cross-era": ["sect", "family", "enterprise", "government", "academy", "guild", "sect", "family", "enterprise", "guild"],
  "timeless-fantasy": ["sect", "family", "guild", "academy", "government", "enterprise", "sect", "family", "guild", "academy"],
};

const NAME_PREFIXES = [
  "青衡", "觀瀾", "玄霄", "流雲", "明德", "遠川", "拾光", "天穹", "星橋", "景曜",
  "清河", "晨曦", "瀚海", "白樺", "長鏡", "新港", "扶光", "雲汀", "北辰", "南華",
] as const;
const FAMILY_SURNAMES = ["謝", "唐", "林", "楚", "白", "顧", "江", "夏", "沈", "景", "容", "陸"] as const;

const ROLE_CATALOG: Record<StoryOrganizationArchetype, readonly string[]> = {
  sect: ["掌門", "宗主", "聖子", "聖女", "太上長老", "執法長老", "傳功長老", "峰主", "堂主", "真傳弟子", "內門弟子", "外門弟子", "丹師", "符師", "陣師"],
  family: ["家主", "族長", "族老", "少主", "繼承人", "長房主事", "房主", "嫡系子弟", "旁支子弟", "家臣", "客卿", "外姓盟親"],
  enterprise: ["董事長", "董事", "執行長", "營運長", "財務長", "事業群總經理", "部門主管", "產品經理", "專案負責人", "資深專員", "專員", "外部顧問"],
  government: ["最高決策者", "議政官", "部門首長", "幕僚長", "地方主官", "執行官", "稽核官", "文書官", "基層成員"],
  academy: ["院長", "副院長", "首席學者", "教授", "研究主持人", "講師", "研究員", "助理", "學員"],
  guild: ["盟主", "議事代表", "分會長", "資深仲介", "情報主管", "執行者", "聯絡人", "見習成員"],
};

function compactVisible(value: string | null | undefined, maximum = 34) {
  const clean = (value ?? "").replace(/\s+/gu, " ").trim();
  return clean.length > maximum ? `${clean.slice(0, maximum)}…` : clean;
}

export function resolveStoryOrganizationSetting(input: {
  genre?: string | null;
  coreIdea?: string | null;
  narrativeStyle?: string | null;
  worldEras?: readonly (string | null | undefined)[];
  worldSummaries?: readonly (string | null | undefined)[];
  sourceWorldId?: string | null;
}): StoryOrganizationSetting {
  const values = [
    ...(input.worldEras ?? []),
    ...(input.worldSummaries ?? []),
    input.genre,
    input.coreIdea,
    input.narrativeStyle,
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  const signal = values.join("｜");
  const declaredWorldEra = (input.worldEras ?? [])
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("｜");
  const eraSignal = /修仙|仙俠|玄幻|修行|靈氣|未來|星際|太空|宇宙|賽博|機甲|殖民|科幻|歷史|古代|王朝|宮廷|朝堂|江湖|武俠|民國|現代|都市|企業|職場|校園/iu.test(declaredWorldEra)
    ? declaredWorldEra
    : signal;
  const era: StoryOrganizationEra = /穿越|跨時代|時空|古今交錯|平行時代|time\s*travel/iu.test(signal)
    ? "cross-era"
    : /修仙|仙俠|玄幻|修行|靈氣|宗門|煉氣|築基|金丹|元嬰/iu.test(eraSignal)
      ? "cultivation"
      : /未來|星際|太空|宇宙|賽博|機甲|殖民|科幻/iu.test(eraSignal)
        ? "future"
        : /歷史|古代|王朝|宮廷|朝堂|江湖|武俠|民國/iu.test(eraSignal)
          ? "historical"
          : /現代|都市|企業|商戰|職場|校園|懸疑|推理|娛樂圈/iu.test(eraSignal)
            ? "contemporary"
            : "timeless-fantasy";
  const backgroundLabel = compactVisible(
    input.worldSummaries?.find((value) => value?.trim())
      ?? input.coreIdea
      ?? input.genre
      ?? "作品既定世界背景",
    42,
  ) || "作品既定世界背景";
  return {
    era,
    eraLabel: ERA_LABELS[era],
    backgroundLabel,
    allowsCrossEra: era === "cross-era",
    signal,
    sourceWorldId: input.sourceWorldId ?? null,
  };
}

export function resolveActiveWorldOrganizationSetting(input: {
  activeWorldId?: string | null;
  worlds: readonly StoryOrganizationWorldSource[];
  fallback: {
    genre?: string | null;
    coreIdea?: string | null;
    narrativeStyle?: string | null;
  };
}): StoryOrganizationSetting {
  const activeWorld = input.activeWorldId
    ? input.worlds.find((world) => world.id === input.activeWorldId)
    : null;
  if (!activeWorld) {
    return resolveStoryOrganizationSetting(input.fallback);
  }
  return resolveStoryOrganizationSetting({
    genre: activeWorld.era,
    coreIdea: activeWorld.summary,
    worldEras: [activeWorld.era],
    worldSummaries: [activeWorld.summary, activeWorld.name],
    sourceWorldId: activeWorld.id,
  });
}

const CROSS_ERA_ORGANIZATION_ERAS = [
  "cultivation",
  "historical",
  "contemporary",
  "future",
  "timeless-fantasy",
] as const satisfies readonly StoryOrganizationEra[];

export function storyOrganizationEraCompatible(
  setting: StoryOrganizationSetting,
  organizationEra: StoryOrganizationEra,
) {
  return setting.allowsCrossEra || organizationEra === setting.era;
}

function organizationEraFor(
  setting: StoryOrganizationSetting,
  ordinal: number,
): StoryOrganizationEra {
  if (!setting.allowsCrossEra) return setting.era;
  return CROSS_ERA_ORGANIZATION_ERAS[ordinal % CROSS_ERA_ORGANIZATION_ERAS.length]!;
}

function institutionKind(archetype: StoryOrganizationArchetype): SocialInstitutionKind {
  if (archetype === "sect") return "宗門";
  if (archetype === "family") return "世家聯盟";
  if (archetype === "enterprise") return "商會";
  if (archetype === "academy") return "學宮";
  return "祕密結社";
}

function organizationKindLabel(archetype: StoryOrganizationArchetype, era: StoryOrganizationEra) {
  if (archetype === "sect") return "宗門";
  if (archetype === "family") return era === "future" ? "殖民家族" : era === "contemporary" ? "家族" : "世家／家族";
  if (archetype === "enterprise") return era === "historical" ? "商幫／商號" : era === "cultivation" ? "修行商會" : "企業";
  if (archetype === "government") return era === "future" ? "星區政權" : era === "historical" ? "政權／官署" : "公共機構";
  if (archetype === "academy") return era === "cultivation" ? "學宮／道院" : era === "future" ? "研究院" : "學院／研究機構";
  return era === "cultivation" ? "散修盟／祕密結社" : "聯盟／祕密組織";
}

function organizationName(archetype: StoryOrganizationArchetype, era: StoryOrganizationEra, seed: string, ordinal: number) {
  const prefix = NAME_PREFIXES[(socialMatrixHash(`${seed}:organization-name:${ordinal}`) + ordinal) % NAME_PREFIXES.length]!;
  const surname = FAMILY_SURNAMES[(socialMatrixHash(`${seed}:family-name:${ordinal}`) + ordinal) % FAMILY_SURNAMES.length]!;
  if (archetype === "sect") return `${prefix}${ordinal % 3 === 0 ? "劍宗" : ordinal % 3 === 1 ? "丹符門" : "陣道院"}`;
  if (archetype === "family") return `${surname}氏${era === "future" ? "星港家族" : era === "contemporary" ? "家族" : era === "cultivation" ? "修行世家" : "世家"}`;
  if (archetype === "enterprise") return `${prefix}${era === "future" ? "星際科技" : era === "historical" ? "商號" : era === "cultivation" ? "萬寶商會" : "控股"}`;
  if (archetype === "government") return `${prefix}${era === "future" ? "星區議會" : era === "historical" ? "都護府" : "公共協作署"}`;
  if (archetype === "academy") return `${prefix}${era === "future" ? "深空研究院" : era === "cultivation" ? "問道學宮" : "研究院"}`;
  return `${prefix}${era === "cultivation" ? "散修盟" : "情報聯盟"}`;
}

export function buildStoryOrganizationBlueprints(input: {
  seed: string;
  setting: StoryOrganizationSetting;
  count?: number;
}): StoryOrganizationBlueprint[] {
  const count = input.count ?? STORY_ORGANIZATION_DIRECTORY_SIZE;
  if (!Number.isSafeInteger(count) || count < 1 || count > STORY_ORGANIZATION_DIRECTORY_SIZE) {
    throw new Error("STORY_ORGANIZATION_COUNT_INVALID");
  }
  const order = ARCHETYPE_ORDER[input.setting.era];
  return Array.from({ length: count }, (_, ordinal) => {
    const archetype = order[ordinal % order.length]!;
    const era = organizationEraFor(input.setting, ordinal);
    return {
      ordinal,
      archetype,
      kind: institutionKind(archetype),
      kindLabel: organizationKindLabel(archetype, era),
      name: organizationName(archetype, era, input.seed, ordinal),
      roles: [...ROLE_CATALOG[archetype]],
      era,
      eraLabel: ERA_LABELS[era],
    };
  }).filter((blueprint) => storyOrganizationEraCompatible(input.setting, blueprint.era));
}

const SIZE_TIERS = [
  { label: "微型", minimum: 1, maximum: 49 },
  { label: "小型", minimum: 50, maximum: 299 },
  { label: "中型", minimum: 300, maximum: 1_499 },
  { label: "大型", minimum: 1_500, maximum: 4_999 },
  { label: "巨型", minimum: 5_000, maximum: STORY_ORGANIZATION_MEMBER_CAPACITY },
] as const;

function organizationCapacity(seed: string, blueprint: StoryOrganizationBlueprint, influence: number) {
  const tierIndex = (socialMatrixHash(`${seed}:organization-size-tier:${blueprint.ordinal}`) + Math.floor(influence / 20)) % SIZE_TIERS.length;
  const tier = SIZE_TIERS[tierIndex]!;
  const span = tier.maximum - tier.minimum + 1;
  return {
    sizeLabel: tier.label,
    memberCapacity: tier.minimum + socialMatrixHash(`${seed}:organization-size:${blueprint.ordinal}`) % span,
  };
}

function organizationCurrentMemberCount(seed: string, blueprint: StoryOrganizationBlueprint, capacity: number) {
  if (capacity <= 1) return capacity;
  const occupancyPercent = 45 + socialMatrixHash(`${seed}:organization-occupancy:${blueprint.ordinal}`) % 46;
  return Math.max(1, Math.min(capacity - 1, Math.floor(capacity * occupancyPercent / 100)));
}

function boundedShare(capacity: number, numerator: number, denominator = 100) {
  return Math.max(1, Math.min(capacity, Math.floor(capacity * numerator / denominator)));
}

function node(input: Omit<StoryOrganizationHierarchyNode, "children" | "currentMemberCount"> & { children?: StoryOrganizationHierarchyNode[] }): StoryOrganizationHierarchyNode {
  return { ...input, currentMemberCount: 0, children: input.children ?? [] };
}

function hierarchyFor(input: {
  organizationId: string;
  name: string;
  archetype: StoryOrganizationArchetype;
  capacity: number;
}): StoryOrganizationHierarchyNode {
  const id = (suffix: string) => `${input.organizationId}:node:${suffix}`;
  const sectRankChildren = (
    prefix: string,
    capacity: number,
    specialistRoles: readonly string[],
  ) => [
    node({ nodeId: id(`${prefix}-leadership`), label: "主事與親傳", kind: "rank", memberCapacity: boundedShare(capacity, 8), roles: [...specialistRoles.slice(0, 1), "親傳弟子"], assets: [] }),
    node({ nodeId: id(`${prefix}-true`), label: "真傳", kind: "rank", memberCapacity: boundedShare(capacity, 12), roles: ["真傳弟子", ...specialistRoles.slice(1, 2)], assets: [] }),
    node({ nodeId: id(`${prefix}-inner`), label: "內門", kind: "rank", memberCapacity: boundedShare(capacity, 28), roles: ["內門弟子", ...specialistRoles.slice(1)], assets: [] }),
    node({ nodeId: id(`${prefix}-outer`), label: "外門", kind: "rank", memberCapacity: boundedShare(capacity, 40), roles: ["外門弟子", ...specialistRoles.slice(1)], assets: [] }),
    node({ nodeId: id(`${prefix}-service`), label: "雜役", kind: "rank", memberCapacity: boundedShare(capacity, 12), roles: ["雜役弟子", "學徒"], assets: [] }),
  ];
  const root = (children: StoryOrganizationHierarchyNode[]) => node({
    nodeId: id("root"),
    label: input.name,
    kind: "root",
    memberCapacity: input.capacity,
    roles: [],
    assets: [],
    children,
  });
  if (input.archetype === "sect") {
    return root([
      node({ nodeId: id("command"), label: "宗門權力中樞", kind: "command", memberCapacity: Math.min(input.capacity, 18), roles: ["掌門／宗主", "聖子", "聖女", "太上長老", "執法長老", "傳功長老"], assets: [] }),
      node({
        nodeId: id("factions"), label: "派系與議事席", kind: "branch", memberCapacity: boundedShare(input.capacity, 12), roles: [], assets: [],
        children: [
          node({ nodeId: id("faction-tradition"), label: "守成派", kind: "branch", memberCapacity: boundedShare(input.capacity, 5), roles: ["守成派主事", "派系執事"], assets: [] }),
          node({ nodeId: id("faction-reform"), label: "革新派", kind: "branch", memberCapacity: boundedShare(input.capacity, 4), roles: ["革新派主事", "派系執事"], assets: [] }),
          node({ nodeId: id("faction-neutral"), label: "中立派", kind: "branch", memberCapacity: boundedShare(input.capacity, 3), roles: ["中立派護法", "派系執事"], assets: [] }),
        ],
      }),
      node({
        nodeId: id("peaks-halls"), label: "峰、殿、堂編制", kind: "branch", memberCapacity: boundedShare(input.capacity, 88), roles: ["峰主", "堂主", "護法", "執事"], assets: [],
        children: [
          node({
            nodeId: id("sword-peak"), label: "主峰／劍峰", kind: "branch", memberCapacity: boundedShare(input.capacity, 28), roles: ["峰主", "劍修"], assets: ["核心功法", "劍典"],
            children: sectRankChildren("sword-peak", boundedShare(input.capacity, 28), ["峰主", "劍修"]),
          }),
          node({
            nodeId: id("alchemy-hall"), label: "丹堂", kind: "branch", memberCapacity: boundedShare(input.capacity, 22), roles: ["丹堂長老", "丹師", "藥童"], assets: ["丹方", "丹藥", "靈植"],
            children: sectRankChildren("alchemy-hall", boundedShare(input.capacity, 22), ["丹堂長老", "丹師", "藥童"]),
          }),
          node({
            nodeId: id("talisman-hall"), label: "符堂", kind: "branch", memberCapacity: boundedShare(input.capacity, 18), roles: ["符堂長老", "符師"], assets: ["符籙", "符紙", "靈墨"],
            children: sectRankChildren("talisman-hall", boundedShare(input.capacity, 18), ["符堂長老", "符師"]),
          }),
          node({
            nodeId: id("formation-hall"), label: "陣堂", kind: "branch", memberCapacity: boundedShare(input.capacity, 20), roles: ["陣堂長老", "陣師"], assets: ["陣法", "陣盤", "護山大陣"],
            children: sectRankChildren("formation-hall", boundedShare(input.capacity, 20), ["陣堂長老", "陣師"]),
          }),
        ],
      }),
      node({ nodeId: id("inheritance"), label: "傳承與戰略資產", kind: "asset", memberCapacity: 0, roles: [], assets: ["功法", "符籙", "丹藥", "陣法", "秘境名額", "靈脈"] }),
    ]);
  }
  if (input.archetype === "family") {
    return root([
      node({ nodeId: id("command"), label: "家主議事層", kind: "command", memberCapacity: Math.min(input.capacity, 16), roles: ["家主／族長", "族老", "少主", "繼承人"], assets: [] }),
      node({
        nodeId: id("houses"), label: "房系與支脈", kind: "branch", memberCapacity: boundedShare(input.capacity, 72), roles: [], assets: [],
        children: [
          node({ nodeId: id("house-main"), label: "嫡系長房", kind: "branch", memberCapacity: boundedShare(input.capacity, 24), roles: ["長房主事", "嫡系子弟"], assets: [] }),
          node({ nodeId: id("house-second"), label: "二房支脈", kind: "branch", memberCapacity: boundedShare(input.capacity, 24), roles: ["房主", "旁支子弟"], assets: [] }),
          node({ nodeId: id("house-third"), label: "外地支脈", kind: "branch", memberCapacity: boundedShare(input.capacity, 24), roles: ["支脈主事", "旁支子弟"], assets: [] }),
        ],
      }),
      node({
        nodeId: id("business"), label: "家業與資產管理", kind: "branch", memberCapacity: boundedShare(input.capacity, 18), roles: [], assets: ["祖產", "商號／企業股權", "家傳技藝", "契約"],
        children: [
          node({ nodeId: id("business-estate"), label: "祖產與產業部", kind: "branch", memberCapacity: boundedShare(input.capacity, 10), roles: ["總管", "產業主事"], assets: ["祖產", "商號／企業股權"] }),
          node({ nodeId: id("business-accounts"), label: "帳房與護衛部", kind: "branch", memberCapacity: boundedShare(input.capacity, 8), roles: ["帳房", "護衛主管"], assets: ["契約", "家傳技藝"] }),
        ],
      }),
      node({
        nodeId: id("external"), label: "家臣、客卿與外親", kind: "rank", memberCapacity: boundedShare(input.capacity, 22), roles: [], assets: [],
        children: [
          node({ nodeId: id("retainers"), label: "家臣", kind: "rank", memberCapacity: boundedShare(input.capacity, 10), roles: ["家臣", "護院"], assets: [] }),
          node({ nodeId: id("guests"), label: "客卿", kind: "rank", memberCapacity: boundedShare(input.capacity, 6), roles: ["客卿", "外聘顧問"], assets: [] }),
          node({ nodeId: id("relatives"), label: "外親與盟親", kind: "rank", memberCapacity: boundedShare(input.capacity, 6), roles: ["外姓盟親", "姻親代表"], assets: [] }),
        ],
      }),
    ]);
  }
  if (input.archetype === "enterprise") {
    return root([
      node({ nodeId: id("board"), label: "所有權與董事會", kind: "command", memberCapacity: Math.min(input.capacity, 24), roles: ["董事長", "董事", "監察人", "股東代表"], assets: ["股權", "投票權"] }),
      node({ nodeId: id("executives"), label: "經營決策層", kind: "command", memberCapacity: Math.min(input.capacity, 32), roles: ["執行長", "營運長", "財務長", "法務長"], assets: [] }),
      node({
        nodeId: id("divisions"), label: "事業群與子公司", kind: "branch", memberCapacity: boundedShare(input.capacity, 38), roles: [], assets: ["品牌", "供應鏈", "通路"],
        children: [
          node({ nodeId: id("division-core"), label: "核心事業群", kind: "branch", memberCapacity: boundedShare(input.capacity, 18), roles: ["事業群總經理", "區域主管"], assets: ["品牌", "通路"] }),
          node({ nodeId: id("division-subsidiary"), label: "子公司群", kind: "branch", memberCapacity: boundedShare(input.capacity, 20), roles: ["子公司負責人", "區域主管"], assets: ["供應鏈"] }),
        ],
      }),
      node({
        nodeId: id("departments"), label: "部門與專案", kind: "rank", memberCapacity: input.capacity, roles: [], assets: ["資金", "資料", "專利／技術", "客戶關係"],
        children: [
          node({ nodeId: id("department-product"), label: "產品部", kind: "branch", memberCapacity: boundedShare(input.capacity, 28), roles: ["部門主管", "產品經理", "專員"], assets: ["產品路線圖", "專利／技術"] }),
          node({ nodeId: id("department-operations"), label: "營運部", kind: "branch", memberCapacity: boundedShare(input.capacity, 28), roles: ["部門主管", "專案負責人", "資深專員"], assets: ["資金", "供應鏈"] }),
          node({ nodeId: id("department-sales"), label: "業務部", kind: "branch", memberCapacity: boundedShare(input.capacity, 24), roles: ["部長", "區域主管", "專員"], assets: ["客戶關係", "通路"] }),
          node({ nodeId: id("department-admin"), label: "財務法務部", kind: "branch", memberCapacity: boundedShare(input.capacity, 20), roles: ["部門主管", "財務專員", "法務專員"], assets: ["財務資料", "合約"] }),
        ],
      }),
    ]);
  }
  const genericRoles = ROLE_CATALOG[input.archetype];
  return root([
    node({ nodeId: id("command"), label: "核心決策層", kind: "command", memberCapacity: Math.min(input.capacity, 24), roles: [...genericRoles.slice(0, 3)], assets: [] }),
    node({ nodeId: id("branches"), label: "分支與地方單位", kind: "branch", memberCapacity: boundedShare(input.capacity, 45), roles: [...genericRoles.slice(3, 6)], assets: [] }),
    node({ nodeId: id("members"), label: "執行與基層位階", kind: "rank", memberCapacity: input.capacity, roles: [...genericRoles.slice(6)], assets: [] }),
    node({ nodeId: id("assets"), label: "制度與戰略資產", kind: "asset", memberCapacity: 0, roles: [], assets: input.archetype === "academy" ? ["研究資料", "課程", "實驗設備", "學術聲望"] : input.archetype === "government" ? ["法令", "預算", "人事權", "公共設施"] : ["情報網", "安全屋", "通行憑證", "契約"] }),
  ]);
}

function membershipLeaves(root: StoryOrganizationHierarchyNode): StoryOrganizationHierarchyNode[] {
  if (root.kind === "asset" || root.memberCapacity <= 0) return [];
  if (!root.children.length) return [root];
  return root.children.flatMap((child) => membershipLeaves(child));
}

function membershipQuotas(
  root: StoryOrganizationHierarchyNode,
  currentMemberCount: number,
  seed: string,
) {
  const leaves = membershipLeaves(root);
  const totalLeafCapacity = leaves.reduce((sum, leaf) => sum + leaf.memberCapacity, 0);
  if (!leaves.length || totalLeafCapacity < 1) return [];
  const quotas = leaves.map((leaf) => ({
    leaf,
    count: Math.min(
      leaf.memberCapacity,
      Math.floor(currentMemberCount * leaf.memberCapacity / totalLeafCapacity),
    ),
  }));
  let remainder = currentMemberCount - quotas.reduce((sum, entry) => sum + entry.count, 0);
  const rotation = socialMatrixHash(`${seed}:quota-rotation`) % quotas.length;
  for (let step = 0; remainder > 0 && step < quotas.length * 2; step += 1) {
    const entry = quotas[(rotation + step) % quotas.length]!;
    if (entry.count >= entry.leaf.memberCapacity) continue;
    entry.count += 1;
    remainder -= 1;
  }
  if (remainder > 0) throw new Error("STORY_ORGANIZATION_HIERARCHY_CAPACITY_INSUFFICIENT");
  return quotas;
}

function withCurrentMemberCounts(
  root: StoryOrganizationHierarchyNode,
  currentMemberCount: number,
  seed: string,
): StoryOrganizationHierarchyNode {
  const counts = new Map(
    membershipQuotas(root, currentMemberCount, seed)
      .map((entry) => [entry.leaf.nodeId, entry.count] as const),
  );
  const visit = (current: StoryOrganizationHierarchyNode): StoryOrganizationHierarchyNode => {
    const children = current.children.map(visit);
    const nextCount = current.kind === "asset"
      ? 0
      : children.length
        ? children.reduce((sum, child) => sum + child.currentMemberCount, 0)
        : counts.get(current.nodeId) ?? 0;
    return { ...current, currentMemberCount: nextCount, children };
  };
  const counted = visit(root);
  return { ...counted, currentMemberCount };
}

function hierarchyPath(
  root: StoryOrganizationHierarchyNode,
  targetNodeId: string,
  path: StoryOrganizationHierarchyNode[] = [],
): StoryOrganizationHierarchyNode[] | null {
  const nextPath = [...path, root];
  if (root.nodeId === targetNodeId) return nextPath;
  for (const child of root.children) {
    const match = hierarchyPath(child, targetNodeId, nextPath);
    if (match) return match;
  }
  return null;
}

function membershipLeafForOffset(
  organization: Pick<StoryOrganizationDirectoryEntry, "organizationId" | "hierarchy" | "currentMemberCount">,
  memberOffset: number,
) {
  if (!Number.isSafeInteger(memberOffset) || memberOffset < 0 || memberOffset >= organization.currentMemberCount) {
    throw new Error("STORY_ORGANIZATION_MEMBER_OFFSET_OUT_OF_RANGE");
  }
  const quotas = membershipQuotas(
    organization.hierarchy,
    organization.currentMemberCount,
    organization.organizationId,
  );
  const rotatedOffset = (
    memberOffset
    + socialMatrixHash(`${organization.organizationId}:member-rotation`)
  ) % organization.currentMemberCount;
  let boundary = 0;
  for (const entry of quotas) {
    boundary += entry.count;
    if (rotatedOffset < boundary) return entry.leaf;
  }
  throw new Error("STORY_ORGANIZATION_MEMBER_HIERARCHY_MISSING");
}

export function organizationMembershipForOffset(
  organization: Pick<StoryOrganizationDirectoryEntry, "organizationId" | "archetype" | "hierarchy" | "currentMemberCount">,
  memberOffset: number,
): StoryOrganizationMembership {
  const leaf = membershipLeafForOffset(organization, memberOffset);
  const path = hierarchyPath(organization.hierarchy, leaf.nodeId);
  if (!path) throw new Error("STORY_ORGANIZATION_HIERARCHY_NODE_NOT_FOUND");
  const organizationRank = leaf.kind === "rank"
    ? leaf.roles[0] ?? leaf.label
    : leaf.roles[
        socialMatrixHash(`${organization.organizationId}:member-role:${memberOffset}`) % Math.max(1, leaf.roles.length)
      ] ?? leaf.label;
  const structuralPath = path.filter((entry) => entry.kind === "branch" || entry.kind === "rank");
  const organizationUnit = [...path].reverse().find((entry) => entry.kind === "branch")?.label
    ?? structuralPath.at(-1)?.label
    ?? leaf.label;
  const factionNode = organization.archetype === "sect"
    ? path.find((entry) => /派$/u.test(entry.label))
    : structuralPath.at(-1);
  const organizationFaction = factionNode?.label
    ?? (organization.archetype === "sect"
      ? ["守成派", "革新派", "中立派"][socialMatrixHash(`${organization.organizationId}:member-faction:${memberOffset}`) % 3]!
      : organizationUnit);
  return {
    hierarchyNodeId: leaf.nodeId,
    hierarchyPathIds: path.map((entry) => entry.nodeId),
    hierarchyPathLabels: path.map((entry) => entry.label),
    organizationUnit,
    organizationRank,
    organizationFaction,
  };
}

export function cultivationProfileForOrganizationMember(input: {
  organization: Pick<StoryOrganizationDirectoryEntry, "organizationId" | "archetype">;
  member: StoryOrganizationMember;
  approvedAt: string;
}): CharacterCultivationProfile | null {
  if (input.organization.archetype !== "sect") return null;
  const powerTierRealm: Record<SocialMatrixCharacter["abilities"]["powerTier"], string> = {
    凡俗: "realm:mortal",
    初境: "realm:qi-refining",
    登堂: "realm:foundation",
    一方強者: "realm:golden-core",
    宗師: "realm:nascent-soul",
  };
  const stages = ["初期", "中期", "後期", "圓滿"] as const;
  const spiritRoots = ["metal", "wood", "water", "fire", "earth", "wind", "lightning"] as const;
  const unitPathIndex = input.member.hierarchyPathLabels.lastIndexOf(input.member.organizationUnit);
  const branchNodeId = unitPathIndex >= 0
    ? input.member.hierarchyPathIds[unitPathIndex]
    : input.member.hierarchyNodeId;
  const branchKey = branchNodeId?.split(":node:").at(-1) ?? "main";
  const rankKey = input.member.organizationRank.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "") || "member";
  return {
    schemaVersion: "character-cultivation-profile-v1",
    spiritRootId: `spirit-root:${spiritRoots[socialMatrixHash(`${input.member.characterId}:spirit-root`) % spiritRoots.length]}`,
    realmId: powerTierRealm[input.member.abilities.powerTier],
    realmStage: stages[socialMatrixHash(`${input.member.characterId}:realm-stage`) % stages.length]!,
    sectBranchId: `${input.organization.organizationId}:branch:${branchKey}`,
    sectRankId: `${input.organization.organizationId}:rank:${rankKey}`,
    techniqueIds: [
      `${input.organization.organizationId}:technique:${branchKey}`,
      `${input.organization.organizationId}:technique:foundation`,
    ],
    approvedAt: input.approvedAt,
  };
}

export function buildStoryOrganizationDirectory(input: {
  seed: string;
  setting: StoryOrganizationSetting;
  blueprints: readonly StoryOrganizationBlueprint[];
  institutions: readonly SocialInstitution[];
}): StoryOrganizationDirectoryEntry[] {
  if (input.blueprints.length !== input.institutions.length) {
    throw new Error("STORY_ORGANIZATION_DIRECTORY_SOURCE_MISMATCH");
  }
  return input.blueprints.map((blueprint, index) => {
    const institution = input.institutions[index]!;
    const size = organizationCapacity(input.seed, blueprint, institution.influence);
    const currentMemberCount = organizationCurrentMemberCount(
      input.seed,
      blueprint,
      size.memberCapacity,
    );
    const hierarchy = hierarchyFor({
      organizationId: institution.institutionId,
      name: institution.name,
      archetype: blueprint.archetype,
      capacity: size.memberCapacity,
    });
    return {
      organizationId: institution.institutionId,
      institutionIndex: institution.institutionIndex,
      archetype: blueprint.archetype,
      kindLabel: blueprint.kindLabel,
      name: institution.name,
      era: blueprint.era,
      eraLabel: blueprint.eraLabel,
      backgroundLabel: input.setting.backgroundLabel,
      sizeLabel: size.sizeLabel,
      memberCapacity: size.memberCapacity,
      currentMemberCount,
      territory: institution.territory,
      doctrine: institution.doctrine,
      publicGoal: institution.publicGoal,
      hiddenConflict: institution.hiddenConflict,
      hierarchy: withCurrentMemberCounts(
        hierarchy,
        currentMemberCount,
        institution.institutionId,
      ),
    };
  }).filter((organization) => storyOrganizationEraCompatible(input.setting, organization.era));
}

export function organizationMemberPage(input: {
  matrix: DeterministicSocialMatrix;
  organization: StoryOrganizationDirectoryEntry;
  page: number;
  pageSize: number;
  hierarchyNodeId?: string | null;
}): SocialMatrixPage<StoryOrganizationMember> {
  const page = Math.max(0, Math.floor(input.page));
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize)));
  const matchingMemberOffsets = Array.from(
    { length: input.organization.currentMemberCount },
    (_, memberOffset) => memberOffset,
  ).filter((memberOffset) => {
    if (!input.hierarchyNodeId || input.hierarchyNodeId === input.organization.hierarchy.nodeId) return true;
    return organizationMembershipForOffset(input.organization, memberOffset)
      .hierarchyPathIds.includes(input.hierarchyNodeId);
  });
  const filteredOffset = page * pageSize;
  if (filteredOffset >= matchingMemberOffsets.length) {
    return { items: [], nextCursor: null, total: matchingMemberOffsets.length };
  }
  const pageMemberOffsets = matchingMemberOffsets.slice(filteredOffset, filteredOffset + pageSize);
  const items = pageMemberOffsets.map((memberOffset) => {
    const source = input.matrix.listInstitutionMembers(input.organization.institutionIndex, {
      cursor: `institution-${input.organization.institutionIndex}:${memberOffset}`,
      limit: 1,
    }).items[0];
    if (!source) throw new Error("STORY_ORGANIZATION_MEMBER_SOURCE_MISSING");
    const membership = organizationMembershipForOffset(input.organization, memberOffset);
    const specialistLocation = [
      ["丹堂", "丹堂藥圃"],
      ["符堂", "藏符閣"],
      ["陣堂", "護山陣眼"],
      ["劍峰", "主峰劍坪"],
      ["董事", "總部董事會議室"],
      ["營運", "營運中心"],
      ["研發", "研發工坊"],
      ["家主", "祖宅議事廳"],
      ["嫡系", "祖宅內院"],
      ["旁支", "支脈別院"],
    ].find(([signal]) => membership.hierarchyPathLabels.some((label) => label.includes(signal!)))?.[1];
    const locationPools: Record<StoryOrganizationArchetype, readonly string[]> = {
      sect: ["主峰議事殿", "傳功閣", "試煉臺", "外門院"],
      family: ["祖宅議事廳", "家祠", "藏書樓", "支脈別院"],
      enterprise: ["總部決策層", "營運中心", "產品部", "區域事業群"],
      government: ["中樞議事廳", "地方署衙", "檔案庫", "外勤駐點"],
      academy: ["講堂", "研究院", "藏書館", "實作工坊"],
      guild: ["盟會議事廳", "情報站", "公共會所", "外勤據點"],
    };
    const locationPool = locationPools[input.organization.archetype];
    const organizationLocation = specialistLocation
      ?? locationPool[socialMatrixHash(`${input.organization.organizationId}:member-location:${memberOffset}`) % locationPool.length]!;
    return {
      ...source,
      ...membership,
      storyAffinity: `${input.organization.eraLabel} · ${input.organization.kindLabel}`,
      location: `${input.organization.territory} · ${organizationLocation}`,
      portrait: {
        ...source.portrait,
        description: `${input.organization.eraLabel}${input.organization.kindLabel}人物；${membership.organizationUnit}的${membership.organizationRank}，採固定原創抽象人像。`,
      },
      institutionRole: membership.organizationRank,
      identity: `${input.organization.name}的${membership.organizationRank}，隸屬${membership.organizationUnit}（${membership.organizationFaction}），目前常駐${input.organization.territory}的${organizationLocation}`,
    };
  });
  const end = filteredOffset + items.length;
  return {
    items,
    nextCursor: end < matchingMemberOffsets.length
      ? `organization-${input.organization.institutionIndex}:${end}`
      : null,
    total: matchingMemberOffsets.length,
  };
}

export function organizationMatrixContext(input: {
  setting: StoryOrganizationSetting;
  base: ProceduralStoryContext;
}): ProceduralStoryContext {
  return {
    ...input.base,
    genre: [input.setting.eraLabel, input.setting.backgroundLabel, input.base.genre].filter(Boolean).join("／"),
    storyTags: [
      ...(input.base.storyTags ?? []),
      input.setting.eraLabel,
      input.setting.backgroundLabel,
    ],
  };
}
