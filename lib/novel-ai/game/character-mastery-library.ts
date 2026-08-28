import type { ProceduralStoryContext } from "./procedural-story-library";
import {
  proceduralTreasureRecordAt,
  type ProceduralTreasureRecord,
} from "./procedural-treasure-library";
import {
  resolveProceduralTreasureStoryEra,
  type ProceduralTreasureEra,
} from "./procedural-treasure-era";
import {
  DeterministicSocialMatrix,
  type SocialMatrixCharacter,
} from "../social-matrix";

export const CHARACTER_MASTERY_LIBRARY_VERSION =
  "character-mastery-library-v1" as const;
export const CHARACTER_MASTERY_MATERIALIZATION_POLICY =
  "indexed-on-demand-no-bulk-materialization" as const;
export const MASTERY_CATALOG_CAPACITY = 1_000;
export const CULTIVATION_TECHNIQUE_CAPACITY_PER_ELEMENT = 1_000;
export const CULTIVATION_TECHNIQUE_TOTAL_CAPACITY = 5_000;
export const CHARACTER_MASTERY_PAGE_MAX = 100;

export const FIVE_PHASE_ELEMENTS = [
  { id: "metal", label: "金", generates: "water", controls: "wood" },
  { id: "wood", label: "木", generates: "fire", controls: "earth" },
  { id: "water", label: "水", generates: "wood", controls: "fire" },
  { id: "fire", label: "火", generates: "earth", controls: "metal" },
  { id: "earth", label: "土", generates: "metal", controls: "water" },
] as const;

export type FivePhaseElement = (typeof FIVE_PHASE_ELEMENTS)[number]["id"];
export type MasteryCatalogKind =
  | "combat"
  | "profession"
  | "talisman"
  | "formation"
  | "weapon"
  | "pill"
  | "herb";
export type CharacterMasteryRelation = "uses" | "makes" | "holds" | "cultivates";

export type ElementalInteraction = {
  source: FivePhaseElement;
  target: FivePhaseElement;
  relation: "同屬" | "相生" | "受生" | "相剋" | "受剋";
  multiplier: number;
  explanation: string;
};

export type CultivationTechniqueRecord = {
  schemaVersion: typeof CHARACTER_MASTERY_LIBRARY_VERSION;
  materializationPolicy: typeof CHARACTER_MASTERY_MATERIALIZATION_POLICY;
  id: string;
  ordinal: number;
  capacityForElement: typeof CULTIVATION_TECHNIQUE_CAPACITY_PER_ELEMENT;
  fictional: true;
  era: "ancient";
  storyEra: ProceduralTreasureEra;
  isCrossEra: boolean;
  compatibilityGate: "story-era-compatible" | "explicit-cross-era";
  element: FivePhaseElement;
  elementLabel: string;
  name: string;
  discipline: string;
  primaryBonus: string;
  baseMultiplier: number;
  elementalMultipliers: {
    sameElement: 1.08;
    generates: 1.18;
    generatedBy: 0.94;
    controls: 1.28;
    controlledBy: 0.72;
  };
  requirement: string;
  limitation: string;
  cost: string;
};

export type MasteryCatalogRecord = {
  schemaVersion: typeof CHARACTER_MASTERY_LIBRARY_VERSION;
  materializationPolicy: typeof CHARACTER_MASTERY_MATERIALIZATION_POLICY;
  id: string;
  ordinal: number;
  capacity: typeof MASTERY_CATALOG_CAPACITY;
  fictional: true;
  catalog: MasteryCatalogKind;
  catalogLabel: string;
  era: ProceduralTreasureEra;
  storyEra: ProceduralTreasureEra;
  isCrossEra: boolean;
  compatibilityGate: "story-era-compatible" | "explicit-cross-era";
  element: FivePhaseElement | null;
  name: string;
  focus: string;
  successMultiplier: number;
  qualityMultiplier: number;
  riskMultiplier: number;
  requirement: string;
  limitation: string;
  cost: string;
};

export type CharacterMasteryAssignment = {
  relation: CharacterMasteryRelation;
  relationLabel: "會使用" | "會製作" | "持有" | "栽培";
  referenceType: "cultivation-technique" | "mastery-catalog" | "procedural-treasure";
  referenceId: string;
  sourceOrdinal: number;
  name: string;
  catalogLabel: string;
  era: ProceduralTreasureEra;
  element: FivePhaseElement | null;
  proficiency: number;
  effectiveMultiplier: number;
  limitation: string;
  cost: string;
};

export type CharacterMasteryProfile = {
  schemaVersion: typeof CHARACTER_MASTERY_LIBRARY_VERSION;
  materializationPolicy: typeof CHARACTER_MASTERY_MATERIALIZATION_POLICY;
  storySeedTag: string;
  characterId: string;
  populationIndex: number;
  characterName: string;
  storyEra: ProceduralTreasureEra;
  storyEraLabel: string;
  primaryElement: FivePhaseElement | null;
  elementalSummary: {
    generates: FivePhaseElement;
    controls: FivePhaseElement;
    generatedBy: FivePhaseElement;
    controlledBy: FivePhaseElement;
  } | null;
  assignments: CharacterMasteryAssignment[];
  heldTreasure: ProceduralTreasureRecord;
};

