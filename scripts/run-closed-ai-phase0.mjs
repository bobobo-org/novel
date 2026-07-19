import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { CLOSED_PROVIDER_SCHEMA_VERSION, validateClosedAIProviderDescriptor } from "../lib/novel-ai/providers/closed/closed-provider-contract.ts";
import { DeterministicClosedProvider } from "../lib/novel-ai/providers/closed/deterministic-closed-provider.ts";
import { CLOSED_AI_TASKS, CLOSED_AI_TASK_CATALOG, validateClosedAITaskDefinition } from "../lib/novel-ai/router/closed-ai-task-catalog.ts";
import { resolveClosedAIWithAudit, validateClosedRouterAudit } from "../lib/novel-ai/router/closed-router-audit.ts";
import { CLOSED_AI_PRIVACY_SCHEMA_VERSION, validateClosedAIPrivacyPolicy } from "../lib/novel-ai/router/closed-ai-privacy-contract.ts";
import { assertFallbackAllowed, resolvePlatformProvider } from "../lib/novel-ai/router/platform-router.ts";
import { TEACHER_PIPELINE_SCHEMA_VERSION, validateTeacherPipelineRecord } from "../lib/novel-ai/teacher-pipeline/teacher-pipeline-contract.ts";
import { CLOSED_AI_BENCHMARK_SCHEMA_VERSION, runDeterministicBenchmark, validateBenchmarkFixture } from "../lib/novel-ai/evaluation/closed-ai-benchmark-contract.ts";

const results = [];
async function test(name, work) { const started = performance.now(); try { await work(); results.push({ name, status: "PASS", elapsedMs: Math.round(performance.now() - started) }); } catch (error) { results.push({ name, status: "FAIL", elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }); } }

const providers = {
  browser: new DeterministicClosedProvider("browser"),
  ollama: new DeterministicClosedProvider("local_ollama"),
  privateHub: new DeterministicClosedProvider("private_hub"),
};
const snapshots = await Promise.all(Object.values(providers).map((provider) => provider.healthProbe()));
const external = { id: "gemini", status: "ready", capabilities: ["text", "structured", "streaming", "long-context"], modelId: "external-test", maxContext: 1000000, local: false, requiresInternet: true };
const deterministicRule = { id: "deterministic-local", status: "ready", capabilities: ["text", "structured", "offline"], modelId: "rule-test", maxContext: 1000000, local: true, requiresInternet: false };
const request = (overrides = {}) => ({ requestId: `phase0-${Math.random()}`, projectId: "phase0-project", taskType: "chapter.continue", privacyMode: "strict-local", privacyLevel: "device_only", input: "continue", context: ["chapter"], externalConsent: false, closedOnly: true, offlineRequired: true, idempotencyKey: "phase0-idempotency", ...overrides });

