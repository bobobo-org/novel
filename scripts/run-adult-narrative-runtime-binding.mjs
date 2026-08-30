import assert from "node:assert/strict";
import {
  ADULT_NARRATIVE_ACT_IDS,
  AdultNarrativeRuntimeBindingError,
  bindAdultNarrativeRuntime,
  formatAdultNarrativeRuntimePromptBinding,
} from "../lib/novel-ai/adult/scenes/index.ts";
import { createAdultNarrativeRuntimeFixture } from "./fixtures/adult-narrative-runtime-binding-fixture.mjs";

let passed = 0;

function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

function expectRejected(name, mutate, expectedCode) {
  const fixture = createAdultNarrativeRuntimeFixture();
  mutate(fixture);
  let error;
  try {
    bindAdultNarrativeRuntime(fixture);
  } catch (caught) {
    error = caught;
  }
  check(
    name,
    error instanceof AdultNarrativeRuntimeBindingError
      && error.issues.some((issue) => issue.code === expectedCode),
  );
}

const disabled = bindAdultNarrativeRuntime({
  project: { id: "general-project", adultMode: false, adultExperienceProfile: null },
  characters: [],
  participantIds: [],
  scopeId: "",
});
check("general projects are not applicable without demanding adult evidence", !disabled.applicable && disabled.reason === "project_adult_mode_disabled");
check("general projects serialize no adult prompt binding", formatAdultNarrativeRuntimePromptBinding(disabled) === null);

const rpgFixture = createAdultNarrativeRuntimeFixture();
const rpgBinding = bindAdultNarrativeRuntime(rpgFixture);
check("RPG scope produces an applicable local binding", rpgBinding.applicable && rpgBinding.scopeId.startsWith("rpg-turn:"));
check("runtime is structural and fade-to-black only", rpgBinding.applicable && rpgBinding.rendering.outputKind === "structural_json" && rpgBinding.rendering.fadeToBlack === true && rpgBinding.rendering.explicitText === false);
check("runtime preserves one primary and at most one secondary engine", rpgBinding.applicable && rpgBinding.blueprint.engineComposition.primary === "E8_world_heat" && rpgBinding.blueprint.engineComposition.secondary === "E2_pretext" && rpgBinding.blueprint.engineComposition.maximumSecondaryCount === 1);
check("runtime preserves all five ordered acts", rpgBinding.applicable && rpgBinding.blueprint.acts.map((act) => act.actId).join(",") === ADULT_NARRATIVE_ACT_IDS.join(","));
check("runtime carries irreversible event and cost", rpgBinding.applicable && Boolean(rpgBinding.blueprint.irreversibility.event) && Boolean(rpgBinding.blueprint.irreversibility.cost));
check("binding policy blocks external execution and data egress", rpgBinding.applicable && rpgBinding.executionPolicy.externalExecutionAllowed === false && rpgBinding.executionPolicy.dataEgressAllowed === false);

const formatted = formatAdultNarrativeRuntimePromptBinding(rpgBinding);
check("closed prompt receives only the structural prompt contract", typeof formatted === "string" && formatted.includes("adult-narrative-runtime-prompt-v1") && formatted.includes('"outputMode":"structural_fade_to_black"') && formatted.includes('"outputKind":"structural_json"') && formatted.includes('"consent_mode":"fade_to_black"'));
check("prompt serialization omits consent evidence IDs", typeof formatted === "string" && !formatted.includes("consent-evidence-") && !formatted.includes("safety-evidence-1"));
check("prompt serialization omits participant IDs and ages", typeof formatted === "string" && !formatted.includes("character-adult-") && !formatted.includes('"age"'));

const chapterFixture = createAdultNarrativeRuntimeFixture({
  scopeId: "chapter:chapter-7:draft-3",
  executionSource: "deterministic-rule-fallback",
});
const chapterBinding = bindAdultNarrativeRuntime(chapterFixture);
check("the same binding supports general chapter scope", chapterBinding.applicable && chapterBinding.scopeId.startsWith("chapter:"));
check("local rule fallback remains local and structurally constrained", chapterBinding.applicable && chapterBinding.executionSource === "deterministic-rule-fallback" && chapterBinding.promptContract.externalExecutionAllowed === false);

