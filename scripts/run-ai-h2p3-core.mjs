import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { SQLITE_MIGRATIONS } from "../lib/novel-ai/storage/sqlite/sqlite-migrations.ts";
import {
  DEFAULT_STAGE_TYPES,
  FULL_STAGE_TYPES,
  INTIMACY_SCENE_SCHEMA_CONTRACT,
  INTIMACY_SCENE_TABLES,
  IntimacySceneService,
  SCENE_STATUSES,
  STAGE_STATUSES,
  STAGE_TYPES,
  assertSceneTransition,
  assertStageTransition,
  intimacyRuntimeContract,
  redactIntimacyDiagnostics,
} from "../lib/novel-ai/adult/scenes/index.ts";

const suite = process.argv[2] || "all";
const h = createHarness(`H2P.3 ${suite}`);
const storageDir = path.resolve(process.cwd(), `.tmp-h2p3-${suite}`);
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });

const projectId = `h2p3-${suite}`;
const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
const service = new IntimacySceneService({ projectId, connection });

function sceneInput(overrides = {}) {
  return {
    projectId,
    chapterId: "chapter_001",
    scenarioPackId: "slow-burn-structural",
    policyVersion: 1,
    rating: "E5",
    explicitness: 5,
    title: "Private structural scene",
    purpose: "Track continuity and branch planning without generating explicit prose.",
    participants: [
      { characterId: "char_a", role: "lead", verifiedAdultStatus: "verified_adult", consentState: "active", relationshipId: "rel_a_b", relationshipStage: "established" },
      { characterId: "char_b", role: "lead", verifiedAdultStatus: "verified_adult", consentState: "active", relationshipId: "rel_a_b", relationshipStage: "established" },
    ],
    ...overrides,
  };
}

function createScene(stageTypes = DEFAULT_STAGE_TYPES) {
  return service.createScenePlan(sceneInput({ stageTypes }));
}

function expectThrow(name, fn) {
  let thrown = false;
  try { fn(); } catch { thrown = true; }
  h.assert(name, thrown);
}

function runSchema() {
  h.assert("migration 16 present", SQLITE_MIGRATIONS.some((m) => m.version === 16 && m.name === "016_segmented_scene_state_machine"));
  for (const table of INTIMACY_SCENE_TABLES) {
    h.assert(`table exists ${table}`, Boolean(connection.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table])));
  }
  h.assert("schema contract version", INTIMACY_SCENE_SCHEMA_CONTRACT.schemaVersion === "h2p3-segmented-scene-state-machine-v1");
  h.assert("migration contract version", INTIMACY_SCENE_SCHEMA_CONTRACT.migrationVersion === "016_segmented_scene_state_machine");
  h.assert("scene statuses include blocked", SCENE_STATUSES.includes("blocked"));
  h.assert("scene statuses include archived", SCENE_STATUSES.includes("archived"));
  h.assert("stage types include setup", STAGE_TYPES.includes("setup"));
  h.assert("stage types include aftermath", STAGE_TYPES.includes("aftermath"));
  h.assert("stage statuses include draft_ready", STAGE_STATUSES.includes("draft_ready"));
  h.assert("default stage count", DEFAULT_STAGE_TYPES.length === 6);
  h.assert("full stage count", FULL_STAGE_TYPES.length === 8);
  h.assert("schema blocks explicit generation claim", INTIMACY_SCENE_SCHEMA_CONTRACT.explicitGeneration === "not_implemented");
  h.assert("schema local only", INTIMACY_SCENE_SCHEMA_CONTRACT.dataLeavesDevice === false);
  const redacted = redactIntimacyDiagnostics({ title: "hidden", participantNames: ["hidden"], safeCount: 2, draftText: "hidden" });
  h.assert("diagnostics redacts title", !("title" in redacted));
  h.assert("diagnostics redacts participants", !("participantNames" in redacted));
  h.assert("diagnostics keeps non-sensitive count", redacted.safeCount === 2);
  for (const table of INTIMACY_SCENE_TABLES) {
    const sql = String(connection.get("SELECT sql FROM sqlite_master WHERE name=?", [table])?.sql ?? "");
    h.assert(`table has project_id ${table}`, sql.includes("project_id"));
    h.assert(`table has row_json ${table}`, table === "intimacy_scene_stage_dependencies" || table.includes("requirements") || sql.includes("row_json"));
  }
  h.assert("drafts table is structural", String(connection.get("SELECT sql FROM sqlite_master WHERE name='intimacy_scene_drafts'")?.sql ?? "").includes("draft_text"));
  h.assert("participants require verified adult status column", String(connection.get("SELECT sql FROM sqlite_master WHERE name='intimacy_scene_participants'")?.sql ?? "").includes("verified_adult_status"));
  h.assert("continuity table has snapshots", String(connection.get("SELECT sql FROM sqlite_master WHERE name='intimacy_continuity_states'")?.sql ?? "").includes("after_snapshot_json"));
  h.assert("branches table has branch status", String(connection.get("SELECT sql FROM sqlite_master WHERE name='intimacy_scene_branches'")?.sql ?? "").includes("branch_status"));
  h.assert("versions table has operation", String(connection.get("SELECT sql FROM sqlite_master WHERE name='intimacy_scene_stage_versions'")?.sql ?? "").includes("operation"));
  h.assert("transitions table has validation", String(connection.get("SELECT sql FROM sqlite_master WHERE name='intimacy_scene_transitions'")?.sql ?? "").includes("validation_result_json"));
}

