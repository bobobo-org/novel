import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  analyzeChapter,
  buildStoryBibleIntelligence,
  buildStoryContext,
  checkContinuity,
  estimateTokens,
  rankMemories,
  retrievalResultToMemory,
  validateSource,
} from "../lib/novel-ai/story-intelligence/index.ts";
import {
  ClosedStoryGenerationLoop,
  deterministicEvaluation,
  mergeModelEvaluation,
  packageGenerationCandidateForApproval,
} from "../lib/novel-ai/generation-loop/index.ts";
import {
  assertLearningRecordPrivate,
  createControlledLearningRecord,
} from "../lib/novel-ai/learning-data/index.ts";
import {
  PRIVATE_AI_HUB_CONTRACT_VERSION,
  validatePrivateHubRequest,
} from "../lib/novel-ai/providers/private-ai-hub/private-ai-hub.ts";
import { resolvePlatformProvider } from "../lib/novel-ai/router/platform-router.ts";
import { detectBrowserAI, runBrowserAI } from "../lib/novel-ai/providers/browser-ai/browser-ai-provider.ts";
import {
  PERSONA_PROFILES,
  evaluateOpenExpression,
  evaluateRigorousLanguage,
  personaRegistrySnapshot,
  validateAdultFictionContext,
  validatePersonaProfile,
} from "../lib/novel-ai/persona/index.ts";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { makeRecord } from "../lib/novel-ai/domain/common.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import {
  LONG_FANTASY_STORY,
  MULTI_CHARACTER_MYSTERY,
  SHORT_URBAN_STORY,
} from "../tests/fixtures/p22-story-benchmarks.ts";

const tests = [];
const results = [];
function test(name, run) { tests.push({ name, run }); }

function source(chapter, excerpt = chapter.content) {
  const start = chapter.content.indexOf(excerpt);
  return { sourceChapterId: chapter.chapterId, sourceRevision: chapter.sourceRevision, evidenceExcerpt: excerpt, start, end: start + excerpt.length };
}

function memories(chapters) {
  return chapters.map((chapter, index) => ({
    memoryId: `memory-${chapter.chapterId}`,
    kind: index === chapters.length - 1 ? "current_scene" : "recent_chapter",
    text: chapter.content,
    source: source(chapter),
    metadata: { projectId: chapter.projectId, chapterOrder: chapter.order, canonical: true, visibility: "project" },
    vectorScore: 0.6 + index * 0.1,
    recencyScore: 0.7 + index * 0.1,
  }));
}

class FixtureProvider {
  calls = [];
  external = false;
  async generate(request) {
    this.calls.push(request);
    if (request.signal?.aborted) throw Object.assign(new Error("cancelled"), { code: "GENERATION_CANCELLED" });
    if (request.taskType === "planning") {
      return this.response({ plan: ["承接目前線索", "讓主角採取行動", "產生可追蹤後果", "留下章尾問題"] }, request);
    }
    if (request.taskType === "evaluation") {
      return this.response({
        scores: [
          { dimension: "continuity", score: 92, reasons: ["遵守已知規則"], sources: [], evaluator: "model" },
          { dimension: "character_consistency", score: 90, reasons: ["角色目標一致"], sources: [], evaluator: "model" },
          { dimension: "plot_coherence", score: 88, reasons: ["因果清楚"], sources: [], evaluator: "model" },
          { dimension: "style_consistency", score: 86, reasons: ["語氣穩定"], sources: [], evaluator: "model" },
        ],
      }, request);
    }
    if (request.taskType === "revision") {
      return this.response(undefined, request, "林昭壓低呼吸，依照監視器只保留七天的規則，決定先取回車站影像。然而紅色刮痕旁新出現的指紋，迫使他改變計畫。他因此聯絡警方，並在午夜前留下可追查的備份。");
    }
    return this.response(undefined, request, "林昭壓低呼吸，依照監視器只保留七天的規則，決定先取回車站影像。然而紅色刮痕旁新出現的指紋，迫使他改變計畫。他因此聯絡警方，並在午夜前留下可追查的備份。");
  }
  response(structuredOutput, request, text = "") {
    return {
      provider: "local-ollama",
      model: "fixture-local-3b",
      text,
      structuredOutput,
      latencyMs: 2,
      estimatedInputTokens: 120,
      estimatedOutputTokens: 80,
      externalRequest: this.external,
      warnings: [],
    };
  }
}

