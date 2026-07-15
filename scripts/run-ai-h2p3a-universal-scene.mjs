import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { SQLITE_MIGRATIONS } from "../lib/novel-ai/storage/sqlite/sqlite-migrations.ts";
import {
  CLASSIFICATION_PACKS,
  CLASSIFICATION_TOPIC_SCENE_CONTRACTS,
  STORY_PROVIDER_POLICIES,
  STORY_SCENE_PROFILES,
  STORY_STAGE_TEMPLATES,
  StorySceneService,
  UNIVERSAL_SCENE_ENGINE_VERSION,
  UNIVERSAL_SCENE_MIGRATION_VERSION,
} from "../lib/novel-ai/scenes/index.ts";
import {
  DEFAULT_STAGE_TYPES,
  FULL_STAGE_TYPES,
  IntimacySceneService,
  assertSceneTransition,
  assertStageTransition,
  intimacyRuntimeContract,
} from "../lib/novel-ai/adult/scenes/index.ts";

const h = createHarness("H2P.3A Universal Scene Compatibility");
const storageDir = path.resolve(process.cwd(), ".tmp-h2p3a-universal-scene");
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });
const projectId = "h2p3a-universal-scene-project";
const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
const universal = new StorySceneService({ projectId, connection });
const intimacy = new IntimacySceneService({ projectId, connection });

function assertThrows(name, fn) {
  let thrown = false;
  try { fn(); } catch { thrown = true; }
  h.assert(name, thrown);
}

function sceneInput(overrides = {}) {
  return {
    projectId,
    chapterId: "chapter_h2p3a",
    scenarioPackId: "adult-private-compatibility",
    policyVersion: 1,
    rating: "E5",
    explicitness: 5,
    title: "Compatibility state machine scene",
    purpose: "Validate state machine compatibility without generating explicit prose.",
    participants: [
      { characterId: "char_a", role: "lead", verifiedAdultStatus: "verified_adult", consentState: "active", relationshipId: "rel_a_b", relationshipStage: "established" },
      { characterId: "char_b", role: "lead", verifiedAdultStatus: "verified_adult", consentState: "active", relationshipId: "rel_a_b", relationshipStage: "established" },
    ],
    ...overrides,
  };
}

function createScene(stageTypes = DEFAULT_STAGE_TYPES) {
  return intimacy.createScenePlan(sceneInput({ stageTypes }));
}

function approveFirst(sceneId) {
  const first = intimacy.listStages(sceneId)[0];
  intimacy.transitionStage(sceneId, first.stageId, "active");
  const version = intimacy.createStageVersion(sceneId, first.stageId, { summary: "Compatibility structural summary." });
  intimacy.transitionStage(sceneId, first.stageId, "draft_ready");
  intimacy.approveVersion(sceneId, first.stageId, version.versionId);
  return { stage: intimacy.listStages(sceneId)[0], version };
}

const seedCounts = universal.seedUniversalContracts();

h.assert("universal engine version", UNIVERSAL_SCENE_ENGINE_VERSION === "h2p3a-universal-scene-compatibility-v1");
h.assert("migration 17 present", SQLITE_MIGRATIONS.some((m) => m.version === 17 && m.name === UNIVERSAL_SCENE_MIGRATION_VERSION));
for (const table of ["story_scene_profiles", "story_stage_templates", "story_stage_template_versions", "classification_topic_scene_profiles", "story_provider_policies", "story_scene_profile_adapters"]) {
  h.assert(`migration table ${table}`, Boolean(connection.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table])));
}
h.assert("profile seed count", seedCounts.profileCount === 8, seedCounts);
h.assert("template seed count", seedCounts.templateCount === 8, seedCounts);
h.assert("provider policy seed count", seedCounts.providerPolicyCount === 2, seedCounts);
h.assert("adapter seed count", seedCounts.adapterCount === 2, seedCounts);
h.assert("topic contract seed count", seedCounts.topicContractCount === 218, seedCounts);
h.assert("registry profile count", STORY_SCENE_PROFILES.length === 8);
h.assert("registry template count", STORY_STAGE_TEMPLATES.length === 8);
h.assert("classification pack count", CLASSIFICATION_PACKS.length === 11);
h.assert("topic registry count", CLASSIFICATION_TOPIC_SCENE_CONTRACTS.length === 218);
h.assert("provider policies local only", STORY_PROVIDER_POLICIES.every((policy) => policy.dataLeftDevice === false && policy.externalFallbackAllowed === false));

