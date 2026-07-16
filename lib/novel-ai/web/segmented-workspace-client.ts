import { WebLocalRuntimeClient, type WebRuntimeTaskInput } from "./local-runtime-client";
import { buildWorkspaceStatus, type WorkspacePrivacyStatus } from "./story-continuity-client";
import { StorySceneWebClient, type WebSceneRecord } from "./story-scene-client";
import { StoryStageWebClient, type WebStageAction, type WebStageRecord } from "./story-stage-client";
import { StoryVersionWebClient } from "./story-version-client";
import { StoryBranchWebClient } from "./story-branch-client";
import { StoryTransformWebClient, type WebTransformType } from "./story-transform-client";

export const WEB_SEGMENTED_WORKSPACE_VERSION = "h2w2-web-segmented-story-workspace-v1";

export type WorkspaceEventType =
  | "planning"
  | "generating"
  | "validating"
  | "updating_continuity"
  | "extracting_consequence"
  | "saving_version"
  | "transforming"
  | "completed"
  | "cancelled"
  | "failed";

export type WorkspaceEvent = {
  type: WorkspaceEventType;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  message: string;
  at: string;
};

export type SegmentedWorkspaceOptions = {
  runtime?: Pick<WebLocalRuntimeClient, "runTask" | "cancelTask">;
  now?: () => string;
};

export type WorkspaceSnapshot = {
  version: string;
  projectId: string;
  sceneCount: number;
  stageCount: number;
  versionCount: number;
  branchCount: number;
  privacy: WorkspacePrivacyStatus;
  events: WorkspaceEvent[];
};

export class SegmentedStoryWorkspaceClient {
  readonly scene = new StorySceneWebClient();
  readonly stage = new StoryStageWebClient();
  readonly version = new StoryVersionWebClient();
  readonly branch = new StoryBranchWebClient();
  readonly transform = new StoryTransformWebClient();
  private readonly runtime?: Pick<WebLocalRuntimeClient, "runTask" | "cancelTask">;
  private readonly now: () => string;
  private events: WorkspaceEvent[] = [];
  private activeTaskId: string | null = null;

