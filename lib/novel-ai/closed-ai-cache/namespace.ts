import { sha256Hex, stableStringify } from "./hashing";
import type { ClosedAICacheInvalidation, ClosedAINamespace } from "./types";

const REQUIRED_NAMESPACE_FIELDS = [
  "tenantId",
  "userId",
  "projectId",
  "storyId",
  "canonId",
  "branchId",
  "characterId",
  "agentRole",
  "modelId",
  "modelDigest",
  "promptProfileVersion",
  "storyBibleRevision",
  "knowledgeScopeRevision",
  "privacyLevel",
] as const satisfies ReadonlyArray<keyof ClosedAINamespace>;

const PRIVACY_LEVELS = new Set([
  "device_only",
  "private_infrastructure_only",
  "author_only",
  "adult_isolated",
] satisfies ClosedAINamespace["privacyLevel"][]);

export function assertClosedAINamespace(namespace: ClosedAINamespace): void {
  for (const field of REQUIRED_NAMESPACE_FIELDS) {
    const value = namespace[field];
    if (!value || value === "*" || value.trim() !== value) {
      throw Object.assign(new Error(`Closed AI namespace field is invalid: ${field}`), {
        code: "CLOSED_AI_NAMESPACE_INVALID",
        field,
      });
    }
  }
  if (!PRIVACY_LEVELS.has(namespace.privacyLevel)) {
    throw Object.assign(new Error("Closed AI namespace privacy level is invalid."), {
      code: "CLOSED_AI_NAMESPACE_INVALID",
      field: "privacyLevel",
    });
  }
}

export async function closedAINamespaceDigest(namespace: ClosedAINamespace): Promise<string> {
  assertClosedAINamespace(namespace);
  return sha256Hex(stableStringify(namespace));
}

export function sameClosedAINamespace(left: ClosedAINamespace, right: ClosedAINamespace): boolean {
  return REQUIRED_NAMESPACE_FIELDS.every((field) => left[field] === right[field]);
}

export function namespaceMatchesInvalidation(
  namespace: ClosedAINamespace,
  invalidation: ClosedAICacheInvalidation,
): boolean {
  return REQUIRED_NAMESPACE_FIELDS.every((field) => {
    const expected = invalidation[field];
    return expected === undefined || namespace[field] === expected;
  });
}

export function assertTargetedCacheInvalidation(
  invalidation: ClosedAICacheInvalidation,
): void {
  const identityFields = REQUIRED_NAMESPACE_FIELDS.filter(
    (field) => invalidation[field] !== undefined,
  );
  if (!identityFields.length) {
    throw Object.assign(
      new Error("Cache invalidation must include at least one namespace identity field."),
      { code: "CLOSED_AI_CACHE_INVALIDATION_NOT_TARGETED" },
    );
  }
  for (const field of identityFields) {
    const value = invalidation[field];
    if (
      typeof value !== "string"
      || !value
      || value === "*"
      || value.trim() !== value
    ) {
      throw Object.assign(new Error(`Cache invalidation field is invalid: ${field}`), {
        code: "CLOSED_AI_CACHE_INVALIDATION_NOT_TARGETED",
        field,
      });
    }
  }
  if (
    invalidation.createdBefore !== undefined
    && !Number.isFinite(Date.parse(invalidation.createdBefore))
  ) {
    throw Object.assign(new Error("Cache invalidation timestamp is invalid."), {
      code: "CLOSED_AI_CACHE_INVALIDATION_NOT_TARGETED",
      field: "createdBefore",
    });
  }
}

export function assertNoNamespaceDowngrade(
  source: ClosedAINamespace,
  target: ClosedAINamespace,
): void {
  const immutableIdentityFields: Array<keyof ClosedAINamespace> = [
    "tenantId",
    "userId",
    "projectId",
    "storyId",
    "canonId",
    "branchId",
    "characterId",
    "privacyLevel",
  ];
  const mismatch = immutableIdentityFields.find((field) => source[field] !== target[field]);
  if (mismatch) {
    throw Object.assign(new Error(`Closed AI namespace boundary mismatch: ${mismatch}`), {
      code: "CLOSED_AI_NAMESPACE_BOUNDARY_VIOLATION",
      field: mismatch,
    });
  }
}