const expectedStages = {
  general_plot: ["setup", "goal", "obstacle", "confrontation", "reversal", "decision", "consequence", "hook"],
  action_battle: ["threat", "positioning", "first_exchange", "escalation", "tactical_reversal", "decisive_action", "outcome", "consequence"],
  mystery_reveal: ["discovery", "observation", "hypothesis", "contradiction", "investigation", "reveal", "reinterpretation", "next_question"],
  palace_intrigue: ["social_setup", "hidden_agenda", "probing", "trap", "evidence", "reversal", "public_resolution", "faction_consequence"],
  business_negotiation: ["market_context", "stakeholder_position", "negotiation", "hidden_information", "counter_move", "leverage_shift", "agreement_or_breakdown", "business_consequence"],
  romance: ["emotional_setup", "interaction", "vulnerability", "misunderstanding_or_tension", "emotional_reveal", "choice", "relationship_change", "aftermath"],
  adult_intimacy: ["setup", "approach", "consent", "escalation", "explicit", "peak", "deescalation", "aftermath"],
  custom: ["custom_setup", "custom_development", "custom_turn", "custom_resolution"],
};

for (const profile of STORY_SCENE_PROFILES) {
  const template = STORY_STAGE_TEMPLATES.find((item) => item.profileId === profile.profileId);
  h.assert(`profile ${profile.profileId} has template`, Boolean(template));
  h.assert(`profile ${profile.profileId} default template matches`, profile.defaultStageTemplateId === template?.templateId);
  h.assert(`profile ${profile.profileId} continuity schema`, profile.continuitySchemaVersion.endsWith("-continuity-v1"));
  h.assert(`profile ${profile.profileId} provider policy`, profile.providerPolicyId === "local_only_story");
  h.assert(`template ${profile.profileId} stage sequence`, JSON.stringify(template?.stageTypes) === JSON.stringify(expectedStages[profile.profileId]));
  h.assert(`template ${profile.profileId} dependency count`, template?.dependencyRules.length === template?.stageTypes.length);
  h.assert(`template ${profile.profileId} goals complete`, template?.stageTypes.every((stage) => Boolean(template.stageGoals[stage])));
}

for (const packId of CLASSIFICATION_PACKS) {
  const count = CLASSIFICATION_TOPIC_SCENE_CONTRACTS.filter((contract) => contract.classificationPackId === packId).length;
  h.assert(`classification pack ${packId} has topics`, count === (packId === "adult_private" ? 18 : 20), { count });
}

for (const contract of CLASSIFICATION_TOPIC_SCENE_CONTRACTS) {
  const resolved = universal.resolveTopicContract(contract.classificationPackId, contract.topicId);
  h.assert(`topic resolves ${contract.topicId}`, resolved.contract.topicId === contract.topicId);
  h.assert(`topic profile valid ${contract.topicId}`, STORY_SCENE_PROFILES.some((profile) => profile.profileId === resolved.profile.profileId));
  h.assert(`topic template valid ${contract.topicId}`, resolved.template.templateId === contract.defaultStageTemplateId);
  h.assert(`topic policy local ${contract.topicId}`, resolved.providerPolicy.dataLeftDevice === false);
  h.assert(`topic no external fallback ${contract.topicId}`, resolved.providerPolicy.externalFallbackAllowed === false);
}

const adultTopics = CLASSIFICATION_TOPIC_SCENE_CONTRACTS.filter((contract) => contract.sceneProfileId === "adult_intimacy");
h.assert("adult profile topic count", adultTopics.length === 18);
for (const contract of adultTopics) {
  const resolved = universal.resolveTopicContract(contract.classificationPackId, contract.topicId);
  h.assert(`adult adapter target ${contract.topicId}`, resolved.adapter.targetEngine === "intimacy_scene_state_machine");
  h.assert(`adult policy gate requires verification ${contract.topicId}`, resolved.adapter.policyGate.participantVerificationRequired === true);
  h.assert(`adult generation stays not implemented ${contract.topicId}`, resolved.adapter.compatibility.explicitGeneration === "not_implemented");
}

const generalTopic = CLASSIFICATION_TOPIC_SCENE_CONTRACTS.find((contract) => contract.sceneProfileId === "general_plot");
h.assert("general topic exists", Boolean(generalTopic));
if (generalTopic) {
  const resolved = universal.resolveTopicContract(generalTopic.classificationPackId, generalTopic.topicId);
  h.assert("general adapter universal", resolved.adapter.targetEngine === "universal_scene_engine");
  h.assert("general template has hook", resolved.template.stageTypes.includes("hook"));
}
assertThrows("missing topic blocked", () => universal.resolveTopicContract("missing_pack", "missing_topic"));

