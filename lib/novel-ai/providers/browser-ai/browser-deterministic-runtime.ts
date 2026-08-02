import { sha256Hex, stableStringify } from "../../closed-ai-cache";
import { estimateBrowserTokens } from "./browser-performance-policy";
import { BROWSER_T0_OPERATIONS } from "./browser-task-eligibility";

export type BrowserDeterministicOperation =
  (typeof BROWSER_T0_OPERATIONS)[number];

export type BrowserDeterministicResult = {
  schemaVersion: "browser-deterministic-runtime-v2";
  operation: BrowserDeterministicOperation;
  value: unknown;
  resultDigest: string;
  actualExecutor: "deterministic-browser";
  externalRequest: false;
  dataLeftDevice: false;
  candidateOnly: true;
  canonicalMutationCount: 0;
};

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .toLocaleLowerCase("zh-Hant");
}

function trigrams(value: string) {
  const units = Array.from(value);
  const result = new Set<string>();
  if (units.length < 3) return new Set(units);
  for (let index = 0; index <= units.length - 3; index += 1) {
    result.add(units.slice(index, index + 3).join(""));
  }
  return result;
}

function similarity(left: unknown, right: unknown) {
  const a = trigrams(normalize(left));
  const b = trigrams(normalize(right));
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return Number((shared / (a.size + b.size - shared || 1)).toFixed(6));
}

function repairJson(value: unknown) {
  const text = String(value ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .replace(/,\s*([}\]])/gu, "$1");
  return JSON.parse(text);
}

function diff(left: string, right: string) {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < left.length - prefix
    && suffix < right.length - prefix
    && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) suffix += 1;
  return {
    commonPrefixCharacters: prefix,
    commonSuffixCharacters: suffix,
    removedCharacters: Math.max(0, left.length - prefix - suffix),
    addedCharacters: Math.max(0, right.length - prefix - suffix),
  };
}

async function execute(
  operation: BrowserDeterministicOperation,
  payload: Record<string, unknown>,
) {
  switch (operation) {
    case "rpg.success-rate": {
      const actor = numeric(payload.actorPower);
      const challenge = Math.max(1, numeric(payload.challengePower, 1));
      const luck = numeric(payload.luck);
      return clamp(Math.round(50 + (actor - challenge) / challenge * 35 + luck * 0.25), 5, 95);
    }
    case "rpg.stat-boundary":
      return clamp(
        numeric(payload.value),
        numeric(payload.minimum),
        numeric(payload.maximum, 999),
      );
    case "rpg.experience-level": {
      const experience = Math.max(0, numeric(payload.experience));
      const level = Math.floor(Math.sqrt(experience / 100)) + 1;
      return { level, currentFloor: (level - 1) ** 2 * 100, nextFloor: level ** 2 * 100 };
    }
    case "rpg.inventory-ledger": {
      const items = Array.isArray(payload.items) ? payload.items : [];
      return items.reduce<Record<string, number>>((ledger, item) => {
        const record = item as { id?: unknown; quantity?: unknown };
        const id = String(record.id ?? "unknown");
        ledger[id] = (ledger[id] ?? 0) + numeric(record.quantity, 1);
        return ledger;
      }, {});
    }
    case "game.progress": {
      const completed = Math.max(0, numeric(payload.completed));
      const total = Math.max(1, numeric(payload.total, 1));
      return { completed, total, ratio: clamp(completed / total, 0, 1) };
    }
    case "candidate.diff":
      return diff(String(payload.left ?? ""), String(payload.right ?? ""));
    case "schema.validation": {
      const subject = (payload.value ?? {}) as Record<string, unknown>;
      const required = Array.isArray(payload.required) ? payload.required.map(String) : [];
      const missing = required.filter((key) => !(key in subject));
      return { valid: missing.length === 0, missing };
    }
    case "json.repair":
      return repairJson(payload.value);
    case "format.validation":
      return {
        valid: typeof payload.value === String(payload.expectedType ?? "string"),
        actualType: typeof payload.value,
      };
    case "canon.revision-check":
      return {
        valid: String(payload.expectedRevision) === String(payload.actualRevision),
        expectedRevision: String(payload.expectedRevision ?? ""),
        actualRevision: String(payload.actualRevision ?? ""),
      };
    case "candidate.digest":
      return { digest: await sha256Hex(String(payload.content ?? "")) };
    case "candidate.deduplicate": {
      const values = Array.isArray(payload.values) ? payload.values : [];
      const digests = await Promise.all(values.map((value) => sha256Hex(normalize(value))));
      return { uniqueCount: new Set(digests).size, duplicateCount: digests.length - new Set(digests).size };
    }
    case "candidate.similarity":
      return { metric: "character_trigram_jaccard", score: similarity(payload.left, payload.right) };
    case "cache.key":
      return { key: await sha256Hex(stableStringify(payload)) };
    case "context.token-estimate":
      return { estimatedTokens: estimateBrowserTokens(String(payload.text ?? "")) };
    case "content-safety.metadata": {
      const text = String(payload.text ?? "");
      return {
        length: text.length,
        containsCredentialShape:
          /(?:(?:vcp|sbp)[_-]|sk-)[A-Za-z0-9_-]{12,}/u.test(text),
        rawTextStored: false,
      };
    }
    case "structured-output.validation": {
      try {
        const parsed = typeof payload.value === "string"
          ? JSON.parse(payload.value)
          : payload.value;
        return { valid: Boolean(parsed && typeof parsed === "object") };
      } catch {
        return { valid: false };
      }
    }
    case "approval.preview":
      return {
        candidateDigest: await sha256Hex(String(payload.content ?? "")),
        approved: false,
        canonicalMutationCount: 0,
      };
    case "backup.semantic-hash":
      return { semanticHash: await sha256Hex(stableStringify(payload.value)) };
  }
}

export async function executeBrowserDeterministicOperation(input: {
  operation: BrowserDeterministicOperation;
  payload?: Record<string, unknown>;
}): Promise<BrowserDeterministicResult> {
  if (!BROWSER_T0_OPERATIONS.includes(input.operation)) {
    throw Object.assign(new Error("Unsupported deterministic browser operation."), {
      code: "BROWSER_T0_OPERATION_UNSUPPORTED",
    });
  }
  const value = await execute(input.operation, input.payload ?? {});
  return {
    schemaVersion: "browser-deterministic-runtime-v2",
    operation: input.operation,
    value,
    resultDigest: await sha256Hex(stableStringify(value)),
    actualExecutor: "deterministic-browser",
    externalRequest: false,
    dataLeftDevice: false,
    candidateOnly: true,
    canonicalMutationCount: 0,
  };
}
