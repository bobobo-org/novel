import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  DATASET_REGISTRY_SCHEMA_VERSION,
  EVALUATOR_RECORD_SCHEMA_VERSION,
  MODEL_REGISTRY_SCHEMA_VERSION,
  PREFERENCE_EVENT_SCHEMA_VERSION,
  TRAINING_RUN_SCHEMA_VERSION,
  assertImmutableRegistryVersion,
  canReadDataset,
  evaluatePromotionGate,
  validateDatasetEntry,
  validateEvaluatorRecord,
  validateModelRegistryEntry,
  validatePreferenceEvent,
  validateRollbackTarget,
  validateTrainingLifecycleTransition,
  validateTrainingRun,
} from "../lib/novel-ai/training/training-system-contract.ts";

const results = [];
async function test(name, work) { const started = performance.now(); try { await work(); results.push({ name, status: "PASS", elapsedMs: Math.round(performance.now() - started) }); } catch (error) { results.push({ name, status: "FAIL", elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) }); } }

const preference = { schemaVersion: PREFERENCE_EVENT_SCHEMA_VERSION, preferenceEventId: "pref-1", subjectId: "user-a", storyId: "story-a", taskType: "continue_scene", promptSnapshot: "prompt", candidateOutputs: ["a", "b"], acceptedCandidate: "a", rejectedCandidates: ["b"], discardedCandidates: [], userEditedFinalOutput: "a edited", editDiff: "diff", rating: 4, reasonTags: ["pace"], occurredAt: new Date().toISOString(), providerId: "local-ollama", modelId: "model-a", status: "approved_for_personalization", consent: { personalizationAllowed: true, sharedTrainingAllowed: false }, trainingEligibility: { personalization: true, shared: false }, retentionPolicy: "delete_on_withdrawal", provenance: { sourceType: "private_user_content", sourceRecordId: "source-1", copyrightStatus: "restricted" }, datasetVersion: null, idempotencyKey: "idem-1", rollbackEvent: false, testAccount: false, systemError: false, completedReview: true, deletionRequestedAt: null };
const dataset = { schemaVersion: DATASET_REGISTRY_SCHEMA_VERSION, datasetId: "dataset-a", version: "1", ownerScope: { type: "personal", subjectId: "user-a" }, lifecycleStatus: "approved", sourceRecordIds: ["pref-1"], contentHash: "hash-a", provenanceValidated: true, qualityScore: 0.9, contaminationFlags: [], deduplicationFingerprint: "dedup-a", createdAt: new Date().toISOString() };
const model = { schemaVersion: MODEL_REGISTRY_SCHEMA_VERSION, modelId: "model-a", baseModelId: "base-a", version: "2", providerCompatibility: ["local_ollama"], capabilities: ["text"], contextLimit: 8192, precision: "q4", trainingMethod: "lora", datasetVersion: "1", benchmarkResultId: "benchmark-1", safetyResultId: "safety-1", deploymentStatus: "candidate", rollbackVersion: "1", createdAt: new Date().toISOString() };
const priorModel = { ...model, version: "1", deploymentStatus: "approved", rollbackVersion: null };
const trainingRun = { schemaVersion: TRAINING_RUN_SCHEMA_VERSION, trainingRunId: "run-1", method: "lora", datasetId: "dataset-a", datasetVersion: "1", baseModelId: "base-a", baseModelVersion: "1", hyperparameterProfile: "profile-a", hardwareProfile: "gpu-a", checkpointId: null, evaluatorVersion: "eval-v1", benchmarkVersion: "benchmark-v1", status: "contract_only", createdAt: new Date().toISOString() };
const evaluator = { schemaVersion: EVALUATOR_RECORD_SCHEMA_VERSION, evaluationId: "evaluation-1", evaluatorId: "deterministic", evaluatorVersion: "1", methods: ["deterministic_rules"], targetType: "training_run", targetId: "run-1", datasetVersion: "1", trainingRunId: "run-1", benchmarkVersion: "benchmark-v1", scores: { continuity: 0.9 }, privacyFailures: 0, closedOnlyFailures: 0, safetyFailures: 0, createdAt: new Date().toISOString() };
const promotionBase = { modelId: "model-a", candidateVersion: "2", currentProductionVersion: "1", benchmarkDelta: 0.1, worstCaseDelta: 0, regressionFailures: 0, privacyFailures: 0, closedOnlyFailures: 0, safetyFailures: 0, latencyWithinLimit: true, memoryWithinLimit: true, gpuWithinLimit: true, humanApproved: true, datasetApproved: true };

