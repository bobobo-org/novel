import crypto from "crypto";
import type { SQLiteProjectConnection } from "../../storage/sqlite/sqlite-connection";
import { intimacySceneError } from "./intimacy-scene-errors";
import { writeIntimacyAudit, hashContent } from "./intimacy-scene-audit";
import { IntimacySceneRepository } from "./intimacy-scene-repository";
import { assertSceneTransition, assertStageTransition, DEFAULT_STAGE_TYPES } from "./intimacy-stage-machine";
import { assertValidation, validateParticipants } from "./intimacy-scene-validator";
import type { IntimacyBranch, IntimacyContinuityState, IntimacyScene, IntimacyScenePlanInput, IntimacySceneStatus, IntimacyStage, IntimacyStageStatus, IntimacyStageVersion, IntimacyVersionOperation } from "./intimacy-scene-types";

function now() { return new Date().toISOString(); }
function compact<T extends Record<string, unknown>>(row: T): T { return JSON.parse(JSON.stringify(row)); }

export class IntimacySceneService {
  readonly repo: IntimacySceneRepository;
  readonly options: { projectId: string; connection: SQLiteProjectConnection };

  constructor(options: { projectId: string; connection: SQLiteProjectConnection }) {
    this.options = options;
    this.repo = new IntimacySceneRepository(options.connection, options.projectId);
  }

  createScenePlan(input: IntimacyScenePlanInput) {
    if (input.projectId !== this.options.projectId) throw intimacySceneError("INTIMACY_BRANCH_CONTAMINATION", "Project ID mismatch.");
    this.ensureProjectRow(input.projectId);
    const validation = validateParticipants(input.participants);
    assertValidation(validation);
    const sceneId = this.repo.id("scene");
    const branchId = "main";
    const createdAt = now();
    const scene: IntimacyScene = compact({
      sceneId, projectId: input.projectId, chapterId: input.chapterId, branchId, scenarioPackId: input.scenarioPackId,
      policyVersion: input.policyVersion, rating: input.rating, explicitness: input.explicitness, title: input.title,
      purpose: input.purpose, status: "planned", plannedStageCount: 0, approvedStageCount: 0,
      participantCount: input.participants.length, createdAt, updatedAt: createdAt, version: 1
    });
    this.repo.insert("intimacy_scenes", sceneId, scene, {
      chapter_id: scene.chapterId ?? null, branch_id: branchId, scenario_pack_id: scene.scenarioPackId ?? null, policy_version: scene.policyVersion,
      rating: scene.rating, explicitness: scene.explicitness, title: scene.title, purpose: scene.purpose, status: scene.status,
      planned_stage_count: 0, approved_stage_count: 0, participant_count: scene.participantCount, version: 1, archived_at: null
    });
    input.participants.forEach((participant, index) => {
      const participantId = this.repo.id("participant");
      this.repo.insert("intimacy_scene_participants", participantId, compact({ participantId, sceneId, projectId: input.projectId, ...participant, required: participant.required ?? true, ordinal: index + 1, joinedAt: createdAt }), {
        scene_id: sceneId, participant_id: participantId, character_id: participant.characterId, role: participant.role, verified_adult_status: participant.verifiedAdultStatus,
        relationship_id: participant.relationshipId ?? null, relationship_stage: participant.relationshipStage ?? null, consent_state: participant.consentState,
        required: participant.required === false ? 0 : 1, ordinal: index + 1, joined_at: createdAt, left_at: null
      });
    });
    const branch: IntimacyBranch = { branchId, sceneId, projectId: input.projectId, branchName: "Main", branchStatus: "active", policyVersion: input.policyVersion, createdAt, updatedAt: createdAt };
    this.repo.insert("intimacy_scene_branches", this.repo.id("branchrow"), branch, { scene_id: sceneId, branch_id: branchId, parent_branch_id: null, divergence_stage_id: null, divergence_version_id: null, branch_name: branch.branchName, branch_status: branch.branchStatus, continuity_snapshot_id: null, policy_version: input.policyVersion });
    const stages = this.createDefaultStages(sceneId, input.stageTypes ?? DEFAULT_STAGE_TYPES);
    this.updateSceneCounts(sceneId);
    this.createContinuitySnapshot({ sceneId, branchId, locationState: "unspecified", timeState: "unspecified", consentState: "active", requiredNextBeat: stages[0]?.stageType ?? "setup" });
    writeIntimacyAudit(this.options.connection, { projectId: input.projectId, sceneId, branchId, action: "createScenePlan", nextStatus: "planned", policyVersion: input.policyVersion, validationResult: validation });
    return { scene: this.getScene(sceneId), stages, validation, dataLeftDevice: false, externalRequestCount: 0 };
  }

