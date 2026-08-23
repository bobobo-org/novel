import { normalizeForLearning, shortStableId } from "./hashing";
import type { LearningRuleDimension, LearningRuleDraft, LearningRuleFamily } from "./types";
import {
  MAX_PUBLIC_STORY_RESEARCH_TOP_K,
  retrieveCausalTeacherResearchRules,
} from "./public-story-research";

export const MODE_CHOICE_CAUSAL_TEACHER_VERSION = "closed-mode-choice-causal-teacher-v1" as const;
export const MODE_CHOICE_CURRICULUM_SCHEMA_VERSION = "mode-choice-causal-curriculum-v1" as const;
export const MODE_CHOICE_TOP_K_PER_MODE = 7 as const;
export const MODE_CHOICE_RULE_INDEX_LIMIT = 13 as const;
export const MODE_CHOICE_RECENT_FINGERPRINT_LIMIT = 12 as const;
export const MODE_CHOICE_SAME_TURN_SIMILARITY_LIMIT = 0.72 as const;
export const MODE_CHOICE_RECENT_SIMILARITY_LIMIT = 0.86 as const;

export type ModeChoicePlayMode = "rpg" | "romance" | "management";

export type ModeChoiceStateKey =
  | "ability"
  | "equipment"
  | "quest"
  | "stamina"
  | "actionPoints"
  | "relationship"
  | "trust"
  | "eventProgress"
  | "characterGrowth"
  | "funds"
  | "workforce"
  | "quality"
  | "reputation"
  | "risk";

export type ModeChoiceIntent =
  | "advance"
  | "protect"
  | "investigate"
  | "negotiate"
  | "invest"
  | "recover"
  | "transform"
  | "transfer_risk";

export type ModeChoiceRiskBand = "low" | "medium" | "high";

export type ModeChoicePublicProvenance = {
  id: string;
  publisher: string;
  title: string;
  url: string;
  accessedAt: "2026-08-23";
  rightsBasis: "public_abstract_research";
  retainedForm: "abstract_summary_only";
  rawSourceRetained: false;
  summary: string;
  supports: readonly string[];
};

export const MODE_CHOICE_PUBLIC_PROVENANCE: readonly ModeChoicePublicProvenance[] = Object.freeze([
  {
    id: "inkle-ink-choice-state",
    publisher: "inkle",
    title: "Writing with ink",
    url: "https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md",
    accessedAt: "2026-08-23",
    rightsBasis: "public_abstract_research",
    retainedForm: "abstract_summary_only",
    rawSourceRetained: false,
    summary: "將選項視為受故事狀態、造訪紀錄與條件控制的流程節點；重返情境時應依狀態改變可用策略與呈現。",
    supports: ["state_condition", "choice_variation", "recent_choice_memory"],
  },
  {
    id: "renpy-conditional-menu",
    publisher: "Ren'Py",
    title: "In-Game Menus",
    url: "https://www.renpy.org/doc/html/menus.html",
    accessedAt: "2026-08-23",
    rightsBasis: "public_abstract_research",
    retainedForm: "abstract_summary_only",
    rawSourceRetained: false,
    summary: "選項的可見性應由當前條件決定，選取後必須執行具體後果區塊並回到後續流程。",
    supports: ["availability_gate", "consequence_block", "state_writeback"],
  },
  {
    id: "choice-of-games-intentional-choices",
    publisher: "Choice of Games",
    title: "How to Write Intentional Choices",
    url: "https://www.choiceofgames.com/2016/12/how-to-write-intentional-choices/",
    accessedAt: "2026-08-23",
    rightsBasis: "public_abstract_research",
    retainedForm: "abstract_summary_only",
    rawSourceRetained: false,
    summary: "玩家應能從當下敘事理解各策略的可能結果、檢定方向、難度與取捨，並據此作有意圖的決策。",
    supports: ["intent_separation", "legible_tradeoff", "state_effect"],
  },
  {
    id: "choice-of-games-great-stats",
    publisher: "Choice of Games",
    title: "7 Rules for Designing Great Stats",
    url: "https://www.choiceofgames.com/2011/07/7-rules-for-designing-great-stats/",
    accessedAt: "2026-08-23",
    rightsBasis: "public_abstract_research",
    retainedForm: "abstract_summary_only",
    rawSourceRetained: false,
    summary: "狀態不只表示技能，也可承載人物傾向、關係、資源與互斥目標；每項狀態都應持續影響後續抉擇。",
    supports: ["meaningful_state", "conflicting_goals", "longitudinal_consequence"],
  },
]);