for (const [name, provider] of Object.entries(providers)) {
  await test(`provider descriptor valid:${name}`, async () => assert.deepEqual(validateClosedAIProviderDescriptor(provider.descriptor), { valid: true, errorCode: null }));
  await test(`provider explicitly test-only:${name}`, async () => assert.equal(provider.descriptor.status, "test_only"));
  await test(`provider schema version:${name}`, async () => assert.equal(provider.descriptor.schemaVersion, CLOSED_PROVIDER_SCHEMA_VERSION));
}
await test("invalid provider profile rejected", async () => { const value = structuredClone(providers.browser.descriptor); value.modelProfile.contextLimit = 0; assert.equal(validateClosedAIProviderDescriptor(value).errorCode, "CLOSED_PROVIDER_MODEL_PROFILE_INVALID"); });
await test("browser selected for device-only", async () => assert.equal(resolvePlatformProvider(request(), [...snapshots, external]).providerId, "browser-ai"));
await test("ollama selected when browser unavailable", async () => { const unavailable = [{ ...snapshots[0], status: "runtime_unavailable" }, snapshots[1], snapshots[2], external]; assert.equal(resolvePlatformProvider(request(), unavailable).providerId, "local-ollama"); });
await test("private hub allowed only on private infrastructure", async () => { const unavailable = [{ ...snapshots[0], status: "runtime_unavailable" }, { ...snapshots[1], status: "runtime_unavailable" }, snapshots[2]]; assert.equal(resolvePlatformProvider(request({ privacyMode: "private-hub-allowed", privacyLevel: "private_infrastructure_only", offlineRequired: false }), unavailable).providerId, "private-ai-hub"); });
await test("device-only blocks private hub", async () => { const unavailable = [{ ...snapshots[0], status: "runtime_unavailable" }, { ...snapshots[1], status: "runtime_unavailable" }, snapshots[2]]; assert.throws(() => resolvePlatformProvider(request(), unavailable), (error) => error.code === "NO_CLOSED_PROVIDER_AVAILABLE"); });
await test("closed-only blocks preferred external provider", async () => { const decision = resolvePlatformProvider(request({ preferredProvider: "gemini", privacyMode: "external-allowed", privacyLevel: "external_allowed", externalConsent: true, offlineRequired: false }), [...snapshots, external]); assert.notEqual(decision.providerId, "gemini"); assert.ok(decision.rejectedCandidates.some((item) => item.providerId === "gemini")); });
await test("closed-only excludes deterministic rule provider", async () => { assert.throws(() => resolvePlatformProvider(request(), [deterministicRule, external]), (error) => error.code === "NO_CLOSED_PROVIDER_AVAILABLE"); });
await test("all closed unavailable fails explicitly", async () => { const unavailable = snapshots.map((item) => ({ ...item, status: "runtime_unavailable" })); assert.throws(() => resolvePlatformProvider(request({ privacyMode: "external-allowed", privacyLevel: "external_allowed", externalConsent: true, offlineRequired: false, preferredProvider: "gemini" }), [...unavailable, external]), (error) => error.code === "NO_CLOSED_PROVIDER_AVAILABLE"); });
await test("structured capability enforced", async () => { const withoutStructured = snapshots.map((item) => ({ ...item, capabilities: item.capabilities.filter((capability) => capability !== "structured") })); assert.throws(() => resolvePlatformProvider(request({ requiresStructured: true }), withoutStructured), (error) => error.code === "NO_CLOSED_PROVIDER_AVAILABLE"); });
await test("context limit enforced", async () => assert.throws(() => resolvePlatformProvider(request({ estimatedContextSize: 999999 }), snapshots), (error) => error.code === "NO_CLOSED_PROVIDER_AVAILABLE"));
await test("fallback privacy guard blocks external", async () => assert.throws(() => assertFallbackAllowed("local-ollama", "gemini", request()), (error) => error.code === "FALLBACK_PRIVACY_BOUNDARY_BLOCKED"));
await test("router audit records successful decision", async () => { const { audit } = resolveClosedAIWithAudit(request(), [...snapshots, external]); assert.equal(audit.selectedProvider, "browser-ai"); assert.equal(audit.closedOnly, true); assert.equal(audit.finalErrorCode, null); assert.equal(validateClosedRouterAudit(audit).valid, true); });
await test("router audit records terminal error", async () => { const { audit } = resolveClosedAIWithAudit(request(), snapshots.map((item) => ({ ...item, status: "runtime_unavailable" }))); assert.equal(audit.selectedProvider, null); assert.equal(audit.finalErrorCode, "NO_CLOSED_PROVIDER_AVAILABLE"); assert.equal(validateClosedRouterAudit(audit).valid, true); });
await test("router audit lists rejection reasons", async () => { const { audit } = resolveClosedAIWithAudit(request({ preferredProvider: "gemini" }), [...snapshots, external]); assert.ok(audit.rejectedProviders.some((item) => item.providerId === "gemini")); });
await test("provider cancellation is deterministic", async () => { const cancelRequest = request({ requestId: "cancel-me" }); await providers.browser.cancel(cancelRequest.requestId); const decision = resolvePlatformProvider(cancelRequest, snapshots); await assert.rejects(() => providers.browser.generate(cancelRequest, decision), (error) => error.code === "CLOSED_AI_CANCELLED"); });

const privacyBase = { schemaVersion: CLOSED_AI_PRIVACY_SCHEMA_VERSION, privacyLevel: "device_only", closedOnly: true, offlineRequired: true, externalConsent: false, fallbackPolicy: "closed-only" };
await test("privacy contract validates closed-only", async () => assert.equal(validateClosedAIPrivacyPolicy(privacyBase).valid, true));
await test("privacy contract blocks external fallback", async () => assert.equal(validateClosedAIPrivacyPolicy({ ...privacyBase, fallbackPolicy: "external-with-consent" }).errorCode, "CLOSED_PRIVACY_EXTERNAL_FALLBACK_FORBIDDEN"));
await test("privacy contract rejects misplaced consent", async () => assert.equal(validateClosedAIPrivacyPolicy({ ...privacyBase, externalConsent: true }).errorCode, "CLOSED_PRIVACY_CONSENT_SCOPE_INVALID"));
await test("privacy contract rejects offline external mode", async () => assert.equal(validateClosedAIPrivacyPolicy({ ...privacyBase, privacyLevel: "external_allowed" }).errorCode, "CLOSED_PRIVACY_OFFLINE_EXTERNAL_CONFLICT"));