  createDefaultStages(sceneId: string, stageTypes = DEFAULT_STAGE_TYPES) {
    const scene = this.mustScene(sceneId);
    const createdAt = now();
    const stages = stageTypes.map((stageType, index) => {
      const stageId = this.repo.id("stage");
      const stage: IntimacyStage = compact({
        stageId, sceneId, projectId: this.options.projectId, branchId: scene.branchId, stageType, ordinal: index + 1,
        title: stageTitle(stageType), goal: stageGoal(stageType), targetLength: 220, status: index === 0 ? "ready" : "planned",
        previousStageId: undefined, nextStageId: undefined, required: stageType !== "explicit" && stageType !== "peak", skippable: stageType === "explicit" || stageType === "peak",
        createdAt, updatedAt: createdAt, version: 1
      });
      this.repo.insert("intimacy_scene_stages", stageId, stage, {
        scene_id: sceneId, branch_id: scene.branchId, stage_id: stageId, stage_type: stageType, ordinal: stage.ordinal, title: stage.title, goal: stage.goal,
        target_length: stage.targetLength, status: stage.status, current_version_id: null, previous_stage_id: null, next_stage_id: null,
        required: stage.required ? 1 : 0, skippable: stage.skippable ? 1 : 0, version: 1, archived_at: null
      });
      return stage;
    });
    stages.forEach((stage, index) => {
      stage.previousStageId = stages[index - 1]?.stageId;
      stage.nextStageId = stages[index + 1]?.stageId;
      this.repo.updateRow("intimacy_scene_stages", stage.stageId, stage, { previous_stage_id: stage.previousStageId ?? null, next_stage_id: stage.nextStageId ?? null });
      if (stage.previousStageId) this.addDependency(sceneId, stage.stageId, stage.previousStageId, "sequence", "approved");
    });
    return stages;
  }

  addDependency(sceneId: string, stageId: string, dependsOnStageId: string, dependencyType: string, requiredStatus: string, condition: Record<string, unknown> = {}) {
    const id = this.repo.id("dependency");
    const row = { id, projectId: this.options.projectId, sceneId, stageId, dependsOnStageId, dependencyType, requiredStatus, condition, createdAt: now() };
    this.repo.insert("intimacy_scene_stage_dependencies", id, row, { scene_id: sceneId, stage_id: stageId, depends_on_stage_id: dependsOnStageId, dependency_type: dependencyType, required_status: requiredStatus, condition_json: JSON.stringify(condition) });
    return row;
  }

  transitionScene(sceneId: string, nextStatus: IntimacySceneStatus) {
    const scene = this.mustScene(sceneId);
    if (scene.status === "archived") throw intimacySceneError("INTIMACY_SCENE_ARCHIVED", "Archived scene cannot transition.");
    assertSceneTransition(scene.status, nextStatus);
    const previous = scene.status;
    scene.status = nextStatus;
    scene.updatedAt = now();
    scene.version += 1;
    if (nextStatus === "archived") scene.archivedAt = scene.updatedAt;
    this.repo.updateRow("intimacy_scenes", sceneId, scene, { status: scene.status, archived_at: scene.archivedAt ?? null, version: scene.version });
    this.recordTransition(sceneId, undefined, scene.branchId, "scene", previous, nextStatus, { ok: true });
    return scene;
  }