const MODE_STATE_KEYS = Object.freeze({
  rpg: Object.freeze(["ability", "equipment", "quest", "stamina", "actionPoints"] as const),
  romance: Object.freeze(["relationship", "trust", "eventProgress", "characterGrowth"] as const),
  management: Object.freeze(["funds", "workforce", "quality", "reputation", "risk"] as const),
}) satisfies Readonly<Record<ModeChoicePlayMode, readonly ModeChoiceStateKey[]>>;

type RuleBlueprint = {
  id: string;
  modes: readonly ModeChoicePlayMode[];
  priority: number;
  family: LearningRuleFamily;
  dimension: LearningRuleDimension;
  statement: string;
  when: string;
  operation: string;
  constraint: string;
  evaluate: string;
  stateKeys: readonly ModeChoiceStateKey[];
  provenanceIds: readonly string[];
  tags: readonly string[];
};

const ALL_MODES: readonly ModeChoicePlayMode[] = Object.freeze(["rpg", "romance", "management"]);

const RULE_BLUEPRINTS: readonly RuleBlueprint[] = Object.freeze([
  {
    id: "canon-state-concretization",
    modes: ALL_MODES,
    priority: 100,
    family: "structure",
    dimension: "scene_transition",
    statement: "三選一教師只提供策略與因果骨架；每回合的動作、對象、限制與預期後果必須由有效 Canon 錨點、目前狀態值及未解鉤子重新具體化。",
    when: "準備產生新回合的三個可玩選項時",
    operation: "先鎖定本回 Canon 修訂與狀態修訂，再為每個策略綁定至少一個有效錨點、受影響狀態及可延續的未解鉤子，最後才生成顯示文字",
    constraint: "不得保存或重播固定選項文案，不得以模式名稱或通用模板取代當前人物、場景、資源與已發生後果",
    evaluate: "三個策略是否都能追溯到本回有效錨點與狀態，且抽掉當前 Canon 後便無法原樣成立",
    stateKeys: [],
    provenanceIds: ["inkle-ink-choice-state", "renpy-conditional-menu"],
    tags: ["Canon具體化", "狀態具體化", "禁止固定文案"],
  },
  {
    id: "three-intent-tradeoffs",
    modes: ALL_MODES,
    priority: 96,
    family: "structure",
    dimension: "conflict_escalation",
    statement: "同回合三個選項必須代表三種可辨識的意圖或手段，並讓收益、成本、難度或風險至少有一項不可兼得。",
    when: "已有可行策略池，需要選出 A、B、C 時",
    operation: "先以意圖、行動族、狀態收益、狀態成本與風險分級建立抽象指紋，再以差異優先選出三個策略，之後才依 Canon 寫成自然語句",
    constraint: "不得只做同義改寫、語氣差異或同一行動的強弱三級，也不得隱藏足以使玩家誤判的主要取捨",
    evaluate: "不看顯示文案時，三個抽象指紋是否仍能由意圖、成本或後果彼此區分",
    stateKeys: [],
    provenanceIds: ["choice-of-games-intentional-choices", "choice-of-games-great-stats"],
    tags: ["三選一", "意圖差異", "可讀取捨"],
  },
  {
    id: "conditional-playability-writeback",
    modes: ALL_MODES,
    priority: 94,
    family: "revision",
    dimension: "other",
    statement: "每個選項都要先通過當前狀態的可玩性檢查，選取後則把成本、收益與新限制寫回狀態，讓下一回合承接真實後果。",
    when: "策略已具體化、即將顯示或執行時",
    operation: "逐項驗證前置條件與可支付成本，為可玩選項建立結果寫回；不可玩策略改由同意圖但符合當前狀態的新策略取代",
    constraint: "不得顯示實際無法執行的假選項，不得在結果後還原資源、關係或進度，也不得用無條件成功抹去風險",
    evaluate: "每個顯示選項是否都有可驗證前置條件、至少一項狀態差異與可供下回合讀取的後果",
    stateKeys: [],
    provenanceIds: ["renpy-conditional-menu", "choice-of-games-intentional-choices"],
    tags: ["可玩性", "狀態寫回", "後果記憶"],
  },
  {
    id: "same-and-recent-choice-novelty",
    modes: ALL_MODES,
    priority: 92,
    family: "revision",
    dimension: "scene_transition",
    statement: "選項去重必須比較抽象策略指紋而非表面句子：同回合排除高相似策略，並對固定數量的近期回合套用更高相似度門檻。",
    when: "候選策略池完成、準備決定最終三項時",
    operation: "以意圖、行動族、狀態目標、成本、收益、風險與 Canon 錨點形成指紋；先做同回合成對比較，再只讀最近固定十二枚指紋做跨回合比較",
    constraint: "不得藉由換詞、交換 A/B/C 順序或替換無關名詞規避去重，也不得掃描無界歷史或儲存完整選項文字",
    evaluate: "同回合相似度必須低於零點七二，近期回合相似度必須低於零點八六，且檢索量不得超過十二枚指紋",
    stateKeys: [],
    provenanceIds: ["inkle-ink-choice-state", "choice-of-games-great-stats"],
    tags: ["策略指紋", "近期去重", "固定索引"],
  },
  {
    id: "rpg-capability-equipment-tradeoff",
    modes: ["rpg"],
    priority: 90,
    family: "worldbuilding",
    dimension: "world_rule_delivery",
    statement: "RPG 選項應以少量可理解的能力與裝備條件改變成功途徑，讓適配裝備、能力優勢與替代成本形成不同策略。",
    when: "場景存在戰鬥、探索、交涉或障礙，需要把角色能力與裝備帶入決策時",
    operation: "從當前可用能力與已裝備物件各取最多一項，分別建立直接運用、改造運用或不依賴該資源的替代策略",
    constraint: "不得展開龐大數值表，不得臨時生成未持有裝備或未學能力，也不得讓三項都只是不同技能名稱的同一檢定",
    evaluate: "能力或裝備差異是否改變可玩性、成本、成功條件或失敗後果，而非只出現在文案中",
    stateKeys: ["ability", "equipment"],
    provenanceIds: ["choice-of-games-intentional-choices", "choice-of-games-great-stats"],
    tags: ["RPG", "簡化能力", "裝備"],
  },
  {
    id: "rpg-quest-progress",
    modes: ["rpg"],
    priority: 88,
    family: "structure",
    dimension: "ending_hook",
    statement: "RPG 三選一要把目前任務目標或未解線索轉成不同進展路徑，且每條路徑都必須推進、改寫或承擔延後任務的後果。",
    when: "目前回合有啟用中的主線、支線或可驗證線索時",
    operation: "為任務選取一個最近可達里程碑，分別建立直接推進、補足資訊與交換資源的策略，並記錄各自的新任務狀態",
    constraint: "不得提供與啟用任務無關的填充選項，不得讓失敗或延後完全不影響時機、線索或任務風險",
    evaluate: "選取任一項後，任務進度、可用線索、期限或風險是否至少改變一項",
    stateKeys: ["quest"],
    provenanceIds: ["inkle-ink-choice-state", "renpy-conditional-menu"],
    tags: ["RPG", "任務", "進度"],
  },
  {
    id: "rpg-action-economy",
    modes: ["rpg"],
    priority: 86,
    family: "pacing",
    dimension: "character_pressure",
    statement: "體力與行動點應形成可恢復但不能忽略的短期預算，使立即突破、保守行動與準備回復各自具有時間或機會成本。",
    when: "本回合行動會消耗體力、行動點或時間窗口時",
    operation: "先計算可支付預算，再建立高消耗高推進、低消耗低暴露與花費機會回復三類候選，僅保留符合當前場景的策略",
    constraint: "不得允許負資源或免費連續高強度行動，也不得讓回復選項脫離迫近威脅與任務期限",
    evaluate: "三項的體力、行動點、推進幅度與錯失機會是否形成可辨識差異",
    stateKeys: ["stamina", "actionPoints", "quest"],
    provenanceIds: ["choice-of-games-intentional-choices", "renpy-conditional-menu"],
    tags: ["RPG", "體力", "行動點"],
  },
  {
    id: "romance-relationship-trust",
    modes: ["romance"],
    priority: 90,
    family: "relationship",
    dimension: "relationship_movement",
    statement: "戀愛養成選項應把關係親近與信任視為不同狀態：親密行動可能加深連結卻暴露風險，保留界線可能保護信任卻延後關係。",
    when: "人物互動牽涉承諾、秘密、界線、依賴或公開立場時",
    operation: "依雙方已知偏好、承諾與秘密，建立坦白、支持、設界線或迴避中的三種不同意圖，並分別預估關係與信任變化",
    constraint: "不得把送禮或討好寫成無條件加分，不得忽略對方既有性格、界線與已發生的失信",
    evaluate: "每項是否對關係與信任造成不同方向、幅度或延遲效果，且符合該人物 Canon",
    stateKeys: ["relationship", "trust"],
    provenanceIds: ["choice-of-games-intentional-choices", "choice-of-games-great-stats"],
    tags: ["戀愛養成", "關係", "信任"],
  },
  {
    id: "romance-event-progress",
    modes: ["romance"],
    priority: 88,
    family: "structure",
    dimension: "reveal_cadence",
    statement: "戀愛事件進度要由已達成的關係條件、時間點與未解事件控制；三選一可推進、轉向或暫緩事件，但都要留下後續入口。",
    when: "目前存在可觸發事件、約定、誤會或關係里程碑時",
    operation: "先驗證事件前置條件，再建立直接面對、先補條件與改變場合三種可行路徑，將結果寫回事件階段與新鉤子",
    constraint: "不得提前解鎖未達條件的親密事件，不得因暫緩而刪除已累積進度，也不得重播已完成事件",
    evaluate: "選取後事件階段、前置條件或下一個可觸發入口是否有明確且可記憶的改變",
    stateKeys: ["eventProgress", "relationship", "trust"],
    provenanceIds: ["inkle-ink-choice-state", "renpy-conditional-menu"],
    tags: ["戀愛養成", "事件進度", "條件觸發"],
  },
  {
    id: "romance-character-growth",
    modes: ["romance"],
    priority: 86,
    family: "character",
    dimension: "character_pressure",
    statement: "人物成長應透過持續選擇改變表達、界線、責任或自我理解，並反過來開啟或關閉後續關係策略。",
    when: "角色面對重複恐懼、缺點、價值衝突或關係模式時",
    operation: "從既有成長弧挑出一個尚未解決的內在矛盾，建立維持舊模式、嘗試新行為與承擔關係代價三類策略",
    constraint: "不得用單次正確答案瞬間完成成長，不得讓成長只增加數值而不改變後續可做與願意做的事",
    evaluate: "結果是否更新成長階段，並至少改變一項後續對話、事件條件、信任或關係行動",
    stateKeys: ["characterGrowth", "relationship", "trust"],
    provenanceIds: ["choice-of-games-great-stats", "choice-of-games-intentional-choices"],
    tags: ["戀愛養成", "人物成長", "長期後果"],
  },
  {
    id: "management-funds-workforce",
    modes: ["management"],
    priority: 90,
    family: "worldbuilding",
    dimension: "world_rule_delivery",
    statement: "經營模擬選項要把資金與人力當作有限且用途競爭的投入，讓擴張、維持與調整流程各自犧牲不同機會。",
    when: "面臨排程、採購、招募、擴張或突發需求時",
    operation: "先計算可用資金與人力容量，再建立投入資金、調度人力與縮減範圍三種符合當前瓶頸的策略",
    constraint: "不得超支或重複占用人力，不得憑空補足資源，也不得讓三項都只改變成本數字而不改變營運路徑",
    evaluate: "每項是否產生不同的現金餘裕、人力負荷、完成時間或被放棄機會",
    stateKeys: ["funds", "workforce"],
    provenanceIds: ["choice-of-games-intentional-choices", "choice-of-games-great-stats"],
    tags: ["經營模擬", "資金", "人力"],
  },
  {
    id: "management-quality-reputation",
    modes: ["management"],
    priority: 88,
    family: "pacing",
    dimension: "conflict_escalation",
    statement: "品質與聲望應承接營運決策的延遲後果：壓縮品質可換取短期速度或現金，但會累積返工、客訴與聲望壓力。",
    when: "時程、成本與交付標準無法同時滿足時",
    operation: "依目前品質缺口與聲望承受度，建立維持標準、限縮交付與承擔品質債三種路徑，並標記短期收益及延遲後果",
    constraint: "不得讓品質與聲望只升不降，不得讓宣傳直接抵銷未處理的品質問題，也不得隱藏延遲成本",
    evaluate: "各項的即時產出、品質債、返工機率與聲望變化是否可區分且能在後續回合被讀取",
    stateKeys: ["quality", "reputation", "funds", "workforce"],
    provenanceIds: ["choice-of-games-intentional-choices", "choice-of-games-great-stats"],
    tags: ["經營模擬", "品質", "聲望"],
  },
  {
    id: "management-risk-portfolio",
    modes: ["management"],
    priority: 86,
    family: "revision",
    dimension: "information_control",
    statement: "風險不是單次成功率，而是由已知威脅、暴露規模、緩衝與連鎖影響組成；三選一應提供承擔、緩解與轉移風險的不同組合。",
    when: "決策存在供應、財務、人員、品質或聲望的不確定性時",
    operation: "列出本回前三個活躍風險與可用緩衝，建立直接承擔、花費資源緩解與調整範圍轉移風險的候選策略",
    constraint: "不得用模糊幸運或無代價保險消除風險，不得忽略高風險失敗對資金、人力、品質與聲望的連鎖影響",
    evaluate: "三項是否在風險暴露、預防成本、上行收益與最壞後果之間形成不同組合",
    stateKeys: ["risk", "funds", "workforce", "quality", "reputation"],
    provenanceIds: ["choice-of-games-intentional-choices", "choice-of-games-great-stats"],
    tags: ["經營模擬", "風險", "連鎖後果"],
  },
]);

