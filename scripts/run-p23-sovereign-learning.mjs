import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  chunkKnowledgeText,
  deduplicateKnowledgeChunks,
  indexKnowledgeEmbeddings,
  registerKnowledgeSource,
  resolveKnowledgeCitation,
  createKnowledgeVersion,
} from "../lib/novel-ai/knowledge-ingestion/index.ts";
import {
  approveCognitiveProposal,
  commitCognitiveProposal,
  createSovereignCognitiveProfile,
  proposeCognitiveRevision,
  revertCognitiveProfile,
} from "../lib/novel-ai/sovereign-cognitive-profile/index.ts";
import {
  createLearningEvent,
  MemoryLearningEventStore,
} from "../lib/novel-ai/learning-events/index.ts";
import {
  approveTrainingExample,
  sealTrainingDataset,
  validateTrainingExample,
} from "../lib/novel-ai/training-data-factory/index.ts";
import {
  SovereignReasoningEngine,
  SovereignToolRegistry,
} from "../lib/novel-ai/reasoning-engine/index.ts";
import {
  attachVerifiedDemonstrations,
  prepareDistillationJob,
} from "../lib/novel-ai/distillation/index.ts";
import {
  executeQloraAction,
  prepareQloraJob,
} from "../lib/novel-ai/training/qlora-pipeline.ts";
import {
  createPreferencePair,
  validatePreferenceDataset,
} from "../lib/novel-ai/preference-learning/index.ts";
import {
  computeOfflineReward,
  detectRewardHacking,
} from "../lib/novel-ai/reinforcement/index.ts";
import { SovereignModelRegistry } from "../lib/novel-ai/model-registry/index.ts";
import {
  PERSONA_BENCHMARK_SCHEMA_VERSION,
  PERSONA_BENCHMARK_VARIANTS,
  PersonaPreferenceStore,
  validatePersonaBenchmarkResult,
} from "../lib/novel-ai/persona/index.ts";
import {
  STORY_MEDIA_EXTENSION_SCHEMA_VERSION,
  createStoryMediaCandidatePackage,
  resolveStoryMediaProvider,
} from "../lib/novel-ai/media-extension/index.ts";

const tests = [];
const results = [];
function test(name, run) { tests.push({ name, run }); }

test("unknown-license knowledge remains retrieval-only", () => {
  const result = registerKnowledgeSource({
    title: "Unverified notes",
    author: null,
    sourceType: "web_import",
    sourceLocation: "https://example.test/reference",
    license: "unknown",
    copyrightStatus: "unknown",
    trustLevel: "unverified",
    userApproved: true,
    content: "這是一份來源授權尚未確認的暫時參考資料。",
  });
  assert.equal(result.source.retrievalEligible, true);
  assert.equal(result.source.trainingEligible, false);
  assert.equal(result.eligibility.disposition, "retrieval_only");
});

test("owned knowledge can be versioned, chunked and cited", () => {
  const result = registerKnowledgeSource({
    title: "My story craft notes",
    author: "owner",
    sourceType: "user_document",
    sourceLocation: null,
    license: "user_owned",
    copyrightStatus: "owned",
    trustLevel: "high",
    userApproved: true,
    content: "第一條：角色選擇必須帶來後果。\n\n第二條：世界規則必須保持一致。",
  });
  assert.equal(result.source.trainingEligible, true);
  const chunks = chunkKnowledgeText({ sourceId: result.source.sourceId, text: result.normalizedContent, language: result.source.language, maxChars: 300 });
  const citation = resolveKnowledgeCitation({ source: result.source, chunk: chunks[0], excerpt: "角色選擇必須帶來後果" });
  assert(citation.start >= 0);
  assert.equal(citation.contentHash, result.source.contentHash);
  const version = createKnowledgeVersion({ sourceId: result.source.sourceId, contentHash: result.source.contentHash, chunks });
  assert.equal(version.current.version, 1);
});

test("knowledge deduplication and local embedding fail closed", async () => {
  const chunks = chunkKnowledgeText({ sourceId: "source", text: "同一段文字。".repeat(80), language: "zh-Hant", maxChars: 300, overlapChars: 0 });
  const duplicate = { ...chunks[0], chunkId: "duplicate" };
  const deduped = deduplicateKnowledgeChunks([...chunks, duplicate]);
  assert(deduped.duplicateChunkIds.includes("duplicate"));
  await assert.rejects(() => indexKnowledgeEmbeddings({
    chunks: deduped.unique,
    provider: { providerId: "external", local: false, embed: async () => [] },
  }), (error) => error.code === "KNOWLEDGE_EXTERNAL_EMBEDDING_FORBIDDEN");
  const indexed = await indexKnowledgeEmbeddings({
    chunks: deduped.unique,
    provider: { providerId: "local-fixture", local: true, embed: async (texts) => texts.map((_, index) => [index + 1, 0.5]) },
  });
  assert.equal(indexed.length, deduped.unique.length);
});

