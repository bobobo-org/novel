import type { ProceduralStoryContext } from "./procedural-story-library";
import type { ProceduralTreasureKind } from "./procedural-treasure-classification";

export const PROCEDURAL_TREASURE_ERA_VERSION = "procedural-treasure-era-v1" as const;

export type ProceduralTreasureEra = "ancient" | "early-modern" | "modern" | "future";

export type ProceduralTreasureEraTaxonomy = {
  schemaVersion: typeof PROCEDURAL_TREASURE_ERA_VERSION;
  storyEra: ProceduralTreasureEra;
  storyEraLabel: string;
  sourceEra: ProceduralTreasureEra;
  sourceEraLabel: string;
  allowsCrossEra: boolean;
  isCrossEra: boolean;
  compatibilityGate: "story-era-compatible" | "explicit-cross-era";
  label: string;
  subtypes: readonly string[];
  abilityNames: readonly string[];
  effects: readonly string[];
  activations: readonly string[];
  costs: readonly string[];
};

type EraKindTerms = {
  label: string;
  subtypes: readonly string[];
  abilityNames: readonly string[];
};

const ERA_LABELS: Record<ProceduralTreasureEra, string> = {
  ancient: "古代／修行",
  "early-modern": "近代／工業化",
  modern: "現代",
  future: "未來",
};

const EARLY_MODERN: Record<ProceduralTreasureKind, EraKindTerms> = {
  weapon: { label: "槍械／冷兵器", subtypes: ["轉輪手槍", "栓動步槍", "軍刀", "信號槍", "警棍", "獵槍"], abilityNames: ["制止", "警戒", "掩護", "破鎖", "精準", "威懾"] },
  artifact: { label: "精密儀器", subtypes: ["懷錶", "測距儀", "留聲機", "顯微鏡", "航海羅盤", "密碼機"], abilityNames: ["校時", "測距", "留聲", "放大", "定向", "譯碼"] },
  talisman: { label: "通訊／證件", subtypes: ["電報密碼本", "通行證", "身分證明", "火漆公文", "無線電報", "緊急信號旗"], abilityNames: ["傳報", "驗證", "通行", "密封", "呼救", "調度"] },
  pill: { label: "醫藥", subtypes: ["止痛藥", "抗菌藥", "疫苗", "外科麻醉劑", "退燒藥", "急救藥劑"], abilityNames: ["止痛", "抑菌", "免疫", "麻醉", "退熱", "急救"] },
  herb: { label: "藥材／化學原料", subtypes: ["金雞納霜原料", "消毒酒精", "草藥浸膏", "硫磺", "嗎啡原料", "止血棉"], abilityNames: ["提煉", "消毒", "鎮痛", "止血", "防腐", "配藥"] },
  formation: { label: "工事／基礎設施", subtypes: ["鐵路調度網", "城市電網", "防禦工事", "電話交換網", "供水系統", "工廠產線"], abilityNames: ["調度", "供電", "防守", "交換", "供水", "量產"] },
  armor: { label: "防護裝備", subtypes: ["鋼盔", "防彈背心", "防毒面具", "消防服", "護目鏡", "工業手套"], abilityNames: ["防彈", "濾毒", "隔熱", "護目", "緩衝", "耐磨"] },
  material: { label: "工業材料", subtypes: ["精煉鋼", "銅線", "硫化橡膠", "光學玻璃", "高壓鍋爐板", "絕緣陶瓷"], abilityNames: ["承壓", "導電", "密封", "折光", "隔熱", "絕緣"] },
  manual: { label: "文件／技術手冊", subtypes: ["工程藍圖", "航海日誌", "醫療手冊", "專利文件", "軍用教範", "帳冊憑證"], abilityNames: ["施工", "導航", "診療", "舉證", "訓練", "稽核"] },
  "special-opportunity": { label: "載具／特殊資源", subtypes: ["蒸汽列車", "早期汽車", "飛艇", "遠洋輪船", "祕密實驗室", "海外航線"], abilityNames: ["運輸", "遠航", "升空", "研究", "撤離", "開路"] },
};