export type ModeChoiceCurriculumRule = {
  id: string;
  modes: readonly ModeChoicePlayMode[];
  priority: number;
  stateKeys: readonly ModeChoiceStateKey[];
  provenanceIds: readonly string[];
  draft: LearningRuleDraft;
};

function asDraft(blueprint: RuleBlueprint): LearningRuleDraft {
  return {
    family: blueprint.family,
    dimension: blueprint.dimension,
    statement: blueprint.statement,
    tags: [...new Set([...blueprint.tags, "閉端因果教師", "抽象規則"])] .slice(0, 10),
    parameters: {
      curriculumRuleId: blueprint.id,
      appliesToModes: blueprint.modes.join(","),
      stateKeys: blueprint.stateKeys.join(","),
      provenanceIds: blueprint.provenanceIds.join(","),
      fixedChoiceCopy: false,
      canonGroundingRequired: true,
      recentFingerprintLimit: MODE_CHOICE_RECENT_FINGERPRINT_LIMIT,
      teacherVersion: MODE_CHOICE_CAUSAL_TEACHER_VERSION,
    },
    recipe: {
      when: blueprint.when,
      operation: blueprint.operation,
      constraint: blueprint.constraint,
      evaluate: blueprint.evaluate,
    },
    confidence: 0.93,
    extractorKind: "local_closed_ai",
    extractorProvider: "closed-mode-choice-causal-teacher",
    extractorModel: MODE_CHOICE_CAUSAL_TEACHER_VERSION,
    sourceOverlapScore: 0,
    longestSourceMatch: 0,
    abstractionScore: 0.98,
    conflictKey: `mode-choice:${blueprint.id}`,
  };
}

