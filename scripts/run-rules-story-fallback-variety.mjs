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
  buildDeterministicRpgChatTurnCandidate,
  buildDeterministicRpgTurnStory,
  buildRpgTurnCausalContract,
  buildRpgOutcomeLines,
  validateRpgOutcomeNarrative,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import {
  PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
  proceduralCharacterTreasureScenarioAt,
} from "../lib/novel-ai/game/procedural-story-library.ts";
import {
  buildRpgResolutionDirectorPrompt,
  validateRpgStoryTurnContract,
} from "../lib/novel-ai/web/rpg-closed-ai-director.ts";

const modes = ["adventure", "cultivation", "management"];
const spaces = Object.fromEntries(modes.map((mode) => [mode, proceduralEncounterCombinationSpace(mode)]));

const noRealmChangeResolution = {
  outcome: "success",
  effect: { resourceChanges: {} },
  settlement: { realmChange: null },
};
assert.doesNotThrow(() => validateRpgOutcomeNarrative(
  "眾人突破封鎖，進入秘境查證線索。",
  noRealmChangeResolution,
  "zh-TW",
));
assert.throws(
  () => validateRpgOutcomeNarrative(
    "他當場突破築基境，氣息隨之暴漲。",
    noRealmChangeResolution,
    "zh-TW",
  ),
  /RPG_AI_STORY_UNAPPROVED_REALM_ADVANCEMENT/u,
);

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
    characters: [
      { id: "hero", name: "林澄" },
      {
        id: "ally",
        name: `蘇錦魚${"長名".repeat(38)}`,
        goal: { value: `${"守住證人與逃生路線".repeat(20)}。` },
        personality: { value: "審慎而不失勇氣。" },
        limitations: [`${"不接受強迫與隱瞞".repeat(20)}。`],
        factionIds: ["雨港藥盟"],
        socialMatrixProfile: { familyId: "蘇氏藥坊", institutionId: "雨港藥盟" },
      },
      {
        id: "counterforce",
        name: "顧行舟",
        goal: { value: "保住顧氏航運的夜航權" },
        personality: { value: "冷靜、務實，從不白白讓步。" },
        limitations: ["不拿族人性命交換口頭承諾"],
        factionIds: ["青楓會"],
        socialMatrixProfile: { familyId: "顧氏航運", institutionId: "青楓會" },
      },
      {
        id: "witness",
        name: "葉聞雪",
        goal: { value: "讓被竄改的交付紀錄重新見光" },
        personality: { value: "寡言但記得每一道筆跡。" },
        limitations: ["證據未核對前不替任何一方背書"],
        factionIds: ["渡口公證盟"],
        socialMatrixProfile: { familyId: "葉氏記錄院", institutionId: "渡口公證盟" },
      },
    ],
    relationships: [
      { fromCharacterId: "hero", toCharacterId: "ally", kind: "盟友", summary: "曾共同救下藥坊傷者，仍欠一次坦白", trust: 62 },
      { fromCharacterId: "hero", toCharacterId: "counterforce", kind: "競爭者", summary: "兩家曾因夜航權公開交鋒", trust: 24 },
      { fromCharacterId: "hero", toCharacterId: "witness", kind: "證人", summary: "彼此只以可核對的證據合作", trust: 48 },
    ],
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
const storyScenario = proceduralCharacterTreasureScenarioAt({
  seed: "project-1|chapter-1|management",
  ordinal: (Math.floor(3 / 3) * 7_919 + 303) % PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
  context: {
    playMode: "management",
    protagonist: "林澄",
    location: "雨夜藥鋪",
    conflict: "天亮前保住最後一批客戶",
  },
});
for (const value of [
  "林澄",
  "蘇錦魚",
  "雨夜藥鋪",
  "青楓派巡察",
  "帳冊與備用藥材",
  "顧行舟",
  "葉聞雪",
  "蘇氏藥坊",
  "顧氏航運",
  "葉氏記錄院",
  storyScenario.treasure.name,
]) {
  assert.ok(value && story.includes(value), `novel fallback prose did not render ${value}`);
}
assert.match(story, /「.+」/u, "supporting characters must speak in the novel scene");
assert.match(story, /蘇氏藥坊[\s\S]{0,260}蘇錦魚[\s\S]{0,220}「我願意一起處理/u, "the allied family character must speak and act");
assert.match(story, /顧氏航運[\s\S]{0,260}顧行舟[\s\S]{0,220}「我願意一起處理/u, "the rival family character must speak and act");
assert.doesNotMatch(
  story,
  /核准規則|規則校準|規則故事後備|因果維度|因果鏈|本回合|下一回合|回合制|關係張力|狀態收益|狀態修訂|狀態更新|結算結果|下一輪可用|下一次行動|等待下一步|Story Bible|Canon/u,
  "reader-facing prose leaked internal engine or governance wording",
);
validateRpgStoryTurnContract(story, "zh-TW");