await test("unreviewed data cannot train", async () => assert.equal(validatePreferenceEvent({ ...preference, completedReview: false }).errorCode, "PREFERENCE_EVENT_INELIGIBLE"));
await test("private data without shared qualification cannot export", async () => assert.equal(validatePreferenceEvent({ ...preference, trainingEligibility: { personalization: true, shared: true } }).errorCode, "PREFERENCE_SHARED_CONSENT_REQUIRED"));
await test("deleted data cannot reenter dataset", async () => assert.equal(validatePreferenceEvent({ ...preference, status: "deleted" }).errorCode, "PREFERENCE_DELETED"));
await test("rollback is not positive preference", async () => assert.equal(validatePreferenceEvent({ ...preference, rollbackEvent: true }).errorCode, "PREFERENCE_EVENT_INELIGIBLE"));
await test("deterministic provider is training-ineligible", async () => assert.equal(validatePreferenceEvent({ ...preference, providerId: "deterministic-local" }).errorCode, "PREFERENCE_TEST_PROVIDER_INELIGIBLE"));
await test("missing provenance cannot approve", async () => assert.equal(validatePreferenceEvent({ ...preference, provenance: null }).errorCode, "PREFERENCE_PROVENANCE_REQUIRED"));
await test("dataset version cannot overwrite", async () => assert.equal(assertImmutableRegistryVersion([dataset], { ...dataset }, (value) => `${value.datasetId}:${value.version}`, "DATASET_VERSION_IMMUTABLE").errorCode, "DATASET_VERSION_IMMUTABLE"));
await test("model version cannot overwrite", async () => assert.equal(assertImmutableRegistryVersion([model], { ...model }, (value) => `${value.modelId}:${value.version}`, "MODEL_VERSION_IMMUTABLE").errorCode, "MODEL_VERSION_IMMUTABLE"));
await test("production model is not directly replaced", async () => assert.equal(evaluatePromotionGate({ ...promotionBase, humanApproved: false }).decision, "rejected"));
await test("benchmark regression blocks promotion", async () => assert.ok(evaluatePromotionGate({ ...promotionBase, benchmarkDelta: -0.01 }).errorCodes.includes("PROMOTION_BENCHMARK_REGRESSION")));
await test("privacy failure blocks promotion", async () => assert.ok(evaluatePromotionGate({ ...promotionBase, privacyFailures: 1 }).errorCodes.includes("PROMOTION_PRIVACY_FAILURE")));
await test("closed-only failure blocks promotion", async () => assert.ok(evaluatePromotionGate({ ...promotionBase, closedOnlyFailures: 1 }).errorCodes.includes("PROMOTION_CLOSED_ONLY_FAILURE")));
await test("personal dataset cannot cross user boundary", async () => assert.equal(canReadDataset(dataset, "user-b"), false));
await test("rejected sample cannot export", async () => assert.equal(validatePreferenceEvent({ ...preference, status: "rejected", trainingEligibility: { personalization: true, shared: true }, consent: { personalizationAllowed: true, sharedTrainingAllowed: true } }).errorCode, "PREFERENCE_REJECTED"));
await test("evaluator result is traceable", async () => assert.equal(validateEvaluatorRecord(evaluator).valid, true));
await test("training run binds dataset and base model", async () => assert.equal(validateTrainingRun(trainingRun).valid, true));
await test("training run without dataset is rejected", async () => assert.equal(validateTrainingRun({ ...trainingRun, datasetVersion: "" }).errorCode, "TRAINING_RUN_DATASET_REQUIRED"));
await test("model registry entry validates", async () => assert.equal(validateModelRegistryEntry(model).valid, true));
await test("production model requires benchmark and safety evidence", async () => assert.equal(validateModelRegistryEntry({ ...model, deploymentStatus: "production", benchmarkResultId: null }).errorCode, "MODEL_REGISTRY_PRODUCTION_EVIDENCE_REQUIRED"));
await test("rollback returns to approved version", async () => assert.equal(validateRollbackTarget(model, priorModel).valid, true));
await test("lifecycle cannot skip collected to trained", async () => assert.equal(validateTrainingLifecycleTransition("collected", "trained").errorCode, "TRAINING_LIFECYCLE_TRANSITION_INVALID"));
await test("lifecycle allows collected to validated", async () => assert.equal(validateTrainingLifecycleTransition("collected", "validated").valid, true));
await test("clean dataset validates", async () => assert.equal(validateDatasetEntry(dataset).valid, true));
await test("contaminated dataset is rejected", async () => assert.equal(validateDatasetEntry({ ...dataset, contaminationFlags: ["private_data_leakage"] }).errorCode, "DATASET_CONTAMINATION_DETECTED"));
await test("approved promotion requires every gate", async () => assert.equal(evaluatePromotionGate(promotionBase).decision, "approved"));

const report = { schemaVersion: "closed-ai-training-phase0-results-v1", suite: "closed-ai-training-phase0", generatedAt: new Date().toISOString(), pass: results.filter((item) => item.status === "PASS").length, fail: results.filter((item) => item.status === "FAIL").length, skip: 0, realTrainingRuns: 0, externalModelCalls: 0, results };
await mkdir(new URL("../artifacts/closed-ai-phase0/", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/closed-ai-phase0/training-test-results.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.fail) process.exitCode = 1;
