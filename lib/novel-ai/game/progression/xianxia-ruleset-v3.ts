import type {
  ChoiceRequirement,
  CultivationRealmDefinition,
  CultivationRealmState,
  NarrativeMeterState,
  ResourceDefinition,
  RpgDerivedCultivationStats,
  RpgDifficulty,
  RpgStateV3,
  RpgTurnSettlement,
  RpgTurnSnapshot,
  StoryChoiceEffect,
  StoryState,
} from "../../domain";
import {
  RPG_FORMULA_V3,
  RPG_STATE_V3_SCHEMA_VERSION,
} from "../../domain";

export const XIANXIA_RULESET_ID = "xianxia-cultivation-v3" as const;
export const MINGTAN_PRESET_ID = "xianxia.mingtan.v1" as const;
export const GENERIC_RPG_V3_RULESET_ID = "unified-generic-v3" as const;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));

const numberFrom = (value: unknown, fallback: number) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

export const NARRATIVE_METER_RANGES = {
  daoHeart: [0, 100],
  mindDemon: [0, 100],
  karma: [-100, 100],
  merit: [0, 100],
  fate: [0, 100],
  pursuit: [0, 100],
  injury: [0, 100],
  sectReputation: [-100, 100],
  worldAttention: [0, 100],
} as const satisfies Record<keyof NarrativeMeterState, readonly [number, number]>;

export const DEFAULT_NARRATIVE_METERS: NarrativeMeterState = {
  daoHeart: 50,
  mindDemon: 10,
  karma: 0,
  merit: 0,
  fate: 50,
  pursuit: 0,
  injury: 0,
  sectReputation: 0,
  worldAttention: 0,
};

export function clampNarrativeMeters(
  input: Partial<NarrativeMeterState> | null | undefined,
): NarrativeMeterState {
  return Object.fromEntries(Object.entries(NARRATIVE_METER_RANGES).map(([key, range]) => {
    const meter = key as keyof NarrativeMeterState;
    return [meter, Math.round(clamp(numberFrom(input?.[meter], DEFAULT_NARRATIVE_METERS[meter]), range[0], range[1]))];
  })) as NarrativeMeterState;
}