test("cognitive principles require proposal evidence and user approval", () => {
  const initial = createSovereignCognitiveProfile("owner");
  const proposed = proposeCognitiveRevision({
    profileId: initial.profileId,
    proposal: "角色主動選擇比被動事件更重要。",
    reason: "提升角色能動性。",
    evidence: ["benchmark:agency-01"],
    counterargument: "部分悲劇需要角色短期失去主導權。",
    expectedImpact: "提高情節推進與讀者投入。",
    confidence: 88,
    target: "corePrinciples",
  });
  assert.throws(() => commitCognitiveProposal({ profile: initial, proposal: proposed, userApproved: false }), (error) => error.code === "COGNITIVE_USER_APPROVAL_REQUIRED");
  const committed = commitCognitiveProposal({ profile: initial, proposal: approveCognitiveProposal(proposed), userApproved: true });
  assert.equal(committed.profile.version, 2);
  assert.equal(committed.profile.corePrinciples.length, 1);
  const reverted = revertCognitiveProfile(committed.profile, initial);
  assert.equal(reverted.version, 3);
  assert.equal(reverted.corePrinciples.length, 0);
});

test("learning events are private, excludable, exportable and deletable", () => {
  const event = createLearningEvent({
    taskId: "task-1",
    storyId: "story-1",
    storyRevision: 1,
    candidateId: "candidate-1",
    provider: "local-ollama",
    model: "qwen2.5:3b",
    promptProfile: "fiction_writer",
    retrievedKnowledge: ["knowledge-1"],
    generatedPlan: ["step"],
    candidateText: "private manuscript",
    evaluation: { continuity: 90 },
    accepted: true,
    rejected: false,
    userEdit: null,
    editDiff: null,
    userRating: 5,
    rejectionReason: null,
    adultMode: false,
    consent: "private_inference_only",
  });
  assert.equal(event.candidateText, null);
  assert.equal(event.trainingEligible, false);
  const store = new MemoryLearningEventStore();
  store.put(event);
  assert.equal(store.export("story-1").events.length, 1);
  assert.equal(store.exclude(event.eventId).trainingEligible, false);
  assert.equal(store.delete(event.eventId), true);
});

test("training factory blocks PII and mixed adult namespaces", () => {
  const base = {
    exampleId: "example-1",
    type: "sft",
    sourceEventIds: ["event-1"],
    input: "請續寫",
    output: "作品內容",
    licenseIds: ["license-owned"],
    adultMode: false,
    qualityScore: 90,
    piiStatus: "pending",
    licenseStatus: "pending",
    hallucinationStatus: "pending",
    contaminationStatus: "pending",
    approvalStatus: "pending",
  };
  const valid = approveTrainingExample(validateTrainingExample({ example: base, allowedLicenseIds: ["license-owned"], hallucinationFree: true, contaminationFree: true }), true);
  const pii = validateTrainingExample({ example: { ...base, exampleId: "pii", output: "token=sbp_abcdefghijklmnop" }, allowedLicenseIds: ["license-owned"], hallucinationFree: true, contaminationFree: true });
  assert.equal(pii.piiStatus, "failed");
  const adult = approveTrainingExample(validateTrainingExample({ example: { ...base, exampleId: "adult", adultMode: true, output: "adult fiction" }, allowedLicenseIds: ["license-owned"], hallucinationFree: true, contaminationFree: true }), true);
  assert.throws(() => sealTrainingDataset({ datasetId: "mixed", datasetVersion: 1, examples: [valid, adult], approvedBy: "owner" }), (error) => error.code === "DATASET_ADULT_NAMESPACE_MIXED");
  const sealed = sealTrainingDataset({ datasetId: "general", datasetVersion: 1, examples: [valid], approvedBy: "owner" });
  assert.equal(sealed.status, "sealed");
  assert.match(sealed.manifestHash, /^[a-f0-9]{64}$/);
});

