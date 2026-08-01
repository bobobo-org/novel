export const XIANXIA_PROCEDURAL_RULE_VERSION = "xianxia-user-principles-v1" as const;

export type XianxiaRuleKind =
  | "talisman"
  | "formation"
  | "profession"
  | "realm"
  | "contract"
  | "emotional_arc";

export type XianxiaRuleCandidate = {
  ruleId: string;
  version: typeof XIANXIA_PROCEDURAL_RULE_VERSION;
  kind: XianxiaRuleKind;
  kindLabel: string;
  title: string;
  rank: string;
  preconditions: string[];
  costs: string[];
  effects: string[];
  risks: string[];
  counters: string[];
  storyHook: string;
  consentRequired: boolean;
  canonicalMutation: 0;
};

type RuleTemplate = Omit<XianxiaRuleCandidate, "ruleId" | "version" | "kind" | "kindLabel" | "rank" | "canonicalMutation">;

const LABELS: Record<XianxiaRuleKind, string> = {
  talisman: "符籙",
  formation: "陣法",
  profession: "特殊職業",
  realm: "境界／天劫",
  contract: "契約",
  emotional_arc: "情緒與關係弧",
};

const RANKS = ["凡階", "靈階", "玄階", "地階", "天階", "道階"];

const TEMPLATES: Record<XianxiaRuleKind, RuleTemplate[]> = {
  talisman: [
    { title: "回光護脈符", preconditions: ["持有可承載靈力的符紙", "施術者保持專注"], costs: ["靈力", "符材耐久"], effects: ["短暫穩定傷勢", "留下可追蹤的靈力紋"], risks: ["連續使用會降低穩定度"], counters: ["斷紋", "逆向靈力干擾"], storyHook: "符面浮出一段不屬於本代符師的筆跡。", consentRequired: false },
    { title: "聽風尋跡符", preconditions: ["取得目標最近留下的可驗證痕跡"], costs: ["感知負荷", "一枚引路材料"], effects: ["指出候選方向而非絕對位置"], risks: ["環境回聲可能造成誤判"], counters: ["多重假痕跡", "隔絕陣"], storyHook: "三個方向同時亮起，表示有人刻意改寫追蹤規則。", consentRequired: false },
    { title: "鎮心明識符", preconditions: ["使用者主動同意", "不存在脅迫或失去判斷能力"], costs: ["精神疲勞"], effects: ["協助分辨自身情緒與外來干擾"], risks: ["不會替使用者作決定"], counters: ["主動撤回", "停止供能"], storyHook: "符只映出被刻意忽略的感受，不宣稱任何預言。", consentRequired: true },
  ],
  formation: [
    { title: "九環流轉陣", preconditions: ["至少三個可用陣眼", "陣眼位置通過校正"], costs: ["持續靈力", "協同專注"], effects: ["把正面壓力分散到多個節點"], risks: ["單一陣眼失衡會形成回流"], counters: ["切斷外圈", "改變地形共振"], storyHook: "本周目的地脈使第三陣眼位置與舊地圖不同。", consentRequired: false },
    { title: "萬象藏界陣", preconditions: ["完成邊界標記", "指定可進出者"], costs: ["稀有空間材料", "維護時間"], effects: ["隱藏入口並建立分層通道"], risks: ["維護者的情緒會影響穩定"], counters: ["節奏探測", "取得合法通行印記"], storyHook: "陣內新增一條沒有人記得建造的路。", consentRequired: false },
    { title: "同心協議陣", preconditions: ["所有參與者明確同意", "每人可獨立退出"], costs: ["共享部分感知", "協同負荷"], effects: ["提升團隊同步與互救效率"], risks: ["界線模糊時自動中止"], counters: ["任一方撤回", "安全隔離符"], storyHook: "不同參與者在陣中看見了彼此從未說出口的目標候選。", consentRequired: true },
  ],
  profession: [
    { title: "靈紋工匠", preconditions: ["完成基礎材料與符紋訓練"], costs: ["練習時間", "材料損耗"], effects: ["製作可維修、可驗證版本的靈具"], risks: ["跳級製作會留下結構缺陷"], counters: ["逐層檢測", "拆解重鑄"], storyHook: "一次失敗作品反而形成前所未見的新用途。", consentRequired: false },
    { title: "丹理校驗師", preconditions: ["能辨識材料來源與批次"], costs: ["檢測試劑", "時間"], effects: ["估算藥力、穩定度與禁忌"], risks: ["未知材料只能提出候選結論"], counters: ["交叉檢驗", "小劑量非人體測試"], storyHook: "兩顆外觀相同的丹藥卻來自完全不同的煉製路徑。", consentRequired: false },
    { title: "界域協調者", preconditions: ["理解勢力、契約與地脈規則"], costs: ["談判資源", "聲望風險"], effects: ["把衝突轉成可追蹤的交換條件"], risks: ["任何承諾都會留下後續責任"], counters: ["公開條款", "版本比對"], storyHook: "最弱小的勢力掌握了一條足以改變談判的例外條款。", consentRequired: false },
  ],
  realm: [
    { title: "根基回照", preconditions: ["境界累積達門檻", "身心狀態可承受"], costs: ["修行資源", "恢復時間"], effects: ["檢查根基並產生突破候選"], risks: ["強行跳級會放大舊傷與心結"], counters: ["延後突破", "補足根基事件"], storyHook: "天劫針對的不是力量，而是最近三次逃避的選擇。", consentRequired: false },
    { title: "心魔問途", preconditions: ["至少有一條未解關係或承諾"], costs: ["精神壓力", "時間"], effects: ["把矛盾轉成可選擇的修行課題"], risks: ["不能以單純戰力解決"], counters: ["坦白", "承擔代價", "改變原目標"], storyHook: "同一個問題在不同周目會由不同人物提出。", consentRequired: false },
    { title: "天地回流劫", preconditions: ["世界靈力與角色境界同時失衡"], costs: ["裝備耐久", "團隊資源"], effects: ["成功後改變世界規則的一個局部參數"], risks: ["失敗會產生補救支線，不直接抹除角色"], counters: ["分流", "借勢", "撤退保全"], storyHook: "劫雲的中心不在主角，而在一個被忽略的配角身上。", consentRequired: false },
  ],
  contract: [
    { title: "互惠同行契", preconditions: ["雙方理解條款", "雙方可拒絕"], costs: ["履約責任"], effects: ["記錄資源、情報與救援承諾"], risks: ["違約會降低信任與聲望"], counters: ["協議終止", "重新談判"], storyHook: "一條看似不起眼的附款在危機時成為救命條件。", consentRequired: true },
    { title: "靈獸共生契", preconditions: ["雙方能表達接受或拒絕", "契約不奪取自主"], costs: ["共享部分資源", "照護責任"], effects: ["建立雙向感知與成長回饋"], risks: ["一方受傷會影響另一方"], counters: ["安全解除儀式", "暫停共享"], storyHook: "靈獸保留了一段人類無法直接讀取的記憶。", consentRequired: true },
    { title: "宗門協作契", preconditions: ["條款公開", "期限與退出條件明確"], costs: ["聲望", "任務義務"], effects: ["取得有限資源與合法身份"], risks: ["勢力衝突會要求重新選邊"], counters: ["中立仲裁", "完成退出條件"], storyHook: "契約版本號與宗門庫存檔案並不一致。", consentRequired: true },
  ],
  emotional_arc: [
    { title: "身份逆轉與重新選擇", preconditions: ["先建立人物欲望與限制", "至少提供一個可回看的線索"], costs: ["原有關係重新定義"], effects: ["鋪墊 → 逆轉 → 回報", "選擇造成長期關係變化"], risks: ["沒有鋪墊的逆轉會降低可信度"], counters: ["角色行動一致性檢查"], storyHook: "真相揭露後，最重要的不是身份，而是角色是否仍作出同一個選擇。", consentRequired: false },
    { title: "多角色朋友圈壓力", preconditions: ["每位角色有獨立目標與知識邊界"], costs: ["信任、時間與資源分配"], effects: ["同一事件在不同人物間產生不同關係後果"], risks: ["不能把所有人物降成主角附屬"], counters: ["輪替視角", "方向關係分開計算"], storyHook: "看似支持主角的兩個人，其實支持的是完全不同的未來。", consentRequired: false },
    { title: "成年親密的界線選擇", preconditions: ["所有參與者已驗證成年", "明確同意且可隨時撤回", "沒有權力脅迫或失去判斷能力"], costs: ["信任暴露", "關係後果"], effects: ["以非露骨方式推進坦白、親密與事後影響"], risks: ["界線不明即停止"], counters: ["撤回", "暫停", "重新確認界線"], storyHook: "真正的轉折不是親密本身，而是事後願意承擔什麼。", consentRequired: true },
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

export function generateXianxiaRuleCandidate(input: {
  runSeed: string;
  kind: XianxiaRuleKind;
  turn: number;
  variant?: number;
  recentRuleIds?: string[];
  adultMode?: boolean;
}): XianxiaRuleCandidate {
  const pool = TEMPLATES[input.kind].filter((template) => input.adultMode || template.title !== "成年親密的界線選擇");
  const base = `${input.runSeed}|${input.kind}|${input.turn}|${input.variant ?? 0}`;
  const recent = new Set(input.recentRuleIds ?? []);
  const start = hashText(base) % pool.length;
  let template = pool[start];
  let ruleId = "";
  for (let offset = 0; offset < pool.length; offset += 1) {
    const candidate = pool[(start + offset) % pool.length];
    const candidateId = `${input.kind}-${hashText(`${base}|${candidate.title}`).toString(16)}`;
    if (!recent.has(candidateId) || offset === pool.length - 1) {
      template = candidate;
      ruleId = candidateId;
      break;
    }
  }
  const rankIndex = hashText(`${base}|rank`) % RANKS.length;
  return {
    ...template,
    ruleId,
    version: XIANXIA_PROCEDURAL_RULE_VERSION,
    kind: input.kind,
    kindLabel: LABELS[input.kind],
    rank: RANKS[rankIndex],
    canonicalMutation: 0,
  };
}

const clamp = (value: number, minimum = 5, maximum = 95) => Math.max(minimum, Math.min(maximum, Math.round(value)));

export function calculateXianxiaCraftingChance(input: {
  skill: number;
  materialQuality: number;
  control: number;
  complexity: number;
  fatigue: number;
}) {
  return clamp(18 + input.skill * 0.34 + input.materialQuality * 0.24 + input.control * 0.22 - input.complexity * 0.22 - input.fatigue * 0.16);
}

export function calculateTribulationDifficulty(input: {
  realmRank: number;
  heartDemon: number;
  karmaDebt: number;
  externalInterference: number;
  worldInstability: number;
  foundation: number;
}) {
  const pressure = 18 + input.realmRank * 9 + input.heartDemon * 0.24 + input.karmaDebt * 0.18 + input.externalInterference * 0.2 + input.worldInstability * 0.18;
  const mitigation = input.foundation * 0.3;
  return clamp(pressure - mitigation, 1, 99);
}

export const XIANXIA_RULE_KIND_OPTIONS = (Object.keys(LABELS) as XianxiaRuleKind[]).map((kind) => ({
  kind,
  label: LABELS[kind],
}));