export type CharacterMasteryDecisionFact = {
  factId: string;
  kind: "capability" | "cost" | "elemental" | "ownership";
  sourceReferenceId: string;
  statement: string;
  consequence: string;
};

type EraCatalogTerms = {
  label: string;
  nouns: readonly string[];
};

const ELEMENT_LABELS: Record<FivePhaseElement, string> = Object.fromEntries(
  FIVE_PHASE_ELEMENTS.map((element) => [element.id, element.label]),
) as Record<FivePhaseElement, string>;

const ELEMENT_PREFIXES: Record<FivePhaseElement, readonly string[]> = {
  metal: ["庚金", "辛金", "白帝", "太白", "玄鐵", "斷岳", "藏鋒", "鳴劍", "流銀", "天罡"],
  wood: ["甲木", "乙木", "青帝", "長生", "萬藤", "靈森", "回春", "扶桑", "翠微", "生息"],
  water: ["壬水", "癸水", "玄冥", "滄海", "流川", "寒泉", "聽雨", "潮生", "弱水", "歸淵"],
  fire: ["丙火", "丁火", "赤帝", "離明", "焚天", "丹霞", "燎原", "地炎", "陽燼", "朱雀"],
  earth: ["戊土", "己土", "黃帝", "厚德", "鎮岳", "崑崙", "息壤", "磐石", "地脈", "玄黃"],
};

const TECHNIQUE_FORMS = [
  "劍典", "心經", "身法", "鍛體訣", "掌法", "刀章", "槍譜", "神識篇", "護脈功", "御器錄",
] as const;
const TECHNIQUE_STAGES = [
  "初引", "循脈", "凝息", "化形", "守一", "通幽", "破障", "合真", "返虛", "圓融",
] as const;
const TECHNIQUE_BONUSES: Record<FivePhaseElement, readonly string[]> = {
  metal: ["穿透", "破甲", "兵器操控", "鍛造品質", "決斷速度"],
  wood: ["恢復", "持續成長", "靈植培育", "療癒", "韌性"],
  water: ["卸力", "持久運轉", "感知", "變化", "冷靜"],
  fire: ["爆發", "煉丹火候", "驅邪", "士氣", "行動速度"],
  earth: ["防禦", "陣法穩定", "負重", "地形掌控", "承傷"],
};

const CATALOG_MODIFIERS: Record<MasteryCatalogKind, readonly string[]> = {
  combat: ["迅捷", "穩守", "破勢", "連環", "迴身", "截擊", "護衛", "應變", "合擊", "精準"],
  profession: ["基礎", "精密", "現場", "協同", "系統", "進階", "複核", "應變", "統籌", "專家"],
  talisman: ["護持", "傳訊", "封存", "鑑別", "示警", "追蹤", "授權", "隔離", "應變", "聯結"],
  formation: ["守護", "調度", "分區", "聯結", "備援", "追蹤", "隔離", "協同", "穩定", "應變"],
  weapon: ["輕型", "重型", "精準", "機動", "防護", "破障", "制止", "遠距", "近身", "備援"],
  pill: ["急救", "穩定", "長效", "速效", "精準", "低敏", "複方", "緩釋", "強化", "恢復"],
  herb: ["耐旱", "耐寒", "高純", "速生", "穩產", "抗病", "低光", "無菌", "再生", "適應"],
};

const ERA_STAGES: Record<ProceduralTreasureEra, readonly string[]> = {
  ancient: ["入門式", "行氣篇", "精修卷", "合擊式", "護脈篇", "破障式", "守成卷", "應變式", "宗師篇", "傳承卷"],
  "early-modern": ["基礎規程", "現場規程", "工長手冊", "調度章程", "安全細則", "精密作業", "聯合作業", "故障應變", "教官課程", "總成規範"],
  modern: ["基礎模組", "現場流程", "進階模組", "聯合演練", "安全規範", "精密操作", "壓力應變", "稽核流程", "教官級", "專家級"],
  future: ["基礎協定", "艦載模組", "進階協定", "群體同步", "安全沙盒", "精密演算", "失效接管", "稽核鏈", "導師級", "旗艦級"],
};

