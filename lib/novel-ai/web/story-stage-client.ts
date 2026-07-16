import type { WebSceneRecord } from "./story-scene-client";

export type WebStageAction = "generate" | "regenerate" | "rewrite" | "extend" | "shorten" | "tone" | "perspective" | "pacing" | "detail" | "split" | "merge" | "save_draft";

export type WebStageRecord = {
  projectId: string;
  sceneId: string;
  stageId: string;
  branchId: string;
  title: string;
  stageType: string;
  goal: string;
  status: "not_started" | "planning" | "generating" | "completed" | "needs_revision" | "paused";
  version: number;
  targetLength: number;
  actualLength: number;
  validation: "pending" | "pass" | "warning" | "fail";
  continuityStatus: "pending" | "updated" | "warning";
  content: string;
  provider: string;
  model: string;
  updatedAt: string;
};

const STAGE_BLUEPRINTS = [
  ["opening", "Opening and scene setup", "Establish place, mood, and immediate pressure."],
  ["character_state", "Character current state", "Clarify the protagonist's goal, emotion, and constraint."],
  ["conflict_appears", "Conflict appears", "Bring the scene problem onto the page."],
  ["first_reaction", "First reaction", "Show a concrete character response."],
  ["escalation", "Conflict escalation", "Raise cost or danger."],
  ["turn", "Midpoint turn", "Change the meaning of the situation."],
  ["choice_cost", "Choice and cost", "Force a decision with consequence."],
  ["hook", "Result and hook", "Close with outcome and next-scene expectation."],
] as const;

export class StoryStageWebClient {
  private stages = new Map<string, WebStageRecord>();

  planStages(scene: WebSceneRecord) {
    return STAGE_BLUEPRINTS.map(([stageType, title, goal], index) => {
      const stageId = `${scene.sceneId}_${stageType}_${index + 1}`;
      const record: WebStageRecord = {
        projectId: scene.projectId,
        sceneId: scene.sceneId,
        stageId,
        branchId: scene.branchId,
        title,
        stageType,
        goal,
        status: "planning",
        version: 1,
        targetLength: scene.rating === "adult" ? 360 : 300,
        actualLength: 0,
        validation: "pending",
        continuityStatus: "pending",
        content: "",
        provider: "none",
        model: "none",
        updatedAt: new Date().toISOString(),
      };
      this.stages.set(stageId, record);
      return record;
    });
  }

  getStage(stageId: string) {
    return this.stages.get(stageId) ?? null;
  }

  listStages(sceneId: string) {
    return [...this.stages.values()].filter((stage) => stage.sceneId === sceneId);
  }

  listAllStages(projectId?: string) {
    return [...this.stages.values()].filter((stage) => !projectId || stage.projectId === projectId);
  }

  applyDraft(stageId: string, content: string, action: WebStageAction, meta: { provider: string; model: string }) {
    const stage = this.getStage(stageId);
    if (!stage) throw new Error("H2W2_STAGE_NOT_FOUND");
    const updated: WebStageRecord = {
      ...stage,
      status: action === "save_draft" ? "planning" : "completed",
      version: stage.version + 1,
      actualLength: content.length,
      validation: content.trim() ? "pass" : "warning",
      continuityStatus: "updated",
      content,
      provider: meta.provider,
      model: meta.model,
      updatedAt: new Date().toISOString(),
    };
    this.stages.set(stageId, updated);
    return updated;
  }

  markStage(stageId: string, status: WebStageRecord["status"]) {
    const stage = this.getStage(stageId);
    if (!stage) throw new Error("H2W2_STAGE_NOT_FOUND");
    const updated = { ...stage, status, updatedAt: new Date().toISOString() };
    this.stages.set(stageId, updated);
    return updated;
  }

  localDraft(stage: WebStageRecord, action: WebStageAction, instruction = "") {
    const actionLabel = action === "rewrite" ? "rewritten" : action === "extend" ? "extended" : action === "shorten" ? "tightened" : "generated";
    return [
      `[${stage.title}] ${actionLabel} locally.`,
      `Goal: ${stage.goal}`,
      instruction ? `Instruction: ${instruction}` : "Instruction: preserve scene outcome and continuity.",
      "The draft keeps the current branch isolated, updates continuity as a candidate, and never calls an external provider.",
    ].join("\n");
  }
}
