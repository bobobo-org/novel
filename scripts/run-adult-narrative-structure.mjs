import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ADULT_NARRATIVE_ACT_IDS,
  ADULT_NARRATIVE_BLUEPRINT_JSON_SCHEMA,
  ADULT_NARRATIVE_CHANGE_DIMENSIONS,
  ADULT_NARRATIVE_ENGINE_IDS,
  ADULT_NARRATIVE_RUNTIME_CONTRACT,
  ADULT_NARRATIVE_WORLD_ADAPTER_IDS,
  AdultNarrativeStructureError,
  IntimacySceneService,
  createAdultNarrativeBlueprint,
  intimacyRuntimeContract,
  validateAdultNarrativeBlueprint,
  validateStageSequence,
} from "../lib/novel-ai/adult/scenes/index.ts";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { createAdultExperienceProfile } from "../lib/novel-data/adult-experience-profile.ts";
import { assertAdultStagePolicy, buildStoryStagePrompt } from "../lib/novel-ai/generation/stages/index.ts";

let passed = 0;

function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

function expectBlocked(name, operation, code) {
  let error;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  check(name, error instanceof AdultNarrativeStructureError && error.issues.some((issue) => issue.code === code));
}

const participants = [
  { participantId: "adult_a", ageStatus: "verified_adult", consentState: "active", consentRevocable: true },
  { participantId: "adult_b", ageStatus: "verified_adult", consentState: "active", consentRevocable: true },
];

const safetyAssertions = {
  allParticipantsVerifiedAdults: true,
  activeRevocableConsent: true,
  participantsUnrelatedByBlood: true,
  noCoercion: true,
  noHiddenRecording: true,
  noExploitativePowerExchange: true,
  noRealCatalogCopying: true,
};

function blueprintInput(overrides = {}) {
  return {
    mode: "adult_only",
    primaryEngine: "E8_world_heat",
    secondaryEngine: "E2_pretext",
    worldAdapter: "multiverse",
    parameters: {
      intensity: 3,
      consent_mode: "continuous_reconfirmation",
      ntr: false,
      climax_as_power: true,
      taboo_proximity: 0,
      aftercare: "required",
    },
    participants,
    safetyAssertions,
    narrativeGoal: "A private choice changes cross-world allegiance.",
    irreversibleEvent: "The alliance becomes visible to both worlds.",
    cost: "Both characters lose a previously neutral refuge.",
    ...overrides,
  };
}

check("exactly eight pluggable engines", ADULT_NARRATIVE_ENGINE_IDS.length === 8 && new Set(ADULT_NARRATIVE_ENGINE_IDS).size === 8);
check("mandatory five acts", ADULT_NARRATIVE_ACT_IDS.length === 5);
check("five world adapters", ADULT_NARRATIVE_WORLD_ADAPTER_IDS.join(",") === "xianxia,ancient_court,modern,scifi,multiverse");
check("five tracked change dimensions", ADULT_NARRATIVE_CHANGE_DIMENSIONS.length === 5);

const stageFixture = (stageType, ordinal, overrides = {}) => ({
  stageId: `stage_${stageType}_${ordinal}`,
  sceneId: "scene_stage_sequence",
  projectId: "project_stage_sequence",
  branchId: "main",
  stageType,
  ordinal,
  title: stageType,
  goal: `Validate ${stageType}`,
  targetLength: 100,
  status: ordinal === 1 ? "ready" : "planned",
  required: true,
  skippable: false,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
  version: 1,
  ...overrides,
});

const missingConsentSequence = validateStageSequence([
  stageFixture("setup", 1),
  stageFixture("escalation", 2),
]);
check(
  "escalation cannot exist without an explicit consent stage",
  !missingConsentSequence.ok && missingConsentSequence.issues.some((issue) => issue.code === "INTIMACY_STAGE_CONSENT_REQUIRED"),
);

const skippableConsentSequence = validateStageSequence([
  stageFixture("consent", 1, { required: false, skippable: true }),
  stageFixture("escalation", 2),
]);
check(
  "consent stage must be required and unskippable",
  !skippableConsentSequence.ok && skippableConsentSequence.issues.some((issue) => issue.code === "INTIMACY_STAGE_CONSENT_MUST_BE_REQUIRED"),
);