  constructor(options: SegmentedWorkspaceOptions = {}) {
    this.runtime = options.runtime;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  createScene(input: Partial<WebSceneRecord> & { projectId: string; title: string }) {
    const scene = this.scene.createScene(input);
    this.event("planning", "success", `Scene created: ${scene.sceneId}`);
    return scene;
  }

  createAdultScene(input: Partial<WebSceneRecord> & { projectId: string; title: string }) {
    const scene = this.scene.createScene({
      ...input,
      rating: "adult",
      adultPolicyStatus: input.adultPolicyStatus ?? "verified",
      externalFallbackAllowed: false,
    });
    this.event("planning", "success", `Adult scene created locally: ${scene.sceneId}`);
    return scene;
  }

  planStages(sceneId: string) {
    const scene = this.scene.getScene(sceneId);
    if (!scene) throw new Error("H2W2_SCENE_NOT_FOUND");
    const stages = this.stage.planStages(scene);
    this.event("planning", "success", `Planned ${stages.length} stages for ${sceneId}`);
    return stages;
  }

  async generateStage(stageId: string, action: WebStageAction = "generate", instruction = "") {
    const stage = this.stage.getStage(stageId);
    if (!stage) throw new Error("H2W2_STAGE_NOT_FOUND");
    this.event("generating", "running", `${action}:${stageId}`);
    const taskInput: WebRuntimeTaskInput = {
      projectId: stage.projectId,
      taskType: `h2w2:${action}`,
      input: [stage.title, stage.goal, instruction].filter(Boolean).join("\n"),
      targetLength: stage.targetLength,
    };
    let content = this.stage.localDraft(stage, action, instruction);
    let provider = "local-rule";
    let model = "workspace-local-rule";
    if (this.runtime) {
      const result = await this.runtime.runTask(taskInput);
      this.activeTaskId = result.taskId;
      content = result.content || content;
      provider = result.provider;
      model = result.model;
      if (result.dataLeftDevice) throw new Error("H2W2_DATA_LEFT_DEVICE_BLOCKED");
    }
    const updated = this.stage.applyDraft(stageId, content, action, { provider, model });
    const version = this.version.createVersionFromStage(updated);
    this.event("validating", "success", `Validated stage ${stageId}`);
    this.event("updating_continuity", "success", `Continuity updated for ${stageId}`);
    this.event("extracting_consequence", "success", `Consequence candidate prepared for ${stageId}`);
    this.event("saving_version", "success", `Version saved ${version.versionId}`);
    this.event("completed", "success", `${action}:${stageId}`);
    return { stage: updated, version };
  }

  async rewriteStage(stageId: string, instruction: string) {
    return this.generateStage(stageId, "rewrite", instruction);
  }

  async extendStage(stageId: string, instruction = "extend") {
    return this.generateStage(stageId, "extend", instruction);
  }

  async shortenStage(stageId: string, instruction = "shorten") {
    return this.generateStage(stageId, "shorten", instruction);
  }

  rollbackStage(stageId: string) {
    const stage = this.stage.markStage(stageId, "needs_revision");
    this.event("validating", "success", `Rolled back stage ${stageId}`);
    return stage;
  }

  completeScene(sceneId: string) {
    const sceneStages = this.stage.listStages(sceneId);
    const merged = sceneStages.map((stage) => stage.content).filter(Boolean).join("\n\n");
    const scene = this.scene.updateScene(sceneId, { status: "completed", mergedContent: merged });
    this.event("completed", "success", `Scene completed ${sceneId}`);
    return { scene, mergedContent: merged };
  }

  mergeWholeScene(sceneId: string) {
    return this.completeScene(sceneId);
  }

  saveDraft(stageId: string, content: string) {
    const stage = this.stage.applyDraft(stageId, content, "save_draft", { provider: "author", model: "manual" });
    const version = this.version.createVersionFromStage(stage, "manual_draft");
    this.event("saving_version", "success", `Manual draft saved ${version.versionId}`);
    return { stage, version };
  }

  createCandidate(stageId: string, label = "consequence") {
    const stage = this.stage.getStage(stageId);
    if (!stage) throw new Error("H2W2_STAGE_NOT_FOUND");
    return {
      candidateId: `candidate_${stageId}_${Date.now()}`,
      projectId: stage.projectId,
      sceneId: stage.sceneId,
      stageId,
      label,
      confidence: 0.72,
      status: "needs_review",
      dataLeftDevice: false,
    };
  }

  createBranch(sceneId: string, name = "alternate") {
    const branch = this.branch.createBranch(sceneId, name);
    this.event("planning", "success", `Branch created ${branch.branchId}`);
    return branch;
  }

  compareBranches(sourceBranchId: string, targetBranchId: string) {
    return this.branch.compareBranches(sourceBranchId, targetBranchId, this.version.listVersions());
  }

  transformVersion(versionId: string, transformType: WebTransformType) {
    this.event("transforming", "running", `${transformType}:${versionId}`);
    const result = this.transform.transformVersion(this.version.getVersion(versionId), transformType);
    this.version.addVersion(result.target);
    this.event("transforming", "success", result.transformId);
    return result;
  }

  compareVersions(sourceVersionId: string, targetVersionId: string) {
    return this.version.compareVersions(sourceVersionId, targetVersionId);
  }

  cancelActiveTask() {
    if (!this.runtime || !this.activeTaskId) {
      this.event("cancelled", "skipped", "No active runtime task.");
      return { cancelled: false };
    }
    this.event("cancelled", "success", this.activeTaskId);
    return this.runtime.cancelTask(this.activeTaskId);
  }

  snapshot(projectId: string): WorkspaceSnapshot {
    return {
      version: WEB_SEGMENTED_WORKSPACE_VERSION,
      projectId,
      sceneCount: this.scene.listScenes(projectId).length,
      stageCount: this.stage.listAllStages(projectId).length,
      versionCount: this.version.listVersions(projectId).length,
      branchCount: this.branch.listBranches().length,
      privacy: buildWorkspaceStatus(),
      events: [...this.events],
    };
  }

  private event(type: WorkspaceEventType, status: WorkspaceEvent["status"], message: string) {
    this.events.push({ type, status, message, at: this.now() });
  }
}
