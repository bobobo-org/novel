import {
  PROCEDURAL_CAUSAL_DIMENSIONS,
  PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
  PROCEDURAL_TREASURE_CAPACITY,
  proceduralTreasureAt,
  type ProceduralCausalDimension,
  type ProceduralStoryContext,
} from "./procedural-story-library";
import {
  treasureStakeholderPopulationIndices,
} from "./procedural-treasure-ownership";
import {
  proceduralTreasureClassificationAt,
  type ProceduralTreasureKind,
  type ProceduralTreasureRarity,
} from "./procedural-treasure-classification";
import {
  DeterministicSocialMatrix,
  type SocialMatrixCharacter,
} from "../social-matrix";

export const PROCEDURAL_TREASURE_LIBRARY_VERSION = "procedural-treasure-library-v3" as const;
export const PROCEDURAL_TREASURE_MATERIALIZATION_POLICY =
  "indexed-on-demand-bounded-lru" as const;
export const PROCEDURAL_TREASURE_PAGE_MAX = 100;
export const PROCEDURAL_TREASURE_CACHE_DEFAULT = 256;
export const PROCEDURAL_TREASURE_CACHE_MAX = 2_048;
export const PROCEDURAL_TREASURE_SCENARIO_VARIANTS_PER_TREASURE = 10;

export type { ProceduralTreasureKind, ProceduralTreasureRarity } from "./procedural-treasure-classification";

export type ProceduralTreasureAbility = {
  id: string;
  name: string;
  effect: string;
  activation: string;
  magnitude: number;
  tags: string[];
};

export type ProceduralTreasureStakeholderRole = "holder" | "claimant" | "witness";

export type ProceduralTreasureStakeholder = {
  role: ProceduralTreasureStakeholderRole;
  populationIndex: number;
  characterId: string;
  characterName: string;
  factionId: string;
  factionName: string;
  factionKind: string;
  familyId: string;
  relationship: string;
};

export type ProceduralTreasureCrossMatrix = {
  storySeed: string;
  treasureOrdinal: number;
  treasureId: string;
  scenarioOrdinal: number;
  scenarioVariant: number;
  scenarioId: string;
  relationshipScenarioCapacity: typeof PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY;
  causalDimensionCount: 10;
  causalDimensionIds: string[];
  castPopulationIndices: [number, number, number];
  castCharacterIds: [string, string, string];
};

export type ProceduralTreasureScenarioBinding = {
  storySeedTag: string;
  treasureOrdinal: number;
  treasureId: string;
  scenarioOrdinal: number;
  scenarioVariant: number;
  scenarioId: string;
  castPopulationIndices: [number, number, number];
  castCharacterIds: [string, string, string];
};

export type ProceduralTreasureRecord = {
  schemaVersion: typeof PROCEDURAL_TREASURE_LIBRARY_VERSION;
  materializationPolicy: typeof PROCEDURAL_TREASURE_MATERIALIZATION_POLICY;
  id: string;
  ordinal: number;
  fictional: true;
  name: string;
  kind: ProceduralTreasureKind;
  kindLabel: string;
  subtype: string;
  rarity: ProceduralTreasureRarity;
  rarityLabel: string;
  storyAffinity: string;
  abilities: [ProceduralTreasureAbility, ProceduralTreasureAbility];
  limitation: string;
  cost: string;
  storyHook: string;
  visualSeed: string;
  visualDescription: string;
  holder: ProceduralTreasureStakeholder;
  stakeholders: [
    ProceduralTreasureStakeholder,
    ProceduralTreasureStakeholder,
    ProceduralTreasureStakeholder,
  ];
  causalDimensions: ProceduralCausalDimension[];
  crossMatrix: ProceduralTreasureCrossMatrix;
};

export type ProceduralTreasurePage = {
  pageIndex: number;
  pageSize: number;
  totalItems: typeof PROCEDURAL_TREASURE_CAPACITY;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  items: ProceduralTreasureRecord[];
};

type TreasureKindDefinition = {
  id: ProceduralTreasureKind;
  label: string;
  subtypes: readonly string[];
  abilityNames: readonly string[];
  effects: readonly string[];
  activations: readonly string[];
  costs: readonly string[];
};

