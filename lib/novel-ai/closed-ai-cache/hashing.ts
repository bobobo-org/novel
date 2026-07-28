export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function estimateJsonBytes(value: unknown): number {
  return new TextEncoder().encode(stableStringify(value)).byteLength;
}

function semanticTerms(value: string): string[] {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!normalized) return [];
  const words = normalized.split(/\s+/u).filter((term) => term.length > 1);
  const han = [...normalized.replace(/[^\p{Script=Han}]/gu, "")];
  const bigrams = han.slice(0, -1).map((character, index) => `${character}${han[index + 1]}`);
  return [...new Set([...words, ...bigrams])].slice(0, 256);
}

export async function semanticFingerprint(value: string): Promise<string[]> {
  const hashes = await Promise.all(semanticTerms(value).map((term) => sha256Hex(`semantic:${term}`)));
  return hashes.map((hash) => hash.slice(0, 20)).sort();
}

export function jaccardSimilarity(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const item of leftSet) if (rightSet.has(item)) intersection += 1;
  const union = leftSet.size + rightSet.size - intersection;
  return union ? intersection / union : 0;
}
