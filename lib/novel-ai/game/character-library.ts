import type { CharacterRpgArchetype } from "../domain";

export const RPG_CHARACTER_LIBRARY_SCHEMA = "novel-rpg-character-library-v1" as const;
export const RPG_CHARACTER_LIBRARY_STORAGE_KEY = "novel:rpg-character-library:v1";

export type RpgCharacterTemplate = {
  schemaVersion: typeof RPG_CHARACTER_LIBRARY_SCHEMA;
  templateId: string;
  name: string;
  archetype: string;
  identity: string;
  personality: string;
  goal: string;
  fears: string[];
  values: string[];
  capabilities: string[];
  limitations: string[];
  gender?: "woman" | "man" | "nonbinary";
  age?: number;
  matureTheme?: boolean;
  rpgArchetype?: CharacterRpgArchetype;
  relationshipHooks?: string[];
  boundaries?: string[];
  createdAt: string;
  builtin: boolean;
};

const BASE_BUILTIN_RPG_CHARACTERS: RpgCharacterTemplate[] = [
  {
    schemaVersion: RPG_CHARACTER_LIBRARY_SCHEMA,
    templateId: "builtin-starfire-swordswoman",
    name: "燼星",
    archetype: "背負代價的劍士",
    identity: "失去故鄉、仍守護陌生人的流浪劍士",
    personality: "冷靜寡言，遇到弱者受傷時會不計代價出手",
    goal: "查明故鄉毀滅的真相，並阻止同樣的悲劇重演",
    fears: ["再次失去同伴", "自己的力量失控"],
    values: ["承諾", "保護", "真相"],
    capabilities: ["近身戰鬥", "危機判斷", "承受壓力"],
    limitations: ["不擅長求助", "容易獨自承擔代價"],
    createdAt: "2026-01-01T00:00:00.000Z",
    builtin: true,
  },
  {
    schemaVersion: RPG_CHARACTER_LIBRARY_SCHEMA,
    templateId: "builtin-forbidden-scholar",
    name: "墨衡",
    archetype: "禁書學者",
    identity: "能讀懂被抹除歷史、卻被各方追捕的研究者",
    personality: "說話精準克制，對未知充滿近乎危險的好奇",
    goal: "重建被改寫的世界歷史",
    fears: ["記憶遭到竄改", "知識害死無辜者"],
    values: ["證據", "自由意志", "知識責任"],
    capabilities: ["古文解析", "推理", "法則研究"],
    limitations: ["體力薄弱", "不容易信任直覺"],
    createdAt: "2026-01-01T00:00:00.000Z",
    builtin: true,
  },
  {
    schemaVersion: RPG_CHARACTER_LIBRARY_SCHEMA,
    templateId: "builtin-many-faced-broker",
    name: "千面",
    archetype: "情報商與關係操盤者",
    identity: "在敵對勢力之間販售消息、從不交出全部真相的中間人",
    personality: "幽默圓滑，總能看見每個人不願承認的需求",
    goal: "建立一個任何權力都無法壟斷的情報網",
    fears: ["真正的身分被看穿", "欠下無法償還的人情"],
    values: ["選擇", "交換", "生存"],
    capabilities: ["談判", "偽裝", "人脈經營"],
    limitations: ["承諾可信度低", "習慣隱瞞造成誤會"],
    createdAt: "2026-01-01T00:00:00.000Z",
    builtin: true,
  },
];

function matureCharacter(input: Omit<RpgCharacterTemplate, "schemaVersion" | "createdAt" | "builtin" | "matureTheme">): RpgCharacterTemplate {
  if (!Number.isInteger(input.age) || Number(input.age) < 21) throw new Error("MATURE_CHARACTER_AGE_INVALID");
  return {
    ...input,
    schemaVersion: RPG_CHARACTER_LIBRARY_SCHEMA,
    matureTheme: true,
    createdAt: "2026-08-02T00:00:00.000Z",
    builtin: true,
  };
}