export const CULTIVATION_REALM_CATALOG_V3: readonly CultivationRealmDefinition[] = [
  {
    id: "realm.mortal-body",
    localizedName: "鍛體／凡俗",
    levelRange: [0, 0],
    lifespanDescription: "凡人壽元，視體魄與傷勢而定",
    narrativePowerRange: "鍛鍊肉身、兵器與凡俗技藝",
    cultivationQualityMultiplier: 1,
    advancementRequirements: ["完成引氣入體", "根基完整度至少 50"],
    requiredResources: {},
    requiredMeters: { injury: { maximum: 70 } },
    typicalRisks: ["經脈受損", "基礎不穩"],
    tribulationProfile: { baseRealmTribulation: 0, lifeAndDeathRiskDisclosed: false, stages: 0 },
    failureProfiles: ["修行停滯", "輕傷並保留重新嘗試機會"],
    unlockedCapabilities: ["感應靈氣"],
  },
  {
    id: "realm.qi-refining",
    localizedName: "煉氣",
    levelRange: [1, 12],
    lifespanDescription: "約百年至一百五十年",
    narrativePowerRange: "引氣、基礎術法與御使低階法器",
    cultivationQualityMultiplier: 1.08,
    advancementRequirements: ["氣海穩定", "煉氣圓滿"],
    requiredResources: { "currency.spiritStone": 12 },
    requiredMeters: { daoHeart: { minimum: 35 }, injury: { maximum: 55 } },
    typicalRisks: ["走火入魔", "靈力逆衝"],
    tribulationProfile: { baseRealmTribulation: 8, lifeAndDeathRiskDisclosed: false, stages: 1 },
    failureProfiles: ["帶傷退回煉氣後期", "根基完整度下降"],
    unlockedCapabilities: ["靈力外放", "低階符籙"],
  },
  {
    id: "realm.foundation",
    localizedName: "築基",
    levelRange: [13, 19],
    lifespanDescription: "約二百年至三百年",
    narrativePowerRange: "建立道基、御器飛行與正式入宗",
    cultivationQualityMultiplier: 1.2,
    advancementRequirements: ["完成築基", "道心穩定"],
    requiredResources: { "currency.spiritStone": 60, "material.spiritHerb": 3 },
    requiredMeters: { daoHeart: { minimum: 45 }, mindDemon: { maximum: 60 } },
    typicalRisks: ["道基有缺", "心魔滋生"],
    tribulationProfile: { baseRealmTribulation: 16, lifeAndDeathRiskDisclosed: false, stages: 1 },
    failureProfiles: ["半步築基", "道基受損"],
    unlockedCapabilities: ["御器飛行", "開闢洞府"],
  },
  {
    id: "realm.golden-core",
    localizedName: "金丹／結丹",
    levelRange: [20, 29],
    lifespanDescription: "約五百年至八百年",
    narrativePowerRange: "凝結金丹、鎮守一域與開宗授徒",
    cultivationQualityMultiplier: 1.42,
    advancementRequirements: ["丹成無悔", "清償主要因果"],
    requiredResources: { "currency.spiritStone": 240, "material.daoMarkFragment": 1 },
    requiredMeters: { daoHeart: { minimum: 55 }, mindDemon: { maximum: 55 } },
    typicalRisks: ["碎丹", "丹毒", "因果雷劫"],
    tribulationProfile: { baseRealmTribulation: 30, lifeAndDeathRiskDisclosed: true, stages: 3 },
    failureProfiles: ["假丹", "碎丹退階", "根基重創"],
    unlockedCapabilities: ["金丹法域", "宗門長老權限"],
  },
  {
    id: "realm.nascent-soul",
    localizedName: "元嬰",
    levelRange: [30, 39],
    lifespanDescription: "約千年至兩千年",
    narrativePowerRange: "元嬰出竅、跨域遠行與重塑肉身",
    cultivationQualityMultiplier: 1.72,
    advancementRequirements: ["神魂與金丹合一", "完成元嬰劫"],
    requiredResources: { "currency.spiritStone": 900, "material.daoMarkFragment": 3 },
    requiredMeters: { daoHeart: { minimum: 60 }, worldAttention: { maximum: 90 } },
    typicalRisks: ["元嬰潰散", "天劫追索"],
    tribulationProfile: { baseRealmTribulation: 48, lifeAndDeathRiskDisclosed: true, stages: 4 },
    failureProfiles: ["元嬰有缺", "神魂受創", "劫下殞落（僅限已揭示生死劫）"],
    unlockedCapabilities: ["元嬰出竅", "跨域傳送"],
  },
  {
    id: "realm.spirit-transformation",
    localizedName: "化神",
    levelRange: [40, 49],
    lifespanDescription: "約三千年至五千年",
    narrativePowerRange: "神識化域、影響一國與承擔界域因果",
    cultivationQualityMultiplier: 2.08,
    advancementRequirements: ["神識化域", "界域承認"],
    requiredResources: { "currency.spiritStone": 2_400, "material.daoMarkFragment": 6 },
    requiredMeters: { daoHeart: { minimum: 65 }, mindDemon: { maximum: 50 } },
    typicalRisks: ["神識反噬", "界域排斥"],
    tribulationProfile: { baseRealmTribulation: 66, lifeAndDeathRiskDisclosed: true, stages: 5 },
    failureProfiles: ["半步化神", "神識領域崩落"],
    unlockedCapabilities: ["神識領域", "界域感應"],
  },
  {
    id: "realm.void-refining",
    localizedName: "煉虛",
    levelRange: [50, 59],
    lifespanDescription: "約八千年至一萬二千年",
    narrativePowerRange: "煉化虛空、跨界遠征與法則初悟",
    cultivationQualityMultiplier: 2.5,
    advancementRequirements: ["掌握一項法則雛形", "承受虛空風暴"],
    requiredResources: { "currency.spiritStone": 8_000, "material.daoMarkFragment": 12 },
    requiredMeters: { daoHeart: { minimum: 70 }, mindDemon: { maximum: 45 } },
    typicalRisks: ["迷失虛空", "法則反噬"],
    tribulationProfile: { baseRealmTribulation: 84, lifeAndDeathRiskDisclosed: true, stages: 6 },
    failureProfiles: ["虛空灼傷", "法則雛形崩解"],
    unlockedCapabilities: ["短距破界", "法則雛形"],
  },
  {
    id: "realm.integration",
    localizedName: "合體",
    levelRange: [60, 69],
    lifespanDescription: "約兩萬年至三萬年",
    narrativePowerRange: "神魂法體合一、統御大型宗門與界域戰爭",
    cultivationQualityMultiplier: 3,
    advancementRequirements: ["法體神魂無缺", "建立穩定道統"],
    requiredResources: { "currency.spiritStone": 24_000, "material.daoMarkFragment": 24 },
    requiredMeters: { daoHeart: { minimum: 75 }, sectReputation: { minimum: 10 } },
    typicalRisks: ["法體分離", "道統反噬"],
    tribulationProfile: { baseRealmTribulation: 106, lifeAndDeathRiskDisclosed: true, stages: 7 },
    failureProfiles: ["合體不全", "宗門氣運受損"],
    unlockedCapabilities: ["法體合一", "道統加持"],
  },
  {
    id: "realm.mahayana",
    localizedName: "大乘",
    levelRange: [70, 79],
    lifespanDescription: "約五萬年以上",
    narrativePowerRange: "凡界巔峰、跨界立道與庇護一界",
    cultivationQualityMultiplier: 3.65,
    advancementRequirements: ["完成凡界道果", "準備飛升"],
    requiredResources: { "currency.spiritStone": 80_000, "material.daoMarkFragment": 48 },
    requiredMeters: { daoHeart: { minimum: 80 }, mindDemon: { maximum: 40 } },
    typicalRisks: ["道果崩解", "上界注視"],
    tribulationProfile: { baseRealmTribulation: 132, lifeAndDeathRiskDisclosed: true, stages: 8 },
    failureProfiles: ["道果有缺", "飛升門關閉"],
    unlockedCapabilities: ["界域庇護", "飛升準備"],
  },
  {
    id: "realm.tribulation",
    localizedName: "渡劫",
    levelRange: [80, 89],
    lifespanDescription: "壽元取決於渡劫進度與界域法則",
    narrativePowerRange: "直面飛升雷劫、因果劫與心魔劫",
    cultivationQualityMultiplier: 4.5,
    advancementRequirements: ["公開承擔飛升生死劫", "完成所有劫段"],
    requiredResources: { "currency.spiritStone": 240_000, "material.daoMarkFragment": 96 },
    requiredMeters: { daoHeart: { minimum: 85 }, mindDemon: { maximum: 35 } },
    typicalRisks: ["帶傷飛升", "退階", "劫下殞落"],
    tribulationProfile: { baseRealmTribulation: 168, lifeAndDeathRiskDisclosed: true, stages: 9 },
    failureProfiles: ["半步突破", "退階", "根基受損", "劫下殞落（已揭示）"],
    unlockedCapabilities: ["引動天劫", "飛升通道"],
  },
  {
    id: "realm.true-immortal",
    localizedName: "真仙",
    levelRange: [90, null],
    lifespanDescription: "仙壽，以仙界法則與道果維繫",
    narrativePowerRange: "仙界立足、凝聚仙道法則",
    cultivationQualityMultiplier: 5.5,
    advancementRequirements: ["完成飛升", "仙體與道果穩定"],
    requiredResources: { "material.daoMarkFragment": 160 },
    requiredMeters: { daoHeart: { minimum: 88 } },
    typicalRisks: ["仙界排斥", "道果污染"],
    tribulationProfile: { baseRealmTribulation: 210, lifeAndDeathRiskDisclosed: true, stages: 10 },
    failureProfiles: ["仙體有缺", "跌落凡界"],
    unlockedCapabilities: ["仙體", "仙道法則"],
  },
] as const;

