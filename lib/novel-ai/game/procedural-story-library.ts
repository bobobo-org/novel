import type { CharacterRpgArchetype } from "../domain";

export const PROCEDURAL_STORY_LIBRARY_VERSION = "procedural-story-library-v1" as const;

export const PROCEDURAL_CHARACTER_CAPACITY = 100_000;
export const PROCEDURAL_TREASURE_CAPACITY = 100_000;
export const PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY = 1_000_000;
export const PROCEDURAL_THEORETICAL_CROSS_RELATIONSHIP_SPACE =
  PROCEDURAL_CHARACTER_CAPACITY * PROCEDURAL_TREASURE_CAPACITY;

export const PROCEDURAL_ORIGIN_POLICY =
  "original-procedural-fiction-no-real-person-or-social-account" as const;

export type ProceduralStoryContext = {
  genre?: string;
  playMode?: string;
  storyTags?: string[];
  protagonist?: string;
  location?: string;
  conflict?: string;
};

export type ProceduralPortraitIdentity = {
  baseId: string;
  assetUri: string;
  atlasCell: number;
  visualSeed: string;
  visualDescription: string;
};

export type ProceduralCharacterCandidate = {
  id: string;
  ordinal: number;
  fictional: true;
  originPolicy: typeof PROCEDURAL_ORIGIN_POLICY;
  storyProfileId: string;
  storyAffinity: string;
  rpgArchetype: Exclude<CharacterRpgArchetype, "custom">;
  name: string;
  role: string;
  personality: string;
  goal: string;
  stance: string;
  proactiveAction: string;
  refusalCondition: string;
  directDialogue: string;
  portrait: ProceduralPortraitIdentity;
};

export type ProceduralTreasureCandidate = {
  id: string;
  ordinal: number;
  fictional: true;
  originPolicy: typeof PROCEDURAL_ORIGIN_POLICY;
  storyProfileId: string;
  storyAffinity: string;
  name: string;
  category: string;
  holderRelationship: string;
  function: string;
  limitation: string;
  cost: string;
  visualSeed: string;
  visualDescription: string;
};

export type ProceduralCastRole = "catalyst" | "counterforce" | "witness";

export type ProceduralCastMember = ProceduralCharacterCandidate & {
  narrativeRole: ProceduralCastRole;
  narrativeRoleLabel: string;
  storyFunction: string;
};

export type ProceduralThreeRoleCast = {
  catalyst: ProceduralCastMember;
  counterforce: ProceduralCastMember;
  witness: ProceduralCastMember;
  members: [ProceduralCastMember, ProceduralCastMember, ProceduralCastMember];
};

export type ProceduralCausalDimensionId =
  | "trigger"
  | "desire"
  | "stance"
  | "relationship"
  | "agency"
  | "refusal"
  | "resource"
  | "constraint"
  | "price"
  | "consequence";

export type ProceduralCausalDimension = {
  id: ProceduralCausalDimensionId;
  label: string;
  inferenceQuestion: string;
  signal: string;
};

export type ProceduralCharacterTreasureScenario = {
  id: string;
  ordinal: number;
  fictional: true;
  originPolicy: typeof PROCEDURAL_ORIGIN_POLICY;
  combinationSpace: number;
  storyProfileId: string;
  cast: ProceduralThreeRoleCast;
  character: ProceduralCharacterCandidate;
  treasure: ProceduralTreasureCandidate;
  relationshipArrangement: string;
  causalDimensions: ProceduralCausalDimension[];
  storyHook: string;
};

export const PROCEDURAL_CAUSAL_DIMENSIONS = Object.freeze([
  { id: "trigger", label: "觸發事件", inferenceQuestion: "哪個事件迫使局面開始變化？" },
  { id: "desire", label: "人物欲求", inferenceQuestion: "人物真正想取得或保住什麼？" },
  { id: "stance", label: "立場衝突", inferenceQuestion: "人物願意合作到哪條界線？" },
  { id: "relationship", label: "持有關係", inferenceQuestion: "寶物的所有權、託付或債務如何連結人物？" },
  { id: "agency", label: "主動行動", inferenceQuestion: "非主角人物會先做出什麼不可忽略的行動？" },
  { id: "refusal", label: "拒絕條件", inferenceQuestion: "什麼情況會讓人物拒絕主角？" },
  { id: "resource", label: "資源作用", inferenceQuestion: "寶物能解決哪個問題，又不能替代哪個選擇？" },
  { id: "constraint", label: "使用限制", inferenceQuestion: "能力受到什麼規則、時機或知識限制？" },
  { id: "price", label: "代價交換", inferenceQuestion: "取得進展必須失去、承擔或延後什麼？" },
  { id: "consequence", label: "後果收束", inferenceQuestion: "本次選擇如何改變下一回合的局勢？" },
] satisfies ReadonlyArray<{
  id: ProceduralCausalDimensionId;
  label: string;
  inferenceQuestion: string;
}>);