test("agent OS exposes no raw reasoning and enforces tool scopes", async () => {
  const registry = new SovereignToolRegistry().register({
    toolId: "knowledge.retrieve",
    description: "project-bound retrieval",
    scopes: ["knowledge:retrieve"],
    localOnly: true,
    projectBound: true,
    execute: async () => ({ refs: ["knowledge-1"] }),
  });
  const runtime = {
    run: async ({ role }) => ({
      answer: `${role} 已完成受控分析。`,
      reasons: ["使用專案內證據"],
      alternatives: ["保留另一種解釋"],
      uncertainty: ["資料仍有限"],
      confidence: 82,
      claimEvidence: [
        { claim: "角色選擇會改變後續分支。", evidenceRefs: ["knowledge-1"], kind: "fact" },
        { claim: "第二個結論尚待查證。", evidenceRefs: ["missing-source"], kind: "fact" },
      ],
    }),
  };
  const engine = new SovereignReasoningEngine(registry, runtime);
  const result = await engine.run({
    requestId: "reasoning-1",
    projectId: "story-1",
    taskClass: "research",
    instruction: "比較兩種情節解法。",
    contextRefs: ["knowledge-1"],
    allowedToolIds: ["knowledge.retrieve"],
    permissionScopes: ["story:read", "knowledge:retrieve", "candidate:read", "story-bible:read", "evaluation:read"],
    maxAgentSteps: 4,
    maxCritiqueRounds: 1,
    timeoutMs: 5000,
    sourceDocuments: [{
      sourceRef: "knowledge-1",
      revision: "1",
      title: "作品規則",
      text: "角色選擇會改變後續分支。",
    }],
  });
  assert.equal(result.rawInternalReasoningExposed, false);
  assert.equal(result.externalRequestCount, 0);
  assert(result.agentsUsed.length <= 4);
  assert.equal(result.deliberativePlan.hypothesisCount, 3);
  assert.equal(result.sourceSynthesis?.citationCoverage, 0.5);
  assert.equal(result.sourceSynthesis?.unsupportedFactCount, 1);
  assert.throws(() => new SovereignToolRegistry().register({
    toolId: "shell.exec",
    description: "forbidden",
    scopes: ["shell"],
    localOnly: true,
    projectBound: true,
    execute: async () => null,
  }), (error) => error.code === "REASONING_TOOL_FORBIDDEN");
});

test("distillation requires a permitted sovereign teacher", () => {
  assert.throws(() => prepareDistillationJob({
    teacher: { modelId: "blocked", owner: "private_hub", license: "unknown", distillationPermitted: false, localOrPrivate: true, modelHash: "a".repeat(64) },
    studentBaseModel: "qwen-student",
    datasetVersion: "dataset-v1",
    sampleTaskIds: ["task-1"],
  }), (error) => error.code === "DISTILLATION_TEACHER_NOT_PERMITTED");
  const job = prepareDistillationJob({
    teacher: { modelId: "owned-teacher", owner: "user", license: "owner-approved", distillationPermitted: true, localOrPrivate: true, modelHash: "b".repeat(64) },
    studentBaseModel: "qwen-student",
    datasetVersion: "dataset-v1",
    sampleTaskIds: ["task-1"],
  });
  const sealed = attachVerifiedDemonstrations(job, [{ taskId: "task-1", output: "verified", deterministicVerified: true, qualityPassed: true }]);
  assert.equal(sealed.status, "dataset_sealed");
});

test("QLoRA never starts without a private training backend", async () => {
  const job = prepareQloraJob({
    baseModel: "qwen-base",
    baseModelLicense: "apache-2.0",
    datasetVersion: "dataset-v1",
    hyperparameters: { learningRate: 0.0002, rank: 16 },
    seed: 42,
    hardwareProfile: "private-gpu",
    previousApprovedModelId: null,
  });
  await assert.rejects(() => executeQloraAction(job, "train", null), (error) => error.code === "PRIVATE_TRAINING_BACKEND_NOT_CONNECTED");
  assert.equal(job.status, "prepared");
});

test("preference learning enforces amount, balance and namespace", () => {
  const pairs = Array.from({ length: 20 }, (_, index) => createPreferencePair({
    prompt: `prompt-${index}`,
    preferred: `preferred-${index}`,
    rejected: `rejected-${index}`,
    reason: "user choice",
    category: index % 2 ? "accepted_rejected" : "style",
    adultMode: false,
    approved: true,
  }));
  assert.equal(validatePreferenceDataset(pairs, "dpo").valid, true);
  assert.equal(validatePreferenceDataset(pairs.slice(0, 5), "dpo").errorCode, "PREFERENCE_DATA_INSUFFICIENT");
});

