import type {
  Character,
  CharacterDynamicsProfile,
  CharacterPersonalityAxis,
  CharacterRpgArchetype,
  CharacterRpgProfile,
  CharacterRpgStatKey,
} from "../domain";
import {
  characterRpgStatsForArchetype,
  createCharacterRpgProfile,
} from "../game/character-rpg-profile";
import type { CharacterRelationshipEdge, RelationshipMetrics } from "./types";

export const CHARACTER_DYNAMICS_ENGINE_VERSION = "browser-character-dynamics-v1" as const;

export const CHARACTER_PERSONALITY_AXIS_LABELS: Record<CharacterPersonalityAxis, string> = {
  curiosity: "好奇",
  empathy: "共感",
  ambition: "企圖",
  caution: "謹慎",
  loyalty: "忠誠",
  volatility: "情緒波動",
};

type NarrativeArchetype = {
  id: string;
  label: string;
  genreTags: string[];
  traits: string[];
  needs: string[];
  tendencies: string[];
  socialRoles: string[];
  rpgArchetype: Exclude<CharacterRpgArchetype, "custom">;
  axes: Record<CharacterPersonalityAxis, number>;
};

/**
 * Reusable narrative rules rather than copied characters or prose from protected works.
 * These archetypes can be combined across wuxia, xianxia, romance, mystery, fantasy,
 * science fiction, historical and contemporary stories.
 */