test("extracts explicit character age with traceable evidence", () => {
  const result = analyzeChapter(SHORT_URBAN_STORY[0]);
  const age = result.candidates.find((row) => row.field === "age");
  assert(age);
  assert.equal(age.factType, "explicit");
  assert.equal(age.candidateStatus, "validated_candidate");
  assert(validateSource(age.sources[0], SHORT_URBAN_STORY[0]));
});

test("extracts world rules and open threads", () => {
  const result = analyzeChapter(SHORT_URBAN_STORY[0]);
  assert(result.candidates.some((row) => row.entityType === "world_rule"));
  assert(result.candidates.some((row) => row.entityType === "plot_thread"));
});

test("relative ambiguous timeline remains inferred", () => {
  const chapter = { ...SHORT_URBAN_STORY[1], content: "多年後，林昭返回車站。" };
  const result = analyzeChapter(chapter);
  const event = result.candidates.find((row) => row.entityType === "event");
  assert.equal(event?.factType, "inferred");
  assert.equal(event?.candidateStatus, "needs_review");
});

test("story bible preserves conflicting facts", () => {
  const changed = { ...SHORT_URBAN_STORY[1], content: "林昭今年三十五歲，目前身在舊醫院。" };
  const bible = buildStoryBibleIntelligence("fixture-urban", [SHORT_URBAN_STORY[0], changed]);
  const age = bible.facts.filter((row) => row.field === "age");
  assert.equal(age.length, 2);
  assert(age.every((row) => row.factType === "conflicted"));
});

test("dead character resurrection is blocking", () => {
  const bible = buildStoryBibleIntelligence("fixture-fantasy", LONG_FANTASY_STORY);
  const draftSource = source(LONG_FANTASY_STORY[1]);
  const report = checkContinuity({ canonicalFacts: bible.facts, draft: LONG_FANTASY_STORY[1].content, draftSource });
  assert(report.issues.some((row) => row.type === "world_rule_violation" && row.severity === "blocking"));
});

test("same revision location conflict is detected", () => {
  const result = analyzeChapter(MULTI_CHARACTER_MYSTERY[1]);
  const report = checkContinuity({ canonicalFacts: result.candidates, draft: "", draftSource: source(MULTI_CHARACTER_MYSTERY[1], "") });
  assert(report.issues.some((row) => row.type === "location_conflict"));
});

test("repeated long paragraph is rejected", () => {
  const paragraph = "林昭決定沿著唯一線索追查，並確認每一步都符合既有世界規則與人物目標。";
  const report = checkContinuity({ canonicalFacts: [], draft: `${paragraph}\n\n${paragraph}`, draftSource: { ...source(SHORT_URBAN_STORY[0]), evidenceExcerpt: `${paragraph}\n\n${paragraph}` } });
  assert(report.issues.some((row) => row.type === "repeated_content"));
});

test("memory ranking favors task-relevant canonical context", () => {
  const ranked = rankMemories("林昭 車站 監視器", memories(SHORT_URBAN_STORY));
  assert.equal(ranked[0].kind, "recent_chapter");
  assert(ranked.some((row) => row.kind === "current_scene"));
  assert(ranked.every((row) => row.selectedReason.length > 0));
});

test("context builder keeps source references", () => {
  const context = buildStoryContext({ task: "continue_writing", authorInstruction: "讓林昭追查監視器", memories: memories(SHORT_URBAN_STORY), tokenLimit: 1000, reservedOutput: 200 });
  assert(context.sourceReferences.length > 0);
  assert(context.sourceReferences.every((row) => row.sourceRevision));
});

test("hybrid retrieval result retains document revision and evidence position", () => {
  const result = {
    documentId: "urban-document",
    chunkId: "urban-document:chunk:1",
    textExcerpt: "林昭今年二十八歲，目前身在臺北車站",
    sourceType: "chapter",
    sourceId: "urban-1",
    branchId: "main",
    canonicalStatus: "approved",
    visibility: "private",
    finalScore: 0.9,
    scoreBreakdown: {
      keywordScore: 1,
      semanticScore: 0.8,
      metadataScore: 1,
      canonicalScore: 1,
      entityScore: 1,
      eventScore: 0,
      relationshipScore: 0,
      recencyScore: 0.8,
      continuityScore: 1,
      sourcePriorityScore: 1,
      branchScore: 1,
      visibilityScore: 1,
      diversityPenalty: 0,
      duplicatePenalty: 0,
      revertedPenalty: 0,
      deletedPenalty: 0,
      policyPenalty: 0,
    },
    matchedTerms: ["林昭"],
    matchedEntities: ["character:林昭"],
    matchedEvents: [],
    explanation: ["keyword=1"],
    warnings: [],
  };
  const memory = retrievalResultToMemory({
    projectId: "fixture-urban",
    result,
    document: {
      version_id: "urban-1-r1",
      chapter_id: "urban-1",
      content_hash: "hash",
      body: SHORT_URBAN_STORY[0].content,
    },
  });
  assert.equal(memory.source.sourceRevision, "urban-1-r1");
  assert(memory.source.start >= 0);
  assert.equal(SHORT_URBAN_STORY[0].content.slice(memory.source.start, memory.source.end), memory.source.evidenceExcerpt);
});