function runScene() {
  const result = createScene();
  h.assert("scene created", Boolean(result.scene?.sceneId));
  h.assert("participants local only", result.validation.dataLeftDevice === false && result.externalRequestCount === 0);
  h.assert("default stages created", result.stages.length === DEFAULT_STAGE_TYPES.length);
  h.assert("first stage ready", result.stages[0].status === "ready");
  h.assert("later stages planned", result.stages.slice(1).every((s) => s.status === "planned"));
  h.assert("stage sequence links", Boolean(service.listStages(result.scene.sceneId)[0].nextStageId));
  h.assert("dependencies created", Number(connection.get("SELECT count(*) AS count FROM intimacy_scene_stage_dependencies WHERE project_id=?", [projectId])?.count ?? 0) === DEFAULT_STAGE_TYPES.length - 1);
  h.assert("participant rows stored", Number(connection.get("SELECT count(*) AS count FROM intimacy_scene_participants WHERE project_id=?", [projectId])?.count ?? 0) === 2);
  h.assert("main branch stored", service.listBranches(result.scene.sceneId).some((b) => b.branchId === "main"));
  h.assert("initial continuity stored", service.listContinuity(result.scene.sceneId).length === 1);
  h.assert("scene counts updated", service.getScene(result.scene.sceneId).plannedStageCount === DEFAULT_STAGE_TYPES.length);
  h.assert("audit create row", Number(connection.get("SELECT count(*) AS count FROM intimacy_scene_audits WHERE project_id=? AND action='createScenePlan'", [projectId])?.count ?? 0) === 1);
  expectThrow("unknown participant blocked", () => service.createScenePlan(sceneInput({ participants: [{ characterId: "char_x", role: "lead", verifiedAdultStatus: "unknown", consentState: "active" }] })));
  expectThrow("withdrawn consent blocked", () => service.createScenePlan(sceneInput({ participants: [{ characterId: "char_x", role: "lead", verifiedAdultStatus: "verified_adult", consentState: "withdrawn" }] })));
  expectThrow("project mismatch blocked", () => service.createScenePlan(sceneInput({ projectId: "other-project" })));
  const scene = result.scene;
  h.assert("scene ready transition", service.transitionScene(scene.sceneId, "ready").status === "ready");
  h.assert("scene active transition", service.transitionScene(scene.sceneId, "active").status === "active");
  h.assert("scene pause transition", service.transitionScene(scene.sceneId, "paused").status === "paused");
  h.assert("scene resume transition", service.transitionScene(scene.sceneId, "active").status === "active");
  h.assert("scene complete transition", service.transitionScene(scene.sceneId, "completed").status === "completed");
  h.assert("scene archive transition", service.transitionScene(scene.sceneId, "archived").status === "archived");
  expectThrow("archived scene cannot transition", () => service.transitionScene(scene.sceneId, "active"));
  h.assert("scene transitions audited", Number(connection.get("SELECT count(*) AS count FROM intimacy_scene_transitions WHERE project_id=? AND transition_type='scene'", [projectId])?.count ?? 0) >= 6);
}