  transitionStage(sceneId: string, stageId: string, nextStatus: IntimacyStageStatus, options: { withdrawalState?: string } = {}) {
    const stage = this.mustStage(stageId);
    if (stage.sceneId !== sceneId) throw intimacySceneError("INTIMACY_BRANCH_CONTAMINATION", "Stage does not belong to scene.");
    if (stage.status === "archived") throw intimacySceneError("INTIMACY_STAGE_ARCHIVED", "Archived stage cannot transition.");
    this.assertDependencies(stage);
    assertStageTransition(stage.status, nextStatus, { required: stage.required, skippable: stage.skippable, withdrawalState: options.withdrawalState });
    const previous = stage.status;
    stage.status = nextStatus;
    stage.updatedAt = now();
    stage.version += 1;
    this.repo.updateRow("intimacy_scene_stages", stageId, stage, { status: stage.status, version: stage.version });
    this.recordTransition(sceneId, stageId, stage.branchId, "stage", previous, nextStatus, { ok: true });
    this.updateSceneCounts(sceneId);
    return stage;
  }

  createStageVersion(sceneId: string, stageId: string, input: { operation?: IntimacyVersionOperation; draftText?: string; summary?: string; metadata?: Record<string, unknown> }) {
    const stage = this.mustStage(stageId);
    const scene = this.mustScene(sceneId);
    const current = this.listVersions(stageId).find((version) => version.status === "current" || version.status === "approved");
    if (current) {
      current.status = "superseded";
      current.supersededAt = now();
      this.repo.updateRow("intimacy_scene_stage_versions", current.versionId, current, { status: "superseded", superseded_at: current.supersededAt });
    }
    const versionId = this.repo.id("stage_version");
    const createdAt = now();
    const version: IntimacyStageVersion = {
      versionId, stageId, sceneId, projectId: this.options.projectId, branchId: stage.branchId, parentVersionId: current?.versionId,
      operation: input.operation ?? "initial", status: "current", goalSnapshot: stage.goal, continuityInputHash: hashContent({ stage, scene }),
      policyVersion: scene.policyVersion, promptTemplateVersion: "h2p3-structural-v1", draftText: input.draftText ?? "[structural placeholder only]",
      summary: input.summary ?? `${stage.stageType} structural summary`, metadata: input.metadata ?? { explicitText: false }, createdAt
    };
    this.repo.insert("intimacy_scene_stage_versions", versionId, version, {
      scene_id: sceneId, stage_id: stageId, branch_id: stage.branchId, version_id: versionId, parent_version_id: version.parentVersionId ?? null,
      operation: version.operation, status: version.status, goal_snapshot: version.goalSnapshot, continuity_input_hash: version.continuityInputHash,
      policy_version: version.policyVersion, prompt_template_version: version.promptTemplateVersion, draft_text: version.draftText, summary: version.summary, metadata_json: JSON.stringify(version.metadata), superseded_at: null
    });
    stage.currentVersionId = versionId;
    this.repo.updateRow("intimacy_scene_stages", stageId, stage, { current_version_id: versionId });
    writeIntimacyAudit(this.options.connection, { projectId: this.options.projectId, sceneId, stageId, versionId, branchId: stage.branchId, action: "createStageVersion", nextStatus: version.status, policyVersion: scene.policyVersion, details: { summary: version.summary } });
    return version;
  }

  approveVersion(sceneId: string, stageId: string, versionId: string) {
    const version = this.mustVersion(versionId);
    version.status = "approved";
    this.repo.updateRow("intimacy_scene_stage_versions", versionId, version, { status: "approved" });
    this.transitionStage(sceneId, stageId, "approved");
    this.createContinuitySnapshot({ sceneId, stageId, versionId, branchId: version.branchId, completedActions: [version.summary], requiredNextBeat: "next-stage" });
    return version;
  }

  rejectVersion(versionId: string) {
    const version = this.mustVersion(versionId);
    version.status = "rejected";
    this.repo.updateRow("intimacy_scene_stage_versions", versionId, version, { status: "rejected" });
    return version;
  }