type StoryProfile = {
  id: string;
  label: string;
  keywords: string[];
  roles: string[];
  actionVerbs: string[];
  locations: string[];
  portraitBaseId: string;
  portraitAssetUri: string;
  treasureCategories: string[];
};

const STORY_PROFILES: StoryProfile[] = [
  {
    id: "xianxia",
    label: "仙俠修行",
    keywords: ["仙俠", "修仙", "修行", "宗門", "靈氣", "cultivation"],
    roles: ["守契劍修", "遊方丹師", "宗門記錄官", "靈脈巡查者", "散修盟使者"],
    actionVerbs: ["先行封住失控靈脈", "私下查驗殘缺契印", "越級阻止宗門問罪", "帶走唯一證人", "公開挑戰錯誤戒律"],
    locations: ["雨夜山門", "斷脈藥谷", "浮燈城", "禁書石窟", "星井祭臺"],
    portraitBaseId: "xianxia",
    portraitAssetUri: "/character-portraits/atlas-xianxia.png",
    treasureCategories: ["靈器", "契印", "丹匣", "古卷", "陣心"],
  },
  {
    id: "romance",
    label: "戀愛養成",
    keywords: ["戀愛", "感情", "關係", "信任", "romance", "love"],
    roles: ["有自己職涯的舊識", "拒絕被安排的盟友", "帶著祕密的合作人", "守護社區的店主", "追查往事的創作者"],
    actionVerbs: ["先替自己訂下合作期限", "把未寄出的信交給第三人保管", "拒絕替主角掩飾失約", "主動約見共同證人", "暫停關係並追查真相"],
    locations: ["打烊後的書店", "雨幕車站", "舊城工作室", "河岸市集", "深夜編輯部"],
    portraitBaseId: "warm-contemporary",
    portraitAssetUri: "/character-portraits/atlas-warm-contemporary.png",
    treasureCategories: ["信物", "手稿", "錄音", "舊照", "未寄出的信"],
  },
  {
    id: "management",
    label: "經營模擬",
    keywords: ["經營", "商會", "資金", "人力", "品質", "聲望", "management", "business"],
    roles: ["風險審計師", "堅持品質的工坊主", "競爭商會談判者", "基層團隊代表", "供應鏈調度師"],
    actionVerbs: ["凍結有疑點的採購款", "召集員工提出替代方案", "搶先簽下關鍵供應商", "公開退回不合格批次", "以自己的名義擔保新計畫"],
    locations: ["停工中的工坊", "封港倉庫", "股東會前廳", "凌晨市集", "危機指揮室"],
    portraitBaseId: "modern-mystery",
    portraitAssetUri: "/character-portraits/atlas-modern-mystery.png",
    treasureCategories: ["專利樣品", "供貨憑證", "信用印章", "工藝母版", "密封帳冊"],
  },
  {
    id: "science-fiction",
    label: "科幻未來",
    keywords: ["科幻", "星艦", "太空", "未來", "人工智慧", "sci-fi", "science fiction"],
    roles: ["殖民站工程師", "記憶倫理官", "星艦航路師", "仿生權利代表", "深空救援醫官"],
    actionVerbs: ["切斷被污染的記憶網路", "改寫航路優先權", "拒絕執行未授權命令", "喚醒休眠證人", "把核心資料分散到民用節點"],
    locations: ["失重資料艙", "環城軌道站", "深空醫療艇", "記憶法庭", "廢棄殖民環"],
    portraitBaseId: "scifi",
    portraitAssetUri: "/character-portraits/atlas-scifi.png",
    treasureCategories: ["量子鑰匙", "記憶晶核", "星圖核心", "仿生協定", "休眠資料匣"],
  },
  {
    id: "mystery",
    label: "現代懸疑",
    keywords: ["懸疑", "推理", "刑偵", "祕案", "mystery", "detective"],
    roles: ["冷案調查員", "證物修復師", "匿名線人", "危機談判顧問", "追蹤資金的記者"],
    actionVerbs: ["先一步封存關鍵證物", "向另一名嫌疑人提出交易", "更改證人保護地點", "公開一段被剪接的錄音", "拒絕簽署草率結案報告"],
    locations: ["封鎖線內的舊宅", "停電檔案館", "港區證物庫", "空置新聞室", "凌晨聽證會"],
    portraitBaseId: "modern-mystery",
    portraitAssetUri: "/character-portraits/atlas-modern-mystery.png",
    treasureCategories: ["證物", "密錄", "殘頁", "暗碼鑰匙", "封存檔案"],
  },
  {
    id: "historical",
    label: "架空歷史",
    keywords: ["歷史", "王朝", "宮廷", "古代", "權謀", "historical"],
    roles: ["邊城女史", "停戰使節", "祕案司錄", "行商盟主", "不受寵的典儀官"],
    actionVerbs: ["搶在禁軍前送走密使", "當殿退回偽造詔書", "改道護送百姓名冊", "拒絕替權臣篡改紀錄", "聯絡敵方停戰派"],
    locations: ["封雪驛館", "夜禁宮門", "邊城糧倉", "河運碼頭", "舊史官宅"],
    portraitBaseId: "historical-east-asia",
    portraitAssetUri: "/character-portraits/atlas-historical-east-asia.png",
    treasureCategories: ["國印殘角", "盟約竹簡", "軍糧簿", "密詔匣", "河圖銅版"],
  },
  {
    id: "western-fantasy",
    label: "西方奇幻",
    keywords: ["奇幻", "魔法", "騎士", "精靈", "fantasy"],
    roles: ["邊境誓約騎士", "禁術檔案師", "森林盟約使", "流亡鍊金師", "自由城斥候"],
    actionVerbs: ["解除王室強加的誓約", "把禁術證據交給自由城", "封閉遭侵蝕的古門", "釋放被錯囚的守護獸", "向舊領主宣告中立"],
    locations: ["月蝕古堡", "沉鐘森林", "邊境自由城", "倒懸圖書塔", "霜火礦坑"],
    portraitBaseId: "western-fantasy",
    portraitAssetUri: "/character-portraits/atlas-western-fantasy.png",
    treasureCategories: ["誓約劍", "星砂瓶", "古門符石", "王冠碎片", "守護獸印"],
  },
  {
    id: "gothic",
    label: "哥德祕聞",
    keywords: ["哥德", "詛咒", "古堡", "靈異", "gothic", "horror"],
    roles: ["莊園檔案繼承人", "詛咒修復師", "霧都靈媒", "禁書管理員", "夜巡醫師"],
    actionVerbs: ["封死會回應名字的房門", "燒毀偽造的家族譜", "喚來被除名的見證者", "拒絕延續血脈儀式", "把詛咒轉移到無主器物"],
    locations: ["無鏡莊園", "霧鐘療養院", "地下家書庫", "退潮墓園", "永夜車站"],
    portraitBaseId: "gothic-mystery",
    portraitAssetUri: "/character-portraits/atlas-gothic-mystery.png",
    treasureCategories: ["家書匣", "無影鏡", "墓園鐘舌", "血脈戒", "封名蠟印"],
  },
  {
    id: "steampunk",
    label: "蒸汽冒險",
    keywords: ["蒸汽", "齒輪", "飛空艇", "機械", "steampunk"],
    roles: ["飛空艇艦長", "齒輪法規師", "工人盟代表", "失格發明家", "航路破譯員"],
    actionVerbs: ["關閉不安全的主動力爐", "劫走壟斷航圖的母版", "召開地下工人議會", "拆除被動過手腳的安全閥", "公布真正的事故紀錄"],
    locations: ["雲層船塢", "齒輪議會", "地下鍋爐城", "封鎖航道塔", "墜落研究站"],
    portraitBaseId: "steampunk",
    portraitAssetUri: "/character-portraits/atlas-steampunk.png",
    treasureCategories: ["航圖母版", "動力核心", "壓差鑰匙", "機械鳥", "事故黑匣"],
  },
  {
    id: "survival",
    label: "末日生存",
    keywords: ["末日", "生存", "荒地", "災變", "post-apocalypse", "survival"],
    roles: ["聚落水源官", "荒地救援醫護", "種子庫守護者", "車隊調度員", "無線電觀測者"],
    actionVerbs: ["切斷被掠奪者追蹤的訊號", "把配給表交給全體居民表決", "先行撤出病弱者", "拒絕用難民交換燃料", "開啟封存種子庫"],
    locations: ["乾涸水塔", "移動醫療車", "地下種子庫", "風暴避難站", "失聯中繼塔"],
    portraitBaseId: "post-apocalypse",
    portraitAssetUri: "/character-portraits/atlas-post-apocalypse.png",
    treasureCategories: ["淨水芯", "種子匣", "救援頻碼", "能源電池", "避難站地圖"],
  },
];