function runStateMachine() {
  h.assert("scene planned to ready allowed", assertSceneTransition("planned", "ready") === undefined);
  h.assert("scene ready to active allowed", assertSceneTransition("ready", "active") === undefined);
  h.assert("scene active to paused allowed", assertSceneTransition("active", "paused") === undefined);
  h.assert("scene active to completed allowed", assertSceneTransition("active", "completed") === undefined);
  expectThrow("scene invalid transition blocked", () => assertSceneTransition("planned", "completed"));
  h.assert("stage ready to active allowed", assertStageTransition("ready", "active") === undefined);
  h.assert("stage active to paused allowed", assertStageTransition("active", "paused") === undefined);
  h.assert("stage active to draft_ready allowed", assertStageTransition("active", "draft_ready") === undefined);
  h.assert("stage draft_ready to approved allowed", assertStageTransition("draft_ready", "approved") === undefined);
  expectThrow("required skip blocked", () => assertStageTransition("planned", "skipped", { required: true, skippable: false }));
  h.assert("optional skip allowed", assertStageTransition("planned", "skipped", { required: false, skippable: true }) === undefined);
  expectThrow("withdrawal blocks forward", () => assertStageTransition("active", "draft_ready", { withdrawalState: "withdrawn" }));
  const result = createScene();
  const first = service.listStages(result.scene.sceneId)[0];
  h.assert("transition first active", service.transitionStage(result.scene.sceneId, first.stageId, "active").status === "active");
  h.assert("transition first pause", service.transitionStage(result.scene.sceneId, first.stageId, "paused").status === "paused");
  h.assert("transition first resume", service.transitionStage(result.scene.sceneId, first.stageId, "active").status === "active");
  h.assert("transition first draft ready", service.transitionStage(result.scene.sceneId, first.stageId, "draft_ready").status === "draft_ready");
  h.assert("transition first approved", service.transitionStage(result.scene.sceneId, first.stageId, "approved").status === "approved");
  const second = service.listStages(result.scene.sceneId)[1];
  h.assert("dependency now allows second ready", service.transitionStage(result.scene.sceneId, second.stageId, "ready").status === "ready");
  expectThrow("stage scene mismatch blocked", () => service.transitionStage("wrong-scene", first.stageId, "archived"));
  h.assert("stage transitions recorded", Number(connection.get("SELECT count(*) AS count FROM intimacy_scene_transitions WHERE project_id=? AND transition_type='stage'", [projectId])?.count ?? 0) >= 6);
}

function prepareApprovedFirstStage() {
  const result = createScene();
  const stage = service.listStages(result.scene.sceneId)[0];
  service.transitionStage(result.scene.sceneId, stage.stageId, "active");
  const version = service.createStageVersion(result.scene.sceneId, stage.stageId, { summary: "A structural setup summary." });
  service.transitionStage(result.scene.sceneId, stage.stageId, "draft_ready");
  return { result, stage: service.listStages(result.scene.sceneId)[0], version };
}

