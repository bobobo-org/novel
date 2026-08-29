import type { ProceduralStoryContext } from "../game/procedural-story-library";
import type { CharacterCultivationProfile } from "../domain";
import {
  DeterministicSocialMatrix,
  socialMatrixHash,
  type SocialMatrixInstitutionProfile,
} from "./social-matrix";
import { familyGenealogyPositionAt } from "./family-genealogy";
import type {
  SocialInstitution,
  SocialInstitutionKind,
  SocialMatrixCharacter,
  SocialMatrixPage,
} from "./types";

/**
 * Every indexed world exposes a full society directory rather than a ten-row
 * sample.  The records remain deterministic and are only materialized for the
 * selected world, so increasing this number does not create a stored 30 x
 * 100,000 data blob.
 */
export const STORY_ORGANIZATION_DIRECTORY_SIZE = 30;
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

export type StoryOrganizationWorldClassificationId =
  | "contemporary-life"
  | "urban-workplace"
  | "school-youth"
  | "mystery-justice"
  | "historical-court"
  | "wuxia-rivers"
  | "cultivation-sects"
  | "mythic-otherworld"
  | "near-future-cyber"
  | "deep-space-future"
  | "post-apocalypse";

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
  worldClassificationId: StoryOrganizationWorldClassificationId;
  specializationId: string;
  specializationLabel: string;
  specialistRoles: readonly string[];
  specialistAssets: readonly string[];
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
  worldClassificationId: StoryOrganizationWorldClassificationId;
  specializationId: string;
  specializationLabel: string;
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
  relationships: StoryOrganizationRelationship[];
};

export type StoryOrganizationRelationshipKind =
  | "alliance"
  | "rivalry"
  | "vassalage"
  | "schism"
  | "marriage-kinship"
  | "resource-dependence"
  | "historic-blood-debt"
  | "covert-cooperation";