test("hybrid retrieval rejects an excerpt missing from the source document", () => {
  assert.throws(() => retrievalResultToMemory({
    projectId: "fixture-urban",
    result: {
      documentId: "urban-document",
      chunkId: "invalid-chunk",
      textExcerpt: "原始文件不存在的句子",
      sourceType: "chapter",
      sourceId: "urban-1",
      branchId: "main",
      canonicalStatus: "approved",
      visibility: "private",
      finalScore: 0.9,
      scoreBreakdown: {
        keywordScore: 1, semanticScore: 1, metadataScore: 1, canonicalScore: 1, entityScore: 0,
        eventScore: 0, relationshipScore: 0, recencyScore: 1, continuityScore: 1, sourcePriorityScore: 1,
        branchScore: 1, visibilityScore: 1, diversityPenalty: 0, duplicatePenalty: 0, revertedPenalty: 0,
        deletedPenalty: 0, policyPenalty: 0,
      },
      matchedTerms: [],
      matchedEntities: [],
      matchedEvents: [],
      explanation: [],
      warnings: [],
    },
    document: { version_id: "urban-1-r1", chapter_id: "urban-1", body: SHORT_URBAN_STORY[0].content },
  }), (error) => error.code === "RETRIEVAL_EVIDENCE_NOT_FOUND");
});

test("token budget never overflows", () => {
  const context = buildStoryContext({ task: "continue_writing", authorInstruction: "續寫", memories: [...memories(SHORT_URBAN_STORY), ...memories(LONG_FANTASY_STORY)], tokenLimit: 80, reservedOutput: 40 });
  assert(context.tokenBudget.used + context.tokenBudget.reservedOutput <= context.tokenBudget.limit);
  assert(context.tokenBudget.omittedMemoryIds.length > 0);
  assert(estimateTokens("繁體中文小說摘要") > 0);
});

test("generation loop produces three approval-only candidates", async () => {
  const provider = new FixtureProvider();
  const loop = new ClosedStoryGenerationLoop(provider);
  const bible = buildStoryBibleIntelligence("fixture-urban", SHORT_URBAN_STORY);
  const result = await loop.run({
    requestId: "generation-001",
    projectId: "fixture-urban",
    branchId: "main",
    taskType: "continue_writing",
    authorInstruction: "讓林昭追查監視器並留下新線索",
    currentText: SHORT_URBAN_STORY[1].content,
    currentChapterId: SHORT_URBAN_STORY[1].chapterId,
    sourceRevision: SHORT_URBAN_STORY[1].sourceRevision,
    storyRevision: 2,
    memories: memories(SHORT_URBAN_STORY),
    canonicalFacts: bible.facts,
    multiCandidate: true,
  });
  assert.equal(result.candidates.length, 3);
  assert(result.candidates.every((row) => row.status === "awaiting_approval"));
  assert.equal(result.canonicalMutationCount, 0);
  assert.equal(result.externalRequestCount, 0);
});

test("generation loop blocks external data transfer", async () => {
  const provider = new FixtureProvider();
  provider.external = true;
  const loop = new ClosedStoryGenerationLoop(provider);
  await assert.rejects(() => loop.run({
    requestId: "generation-external",
    projectId: "fixture-urban",
    branchId: "main",
    taskType: "continue_writing",
    authorInstruction: "續寫",
    currentText: "",
    currentChapterId: "urban-2",
    sourceRevision: "urban-2-r1",
    storyRevision: 1,
    memories: memories(SHORT_URBAN_STORY),
    canonicalFacts: [],
  }), (error) => error.code === "CLOSED_GENERATION_EXTERNAL_REQUEST_BLOCKED");
});