expectRejected("external AI is blocked for adult runtime bindings", (fixture) => {
  fixture.executionSource = "gemini";
}, "ADULT_EXTERNAL_EXECUTION_BLOCKED");

expectRejected("unknown executors fail closed", (fixture) => {
  fixture.executionSource = "unknown-provider";
}, "ADULT_LOCAL_EXECUTION_SOURCE_REQUIRED");

expectRejected("adult mode requires fictional-adult confirmation", (fixture) => {
  fixture.project.adultExperienceProfile.fictionalAdultsConfirmed = false;
}, "FICTIONAL_ADULTS_CONFIRMATION_REQUIRED");

expectRejected("real-person likeness blocking cannot be relaxed", (fixture) => {
  fixture.project.adultExperienceProfile.realPersonLikenessBlocked = false;
}, "REAL_PERSON_LIKENESS_MUST_BE_BLOCKED");

expectRejected("every actual participant needs verified age evidence", (fixture) => {
  fixture.characters[0].ageVerified = false;
}, "PARTICIPANT_AGE_NOT_VERIFIED");

expectRejected("a participant below 18 is rejected", (fixture) => {
  fixture.characters[0].age = 17;
}, "PARTICIPANT_NOT_VERIFIED_ADULT");

expectRejected("unknown numeric age is rejected", (fixture) => {
  fixture.characters[0].age = null;
}, "PARTICIPANT_NOT_VERIFIED_ADULT");

expectRejected("missing canonical character data is rejected", (fixture) => {
  fixture.characters = fixture.characters.filter((character) => character.id !== fixture.participantIds[1]);
}, "ACTUAL_PARTICIPANT_NOT_FOUND");

expectRejected("duplicate actual participants are rejected", (fixture) => {
  fixture.participantIds[1] = fixture.participantIds[0];
}, "ACTUAL_PARTICIPANT_DUPLICATE");

expectRejected("missing participant consent evidence is rejected", (fixture) => {
  fixture.consentEvidence.pop();
}, "PARTICIPANT_CONSENT_EVIDENCE_MISSING");

expectRejected("withdrawn consent stops the binding", (fixture) => {
  fixture.consentEvidence[0].state = "withdrawn";
  fixture.consentEvidence[0].withdrawalState = "withdrawn";
}, "ACTIVE_REVOCABLE_CONSENT_REQUIRED");

expectRejected("non-revocable consent stops the binding", (fixture) => {
  fixture.consentEvidence[0].revocable = false;
}, "ACTIVE_REVOCABLE_CONSENT_REQUIRED");

expectRejected("consent from another turn cannot be reused", (fixture) => {
  fixture.consentEvidence[0].scopeId = "rpg-turn:stale";
}, "CONSENT_TURN_SCOPE_MISMATCH");

expectRejected("expired consent evidence fails closed", (fixture) => {
  fixture.consentEvidence[0].expiresAt = "2026-08-30T05:59:30.000Z";
}, "CONSENT_EVIDENCE_EXPIRED");

expectRejected("safety evidence must cover exact participants", (fixture) => {
  fixture.safetyEvidence.participantIds.pop();
}, "SAFETY_PARTICIPANT_SCOPE_MISMATCH");

expectRejected("every safety assertion must remain true", (fixture) => {
  fixture.safetyEvidence.assertions.noCoercion = false;
}, "SAFETY_ASSERTION_NOCOERCION");

expectRejected("runtime rejects non-fade rendering", (fixture) => {
  fixture.request.parameters.consent_mode = "continuous_reconfirmation";
}, "FADE_TO_BLACK_REQUIRED");

expectRejected("runtime rejects explicit act instructions", (fixture) => {
  fixture.request.narrativeGoal = "Describe explicit penetration instead of a structural consequence.";
}, "EXPLICIT_ACT_NOT_ALLOWED");

expectRejected("runtime requires the structural request", (fixture) => {
  fixture.request = null;
}, "ADULT_STRUCTURAL_REQUEST_REQUIRED");

expectRejected("runtime rejects more than one secondary engine", (fixture) => {
  fixture.request.secondaryEngine = ["E1_proximity", "E2_pretext"];
}, "SECONDARY_ENGINE_LIMIT");

console.log(`adult narrative runtime binding: ${passed} executable assertions passed`);
