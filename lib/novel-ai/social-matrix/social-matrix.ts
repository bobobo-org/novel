import { sha256Hex, stableStringify } from "../closed-ai-cache";
import { characterRpgStatsForArchetype } from "../game/character-rpg-profile";
import {
  PROCEDURAL_CHARACTER_CAPACITY,
  PROCEDURAL_ORIGIN_POLICY,
  PROCEDURAL_STORY_LIBRARY_VERSION,
  PROCEDURAL_TREASURE_CAPACITY,
  proceduralCharacterAt,
  proceduralTreasureAt,
  type ProceduralStoryContext,
} from "../game/procedural-story-library";
import {
  PROCEDURAL_TREASURE_CLASSIFICATION_VERSION,
  proceduralTreasureClassificationAt,
} from "../game/procedural-treasure-classification";
import {
  PROCEDURAL_TREASURE_OWNERSHIP_VERSION,
  treasureOrdinalsHeldByPopulationIndex,
} from "../game/procedural-treasure-ownership";
import {
  SOCIAL_MATRIX_SCHEMA_VERSION,
  type ApprovedSocialCharacter,
  type SocialCharacterApproval,
  type SocialCharacterCandidate,
  type SocialFamily,
  type SocialInstitution,
  type SocialInstitutionKind,
  type SocialMatrixCharacter,
  type SocialMatrixPage,
  type SocialMatrixPossession,
  type SocialMatrixRelationship,
  type SocialMatrixRelationshipPair,
  type SocialPossessionKind,
  type SocialRelationshipKind,
} from "./types";

type SocialDisplayGenre =
  | "cultivation"
  | "entertainment"
  | "campus"
  | "business"
  | "science-fiction"
  | "historical"
  | "mystery"
  | "general";

type SocialDisplayVocabulary = {
  institutionNames: readonly string[];
  institutionKinds: readonly SocialInstitutionKind[];
  territories: readonly string[];
  doctrines: readonly string[];
  publicGoals: readonly string[];
  hiddenConflicts: readonly string[];
  familySuffixes: readonly string[];
  familyHomes: readonly string[];
  familyReputations: readonly string[];
  inheritedTraits: readonly string[];
};

const SOCIAL_DISPLAY_VOCABULARIES: Record<SocialDisplayGenre, SocialDisplayVocabulary> = {
  cultivation: {
    institutionNames: ["青衡劍宗", "觀瀾丹盟", "玄霄符門", "天衡書院", "流雲陣院", "百鍊山莊"],
    institutionKinds: ["宗門", "門派", "世家聯盟", "商會", "學宮"],
    territories: ["雲汀", "蒼梧", "北溟", "鏡湖", "青岫", "扶光"],
    doctrines: ["以守護弱者衡量力量", "先求證再出手", "術法必須留下代價紀錄", "個人選擇高於血脈命令"],
    publicGoals: ["維持邊境秩序", "修復失衡靈脈", "開放平民修行", "守護古籍傳承"],
    hiddenConflicts: ["長老派與新生代爭奪改革方向", "核心傳承的真實來源遭到質疑", "主家隱瞞了一場失敗遠征"],
    familySuffixes: ["修行世家", "丹道支脈", "劍修一脈", "陣法傳承"],
    familyHomes: ["雲汀山城", "鏡湖靈谷", "青岫坊市", "扶光古鎮"],
    familyReputations: ["守諾重義", "丹術傳家", "長於陣法", "曾因舊案失勢"],
    inheritedTraits: ["靈息敏銳", "劍意澄明", "經脈堅韌", "危機直覺"],
  },
  entertainment: {
    institutionNames: ["星河影業", "雲幕經紀", "拾光製作團隊", "長鏡觀眾社群", "晨曦音樂工作室", "遠景發行聯盟"],
    institutionKinds: ["商會", "祕密結社"],
    territories: ["影視城", "錄音園區", "城市劇院", "海港片場", "媒體街區", "直播園區"],
    doctrines: ["作品品質優先於短期聲量", "合約與署名必須透明", "演出安全高於檔期", "觀眾信任不可透支"],
    publicGoals: ["完成年度重點作品", "培養新生代創作者", "修復公眾信任", "拓展海外發行"],
    hiddenConflicts: ["製作人與資方對選角意見相左", "主力藝人的合約即將到期", "匿名爆料正在改變輿論", "收視與口碑只能先保住其一"],
    familySuffixes: ["演藝世家", "製作團隊", "經紀合夥人", "創作家族"],
    familyHomes: ["影視城宿舍", "河岸工作室", "城市劇院後台", "媒體街區公寓"],
    familyReputations: ["選角眼光精準", "擅長危機公關", "重視創作署名", "與多方保持合作"],
    inheritedTraits: ["鏡頭感敏銳", "記詞出眾", "舞台沉著", "輿情直覺"],
  },
  campus: {
    institutionNames: ["明德學院", "青禾文學社", "曙光校隊", "校務協作會", "晨星研究社", "白樺學生議會"],
    institutionKinds: ["學宮", "祕密結社"],
    territories: ["明德校園", "青禾宿舍區", "白樺圖書館", "城市大學城", "舊校舍", "河畔運動場"],
    doctrines: ["求證重於傳聞", "團隊榮譽不凌駕個人選擇", "學術成果必須誠實署名", "每位學生都有申辯機會"],
    publicGoals: ["完成校際競賽", "守住研究計畫", "改善校園環境", "協助新生適應"],
    hiddenConflicts: ["社團幹部對改革方向分歧", "競賽資格受到匿名質疑", "研究成果的署名爭議浮現", "校隊與教職團隊互不信任"],
    familySuffixes: ["校友家庭", "學生團隊", "研究小組", "社團夥伴"],
    familyHomes: ["學生宿舍", "校外合租屋", "教師宿舍", "大學城公寓"],
    familyReputations: ["學風踏實", "熱心校務", "競賽經驗豐富", "善於調解衝突"],
    inheritedTraits: ["記憶出眾", "學習敏銳", "團隊韌性", "觀察細緻"],
  },
  business: {
    institutionNames: ["遠川控股", "拾光創業團隊", "江氏實業", "城東商業聯盟", "瀚海物流", "青原品牌集團"],
    institutionKinds: ["商會", "世家聯盟", "祕密結社"],
    territories: ["金融中心", "港區物流園", "新創園區", "城東商圈", "工業園區", "國際會展中心"],
    doctrines: ["現金流優先於虛假成長", "品質承諾必須可驗證", "合約風險先行揭露", "員工安全不可交換"],
    publicGoals: ["守住關鍵供應鏈", "完成產品轉型", "修復客戶信任", "開拓新市場"],
    hiddenConflicts: ["董事會對接班方向分歧", "核心供應商正在秘密議價", "競爭者以匿名消息試探市場", "短期營收與品質只能先保住其一"],
    familySuffixes: ["企業家族", "創業夥伴", "品牌團隊", "供應鏈聯盟"],
    familyHomes: ["城東商務宅邸", "港區員工社區", "新創園區宿舍", "河岸辦公社區"],
    familyReputations: ["守信穩健", "精於商略", "重視品質", "擅長資源調度"],
    inheritedTraits: ["數字敏銳", "談判沉著", "風險直覺", "執行精準"],
  },
  "science-fiction": {
    institutionNames: ["曙光艦隊", "天穹研究院", "新港殖民共同體", "星橋科技", "深空救援隊", "軌道議事團"],
    institutionKinds: ["商會", "學宮", "祕密結社"],
    territories: ["近地軌道城", "火星新港", "月面研究區", "外環補給站", "深空航道", "海王星前哨"],
    doctrines: ["生命維持優先於任務榮譽", "研究資料必須可追溯", "人工智慧不得繞過人類同意", "殖民資源公平配給"],
    publicGoals: ["修復航道網路", "保護殖民地居民", "完成深空觀測", "阻止失控系統擴散"],
    hiddenConflicts: ["艦隊與研究院爭奪決策權", "生命維持資料遭到竄改", "未知訊號引發撤離爭議", "能源與救援窗口只能保住其一"],
    familySuffixes: ["殖民家族", "艦員團隊", "研究共同體", "航運聯盟"],
    familyHomes: ["近地軌道城", "火星新港居住艙", "月面科研站", "外環補給站"],
    familyReputations: ["航行紀律嚴謹", "研究紀錄完整", "擅長危機修復", "重視生命安全"],
    inheritedTraits: ["空間感敏銳", "系統思維", "低重力適應", "訊號直覺"],
  },
  historical: {
    institutionNames: ["景氏皇族", "清河世家", "玄甲軍府", "長安商幫", "翰林文館", "江南漕運盟"],
    institutionKinds: ["世家聯盟", "商會", "學宮", "祕密結社"],
    territories: ["京畿", "清河郡", "江南道", "北境軍鎮", "長安西市", "漕運河道"],
    doctrines: ["民生重於門第", "軍令必須留下責任紀錄", "宗族承諾不得凌駕國法", "史官紀錄不可任意刪改"],
    publicGoals: ["穩定邊境糧道", "平息朝堂黨爭", "守護漕運命脈", "查明舊案真相"],
    hiddenConflicts: ["皇族與世家爭奪繼承話語權", "軍府隱瞞一場敗仗", "漕運帳冊牽出舊日盟約", "名節與家族存續只能先保住其一"],
    familySuffixes: ["皇族支脈", "士族門第", "軍功世家", "商幫家族"],
    familyHomes: ["京畿府邸", "清河祖宅", "北境軍鎮", "江南商館"],
    familyReputations: ["清議持重", "軍紀嚴明", "詩書傳家", "漕運經驗深厚"],
    inheritedTraits: ["識人敏銳", "禮法純熟", "治軍沉著", "帳目精準"],
  },
  mystery: {
    institutionNames: ["城南專案組", "刑事調查隊", "白氏證人家族", "夜航情報網", "晨報調查室", "舊城鑑識中心"],
    institutionKinds: ["祕密結社", "世家聯盟", "學宮"],
    territories: ["舊城區", "河岸碼頭", "城南警署", "山區小鎮", "都會新聞街", "郊外研究所"],
    doctrines: ["證據先於直覺", "證人安全高於破案速度", "推論必須能被反駁", "個人隱私不得任意公開"],
    publicGoals: ["查明失蹤案真相", "保護關鍵證人", "阻止證據遭到銷毀", "釐清連環事件關聯"],
    hiddenConflicts: ["調查員對主要嫌疑人意見分歧", "關鍵證詞存在時間矛盾", "情報來源隱瞞私人動機", "破案速度與證人安全只能先保住其一"],
    familySuffixes: ["證人家族", "調查搭檔", "記者團隊", "地方關係網"],
    familyHomes: ["舊城公寓", "河岸旅館", "城南宿舍", "山區祖宅"],
    familyReputations: ["證詞謹慎", "觀察敏銳", "保密可靠", "熟悉地方人脈"],
    inheritedTraits: ["細節記憶", "謊言直覺", "足跡辨識", "危機警覺"],
  },
  general: {
    institutionNames: ["地方工作團隊", "公共協作會", "城市互助聯盟", "社區研究小組", "跨域合作社", "文化交流中心"],
    institutionKinds: ["商會", "學宮", "祕密結社"],
    territories: ["城市中心", "河岸社區", "海港街區", "山城聚落", "交通樞紐", "公共園區"],
    doctrines: ["承諾必須可被驗證", "個人選擇高於集體命令", "資訊公開但保護隱私", "衝突先經協商處理"],
    publicGoals: ["修復公共信任", "完成跨域合作", "保護共同資源", "解決地方危機"],
    hiddenConflicts: ["核心成員對改革方向分歧", "盟約中的舊條款即將到期", "合作夥伴正在試探底線", "資源與名聲只能先保住其一"],
    familySuffixes: ["地方家族", "工作團隊", "合作夥伴", "社區聯盟"],
    familyHomes: ["河岸社區", "城市公寓", "海港聚落", "山城街區"],
    familyReputations: ["守諾重義", "善於協調", "重視公共利益", "與多方保持合作"],
    inheritedTraits: ["記憶出眾", "意志堅定", "手藝精準", "善察人心"],
  },
};