test("generation cancellation stops before provider work", async () => {
  const controller = new AbortController();
  controller.abort();
  const provider = new FixtureProvider();
  const loop = new ClosedStoryGenerationLoop(provider);
  await assert.rejects(() => loop.run({
    requestId: "generation-cancel",
    projectId: "fixture-urban",
    branchId: "main",
    taskType: "continue_writing",
    authorInstruction: "續寫",
    currentText: "",
    currentChapterId: "urban-2",
    sourceRevision: "urban-2-r1",
    storyRevision: 1,
    memories: [],
    canonicalFacts: [],
    signal: controller.signal,
  }), (error) => error.code === "GENERATION_CANCELLED");
  assert.equal(provider.calls.length, 0);
});

test("generation context always includes the current source revision", async () => {
  const provider = new FixtureProvider();
  const loop = new ClosedStoryGenerationLoop(provider);
  const chapter = SHORT_URBAN_STORY[1];
  const result = await loop.run({
    requestId: "generation-current-scene",
    projectId: chapter.projectId,
    branchId: "main",
    taskType: "continue_writing",
    authorInstruction: "承接目前場景。",
    currentText: chapter.content,
    currentChapterId: chapter.chapterId,
    sourceRevision: chapter.sourceRevision,
    storyRevision: 2,
    memories: [],
    canonicalFacts: [],
  });
  assert.equal(result.candidates[0].retrievedMemory.currentScene[0]?.text, chapter.content);
  assert.equal(result.candidates[0].retrievedMemory.currentScene[0]?.source.sourceRevision, chapter.sourceRevision);
});

test("generation reports the real multi-stage workflow", async () => {
  const provider = new FixtureProvider();
  const loop = new ClosedStoryGenerationLoop(provider);
  const events = [];
  await loop.run({
    requestId: "generation-progress",
    projectId: "fixture-urban",
    branchId: "main",
    taskType: "continue_writing",
    authorInstruction: "承接目前線索。",
    currentText: SHORT_URBAN_STORY[1].content,
    currentChapterId: SHORT_URBAN_STORY[1].chapterId,
    sourceRevision: SHORT_URBAN_STORY[1].sourceRevision,
    storyRevision: 2,
    memories: [],
    canonicalFacts: [],
    onProgress: (event) => events.push(event),
  });
  for (const stage of ["task_understanding", "memory_retrieval", "planning", "draft_generation", "continuity_evaluation", "character_evaluation", "plot_evaluation", "style_evaluation", "revision", "candidate_packaging"]) {
    assert(events.some((event) => event.stage === stage), `missing progress stage ${stage}`);
  }
});

test("generation rejects a candidate when the source revision changes in flight", async () => {
  const provider = new FixtureProvider();
  const loop = new ClosedStoryGenerationLoop(provider);
  let revisionChecks = 0;
  await assert.rejects(() => loop.run({
    requestId: "generation-stale-source",
    projectId: "fixture-urban",
    branchId: "main",
    taskType: "continue_writing",
    authorInstruction: "承接目前線索。",
    currentText: SHORT_URBAN_STORY[1].content,
    currentChapterId: SHORT_URBAN_STORY[1].chapterId,
    sourceRevision: SHORT_URBAN_STORY[1].sourceRevision,
    storyRevision: 2,
    memories: [],
    canonicalFacts: [],
    getCurrentSourceRevision: () => ++revisionChecks === 1 ? SHORT_URBAN_STORY[1].sourceRevision : "urban-2-r2",
  }), (error) => error.code === "GENERATION_SOURCE_REVISION_STALE");
});

test("deterministic continuity evidence overrides an optimistic model score", () => {
  const bible = buildStoryBibleIntelligence("fixture-fantasy", LONG_FANTASY_STORY);
  const draft = LONG_FANTASY_STORY[1].content;
  const input = {
    requestId: "evaluation-disagreement",
    projectId: "fixture-fantasy",
    branchId: "main",
    taskType: "continue_writing",
    authorInstruction: "續寫。",
    currentText: draft,
    currentChapterId: LONG_FANTASY_STORY[1].chapterId,
    sourceRevision: LONG_FANTASY_STORY[1].sourceRevision,
    storyRevision: 2,
    memories: [],
    canonicalFacts: bible.facts,
  };
  const deterministic = deterministicEvaluation(input, draft);
  const merged = mergeModelEvaluation(deterministic, {
    scores: [{ dimension: "continuity", score: 100, reasons: ["模型未看出矛盾"], sources: [], evaluator: "model" }],
  }, source(LONG_FANTASY_STORY[1]));
  assert(merged.disagreements.some((row) => row.dimension === "continuity" && row.resolution === "deterministic_wins"));
  assert.equal(merged.passed, false);
});