const MODE_CHOICE_RULE_INDEX: readonly ModeChoiceCurriculumRule[] = Object.freeze(
  RULE_BLUEPRINTS
    .map((blueprint) => Object.freeze({
      id: blueprint.id,
      modes: blueprint.modes,
      priority: blueprint.priority,
      stateKeys: blueprint.stateKeys,
      provenanceIds: blueprint.provenanceIds,
      draft: asDraft(blueprint),
    }))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id)),
);

const RULES_BY_MODE: Readonly<Record<ModeChoicePlayMode, readonly ModeChoiceCurriculumRule[]>> = Object.freeze({
  rpg: Object.freeze(MODE_CHOICE_RULE_INDEX.filter((rule) => rule.modes.includes("rpg")).slice(0, MODE_CHOICE_TOP_K_PER_MODE)),
  romance: Object.freeze(MODE_CHOICE_RULE_INDEX.filter((rule) => rule.modes.includes("romance")).slice(0, MODE_CHOICE_TOP_K_PER_MODE)),
  management: Object.freeze(MODE_CHOICE_RULE_INDEX.filter((rule) => rule.modes.includes("management")).slice(0, MODE_CHOICE_TOP_K_PER_MODE)),
});

function boundedTopK(value: unknown) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return MODE_CHOICE_TOP_K_PER_MODE;
  return Math.max(1, Math.min(MODE_CHOICE_TOP_K_PER_MODE, Math.floor(requested)));
}