const CATALOG_TERMS: Record<ProceduralTreasureEra, Record<MasteryCatalogKind, EraCatalogTerms>> = {
  ancient: {
    combat: { label: "武技／功夫", nouns: ["伏虎拳", "游龍掌", "聽風劍", "撼山刀", "流雲步", "鎖脈指", "回身槍", "鐵衣功", "卸力手", "追星箭"] },
    profession: { label: "修行百藝", nouns: ["煉器術", "醫修術", "御獸術", "尋脈術", "鑑寶術", "機關術", "釀靈術", "採礦術", "占星術", "靈廚術"] },
    talisman: { label: "符籙製作", nouns: ["護身符", "傳訊符", "鎮魂符", "遁行符", "鑑真符", "封息符", "引雷符", "聚火符", "清心符", "破禁符"] },
    formation: { label: "陣法製作", nouns: ["護山陣", "聚靈陣", "迷蹤陣", "傳送陣", "鑑心陣", "封界陣", "五行陣", "劍域陣", "地脈陣", "星斗陣"] },
    weapon: { label: "武器鍛造", nouns: ["長劍", "靈弓", "護刃", "戰槍", "機巧索", "鎮岳錘", "飛刀", "雙環", "長戟", "鏈刃"] },
    pill: { label: "丹藥煉製", nouns: ["療傷丹", "破境丸", "解毒散", "養魂露", "洗髓膏", "續脈丹", "凝神丹", "避瘴丸", "固元散", "回氣露"] },
    herb: { label: "藥草栽培", nouns: ["續命靈芝", "凝露草", "洗髓藤", "養魂花", "避毒苔", "地脈參", "赤陽果", "玄陰葉", "定神蘭", "回春木"] },
  },
  "early-modern": {
    combat: { label: "近代戰技／功夫", nouns: ["拳擊", "摔角", "刺刀術", "軍刀術", "警棍術", "擒拿", "短槍射擊", "步槍射擊", "巷戰移動", "護衛術"] },
    profession: { label: "近代專業", nouns: ["機械工程", "外科救護", "電報通信", "鐵路調度", "航海測繪", "刑事調查", "消防救援", "工廠管理", "新聞採訪", "會計稽核"] },
    talisman: { label: "通訊／證件製作", nouns: ["電報密碼本", "通行證", "身分證明", "火漆公文", "無線電碼", "信號旗", "保密封套", "調度票證", "航運提單", "查驗印記"] },
    formation: { label: "工事／基礎設施設計", nouns: ["鐵路調度網", "城市電網", "防禦工事", "電話交換網", "供水系統", "工廠產線", "港口燈號網", "消防分區", "醫院動線", "倉儲網"] },
    weapon: { label: "近代防衛裝備製作", nouns: ["轉輪手槍", "栓動步槍", "軍刀", "信號槍", "警棍", "獵槍", "防暴盾", "瞄準鏡", "彈藥盒", "野戰工兵鏟"] },
    pill: { label: "近代醫藥製備", nouns: ["止痛藥", "抗菌藥", "疫苗", "外科麻醉劑", "退燒藥", "急救藥劑", "止血劑", "消毒劑", "營養補給", "解毒劑"] },
    herb: { label: "藥材／作物栽培", nouns: ["金雞納", "藥用薄荷", "顛茄", "毛地黃", "止血棉", "藥用罌粟", "金盞花", "紫錐花", "薰衣草", "白柳"] },
  },
  modern: {
    combat: { label: "現代戰技／功夫", nouns: ["拳擊", "散打", "柔道", "巴西柔術", "跆拳道", "空手道", "擒拿控制", "戰術移動", "近身防護", "危機脫離"] },
    profession: { label: "現代專業", nouns: ["軟體工程", "臨床醫療", "資料分析", "機械工程", "法律調查", "影像製作", "企業管理", "新聞查證", "網路防禦", "災難救援"] },
    talisman: { label: "通訊／識別安全設計", nouns: ["加密手機", "無線電台", "門禁卡", "電子憑證", "緊急信標", "衛星電話", "多因素金鑰", "防偽標籤", "身分權杖", "離線驗證器"] },
    formation: { label: "系統／網路架構", nouns: ["城市監控網", "資料中心", "電力調度系統", "醫院資訊網", "交通控制網", "實驗室安全系統", "災防通報網", "金融清算網", "物流追蹤網", "通訊備援網"] },
    weapon: { label: "現代防衛裝備工程", nouns: ["防暴盾", "非致命電擊器", "精準步槍", "戰術照明器", "防護頭盔", "信號槍", "遙控排爆器", "防彈插板", "救援破門器", "訓練模擬器"] },
    pill: { label: "現代醫藥製備", nouns: ["處方藥", "疫苗", "急救針劑", "抗生素", "止痛藥", "解毒劑", "抗過敏藥", "輸液配方", "鎮靜藥", "生物製劑"] },
    herb: { label: "現代藥用／生醫培育", nouns: ["藥用植萃", "細胞培養基", "血清原料", "蛋白試劑", "組織樣本", "醫用真菌", "藥用藻類", "無菌苗株", "基因種源", "益生菌株"] },
  },
  future: {
    combat: { label: "未來戰技／身體控制", nouns: ["外骨骼格鬥", "低重力擒拿", "神經反應術", "無人僚機協戰", "艙內近戰", "動力甲機動", "零重力射擊", "感測盲區移動", "群體戰術同步", "非致命制止"] },
    profession: { label: "未來專業", nouns: ["量子工程", "奈米醫療", "星艦維修", "殖民治理", "外星語訊分析", "AI 安全", "軌道建築", "基因倫理", "行星氣候工程", "深空導航"] },
    talisman: { label: "星際通訊／身分金鑰設計", nouns: ["量子通訊鑰", "生物身分環", "殖民通行憑證", "深空信標", "神經介面令牌", "艦隊授權碼", "量子簽章器", "休眠艙金鑰", "機器人權限核", "躍遷航權證"] },
    formation: { label: "星艦／殖民系統架構", nouns: ["艦隊戰術網", "殖民維生網", "行星氣候控制", "躍遷航路系統", "量子資料網", "軌道防衛網", "人工重力網", "休眠監護網", "星港調度網", "能源回收網"] },
    weapon: { label: "未來防衛系統工程", nouns: ["脈衝步槍", "電磁投射器", "神經制止器", "無人防衛平台", "軌道信標", "反制盾", "定向能攔截器", "奈米束縛器", "重力錨", "艦載防衛核"] },
    pill: { label: "未來生醫製備", nouns: ["奈米修復劑", "基因穩定劑", "輻射解毒劑", "冬眠甦醒劑", "免疫重編劑", "神經保護劑", "低重力骨修劑", "器官再生劑", "代謝調節劑", "異星病原抗體"] },
    herb: { label: "未來異星／生醫培育", nouns: ["異星菌株", "人工器官基質", "火星藻種", "再生蛋白", "真空孢子", "低重力藥植", "木衛冰藻", "輻射耐受菌", "光合器官苗", "封閉生態種源"] },
  },
};