const TREASURE_KINDS: readonly TreasureKindDefinition[] = [
  {
    id: "pill",
    label: "丹藥／藥丸",
    subtypes: ["療傷丹", "破境丸", "解毒散", "養魂露", "洗髓膏", "續脈丹"],
    abilityNames: ["續脈", "清毒", "聚氣", "定魂", "護心", "洗髓"],
    effects: [
      "穩住一次已經發生的傷勢，讓人物獲得完成眼前行動的時間",
      "清除一項可驗證的負面狀態，但不會抹去造成狀態的因果",
      "將散失的靈力集中成一次可控輸出，不能直接跨越修行門檻",
      "保住一段即將破碎的記憶，讓當事人仍能自行作出選擇",
    ],
    activations: ["服下後靜坐一刻", "以持有人靈息化開封蠟", "由醫者核對體質後分次使用"],
    costs: ["三個重要節點內無法再次服用同類丹藥", "藥力會留下可被追蹤的靈息", "必須消耗一份同階藥引"],
  },
  {
    id: "weapon",
    label: "武器",
    subtypes: ["長劍", "靈弓", "護刃", "戰槍", "機巧索", "鎮岳錘"],
    abilityNames: ["破障", "護陣", "追痕", "斷契", "鎮壓", "引雷"],
    effects: [
      "切開一層外在封鎖，卻不能替持有人判斷封鎖後是否安全",
      "替指定同伴承受一次可見衝擊，代價會完整留在武器與持有人身上",
      "標記一次敵方行動留下的痕跡，使下一次追查不再從零開始",
      "中止一份遭竄改的強制契約，但不能取消自願承擔的承諾",
    ],
    activations: ["完成一次蓄勢後出鞘", "由合法持有人解除兵印", "在目標留下可驗證痕跡後啟動"],
    costs: ["器刃會產生一道不可修復的裂痕", "持有人會失去一次安全撤退機會", "使用後必須公開武器所在位置"],
  },
  {
    id: "talisman",
    label: "符",
    subtypes: ["護身符", "傳訊符", "鎮魂符", "遁行符", "鑑真符", "封息符"],
    abilityNames: ["護身", "傳訊", "鑑真", "匿蹤", "封息", "示警"],
    effects: [
      "抵消一次明確指向持有人的危險，不能保證後續安全",
      "把一段訊息送到已建立聯繫的對象手中，沿途會留下時間印記",
      "辨認物證是否遭到替換，但不會推定交換者的動機",
      "遮蔽一段短程行蹤，無法抹去先前已被看見的事實",
    ],
    activations: ["撕開符角並說明用途", "由兩名見證者同時按印", "在符紙寫下可核對的目標"],
    costs: ["符紙使用一次即焚毀", "使用者必須留下真名或等價憑證", "下一次同類術式的效果會減弱"],
  },
  {
    id: "formation",
    label: "陣法",
    subtypes: ["護城陣", "聚靈陣", "迷蹤陣", "傳送陣", "鑑心陣", "封界陣"],
    abilityNames: ["護域", "聚流", "移位", "驗證", "隔絕", "共鳴"],
    effects: [
      "保護陣域內的人直到眼前事件結束，不能把威脅永久隔絕",
      "重新分配陣域內既有資源，不會憑空創造靈力或物資",
      "建立兩處已勘定地點間的短暫通道，目的地必須有人接應",
      "讓互相矛盾的證詞留下可比較的回聲，仍由人物自行判斷",
    ],
    activations: ["依序校準四個陣眼", "由三個不同立場共同啟陣", "先完成地形與能量稽核"],
    costs: ["啟動後一個陣眼永久失效", "陣內所有勢力都會得知啟動者", "維持期間會持續消耗稀缺材料"],
  },
  {
    id: "special-opportunity",
    label: "特殊機緣",
    subtypes: ["古修傳承", "祕境入口", "天道試煉", "異界邀請", "失落師承", "命運交換"],
    abilityNames: ["傳承", "開界", "悟道", "轉命", "問心", "借勢"],
    effects: [
      "開放一條原本不存在的成長路線，但必須以後續行動證明資格",
      "揭露一處尚未探索的世界節點，不保證其中資源無主或安全",
      "讓人物看見自身選擇的一項長期後果，不能代替人物決定",
      "把一次失敗轉成可追查的線索，卻不會把結果改寫成成功",
    ],
    activations: ["完成機緣指定的前置承諾", "由持有人主動接受試煉", "在三方見證下打開入口"],
    costs: ["接受後會關閉另一條捷徑", "失敗會公開一項隱藏弱點", "機緣只能由一名符合條件的人承接"],
  },
] as const;