const orderedConsentSequence = validateStageSequence([
  stageFixture("consent", 1),
  stageFixture("escalation", 2),
]);
check("required consent before escalation passes", orderedConsentSequence.ok);

const blueprint = createAdultNarrativeBlueprint(blueprintInput());
check("one primary and maximum one secondary", blueprint.engineComposition.primary === "E8_world_heat" && blueprint.engineComposition.secondary === "E2_pretext" && blueprint.engineComposition.maximumSecondaryCount === 1);
check("all requested parameters survive structural planning", blueprint.parameters.intensity === 3 && blueprint.parameters.consent_mode === "continuous_reconfirmation" && blueprint.parameters.ntr === false && blueprint.parameters.climax_as_power === true && blueprint.parameters.taboo_proximity === 0 && blueprint.parameters.aftercare === "required");
check("climax-as-power produces a tracked power change", blueprint.escalationLadder.at(-1)?.stateChanges.some((change) => change.dimension === "power"));
check("all five acts remain ordered", blueprint.acts.map((act) => act.actId).join(",") === ADULT_NARRATIVE_ACT_IDS.join(","));
check("all escalation steps reconfirm consent", blueprint.escalationLadder.every((step) => step.consentCheckpoint));
check("all escalation steps materially change state", blueprint.escalationLadder.every((step) => step.stateChanges.length > 0 && step.stateChanges.every((change) => change.before !== change.after && Boolean(change.cost))));
check("irreversible event and cost retained", blueprint.irreversibility.rule === "event_must_become_irreversible" && Boolean(blueprint.irreversibility.event) && Boolean(blueprint.irreversibility.cost));
check("structural JSON never claims copied source", blueprint.outputKind === "structural_json" && blueprint.safety.sourceUse === "abstract_taxonomy_axes_only");
check("output schema identifies strict engine count", ADULT_NARRATIVE_BLUEPRINT_JSON_SCHEMA.properties.engineComposition.properties.maximumSecondaryCount.const === 1);
check("output schema pins five ordered acts", ADULT_NARRATIVE_BLUEPRINT_JSON_SCHEMA.properties.acts.prefixItems.map((item) => item.properties.actId.const).join(",") === ADULT_NARRATIVE_ACT_IDS.join(","));
check("output schema pins escalation order", ADULT_NARRATIVE_BLUEPRINT_JSON_SCHEMA.properties.escalationLadder.prefixItems.map((item) => item.properties.stepId.const).join(",") === "first_fault,line_break,ladder_rung_1,ladder_rung_2,ladder_rung_3");
check("output schema declares engine parameter dependencies", ADULT_NARRATIVE_BLUEPRINT_JSON_SCHEMA.allOf.length === 2);

const brokenEscalation = structuredClone(blueprint);
brokenEscalation.escalationLadder[0].stateChanges = [];
check("escalation without state change rejected", validateAdultNarrativeBlueprint(brokenEscalation).issues.some((issue) => issue.code === "ESCALATION_WITHOUT_STATE_CHANGE"));
const relaxedSafety = structuredClone(blueprint);
relaxedSafety.safety.verifiedAdultsOnly = false;
check("serialized blueprint cannot relax adult safety", validateAdultNarrativeBlueprint(relaxedSafety).issues.some((issue) => issue.code === "SAFETY_CONTRACT_INVALID"));
const missingSafetyBlock = structuredClone(blueprint);
missingSafetyBlock.safety.blockedContent = missingSafetyBlock.safety.blockedContent.slice(1);
check("serialized blueprint cannot omit red lines", validateAdultNarrativeBlueprint(missingSafetyBlock).issues.some((issue) => issue.code === "SAFETY_BLOCK_MISSING"));
const wrongVersion = structuredClone(blueprint);
wrongVersion.version = "legacy";
check("serialized blueprint rejects wrong version", validateAdultNarrativeBlueprint(wrongVersion).issues.some((issue) => issue.code === "BLUEPRINT_VERSION_INVALID"));
const reorderedLadder = structuredClone(blueprint);
[reorderedLadder.escalationLadder[0], reorderedLadder.escalationLadder[1]] = [reorderedLadder.escalationLadder[1], reorderedLadder.escalationLadder[0]];
check("serialized blueprint rejects reordered ladder", validateAdultNarrativeBlueprint(reorderedLadder).issues.some((issue) => issue.code === "ESCALATION_ORDER_INVALID"));
const invalidDependency = structuredClone(blueprint);
invalidDependency.parameters.ntr = true;
check("serialized blueprint rechecks engine dependencies", validateAdultNarrativeBlueprint(invalidDependency).issues.some((issue) => issue.code === "NTR_ENGINE_REQUIRED"));