type SocialNativeVocabulary = {
  institutionUnit: string;
  familyUnit: string;
  roles: readonly string[];
  familyRoles: readonly string[];
  locations: readonly string[];
  specialties: readonly string[];
  secrets: readonly string[];
  possessionKinds: readonly [
    SocialPossessionKind,
    SocialPossessionKind,
    SocialPossessionKind,
    SocialPossessionKind,
    SocialPossessionKind,
  ];
  possessionNames: readonly string[];
  possessionFunctions: readonly string[];
  possessionLimitations: readonly string[];
  possessionCosts: readonly string[];
  possessionHooks: readonly string[];
};

const SOCIAL_NATIVE_VOCABULARIES: Record<SocialDisplayGenre, SocialNativeVocabulary> = {
  cultivation: {
    institutionUnit: "支壇",
    familyUnit: "支脈",
    roles: ["外門弟子", "內門弟子", "執事", "客卿", "護法", "長老", "丹師", "符師", "陣師", "靈植師"],
    familyRoles: ["長房傳人", "旁支子弟", "守譜人", "客居族人", "家業繼承候選", "外姓盟親"],
    locations: ["山門議事堂", "邊城藥鋪", "古陣遺址", "藏書洞府", "靈田聚落", "鏡湖渡口"],
    specialties: ["劍術", "煉丹", "符法", "陣法", "醫術", "鑑寶", "鍛造", "馭獸", "星象", "靈植"],
    secrets: ["真實血脈與族譜記載不符", "曾暗中救過敵對宗門的人", "知道一件法器其實選錯了主人", "能辨認失落陣法的最後一筆", "私藏一份未公開的丹方", "掌握秘境入口改道的證據"],
    possessionKinds: ["丹藥", "武器", "符籙", "陣法", "特殊機緣"],
    possessionNames: ["凝息丹", "青鋒劍", "護脈符", "聚靈陣盤", "古修洞府線索"],
    possessionFunctions: ["穩定靈息", "提升護身能力", "封存一次術法衝擊", "調整周遭靈流", "指出一條未公開的修行路徑"],
    possessionLimitations: ["每日只能啟用一次", "需要同源靈力", "超出境界會反噬", "離開靈脈便失效", "必須完成前任持有者的承諾"],
    possessionCosts: ["消耗靈力", "留下可追查的氣息", "短暫削弱感知", "耗用一枚靈石", "承擔一次因果債"],
    possessionHooks: ["前任持有者仍在追查下落", "與失落傳承互相呼應", "所有權正被兩個宗門爭議"],
  },
  entertainment: {
    institutionUnit: "分部",
    familyUnit: "團隊",
    roles: ["製片人", "導演", "編劇", "演員", "經紀人", "剪輯師", "攝影師", "宣傳企劃"],
    familyRoles: ["核心演員", "製作搭檔", "合約顧問", "新人代表", "經紀合夥人", "幕後協力"],
    locations: ["攝影棚", "排練室", "錄音室", "剪輯室", "首映會場", "經紀公司會議室"],
    specialties: ["鏡頭表演", "劇本分析", "場面調度", "剪輯節奏", "聲音設計", "輿情研判", "合約談判", "造型設計"],
    secrets: ["掌握未公開選角紀錄", "知道剪輯版本遭人替換", "隱瞞一份署名協議", "清楚主力演員的檔期衝突", "知道匿名爆料的真正來源", "保存一份試映數據"],
    possessionKinds: ["合約", "道具", "素材", "設備", "檔案"],
    possessionNames: ["限期演出合約", "關鍵場景道具", "未公開母帶", "備用攝影機", "試映回饋檔案"],
    possessionFunctions: ["鎖定演出檔期", "完成關鍵鏡頭", "還原被刪除的片段", "支援臨時補拍", "揭示觀眾反應差異"],
    possessionLimitations: ["僅限指定作品使用", "需要製作人共同簽核", "公開前不得外流", "使用時會占用棚期", "只能查閱一次完整版本"],
    possessionCosts: ["占用宣傳預算", "延後其他拍攝", "承擔保密責任", "增加後製工時", "可能引發署名爭議"],
    possessionHooks: ["另一位製作人主張共同所有", "內容能改變最終剪輯方向", "公開時機會影響整個團隊"],
  },
  campus: {
    institutionUnit: "分社",
    familyUnit: "小組",
    roles: ["學生代表", "社團幹部", "研究助理", "校隊成員", "導師", "圖書館員", "實驗室管理員", "校務協調員"],
    familyRoles: ["核心社員", "競賽隊員", "同組夥伴", "學長姊", "新生代表", "指導老師"],
    locations: ["圖書館討論室", "社團教室", "實驗室", "校隊訓練場", "學生會辦公室", "校園廣場"],
    specialties: ["研究整理", "簡報表達", "實驗設計", "程式開發", "辯論", "文獻檢索", "活動企劃", "運動訓練"],
    secrets: ["掌握競賽評分表的異常", "知道研究署名被人更動", "隱瞞社團預算的缺口", "知道匿名檢舉者的身分", "看見考場外的一段爭執", "保存尚未刊出的校刊資料"],
    possessionKinds: ["教材", "器材", "文件", "憑證", "研究資料"],
    possessionNames: ["競賽講義", "實驗測量器", "社團會議紀錄", "校務通行證", "研究原始資料"],
    possessionFunctions: ["補足關鍵知識", "驗證實驗結果", "還原決策過程", "進入限制區域", "比對研究結論"],
    possessionLimitations: ["僅供本學期使用", "需要教師簽借", "不得刪改原始內容", "限定持證本人", "引用時必須保留來源"],
    possessionCosts: ["占用複習時間", "承擔器材保管責任", "可能引發社團爭議", "留下進出紀錄", "增加資料整理工時"],
    possessionHooks: ["另一組也在尋找同份資料", "能證明一次被忽略的貢獻", "會改變競賽資格的判定"],
  },
  business: {
    institutionUnit: "事業部",
    familyUnit: "專案組",
    roles: ["營運主管", "產品經理", "財務分析師", "品質工程師", "法務顧問", "供應鏈專員", "客戶經理", "稽核員"],
    familyRoles: ["創業合夥人", "董事代表", "部門主管", "專案成員", "接班候選", "外部顧問"],
    locations: ["董事會議室", "產品實驗室", "港區倉庫", "客戶簡報室", "品質稽核現場", "供應鏈調度中心"],
    specialties: ["現金流分析", "供應鏈調度", "品質稽核", "合約談判", "市場研究", "產品規劃", "風險管理", "客戶溝通"],
    secrets: ["掌握供應商議價紀錄", "看過尚未公開的財測", "知道董事投票的真實意向", "保留一份產品缺陷報告", "清楚接班協議的附帶條款", "收到客戶流失預警"],
    possessionKinds: ["合約", "設備", "文件", "數據", "資源"],
    possessionNames: ["優先供貨合約", "品質檢測設備", "董事會議紀錄", "市場測試數據", "緊急週轉額度"],
    possessionFunctions: ["穩定關鍵供應", "驗證產品品質", "還原決策責任", "預測市場反應", "維持短期現金安全線"],
    possessionLimitations: ["只涵蓋一個交付週期", "必須由合格人員操作", "內容受保密條款限制", "樣本不足時誤差升高", "動用後需接受財務稽核"],
    possessionCosts: ["犧牲部分毛利", "增加維護費用", "承擔資訊揭露風險", "延後正式上市", "提高後續融資成本"],
    possessionHooks: ["競爭者也在爭取同一資源", "能揭露供應中斷的真正原因", "動用時機會改變董事會立場"],
  },
  "science-fiction": {
    institutionUnit: "分艦",
    familyUnit: "艙組",
    roles: ["艦長", "導航員", "系統工程師", "生醫官", "任務科學家", "通訊官", "殖民地協調員", "救援駕駛"],
    familyRoles: ["艦橋成員", "科研組員", "維生班員", "殖民代表", "航運夥伴", "救援隊員"],
    locations: ["艦橋", "維生艙", "軌道實驗室", "火星新港", "外環補給站", "深空通訊室"],
    specialties: ["軌道導航", "維生維修", "訊號解析", "外星生物研究", "機器人工程", "反應爐管理", "低重力救援", "殖民治理"],
    secrets: ["知道維生耗損被人隱瞞", "曾收到一段未知訊號", "掌握未登記的航道座標", "看過人工智慧的原始決策紀錄", "發現樣本污染沒有被通報", "保存一份秘密撤離名單"],
    possessionKinds: ["生醫製劑", "航太模組", "通行憑證", "維生系統", "異星樣本"],
    possessionNames: ["細胞修復製劑", "姿態控制模組", "軌道通行憑證", "備援維生核心", "未知微生物樣本"],
    possessionFunctions: ["修復輻射損傷", "校正飛行姿態", "穿越封鎖航道", "維持艙區供氧", "分析外星生態"],
    possessionLimitations: ["只能使用一次療程", "需要相容艦體介面", "僅在指定航窗有效", "能源只能維持六小時", "必須在隔離艙操作"],
    possessionCosts: ["消耗有限醫療配額", "占用推進能源", "留下完整航行紀錄", "降低其他艙區供能", "承擔生物污染風險"],
    possessionHooks: ["另一艘分艦也在搜尋此物", "能證明未知訊號並非雜訊", "啟用會暴露目前座標"],
  },
  historical: {
    institutionUnit: "別署",
    familyUnit: "房",
    roles: ["史官", "幕僚", "校尉", "掌櫃", "漕運吏", "醫官", "使節", "書吏"],
    familyRoles: ["長房子弟", "旁房族人", "門客", "家臣", "嫡系候選", "姻親代表"],
    locations: ["京畿府衙", "翰林文館", "北境軍營", "江南商館", "漕運碼頭", "清河祖宅"],
    specialties: ["經史考據", "軍陣調度", "漕運帳目", "禮制談判", "醫藥辨證", "公文書寫", "輿圖判讀", "情報甄別"],
    secrets: ["保管一封尚未呈上的密奏", "知道漕運帳冊缺了一頁", "曾聽見舊案證詞遭人改寫", "隱瞞一份繼承文書", "掌握北境防線的缺口", "知道賜婚詔令另有附款"],
    possessionKinds: ["藥材", "兵器", "文書", "印信", "輿圖"],
    possessionNames: ["御醫藥匣", "玄甲佩刀", "封緘密奏", "漕運司印信", "北境軍防輿圖"],
    possessionFunctions: ["救治急症", "護衛持有人", "證明朝堂意旨", "調動漕運人手", "標示軍防要道"],
    possessionLimitations: ["藥材只能救治一人", "離開軍籍便須繳回", "拆封後會留下痕跡", "只能在任期內使用", "部分地形已經改變"],
    possessionCosts: ["耗盡珍稀藥材", "承擔軍紀責任", "可能觸怒權臣", "留下調度帳目", "暴露邊防部署"],
    possessionHooks: ["另一房族人主張合法持有", "能翻轉一樁舊案", "交付對象正在途中失聯"],
  },
  mystery: {
    institutionUnit: "小隊",
    familyUnit: "線索組",
    roles: ["刑警", "鑑識員", "調查記者", "律師", "證人保護員", "犯罪分析師", "法醫", "地方聯絡員"],
    familyRoles: ["調查搭檔", "證人家屬", "專案顧問", "線索提供者", "地方嚮導", "安全聯絡人"],
    locations: ["鑑識中心", "城南警署", "河岸碼頭", "舊城公寓", "新聞資料室", "證人安全屋"],
    specialties: ["證物鑑定", "時間線重建", "訪談取證", "足跡辨識", "數位鑑識", "行為分析", "法律程序", "地方情報"],
    secrets: ["知道關鍵證物曾被移動", "保留一段未交出的錄音", "發現證詞時間互相矛盾", "認得匿名情報來源", "曾私下保護一名嫌疑人", "掌握第二現場的位置"],
    possessionKinds: ["藥材", "工具", "證物", "文件", "線索"],
    possessionNames: ["急救藥箱", "鑑識工具箱", "封存證物袋", "原始筆錄", "監視器備份"],
    possessionFunctions: ["維持證人狀態", "採集微量痕跡", "保存證物完整性", "比對證詞差異", "重建失蹤前行動"],
    possessionLimitations: ["只能處理輕傷", "必須在無污染環境使用", "封條破損即失去效力", "需要合法授權查閱", "畫面存在數分鐘缺口"],
    possessionCosts: ["占用救援時間", "耗用一次性耗材", "承擔保管責任", "可能暴露證人身分", "引起真正犯人的警覺"],
    possessionHooks: ["另一名調查員質疑來源", "能證明案件存在第二現場", "失主尚未說出全部真相"],
  },
  general: {
    institutionUnit: "分組",
    familyUnit: "協作組",
    roles: ["協調員", "研究者", "醫師", "工匠", "聯絡員", "記錄員", "顧問", "巡查員"],
    familyRoles: ["核心成員", "協作夥伴", "家屬代表", "外部顧問", "接班候選", "地方聯絡人"],
    locations: ["公共會議室", "社區工作站", "河岸市場", "城市資料館", "交通轉運站", "地方服務中心"],
    specialties: ["資料整理", "談判", "追蹤", "醫療", "修繕", "情報", "經營", "教學"],
    secrets: ["掌握一份尚未公開的交易紀錄", "曾暗中救過敵對陣營的人", "替同伴承擔一項不存在的罪名", "知道共同資源真正的去向", "保留一份未完成的協議", "曾在關鍵會議中投下反對票"],
    possessionKinds: ["藥材", "工具", "文件", "設備", "資源"],
    possessionNames: ["急救藥箱", "維修工具", "合作協議", "備援設備", "公共資源憑證"],
    possessionFunctions: ["處理緊急傷勢", "修復故障", "證明合作條件", "維持短期運作", "調用共同資源"],
    possessionLimitations: ["數量有限", "需要專業操作", "只在期限內有效", "必須定期維護", "需要共同簽核"],
    possessionCosts: ["消耗庫存", "占用工時", "承擔公開責任", "提高維護費用", "留下完整使用紀錄"],
    possessionHooks: ["另一個團隊也提出使用申請", "能解決眼前危機但會留下後續責任", "真正所有人尚未現身"],
  },
};