export const CULTIVATION_REALM_EXTENSION_SLOTS = [
  "realm.mysterious-immortal",
  "realm.golden-immortal",
  "realm.taiyi-golden-immortal",
  "realm.daluo-golden-immortal",
  "realm.divine-world",
] as const;

export function cultivationRealmForLevel(level: number): CultivationRealmDefinition {
  const normalized = Math.max(0, Math.floor(numberFrom(level, 0)));
  return CULTIVATION_REALM_CATALOG_V3.find((definition) => {
    const [minimum, maximum] = definition.levelRange;
    return normalized >= minimum && (maximum === null || normalized <= maximum);
  }) ?? CULTIVATION_REALM_CATALOG_V3[0];
}

export function normalizeRealmState(input: CultivationRealmState | null | undefined): CultivationRealmState | null {
  if (!input) return null;
  const definition = CULTIVATION_REALM_CATALOG_V3.find((item) => item.id === input.definitionId)
    ?? cultivationRealmForLevel(input.level);
  const maximum = definition.levelRange[1] ?? Math.max(90, input.level);
  const level = Math.round(clamp(input.level, definition.levelRange[0], maximum));
  return {
    definitionId: definition.id,
    level,
    stage: ["early", "middle", "late", "peak"].includes(input.stage) ? input.stage : "early",
    progress: Math.round(clamp(input.progress, 0, 100)),
    foundationIntegrity: Math.round(clamp(input.foundationIntegrity, 0, 100)),
    lastBreakthroughTurn: input.lastBreakthroughTurn === null
      ? null
      : Math.max(0, Math.round(numberFrom(input.lastBreakthroughTurn, 0))),
  };
}