export type StoryOrganizationRelationship = {
  relationshipId: string;
  kind: StoryOrganizationRelationshipKind;
  kindLabel: string;
  sourceOrganizationId: string;
  targetOrganizationId: string;
  directed: boolean;
  worldClassificationId: StoryOrganizationWorldClassificationId;
  era: StoryOrganizationEra;
  cause: string;
  history: string;
  currentStatus: string;
  publicStance: string;
  secretMotive: string;
  intensity: number;
  trust: number;
  publiclyKnown: boolean;
  eraGate: "same-era";
  classificationGate: "same-world-classification";
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

const CLASSIFICATION_ARCHETYPE_ORDER: Record<StoryOrganizationWorldClassificationId, readonly StoryOrganizationArchetype[]> = {
  "contemporary-life": ["family", "government", "guild", "academy", "enterprise", "family", "guild", "government", "enterprise", "academy"],
  "urban-workplace": ["enterprise", "enterprise", "family", "government", "academy", "guild", "enterprise", "family", "enterprise", "government"],
  "school-youth": ["academy", "guild", "academy", "government", "family", "academy", "guild", "enterprise", "academy", "guild"],
  "mystery-justice": ["government", "academy", "guild", "enterprise", "family", "government", "guild", "academy", "enterprise", "government"],
  "historical-court": ["government", "family", "enterprise", "academy", "guild", "government", "family", "enterprise", "government", "academy"],
  "wuxia-rivers": ["sect", "guild", "family", "enterprise", "government", "sect", "academy", "guild", "family", "enterprise"],
  "cultivation-sects": ["sect", "family", "sect", "enterprise", "academy", "guild", "sect", "family", "enterprise", "guild"],
  "mythic-otherworld": ["government", "sect", "guild", "academy", "family", "enterprise", "sect", "guild", "government", "academy"],
  "near-future-cyber": ["enterprise", "government", "academy", "guild", "enterprise", "family", "government", "academy", "enterprise", "guild"],
  "deep-space-future": ["government", "enterprise", "academy", "guild", "family", "government", "enterprise", "academy", "guild", "enterprise"],
  "post-apocalypse": ["guild", "government", "academy", "enterprise", "family", "guild", "government", "enterprise", "academy", "guild"],
};

type OrganizationSpecialization = {
  id: string;
  label: string;
  roles: readonly string[];
  assets: readonly string[];
};

const ORGANIZATION_SPECIALIZATIONS: Record<StoryOrganizationWorldClassificationId, readonly OrganizationSpecialization[]> = {
  "contemporary-life": [
    { id: "community", label: "社區治理", roles: ["社區協調員", "住民代表"], assets: ["社區名冊", "公共空間"] },
    { id: "medical", label: "醫療照護", roles: ["醫療主任", "個案管理師"], assets: ["醫療網路", "藥品庫存"] },
    { id: "retail", label: "民生零售", roles: ["採購主管", "門市經理"], assets: ["民生通路", "供貨契約"] },
    { id: "culture", label: "文化創作", roles: ["策展人", "創作總監"], assets: ["文化館舍", "作品授權"] },
    { id: "sports", label: "運動競技", roles: ["總教練", "賽務主管"], assets: ["訓練基地", "賽事資格"] },
    { id: "transit", label: "交通運輸", roles: ["調度長", "路線規劃師"], assets: ["運輸路網", "調度中心"] },
    { id: "housing", label: "居住建設", roles: ["建築師", "物業主管"], assets: ["住宅資產", "施工許可"] },
    { id: "family-service", label: "家庭服務", roles: ["社工督導", "家庭顧問"], assets: ["照護據點", "扶助基金"] },
    { id: "food", label: "飲食供應", roles: ["主廚", "食品安全主管"], assets: ["中央廚房", "食材產地"] },
    { id: "travel", label: "旅行觀光", roles: ["行程策劃師", "在地嚮導"], assets: ["旅運牌照", "地方合作網"] },
  ],
  "urban-workplace": [
    { id: "finance", label: "金融資本", roles: ["投資長", "風險主管"], assets: ["資本額度", "投資組合"] },
    { id: "software", label: "軟體平台", roles: ["技術長", "平台架構師"], assets: ["原始碼", "雲端平台"] },
    { id: "manufacturing", label: "精密製造", roles: ["廠長", "品質工程師"], assets: ["生產線", "製造專利"] },
    { id: "logistics", label: "物流供應鏈", roles: ["供應鏈長", "倉儲主管"], assets: ["物流樞紐", "供應商名冊"] },
    { id: "biotech", label: "生技醫藥", roles: ["研發長", "臨床專案主管"], assets: ["藥證", "研究樣本"] },
    { id: "media", label: "媒體娛樂", roles: ["製作人", "經紀總監"], assets: ["內容版權", "發行通路"] },
    { id: "commerce", label: "品牌零售", roles: ["品牌長", "通路主管"], assets: ["品牌商標", "會員資料"] },
    { id: "energy", label: "能源建設", roles: ["工程長", "電網調度主管"], assets: ["能源設施", "特許合約"] },
    { id: "consulting", label: "專業顧問", roles: ["合夥人", "專案總監"], assets: ["客戶契約", "產業資料庫"] },
    { id: "labor", label: "勞動協作", roles: ["工會理事長", "勞資協調員"], assets: ["團體協約", "互助基金"] },
  ],
  "school-youth": [
    { id: "student-council", label: "學生自治", roles: ["學生會長", "議事代表"], assets: ["學生議會", "活動預算"] },
    { id: "humanities", label: "人文社科", roles: ["系主任", "田野研究員"], assets: ["文獻典藏", "田野資料"] },
    { id: "science", label: "基礎科學", roles: ["實驗室主任", "研究助理"], assets: ["實驗室", "研究數據"] },
    { id: "engineering", label: "工程創客", roles: ["工坊主任", "競賽隊長"], assets: ["創客工坊", "競賽原型"] },
    { id: "medicine", label: "醫學教育", roles: ["教學醫師", "實習隊長"], assets: ["教學病房", "模擬訓練設備"] },
    { id: "law", label: "法政辯論", roles: ["模擬法庭教練", "辯論隊長"], assets: ["案例卷宗", "模擬法庭"] },
    { id: "arts", label: "藝術展演", roles: ["藝術總監", "舞台監督"], assets: ["展演場館", "作品檔案"] },
    { id: "athletics", label: "校隊競技", roles: ["總教練", "隊長"], assets: ["訓練場", "參賽資格"] },
    { id: "library", label: "圖書典藏", roles: ["館長", "檔案管理員"], assets: ["特藏文獻", "借閱紀錄"] },
    { id: "alumni", label: "校友協力", roles: ["校友會長", "獎助專員"], assets: ["獎助基金", "實習網路"] },
  ],
  "mystery-justice": [
    { id: "criminal", label: "刑事偵查", roles: ["專案指揮官", "刑警"], assets: ["案件卷宗", "搜索權限"] },
    { id: "forensics", label: "鑑識科學", roles: ["鑑識主任", "痕跡分析師"], assets: ["證物庫", "鑑識實驗室"] },
    { id: "legal", label: "司法訴訟", roles: ["主任檢察官", "訴訟律師"], assets: ["訴訟卷宗", "法庭程序"] },
    { id: "intelligence", label: "情報分析", roles: ["情報主管", "分析員"], assets: ["線人網路", "機密檔案"] },
    { id: "journalism", label: "調查新聞", roles: ["調查主編", "記者"], assets: ["消息來源", "未刊稿件"] },
    { id: "witness", label: "證人保護", roles: ["保護官", "安全規劃員"], assets: ["安全屋", "新身分檔案"] },
    { id: "archives", label: "檔案稽核", roles: ["檔案館長", "稽核員"], assets: ["歷史卷宗", "存取紀錄"] },
    { id: "cybercrime", label: "數位犯罪", roles: ["資安偵查官", "數位鑑識員"], assets: ["取證映像", "網路日誌"] },
    { id: "private-detective", label: "民間調查", roles: ["調查社長", "外勤調查員"], assets: ["委託契約", "地方人脈"] },
    { id: "rescue", label: "緊急搜救", roles: ["搜救隊長", "危機談判員"], assets: ["救援裝備", "災情地圖"] },
  ],
  "historical-court": [
    { id: "court", label: "朝廷中樞", roles: ["宰輔", "給事中"], assets: ["詔令", "官員名冊"] },
    { id: "civil-service", label: "地方官署", roles: ["郡守", "主簿"], assets: ["戶籍黃冊", "官倉"] },
    { id: "military", label: "邊軍軍鎮", roles: ["都督", "校尉"], assets: ["兵符", "軍糧"] },
    { id: "granary", label: "糧政漕運", roles: ["轉運使", "倉曹"], assets: ["漕船", "糧冊"] },
    { id: "salt-iron", label: "鹽鐵專營", roles: ["鹽鐵使", "巡檢"], assets: ["專賣憑引", "冶鐵作坊"] },
    { id: "courier", label: "驛傳交通", roles: ["驛丞", "急腳遞"], assets: ["驛站網", "通關符節"] },
    { id: "justice", label: "刑獄司法", roles: ["廷尉", "推官"], assets: ["刑獄卷宗", "勘驗文書"] },
    { id: "craft", label: "宮造工藝", roles: ["大匠", "監作"], assets: ["官營工坊", "工藝圖譜"] },
    { id: "rites", label: "禮制祭祀", roles: ["禮官", "司儀"], assets: ["禮制典冊", "祭器"] },
    { id: "merchant", label: "商幫會館", roles: ["會首", "大掌櫃"], assets: ["商路", "票號信用"] },
  ],
  "wuxia-rivers": [
    { id: "sword", label: "劍術傳承", roles: ["劍首", "傳劍師"], assets: ["劍譜", "名劍"] },
    { id: "blade", label: "刀法武館", roles: ["館主", "教頭"], assets: ["刀譜", "演武場"] },
    { id: "medicine", label: "醫毒藥門", roles: ["醫堂主", "毒理師"], assets: ["醫書", "解毒方"] },
    { id: "escort", label: "鏢局護運", roles: ["總鏢頭", "鏢師"], assets: ["鏢路", "保鏢契約"] },
    { id: "beggar", label: "江湖幫會", roles: ["幫主", "分舵主"], assets: ["耳目網", "分舵據點"] },
    { id: "intelligence", label: "江湖情報", roles: ["樓主", "探子"], assets: ["江湖榜", "密信渠道"] },
    { id: "martial-art", label: "拳掌武學", roles: ["掌門", "首席教習"], assets: ["拳譜", "武館盟約"] },
    { id: "merchant", label: "江湖商盟", roles: ["盟主", "行商管事"], assets: ["商隊", "黑白兩道信用"] },
    { id: "yamen", label: "地方巡捕", roles: ["總捕頭", "緝事捕快"], assets: ["海捕文書", "牢獄名冊"] },
    { id: "hidden-weapon", label: "機關暗器", roles: ["機關師", "暗器教習"], assets: ["機關圖譜", "暗器庫"] },
  ],
  "cultivation-sects": [
    { id: "sword", label: "劍道傳承", roles: ["劍峰首座", "劍修"], assets: ["劍典", "劍塚"] },
    { id: "alchemy", label: "丹藥煉製", roles: ["丹堂首座", "煉丹師"], assets: ["丹方", "地火丹爐"] },
    { id: "talisman", label: "符籙製作", roles: ["符堂首座", "制符師"], assets: ["符籙傳承", "靈墨庫"] },
    { id: "formation", label: "陣法禁制", roles: ["陣堂首座", "陣師"], assets: ["護山大陣", "陣圖"] },
    { id: "artifact", label: "煉器鍛造", roles: ["器峰首座", "煉器師"], assets: ["煉器爐", "法器圖譜"] },
    { id: "herb", label: "靈植藥草", roles: ["藥園長老", "靈植師"], assets: ["靈田", "藥草種庫"] },
    { id: "beast", label: "御獸靈禽", roles: ["御獸長老", "馭獸師"], assets: ["靈獸譜", "獸園"] },
    { id: "astrology", label: "星象天機", roles: ["觀星長老", "推演師"], assets: ["星盤", "天機錄"] },
    { id: "law", label: "戒律執法", roles: ["執法長老", "巡戒使"], assets: ["宗規戒律", "罪錄臺帳"] },
    { id: "market", label: "坊市商貿", roles: ["坊主", "鑑寶師"], assets: ["坊市地契", "拍賣名錄"] },
  ],
  "mythic-otherworld": [
    { id: "magic", label: "奧術魔法", roles: ["大法師", "咒術研究員"], assets: ["法術書庫", "魔力塔"] },
    { id: "temple", label: "神殿祭司", roles: ["大祭司", "聖堂騎士"], assets: ["神諭碑", "聖物庫"] },
    { id: "dragon", label: "龍族議會", roles: ["龍裔議長", "鱗衛"], assets: ["龍巢領地", "古老盟約"] },
    { id: "forest", label: "森林族群", roles: ["長老", "巡林者"], assets: ["古樹聖地", "自然契約"] },
    { id: "craft", label: "鍛造工坊", roles: ["鍛造大師", "符文工匠"], assets: ["熔爐城", "符文圖譜"] },
    { id: "adventure", label: "冒險者公會", roles: ["公會長", "任務仲介"], assets: ["委託榜", "地下城地圖"] },
    { id: "royal", label: "王國議政", roles: ["攝政官", "封地領主"], assets: ["王室印璽", "封地冊"] },
    { id: "healing", label: "魔法醫療", roles: ["首席治療師", "藥劑師"], assets: ["療癒泉", "藥劑配方"] },
    { id: "trade", label: "跨族商盟", roles: ["商盟議長", "關務官"], assets: ["傳送商路", "通商條約"] },
    { id: "abyss", label: "深淵防衛", roles: ["守門人", "封印師"], assets: ["界門封印", "異界警戒網"] },
  ],
  "near-future-cyber": [
    { id: "ai", label: "人工智慧", roles: ["AI 治理長", "模型稽核師"], assets: ["模型權重", "訓練資料"] },
    { id: "cybersecurity", label: "網路安全", roles: ["資安長", "威脅獵人"], assets: ["安全營運中心", "漏洞情報"] },
    { id: "biotech", label: "基因生技", roles: ["基因研究長", "倫理審查員"], assets: ["基因資料庫", "細胞樣本"] },
    { id: "prosthetics", label: "義體工程", roles: ["義體總工程師", "神經介面師"], assets: ["義體專利", "神經映射資料"] },
    { id: "data", label: "資料治理", roles: ["資料長", "隱私稽核員"], assets: ["城市資料湖", "資料授權"] },
    { id: "energy", label: "新型能源", roles: ["能源研究長", "微電網調度員"], assets: ["儲能網", "反應爐原型"] },
    { id: "smart-city", label: "智慧城市", roles: ["城市系統長", "感測網工程師"], assets: ["城市孿生系統", "感測網"] },
    { id: "immersive", label: "沉浸媒體", roles: ["虛擬世界總監", "體驗設計師"], assets: ["虛擬空間", "感官介面"] },
    { id: "fintech", label: "數位金融", roles: ["金融科技長", "反詐分析師"], assets: ["清算網路", "信用模型"] },
    { id: "relief", label: "科技救援", roles: ["救援指揮官", "無人機調度員"], assets: ["救援機群", "災情資料網"] },
  ],
  "deep-space-future": [
    { id: "fleet", label: "星際艦隊", roles: ["艦隊司令", "艦長"], assets: ["星艦編隊", "戰術網路"] },
    { id: "navigation", label: "深空航行", roles: ["航路總監", "領航員"], assets: ["星圖", "躍遷航標"] },
    { id: "colony", label: "殖民治理", roles: ["殖民總督", "聚落議員"], assets: ["生命維持城", "配給權"] },
    { id: "terraform", label: "行星改造", roles: ["生態工程長", "氣候技師"], assets: ["大氣處理器", "生態種庫"] },
    { id: "xenobiology", label: "外星生物", roles: ["外星生物學家", "隔離官"], assets: ["異星樣本", "隔離實驗站"] },
    { id: "mecha", label: "機甲工業", roles: ["機甲總設計師", "試飛員"], assets: ["機甲船塢", "動力核心"] },
    { id: "supply", label: "星際補給", roles: ["補給長", "貨運艦長"], assets: ["補給站網", "貨運艦隊"] },
    { id: "diplomacy", label: "星際外交", roles: ["首席使節", "文明譯解員"], assets: ["星際條約", "外交航道"] },
    { id: "communication", label: "量子通訊", roles: ["通訊總監", "訊號分析師"], assets: ["量子中繼站", "深空訊號庫"] },
    { id: "rescue", label: "深空救援", roles: ["救援艦長", "太空醫療官"], assets: ["救援艦隊", "生命維持艙"] },
  ],
  "post-apocalypse": [
    { id: "shelter", label: "避難據點", roles: ["據點管理人", "配給官"], assets: ["地下避難所", "居民名冊"] },
    { id: "medical", label: "災後醫療", roles: ["醫療站長", "防疫員"], assets: ["藥品庫", "隔離病房"] },
    { id: "supply", label: "物資配給", roles: ["物資總管", "倉庫員"], assets: ["糧食倉庫", "配給帳冊"] },
    { id: "defense", label: "聚落防衛", roles: ["防衛隊長", "哨戒員"], assets: ["防線工事", "武器庫"] },
    { id: "intelligence", label: "災情情報", roles: ["情報主管", "電台監聽員"], assets: ["短波電台", "災區地圖"] },
    { id: "agriculture", label: "生存農耕", roles: ["農務長", "種子保育員"], assets: ["溫室農場", "種子庫"] },
    { id: "engineering", label: "設施工程", roles: ["總工程師", "維修技師"], assets: ["淨水設施", "發電設備"] },
    { id: "transport", label: "廢土運輸", roles: ["車隊長", "路線偵察員"], assets: ["運輸車隊", "安全路線圖"] },
    { id: "education", label: "知識保存", roles: ["學舍主持人", "檔案保管員"], assets: ["教材庫", "技術手冊"] },
    { id: "reconstruction", label: "文明重建", roles: ["重建議長", "制度設計員"], assets: ["重建公約", "公共工坊"] },
  ],
};

const NAME_PREFIXES = [
  "青衡", "觀瀾", "玄霄", "流雲", "明德", "遠川", "拾光", "天穹", "星橋", "景曜",
  "清河", "晨曦", "瀚海", "白樺", "長鏡", "新港", "扶光", "雲汀", "北辰", "南華",
  "映川", "臨淵", "昭明", "鶴鳴", "赤霄", "滄瀾", "啟元", "墨嶺", "紫宸", "碧落",
  "錦城", "鳴沙", "海岳", "銀杉", "長風", "東序", "西陵", "霽月", "崇光", "望舒",
] as const;
const FAMILY_SURNAMES = ["謝", "唐", "林", "楚", "白", "顧", "江", "夏", "沈", "景", "容", "陸"] as const;
const FAMILY_GIVEN_NAME_FALLBACK = ["知", "衡", "寧", "昭", "遠", "清", "言", "安", "若", "承", "景", "和"] as const;

const ROLE_CATALOG: Record<StoryOrganizationArchetype, readonly string[]> = {
  sect: ["掌門", "宗主", "聖子", "聖女", "太上長老", "執法長老", "傳功長老", "峰主", "堂主", "真傳弟子", "內門弟子", "外門弟子", "丹師", "符師", "陣師"],
  family: ["家主", "族長", "族老", "少主", "繼承人", "長房主事", "房主", "嫡系子弟", "旁支子弟", "家臣", "客卿", "外姓盟親"],
  enterprise: ["董事長", "董事", "執行長", "營運長", "財務長", "事業群總經理", "部門主管", "產品經理", "專案負責人", "資深專員", "專員", "外部顧問"],
  government: ["最高決策者", "議政官", "部門首長", "幕僚長", "地方主官", "執行官", "稽核官", "文書官", "基層成員"],
  academy: ["院長", "副院長", "首席學者", "教授", "研究主持人", "講師", "研究員", "助理", "學員"],
  guild: ["盟主", "議事代表", "分會長", "資深仲介", "情報主管", "執行者", "聯絡人", "見習成員"],
};

export function familySurnameForOrganizationName(organizationName: string) {
  const normalized = organizationName.normalize("NFKC").replace(/\s+/gu, "").trim();
  const surname = /^([\p{Script=Han}]{1,2})氏/u.exec(normalized)?.[1];
  if (!surname) throw new Error("STORY_FAMILY_ORGANIZATION_SURNAME_MISSING");
  return surname;
}

function familyGivenName(originalName: string, organizationId: string, memberOffset: number) {
  const hanCharacters = Array.from(originalName.normalize("NFKC"))
    .filter((character) => /\p{Script=Han}/u.test(character));
  if (hanCharacters.length >= 2) {
    return hanCharacters.slice(-Math.min(2, hanCharacters.length - 1)).join("");
  }
  const first = FAMILY_GIVEN_NAME_FALLBACK[
    socialMatrixHash(`${organizationId}:family-given-name:${memberOffset}:first`)
      % FAMILY_GIVEN_NAME_FALLBACK.length
  ]!;
  const second = FAMILY_GIVEN_NAME_FALLBACK[
    socialMatrixHash(`${organizationId}:family-given-name:${memberOffset}:second`)
      % FAMILY_GIVEN_NAME_FALLBACK.length
  ]!;
  return `${first}${second}`;
}

function familyGenealogyDisplayName(input: {
  originalName: string;
  organizationId: string;
  organizationSurname: string;
  memberOffset: number;
  lineageRole: "bloodline" | "spouse";
}) {
  const givenName = familyGivenName(
    input.originalName,
    input.organizationId,
    input.memberOffset,
  );
  if (input.lineageRole === "bloodline") {
    return `${input.organizationSurname}${givenName}`;
  }
  const original = input.originalName.normalize("NFKC").replace(/\s+/gu, "").trim();
  if (original && !original.startsWith(input.organizationSurname)) return original;
  const externalSurnames = FAMILY_SURNAMES.filter(
    (surname) => surname !== input.organizationSurname,
  );
  const externalSurname = externalSurnames[
    socialMatrixHash(`${input.organizationId}:family-spouse-surname:${input.memberOffset}`)
      % externalSurnames.length
  ]!;
  return `${externalSurname}${givenName}`;
}

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

const CLASSIFICATION_ERAS: Record<StoryOrganizationWorldClassificationId, readonly StoryOrganizationEra[]> = {
  "contemporary-life": ["contemporary"],
  "urban-workplace": ["contemporary"],
  "school-youth": ["contemporary"],
  "mystery-justice": ["contemporary", "historical"],
  "historical-court": ["historical"],
  "wuxia-rivers": ["historical", "timeless-fantasy"],
  "cultivation-sects": ["cultivation", "timeless-fantasy"],
  "mythic-otherworld": ["timeless-fantasy"],
  "near-future-cyber": ["future"],
  "deep-space-future": ["future"],
  "post-apocalypse": ["contemporary", "future"],
};

const CLASSIFICATION_SIGNALS: readonly [StoryOrganizationWorldClassificationId, RegExp][] = [
  ["cultivation-sects", /修仙宗門|修仙|修真|仙俠|宗門|靈根|飛升|渡劫|煉丹|符籙|陣法/u],
  ["wuxia-rivers", /武俠江湖|武俠|江湖|武林|鏢局|刀客|劍客|國術/u],
  ["historical-court", /歷史宮廷|宮廷|王朝|朝廷|皇族|王侯|宅鬥|官場|絲路/u],
  ["school-youth", /校園青春|校園|學校|學生|青春|社團|校隊|學園/u],
  ["mystery-justice", /懸疑司法|懸疑|推理|司法|法庭|犯罪|刑偵|法醫|證據|案件/u],
  ["post-apocalypse", /末日災變|末日|末世|災變|倖存|避難|喪屍|文明重建/u],
  ["deep-space-future", /星際遠未來|星際|星艦|太空|行星|銀河|殖民星|機甲|外星/u],
  ["near-future-cyber", /近未來賽博|近未來|賽博|人工智慧|虛擬|基因|義體|智慧城市/u],
  ["mythic-otherworld", /神話異界|神話|異界|異世|魔法|龍族|精靈|神祇|地下城/u],
  ["urban-workplace", /都市職場|職場|企業|公司|商戰|商業|金融|創業|董事|經紀|媒體|品牌/u],
  ["contemporary-life", /當代生活|現代|都市|生活|家庭|社區|醫療|運動|藝術|旅行/u],
];

export function storyOrganizationWorldClassification(
  setting: StoryOrganizationSetting,
  organizationEra: StoryOrganizationEra = setting.era,
): StoryOrganizationWorldClassificationId {
  const detected = CLASSIFICATION_SIGNALS.find(([classificationId, pattern]) => (
    pattern.test(setting.signal)
    && CLASSIFICATION_ERAS[classificationId].includes(organizationEra)
  ))?.[0];
  if (detected) return detected;
  if (organizationEra === "cultivation") return "cultivation-sects";
  if (organizationEra === "historical") return "historical-court";
  if (organizationEra === "contemporary") return "contemporary-life";
  if (organizationEra === "future") return "near-future-cyber";
  return "mythic-otherworld";
}

function institutionKind(archetype: StoryOrganizationArchetype): SocialInstitutionKind {
  if (archetype === "sect") return "宗門";
  if (archetype === "family") return "世家聯盟";
  if (archetype === "enterprise") return "商會";
  if (archetype === "academy") return "學宮";
  return "祕密結社";
}

function organizationKindLabel(
  archetype: StoryOrganizationArchetype,
  era: StoryOrganizationEra,
  classificationId: StoryOrganizationWorldClassificationId,
) {
  if (archetype === "sect") return classificationId === "wuxia-rivers" ? "武林門派" : classificationId === "mythic-otherworld" ? "魔法／信仰組織" : "宗門";
  if (archetype === "family") return era === "future" ? "殖民家族" : era === "contemporary" ? "家族" : "世家／家族";
  if (archetype === "enterprise") return era === "historical" ? "商幫／商號" : era === "cultivation" ? "修行商會" : "企業";
  if (archetype === "government") return era === "future" ? "星區政權" : era === "historical" ? "政權／官署" : "公共機構";
  if (archetype === "academy") return era === "cultivation" ? "學宮／道院" : era === "future" ? "研究院" : "學院／研究機構";
  if (classificationId === "post-apocalypse") return "倖存者組織";
  return era === "cultivation" ? "散修盟／祕密結社" : "聯盟／協會";
}

function organizationName(input: {
  archetype: StoryOrganizationArchetype;
  era: StoryOrganizationEra;
  seed: string;
  ordinal: number;
  classificationId: StoryOrganizationWorldClassificationId;
  specialization: OrganizationSpecialization;
}) {
  // One seed-based offset plus the ordinal is collision-free for the default
  // 30-row directory because the prefix catalog is larger than the directory.
  const prefix = NAME_PREFIXES[(socialMatrixHash(`${input.seed}:organization-name-offset`) + input.ordinal) % NAME_PREFIXES.length]!;
  const surname = FAMILY_SURNAMES[(socialMatrixHash(`${input.seed}:family-name-offset`) + input.ordinal) % FAMILY_SURNAMES.length]!;
  const specialization = input.specialization.label.replace(/組織|治理|傳承/gu, "");
  if (input.archetype === "sect") {
    const suffix = input.classificationId === "wuxia-rivers" ? "門" : input.classificationId === "mythic-otherworld" ? "會" : "宗";
    return `${prefix}${specialization}${suffix}`;
  }
  if (input.archetype === "family") {
    const suffix = input.era === "future" ? "殖民家族" : input.era === "contemporary" ? "家族" : input.era === "cultivation" ? "修行世家" : "世家";
    return `${surname}氏${prefix}${specialization}${suffix}`;
  }
  if (input.archetype === "enterprise") {
    const suffix = input.era === "future" ? "聯合體" : input.era === "historical" ? "商號" : input.era === "cultivation" ? "商會" : "集團";
    return `${prefix}${specialization}${suffix}`;
  }
  if (input.archetype === "government") {
    const suffix = input.era === "future" ? "議會" : input.era === "historical" ? "署" : "協作署";
    return `${prefix}${specialization}${suffix}`;
  }
  if (input.archetype === "academy") {
    const suffix = input.era === "cultivation" ? "學宮" : input.era === "future" ? "研究院" : "學院";
    return `${prefix}${specialization}${suffix}`;
  }
  return `${prefix}${specialization}${input.era === "cultivation" ? "盟" : "聯盟"}`;
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
  return Array.from({ length: count }, (_, ordinal) => {
    const era = organizationEraFor(input.setting, ordinal);
    const worldClassificationId = storyOrganizationWorldClassification(input.setting, era);
    const order = CLASSIFICATION_ARCHETYPE_ORDER[worldClassificationId];
    const archetype = order[ordinal % order.length]!;
    const specializationPool = ORGANIZATION_SPECIALIZATIONS[worldClassificationId];
    const specialization = specializationPool[
      (socialMatrixHash(`${input.seed}:${worldClassificationId}:specialization-offset`) + ordinal)
      % specializationPool.length
    ]!;
    return {
      ordinal,
      archetype,
      worldClassificationId,
      specializationId: specialization.id,
      specializationLabel: specialization.label,
      specialistRoles: specialization.roles,
      specialistAssets: specialization.assets,
      kind: institutionKind(archetype),
      kindLabel: organizationKindLabel(archetype, era, worldClassificationId),
      name: organizationName({ archetype, era, seed: input.seed, ordinal, classificationId: worldClassificationId, specialization }),
      roles: [...new Set([...ROLE_CATALOG[archetype], ...specialization.roles])],
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

function organizationSizeLabel(capacity: number): StoryOrganizationDirectoryEntry["sizeLabel"] {
  return SIZE_TIERS.find((tier) => capacity >= tier.minimum && capacity <= tier.maximum)?.label
    ?? "巨型";
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
  specializationLabel: string;
  specialistRoles: readonly string[];
  specialistAssets: readonly string[];
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
        nodeId: id("specialization"),
        label: `${input.specializationLabel}專責峰堂`,
        kind: "branch",
        memberCapacity: boundedShare(input.capacity, 16),
        roles: [...input.specialistRoles],
        assets: [...input.specialistAssets],
      }),
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
        nodeId: id("specialization"),
        label: `${input.specializationLabel}家業`,
        kind: "branch",
        memberCapacity: boundedShare(input.capacity, 16),
        roles: [...input.specialistRoles],
        assets: [...input.specialistAssets],
      }),
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
        nodeId: id("specialization"),
        label: `${input.specializationLabel}專業事業群`,
        kind: "branch",
        memberCapacity: boundedShare(input.capacity, 22),
        roles: [...input.specialistRoles],
        assets: [...input.specialistAssets],
      }),
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
    node({
      nodeId: id("specialization"),
      label: `${input.specializationLabel}專責系統`,
      kind: "branch",
      memberCapacity: boundedShare(input.capacity, 32),
      roles: [...input.specialistRoles],
      assets: [...input.specialistAssets],
    }),
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