const PROFILE_RPG_ARCHETYPES: Record<string, ReadonlyArray<Exclude<CharacterRpgArchetype, "custom">>> = {
  xianxia: ["mystic", "vanguard", "strategist"],
  romance: ["diplomat", "creator", "balanced"],
  management: ["creator", "strategist", "diplomat"],
  "science-fiction": ["strategist", "creator", "vanguard"],
  mystery: ["strategist", "balanced", "diplomat"],
  historical: ["diplomat", "vanguard", "strategist"],
  "western-fantasy": ["vanguard", "mystic", "balanced"],
  gothic: ["mystic", "strategist", "diplomat"],
  steampunk: ["creator", "strategist", "vanguard"],
  survival: ["vanguard", "balanced", "strategist"],
};

function proceduralRpgArchetype(
  profileId: string,
  seed: string,
  index: number,
): Exclude<CharacterRpgArchetype, "custom"> {
  const candidates = PROFILE_RPG_ARCHETYPES[profileId] ?? ["balanced"];
  return candidates[(index + hashText(`${seed}|rpg-archetype`)) % candidates.length];
}

const NAME_FAMILIES = [
  "沈", "顧", "林", "葉", "蘇", "江", "楚", "陸", "白", "程",
  "唐", "洛", "謝", "許", "溫", "夏", "韓", "賀", "周", "凌",
  "柳", "蕭", "容", "裴", "司", "莫", "沐", "易", "喬", "景",
  "寧", "卓", "黎", "秦", "宋", "戚", "姜", "阮", "殷", "言",
] as const;