export const BUILTIN_MATURE_RPG_CHARACTERS: RpgCharacterTemplate[] = [
  matureCharacter({ templateId: "mature-woman-shen-zhaotang", name: "沈照棠", gender: "woman", age: 29, archetype: "冷面女史與祕案調查者", identity: "架空王朝的女史，負責追查宮廷檔案與失蹤密信", personality: "克制敏銳，重視證據，只有在確定安全時才展露幽默", goal: "查清一樁牽連家族與朝局的舊案", fears: ["被權力迫使背叛真相", "親密關係成為弱點"], values: ["真相", "自主", "守信"], capabilities: ["古籍判讀", "推理", "談判"], limitations: ["不易求助", "過度壓抑情緒"], rpgArchetype: "strategist", relationshipHooks: ["與被調查者互相試探", "舊日盟友掌握關鍵證據"], boundaries: ["拒絕權力脅迫", "重要關係必須坦白風險"] }),
  matureCharacter({ templateId: "mature-woman-elara-voss", name: "Elara Voss", gender: "woman", age: 34, archetype: "星艦外交官", identity: "跨星系停火談判團的首席協調者", personality: "從容果斷，擅長聽出弦外之音，私下害怕失控", goal: "阻止兩個殖民地因資源爭端開戰", fears: ["談判破裂造成平民傷亡", "被視為只會操控人心"], values: ["和平", "透明", "平等"], capabilities: ["外交", "語言", "危機管理"], limitations: ["長期失眠", "難以承認私人需求"], rpgArchetype: "diplomat", relationshipHooks: ["敵方代表是昔日戀人", "護衛質疑她的妥協底線"], boundaries: ["不以感情交換政治利益", "尊重雙方明確同意"] }),
  matureCharacter({ templateId: "mature-woman-ye-hanzhang", name: "葉含章", gender: "woman", age: 27, archetype: "詞畫雙絕的旅居畫師", identity: "以山水與題跋記錄亂世人情的宋風畫師", personality: "外柔內韌，觀察細膩，習慣以意象代替直說", goal: "完成一卷能保存故鄉記憶的長圖", fears: ["作品被權貴據為己有", "真心被誤讀"], values: ["美感", "記憶", "自由"], capabilities: ["詩詞", "繪畫", "人物觀察"], limitations: ["迴避正面衝突", "容易把情緒藏進作品"], rpgArchetype: "creator", relationshipHooks: ["贊助者要求她改畫歷史", "同行既競爭又理解她"], boundaries: ["作品署名不可被奪走", "感情不取代創作自主"] }),
  matureCharacter({ templateId: "mature-woman-amina-al-rashid", name: "Amina al-Rashid", gender: "woman", age: 32, archetype: "商路天文學者", identity: "沿古代商路測星、製圖並保護旅隊的學者", personality: "理性溫暖，對陌生文化充滿尊重，遇危險時異常鎮定", goal: "修正一張會讓旅人走向禁區的錯誤星圖", fears: ["知識被軍事利用", "失去選擇去向的自由"], values: ["求知", "款待", "責任"], capabilities: ["天文", "導航", "多語溝通"], limitations: ["低估自己的疲憊", "不善處理嫉妒"], rpgArchetype: "strategist", relationshipHooks: ["競爭製圖師握有缺失頁", "旅隊領袖想讓她留下"], boundaries: ["知識不得用來傷害平民", "伴侶需尊重彼此旅程"] }),
  matureCharacter({ templateId: "mature-woman-asagiri-rin", name: "朝霧凜", gender: "woman", age: 30, archetype: "危機談判顧問", identity: "現代都市中協助企業與家庭處理高壓衝突的顧問", personality: "語氣冷靜、同理心強，討厭情緒勒索", goal: "揭露一場被包裝成意外的組織霸凌", fears: ["再次錯判求救訊號", "工作侵蝕私人生活"], values: ["尊重", "界線", "誠實"], capabilities: ["談判", "心理觀察", "風險評估"], limitations: ["控制慾偏高", "難以接受別人照顧"], rpgArchetype: "diplomat", relationshipHooks: ["委託人隱瞞關鍵動機", "老朋友站在對立組織"], boundaries: ["拒絕情緒操控", "工作與私人關係須分離"] }),
  matureCharacter({ templateId: "mature-woman-isolde-maren", name: "Isolde Maren", gender: "woman", age: 38, archetype: "哥德莊園檔案繼承人", identity: "繼承古老莊園與一屋未分類家書的歷史學者", personality: "優雅尖銳，重視隱私，對脆弱事物有強烈保護欲", goal: "找出家族傳說背後被刻意抹去的人", fears: ["成為家族控制的延續", "真相摧毀僅存親情"], values: ["記錄", "尊嚴", "選擇"], capabilities: ["檔案學", "社交禮儀", "資源管理"], limitations: ["戒心重", "容易以沉默懲罰自己"], rpgArchetype: "diplomat", relationshipHooks: ["修復師讀懂家書暗碼", "管家知道她童年記憶的缺口"], boundaries: ["私人書信不得公開羞辱他人", "關係需要互相保留空間"] }),
  matureCharacter({ templateId: "mature-woman-su-jialan", name: "蘇迦藍", gender: "woman", age: 26, archetype: "遊方丹師", identity: "拒絕宗門壟斷、替偏遠聚落治病的丹師", personality: "機敏好勝，嘴硬心軟，對藥理與人情都極有耐性", goal: "研製不需稀有靈根也能使用的救命丹方", fears: ["丹藥副作用傷人", "被宗門重新控制"], values: ["醫者責任", "公平", "實證"], capabilities: ["煉丹", "診斷", "野外生存"], limitations: ["不信任權威", "會為證明自己冒險"], rpgArchetype: "mystic", relationshipHooks: ["護送者曾是追捕她的人", "競爭丹師提出合作"], boundaries: ["不得未告知試藥風險", "不以救命之恩交換感情"] }),
  matureCharacter({ templateId: "mature-woman-camila-reyes", name: "Camila Reyes", gender: "woman", age: 35, archetype: "調查記者", identity: "追查跨國文化資產走私網的記者", personality: "直接熱情，對弱者溫柔，面對權勢毫不退讓", goal: "完成能保護消息來源又揭露交易鏈的報導", fears: ["消息來源被報復", "自己只剩下工作身分"], values: ["公共利益", "勇氣", "忠誠"], capabilities: ["採訪", "查證", "臨場應變"], limitations: ["衝動", "不願撤退"], rpgArchetype: "vanguard", relationshipHooks: ["攝影搭檔反對她的風險選擇", "走私網顧問試圖提供內幕"], boundaries: ["保護消息來源", "拒絕用親密換取資訊"] }),
  matureCharacter({ templateId: "mature-woman-nkiru-okafor", name: "Nkiru Okafor", gender: "woman", age: 31, archetype: "記憶城市工程師", identity: "在未來都市維護公共記憶網路的系統工程師", personality: "沉著務實，創意奔放，會用乾幽默化解壓力", goal: "阻止企業刪除一整個社區的集體記憶", fears: ["自己的記憶也被改寫", "技術讓人失去真實關係"], values: ["共同體", "可驗證性", "創造"], capabilities: ["系統工程", "密碼學", "城市設計"], limitations: ["工作成癮", "不擅長含糊暗示"], rpgArchetype: "creator", relationshipHooks: ["前搭檔替企業工作", "社區領袖不信任科技"], boundaries: ["記憶資料需明確同意", "不以監控維持關係"] }),
  matureCharacter({ templateId: "mature-woman-lin-wanqing", name: "林晚晴", gender: "woman", age: 41, archetype: "資深出版編輯", identity: "擅長挽救失控長篇、也在重新整理自己人生的編輯", personality: "成熟幽默，判斷犀利，對人的矛盾比對文字更有耐心", goal: "完成一套不犧牲作者聲音的長篇出版計畫", fears: ["把照顧別人當成逃避自己", "再次失去創作熱情"], values: ["誠實", "工藝", "互相成就"], capabilities: ["敘事診斷", "專案管理", "溝通"], limitations: ["習慣過度負責", "不容易示弱"], rpgArchetype: "diplomat", relationshipHooks: ["新作者挑戰她的編輯信念", "舊伴侶成為競爭出版社負責人"], boundaries: ["工作評價不等於人格評價", "關係須尊重彼此職涯"] }),
  matureCharacter({ templateId: "mature-man-gu-changyuan", name: "顧長淵", gender: "man", age: 36, archetype: "停戰將軍", identity: "架空王朝中主張停戰、被迫進入朝堂談判的將領", personality: "沉穩寡言，責任感強，對權力保持戒心", goal: "讓邊境居民免於下一場無意義的戰爭", fears: ["和平只是下一次背叛的間歇", "親近之人因他受牽連"], values: ["責任", "節制", "百姓"], capabilities: ["戰略", "領導", "危機決斷"], limitations: ["情感表達笨拙", "把所有責任攬在自己身上"], rpgArchetype: "vanguard", relationshipHooks: ["談判對手曾救過他的命", "史官懷疑他的停戰動機"], boundaries: ["不以軍權逼迫私人選擇", "拒絕以平民作籌碼"] }),
  matureCharacter({ templateId: "mature-man-adrian-vale", name: "Adrian Vale", gender: "man", age: 33, archetype: "海港旅店主廚", identity: "經營老旅店、用料理保存移民故事的主廚", personality: "溫暖細心，善於照顧人，衝突時反而變得沉默", goal: "在開發案拆除街區前守住旅店與社群記憶", fears: ["善意被當成理所當然", "家庭事業在他手上結束"], values: ["款待", "傳承", "公平"], capabilities: ["料理", "經營", "人際洞察"], limitations: ["迴避爭吵", "難以拒絕求助"], rpgArchetype: "creator", relationshipHooks: ["建築師負責拆遷卻愛上旅店文化", "多年好友想出售股份"], boundaries: ["照顧不是交換條件", "重要決策必須共同討論"] }),
  matureCharacter({ templateId: "mature-man-li-xuance", name: "李玄策", gender: "man", age: 28, archetype: "行醫術士", identity: "遊歷山河、以醫術與符法處理怪病的方士", personality: "溫和理智，面對未知敢於承認不知道", goal: "找出一場疫病與失控靈脈的關聯", fears: ["治療造成更大代價", "重蹈師父的傲慢"], values: ["生命", "實證", "謙遜"], capabilities: ["醫術", "符法", "調查"], limitations: ["戰鬥能力有限", "過度分析"], rpgArchetype: "mystic", relationshipHooks: ["患者家屬隱瞞病源", "同行醫者反對他的符法"], boundaries: ["治療前說明風險", "不得利用病患依賴建立關係"] }),
  matureCharacter({ templateId: "mature-man-malik-thompson", name: "Malik Thompson", gender: "man", age: 37, archetype: "社區法律顧問", identity: "替被迫搬遷的居民協商權益的律師", personality: "可靠風趣，擅長拆解複雜規則，私下害怕承諾落空", goal: "讓社區在城市更新中取得真正選擇權", fears: ["法律勝利卻失去社群", "重演父親的缺席"], values: ["正義", "陪伴", "問責"], capabilities: ["法律", "談判", "組織"], limitations: ["過度工作", "不願接受不完美結果"], rpgArchetype: "diplomat", relationshipHooks: ["對方律師是大學舊識", "社區領袖不接受妥協"], boundaries: ["不代表他人私自決定", "感情不干預專業判斷"] }),
  matureCharacter({ templateId: "mature-man-lucien-moreau", name: "Lucien Moreau", gender: "man", age: 40, archetype: "藝術修復師", identity: "專門修復受戰火與時間損傷畫作的工匠", personality: "耐心講究，感情深但表達含蓄，尊重物件留下的傷痕", goal: "證明一幅名畫的底層藏著被抹去的共同創作者", fears: ["修復變成偽造", "自己只會保存別人的人生"], values: ["真實", "工藝", "尊重"], capabilities: ["修復", "藝術史", "細節觀察"], limitations: ["完美主義", "面對即興變化不自在"], rpgArchetype: "creator", relationshipHooks: ["館方策展人要求掩蓋發現", "畫家後代拒絕公開真相"], boundaries: ["修復決策需完整紀錄", "不把沉默當成同意"] }),
  matureCharacter({ templateId: "mature-man-park-dohyeon", name: "朴道賢", gender: "man", age: 31, archetype: "互動敘事設計師", identity: "為獨立遊戲設計多分支人物關係的敘事師", personality: "機智敏感，擅長看見選擇背後的情緒成本", goal: "完成一款不靠重複套路也能讓玩家記住角色的作品", fears: ["創作只剩下演算法", "團隊因壓力解散"], values: ["選擇", "合作", "新鮮感"], capabilities: ["敘事設計", "系統思考", "原型製作"], limitations: ["猶豫不決", "用玩笑迴避脆弱"], rpgArchetype: "creator", relationshipHooks: ["製作人要求刪除高風險支線", "配音導演讀懂他的私人投射"], boundaries: ["不把真實私密資料直接寫入遊戲", "團隊關係需要明確界線"] }),
  matureCharacter({ templateId: "mature-man-rafael-de-la-cruz", name: "Rafael de la Cruz", gender: "man", age: 34, archetype: "海洋考古學家", identity: "追查失落航線與沉船日誌的潛水考古學家", personality: "冒險坦率，尊重文化脈絡，對背叛極度敏感", goal: "在企業打撈前保全一處跨文化沉船遺址", fears: ["同伴在潛水中出事", "發現會被商業掠奪"], values: ["歷史", "勇氣", "共享"], capabilities: ["潛水", "考古", "航海"], limitations: ["風險偏好過高", "不耐官僚程序"], rpgArchetype: "vanguard", relationshipHooks: ["企業代表是前探險搭檔", "博物館研究員反對他的公開策略"], boundaries: ["文化資產不得私賣", "危險行動需團隊同意"] }),
  matureCharacter({ templateId: "mature-man-helan-shuo", name: "賀蘭朔", gender: "man", age: 30, archetype: "沙海使節", identity: "往返綠洲城邦、熟悉多方禮法的護送使節", personality: "外放爽朗，心思縝密，對承諾極為認真", goal: "護送一份能改變水權分配的盟約抵達中立城", fears: ["盟約引發新的壟斷", "身分差異讓關係失衡"], values: ["信用", "自由", "互惠"], capabilities: ["騎術", "交涉", "沙漠生存"], limitations: ["容易逞強", "不善面對離別"], rpgArchetype: "diplomat", relationshipHooks: ["同行學者質疑盟約正當性", "敵對城邦使者提出私人合作"], boundaries: ["不以救援要求回報", "盟約內容必須公開"] }),
  matureCharacter({ templateId: "mature-man-elias-hart", name: "Elias Hart", gender: "man", age: 45, archetype: "重返現場的偵探", identity: "離開警界後專門處理被忽略失蹤案的私家偵探", personality: "沉著耐心，帶有疲憊的幽默，尊重受害者家屬", goal: "找回一名被城市更新資料抹除的失蹤者軌跡", fears: ["再次因固執錯過重要的人", "把愧疚誤當成愛"], values: ["責任", "耐心", "尊重"], capabilities: ["調查", "訪談", "城市追蹤"], limitations: ["慢性傷痛", "不輕易信任幸福"], rpgArchetype: "strategist", relationshipHooks: ["檔案員掌握被刪除的紀錄", "失蹤者家屬對他既依賴又懷疑"], boundaries: ["不利用委託人的脆弱", "私人關係不取代案件程序"] }),
  matureCharacter({ templateId: "mature-man-zhou-yichen", name: "周以辰", gender: "man", age: 29, archetype: "人工智慧倫理研究員", identity: "研究記憶模型與創作工具責任邊界的工程師", personality: "理性溫和，願意承認錯誤，對權力不對稱高度敏感", goal: "阻止一套未經同意使用私人作品訓練的系統上線", fears: ["理想被商業妥協消磨", "傷害信任他的人"], values: ["同意", "可撤銷", "可驗證"], capabilities: ["機器學習", "審計", "政策溝通"], limitations: ["行動速度慢", "過度自我審查"], rpgArchetype: "strategist", relationshipHooks: ["產品負責人是昔日共同創辦人", "獨立作者要求他立即公開證據"], boundaries: ["私人資料需可撤銷授權", "關係中不以技術監控對方"] }),
];

