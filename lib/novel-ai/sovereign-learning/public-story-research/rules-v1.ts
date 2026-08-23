import {
  CAUSAL_RUNTIME_CONSUMERS,
  TEN_CAUSAL_DIMENSIONS,
  type AbstractResearchInferenceRule,
  type CausalStateDeltaKind,
  type RuleTriggerParameter,
  type TenCausalDimension,
  type TenDimensionInstruction,
  type TenDimensionRulePayload,
} from "./types";

type DimensionOverride = Partial<Omit<TenDimensionInstruction, "dimension">>;

const BASELINE_DIMENSIONS: TenDimensionRulePayload = {
  catalyst: {
    dimension: "catalyst",
    basis: "baseline_causal_schema",
    operation: "先用可觀測的狀態變化啟動本輪因果鏈。",
    stateDeltaKinds: ["information", "position"],
  },
  goal: {
    dimension: "goal",
    basis: "baseline_causal_schema",
    operation: "把本輪目標寫成可驗證的完成狀態。",
    stateDeltaKinds: ["opportunity", "position"],
  },
  pressure: {
    dimension: "pressure",
    basis: "baseline_causal_schema",
    operation: "用阻力壓縮行動空間，但保留真實能動性。",
    stateDeltaKinds: ["cost", "position"],
  },
  leverage: {
    dimension: "leverage",
    basis: "baseline_causal_schema",
    operation: "顯示可用於談判、交換或反制的籌碼。",
    stateDeltaKinds: ["information", "relationship", "resource"],
  },
  "prop/resource": {
    dimension: "prop/resource",
    basis: "baseline_causal_schema",
    operation: "記錄可取得、消耗、轉換或失去的道具與資源。",
    stateDeltaKinds: ["resource", "ability"],
  },
  "relationship tension": {
    dimension: "relationship tension",
    basis: "baseline_causal_schema",
    operation: "記錄信任、權力、親密或義務的方向性變化。",
    stateDeltaKinds: ["relationship", "information"],
  },
  cost: {
    dimension: "cost",
    basis: "baseline_causal_schema",
    operation: "讓重大代價在承擔前可感知，並在結果中落帳。",
    stateDeltaKinds: ["cost", "resource", "relationship"],
  },
  deadline: {
    dimension: "deadline",
    basis: "baseline_causal_schema",
    operation: "只在時間窗會改變選擇時加入期限。",
    stateDeltaKinds: ["time", "opportunity"],
  },
  reversal: {
    dimension: "reversal",
    basis: "baseline_causal_schema",
    operation: "以新資訊或狀態變化重排選項，不抹除已發生的因果。",
    stateDeltaKinds: ["information", "position", "opportunity"],
  },
  "aftermath hook": {
    dimension: "aftermath hook",
    basis: "baseline_causal_schema",
    operation: "結算本輪後，保留由結果產生的下一個問題或機會。",
    stateDeltaKinds: ["information", "opportunity", "relationship"],
  },
};

function tenDimensions(
  overrides: Partial<Record<TenCausalDimension, DimensionOverride>> = {},
): TenDimensionRulePayload {
  return Object.fromEntries(TEN_CAUSAL_DIMENSIONS.map((dimension) => [
    dimension,
    {
      ...BASELINE_DIMENSIONS[dimension],
      ...(overrides[dimension] ?? {}),
      dimension,
    },
  ])) as TenDimensionRulePayload;
}

function parameter(
  key: string,
  defaultValue: string | number | boolean,
  unit: RuleTriggerParameter["unit"],
  options: {
    valueType?: RuleTriggerParameter["valueType"];
    minimum?: number;
    maximum?: number;
  } = {},
): RuleTriggerParameter {
  return {
    key,
    valueType: options.valueType
      ?? (typeof defaultValue === "number" ? "integer" : typeof defaultValue === "boolean" ? "boolean" : "enum"),
    defaultValue,
    ...(options.minimum === undefined ? {} : { minimum: options.minimum }),
    ...(options.maximum === undefined ? {} : { maximum: options.maximum }),
    unit,
    experimentOnly: true,
  };
}

