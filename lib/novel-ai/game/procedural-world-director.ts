import type { StoryChoiceEffect } from "../domain";
import type { RpgChoiceStrategy, RpgMode, RpgOutcome } from "./progression/rpg-progression";
import {
  buildApprovedStoryEndingFlags,
  storyEndingReaderDisclosure,
} from "./story-ending-contract";

export const PROCEDURAL_WORLD_DIRECTOR_VERSION = "procedural-world-director-v2" as const;
export const PROCEDURAL_ENCOUNTER_DEDUP_WINDOW = 24;
export const PROCEDURAL_SUCCESS_FACTOR_IDS = [
  "clear-catalyst",
  "bounded-goal",
  "escalating-pressure",
  "earned-leverage",
  "meaningful-resource-prop",
  "relationship-friction",
  "telegraphed-cost",
  "visible-deadline",
  "causal-reversal",
  "hopeful-aftermath",
] as const;

export type ProceduralProgressKind = "information" | "relationship" | "ability" | "resource" | "opportunity";
export type ProceduralArcPhase = "setup" | "escalation" | "reversal" | "climax" | "resolution";

export type ProceduralCausalRuleSignal = {
  ruleId: string;
  family: string;
  dimension: string;
  statement: string;
  operation: string;
  constraint: string;
  evaluate: string;
};

export type ProceduralCausalKnowledgeSnapshot = {
  snapshotVersion: string;
  snapshotDigest: string;
  selectedRuleIds: string[];
  signals: ProceduralCausalRuleSignal[];
  maximumRules: number;
  entireLibraryScanned: false;
};

const ROMANCE_TERM_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/經脈/gu, "情緒脈絡"], [/灵脉|靈脈/gu, "關係脈絡"], [/靈材|灵材/gu, "共同線索"],
  [/境界/gu, "關係階段"], [/功法/gu, "相處方式"], [/修行/gu, "關係成長"],
  [/吐納|吐纳/gu, "對話節奏"], [/共修|同修/gu, "共同面對"], [/師門|师门|宗門|宗门/gu, "社交圈"],
  [/師者|师者|導師|导师/gu, "前輩"], [/靈力|灵力/gu, "情緒力量"], [/靈場|灵场/gu, "現場氛圍"],
  [/反噬/gu, "信任反彈"], [/試煉|试炼/gu, "關係考驗"], [/突破/gu, "關係轉折"],
  [/靈氣|灵气/gu, "情緒氛圍"], [/煉製|炼制/gu, "共同準備"], [/靈域|灵域/gu, "私密空間"],
];