export const RPG_RESOURCE_CATALOG_V3: readonly ResourceDefinition[] = [
  { id: "currency.spiritStone", localizedName: "𩆜石", type: "currency", description: "修煉、交易、陣法與宗門維護的基礎通貨。", nonNegative: true, sources: ["宗門任務堂", "坊市", "公會懸賞", "拍賣場", "秘境", "靈脈"], sinks: ["修煉", "煉丹", "製符", "煉器", "布陣", "宗門維護", "渡劫"] },
  { id: "currency.contribution", localizedName: "宗門貢獻", type: "currency", description: "完成宗門責任後取得的內部信用。", nonNegative: true, sources: ["宗門任務堂", "宗門維護"], sinks: ["功法兌換", "宗門設施", "情報"] },
  { id: "currency.favor", localizedName: "人情", type: "social_capital", description: "可兌現、也會形成後續義務的關係資本。", nonNegative: true, sources: ["互助", "救援", "交涉"], sinks: ["情報交換", "請託", "外力干預"] },
  { id: "currency.faith", localizedName: "香火／信仰", type: "social_capital", description: "凡俗與信眾對宗門的長期支持。", nonNegative: true, sources: ["庇護凡城", "宗門治理"], sinks: ["大型陣法", "界域庇護"] },
  { id: "material.spiritHerb", localizedName: "靈草", type: "material", description: "煉丹與療傷材料。", nonNegative: true, sources: ["靈田", "秘境", "坊市"], sinks: ["煉丹", "療傷"] },
  { id: "material.spiritOre", localizedName: "靈礦", type: "material", description: "煉器與陣基材料。", nonNegative: true, sources: ["礦脈", "秘境"], sinks: ["煉器", "布陣"] },
  { id: "material.talismanPaper", localizedName: "符紙", type: "material", description: "製符基材。", nonNegative: true, sources: ["坊市", "宗門工坊"], sinks: ["製符"] },
  { id: "material.spiritInk", localizedName: "靈墨", type: "material", description: "高階符籙與契約材料。", nonNegative: true, sources: ["坊市", "秘境"], sinks: ["製符", "契約"] },
  { id: "material.artifactEmbryo", localizedName: "法寶胚料", type: "material", description: "可鍛造成長法寶的核心胚體。", nonNegative: true, sources: ["拍賣場", "秘境", "礦脈"], sinks: ["煉器"] },
  { id: "material.arrayFlagBlank", localizedName: "空白陣旗", type: "material", description: "布置與維護陣法的耗材。", nonNegative: true, sources: ["坊市", "宗門工坊"], sinks: ["布陣", "宗門維護"] },
  { id: "material.daoMarkFragment", localizedName: "道痕碎片", type: "material", description: "高階突破與傳承所需的稀有法則材料。", nonNegative: true, sources: ["秘境", "天劫", "傳承"], sinks: ["突破", "渡劫", "法寶傳承"] },
  { id: "asset.spiritField", localizedName: "靈田", type: "strategic_asset", description: "穩定產出靈草並支援宗門招募。", nonNegative: true, sources: ["領地經營"], sinks: ["維護", "爭奪"] },
  { id: "asset.spiritVein", localizedName: "靈脈", type: "strategic_asset", description: "提高修煉效率、靈田產量與宗門聲望，也會引來爭奪。", nonNegative: true, sources: ["探索", "勢力戰"], sinks: ["維護", "過度抽取"] },
  { id: "asset.spiritSpring", localizedName: "靈泉", type: "strategic_asset", description: "提供療傷與煉丹水源。", nonNegative: true, sources: ["秘境", "領地"], sinks: ["維護"] },
  { id: "asset.mine", localizedName: "礦脈", type: "strategic_asset", description: "產出靈礦與胚料。", nonNegative: true, sources: ["探索", "領地"], sinks: ["採掘", "維護"] },
  { id: "asset.secretRealm", localizedName: "秘境", type: "strategic_asset", description: "供應稀有材料、傳承、拍賣收入與後續事件。", nonNegative: true, sources: ["探索", "勢力戰"], sinks: ["開發", "維護"] },
  { id: "asset.territory", localizedName: "領地", type: "strategic_asset", description: "支撐人口、信仰與宗門設施。", nonNegative: true, sources: ["治理", "結盟"], sinks: ["治理", "防務"] },
  { id: "asset.market", localizedName: "坊市", type: "strategic_asset", description: "帶來交易與拍賣收入。", nonNegative: true, sources: ["建設", "結盟"], sinks: ["維護", "治安"] },
  { id: "asset.informationNetwork", localizedName: "情報網", type: "strategic_asset", description: "降低未知風險並揭露勢力行動。", nonNegative: true, sources: ["交涉", "任務"], sinks: ["人情", "維護"] },
  { id: "item.spirit-market-blade", localizedName: "青鋒靈刃", type: "equipment", description: "以正式坊市交易取得的靈刃；取得與換裝必須隨回合收據結算。", nonNegative: true, sources: ["坊市", "拍賣場", "煉器"], sinks: ["耐久下降", "報廢", "拆解", "回收", "傳承"] },
  { id: "item.feminization-charm-pill", localizedName: "女體化媚心丹", type: "consumable", description: "明檀規則包的內容物品；使用仍受角色年齡、同意與內容分級保護。", nonNegative: true, sources: ["明檀規則包初始化"], sinks: ["經明確同意的內容行動"] },
  { id: "knowledge.pastLifeArchive", localizedName: "前世檔案", type: "knowledge", description: "逆命殘卷保留的失敗時間線片段；不是精確未來。", nonNegative: true, sources: ["前世記憶", "因果驗證", "秘境傳承"], sinks: ["推演", "記憶代價", "時間線偏差"] },
  { id: "knowledge.pastLifeReliability", localizedName: "前世情報可信度", type: "knowledge", description: "前世資料在目前時間線仍可採信的程度；改變重大因果後會下降。", nonNegative: true, sources: ["親身記憶", "系統驗證", "情報網"], sinks: ["時間線偏差", "敵方適應", "情緒扭曲"] },
  { id: "knowledge.timelineDeviation", localizedName: "時間線偏差", type: "knowledge", description: "今世與失敗時間線的差異；越高代表前世記憶越不能當成答案。", nonNegative: true, sources: ["救下原定死亡者", "提前奪取機緣", "改變勢力格局"], sinks: ["重新驗證", "接受未知未來"] },
  { id: "knowledge.blackMarketIntel", localizedName: "黑市情報", type: "knowledge", description: "可取得稀缺線索，但每次取得都伴隨追查、設局或暴露風險。", nonNegative: true, sources: ["黑市"], sinks: ["反情報", "勢力追查", "任務"] },
  { id: "risk.heavenlyExposure", localizedName: "天道暴露", type: "knowledge", description: "逆命、時間與高階系統活動被上界察覺的累積風險。", nonNegative: true, sources: ["改變重大因果", "外力渡劫", "時間能力"], sinks: ["遮蔽陣法", "因果偽裝", "降低系統使用"] },
  { id: "social.systemDependency", localizedName: "系統依賴", type: "social_capital", description: "主角把判斷交給逆命殘卷的程度；過高會削弱自主判斷並形成反制鉤子。", nonNegative: true, sources: ["頻繁推演", "拒絕自主判斷"], sinks: ["自行驗證", "拒絕系統任務", "承擔未知"] },
  { id: "quest.mingtan.rebuildSect", localizedName: "重建合歡宗", type: "quest", description: "明檀規則包的長期宗門重建目標。", nonNegative: true, sources: ["明檀規則包初始化"], sinks: ["宗門維護", "勢力衝突"] },
  { id: "quest.mingtan.destinyAnchors", localizedName: "四位命運錨點", type: "quest", description: "尋找四位前世伴侶並尊重她們今世的獨立選擇；不等於自動恢復關係。", nonNegative: true, sources: ["前世檔案", "命錨感應"], sinks: ["信任篇章", "因果抉擇"] },
] as const;

export function migrateLegacyRpgStateToV3(
  storyState: Pick<StoryState, "resources" | "worldFlags" | "protagonistStats">,
): RpgStateV3 {
  const resources = storyState.resources ?? {};
  const worldFlags = storyState.worldFlags ?? {};
  const presetId = worldFlags["rpg.presetId"] === MINGTAN_PRESET_ID
    ? MINGTAN_PRESET_ID
    : null;
  const rulesetId = worldFlags["rpg.rulesetId"] === XIANXIA_RULESET_ID || presetId
    ? XIANXIA_RULESET_ID
    : GENERIC_RPG_V3_RULESET_ID;
  const realmLevel = Math.max(0, Math.round(numberFrom(
    resources["cultivation.realmLevel"] ?? resources["growth.realm"],
    0,
  )));
  const realmDefinition = cultivationRealmForLevel(realmLevel);
  const initializationId = typeof worldFlags["rpg.presetInitializationId"] === "string"
    ? String(worldFlags["rpg.presetInitializationId"])
    : null;
  return {
    schemaVersion: RPG_STATE_V3_SCHEMA_VERSION,
    formulaVersion: RPG_FORMULA_V3,
    rulesetId,
    presetId,
    difficulty: (worldFlags["rpg.difficulty"] === "extreme" ? "extreme" : "standard") as RpgDifficulty,
    realm: rulesetId === XIANXIA_RULESET_ID ? {
      definitionId: realmDefinition.id,
      level: realmLevel,
      stage: "early",
      progress: Math.round(clamp(numberFrom(resources["cultivation.realmProgress"], 0), 0, 100)),
      foundationIntegrity: Math.round(clamp(numberFrom(resources["cultivation.foundationIntegrity"], 75), 0, 100)),
      lastBreakthroughTurn: null,
    } : null,
    meters: clampNarrativeMeters({
      daoHeart: numberFrom(resources["meter.daoHeart"], 50),
      mindDemon: numberFrom(resources["meter.mindDemon"], 10),
      karma: numberFrom(resources["meter.karma"], 0),
      merit: numberFrom(resources["meter.merit"], 0),
      fate: numberFrom(resources["meter.fate"], resources["game.fatePoints"] ?? 50),
      pursuit: numberFrom(resources["meter.pursuit"], 0),
      injury: numberFrom(resources["meter.injury"], Math.max(0, 100 - numberFrom(resources["status.health"], 100))),
      sectReputation: numberFrom(resources["meter.sectReputation"], 0),
      worldAttention: numberFrom(resources["meter.worldAttention"], 0),
    }),
    strategicAssets: [],
    pendingConsequences: [],
    lastTurnReceiptId: null,
    customActionEnabled: presetId !== MINGTAN_PRESET_ID,
    presetInitialization: presetId && initializationId ? {
      presetId,
      initializationId,
      initializedAt: typeof worldFlags["rpg.presetInitializedAt"] === "string"
        ? String(worldFlags["rpg.presetInitializedAt"])
        : "1970-01-01T00:00:00.000Z",
      storyStateRevisionBefore: Math.max(0, Math.round(numberFrom(worldFlags["rpg.presetSourceRevision"], 0))),
    } : null,
  };
}

