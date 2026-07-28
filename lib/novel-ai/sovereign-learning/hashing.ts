import type { TextFingerprint } from "./types";

const DEFAULT_BLOOM_BITS = 131_072;
const BLOOM_HASH_COUNT = 4;

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

export function fnv1a32(value: string, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function shortStableId(prefix: string, value: string) {
  const left = fnv1a32(value, 0x811c9dc5).toString(16).padStart(8, "0");
  const right = fnv1a32(value, 0x9e3779b9).toString(16).padStart(8, "0");
  return `${prefix}_${left}${right}`;
}

export function normalizeForLearning(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueShingles(value: string) {
  const normalized = normalizeForLearning(value).toLocaleLowerCase("zh-Hant");
  const shingles = new Set<string>();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length >= 8) {
    for (let index = 0; index <= words.length - 8; index += 1) {
      shingles.add(`w:${words.slice(index, index + 8).join(" ")}`);
    }
  }
  const compact = normalized.replace(/[^\p{L}\p{N}]/gu, "");
  if (compact.length >= 18) {
    for (let index = 0; index <= compact.length - 18; index += 3) {
      shingles.add(`c:${compact.slice(index, index + 18)}`);
    }
  }
  return [...shingles];
}

function bloomPositions(value: string, bloomBits: number) {
  const first = fnv1a32(value, 0x811c9dc5);
  const second = fnv1a32(value, 0x9e3779b9) || 1;
  return Array.from(
    { length: BLOOM_HASH_COUNT },
    (_, index) => (first + Math.imul(index + 1, second)) >>> 0,
  ).map((hash) => hash % bloomBits);
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  if (hex.length % 2 !== 0) throw new Error("LEARNING_FINGERPRINT_INVALID");
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function setBloomBit(bytes: Uint8Array, position: number) {
  bytes[Math.floor(position / 8)] |= 1 << (position % 8);
}

function readBloomBit(bytes: Uint8Array, position: number) {
  return (bytes[Math.floor(position / 8)] & (1 << (position % 8))) !== 0;
}

export function createTextFingerprint(
  value: string,
  bloomBits = DEFAULT_BLOOM_BITS,
): TextFingerprint {
  const normalizedBits = Math.max(8_192, Math.ceil(bloomBits / 8) * 8);
  const bytes = new Uint8Array(normalizedBits / 8);
  const shingles = uniqueShingles(value);
  for (const shingle of shingles) {
    for (const position of bloomPositions(shingle, normalizedBits)) setBloomBit(bytes, position);
  }
  const sampleStep = Math.max(1, Math.ceil(shingles.length / 128));
  return {
    algorithm: "fnv1a-bloom-v1",
    unit: "mixed-word-character-shingles",
    bloomBits: normalizedBits,
    bloomHex: bytesToHex(bytes),
    shingleCount: shingles.length,
    sampleHashes: shingles
      .filter((_, index) => index % sampleStep === 0)
      .slice(0, 128)
      .map((item) => fnv1a32(item).toString(16).padStart(8, "0")),
  };
}

export function fingerprintOverlap(value: string, fingerprint: TextFingerprint) {
  const shingles = uniqueShingles(value);
  if (!shingles.length || !fingerprint.shingleCount) {
    return { score: 0, matchedShingles: 0, testedShingles: shingles.length };
  }
  const bytes = hexToBytes(fingerprint.bloomHex);
  let matchedShingles = 0;
  for (const shingle of shingles) {
    const matched = bloomPositions(shingle, fingerprint.bloomBits)
      .every((position) => readBloomBit(bytes, position));
    if (matched) matchedShingles += 1;
  }
  return {
    score: matchedShingles / shingles.length,
    matchedShingles,
    testedShingles: shingles.length,
  };
}

function containsSubstring(source: string, candidate: string, length: number) {
  for (let index = 0; index <= candidate.length - length; index += 1) {
    if (source.includes(candidate.slice(index, index + length))) return true;
  }
  return false;
}

export function longestDirectSourceMatch(sourceText: string, candidateText: string) {
  const source = normalizeForLearning(sourceText).replace(/[^\p{L}\p{N}]/gu, "");
  const candidate = normalizeForLearning(candidateText).replace(/[^\p{L}\p{N}]/gu, "");
  if (source.length < 8 || candidate.length < 8) return 0;
  let low = 8;
  let high = Math.min(96, candidate.length);
  let best = 0;
  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    if (containsSubstring(source, candidate, midpoint)) {
      best = midpoint;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }
  return best;
}

export function ruleSimilarity(left: string, right: string) {
  const units = (value: string) => {
    const compact = normalizeForLearning(value)
      .toLocaleLowerCase("zh-Hant")
      .replace(/[^\p{L}\p{N}]/gu, "");
    const result = new Set<string>();
    for (let index = 0; index < compact.length - 1; index += 1) {
      result.add(compact.slice(index, index + 2));
    }
    return result;
  };
  const leftUnits = units(left);
  const rightUnits = units(right);
  if (!leftUnits.size || !rightUnits.size) return 0;
  const intersection = [...leftUnits].filter((item) => rightUnits.has(item)).length;
  const union = new Set([...leftUnits, ...rightUnits]).size;
  return intersection / union;
}
