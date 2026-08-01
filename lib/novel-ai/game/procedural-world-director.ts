import type { StoryChoiceEffect } from "../domain";
import type { RpgChoiceStrategy, RpgMode, RpgOutcome } from "./progression/rpg-progression";

export const PROCEDURAL_WORLD_DIRECTOR_VERSION = "procedural-world-director-v1" as const;

export type ProceduralEncounter = {
  signature: string;
  templateId: string;
  title: string;
  telegraph: string;
  complication: string;
  locationShift: string;
  worldAspect: string;
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
  return value.split(",").map((item) => item.trim()).filter(Boolean).slice(-8);
}

export function buildProceduralEncounter(input: {
  runSeed: string;
  mode: RpgMode;
  turn: number;
  strategy: RpgChoiceStrategy;
  variant?: number;
  recentSignatures?: string[];
}): ProceduralEncounter {
  const pool = ENCOUNTERS[input.mode];
  const base = `${input.runSeed}|${input.mode}|${input.turn}|${input.strategy}|${input.variant ?? 0}`;
  const start = hashText(base) % pool.length;
  const recent = new Set(input.recentSignatures ?? []);
  let selected = pool[start];
  let signature = "";
  for (let offset = 0; offset < pool.length; offset += 1) {
    const candidate = pool[(start + offset) % pool.length];
    const nextSignature = `${candidate.templateId}-${hashText(`${base}|${candidate.templateId}`).toString(16)}`;
    if (!recent.has(nextSignature) || offset === pool.length - 1) {
      selected = candidate;
      signature = nextSignature;
      break;
    }
  }
  return { ...selected, signature };
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
  const delta = outcomeDelta(input.outcome);
  const relationshipShift = input.strategy === "resource" ? delta.trust + 1 : delta.trust;
  const signatures = [...(input.recentSignatures ?? []).filter((item) => item !== input.encounter.signature), input.encounter.signature].slice(-8);
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
      "rpg.proceduralDirectorVersion": PROCEDURAL_WORLD_DIRECTOR_VERSION,
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