export const NARRATIVE_ARCHETYPES: NarrativeArchetype[] = [
  { id: "wandering-seeker", label: "漂泊求道者", genreTags: ["武俠", "仙俠", "冒險"], traits: ["獨立", "好奇", "重視自由"], needs: ["保留選擇權", "找到歸屬"], tendencies: ["先觀察陌生規則", "在關鍵時刻打破慣例"], socialRoles: ["探索者", "變局引路人"], rpgArchetype: "balanced", axes: { curiosity: 78, empathy: 52, ambition: 58, caution: 48, loyalty: 56, volatility: 44 } },
  { id: "oath-guardian", label: "誓約守護者", genreTags: ["武俠", "奇幻", "歷史"], traits: ["可靠", "克制", "責任感"], needs: ["守住承諾", "被同伴信任"], tendencies: ["優先保護弱者", "承擔團隊代價"], socialRoles: ["守護者", "團隊核心"], rpgArchetype: "vanguard", axes: { curiosity: 40, empathy: 68, ambition: 42, caution: 63, loyalty: 84, volatility: 28 } },
  { id: "hidden-strategist", label: "隱線策士", genreTags: ["推理", "權謀", "科幻"], traits: ["冷靜", "洞察", "善於布局"], needs: ["掌握可信情報", "保有退路"], tendencies: ["比較多條因果線", "避免過早公開底牌"], socialRoles: ["策士", "情報樞紐"], rpgArchetype: "strategist", axes: { curiosity: 72, empathy: 38, ambition: 68, caution: 80, loyalty: 46, volatility: 22 } },
  { id: "compassionate-healer", label: "慈悲療癒者", genreTags: ["仙俠", "現代", "災難"], traits: ["溫柔", "堅韌", "重視生命"], needs: ["讓傷害有補救方式", "維持人性界線"], tendencies: ["先處理不可逆傷害", "用合作取代控制"], socialRoles: ["療癒者", "調停者"], rpgArchetype: "diplomat", axes: { curiosity: 55, empathy: 88, ambition: 35, caution: 67, loyalty: 74, volatility: 32 } },
  { id: "fate-rebel", label: "逆命反抗者", genreTags: ["仙俠", "反烏托邦", "青春"], traits: ["不服輸", "直率", "渴望改變"], needs: ["證明命運可改", "拒絕被定義"], tendencies: ["挑戰不公平規則", "失敗後尋找新路"], socialRoles: ["反抗者", "變革催化者"], rpgArchetype: "vanguard", axes: { curiosity: 64, empathy: 48, ambition: 82, caution: 25, loyalty: 58, volatility: 70 } },
  { id: "masked-trickster", label: "多面破局者", genreTags: ["喜劇", "諜報", "奇幻"], traits: ["機敏", "幽默", "難以預測"], needs: ["保有秘密空間", "找到真正理解自己的人"], tendencies: ["用誤導測試對手", "把危機轉成交換"], socialRoles: ["破局者", "不穩定盟友"], rpgArchetype: "creator", axes: { curiosity: 82, empathy: 44, ambition: 62, caution: 52, loyalty: 38, volatility: 62 } },
  { id: "burdened-sovereign", label: "負重領導者", genreTags: ["歷史", "權謀", "經營"], traits: ["自律", "有遠見", "承受孤獨"], needs: ["建立可持續秩序", "有人敢說真話"], tendencies: ["權衡群體利益", "在危機時集中決策"], socialRoles: ["領導者", "資源中心"], rpgArchetype: "diplomat", axes: { curiosity: 50, empathy: 56, ambition: 86, caution: 72, loyalty: 66, volatility: 30 } },
  { id: "forbidden-scholar", label: "禁域研究者", genreTags: ["仙俠", "科幻", "恐怖"], traits: ["求知", "專注", "願意冒險"], needs: ["理解未知代價", "保留研究自主"], tendencies: ["拆解規則再重組", "以小規模實驗驗證"], socialRoles: ["研究者", "秘密持有者"], rpgArchetype: "mystic", axes: { curiosity: 92, empathy: 34, ambition: 70, caution: 58, loyalty: 40, volatility: 48 } },
  { id: "scarred-survivor", label: "帶傷倖存者", genreTags: ["末世", "戰爭", "懸疑"], traits: ["務實", "警覺", "珍惜資源"], needs: ["可預測的安全感", "重新學會信任"], tendencies: ["先確認出口", "用行動而非承諾判斷他人"], socialRoles: ["生存者", "風險哨兵"], rpgArchetype: "balanced", axes: { curiosity: 38, empathy: 50, ambition: 45, caution: 90, loyalty: 54, volatility: 55 } },
  { id: "devoted-artisan", label: "執著創造者", genreTags: ["職人", "經營", "奇幻"], traits: ["專注", "講究品質", "持續改良"], needs: ["作品被正確理解", "保有創作標準"], tendencies: ["把失敗轉成配方", "透過作品建立關係"], socialRoles: ["創造者", "技術支點"], rpgArchetype: "creator", axes: { curiosity: 76, empathy: 46, ambition: 65, caution: 61, loyalty: 60, volatility: 36 } },
  { id: "visionary-mystic", label: "異象解讀者", genreTags: ["仙俠", "神話", "靈異"], traits: ["敏感", "直覺", "尊重徵兆"], needs: ["分辨真實與幻象", "被允許保留不確定"], tendencies: ["從象徵尋找關聯", "先提出候選而非宣稱真相"], socialRoles: ["預警者", "精神指引"], rpgArchetype: "mystic", axes: { curiosity: 84, empathy: 70, ambition: 42, caution: 58, loyalty: 52, volatility: 66 } },
  { id: "idealistic-connector", label: "理想連結者", genreTags: ["言情", "群像", "現代"], traits: ["真誠", "樂觀", "相信合作"], needs: ["建立互相理解", "讓關係有成長空間"], tendencies: ["主動促成對話", "在衝突中尋找共同目標"], socialRoles: ["連結者", "朋友圈橋樑"], rpgArchetype: "diplomat", axes: { curiosity: 62, empathy: 86, ambition: 56, caution: 42, loyalty: 76, volatility: 44 } },
];

export type CharacterDynamicsCandidateProfile = {
  characterId: string;
  archetypeId: string;
  archetypeLabel: string;
  personalityAxes: Record<CharacterPersonalityAxis, number>;
  personalityTraits: string[];
  socialRole: string;
  relationshipNeeds: string[];
  behavioralTendencies: string[];
  rpgArchetype: Exclude<CharacterRpgArchetype, "custom">;
  proposedRpgStats: Record<CharacterRpgStatKey, number>;
  preservesApprovedRpgProfile: boolean;
};