function socialDisplayGenre(context: ProceduralStoryContext | undefined): SocialDisplayGenre {
  const signal = [context?.genre, context?.playMode, ...(context?.storyTags ?? [])]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
  if (/娛樂|演藝|影視|明星|偶像|經紀|娛樂圈/u.test(signal)) return "entertainment";
  if (/校園|學校|學生|青春|社團|校隊/u.test(signal)) return "campus";
  if (/商戰|企業|職場|創業|經營|金融|財經/u.test(signal)) return "business";
  if (/科幻|星際|太空|未來|賽博|機器人|宇宙/u.test(signal)) return "science-fiction";
  if (/歷史|宮廷|宮鬥|朝堂|古代|權謀|王朝/u.test(signal)) return "historical";
  if (/懸疑|推理|刑偵|偵探|犯罪|解謎/u.test(signal)) return "mystery";
  if (/修仙|仙俠|玄幻|靈氣|宗門|煉氣/u.test(signal)) return "cultivation";
  return "general";
}

function socialDisplayVocabulary(context: ProceduralStoryContext | undefined) {
  return SOCIAL_DISPLAY_VOCABULARIES[socialDisplayGenre(context)];
}

function socialNativeVocabulary(context: ProceduralStoryContext | undefined) {
  return SOCIAL_NATIVE_VOCABULARIES[socialDisplayGenre(context)];
}
const TRAITS = ["審慎", "果斷", "好奇", "溫厚", "敏銳", "守信", "野心勃勃", "幽默", "克制", "叛逆", "務實", "浪漫", "多疑", "寬容", "好勝", "沉著", "固執", "圓融"];
const PUBLIC_FACES = ["禮貌而難以親近", "爽朗且善於凝聚人心", "冷靜精準，很少浪費一句話", "溫和可靠，總先照顧別人", "機敏風趣，習慣用笑話試探", "沉默寡言，行動比承諾更快"];
const PRIVATE_NEEDS = ["被看見真正的努力", "證明自己不必複製上一代", "找到能放心交付弱點的人", "修補一次無法公開的失誤", "在責任之外保留自己的選擇", "讓失去的關係獲得一次告別"];
const UNDIRECTED_RELATIONSHIP_KINDS = ["血親", "同門", "盟友", "宿敵"] as const;
const DIRECTED_RELATIONSHIP_KINDS: SocialRelationshipKind[] = [
  "師徒",
  "競爭",
  "債務",
  "救命之恩",
  "監護",
  "交易",
];
const OWNERSHIP: Exclude<SocialMatrixPossession["ownership"], "尚未認主">[] = ["持有", "保管", "借用", "爭奪中"];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