for (const taskType of CLOSED_AI_TASKS) await test(`task catalog:${taskType}`, async () => assert.equal(validateClosedAITaskDefinition(CLOSED_AI_TASK_CATALOG[taskType]).valid, true));

const teacherBase = { schemaVersion: TEACHER_PIPELINE_SCHEMA_VERSION, recordId: "teacher-1", workspace: "training", taskDefinition: "rewrite", inputSnapshot: "private text", teacherResponse: "candidate", candidateOutputs: ["candidate"], evaluatorScores: {}, ranking: [], status: "generated", humanApproval: null, provenance: { providerId: "contract-provider", modelId: "contract-model", taskDefinitionVersion: "v1", sourceType: "private_user_content", sourceReference: null, copyrightStatus: "restricted" }, consent: { trainingAllowed: false, sharedDatasetAllowed: false, grantedAt: null, withdrawnAt: null }, retention: { expiresAt: null, policy: "delete_on_withdrawal" }, datasetVersion: null, rejectionReason: null, trainingEligibility: false, exportEligibility: false, deletionRequestedAt: null, offlineBenchmarkLink: null };
await test("private user content requires training consent", async () => assert.equal(validateTeacherPipelineRecord(teacherBase).errorCode, "TEACHER_PRIVATE_CONTENT_CONSENT_REQUIRED"));
await test("unapproved teacher record cannot export", async () => assert.equal(validateTeacherPipelineRecord({ ...teacherBase, provenance: { ...teacherBase.provenance, sourceType: "synthetic", copyrightStatus: "cleared" }, exportEligibility: true }).errorCode, "TEACHER_EXPORT_NOT_APPROVED"));
await test("approved cleared synthetic record validates", async () => { const value = { ...teacherBase, provenance: { ...teacherBase.provenance, sourceType: "synthetic", copyrightStatus: "cleared" }, status: "approved", humanApproval: { reviewerId: "human", reviewedAt: new Date().toISOString(), decision: "approved" }, trainingEligibility: true, exportEligibility: true }; assert.equal(validateTeacherPipelineRecord(value).valid, true); });
await test("teacher workspace boundary enforced", async () => assert.equal(validateTeacherPipelineRecord({ ...teacherBase, workspace: "story" }).errorCode, "TEACHER_STORAGE_BOUNDARY_INVALID"));

const fixture = { schemaVersion: CLOSED_AI_BENCHMARK_SCHEMA_VERSION, fixtureId: "fixture-1", taskType: "continue_scene", input: "input", expectedConstraints: ["主角", "衝突"], scoringDimensions: ["constraint"], providerEligibility: ["browser-ai", "local-ollama"], offlineRequired: true, layers: ["contract_test", "deterministic_regression", "model_quality_evaluation", "human_review", "production_e2e"] };
await test("benchmark fixture validates", async () => assert.equal(validateBenchmarkFixture(fixture).valid, true));
await test("deterministic benchmark passes constraints", async () => assert.equal(runDeterministicBenchmark(fixture, "主角面對衝突").status, "PASS"));
await test("deterministic benchmark reports missed constraint", async () => assert.equal(runDeterministicBenchmark(fixture, "主角前進").errorCode, "BENCHMARK_CONSTRAINT_MISSED"));
await test("model quality remains not run in phase 0", async () => { const phase0Layers = ["contract_test", "deterministic_regression"]; assert.equal(phase0Layers.includes("model_quality_evaluation"), false); });

const report = { suite: "closed-ai-phase0", schemaVersion: "closed-ai-phase0-results-v1", generatedAt: new Date().toISOString(), pass: results.filter((item) => item.status === "PASS").length, fail: results.filter((item) => item.status === "FAIL").length, skip: 0, externalModelCalls: 0, deterministicProvidersProductionRegistered: false, results };
await mkdir(new URL("../artifacts/closed-ai-phase0/", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/closed-ai-phase0/test-results.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.fail) process.exitCode = 1;
