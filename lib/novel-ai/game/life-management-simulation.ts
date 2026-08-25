import type { Character, CharacterRelationship, StoryState } from "../domain";

export const LIFE_MANAGEMENT_SYSTEMS = [
  { id: "growth", name: "人物養成", resources: ["能力", "魅力", "體力", "人脈", "專業"], tension: "能力不能同時點滿，專精會形成機會成本" },
  { id: "time", name: "時間管理", resources: ["每日 12 點時間", "檔期", "休息"], tension: "所有行動占用同一份有限日程" },
  { id: "money", name: "金錢經營", resources: ["現金流", "投資", "負債", "資產流動性"], tension: "高報酬會鎖定本金並帶來風險" },
  { id: "relationships", name: "人際關係", resources: ["信任", "壓力", "忠誠", "承諾"], tension: "NPC 會記得公開肯定、羞辱、失約與救援" },
  { id: "organization", name: "組織經營", resources: ["招募", "培養", "升遷", "授權", "留任"], tension: "後期必須從親自執行轉為選人與授權" },
  { id: "events", name: "動態事件", resources: ["景氣", "客訴", "挖角", "爆紅", "危機"], tension: "同一種子可重現，不同種子有不同人生" },
  { id: "causality", name: "長期因果", resources: ["短期成果", "中期策略", "長期回返"], tension: "被忽略的人與債務會在多年後換一種身分回來" },
] as const;

export const LIFE_MANAGEMENT_PHASES = [
  { level: 1, id: "newcomer", name: "新人", threshold: 0, focus: "親自完成工作、建立第一份作品與信用", delegation: 0 },
  { level: 2, id: "professional", name: "專業者", threshold: 18, focus: "建立專長、穩定客源與可重複流程", delegation: 1 },
  { level: 3, id: "supervisor", name: "小主管", threshold: 34, focus: "帶領小隊、訓練新人並承擔團隊結果", delegation: 3 },
  { level: 4, id: "operator", name: "經營者", threshold: 50, focus: "配置人才、資本與多項業務，不再凡事親力親為", delegation: 8 },
  { level: 5, id: "entrepreneur", name: "企業家", threshold: 68, focus: "經營多組織、投資與跨勢力合作", delegation: 20 },
  { level: 6, id: "industry-leader", name: "產業領袖", threshold: 84, focus: "改變產業規則、培養接班人並留下傳承", delegation: 50 },
] as const;

export const ORGANIZATION_MANAGEMENT_DIMENSIONS = [
  { id: "money", name: "金錢", shop: "銀兩／營收", cultivation: "靈石", company: "現金" },
  { id: "talent", name: "人才", shop: "店員／掌櫃", cultivation: "弟子／長老", company: "員工／主管" },
  { id: "customers", name: "客源", shop: "顧客", cultivation: "香火／委託", company: "客戶" },
  { id: "reputation", name: "聲望", shop: "商譽", cultivation: "宗門威望", company: "品牌" },
  { id: "products", name: "商品", shop: "商品／配方", cultivation: "丹藥／功法／法器", company: "產品／服務" },
  { id: "facilities", name: "設施", shop: "店面／倉庫", cultivation: "丹房／藏經閣", company: "辦公室／工廠" },
  { id: "relations", name: "關係", shop: "商會／官府", cultivation: "皇朝／其他宗門", company: "政府／供應商／競爭者" },
  { id: "core-assets", name: "核心資源", shop: "原料", cultivation: "靈脈／秘境", company: "技術／資本／數據" },
] as const;

export const ORGANIZATION_SCALE_MILESTONES = [
  { level: 1, name: "一人起步", scope: "自己完成核心工作" },
  { level: 5, name: "小型據點", scope: "店鋪、小隊或沒落宗門" },
  { level: 12, name: "正式組織", scope: "商號、分部或成形宗門" },
  { level: 20, name: "區域勢力", scope: "商會、聯盟或多部門企業" },
  { level: 30, name: "跨城體系", scope: "跨城商業帝國或多地分宗" },
  { level: 40, name: "制度建立者", scope: "建立宗門、集團或公共制度" },
  { level: 60, name: "國家級影響", scope: "影響王朝、國家或大型市場" },
  { level: 80, name: "跨界聯盟", scope: "跨國、跨界或跨文明組織" },
  { level: 100, name: "世界規則制定者", scope: "改變整個世界的資源與組織秩序" },
] as const;

