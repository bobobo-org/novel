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