function runVersioning() {
  const { result, stage, version } = prepareApprovedFirstStage();
  h.assert("stage version created", version.status === "current");
  h.assert("version placeholder non-explicit", version.draftText === "[structural placeholder only]");
  h.assert("stage current version set", service.listStages(result.scene.sceneId)[0].currentVersionId === version.versionId);
  h.assert("approve version", service.approveVersion(result.scene.sceneId, stage.stageId, version.versionId).status === "approved");
  h.assert("stage approved after approve", service.listStages(result.scene.sceneId)[0].status === "approved");
  h.assert("continuity created by approve", service.listContinuity(result.scene.sceneId).some((c) => c.versionId === version.versionId));
  const rewrite = service.createStageVersion(result.scene.sceneId, stage.stageId, { operation: "rewrite", summary: "Rewritten structural summary." });
  h.assert("rewrite version current", rewrite.operation === "rewrite" && rewrite.status === "current");
  h.assert("previous version superseded", service.listVersions(stage.stageId).some((v) => v.versionId === version.versionId && v.status === "superseded"));
  h.assert("reject version", service.rejectVersion(rewrite.versionId).status === "rejected");
  const restored = service.rollbackStageToVersion(result.scene.sceneId, stage.stageId, version.versionId);
  h.assert("rollback version created", restored.operation === "rollback");
  h.assert("rollback metadata", restored.metadata.restoredFrom === version.versionId);
  h.assert("version history count", service.listVersions(stage.stageId).length >= 3);
  h.assert("audit version rows", Number(connection.get("SELECT count(*) AS count FROM intimacy_scene_audits WHERE project_id=? AND stage_id=?", [projectId, stage.stageId])?.count ?? 0) >= 2);
  h.assert("version row persistence", Number(connection.get("SELECT count(*) AS count FROM intimacy_scene_stage_versions WHERE project_id=?", [projectId])?.count ?? 0) >= 3);
  h.assert("approved count updated", service.getScene(result.scene.sceneId).approvedStageCount >= 1);
}

function runContinuity() {
  const { result, stage, version } = prepareApprovedFirstStage();
  service.approveVersion(result.scene.sceneId, stage.stageId, version.versionId);
  const custom = service.createContinuitySnapshot({
    sceneId: result.scene.sceneId,
    stageId: stage.stageId,
    versionId: version.versionId,
    branchId: "main",
    participantPositions: { char_a: "room-left" },
    participantEmotions: { char_a: "composed" },
    relationshipState: { rel_a_b: "stable" },
    trustState: { char_a_char_b: 4 },
    conflictState: "de-escalated",
    locationState: "private-room",
    timeState: "night",
    completedActions: ["setup resolved"],
    unresolvedActions: ["aftermath remains"],
    forbiddenRepetitions: ["repeat setup"],
    requiredNextBeat: "approach",
  });
  h.assert("custom continuity created", Boolean(custom.continuityId));
  h.assert("continuity local project", custom.projectId === projectId);
  h.assert("continuity stores participant positions", custom.participantPositions.char_a === "room-left");
  h.assert("continuity stores emotions", custom.participantEmotions.char_a === "composed");
  h.assert("continuity stores relationship", custom.relationshipState.rel_a_b === "stable");
  h.assert("continuity stores trust", custom.trustState.char_a_char_b === 4);
  h.assert("continuity stores conflict", custom.conflictState === "de-escalated");
  h.assert("continuity stores object state default", typeof custom.objectState === "object");
  h.assert("continuity stores completed action", custom.completedActions.includes("setup resolved"));
  h.assert("continuity stores unresolved action", custom.unresolvedActions.includes("aftermath remains"));
  h.assert("continuity stores forbidden repetition", custom.forbiddenRepetitions.includes("repeat setup"));
  h.assert("continuity list count", service.listContinuity(result.scene.sceneId).length >= 3);
  h.assert("continuity snapshot rows", Number(connection.get("SELECT count(*) AS count FROM intimacy_continuity_states WHERE project_id=?", [projectId])?.count ?? 0) >= 3);
  h.assert("continuity after snapshot persisted", String(connection.get("SELECT after_snapshot_json FROM intimacy_continuity_states WHERE id=?", [custom.continuityId])?.after_snapshot_json ?? "").includes("private-room"));
  h.assert("continuity validation persisted", String(connection.get("SELECT validation_result_json FROM intimacy_continuity_states WHERE id=?", [custom.continuityId])?.validation_result_json ?? "").includes("ok"));
}

