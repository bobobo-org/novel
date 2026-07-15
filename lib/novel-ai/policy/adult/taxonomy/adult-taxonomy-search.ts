import { ADULT_TAXONOMY_TAGS, normalizeAlias } from "./adult-taxonomy-registry";
import type { AdultTaxonomyCategoryId, AdultTaxonomyTag } from "./adult-taxonomy-types";

export type TaxonomySearchInput = {
  query?: string;
  categoryId?: AdultTaxonomyCategoryId;
  includeAdultOnly?: boolean;
  limit?: number;
};

export function searchAdultTaxonomyTags(input: TaxonomySearchInput, tags: AdultTaxonomyTag[] = ADULT_TAXONOMY_TAGS) {
  const q = normalizeAlias(input.query ?? "");
  const limit = input.limit ?? 20;
  return tags
    .filter((tag) => tag.enabled)
    .filter((tag) => input.includeAdultOnly || !tag.adultOnly)
    .filter((tag) => !input.categoryId || tag.categoryId === input.categoryId)
    .filter((tag) => {
      if (!q) return true;
      return normalizeAlias(tag.tagId).includes(q)
        || normalizeAlias(tag.displayName).includes(q)
        || tag.aliases.some((alias) => normalizeAlias(alias).includes(q));
    })
    .slice(0, limit);
}

export function findAdultTaxonomyTag(query: string, tags: AdultTaxonomyTag[] = ADULT_TAXONOMY_TAGS) {
  const q = normalizeAlias(query);
  return tags.find((tag) => normalizeAlias(tag.tagId) === q || normalizeAlias(tag.displayName) === q || tag.aliases.some((alias) => normalizeAlias(alias) === q));
}