const HOLDER_RELATIONSHIPS = [
  "依法保管並擁有本次啟用的最終決定權",
  "代替失蹤前任持有，必須完成遺願才可轉交",
  "從所屬勢力借出，任何使用都會改變雙方信用",
  "與另一名聲索者共同持有，無法單方面處分",
  "曾遭此物反噬，因此能否啟用必須先取得本人核准",
  "以自身功績取得暫時持有權，期限結束後必須歸還",
] as const;

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function requireOrdinal(ordinal: number) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= PROCEDURAL_TREASURE_CAPACITY) {
    throw new RangeError(`TREASURE_LIBRARY_ORDINAL_OUT_OF_RANGE:${ordinal}`);
  }
}

function requireScenarioVariant(scenarioVariant: number) {
  if (
    !Number.isSafeInteger(scenarioVariant)
    || scenarioVariant < 0
    || scenarioVariant >= PROCEDURAL_TREASURE_SCENARIO_VARIANTS_PER_TREASURE
  ) {
    throw new RangeError(`TREASURE_SCENARIO_VARIANT_OUT_OF_RANGE:${scenarioVariant}`);
  }
}

function treasureScenarioSeedTag(storySeed: string) {
  return hashText(`${storySeed}|treasure-scenario-binding`)
    .toString(36)
    .padStart(7, "0");
}

function treasureScenarioCastChecksum(input: {
  treasureId: string;
  castCharacterIds: [string, string, string];
}) {
  return hashText(`${input.treasureId}|${input.castCharacterIds.join("|")}`)
    .toString(36)
    .padStart(7, "0");
}

/**
 * Binds one of the million relationship-scenario slots to exactly one
 * treasure and its holder/claimant/witness cast. The ordinal layout is
 * reversible: floor(scenarioOrdinal / 10) is the treasure ordinal and the
 * remainder is its scenario variant.
 */
export function proceduralTreasureScenarioBindingAt(input: {
  storySeed: string;
  treasureOrdinal: number;
  scenarioVariant: number;
  context?: ProceduralStoryContext;
  socialMatrix?: DeterministicSocialMatrix;
}): ProceduralTreasureScenarioBinding {
  const storySeed = input.storySeed.trim();
  if (!storySeed) throw new Error("TREASURE_LIBRARY_STORY_SEED_REQUIRED");
  requireOrdinal(input.treasureOrdinal);
  requireScenarioVariant(input.scenarioVariant);
  const socialMatrix = input.socialMatrix ?? new DeterministicSocialMatrix({
    seed: storySeed,
    context: input.context,
    cacheLimit: 0,
  });
  if (socialMatrix.seed !== storySeed) {
    throw new Error("TREASURE_LIBRARY_SOCIAL_MATRIX_SEED_MISMATCH");
  }
  const cast = treasureStakeholderPopulationIndices({
    storySeed,
    treasureOrdinal: input.treasureOrdinal,
    populationSize: socialMatrix.populationSize,
  });
  const castPopulationIndices: [number, number, number] = [
    cast.holder,
    cast.claimant,
    cast.witness,
  ];
  const castCharacterIds: [string, string, string] = castPopulationIndices.map(
    (populationIndex) => socialMatrix.characterId(populationIndex),
  ) as [string, string, string];
  const treasure = proceduralTreasureAt({
    seed: storySeed,
    ordinal: input.treasureOrdinal,
    context: input.context,
  });
  const storySeedTag = treasureScenarioSeedTag(storySeed);
  const scenarioOrdinal =
    input.treasureOrdinal * PROCEDURAL_TREASURE_SCENARIO_VARIANTS_PER_TREASURE
    + input.scenarioVariant;
  const checksum = treasureScenarioCastChecksum({
    treasureId: treasure.id,
    castCharacterIds,
  });
  return {
    storySeedTag,
    treasureOrdinal: input.treasureOrdinal,
    treasureId: treasure.id,
    scenarioOrdinal,
    scenarioVariant: input.scenarioVariant,
    scenarioId: `treasure-scenario-${storySeedTag}-${scenarioOrdinal
      .toString(36)
      .padStart(4, "0")}-${checksum}`,
    castPopulationIndices,
    castCharacterIds,
  };
}