const CATALOG_FOCUS: Record<MasteryCatalogKind, readonly string[]> = {
  combat: ["命中與節奏", "防守與卸力", "移動與站位", "控制與撤離", "反應與協同"],
  profession: ["分析品質", "作業速度", "查核完整性", "協作效率", "故障應變"],
  talisman: ["啟用可靠度", "驗證強度", "傳遞完整性", "封存時間", "追蹤精度"],
  formation: ["覆蓋範圍", "系統穩定", "節點協同", "故障隔離", "資源調度"],
  weapon: ["操控精度", "結構耐久", "安全冗餘", "能量效率", "維護速度"],
  pill: ["藥效穩定", "配方純度", "劑量精度", "副作用控制", "保存期限"],
  herb: ["成活率", "有效成分", "環境耐受", "生長速度", "批次穩定"],
};

const ERA_REQUIREMENTS: Record<ProceduralTreasureEra, readonly string[]> = {
  ancient: ["完成師承核准並通過前卷", "靈根與材料屬性相容", "在安全場域完成三次驗證", "境界與神識負荷達到門檻"],
  "early-modern": ["由合格教官或工長簽認", "完成器材與環境檢查", "具備對應執照或學徒年資", "留下紙本操作與維護紀錄"],
  modern: ["完成受認可訓練與安全考核", "具備合法授權與合格設備", "依標準流程保留稽核紀錄", "在專業監督範圍內執行"],
  future: ["通過生物金鑰與能力驗證", "完成 AI 安全協定確認", "建立可回溯量子簽章", "取得艦艇或殖民地雙人授權"],
};

const ERA_LIMITATIONS: Record<ProceduralTreasureEra, readonly string[]> = {
  ancient: ["不能跳過前置境界，也不能同時兼修相剋主法", "效果受靈根、地脈與材料品質限制", "失敗會留下可追查的氣息與內傷", "離開適配環境後加乘會明顯下降"],
  "early-modern": ["不能超過器材額定性能或操作員資格", "缺料、停電或通訊中斷時效果下降", "每次使用都會留下紙本或電報紀錄", "故障後必須停機檢修，不能立刻重用"],
  modern: ["不能繞過法律、授權與物理性能邊界", "離線、缺電或設備未校準時加乘失效", "所有關鍵操作都會留下可稽核紀錄", "高壓連續使用會提高錯誤與傷害風險"],
  future: ["不能繞過物理限制、倫理審查與使用者自主權", "運算、能源或維生配額不足時降級", "啟用座標與操作者會寫入稽核鏈", "失效後必須冷卻、維修或重新授權"],
};

const CATALOG_COSTS: Record<MasteryCatalogKind, readonly string[]> = {
  combat: ["體力消耗增加", "連續使用會降低反應", "必須保留安全撤離餘裕"],
  profession: ["耗用時間與專業資源", "必須由第二人複核", "錯誤會觸發返工與責任調查"],
  talisman: ["消耗一次性載體或授權額度", "啟用會留下身分痕跡", "每次重製都需重新驗證"],
  formation: ["持續消耗能源與維護人力", "單一節點失效會降低全域效能", "擴大範圍會增加延遲與風險"],
  weapon: ["耐久或能源會被消耗", "使用後必須檢修校準", "錯誤操控會傷及持有人或同伴"],
  pill: ["消耗配方材料與製備時間", "劑量錯誤會增加副作用", "同類製劑存在冷卻或耐受限制"],
  herb: ["占用土地、培養艙與照護時間", "環境波動會降低有效成分", "採收後必須保留種源才能續栽"],
};

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seedTag(seed: string) {
  return hashText(seed).toString(36).padStart(7, "0");
}

function roundMultiplier(value: number) {
  return Math.round(value * 100) / 100;
}

function requireSeed(seed: string) {
  if (!seed.trim()) throw new Error("CHARACTER_MASTERY_STORY_SEED_REQUIRED");
}

function requireOrdinal(ordinal: number, capacity: number, code: string) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= capacity) {
    throw new RangeError(`${code}_ORDINAL_OUT_OF_RANGE:${ordinal}`);
  }
}

function resolveEra(input: {
  context?: ProceduralStoryContext;
  sourceEra?: ProceduralTreasureEra;
}) {
  const story = resolveProceduralTreasureStoryEra(input.context);
  const sourceEra = input.sourceEra ?? story.era;
  const isCrossEra = sourceEra !== story.era;
  if (isCrossEra && !story.allowsCrossEra) {
    throw new Error("CHARACTER_MASTERY_CROSS_ERA_REQUIRES_EXPLICIT_STORY_SIGNAL");
  }
  return {
    storyEra: story.era,
    storyEraLabel: story.eraLabel,
    sourceEra,
    isCrossEra,
    compatibilityGate: isCrossEra
      ? "explicit-cross-era" as const
      : "story-era-compatible" as const,
  };
}