const familyDirectorPrompt = JSON.parse(buildRpgResolutionDirectorPrompt({
  context: {
    stagedFamilies: [
      { family: "蘇氏藥坊", faction: "雨港藥盟", members: ["蘇錦魚"] },
      { family: "顧氏航運", faction: "青楓會", members: ["顧行舟"] },
    ],
    supportingCharacters: [{ name: "蘇錦魚" }, { name: "顧行舟" }],
    relationships: [{ from: "林澄", to: "蘇錦魚", summary: "仍欠一次坦白" }],
  },
  choice: {
    key: "B",
    title: "借勢調度",
    description: "重新配置現有人力與資金",
    encounter,
  },
  language: "zh-TW",
  resolution: { outcomeLabel: "失敗", roll: 24, successChance: 58, settlement: [] },
}));
assert.match(familyDirectorPrompt.instruction, /上場人物網絡/u);
assert.match(familyDirectorPrompt.instruction, /兩名具名配角/u);
assert.match(familyDirectorPrompt.instruction, /上場家族或派系/u);
assert.match(familyDirectorPrompt.instruction, /不同人物說出至少兩句/u);

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
    characters: [
      { id: "hero", name: "林澄" },
      {
        id: "ally",
        name: "蘇錦魚",
        goal: { value: `${"守住證人與逃生路線".repeat(20)}。` },
        personality: { value: "審慎而不失勇氣。" },
        limitations: [`${"不接受強迫與隱瞞".repeat(20)}。`],
      },
    ],
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
      const richFrame = buildRpgTurnCausalContract({
        snapshot: richSnapshot,
        choice: richChoice,
        outcome,
      });
      assert.equal(
        richFrame.causalKnowledge?.appliedRuleIds.length,
        richCausalSignals.length,
        `${playMode}/${closureKind ?? "active"}/${outcome} did not apply shared learning internally`,
      );
      assert.doesNotMatch(
        richStory,
        /核准規則|規則校準|本回合|下一回合|回合制|關係張力|狀態更新|結算結果|下一輪可用|Story Bible|Canon/u,
        `${playMode}/${closureKind ?? "active"}/${outcome} leaked internal engine wording`,
      );
      assert.doesNotMatch(richStory, /。。|。；|；。|！！|？？/u, "canonical punctuation was duplicated");
      assert.doesNotMatch(richStory, /從這些已發生的後果開。/u, "paragraph truncation left an incomplete phrase");
      assert.equal(
        richStory.match(/「/gu)?.length ?? 0,
        richStory.match(/」/gu)?.length ?? 0,
        "canonical text truncation left an unclosed dialogue quote",
      );
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

// A new project may contain only the protagonist. The fallback must still
// rotate original fictional supporting characters with independent goals,
// actions, refusal conditions and dialogue, rather than printing "同行者" or
// keeping the protagonist alone in a static loop.
const protagonistOnlySnapshot = {
  project: { id: "project-protagonist-only", genrePackId: "現代懸疑" },
  chapter: { id: "chapter-protagonist-only", title: "封存證物", revision: 1 },
  storyState: { locationState: "停電檔案館", revision: 1, worldFlags: {} },
  storyBible: { protagonistIds: ["hero"], unresolvedThreads: ["被剪去的證詞去了哪裡"] },
  characters: [{ id: "hero", name: "沈星河" }],
  progression: { turn: 0, inventory: [{ name: "破損錄音帶", quantity: 1 }], procedural: { runSeed: "solo-runtime" } },
  language: "zh-TW",
  playMode: "rpg",
  conflict: "在天亮前找出證物被替換的時間",
  rpgTurnReceipts: [],
};
const soloStories = [];
const soloActors = new Set();
for (let turn = 0; turn < 4; turn += 1) {
  const turnSnapshot = {
    ...protagonistOnlySnapshot,
    progression: { ...protagonistOnlySnapshot.progression, turn },
  };
  const soloEncounter = buildProceduralEncounter({
    runSeed: "solo-runtime",
    mode: "adventure",
    turn,
    strategy: ["steady", "resource", "bold"][turn % 3],
  });
  const soloChoice = {
    key: ["A", "B", "C"][turn % 3],
    title: soloEncounter.title,
    description: soloEncounter.complication,
    encounter: soloEncounter,
  };
  const soloStory = buildDeterministicRpgTurnStory({
    snapshot: turnSnapshot,
    choice: soloChoice,
    resolution: { outcome: turn === 2 ? "failure" : "success" },
  });
  const soloScenario = proceduralCharacterTreasureScenarioAt({
    seed: "project-protagonist-only|chapter-protagonist-only|rpg",
    ordinal: (Math.floor(turn / 3) * 7_919) % PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
    context: {
      genre: "現代懸疑",
      playMode: "rpg",
      protagonist: "沈星河",
      location: "停電檔案館",
      conflict: "在天亮前找出證物被替換的時間",
    },
  });
  for (let index = 0; index < 3; index += 1) {
    const member = soloScenario.cast.members[(turn + index) % 3];
    assert.ok(soloStory.includes(member.name), `solo turn ${turn} lost ${member.narrativeRole} ${member.name}`);
    soloActors.add(member.name);
  }
  assert.match(soloStory, /「.+」/u);
  assert.doesNotMatch(soloStory, /同行者|核准規則|本回合|下一回合|回合制|關係張力|結算結果/u);
  soloStories.push(soloStory);
}
assert.ok(soloActors.size >= 6, "supporting cast did not rotate across the four-turn story sample");
assert.equal(new Set(soloStories).size, soloStories.length, "four turns repeated the same novel prose");

const soloCandidate = await buildDeterministicRpgChatTurnCandidate({
  snapshot: protagonistOnlySnapshot,
  choice: {
    key: "A",
    title: encounter.title,
    description: encounter.complication,
    impactLabels: ["保住一條可驗證線索"],
    costLabels: ["承擔已知代價"],
    consequenceTeaser: "局面會沿著已發生的後果繼續",
    encounter,
  },
  resolution: {
    outcome: "success",
    outcomeLabel: "成功",
    roll: 50,
    successChance: 60,
    effect: { resourceChanges: {} },
    settlement: { realmChange: null },
  },
});
assert.equal(soloCandidate.actualExecutor, "deterministic-rule-fallback");
assert.match(String(soloCandidate.resolution.effect.worldFlags?.["story.relationshipScenarioId"]), /^scenario-/u);
assert.ok(String(soloCandidate.resolution.effect.worldFlags?.["story.activeSupportingCharacterName"]));
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