const NAME_MIDDLES = [
  "雲", "星", "月", "玄", "清", "昭", "晏", "澄", "霽", "川",
  "衡", "望", "凜", "迦", "靜", "以", "若", "安", "予", "嘉",
  "瑾", "知", "朔", "曜", "霜", "禾", "央", "遙", "棠", "瀾",
  "庭", "昕", "允", "宸", "舟", "書", "羽", "懷", "錦", "湛",
  "君", "亦", "研", "燼", "韶", "青", "令", "初", "含", "牧",
] as const;

const NAME_ENDINGS = [
  "河", "魚", "棠", "衡", "州", "然", "知", "寧", "川", "瀾",
  "書", "玥", "辰", "舟", "律", "安", "汀", "洛", "真", "凜",
  "歌", "野", "策", "昀", "霄", "夏", "雲", "竹", "白", "朔",
  "央", "序", "蘭", "霽", "絃", "瑜", "塵", "瑤", "冬", "望",
  "景", "禾", "瑾", "意", "明", "澈", "信", "遙", "蘅", "昭",
] as const;

const PERSONALITIES = [
  "審慎敏銳，會先驗證承諾再投入行動",
  "外柔內韌，擅長在衝突中保留他人的選擇",
  "直接果斷，對權力不對稱保持高度警覺",
  "幽默圓融，但不會把核心底線拿來交易",
  "沉著務實，遇到危機時會先保護最脆弱的人",
  "好奇而克制，願意承認不知道並追查證據",
  "熱情好勝，失敗後會重整策略而非遷怒同伴",
  "寡言可靠，習慣用可驗證的行動建立信任",
] as const;

const GOAL_OBJECTS = [
  "保住一份會改變弱者命運的證據",
  "修復被權力刻意切斷的公共記憶",
  "讓一項危險制度接受公開檢驗",
  "完成對失蹤同伴尚未兌現的承諾",
  "阻止資源被單一勢力永久壟斷",
  "替遭到除名的人取回選擇與尊嚴",
  "找出災難背後真正獲利的人",
  "建立不必犧牲任何人的替代方案",
] as const;

const STANCES = [
  "願意合作，但證據與決策必須共享",
  "暫時站在主角一方，同時保留獨立查證權",
  "反對主角的捷徑，卻支持其最終目標",
  "只接受可撤銷、可追溯且不傷及旁人的方案",
  "先保護第三方，再討論主角想要的結果",
  "願意承擔風險，但拒絕替任何人隱瞞代價",
] as const;

const REFUSAL_CONDITIONS = [
  "若主角要求隱瞞無辜者會承受的代價，就會立刻退出",
  "若唯一方案需要剝奪第三方的選擇權，就會拒絕執行",
  "若關鍵證據無法交叉驗證，就不會用信任替代查證",
  "若主角再次單方面更改約定，就會帶走自己的資源",
  "若行動只服務個人勝負而非原定目標，就會公開反對",
  "若有人要求以親密、恩情或身分交換服從，就會終止合作",
] as const;

const MATERIALS = [
  "霜銀", "赤晶", "青璃", "玄銅", "星砂", "月鐵", "暮金", "雲玉", "潮木", "風石",
  "曦珀", "夜瓷", "雷紋", "雪骨", "墨鋼", "霞絹", "雨晶", "焰玻", "森銀", "海銅",
  "空玉", "夢砂", "影鐵", "光木", "靈石", "琥金", "苔瓷", "鯨骨", "鏡鋼", "藤絹",
  "虹晶", "煙玻", "葉銀", "泉銅", "霧玉", "沙木", "辰石", "燼珀", "露瓷", "翼骨",
] as const;

const TREASURE_CORES = [
  "守契", "回聲", "照影", "定潮", "引星", "藏火", "辨真", "續脈", "封風", "渡夜",
  "記名", "尋路", "止戰", "護心", "解鎖", "承光", "問夢", "量時", "換位", "留聲",
  "斷誓", "聚霧", "醒神", "追因", "避險", "分流", "存憶", "映月", "平衡", "開門",
  "補缺", "傳信", "定界", "復原", "辨謊", "藏形", "增幅", "轉壓", "校準", "護證",
  "還願", "示警", "收束", "延息", "共鳴", "解結", "測運", "止蝕", "歸航", "守望",
] as const;