expectBlocked("duplicate engine rejected", () => createAdultNarrativeBlueprint(blueprintInput({ secondaryEngine: "E8_world_heat" })), "ENGINE_DUPLICATE");
expectBlocked("multiple secondary engines rejected", () => createAdultNarrativeBlueprint(blueprintInput({ secondaryEngine: ["E1_proximity", "E2_pretext"] })), "SECONDARY_ENGINE_LIMIT");
expectBlocked("intensity above five rejected", () => createAdultNarrativeBlueprint(blueprintInput({ parameters: { ...blueprintInput().parameters, intensity: 6 } })), "INTENSITY_OUT_OF_RANGE");
expectBlocked("taboo proximity above five rejected", () => createAdultNarrativeBlueprint(blueprintInput({ parameters: { ...blueprintInput().parameters, taboo_proximity: 6 } })), "TABOO_PROXIMITY_OUT_OF_RANGE");
expectBlocked("taboo proximity requires its safe engine", () => createAdultNarrativeBlueprint(blueprintInput({ parameters: { ...blueprintInput().parameters, taboo_proximity: 2 } })), "TABOO_ENGINE_REQUIRED");
expectBlocked("invalid consent mode rejected", () => createAdultNarrativeBlueprint(blueprintInput({ parameters: { ...blueprintInput().parameters, consent_mode: "implicit" } })), "CONSENT_MODE_INVALID");
expectBlocked("missing aftercare treatment rejected", () => createAdultNarrativeBlueprint(blueprintInput({ parameters: { ...blueprintInput().parameters, aftercare: "none" } })), "AFTERCARE_INVALID");
expectBlocked("ntr must be boolean", () => createAdultNarrativeBlueprint(blueprintInput({ parameters: { ...blueprintInput().parameters, ntr: "yes" } })), "NTR_PARAMETER_INVALID");
expectBlocked("climax-as-power must be boolean", () => createAdultNarrativeBlueprint(blueprintInput({ parameters: { ...blueprintInput().parameters, climax_as_power: "yes" } })), "CLIMAX_AS_POWER_INVALID");
expectBlocked("unknown age rejected", () => createAdultNarrativeBlueprint(blueprintInput({ participants: [{ ...participants[0], ageStatus: "unknown" }, participants[1]] })), "VERIFIED_ADULT_REQUIRED");
expectBlocked("minor rejected", () => createAdultNarrativeBlueprint(blueprintInput({ participants: [{ ...participants[0], ageStatus: "verified_minor" }, participants[1]] })), "VERIFIED_ADULT_REQUIRED");
expectBlocked("non-revocable consent rejected", () => createAdultNarrativeBlueprint(blueprintInput({ participants: [{ ...participants[0], consentRevocable: false }, participants[1]] })), "ACTIVE_REVOCABLE_CONSENT_REQUIRED");
expectBlocked("withdrawn consent rejected", () => createAdultNarrativeBlueprint(blueprintInput({ participants: [{ ...participants[0], consentState: "withdrawn" }, participants[1]] })), "ACTIVE_REVOCABLE_CONSENT_REQUIRED");
expectBlocked("blood-relation assertion fails closed", () => createAdultNarrativeBlueprint(blueprintInput({ safetyAssertions: { ...safetyAssertions, participantsUnrelatedByBlood: false } })), "SAFETY_ASSERTION_PARTICIPANTSUNRELATEDBYBLOOD");
expectBlocked("hidden-recording assertion fails closed", () => createAdultNarrativeBlueprint(blueprintInput({ safetyAssertions: { ...safetyAssertions, noHiddenRecording: false } })), "SAFETY_ASSERTION_NOHIDDENRECORDING");
expectBlocked("coercion assertion fails closed", () => createAdultNarrativeBlueprint(blueprintInput({ safetyAssertions: { ...safetyAssertions, noCoercion: false } })), "SAFETY_ASSERTION_NOCOERCION");
expectBlocked("exploitative exchange fails closed", () => createAdultNarrativeBlueprint(blueprintInput({ safetyAssertions: { ...safetyAssertions, noExploitativePowerExchange: false } })), "SAFETY_ASSERTION_NOEXPLOITATIVEPOWEREXCHANGE");
expectBlocked("real catalog copying fails closed", () => createAdultNarrativeBlueprint(blueprintInput({ safetyAssertions: { ...safetyAssertions, noRealCatalogCopying: false } })), "SAFETY_ASSERTION_NOREALCATALOGCOPYING");
expectBlocked("blocked free-text premise rejected", () => createAdultNarrativeBlueprint(blueprintInput({ narrativeGoal: "A hidden recording drives the premise." })), "HIDDEN_RECORDING");
expectBlocked("real catalog copying in free text rejected", () => createAdultNarrativeBlueprint(blueprintInput({ narrativeGoal: "Copy a real performer catalog number into the premise." })), "REAL_CATALOG_COPYING");
expectBlocked("ntr requires safe witnessed-triangle engine", () => createAdultNarrativeBlueprint(blueprintInput({ parameters: { ...blueprintInput().parameters, ntr: true } })), "NTR_ENGINE_REQUIRED");