test("all six sovereign persona profiles are versioned and valid", () => {
  const snapshot = personaRegistrySnapshot();
  assert.equal(snapshot.profiles.length, 6);
  assert(snapshot.profiles.every((profile) => validatePersonaProfile(profile).valid));
  assert.equal(PERSONA_PROFILES.fiction_writer.narrativeFreedom, 100);
  assert.equal(PERSONA_PROFILES.deep_reasoning.evidenceStrictness, 100);
});

test("open expression detects empty refusal without penalizing direct fiction", () => {
  const refused = evaluateOpenExpression("作為 AI，我不能處理任何黑暗題材。", { fictional: true, requestedSensitiveTheme: true });
  const direct = evaluateOpenExpression("主角承認自己為權力犧牲朋友，並承擔背叛造成的後果。", { fictional: true, requestedSensitiveTheme: true });
  assert.equal(refused.overRefusal, true);
  assert.equal(direct.passed, true);
});

test("rigorous language evaluator is evidence-bearing and fiction-aware", () => {
  const clean = evaluateRigorousLanguage({
    text: "雨像遲到的證詞，沿著窗框一行行滑下。林昭沒有回答，只把錄音筆推向桌面中央。",
    taskInstruction: "以第三人稱延續審訊場景。",
    expectedViewpoint: "third_person",
    sources: [source(SHORT_URBAN_STORY[0])],
    fictionMode: true,
  });
  const malformed = evaluateRigorousLanguage({
    text: "TODO\n\n這是一段重複而且足夠長的測試段落，用來確認重複內容會被辨識。\n\n這是一段重複而且足夠長的測試段落，用來確認重複內容會被辨識。",
    taskInstruction: "續寫。",
    sources: [source(SHORT_URBAN_STORY[0])],
    fictionMode: true,
  });
  assert(clean.score >= 90);
  assert.equal(clean.evidence.length, 1);
  assert(malformed.issues.some((issue) => issue.code === "PLACEHOLDER_TEXT"));
  assert(malformed.issues.some((issue) => issue.code === "REPEATED_PARAGRAPH"));
});

test("adult fiction persona requires explicit adult and isolation gates", async () => {
  const valid = validateAdultFictionContext({
    enabled: true,
    userAgeConfirmed: true,
    projectAdultMode: true,
    characters: [{ characterId: "char-a", age: 28, ageExplicit: true }],
    consentState: "active",
    isolatedIndex: true,
    excludeFromSharedLearning: true,
  });
  assert.equal(valid.valid, true);
  const provider = new FixtureProvider();
  const loop = new ClosedStoryGenerationLoop(provider);
  await assert.rejects(() => loop.run({
    requestId: "adult-invalid",
    projectId: "adult-project",
    branchId: "main",
    taskType: "continue_writing",
    authorInstruction: "延續成人戀愛場景。",
    currentText: "兩名角色回到房間。",
    currentChapterId: "adult-1",
    sourceRevision: "adult-1-r1",
    storyRevision: 1,
    memories: [],
    canonicalFacts: [],
    personaProfile: "adult_fiction",
    adultFictionContext: {
      enabled: true,
      userAgeConfirmed: true,
      projectAdultMode: true,
      characters: [{ characterId: "char-unknown", age: null, ageExplicit: false }],
      consentState: "active",
      isolatedIndex: true,
      excludeFromSharedLearning: true,
    },
  }), (error) => error.errorCode === "ADULT_FICTION_CONTEXT_REJECTED");
  assert.equal(provider.calls.length, 0);
});

test("combined persona candidate exposes only a concise reasoning summary", async () => {
  const provider = new FixtureProvider();
  const loop = new ClosedStoryGenerationLoop(provider);
  const result = await loop.run({
    requestId: "persona-combined",
    projectId: "fixture-urban",
    branchId: "main",
    taskType: "continue_writing",
    authorInstruction: "直接推進衝突，但遵守既有監視器規則。",
    currentText: SHORT_URBAN_STORY[1].content,
    currentChapterId: SHORT_URBAN_STORY[1].chapterId,
    sourceRevision: SHORT_URBAN_STORY[1].sourceRevision,
    storyRevision: 2,
    memories: memories(SHORT_URBAN_STORY),
    canonicalFacts: buildStoryBibleIntelligence("fixture-urban", SHORT_URBAN_STORY).facts,
    personaProfile: "deep_reasoning",
  });
  const candidate = result.candidates[0];
  assert.equal(candidate.personaProfile.id, "deep_reasoning");
  assert(candidate.reasoningSummary.aiUnderstanding);
  assert(candidate.reasoningSummary.mainPlan.length > 0);
  assert.equal("rawChainOfThought" in candidate.reasoningSummary, false);
  assert(candidate.languageEvaluation.score >= 70);
});