const MODERN: Record<ProceduralTreasureKind, EraKindTerms> = {
  weapon: { label: "槍械／防衛裝備", subtypes: ["半自動手槍", "精準步槍", "非致命電擊器", "戰術盾", "信號槍", "防暴裝備"], abilityNames: ["精準", "制止", "掩護", "威懾", "示警", "破障"] },
  artifact: { label: "電子與晶片／實驗器材", subtypes: ["加密晶片", "衛星定位器", "無人機控制器", "光譜分析儀", "實驗感測器", "資料儲存模組"], abilityNames: ["加密", "定位", "遙控", "分析", "感測", "存證"] },
  talisman: { label: "通訊／識別", subtypes: ["加密手機", "無線電台", "門禁卡", "電子憑證", "緊急信標", "衛星電話"], abilityNames: ["通訊", "驗證", "授權", "示警", "定位", "廣播"] },
  pill: { label: "醫藥", subtypes: ["處方藥", "疫苗", "急救針劑", "抗生素", "止痛藥", "解毒劑"], abilityNames: ["治療", "免疫", "急救", "抑菌", "止痛", "解毒"] },
  herb: { label: "生醫原料", subtypes: ["細胞培養基", "藥用植萃", "血清原料", "蛋白試劑", "醫用氧氣", "組織樣本"], abilityNames: ["培養", "萃取", "檢驗", "合成", "供氧", "比對"] },
  formation: { label: "系統／網路", subtypes: ["城市監控網", "資料中心", "電力調度系統", "醫院資訊網", "交通控制網", "實驗室安全系統"], abilityNames: ["監控", "運算", "調度", "追蹤", "控管", "隔離"] },
  armor: { label: "防護裝備", subtypes: ["防彈背心", "化學防護衣", "消防裝", "攀登護具", "醫療隔離衣", "工業安全帽"], abilityNames: ["防彈", "隔離", "隔熱", "防墜", "防污", "緩衝"] },
  material: { label: "工業／電子材料", subtypes: ["航太合金", "碳纖維", "半導體晶圓", "稀土磁材", "醫療級聚合物", "超導線材"], abilityNames: ["承壓", "減重", "運算", "導磁", "相容", "導電"] },
  manual: { label: "文件／憑證／技術手冊", subtypes: ["實驗紀錄", "操作手冊", "調查卷宗", "專利文件", "數位憑證", "工程圖紙"], abilityNames: ["重現", "操作", "舉證", "授權", "驗證", "施工"] },
  "special-opportunity": { label: "載具／特殊資源", subtypes: ["電動車", "直升機", "無人機", "行動實驗車", "救援船", "專用衛星時段"], abilityNames: ["運輸", "升空", "偵察", "實驗", "救援", "通訊"] },
};