export type PowerRelation = {
  sourceId: string;
  targetId: string;
  friendliness: number;
  interest: number;
  fear: number;
  competition: number;
  alliance: number;
  hatred: number;
};

export function evolvePowerRelation(relation: PowerRelation, input: {
  sharedBenefit?: number;
  threat?: number;
  betrayal?: number;
  fulfilledPromise?: number;
}) {
  const cap = (value: number) => Math.max(-100, Math.min(100, Math.round(value)));
  const shared = input.sharedBenefit ?? 0;
  const threat = input.threat ?? 0;
  const betrayal = input.betrayal ?? 0;
  const promise = input.fulfilledPromise ?? 0;
  return {
    ...relation,
    friendliness: cap(relation.friendliness + shared * .4 + promise * .6 - betrayal),
    interest: cap(relation.interest + shared * .8 + threat * .1),
    fear: cap(relation.fear + threat * .8 - promise * .15),
    competition: cap(relation.competition + threat * .35 - shared * .2),
    alliance: cap(relation.alliance + shared * .45 + promise * .7 - betrayal * 1.2),
    hatred: cap(relation.hatred + betrayal + threat * .25 - promise * .3),
  };
}

export function evaluateTalentAssignment(input: {
  professionalAbility: number;
  managementAbility: number;
  loyalty: number;
  ambition: number;
  role: "specialist" | "manager" | "successor";
}) {
  const roleFit = input.role === "specialist"
    ? input.professionalAbility * .75 + input.loyalty * .15 + (100 - input.ambition) * .1
    : input.role === "manager"
      ? input.managementAbility * .58 + input.professionalAbility * .18 + input.loyalty * .16 + (100 - input.ambition) * .08
      : input.managementAbility * .35 + input.professionalAbility * .2 + input.loyalty * .25 + input.ambition * .2;
  const teamDepartureRisk = input.role === "manager"
    ? clamp((input.professionalAbility - input.managementAbility) * .7 + input.ambition * .35 - input.loyalty * .25)
    : clamp(input.ambition * .35 - input.loyalty * .25);
  return {
    roleFit: clamp(roleFit),
    teamDepartureRisk,
    warning: input.role === "manager" && input.professionalAbility - input.managementAbility >= 25
      ? "此人是明星專業者，但管理適性顯著較低；升任主管可能提高團隊流失。"
      : null,
  };
}

export function organizationDailyLoop(kind: "shop" | "cultivation" | "company") {
  if (kind === "shop") return ["早晨決策", "進貨與排班", "白天營業", "顧客／競爭事件", "晚上結算"];
  if (kind === "cultivation") return ["晨課與任務分派", "資源／功法分配", "煉製與探索", "弟子／外勢事件", "宗門結算"];
  return ["晨會決策", "研發／業務／招聘調度", "日間執行", "客戶／市場事件", "現金流與團隊結算"];
}

export type LifeManagementEndingDimension =
  | "財富" | "事業" | "影響力" | "人脈" | "家庭" | "健康" | "名聲" | "傳承";

export type LifeManagementSnapshot = {
  phase: typeof LIFE_MANAGEMENT_PHASES[number];
  dailyTimeBudget: 12;
  delegationCapacity: number;
  dimensions: Record<LifeManagementEndingDimension, number>;
  pressure: number;
  retentionRisk: number;
  feedbackLoop: string[];
};

