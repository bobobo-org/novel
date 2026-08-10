import { sha256Hex } from "../closed-ai-cache";
import type {
  ClosedAIBackendId,
  ClosedAIRegenerationContract,
} from "../closed-agent-os";

const REGENERATION_DIRECTIONS = [
  "改變場景中的主動者與第一個具體行動，讓事件以另一條因果鏈展開。",
  "改變角色處理衝突的策略，使用不同對話目的、阻力與結果。",
  "改變敘事節奏與資訊揭露順序，避免沿用前一候選的段落結構。",
  "改變場景焦點與感官線索，以不同空間互動推進情節。",
  "改變決策代價與立即後果，建立另一個可延續的劇情鉤子。",
] as const;

export type ExplicitRegenerationSource = {
  taskId?: string | null;
  candidateId?: string | null;
  backendId?: ClosedAIBackendId | null;
  modelId?: string | null;
  modelDigest?: string | null;
  content: string;
  contentDigest?: string | null;
  regenerationAttempt?: number;
};

export type RegenerationDistinctness = {
  normalizedDigestDifferent: boolean;
  similarityMetric: "character_trigram_jaccard";
  similarityScore: number;
  distinct: boolean;
};

function secureSeed(attempt: number) {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const mixed = (random[0] ^ Math.imul(attempt, 0x9e3779b1)) >>> 0;
  return (mixed & 0x7fffffff) || attempt;
}

export function createExplicitRegenerationContract(input: {
  previousCandidateId: string;
  previousTaskId: string;
  previousCandidateDigest: string;
  regenerationAttempt: number;
  extraRequirement?: string;
}): ClosedAIRegenerationContract {
  if (!input.previousCandidateId.trim() || !input.previousTaskId.trim()) {
    throw Object.assign(new Error("Previous candidate identity is invalid."), {
      code: "REGENERATION_SOURCE_IDENTITY_INVALID",
    });
  }
  if (!/^[a-f0-9]{64}$/iu.test(input.previousCandidateDigest)) {
    throw Object.assign(new Error("Previous candidate digest is invalid."), {
      code: "REGENERATION_PREVIOUS_DIGEST_INVALID",
    });
  }
  if (!Number.isSafeInteger(input.regenerationAttempt) || input.regenerationAttempt < 1) {
    throw Object.assign(new Error("Regeneration attempt must be a positive integer."), {
      code: "REGENERATION_ATTEMPT_INVALID",
    });
  }
  const baseDirection = REGENERATION_DIRECTIONS[
    (input.regenerationAttempt - 1) % REGENERATION_DIRECTIONS.length
  ];
  const extra = input.extraRequirement?.trim().replace(/\s+/gu, " ").slice(0, 280);
  return {
    previousCandidateId: input.previousCandidateId,
    previousTaskId: input.previousTaskId,
    regenerationAttempt: input.regenerationAttempt,
    regenerationNonce: crypto.randomUUID(),
    previousCandidateDigest: input.previousCandidateDigest.toLowerCase(),
    cacheBypassReason: "explicit_regeneration",
    modelSeed: secureSeed(input.regenerationAttempt),
    direction: extra ? `${baseDirection} 作者額外要求：${extra}` : baseDirection,
  };
}

export function explicitRegenerationInstruction(
  contract: ClosedAIRegenerationContract,
) {
  return [
    "",
    "[明確重新生成契約]",
    `前一候選摘要（SHA-256）：${contract.previousCandidateDigest}`,
    `本次嘗試：${contract.regenerationAttempt}`,
    `替代方向：${contract.direction}`,
    "必須產生不同的策略、場景行動或語言表達；不得重現前一候選的情節路徑與段落結構。",
    "只輸出新的故事候選，不要解釋契約、雜湊或生成參數。",
  ].join("\n");
}

export function normalizeCandidateForComparison(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hant")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .trim();
}

function characterTrigrams(value: string) {
  const characters = Array.from(value);
  if (characters.length < 3) return new Set(characters);
  const grams = new Set<string>();
  for (let index = 0; index <= characters.length - 3; index += 1) {
    grams.add(characters.slice(index, index + 3).join(""));
  }
  return grams;
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection || 1);
}

export async function assessRegenerationDistinctness(
  previousContent: string,
  nextContent: string,
): Promise<RegenerationDistinctness> {
  const previous = normalizeCandidateForComparison(previousContent);
  const next = normalizeCandidateForComparison(nextContent);
  const [previousDigest, nextDigest] = await Promise.all([
    sha256Hex(previous),
    sha256Hex(next),
  ]);
  const similarityScore = Number(
    jaccard(characterTrigrams(previous), characterTrigrams(next)).toFixed(6),
  );
  const normalizedDigestDifferent = previousDigest !== nextDigest;
  return {
    normalizedDigestDifferent,
    similarityMetric: "character_trigram_jaccard",
    similarityScore,
    distinct: normalizedDigestDifferent && similarityScore < 0.95,
  };
}
