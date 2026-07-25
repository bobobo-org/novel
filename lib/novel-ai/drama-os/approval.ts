import type { ApproveDramaProjectionInput, DramaApprovalRecord, DramaProject, NarrativeCanonLink } from "./types";
import { DramaOsError } from "./errors";
import { makeDramaRecord } from "./record-factory";

export function buildDramaApprovalRecords(
  input: ApproveDramaProjectionInput,
  currentProject: DramaProject,
  currentCanonLink: NarrativeCanonLink,
): { project: DramaProject; approval: DramaApprovalRecord; canonLink: NarrativeCanonLink } {
  if (currentProject.projectId !== input.projectId || currentProject.dramaProjectId !== input.dramaProjectId) {
    throw new DramaOsError("DRAMA_PROJECTION_NOT_FOUND", "找不到指定的短劇候選。");
  }
  if (currentProject.status === "private_simulation" || currentProject.status === "rejected" || currentProject.status === "stale") {
    throw new DramaOsError("DRAMA_PROJECTION_NOT_APPROVABLE", "這份短劇候選目前不能核准。");
  }
  if (currentProject.revision !== input.expectedDramaProjectRevision) {
    throw new DramaOsError("DRAMA_SOURCE_REVISION_STALE", "短劇候選版本已更新，請重新載入。");
  }
  if (currentProject.sourceStoryRevision !== input.expectedSourceStoryRevision) {
    throw new DramaOsError("DRAMA_SOURCE_REVISION_STALE", "小說內容已更新，請重新建立改編候選。");
  }
  if (currentProject.sourceStoryBibleVersion !== input.expectedStoryBibleVersion) {
    throw new DramaOsError("DRAMA_STORY_BIBLE_STALE", "角色與世界設定已更新，請重新建立改編候選。");
  }

  const now = new Date().toISOString();
  const nextAdaptationRevision = currentProject.canonicalAdaptationRevision + 1;
  const project: DramaProject = {
    ...currentProject,
    status: "approved",
    canonicalAdaptationRevision: nextAdaptationRevision,
    parentRevision: currentProject.revision,
    revision: currentProject.revision + 1,
    updatedAt: now,
  };
  const approvalRecord = makeDramaRecord(input.projectId, currentProject.projectionTrace.providerId, input.idempotencyKey);
  const approval: DramaApprovalRecord = {
    ...approvalRecord,
    id: approvalRecord.id,
    approvalId: approvalRecord.id,
    dramaProjectId: currentProject.dramaProjectId,
    idempotencyKey: input.idempotencyKey,
    payloadFingerprint: input.payloadFingerprint,
    expectedDramaProjectRevision: input.expectedDramaProjectRevision,
    sourceStoryRevision: input.expectedSourceStoryRevision,
    sourceStoryBibleVersion: input.expectedStoryBibleVersion,
    resultingAdaptationRevision: nextAdaptationRevision,
    approvedEntityIds: [currentProject.dramaProjectId, ...currentCanonLink.episodeIds],
    approvedBy: input.approvedBy,
    approvedAt: now,
    status: "committed",
  };
  const canonLink: NarrativeCanonLink = {
    ...currentCanonLink,
    projectionStatus: "approved",
    dramaAdaptationRevision: nextAdaptationRevision,
    approvedBy: input.approvedBy,
    approvedAt: now,
    parentRevision: currentCanonLink.revision,
    revision: currentCanonLink.revision + 1,
    updatedAt: now,
  };
  return { project, approval, canonLink };
}