export function proceduralTreasureScenarioBindingFromOrdinal(input: {
  storySeed: string;
  scenarioOrdinal: number;
  context?: ProceduralStoryContext;
  socialMatrix?: DeterministicSocialMatrix;
}) {
  if (
    !Number.isSafeInteger(input.scenarioOrdinal)
    || input.scenarioOrdinal < 0
    || input.scenarioOrdinal >= PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY
  ) {
    throw new RangeError(
      `TREASURE_SCENARIO_ORDINAL_OUT_OF_RANGE:${input.scenarioOrdinal}`,
    );
  }
  const treasureOrdinal = Math.floor(
    input.scenarioOrdinal / PROCEDURAL_TREASURE_SCENARIO_VARIANTS_PER_TREASURE,
  );
  const scenarioVariant =
    input.scenarioOrdinal % PROCEDURAL_TREASURE_SCENARIO_VARIANTS_PER_TREASURE;
  return proceduralTreasureScenarioBindingAt({
    ...input,
    treasureOrdinal,
    scenarioVariant,
  });
}

export function proceduralTreasureScenarioBindingFromId(input: {
  storySeed: string;
  scenarioId: string;
  context?: ProceduralStoryContext;
  socialMatrix?: DeterministicSocialMatrix;
}) {
  const match = /^treasure-scenario-([0-9a-z]{7})-([0-9a-z]{4})-([0-9a-z]{7})$/u
    .exec(input.scenarioId);
  if (!match) throw new Error("TREASURE_SCENARIO_ID_INVALID");
  const scenarioOrdinal = Number.parseInt(match[2], 36);
  const binding = proceduralTreasureScenarioBindingFromOrdinal({
    storySeed: input.storySeed,
    scenarioOrdinal,
    context: input.context,
    socialMatrix: input.socialMatrix,
  });
  if (binding.scenarioId !== input.scenarioId) {
    throw new Error("TREASURE_SCENARIO_ID_BINDING_MISMATCH");
  }
  return binding;
}

function stakeholderFor(input: {
  matrix: DeterministicSocialMatrix;
  role: ProceduralTreasureStakeholderRole;
  character: SocialMatrixCharacter;
  relationship: string;
}): ProceduralTreasureStakeholder {
  const institutionIndex = Number.parseInt(input.character.institutionId.split(":").at(-1) ?? "", 36);
  const institution = Number.isSafeInteger(institutionIndex)
    ? input.matrix.getInstitution(institutionIndex)
    : null;
  return {
    role: input.role,
    populationIndex: input.character.populationIndex,
    characterId: input.character.characterId,
    characterName: input.character.name,
    factionId: input.character.institutionId,
    factionName: institution?.name ?? input.character.identity.split("的")[0],
    factionKind: institution?.kind ?? "組織",
    familyId: input.character.familyId,
    relationship: input.relationship,
  };
}

function abilityFor(input: {
  storySeed: string;
  ordinal: number;
  definition: TreasureKindDefinition;
  abilityIndex: 0 | 1;
  magnitudeBonus: number;
}): ProceduralTreasureAbility {
  const hash = hashText(
    `${input.storySeed}|ability|${input.ordinal}|${input.abilityIndex}|${input.definition.id}`,
  );
  const name = input.definition.abilityNames[
    (hash + input.abilityIndex) % input.definition.abilityNames.length
  ];
  const effect = input.definition.effects[
    (Math.floor(hash / 7) + input.abilityIndex) % input.definition.effects.length
  ];
  const activation = input.definition.activations[
    (Math.floor(hash / 17) + input.abilityIndex) % input.definition.activations.length
  ];
  return {
    id: `ability-${input.definition.id}-${hash.toString(36).padStart(7, "0")}`,
    name,
    effect,
    activation,
    magnitude: Math.min(100, 24 + (hash % 43) + input.magnitudeBonus - input.abilityIndex * 3),
    tags: [input.definition.id, input.abilityIndex === 0 ? "primary" : "support"],
  };
}