export type CharacterDynamicsRelationshipCandidate = {
  candidateId: string;
  fromCharacterId: string;
  toCharacterId: string;
  relationshipTypes: string[];
  metrics: RelationshipMetrics;
  rationale: string;
};

export type SocialNetworkComplexity = {
  characterCount: number;
  directedEdgeCount: number;
  density: number;
  reciprocity: number;
  triangleRatio: number;
  cohesion: number;
  tension: number;
  polarization: number;
  complexityScore: number;
  label: "單純" | "多線" | "複雜" | "高度交織";
};

export type CharacterDynamicsCandidate = {
  candidateId: string;
  engineVersion: typeof CHARACTER_DYNAMICS_ENGINE_VERSION;
  playthroughSeed: string;
  generatedAt: string;
  canonicalMutation: 0;
  profiles: CharacterDynamicsCandidateProfile[];
  relationships: CharacterDynamicsRelationshipCandidate[];
  complexity: SocialNetworkComplexity;
};

const AXES: CharacterPersonalityAxis[] = ["curiosity", "empathy", "ambition", "caution", "loyalty", "volatility"];
const METRICS: Array<keyof RelationshipMetrics> = ["trust", "affection", "attraction", "fear", "resentment", "loyalty", "debt", "dependency", "conflict", "powerBalance"];
const clamp = (value: number, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, Math.round(value)));