function finite(resources: StoryState["resources"], key: string, fallback: number) {
  const value = resources[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function readLifeManagementSnapshot(storyState: StoryState): LifeManagementSnapshot {
  const resources = storyState.resources;
  const cash = finite(resources, "management.cash", 100_000);
  const staff = finite(resources, "management.staff", 3);
  const branches = finite(resources, "management.branches", 0);
  const reputation = finite(resources, "management.reputation", 20);
  const marketShare = finite(resources, "management.marketShare", 5);
  const careerScore = clamp(
    Math.log10(Math.max(10, cash)) * 6
    + staff * 1.2
    + branches * 7
    + reputation * .25
    + marketShare * .35
    - 22,
  );
  const phase = [...LIFE_MANAGEMENT_PHASES].reverse().find((item) => careerScore >= item.threshold)
    ?? LIFE_MANAGEMENT_PHASES[0];
  const health = clamp(finite(resources, "status.health", 80) - finite(resources, "status.fatigue", 0) * .35);
  const family = clamp(finite(resources, "life.family", 55) + finite(resources, "romance.trust", 0) * .15);
  const connections = clamp(finite(resources, "life.network", 20) + reputation * .45 + staff * .5);
  const legacy = clamp(finite(resources, "life.legacy", 0) + finite(resources, "management.peopleDeveloped", 0) * 5 + phase.level * 4);
  const pressure = clamp(finite(resources, "status.stress", 10) + finite(resources, "management.risk", 10) * .45);
  const morale = finite(resources, "management.morale", 65);
  const employeeSkill = finite(resources, "management.employeeSkill", 52);
  const publicCriticism = finite(resources, "management.publicCriticism", 0);
  const retentionRisk = clamp(35 + pressure * .35 + publicCriticism * .8 - morale * .32 - employeeSkill * .08);
  const dimensions = {
    財富: clamp(Math.log10(Math.max(10, cash)) * 20 - 40),
    事業: careerScore,
    影響力: clamp(reputation * .55 + marketShare * .45 + branches * 4),
    人脈: connections,
    家庭: family,
    健康: health,
    名聲: clamp(reputation),
    傳承: legacy,
  } satisfies Record<LifeManagementEndingDimension, number>;
  return {
    phase,
    dailyTimeBudget: 12,
    delegationCapacity: Math.max(phase.delegation, Math.floor(staff * (phase.level >= 3 ? .4 : .15))),
    dimensions,
    pressure,
    retentionRisk,
    feedbackLoop: [
      `短期：現金流與成果 ${dimensions.財富}／100`,
      `中期：組織、人才與事業 ${dimensions.事業}／100`,
      `長期：關係、健康與傳承 ${Math.round((dimensions.家庭 + dimensions.健康 + dimensions.傳承) / 3)}／100`,
    ],
  };
}

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619) >>> 0;
  }
  return result;
}

export function simulateAutonomousNpcEvent(input: {
  seed: string;
  turn: number;
  characters: Character[];
  relationships: CharacterRelationship[];
}) {
  if (!input.characters.length) return null;
  const character = input.characters[hash(`${input.seed}:${input.turn}:npc`) % input.characters.length];
  const ambition = character.dynamicsProfile?.personalityAxes.ambition ?? 50;
  const loyalty = character.dynamicsProfile?.personalityAxes.loyalty ?? 50;
  const volatility = character.dynamicsProfile?.personalityAxes.volatility ?? 35;
  const relations = input.relationships.filter((item) => item.fromCharacterId === character.id || item.toCharacterId === character.id);
  const trust = relations.length
    ? relations.reduce((sum, item) => sum + (item.trust ?? 0), 0) / relations.length
    : 0;
  const roll = hash(`${input.seed}:${input.turn}:${character.id}`) % 100;
  const event = roll < Math.max(8, ambition - loyalty + volatility * .25 - trust * .2)
    ? "收到外部挖角或自行創業的機會"
    : roll > 78
      ? "主動培養新人並建立新的合作網"
      : roll > 55
        ? "因工作與私人需求衝突，要求重新談判職責"
        : "在既有職位累積能力與人際記憶";
  return {
    characterId: character.id,
    characterName: character.name,
    event,
    publicSignals: character.personality.value || character.dynamicsProfile?.personalityTraits.join("、") || "公開性格尚未完整",
    causalKey: `npc:${character.id}:turn:${input.turn}`,
  };
}

export function evaluateLifeManagementEnding(snapshot: LifeManagementSnapshot) {
  const dimensions = snapshot.dimensions;
  const average = Object.values(dimensions).reduce((sum, value) => sum + value, 0) / Object.values(dimensions).length;
  if (dimensions.財富 >= 88 && dimensions.家庭 < 35) return { id: "commercial-sovereign", name: "商業帝王", description: "資產與控制力登頂，卻必須面對家庭與親密關係留下的空缺。" };
  if (dimensions.傳承 >= 82 && dimensions.人脈 >= 70) return { id: "mentor-legacy", name: "桃李滿天下", description: "個人財富未必最高，但培養的人才與組織文化持續影響下一代。" };
  if (dimensions.家庭 >= 78 && dimensions.健康 >= 75 && dimensions.事業 >= 50) return { id: "balanced-life", name: "幸福人生", description: "事業有立足之地，也保住健康、家人與重要關係。" };
  if (average >= 82 && Math.min(...Object.values(dimensions)) >= 62) return { id: "legendary-leader", name: "傳奇領袖", description: "事業、影響力、關係、健康與傳承都通過長期因果的考驗。" };
  return { id: "unfinished-life", name: "仍在書寫的人生", description: "沒有被單一成敗定義；現有得失會成為下一段人生的起點。" };
}