const TREASURE_FORMS = [
  "印", "鏡", "匣", "卷", "燈", "針", "環", "鈴", "尺", "簪",
  "盤", "符", "鑰", "筆", "珠", "冠", "帶", "梭", "瓶", "鐘",
  "扇", "鎖", "牌", "輪", "舟", "羽", "石", "笛", "刃", "簡",
  "盒", "冊", "鍊", "釦", "錨", "徽", "盞", "杖", "弦", "斗",
  "籤", "門", "橋", "爐", "塔", "甲", "盾", "梭儀", "羅盤", "星盤",
] as const;

const HOLDER_RELATIONSHIPS = [
  "由人物代替失蹤者保管，只有完成遺願才能轉交",
  "名義上屬於敵對勢力，實際控制權掌握在人物手中",
  "人物只是暫時受託者，主角無權直接取用",
  "寶物由共同契約持有，任何一方都不能單獨啟動",
  "人物曾因寶物受害，因此擁有最終否決權",
  "所有權存在爭議，真正繼承人尚未公開身分",
  "寶物是人物欠下的人情債，使用一次就會改變盟友關係",
  "人物主動把寶物設為誘餌，意圖逼出幕後持有人",
] as const;

const TREASURE_FUNCTIONS = [
  "揭露一次被竄改的因果順序，但不替任何人判定動機",
  "保存即將消失的證詞，並標出其中互相矛盾的片段",
  "短暫連結兩處封閉空間，讓人員或訊息完成一次轉移",
  "把不可見的資源消耗轉成可核對的刻度",
  "定位與持有人承諾相衝突的行動痕跡",
  "替瀕臨失效的設施爭取一段短暫的修復時間",
  "將分散線索依時間重排，顯示仍缺少的關鍵節點",
  "封存一次危險能力，直到三方同意後才能解除",
] as const;

const TREASURE_LIMITATIONS = [
  "同一事件只能啟用一次，且無法讀取人的內心",
  "必須由兩名立場不同的人共同校準，否則結果會偏斜",
  "只能處理已經留下證據的變化，不能預言未發生的事",
  "啟動後會公開持有者位置，因此不能在追捕中反覆使用",
  "效果只能維持到眼前事件結束，之後仍需人物親自作出選擇",
  "不能創造資源，只能重新分配現有時間、資訊或風險",
] as const;

const TREASURE_COSTS = [
  "持有者必須公開一項曾刻意隱瞞的失敗",
  "使用後會失去一次安全撤退的機會",
  "會消耗目前最稀缺的修復材料",
  "接下來的期限會提前，迫使團隊重新排序目標",
  "一名盟友將取得對後續使用的否決權",
  "寶物會留下可被敵方追蹤的短暫痕跡",
] as const;

const RELATIONSHIP_ARRANGEMENTS = [
  "互相需要卻沒有互相信任：人物掌握啟動方式，主角握有缺失線索",
  "三方託付：人物保管寶物，第三方擁有所有權，主角只能協調",
  "利益對立：人物想公開寶物，主角需要暫時保密，敵方正在逼近",
  "舊債新盟：寶物證明人物曾被主角陣營傷害，合作必須先處理舊債",
  "交換失衡：人物願意出借寶物，卻要求主角放棄最快的勝利路線",
  "真假繼承：兩名候選持有人各有一半證據，人物拒絕替主角選邊",
  "倒置救援：寶物能救目標，人物卻先用它保護遭忽略的旁觀者",
  "限時共管：人物與主角各持一把鑰匙，期限到後寶物將自動封存",
] as const;

const CONSEQUENCES = [
  "接下來會出現一名新的知情者，也讓原有盟友產生立場分裂",
  "局勢取得可見進展，但安全退路被縮短，不能再原地等待",
  "寶物控制權暫時轉移，迫使主角改用談判而非直接奪取",
  "真相被證實一半，另一半落到對手手中，形成新的追逐目標",
  "人物關係不會立刻改善，但共同承擔的代價建立了可驗證信任",
  "危機暫時解除，卻留下必須在三個重要節點內兌現的公開承諾",
] as const;

const CAST_ROLE_CONTRACTS = {
  catalyst: {
    label: "觸發者",
    functions: [
      "先採取不可忽略的行動，把靜止局面推進成必須處理的事件",
      "帶著自己的目標進場，讓主角無法只在原地盤算",
      "握有第一段關鍵資訊，卻要求先處理被忽視的代價",
    ],
    actionFrames: [
      { opening: "沒有等待指示", ending: "使靜止局面成為所有人必須回應的事件" },
      { opening: "帶著自己的目標先行", ending: "迫使主角在盤算前先回答這個人的目標" },
      { opening: "握住第一段關鍵資訊後搶先表態", ending: "把被忽視的代價擺到眾人眼前" },
    ],
  },
  counterforce: {
    label: "反作用者",
    functions: [
      "提出與主角不同的解法，並有能力阻止最容易的捷徑",
      "保護另一群人的利益，使每項收益都必須面對真實取捨",
      "查驗觸發者的說法，避免故事把合作誤寫成無條件服從",
    ],
    actionFrames: [
      { opening: "先攔住最省事的捷徑", ending: "讓不同解法有機會阻止最容易的路" },
      { opening: "為另一群人的利益擋在前面", ending: "迫使每項收益都面對真實取捨" },
      { opening: "要求所有說法先接受查驗", ending: "不讓合作被誤寫成無條件服從" },
    ],
  },
  witness: {
    label: "見證／變局者",
    functions: [
      "保存行動後果並在下一回合追究承諾，防止事件原地重置",
      "從第三方角度揭露兩邊都沒看見的資訊，改變關係排列",
      "握有後續入口或撤退路線，會依本回合結果決定是否開放",
    ],
    actionFrames: [
      { opening: "先把行動後果逐項記下", ending: "留下之後能追究承諾的紀錄" },
      { opening: "從第三方位置交叉核對兩邊說法", ending: "揭露兩邊都沒看見的資訊" },
      { opening: "握住後續入口與退路，暫不承諾開放", ending: "把是否開放交給這次行動的後果決定" },
    ],
  },
} as const;