  rollbackStageToVersion(sceneId: string, stageId: string, versionId: string) {
    const version = this.mustVersion(versionId);
    if (version.stageId !== stageId || version.sceneId !== sceneId) throw intimacySceneError("INTIMACY_ROLLBACK_INVALID", "Version does not belong to target stage.");
    const restored = this.createStageVersion(sceneId, stageId, { operation: "rollback", draftText: version.draftText, summary: version.summary, metadata: { restoredFrom: versionId } });
    writeIntimacyAudit(this.options.connection, { projectId: this.options.projectId, sceneId, stageId, versionId: restored.versionId, branchId: version.branchId, action: "rollbackStageToVersion", previousStatus: version.status, nextStatus: restored.status });
    return restored;
  }

  createBranchFromStage(sceneId: string, stageId: string, name = "Alternative branch") {
    const scene = this.mustScene(sceneId);
    const stage = this.mustStage(stageId);
    const branchId = this.repo.id("branch");
    const branch: IntimacyBranch = { branchId, sceneId, projectId: this.options.projectId, parentBranchId: stage.branchId, divergenceStageId: stageId, divergenceVersionId: stage.currentVersionId, branchName: name, branchStatus: "active", policyVersion: scene.policyVersion, createdAt: now(), updatedAt: now() };
    this.repo.insert("intimacy_scene_branches", this.repo.id("branchrow"), branch, { scene_id: sceneId, branch_id: branchId, parent_branch_id: branch.parentBranchId ?? null, divergence_stage_id: stageId, divergence_version_id: stage.currentVersionId ?? null, branch_name: name, branch_status: "active", continuity_snapshot_id: null, policy_version: scene.policyVersion });
    const stages = this.listStages(sceneId).map((source) => {
      const clone: IntimacyStage = { ...source, stageId: this.repo.id("stage"), branchId, status: source.stageId === stageId ? "ready" : source.status, currentVersionId: undefined, previousStageId: undefined, nextStageId: undefined, createdAt: now(), updatedAt: now(), version: 1 };
      this.repo.insert("intimacy_scene_stages", clone.stageId, clone, { scene_id: sceneId, branch_id: branchId, stage_id: clone.stageId, stage_type: clone.stageType, ordinal: clone.ordinal, title: clone.title, goal: clone.goal, target_length: clone.targetLength, status: clone.status, current_version_id: null, previous_stage_id: null, next_stage_id: null, required: clone.required ? 1 : 0, skippable: clone.skippable ? 1 : 0, version: 1, archived_at: null });
      return clone;
    });
    stages.forEach((cloned, index) => {
      cloned.previousStageId = stages[index - 1]?.stageId;
      cloned.nextStageId = stages[index + 1]?.stageId;
      this.repo.updateRow("intimacy_scene_stages", cloned.stageId, cloned, { previous_stage_id: cloned.previousStageId ?? null, next_stage_id: cloned.nextStageId ?? null });
    });
    this.createContinuitySnapshot({ sceneId, branchId, requiredNextBeat: "branch-review" });
    return { branch, stages };
  }

  compareBranches(sceneId: string, a: string, b: string) {
    const aStages = this.listStages(sceneId).filter((stage) => stage.branchId === a);
    const bStages = this.listStages(sceneId).filter((stage) => stage.branchId === b);
    return { sceneId, leftBranchId: a, rightBranchId: b, stageCountDelta: aStages.length - bStages.length, statusDifferences: aStages.filter((stage, index) => stage.status !== bStages[index]?.status).length, dataLeftDevice: false, externalRequestCount: 0 };
  }

  archiveBranch(sceneId: string, branchId: string) {
    const branch = this.mustBranch(sceneId, branchId);
    branch.branchStatus = "archived";
    branch.updatedAt = now();
    this.repo.updateRow("intimacy_scene_branches", String((this.options.connection.get("SELECT id FROM intimacy_scene_branches WHERE project_id=? AND scene_id=? AND branch_id=?", [this.options.projectId, sceneId, branchId])?.id)), branch, { branch_status: "archived" });
    return branch;
  }