test("reward foundation is offline and detects reward hacking", () => {
  const weights = {
    continuityReward: 1, characterConsistencyReward: 1, timelineReward: 1, worldRuleReward: 1,
    plotCoherenceReward: 1, styleReward: 1, repetitionPenalty: -1, hallucinationPenalty: -2,
    citationReward: 1, userPreferenceReward: 1,
  };
  const reward = computeOfflineReward({ weights, metrics: {
    continuityReward: 1, characterConsistencyReward: 1, timelineReward: 1, worldRuleReward: 1,
    plotCoherenceReward: 1, styleReward: 1, repetitionPenalty: 0, hallucinationPenalty: 0,
    citationReward: 1, userPreferenceReward: 1,
  } });
  assert.equal(reward.offlineSimulationOnly, true);
  assert.equal(detectRewardHacking({ reward: 95, deterministicPassRate: 0.4, humanPreferenceRate: 0.4 }).suspected, true);
});

test("model registry requires approval and supports namespace-safe rollback", () => {
  const registry = new SovereignModelRegistry();
  const first = registry.register({
    baseModel: "qwen-base",
    adapter: null,
    datasetVersion: "base",
    trainingMethod: "base",
    capabilities: ["text"],
    adultMode: false,
    benchmark: { continuity: 80 },
    knownWeaknesses: [],
    license: "apache-2.0",
    hash: "a".repeat(64),
    previousApprovedModelId: null,
  });
  assert.throws(() => registry.transition(first.modelId, "active", false), (error) => error.code === "MODEL_USER_APPROVAL_REQUIRED");
  registry.transition(first.modelId, "approved", true);
  registry.transition(first.modelId, "active", true);
  const second = registry.register({
    baseModel: "qwen-base",
    adapter: "adapter-v2",
    datasetVersion: "dataset-v2",
    trainingMethod: "qlora",
    capabilities: ["text", "story"],
    adultMode: false,
    benchmark: { continuity: 88 },
    knownWeaknesses: [],
    license: "apache-2.0",
    hash: "b".repeat(64),
    previousApprovedModelId: first.modelId,
  });
  registry.transition(second.modelId, "approved", true);
  registry.transition(second.modelId, "active", true);
  assert.equal(registry.rollback("general", first.modelId, true).modelId, first.modelId);
});

test("persona preferences are viewable, editable, disableable, revertible and deletable", () => {
  const store = new PersonaPreferenceStore();
  const first = store.save({
    projectId: "persona-project",
    profile: "fiction_writer",
    source: "user_defined",
    reason: "使用者選擇小說創作語氣。",
  });
  const second = store.save({
    projectId: "persona-project",
    profile: "open_discussion",
    source: "learned_preference",
    reason: "使用者多次接受較直接的版本。",
  });
  assert.equal(store.list("persona-project").length, 2);
  assert.equal(second.profile.id, "open_discussion");
  assert.equal(store.disable("persona-project", "暫停人格偏好。").enabled, false);
  assert.equal(store.revert("persona-project", first.versionId, "回復使用者指定版本。").profile.id, "fiction_writer");
  assert.equal(store.delete("persona-project").deleted, 4);
  assert.equal(store.current("persona-project"), null);
});

test("persona benchmark contract covers six categories and five variants", () => {
  const cases = [
    "controversial_direct_answer",
    "rigorous_fact_analysis",
    "multi_view_comparison",
    "traditional_chinese_longform",
    "adult_fiction",
    "self_critique_revision",
  ];
  const results = cases.flatMap((category, caseIndex) =>
    PERSONA_BENCHMARK_VARIANTS.map((variant, variantIndex) => ({
      schemaVersion: PERSONA_BENCHMARK_SCHEMA_VERSION,
      caseId: `persona-case-${caseIndex + 1}`,
      variant,
      profileId: variant === "base" ? null : variant === "combined_sovereign_persona" ? "deep_reasoning" : "fiction_writer",
      output: "這是用於驗證評測資料契約的繁體中文候選內容，不代表真模型品質。",
      metrics: {
        directness: 70 + variantIndex,
        accuracy: 80,
        clarity: 82,
        structure: 81,
        creativity: category === "adult_fiction" ? 84 : 78,
        consistency: 83,
        overRefusal: 0,
        hallucination: 0,
        uncertaintyCalibration: 80,
        adultFictionQuality: category === "adult_fiction" ? 80 : 0,
      },
      evaluatorVersion: "p23a-deterministic-contract-evaluator-v1",
      modelId: "deterministic-contract-only",
      realModelExecution: false,
      externalRequestCount: 0,
    })),
  );
  assert.equal(results.length, 30);
  assert(results.every((result) => validatePersonaBenchmarkResult(result).valid));
  assert(results.every((result) => result.realModelExecution === false));
});