export function socialMatrixHash(value: string) {
  let hash = 2166136261;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function seededRandom(seed: string) {
  let state = socialMatrixHash(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gcd(left: number, right: number) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a;
}

function modularInverse(value: number, modulus: number) {
  let [oldR, r] = [value, modulus];
  let [oldS, s] = [1, 0];
  while (r) {
    const quotient = Math.floor(oldR / r);
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
  }
  return ((oldS % modulus) + modulus) % modulus;
}

function permutation(population: number, salt: string) {
  if (population <= 1) return { multiplier: 1, increment: 0, inverse: 1 };
  let multiplier = (socialMatrixHash(`${salt}:multiplier`) % population) || 1;
  if (multiplier % 2 === 0) multiplier += 1;
  while (gcd(multiplier, population) !== 1) multiplier = (multiplier + 2) % population || 1;
  const increment = socialMatrixHash(`${salt}:increment`) % population;
  return { multiplier, increment, inverse: modularInverse(multiplier, population) };
}

function permute(index: number, population: number, salt: string) {
  const { multiplier, increment } = permutation(population, salt);
  return (multiplier * index + increment) % population;
}

function invertPermutation(value: number, population: number, salt: string) {
  const { increment, inverse } = permutation(population, salt);
  const normalized = ((value - increment) % population + population) % population;
  return (inverse * normalized) % population;
}

function itemAt<T>(items: readonly T[], random: () => number) {
  return items[Math.floor(random() * items.length) % items.length];
}

function uniqueItems<T>(items: readonly T[], random: () => number, count: number) {
  const chosen: T[] = [];
  const seen = new Set<T>();
  while (chosen.length < Math.min(count, items.length)) {
    const candidate = itemAt(items, random);
    if (!seen.has(candidate)) {
      seen.add(candidate);
      chosen.push(candidate);
    }
  }
  return chosen;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function buildPortrait(input: { seed: string; characterId: string; name: string; visualSeed: string; visualDescription: string }) {
  const random = seededRandom(`${input.seed}:portrait:${input.visualSeed}`);
  const hue = Math.floor(random() * 360);
  const accent = (hue + 48 + Math.floor(random() * 96)) % 360;
  const palette: [string, string, string] = [`hsl(${hue} 48% 22%)`, `hsl(${accent} 64% 58%)`, `hsl(${(hue + 190) % 360} 34% 88%)`];
  const initials = escapeXml([...input.name].slice(-2).join(""));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="${escapeXml(input.name)}的原創抽象人物頭像"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette[0]}"/><stop offset="1" stop-color="${palette[1]}"/></linearGradient></defs><rect width="256" height="256" rx="48" fill="url(#g)"/><circle cx="128" cy="91" r="45" fill="${palette[2]}" opacity=".92"/><path d="M45 229c8-56 39-86 83-86s75 30 83 86" fill="${palette[2]}" opacity=".86"/><circle cx="202" cy="48" r="24" fill="none" stroke="${palette[2]}" stroke-width="3" opacity=".55"/><text x="128" y="236" text-anchor="middle" font-size="22" font-family="serif" fill="${palette[0]}" opacity=".72">${initials}</text></svg>`;
  return {
    source: "procedural-original-svg" as const,
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    palette,
    description: `${input.visualDescription} 此 SVG 是${input.name}的原創程式化抽象頭像；不對應任何真人或既有角色。`,
    storyLibraryVisualSeed: input.visualSeed,
  };
}

function powerTier(total: number): SocialMatrixCharacter["abilities"]["powerTier"] {
  if (total >= 600) return "宗師";
  if (total >= 510) return "一方強者";
  if (total >= 420) return "登堂";
  if (total >= 330) return "初境";
  return "凡俗";
}

function encodeIndex(index: number) {
  return index.toString(36).padStart(4, "0");
}

// Public names need a deterministic address just as much as internal IDs do,
// but that address must remain readable Chinese rather than leaking base36.
// Two positions cover every institution (16 * 16); three cover every family
// (16 * 16 * 16) in the complete default matrix.
const VISIBLE_NAME_LEADS = ["青", "白", "玄", "赤", "紫", "蒼", "明", "清", "景", "雲", "星", "長", "安", "遠", "新", "和"] as const;
const VISIBLE_NAME_PLACES = ["河", "川", "山", "湖", "海", "城", "港", "原", "林", "嶺", "谷", "洲", "庭", "橋", "峰", "澤"] as const;
const VISIBLE_NAME_BRANCHES = ["本", "東", "西", "南", "北", "上", "中", "新", "前", "後", "左", "右", "長", "次", "內", "外"] as const;
const FAMILY_SURNAMES = [
  "李", "王", "張", "陳", "林", "黃", "吳", "劉", "蔡", "楊", "許", "鄭", "謝", "郭", "洪", "邱",
  "曾", "廖", "賴", "徐", "周", "葉", "蘇", "莊", "江", "呂", "何", "羅", "高", "蕭", "潘", "朱",
] as const;

function visibleNameAddress(index: number, depth: 2 | 3) {
  const lead = VISIBLE_NAME_LEADS[index % VISIBLE_NAME_LEADS.length];
  const place = VISIBLE_NAME_PLACES[
    Math.floor(index / VISIBLE_NAME_LEADS.length) % VISIBLE_NAME_PLACES.length
  ];
  if (depth === 2) return `${lead}${place}`;
  const branch = VISIBLE_NAME_BRANCHES[
    Math.floor(index / (VISIBLE_NAME_LEADS.length * VISIBLE_NAME_PLACES.length))
      % VISIBLE_NAME_BRANCHES.length
  ];
  return `${lead}${place}${branch}`;
}

function familySurname(index: number) {
  return FAMILY_SURNAMES[socialMatrixHash(`family-surname:${index}`) % FAMILY_SURNAMES.length];
}

function familyPublicName(index: number, surname: string, genre: SocialDisplayGenre) {
  const address = visibleNameAddress(index, 3);
  if (genre === "cultivation") return `${address}${surname}氏修行世家`;
  if (genre === "historical") return `${address}${surname}氏`;
  if (genre === "business") return `${surname}氏家族企業`;
  if (genre === "entertainment") return `${surname}氏演藝世家`;
  return `${address}${surname}氏家族`;
}

function familyMemberName(originalName: string, surname: string, familyRole: string) {
  // 配偶、入贅、客居、收養與外部顧問保留原姓；其餘同一家族成員承同姓。
  if (/妻|夫|配偶|姻親|入贅|外姓|客居|收養|養子|養女|門客|家臣|外部|顧問|搭檔|夥伴|指導老師/u.test(familyRole)) {
    return originalName;
  }
  const givenName = originalName.replace(/^[\p{Script=Han}]{1,2}(?=[\p{Script=Han}]{1,3}$)/u, (prefix) => prefix.length > 1 ? prefix.slice(1) : "");
  return `${surname}${givenName || originalName.slice(-2)}`;
}

function parseCursor(cursor: string | undefined, prefix: string) {
  if (!cursor) return 0;
  const match = new RegExp(`^${prefix}:(\\d+)$`, "u").exec(cursor);
  if (!match) throw new Error("SOCIAL_MATRIX_CURSOR_INVALID");
  return Number(match[1]);
}

export function isUndirectedSocialRelationshipKind(
  kind: SocialRelationshipKind,
) {
  return (UNDIRECTED_RELATIONSHIP_KINDS as readonly SocialRelationshipKind[])
    .includes(kind);
}

function mirrorUndirectedRelationship(input: {
  relationship: SocialMatrixRelationship;
  sourceCharacterId: string;
}): SocialMatrixRelationship {
  return {
    ...input.relationship,
    targetCharacterId: input.sourceCharacterId,
  };
}

function isExactRelationshipMirror(
  forward: SocialMatrixRelationship,
  reverse: SocialMatrixRelationship,
  sourceCharacterId: string,
) {
  return !forward.directed
    && !reverse.directed
    && reverse.relationshipId === forward.relationshipId
    && reverse.targetCharacterId === sourceCharacterId
    && reverse.kind === forward.kind
    && reverse.trust === forward.trust
    && reverse.tension === forward.tension
    && reverse.obligation === forward.obligation
    && reverse.historyHook === forward.historyHook;
}

export class DeterministicSocialMatrix {
  readonly seed: string;
  readonly seedTag: string;
  readonly populationSize: number;
  readonly institutionCount: number;
  readonly familyCount: number;
  readonly cacheLimit: number;
  readonly context: ProceduralStoryContext | undefined;
  private readonly cache = new Map<number, SocialMatrixCharacter>();
  private cacheHits = 0;
  private cacheMisses = 0;
  private cacheEvictions = 0;

  constructor(input: { seed: string; context?: ProceduralStoryContext; populationSize?: number; institutionCount?: number; familyCount?: number; cacheLimit?: number }) {
    const seed = input.seed.trim();
    if (!seed) throw new Error("SOCIAL_MATRIX_SEED_REQUIRED");
    const populationSize = input.populationSize ?? PROCEDURAL_CHARACTER_CAPACITY;
    if (!Number.isInteger(populationSize) || populationSize < 1 || populationSize > PROCEDURAL_CHARACTER_CAPACITY) throw new Error("SOCIAL_MATRIX_POPULATION_INVALID");
    const institutionCount = input.institutionCount ?? Math.min(256, populationSize);
    const familyCount = input.familyCount ?? Math.min(4096, populationSize);
    if (!Number.isInteger(institutionCount) || institutionCount < 1 || institutionCount > populationSize) throw new Error("SOCIAL_MATRIX_INSTITUTION_COUNT_INVALID");
    if (!Number.isInteger(familyCount) || familyCount < 1 || familyCount > populationSize) throw new Error("SOCIAL_MATRIX_FAMILY_COUNT_INVALID");
    const cacheLimit = input.cacheLimit ?? 256;
    if (!Number.isInteger(cacheLimit) || cacheLimit < 0 || cacheLimit > 2048) throw new Error("SOCIAL_MATRIX_CACHE_LIMIT_INVALID");
    this.seed = seed;
    this.seedTag = proceduralCharacterAt({ seed, ordinal: 0, context: input.context }).id.split("-")[1];
    this.context = input.context ? structuredClone(input.context) : undefined;
    this.populationSize = populationSize;
    this.institutionCount = institutionCount;
    this.familyCount = familyCount;
    this.cacheLimit = cacheLimit;
  }

  characterId(index: number) {
    this.assertIndex(index);
    return proceduralCharacterAt({ seed: this.seed, ordinal: index, context: this.context }).id;
  }

  institutionId(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.institutionCount) throw new Error("SOCIAL_MATRIX_INSTITUTION_INDEX_INVALID");
    return `social-institution:${this.seedTag}:${encodeIndex(index)}`;
  }

  familyId(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.familyCount) throw new Error("SOCIAL_MATRIX_FAMILY_INDEX_INVALID");
    return `social-family:${this.seedTag}:${encodeIndex(index)}`;
  }

  private assertIndex(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.populationSize) throw new Error("SOCIAL_MATRIX_CHARACTER_INDEX_INVALID");
  }

  private institutionIndexForCharacter(index: number) {
    return permute(index, this.populationSize, `${this.seed}:institution-index`) % this.institutionCount;
  }

  private familyIndexForCharacter(index: number) {
    return permute(index, this.populationSize, `${this.seed}:family-index`) % this.familyCount;
  }

  private memberIndexForBucket(bucket: number, ordinal: number, count: number, salt: string) {
    const total = this.memberCount(bucket, count);
    const normalizedOrdinal = ((ordinal % total) + total) % total;
    return invertPermutation(bucket + normalizedOrdinal * count, this.populationSize, salt);
  }

  private memberCount(bucket: number, count: number) {
    return bucket >= this.populationSize ? 0 : Math.floor((this.populationSize - 1 - bucket) / count) + 1;
  }

  getInstitution(index: number): SocialInstitution {
    const institutionId = this.institutionId(index);
    const random = seededRandom(`${this.seed}:institution:${index}`);
    const vocabulary = socialDisplayVocabulary(this.context);
    const nativeVocabulary = socialNativeVocabulary(this.context);
    const allies = new Set<number>();
    const rivals = new Set<number>();
    while (allies.size < Math.min(2, this.institutionCount - 1)) {
      const target = Math.floor(random() * this.institutionCount);
      if (target !== index) allies.add(target);
    }
    while (rivals.size < Math.min(2, this.institutionCount - 1)) {
      const target = Math.floor(random() * this.institutionCount);
      if (target !== index && !allies.has(target)) rivals.add(target);
    }
    return deepFreeze({
      institutionId,
      institutionIndex: index,
      kind: itemAt(vocabulary.institutionKinds, random),
      name: `${itemAt(vocabulary.institutionNames, random)}・${visibleNameAddress(index, 2)}${nativeVocabulary.institutionUnit}`,
      territory: itemAt(vocabulary.territories, random),
      doctrine: itemAt(vocabulary.doctrines, random),
      influence: 20 + Math.floor(random() * 81),
      publicGoal: itemAt(vocabulary.publicGoals, random),
      hiddenConflict: itemAt(vocabulary.hiddenConflicts, random),
      allyInstitutionIds: [...allies].map((target) => this.institutionId(target)),
      rivalInstitutionIds: [...rivals].map((target) => this.institutionId(target)),
      memberCount: this.memberCount(index, this.institutionCount),
    });
  }

  getFamily(index: number): SocialFamily {
    const random = seededRandom(`${this.seed}:family:${index}`);
    const vocabulary = socialDisplayVocabulary(this.context);
    const genre = socialDisplayGenre(this.context);
    const representative = this.memberIndexForBucket(index, 0, this.familyCount, `${this.seed}:family-index`);
    const institutionIndex = this.institutionIndexForCharacter(representative);
    const surname = familySurname(index);
    return deepFreeze({
      familyId: this.familyId(index),
      familyIndex: index,
      surname,
      name: familyPublicName(index, surname, genre),
      home: itemAt(vocabulary.familyHomes, random),
      reputation: itemAt(vocabulary.familyReputations, random),
      inheritedTrait: itemAt(vocabulary.inheritedTraits, random),
      institutionId: this.institutionId(institutionIndex),
      memberCount: this.memberCount(index, this.familyCount),
    });
  }

  private buildRelationships(index: number, familyIndex: number, institutionIndex: number, random: () => number) {
    const relationshipSeeds: Array<{
      targetIndex: number;
      kind: SocialRelationshipKind;
    }> = [];
    const addRelationshipSeed = (
      targetIndex: number,
      kind: SocialRelationshipKind,
    ) => {
      if (
        targetIndex !== index
        && !relationshipSeeds.some((candidate) => candidate.targetIndex === targetIndex)
      ) {
        relationshipSeeds.push({ targetIndex, kind });
      }
    };
    const addBucketNeighbours = (input: {
      bucket: number;
      count: number;
      memberCount: number;
      salt: string;
      kind: SocialRelationshipKind;
    }) => {
      if (input.memberCount <= 1) return;
      const currentSlot = Math.floor(
        permute(index, this.populationSize, input.salt) / input.count,
      );
      for (const delta of [-1, 1]) {
        const targetSlot = (
          currentSlot + delta + input.memberCount
        ) % input.memberCount;
        addRelationshipSeed(
          this.memberIndexForBucket(
            input.bucket,
            targetSlot,
            input.count,
            input.salt,
          ),
          input.kind,
        );
      }
    };
    const familyMemberCount = this.memberCount(familyIndex, this.familyCount);
    addBucketNeighbours({
      bucket: familyIndex,
      count: this.familyCount,
      memberCount: familyMemberCount,
      salt: `${this.seed}:family-index`,
      kind: "血親",
    });
    const institutionMemberCount = this.memberCount(institutionIndex, this.institutionCount);
    addBucketNeighbours({
      bucket: institutionIndex,
      count: this.institutionCount,
      memberCount: institutionMemberCount,
      salt: `${this.seed}:institution-index`,
      kind: "同門",
    });
    const relationCount = 6 + Math.floor(random() * 5);
    let attempt = 0;
    while (relationshipSeeds.length < relationCount && attempt < relationCount * 8) {
      const offset = 1 + (socialMatrixHash(`${this.seed}:relation:${index}:${attempt}`) % (this.populationSize - 1 || 1));
      const target = (index + offset) % this.populationSize;
      addRelationshipSeed(
        target,
        DIRECTED_RELATIONSHIP_KINDS[
          socialMatrixHash(`${this.seed}:relation-kind:${index}:${attempt}`)
            % DIRECTED_RELATIONSHIP_KINDS.length
        ],
      );
      attempt += 1;
    }
    return relationshipSeeds.slice(0, relationCount).map(({ targetIndex, kind }): SocialMatrixRelationship => {
      const directed = !isUndirectedSocialRelationshipKind(kind);
      const lowerIndex = Math.min(index, targetIndex);
      const upperIndex = Math.max(index, targetIndex);
      const edgeRandom = seededRandom(directed
        ? `${this.seed}:directed-edge:${index}:${targetIndex}:${kind}`
        : `${this.seed}:undirected-edge:${lowerIndex}:${upperIndex}:${kind}`);
      const trust = clamp((edgeRandom() - 0.28) * 140, -100, 100);
      const tension = clamp((edgeRandom() - 0.34) * 145, -100, 100);
      const obligation = clamp((edgeRandom() - 0.42) * 160, -100, 100);
      const relationshipSource = directed ? index : lowerIndex;
      const relationshipTarget = directed ? targetIndex : upperIndex;
      return {
        relationshipId: `social-edge:${this.seedTag}:${encodeIndex(relationshipSource)}:${encodeIndex(relationshipTarget)}`,
        targetCharacterId: this.characterId(targetIndex),
        kind,
        directed,
        trust,
        tension,
        obligation,
        historyHook: itemAt([
          "曾共同守住一次無人知曉的危機",
          "對同一件往事持有互相衝突的證詞",
          "一方保管著另一方急需取回的信物",
          "彼此的家族盟約即將到期",
          "曾在最壞時刻做出相反選擇",
          "表面合作，實際都在確認對方底線",
        ], edgeRandom),
      };
    });
  }

  private possessionFor(index: number, treasureOrdinal: number): SocialMatrixPossession {
    const random = seededRandom(`${this.seed}:possession:${index}:${treasureOrdinal}`);
    const displayGenre = socialDisplayGenre(this.context);
    const nativeVocabulary = SOCIAL_NATIVE_VOCABULARIES[displayGenre];
    const useNativePossession = displayGenre !== "cultivation" && displayGenre !== "general";
    const classification = proceduralTreasureClassificationAt({
      storySeed: this.seed,
      treasureOrdinal,
      treasureCapacity: PROCEDURAL_TREASURE_CAPACITY,
    });
    const treasure = proceduralTreasureAt({
      seed: this.seed,
      ordinal: treasureOrdinal,
      context: this.context,
    });
    const classificationSlot = classification.kind === "pill"
      ? 0
      : classification.kind === "weapon"
        ? 1
        : classification.kind === "talisman"
          ? 2
          : classification.kind === "formation"
            ? 3
            : 4;
    const legacyKind = classification.kind === "pill"
      ? itemAt(["丹藥", "藥丸"] as const, random)
      : classification.kind === "weapon"
        ? "武器"
        : classification.kind === "talisman"
          ? "符籙"
          : classification.kind === "formation"
            ? "陣法"
            : "特殊機緣";
    const kind = useNativePossession
      ? nativeVocabulary.possessionKinds[classificationSlot]
      : legacyKind;
    const rarity: SocialMatrixPossession["rarity"] = classification.rarity === "common"
      ? "常見"
      : classification.rarity === "uncommon"
        ? "稀有"
        : classification.rarity === "rare"
          ? "珍品"
          : classification.rarity === "epic"
            ? "傳承"
            : "唯一機緣";
    const ownership = /保管|受託/u.test(treasure.holderRelationship)
      ? "保管"
      : /共同|爭議/u.test(treasure.holderRelationship)
        ? "爭奪中"
        : /借/u.test(treasure.holderRelationship)
          ? "借用"
          : itemAt(OWNERSHIP, random);
    return {
      possessionId: `social-possession:${this.seedTag}:${encodeIndex(index)}:${treasureOrdinal.toString(36).padStart(4, "0")}`,
      treasureOrdinal,
      treasureRef: treasure.id,
      kind,
      rarity,
      ownership,
      name: useNativePossession ? itemAt(nativeVocabulary.possessionNames, random) : treasure.name,
      function: useNativePossession ? itemAt(nativeVocabulary.possessionFunctions, random) : treasure.function,
      limitation: useNativePossession ? itemAt(nativeVocabulary.possessionLimitations, random) : treasure.limitation,
      cost: useNativePossession ? itemAt(nativeVocabulary.possessionCosts, random) : treasure.cost,
      storyHook: useNativePossession
        ? itemAt(nativeVocabulary.possessionHooks, random)
        : `${treasure.holderRelationship}；${itemAt([
          "真正用途只有前任持有人知道",
          "啟用會留下可追查的痕跡",
          "與另一件失落之物互相呼應",
          "所有權正被家族與宗門同時爭議",
          "使用一次便會改變持有者的選擇成本",
        ], random)}`,
    };
  }

  listCharacterPossessions(index: number, input: { cursor?: string | null; limit?: number } = {}): SocialMatrixPage<SocialMatrixPossession> {
    this.assertIndex(index);
    const page = treasureOrdinalsHeldByPopulationIndex({
      storySeed: this.seed,
      populationIndex: index,
      populationSize: this.populationSize,
      treasureCapacity: PROCEDURAL_TREASURE_CAPACITY,
      cursor: input.cursor,
      limit: input.limit,
    });
    return {
      items: page.items.map((treasureOrdinal) => this.possessionFor(index, treasureOrdinal)),
      nextCursor: page.nextCursor,
      total: page.total,
    };
  }

  private generate(index: number): SocialMatrixCharacter {
    const storyCharacter = proceduralCharacterAt({
      seed: this.seed,
      ordinal: index,
      context: this.context,
    });
    const characterId = storyCharacter.id;
    const random = seededRandom(`${this.seed}:character:${index}`);
    const nativeVocabulary = socialNativeVocabulary(this.context);
    const familyIndex = this.familyIndexForCharacter(index);
    const institutionIndex = this.institutionIndexForCharacter(index);
    const institution = this.getInstitution(institutionIndex);
    const family = this.getFamily(familyIndex);
    const familyRole = itemAt(nativeVocabulary.familyRoles, random);
    const name = familyMemberName(storyCharacter.name, family.surname, familyRole);
    const age = 18 + Math.floor(random() * 65);
    const traits = uniqueItems(TRAITS, random, 3);
    const rpgStats = characterRpgStatsForArchetype(storyCharacter.rpgArchetype);
    const physique = rpgStats["rpg.physique"];
    const technique = rpgStats["rpg.technique"];
    const intellect = rpgStats["rpg.intellect"];
    const charisma = rpgStats["rpg.charisma"];
    const will = rpgStats["rpg.will"];
    const creativity = rpgStats["rpg.creativity"];
    const withVariation = (value: number) => clamp(value + random() * 16 - 8, 10, 100);
    const stats = {
      cultivation: withVariation((will + creativity + intellect) / 3),
      martial: withVariation(physique * 0.55 + technique * 0.45),
      strategy: withVariation(intellect * 0.65 + will * 0.35),
      perception: withVariation(intellect * 0.5 + technique * 0.25 + will * 0.25),
      medicine: withVariation(intellect * 0.4 + will * 0.3 + technique * 0.3),
      crafting: withVariation(creativity * 0.45 + technique * 0.4 + intellect * 0.15),
      leadership: withVariation(charisma * 0.5 + will * 0.35 + intellect * 0.15),
      influence: withVariation(charisma * 0.65 + will * 0.2 + creativity * 0.15),
    };
    const statTotal = Object.values(stats).reduce((sum, value) => sum + value, 0);
    const institutionRole = uniqueItems(nativeVocabulary.roles, random, 2).join("／");
    const location = this.context?.location?.trim() || itemAt(nativeVocabulary.locations, random);
    const possessionPage = this.listCharacterPossessions(index, { limit: 4 });
    return deepFreeze({
      schemaVersion: SOCIAL_MATRIX_SCHEMA_VERSION,
      characterId,
      populationIndex: index,
      fictional: true,
      originPolicy: PROCEDURAL_ORIGIN_POLICY,
      canonicalStatus: "VIRTUAL_CANDIDATE",
      storyProfileId: storyCharacter.storyProfileId,
      storyAffinity: storyCharacter.storyAffinity,
      name,
      pronouns: itemAt(["她", "他", "其"] as const, random),
      age,
      lifeStage: age < 20 ? "少年" : age < 36 ? "青年" : age < 61 ? "壯年" : "長者",
      institutionId: institution.institutionId,
      institutionRole,
      familyId: this.familyId(familyIndex),
      familyRole,
      location,
      identity: `${institution.name}的${institutionRole}，目前常駐${location}`,
      goal: storyCharacter.goal,
      secret: itemAt(nativeVocabulary.secrets, random),
      personality: {
        traits,
        ambition: Math.floor(random() * 101),
        empathy: Math.floor(random() * 101),
        loyalty: Math.floor(random() * 101),
        caution: Math.floor(random() * 101),
        volatility: Math.floor(random() * 101),
        publicFace: `${storyCharacter.personality}；${itemAt(PUBLIC_FACES, random)}`,
        privateNeed: itemAt(PRIVATE_NEEDS, random),
      },
      abilities: {
        ...stats,
        powerTier: powerTier(statTotal),
        specialties: uniqueItems(nativeVocabulary.specialties, random, 3),
      },
      relationships: this.buildRelationships(index, familyIndex, institutionIndex, random),
      ownedTreasureCount: possessionPage.total,
      possessions: possessionPage.items,
      portrait: buildPortrait({
        seed: this.seed,
        characterId,
        name,
        visualSeed: storyCharacter.portrait.visualSeed,
        visualDescription: storyCharacter.portrait.visualDescription,
      }),
    });
  }

  getCharacter(index: number) {
    this.assertIndex(index);
    const cached = this.cache.get(index);
    if (cached) {
      this.cache.delete(index);
      this.cache.set(index, cached);
      this.cacheHits += 1;
      return cached;
    }
    this.cacheMisses += 1;
    const character = this.generate(index);
    if (this.cacheLimit > 0) {
      this.cache.set(index, character);
      if (this.cache.size > this.cacheLimit) {
        const oldest = this.cache.keys().next().value as number | undefined;
        if (oldest !== undefined) this.cache.delete(oldest);
        this.cacheEvictions += 1;
      }
    }
    return character;
  }

  getCharacterById(characterId: string) {
    const pattern = new RegExp(`^character-${this.seedTag}-([0-9a-z]+)$`, "u");
    const match = pattern.exec(characterId);
    if (!match) return null;
    const index = Number.parseInt(match[1], 36);
    return Number.isInteger(index) && index >= 0 && index < this.populationSize ? this.getCharacter(index) : null;
  }

  /**
   * Resolves both directions of one social edge. Undirected edges generated by
   * this matrix are exact mirrors; the effective fields also provide a
   * deterministic mirror when importing an older or partial record that only
   * contains one side.
   */
  getRelationshipPair(
    sourceIndex: number,
    targetIndex: number,
  ): SocialMatrixRelationshipPair {
    this.assertIndex(sourceIndex);
    this.assertIndex(targetIndex);
    if (sourceIndex === targetIndex) {
      throw new Error("SOCIAL_MATRIX_RELATIONSHIP_SELF_PAIR_INVALID");
    }
    const source = this.getCharacter(sourceIndex);
    const target = this.getCharacter(targetIndex);
    const forward = source.relationships.find(
      (relationship) => relationship.targetCharacterId === target.characterId,
    ) ?? null;
    const reverse = target.relationships.find(
      (relationship) => relationship.targetCharacterId === source.characterId,
    ) ?? null;
    let effectiveForward = forward;
    let effectiveReverse = reverse;
    let reciprocity: SocialMatrixRelationshipPair["reciprocity"] =
      "NO_RELATIONSHIP";

    if (forward && !forward.directed) {
      if (reverse && isExactRelationshipMirror(forward, reverse, source.characterId)) {
        reciprocity = "EXACT_RECIPROCAL";
      } else {
        effectiveReverse = mirrorUndirectedRelationship({
          relationship: forward,
          sourceCharacterId: source.characterId,
        });
        reciprocity = "SYNTHESIZED_RECIPROCAL";
      }
    } else if (reverse && !reverse.directed) {
      effectiveForward = mirrorUndirectedRelationship({
        relationship: reverse,
        sourceCharacterId: target.characterId,
      });
      reciprocity = "SYNTHESIZED_RECIPROCAL";
    } else if (forward || reverse) {
      reciprocity = "DIRECTED_NOT_REQUIRED";
    }

    return deepFreeze({
      sourceCharacterId: source.characterId,
      targetCharacterId: target.characterId,
      forward,
      reverse,
      effectiveForward,
      effectiveReverse,
      reciprocity,
    });
  }

  verifyCharacterRelationshipReciprocity(populationIndex: number) {
    const character = this.getCharacter(populationIndex);
    return character.relationships
      .filter((relationship) => !relationship.directed)
      .map((relationship) => {
        const target = this.getCharacterById(relationship.targetCharacterId);
        if (!target) throw new Error("SOCIAL_MATRIX_RELATIONSHIP_TARGET_NOT_FOUND");
        return this.getRelationshipPair(populationIndex, target.populationIndex);
      });
  }

  listCharacters(input: { cursor?: string; limit?: number } = {}): SocialMatrixPage<SocialMatrixCharacter> {
    const offset = parseCursor(input.cursor, "characters");
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 24)));
    if (offset < 0 || offset > this.populationSize) throw new Error("SOCIAL_MATRIX_CURSOR_OUT_OF_RANGE");
    const end = Math.min(this.populationSize, offset + limit);
    const items = Array.from({ length: end - offset }, (_, position) => this.getCharacter(offset + position));
    return { items, nextCursor: end < this.populationSize ? `characters:${end}` : null, total: this.populationSize };
  }

  private listBucketMembers(input: { bucket: number; count: number; salt: string; cursor?: string; cursorPrefix: string; limit?: number }) {
    const total = this.memberCount(input.bucket, input.count);
    const offset = parseCursor(input.cursor, input.cursorPrefix);
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 24)));
    if (offset < 0 || offset > total) throw new Error("SOCIAL_MATRIX_CURSOR_OUT_OF_RANGE");
    const end = Math.min(total, offset + limit);
    const items = Array.from({ length: end - offset }, (_, position) => this.getCharacter(
      this.memberIndexForBucket(input.bucket, offset + position, input.count, input.salt),
    ));
    return { items, nextCursor: end < total ? `${input.cursorPrefix}:${end}` : null, total };
  }

  listInstitutionMembers(institutionIndex: number, input: { cursor?: string; limit?: number } = {}) {
    this.institutionId(institutionIndex);
    return this.listBucketMembers({
      bucket: institutionIndex,
      count: this.institutionCount,
      salt: `${this.seed}:institution-index`,
      cursor: input.cursor,
      cursorPrefix: `institution-${institutionIndex}`,
      limit: input.limit,
    });
  }

  listFamilyMembers(familyIndex: number, input: { cursor?: string; limit?: number } = {}) {
    this.familyId(familyIndex);
    return this.listBucketMembers({
      bucket: familyIndex,
      count: this.familyCount,
      salt: `${this.seed}:family-index`,
      cursor: input.cursor,
      cursorPrefix: `family-${familyIndex}`,
      limit: input.limit,
    });
  }

  cacheStats() {
    return {
      limit: this.cacheLimit,
      materializedCharacters: this.cache.size,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      evictions: this.cacheEvictions,
    };
  }

  indexMetadata() {
    return {
      sourceLibraryVersion: PROCEDURAL_STORY_LIBRARY_VERSION,
      sourceCharacterCapacity: PROCEDURAL_CHARACTER_CAPACITY,
      sourceTreasureCapacity: PROCEDURAL_TREASURE_CAPACITY,
      sourceOwnershipVersion: PROCEDURAL_TREASURE_OWNERSHIP_VERSION,
      sourceClassificationVersion: PROCEDURAL_TREASURE_CLASSIFICATION_VERSION,
      originPolicy: PROCEDURAL_ORIGIN_POLICY,
      populationSize: this.populationSize,
      institutionCount: this.institutionCount,
      familyCount: this.familyCount,
      indexStrategy: "deterministic-invertible-virtual-index" as const,
      eagerlyMaterializedCharacters: 0,
      maximumPageSize: 100,
      cacheLimit: this.cacheLimit,
    };
  }
}