  createContinuitySnapshot(input: Partial<IntimacyContinuityState> & { sceneId: string; branchId: string; beforeSnapshot?: unknown; afterSnapshot?: unknown; delta?: unknown; validationResult?: unknown }) {
    const continuityId = this.repo.id("continuity");
    const createdAt = now();
    const state: IntimacyContinuityState = {
      continuityId, projectId: this.options.projectId, sceneId: input.sceneId, stageId: input.stageId, versionId: input.versionId, branchId: input.branchId,
      participantPositions: input.participantPositions ?? {}, participantEmotions: input.participantEmotions ?? {}, relationshipState: input.relationshipState ?? {},
      trustState: input.trustState ?? {}, attractionState: input.attractionState ?? {}, conflictState: input.conflictState ?? "stable",
      objectState: input.objectState ?? {}, locationState: input.locationState ?? "unspecified", timeState: input.timeState ?? "unspecified",
      dialogueCommitments: input.dialogueCommitments ?? [], completedActions: input.completedActions ?? [], unresolvedActions: input.unresolvedActions ?? [],
      forbiddenRepetitions: input.forbiddenRepetitions ?? [], requiredNextBeat: input.requiredNextBeat ?? "", consentState: input.consentState ?? "active",
      withdrawalState: input.withdrawalState ?? "none", narrativePurposeProgress: input.narrativePurposeProgress ?? "planned", continuityVersion: input.continuityVersion ?? 1,
      createdAt, updatedAt: createdAt
    };
    this.repo.insert("intimacy_continuity_states", continuityId, state, { scene_id: state.sceneId, stage_id: state.stageId ?? null, version_id: state.versionId ?? null, branch_id: state.branchId, continuity_version: state.continuityVersion, before_snapshot_json: JSON.stringify(input.beforeSnapshot ?? null), after_snapshot_json: JSON.stringify(input.afterSnapshot ?? state), delta_json: JSON.stringify(input.delta ?? {}), validation_result_json: JSON.stringify(input.validationResult ?? { ok: true }) });
    return state;
  }

  listScenes() { return this.options.connection.all("SELECT row_json FROM intimacy_scenes WHERE project_id=? ORDER BY created_at", [this.options.projectId]).map((row) => JSON.parse(String(row.row_json)) as IntimacyScene); }
  getScene(sceneId: string) { return this.repo.getById<IntimacyScene>("intimacy_scenes", sceneId); }
  listStages(sceneId: string) { return this.repo.listByScene<IntimacyStage>("intimacy_scene_stages", sceneId, "ordinal ASC, created_at ASC"); }
  listVersions(stageId: string) { return this.options.connection.all("SELECT row_json FROM intimacy_scene_stage_versions WHERE project_id=? AND stage_id=? ORDER BY created_at", [this.options.projectId, stageId]).map((row) => JSON.parse(String(row.row_json)) as IntimacyStageVersion); }
  listContinuity(sceneId: string) { return this.repo.listByScene<IntimacyContinuityState>("intimacy_continuity_states", sceneId, "created_at ASC"); }
  listBranches(sceneId: string) { return this.repo.listByScene<IntimacyBranch>("intimacy_scene_branches", sceneId, "created_at ASC"); }
  counts() {
    return {
      sceneCount: this.repo.count("intimacy_scenes"),
      stageCount: this.repo.count("intimacy_scene_stages"),
      versionCount: this.repo.count("intimacy_scene_stage_versions"),
      branchCount: this.repo.count("intimacy_scene_branches"),
      activeSceneCount: this.repo.count("intimacy_scenes", "status='active'"),
      pausedSceneCount: this.repo.count("intimacy_scenes", "status='paused'"),
      dataLeftDevice: false,
      externalRequestCount: 0,
    };
  }

