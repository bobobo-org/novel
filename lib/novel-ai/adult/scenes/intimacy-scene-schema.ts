import {
  BRANCH_STATUSES,
  INTIMACY_MIGRATION_VERSION,
  INTIMACY_SCHEMA_VERSION,
  SCENE_STATUSES,
  STAGE_STATUSES,
  STAGE_TYPES,
  VERSION_OPERATIONS,
} from "./intimacy-scene-types";

export const INTIMACY_SCENE_TABLES = [
  "intimacy_scenes",
  "intimacy_scene_participants",
  "intimacy_scene_stages",
  "intimacy_scene_stage_versions",
  "intimacy_continuity_states",
  "intimacy_scene_branches",
  "intimacy_scene_transitions",
  "intimacy_scene_audits",
  "intimacy_scene_drafts",
  "intimacy_scene_stage_dependencies",
  "intimacy_scene_stage_requirements",
] as const;

export const INTIMACY_SCENE_SCHEMA_CONTRACT = {
  schemaVersion: INTIMACY_SCHEMA_VERSION,
  migrationVersion: INTIMACY_MIGRATION_VERSION,
  tables: INTIMACY_SCENE_TABLES,
  sceneStatuses: SCENE_STATUSES,
  stageTypes: STAGE_TYPES,
  stageStatuses: STAGE_STATUSES,
  branchStatuses: BRANCH_STATUSES,
  versionOperations: VERSION_OPERATIONS,
  explicitGeneration: "not_implemented",
  localGeneration: "not_implemented",
  dataLeavesDevice: false,
};

export function redactIntimacyDiagnostics(value: Record<string, unknown>) {
  const hidden = new Set(["title", "stageTitle", "participantNames", "selectedTags", "draftText", "continuityDetails", "privatePreferences"]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !hidden.has(key)));
}