export function getModeChoiceCurriculum(mode: ModeChoicePlayMode, limit: number = MODE_CHOICE_TOP_K_PER_MODE) {
  const topK = boundedTopK(limit);
  const rules = RULES_BY_MODE[mode].slice(0, topK);
  const provenanceIds = new Set(rules.flatMap((rule) => [...rule.provenanceIds]));
  const publicResearch = retrieveCausalTeacherResearchRules({
    query: `${mode} three choices distinct state failure-forward recovery cost foreshadow payoff closure`,
    experience: mode,
    consumer: "choice",
    topK: 4,
  });
  return {
    schemaVersion: MODE_CHOICE_CURRICULUM_SCHEMA_VERSION,
    teacherVersion: MODE_CHOICE_CAUSAL_TEACHER_VERSION,
    mode,
    requiredStateKeys: [...MODE_STATE_KEYS[mode]],
    rules: rules.map((rule) => ({ ...rule, draft: structuredClone(rule.draft) })),
    provenance: MODE_CHOICE_PUBLIC_PROVENANCE
      .filter((source) => provenanceIds.has(source.id))
      .map((source) => ({ ...source, supports: [...source.supports] })),
    publicResearch: {
      candidates: publicResearch.candidates,
      sourceEvidence: publicResearch.sourceEvidence,
      pipeline: publicResearch.pipeline,
    },
    selection: {
      requestedLimit: topK,
      returnedCount: rules.length,
      topKLimit: MODE_CHOICE_TOP_K_PER_MODE,
      ruleIndexLimit: MODE_CHOICE_RULE_INDEX_LIMIT,
      entireLearningLibraryScanned: false as const,
      fixedModeIndex: true as const,
      publicResearchTopKLimit: MAX_PUBLIC_STORY_RESEARCH_TOP_K,
      publicResearchReturnedCount: publicResearch.candidates.length,
      combinedRuntimeRuleLimit: MODE_CHOICE_TOP_K_PER_MODE + MAX_PUBLIC_STORY_RESEARCH_TOP_K,
    },
    privacy: {
      fixedChoiceCopyIncluded: false as const,
      rawSourceIncluded: false as const,
      sourceSentencesIncluded: false as const,
      abstractCausalRulesOnly: true as const,
    },
  };
}