type StoryOrganizationWithoutRelationships = Omit<StoryOrganizationDirectoryEntry, "relationships">;

const ORGANIZATION_RELATIONSHIP_LABELS: Record<StoryOrganizationRelationshipKind, string> = {
  alliance: "公開盟約",
  rivalry: "長期競逐",
  vassalage: "附庸／子公司",
  schism: "分裂舊脈",
  "marriage-kinship": "聯姻／宗親",
  "resource-dependence": "資源依存",
  "historic-blood-debt": "歷史血債",
  "covert-cooperation": "祕密合作",
};

const DIRECTED_ORGANIZATION_RELATIONSHIPS = new Set<StoryOrganizationRelationshipKind>([
  "vassalage",
  "resource-dependence",
  "historic-blood-debt",
]);

const COMMON_ORGANIZATION_RELATIONSHIPS = [
  "alliance",
  "rivalry",
  "resource-dependence",
  "historic-blood-debt",
  "covert-cooperation",
] as const satisfies readonly StoryOrganizationRelationshipKind[];

function relationshipHistoryOpening(era: StoryOrganizationEra) {
  if (era === "cultivation") return "三代掌門以前的秘境分配中";
  if (era === "historical") return "上一輪政局與商路重整時";
  if (era === "contemporary") return "前次改制與共同專案期間";
  if (era === "future") return "上一次航道或城市系統重構時";
  return "上一紀元的疆界重訂時";
}