const witnessedTriangle = createAdultNarrativeBlueprint(blueprintInput({
  primaryEngine: "E5_voyeur_ntr",
  secondaryEngine: "E6_persona_collapse",
  parameters: { ...blueprintInput().parameters, ntr: true },
}));
check("safe witnessed-triangle plan blocks clandestine observation", witnessedTriangle.safety.blockedContent.includes("hidden_recording_or_clandestine_observation"));

for (const worldAdapter of ADULT_NARRATIVE_WORLD_ADAPTER_IDS) {
  const adapted = createAdultNarrativeBlueprint(blueprintInput({ worldAdapter }));
  check(`world adapter ${worldAdapter} supplies consequence frame`, adapted.worldAdapter.id === worldAdapter && adapted.worldAdapter.consequenceVocabulary.length > 0);
}

const runtime = intimacyRuntimeContract();
check("runtime exposes narrative contract", runtime.narrativeStructure.version === ADULT_NARRATIVE_RUNTIME_CONTRACT.version);
check("runtime is adult-only", runtime.narrativeStructure.guards.generalModeActivation === "blocked");
check("runtime hard-blocks unsafe themes", runtime.narrativeStructure.guards.bloodIncestEnactment === "blocked" && runtime.narrativeStructure.guards.hiddenRecording === "blocked" && runtime.narrativeStructure.guards.glorifiedCoercion === "blocked");
check("runtime requires project adult profile and transition-time consent", runtime.narrativeStructure.guards.projectAdultModeRequired === true && runtime.guards.participantRevocableConsent === "required_each_transition");

const storageDir = path.resolve(process.cwd(), ".tmp-adult-narrative-structure");
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });
const projectId = "adult-narrative-structure-test";
const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
const service = new IntimacySceneService({ projectId, connection });
const adultExperienceProfile = { ...createAdultExperienceProfile(), fictionalAdultsConfirmed: true };

function sceneParticipants() {
  return [
    { characterId: "adult_a", role: "lead", verifiedAdultStatus: "verified_adult", consentState: "active", consentRevocable: true },
    { characterId: "adult_b", role: "counterpart", verifiedAdultStatus: "verified_adult", consentState: "active", consentRevocable: true },
  ];
}

