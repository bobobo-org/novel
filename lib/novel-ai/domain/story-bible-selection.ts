import type { NovelProject, StoryBible } from "./index";
import { NOVEL_DOMAIN_VERSION } from "./common";

/**
 * Resolves the Story Bible selected by the project's canonical pointer.
 *
 * A singleton fallback exists only for legacy projects created before the
 * pointer was reliable. Multiple candidates with a missing or stale pointer
 * are ambiguous and therefore fail closed.
 */
export function resolveProjectStoryBible<T extends StoryBible>(
  project: Pick<NovelProject, "id" | "storyBibleId"> | null | undefined,
  storyBibles: readonly T[],
): T | null {
  if (!project) return null;
  const validStoryBibles = storyBibles.filter((storyBible) => (
    storyBible.projectId === project.id
    && storyBible.schemaVersion === NOVEL_DOMAIN_VERSION
    && Number.isSafeInteger(storyBible.revision)
    && storyBible.revision >= 1
    && (storyBible.deletedAt === null || storyBible.deletedAt === undefined)
  ));
  const selected = validStoryBibles.find((storyBible) => storyBible.id === project.storyBibleId);
  if (selected) return selected;
  return validStoryBibles.length === 1 ? validStoryBibles.at(0) ?? null : null;
}