function rule(
  input: Omit<
    AbstractResearchInferenceRule,
    "candidateOnly" | "autoApprove" | "outcomeGuarantee" | "experimentRequired" | "consumerFits"
  > & { consumerFits?: AbstractResearchInferenceRule["consumerFits"] },
): AbstractResearchInferenceRule {
  return {
    ...input,
    consumerFits: input.consumerFits ?? CAUSAL_RUNTIME_CONSUMERS,
    candidateOnly: true,
    autoApprove: false,
    outcomeGuarantee: false,
    experimentRequired: true,
  };
}

const ALL_MODES = ["rpg", "romance", "management"] as const;
const NO_VIRAL_GUARANTEE = "不得將任何節拍或平台指標宣稱為爆紅、留存或滿意度保證。";

export const PUBLIC_STORY_RESEARCH_RULES_V1 = [
  rule({
    ruleId: "research.causal-network-connected-events",
    claimKind: "inference",
    mechanismClass: "research_translation",
    statement: "讓每個重大事件至少能追溯一個先前原因，並產生一個後續狀態變化。",
    rationale: "原始研究連結因果鏈位置、連結數與記憶及事件重要性；本規則是對互動敘事的抽象轉譯。",
    sourceFactRefs: ["study.causal_network.method", "study.causal_network.result"],
    experienceModes: ALL_MODES,
    tags: ["因果", "causal chain", "event connection", "後果", "teacher"],
    triggerParameters: [
      parameter("unlinkedMajorEventThreshold", 1, "state", { minimum: 1, maximum: 3 }),
      parameter("minimumOutgoingStateDelta", 1, "state", { minimum: 1, maximum: 3 }),
    ],
    tenDimensions: tenDimensions({
      catalyst: {
        basis: "rule_inference",
        operation: "啟動事件必須改變至少一個可追蹤狀態，並記錄其直接前因。",
      },
      reversal: {
        basis: "rule_inference",
        operation: "轉折必須由既有線索、選擇或壓力觸發，不使用無前因的方便事件。",
      },
      "aftermath hook": {
        basis: "rule_inference",
        operation: "每個重大事件至少向後產生一個可追蹤狀態變化。",
      },
    }),
    evaluationSignals: ["causalConnectionCoverage", "unlinkedMajorEventCount", "stateDeltaCoverage"],
    guardrails: ["不用補寫假因果掩蓋斷裂；斷裂應變成待修復候選。"],
  }),
  rule({
    ruleId: "experiment.suspense-predictive-gap",
    claimKind: "experiment",
    mechanismClass: "research_translation",
    statement: "以可理解的未完預測、逐步縮窄的選項與可追蹤後果進行懸念實驗。",
    rationale: "兩項懸念原始研究報告注意聚焦、心智推測與預測推論關聯；實作參數僅是可否證假說。",
    sourceFactRefs: [
      "study.suspense_attention.method",
      "study.suspense_attention.result",
      "study.suspense_reading.method",
      "study.suspense_reading.result",
    ],
    experienceModes: ALL_MODES,
    tags: ["懸念", "suspense", "prediction", "attention", "期限", "轉折"],
    triggerParameters: [
      parameter("lowTensionBeatThreshold", 2, "beat", { minimum: 1, maximum: 6 }),
      parameter("predictionGapVisibility", 0.65, "ratio", { valueType: "ratio", minimum: 0.2, maximum: 0.9 }),
      parameter("suspenseProbeInterval", 3, "beat", { minimum: 1, maximum: 8 }),
    ],
    tenDimensions: tenDimensions({
      pressure: {
        basis: "rule_inference",
        operation: "用可推理但尚未完成的結果預期升壓，同時保留至少一條合理應對。",
      },
      deadline: {
        basis: "rule_inference",
        operation: "期限必須讓讀者知道逾時會改變什麼，再測試其對張力的影響。",
      },
      reversal: {
        basis: "rule_inference",
        operation: "用可追溯資訊更新讀者的預測，避免純隨機驚嚇。",
      },
    }),
    evaluationSignals: ["subjectiveTensionDelta", "choiceCompletionRate", "confusionReportRate"],
    guardrails: [NO_VIRAL_GUARANTEE, "實驗不得把恐懼或焦慮當成唯一高張力手段。"],
  }),
  rule({
    ruleId: "experiment.taxonomy-mode-buckets",
    claimKind: "experiment",
    mechanismClass: "research_translation",
    statement: "用寬類型加細主題標籤建立 RPG、戀愛與經營實驗桶，不把分類本身當成成效證據。",
    rationale: "Project Gutenberg 與 Royal Road 的官方資訊支持多層分類與搜尋，但並未證明任一類型必然更受歡迎。",
    sourceFactRefs: ["pg.categories.auto", "pg.subjects.catalog", "rr.genres.broad", "rr.tags.fine", "rr.tags.discovery"],
    experienceModes: ALL_MODES,
    tags: ["genre", "tags", "taxonomy", "RPG", "romance", "management", "題材", "實驗桶"],
    triggerParameters: [
      parameter("broadGenreCount", 1, "state", { minimum: 1, maximum: 2 }),
      parameter("fineTagCount", 3, "state", { minimum: 1, maximum: 6 }),
      parameter("excludedTagCount", 1, "state", { minimum: 0, maximum: 4 }),
    ],
    tenDimensions: tenDimensions({
      goal: {
        basis: "rule_inference",
        operation: "使用實驗桶的類型承諾界定本輪目標，但以實際選擇結果校正。",
      },
      "prop/resource": {
        basis: "rule_inference",
        operation: "將細標籤轉成可選的資源或約束變體，不複製任何平台故事。",
      },
      "relationship tension": {
        basis: "rule_inference",
        operation: "將關係類標籤僅用於選擇測試軸，不預設流行度。",
      },
    }),
    evaluationSignals: ["bucketChoiceRate", "bucketCompletionRate", "bucketDiversity"],
    guardrails: [NO_VIRAL_GUARANTEE, "類型、主題與情節機制標籤必須分開存放與分析。"],
  }),
  rule({
    ruleId: "experiment.popular-short-drama-causal-loop",
    claimKind: "experiment",
    mechanismClass: "popular_short_drama_experiment",
    statement: "將熱門或爽劇常見的快觸發、明目標、壓力、轉折與餘波鉤子轉成可調參數的離線實驗。",
    rationale: "YouTube 官方建議用留存曲線與分組比較觀察表現；本規則只建立可測假說，不聲稱平台因果。",
    sourceFactRefs: [
      "yt.recommendation.objective",
      "yt.recommendation.signals",
      "yt.retention.key_moments",
      "yt.retention.comparison",
      "yt.grouping.axes",
      "yt.grouping.compare",
    ],
    experienceModes: ALL_MODES,
    tags: ["熱門", "爽劇", "short drama", "hook", "retention", "快觸發", "轉折", "餘波"],
    triggerParameters: [
      parameter("openingCatalystBeatMax", 2, "beat", { minimum: 1, maximum: 5 }),
      parameter("visibleGoalBeatMax", 3, "beat", { minimum: 1, maximum: 6 }),
      parameter("pressureIntervalBeats", 3, "beat", { minimum: 1, maximum: 8 }),
      parameter("reversalIntervalBeats", 6, "beat", { minimum: 2, maximum: 12 }),
      parameter("aftermathHookBeatMax", 2, "beat", { minimum: 1, maximum: 5 }),
    ],
    tenDimensions: tenDimensions({
      catalyst: {
        basis: "rule_inference",
        operation: "在可調開場節拍窗內呈現可觀測變化，並保留慢開場對照組。",
      },
      goal: {
        basis: "rule_inference",
        operation: "在可調節拍窗內讓受眾能描述當前目標。",
      },
      pressure: {
        basis: "rule_inference",
        operation: "以間隔參數測試壓力節點，但不得連續取消所有安全選擇。",
      },
      reversal: {
        basis: "rule_inference",
        operation: "用轉折間隔做實驗變數，且每次必須改變至少一個可追蹤狀態。",
      },
      "aftermath hook": {
        basis: "rule_inference",
        operation: "先結算選擇代價，再於可調節拍窗內打開下一個問題。",
      },
    }),
    evaluationSignals: ["choiceStartRate", "choiceCompletionRate", "dropOffByBeat", "returnIntent"],
    guardrails: [NO_VIRAL_GUARANTEE, "不得自動抓取影片、轉錄、留言或帳號內分析資料。"],
  }),
  rule({
    ruleId: "experiment.cross-platform-grouped-measurement",
    claimKind: "experiment",
    mechanismClass: "cross_platform_measurement_experiment",
    statement: "依體驗模式、因果參數版本與成本分組，只以授權後的彙總指標比較實驗。",
    rationale: "YouTube 建議使用內容群組檢查趨勢與離群值；Meta 官方定義可作為觀測結果的彙總觸及、觀看與互動指標。",
    sourceFactRefs: [
      "yt.grouping.axes",
      "yt.grouping.compare",
      "ig.insights.metrics",
      "ig.insights.metric_scope",
      "fb.insights.aggregate",
      "fb.insights.metrics",
    ],
    experienceModes: ALL_MODES,
    tags: ["metrics", "insights", "retention", "reach", "engagement", "分組", "彙總指標"],
    triggerParameters: [
      parameter("minimumGroupSample", 20, "state", { minimum: 5, maximum: 500 }),
      parameter("outlierReviewRequired", true, "flag"),
      parameter("crossGroupWindowAligned", true, "flag"),
    ],
    tenDimensions: tenDimensions(),
    evaluationSignals: ["completionRate", "returnIntent", "aggregateInteractions", "uniqueReach", "outlierContribution"],
    guardrails: [NO_VIRAL_GUARANTEE, "不存個人帳號級資料；未授權就不匯入指標。"],
  }),
  rule({
    ruleId: "research.foreshadow-payoff-closure",
    claimKind: "inference",
    mechanismClass: "research_translation",
    statement: "伏筆建立時記錄可驗證的觸發條件與承諾後果；進入收束時優先回收重大開放線，限制新鉤子。",
    rationale: "因果網路研究支持檢查事件的因果連結；將此用於伏筆回收與收束是互動敘事的抽象推論，不是實證的畅銷公式。",
    sourceFactRefs: ["study.causal_network.method", "study.causal_network.result"],
    experienceModes: ALL_MODES,
    consumerFits: ["planner", "choice", "story", "continuity", "closure"],
    tags: ["伏筆", "回收", "foreshadow", "payoff", "continuity", "closure", "收束", "open thread"],
    triggerParameters: [
      parameter("majorOpenThreadMaxAtClosure", 1, "state", { minimum: 0, maximum: 3 }),
      parameter("minimumPayoffCausalLinks", 2, "state", { minimum: 1, maximum: 4 }),
      parameter("newMajorHookAllowedDuringClosure", false, "flag"),
    ],
    tenDimensions: tenDimensions({
      catalyst: {
        basis: "rule_inference",
        operation: "建立伏筆時記錄它改變的資訊狀態、未來觸發條件與預期回收範圍。",
      },
      goal: {
        basis: "rule_inference",
        operation: "進入 closure 模式時，目標改為回收重大承諾、結算代價與確認新平衡。",
      },
      reversal: {
        basis: "rule_inference",
        operation: "回收可重解已知事件，但必須可追溯到早先資訊或選擇。",
      },
      "aftermath hook": {
        basis: "rule_inference",
        operation: "收束模式先封閉重大開放線；除非明示啟用續作模式，不新增重大鉤子。",
      },
    }),
    evaluationSignals: ["majorOpenThreadCount", "payoffCausalLinkCoverage", "unearnedRevealCount", "closureStateSettled"],
    guardrails: ["不為了假回收而事後偽造早先線索；無依據的伏筆應標成未回收。"],
  }),
  rule({
    ruleId: "policy.anti-despair-affordable-recovery",
    claimKind: "product_safety_policy",
    mechanismClass: "anti_despair_policy",
    statement: "每組三選項至少保留一條現有狀態可負擔的復原或穩態路徑。",
    rationale: "這是產品安全與能動性規範，不是對流行度的經驗聲稱。",
    sourceFactRefs: ["policy.anti_despair.required"],
    experienceModes: ALL_MODES,
    tags: ["anti-despair", "recovery", "steady", "復原", "穩態", "可負擔"],
    triggerParameters: [
      parameter("minimumAffordableRecoveryChoices", 1, "choice", { minimum: 1, maximum: 2 }),
      parameter("affordableCostRatioMax", 0.35, "ratio", { valueType: "ratio", minimum: 0, maximum: 0.6 }),
    ],
    tenDimensions: tenDimensions({
      leverage: {
        basis: "product_safety_policy",
        operation: "在最弱狀態下仍提供一個可用籌碼，足以選擇復原或穩態路徑。",
      },
      "prop/resource": {
        basis: "product_safety_policy",
        operation: "計算復原成本後，確認至少一個選項不超過當前可用資源。",
      },
      cost: {
        basis: "product_safety_policy",
        operation: "復原可有代價，但不得高於當前狀態可承擔上限。",
      },
    }),
    evaluationSignals: ["affordableRecoveryChoiceCount", "recoveryCostRatio", "deadEndChoiceCount"],
    guardrails: ["當前無可負擔復原路徑時，不得輸出該組選項。"],
  }),
  rule({
    ruleId: "policy.failure-forward-positive-carry",
    claimKind: "product_safety_policy",
    mechanismClass: "anti_despair_policy",
    statement: "失敗後仍必須帶來情報、關係、資源、能力或機會之一，同時真實結算失敗代價。",
    rationale: "這是 failure-forward 產品規範，目的是避免失敗只剩重複受罰。",
    sourceFactRefs: ["policy.anti_despair.required"],
    experienceModes: ALL_MODES,
    tags: ["failure-forward", "失敗推進", "information", "relationship", "resource", "ability", "opportunity"],
    triggerParameters: [
      parameter("minimumPositiveCarryKinds", 1, "state", { minimum: 1, maximum: 3 }),
      parameter("failureCostMustPersist", true, "flag"),
    ],
    tenDimensions: tenDimensions({
      "prop/resource": {
        basis: "product_safety_policy",
        operation: "失敗結算可失去資源，但必須另留一種正向攜帶狀態。",
      },
      "relationship tension": {
        basis: "product_safety_policy",
        operation: "失敗可加深衝突，但不得同時清空所有關係修復機會。",
      },
      "aftermath hook": {
        basis: "product_safety_policy",
        operation: "失敗餘波必須包含情報、關係、資源、能力或機會中至少一項新狀態。",
      },
    }),
    evaluationSignals: ["failurePositiveCarryCount", "failureCostPersisted", "repeatPunishmentCount"],
    guardrails: ["正向攜帶不得偽裝成失敗未發生；代價與新機會必須同時存在。"],
  }),
  rule({
    ruleId: "policy.major-cost-forewarning",
    claimKind: "product_safety_policy",
    mechanismClass: "anti_despair_policy",
    statement: "選擇可能造成重大且難以回復的代價時，必須在確認前給出具體預告。",
    rationale: "這是可預期後果的產品規範，避免以隱藏重大代價製造假選擇。",
    sourceFactRefs: ["policy.anti_despair.required"],
    experienceModes: ALL_MODES,
    tags: ["cost preview", "forewarning", "重大代價", "預告", "irreversible"],
    triggerParameters: [
      parameter("majorCostSeverityThreshold", 0.7, "ratio", { valueType: "ratio", minimum: 0.5, maximum: 1 }),
      parameter("confirmationRequired", true, "flag"),
    ],
    tenDimensions: tenDimensions({
      cost: {
        basis: "product_safety_policy",
        operation: "在選擇文案中預告重大代價影響的狀態種類與難回復性。",
      },
      deadline: {
        basis: "product_safety_policy",
        operation: "即使有期限也不得隱藏重大代價；必要時增加確認步驟。",
      },
    }),
    evaluationSignals: ["majorCostPreviewCoverage", "surpriseIrreversibleCostCount", "confirmationCoverage"],
    guardrails: ["不能只用模糊的危險或謹慎取代具體狀態代價。"],
  }),
  rule({
    ruleId: "policy.consecutive-setback-relief-weight",
    claimKind: "product_safety_policy",
    mechanismClass: "anti_despair_policy",
    statement: "連續挫敗達門檻後提高 relief 權重，讓下一組選項增加緩衝、穩態或可靠復原機會。",
    rationale: "這是防止連續挫敗無限放大的動態安全規範。",
    sourceFactRefs: ["policy.anti_despair.required"],
    experienceModes: ALL_MODES,
    tags: ["anti-despair", "relief", "連續挫敗", "緩衝", "weight", "steady"],
    triggerParameters: [
      parameter("consecutiveSetbackThreshold", 2, "state", { minimum: 1, maximum: 4 }),
      parameter("reliefWeightIncrement", 0.25, "ratio", { valueType: "ratio", minimum: 0.1, maximum: 0.6 }),
      parameter("reliefWeightCeiling", 0.8, "ratio", { valueType: "ratio", minimum: 0.4, maximum: 1 }),
    ],
    tenDimensions: tenDimensions({
      pressure: {
        basis: "product_safety_policy",
        operation: "連續挫敗達門檻時降低純壓力分支權重，不再累加同類受罰。",
      },
      leverage: {
        basis: "product_safety_policy",
        operation: "隨 relief 權重提高可用籌碼、求助或緩衝機會的候選權重。",
      },
      "aftermath hook": {
        basis: "product_safety_policy",
        operation: "緩衝後的鉤子應打開穩定前進機會，而非立即恢復同類惡化。",
      },
    }),
    evaluationSignals: ["consecutiveSetbacks", "reliefWeight", "repeatedSetbackTypeCount"],
    guardrails: ["Relief 是狀態調節而非無條件勝利；已發生代價仍須結算。"],
  }),
  rule({
    ruleId: "policy.three-choice-distinct-state",
    claimKind: "product_safety_policy",
    mechanismClass: "anti_despair_policy",
    statement: "A/B/C 三個選項在預期狀態向量上必須有不同後果，不允許只換文案的假選擇。",
    rationale: "這是互動敘事能動性規範，要求選擇後的資訊、關係、資源、能力、機會、代價、時間或位置差異可驗證。",
    sourceFactRefs: ["policy.anti_despair.required"],
    experienceModes: ALL_MODES,
    tags: ["A/B/C", "three choices", "distinct state", "差異後果", "agency", "假選擇"],
    triggerParameters: [
      parameter("choiceCount", 3, "choice", { minimum: 3, maximum: 3 }),
      parameter("minimumPairwiseStateDistance", 1, "state", { minimum: 1, maximum: 4 }),
    ],
    tenDimensions: tenDimensions({
      goal: {
        basis: "product_safety_policy",
        operation: "三選項可共用長期目標，但本輪達成條件或順序必須不同。",
      },
      cost: {
        basis: "product_safety_policy",
        operation: "比較三選項的代價狀態，若完全相同就必須調整其他狀態向量。",
      },
      "aftermath hook": {
        basis: "product_safety_policy",
        operation: "每個選項結算後的下一問題必須反映該選項的獨特狀態變化。",
      },
    }),
    evaluationSignals: ["pairwiseChoiceStateDistance", "sameOutcomeChoiceCount", "choiceStateVectorCoverage"],
    guardrails: ["不得用隨機同義改寫偽造差異；必須比較結算後狀態。"],
  }),
  rule({
    ruleId: "mode.rpg-agency-resource-choice",
    claimKind: "experiment",
    mechanismClass: "mode_specific_experiment",
    statement: "RPG 選擇同時改變立即位置與至少一項情報、資源、能力或關係狀態。",
    rationale: "這是將十維因果 schema 適配為 RPG 能動性的模式實驗。",
    sourceFactRefs: ["study.causal_network.result", "rr.tags.fine", "policy.anti_despair.required"],
    experienceModes: ["rpg"],
    tags: ["RPG", "agency", "quest", "resource", "ability", "行動選擇"],
    triggerParameters: [
      parameter("minimumRpgStateDeltaKinds", 2, "state", { minimum: 2, maximum: 4 }),
      parameter("minimumActionableChoices", 3, "choice", { minimum: 3, maximum: 3 }),
    ],
    tenDimensions: tenDimensions({
      goal: { basis: "rule_inference", operation: "將任務目標表示為玩家可驗證的世界或角色狀態。" },
      "prop/resource": { basis: "rule_inference", operation: "每個 RPG 選擇都檢查道具、資源或能力的可用性與結算。" },
      "aftermath hook": { basis: "rule_inference", operation: "結算玩家位置與能力後，以新機會或新情報打開下一步。" },
    }),
    evaluationSignals: ["rpgStateDeltaKinds", "resourceValidity", "playerAgencyDistance"],
    guardrails: ["不自動替玩家選擇；不用隱藏數值否定明示能力。"],
  }),
  rule({
    ruleId: "mode.romance-tension-boundary-repair",
    claimKind: "experiment",
    mechanismClass: "mode_specific_experiment",
    statement: "戀愛模式用信任、親密、邊界與義務的差異化狀態變化建立張力與修復。",
    rationale: "這是將十維因果 schema 適配為戀愛關係後果的模式實驗。",
    sourceFactRefs: ["study.causal_network.result", "rr.tags.fine", "study.suspense_reading.result", "policy.anti_despair.required"],
    experienceModes: ["romance"],
    tags: ["romance", "relationship tension", "trust", "boundary", "repair", "戀愛", "關係修復"],
    triggerParameters: [
      parameter("relationshipStateDeltaMinimum", 1, "state", { minimum: 1, maximum: 3 }),
      parameter("repairOpportunityAfterRupture", true, "flag"),
    ],
    tenDimensions: tenDimensions({
      leverage: { basis: "rule_inference", operation: "戀愛衝突的籌碼可來自信任、坦白、邊界或承諾，不只是地位。" },
      "relationship tension": { basis: "rule_inference", operation: "每個關係選擇明確結算信任、親密、邊界或義務中至少一項。" },
      "aftermath hook": { basis: "rule_inference", operation: "關係破裂後保留可負擔的修復、穩態或清楚離開機會。" },
    }),
    evaluationSignals: ["relationshipStateDelta", "boundaryViolationCount", "repairOpportunityCoverage"],
    guardrails: ["不把操控、強迫或越界當成必然浪漫回報。"],
  }),
  rule({
    ruleId: "mode.management-pressure-leverage-loop",
    claimKind: "experiment",
    mechanismClass: "mode_specific_experiment",
    statement: "經營模式讓需求、供給、信用、人力與時間在選擇後形成可稽核的權衡鏈。",
    rationale: "這是將十維因果 schema 適配為經營狀態結算的模式實驗。",
    sourceFactRefs: ["study.causal_network.result", "pg.categories.auto", "policy.anti_despair.required"],
    experienceModes: ["management"],
    tags: ["management", "resource", "leverage", "deadline", "tradeoff", "經營", "資源權衡"],
    triggerParameters: [
      parameter("minimumManagementLedgerDeltas", 2, "state", { minimum: 2, maximum: 5 }),
      parameter("deadlineOnlyWhenChoiceChanges", true, "flag"),
    ],
    tenDimensions: tenDimensions({
      leverage: { basis: "rule_inference", operation: "把信用、契約、庫存或人力轉成可追蹤籌碼，並限定使用條件。" },
      "prop/resource": { basis: "rule_inference", operation: "結算需求、供給、現金、庫存或人力中至少兩項差異。" },
      deadline: { basis: "rule_inference", operation: "只在逾時會改變成本、機會或關係時加入經營期限。" },
    }),
    evaluationSignals: ["managementLedgerDeltaCount", "resourceConservation", "deadlineChoiceImpact"],
    guardrails: ["不得用未公布的隱藏成本使選擇必敗。"],
  }),
] as const satisfies readonly AbstractResearchInferenceRule[];

export function cloneBaselineTenDimensionPayload(): TenDimensionRulePayload {
  return tenDimensions();
}

export function coveredStateDeltaKinds(
  payload: TenDimensionRulePayload,
): readonly CausalStateDeltaKind[] {
  return [...new Set(TEN_CAUSAL_DIMENSIONS.flatMap((dimension) => payload[dimension].stateDeltaKinds))];
}