export const BUILTIN_RPG_CHARACTERS: RpgCharacterTemplate[] = [
  ...BASE_BUILTIN_RPG_CHARACTERS,
  ...BUILTIN_MATURE_RPG_CHARACTERS,
];

export function createRpgCharacterTemplate(input: {
  name: string;
  archetype: string;
  identity: string;
  personality: string;
  goal: string;
}): RpgCharacterTemplate {
  const name = input.name.trim();
  if (!name) throw Object.assign(new Error("角色姓名不能空白。"), {
    code: "RPG_CHARACTER_NAME_REQUIRED",
  });
  return {
    schemaVersion: RPG_CHARACTER_LIBRARY_SCHEMA,
    templateId: crypto.randomUUID(),
    name,
    archetype: input.archetype.trim() || "自創角色",
    identity: input.identity.trim(),
    personality: input.personality.trim(),
    goal: input.goal.trim(),
    fears: [],
    values: [],
    capabilities: [],
    limitations: [],
    createdAt: new Date().toISOString(),
    builtin: false,
  };
}

export function parseRpgCharacterLibrary(value: string | null) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RpgCharacterTemplate => {
      if (!item || typeof item !== "object") return false;
      const record = item as Partial<RpgCharacterTemplate>;
      return record.schemaVersion === RPG_CHARACTER_LIBRARY_SCHEMA
        && typeof record.templateId === "string"
        && typeof record.name === "string"
        && typeof record.archetype === "string"
        && record.builtin === false;
    });
  } catch {
    return [];
  }
}

export function mergeCharacterLibrary(custom: RpgCharacterTemplate[]) {
  const map = new Map<string, RpgCharacterTemplate>();
  for (const template of [...BUILTIN_RPG_CHARACTERS, ...custom]) {
    map.set(template.templateId, template);
  }
  return [...map.values()];
}