function inverseElementRelation(element: FivePhaseElement, property: "generates" | "controls") {
  return FIVE_PHASE_ELEMENTS.find((candidate) => candidate[property] === element)!.id;
}

export function elementalInteraction(
  source: FivePhaseElement,
  target: FivePhaseElement,
): ElementalInteraction {
  const sourceDefinition = FIVE_PHASE_ELEMENTS.find((element) => element.id === source)!;
  const targetDefinition = FIVE_PHASE_ELEMENTS.find((element) => element.id === target)!;
  if (source === target) {
    return { source, target, relation: "同屬", multiplier: 1.08, explanation: `${sourceDefinition.label}對${targetDefinition.label}同屬共鳴，穩定加乘但不形成壓制。` };
  }
  if (sourceDefinition.generates === target) {
    return { source, target, relation: "相生", multiplier: 1.18, explanation: `${sourceDefinition.label}生${targetDefinition.label}，後者效果獲得供能加乘。` };
  }
  if (targetDefinition.generates === source) {
    return { source, target, relation: "受生", multiplier: 0.94, explanation: `${targetDefinition.label}生${sourceDefinition.label}，逆向輸出需先回補來源，短時效率降低。` };
  }
  if (sourceDefinition.controls === target) {
    return { source, target, relation: "相剋", multiplier: 1.28, explanation: `${sourceDefinition.label}剋${targetDefinition.label}，在條件成立時取得壓制加乘。` };
  }
  return { source, target, relation: "受剋", multiplier: 0.72, explanation: `${targetDefinition.label}剋${sourceDefinition.label}，未先化解時輸出受到壓制。` };
}

export function cultivationTechniqueAt(input: {
  storySeed: string;
  element: FivePhaseElement;
  ordinal: number;
  context?: ProceduralStoryContext;
}) : CultivationTechniqueRecord {
  requireSeed(input.storySeed);
  requireOrdinal(input.ordinal, CULTIVATION_TECHNIQUE_CAPACITY_PER_ELEMENT, "CULTIVATION_TECHNIQUE");
  const era = resolveEra({ context: input.context, sourceEra: "ancient" });
  const hash = hashText(`${input.storySeed}|technique|${input.element}`);
  const rootIndex = (input.ordinal % 10 + hash % 10) % 10;
  const formIndex = (Math.floor(input.ordinal / 10) % 10 + Math.floor(hash / 10) % 10) % 10;
  const stageIndex = (Math.floor(input.ordinal / 100) + Math.floor(hash / 100) % 10) % 10;
  const bonusIndex = hashText(`${input.storySeed}|technique-bonus|${input.element}|${input.ordinal}`) % TECHNIQUE_BONUSES[input.element].length;
  const baseMultiplier = roundMultiplier(1.05 + (hashText(`${input.storySeed}|technique-power|${input.element}|${input.ordinal}`) % 36) / 100);
  const generates = FIVE_PHASE_ELEMENTS.find((element) => element.id === input.element)!.generates;
  const controls = FIVE_PHASE_ELEMENTS.find((element) => element.id === input.element)!.controls;
  return Object.freeze({
    schemaVersion: CHARACTER_MASTERY_LIBRARY_VERSION,
    materializationPolicy: CHARACTER_MASTERY_MATERIALIZATION_POLICY,
    id: `mastery-technique:${seedTag(input.storySeed)}:${input.element}:${input.ordinal.toString(36).padStart(2, "0")}`,
    ordinal: input.ordinal,
    capacityForElement: CULTIVATION_TECHNIQUE_CAPACITY_PER_ELEMENT,
    fictional: true,
    era: "ancient",
    storyEra: era.storyEra,
    isCrossEra: era.isCrossEra,
    compatibilityGate: era.compatibilityGate,
    element: input.element,
    elementLabel: ELEMENT_LABELS[input.element],
    name: `《${ELEMENT_PREFIXES[input.element][rootIndex]}${TECHNIQUE_FORMS[formIndex]}・${TECHNIQUE_STAGES[stageIndex]}》`,
    discipline: TECHNIQUE_FORMS[formIndex],
    primaryBonus: `${TECHNIQUE_BONUSES[input.element][bonusIndex]}基礎效果 ×${baseMultiplier.toFixed(2)}`,
    baseMultiplier,
    elementalMultipliers: {
      sameElement: 1.08 as const,
      generates: 1.18 as const,
      generatedBy: 0.94 as const,
      controls: 1.28 as const,
      controlledBy: 0.72 as const,
    },
    requirement: `主靈根需與${ELEMENT_LABELS[input.element]}相容，完成前置卷與一次受監督周天；對${ELEMENT_LABELS[generates]}相生、對${ELEMENT_LABELS[controls]}相剋。`,
    limitation: `同時兼修受${ELEMENT_LABELS[inverseElementRelation(input.element, "controls")]}系克制的主功法時，最終倍率另乘 0.72；未完成前置不得跳卷。`,
    cost: `每次強行超額運轉會增加經脈負荷；連續兩次超額後，下一次基礎倍率降至 ${roundMultiplier(baseMultiplier * 0.8).toFixed(2)}。`,
  });
}