export function romanceSafeProceduralText(value: string) {
  return ROMANCE_TERM_REPLACEMENTS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

export function adaptProceduralEncounterForRomance(encounter: ProceduralEncounter): ProceduralEncounter {
  return Object.fromEntries(Object.entries(encounter).map(([key, value]) => [
    key,
    typeof value === "string" ? romanceSafeProceduralText(value) : value,
  ])) as ProceduralEncounter;
}

export function proceduralArcPhase(turn: number, horizon: number): ProceduralArcPhase {
  if (turn >= horizon) return "resolution";
  const ratio = turn / horizon;
  if (ratio < 0.25) return "setup";
  if (ratio < 0.5) return "escalation";
  if (ratio < 0.7) return "reversal";
  return "climax";
}

export type ProceduralEncounter = {
  signature: string;
  templateId: string;
  title: string;
  telegraph: string;
  complication: string;
  locationShift: string;
  worldAspect: string;
  /** These fields are rules-only composition evidence, never an LLM claim. */
  rulesOnly?: true;
  combinationOrdinal?: number;
  combinationSpace?: number;
  catalystId?: string;
  catalyst?: string;
  goalId?: string;
  goal?: string;
  pressureId?: string;
  pressure?: string;
  leverageId?: string;
  leverage?: string;
  resourcePropId?: string;
  resourceProp?: string;
  relationshipTensionId?: string;
  relationshipTension?: string;
  costId?: string;
  cost?: string;
  deadlineId?: string;
  deadline?: string;
  reversalId?: string;
  reversal?: string;
  aftermathId?: string;
  aftermath?: string;
  /** Persisted bounded-arc contract copied into the accepted effect. */
  arcKey?: string;
  arcGoal?: string;
  arcThread?: string;
  arcStartTurn?: number;
  arcLocalTurn?: number;
  arcHorizon?: number;
  arcPhase?: ProceduralArcPhase;
  arcResolved?: boolean;
  arcResolutionKind?: "complete" | "accept-cost" | "leave-consequence";
  arcNextAction?: "epilogue" | "new-arc" | "archive-ending";
};

type EncounterTemplate = Omit<ProceduralEncounter, "signature">;

const ENCOUNTERS: Record<RpgMode, EncounterTemplate[]> = {
  adventure: [
    { templateId: "moving-patrol", title: "移動巡邏線", telegraph: "遠處反覆出現不同節奏的金屬碰撞聲。", complication: "敵方巡邏位置正隨時間改變，舊路線不再可靠。", locationShift: "交錯巡邏區", worldAspect: "敵情" },
    { templateId: "false-safe-path", title: "偽裝安全路", telegraph: "最乾淨的道路反而沒有任何動物足跡。", complication: "看似安全的路線可能是誘導，真正出口藏在環境變化後。", locationShift: "誘導岔路", worldAspect: "地形" },
    { templateId: "weather-front", title: "突變天候", telegraph: "風向、氣味與雲層同時偏移。", complication: "天候會改寫視野、移動速度與敵我位置。", locationShift: "風暴邊界", worldAspect: "天候" },
    { templateId: "third-faction", title: "第三方介入", telegraph: "現場留下不屬於已知兩方的記號。", complication: "新的勢力有自己的目標，可能交易、觀望或攪局。", locationShift: "中立交界", worldAspect: "勢力" },
    { templateId: "living-ruin", title: "活化遺跡", telegraph: "牆面符號會在無人觸碰時改變位置。", complication: "遺跡依進入者的行動重新排列，不能只背固定步驟。", locationShift: "重組遺跡", worldAspect: "規則" },
    { templateId: "resource-migration", title: "資源遷移", telegraph: "原本稀少的痕跡突然集中到另一方向。", complication: "補給與稀有物已轉移，追逐它也可能暴露位置。", locationShift: "資源遷移帶", worldAspect: "資源" },
    { templateId: "echo-double", title: "回聲替身", telegraph: "同一個腳步聲從不可能的兩個方向傳來。", complication: "至少一個目標是誘餌，真正威脅會依玩家策略換位。", locationShift: "回聲廊道", worldAspect: "感知" },
    { templateId: "civilian-crossing", title: "無辜者穿越", telegraph: "衝突區出現與戰鬥無關的求救信號。", complication: "保護、繞行或利用現場，會留下不同道德與關係後果。", locationShift: "撤離通道", worldAspect: "倫理" },
  ],
  cultivation: [
    { templateId: "meridian-drift", title: "經脈潮汐", telegraph: "同一功法今日的靈力回聲比昨日慢半拍。", complication: "身體狀態正在改變，照抄上次修行步驟可能造成反噬。", locationShift: "靈脈潮汐點", worldAspect: "體質" },
    { templateId: "teacher-variation", title: "師承變式", telegraph: "指導者刻意省略了一個熟悉步驟。", complication: "考驗的是理解與調整，不是背誦招式。", locationShift: "變式演武場", worldAspect: "學習" },
    { templateId: "rival-observation", title: "對手觀察", telegraph: "旁觀者總在你重複舊招時記錄細節。", complication: "對手會針對常用策略準備反制，必須混合新方法。", locationShift: "公開試煉場", worldAspect: "競爭" },
    { templateId: "emotion-resonance", title: "情緒共振", telegraph: "心境波動讓周圍器物產生細小回音。", complication: "壓力、關係與未解心事會改變修行效果。", locationShift: "共鳴靜室", worldAspect: "心境" },
    { templateId: "rare-ingredient", title: "變質靈材", telegraph: "材料色澤正常，但氣味與重量不一致。", complication: "本批材料特性不同，配方需要重新校正。", locationShift: "浮動藥圃", worldAspect: "煉製" },
    { templateId: "realm-backwash", title: "境界回流", telegraph: "突破前兆提早出現，卻沒有完整閉環。", complication: "強行突破、穩固根基或轉化能量都會留下不同長期效果。", locationShift: "回流靈域", worldAspect: "境界" },
  ],
  management: [
    { templateId: "demand-shift", title: "需求轉向", telegraph: "詢問量上升，但顧客關心的問題已改變。", complication: "昨日暢銷方案不一定適用今天，產品與訊息需重新配對。", locationShift: "新客群市場", worldAspect: "市場" },
    { templateId: "supplier-delay", title: "供應延遲", telegraph: "交付節點先出現小幅偏差。", complication: "供應商、庫存與替代材料需要重新排序。", locationShift: "供應缺口", worldAspect: "供應" },
    { templateId: "staff-opportunity", title: "人才機會", telegraph: "團隊成員提出超出原職務的解法。", complication: "授權可能提高能力，也可能增加協調成本。", locationShift: "跨職能小組", worldAspect: "人力" },
    { templateId: "competitor-feint", title: "競爭假動作", telegraph: "對手公開訊息與實際資源流向不一致。", complication: "跟進、等待或另闢市場都有不同風險。", locationShift: "競爭情報區", worldAspect: "競爭" },
    { templateId: "quality-signal", title: "品質預警", telegraph: "退貨率尚低，但同類細節抱怨開始集中。", complication: "及早停線會損失收入，忽略則可能擴大成危機。", locationShift: "品質檢查站", worldAspect: "品質" },
    { templateId: "policy-window", title: "規則窗口", telegraph: "新制度仍有一段解釋空間。", complication: "合法調整流程可能創造先機，也會增加合規責任。", locationShift: "政策過渡期", worldAspect: "制度" },
  ],
};

type StoryDimension = { id: string; label: string; text: string };
type EncounterDimensions = {
  catalysts: StoryDimension[];
  goals: StoryDimension[];
  pressures: StoryDimension[];
  leverages: StoryDimension[];
  resourceProps: StoryDimension[];
  relationshipTensions: StoryDimension[];
  costs: StoryDimension[];
  deadlines: StoryDimension[];
  reversals: StoryDimension[];
  aftermaths: StoryDimension[];
};

const DIMENSIONS: Record<RpgMode, EncounterDimensions> = {
  adventure: {
    catalysts: [
      { id: "witness-signal", label: "目擊訊號", text: "一名目擊者留下只指向半段真相的訊號。" },
      { id: "route-collapse", label: "退路崩解", text: "原先標記的退路在眾人眼前失去作用。" },
      { id: "stolen-token", label: "信物易手", text: "能證明身分的信物出現在不該持有它的人手中。" },
      { id: "delayed-message", label: "遲到密訊", text: "一封延遲抵達的密訊推翻了原本的時間判斷。" },
      { id: "ally-separated", label: "同伴失聯", text: "負責接應的同伴突然中斷聯絡，只留下可追查的痕跡。" },
      { id: "enemy-mistake", label: "敵方失誤", text: "對手的一次倉促調度暴露出防線內部的不一致。" },
      { id: "civilian-request", label: "求援插入", text: "與任務無關的求援迫使行動者重新排序責任。" },
      { id: "sealed-object", label: "封存物甦醒", text: "一件被視為無效的封存物開始回應現場變化。" },
    ],
    goals: [
      { id: "secure-exit", label: "保住退路", text: "本回合目標是保住能讓眾人安全離場的退路。" },
      { id: "verify-truth", label: "驗明真相", text: "本回合目標是取得足以排除假情報的證據。" },
      { id: "protect-witness", label: "護住證人", text: "本回合目標是讓關鍵證人能自行說出完整經過。" },
      { id: "reach-target", label: "逼近目標", text: "本回合目標是在不失去後援的前提下逼近核心目標。" },
    ],
    pressures: [
      { id: "pursuit-closing", label: "追兵收網", text: "追兵正在縮短包圍間距，停留越久越難隱藏。" },
      { id: "terrain-cost", label: "地形耗損", text: "地形持續消耗體力，強行前進會犧牲撤退能力。" },
      { id: "identity-risk", label: "身分暴露", text: "每一次公開行動都會增加身分被辨認的可能。" },
      { id: "split-objective", label: "目標分裂", text: "救援與追查無法同時完成，延誤任何一方都會留下後果。" },
      { id: "resource-attrition", label: "補給流失", text: "現有補給正以可見速度耗損，不能等待完美方案。" },
      { id: "false-intel", label: "情報污染", text: "可靠情報混入一項刻意製造的錯誤，判斷必須重新驗證。" },
      { id: "ally-doubt", label: "同伴疑慮", text: "同伴開始質疑行動理由，合作仍在但不再無條件。" },
      { id: "public-consequence", label: "公眾後果", text: "現場選擇將被旁人記住，事後不能只用勝負解釋。" },
    ],
    leverages: [
      { id: "known-route", label: "已知路線", text: "可利用先前確認過的路線製造位置優勢。" },
      { id: "carried-tool", label: "攜行工具", text: "可把現有裝備改作一次性的觀測或掩護手段。" },
      { id: "ally-specialty", label: "同伴專長", text: "可請同伴用已知專長補足主角無法兼顧的一側。" },
      { id: "enemy-pattern", label: "敵方習慣", text: "可反用敵方已重複出現的行動習慣設置誤導。" },
      { id: "local-custom", label: "地方規矩", text: "可依當地既有規矩迫使第三方暫時表態。" },
      { id: "unpaid-favor", label: "未償人情", text: "可動用一項尚未償還的人情，但往後必須付出代價。" },
      { id: "visible-trace", label: "可見痕跡", text: "可把現場痕跡串成能被驗證的行動順序。" },
      { id: "controlled-retreat", label: "有限撤退", text: "可用有限撤退換取觀察時間，而不是直接放棄目標。" },
    ],
    resourceProps: [
      { id: "repurpose-carried-item", label: "改用攜行物", text: "關鍵資源不是新寶物，而是把既有攜行物改作標記與驗證。" },
      { id: "ration-stamina", label: "保留體力", text: "關鍵資源是尚存體力，必須分配在前進與撤退之間。" },
      { id: "spend-one-use", label: "一次性耗材", text: "關鍵資源只能使用一次，因此必須留給最能改變局面的節點。" },
      { id: "combine-clues", label: "組合線索", text: "關鍵資源是既有線索之間的交叉驗證，不會憑空新增情報。" },
    ],
    relationshipTensions: [
      { id: "ally-needs-reason", label: "同伴要求理由", text: "關係張力來自同伴願意協助，卻要求主角先說明真正目的。" },
      { id: "witness-fears-cost", label: "證人畏懼代價", text: "關係張力來自證人知道真相，卻擔心說出口會傷害身邊的人。" },
      { id: "rival-shares-interest", label: "對手暫時同利", text: "關係張力來自對手與主角暫時利益一致，但彼此都不信任。" },
      { id: "leader-tests-loyalty", label: "領隊檢驗承擔", text: "關係張力來自隊伍正在觀察主角是否願意承擔選擇後果。" },
    ],
    costs: [
      { id: "lose-position", label: "失去位置", text: "代價是放棄一個原本安全的位置。" },
      { id: "consume-supplies", label: "消耗補給", text: "代價是消耗已持有的補給與行動餘裕。" },
      { id: "expose-intent", label: "暴露意圖", text: "代價是讓對手更清楚主角真正想保護的目標。" },
      { id: "accept-obligation", label: "承擔義務", text: "代價是接受一項之後必須履行的具體義務。" },
    ],
    deadlines: [
      { id: "before-dawn", label: "黎明前", text: "必須在黎明前完成關鍵步驟。" },
      { id: "one-patrol", label: "一輪巡邏", text: "下一輪巡邏抵達前只剩一次完整行動。" },
      { id: "weather-turn", label: "天候轉折", text: "風向再次改變後，現有路線就會失效。" },
      { id: "signal-fades", label: "訊號消退", text: "線索的可辨識訊號正在快速消退。" },
      { id: "witness-leaves", label: "證人離場", text: "唯一能確認細節的證人即將被帶離現場。" },
      { id: "gate-closes", label: "關口封閉", text: "通往目標的關口只會再開放短暫一次。" },
      { id: "ally-endurance", label: "同伴極限", text: "同伴只能再支撐一段路程，不能無限拖延。" },
      { id: "enemy-handoff", label: "敵方交接", text: "敵方完成交接後，現有破綻就會消失。" },
    ],
    reversals: [
      { id: "success-draws-attention", label: "成功引來注意", text: "即使成功，也會讓更高層的追蹤者注意到行動者。" },
      { id: "rescued-knows-less", label: "救援資訊不足", text: "救下的人並不知道全貌，只能提供下一段方向。" },
      { id: "enemy-protects-clue", label: "敵人保護線索", text: "看似阻路的敵人其實也在保護同一條線索。" },
      { id: "shortcut-exacts-debt", label: "捷徑留下債務", text: "捷徑可以使用，但會形成日後必須償還的責任。" },
      { id: "evidence-implicates-ally", label: "證據牽連同伴", text: "新證據把一名同伴也拉進嫌疑範圍。" },
    ],
    aftermaths: [
      { id: "tool-damaged", label: "裝備受損", text: "行動會讓一件現有工具暫時失去完整效能。" },
      { id: "route-marked", label: "路線留痕", text: "撤離路線會留下可被敵我雙方追查的記號。" },
      { id: "favor-owed", label: "欠下人情", text: "得到協助的同時，也欠下一次必須回應的人情。" },
      { id: "clue-fragment", label: "線索碎片", text: "現場只留下能指向下一站、卻不足以結案的碎片。" },
      { id: "enemy-adapts", label: "敵方學習", text: "敵方會記住這次策略，下一次同樣手法的效果將降低。" },
      { id: "ally-exhausted", label: "同伴耗竭", text: "同行者完成協助後需要一段恢復時間。" },
      { id: "public-rumor", label: "傳聞擴散", text: "目擊者會把不完整版本傳出去，形成新的聲望壓力。" },
      { id: "safehouse-exposed", label: "據點曝露", text: "原本安全的落腳處因此不再能長期使用。" },
      { id: "counter-route", label: "反向通路", text: "後果同時打開一條危險但可利用的反向通路。" },
    ],
  },
  cultivation: {
    catalysts: [
      { id: "breath-desync", label: "吐納失拍", text: "原本穩定的吐納在關鍵一息突然失去同步。" },
      { id: "mentor-question", label: "師者追問", text: "指導者不給答案，反而要求說明每一步的因果。" },
      { id: "rival-challenge", label: "同輩挑戰", text: "同輩在眾人面前提出一項無法迴避的驗證。" },
      { id: "ingredient-reaction", label: "靈材異應", text: "既有靈材對主角當前狀態產生與記錄不同的反應。" },
      { id: "old-vow-echo", label: "舊誓回響", text: "先前立下的承諾在修行時形成可感知的回響。" },
      { id: "realm-omen", label: "境界假兆", text: "突破徵兆提早出現，卻缺少一項必要閉環。" },
      { id: "companion-instability", label: "同修不穩", text: "同行者的狀態開始波動，兩人的節奏互相影響。" },
      { id: "sealed-method", label: "殘式顯文", text: "殘缺功法只在目前條件下顯出一段新文字。" },
    ],
    goals: [
      { id: "stabilize-state", label: "穩住狀態", text: "本回合目標是先穩住身心，保留下一輪修行能力。" },
      { id: "verify-method", label: "驗證功法", text: "本回合目標是辨明功法變化來自規則還是誤判。" },
      { id: "repair-trust", label: "修補信任", text: "本回合目標是在不越過界線的前提下修補合作信任。" },
      { id: "complete-trial", label: "完成試煉", text: "本回合目標是以現有境界完成試煉，而非跳級突破。" },
    ],
    pressures: [
      { id: "meridian-strain", label: "經脈負荷", text: "繼續強行運轉會提高經脈負荷與後續反噬。" },
      { id: "trust-friction", label: "信任摩擦", text: "隱瞞代價會傷害信任，坦白也可能失去合作機會。" },
      { id: "limited-material", label: "材料有限", text: "關鍵材料只夠支持一種處理方式。" },
      { id: "public-evaluation", label: "公開評量", text: "每個調整都在旁觀者眼前，結果將改變後續評價。" },
      { id: "inner-conflict", label: "心境衝突", text: "未解心事正干擾判斷，不能只靠重複口訣壓下。" },
      { id: "rival-counter", label: "對手反制", text: "對手已看懂常用做法，再次照搬會被直接克制。" },
      { id: "unstable-environment", label: "靈場不穩", text: "周圍靈場持續偏移，等待會讓條件更加陌生。" },
      { id: "promise-cost", label: "承諾代價", text: "接受協助就必須履行先前尚未完成的承諾。" },
    ],
    leverages: [
      { id: "known-breath", label: "既有吐納", text: "可拆解已掌握的吐納節奏，找出失衡發生的位置。" },
      { id: "companion-feedback", label: "同伴回饋", text: "可用同行者的真實感受校正主角無法自察的偏差。" },
      { id: "recorded-failure", label: "失敗紀錄", text: "可把上次失敗留下的紀錄反用為排除條件。" },
      { id: "available-material", label: "現有靈材", text: "可用現有材料做小規模驗證，不必孤注一擲。" },
      { id: "world-rule", label: "已知規則", text: "可依已確認的世界規則限制風險擴散範圍。" },
      { id: "rival-assumption", label: "對手假設", text: "可利用對手對常用招式的預判安排一次變式。" },
      { id: "relationship-boundary", label: "關係界線", text: "可把彼此已同意的界線轉化為穩定共鳴的條件。" },
      { id: "unresolved-thread", label: "未解心結", text: "可正面處理未解心結，換取心境與行動的一致。" },
    ],
    resourceProps: [
      { id: "measured-material", label: "定量靈材", text: "關鍵資源是現有靈材，只能用於一次小規模驗證。" },
      { id: "breath-reserve", label: "吐納餘裕", text: "關鍵資源是尚存的吐納餘裕，必須保留安全收功的份量。" },
      { id: "written-record", label: "既有紀錄", text: "關鍵資源是先前留下的修行紀錄，可用來比對偏差。" },
      { id: "consented-support", label: "自願協助", text: "關鍵資源是同行者明確同意提供的協助，不能被當成可任意支配的能力。" },
    ],
    relationshipTensions: [
      { id: "truth-or-distance", label: "坦白或疏離", text: "關係張力來自坦白限制可能換得理解，也可能拉開距離。" },
      { id: "mentor-withholds", label: "師者保留", text: "關係張力來自指導者願意糾錯，卻拒絕替主角作決定。" },
      { id: "rival-respect", label: "競爭中的尊重", text: "關係張力來自對手承認能力，卻會利用任何重複與鬆懈。" },
      { id: "companion-boundary", label: "同修界線", text: "關係張力來自同行者願意共修，但要求每一步都能撤回同意。" },
    ],
    costs: [
      { id: "slow-progress", label: "放慢進度", text: "代價是放慢本輪修行進度以換取穩定。" },
      { id: "spend-material", label: "耗用材料", text: "代價是耗用一份既有材料，不能自動補回。" },
      { id: "raise-attention", label: "增加關注", text: "代價是讓師門與同輩更注意主角的特殊狀態。" },
      { id: "owe-answer", label: "欠下答覆", text: "代價是承諾在後續回合正面回答一項未解問題。" },
    ],
    deadlines: [
      { id: "before-next-cycle", label: "下輪吐納前", text: "下一輪吐納開始前必須決定是否調整。" },
      { id: "incense-burn", label: "一炷香", text: "現有穩定狀態只能維持一炷香。" },
      { id: "mentor-departs", label: "師者離場", text: "指導者離場後就不會再提供即時校正。" },
      { id: "material-decays", label: "靈材衰退", text: "靈材效性正在衰退，拖延會降低可驗證性。" },
      { id: "emotion-peaks", label: "情緒峰值", text: "情緒共振抵達峰值後，當前窗口就會關閉。" },
      { id: "trial-bell", label: "試煉鐘響", text: "試煉鐘再次響起前只容許一次完整嘗試。" },
      { id: "realm-backwash", label: "靈力回流", text: "靈力下一次回流前必須建立安全出口。" },
      { id: "promise-due", label: "承諾到期", text: "約定的答覆必須在本回合結束前交付。" },
    ],
    reversals: [
      { id: "stability-slows-growth", label: "穩定換取慢速", text: "穩住狀態會放慢成長，卻保留後續選擇。" },
      { id: "breakthrough-is-warning", label: "突破其實是警訊", text: "看似突破的徵兆其實是失衡即將擴大的警訊。" },
      { id: "rival-needs-help", label: "對手也需協助", text: "提出挑戰的對手其實同樣受困於這項變化。" },
      { id: "method-tests-honesty", label: "功法驗證坦白", text: "功法真正驗證的是是否如實面對限制，而非力量高低。" },
      { id: "ingredient-mirrors-state", label: "靈材映照心境", text: "靈材異常只是把主角未處理的狀態放大顯現。" },
    ],
    aftermaths: [
      { id: "method-fatigue", label: "功法疲勞", text: "本次運轉會讓同一功法短期內難以再次全力使用。" },
      { id: "material-spent", label: "靈材消耗", text: "驗證會消耗一份既有材料，不能憑空補回。" },
      { id: "trust-question", label: "信任待答", text: "同行者會保留一個必須在後續回合回答的疑問。" },
      { id: "rival-records", label: "對手記招", text: "旁觀對手會記下變式，迫使下一次採用不同組合。" },
      { id: "meridian-rest", label: "經脈休養", text: "經脈需要休養，短期內必須降低同類行動強度。" },
      { id: "new-insight", label: "心得未證", text: "獲得的心得仍只是候選理解，必須再經實際驗證。" },
      { id: "vow-deepens", label: "誓約加深", text: "接受共修協助會讓既有承諾承擔更明確的責任。" },
      { id: "attention-rises", label: "宗門留意", text: "公開表現會提高宗門與同輩對主角的關注。" },
      { id: "hidden-branch", label: "支脈顯現", text: "結果會顯出一條尚未成熟、不可立即升級的修行支脈。" },
    ],
  },
  management: {
    catalysts: [
      { id: "order-spike", label: "訂單突增", text: "一批超出產能的訂單在同一時間湧入。" },
      { id: "staff-proposal", label: "員工提案", text: "基層成員提出一項會改變既有分工的方案。" },
      { id: "supplier-change", label: "供應異動", text: "主要供應商臨時改變交付條件。" },
      { id: "quality-complaint", label: "品質訊號", text: "少量但高度一致的品質抱怨開始出現。" },
      { id: "competitor-price", label: "競價突襲", text: "競爭者用短期限價吸走最敏感的客群。" },
      { id: "public-review", label: "公開評價", text: "一則可被查證的公開評價迅速擴散。" },
      { id: "policy-notice", label: "制度通知", text: "新制度的執行日期比預期更早公布。" },
      { id: "key-client-request", label: "關鍵客戶要求", text: "關鍵客戶要求一項會排擠其他工作的臨時調整。" },
    ],
    goals: [
      { id: "preserve-runway", label: "守住現金線", text: "本回合目標是守住能維持下一輪營運的現金安全線。" },
      { id: "protect-quality", label: "保住品質", text: "本回合目標是在交付壓力下保住可驗證的品質底線。" },
      { id: "retain-team", label: "穩住團隊", text: "本回合目標是重新分工並避免關鍵人力流失。" },
      { id: "capture-window", label: "抓住窗口", text: "本回合目標是用有限投入抓住即將關閉的市場窗口。" },
    ],
    pressures: [
      { id: "cash-runway", label: "現金期限", text: "可用現金只允許一次主要投入，不能同時押注所有方向。" },
      { id: "staff-fatigue", label: "人力疲勞", text: "團隊已接近負荷上限，追加工作會降低穩定度。" },
      { id: "quality-risk", label: "品質風險", text: "趕工能換取速度，但瑕疵會累積為可追溯的責任。" },
      { id: "reputation-exposure", label: "聲望曝險", text: "處理過程正被外界觀察，沉默本身也會被解讀。" },
      { id: "supplier-dependence", label: "供應依賴", text: "替代方案仍依賴同一個脆弱節點，不能假裝風險消失。" },
      { id: "internal-disagreement", label: "內部歧見", text: "不同部門對優先順序沒有共識，執行成本正在上升。" },
      { id: "customer-churn", label: "客戶流失", text: "延遲一天都會增加一批客戶離開的可能。" },
      { id: "compliance-duty", label: "合規責任", text: "任何捷徑都必須留下可稽核紀錄，否則後果會放大。" },
    ],
    leverages: [
      { id: "cash-reserve", label: "現金緩衝", text: "可動用有限現金緩衝換取調整時間。" },
      { id: "staff-specialty", label: "團隊專長", text: "可重排人力，讓既有專長處理最容易失守的一環。" },
      { id: "quality-data", label: "品質資料", text: "可用現有品質資料先鎖定問題範圍。" },
      { id: "reputation-credit", label: "聲望信用", text: "可用已累積的聲望換取一次透明溝通的空間。" },
      { id: "supplier-alternative", label: "替代供應", text: "可啟用成本較高但已驗證的替代供應。" },
      { id: "customer-segment", label: "客群分流", text: "可把需求依承諾與風險分流，而非全面接受或拒絕。" },
      { id: "competitor-gap", label: "競爭缺口", text: "可利用競爭者尚未覆蓋的服務缺口建立差異。" },
      { id: "process-audit", label: "流程稽核", text: "可用一次快速稽核找出資源真正被卡住的位置。" },
    ],
    resourceProps: [
      { id: "cash-envelope", label: "資金額度", text: "關鍵資源是已確認的資金額度，只能支持一項主要投入。" },
      { id: "staff-hours", label: "可用工時", text: "關鍵資源是團隊剩餘工時，必須保留恢復與交接空間。" },
      { id: "quality-evidence", label: "品質證據", text: "關鍵資源是現有品質紀錄，可用來縮小問題範圍。" },
      { id: "reputation-credit", label: "聲望信用", text: "關鍵資源是過往累積的信用，只能承擔一次公開說明。" },
    ],
    relationshipTensions: [
      { id: "team-disagrees", label: "團隊歧見", text: "關係張力來自團隊對速度與品質的優先順序沒有共識。" },
      { id: "client-tests-trust", label: "客戶試探信任", text: "關係張力來自客戶願意等待，卻要求看見可驗證承諾。" },
      { id: "supplier-bargains", label: "供應商談判", text: "關係張力來自供應商能提供協助，但要求更長期的交換。" },
      { id: "leader-owns-result", label: "領導承擔", text: "關係張力來自團隊正在判斷負責人是否會承擔失敗結果。" },
    ],
    costs: [
      { id: "lock-cash", label: "鎖定資金", text: "代價是讓一部分資金短期內不能轉作他用。" },
      { id: "spend-morale", label: "消耗士氣", text: "代價是增加團隊負荷並消耗一部分士氣。" },
      { id: "narrow-quality", label: "縮減範圍", text: "代價是縮減本輪交付範圍以守住核心品質。" },
      { id: "public-accountability", label: "公開負責", text: "代價是留下可被客戶與團隊追蹤的公開承諾。" },
    ],
    deadlines: [
      { id: "before-payroll", label: "發薪前", text: "必須在下一次發薪前保住現金安全線。" },
      { id: "delivery-window", label: "交付窗口", text: "本輪交付窗口關閉後，訂單將自動轉往他處。" },
      { id: "shift-change", label: "交班前", text: "團隊交班前只夠完成一項主要調度。" },
      { id: "review-publishes", label: "評價擴散前", text: "公開評價全面擴散前仍有一次主動回應機會。" },
      { id: "supplier-cutoff", label: "供應截止", text: "供應商的保留額度即將失效。" },
      { id: "policy-effective", label: "制度生效", text: "新制度生效前必須完成流程與紀錄調整。" },
      { id: "client-meeting", label: "客戶會議", text: "關鍵客戶會議前只能提出一份可執行方案。" },
      { id: "competitor-launch", label: "競品上線", text: "競品正式上線後，目前的市場窗口就會縮小。" },
    ],
    reversals: [
      { id: "growth-reveals-bottleneck", label: "成長暴露瓶頸", text: "訂單成長反而暴露出最脆弱的流程瓶頸。" },
      { id: "complaint-is-systemic", label: "抱怨來自系統", text: "看似個案的抱怨其實指向可重複發生的系統問題。" },
      { id: "rival-tests-market", label: "對手只在試探", text: "競爭者的激烈動作可能只是測試市場反應。" },
      { id: "supplier-seeks-partnership", label: "供應商另有所求", text: "改變條件的供應商其實在測試長期合作意願。" },
      { id: "staff-resistance-protects-quality", label: "反對是品質警報", text: "團隊的反對並非消極，而是在保護一項即將失守的品質底線。" },
    ],
    aftermaths: [
      { id: "cash-locked", label: "資金鎖定", text: "投入資金會在數個回合內無法轉作其他用途。" },
      { id: "staff-recovery", label: "人力恢復", text: "參與執行的團隊需要恢復，下一輪可用人力會受限制。" },
      { id: "quality-debt", label: "品質債", text: "趕工留下的品質債必須排入後續修復計畫。" },
      { id: "reputation-promise", label: "公開承諾", text: "對外說明會形成可被檢查的公開承諾。" },
      { id: "supplier-obligation", label: "供應義務", text: "啟用替代供應同時會增加新的交付義務。" },
      { id: "customer-expectation", label: "客戶期待", text: "成功處理會提高客戶對下一次服務的期待。" },
      { id: "competitor-response", label: "競爭回應", text: "競爭者會依本次策略調整下一輪市場動作。" },
      { id: "audit-trail", label: "稽核軌跡", text: "流程調整會留下需要持續維護的稽核軌跡。" },
      { id: "team-learning", label: "團隊學習", text: "團隊會保留這次經驗，但也會要求後續決策維持一致。" },
    ],
  },
};

function hashText(value: string) {
  let hash = 2166136261;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function parseRecentEncounterSignatures(value: unknown) {
  if (typeof value !== "string") return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean).slice(-PROCEDURAL_ENCOUNTER_DEDUP_WINDOW);
}

function combinationSpace(mode: RpgMode) {
  const dimensions = DIMENSIONS[mode];
  return ENCOUNTERS[mode].length
    * dimensions.catalysts.length
    * dimensions.goals.length
    * dimensions.pressures.length
    * dimensions.leverages.length
    * dimensions.resourceProps.length
    * dimensions.relationshipTensions.length
    * dimensions.costs.length
    * dimensions.deadlines.length
    * dimensions.reversals.length
    * dimensions.aftermaths.length;
}

export function proceduralEncounterCombinationSpace(mode: RpgMode) {
  return combinationSpace(mode);
}

function decodeCombination(mode: RpgMode, rawOrdinal: number) {
  const templates = ENCOUNTERS[mode];
  const dimensions = DIMENSIONS[mode];
  const space = combinationSpace(mode);
  let cursor = ((Math.trunc(rawOrdinal) % space) + space) % space;
  const take = <T,>(values: T[]) => {
    const value = values[cursor % values.length];
    cursor = Math.floor(cursor / values.length);
    return value;
  };
  const reversal = take(dimensions.reversals);
  const deadline = take(dimensions.deadlines);
  const cost = take(dimensions.costs);
  const relationshipTension = take(dimensions.relationshipTensions);
  const resourceProp = take(dimensions.resourceProps);
  const leverage = take(dimensions.leverages);
  const pressure = take(dimensions.pressures);
  const goal = take(dimensions.goals);
  const catalyst = take(dimensions.catalysts);
  const template = take(templates);
  const aftermath = take(dimensions.aftermaths);
  const signature = [
    mode,
    template.templateId,
    catalyst.id,
    goal.id,
    pressure.id,
    leverage.id,
    resourceProp.id,
    relationshipTension.id,
    cost.id,
    deadline.id,
    reversal.id,
    aftermath.id,
  ].join(":");
  return { template, catalyst, goal, pressure, leverage, resourceProp, relationshipTension, cost, deadline, reversal, aftermath, signature };
}

export function proceduralEncounterSignatureAt(mode: RpgMode, ordinal: number) {
  return decodeCombination(mode, ordinal).signature;
}

export function proceduralEncounterAt(mode: RpgMode, rawOrdinal: number): ProceduralEncounter {
  const space = combinationSpace(mode);
  const ordinal = ((Math.trunc(rawOrdinal) % space) + space) % space;
  const selected = decodeCombination(mode, ordinal);
  return {
    ...selected.template,
    signature: selected.signature,
    title: `${selected.template.title}・${selected.catalyst.label}`,
    telegraph: `${selected.template.telegraph}${selected.catalyst.text}${selected.goal.text}`,
    complication: `${selected.template.complication}${selected.pressure.text}${selected.relationshipTension.text}${selected.cost.text}`,
    locationShift: `${selected.template.locationShift}・${selected.leverage.label}・${selected.resourceProp.label}`,
    worldAspect: `${selected.template.worldAspect}／${selected.deadline.label}／${selected.reversal.label}／${selected.aftermath.label}`,
    rulesOnly: true,
    combinationOrdinal: ordinal,
    combinationSpace: space,
    catalystId: selected.catalyst.id,
    catalyst: selected.catalyst.text,
    goalId: selected.goal.id,
    goal: selected.goal.text,
    pressureId: selected.pressure.id,
    pressure: selected.pressure.text,
    leverageId: selected.leverage.id,
    leverage: selected.leverage.text,
    resourcePropId: selected.resourceProp.id,
    resourceProp: selected.resourceProp.text,
    relationshipTensionId: selected.relationshipTension.id,
    relationshipTension: selected.relationshipTension.text,
    costId: selected.cost.id,
    cost: selected.cost.text,
    deadlineId: selected.deadline.id,
    deadline: selected.deadline.text,
    reversalId: selected.reversal.id,
    reversal: selected.reversal.text,
    aftermathId: selected.aftermath.id,
    aftermath: selected.aftermath.text,
  };
}

export function buildProceduralEncounter(input: {
  runSeed: string;
  mode: RpgMode;
  turn: number;
  strategy: RpgChoiceStrategy;
  variant?: number;
  recentSignatures?: string[];
  causalKnowledgeDigest?: string;
}): ProceduralEncounter {
  const space = combinationSpace(input.mode);
  const knowledgeDigest = input.causalKnowledgeDigest?.trim() ?? "";
  const base = `${input.runSeed}|${input.mode}|${input.turn}|${input.strategy}|${input.variant ?? 0}|${knowledgeDigest}`;
  const start = hashText(base) % space;
  const recent = new Set(input.recentSignatures ?? []);
  const stride = 7_919;
  let ordinal = start;
  for (let offset = 0; offset <= Math.min(recent.size, PROCEDURAL_ENCOUNTER_DEDUP_WINDOW); offset += 1) {
    ordinal = (start + offset * stride) % space;
    const candidate = decodeCombination(input.mode, ordinal);
    if (!recent.has(candidate.signature) || offset === Math.min(recent.size, PROCEDURAL_ENCOUNTER_DEDUP_WINDOW)) {
      break;
    }
  }
  const encounter = proceduralEncounterAt(input.mode, ordinal);
  return knowledgeDigest
    ? {
        ...encounter,
        signature: `${encounter.signature}:learned-${knowledgeDigest.slice(0, 12)}`,
      }
    : encounter;
}

type ProceduralInferenceDimensions = {
  catalyst: string;
  goal: string;
  pressure: string;
  leverage: string;
  resourceProp: string;
  relationshipTension: string;
  cost: string;
  deadline: string;
  reversal: string;
  aftermath: string;
};

const RULE_DIMENSION_TARGET: Record<string, keyof ProceduralInferenceDimensions> = {
  opening_hook: "catalyst",
  viewpoint: "goal",
  character_pressure: "pressure",
  information_control: "leverage",
  world_rule_delivery: "resourceProp",
  relationship_movement: "relationshipTension",
  dialogue_density: "relationshipTension",
  tone: "cost",
  sentence_rhythm: "pressure",
  paragraph_rhythm: "deadline",
  scene_transition: "deadline",
  reveal_cadence: "reversal",
  foreshadow_payoff: "reversal",
  ending_hook: "aftermath",
  conflict_escalation: "pressure",
  other: "leverage",
};

function compactRuleInstruction(value: string, maximum = 84) {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, maximum - 1)}…`;
}

function applyApprovedCausalSignals(
  dimensions: ProceduralInferenceDimensions,
  snapshot?: ProceduralCausalKnowledgeSnapshot,
) {
  const next = { ...dimensions };
  const appliedRuleIds: string[] = [];
  if (!snapshot) return { dimensions: next, appliedRuleIds };
  const selectedIds = new Set(snapshot.selectedRuleIds.slice(0, snapshot.maximumRules));
  for (const signal of snapshot.signals.slice(0, snapshot.maximumRules)) {
    if (!selectedIds.has(signal.ruleId)) continue;
    const target = RULE_DIMENSION_TARGET[signal.dimension]
      ?? (Object.keys(next) as Array<keyof ProceduralInferenceDimensions>)[
        hashText(`${signal.family}|${signal.dimension}|${signal.ruleId}`) % 10
      ];
    const operation = compactRuleInstruction(signal.operation || signal.statement);
    const constraint = compactRuleInstruction(signal.constraint, 56);
    next[target] = `${next[target]} 核准規則校準：${operation}${constraint ? `；限制：${constraint}` : ""}`;
    appliedRuleIds.push(signal.ruleId);
  }
  return { dimensions: next, appliedRuleIds };
}

export function buildProceduralCausalFrame(input: {
  encounter: ProceduralEncounter;
  protagonist: string;
  supportingCharacter: string;
  location: string;
  conflict: string;
  unresolvedThread: string;
  availableResource: string;
  outcome?: RpgOutcome;
  consecutiveSetbacks?: number;
  arcKey?: string;
  turn?: number;
  arcHorizon?: number;
  approvedEnding?: boolean;
  causalKnowledge?: ProceduralCausalKnowledgeSnapshot;
}) {
  const encounter = input.encounter;
  const learned = applyApprovedCausalSignals({
    catalyst: encounter.catalyst ?? encounter.telegraph,
    goal: encounter.goal ?? "本回合必須完成一項可驗證、但有限的目標。",
    pressure: encounter.pressure ?? encounter.complication,
    leverage: encounter.leverage ?? `只能使用${input.availableResource}與既有線索`,
    resourceProp: encounter.resourceProp ?? "關鍵資源只能來自作品已存在的條件。",
    relationshipTension: encounter.relationshipTension ?? "合作仍需經過人物立場與界線的檢驗。",
    cost: encounter.cost ?? "採取行動必須支付可追蹤的代價。",
    deadline: encounter.deadline ?? "本回合結束前必須作出取捨。",
    reversal: encounter.reversal ?? "結果會留下可追查、可回應的後果。",
    aftermath: encounter.aftermath ?? "既有狀態會保留這次行動留下的餘波。",
  }, input.causalKnowledge);
  const {
    catalyst,
    goal,
    pressure,
    leverage,
    resourceProp,
    relationshipTension,
    cost,
    deadline,
    reversal,
    aftermath,
  } = learned.dimensions;
  const setbackCount = Math.max(0, Math.trunc(input.consecutiveSetbacks ?? 0));
  const progressKinds: ProceduralProgressKind[] = setbackCount >= 2
    ? ["resource", "opportunity", "relationship", "information", "ability"]
    : ["information", "relationship", "ability", "resource", "opportunity"];
  const progressKind = progressKinds[hashText(`${encounter.signature}|${setbackCount}|${input.outcome ?? "pending"}`) % progressKinds.length];
  const progressBeatByKind: Record<ProceduralProgressKind, string> = {
    information: `即使原目標受挫，眾人仍會從「${input.unresolvedThread}」取得一項可驗證的情報進展，不會空手回到原點。`,
    relationship: `${input.supportingCharacter}會根據承擔與坦白調整合作界線，因此關係仍有一小步可追蹤的進展。`,
    ability: `${input.protagonist}會把本次阻力整理成可重用的判斷能力，下一輪不必重犯同一個錯誤。`,
    resource: `行動至少保住或回收一部分「${input.availableResource}」，讓下一輪仍有可負擔的穩健路線。`,
    opportunity: `結果會打開一個可在下一輪回應的機會窗口，而不是把三條路都封死。`,
  };
  const recoveryBias = setbackCount >= 3 ? "high" : setbackCount >= 1 ? "raised" : "normal";
  const recoveryBeat = setbackCount >= 3
    ? "連續挫敗已提高恢復、喘息與延遲回報的權重；下一輪至少保留一條低成本止損路線，累積成果也會更容易被兌現。"
    : setbackCount >= 1
      ? "前次受挫會提高下一輪穩定與恢復路線的優先度，避免局勢只剩加碼冒險。"
      : "局勢仍保留穩定、恢復與高風險突破的不同節奏，不把成功當成保證。";
  const progressBeat = progressBeatByKind[progressKind];
  const turn = Math.max(0, Math.trunc(input.turn ?? 0));
  const arcHorizon = Math.max(4, Math.trunc(input.arcHorizon ?? 8));
  const arcKey = input.arcKey?.trim() || `arc-${hashText([
    input.protagonist,
    input.conflict,
    input.unresolvedThread,
  ].join("|")).toString(16).padStart(8, "0")}`;
  const phase = proceduralArcPhase(turn, arcHorizon);
  const causalChainAction = phase === "resolution" ? "recover" : "advance";
  const persistentGoal = input.conflict;
  const endingDisclosure = storyEndingReaderDisclosure({
    phase,
    approvedEnding: input.approvedEnding === true,
  });
  const closureBeat = endingDisclosure.readerBeat;
  return {
    rulesOnly: true as const,
    successFactorIds: PROCEDURAL_SUCCESS_FACTOR_IDS,
    popularityGuaranteed: false as const,
    persistentArc: {
      arcKey,
      goal: persistentGoal,
      unresolvedThread: input.unresolvedThread,
      turn,
      horizon: arcHorizon,
      phase,
      causalChainAction,
      newSubplotBudget: phase === "setup" && turn === 0 ? 1 : 0,
      endingReachable: true as const,
      endingOptionsRequired: phase === "resolution",
      closureBeat,
      readerDisclosure: endingDisclosure,
    },
    inferenceDimensions: {
      catalyst,
      goal,
      pressure,
      leverage,
      resourceProp,
      relationshipTension,
      cost,
      deadline,
      reversal,
      aftermath,
    },
    causalKnowledge: input.causalKnowledge ? {
      snapshotVersion: input.causalKnowledge.snapshotVersion,
      snapshotDigest: input.causalKnowledge.snapshotDigest,
      selectedRuleIds: input.causalKnowledge.selectedRuleIds.slice(0, input.causalKnowledge.maximumRules),
      appliedRuleIds: learned.appliedRuleIds,
      maximumRules: input.causalKnowledge.maximumRules,
      entireLibraryScanned: false as const,
    } : null,
    contextSignature: hashText([
      encounter.signature,
      input.causalKnowledge?.snapshotDigest ?? "no-approved-learning",
      input.protagonist,
      input.supportingCharacter,
      input.location,
      input.conflict,
      input.unresolvedThread,
      input.availableResource,
    ].join("|")).toString(16).padStart(8, "0"),
    incitingBeat: `在${input.location}，${catalyst}${goal}${input.protagonist}因而必須回應「${input.conflict}」，不能把作品硬切成另一個無關題材。`,
    pressureBeat: `${pressure}${relationshipTension}重大代價預兆：${cost}${deadline}`,
    opportunityBeat: `${input.protagonist}能動用的不是憑空出現的解法，而是${input.availableResource}、${input.supportingCharacter}目前願意提供的協助，以及未解線索「${input.unresolvedThread}」；${leverage}${resourceProp}`,
    consequenceBeat: `${reversal}${aftermath}${progressBeat}${recoveryBeat}${closureBeat}這些後果會沿著本回合的選擇進入下一輪，而不是重置人物、地點或既有狀態。`,
    hopeGuard: {
      progressKind,
      progressBeat,
      recoveryBeat,
      recoveryBias,
      setbackCount,
      majorCostTelegraphed: true as const,
      pureDeadEnd: false as const,
    },
  };
}

function outcomeDelta(outcome: RpgOutcome) {
  if (outcome === "critical_success") return { momentum: 5, instability: -2, trust: 3 };
  if (outcome === "success") return { momentum: 3, instability: -1, trust: 2 };
  if (outcome === "partial_success") return { momentum: 1, instability: 2, trust: 0 };
  return { momentum: -1, instability: 4, trust: -2 };
}

export function applyProceduralWorldPulse(input: {
  effect: StoryChoiceEffect;
  encounter: ProceduralEncounter;
  outcome: RpgOutcome;
  strategy: RpgChoiceStrategy;
  turn: number;
  recentSignatures?: string[];
}): StoryChoiceEffect {
  if (input.encounter.arcNextAction) {
    const nextAction = input.encounter.arcNextAction;
    const actionFlags: Record<string, boolean | string | number> = nextAction === "new-arc"
      ? {
          "story.arc.key": input.encounter.arcKey ?? "",
          "story.arc.goal": input.encounter.arcGoal ?? "",
          "story.arc.thread": input.encounter.arcThread ?? "",
          "story.arc.startTurn": input.encounter.arcStartTurn ?? input.turn + 1,
          "story.arc.localTurn": 0,
          "story.arc.horizon": input.encounter.arcHorizon ?? 8,
          "story.arc.phase": "setup",
          "story.arc.resolved": false,
          "story.arc.epilogueRead": false,
          "story.arc.archived": false,
        }
      : nextAction === "epilogue"
        ? {
            "story.arc.epilogueRead": true,
            "story.arc.epilogueReadTurn": input.turn + 1,
          }
        : {
            "story.arc.archived": true,
            "story.arc.archivedTurn": input.turn + 1,
          };
    return {
      ...input.effect,
      // Post-closure actions have a dedicated, bounded effect.  They may move
      // the canonical turn forward, but they must not replay a generic world
      // pulse, pay a second gameplay cost, or overwrite the immutable closure
      // ledger written by the actual resolution choice.
      worldFlags: {
        ...input.effect.worldFlags,
        ...actionFlags,
        "story.arc.nextAction": nextAction,
        "rpg.proceduralDirectorVersion": PROCEDURAL_WORLD_DIRECTOR_VERSION,
        "rpg.proceduralRulesOnly": true,
      },
      timelineEvents: [
        ...input.effect.timelineEvents,
        nextAction === "epilogue"
          ? "結案後續：尾聲已閱讀，原故事弧保持結案。"
          : nextAction === "new-arc"
            ? `續篇開始：${input.encounter.arcThread ?? "結局後的新責任"}`
            : "結局封存：目前故事弧停在完整終點。",
      ],
    };
  }
  const delta = outcomeDelta(input.outcome);
  const relationshipShift = input.strategy === "resource" ? delta.trust + 1 : delta.trust;
  const signatures = [...(input.recentSignatures ?? []).filter((item) => item !== input.encounter.signature), input.encounter.signature]
    .slice(-PROCEDURAL_ENCOUNTER_DEDUP_WINDOW);
  const endingFlags = input.encounter.arcResolved && input.encounter.arcKey
    ? buildApprovedStoryEndingFlags({
        arcKey: input.encounter.arcKey,
        goal: input.encounter.arcGoal ?? "",
        thread: input.encounter.arcThread ?? "",
        resolutionKind: input.encounter.arcResolutionKind ?? "complete",
        resolvedTurn: input.turn + 1,
      })
    : {};
  const arcFlags = input.encounter.arcKey ? {
    "story.arc.key": input.encounter.arcKey,
    "story.arc.goal": input.encounter.arcGoal ?? "",
    "story.arc.thread": input.encounter.arcThread ?? "",
    "story.arc.startTurn": input.encounter.arcStartTurn ?? 0,
    "story.arc.localTurn": input.encounter.arcLocalTurn ?? 1,
    "story.arc.horizon": input.encounter.arcHorizon ?? 8,
    "story.arc.phase": input.encounter.arcPhase ?? "setup",
    "story.arc.resolved": input.encounter.arcResolved ?? false,
    ...endingFlags,
    ...(input.encounter.arcNextAction ? {
      "story.arc.nextAction": input.encounter.arcNextAction,
    } : {}),
  } : {};
  return {
    ...input.effect,
    relationshipChanges: {
      ...input.effect.relationshipChanges,
      "rpg.partyTrust": (input.effect.relationshipChanges["rpg.partyTrust"] ?? 0) + relationshipShift,
    },
    resourceChanges: {
      ...input.effect.resourceChanges,
      "world.momentum": (input.effect.resourceChanges["world.momentum"] ?? 0) + delta.momentum,
      "world.instability": (input.effect.resourceChanges["world.instability"] ?? 0) + delta.instability,
      "world.choiceConsequences": (input.effect.resourceChanges["world.choiceConsequences"] ?? 0) + 1,
    },
    worldFlags: {
      ...input.effect.worldFlags,
      ...arcFlags,
      "rpg.proceduralDirectorVersion": PROCEDURAL_WORLD_DIRECTOR_VERSION,
      "rpg.proceduralRulesOnly": true,
      "rpg.proceduralCombinationSpace": input.encounter.combinationSpace ?? 0,
      "rpg.lastEncounterSignature": input.encounter.signature,
      "rpg.recentEncounterSignatures": signatures.join(","),
      "world.currentAspect": input.encounter.worldAspect,
      "world.currentLocationVariant": input.encounter.locationShift,
      "world.lastChoiceTurn": input.turn,
    },
    timelineEvents: [
      ...input.effect.timelineEvents,
      `世界脈動：${input.encounter.title}（${input.encounter.worldAspect}／${input.outcome}）`,
    ],
  };
}
