import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  MAX_PUBLIC_STORY_RESEARCH_TOP_K,
  MAX_VALIDATED_CAUSAL_SNAPSHOT_RULES,
  PUBLIC_STORY_RESEARCH_RUNTIME_INDEX_V1,
  PUBLIC_STORY_RESEARCH_RUNTIME_SNAPSHOT_V1,
  PUBLIC_STORY_RESEARCH_SEED_V1,
  PUBLIC_STORY_RESEARCH_SHARED_LIBRARY_V1,
  SHARED_STORY_EXPERIENCE_MODES,
  TEN_CAUSAL_DIMENSIONS,
  createValidatedCausalResearchSnapshot,
  getPublicStoryResearchLearningRuleDrafts,
  recordAbstractCausalRuleFeedback,
  retrieveCausalTeacherResearchRules,
  retrievePublicStoryResearchRules,
  validatePublicStoryResearchSeed,
} from "../lib/novel-ai/sovereign-learning/public-story-research/index.ts";
import {
  getModeChoiceCurriculum,
} from "../lib/novel-ai/sovereign-learning/mode-choice-causal-curriculum.ts";

const tests = [];
const results = [];
let benchmark = null;

function test(name, run) {
  tests.push({ name, run });
}

function errorCode(expected) {
  return (error) => error?.code === expected;
}

function assertTenDimensions(payload) {
  assert.deepEqual(Object.keys(payload), [...TEN_CAUSAL_DIMENSIONS]);
  for (const dimension of TEN_CAUSAL_DIMENSIONS) {
    assert.equal(payload[dimension].dimension, dimension);
    assert(payload[dimension].operation.length >= 8);
  }
}

function ruleIds(result) {
  return result.hits.map((hit) => hit.rule.ruleId);
}

test("versioned seed validates exact ten-dimensional schema", () => {
  const validation = validatePublicStoryResearchSeed();
  assert.deepEqual(validation.errorCodes, []);
  assert.equal(validation.valid, true);
  assert.equal(PUBLIC_STORY_RESEARCH_SEED_V1.seedVersion, "2026-08-23.1");
  assert.deepEqual(PUBLIC_STORY_RESEARCH_SEED_V1.tenDimensionSchema, [...TEN_CAUSAL_DIMENSIONS]);
  assert(validation.primaryResearchSourceCount >= 2);
  for (const rule of PUBLIC_STORY_RESEARCH_SEED_V1.inferenceRules) {
    assertTenDimensions(rule.tenDimensions);
  }
});

test("official sources and original studies are traceable without retained source expression", () => {
  const platforms = new Set(PUBLIC_STORY_RESEARCH_SEED_V1.sources.map((source) => source.platform));
  for (const required of [
    "project_gutenberg",
    "royal_road",
    "youtube",
    "meta_facebook",
    "meta_instagram",
    "peer_reviewed_research",
  ]) assert(platforms.has(required), `missing ${required}`);
  const studies = PUBLIC_STORY_RESEARCH_SEED_V1.sources.filter((source) =>
    source.sourceType === "peer_reviewed_original_research");
  assert(studies.length >= 2);
  for (const source of PUBLIC_STORY_RESEARCH_SEED_V1.sources) {
    assert(source.url.startsWith("https://") || source.url.startsWith("urn:novel:"));
    assert(source.sourceFacts.length > 0);
    assert.equal(source.rights.sourceTextCopied, false);
    assert.equal(source.rights.storyExpressionUsed, false);
    assert.equal(source.robots.automatedCollectionPerformed, false);
    assert.equal(source.robots.robotsOrLoginBypass, false);
    assert(Object.values(source.retention).every((value) => value === false));
    assert(source.provenance.publisher);
    assert(source.provenance.citationTitle);
  }
});

test("source facts and inference rules remain separate evidence planes", () => {
  const factIds = new Set(PUBLIC_STORY_RESEARCH_SEED_V1.sources.flatMap((source) =>
    source.sourceFacts.map((fact) => fact.factId)));
  for (const source of PUBLIC_STORY_RESEARCH_SEED_V1.sources) {
    assert.equal("inferenceRules" in source, false);
    assert(source.sourceFacts.every((fact) => fact.factKind !== undefined));
  }
  for (const rule of PUBLIC_STORY_RESEARCH_SEED_V1.inferenceRules) {
    assert.equal("sourceFacts" in rule, false);
    assert(rule.sourceFactRefs.every((factRef) => factIds.has(factRef)));
    assert.equal(rule.autoApprove, false);
    assert.equal(rule.outcomeGuarantee, false);
  }
  const adapted = retrieveCausalTeacherResearchRules({
    query: "causal event connection",
    experience: "rpg",
    consumer: "planner",
    topK: 2,
  });
  assert(adapted.sourceEvidence.every((source) => Array.isArray(source.facts)));
  assert(adapted.candidates.every((candidate) => !("facts" in candidate)));
});