export function masteryCatalogRecordAt(input: {
  storySeed: string;
  catalog: MasteryCatalogKind;
  ordinal: number;
  context?: ProceduralStoryContext;
  sourceEra?: ProceduralTreasureEra;
}): MasteryCatalogRecord {
  requireSeed(input.storySeed);
  requireOrdinal(input.ordinal, MASTERY_CATALOG_CAPACITY, "MASTERY_CATALOG");
  const era = resolveEra({ context: input.context, sourceEra: input.sourceEra });
  const terms = CATALOG_TERMS[era.sourceEra][input.catalog];
  const hash = hashText(`${input.storySeed}|catalog|${era.sourceEra}|${input.catalog}`);
  const modifierIndex = (input.ordinal % 10 + hash % 10) % 10;
  const nounIndex = (Math.floor(input.ordinal / 10) % 10 + Math.floor(hash / 10) % 10) % 10;
  const stageIndex = (Math.floor(input.ordinal / 100) + Math.floor(hash / 100) % 10) % 10;
  const detailHash = hashText(`${input.storySeed}|catalog-detail|${era.sourceEra}|${input.catalog}|${input.ordinal}`);
  const element = era.sourceEra === "ancient"
    ? FIVE_PHASE_ELEMENTS[detailHash % FIVE_PHASE_ELEMENTS.length].id
    : null;
  const successMultiplier = roundMultiplier(1.05 + detailHash % 41 / 100);
  const qualityMultiplier = roundMultiplier(1.02 + Math.floor(detailHash / 41) % 29 / 100);
  const riskMultiplier = roundMultiplier(0.72 + Math.floor(detailHash / (41 * 29)) % 49 / 100);
  const focus = CATALOG_FOCUS[input.catalog][detailHash % CATALOG_FOCUS[input.catalog].length];
  return Object.freeze({
    schemaVersion: CHARACTER_MASTERY_LIBRARY_VERSION,
    materializationPolicy: CHARACTER_MASTERY_MATERIALIZATION_POLICY,
    id: `mastery-catalog:${seedTag(input.storySeed)}:${era.sourceEra}:${input.catalog}:${input.ordinal.toString(36).padStart(2, "0")}`,
    ordinal: input.ordinal,
    capacity: MASTERY_CATALOG_CAPACITY,
    fictional: true,
    catalog: input.catalog,
    catalogLabel: terms.label,
    era: era.sourceEra,
    storyEra: era.storyEra,
    isCrossEra: era.isCrossEra,
    compatibilityGate: era.compatibilityGate,
    element,
    name: `${element ? `${ELEMENT_LABELS[element]}系` : ""}${CATALOG_MODIFIERS[input.catalog][modifierIndex]}${terms.nouns[nounIndex]}・${ERA_STAGES[era.sourceEra][stageIndex]}`,
    focus,
    successMultiplier,
    qualityMultiplier,
    riskMultiplier,
    requirement: ERA_REQUIREMENTS[era.sourceEra][detailHash % ERA_REQUIREMENTS[era.sourceEra].length],
    limitation: ERA_LIMITATIONS[era.sourceEra][Math.floor(detailHash / 7) % ERA_LIMITATIONS[era.sourceEra].length],
    cost: `${CATALOG_COSTS[input.catalog][Math.floor(detailHash / 17) % CATALOG_COSTS[input.catalog].length]}；${focus}加乘為 ×${successMultiplier.toFixed(2)}、成品品質為 ×${qualityMultiplier.toFixed(2)}、事故風險為 ×${riskMultiplier.toFixed(2)}。`,
  });
}

function requirePage(pageIndex: number, pageSize: number) {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw new RangeError(`CHARACTER_MASTERY_PAGE_INDEX_INVALID:${pageIndex}`);
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > CHARACTER_MASTERY_PAGE_MAX) {
    throw new RangeError(`CHARACTER_MASTERY_PAGE_SIZE_INVALID:${pageSize}`);
  }
}

export function masteryCatalogPage(input: {
  storySeed: string;
  catalog: MasteryCatalogKind;
  pageIndex: number;
  pageSize: number;
  context?: ProceduralStoryContext;
  sourceEra?: ProceduralTreasureEra;
}) {
  requirePage(input.pageIndex, input.pageSize);
  const start = input.pageIndex * input.pageSize;
  const end = Math.min(MASTERY_CATALOG_CAPACITY, start + input.pageSize);
  if (start > MASTERY_CATALOG_CAPACITY) {
    throw new RangeError(`CHARACTER_MASTERY_PAGE_INDEX_OUT_OF_RANGE:${input.pageIndex}`);
  }
  return {
    pageIndex: input.pageIndex,
    pageSize: input.pageSize,
    total: MASTERY_CATALOG_CAPACITY,
    totalPages: Math.ceil(MASTERY_CATALOG_CAPACITY / input.pageSize),
    items: Array.from({ length: Math.max(0, end - start) }, (_, index) => masteryCatalogRecordAt({
      ...input,
      ordinal: start + index,
    })),
  };
}

