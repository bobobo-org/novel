import type { StoryRetrievalMetadata, StoryVersionCreateInput, StoryVisibility } from "./story-version-types";

export function createRetrievalMetadata(input: StoryVersionCreateInput, versionId: string, contentHash: string): StoryRetrievalMetadata {
  return {
    projectId: input.projectId,
    classificationPackId: input.classificationPackId,
    topicId: input.topicId,
    storyEngineId: input.storyEngineId,
    sceneProfileId: input.sceneProfileId,
    sceneType: input.sceneType,
    stageType: input.stageType,
    participantIds: input.participantIds || [],
    relationshipIds: input.relationshipIds || [],
    branchId: input.branchId || "main",
    versionId,
    versionType: input.versionType || "original",
    rating: input.rating || "mature",
    visibility: input.visibility || "project_only",
    canonicalStatus: input.canonicalStatus || "draft",
    consequenceStatus: "candidate",
    contentHash,
    indexedAt: new Date().toISOString(),
  };
}

export function canUseInScope(metadata: StoryRetrievalMetadata, scope: "private" | "project_only" | "local_only" | "public_export") {
  if (metadata.deletedAt) return false;
  if (scope === "private") return ["private", "project_only", "local_library", "export_allowed", "public_ready", "local_only"].includes(metadata.visibility);
  if (scope === "project_only") return ["project_only", "local_library", "export_allowed", "public_ready"].includes(metadata.visibility);
  if (scope === "local_only") return metadata.visibility !== "public_ready";
  return metadata.visibility === "public_ready" || metadata.visibility === "export_allowed";
}

export function normalizeVisibility(visibility: StoryVisibility, rating: string) {
  if (rating === "private_adult" && visibility === "public_ready") return "private";
  return visibility;
}