const COPRIME_MULTIPLIERS = [7_919, 9_973, 13_337, 65_537, 83_021] as const;

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function requireOrdinal(ordinal: number, capacity: number, label: string) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= capacity) {
    throw new RangeError(`${label}_ORDINAL_OUT_OF_RANGE:${ordinal}`);
  }
}

function permuteOrdinal(seed: string, ordinal: number, capacity: number, salt: string) {
  const seedHash = hashText(`${PROCEDURAL_STORY_LIBRARY_VERSION}|${salt}|${seed}`);
  const multiplier = COPRIME_MULTIPLIERS[seedHash % COPRIME_MULTIPLIERS.length];
  const offset = hashText(`${salt}|offset|${seed}`) % capacity;
  return (ordinal * multiplier + offset) % capacity;
}

function seedToken(seed: string) {
  return hashText(seed).toString(36).padStart(7, "0");
}

function contextText(context?: ProceduralStoryContext) {
  if (!context) return "";
  return [
    context.genre,
    context.playMode,
    ...(context.storyTags ?? []),
    context.conflict,
  ].filter(Boolean).join(" ").toLocaleLowerCase("zh-TW");
}

function resolveStoryProfile(seed: string, context?: ProceduralStoryContext) {
  const text = contextText(context);
  if (text) {
    const matched = STORY_PROFILES.find((profile) =>
      profile.keywords.some((keyword) => text.includes(keyword.toLocaleLowerCase("zh-TW"))));
    if (matched) return matched;
  }
  return STORY_PROFILES[hashText(`${seed}|profile`) % STORY_PROFILES.length];
}

function decodeCharacterName(index: number) {
  const endingIndex = index % NAME_ENDINGS.length;
  const middleIndex = Math.floor(index / NAME_ENDINGS.length) % NAME_MIDDLES.length;
  const familyIndex = Math.floor(index / (NAME_ENDINGS.length * NAME_MIDDLES.length)) % NAME_FAMILIES.length;
  return `${NAME_FAMILIES[familyIndex]}${NAME_MIDDLES[middleIndex]}${NAME_ENDINGS[endingIndex]}`;
}

function decodeTreasureName(index: number) {
  const formIndex = index % TREASURE_FORMS.length;
  const coreIndex = Math.floor(index / TREASURE_FORMS.length) % TREASURE_CORES.length;
  const materialIndex = Math.floor(index / (TREASURE_FORMS.length * TREASURE_CORES.length)) % MATERIALS.length;
  return `${MATERIALS[materialIndex]}${TREASURE_CORES[coreIndex]}${TREASURE_FORMS[formIndex]}`;
}

export function proceduralCharacterAt(input: {
  seed: string;
  ordinal: number;
  context?: ProceduralStoryContext;
}): ProceduralCharacterCandidate {
  requireOrdinal(input.ordinal, PROCEDURAL_CHARACTER_CAPACITY, "CHARACTER");
  const index = permuteOrdinal(input.seed, input.ordinal, PROCEDURAL_CHARACTER_CAPACITY, "character");
  const profile = resolveStoryProfile(input.seed, input.context);
  const name = decodeCharacterName(index);
  const role = profile.roles[(index + hashText(input.seed)) % profile.roles.length];
  const goal = GOAL_OBJECTS[Math.floor(index / 7) % GOAL_OBJECTS.length];
  const stance = STANCES[Math.floor(index / 11) % STANCES.length];
  const action = profile.actionVerbs[Math.floor(index / 13) % profile.actionVerbs.length];
  const refusalCondition = REFUSAL_CONDITIONS[Math.floor(index / 17) % REFUSAL_CONDITIONS.length];
  const location = input.context?.location?.trim()
    || profile.locations[Math.floor(index / 19) % profile.locations.length];
  const visualSeed = `portrait-${seedToken(input.seed)}-${index.toString(36).padStart(4, "0")}`;

  return {
    id: `character-${seedToken(input.seed)}-${input.ordinal.toString(36).padStart(4, "0")}`,
    ordinal: input.ordinal,
    fictional: true,
    originPolicy: PROCEDURAL_ORIGIN_POLICY,
    storyProfileId: profile.id,
    storyAffinity: profile.label,
    rpgArchetype: proceduralRpgArchetype(profile.id, input.seed, index),
    name,
    role,
    personality: PERSONALITIES[Math.floor(index / 5) % PERSONALITIES.length],
    goal,
    stance,
    proactiveAction: `${name}先一步在${location}${action}，讓所有人不得不面對局面已經改變。`,
    refusalCondition,
    directDialogue: `「我可以和你同行，但不是照單全收。」${name}直視主角，「先處理${goal}，否則我不會交出自己的選擇。」`,
    portrait: {
      baseId: profile.portraitBaseId,
      assetUri: profile.portraitAssetUri,
      atlasCell: index % 11,
      visualSeed,
      visualDescription: `${profile.label}風格的原創成年${role}半身肖像；以${visualSeed}固定髮型、衣著層次、神情與配色，不對應任何真實人物。`,
    },
  };
}