const FUTURE: Record<ProceduralTreasureKind, EraKindTerms> = {
  weapon: { label: "定向能／防衛系統", subtypes: ["脈衝步槍", "電磁投射器", "非致命神經制止器", "無人防衛平台", "軌道信標", "反制盾"], abilityNames: ["脈衝", "投射", "制止", "攔截", "標定", "反制"] },
  artifact: { label: "量子晶片／尖端儀器", subtypes: ["量子運算核心", "引力感測器", "奈米修復器", "全息投影核", "外星訊號分析器", "自主機器人核心"], abilityNames: ["量算", "測引", "奈修", "全息", "解訊", "自治"] },
  talisman: { label: "星際通訊／身分金鑰", subtypes: ["量子通訊鑰", "生物身分環", "殖民通行憑證", "深空信標", "神經介面令牌", "艦隊授權碼"], abilityNames: ["量傳", "生驗", "通行", "導引", "介接", "授權"] },
  pill: { label: "奈米醫藥", subtypes: ["奈米修復劑", "基因穩定劑", "輻射解毒劑", "冬眠甦醒劑", "免疫重編劑", "神經保護劑"], abilityNames: ["奈修", "穩基", "解輻", "甦醒", "重免", "護神"] },
  herb: { label: "異星生醫樣本", subtypes: ["異星菌株", "人工器官基質", "火星藻種", "再生蛋白", "真空孢子", "低重力藥植"], abilityNames: ["培菌", "植器", "供氧", "再生", "耐空", "適重"] },
  formation: { label: "星艦／殖民系統", subtypes: ["艦隊戰術網", "殖民維生網", "行星氣候控制", "躍遷航路系統", "量子資料網", "軌道防衛網"], abilityNames: ["協戰", "維生", "控候", "躍遷", "量聯", "衛軌"] },
  armor: { label: "外骨骼／太空護具", subtypes: ["動力外骨骼", "艙外作業服", "輻射護甲", "生物適應服", "重力穩定靴", "奈米防護膜"], abilityNames: ["增力", "耐空", "抗輻", "適生", "穩重", "奈護"] },
  material: { label: "超材料／異星材料", subtypes: ["超導晶格", "記憶金屬", "負質量樣本", "自癒陶瓷", "量子點陣", "異星複合材"], abilityNames: ["超導", "復形", "減質", "自癒", "量鎖", "異構"] },
  manual: { label: "資料協定／技術檔案", subtypes: ["躍遷協定", "殖民地法典", "AI 訓練紀錄", "星圖資料庫", "基因授權書", "艦艇維修模型"], abilityNames: ["躍遷", "治理", "訓練", "導航", "授權", "維修"] },
  "special-opportunity": { label: "星艦／宇宙機緣", subtypes: ["私人星艦", "躍遷窗口", "外星遺跡座標", "軌道實驗站", "殖民地席位", "休眠方舟"], abilityNames: ["遠航", "躍遷", "探索", "實驗", "殖民", "休眠"] },
};

const TERMS_BY_ERA = {
  "early-modern": EARLY_MODERN,
  modern: MODERN,
  future: FUTURE,
} as const;

const OPERATIONAL_LANGUAGE: Record<Exclude<ProceduralTreasureEra, "ancient">, Pick<ProceduralTreasureEraTaxonomy, "effects" | "activations" | "costs">> = {
  "early-modern": {
    effects: ["在額定範圍內完成一次可驗證作業，不能抹去操作留下的物理證據", "把一次危機轉成可處理的程序窗口，但後續責任仍由人物承擔", "保存一份可供他人複核的紀錄，不能直接證明當事人的動機", "調度既有資源完成一項短程任務，不會憑空補足缺料"],
    activations: ["由合格操作員完成檢查後啟用", "登記序號與用途後投入使用", "取得管理者與一名見證者簽署"],
    costs: ["使用會消耗難以補充的燃料或材料", "操作紀錄與所在位置會留在紙本或電報系統", "使用後必須停機維護一個重要節點"],
  },
  modern: {
    effects: ["依標準操作程序提供一次可量測輸出，不能超越額定性能或法律邊界", "保存時間、位置與操作者紀錄，讓結果可由第三方複核", "降低一項眼前風險，但不會消除造成風險的制度或人物選擇", "把既有資料或資源調度到指定任務，不能生成不存在的證據"],
    activations: ["通過身分授權與安全檢查後啟用", "由合格專業人員依操作手冊執行", "連接電力或網路並建立稽核紀錄"],
    costs: ["消耗電力、耗材或有限額度並留下稽核軌跡", "使用後必須維護、校準或重新取得授權", "錯誤操作會觸發停用與責任調查"],
  },
  future: {
    effects: ["在安全協定範圍內提供一次高階輸出，不能繞過物理限制與使用者自主權", "同步感測與決策紀錄供事後複核，AI 不會替人物承擔選擇", "暫時穩定一項艦艇、殖民或生醫危機，根因仍需後續處置", "連結既有星際資源完成一次任務，不能從零創造能源或物資"],
    activations: ["以生物金鑰與雙人授權啟用", "完成艦載 AI 安全協定確認", "建立可回溯的量子簽章後執行"],
    costs: ["消耗稀缺能源、運算配額或不可逆材料", "啟用座標與操作者會寫入跨星區稽核鏈", "使用後必須進入冷卻、維修或倫理審查"],
  },
};

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function resolveProceduralTreasureStoryEra(context?: ProceduralStoryContext) {
  const signal = [context?.genre, context?.playMode, context?.conflict, ...(context?.storyTags ?? [])]
    .filter(Boolean)
    .join(" ");
  const allowsCrossEra = /跨時代|穿越|時空|time[ -]?travel|cross[ -]?era/iu.test(signal);
  const era: ProceduralTreasureEra = /未來|科幻|星際|太空|賽博|future|sci[ -]?fi/iu.test(signal)
    ? "future"
    : /近代|民國|維多利亞|工業革命|early[ -]?modern|industrial/iu.test(signal)
      ? "early-modern"
      : /現代|當代|校園|企業|娛樂|推理|modern|contemporary|business|campus/iu.test(signal)
        ? "modern"
        : "ancient";
  return { era, eraLabel: ERA_LABELS[era], allowsCrossEra };
}

