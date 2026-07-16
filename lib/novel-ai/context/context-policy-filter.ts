import type { ContextItem } from "./context-composer-types";

export function filterContextByPolicy<T extends ContextItem>(items: T[], options: { includePublicCorpus?: boolean; includeUserLibrary?: boolean } = {}) {
  return items.filter((item) => {
    if (item.canonicalStatus === "reverted" || item.canonicalStatus === "deleted") return false;
    if (item.sourceScope === "PUBLIC_CORPUS" && !options.includePublicCorpus) return false;
    if (item.sourceScope === "USER_IMPORTED_LIBRARY" && !options.includeUserLibrary) return false;
    if (item.visibility === "public_ready" && item.sourceScope !== "PUBLIC_CORPUS") return false;
    return true;
  });
}