export function cultivationTechniquePage(input: {
  storySeed: string;
  element: FivePhaseElement;
  pageIndex: number;
  pageSize: number;
  context?: ProceduralStoryContext;
}) {
  requirePage(input.pageIndex, input.pageSize);
  const start = input.pageIndex * input.pageSize;
  const end = Math.min(CULTIVATION_TECHNIQUE_CAPACITY_PER_ELEMENT, start + input.pageSize);
  if (start > CULTIVATION_TECHNIQUE_CAPACITY_PER_ELEMENT) {
    throw new RangeError(`CULTIVATION_TECHNIQUE_PAGE_INDEX_OUT_OF_RANGE:${input.pageIndex}`);
  }
  return {
    element: input.element,
    pageIndex: input.pageIndex,
    pageSize: input.pageSize,
    total: CULTIVATION_TECHNIQUE_CAPACITY_PER_ELEMENT,
    totalPages: Math.ceil(CULTIVATION_TECHNIQUE_CAPACITY_PER_ELEMENT / input.pageSize),
    items: Array.from({ length: Math.max(0, end - start) }, (_, index) => cultivationTechniqueAt({
      ...input,
      ordinal: start + index,
    })),
  };
}

function abilityForCatalog(character: SocialMatrixCharacter, catalog: MasteryCatalogKind) {
  switch (catalog) {
    case "combat": return character.abilities.martial;
    case "profession": return (character.abilities.strategy + character.abilities.perception) / 2;
    case "pill":
    case "herb": return character.abilities.medicine;
    case "talisman": return (character.abilities.crafting + character.abilities.perception) / 2;
    case "formation": return (character.abilities.strategy + character.abilities.crafting) / 2;
    case "weapon": return character.abilities.crafting;
  }
}

function catalogAssignment(input: {
  relation: Exclude<CharacterMasteryRelation, "holds">;
  record: MasteryCatalogRecord;
  character: SocialMatrixCharacter;
}): CharacterMasteryAssignment {
  const ability = abilityForCatalog(input.character, input.record.catalog);
  const proficiency = Math.max(1, Math.min(100, Math.round(ability * 0.72 + input.record.ordinal % 29)));
  const effectiveMultiplier = roundMultiplier(input.record.successMultiplier * (0.75 + proficiency / 200));
  return {
    relation: input.relation,
    relationLabel: input.relation === "uses" ? "會使用" : input.relation === "makes" ? "會製作" : "栽培",
    referenceType: "mastery-catalog",
    referenceId: input.record.id,
    sourceOrdinal: input.record.ordinal,
    name: input.record.name,
    catalogLabel: input.record.catalogLabel,
    era: input.record.era,
    element: input.record.element,
    proficiency,
    effectiveMultiplier,
    limitation: input.record.limitation,
    cost: input.record.cost,
  };
}

function techniqueAssignment(input: {
  record: CultivationTechniqueRecord;
  character: SocialMatrixCharacter;
}): CharacterMasteryAssignment {
  const proficiency = Math.max(1, Math.min(100, Math.round(
    input.character.abilities.cultivation * 0.7 + input.character.abilities.martial * 0.2 + input.record.ordinal % 19,
  )));
  return {
    relation: "uses",
    relationLabel: "會使用",
    referenceType: "cultivation-technique",
    referenceId: input.record.id,
    sourceOrdinal: input.record.ordinal,
    name: input.record.name,
    catalogLabel: `${input.record.elementLabel}系功法`,
    era: input.record.era,
    element: input.record.element,
    proficiency,
    effectiveMultiplier: roundMultiplier(input.record.baseMultiplier * (0.75 + proficiency / 200)),
    limitation: input.record.limitation,
    cost: input.record.cost,
  };
}

function treasureAssignment(treasure: ProceduralTreasureRecord): CharacterMasteryAssignment {
  return {
    relation: "holds",
    relationLabel: "持有",
    referenceType: "procedural-treasure",
    referenceId: treasure.id,
    sourceOrdinal: treasure.ordinal,
    name: treasure.name,
    catalogLabel: treasure.kindLabel,
    era: treasure.era.sourceEra,
    element: null,
    proficiency: treasure.abilities[0].magnitude,
    effectiveMultiplier: roundMultiplier(1 + treasure.abilities[0].magnitude / 100),
    limitation: treasure.limitation,
    cost: treasure.cost,
  };
}

/**
 * Produces one person's compact training/production profile. It creates only
 * the referenced records and the person's existing treasure; no 100,000-person
 * or 1,000-record catalog is allocated.
 */