test("adult learning records remain independently excluded from shared export", () => {
  const record = createControlledLearningRecord({
    projectId: "adult-private",
    candidateId: "candidate-adult",
    taskType: "continue",
    promptProfile: "adult_fiction",
    retrievedContextRefs: [],
    candidateText: "private adult manuscript",
    accepted: true,
    rejected: false,
    provider: "local-ollama",
    model: "qwen2.5:3b",
    storyRevision: 1,
    consent: "shared_opt_in",
    adultMode: true,
    adultLearningExcluded: true,
    personaProfile: PERSONA_PROFILES.adult_fiction,
    directnessPreference: 90,
    languagePrecisionScore: 91,
    reasoningDepth: 80,
  });
  assert.equal(record.exportEligible, false);
  assert.equal(record.adultLearningExcluded, true);
});

test("platform router limits Browser AI to summary", () => {
  const providers = [
    { id: "browser-ai", status: "ready", capabilities: ["text", "offline"], modelId: "browser", maxContext: 16000, local: true, requiresInternet: false, taskTypes: ["story.summary"] },
    { id: "local-ollama", status: "ready", capabilities: ["text", "offline"], modelId: "qwen2.5:3b", maxContext: 32000, local: true, requiresInternet: false },
  ];
  const common = { requestId: "route-1", projectId: "p", privacyMode: "strict-local", input: "x", context: [], externalConsent: false, closedOnly: true, offlineRequired: true };
  assert.equal(resolvePlatformProvider({ ...common, taskType: "story.summary" }, providers).providerId, "browser-ai");
  assert.equal(resolvePlatformProvider({ ...common, taskType: "chapter.continue" }, providers).providerId, "local-ollama");
});

test("Browser AI executes a real injected browser summary runtime contract", async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const summarizerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Summarizer");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage: { estimate: async () => ({ quota: 1024, usage: 128 }) } },
  });
  Object.defineProperty(globalThis, "Summarizer", {
    configurable: true,
    value: {
      availability: async () => "available",
      create: async () => ({
        summarize: async () => "林昭在車站追查監視器，並發現紅色刮痕這項新線索。",
        destroy() {},
      }),
    },
  });
  try {
    const capability = await detectBrowserAI();
    assert.equal(capability.status, "ready");
    const decision = {
      providerId: "browser-ai",
      modelId: "chrome-built-in-summarizer",
      privacyMode: "strict-local",
      reason: "test",
      contextSources: [],
      externalRequest: false,
      dataLeavesDevice: false,
      fallbackChain: [],
      warnings: [],
    };
    const result = await runBrowserAI({
      requestId: "browser-summary",
      projectId: "fixture-urban",
      taskType: "story.summary",
      privacyMode: "strict-local",
      input: SHORT_URBAN_STORY[0].content,
      context: [],
      externalConsent: false,
      closedOnly: true,
      offlineRequired: true,
    }, decision);
    assert.match(result.content, /林昭/);
    assert.equal(result.dataLeavesDevice, false);
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else delete globalThis.window;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
    if (summarizerDescriptor) Object.defineProperty(globalThis, "Summarizer", summarizerDescriptor);
    else delete globalThis.Summarizer;
  }
});