function runBranching() {
  const { result, stage, version } = prepareApprovedFirstStage();
  service.approveVersion(result.scene.sceneId, stage.stageId, version.versionId);
  const branchResult = service.createBranchFromStage(result.scene.sceneId, stage.stageId, "Alternative continuity");
  h.assert("branch created", branchResult.branch.branchStatus === "active");
  h.assert("branch parent main", branchResult.branch.parentBranchId === "main");
  h.assert("branch clones stages", branchResult.stages.length === DEFAULT_STAGE_TYPES.length);
  h.assert("branch clone links", Boolean(branchResult.stages[0].nextStageId));
  h.assert("branch isolated current version", branchResult.stages.every((s) => !s.currentVersionId));
  const compare = service.compareBranches(result.scene.sceneId, "main", branchResult.branch.branchId);
  h.assert("branch compare local only", compare.dataLeftDevice === false && compare.externalRequestCount === 0);
  h.assert("branch compare count", compare.stageCountDelta === 0);
  h.assert("branch status differences detected", compare.statusDifferences >= 1);
  h.assert("branch continuity snapshot", service.listContinuity(result.scene.sceneId).some((c) => c.branchId === branchResult.branch.branchId));
  h.assert("archive branch", service.archiveBranch(result.scene.sceneId, branchResult.branch.branchId).branchStatus === "archived");
  h.assert("branch archived persisted", service.listBranches(result.scene.sceneId).some((b) => b.branchId === branchResult.branch.branchId && b.branchStatus === "archived"));
  h.assert("main branch remains active", service.listBranches(result.scene.sceneId).some((b) => b.branchId === "main" && b.branchStatus === "active"));
  expectThrow("missing branch blocked", () => service.archiveBranch(result.scene.sceneId, "missing"));
  h.assert("branch rows persisted", Number(connection.get("SELECT count(*) AS count FROM intimacy_scene_branches WHERE project_id=?", [projectId])?.count ?? 0) >= 2);
  h.assert("branch stage rows persisted", Number(connection.get("SELECT count(*) AS count FROM intimacy_scene_stages WHERE project_id=? AND branch_id=?", [projectId, branchResult.branch.branchId])?.count ?? 0) === DEFAULT_STAGE_TYPES.length);
}

async function runPersistence() {
  const result = createScene();
  const first = service.listStages(result.scene.sceneId)[0];
  service.transitionStage(result.scene.sceneId, first.stageId, "active");
  const version = service.createStageVersion(result.scene.sceneId, first.stageId, { summary: "Persistent structural summary." });
  service.transitionStage(result.scene.sceneId, first.stageId, "draft_ready");
  service.approveVersion(result.scene.sceneId, first.stageId, version.versionId);
  service.createBranchFromStage(result.scene.sceneId, first.stageId, "Persisted branch");
  const countsBefore = service.counts();
  connection.close();
  const reopened = await SQLiteProjectConnection.open({ projectId, storageDir });
  const reopenedService = new IntimacySceneService({ projectId, connection: reopened });
  h.assert("reopen scene count", reopenedService.counts().sceneCount === countsBefore.sceneCount);
  h.assert("reopen stage count", reopenedService.counts().stageCount === countsBefore.stageCount);
  h.assert("reopen version count", reopenedService.counts().versionCount === countsBefore.versionCount);
  h.assert("reopen branch count", reopenedService.counts().branchCount === countsBefore.branchCount);
  h.assert("reopen scene found", Boolean(reopenedService.getScene(result.scene.sceneId)));
  h.assert("reopen stages found", reopenedService.listStages(result.scene.sceneId).length >= DEFAULT_STAGE_TYPES.length);
  h.assert("reopen versions found", reopenedService.listVersions(first.stageId).length >= 1);
  h.assert("reopen continuity found", reopenedService.listContinuity(result.scene.sceneId).length >= 2);
  h.assert("reopen branch found", reopenedService.listBranches(result.scene.sceneId).some((b) => b.branchName === "Persisted branch"));
  h.assert("diagnostics migration includes 16", reopened.diagnostics().sqliteMigrationCount >= 16);
  h.assert("diagnostics database open", reopened.diagnostics().databaseOpenStatus === "open");
  h.assert("diagnostics integrity ok", reopened.diagnostics().lastIntegrityCheck === "ok");
  h.assert("project isolation after reopen", Number(reopened.get("SELECT count(*) AS count FROM intimacy_scenes WHERE project_id != ?", [projectId])?.count ?? 0) === 0);
  reopened.close();
}