export function proceduralTreasureEraTaxonomyAt(input: {
  storySeed: string;
  ordinal: number;
  kind: ProceduralTreasureKind;
  context?: ProceduralStoryContext;
  ancient: Pick<ProceduralTreasureEraTaxonomy, "label" | "subtypes" | "abilityNames" | "effects" | "activations" | "costs">;
}): ProceduralTreasureEraTaxonomy {
  const story = resolveProceduralTreasureStoryEra(input.context);
  const eras: readonly ProceduralTreasureEra[] = ["ancient", "early-modern", "modern", "future"];
  const crossEraRoll = hashText(`${input.storySeed}|cross-era-item|${input.ordinal}`);
  const isCrossEra = story.allowsCrossEra && crossEraRoll % 11 === 0;
  const sourceEra = isCrossEra
    ? eras[(eras.indexOf(story.era) + 1 + crossEraRoll % (eras.length - 1)) % eras.length]!
    : story.era;
  const terms = sourceEra === "ancient" ? input.ancient : TERMS_BY_ERA[sourceEra][input.kind];
  const operational = sourceEra === "ancient" ? input.ancient : OPERATIONAL_LANGUAGE[sourceEra];
  return {
    schemaVersion: PROCEDURAL_TREASURE_ERA_VERSION,
    storyEra: story.era,
    storyEraLabel: story.eraLabel,
    sourceEra,
    sourceEraLabel: ERA_LABELS[sourceEra],
    allowsCrossEra: story.allowsCrossEra,
    isCrossEra,
    compatibilityGate: isCrossEra ? "explicit-cross-era" : "story-era-compatible",
    label: terms.label,
    subtypes: terms.subtypes,
    abilityNames: terms.abilityNames,
    effects: operational.effects,
    activations: operational.activations,
    costs: operational.costs,
  };
}

export function proceduralTreasureEraDisplayName(input: {
  storySeed: string;
  ordinal: number;
  sourceEra: ProceduralTreasureEra;
  subtype: string;
  ancientName: string;
}) {
  if (input.sourceEra === "ancient") return input.ancientName;
  const code = hashText(`${input.storySeed}|era-item-name|${input.ordinal}`);
  const letters = `${String.fromCharCode(65 + code % 26)}${String.fromCharCode(65 + Math.floor(code / 26) % 26)}`;
  const number = (Math.floor(code / (26 * 26)) % 10_000).toString().padStart(4, "0");
  if (input.sourceEra === "early-modern") return `${input.subtype}・${letters}-${number}型`;
  if (input.sourceEra === "modern") return `${input.subtype} ${letters}-${number}`;
  return `${input.subtype}「${letters}-${number}」`;
}