test("serialized seed contains no novel post video transcript dialogue or reconstructable plot fields", () => {
  const serialized = JSON.stringify(PUBLIC_STORY_RESEARCH_SEED_V1);
  for (const prohibitedKey of [
    "rawText",
    "rawContent",
    "sourceContent",
    "storyText",
    "originalText",
    "excerpt",
    "transcript",
    "postBody",
    "videoBody",
    "dialogue",
    "characterName",
    "plotSummary",
    "chainOfThought",
  ]) {
    assert.equal(serialized.includes(`\"${prohibitedKey}\":`), false, prohibitedKey);
  }
  assert.equal(PUBLIC_STORY_RESEARCH_SEED_V1.retention.sourceTextRetained, false);
  assert.equal(PUBLIC_STORY_RESEARCH_RUNTIME_INDEX_V1.rawSourceDocumentCount, 0);
});

test("popular and short-drama mechanisms are triggerable experiments, never viral laws", () => {
  const popular = PUBLIC_STORY_RESEARCH_SEED_V1.inferenceRules.find((rule) =>
    rule.mechanismClass === "popular_short_drama_experiment");
  assert(popular);
  assert(["inference", "experiment"].includes(popular.claimKind));
  assert(popular.triggerParameters.length >= 5);
  assert(popular.triggerParameters.every((parameter) => parameter.experimentOnly));
  assert.equal(popular.outcomeGuarantee, false);
  assert(popular.guardrails.some((guardrail) => guardrail.includes("爆紅")));
  const retrieved = retrievePublicStoryResearchRules({
    query: "熱門 爽劇 short drama hook retention 轉折",
    experience: "rpg",
    consumer: "story",
    topK: 99,
  });
  assert(ruleIds(retrieved).includes(popular.ruleId));
  assert(retrieved.hits.length <= MAX_PUBLIC_STORY_RESEARCH_TOP_K);
});

test("anti-despair failure-forward cost preview relief and distinct choices are Top-K retrievable", () => {
  const cases = [
    ["recovery steady 復原 穩態 可負擔", "policy.anti-despair-affordable-recovery"],
    ["failure-forward 失敗推進 information relationship resource ability opportunity", "policy.failure-forward-positive-carry"],
    ["major cost forewarning 重大代價 預告", "policy.major-cost-forewarning"],
    ["consecutive setback relief weight 連續挫敗 緩衝", "policy.consecutive-setback-relief-weight"],
    ["A/B/C three choices distinct state 三選項 差異後果", "policy.three-choice-distinct-state"],
  ];
  for (const [query, expectedRuleId] of cases) {
    const retrieved = retrievePublicStoryResearchRules({
      query,
      experience: "rpg",
      consumer: "choice",
      topK: 8,
    });
    assert(ruleIds(retrieved).includes(expectedRuleId), `${expectedRuleId} not retrieved`);
    assert.equal(retrieved.trace.sharedLibraryScanCount, 0);
    assert.equal(retrieved.trace.rawSourceDocumentsLoaded, 0);
  }
});

test("RPG romance and management receive mode-fit complete teacher candidates", () => {
  const cases = [
    ["rpg", "RPG agency resource ability", "mode.rpg-agency-resource-choice"],
    ["romance", "romance relationship tension trust boundary repair", "mode.romance-tension-boundary-repair"],
    ["management", "management resource leverage deadline tradeoff", "mode.management-pressure-leverage-loop"],
  ];
  for (const [experience, query, expectedRuleId] of cases) {
    const adapted = retrieveCausalTeacherResearchRules({
      query,
      experience,
      consumer: "choice",
      topK: 4,
    });
    const candidate = adapted.candidates.find((item) => item.ruleId === expectedRuleId);
    assert(candidate, `${expectedRuleId} not adapted`);
    assert.equal(candidate.experience, experience);
    assert.equal(candidate.status, "candidate");
    assert.equal(candidate.humanReviewRequired, true);
    assert.equal(candidate.modelWeightTraining, false);
    assert.equal(candidate.capabilitySemantics, "knowledge_retrieval_and_rule_weight_learning");
    assertTenDimensions(candidate.tenDimensions);
    assert(candidate.provenance.sourceIds.length >= 1);
    assert(candidate.provenance.urls.length >= 1);
  }
});