export function readRpgStateV3(
  storyState: Pick<StoryState, "rpgState" | "resources" | "worldFlags" | "protagonistStats">,
): RpgStateV3 {
  const candidate = storyState.rpgState;
  if (!candidate || candidate.schemaVersion !== RPG_STATE_V3_SCHEMA_VERSION) {
    return migrateLegacyRpgStateToV3(storyState);
  }
  return {
    ...candidate,
    schemaVersion: RPG_STATE_V3_SCHEMA_VERSION,
    formulaVersion: RPG_FORMULA_V3,
    difficulty: ["story", "standard", "hard", "extreme"].includes(candidate.difficulty)
      ? candidate.difficulty
      : "standard",
    realm: normalizeRealmState(candidate.realm),
    meters: clampNarrativeMeters(candidate.meters),
    strategicAssets: (candidate.strategicAssets ?? []).map((asset) => ({
      ...asset,
      tier: Math.max(1, Math.round(numberFrom(asset.tier, 1))),
      condition: Math.round(clamp(asset.condition, 0, 100)),
      capacity: Math.max(0, Math.round(numberFrom(asset.capacity, 0))),
      risk: Math.round(clamp(asset.risk, 0, 100)),
      contestedByFactionIds: [...new Set(asset.contestedByFactionIds ?? [])],
    })),
    pendingConsequences: (candidate.pendingConsequences ?? []).filter((item) =>
      item && typeof item.consequenceId === "string"),
    lastTurnReceiptId: candidate.lastTurnReceiptId ?? null,
    customActionEnabled: candidate.customActionEnabled ?? candidate.presetId !== MINGTAN_PRESET_ID,
    presetInitialization: candidate.presetInitialization ?? null,
  };
}

export function projectRpgStateV3ToLegacyMaps(
  rpgState: RpgStateV3,
  legacy: Pick<StoryState, "resources" | "worldFlags">,
) {
  const resources: Record<string, number> = { ...legacy.resources };
  for (const [key, value] of Object.entries(rpgState.meters)) {
    resources[`meter.${key}`] = value;
  }
  if (rpgState.realm) {
    resources["cultivation.realmLevel"] = rpgState.realm.level;
    resources["cultivation.realmProgress"] = rpgState.realm.progress;
    resources["cultivation.foundationIntegrity"] = rpgState.realm.foundationIntegrity;
  }
  return {
    resources,
    worldFlags: {
      ...legacy.worldFlags,
      "rpg.formulaVersion": RPG_FORMULA_V3,
      "rpg.rulesetId": rpgState.rulesetId,
      "rpg.presetId": rpgState.presetId ?? "",
      "rpg.difficulty": rpgState.difficulty,
      "rpg.customActionEnabled": rpgState.customActionEnabled,
      ...(rpgState.realm ? { "rpg.realmId": rpgState.realm.definitionId } : {}),
      ...(rpgState.presetInitialization ? {
        "rpg.presetInitializationId": rpgState.presetInitialization.initializationId,
        "rpg.presetInitializedAt": rpgState.presetInitialization.initializedAt,
        "rpg.presetSourceRevision": rpgState.presetInitialization.storyStateRevisionBefore,
      } : {}),
    },
  };
}

export function buildRpgTurnSnapshot(storyState: StoryState): RpgTurnSnapshot {
  const rpgState = readRpgStateV3(storyState);
  return {
    schemaVersion: "rpg-turn-snapshot-v1",
    storyStateRevision: storyState.revision,
    turnNumber: Math.max(0, Math.round(numberFrom(storyState.resources["game.turn"], 0))),
    realm: rpgState.realm ? structuredClone(rpgState.realm) : null,
    meters: structuredClone(rpgState.meters),
    stats: structuredClone(storyState.protagonistStats),
    resources: structuredClone(storyState.resources),
    relationships: structuredClone(storyState.relationships),
    strategicAssets: structuredClone(rpgState.strategicAssets),
    pendingConsequences: structuredClone(rpgState.pendingConsequences),
  };
}

function compareRequirement(actual: unknown, requirement: ChoiceRequirement) {
  if (requirement.operator === "eq") return actual === requirement.value;
  const actualNumber = numberFrom(actual, Number.NaN);
  const expected = numberFrom(requirement.value, Number.NaN);
  if (!Number.isFinite(actualNumber) || !Number.isFinite(expected)) return false;
  return requirement.operator === "gte" ? actualNumber >= expected : actualNumber <= expected;
}