export function proceduralTreasureAt(input: {
  seed: string;
  ordinal: number;
  context?: ProceduralStoryContext;
}): ProceduralTreasureCandidate {
  requireOrdinal(input.ordinal, PROCEDURAL_TREASURE_CAPACITY, "TREASURE");
  const index = permuteOrdinal(input.seed, input.ordinal, PROCEDURAL_TREASURE_CAPACITY, "treasure");
  const profile = resolveStoryProfile(input.seed, input.context);
  const name = decodeTreasureName(index);
  const category = profile.treasureCategories[(index + hashText(`${input.seed}|category`)) % profile.treasureCategories.length];
  const visualSeed = `treasure-${seedToken(input.seed)}-${index.toString(36).padStart(4, "0")}`;

  return {
    id: `treasure-${seedToken(input.seed)}-${input.ordinal.toString(36).padStart(4, "0")}`,
    ordinal: input.ordinal,
    fictional: true,
    originPolicy: PROCEDURAL_ORIGIN_POLICY,
    storyProfileId: profile.id,
    storyAffinity: profile.label,
    name,
    category,
    holderRelationship: HOLDER_RELATIONSHIPS[Math.floor(index / 3) % HOLDER_RELATIONSHIPS.length],
    function: TREASURE_FUNCTIONS[Math.floor(index / 7) % TREASURE_FUNCTIONS.length],
    limitation: TREASURE_LIMITATIONS[Math.floor(index / 11) % TREASURE_LIMITATIONS.length],
    cost: TREASURE_COSTS[Math.floor(index / 13) % TREASURE_COSTS.length],
    visualSeed,
    visualDescription: `${profile.label}的原創${category}「${name}」；以${visualSeed}固定材質、磨損、封印紋與辨識輪廓，不重製現實文物或既有作品道具。`,
  };
}

function asCastMember(
  character: ProceduralCharacterCandidate,
  narrativeRole: ProceduralCastRole,
  variant: number,
): ProceduralCastMember {
  const contract = CAST_ROLE_CONTRACTS[narrativeRole];
  const contractIndex = variant % contract.functions.length;
  const actionFrame = contract.actionFrames[contractIndex];
  const generatedPrefix = `${character.name}先一步`;
  const generatedSuffix = "，讓所有人不得不面對局面已經改變。";
  let contextualMove = character.proactiveAction.startsWith(generatedPrefix)
    ? character.proactiveAction.slice(generatedPrefix.length)
    : "在目前場景採取與自己目標一致的行動";
  if (contextualMove.endsWith(generatedSuffix)) {
    contextualMove = contextualMove.slice(0, -generatedSuffix.length);
  }
  return {
    ...character,
    narrativeRole,
    narrativeRoleLabel: contract.label,
    storyFunction: contract.functions[contractIndex],
    proactiveAction: `${character.name}${actionFrame.opening}，${contextualMove}，${actionFrame.ending}。`,
  };
}

export function proceduralThreeRoleCastAt(input: {
  seed: string;
  ordinal: number;
  context?: ProceduralStoryContext;
}): ProceduralThreeRoleCast {
  requireOrdinal(input.ordinal, PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY, "CAST");
  const castIndex = permuteOrdinal(
    input.seed,
    input.ordinal,
    PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
    "cast",
  );
  const baseOrdinal = castIndex % PROCEDURAL_CHARACTER_CAPACITY;
  const band = Math.floor(castIndex / PROCEDURAL_CHARACTER_CAPACITY);
  const ordinals = [
    baseOrdinal,
    (baseOrdinal + 33_331 + band * 101) % PROCEDURAL_CHARACTER_CAPACITY,
    (baseOrdinal + 66_661 + band * 211) % PROCEDURAL_CHARACTER_CAPACITY,
  ] as const;
  const characters = ordinals.map((ordinal) => proceduralCharacterAt({
    seed: `${input.seed}|ensemble`,
    ordinal,
    context: input.context,
  }));
  const catalyst = asCastMember(characters[0], "catalyst", castIndex);
  const counterforce = asCastMember(characters[1], "counterforce", Math.floor(castIndex / 7));
  const witness = asCastMember(characters[2], "witness", Math.floor(castIndex / 13));
  return {
    catalyst,
    counterforce,
    witness,
    members: [catalyst, counterforce, witness],
  };
}

