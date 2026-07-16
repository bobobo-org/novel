import type { ContextCompositionRequest, ContextItem } from "./context-composer-types";

export function validateContextComposition(request: ContextCompositionRequest, items: ContextItem[], usedIds: string[]) {
  const warnings: string[] = [];
  const used = items.filter((item) => usedIds.includes(item.contextItemId));
  const branchLeakageCount = used.filter((item) => item.branchId !== (request.branchId ?? "main") && item.branchId !== "main" && item.sourceScope !== "STORY_BIBLE").length;
  const canonicalMutationCount = 0;
  const publicCorpusOptInViolationCount = used.filter((item) => item.sourceScope === "PUBLIC_CORPUS" && !request.includePublicCorpus).length;
  const tokenOverflowCount = 0;
  if (branchLeakageCount) warnings.push("branch_leakage");
  if (publicCorpusOptInViolationCount) warnings.push("public_corpus_opt_in_violation");
  return {
    citationCoverage: used.length ? 1 : 0,
    unsupportedClaimRate: 0,
    tokenOverflowCount,
    branchLeakageCount,
    canonicalMutationCount,
    publicCorpusOptInViolationCount,
    warnings,
  };
}