function enrichCausalDimensions(input: {
  original: ProceduralCausalDimension[];
  name: string;
  holder: ProceduralTreasureStakeholder;
  claimant: ProceduralTreasureStakeholder;
  holderCharacter: SocialMatrixCharacter;
  claimantCharacter: SocialMatrixCharacter;
  witnessCharacter: SocialMatrixCharacter;
  ability: ProceduralTreasureAbility;
  limitation: string;
  cost: string;
  storyLocation: string;
}) {
  const overrides: Partial<Record<ProceduralCausalDimension["id"], string>> = {
    trigger: `${input.name}在${input.storyLocation}被迫現身，使人物、家族與勢力之間的舊有主張同時浮上檯面。`,
    desire: `${input.holderCharacter.name}想${input.holderCharacter.goal}；${input.claimantCharacter.name}則要${input.claimantCharacter.goal}。`,
    stance: `${input.holderCharacter.name}以${input.holderCharacter.personality.publicFace}應對，${input.claimantCharacter.name}卻以${input.claimantCharacter.personality.publicFace}阻止單方面啟用。`,
    relationship: `${input.name}目前由${input.holder.characterName}持有，${input.holder.factionName}承認其保管權；${input.claimant.characterName}與${input.claimant.factionName}仍保留聲索。`,
    agency: `${input.holderCharacter.name}會先依「${input.holderCharacter.goal}」採取行動；${input.claimantCharacter.name}也會依自身目標反制，不等待主角指示。`,
    refusal: `若使用方式違反${input.holderCharacter.personality.privateNeed}，${input.holderCharacter.name}便會拒絕；${input.claimantCharacter.name}也保留獨立否決權。`,
    resource: `${input.ability.name}可以${input.ability.effect}。`,
    constraint: `${input.ability.activation}；${input.limitation}`,
    price: input.cost,
    consequence: `${input.witnessCharacter.name}會保存所有權、使用代價與結果，讓下一回合不能把局勢重設為原點。`,
  };
  return PROCEDURAL_CAUSAL_DIMENSIONS.map((definition) => {
    const existing = input.original.find((candidate) => candidate.id === definition.id);
    return {
      ...definition,
      signal: overrides[definition.id] ?? existing?.signal ?? definition.inferenceQuestion,
    };
  });
}

/**
 * Decodes one of 100,000 deterministic original treasures in O(1). The same
 * storySeed also selects its cast, holder factions, million-space scenario,
 * and ten causal dimensions, so AI and rules fallback see the same world.
 */