export function dynamicsHash(value: string) {
  let hash = 2166136261;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function seededRandom(seed: string) {
  let state = dynamicsHash(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function characterText(character: Character) {
  return [
    character.name,
    character.identity.value,
    character.personality.value,
    character.goal.value,
    ...(character.values ?? []),
    ...(character.capabilities ?? []),
    ...(character.limitations ?? []),
    ...(character.portrait?.traits ?? []),
    character.portrait?.role,
  ].filter(Boolean).join(" ");
}

function selectArchetype(character: Character, seed: string) {
  const text = characterText(character);
  const scored = NARRATIVE_ARCHETYPES.map((archetype) => {
    const terms = [...archetype.genreTags, ...archetype.traits, ...archetype.socialRoles];
    const lexical = terms.reduce((score, term) => score + (text.includes(term) ? 9 : 0), 0);
    return { archetype, score: lexical + dynamicsHash(`${seed}|${character.id}|${archetype.id}`) % 11 };
  });
  return scored.sort((a, b) => b.score - a.score || a.archetype.id.localeCompare(b.archetype.id))[0].archetype;
}

function variedAxes(archetype: NarrativeArchetype, character: Character, seed: string) {
  const random = seededRandom(`${seed}|axes|${character.id}`);
  return Object.fromEntries(AXES.map((axis) => [
    axis,
    clamp(archetype.axes[axis] + Math.round((random() - 0.5) * 24), 12, 92),
  ])) as Record<CharacterPersonalityAxis, number>;
}

function variedStats(archetype: NarrativeArchetype, character: Character, seed: string) {
  if (character.rpgProfile) return { ...character.rpgProfile.stats };
  const stats = characterRpgStatsForArchetype(archetype.rpgArchetype);
  const keys = Object.keys(stats) as CharacterRpgStatKey[];
  const random = seededRandom(`${seed}|rpg|${character.id}`);
  for (let index = 0; index < 18; index += 1) {
    const from = keys[Math.floor(random() * keys.length)];
    let to = keys[Math.floor(random() * keys.length)];
    if (to === from) to = keys[(keys.indexOf(to) + 1) % keys.length];
    if (stats[from] > 20 && stats[to] < 80) {
      stats[from] -= 1;
      stats[to] += 1;
    }
  }
  return stats;
}

function relationshipMetrics(
  from: CharacterDynamicsCandidateProfile,
  to: CharacterDynamicsCandidateProfile,
  characters: Map<string, Character>,
  seed: string,
): RelationshipMetrics {
  const random = seededRandom(`${seed}|edge|${from.characterId}|${to.characterId}`);
  const similarity = 100 - AXES.reduce((sum, axis) => sum + Math.abs(from.personalityAxes[axis] - to.personalityAxes[axis]), 0) / AXES.length;
  const adultRomanceAllowed = [characters.get(from.characterId), characters.get(to.characterId)]
    .every((character) => Boolean(character?.ageVerified && (character?.age ?? 0) >= 18));
  const trust = clamp(similarity * 0.45 + from.personalityAxes.empathy * 0.2 + (random() - 0.5) * 34, -100, 100);
  const affection = clamp(similarity * 0.35 + from.personalityAxes.loyalty * 0.15 + (random() - 0.5) * 38, -100, 100);
  const conflict = clamp(Math.abs(from.personalityAxes.ambition - to.personalityAxes.ambition) * 0.45 + from.personalityAxes.volatility * 0.25 + random() * 28, -100, 100);
  return {
    trust,
    affection,
    attraction: adultRomanceAllowed ? clamp((affection + random() * 38) * 0.55, -100, 100) : 0,
    fear: clamp(to.personalityAxes.ambition * 0.16 + to.personalityAxes.volatility * 0.18 + random() * 20, -100, 100),
    resentment: clamp(conflict * 0.42 + random() * 16 - 8, -100, 100),
    loyalty: clamp((trust + from.personalityAxes.loyalty) * 0.5 + random() * 12, -100, 100),
    debt: clamp((random() - 0.45) * 54, -100, 100),
    dependency: clamp((affection * 0.24) + random() * 22, -100, 100),
    conflict,
    powerBalance: clamp((to.proposedRpgStats["rpg.will"] - from.proposedRpgStats["rpg.will"]) * 1.4 + (random() - 0.5) * 24, -100, 100),
  };
}

function relationshipTypes(metrics: RelationshipMetrics) {
  const result: string[] = [];
  if (metrics.trust >= 48 && metrics.affection >= 42) result.push("朋友");
  if (metrics.loyalty >= 58) result.push("盟友");
  if (metrics.conflict >= 48) result.push("競爭者");
  if (metrics.fear >= 46) result.push("戒備");
  if (metrics.attraction >= 50) result.push("潛在情感線");
  return result.length ? result.slice(0, 3) : [metrics.trust >= 0 ? "認識" : "互不信任"];
}

function edgeKey(fromCharacterId: string, toCharacterId: string) {
  return `${fromCharacterId}->${toCharacterId}`;
}

function toMetrics(edge: CharacterRelationshipEdge): RelationshipMetrics {
  return Object.fromEntries(METRICS.map((metric) => [metric, edge[metric]])) as unknown as RelationshipMetrics;
}

export function calculateSocialNetworkComplexity(input: {
  characterIds: string[];
  edges: Array<{ fromCharacterId: string; toCharacterId: string; metrics: RelationshipMetrics }>;
}): SocialNetworkComplexity {
  const ids = [...new Set(input.characterIds)];
  const valid = input.edges.filter((edge) => ids.includes(edge.fromCharacterId) && ids.includes(edge.toCharacterId) && edge.fromCharacterId !== edge.toCharacterId);
  const unique = new Map(valid.map((edge) => [edgeKey(edge.fromCharacterId, edge.toCharacterId), edge]));
  const edges = [...unique.values()];
  const possible = ids.length > 1 ? ids.length * (ids.length - 1) : 0;
  const density = possible ? edges.length / possible * 100 : 0;
  const reciprocal = edges.filter((edge) => unique.has(edgeKey(edge.toCharacterId, edge.fromCharacterId))).length;
  const reciprocity = edges.length ? reciprocal / edges.length * 100 : 0;
  const undirected = new Set(edges.map((edge) => [edge.fromCharacterId, edge.toCharacterId].sort().join("|")));
  let triangles = 0;
  for (let a = 0; a < ids.length; a += 1) for (let b = a + 1; b < ids.length; b += 1) for (let c = b + 1; c < ids.length; c += 1) {
    if (undirected.has([ids[a], ids[b]].sort().join("|")) && undirected.has([ids[a], ids[c]].sort().join("|")) && undirected.has([ids[b], ids[c]].sort().join("|"))) triangles += 1;
  }
  const possibleTriangles = ids.length >= 3 ? ids.length * (ids.length - 1) * (ids.length - 2) / 6 : 0;
  const triangleRatio = possibleTriangles ? triangles / possibleTriangles * 100 : 0;
  const cohesionValues = edges.map((edge) => (edge.metrics.trust + edge.metrics.affection + edge.metrics.loyalty) / 3);
  const tensionValues = edges.map((edge) => (edge.metrics.conflict + edge.metrics.resentment + edge.metrics.fear) / 3);
  const cohesion = cohesionValues.length ? cohesionValues.reduce((sum, value) => sum + value, 0) / cohesionValues.length : 0;
  const tension = tensionValues.length ? tensionValues.reduce((sum, value) => sum + value, 0) / tensionValues.length : 0;
  const trustValues = edges.map((edge) => edge.metrics.trust);
  const trustMean = trustValues.length ? trustValues.reduce((sum, value) => sum + value, 0) / trustValues.length : 0;
  const polarization = trustValues.length ? Math.sqrt(trustValues.reduce((sum, value) => sum + (value - trustMean) ** 2, 0) / trustValues.length) : 0;
  const complexityScore = clamp(density * 0.28 + reciprocity * 0.16 + triangleRatio * 0.18 + Math.abs(tension) * 0.2 + polarization * 0.18);
  return {
    characterCount: ids.length,
    directedEdgeCount: edges.length,
    density: clamp(density),
    reciprocity: clamp(reciprocity),
    triangleRatio: clamp(triangleRatio),
    cohesion: clamp(cohesion, -100, 100),
    tension: clamp(tension, -100, 100),
    polarization: clamp(polarization),
    complexityScore,
    label: complexityScore >= 76 ? "高度交織" : complexityScore >= 52 ? "複雜" : complexityScore >= 28 ? "多線" : "單純",
  };
}

export function buildCharacterDynamicsCandidate(input: {
  projectId: string;
  characters: Character[];
  existingRelationships?: CharacterRelationshipEdge[];
  playthroughSeed: string;
  generatedAt?: string;
}): CharacterDynamicsCandidate {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const seed = `${input.projectId}|${input.playthroughSeed}`;
  const profiles = input.characters.map((character) => {
    const archetype = selectArchetype(character, seed);
    const axes = variedAxes(archetype, character, seed);
    return {
      characterId: character.id,
      archetypeId: archetype.id,
      archetypeLabel: archetype.label,
      personalityAxes: axes,
      personalityTraits: [...new Set([...archetype.traits, ...(character.portrait?.traits ?? [])])].slice(0, 6),
      socialRole: archetype.socialRoles[dynamicsHash(`${seed}|role|${character.id}`) % archetype.socialRoles.length],
      relationshipNeeds: [...archetype.needs],
      behavioralTendencies: [...archetype.tendencies],
      rpgArchetype: archetype.rpgArchetype,
      proposedRpgStats: variedStats(archetype, character, seed),
      preservesApprovedRpgProfile: Boolean(character.rpgProfile),
    } satisfies CharacterDynamicsCandidateProfile;
  });
  const profileById = new Map(profiles.map((profile) => [profile.characterId, profile]));
  const characterById = new Map(input.characters.map((character) => [character.id, character]));
  const existingKeys = new Set((input.existingRelationships ?? []).map((edge) => edgeKey(edge.fromCharacterId, edge.toCharacterId)));
  const proposed = new Map<string, CharacterDynamicsRelationshipCandidate>();
  const ids = input.characters.map((character) => character.id);
  const addEdge = (fromCharacterId: string, toCharacterId: string, reason: string) => {
    const key = edgeKey(fromCharacterId, toCharacterId);
    if (existingKeys.has(key) || proposed.has(key) || fromCharacterId === toCharacterId) return;
    const from = profileById.get(fromCharacterId);
    const to = profileById.get(toCharacterId);
    if (!from || !to) return;
    const metrics = relationshipMetrics(from, to, characterById, seed);
    proposed.set(key, {
      candidateId: `dynamic-edge-${dynamicsHash(`${seed}|${key}`).toString(16)}`,
      fromCharacterId,
      toCharacterId,
      relationshipTypes: relationshipTypes(metrics),
      metrics,
      rationale: `${reason}；依兩人的核准資料與「${from.archetypeLabel}／${to.archetypeLabel}」互動規則計算。`,
    });
  };
  if (ids.length > 1) {
    const offset = dynamicsHash(`${seed}|ring`) % ids.length;
    for (let index = 0; index < ids.length; index += 1) {
      const from = ids[(index + offset) % ids.length];
      const to = ids[(index + offset + 1) % ids.length];
      addEdge(from, to, "確保朋友圈至少形成一條可互動路徑");
    }
    const targetDensity = Math.min(0.7, 0.34 + (dynamicsHash(`${seed}|density`) % 25) / 100);
    const targetCount = Math.max(ids.length, Math.round(ids.length * (ids.length - 1) * targetDensity));
    const pairCandidates = ids.flatMap((from) => ids.filter((to) => to !== from).map((to) => ({ from, to })))
      .sort((left, right) => dynamicsHash(`${seed}|pair|${left.from}|${left.to}`) - dynamicsHash(`${seed}|pair|${right.from}|${right.to}`));
    for (const pair of pairCandidates) {
      if (proposed.size >= targetCount) break;
      addEdge(pair.from, pair.to, "本周目新增的支線關係候選");
    }
  }
  const combined = [
    ...(input.existingRelationships ?? []).map((edge) => ({ fromCharacterId: edge.fromCharacterId, toCharacterId: edge.toCharacterId, metrics: toMetrics(edge) })),
    ...[...proposed.values()],
  ];
  return {
    candidateId: `character-dynamics-${dynamicsHash(`${seed}|${generatedAt}`).toString(16)}`,
    engineVersion: CHARACTER_DYNAMICS_ENGINE_VERSION,
    playthroughSeed: input.playthroughSeed,
    generatedAt,
    canonicalMutation: 0,
    profiles,
    relationships: [...proposed.values()],
    complexity: calculateSocialNetworkComplexity({ characterIds: ids, edges: combined }),
  };
}

export function approveCharacterDynamicsProfile(
  candidate: CharacterDynamicsCandidateProfile,
  playthroughSeed: string,
  approvedAt = new Date().toISOString(),
): { dynamicsProfile: CharacterDynamicsProfile; rpgProfile: CharacterRpgProfile } {
  return {
    dynamicsProfile: {
      schemaVersion: "character-dynamics-profile-v1",
      engineVersion: CHARACTER_DYNAMICS_ENGINE_VERSION,
      playthroughSeed,
      archetypeId: candidate.archetypeId,
      archetypeLabel: candidate.archetypeLabel,
      personalityAxes: { ...candidate.personalityAxes },
      personalityTraits: [...candidate.personalityTraits],
      socialRole: candidate.socialRole,
      relationshipNeeds: [...candidate.relationshipNeeds],
      behavioralTendencies: [...candidate.behavioralTendencies],
      approvedAt,
      approvedBy: "user",
    },
    rpgProfile: createCharacterRpgProfile({
      archetype: candidate.rpgArchetype,
      stats: candidate.proposedRpgStats,
      approvedAt,
    }),
  };
}