test("Browser AI executes the packaged model when the native Summarizer is unavailable", async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const summarizerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Summarizer");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage: { estimate: async () => ({ quota: 2048, usage: 256 }) } },
  });
  delete globalThis.Summarizer;
  try {
    const capability = await detectBrowserAI();
    assert.equal(capability.status, "ready");
    assert.equal(capability.reason, "browser_hybrid_runtime_packaged_ready");
    assert.equal(capability.modelId, "novel-browser-task-runtime-v2");
    const decision = {
      providerId: "browser-ai",
      modelId: "novel-browser-task-runtime-v2",
      privacyMode: "strict-local",
      reason: "packaged fallback test",
      contextSources: [],
      externalRequest: false,
      dataLeavesDevice: false,
      fallbackChain: [],
      warnings: [],
    };
    const result = await runBrowserAI({
      requestId: "browser-packaged-summary",
      projectId: "fixture-browser-packaged",
      taskType: "story.summary",
      privacyMode: "strict-local",
      input: "林昭進入圖書館。她發現帳冊失蹤，並在窗邊找到濕泥腳印。守門人聲稱沒有人進出。",
      context: [],
      externalConsent: false,
      closedOnly: true,
      offlineRequired: true,
    }, decision);
    assert.equal(result.modelId, "novel-browser-task-runtime-v2");
    assert.equal(result.content, "她發現帳冊失蹤，並在窗邊找到濕泥腳印。");
    assert.equal(result.externalRequest, false);
    assert.equal(result.dataLeavesDevice, false);
    assert.match(result.provenance.warnings.join("\n"), /packaged browser task model used/);
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else delete globalThis.window;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
    if (summarizerDescriptor) Object.defineProperty(globalThis, "Summarizer", summarizerDescriptor);
    else delete globalThis.Summarizer;
  }
});

test("Browser AI capability probe fails over when the native Summarizer hangs", async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const summarizerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Summarizer");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage: { estimate: async () => ({ quota: 4096, usage: 512 }) } },
  });
  Object.defineProperty(globalThis, "Summarizer", {
    configurable: true,
    value: {
      availability: async () => new Promise(() => {}),
      create: async () => {
        throw new Error("native runtime must not be selected after a timed-out probe");
      },
    },
  });
  try {
    const startedAt = Date.now();
    const capability = await detectBrowserAI();
    assert(Date.now() - startedAt < 3_000);
    assert.equal(capability.status, "ready");
    assert.equal(capability.reason, "browser_hybrid_runtime_packaged_ready");
    assert.equal(capability.modelId, "novel-browser-task-runtime-v2");
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else delete globalThis.window;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
    if (summarizerDescriptor) Object.defineProperty(globalThis, "Summarizer", summarizerDescriptor);
    else delete globalThis.Summarizer;
  }
});

test("closed-only router never selects external provider", () => {
  const providers = [{ id: "gemini", status: "ready", capabilities: ["text"], modelId: "external", maxContext: 100000, local: false, requiresInternet: true }];
  assert.throws(() => resolvePlatformProvider({
    requestId: "route-closed",
    projectId: "p",
    taskType: "chapter.continue",
    privacyMode: "external-allowed",
    input: "x",
    context: [],
    externalConsent: true,
    closedOnly: true,
  }, providers), (error) => error.code === "NO_CLOSED_PROVIDER_AVAILABLE");
});

