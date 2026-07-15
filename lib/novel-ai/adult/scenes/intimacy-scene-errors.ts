export type IntimacySceneErrorCode =
  | "INTIMACY_SCENE_NOT_FOUND"
  | "INTIMACY_STAGE_NOT_FOUND"
  | "INTIMACY_BRANCH_NOT_FOUND"
  | "INTIMACY_VERSION_NOT_FOUND"
  | "INTIMACY_INVALID_SCENE_TRANSITION"
  | "INTIMACY_INVALID_STAGE_TRANSITION"
  | "INTIMACY_STAGE_DEPENDENCY_UNMET"
  | "INTIMACY_REQUIRED_STAGE_SKIPPED"
  | "INTIMACY_POLICY_VERSION_MISMATCH"
  | "INTIMACY_PARTICIPANT_INVALID"
  | "INTIMACY_CONTINUITY_MISSING"
  | "INTIMACY_BRANCH_CONTAMINATION"
  | "INTIMACY_VERSION_CONFLICT"
  | "INTIMACY_ROLLBACK_INVALID"
  | "INTIMACY_SCENE_ARCHIVED"
  | "INTIMACY_STAGE_ARCHIVED";

export class IntimacySceneError extends Error {
  readonly code: IntimacySceneErrorCode;
  readonly details?: unknown;

  constructor(code: IntimacySceneErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "IntimacySceneError";
    this.code = code;
    this.details = details;
  }
}

export function intimacySceneError(code: IntimacySceneErrorCode, message: string, details?: unknown) {
  return new IntimacySceneError(code, message, details);
}