export function unmetChoiceRequirements(
  requirements: readonly ChoiceRequirement[],
  storyState: Pick<StoryState, "resources" | "money" | "protagonistStats" | "worldFlags" | "rpgState">,
) {
  const rpgState = readRpgStateV3(storyState);
  return requirements.filter((requirement) => {
    const actual = requirement.kind === "resource"
      ? storyState.resources[requirement.key] ?? 0
      : requirement.kind === "money"
        ? storyState.money ?? 0
        : requirement.kind === "stat"
          ? storyState.protagonistStats[requirement.key] ?? 0
          : requirement.kind === "meter"
            ? rpgState.meters[requirement.key as keyof NarrativeMeterState]
            : requirement.kind === "realm"
              ? rpgState.realm?.level ?? 0
              : storyState.worldFlags[requirement.key];
    return !compareRequirement(actual, requirement);
  });
}

function hashText(value: string) {
  let hash = 2166136261;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function evaluateDelayedConsequences(input: {
  storyState: StoryState;
  nextTurn: number;
  seed: string;
}) {
  const rpgState = readRpgStateV3(input.storyState);
  return rpgState.pendingConsequences.filter((consequence) => {
    if (consequence.status !== "pending") return false;
    const condition = consequence.triggerCondition;
    switch (consequence.triggerType) {
      case "exact_turn":
        return typeof consequence.triggerTurn === "number" && input.nextTurn >= consequence.triggerTurn;
      case "turn_range": {
        const range = Array.isArray(consequence.triggerTurn) ? consequence.triggerTurn : null;
        return Boolean(range && input.nextTurn >= range[0] && input.nextTurn <= range[1]);
      }
      case "resource_threshold":
        return numberFrom(input.storyState.resources[String(condition.resourceId)], 0)
          >= numberFrom(condition.minimum, Number.POSITIVE_INFINITY);
      case "meter_threshold": {
        const meter = String(condition.meter) as keyof NarrativeMeterState;
        const value = rpgState.meters[meter];
        return Number.isFinite(value)
          && value >= numberFrom(condition.minimum, Number.POSITIVE_INFINITY)
          && value <= numberFrom(condition.maximum, Number.POSITIVE_INFINITY);
      }
      case "location_entered":
        return input.storyState.locationState === condition.locationId;
      case "faction_encountered":
        return input.storyState.worldFlags[`faction.encountered.${String(condition.factionId)}`] === true;
      case "realm_breakthrough":
        return (rpgState.realm?.lastBreakthroughTurn ?? -1) === input.nextTurn - 1;
      case "quest_state":
        return input.storyState.questStates[String(condition.questId)] === String(condition.state);
      case "random_with_seed": {
        const chance = clamp(numberFrom(condition.chance, 0.35), 0, 1);
        return (hashText(`${input.seed}|${consequence.consequenceId}|${input.nextTurn}`) % 10_000) / 10_000 < chance;
      }
      default:
        return false;
    }
  });
}

export function mergeStoryEffects(
  effects: readonly StoryChoiceEffect[],
): StoryChoiceEffect {
  const sumMaps = (select: (effect: StoryChoiceEffect) => Record<string, number>) => {
    const result: Record<string, number> = {};
    for (const effect of effects) {
      for (const [key, value] of Object.entries(select(effect))) result[key] = (result[key] ?? 0) + value;
    }
    return result;
  };
  return {
    statChanges: sumMaps((effect) => effect.statChanges),
    relationshipChanges: sumMaps((effect) => effect.relationshipChanges),
    resourceChanges: sumMaps((effect) => effect.resourceChanges),
    moneyChange: effects.reduce((sum, effect) => sum + effect.moneyChange, 0),
    worldFlags: Object.assign({}, ...effects.map((effect) => effect.worldFlags)),
    questProgress: sumMaps((effect) => effect.questProgress),
    achievementProgress: sumMaps((effect) => effect.achievementProgress),
    timelineEvents: effects.flatMap((effect) => effect.timelineEvents),
  };
}

export function applyRpgSettlementToStoryState(
  storyStateAfterEffect: StoryState,
  settlement: RpgTurnSettlement,
  receiptId: string,
  now: string,
): StoryState {
  const current = readRpgStateV3(storyStateAfterEffect);
  const meters = clampNarrativeMeters(Object.fromEntries(
    Object.entries(current.meters).map(([key, value]) => [
      key,
      value + (settlement.meterChanges[key as keyof NarrativeMeterState] ?? 0),
    ]),
  ) as Partial<NarrativeMeterState>);
  const triggeredIds = new Set(settlement.triggeredConsequences.map((item) => item.consequenceId));
  const pending = current.pendingConsequences
    .map((item) => triggeredIds.has(item.consequenceId)
      ? { ...item, status: "resolved" as const, resolvedAt: now }
      : item)
    .filter((item) => item.status === "pending");
  const scheduled = settlement.scheduledConsequences.map((item) => ({
    ...item,
    sourceTurnReceiptId: receiptId,
    createdAt: now,
  }));
  const nextRpgState: RpgStateV3 = {
    ...current,
    realm: settlement.realmChange?.to ?? current.realm,
    meters,
    pendingConsequences: [...pending, ...scheduled],
    lastTurnReceiptId: receiptId,
  };
  const legacy = projectRpgStateV3ToLegacyMaps(nextRpgState, storyStateAfterEffect);
  return {
    ...storyStateAfterEffect,
    rpgState: nextRpgState,
    resources: legacy.resources,
    worldFlags: legacy.worldFlags,
  };
}

export function computeCultivationDerivedStats(input: {
  stats: Record<string, number>;
  realm: CultivationRealmState | null;
  meters: NarrativeMeterState;
  injury?: number;
}): RpgDerivedCultivationStats {
  const level = input.realm?.level ?? 0;
  const foundation = input.realm?.foundationIntegrity ?? 70;
  const injury = clamp(input.injury ?? input.meters.injury, 0, 100);
  const value = (key: string) => clamp(numberFrom(input.stats[key], 50), 0, 130);
  return {
    spiritualPower: Math.round(value("rpg.creativity") * 0.55 + value("rpg.will") * 0.2 + level * 1.7 - injury * 0.18),
    divineSense: Math.round(value("rpg.intellect") * 0.58 + value("rpg.creativity") * 0.24 + level * 1.4),
    breakthroughStability: Math.round(clamp(value("rpg.will") * 0.35 + foundation * 0.35 + input.meters.daoHeart * 0.3 - input.meters.mindDemon * 0.3, 0, 140)),
    tribulationResistance: Math.round(clamp(value("rpg.physique") * 0.32 + value("rpg.will") * 0.28 + foundation * 0.25 + level - injury * 0.35, 0, 160)),
    craftingControl: Math.round(value("rpg.technique") * 0.34 + value("rpg.intellect") * 0.34 + value("rpg.creativity") * 0.32 + level * 0.6),
    sectLeadership: Math.round(value("rpg.charisma") * 0.42 + value("rpg.will") * 0.3 + value("rpg.intellect") * 0.28 + input.meters.sectReputation * 0.18),
  };
}

export const TRIBULATION_FORMULA_VERSION = "xianxia-tribulation-v1" as const;

export function computeTribulationPower(input: {
  baseRealmTribulation: number;
  mindDemon: number;
  karma: number;
  intervention: number;
  worldAura: number;
  difficulty: RpgDifficulty;
}) {
  const mindDemonCoefficient = clamp(0.8 + clamp(input.mindDemon, 0, 100) / 125, 0.8, 1.6);
  const karmaCoefficient = clamp(1 + Math.max(0, input.karma) / 180 - Math.max(0, -input.karma) / 500, 0.8, 1.6);
  const interventionCoefficient = clamp(1 + Math.max(0, input.intervention) / 100, 1, 1.8);
  const worldAuraCoefficient = clamp(numberFrom(input.worldAura, 1), 0.75, 1.5);
  const difficultyCoefficient = ({ story: 0.82, standard: 1, hard: 1.18, extreme: 1.38 } as const)[input.difficulty];
  return {
    formulaVersion: TRIBULATION_FORMULA_VERSION,
    power: Math.round(input.baseRealmTribulation
      * mindDemonCoefficient
      * karmaCoefficient
      * interventionCoefficient
      * worldAuraCoefficient
      * difficultyCoefficient * 100) / 100,
    coefficients: {
      mindDemonCoefficient,
      karmaCoefficient,
      interventionCoefficient,
      worldAuraCoefficient,
      difficultyCoefficient,
    },
  };
}

export function buildMingtanPresetState(
  storyState: StoryState,
  options: {
    now?: string;
    initialRealmLevel?: number;
    initialStats?: Record<string, number>;
  } = {},
) {
  const canonicalStatKeys = [
    "rpg.physique",
    "rpg.technique",
    "rpg.intellect",
    "rpg.charisma",
    "rpg.will",
    "rpg.creativity",
  ] as const;
  const existing = readRpgStateV3(storyState);
  const alreadyApplied = (
    existing.presetId === MINGTAN_PRESET_ID
    && existing.presetInitialization?.presetId === MINGTAN_PRESET_ID
  );
  const hasCanonicalStats = canonicalStatKeys.every((key) =>
    Number.isFinite(storyState.protagonistStats[key]));
  if (alreadyApplied && hasCanonicalStats) {
    return { storyState, rpgState: existing, replayed: true };
  }
  const now = options.now ?? new Date().toISOString();
  const realmLevel = Math.max(0, Math.round(numberFrom(
    options.initialRealmLevel
      ?? storyState.resources["cultivation.realmLevel"]
      ?? storyState.resources["growth.realm"]
      ?? storyState.worldFlags["xianxia.realmLevel"],
    0,
  )));
  const definition = cultivationRealmForLevel(realmLevel);
  const rpgState: RpgStateV3 = {
    ...existing,
    schemaVersion: RPG_STATE_V3_SCHEMA_VERSION,
    formulaVersion: RPG_FORMULA_V3,
    rulesetId: XIANXIA_RULESET_ID,
    presetId: MINGTAN_PRESET_ID,
    difficulty: "extreme",
    realm: {
      definitionId: definition.id,
      level: realmLevel,
      stage: "early",
      progress: Math.round(clamp(numberFrom(storyState.resources["cultivation.realmProgress"], 0), 0, 100)),
      foundationIntegrity: Math.round(clamp(numberFrom(storyState.resources["cultivation.foundationIntegrity"], 75), 0, 100)),
      lastBreakthroughTurn: null,
    },
    customActionEnabled: false,
    presetInitialization: alreadyApplied && existing.presetInitialization
      ? existing.presetInitialization
      : {
          presetId: MINGTAN_PRESET_ID,
          initializationId: `preset:${MINGTAN_PRESET_ID}:${storyState.projectId}`,
          initializedAt: now,
          storyStateRevisionBefore: storyState.revision,
        },
  };
  const canonicalStats = Object.fromEntries(canonicalStatKeys.flatMap((key) => {
    const value = options.initialStats?.[key] ?? storyState.protagonistStats[key];
    return Number.isFinite(value) ? [[key, Math.round(clamp(Number(value), 0, 100))]] : [];
  }));
  const legacy = projectRpgStateV3ToLegacyMaps(rpgState, storyState);
  return {
    replayed: false,
    rpgState,
    storyState: {
      ...storyState,
      rpgState,
      // Materialize the legacy RPG wallet instead of letting the read model
      // expose a spendable 1,200-gold default that the canonical state does
      // not actually own. Formal requirement checks and settlement now read
      // the same source of truth.
      money: storyState.money ?? 1_200,
      protagonistStats: {
        ...storyState.protagonistStats,
        ...canonicalStats,
        "rpg.xp": storyState.protagonistStats["rpg.xp"] ?? 0,
      },
      resources: {
        "game.day": storyState.resources["game.day"] ?? 1,
        "game.turn": storyState.resources["game.turn"] ?? 0,
        "game.actionPoints": storyState.resources["game.actionPoints"] ?? 3,
        "game.choiceVariant": storyState.resources["game.choiceVariant"] ?? 0,
        "game.fatePoints": storyState.resources["game.fatePoints"] ?? 50,
        "status.hp": storyState.resources["status.hp"] ?? 100,
        "status.stamina": storyState.resources["status.stamina"] ?? 100,
        "status.spirit": storyState.resources["status.spirit"] ?? 100,
        "status.fatigue": storyState.resources["status.fatigue"] ?? 0,
        "status.stress": storyState.resources["status.stress"] ?? 0,
        "status.health": storyState.resources["status.health"] ?? 100,
        "status.focus": storyState.resources["status.focus"] ?? 80,
        ...legacy.resources,
        "currency.spiritStone": Math.max(10_000, Math.round(numberFrom(storyState.resources["currency.spiritStone"], 0))),
        "item.feminization-charm-pill": Math.max(10, Math.round(numberFrom(storyState.resources["item.feminization-charm-pill"], 0))),
        "knowledge.pastLifeArchive": Math.max(1, Math.round(numberFrom(storyState.resources["knowledge.pastLifeArchive"], 0))),
        "knowledge.pastLifeReliability": Math.max(0, Math.min(100, Math.round(numberFrom(storyState.resources["knowledge.pastLifeReliability"], 94)))),
        "knowledge.timelineDeviation": Math.max(0, Math.min(100, Math.round(numberFrom(storyState.resources["knowledge.timelineDeviation"], 1)))),
        "risk.heavenlyExposure": Math.max(0, Math.min(100, Math.round(numberFrom(storyState.resources["risk.heavenlyExposure"], 2)))),
        "social.systemDependency": Math.max(0, Math.min(100, Math.round(numberFrom(storyState.resources["social.systemDependency"], 0)))),
      },
      questStates: {
        ...storyState.questStates,
        "xianxia.mingtan.rebuildSect": storyState.questStates["xianxia.mingtan.rebuildSect"] ?? "0",
        "xianxia.mingtan.findWives": storyState.questStates["xianxia.mingtan.findWives"] ?? "0",
        "xianxia.mingtan.ascendWorlds": storyState.questStates["xianxia.mingtan.ascendWorlds"] ?? "0",
        "xianxia.mingtan.anchor.zining": storyState.questStates["xianxia.mingtan.anchor.zining"] ?? "0",
        "xianxia.mingtan.anchor.luoqingyao": storyState.questStates["xianxia.mingtan.anchor.luoqingyao"] ?? "0",
        "xianxia.mingtan.anchor.xueqi": storyState.questStates["xianxia.mingtan.anchor.xueqi"] ?? "0",
        "xianxia.mingtan.anchor.wanxin": storyState.questStates["xianxia.mingtan.anchor.wanxin"] ?? "0",
      },
      worldFlags: {
        ...legacy.worldFlags,
        "rpg.runSeed": storyState.worldFlags["rpg.runSeed"] || `mingtan:${storyState.projectId}`,
        "story.playMode": "rpg",
        "story.playModeLocked": true,
        "content.consentRequired": true,
        "content.ageSafeguardsPreserved": true,
        "xianxia.mingtan.goal.rebuildSect": "重建合歡宗",
        "xianxia.mingtan.goal.findWives": "尋找四位失散妻子",
        "xianxia.mingtan.goal.ascendWorlds": "突破凡界、靈界、仙界與神界限制",
        "xianxia.mingtan.factions.righteous": 6,
        "xianxia.mingtan.factions.demonic": 7,
        "xianxia.mingtan.factions.demonRaceEnabled": true,
        "xianxia.mingtan.oneMajorActionPerTurn": true,
        "xianxia.mingtan.genre.possession": true,
        "xianxia.mingtan.genre.rebirth": true,
        "xianxia.mingtan.genre.system": true,
        "xianxia.mingtan.system.name": "逆命殘卷系統",
        "xianxia.mingtan.system.origin": "失敗時間線的因果、殘缺記憶與瑤光月魄形成的有限備份",
        "xianxia.mingtan.system.capability": "評估、修正、製作推演與有限任務；不可全知或無中生有",
        "xianxia.mingtan.system.futureIsFallible": true,
        "xianxia.mingtan.identity.host": "Brendon",
        "xianxia.mingtan.identity.body": "明檀",
        "xianxia.mingtan.identity.originalSoul": "原主已死亡；只保留肉身記憶、情緒殘響與不完整影像",
        "xianxia.mingtan.timeline.previous": "合歡宗毀滅、瑤光被捕、四位命運錨點各自走向悲劇的失敗時間線",
        "xianxia.mingtan.relationships.autonomous": true,
        "xianxia.mingtan.relationships.noAutomaticLove": true,
        "xianxia.mingtan.coreCheatLimitPerMajorEvent": 2,
        "xianxia.mingtan.destinyAnchors": "紫凝、洛青瑤、雪琪、婉心",
      },
    } satisfies StoryState,
  };
}

export function emptyRpgEffect(): StoryChoiceEffect {
  return {
    statChanges: {},
    relationshipChanges: {},
    resourceChanges: {},
    moneyChange: 0,
    worldFlags: {},
    questProgress: {},
    achievementProgress: {},
    timelineEvents: [],
  };
}