const generalCompatible = service.createScenePlan({
  projectId,
  policyVersion: 1,
  rating: "E3",
  explicitness: 0,
  title: "Existing structural path",
  purpose: "Verify optional adult narrative rules do not alter the existing path.",
  participants: sceneParticipants(),
});
check("existing scene path remains unchanged", generalCompatible.stages.length === 6 && !generalCompatible.scene.narrativeBlueprint);

const adultNarrative = Object.fromEntries(Object.entries(blueprintInput()).filter(([key]) => key !== "participants"));
const adultStructured = service.createScenePlan({
  projectId,
  policyVersion: 1,
  rating: "E3",
  explicitness: 0,
  title: "Adult structural blueprint",
  purpose: "Verify safe structural planning without explicit prose.",
  participants: sceneParticipants(),
  adultMode: true,
  adultExperienceProfile,
  adultNarrative,
});
check("adult blueprint creates exactly five mandatory stages", adultStructured.stages.length === 5 && adultStructured.stages.map((stage) => stage.narrativeActId).join(",") === ADULT_NARRATIVE_ACT_IDS.join(","));
check("adult blueprint persisted on scene", adultStructured.scene.narrativeBlueprint?.engineComposition.primary === "E8_world_heat");
check("stage carries world and consent contract", adultStructured.stages.every((stage) => stage.worldAdapterId === "multiverse" && stage.consentCheckpoint === true));

let missingAdultProfileBlocked = false;
try {
  service.createScenePlan({
    projectId,
    policyVersion: 1,
    rating: "E3",
    explicitness: 0,
    title: "Missing adult profile",
    purpose: "This structural route must fail closed.",
    participants: sceneParticipants(),
    adultNarrative,
  });
} catch (error) {
  missingAdultProfileBlocked = error?.code === "INTIMACY_ADULT_PROFILE_REQUIRED";
}
check("adult blueprint requires project mode and confirmed profile", missingAdultProfileBlocked);

let omittedRevocabilityBlocked = false;
try {
  service.createScenePlan({
    projectId,
    policyVersion: 1,
    rating: "E3",
    explicitness: 0,
    title: "Missing revocability",
    purpose: "Consent revocability may not default open.",
    participants: sceneParticipants().map((participant) => ({
      characterId: participant.characterId,
      role: participant.role,
      verifiedAdultStatus: participant.verifiedAdultStatus,
      consentState: participant.consentState,
    })),
  });
} catch {
  omittedRevocabilityBlocked = true;
}
check("participant consent revocability cannot be omitted", omittedRevocabilityBlocked);

const safetyEvidence = { ...safetyAssertions };
function stageEvidence(stage, stateChanges = []) {
  return {
    blueprintVersion: blueprint.version,
    actId: stage.narrativeActId,
    structuralOnly: true,
    explicitText: false,
    consentCheckpoint: true,
    consentState: "active",
    withdrawalState: "none",
    safetyAssertions: safetyEvidence,
    stateChanges,
  };
}

const firstAdultStage = adultStructured.stages[0];
service.transitionStage(adultStructured.scene.sceneId, firstAdultStage.stageId, "active");
let missingEvidenceBlocked = false;
try {
  service.createStageVersion(adultStructured.scene.sceneId, firstAdultStage.stageId, { summary: "Structural setup remains voluntary and reversible." });
} catch (error) {
  missingEvidenceBlocked = error instanceof AdultNarrativeStructureError;
}
check("adult stage version cannot omit structural safety evidence", missingEvidenceBlocked);

let redLineBlocked = false;
try {
  service.createStageVersion(adultStructured.scene.sceneId, firstAdultStage.stageId, {
    summary: "A hidden recording drives the structural beat.",
    metadata: { adultNarrativeEvidence: stageEvidence(firstAdultStage) },
  });
} catch (error) {
  redLineBlocked = error instanceof AdultNarrativeStructureError && error.issues.some((issue) => issue.code === "HIDDEN_RECORDING");
}
check("adult stage version rechecks red lines", redLineBlocked);