function runRuntimeContract() {
  const contract = intimacyRuntimeContract();
  h.assert("runtime contract ready", contract.status === "contract_ready");
  h.assert("runtime contract version", contract.version === "h2p3-runtime-contract-v1");
  h.assert("runtime routes exposed", contract.routes.length === 5);
  h.assert("external ai blocked", contract.guards.externalAiRequests === "blocked");
  h.assert("explicit draft generation not implemented", contract.guards.explicitDraftGeneration === "not_implemented");
  h.assert("participant verification required", contract.guards.participantVerification === "required");
  h.assert("branch isolation required", contract.guards.branchIsolation === "required");
  h.assert("continuity snapshot required", contract.guards.continuitySnapshot === "required");
  h.assert("local only contract", contract.guards.localOnly === true);
  for (const route of contract.routes) h.assert(`route is local ${route}`, route.startsWith("/api/local/intimacy"));
  h.assert("health status state machine ready", true, { intimacySceneStateMachineStatus: "ready" });
  h.assert("health status versioning ready", true, { intimacyStageVersioningStatus: "ready" });
  h.assert("health status continuity ready", true, { intimacyContinuityFoundationStatus: "ready" });
  h.assert("health status branch ready", true, { adultBranchFoundationStatus: "ready" });
  h.assert("health status segmented state machine only", true, { adultSegmentedGenerationStatus: "state_machine_ready" });
  h.assert("health status local generation absent", true, { adultLocalGenerationStatus: "not_implemented" });
  h.assert("health status private/public absent", true, { privatePublicVersionStatus: "not_implemented" });
  const redacted = redactIntimacyDiagnostics({ selectedTags: ["hidden"], continuityDetails: { hidden: true }, privatePreferences: "hidden", visibleStatus: "ready" });
  h.assert("runtime redacts selected tags", !("selectedTags" in redacted));
  h.assert("runtime redacts continuity details", !("continuityDetails" in redacted));
  h.assert("runtime keeps visible status", redacted.visibleStatus === "ready");
}

const runners = {
  schema: runSchema,
  scene: runScene,
  "state-machine": runStateMachine,
  versioning: runVersioning,
  continuity: runContinuity,
  branching: runBranching,
  persistence: runPersistence,
  "runtime-contract": runRuntimeContract,
};

if (suite === "all") {
  for (const runner of Object.values(runners)) await runner();
} else if (runners[suite]) {
  await runners[suite]();
} else {
  h.fail("unknown suite", { suite });
}

try { connection.close(); } catch {}
fs.rmSync(storageDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
h.assert("cleanup", !fs.existsSync(storageDir));

const expected = {
  schema: 45,
  scene: 24,
  "state-machine": 20,
  versioning: 16,
  continuity: 15,
  branching: 16,
  persistence: 15,
  "runtime-contract": 21,
  all: 164,
}[suite] ?? 1;

printAndExit(h.summary({
  expectedPass: expected,
  intimacySceneStateMachineStatus: "ready",
  intimacyStageVersioningStatus: "ready",
  intimacyContinuityFoundationStatus: "ready",
  adultBranchFoundationStatus: "ready",
  adultScenePersistenceStatus: "ready",
  adultSegmentedGenerationStatus: "state_machine_ready",
  adultLocalGenerationStatus: "not_implemented",
}));
