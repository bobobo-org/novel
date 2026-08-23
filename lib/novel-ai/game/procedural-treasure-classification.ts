import { PROCEDURAL_TREASURE_CAPACITY } from "./procedural-story-library";

export const PROCEDURAL_TREASURE_CLASSIFICATION_VERSION =
  "procedural-treasure-classification-v1" as const;

export const PROCEDURAL_TREASURE_KIND_DEFINITIONS = [
  { id: "pill", label: "丹藥／藥丸" },
  { id: "weapon", label: "武器" },
  { id: "talisman", label: "符" },
  { id: "formation", label: "陣法" },
  { id: "special-opportunity", label: "特殊機緣" },
] as const;

export const PROCEDURAL_TREASURE_RARITY_DEFINITIONS = [
  { id: "mythic", label: "神話", minimumRoll: 998, magnitudeBonus: 34 },
  { id: "legendary", label: "傳說", minimumRoll: 985, magnitudeBonus: 26 },
  { id: "epic", label: "史詩", minimumRoll: 930, magnitudeBonus: 18 },
  { id: "rare", label: "稀有", minimumRoll: 800, magnitudeBonus: 12 },
  { id: "uncommon", label: "精良", minimumRoll: 550, magnitudeBonus: 6 },
  { id: "common", label: "常見", minimumRoll: 0, magnitudeBonus: 0 },
] as const;

export type ProceduralTreasureKind =
  (typeof PROCEDURAL_TREASURE_KIND_DEFINITIONS)[number]["id"];
export type ProceduralTreasureRarity =
  (typeof PROCEDURAL_TREASURE_RARITY_DEFINITIONS)[number]["id"];

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function proceduralTreasureClassificationAt(input: {
  storySeed: string;
  treasureOrdinal: number;
  treasureCapacity?: number;
}) {
  const storySeed = input.storySeed.trim();
  if (!storySeed) throw new Error("TREASURE_CLASSIFICATION_STORY_SEED_REQUIRED");
  const treasureCapacity = input.treasureCapacity ?? PROCEDURAL_TREASURE_CAPACITY;
  if (
    !Number.isSafeInteger(treasureCapacity)
    || treasureCapacity < 1
    || treasureCapacity > PROCEDURAL_TREASURE_CAPACITY
  ) {
    throw new RangeError(`TREASURE_CLASSIFICATION_CAPACITY_INVALID:${treasureCapacity}`);
  }
  if (
    !Number.isSafeInteger(input.treasureOrdinal)
    || input.treasureOrdinal < 0
    || input.treasureOrdinal >= treasureCapacity
  ) {
    throw new RangeError(
      `TREASURE_CLASSIFICATION_ORDINAL_OUT_OF_RANGE:${input.treasureOrdinal}`,
    );
  }
  const kind = PROCEDURAL_TREASURE_KIND_DEFINITIONS[
    (input.treasureOrdinal + hashText(`${storySeed}|kind`))
      % PROCEDURAL_TREASURE_KIND_DEFINITIONS.length
  ];
  const rarityRoll = hashText(`${storySeed}|rarity|${input.treasureOrdinal}`) % 1_000;
  const rarity = PROCEDURAL_TREASURE_RARITY_DEFINITIONS.find(
    (candidate) => rarityRoll >= candidate.minimumRoll,
  ) ?? PROCEDURAL_TREASURE_RARITY_DEFINITIONS.at(-1)!;
  return {
    version: PROCEDURAL_TREASURE_CLASSIFICATION_VERSION,
    kind: kind.id,
    kindLabel: kind.label,
    rarity: rarity.id,
    rarityLabel: rarity.label,
    magnitudeBonus: rarity.magnitudeBonus,
  } as const;
}