test("mode-choice curriculum merges the bounded public research snapshot", () => {
  for (const mode of SHARED_STORY_EXPERIENCE_MODES) {
    const curriculum = getModeChoiceCurriculum(mode, 7);
    assert(curriculum.publicResearch.candidates.length >= 1);
    assert(curriculum.publicResearch.candidates.length <= MAX_PUBLIC_STORY_RESEARCH_TOP_K);
    assert(curriculum.publicResearch.candidates.every((candidate) => candidate.experience === mode));
    assert.equal(curriculum.publicResearch.pipeline.runtimeNetworkRequests, 0);
    assert.deepEqual(curriculum.publicResearch.pipeline.stages, [
      "shared_approved_abstract_library",
      "validated_bounded_snapshot",
      "closed_ai_runtime_top_k",
    ]);
    assert.equal(curriculum.selection.entireLearningLibraryScanned, false);
    assert.equal(
      curriculum.selection.combinedRuntimeRuleLimit,
      curriculum.selection.topKLimit + MAX_PUBLIC_STORY_RESEARCH_TOP_K,
    );
  }
  const sharedDrafts = getPublicStoryResearchLearningRuleDrafts();
  assert.equal(sharedDrafts.length, PUBLIC_STORY_RESEARCH_RUNTIME_SNAPSHOT_V1.entries.length);
  assert(sharedDrafts.every((draft) => draft.parameters.modelWeightTraining === false));
  assert(sharedDrafts.every((draft) => draft.parameters.tenDimensions === TEN_CAUSAL_DIMENSIONS.join("|")));
  assert(sharedDrafts.every((draft) => draft.longestSourceMatch === 0));
});

test("planner and closure consumers retrieve foreshadow payoff and story closure rules", () => {
  for (const consumer of ["planner", "closure"]) {
    const adapted = retrieveCausalTeacherResearchRules({
      query: "伏筆 回收 foreshadow payoff continuity closure 收束",
      experience: "rpg",
      consumer,
      topK: 3,
    });
    const candidate = adapted.candidates.find((item) =>
      item.ruleId === "research.foreshadow-payoff-closure");
    assert(candidate, `closure rule missing for ${consumer}`);
    assert.equal(candidate.consumer, consumer);
    assertTenDimensions(candidate.tenDimensions);
    assert(candidate.tenDimensions["aftermath hook"].operation.includes("收束"));
  }
});

test("shared library compiles to a validated fixed-cap runtime snapshot", () => {
  assert.equal(PUBLIC_STORY_RESEARCH_SHARED_LIBRARY_V1.modelWeightTraining, false);
  assert.equal(
    PUBLIC_STORY_RESEARCH_SHARED_LIBRARY_V1.learningSemantics,
    "knowledge_retrieval_and_rule_weight_learning",
  );
  assert(PUBLIC_STORY_RESEARCH_RUNTIME_SNAPSHOT_V1.entries.length <= MAX_VALIDATED_CAUSAL_SNAPSHOT_RULES);
  assert.equal(PUBLIC_STORY_RESEARCH_RUNTIME_SNAPSHOT_V1.rawSourceDocumentCount, 0);
  assert.equal(PUBLIC_STORY_RESEARCH_RUNTIME_SNAPSHOT_V1.runtimeNetworkRequests, 0);

  const expandedLibrary = {
    ...PUBLIC_STORY_RESEARCH_SHARED_LIBRARY_V1,
    libraryVersion: "synthetic-expanded-abstract-library-v1",
    entries: Array.from({ length: 80 }, (_, index) => {
      const base = PUBLIC_STORY_RESEARCH_SHARED_LIBRARY_V1.entries[
        index % PUBLIC_STORY_RESEARCH_SHARED_LIBRARY_V1.entries.length
      ];
      return {
        ...base,
        rule: { ...base.rule, ruleId: `${base.rule.ruleId}:variant:${index}` },
        abstractWeight: 1 + (index % 7) / 10,
      };
    }),
  };
  const snapshot = createValidatedCausalResearchSnapshot({
    library: expandedLibrary,
    maximumSnapshotRules: 999,
    snapshotVersion: "bounded-expanded-snapshot-v1",
  });
  assert.equal(snapshot.entries.length, MAX_VALIDATED_CAUSAL_SNAPSHOT_RULES);
  const retrieved = retrievePublicStoryResearchRules({
    query: "anti-despair recovery",
    experience: "rpg",
    consumer: "choice",
    topK: 999,
    snapshot,
  });
  assert(retrieved.hits.length <= MAX_PUBLIC_STORY_RESEARCH_TOP_K);
  assert.equal(retrieved.trace.sharedLibraryScanCount, 0);
  assert.equal(retrieved.trace.snapshotRuleCount, MAX_VALIDATED_CAUSAL_SNAPSHOT_RULES);
});