  private updateSceneCounts(sceneId: string) {
    const scene = this.mustScene(sceneId);
    const stages = this.listStages(sceneId).filter((stage) => stage.branchId === scene.branchId);
    scene.plannedStageCount = stages.length;
    scene.approvedStageCount = stages.filter((stage) => stage.status === "approved").length;
    scene.currentStageId = stages.find((stage) => ["ready", "active", "draft_ready"].includes(stage.status))?.stageId;
    scene.currentStageType = stages.find((stage) => stage.stageId === scene.currentStageId)?.stageType;
    scene.updatedAt = now();
    this.repo.updateRow("intimacy_scenes", sceneId, scene, { current_stage_id: scene.currentStageId ?? null, current_stage_type: scene.currentStageType ?? null, planned_stage_count: scene.plannedStageCount, approved_stage_count: scene.approvedStageCount });
  }

  private assertDependencies(stage: IntimacyStage) {
    const deps = this.options.connection.all("SELECT row_json FROM intimacy_scene_stage_dependencies WHERE project_id=? AND stage_id=?", [this.options.projectId, stage.stageId]).map((row) => JSON.parse(String(row.row_json)) as { dependsOnStageId: string; requiredStatus: string });
    for (const dep of deps) {
      const parent = this.mustStage(dep.dependsOnStageId);
      if (stage.status === "planned" && parent.status !== dep.requiredStatus) throw intimacySceneError("INTIMACY_STAGE_DEPENDENCY_UNMET", "Stage dependency is not met.", { stageId: stage.stageId, dependsOnStageId: dep.dependsOnStageId, requiredStatus: dep.requiredStatus, actualStatus: parent.status });
    }
  }

  private recordTransition(sceneId: string, stageId: string | undefined, branchId: string | undefined, transitionType: string, previousStatus: string, nextStatus: string, validationResult: unknown) {
    const id = this.repo.id("transition");
    const row = { id, projectId: this.options.projectId, sceneId, stageId, branchId, transitionType, previousStatus, nextStatus, validationResult, createdAt: now() };
    this.repo.insert("intimacy_scene_transitions", id, row, { scene_id: sceneId, stage_id: stageId ?? null, branch_id: branchId ?? null, transition_type: transitionType, previous_status: previousStatus, next_status: nextStatus, validation_result_json: JSON.stringify(validationResult) });
    writeIntimacyAudit(this.options.connection, { projectId: this.options.projectId, sceneId, stageId, branchId, action: `${transitionType}Transition`, previousStatus, nextStatus, validationResult });
  }

  private mustScene(sceneId: string) { const scene = this.getScene(sceneId); if (!scene) throw intimacySceneError("INTIMACY_SCENE_NOT_FOUND", `Scene not found: ${sceneId}`); return scene; }
  private mustStage(stageId: string) { const stage = this.repo.getById<IntimacyStage>("intimacy_scene_stages", stageId); if (!stage) throw intimacySceneError("INTIMACY_STAGE_NOT_FOUND", `Stage not found: ${stageId}`); return stage; }
  private mustVersion(versionId: string) { const version = this.repo.getById<IntimacyStageVersion>("intimacy_scene_stage_versions", versionId); if (!version) throw intimacySceneError("INTIMACY_VERSION_NOT_FOUND", `Version not found: ${versionId}`); return version; }
  private mustBranch(sceneId: string, branchId: string) { const row = this.options.connection.get("SELECT row_json FROM intimacy_scene_branches WHERE project_id=? AND scene_id=? AND branch_id=?", [this.options.projectId, sceneId, branchId]); if (!row) throw intimacySceneError("INTIMACY_BRANCH_NOT_FOUND", `Branch not found: ${branchId}`); return JSON.parse(String(row.row_json)) as IntimacyBranch; }
  private ensureProjectRow(projectId: string) {
    const row = this.options.connection.get("SELECT project_id FROM projects WHERE project_id=?", [projectId]);
    if (row) return;
    const createdAt = now();
    this.options.connection.run("INSERT INTO projects(id, project_id, row_json, created_at, updated_at) VALUES(?,?,?,?,?)", [
      projectId,
      projectId,
      JSON.stringify({ projectId, createdBy: "intimacy-scene-service", createdAt }),
      createdAt,
      createdAt,
    ]);
  }
}

function stageTitle(type: string) { return type.replace(/_/g, " "); }
function stageGoal(type: string) { return `Plan the ${type} beat as a non-explicit structural summary.`; }