const validVersion = service.createStageVersion(adultStructured.scene.sceneId, firstAdultStage.stageId, {
  summary: "Both adults state the premise, exits, and later cost before proceeding.",
  metadata: { adultNarrativeEvidence: stageEvidence(firstAdultStage) },
});
service.transitionStage(adultStructured.scene.sceneId, firstAdultStage.stageId, "draft_ready");

const participantRow = connection.get("SELECT id,row_json FROM intimacy_scene_participants WHERE project_id=? AND scene_id=? ORDER BY ordinal LIMIT 1", [projectId, adultStructured.scene.sceneId]);
const revokedParticipant = { ...JSON.parse(String(participantRow.row_json)), consentRevocable: false };
connection.run("UPDATE intimacy_scene_participants SET row_json=? WHERE id=?", [JSON.stringify(revokedParticipant), participantRow.id]);
let liveConsentBlocked = false;
try {
  service.approveVersion(adultStructured.scene.sceneId, firstAdultStage.stageId, validVersion.versionId);
} catch (error) {
  liveConsentBlocked = error?.code === "INTIMACY_LIVE_CONSENT_INVALID";
}
check("approval rechecks latest participant revocable consent", liveConsentBlocked && service.listVersions(firstAdultStage.stageId).find((item) => item.versionId === validVersion.versionId)?.status === "current");
connection.run("UPDATE intimacy_scene_participants SET row_json=? WHERE id=?", [JSON.stringify({ ...revokedParticipant, consentRevocable: true }), participantRow.id]);

let undefinedContinuityBlocked = false;
try {
  service.createContinuitySnapshot({
    sceneId: adultStructured.scene.sceneId,
    branchId: "main",
    consentState: undefined,
    withdrawalState: undefined,
    requiredNextBeat: "must-not-default",
  });
} catch (error) {
  undefinedContinuityBlocked = error?.code === "INTIMACY_CONTINUITY_CONSENT_REQUIRED";
}
check("adult continuity cannot explicitly pass undefined consent fields", undefinedContinuityBlocked);

service.createContinuitySnapshot({ sceneId: adultStructured.scene.sceneId, branchId: "main", consentState: "withdrawn", withdrawalState: "active", requiredNextBeat: "stop" });
let withdrawalBlocked = false;
try {
  service.approveVersion(adultStructured.scene.sceneId, firstAdultStage.stageId, validVersion.versionId);
} catch (error) {
  withdrawalBlocked = error?.code === "INTIMACY_WITHDRAWAL_ACTIVE";
}
check("approval rechecks latest continuity withdrawal", withdrawalBlocked);
service.createContinuitySnapshot({ sceneId: adultStructured.scene.sceneId, branchId: "main", consentState: "active", withdrawalState: "none", requiredNextBeat: "review" });
check("valid adult structural version can be approved", service.approveVersion(adultStructured.scene.sceneId, firstAdultStage.stageId, validVersion.versionId).status === "approved");
const secondAdultStage = service.listStages(adultStructured.scene.sceneId).find((stage) => stage.ordinal === 2 && stage.branchId === "main");
service.transitionStage(adultStructured.scene.sceneId, secondAdultStage.stageId, "ready");
service.createContinuitySnapshot({ sceneId: adultStructured.scene.sceneId, branchId: "main", consentState: "withdrawn", withdrawalState: "active", requiredNextBeat: "stop" });
let transitionWithdrawalBlocked = false;
try {
  service.transitionStage(adultStructured.scene.sceneId, secondAdultStage.stageId, "active");
} catch (error) {
  transitionWithdrawalBlocked = error?.code === "INTIMACY_WITHDRAWAL_ACTIVE";
}
check("forward stage transition rechecks latest continuity withdrawal", transitionWithdrawalBlocked);
service.createContinuitySnapshot({ sceneId: adultStructured.scene.sceneId, branchId: "main", consentState: "active", withdrawalState: "none", requiredNextBeat: "approach" });
check("forward stage transition resumes only after active continuity", service.transitionStage(adultStructured.scene.sceneId, secondAdultStage.stageId, "active").status === "active");
let requiredChangeBlocked = false;
try {
  service.createStageVersion(adultStructured.scene.sceneId, secondAdultStage.stageId, {
    summary: "The first voluntary choice changes what both adults know.",
    metadata: { adultNarrativeEvidence: stageEvidence(secondAdultStage) },
  });
} catch (error) {
  requiredChangeBlocked = error instanceof AdultNarrativeStructureError && error.issues.some((issue) => issue.code === "STAGE_REQUIRED_STATE_CHANGE_MISSING");
}
check("adult stage version enforces act-required state changes", requiredChangeBlocked);
check("adult stage version accepts a material required state change", Boolean(service.createStageVersion(adultStructured.scene.sceneId, secondAdultStage.stageId, {
  summary: "The first voluntary choice makes a previously deniable intention mutually known.",
  metadata: {
    adultNarrativeEvidence: stageEvidence(secondAdultStage, [{
      dimension: "information",
      before: "The intention remains deniable.",
      after: "Both adults can now identify the intention.",
      cost: "Future denial would damage their established trust.",
    }]),
  },
}).versionId));