export function characterMasteryProfileAt(input: {
  storySeed: string;
  populationIndex: number;
  context?: ProceduralStoryContext;
  socialMatrix?: DeterministicSocialMatrix;
}): CharacterMasteryProfile {
  requireSeed(input.storySeed);
  const matrix = input.socialMatrix ?? new DeterministicSocialMatrix({
    seed: input.storySeed,
    context: input.context,
    cacheLimit: 0,
  });
  if (matrix.seed !== input.storySeed.trim()) {
    throw new Error("CHARACTER_MASTERY_SOCIAL_MATRIX_SEED_MISMATCH");
  }
  const character = matrix.getCharacter(input.populationIndex);
  const era = resolveProceduralTreasureStoryEra(input.context);
  const profileHash = hashText(`${input.storySeed}|character-mastery|${character.characterId}`);
  const primaryElement = era.era === "ancient"
    ? FIVE_PHASE_ELEMENTS[profileHash % FIVE_PHASE_ELEMENTS.length].id
    : null;
  const combat = masteryCatalogRecordAt({
    storySeed: input.storySeed,
    catalog: "combat",
    ordinal: profileHash % MASTERY_CATALOG_CAPACITY,
    context: input.context,
  });
  const profession = masteryCatalogRecordAt({
    storySeed: input.storySeed,
    catalog: "profession",
    ordinal: Math.floor(profileHash / 11) % MASTERY_CATALOG_CAPACITY,
    context: input.context,
  });
  const makingCatalogs = ["talisman", "formation", "weapon", "pill"] as const;
  const makingCatalog = makingCatalogs[Math.floor(profileHash / 17) % makingCatalogs.length];
  const making = masteryCatalogRecordAt({
    storySeed: input.storySeed,
    catalog: makingCatalog,
    ordinal: Math.floor(profileHash / 23) % MASTERY_CATALOG_CAPACITY,
    context: input.context,
  });
  const cultivated = masteryCatalogRecordAt({
    storySeed: input.storySeed,
    catalog: "herb",
    ordinal: Math.floor(profileHash / 31) % MASTERY_CATALOG_CAPACITY,
    context: input.context,
  });
  const possession = character.possessions[0];
  if (!possession) throw new Error("CHARACTER_MASTERY_HELD_TREASURE_MISSING");
  const heldTreasure = proceduralTreasureRecordAt({
    storySeed: input.storySeed,
    ordinal: possession.treasureOrdinal,
    context: input.context,
    socialMatrix: matrix,
  });
  if (heldTreasure.holder.characterId !== character.characterId) {
    throw new Error("CHARACTER_MASTERY_TREASURE_HOLDER_MISMATCH");
  }
  const assignments: CharacterMasteryAssignment[] = [];
  if (primaryElement) {
    assignments.push(techniqueAssignment({
      character,
      record: cultivationTechniqueAt({
        storySeed: input.storySeed,
        element: primaryElement,
        ordinal: Math.floor(profileHash / 43) % CULTIVATION_TECHNIQUE_CAPACITY_PER_ELEMENT,
        context: input.context,
      }),
    }));
  }
  assignments.push(
    catalogAssignment({ relation: "uses", record: combat, character }),
    catalogAssignment({ relation: "uses", record: profession, character }),
    catalogAssignment({ relation: "makes", record: making, character }),
    catalogAssignment({ relation: "cultivates", record: cultivated, character }),
    treasureAssignment(heldTreasure),
  );
  const primaryDefinition = primaryElement
    ? FIVE_PHASE_ELEMENTS.find((element) => element.id === primaryElement)!
    : null;
  return Object.freeze({
    schemaVersion: CHARACTER_MASTERY_LIBRARY_VERSION,
    materializationPolicy: CHARACTER_MASTERY_MATERIALIZATION_POLICY,
    storySeedTag: seedTag(input.storySeed),
    characterId: character.characterId,
    populationIndex: character.populationIndex,
    characterName: character.name,
    storyEra: era.era,
    storyEraLabel: era.eraLabel,
    primaryElement,
    elementalSummary: primaryDefinition ? {
      generates: primaryDefinition.generates,
      controls: primaryDefinition.controls,
      generatedBy: inverseElementRelation(primaryElement!, "generates"),
      controlledBy: inverseElementRelation(primaryElement!, "controls"),
    } : null,
    assignments,
    heldTreasure,
  });
}

/**
 * Shared, deterministic decision facts for both closed AI and the rules
 * fallback. A prose generator may phrase these facts naturally, but it must
 * not invent a higher multiplier, erase the listed cost, or change ownership.
 */
export function characterMasteryDecisionFacts(
  profile: CharacterMasteryProfile,
): CharacterMasteryDecisionFact[] {
  const assignmentFacts = profile.assignments.map((assignment) => ({
    factId: `mastery-fact:${assignment.referenceId}:${assignment.relation}`,
    kind: assignment.relation === "holds" ? "ownership" as const : "capability" as const,
    sourceReferenceId: assignment.referenceId,
    statement: `${profile.characterName}${assignment.relationLabel}${assignment.catalogLabel}「${assignment.name}」，熟練 ${assignment.proficiency}/100，當前實效 ×${assignment.effectiveMultiplier.toFixed(2)}。`,
    consequence: `${assignment.limitation}；${assignment.cost}`,
  }));
  if (!profile.primaryElement || !profile.elementalSummary) return assignmentFacts;
  const elementLabel = ELEMENT_LABELS[profile.primaryElement];
  return [
    {
      factId: `mastery-fact:${profile.characterId}:five-phase`,
      kind: "elemental",
      sourceReferenceId: profile.characterId,
      statement: `${profile.characterName}主修${elementLabel}系：生${ELEMENT_LABELS[profile.elementalSummary.generates]}、剋${ELEMENT_LABELS[profile.elementalSummary.controls]}。`,
      consequence: `同屬 ×1.08，相生 ×1.18，相剋 ×1.28，受生 ×0.94，受剋 ×0.72；倍率必須連同功法本身的基礎倍率計算。`,
    },
    ...assignmentFacts,
  ];
}

/** Compact prompt/state block; intentionally bounded to one character only. */
export function characterMasteryNarrativeContext(profile: CharacterMasteryProfile) {
  const facts = characterMasteryDecisionFacts(profile);
  return [
    `[人物修習與持有物｜${profile.characterName}｜${profile.storyEraLabel}]`,
    ...facts.map((fact) => `- ${fact.statement} 後果：${fact.consequence}`),
    "寫作約束：能力必須透過人物行動呈現；不能把專長當成自動成功，也不能略過限制、代價、所有權與時代相容性。",
  ].join("\n");
}
