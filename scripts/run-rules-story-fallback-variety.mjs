import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  PROCEDURAL_ENCOUNTER_DEDUP_WINDOW,
  PROCEDURAL_SUCCESS_FACTOR_IDS,
  PROCEDURAL_WORLD_DIRECTOR_VERSION,
  adaptProceduralEncounterForRomance,
  buildProceduralCausalFrame,
  proceduralEncounterAt,
  buildProceduralEncounter,
  proceduralEncounterCombinationSpace,
  proceduralEncounterSignatureAt,
} from "../lib/novel-ai/game/procedural-world-director.ts";
import {
  buildDeterministicRpgTurnStory,
  buildRpgOutcomeLines,
  validateRpgOutcomeNarrative,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import { validateRpgStoryTurnContract } from "../lib/novel-ai/web/rpg-closed-ai-director.ts";

const modes = ["adventure", "cultivation", "management"];
const spaces = Object.fromEntries(modes.map((mode) => [mode, proceduralEncounterCombinationSpace(mode)]));

assert.equal(PROCEDURAL_WORLD_DIRECTOR_VERSION, "procedural-world-director-v2");
assert.deepEqual(spaces, {
  adventure: 377_487_360,
  cultivation: 283_115_520,
  management: 283_115_520,
});
assert.ok(Object.values(spaces).every((count) => count >= 1_000_000));

// The runtime decodes a mixed-radix ordinal in O(fixed dimensions). CI proves
// boundaries, the high-order aftermath dimension, and a deterministic sample;
// it deliberately does not allocate millions of strings.
for (const mode of modes) {
  const aftermathStride = spaces[mode] / 9;
  const boundaryOrdinals = [0, 1, 4, 5, 39, 40, aftermathStride - 1, aftermathStride, aftermathStride * 8, spaces[mode] - 1];
  assert.equal(new Set(boundaryOrdinals.map((ordinal) => proceduralEncounterSignatureAt(mode, ordinal))).size, boundaryOrdinals.length);
  const highDimensionChecks = [
    { field: "goal", id: "goalId", stride: 163_840 },
    { field: "catalyst", id: "catalystId", stride: 655_360 },
    { field: "aftermath", id: "aftermathId", stride: aftermathStride },
  ];
  const base = proceduralEncounterAt(mode, 0);
  for (const check of highDimensionChecks) {
    const changed = proceduralEncounterAt(mode, check.stride);
    assert.notEqual(changed[check.id], base[check.id], `${mode}.${check.field} high-order digit must change`);
    assert.notEqual(changed[check.field], base[check.field], `${mode}.${check.field} must change rendered content`);
    assert.notEqual(changed.signature, base.signature);
  }
  const signatures = new Set();
  const sampleSize = 20_000;
  for (let index = 0; index < sampleSize; index += 1) {
    const ordinal = (index * 7_919) % spaces[mode];
    signatures.add(proceduralEncounterSignatureAt(mode, ordinal));
  }
  assert.equal(signatures.size, sampleSize, `${mode} sampled mixed-radix signatures must be collision-free`);
}

for (const mode of modes) {
  const first = buildProceduralEncounter({
    runSeed: "same-work",
    mode,
    turn: 7,
    strategy: "steady",
    variant: 2,
  });
  const replay = buildProceduralEncounter({
    runSeed: "same-work",
    mode,
    turn: 7,
    strategy: "steady",
    variant: 2,
  });
  const replacement = buildProceduralEncounter({
    runSeed: "same-work",
    mode,
    turn: 7,
    strategy: "steady",
    variant: 2,
    recentSignatures: [first.signature],
  });
  assert.deepEqual(replay, first, `${mode} replay must be deterministic`);
  assert.notEqual(replacement.signature, first.signature, `${mode} must skip a recent full composition`);
  assert.equal(first.rulesOnly, true);
  assert.equal(first.combinationSpace, spaces[mode]);
  for (const field of ["catalyst", "goal", "pressure", "leverage", "resourceProp", "relationshipTension", "cost", "deadline", "reversal", "aftermath"]) {
    assert.ok(first[field]?.length > 8, `${mode}.${field} must materially affect content`);
  }

  const recent = [];
  for (let turn = 0; turn < 80; turn += 1) {
    const encounter = buildProceduralEncounter({
      runSeed: "long-running-work",
      mode,
      turn,
      strategy: ["steady", "resource", "bold"][turn % 3],
      variant: turn % 11,
      recentSignatures: recent,
    });
    assert.equal(recent.includes(encounter.signature), false, `${mode} turn ${turn} repeated within the window`);
    recent.push(encounter.signature);
    if (recent.length > PROCEDURAL_ENCOUNTER_DEDUP_WINDOW) recent.shift();
  }
}

const encounter = buildProceduralEncounter({
  runSeed: "context-bound-work",
  mode: "management",
  turn: 3,
  strategy: "resource",
});
const frame = buildProceduralCausalFrame({
  encounter,
  protagonist: "林澄",
  supportingCharacter: "蘇錦魚",
  location: "雨夜藥鋪",
  conflict: "天亮前保住最後一批客戶",
  unresolvedThread: "青楓派巡察將封鎖通路",
  availableResource: "僅存現金與三人團隊",
  outcome: "failure",
  consecutiveSetbacks: 3,
  arcKey: "arc-management-a",
  turn: 8,
});
assert.equal(frame.rulesOnly, true);
assert.deepEqual(frame.successFactorIds, PROCEDURAL_SUCCESS_FACTOR_IDS);
assert.equal(frame.popularityGuaranteed, false);
assert.equal(frame.hopeGuard.setbackCount, 3);
assert.equal(frame.hopeGuard.recoveryBias, "high");
assert.equal(frame.hopeGuard.majorCostTelegraphed, true);
assert.equal(frame.hopeGuard.pureDeadEnd, false);
assert.ok(frame.pressureBeat.includes(encounter.cost), "major cost must be telegraphed before settlement");
assert.ok(frame.consequenceBeat.includes(frame.hopeGuard.progressBeat), "failure must still grant a concrete progress channel");
assert.match(frame.hopeGuard.recoveryBeat, /恢復|喘息|回報/u);
assert.equal(frame.persistentArc.arcKey, "arc-management-a");
assert.equal(frame.persistentArc.phase, "resolution");
assert.equal(frame.persistentArc.causalChainAction, "recover");
assert.equal(frame.persistentArc.endingOptionsRequired, true);
assert.equal(frame.persistentArc.newSubplotBudget, 0);
assert.ok(frame.consequenceBeat.includes(frame.persistentArc.closureBeat));
assert.deepEqual(Object.keys(frame.inferenceDimensions), [
  "catalyst",
  "goal",
  "pressure",
  "leverage",
  "resourceProp",
  "relationshipTension",
  "cost",
  "deadline",
  "reversal",
  "aftermath",
]);
for (const fact of ["林澄", "蘇錦魚", "雨夜藥鋪", "天亮前保住最後一批客戶", "青楓派巡察", "僅存現金與三人團隊"]) {
  assert.ok(Object.values(frame).some((value) => typeof value === "string" && value.includes(fact)), `causal frame lost ${fact}`);
}
for (const dimension of Object.values(frame.inferenceDimensions)) {
  assert.ok(dimension);
  assert.ok(Object.values(frame).some((value) => typeof value === "string" && value.includes(dimension)), `causal frame did not use ${dimension}`);
}

const story = buildDeterministicRpgTurnStory({
  snapshot: {
    project: { id: "project-1" },
    chapter: { id: "chapter-1", title: "雨夜期限" },
    storyState: { locationState: "雨夜藥鋪", worldFlags: {} },
    storyBible: { protagonistIds: ["hero"], unresolvedThreads: ["青楓派巡察將封鎖通路"] },
    characters: [{ id: "hero", name: "林澄" }, { id: "ally", name: "蘇錦魚" }],
    progression: { turn: 3, inventory: [{ name: "帳冊與備用藥材", quantity: 1 }] },
    language: "zh-TW",
    playMode: "management",
    conflict: "天亮前保住最後一批客戶",
    rpgTurnReceipts: [{ outcome: "failure" }, { outcome: "partial_success" }, { outcome: "failure" }],
  },
  choice: {
    key: "B",
    title: "借勢調度",
    description: "重新配置現有人力與資金",
    encounter,
  },
  resolution: { outcome: "failure" },
});
for (const value of [
  "林澄",
  "蘇錦魚",
  "雨夜藥鋪",
  "青楓派巡察",
  "帳冊與備用藥材",
  encounter.catalyst,
  encounter.goal,
  encounter.pressure,
  encounter.leverage,
  encounter.resourceProp,
  encounter.relationshipTension,
  encounter.cost,
  encounter.deadline,
  encounter.reversal,
  encounter.aftermath,
]) {
  assert.ok(value && story.includes(value), `rules fallback prose did not render ${value}`);
}
assert.ok(story.includes(frame.hopeGuard.progressBeat), "rules fallback prose must render hope-guard progress");
assert.match(story, /恢復|喘息|回報/u, "consecutive setbacks must visibly raise recovery/payoff weighting");

// Browser reproduction guard: the closed-AI story may be rejected as too long,
// so its deterministic replacement must remain valid even when every causal
// dimension and all eight approved shared-learning slots carry rich text.
const richSignalDimensions = [
  "opening_hook",
  "viewpoint",
  "character_pressure",
  "information_control",
  "world_rule_delivery",
  "relationship_movement",
  "tone",
  "ending_hook",
];
const richCausalSignals = richSignalDimensions.map((dimension, index) => ({
  ruleId: `rich-shared-rule-${index}`,
  family: "shared-story-causality",
  dimension,
  statement: `敘事規則${index}必須保留前因後果`.repeat(20),
  operation: `保留因果${index}並依既有狀態推進`.repeat(20),
  constraint: `不可重置${index}且不可憑空補充資源`.repeat(20),
  evaluate: `檢查人物與狀態後果${index}`.repeat(20),
}));
const richEncounterFields = [
  "catalyst",
  "goal",
  "pressure",
  "leverage",
  "resourceProp",
  "relationshipTension",
  "cost",
  "deadline",
  "reversal",
  "aftermath",
];
const outcomeLabels = {
  critical_success: "大成功",
  success: "成功",
  partial_success: "部分成功",
  failure: "失敗",
};
const worstCaseContracts = [];
for (const [playMode, encounterMode] of [
  ["rpg", "adventure"],
  ["romance", "cultivation"],
  ["management", "management"],
]) {
  let richEncounter = {
    ...buildProceduralEncounter({
      runSeed: `rich-fallback-${playMode}`,
      mode: encounterMode,
      turn: 8,
      strategy: "resource",
    }),
    ...Object.fromEntries(richEncounterFields.map((field, index) => [
      field,
      `${field}因果${index}必須保留且不得重置`.repeat(24),
    ])),
    locationShift: "場景位移後果必須持續".repeat(30),
    worldAspect: "世界狀態已經改變".repeat(30),
  };
  if (playMode === "romance") richEncounter = adaptProceduralEncounterForRomance(richEncounter);
  const richSnapshot = {
    project: { id: `project-rich-${playMode}` },
    chapter: { id: `chapter-rich-${playMode}`, title: "雨夜期限" },
    storyState: { locationState: "雨夜藥鋪", worldFlags: {} },
    storyBible: { protagonistIds: ["hero"], unresolvedThreads: ["封鎖通路背後的責任"] },
    characters: [{ id: "hero", name: "林澄" }, { id: "ally", name: "蘇錦魚" }],
    progression: { turn: 8, inventory: [{ name: "帳冊與舊地圖", quantity: 1 }] },
    language: "zh-TW",
    playMode,
    conflict: "天亮以前保住證人與最後通路",
    rpgTurnReceipts: [{ outcome: "failure" }, { outcome: "partial_success" }, { outcome: "failure" }],
    causalKnowledge: {
      snapshotVersion: "approved-learning-context-snapshot-v1",
      snapshotDigest: `rich-shared-digest-${playMode}`,
      selectedRuleIds: richCausalSignals.map((signal) => signal.ruleId),
      instructions: [],
      causalSignals: richCausalSignals,
      maximumRules: 8,
      entireLibraryScanned: false,
    },
  };
  for (const closureKind of [null, "complete", "accept-cost", "leave-consequence"]) {
    const boundedEncounter = closureKind ? {
      ...richEncounter,
      arcKey: `arc-rich-${playMode}`,
      arcGoal: "守住既有目標",
      arcThread: "前七回合未解因果",
      arcLocalTurn: 8,
      arcHorizon: 8,
      arcPhase: "resolution",
      arcResolutionKind: closureKind,
    } : richEncounter;
    for (const outcome of Object.keys(outcomeLabels)) {
      const richChoice = {
        key: "B",
        title: "守住最後撤離路線",
        description: "沿既有證據承擔代價並推進",
        encounter: boundedEncounter,
      };
      const richResolution = {
        outcome,
        outcomeLabel: outcomeLabels[outcome],
        roll: 50,
        successChance: 60,
        effect: { resourceChanges: {} },
        settlement: { realmChange: null },
      };
      const richStory = buildDeterministicRpgTurnStory({
        snapshot: richSnapshot,
        choice: richChoice,
        resolution: richResolution,
      });
      const contract = validateRpgStoryTurnContract(richStory, "zh-TW");
      validateRpgOutcomeNarrative(richStory, richResolution, "zh-TW", richChoice);
      assert.ok(richStory.includes("核准規則"), `${playMode}/${closureKind ?? "active"}/${outcome} lost shared learning`);
      for (const continuityFact of ["林澄", "蘇錦魚", "雨夜藥鋪", "帳冊與舊地圖", "封鎖通路背後的責任"]) {
        assert.ok(richStory.includes(continuityFact), `${playMode}/${closureKind ?? "active"}/${outcome} lost ${continuityFact}`);
      }
      worstCaseContracts.push({ playMode, closureKind: closureKind ?? "active", outcome, ...contract });
    }
  }
}
assert.equal(worstCaseContracts.length, 48);
assert.ok(worstCaseContracts.every((contract) => contract.narrativeLength >= 900 && contract.narrativeLength <= 1_600));
assert.ok(worstCaseContracts.every((contract) => contract.paragraphCount >= 8 && contract.paragraphCount <= 16));
assert.ok(worstCaseContracts.every((contract) => contract.sentenceCount >= 10));
const worstCaseFallbackContract = {
  cases: worstCaseContracts.length,
  narrativeLength: {
    minimum: Math.min(...worstCaseContracts.map((contract) => contract.narrativeLength)),
    maximum: Math.max(...worstCaseContracts.map((contract) => contract.narrativeLength)),
  },
  paragraphCounts: [...new Set(worstCaseContracts.map((contract) => contract.paragraphCount))],
  sentenceCount: {
    minimum: Math.min(...worstCaseContracts.map((contract) => contract.sentenceCount)),
    maximum: Math.max(...worstCaseContracts.map((contract) => contract.sentenceCount)),
  },
  richSharedRules: richCausalSignals.length,
  dynamicDimensions: richEncounterFields.length,
};

for (const outcome of ["partial_success", "failure"]) {
  const guarded = buildProceduralCausalFrame({
    encounter,
    protagonist: "林澄",
    supportingCharacter: "蘇錦魚",
    location: "雨夜藥鋪",
    conflict: "守住營運底線",
    unresolvedThread: "巡察封路",
    availableResource: "僅存現金",
    outcome,
    consecutiveSetbacks: 2,
  });
  assert.equal(guarded.hopeGuard.pureDeadEnd, false);
  assert.ok(["information", "relationship", "ability", "resource", "opportunity"].includes(guarded.hopeGuard.progressKind));
  assert.ok(guarded.consequenceBeat.includes(guarded.hopeGuard.progressBeat));
}

// Rules handoff benchmark: fixed ten-digit lookup + prose + locked outcome,
// dashboard settlement, and the next A/B/C. No model, network, database, or
// million-space enumeration is permitted inside this measured path.
const benchmarkSnapshot = {
  project: { id: "project-bench" },
  chapter: { id: "chapter-bench", title: "期限迫近", revision: 1 },
  storyState: { locationState: "雨夜藥鋪", revision: 1, worldFlags: { "story.activeArcKey": "arc-bench" } },
  storyBible: { protagonistIds: ["hero"], unresolvedThreads: ["封路危機"] },
  characters: [{ id: "hero", name: "林澄" }, { id: "ally", name: "蘇錦魚" }],
  progression: { turn: 8, inventory: [{ name: "僅存現金", quantity: 1 }] },
  language: "zh-TW",
  playMode: "management",
  conflict: "守住下一輪營運",
  rpgTurnReceipts: [{ outcome: "failure" }, { outcome: "partial_success" }, { outcome: "failure" }],
};
const benchmarkResolution = {
  outcome: "partial_success",
  outcomeLabel: "部分成功",
  roll: 47,
  successChance: 61,
  effect: {
    resourceChanges: { "management.cash": -1, "management.quality": 1 },
    relationshipChanges: { "management.teamTrust": 1 },
    worldFlags: {},
    timelineEvents: [],
  },
};
const generateMeasuredFallback = (iteration) => {
  const nextChoices = ["steady", "resource", "bold"].map((strategy, variant) => {
    const nextEncounter = buildProceduralEncounter({
      runSeed: "sla-work",
      mode: "management",
      turn: 9 + iteration,
      strategy,
      variant,
    });
    return {
      key: ["A", "B", "C"][variant],
      title: nextEncounter.title,
      consequence: nextEncounter.complication,
      encounter: nextEncounter,
    };
  });
  const selectedChoice = {
    key: "B",
    title: "借勢調度",
    description: "重新配置現有人力與資金",
    impactLabels: ["品質進展"],
    costLabels: ["現金 -1"],
    consequenceTeaser: "保住下一輪營運",
    encounter: nextChoices[1].encounter,
  };
  return {
    story: buildDeterministicRpgTurnStory({ snapshot: benchmarkSnapshot, choice: selectedChoice, resolution: benchmarkResolution }),
    outcome: benchmarkResolution.outcome,
    outcomeLines: buildRpgOutcomeLines(selectedChoice, benchmarkResolution),
    dashboardData: benchmarkResolution.effect,
    nextChoices,
  };
};
for (let index = 0; index < 100; index += 1) generateMeasuredFallback(index);
const latencySamples = [];
for (let index = 0; index < 1_000; index += 1) {
  const startedAt = performance.now();
  const output = generateMeasuredFallback(index);
  latencySamples.push(performance.now() - startedAt);
  assert.ok(output.story.length > 900);
  assert.equal(output.outcomeLines.length, 4);
  assert.equal(output.nextChoices.map((choice) => choice.key).join(""), "ABC");
  assert.equal(new Set(output.nextChoices.map((choice) => choice.encounter.signature)).size, 3);
  assert.ok(Object.keys(output.dashboardData.resourceChanges).length > 0);
}
latencySamples.sort((left, right) => left - right);
const percentile = (ratio) => latencySamples[Math.min(latencySamples.length - 1, Math.floor(latencySamples.length * ratio))];
const latencyMs = {
  p50: percentile(0.5),
  p95: percentile(0.95),
  p99: percentile(0.99),
  max: latencySamples.at(-1),
};
assert.ok(latencyMs.p99 < 1_000, `rules fallback p99 ${latencyMs.p99}ms exceeded 1000ms`);
assert.ok(latencyMs.max < 1_000, `rules fallback max ${latencyMs.max}ms exceeded 1000ms`);

// A changing encounter may vary the texture, but it cannot reset the active
// people, goal, or unresolved causal chain. The finite horizon must lead to a
// resolution phase rather than growing an endless pile of new hooks.
const arcFrames = Array.from({ length: 8 }, (_, index) => buildProceduralCausalFrame({
  encounter: buildProceduralEncounter({
    runSeed: "persistent-arc",
    mode: "adventure",
    turn: index + 1,
    strategy: ["steady", "resource", "bold"][index % 3],
  }),
  protagonist: "林澄",
  supportingCharacter: "蘇錦魚",
  location: "青楓山道",
  conflict: "護送證人越過封鎖線",
  unresolvedThread: "巡察者為何封鎖山道",
  availableResource: "舊地圖與一份乾糧",
  outcome: index % 3 === 0 ? "partial_success" : "success",
  consecutiveSetbacks: index % 3 === 0 ? 1 : 0,
  arcKey: "arc-escort-001",
  turn: index + 1,
  arcHorizon: 8,
}));
assert.equal(new Set(arcFrames.map((item) => item.persistentArc.arcKey)).size, 1);
assert.equal(new Set(arcFrames.map((item) => item.persistentArc.goal)).size, 1);
assert.equal(new Set(arcFrames.map((item) => item.persistentArc.unresolvedThread)).size, 1);
assert.ok(arcFrames.every((item) => item.incitingBeat.includes("林澄") && item.opportunityBeat.includes("蘇錦魚")));
assert.ok(arcFrames.every((item) => item.persistentArc.causalChainAction === "advance" || item.persistentArc.causalChainAction === "recover"));
assert.ok(arcFrames.slice(1).every((item) => item.persistentArc.newSubplotBudget === 0));
assert.deepEqual(arcFrames.map((item) => item.persistentArc.phase), [
  "setup",
  "escalation",
  "escalation",
  "reversal",
  "reversal",
  "climax",
  "climax",
  "resolution",
]);
assert.equal(arcFrames.at(-1).persistentArc.endingReachable, true);
assert.equal(arcFrames.at(-1).persistentArc.endingOptionsRequired, true);
assert.match(arcFrames.at(-1).persistentArc.closureBeat, /收束|結局/u);

const romanceEncounter = adaptProceduralEncounterForRomance(buildProceduralEncounter({
  runSeed: "modern-romance",
  mode: "cultivation",
  turn: 2,
  strategy: "steady",
}));
const romanceStory = buildDeterministicRpgTurnStory({
  snapshot: {
    project: { id: "project-romance" },
    chapter: { id: "chapter-romance", title: "雨夜重逢" },
    storyState: { locationState: "捷運站咖啡店", worldFlags: {} },
    storyBible: { protagonistIds: ["hero"], unresolvedThreads: ["三年前未寄出的信"] },
    characters: [{ id: "hero", name: "林澄" }, { id: "ally", name: "蘇錦魚" }],
    progression: { turn: 2, inventory: [{ name: "舊車票", quantity: 1 }] },
    language: "zh-TW",
    playMode: "romance",
    conflict: "在末班車前說清當年的誤會",
    rpgTurnReceipts: [],
  },
  choice: {
    key: "A",
    title: romanceEncounter.title,
    description: romanceEncounter.complication,
    encounter: romanceEncounter,
  },
  resolution: { outcome: "success" },
});
assert.doesNotMatch(romanceStory, /經脈|灵脉|靈脈|靈材|灵材|境界|功法|修行|吐納|吐纳|共修|同修|師門|师门|宗門|宗门|靈力|灵力|靈場|灵场|反噬|試煉|试炼/u);
for (const fact of ["林澄", "蘇錦魚", "捷運站咖啡店", "末班車", "三年前未寄出的信", "舊車票"]) {
  assert.ok(romanceStory.includes(fact), `modern romance continuity lost ${fact}`);
}

console.log(JSON.stringify({
  suite: "rules-story-fallback-variety",
  status: "PASS",
  formula: "templates x 8 catalysts x 4 goals x 8 pressures x 8 leverages x 4 resource props x 4 relationship tensions x 4 costs x 8 deadlines x 5 reversals x 9 aftermath hooks",
  inferenceDimensionCount: 10,
  spaces,
  totalEffectiveCombinations: Object.values(spaces).reduce((sum, count) => sum + count, 0),
  dedupWindow: PROCEDURAL_ENCOUNTER_DEDUP_WINDOW,
  truthfulExecutor: "rules-only deterministic composition",
  popularityGuaranteed: false,
  hopeGuard: "failure still advances information/relationship/ability/resource/opportunity; repeated setbacks bias recovery/payoff",
  finiteArcContract: { horizon: 8, finalPhase: arcFrames.at(-1).persistentArc.phase, endingReachable: true },
  romanceSafeContract: "modern romance cannot leak cultivation vocabulary unless Canon supplies it",
  worstCaseFallbackContract,
  handoffLatencyBenchmark: { warmup: 100, samples: 1_000, unit: "ms", ...latencyMs },
  contextBinding: ["protagonist", "supportingCharacter", "location", "conflict", "unresolvedThread", "availableResource"],
}, null, 2));