const generalBranchSource = generalCompatible.stages[0];
const firstBranch = service.createBranchFromStage(generalCompatible.scene.sceneId, generalBranchSource.stageId, "First isolated branch");
const nestedBranch = service.createBranchFromStage(generalCompatible.scene.sceneId, firstBranch.stages[0].stageId, "Nested isolated branch");
check("nested branch clones only selected source branch stages", nestedBranch.stages.length === generalCompatible.stages.length);
const nestedStageIds = new Set(nestedBranch.stages.map((stage) => stage.stageId));
const nestedDependencies = connection.all("SELECT row_json FROM intimacy_scene_stage_dependencies WHERE project_id=? AND scene_id=?", [projectId, generalCompatible.scene.sceneId])
  .map((row) => JSON.parse(String(row.row_json)))
  .filter((dependency) => nestedStageIds.has(dependency.stageId));
check("nested branch rebuilds isolated dependencies", nestedDependencies.length === nestedBranch.stages.length - 1 && nestedDependencies.every((dependency) => nestedStageIds.has(dependency.dependsOnStageId)));

const generatorContext = {
  projectId,
  sceneId: adultStructured.scene.sceneId,
  stageId: firstAdultStage.stageId,
  branchId: "main",
  profileId: "adult_intimacy",
  stageType: firstAdultStage.stageType,
  stageGoal: firstAdultStage.goal,
  adultMode: true,
  adultExperienceProfile,
  adultNarrativeBlueprint: adultStructured.scene.narrativeBlueprint,
  adultNarrativeActId: firstAdultStage.narrativeActId,
  policy: {
    providerMode: "local-only",
    adultPolicyEnabled: true,
    participantsVerifiedAdult: true,
    relationshipPermitted: true,
    consentState: "active",
    consentRevocable: true,
    withdrawalState: "none",
    ratingPermitted: true,
    localOnlyRequired: true,
  },
};
check("actual story-stage context accepts confirmed adult structural profile", assertAdultStagePolicy(generatorContext).ok === true);
const structuralPrompt = buildStoryStagePrompt(generatorContext, "generateStage");
check("generator prompt receives the validated blueprint and experience profile", structuralPrompt.includes(blueprint.version) && structuralPrompt.includes(adultExperienceProfile.version));
let unconfirmedGeneratorBlocked = false;
try {
  assertAdultStagePolicy({ ...generatorContext, adultExperienceProfile: createAdultExperienceProfile() });
} catch (error) {
  unconfirmedGeneratorBlocked = error?.code === "STORY_GENERATION_POLICY_BLOCKED";
}
check("adult generator fails closed without confirmed profile", unconfirmedGeneratorBlocked);

connection.close();
fs.rmSync(storageDir, { recursive: true, force: true });

console.log(JSON.stringify({
  status: "PASS",
  passed,
  engineCount: ADULT_NARRATIVE_ENGINE_IDS.length,
  mandatoryActCount: ADULT_NARRATIVE_ACT_IDS.length,
  worldAdapterCount: ADULT_NARRATIVE_WORLD_ADAPTER_IDS.length,
  outputKind: blueprint.outputKind,
  safety: blueprint.safety,
}, null, 2));