function relationshipTrust(kind: StoryOrganizationRelationshipKind, hash: number) {
  if (kind === "rivalry" || kind === "schism" || kind === "historic-blood-debt") return -90 + hash % 56;
  if (kind === "alliance" || kind === "marriage-kinship" || kind === "covert-cooperation") return 12 + hash % 74;
  return -20 + hash % 71;
}

function relationshipNarrative(input: {
  seed: string;
  kind: StoryOrganizationRelationshipKind;
  source: StoryOrganizationWithoutRelationships;
  target: StoryOrganizationWithoutRelationships;
}) {
  const sourceAsset = input.source.hierarchy.children
    .flatMap((node) => node.assets)
    .find(Boolean) ?? input.source.specializationLabel;
  const targetAsset = input.target.hierarchy.children
    .flatMap((node) => node.assets)
    .find(Boolean) ?? input.target.specializationLabel;
  const historyOpening = relationshipHistoryOpening(input.source.era);
  const salt = `${input.seed}:${input.kind}:${input.source.organizationId}:${input.target.organizationId}`;
  const variant = socialMatrixHash(`${salt}:narrative`) % 3;
  const narratives: Record<StoryOrganizationRelationshipKind, {
    cause: string;
    history: string;
    currentStatus: readonly string[];
    publicStance: string;
    secretMotive: string;
  }> = {
    alliance: {
      cause: `${input.source.name}需要${targetAsset}，${input.target.name}則需要${sourceAsset}，雙方以互惠盟約交換保護與通行。`,
      history: `${historyOpening}，兩方曾共同阻止一場會摧毀${input.source.territory}秩序的危機，盟約自此延續。`,
      currentStatus: ["盟約仍有效，但下一次共同決策尚未表決", "互派代表已就位，資源交付仍待驗收", "合作穩定，年輕派系正要求擴大盟約"],
      publicStance: `雙方公開稱彼此為${input.source.publicGoal}的必要盟友。`,
      secretMotive: `${input.source.name}想藉合作查明${input.target.name}如何控制${targetAsset}。`,
    },
    rivalry: {
      cause: `${input.source.name}與${input.target.name}同時爭奪${sourceAsset}與${targetAsset}的決定權。`,
      history: `${historyOpening}，一次未公開的歸屬裁決讓勝負失衡，兩方從此把制度競爭延伸到人才與聲望。`,
      currentStatus: ["競爭仍受規則約束，邊緣派系卻在試探底線", "公開較量暫停，人才與情報爭奪正在升高", "雙方同意短暫停火，但核心爭議未解"],
      publicStance: `雙方宣稱只會以公開程序競爭${sourceAsset}。`,
      secretMotive: `${input.target.name}正尋找能迫使${input.source.name}退出競逐的舊證據。`,
    },
    vassalage: {
      cause: `${input.target.name}曾以${targetAsset}換取${input.source.name}提供${sourceAsset}與制度庇護，因此形成上下級關係。`,
      history: `${historyOpening}，一份救援或併購契約把臨時依附寫成長期編制，至今仍有退出條款爭議。`,
      currentStatus: ["名義從屬仍在，自治權正重新談判", "上級要求整併資源，下級則保留否決權", "契約即將到期，雙方都在尋找替代方案"],
      publicStance: `${input.source.name}稱這是資源共享；${input.target.name}只承認有限授權。`,
      secretMotive: `${input.target.name}正在累積足以脫離${input.source.name}的獨立資源。`,
    },
    schism: {
      cause: `${input.source.name}與${input.target.name}曾共享同一套${sourceAsset}制度，後因傳承、職權或倫理界線分裂。`,
      history: `${historyOpening}，改革派帶走一部分名冊與${targetAsset}另立門戶，雙方對正統的說法完全相反。`,
      currentStatus: ["分裂已制度化，但基層仍維持私人往來", "正統爭議重新升高，舊成員被迫選邊", "雙方暫停互相否認，準備核對共同檔案"],
      publicStance: `彼此公開否認對方擁有完整的${input.source.specializationLabel}正統。`,
      secretMotive: `兩方高層都知道，只有合併各自保留的檔案才能還原分裂真相。`,
    },
    "marriage-kinship": {
      cause: `${input.source.name}與${input.target.name}以聯姻連接房系、繼承權與${sourceAsset}的共同管理。`,
      history: `${historyOpening}，兩家以一場政治婚姻終止衝突，後代同時列入兩邊祖譜。`,
      currentStatus: ["姻親盟約仍在，下一代繼承順位出現爭議", "兩家共同照護支脈，但財產界線尚未釐清", "婚盟穩定，旁支正要求取得同等代表席"],
      publicStance: `兩家公開強調親族互助，不承認聯姻涉及${targetAsset}交換。`,
      secretMotive: `其中一支後代持有能改寫兩家繼承順位的證明。`,
    },
    "resource-dependence": {
      cause: `${input.source.name}的${sourceAsset}必須依賴${input.target.name}控制的${targetAsset}才能持續運作。`,
      history: `${historyOpening}，一次供給中斷暴露單一來源風險，卻也讓雙方簽下更深的排他協議。`,
      currentStatus: ["供應正常，但替代來源仍未通過驗證", "配額縮減，雙方正重談優先順位", "依存度下降，舊契約可能提前終止"],
      publicStance: `雙方稱這是普通供應關係，否認任何一方握有否決權。`,
      secretMotive: `${input.source.name}正暗中建立替代${targetAsset}，${input.target.name}則想延長排他條款。`,
    },
    "historic-blood-debt": {
      cause: `${input.source.name}認定${input.target.name}曾為奪取${targetAsset}犧牲其成員與${sourceAsset}。`,
      history: `${historyOpening}，一場被改寫的事故留下失蹤者、受害名冊與互相矛盾的責任紀錄。`,
      currentStatus: ["追責暫緩，受害者名冊仍未公開", "新證人出現，舊停戰協議瀕臨失效", "雙方同意重查，但拒絕先承認責任"],
      publicStance: `${input.target.name}公開否認蓄意傷害，只承認程序失誤。`,
      secretMotive: `${input.source.name}內部有人想以血債為由奪取${targetAsset}，而非追求真相。`,
    },
    "covert-cooperation": {
      cause: `${input.source.name}與${input.target.name}表面立場不合，卻都需要對方的${targetAsset}處理不能公開的共同威脅。`,
      history: `${historyOpening}，兩方透過不具名中間人完成第一次交換，只有少數決策者知道完整條件。`,
      currentStatus: ["祕密管道仍暢通，但接頭人開始失聯", "合作剛完成一次交付，下一項條件更危險", "雙方互信有限，仍各自保留反制方案"],
      publicStance: `雙方公開保持距離，甚至刻意放大彼此分歧。`,
      secretMotive: `${input.target.name}想藉合作確認${input.source.name}隱藏的${sourceAsset}規模。`,
    },
  };
  const narrative = narratives[input.kind];
  return {
    cause: narrative.cause,
    history: narrative.history,
    currentStatus: narrative.currentStatus[variant]!,
    publicStance: narrative.publicStance,
    secretMotive: narrative.secretMotive,
  };
}

