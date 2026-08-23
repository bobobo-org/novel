import { PROCEDURAL_TREASURE_CAPACITY } from "./procedural-story-library";

export const PROCEDURAL_TREASURE_OWNERSHIP_VERSION =
  "procedural-treasure-ownership-v1" as const;
export const PROCEDURAL_TREASURE_OWNERSHIP_PAGE_MAX = 100;

export type ProceduralTreasureOwnershipPage = {
  items: number[];
  nextCursor: string | null;
  total: number;
};

export type ProceduralTreasureStakeholderPopulationIndices = {
  holder: number;
  claimant: number;
  witness: number;
};

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function modularInverse(value: number, modulus: number) {
  let [oldR, remainder] = [value, modulus];
  let [oldCoefficient, coefficient] = [1, 0];
  while (remainder !== 0) {
    const quotient = Math.floor(oldR / remainder);
    [oldR, remainder] = [remainder, oldR - quotient * remainder];
    [oldCoefficient, coefficient] = [
      coefficient,
      oldCoefficient - quotient * coefficient,
    ];
  }
  if (oldR !== 1) throw new Error("TREASURE_OWNERSHIP_PERMUTATION_NOT_INVERTIBLE");
  return ((oldCoefficient % modulus) + modulus) % modulus;
}

function requirePositiveInteger(value: number, code: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${code}:${value}`);
  }
}

function requireStorySeed(storySeed: string) {
  if (!storySeed.trim()) throw new Error("TREASURE_OWNERSHIP_STORY_SEED_REQUIRED");
}

function ownershipPermutation(storySeed: string, treasureCapacity: number) {
  if (treasureCapacity === 1) return { multiplier: 0, increment: 0, inverse: 0 };
  let multiplier = hashText(`${storySeed}|treasure-owner|multiplier`) % treasureCapacity;
  if (multiplier === 0) multiplier = 1;
  while (greatestCommonDivisor(multiplier, treasureCapacity) !== 1) {
    multiplier = (multiplier + 1) % treasureCapacity;
    if (multiplier === 0) multiplier = 1;
  }
  const increment = hashText(`${storySeed}|treasure-owner|increment`) % treasureCapacity;
  return {
    multiplier,
    increment,
    inverse: modularInverse(multiplier, treasureCapacity),
  };
}

function permutedTreasureSlot(input: {
  storySeed: string;
  treasureOrdinal: number;
  treasureCapacity: number;
}) {
  if (input.treasureCapacity === 1) return 0;
  const permutation = ownershipPermutation(input.storySeed, input.treasureCapacity);
  return (
    permutation.multiplier * input.treasureOrdinal
    + permutation.increment
  ) % input.treasureCapacity;
}

function treasureOrdinalFromSlot(input: {
  storySeed: string;
  slot: number;
  treasureCapacity: number;
}) {
  if (input.treasureCapacity === 1) return 0;
  const permutation = ownershipPermutation(input.storySeed, input.treasureCapacity);
  const normalized = (
    (input.slot - permutation.increment) % input.treasureCapacity
    + input.treasureCapacity
  ) % input.treasureCapacity;
  return (permutation.inverse * normalized) % input.treasureCapacity;
}

/**
 * Maps a treasure to exactly one population index without storing an ownership
 * table. The affine permutation is reversible, so the character side can list
 * the exact same possessions without scanning all 100,000 treasures.
 */
export function treasureHolderPopulationIndex(input: {
  storySeed: string;
  treasureOrdinal: number;
  populationSize: number;
  treasureCapacity?: number;
}) {
  requireStorySeed(input.storySeed);
  requirePositiveInteger(input.populationSize, "TREASURE_OWNERSHIP_POPULATION_INVALID");
  const treasureCapacity = input.treasureCapacity ?? PROCEDURAL_TREASURE_CAPACITY;
  requirePositiveInteger(treasureCapacity, "TREASURE_OWNERSHIP_CAPACITY_INVALID");
  if (treasureCapacity > PROCEDURAL_TREASURE_CAPACITY) {
    throw new RangeError(`TREASURE_OWNERSHIP_CAPACITY_INVALID:${treasureCapacity}`);
  }
  if (
    !Number.isSafeInteger(input.treasureOrdinal)
    || input.treasureOrdinal < 0
    || input.treasureOrdinal >= treasureCapacity
  ) {
    throw new RangeError(`TREASURE_OWNERSHIP_ORDINAL_OUT_OF_RANGE:${input.treasureOrdinal}`);
  }
  return permutedTreasureSlot({
    storySeed: input.storySeed,
    treasureOrdinal: input.treasureOrdinal,
    treasureCapacity,
  }) % input.populationSize;
}

/**
 * Returns the one deterministic three-person cast bound to a treasure. Keeping
 * this mapping beside the reversible ownership index prevents callers from
 * independently inventing a claimant/witness cast that no longer matches the
 * holder recorded by the social matrix.
 */
export function treasureStakeholderPopulationIndices(input: {
  storySeed: string;
  treasureOrdinal: number;
  populationSize: number;
  treasureCapacity?: number;
}): ProceduralTreasureStakeholderPopulationIndices {
  if (input.populationSize < 3) {
    throw new RangeError(
      `TREASURE_STAKEHOLDER_POPULATION_TOO_SMALL:${input.populationSize}`,
    );
  }
  const holder = treasureHolderPopulationIndex(input);
  let claimant = (
    holder + 33_331 + input.treasureOrdinal * 101
  ) % input.populationSize;
  if (claimant === holder) claimant = (claimant + 1) % input.populationSize;
  let witness = (
    holder + 66_661 + input.treasureOrdinal * 211
  ) % input.populationSize;
  while (witness === holder || witness === claimant) {
    witness = (witness + 1) % input.populationSize;
  }
  return { holder, claimant, witness };
}

/**
 * Reverses the ownership mapping in O(pageSize). `total` may be zero when the
 * character population is larger than the treasure capacity.
 */
export function treasureOrdinalsHeldByPopulationIndex(input: {
  storySeed: string;
  populationIndex: number;
  populationSize: number;
  treasureCapacity?: number;
  cursor?: string | null;
  limit?: number;
}): ProceduralTreasureOwnershipPage {
  requireStorySeed(input.storySeed);
  requirePositiveInteger(input.populationSize, "TREASURE_OWNERSHIP_POPULATION_INVALID");
  const treasureCapacity = input.treasureCapacity ?? PROCEDURAL_TREASURE_CAPACITY;
  requirePositiveInteger(treasureCapacity, "TREASURE_OWNERSHIP_CAPACITY_INVALID");
  if (treasureCapacity > PROCEDURAL_TREASURE_CAPACITY) {
    throw new RangeError(`TREASURE_OWNERSHIP_CAPACITY_INVALID:${treasureCapacity}`);
  }
  if (
    !Number.isSafeInteger(input.populationIndex)
    || input.populationIndex < 0
    || input.populationIndex >= input.populationSize
  ) {
    throw new RangeError(
      `TREASURE_OWNERSHIP_POPULATION_INDEX_OUT_OF_RANGE:${input.populationIndex}`,
    );
  }
  const limit = input.limit ?? 24;
  if (
    !Number.isSafeInteger(limit)
    || limit < 1
    || limit > PROCEDURAL_TREASURE_OWNERSHIP_PAGE_MAX
  ) {
    throw new RangeError(`TREASURE_OWNERSHIP_PAGE_LIMIT_INVALID:${limit}`);
  }
  const cursorPattern = new RegExp(`^treasure-owner:${input.populationIndex}:(\\d+)$`, "u");
  const cursorMatch = input.cursor ? cursorPattern.exec(input.cursor) : null;
  if (input.cursor && !cursorMatch) throw new Error("TREASURE_OWNERSHIP_CURSOR_INVALID");
  const offset = cursorMatch ? Number(cursorMatch[1]) : 0;
  const total = input.populationIndex >= treasureCapacity
    ? 0
    : Math.floor((treasureCapacity - 1 - input.populationIndex) / input.populationSize) + 1;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > total) {
    throw new RangeError(`TREASURE_OWNERSHIP_CURSOR_OUT_OF_RANGE:${offset}`);
  }
  const end = Math.min(total, offset + limit);
  const items = Array.from({ length: end - offset }, (_, localOffset) => {
    const holderSlot = input.populationIndex + (offset + localOffset) * input.populationSize;
    return treasureOrdinalFromSlot({
      storySeed: input.storySeed,
      slot: holderSlot,
      treasureCapacity,
    });
  });
  return {
    items,
    nextCursor: end < total ? `treasure-owner:${input.populationIndex}:${end}` : null,
    total,
  };
}