export function getAllModeChoiceCurriculumDrafts() {
  return MODE_CHOICE_RULE_INDEX.map((rule) => structuredClone(rule.draft));
}

export type ModeChoiceTurnContext = {
  mode: ModeChoicePlayMode;
  canonRevisionId: string;
  stateRevision: number;
  activeCanonAnchorIds: readonly string[];
  activeStateKeys: readonly ModeChoiceStateKey[];
  unresolvedHookIds: readonly string[];
};

export type ModeChoiceStrategy = {
  intent: ModeChoiceIntent;
  actionFamily: string;
  canonAnchorIds: readonly string[];
  targetStateKeys: readonly ModeChoiceStateKey[];
  costStateKeys: readonly ModeChoiceStateKey[];
  benefitStateKeys: readonly ModeChoiceStateKey[];
  riskBand: ModeChoiceRiskBand;
};

export type ModeChoiceStrategyFingerprint = {
  version: "mode-choice-strategy-fingerprint-v1";
  signature: string;
  contextSignature: string;
  mode: ModeChoicePlayMode;
  intent: ModeChoiceIntent;
  actionFamilyHash: string;
  canonAnchorHashes: readonly string[];
  targetStateKeys: readonly ModeChoiceStateKey[];
  costStateKeys: readonly ModeChoiceStateKey[];
  benefitStateKeys: readonly ModeChoiceStateKey[];
  riskBand: ModeChoiceRiskBand;
  renderedTextRetained: false;
};

function uniqueBounded(values: readonly string[], limit: number) {
  return [...new Set(values
    .slice(0, limit)
    .map((value) => normalizeForLearning(value).toLocaleLowerCase("zh-Hant"))
    .filter(Boolean))]
    .sort()
    .slice(0, limit);
}