test("future story-to-media extension remains source-bound and candidate-only", () => {
  const candidate = createStoryMediaCandidatePackage({
    packageId: "media-package-1",
    requestId: "media-request-1",
    projectId: "story-1",
    projectRevision: "12",
    task: "story_to_storyboard",
    sourceRefs: [{
      sourceType: "chapter",
      sourceId: "chapter-7",
      revision: "3",
      evidenceExcerpt: "主角在雨夜踏入鐘樓。",
    }],
    characterContinuityRefs: ["character:hero@5"],
    worldContinuityRefs: ["world-rule:clock-tower@2"],
    storyboard: [{
      shotId: "shot-1",
      sourceRefIds: ["chapter-7"],
      visualIntent: "雨夜中的鐘樓遠景",
      continuityNotes: ["保留主角的黑色長外套"],
    }],
    mediaPrompt: "以雨夜鐘樓為場景建立電影分鏡。",
    now: "2026-07-25T00:00:00.000Z",
  });
  assert.equal(candidate.schemaVersion, STORY_MEDIA_EXTENSION_SCHEMA_VERSION);
  assert.equal(candidate.runtimeStatus, "contract_only");
  assert.equal(candidate.candidateStatus, "awaiting_approval");
  assert.equal(candidate.canonicalWriteAllowed, false);
  assert.equal(candidate.dataLeavesDevice, false);
  assert.equal(candidate.sourceRefs[0].revision, "3");
});

test("future media provider routing fails closed without a connected runtime", () => {
  assert.throws(() => resolveStoryMediaProvider({
    task: "video_generation",
    adultNamespace: "general",
    allowExternal: false,
    externalConsent: false,
    providers: [{
      providerId: "future-video-adapter",
      targetFamily: "user_authorized_media_provider",
      tasks: ["video_generation"],
      runtimeStatus: "not_connected",
      localOnly: false,
      requiresExternalConsent: true,
      supportsAdultNamespace: false,
      modelId: null,
    }],
  }), (error) => error.code === "MEDIA_PROVIDER_NOT_CONNECTED");
});

test("future media extension preserves privacy and adult namespace isolation", () => {
  assert.throws(() => createStoryMediaCandidatePackage({
    packageId: "media-package-adult",
    requestId: "media-request-adult",
    projectId: "story-adult",
    projectRevision: "4",
    task: "scene_to_video_prompt",
    provider: {
      providerId: "external-general-video",
      targetFamily: "user_authorized_media_provider",
      tasks: ["scene_to_video_prompt"],
      runtimeStatus: "ready",
      localOnly: false,
      requiresExternalConsent: true,
      supportsAdultNamespace: false,
      modelId: "future-model",
    },
    sourceRefs: [{
      sourceType: "chapter",
      sourceId: "chapter-adult",
      revision: "1",
      evidenceExcerpt: null,
    }],
    adultNamespace: "adult_verified",
    externalConsent: true,
  }), (error) => error.code === "MEDIA_ADULT_NAMESPACE_UNSUPPORTED");
});

for (const item of tests) {
  const started = Date.now();
  try {
    await item.run();
    results.push({ name: item.name, status: "PASS", elapsedMs: Date.now() - started });
  } catch (error) {
    results.push({ name: item.name, status: "FAIL", elapsedMs: Date.now() - started, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  }
}

const report = {
  suite: "P2.3 Sovereign Learning, Reasoning and Distillation Foundation",
  runAt: new Date().toISOString(),
  pass: results.filter((row) => row.status === "PASS").length,
  fail: results.filter((row) => row.status === "FAIL").length,
  skip: 0,
  realTrainingStarted: false,
  externalTeacherCalled: false,
  modelDownloaded: false,
  results,
};
const artifactDir = path.join(process.cwd(), "artifacts", "p23");
fs.mkdirSync(artifactDir, { recursive: true });
const output = JSON.stringify(report, null, 2);
fs.writeFileSync(path.join(artifactDir, "sovereign-foundation-tests.json"), output, "utf8");
fs.writeFileSync(path.join(artifactDir, "sovereign-foundation-tests.sha256"), `${crypto.createHash("sha256").update(output).digest("hex")}  sovereign-foundation-tests.json\n`, "utf8");
console.log(output);
if (report.fail) process.exitCode = 1;