function socialCandidatePayload(input: { projectId: string; seedTag: string; character: SocialMatrixCharacter }) {
  return {
    schemaVersion: SOCIAL_MATRIX_SCHEMA_VERSION,
    projectId: input.projectId,
    seedTag: input.seedTag,
    character: input.character,
    canonicalMutation: 0,
  };
}

export async function createSocialCharacterCandidate(input: {
  projectId: string;
  matrix: DeterministicSocialMatrix;
  populationIndex: number;
  proposedAt: string;
  proposedBy?: SocialCharacterCandidate["proposedBy"];
}): Promise<SocialCharacterCandidate> {
  const projectId = input.projectId.trim();
  if (!projectId) throw new Error("SOCIAL_CHARACTER_PROJECT_REQUIRED");
  const character = input.matrix.getCharacter(input.populationIndex);
  const payloadFingerprint = await sha256Hex(stableStringify(socialCandidatePayload({ projectId, seedTag: input.matrix.seedTag, character })));
  return deepFreeze({
    schemaVersion: SOCIAL_MATRIX_SCHEMA_VERSION,
    candidateId: `social-character-candidate:${payloadFingerprint.slice(0, 32)}`,
    projectId,
    character,
    payloadFingerprint,
    proposedAt: input.proposedAt,
    proposedBy: input.proposedBy ?? "closed-ai",
    status: "PENDING_APPROVAL",
    canonicalMutation: 0,
    evidence: {
      generatorSeedTag: input.matrix.seedTag,
      populationIndex: input.populationIndex,
      generatorVersion: SOCIAL_MATRIX_SCHEMA_VERSION,
      storyLibraryVersion: PROCEDURAL_STORY_LIBRARY_VERSION,
      ownershipIndexVersion: PROCEDURAL_TREASURE_OWNERSHIP_VERSION,
      treasureClassificationVersion: PROCEDURAL_TREASURE_CLASSIFICATION_VERSION,
      portraitSource: "procedural-original-svg",
    },
  });
}

