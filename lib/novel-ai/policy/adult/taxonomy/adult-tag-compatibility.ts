import type { AdultTaxonomyTag } from "./adult-taxonomy-types";

export type TagCompatibilityIssue = {
  tagId: string;
  relatedTagId: string;
  type: "missing_requirement" | "excluded_pair";
  message: string;
};

export function explainTagCompatibility(tagIds: string[], tags: AdultTaxonomyTag[]) {
  const selected = new Set(tagIds);
  const byId = new Map(tags.map((tag) => [tag.tagId, tag]));
  const issues: TagCompatibilityIssue[] = [];
  for (const tagId of selected) {
    const tag = byId.get(tagId);
    if (!tag) continue;
    for (const required of tag.requiresTags) {
      if (!selected.has(required)) {
        issues.push({ tagId, relatedTagId: required, type: "missing_requirement", message: `${tagId} requires ${required}.` });
      }
    }
    for (const excluded of tag.excludesTags) {
      if (selected.has(excluded)) {
        issues.push({ tagId, relatedTagId: excluded, type: "excluded_pair", message: `${tagId} cannot be combined with ${excluded}.` });
      }
    }
  }
  return { compatible: issues.length === 0, issues };
}

export function tagsCompatible(tagIds: string[], tags: AdultTaxonomyTag[]) {
  return explainTagCompatibility(tagIds, tags).compatible;
}
