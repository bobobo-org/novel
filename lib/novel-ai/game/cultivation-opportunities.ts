export type CultivationOpportunity = {
  id: string;
  name: string;
  category: "competition" | "trial" | "inheritance" | "craft" | "mission" | "crisis" | "social";
  eligibleRanks: string[];
  minimumRealmId: string;
  entryCost: string;
  rewards: string[];
  risks: string[];
  factionEffects: string[];
};

export const CULTIVATION_OPPORTUNITIES: CultivationOpportunity[] = [
  { id: "sect-tournament", name: "宗門大比", category: "competition", eligibleRanks: ["外門弟子", "內門弟子", "真傳弟子", "聖子／聖女"], minimumRealmId: "realm.qi-refining", entryCost: "報名資格、傷藥與備戰時間", rewards: ["晉升名額", "藏經閣選功資格", "築基丹／宗門功勳", "長老關注"], risks: ["受傷", "底牌曝光", "同門結怨", "被派系拉攏"], factionEffects: ["各峰排名改變", "資源配額重分", "新一代核心弟子浮現"] },
  { id: "outer-assessment", name: "外門考核與內門晉升", category: "competition", eligibleRanks: ["雜役弟子", "外門弟子"], minimumRealmId: "realm.mortal-body", entryCost: "任務功勳、基礎功法與門規考核", rewards: ["正式弟子身分", "月例提升", "師承機會"], risks: ["淘汰", "降為雜役", "考核作弊構陷"], factionEffects: ["外門勢力洗牌", "執事權力增加"] },
  { id: "cave-trial", name: "失落洞府／洞穴試煉", category: "trial", eligibleRanks: ["外門弟子", "內門弟子", "真傳弟子", "散修"], minimumRealmId: "realm.qi-refining", entryCost: "地圖、照明／避瘴資源與退出符", rewards: ["前人遺寶", "殘缺功法", "靈草礦材", "洞府控制權"], risks: ["機關禁制", "妖獸", "坍塌", "隊伍背叛"], factionEffects: ["洞府歸屬爭議", "持有人與分配契約形成"] },
  { id: "secret-realm", name: "跨宗秘境開啟", category: "trial", eligibleRanks: ["內門弟子", "真傳弟子", "聖子／聖女", "長老"], minimumRealmId: "realm.foundation", entryCost: "宗門名額、傳送資源與生死契約", rewards: ["稀有靈藥", "秘境傳承", "靈脈座標", "宗門資源份額"], risks: ["空間崩塌", "跨宗爭奪", "境界壓制", "延遲因果"], factionEffects: ["宗門排名變化", "聯盟與仇恨重算", "秘境入口控制權改變"] },
  { id: "inheritance-stele", name: "傳承碑悟道", category: "inheritance", eligibleRanks: ["內門弟子", "真傳弟子", "聖子／聖女", "長老"], minimumRealmId: "realm.foundation", entryCost: "悟道時限、神識負荷與功勳", rewards: ["功法真意", "神通線索", "境界感悟"], risks: ["心魔", "記憶混雜", "傳承契約", "派系爭議"], factionEffects: ["傳承候選順位改變", "師徒關係加深或破裂"] },
  { id: "craft-conference", name: "丹會／符會／陣會／器會", category: "craft", eligibleRanks: ["外門弟子", "內門弟子", "真傳弟子", "長老", "客卿／供奉"], minimumRealmId: "realm.qi-refining", entryCost: "材料、配方、火候／陣盤與公開驗證", rewards: ["職業名聲", "配方交換", "坊市訂單", "專業傳承"], risks: ["炸爐／失控", "配方洩漏", "材料虧損", "同行競爭"], factionEffects: ["峰堂資源增加", "專業人才被挖角"] },
  { id: "elder-apprentice", name: "長老公開收徒", category: "social", eligibleRanks: ["雜役弟子", "外門弟子", "內門弟子"], minimumRealmId: "realm.mortal-body", entryCost: "心性、靈根與公開承諾考驗", rewards: ["正式師承", "核心功法", "庇護與資源"], risks: ["捲入派系", "師命債務", "同門競爭"], factionEffects: ["師徒網擴張", "峰內繼承秩序改變"] },
  { id: "escort-mission", name: "護送靈貨與跨域任務", category: "mission", eligibleRanks: ["外門弟子", "內門弟子", "真傳弟子", "散修", "客卿／供奉"], minimumRealmId: "realm.qi-refining", entryCost: "時間、護送保證與路線情報", rewards: ["靈石", "功勳", "跨勢力人脈", "商路情報"], risks: ["劫修", "內鬼", "貨損", "外交誤會"], factionEffects: ["坊市信用變化", "商盟與宗門關係調整"] },
  { id: "beast-tide", name: "獸潮／魔患鎮守", category: "crisis", eligibleRanks: ["外門弟子", "內門弟子", "真傳弟子", "長老", "客卿／供奉"], minimumRealmId: "realm.qi-refining", entryCost: "宗門戰備、丹藥、符籙與傷亡風險", rewards: ["大額功勳", "戰場材料", "城池／凡人信任"], risks: ["傷亡", "防線崩潰", "資源透支", "魔氣污染"], factionEffects: ["宗門威望重算", "防區與責任歸屬改變"] },
  { id: "sect-diplomacy", name: "宗門盟會與聯姻／交換生", category: "social", eligibleRanks: ["聖子／聖女", "長老", "宗主／掌門", "客卿／供奉"], minimumRealmId: "realm.foundation", entryCost: "承諾、資源交換與政治風險", rewards: ["聯盟", "商路", "功法交流", "共同秘境名額"], risks: ["失去自主權", "人質疑慮", "婚約／契約衝突"], factionEffects: ["友好、利益、恐懼、競爭、聯盟、仇恨同步變化"] },
  { id: "spirit-auction", name: "坊市拍賣與地下交易", category: "social", eligibleRanks: ["外門弟子", "內門弟子", "真傳弟子", "長老", "散修", "客卿／供奉"], minimumRealmId: "realm.qi-refining", entryCost: "靈石、保證金與身分暴露", rewards: ["稀有法器", "丹藥符籙", "情報與債權"], risks: ["抬價陷阱", "贓物追查", "殺人奪寶", "黑市信用債"], factionEffects: ["寶物持有人改變", "競標敵人與交易盟友形成"] },
  { id: "heavenly-anomaly", name: "天地異象與無主機緣", category: "inheritance", eligibleRanks: ["外門弟子", "內門弟子", "真傳弟子", "長老", "散修"], minimumRealmId: "realm.qi-refining", entryCost: "情報判讀、先機與可撤退資源", rewards: ["奇物", "新秘境入口", "特殊靈根／體質線索"], risks: ["假機緣", "高階修士爭奪", "天劫標記", "因果債"], factionEffects: ["多方勢力追蹤", "新世界事件鏈啟動"] },
];

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619) >>> 0;
  }
  return result;
}

export function selectCultivationOpportunity(input: {
  seed: string;
  turn: number;
  strategy: "steady" | "resource" | "bold";
}) {
  const categories = input.strategy === "steady"
    ? new Set(["competition", "craft", "social"])
    : input.strategy === "resource"
      ? new Set(["mission", "craft", "social", "inheritance"])
      : new Set(["trial", "crisis", "inheritance"]);
  const pool = CULTIVATION_OPPORTUNITIES.filter((item) => categories.has(item.category));
  return pool[hash(`${input.seed}:${input.turn}:${input.strategy}`) % pool.length];
}
