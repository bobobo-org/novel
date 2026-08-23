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
  type SocialRelationshipKind,
} from "./types";

const TERRITORIES = ["雲汀", "蒼梧", "落星", "北溟", "赤霞", "鏡湖", "玄砂", "青岫", "霜河", "長夜", "扶光", "天衡", "九嶺", "浮玉", "星羅", "無妄"];
const INSTITUTION_PREFIX = ["太初", "玄霄", "問心", "燼星", "流雲", "藏鋒", "萬象", "觀瀾", "照夜", "青衡", "歸元", "九曜", "聽雪", "百鍊", "扶桑", "天機"];
const INSTITUTION_SUFFIX = ["劍宗", "丹盟", "符門", "陣院", "武府", "醫谷", "商會", "學宮", "影樓", "星閣", "山莊", "書院"];
const INSTITUTION_KINDS: SocialInstitutionKind[] = ["宗門", "門派", "世家聯盟", "商會", "學宮", "祕密結社"];
const DOCTRINES = ["以守護弱者衡量力量", "先求證再出手", "術法必須留下代價紀錄", "個人選擇高於血脈命令", "知識不得被一家壟斷", "承諾可被驗證也可被撤回"];
const PUBLIC_GOALS = ["維持邊境秩序", "修復失衡靈脈", "開放平民修行", "守護古籍傳承", "重建跨域商路", "阻止禁術擴散"];
const HIDDEN_CONFLICTS = ["長老派與新生代爭奪改革方向", "核心傳承的真實來源遭到質疑", "盟約中的一條舊約即將到期", "主家隱瞞了一場失敗遠征", "財庫與名聲只能保住其一", "最可靠的盟友正在秘密試探底線"];
const TRAITS = ["審慎", "果斷", "好奇", "溫厚", "敏銳", "守信", "野心勃勃", "幽默", "克制", "叛逆", "務實", "浪漫", "多疑", "寬容", "好勝", "沉著", "固執", "圓融"];
const PUBLIC_FACES = ["禮貌而難以親近", "爽朗且善於凝聚人心", "冷靜精準，很少浪費一句話", "溫和可靠，總先照顧別人", "機敏風趣，習慣用笑話試探", "沉默寡言，行動比承諾更快"];
const PRIVATE_NEEDS = ["被看見真正的努力", "證明自己不必複製上一代", "找到能放心交付弱點的人", "修補一次無法公開的失誤", "在責任之外保留自己的選擇", "讓失去的關係獲得一次告別"];
const SPECIALTIES = ["劍術", "煉丹", "符法", "陣法", "醫術", "談判", "追蹤", "鑑寶", "鍛造", "情報", "馭獸", "星象", "經營", "律法", "航行", "教學"];
const ROLES = ["外門弟子", "內門弟子", "執事", "客卿", "護法", "長老", "掌櫃", "研究者", "醫師", "工匠", "斥候", "使者", "藏書人", "巡守", "繼承候選", "自由合作者"];
const FAMILY_ROLES = ["長支", "次支", "旁支", "收養子弟", "守譜人", "出走者", "家業繼承候選", "外姓盟親"];
const LOCATIONS = ["山門議事堂", "邊城藥鋪", "雲港商街", "古陣遺址", "藏書洞府", "靈田聚落", "巡守營地", "鏡湖渡口", "地下工坊", "中立驛站", "星砂礦區", "失落祭壇"];
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
      kind: itemAt(INSTITUTION_KINDS, random),
      name: `${itemAt(INSTITUTION_PREFIX, random)}${itemAt(INSTITUTION_SUFFIX, random)}・${encodeIndex(index).toUpperCase()}`,
      territory: itemAt(TERRITORIES, random),
      doctrine: itemAt(DOCTRINES, random),
      influence: 20 + Math.floor(random() * 81),
      publicGoal: itemAt(PUBLIC_GOALS, random),
      hiddenConflict: itemAt(HIDDEN_CONFLICTS, random),
      allyInstitutionIds: [...allies].map((target) => this.institutionId(target)),
      rivalInstitutionIds: [...rivals].map((target) => this.institutionId(target)),
      memberCount: this.memberCount(index, this.institutionCount),
    });
  }

  getFamily(index: number): SocialFamily {
    const random = seededRandom(`${this.seed}:family:${index}`);
    const representative = this.memberIndexForBucket(index, 0, this.familyCount, `${this.seed}:family-index`);
    const representativeCharacter = proceduralCharacterAt({
      seed: this.seed,
      ordinal: representative,
      context: this.context,
    });
    const institutionIndex = this.institutionIndexForCharacter(representative);
    return deepFreeze({
      familyId: this.familyId(index),
      familyIndex: index,
      name: `${[...representativeCharacter.name][0] ?? "無"}氏・${itemAt(TERRITORIES, random)}支・${encodeIndex(index).toUpperCase()}`,
      home: itemAt(TERRITORIES, random),
      reputation: itemAt(["守諾重義", "精於商略", "醫術傳家", "長於陣法", "曾因舊案失勢", "與多方保持中立"], random),
      inheritedTrait: itemAt(["靈息敏銳", "記憶出眾", "意志堅定", "手藝精準", "善察人心", "危機直覺"], random),
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
    const kind = classification.kind === "pill"
      ? itemAt(["丹藥", "藥丸"] as const, random)
      : classification.kind === "weapon"
        ? "武器"
        : classification.kind === "talisman"
          ? "符籙"
          : classification.kind === "formation"
            ? "陣法"
            : "特殊機緣";
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
      name: treasure.name,
      function: treasure.function,
      limitation: treasure.limitation,
      cost: treasure.cost,
      storyHook: `${treasure.holderRelationship}；${itemAt([
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
    const familyIndex = this.familyIndexForCharacter(index);
    const institutionIndex = this.institutionIndexForCharacter(index);
    const institution = this.getInstitution(institutionIndex);
    const name = storyCharacter.name;
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
    const institutionRole = `${storyCharacter.role}／${itemAt(ROLES, random)}`;
    const location = this.context?.location?.trim() || itemAt(LOCATIONS, random);
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
      familyRole: itemAt(FAMILY_ROLES, random),
      location,
      identity: `${institution.name}的${institutionRole}，目前常駐${location}`,
      goal: storyCharacter.goal,
      secret: itemAt(["掌握一份尚未公開的交易紀錄", "真實血脈與族譜記載不符", "曾暗中救過敵對陣營的人", "知道一件寶物其實選錯了主人", "替家族承擔了一項不存在的罪名", "能辨認失落陣法的最後一筆"], random),
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
        specialties: uniqueItems(SPECIALTIES, random, 3),
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