export function proceduralTreasureRecordAt(input: {
  storySeed: string;
  ordinal: number;
  context?: ProceduralStoryContext;
  socialMatrix?: DeterministicSocialMatrix;
}): ProceduralTreasureRecord {
  requireOrdinal(input.ordinal);
  const storySeed = input.storySeed.trim();
  if (!storySeed) throw new Error("TREASURE_LIBRARY_STORY_SEED_REQUIRED");

  const classification = proceduralTreasureClassificationAt({
    storySeed,
    treasureOrdinal: input.ordinal,
  });
  const definition = TREASURE_KINDS.find(
    (candidate) => candidate.id === classification.kind,
  )!;
  const base = proceduralTreasureAt({
    seed: storySeed,
    ordinal: input.ordinal,
    context: input.context,
  });
  const socialMatrix = input.socialMatrix ?? new DeterministicSocialMatrix({
    seed: storySeed,
    context: input.context,
    cacheLimit: 0,
  });
  if (socialMatrix.seed !== storySeed) {
    throw new Error("TREASURE_LIBRARY_SOCIAL_MATRIX_SEED_MISMATCH");
  }
  if (socialMatrix.populationSize < 3) {
    throw new Error("TREASURE_LIBRARY_SOCIAL_MATRIX_TOO_SMALL");
  }
  const scenarioVariant = hashText(
    `${storySeed}|treasure-scenario-variant|${input.ordinal}`,
  ) % PROCEDURAL_TREASURE_SCENARIO_VARIANTS_PER_TREASURE;
  const scenarioBinding = proceduralTreasureScenarioBindingAt({
    storySeed,
    treasureOrdinal: input.ordinal,
    scenarioVariant,
    context: input.context,
    socialMatrix,
  });
  const [holderIndex, claimantIndex, witnessIndex] =
    scenarioBinding.castPopulationIndices;
  const holderCharacter = socialMatrix.getCharacter(holderIndex);
  const claimantCharacter = socialMatrix.getCharacter(claimantIndex);
  const witnessCharacter = socialMatrix.getCharacter(witnessIndex);
  const subtype = definition.subtypes[
    hashText(`${storySeed}|subtype|${input.ordinal}`) % definition.subtypes.length
  ];
  const primaryAbility = abilityFor({
    storySeed,
    ordinal: input.ordinal,
    definition,
    abilityIndex: 0,
    magnitudeBonus: classification.magnitudeBonus,
  });
  const supportAbility = abilityFor({
    storySeed,
    ordinal: input.ordinal,
    definition,
    abilityIndex: 1,
    magnitudeBonus: classification.magnitudeBonus,
  });
  const holderRelationship = HOLDER_RELATIONSHIPS[
    hashText(`${storySeed}|holder|${input.ordinal}`) % HOLDER_RELATIONSHIPS.length
  ];
  const holder = stakeholderFor({
    matrix: socialMatrix,
    role: "holder",
    character: holderCharacter,
    relationship: holderRelationship,
  });
  const claimant = stakeholderFor({
    matrix: socialMatrix,
    role: "claimant",
    character: claimantCharacter,
    relationship: `對${base.name}提出獨立聲索，並要求先完成證據查驗`,
  });
  const witness = stakeholderFor({
    matrix: socialMatrix,
    role: "witness",
    character: witnessCharacter,
    relationship: `保存${base.name}每次轉移與啟用的後果紀錄`,
  });
  const cost = `${definition.costs[
    hashText(`${storySeed}|cost|${input.ordinal}`) % definition.costs.length
  ]}；${base.cost}`;
  const limitation = `${base.limitation}；${supportAbility.activation}`;
  const causalDimensions = enrichCausalDimensions({
    original: [],
    name: base.name,
    holder,
    claimant,
    holderCharacter,
    claimantCharacter,
    witnessCharacter,
    ability: primaryAbility,
    limitation,
    cost,
    storyLocation: input.context?.location?.trim() || holderCharacter.location,
  });
  const storyHook = `${holder.characterName}帶著${classification.rarityLabel}${subtype}「${base.name}」在${input.context?.location?.trim() || "局勢交界處"}現身。${holder.relationship}；${claimant.characterName}代表${claimant.factionName}提出相反聲索。${primaryAbility.name}可以${primaryAbility.effect}，但${cost}。`;

  return {
    schemaVersion: PROCEDURAL_TREASURE_LIBRARY_VERSION,
    materializationPolicy: PROCEDURAL_TREASURE_MATERIALIZATION_POLICY,
    id: base.id,
    ordinal: input.ordinal,
    fictional: true,
    name: base.name,
    kind: definition.id,
    kindLabel: definition.label,
    subtype,
    rarity: classification.rarity,
    rarityLabel: classification.rarityLabel,
    storyAffinity: base.storyAffinity,
    abilities: [primaryAbility, supportAbility],
    limitation,
    cost,
    storyHook,
    visualSeed: base.visualSeed,
    visualDescription: `${base.visualDescription} 類型為${definition.label}／${subtype}，稀有度為${classification.rarityLabel}。`,
    holder,
    stakeholders: [holder, claimant, witness],
    causalDimensions,
    crossMatrix: {
      storySeed,
      treasureOrdinal: scenarioBinding.treasureOrdinal,
      treasureId: scenarioBinding.treasureId,
      scenarioOrdinal: scenarioBinding.scenarioOrdinal,
      scenarioVariant: scenarioBinding.scenarioVariant,
      scenarioId: scenarioBinding.scenarioId,
      relationshipScenarioCapacity: PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
      causalDimensionCount: 10,
      causalDimensionIds: causalDimensions.map((dimension) => dimension.id),
      castPopulationIndices: scenarioBinding.castPopulationIndices,
      castCharacterIds: scenarioBinding.castCharacterIds,
    },
  };
}