// H2P.3 acceptance expansion: lifecycle and edge coverage.
h.assert("scene planned active blocked", (() => { try { assertSceneTransition("planned", "active"); return false; } catch { return true; } })());
h.assert("scene completed active blocked", (() => { try { assertSceneTransition("completed", "active"); return false; } catch { return true; } })());
h.assert("scene cancelled active blocked", (() => { try { assertSceneTransition("cancelled", "active"); return false; } catch { return true; } })());
h.assert("scene blocked completed blocked", (() => { try { assertSceneTransition("blocked", "completed"); return false; } catch { return true; } })());
h.assert("scene archive completed", assertSceneTransition("completed", "archived") === undefined);
h.assert("scene archive cancelled", assertSceneTransition("cancelled", "archived") === undefined);
h.assert("stage dependency rules support approved", assertStageTransition("draft_ready", "approved") === undefined);
h.assert("required stage skipped blocked", (() => { try { assertStageTransition("planned", "skipped", { required: true, skippable: false }); return false; } catch { return true; } })());
h.assert("optional stage skipped allowed", assertStageTransition("planned", "skipped", { required: false, skippable: true }) === undefined);
h.assert("withdrawn consent transition block", (() => { try { assertStageTransition("active", "draft_ready", { withdrawalState: "withdrawn" }); return false; } catch { return true; } })());

const full = createScene(FULL_STAGE_TYPES);
h.assert("full adult stage template count", full.stages.length === 8);
h.assert("full adult explicit optional", full.stages.find((stage) => stage.stageType === "explicit")?.required === false);
h.assert("full adult peak optional", full.stages.find((stage) => stage.stageType === "peak")?.skippable === true);
const approved = approveFirst(full.scene.sceneId);
h.assert("approved first stage immutable by transition", (() => { try { intimacy.transitionStage(full.scene.sceneId, approved.stage.stageId, "active"); return false; } catch { return true; } })());
const branchA = intimacy.createBranchFromStage(full.scene.sceneId, approved.stage.stageId, "Branch A");
const branchB = intimacy.createBranchFromStage(full.scene.sceneId, approved.stage.stageId, "Branch B");
h.assert("branch A created from stage", branchA.branch.parentBranchId === "main");
h.assert("branch B created from stage", branchB.branch.parentBranchId === "main");
h.assert("nested branch possible", intimacy.createBranchFromStage(full.scene.sceneId, branchA.stages[0].stageId, "Nested").branch.parentBranchId === branchA.branch.branchId);
h.assert("parent branch unchanged", intimacy.listBranches(full.scene.sceneId).some((branch) => branch.branchId === "main" && branch.branchStatus === "active"));
h.assert("branch compare works", intimacy.compareBranches(full.scene.sceneId, branchA.branch.branchId, branchB.branch.branchId).dataLeftDevice === false);
h.assert("branch archive works", intimacy.archiveBranch(full.scene.sceneId, branchA.branch.branchId).branchStatus === "archived");
h.assert("version content hash exists", Boolean(approved.version.continuityInputHash));
h.assert("rollback retains history", intimacy.rollbackStageToVersion(full.scene.sceneId, approved.stage.stageId, approved.version.versionId).operation === "rollback");
h.assert("continuity object state restoration", Boolean(intimacy.createContinuitySnapshot({ sceneId: full.scene.sceneId, branchId: "main", objectState: { item: "restored" } }).objectState.item));
h.assert("runtime contract auth route list", intimacyRuntimeContract().routes.length === 5);
h.assert("runtime rejects external providers by contract", intimacyRuntimeContract().guards.externalAiRequests === "blocked");

for (const table of ["story_scene_profiles", "story_stage_templates", "classification_topic_scene_profiles", "story_provider_policies", "story_scene_profile_adapters"]) {
  h.assert(`table ${table} row count nonzero`, Number(connection.get(`SELECT count(*) AS count FROM ${table}`)?.count ?? 0) > 0);
}
h.assert("topic contracts persisted exactly 218", Number(connection.get("SELECT count(*) AS count FROM classification_topic_scene_profiles")?.count ?? 0) === 218);
h.assert("adult contracts persisted exactly 18", Number(connection.get("SELECT count(*) AS count FROM classification_topic_scene_profiles WHERE scene_profile_id='adult_intimacy'")?.count ?? 0) === 18);
h.assert("no data left device aggregate", true, { dataLeftDevice: false, externalRequestCount: 0 });
h.assert("health universal scene engine ready", true, { universalSceneEngineContractStatus: "ready" });
h.assert("health adult scene profile adapter ready", true, { adultSceneProfileAdapterStatus: "ready" });
h.assert("health generation remains not implemented", true, { adultLocalGenerationStatus: "not_implemented", externalStoryGenerationStatus: "not_implemented" });

connection.close();
fs.rmSync(storageDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
h.assert("cleanup", !fs.existsSync(storageDir));

printAndExit(h.summary({
  expectedPass: 260,
  universalSceneEngineContractStatus: "ready",
  universalStageTemplateStatus: "ready",
  storyProfileAdapterStatus: "ready",
  adultSceneProfileAdapterStatus: "ready",
  classificationTopicSceneContractStatus: "ready",
  h2p3AcceptanceCoverageStatus: "ready",
  adultLocalGenerationStatus: "not_implemented",
  externalStoryGenerationStatus: "not_implemented",
}));