test("private hub contract validates scope, hash, and expiry", () => {
  const result = validatePrivateHubRequest({
    contractVersion: PRIVATE_AI_HUB_CONTRACT_VERSION,
    requestId: "private-1",
    ownerId: "owner",
    projectId: "project",
    taskType: "multi_chapter_plan",
    scopes: ["story:read", "candidate:write"],
    payloadHash: "a".repeat(64),
    contextRefs: ["chapter-1"],
    quotaClass: "batch",
    stream: true,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(result.valid, true);
});

test("private learning does not persist novel text", () => {
  const record = createControlledLearningRecord({
    projectId: "private-project",
    candidateId: "candidate",
    taskType: "continue",
    promptProfile: "p22",
    retrievedContextRefs: ["chapter-1"],
    candidateText: "私人小說正文",
    accepted: true,
    rejected: false,
    provider: "local-ollama",
    model: "qwen2.5:3b",
    storyRevision: 1,
  });
  assert.equal(record.candidateText, null);
  assert.equal(record.exportEligible, false);
  assertLearningRecordPrivate(record);
});

test("shared opt-in learning redacts credentials", () => {
  const record = createControlledLearningRecord({
    projectId: "private-project",
    candidateId: "candidate",
    taskType: "continue",
    promptProfile: "p22",
    retrievedContextRefs: [],
    candidateText: "token=super-secret-value-123456",
    accepted: true,
    rejected: false,
    provider: "local-ollama",
    model: "qwen2.5:3b",
    storyRevision: 1,
    consent: "shared_opt_in",
  });
  assert(!record.candidateText?.includes("super-secret"));
  assert.equal(record.exportEligible, true);
});

test("Ollama task prompts are valid Traditional Chinese and include context", () => {
  const providerSource = fs.readFileSync("lib/novel-ai/providers/ollama/ollama-provider.ts", "utf8");
  assert.match(providerSource, /繁體中文小說助手/);
  assert.match(providerSource, /最近正文與摘要/);
  assert.match(providerSource, /Story Bible 與相關記憶/);
  assert(!providerSource.includes("\uFFFD"));
  assert(!providerSource.includes("隢"));
});

test("generation candidate enters existing atomic approval transaction", async () => {
  const draft = createDraft("quick");
  draft.title = "P2.2 測試作品";
  draft.coreIdea = { value: "城市懸疑", status: "user_defined", source: "user", updatedAt: new Date().toISOString() };
  const bundle = buildProjectBundle(draft);
  const repository = new MemoryNovelRepository();
  await repository.createProject(bundle, "create-p22");
  const chapter = {
    ...makeRecord(bundle.project.id),
    id: "approval-chapter",
    title: "第一章",
    order: 1,
    content: "林昭走進車站。",
    summary: null,
    status: "draft",
  };
  await repository.put("chapters", chapter);
  const provider = new FixtureProvider();
  const loop = new ClosedStoryGenerationLoop(provider);
  const generated = await loop.run({
    requestId: "approval-generation",
    projectId: bundle.project.id,
    branchId: "main",
    taskType: "continue_writing",
    authorInstruction: "續寫調查",
    currentText: chapter.content,
    currentChapterId: chapter.id,
    sourceRevision: `chapter:${chapter.revision}`,
    storyRevision: bundle.project.revision,
    memories: memories(SHORT_URBAN_STORY),
    canonicalFacts: [],
  });
  const candidate = packageGenerationCandidateForApproval({
    candidate: generated.candidates[0],
    chapterId: chapter.id,
    chapterRevision: chapter.revision,
    storyStateRevision: bundle.storyState.revision,
    storyBibleRevision: bundle.storyBible.revision,
  });
  await repository.put("candidates", candidate);
  const accepted = await repository.acceptChoiceTransaction({
    operationId: "operation-p22",
    idempotencyKey: "idempotency-p22",
    projectId: bundle.project.id,
    chapterId: chapter.id,
    candidateId: candidate.id,
    acceptedText: candidate.text,
    expectedProjectRevision: bundle.project.revision,
    expectedChapterRevision: chapter.revision,
    expectedCandidateRevision: candidate.revision,
    expectedStoryStateRevision: bundle.storyState.revision,
    expectedStoryBibleRevision: bundle.storyBible.revision,
  });
  assert.equal(accepted.replayed, false);
  const replay = await repository.acceptChoiceTransaction({
    operationId: "operation-p22",
    idempotencyKey: "idempotency-p22",
    projectId: bundle.project.id,
    chapterId: chapter.id,
    candidateId: candidate.id,
    acceptedText: candidate.text,
    expectedProjectRevision: bundle.project.revision,
    expectedChapterRevision: chapter.revision,
    expectedCandidateRevision: candidate.revision,
    expectedStoryStateRevision: bundle.storyState.revision,
    expectedStoryBibleRevision: bundle.storyBible.revision,
  });
  assert.equal(replay.replayed, true);
  assert.equal((await repository.listAcceptedChoices(bundle.project.id)).length, 1);
  assert.equal((await repository.listStoryBranches(bundle.project.id)).length, 1);
});

test("backup round-trip retains Story Bible and accepted interaction", async () => {
  const draft = createDraft("blank");
  const bundle = buildProjectBundle(draft);
  const repository = new MemoryNovelRepository();
  await repository.createProject(bundle, "backup-create");
  const payload = await repository.exportProject(bundle.project.id);
  const copyId = await repository.importProject(payload, "copy");
  const copiedBible = await repository.list("storyBibles", copyId);
  assert.equal(copiedBible.length, 1);
  assert.notEqual(copyId, bundle.project.id);
});

for (const item of tests) {
  const started = performance.now();
  try {
    await item.run();
    results.push({ name: item.name, status: "PASS", elapsedMs: Math.round(performance.now() - started) });
  } catch (error) {
    results.push({ name: item.name, status: "FAIL", elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  }
}

const summary = {
  suite: "P2.2 Story Intelligence and Generation Loop",
  runAt: new Date().toISOString(),
  pass: results.filter((row) => row.status === "PASS").length,
  fail: results.filter((row) => row.status === "FAIL").length,
  skip: 0,
  results,
};
const outputDirectory = path.resolve("artifacts/p22");
fs.mkdirSync(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "core-test-results.json");
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
const sha = crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex");
fs.writeFileSync(path.join(outputDirectory, "core-test-results.sha256"), `${sha}  core-test-results.json\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
if (summary.fail) process.exitCode = 1;
