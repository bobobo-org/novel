import type { StoryStageVersionRecord } from "./story-stage-context";

export function validateMergedScene(versions: StoryStageVersionRecord[]) {
  const ordered = [...versions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const duplicateHashes = new Set<string>();
  const seen = new Set<string>();
  for (const version of ordered) {
    if (seen.has(version.contentHash)) duplicateHashes.add(version.contentHash);
    seen.add(version.contentHash);
  }
  return {
    ok: duplicateHashes.size === 0 && ordered.length > 0,
    stageCount: ordered.length,
    duplicateHashes: [...duplicateHashes],
    warnings: duplicateHashes.size ? ["DUPLICATE_STAGE_CONTENT"] : [],
  };
}