function uniqueStateKeys(values: readonly ModeChoiceStateKey[], limit = 5) {
  return [...new Set(values.slice(0, limit))].sort() as ModeChoiceStateKey[];
}

export function createModeChoiceStrategyFingerprint(
  context: ModeChoiceTurnContext,
  strategy: ModeChoiceStrategy,
): ModeChoiceStrategyFingerprint {
  const actionFamily = uniqueBounded([strategy.actionFamily], 1)[0] ?? "unknown";
  const actionFamilyHash = shortStableId("action", actionFamily);
  const canonAnchorHashes = uniqueBounded(strategy.canonAnchorIds, 4)
    .map((value) => shortStableId("canon", value));
  const targetStateKeys = uniqueStateKeys(strategy.targetStateKeys).slice(0, 5);
  const costStateKeys = uniqueStateKeys(strategy.costStateKeys).slice(0, 5);
  const benefitStateKeys = uniqueStateKeys(strategy.benefitStateKeys).slice(0, 5);
  const contextSignature = shortStableId("ctx", [
    context.mode,
    normalizeForLearning(context.canonRevisionId),
    Math.max(0, Math.floor(context.stateRevision)),
    ...uniqueBounded(context.unresolvedHookIds, 6),
  ].join("|"));
  const signature = shortStableId("choice", [
    context.mode,
    strategy.intent,
    actionFamilyHash,
    ...canonAnchorHashes,
    ...targetStateKeys.map((value) => `target:${value}`),
    ...costStateKeys.map((value) => `cost:${value}`),
    ...benefitStateKeys.map((value) => `benefit:${value}`),
    strategy.riskBand,
  ].join("|"));
  return {
    version: "mode-choice-strategy-fingerprint-v1",
    signature,
    contextSignature,
    mode: context.mode,
    intent: strategy.intent,
    actionFamilyHash,
    canonAnchorHashes,
    targetStateKeys,
    costStateKeys,
    benefitStateKeys,
    riskBand: strategy.riskBand,
    renderedTextRetained: false,
  };
}

function jaccard(left: readonly string[], right: readonly string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (!union.size) return 1;
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  return intersection / union.size;
}

export function modeChoiceStrategySimilarity(
  left: ModeChoiceStrategyFingerprint,
  right: ModeChoiceStrategyFingerprint,
) {
  if (left.mode !== right.mode) return 0;
  const score =
    (left.intent === right.intent ? 0.24 : 0)
    + (left.actionFamilyHash === right.actionFamilyHash ? 0.2 : 0)
    + jaccard(left.canonAnchorHashes, right.canonAnchorHashes) * 0.08
    + jaccard(left.targetStateKeys, right.targetStateKeys) * 0.14
    + jaccard(left.costStateKeys, right.costStateKeys) * 0.1
    + jaccard(left.benefitStateKeys, right.benefitStateKeys) * 0.14
    + (left.riskBand === right.riskBand ? 0.1 : 0);
  return Math.round(score * 1_000) / 1_000;
}

export type ModeChoiceNoveltyViolation = {
  code:
    | "CHOICE_COUNT_NOT_THREE"
    | "TURN_CONTEXT_INCOMPLETE"
    | "CHOICE_NOT_CANON_GROUNDED"
    | "CHOICE_ACTION_FAMILY_INVALID"
    | "CHOICE_STATE_NOT_ACTIVE"
    | "CHOICE_EFFECT_NOT_CONCRETE"
    | "SAME_TURN_INTENT_DUPLICATE"
    | "SAME_TURN_STRATEGY_TOO_SIMILAR"
    | "RECENT_STRATEGY_TOO_SIMILAR";
  candidateIndex: number | null;
  comparedIndex: number | null;
  similarity: number | null;
};