test("play feedback changes only abstract weight and aggregate statistics", () => {
  const original = PUBLIC_STORY_RESEARCH_SHARED_LIBRARY_V1.entries[0];
  const updated = recordAbstractCausalRuleFeedback(PUBLIC_STORY_RESEARCH_SHARED_LIBRARY_V1, {
    ruleId: original.rule.ruleId,
    decision: "accepted",
    aggregateWeightDelta: 0.1,
    recordedAt: "2026-08-23T01:00:00.000Z",
    rawStoryRetained: false,
    chainOfThoughtRetained: false,
  });
  const changed = updated.entries.find((entry) => entry.rule.ruleId === original.rule.ruleId);
  assert(changed);
  assert.equal(changed.aggregateFeedback.accepted, original.aggregateFeedback.accepted + 1);
  assert.equal(changed.abstractWeight, original.abstractWeight + 0.1);
  assert.equal(changed.rawStoryRetained, false);
  assert.equal(changed.chainOfThoughtRetained, false);
  assert.equal(updated.modelWeightTraining, false);
  assert.equal(updated.learningSemantics, "knowledge_retrieval_and_rule_weight_learning");

  assert.throws(
    () => recordAbstractCausalRuleFeedback(PUBLIC_STORY_RESEARCH_SHARED_LIBRARY_V1, {
      ruleId: original.rule.ruleId,
      decision: "accepted",
      aggregateWeightDelta: 0.1,
      recordedAt: "2026-08-23T01:01:00.000Z",
      rawStoryRetained: false,
      chainOfThoughtRetained: false,
      storyText: "forbidden",
    }),
    errorCode("RESEARCH_FEEDBACK_METADATA_ONLY"),
  );
});

test("offline Top-K fallback stays under one second with no runtime network calls", () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("NETWORK_FORBIDDEN_IN_RESEARCH_FALLBACK");
  };
  try {
    for (let index = 0; index < 100; index += 1) {
      retrievePublicStoryResearchRules({
        query: "failure-forward relief closure causal",
        experience: SHARED_STORY_EXPERIENCE_MODES[index % SHARED_STORY_EXPERIENCE_MODES.length],
        consumer: index % 2 ? "choice" : "closure",
        topK: 8,
      });
    }
    const samples = [];
    for (let index = 0; index < 2_000; index += 1) {
      const startedAt = performance.now();
      const result = retrieveCausalTeacherResearchRules({
        query: index % 2
          ? "連續挫敗 relief failure-forward recovery"
          : "伏筆回收 closure causal aftermath hook",
        experience: SHARED_STORY_EXPERIENCE_MODES[index % SHARED_STORY_EXPERIENCE_MODES.length],
        consumer: index % 2 ? "choice" : "closure",
        topK: 8,
      });
      samples.push(performance.now() - startedAt);
      assert(result.candidates.length <= MAX_PUBLIC_STORY_RESEARCH_TOP_K);
      assert.equal(result.trace.networkRequestCount, 0);
      assert.equal(result.trace.rawSourceDocumentsLoaded, 0);
    }
    samples.sort((left, right) => left - right);
    const p95Ms = samples[Math.floor(samples.length * 0.95)];
    const maxMs = samples.at(-1);
    benchmark = {
      iterations: samples.length,
      p95Ms: Number(p95Ms.toFixed(3)),
      maxMs: Number(maxMs.toFixed(3)),
      limitMs: 1_000,
      networkCalls,
      snapshotRules: PUBLIC_STORY_RESEARCH_RUNTIME_SNAPSHOT_V1.entries.length,
      maxTopK: MAX_PUBLIC_STORY_RESEARCH_TOP_K,
    };
    assert(p95Ms < 1_000, `p95 ${p95Ms}ms exceeded fallback budget`);
    assert(maxMs < 1_000, `max ${maxMs}ms exceeded fallback budget`);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const { name, run } of tests) {
  const startedAt = performance.now();
  try {
    await run();
    const durationMs = Number((performance.now() - startedAt).toFixed(3));
    results.push({ name, status: "passed", durationMs });
    console.log(`PASS ${name} (${durationMs}ms)`);
  } catch (error) {
    const durationMs = Number((performance.now() - startedAt).toFixed(3));
    results.push({ name, status: "failed", durationMs, error: String(error?.stack ?? error) });
    console.error(`FAIL ${name} (${durationMs}ms)`);
    console.error(error);
  }
}

const failed = results.filter((result) => result.status === "failed");
console.log(JSON.stringify({
  suite: "public-story-research-seed",
  passed: results.length - failed.length,
  failed: failed.length,
  benchmark,
}, null, 2));
if (failed.length) process.exitCode = 1;
