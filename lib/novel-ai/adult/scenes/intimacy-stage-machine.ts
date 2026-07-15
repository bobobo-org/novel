import { intimacySceneError } from "./intimacy-scene-errors";
import type { IntimacySceneStatus, IntimacyStageStatus, IntimacyStageType } from "./intimacy-scene-types";

const SCENE_TRANSITIONS: Record<IntimacySceneStatus, IntimacySceneStatus[]> = {
  planned: ["ready", "cancelled", "blocked"],
  ready: ["active", "paused", "cancelled", "blocked"],
  active: ["paused", "completed", "cancelled", "blocked"],
  paused: ["active", "cancelled", "blocked"],
  completed: ["archived"],
  cancelled: ["archived"],
  blocked: ["planned", "cancelled", "archived"],
  archived: [],
};

const STAGE_TRANSITIONS: Record<IntimacyStageStatus, IntimacyStageStatus[]> = {
  planned: ["ready", "cancelled", "skipped"],
  ready: ["active", "cancelled", "skipped"],
  active: ["paused", "draft_ready", "failed", "cancelled"],
  paused: ["active", "cancelled"],
  draft_ready: ["approved", "rejected"],
  rejected: ["active", "archived"],
  failed: ["active", "cancelled"],
  approved: ["superseded", "archived"],
  cancelled: ["archived"],
  superseded: ["archived"],
  archived: [],
  skipped: ["archived"],
};

export const DEFAULT_STAGE_TYPES: IntimacyStageType[] = ["setup", "approach", "consent", "escalation", "deescalation", "aftermath"];
export const FULL_STAGE_TYPES: IntimacyStageType[] = ["setup", "approach", "consent", "escalation", "explicit", "peak", "deescalation", "aftermath"];

export function assertSceneTransition(previous: IntimacySceneStatus, next: IntimacySceneStatus) {
  if (!SCENE_TRANSITIONS[previous]?.includes(next)) {
    throw intimacySceneError("INTIMACY_INVALID_SCENE_TRANSITION", `Cannot transition scene from ${previous} to ${next}.`, { previous, next });
  }
}

export function assertStageTransition(previous: IntimacyStageStatus, next: IntimacyStageStatus, options: { required?: boolean; skippable?: boolean; withdrawalState?: string } = {}) {
  if (next === "skipped" && (options.required || !options.skippable)) {
    throw intimacySceneError("INTIMACY_REQUIRED_STAGE_SKIPPED", "Required stage cannot be skipped.", options);
  }
  if (options.withdrawalState === "withdrawn" && next !== "cancelled" && next !== "archived") {
    throw intimacySceneError("INTIMACY_INVALID_STAGE_TRANSITION", "Withdrawn consent blocks forward stage transitions.", options);
  }
  if (!STAGE_TRANSITIONS[previous]?.includes(next)) {
    throw intimacySceneError("INTIMACY_INVALID_STAGE_TRANSITION", `Cannot transition stage from ${previous} to ${next}.`, { previous, next });
  }
}

export function sceneTransitionRules() {
  return SCENE_TRANSITIONS;
}

export function stageTransitionRules() {
  return STAGE_TRANSITIONS;
}