export function buildStoryOrganizationRelationshipNetwork(input: {
  seed: string;
  organizations: readonly StoryOrganizationWithoutRelationships[];
}): StoryOrganizationRelationship[] {
  const organizations = [...input.organizations]
    .sort((left, right) => left.institutionIndex - right.institutionIndex);
  const organizationIds = new Set(organizations.map((organization) => organization.organizationId));
  if (organizationIds.size !== organizations.length) throw new Error("STORY_ORGANIZATION_RELATIONSHIP_DUPLICATE_ORGANIZATION");
  const relationships: StoryOrganizationRelationship[] = [];
  const relationshipIds = new Set<string>();
  const add = (
    kind: StoryOrganizationRelationshipKind,
    source: StoryOrganizationWithoutRelationships,
    target: StoryOrganizationWithoutRelationships,
  ) => {
    if (source.organizationId === target.organizationId) return;
    if (source.era !== target.era) throw new Error("STORY_ORGANIZATION_RELATIONSHIP_ERA_MISMATCH");
    if (source.worldClassificationId !== target.worldClassificationId) {
      throw new Error("STORY_ORGANIZATION_RELATIONSHIP_CLASSIFICATION_MISMATCH");
    }
    const directed = DIRECTED_ORGANIZATION_RELATIONSHIPS.has(kind);
    const endpoints = directed
      ? [source.organizationId, target.organizationId]
      : [source.organizationId, target.organizationId].sort();
    const relationshipId = `organization-relationship:${socialMatrixHash(`${input.seed}:${kind}:${endpoints.join(":")}`).toString(16).padStart(8, "0")}`;
    if (relationshipIds.has(relationshipId)) return;
    relationshipIds.add(relationshipId);
    const hash = socialMatrixHash(`${relationshipId}:metrics`);
    const narrative = relationshipNarrative({ seed: input.seed, kind, source, target });
    relationships.push({
      relationshipId,
      kind,
      kindLabel: ORGANIZATION_RELATIONSHIP_LABELS[kind],
      sourceOrganizationId: source.organizationId,
      targetOrganizationId: target.organizationId,
      directed,
      worldClassificationId: source.worldClassificationId,
      era: source.era,
      ...narrative,
      intensity: 35 + hash % 66,
      trust: relationshipTrust(kind, socialMatrixHash(`${relationshipId}:trust`)),
      publiclyKnown: kind !== "covert-cooperation" && socialMatrixHash(`${relationshipId}:public`) % 5 !== 0,
      eraGate: "same-era",
      classificationGate: "same-world-classification",
    });
  };
  const groups = new Map<string, StoryOrganizationWithoutRelationships[]>();
  for (const organization of organizations) {
    const key = `${organization.era}:${organization.worldClassificationId}`;
    groups.set(key, [...(groups.get(key) ?? []), organization]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (let index = 0; index < group.length; index += 1) {
      add(
        COMMON_ORGANIZATION_RELATIONSHIPS[index % COMMON_ORGANIZATION_RELATIONSHIPS.length]!,
        group[index]!,
        group[(index + 1) % group.length]!,
      );
      add(
        COMMON_ORGANIZATION_RELATIONSHIPS[(index + 2) % COMMON_ORGANIZATION_RELATIONSHIPS.length]!,
        group[index]!,
        group[(index + Math.max(2, Math.floor(group.length / 3))) % group.length]!,
      );
    }
    const families = group.filter((organization) => organization.archetype === "family");
    if (families.length >= 2) {
      for (let index = 0; index < families.length; index += 1) {
        add("marriage-kinship", families[index]!, families[(index + 1) % families.length]!);
      }
    }
    for (const archetype of ["sect", "family", "enterprise", "government", "academy", "guild"] as const) {
      const sharedOrigin = group.filter((organization) => organization.archetype === archetype);
      if (sharedOrigin.length >= 2) add("schism", sharedOrigin[0]!, sharedOrigin.at(-1)!);
    }
    const controller = group.find((organization) => organization.archetype === "government")
      ?? group.find((organization) => organization.archetype === "enterprise")
      ?? group.find((organization) => organization.archetype === "sect");
    const dependent = group.find((organization) => (
      organization.organizationId !== controller?.organizationId
      && ["guild", "enterprise", "family", "academy"].includes(organization.archetype)
    ));
    if (controller && dependent) add("vassalage", controller, dependent);
  }
  return relationships.sort((left, right) => left.relationshipId.localeCompare(right.relationshipId, "en"));
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
  const directory: StoryOrganizationWithoutRelationships[] = input.blueprints.map((blueprint, index) => {
    const institution = input.institutions[index]!;
    // One world's 100,000-person catalog is partitioned across its directory.
    // Each directory capacity is the exact size of its non-overlapping virtual
    // bucket, so giant organizations are real rather than a label over an
    // evenly divided 3,334-person roster.
    const memberCapacity = Math.max(1, Math.min(
      institution.memberCount,
      STORY_ORGANIZATION_MEMBER_CAPACITY,
    ));
    const currentMemberCount = organizationCurrentMemberCount(
      input.seed,
      blueprint,
      memberCapacity,
    );
    const hierarchy = hierarchyFor({
      organizationId: institution.institutionId,
      name: institution.name,
      archetype: blueprint.archetype,
      specializationLabel: blueprint.specializationLabel,
      specialistRoles: blueprint.specialistRoles,
      specialistAssets: blueprint.specialistAssets,
      capacity: memberCapacity,
    });
    return {
      organizationId: institution.institutionId,
      institutionIndex: institution.institutionIndex,
      archetype: blueprint.archetype,
      worldClassificationId: blueprint.worldClassificationId,
      specializationId: blueprint.specializationId,
      specializationLabel: blueprint.specializationLabel,
      kindLabel: blueprint.kindLabel,
      name: institution.name,
      era: blueprint.era,
      eraLabel: blueprint.eraLabel,
      backgroundLabel: input.setting.backgroundLabel,
      sizeLabel: organizationSizeLabel(memberCapacity),
      memberCapacity,
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
  const network = buildStoryOrganizationRelationshipNetwork({
    seed: input.seed,
    organizations: directory,
  });
  const relationshipsByOrganization = new Map<string, StoryOrganizationRelationship[]>();
  for (const relationship of network) {
    relationshipsByOrganization.set(
      relationship.sourceOrganizationId,
      [...(relationshipsByOrganization.get(relationship.sourceOrganizationId) ?? []), relationship],
    );
    relationshipsByOrganization.set(
      relationship.targetOrganizationId,
      [...(relationshipsByOrganization.get(relationship.targetOrganizationId) ?? []), relationship],
    );
  }
  return directory.map((organization) => ({
    ...organization,
    relationships: relationshipsByOrganization.get(organization.organizationId) ?? [],
  }));
}

/**
 * Resolves exactly one organization member without enumerating the remaining
 * roster. This is the primitive used by paged directories and genealogy views
 * so a ten-thousand-person organization stays virtual until a row is opened.
 */
export function organizationMemberAtOffset(input: {
  matrix: DeterministicSocialMatrix;
  organization: StoryOrganizationDirectoryEntry;
  memberOffset: number;
}): StoryOrganizationMember {
  const memberOffset = Math.floor(input.memberOffset);
  if (
    !Number.isSafeInteger(memberOffset)
    || memberOffset < 0
    || memberOffset >= input.organization.currentMemberCount
  ) {
    throw new Error("STORY_ORGANIZATION_MEMBER_OFFSET_OUT_OF_RANGE");
  }
  const source = input.matrix.listInstitutionMembers(input.organization.institutionIndex, {
    cursor: `institution-${input.organization.institutionIndex}:${memberOffset}`,
    limit: 1,
  }).items[0];
  if (!source) throw new Error("STORY_ORGANIZATION_MEMBER_SOURCE_MISSING");
  const membership = organizationMembershipForOffset(input.organization, memberOffset);
  const genealogyPosition = input.organization.archetype === "family"
    ? familyGenealogyPositionAt({
        organizationId: input.organization.organizationId,
        memberCount: input.organization.currentMemberCount,
        memberOffset,
      })
    : null;
  const organizationSurname = genealogyPosition
    ? familySurnameForOrganizationName(input.organization.name)
    : null;
  const displayName = genealogyPosition && organizationSurname
    ? familyGenealogyDisplayName({
        originalName: source.name,
        organizationId: input.organization.organizationId,
        organizationSurname,
        memberOffset,
        lineageRole: genealogyPosition.lineageRole,
      })
    : source.name;
  const familyRole = genealogyPosition?.lineageRole === "bloodline"
    ? "本姓血親"
    : genealogyPosition?.lineageRole === "spouse"
      ? "外姓配偶（姻親入譜）"
      : source.familyRole;
  const genealogyIdentity = genealogyPosition?.lineageRole === "bloodline"
    ? `${organizationSurname}氏本姓血親・${genealogyPosition.generationLabel}・${genealogyPosition.branchLabel}`
    : genealogyPosition?.lineageRole === "spouse"
      ? `外姓配偶（姻親入譜）・${genealogyPosition.generationLabel}・${genealogyPosition.branchLabel}`
      : null;
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
    name: displayName,
    familyId: genealogyPosition ? input.organization.organizationId : source.familyId,
    familyRole,
    storyAffinity: `${input.organization.eraLabel} · ${input.organization.kindLabel}`,
    location: `${input.organization.territory} · ${organizationLocation}`,
    portrait: {
      ...source.portrait,
      description: `${input.organization.eraLabel}${input.organization.kindLabel}人物；${genealogyIdentity ? `${genealogyIdentity}；` : ""}${membership.organizationUnit}的${membership.organizationRank}，採固定原創抽象人像。`,
    },
    institutionRole: membership.organizationRank,
    identity: `${input.organization.name}的${membership.organizationRank}，${genealogyIdentity ? `${genealogyIdentity}，` : ""}隸屬${membership.organizationUnit}（${membership.organizationFaction}），目前常駐${input.organization.territory}的${organizationLocation}`,
  };
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
  const filteredOffset = page * pageSize;
  const usesWholeOrganization = !input.hierarchyNodeId
    || input.hierarchyNodeId === input.organization.hierarchy.nodeId;
  let total = input.organization.currentMemberCount;
  let pageMemberOffsets: number[];
  if (usesWholeOrganization) {
    const end = Math.min(total, filteredOffset + pageSize);
    pageMemberOffsets = filteredOffset >= total
      ? []
      : Array.from({ length: end - filteredOffset }, (_, index) => filteredOffset + index);
  } else {
    let rotatedBoundary = 0;
    const matchingIntervals = membershipQuotas(
      input.organization.hierarchy,
      input.organization.currentMemberCount,
      input.organization.organizationId,
    ).flatMap((entry) => {
      const start = rotatedBoundary;
      rotatedBoundary += entry.count;
      const path = hierarchyPath(input.organization.hierarchy, entry.leaf.nodeId);
      return path?.some((node) => node.nodeId === input.hierarchyNodeId)
        ? [{ start, count: entry.count }]
        : [];
    });
    total = matchingIntervals.reduce((sum, interval) => sum + interval.count, 0);
    const requestedEnd = Math.min(total, filteredOffset + pageSize);
    const rotation = socialMatrixHash(`${input.organization.organizationId}:member-rotation`)
      % input.organization.currentMemberCount;
    pageMemberOffsets = [];
    let matchingBoundary = 0;
    for (const interval of matchingIntervals) {
      const intervalResultStart = matchingBoundary;
      const intervalResultEnd = matchingBoundary + interval.count;
      matchingBoundary = intervalResultEnd;
      if (intervalResultEnd <= filteredOffset || intervalResultStart >= requestedEnd) continue;
      const localStart = Math.max(0, filteredOffset - intervalResultStart);
      const localEnd = Math.min(interval.count, requestedEnd - intervalResultStart);
      for (let local = localStart; local < localEnd; local += 1) {
        const rotatedOffset = interval.start + local;
        pageMemberOffsets.push((
          rotatedOffset
          - rotation
          + input.organization.currentMemberCount
        ) % input.organization.currentMemberCount);
      }
    }
  }
  const items = pageMemberOffsets.map((memberOffset) => organizationMemberAtOffset({
    matrix: input.matrix,
    organization: input.organization,
    memberOffset,
  }));
  const end = filteredOffset + items.length;
  return {
    items,
    nextCursor: end < total
      ? `organization-${input.organization.institutionIndex}:${end}`
      : null,
    total,
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