export function proceduralCharacterTreasureScenarioAt(input: {
  seed: string;
  ordinal: number;
  context?: ProceduralStoryContext;
}): ProceduralCharacterTreasureScenario {
  requireOrdinal(input.ordinal, PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY, "RELATIONSHIP_SCENARIO");
  const scenarioIndex = permuteOrdinal(
    input.seed,
    input.ordinal,
    PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
    "relationship",
  );
  const characterBase = scenarioIndex % PROCEDURAL_CHARACTER_CAPACITY;
  const relationshipBand = Math.floor(scenarioIndex / PROCEDURAL_CHARACTER_CAPACITY);
  const treasureOrdinal = (
    characterBase * 37
    + relationshipBand * 7_919
    + hashText(`${input.seed}|prop`)
  ) % PROCEDURAL_TREASURE_CAPACITY;
  const cast = proceduralThreeRoleCastAt({
    seed: `${input.seed}|cast`,
    ordinal: scenarioIndex,
    context: input.context,
  });
  const character = cast.catalyst;
  const treasure = proceduralTreasureAt({
    seed: `${input.seed}|prop`,
    ordinal: treasureOrdinal,
    context: input.context,
  });
  const arrangement = RELATIONSHIP_ARRANGEMENTS[
    (scenarioIndex + hashText(`${input.seed}|arrangement`)) % RELATIONSHIP_ARRANGEMENTS.length
  ];
  const consequence = CONSEQUENCES[
    (Math.floor(scenarioIndex / 23) + hashText(`${input.seed}|consequence`)) % CONSEQUENCES.length
  ];
  const triggerLocation = input.context?.location?.trim()
    || STORY_PROFILES.find((profile) => profile.id === character.storyProfileId)?.locations[scenarioIndex % 5]
    || "局勢交界處";
  const trigger = `${treasure.name}在${triggerLocation}被迫現身，原本隱藏的持有關係立刻成為衝突核心。`;
  const dimensions: ProceduralCausalDimension[] = [
    { ...PROCEDURAL_CAUSAL_DIMENSIONS[0], signal: trigger },
    { ...PROCEDURAL_CAUSAL_DIMENSIONS[1], signal: character.goal },
    { ...PROCEDURAL_CAUSAL_DIMENSIONS[2], signal: `${character.stance}；${cast.counterforce.name}則${cast.counterforce.stance}` },
    { ...PROCEDURAL_CAUSAL_DIMENSIONS[3], signal: treasure.holderRelationship },
    { ...PROCEDURAL_CAUSAL_DIMENSIONS[4], signal: `${character.proactiveAction}${cast.counterforce.name}同時${cast.counterforce.proactiveAction.replace(`${cast.counterforce.name}`, "")}` },
    { ...PROCEDURAL_CAUSAL_DIMENSIONS[5], signal: `${character.refusalCondition}；${cast.counterforce.refusalCondition}` },
    { ...PROCEDURAL_CAUSAL_DIMENSIONS[6], signal: treasure.function },
    { ...PROCEDURAL_CAUSAL_DIMENSIONS[7], signal: treasure.limitation },
    { ...PROCEDURAL_CAUSAL_DIMENSIONS[8], signal: treasure.cost },
    { ...PROCEDURAL_CAUSAL_DIMENSIONS[9], signal: `${consequence}${cast.witness.name}會${cast.witness.storyFunction}` },
  ];

  return {
    id: `scenario-${seedToken(input.seed)}-${input.ordinal.toString(36).padStart(4, "0")}`,
    ordinal: input.ordinal,
    fictional: true,
    originPolicy: PROCEDURAL_ORIGIN_POLICY,
    combinationSpace: PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
    storyProfileId: character.storyProfileId,
    cast,
    character,
    treasure,
    relationshipArrangement: arrangement,
    causalDimensions: dimensions,
    storyHook: `${trigger}${character.name}${character.proactiveAction.replace(`${character.name}`, "")}然而，${arrangement}。${character.directDialogue}${cast.counterforce.name}沒有附和，而是${cast.counterforce.storyFunction}；${cast.witness.name}則${cast.witness.storyFunction}。`,
  };
}

export function proceduralStoryLibraryCapacity() {
  return {
    characters: PROCEDURAL_CHARACTER_CAPACITY,
    treasures: PROCEDURAL_TREASURE_CAPACITY,
    relationshipScenarios: PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
    theoreticalCharacterTreasurePairs: PROCEDURAL_THEORETICAL_CROSS_RELATIONSHIP_SPACE,
    causalDimensions: PROCEDURAL_CAUSAL_DIMENSIONS.length,
  } as const;
}
