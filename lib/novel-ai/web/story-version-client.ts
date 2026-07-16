import { stableHash } from "../generation/stages/story-stage-context";
import type { WebStageRecord } from "./story-stage-client";

export type WebVersionRecord = {
  projectId: string;
  sceneId: string;
  stageId: string;
  branchId: string;
  versionId: string;
  sourceVersionId?: string;
  versionType: string;
  visibility: "private" | "project_only" | "local_only" | "public_ready";
  content: string;
  contentHash: string;
  outcomeParity: "pending" | "pass" | "warning" | "fail";
  provider: string;
  model: string;
  createdAt: string;
};

export class StoryVersionWebClient {
  private versions = new Map<string, WebVersionRecord>();

  createVersionFromStage(stage: WebStageRecord, versionType = "stage_draft") {
    const version: WebVersionRecord = {
      projectId: stage.projectId,
      sceneId: stage.sceneId,
      stageId: stage.stageId,
      branchId: stage.branchId,
      versionId: `web_version_${Date.now()}_${this.versions.size + 1}`,
      versionType,
      visibility: "local_only",
      content: stage.content,
      contentHash: stableHash(stage.content),
      outcomeParity: "pending",
      provider: stage.provider,
      model: stage.model,
      createdAt: new Date().toISOString(),
    };
    this.versions.set(version.versionId, version);
    return version;
  }

  addVersion(version: WebVersionRecord) {
    this.versions.set(version.versionId, version);
    return version;
  }

  getVersion(versionId: string) {
    const version = this.versions.get(versionId);
    if (!version) throw new Error("H2W2_VERSION_NOT_FOUND");
    return version;
  }

  listVersions(projectId?: string) {
    return [...this.versions.values()].filter((version) => !projectId || version.projectId === projectId);
  }

  compareVersions(sourceVersionId: string, targetVersionId: string) {
    const source = this.getVersion(sourceVersionId);
    const target = this.getVersion(targetVersionId);
    const sameOutcome = source.sceneId === target.sceneId && source.stageId === target.stageId;
    return {
      sourceVersionId,
      targetVersionId,
      contentChanged: source.contentHash !== target.contentHash,
      outcomeParity: sameOutcome ? "pass" : "warning",
      missingOutcomes: sameOutcome ? [] : ["stage identity differs"],
      dataLeftDevice: false,
    };
  }
}