export async function approveSocialCharacterCandidate(input: {
  candidate: SocialCharacterCandidate;
  expectedPayloadFingerprint: string;
  approvedBy: string;
  approvedAt: string;
}): Promise<{ canonicalRecord: ApprovedSocialCharacter; approval: SocialCharacterApproval }> {
  const approvedBy = input.approvedBy.trim();
  if (!approvedBy) throw new Error("SOCIAL_CHARACTER_APPROVER_REQUIRED");
  if (input.candidate.status !== "PENDING_APPROVAL") throw new Error("SOCIAL_CHARACTER_CANDIDATE_NOT_APPROVABLE");
  const expected = await sha256Hex(stableStringify(socialCandidatePayload({
    projectId: input.candidate.projectId,
    seedTag: input.candidate.evidence.generatorSeedTag,
    character: input.candidate.character,
  })));
  if (expected !== input.candidate.payloadFingerprint || expected !== input.expectedPayloadFingerprint) {
    throw new Error("SOCIAL_CHARACTER_CANDIDATE_FINGERPRINT_MISMATCH");
  }
  const { canonicalStatus: _virtualStatus, ...character } = input.candidate.character;
  if (_virtualStatus !== "VIRTUAL_CANDIDATE") throw new Error("SOCIAL_CHARACTER_SOURCE_STATUS_INVALID");
  const canonicalRecord: ApprovedSocialCharacter = deepFreeze({
    ...character,
    canonicalStatus: "APPROVED",
    projectId: input.candidate.projectId,
    sourceCandidateId: input.candidate.candidateId,
    payloadFingerprint: expected,
    approvedAt: input.approvedAt,
    approvedBy,
  });
  const approvalIdentity = await sha256Hex(stableStringify({
    projectId: input.candidate.projectId,
    candidateId: input.candidate.candidateId,
    payloadFingerprint: expected,
    approvedAt: input.approvedAt,
    approvedBy,
  }));
  const approval: SocialCharacterApproval = deepFreeze({
    approvalId: `social-character-approval:${approvalIdentity.slice(0, 32)}`,
    projectId: input.candidate.projectId,
    candidateId: input.candidate.candidateId,
    payloadFingerprint: expected,
    approvedAt: input.approvedAt,
    approvedBy,
    decision: "APPROVED",
    canonicalMutation: 1,
  });
  return { canonicalRecord, approval };
}

export function isApprovedSocialCharacter(value: SocialMatrixCharacter | ApprovedSocialCharacter): value is ApprovedSocialCharacter {
  return value.canonicalStatus === "APPROVED";
}