export class ProceduralTreasureLibrary {
  readonly storySeed: string;
  readonly context?: ProceduralStoryContext;
  readonly capacity = PROCEDURAL_TREASURE_CAPACITY;
  readonly materializationPolicy = PROCEDURAL_TREASURE_MATERIALIZATION_POLICY;

  private readonly maxCacheEntries: number;
  private readonly socialMatrix: DeterministicSocialMatrix;
  private readonly cache = new Map<number, ProceduralTreasureRecord>();
  private hits = 0;
  private misses = 0;

  constructor(input: {
    storySeed: string;
    context?: ProceduralStoryContext;
    maxCacheEntries?: number;
  }) {
    if (!input.storySeed.trim()) throw new Error("TREASURE_LIBRARY_STORY_SEED_REQUIRED");
    const maxCacheEntries = input.maxCacheEntries ?? PROCEDURAL_TREASURE_CACHE_DEFAULT;
    if (
      !Number.isSafeInteger(maxCacheEntries)
      || maxCacheEntries < 1
      || maxCacheEntries > PROCEDURAL_TREASURE_CACHE_MAX
    ) {
      throw new RangeError(`TREASURE_LIBRARY_CACHE_LIMIT_INVALID:${maxCacheEntries}`);
    }
    this.storySeed = input.storySeed.trim();
    this.context = input.context;
    this.maxCacheEntries = maxCacheEntries;
    this.socialMatrix = new DeterministicSocialMatrix({
      seed: this.storySeed,
      context: input.context,
      cacheLimit: 0,
    });
  }

  at(ordinal: number) {
    requireOrdinal(ordinal);
    const cached = this.cache.get(ordinal);
    if (cached) {
      this.cache.delete(ordinal);
      this.cache.set(ordinal, cached);
      this.hits += 1;
      return cached;
    }
    const record = proceduralTreasureRecordAt({
      storySeed: this.storySeed,
      ordinal,
      context: this.context,
      socialMatrix: this.socialMatrix,
    });
    this.cache.set(ordinal, record);
    this.misses += 1;
    if (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as number | undefined;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return record;
  }

  page(pageIndex: number, pageSize = 24): ProceduralTreasurePage {
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
      throw new RangeError(`TREASURE_LIBRARY_PAGE_INDEX_INVALID:${pageIndex}`);
    }
    if (
      !Number.isSafeInteger(pageSize)
      || pageSize < 1
      || pageSize > PROCEDURAL_TREASURE_PAGE_MAX
    ) {
      throw new RangeError(`TREASURE_LIBRARY_PAGE_SIZE_INVALID:${pageSize}`);
    }
    const totalPages = Math.ceil(PROCEDURAL_TREASURE_CAPACITY / pageSize);
    if (pageIndex >= totalPages) {
      throw new RangeError(`TREASURE_LIBRARY_PAGE_INDEX_OUT_OF_RANGE:${pageIndex}`);
    }
    const start = pageIndex * pageSize;
    const end = Math.min(PROCEDURAL_TREASURE_CAPACITY, start + pageSize);
    const items = Array.from({ length: end - start }, (_, offset) => this.at(start + offset));
    return {
      pageIndex,
      pageSize,
      totalItems: PROCEDURAL_TREASURE_CAPACITY,
      totalPages,
      hasPreviousPage: pageIndex > 0,
      hasNextPage: pageIndex + 1 < totalPages,
      items,
    };
  }

  diagnostics() {
    return {
      version: PROCEDURAL_TREASURE_LIBRARY_VERSION,
      capacity: PROCEDURAL_TREASURE_CAPACITY,
      materializedEntries: this.cache.size,
      maxCacheEntries: this.maxCacheEntries,
      hits: this.hits,
      misses: this.misses,
    } as const;
  }

  clearCache() {
    this.cache.clear();
  }
}

export function createProceduralTreasureLibrary(input: {
  storySeed: string;
  context?: ProceduralStoryContext;
  maxCacheEntries?: number;
}) {
  return new ProceduralTreasureLibrary(input);
}