export function auditModeChoiceNovelty(input: {
  context: ModeChoiceTurnContext;
  candidates: readonly ModeChoiceStrategy[];
  recentFingerprints?: readonly ModeChoiceStrategyFingerprint[];
}) {
  const violations: ModeChoiceNoveltyViolation[] = [];
  const activeAnchors = new Set(uniqueBounded(input.context.activeCanonAnchorIds, 16));
  const activeStateKeys = new Set(input.context.activeStateKeys.slice(0, MODE_STATE_KEYS[input.context.mode].length));
  const allowedModeStateKeys = new Set(MODE_STATE_KEYS[input.context.mode]);
  if (
    !normalizeForLearning(input.context.canonRevisionId)
    || !Number.isInteger(input.context.stateRevision)
    || input.context.stateRevision < 0
    || !activeAnchors.size
    || !activeStateKeys.size
  ) {
    violations.push({ code: "TURN_CONTEXT_INCOMPLETE", candidateIndex: null, comparedIndex: null, similarity: null });
  }
  if (input.candidates.length !== 3) {
    violations.push({ code: "CHOICE_COUNT_NOT_THREE", candidateIndex: null, comparedIndex: null, similarity: null });
  }
  const candidates = input.candidates.slice(0, 3);
  const fingerprints = candidates.map((candidate) => createModeChoiceStrategyFingerprint(input.context, candidate));
  for (const [index, candidate] of candidates.entries()) {
    if (!uniqueBounded([candidate.actionFamily], 1).length) {
      violations.push({ code: "CHOICE_ACTION_FAMILY_INVALID", candidateIndex: index, comparedIndex: null, similarity: null });
    }
    const candidateAnchors = uniqueBounded(candidate.canonAnchorIds, 4);
    if (!candidateAnchors.length || candidateAnchors.some((anchor) => !activeAnchors.has(anchor))) {
      violations.push({ code: "CHOICE_NOT_CANON_GROUNDED", candidateIndex: index, comparedIndex: null, similarity: null });
    }
    const usedStateKeys = uniqueStateKeys([
      ...candidate.targetStateKeys.slice(0, 5),
      ...candidate.costStateKeys.slice(0, 5),
      ...candidate.benefitStateKeys.slice(0, 5),
    ], 15);
    if (usedStateKeys.some((key) => !allowedModeStateKeys.has(key) || !activeStateKeys.has(key))) {
      violations.push({ code: "CHOICE_STATE_NOT_ACTIVE", candidateIndex: index, comparedIndex: null, similarity: null });
    }
    if (!candidate.targetStateKeys.length || (!candidate.costStateKeys.length && !candidate.benefitStateKeys.length)) {
      violations.push({ code: "CHOICE_EFFECT_NOT_CONCRETE", candidateIndex: index, comparedIndex: null, similarity: null });
    }
  }
  for (let left = 0; left < fingerprints.length; left += 1) {
    for (let right = left + 1; right < fingerprints.length; right += 1) {
      if (fingerprints[left].intent === fingerprints[right].intent) {
        violations.push({ code: "SAME_TURN_INTENT_DUPLICATE", candidateIndex: right, comparedIndex: left, similarity: null });
      }
      const similarity = modeChoiceStrategySimilarity(fingerprints[left], fingerprints[right]);
      if (similarity >= MODE_CHOICE_SAME_TURN_SIMILARITY_LIMIT) {
        violations.push({ code: "SAME_TURN_STRATEGY_TOO_SIMILAR", candidateIndex: right, comparedIndex: left, similarity });
      }
    }
  }
  const recentFingerprints = (input.recentFingerprints ?? [])
    .slice(-MODE_CHOICE_RECENT_FINGERPRINT_LIMIT)
    .filter((fingerprint) => fingerprint.mode === input.context.mode);
  for (const [candidateIndex, fingerprint] of fingerprints.entries()) {
    for (let recentIndex = 0; recentIndex < recentFingerprints.length; recentIndex += 1) {
      const similarity = modeChoiceStrategySimilarity(fingerprint, recentFingerprints[recentIndex]);
      if (similarity >= MODE_CHOICE_RECENT_SIMILARITY_LIMIT) {
        violations.push({
          code: "RECENT_STRATEGY_TOO_SIMILAR",
          candidateIndex,
          comparedIndex: recentIndex,
          similarity,
        });
        break;
      }
    }
  }
  return {
    accepted: violations.length === 0,
    fingerprints,
    violations,
    inspectedRecentFingerprintCount: recentFingerprints.length,
    limits: {
      sameTurnSimilarity: MODE_CHOICE_SAME_TURN_SIMILARITY_LIMIT,
      recentSimilarity: MODE_CHOICE_RECENT_SIMILARITY_LIMIT,
      recentFingerprintCount: MODE_CHOICE_RECENT_FINGERPRINT_LIMIT,
    },
    privacy: {
      renderedTextRetained: false as const,
      canonTextRetained: false as const,
      abstractFingerprintsOnly: true as const,
    },
  };
}
