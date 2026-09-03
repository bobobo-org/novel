import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  describePrivateModelRole,
  parseParameterBillions,
  rankPrivateModels,
} from "../lib/novel-ai/model-orchestration/private-model-fleet.ts";
import {
  sealFormalPreferenceDataset,
  verifyFormalPreferenceDataset,
} from "../lib/novel-ai/training/formal-preference-dataset.ts";
import {
  applyStoryChoiceEffect,
} from "../lib/novel-ai/game/effects/index.ts";
import {
  RPG_ITEM_CATALOG,
  RPG_MODE_DEFINITIONS,
  buildCustomRpgChoice,
  buildManagementSettlementEffect,
  buildRpgChoices,
  computePowerScore,
  computeSuccessChance,
  experienceForLevel,
  initialRpgResources,
  initialRpgStats,
  levelFromExperience,
  readRpgProgression,
  resolveRpgChoice,
} from "../lib/novel-ai/game/progression/rpg-progression.ts";
import {
  BUILTIN_MATURE_RPG_CHARACTERS,
  BUILTIN_RPG_CHARACTERS,
  RPG_CHARACTER_LIBRARY_SCHEMA,
  mergeCharacterLibrary,
  parseRpgCharacterLibrary,
} from "../lib/novel-ai/game/character-library.ts";
import {
  assertFormalTrainingManifest,
} from "../local-ai/private-hub/server.mjs";
import {
  scoreWithPreferenceModel,
  trainOfflinePreferenceModel,
  verifyOfflinePreferenceModel,
} from "../local-ai/private-hub/preference-model.mjs";
import {
  runPackagedBrowserTaskModel,
} from "../lib/novel-ai/providers/browser-ai/browser-task-model.ts";

const results = [];

async function test(name, work) {
  try {
    const evidence = await work();
    results.push({ name, status: "PASS", evidence });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

await test("model fleet parses reported model scale", () => {
  assert.equal(parseParameterBillions("3.2B"), 3.2);
  assert.equal(parseParameterBillions("14.7 B"), 14.7);
  assert.equal(parseParameterBillions("780M"), 0.78);
  assert.equal(describePrivateModelRole("deep-reasoner"), "深度推理");
  return { parsed: ["3.2B", "14.7B", "780M"] };
});

const models = [
  {
    modelId: "swift:3b",
    modelDigest: "a".repeat(64),
    family: { value: "qwen" },
    parameterSize: { value: "3B" },
    quantization: { value: "Q4_K_M" },
    contextLength: { value: 8192 },
    diskSize: { value: 2_100_000_000 },
    capabilities: { textGeneration: { value: true }, streaming: { value: true } },
  },
  {
    modelId: "reasoner:32b",
    modelDigest: "b".repeat(64),
    family: { value: "reasoner" },
    parameterSize: { value: "32B" },
    quantization: { value: "Q4_K_M" },
    contextLength: { value: 65536 },
    diskSize: { value: 20_000_000_000 },
    capabilities: { textGeneration: { value: true }, streaming: { value: true } },
  },
];

await test("model fleet routes light and heavy work differently", () => {
  const light = rankPrivateModels(models, {
    taskType: "story.summary",
    complexity: "light",
    preferLatency: true,
  });
  const heavy = rankPrivateModels(models, {
    taskType: "story.storyBibleCandidate",
    complexity: "heavy",
  });
  assert.equal(light[0].modelId, "swift:3b");
  assert.equal(heavy[0].modelId, "reasoner:32b");
  assert.ok(heavy[0].roles.includes("deep-reasoner"));
  return {
    light: light.map(({ modelId, score }) => ({ modelId, score })),
    heavy: heavy.map(({ modelId, score }) => ({ modelId, score })),
  };
});

const preferenceSamples = [
  {
    chosen: "她沒有解釋，只把染血的信放到桌上，等他先做選擇。",
    rejected: "她非常傷心地說明自己現在真的非常難過，希望他理解。",
  },
  {
    chosen: "門外的腳步停了。燈芯縮成一點藍光，他握緊了沒有寄出的信。",
    rejected: "這是一個很緊張的場面，所有人都感覺情況非常危險。",
  },
];

await test("formal training dataset seals and verifies without raw persistence", async () => {
  const manifest = await sealFormalPreferenceDataset({
    projectId: "project-a",
    baseModelId: "reasoner:32b",
    datasetVersion: "approved-v1",
    samples: preferenceSamples,
    rightsConfirmed: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(await verifyFormalPreferenceDataset(manifest, preferenceSamples), true);
  assert.equal(manifest.privacy.rawSamplesStored, false);
  assert.equal(manifest.sampleCount, 2);
  assert.match(manifest.manifestHash, /^[a-f0-9]{64}$/u);
  assert.equal(assertFormalTrainingManifest(manifest, {
    projectId: "project-a",
    baseModelId: "reasoner:32b",
    datasetVersion: "approved-v1",
    samples: preferenceSamples,
  }), manifest.manifestHash);
  return {
    datasetId: manifest.datasetId,
    datasetDigest: manifest.datasetDigest,
    manifestHash: manifest.manifestHash,
  };
});

await test("formal training dataset blocks credentials and rights ambiguity", async () => {
  await assert.rejects(() => sealFormalPreferenceDataset({
    projectId: "project-a",
    baseModelId: "reasoner:32b",
    datasetVersion: "blocked-v1",
    samples: preferenceSamples,
    rightsConfirmed: false,
  }), (error) => error?.code === "TRAINING_RIGHTS_CONFIRMATION_REQUIRED");
  await assert.rejects(() => sealFormalPreferenceDataset({
    projectId: "project-a",
    baseModelId: "reasoner:32b",
    datasetVersion: "blocked-v2",
    samples: [
      preferenceSamples[0],
      { chosen: "把 password=not-a-real-secret 寫進去", rejected: "這是另一個正常但不採用的段落。" },
    ],
    rightsConfirmed: true,
  }), (error) => error?.code === "TRAINING_CREDENTIAL_INPUT_BLOCKED");
  return { rightsGate: "blocked", credentialGate: "blocked" };
});

await test("formal preference data runs a real offline gradient training cycle", async () => {
  const manifest = await sealFormalPreferenceDataset({
    projectId: "project-a",
    baseModelId: "reasoner:32b",
    datasetVersion: "approved-training-v1",
    samples: preferenceSamples,
    rightsConfirmed: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const artifact = trainOfflinePreferenceModel({
    projectId: "project-a",
    baseModelId: "reasoner:32b",
    datasetVersion: "approved-training-v1",
    samples: preferenceSamples,
    datasetManifestHash: manifest.manifestHash,
    epochs: 320,
    learningRate: 0.08,
    l2: 0.015,
  });
  assert.equal(verifyOfflinePreferenceModel(artifact), true);
  assert.equal(artifact.datasetGovernance, "formal_manifest_verified");
  assert.equal(artifact.datasetManifestHash, manifest.manifestHash);
  assert.ok(artifact.weights.some((weight) => Math.abs(weight) > 0.000001));
  for (const sample of preferenceSamples) {
    assert.ok(
      scoreWithPreferenceModel(artifact, sample.chosen)
        > scoreWithPreferenceModel(artifact, sample.rejected),
    );
  }
  return {
    trainingMethod: artifact.trainingMethod,
    allPairAccuracy: artifact.metrics.allPairAccuracy,
    finalLoss: artifact.metrics.finalLoss,
    artifactVerified: true,
    rawSamplesStored: artifact.privacy.rawSamplesStored,
  };
});

await test("RPG formulas have bounded deterministic results", () => {
  assert.equal(experienceForLevel(1), 0);
  assert.equal(experienceForLevel(2), 100);
  assert.equal(levelFromExperience(99), 1);
  assert.equal(levelFromExperience(100), 2);
  const stats = initialRpgStats("諸天萬界|燼星");
  assert.equal(Object.keys(stats).length, 6);
  assert.ok(Object.values(stats).every((value) => value >= 45 && value <= 55));
  const power = computePowerScore(stats, 1);
  const success = computeSuccessChance({
    primary: 50,
    secondary: 50,
    level: 1,
    risk: 3,
  });
  assert.ok(power >= 45 && power <= 55);
  assert.ok(success >= 5 && success <= 95);
  return { stats, power, success };
});

await test("RPG three-choice engine produces distinct governed effects", () => {
  const storyState = { protagonistStats: { ...initialRpgStats("seed"), "rpg.xp": 0 } };
  const progression = readRpgProgression(storyState, "seed");
  const choices = buildRpgChoices({
    progression,
    protagonist: "燼星",
    chapterTitle: "第一章",
    conflict: "城門即將在日落前關閉",
  });
  assert.deepEqual(choices.map((choice) => choice.key), ["A", "B", "C"]);
  assert.equal(new Set(choices.map((choice) => choice.primaryStat)).size, 3);
  assert.ok(choices.every((choice) => choice.effect.statChanges["rpg.xp"] > 0));
  assert.ok(choices.every((choice) => choice.acceptedText.includes("互動分支")));
  return choices.map(({ key, title, successChance, xpGain }) => ({
    key,
    title,
    successChance,
    xpGain,
  }));
});

await test("unified RPG, cultivation and management modes share one governed state", () => {
  const protagonistStats = { ...initialRpgStats("unified-seed"), "rpg.xp": 1_600 };
  const resources = initialRpgResources();
  const storyState = {
    protagonistStats,
    resources,
    money: 1_200,
    inventory: [],
    worldFlags: {
      "rpg.equipped.weapon": "iron-sword",
      "rpg.equipped.armor": "traveler-armor",
      "rpg.equipped.treasure": "contract-seal",
    },
  };
  const modeResults = Object.keys(RPG_MODE_DEFINITIONS).map((mode) => {
    const progression = readRpgProgression(storyState, "unified-seed", mode);
    const choices = buildRpgChoices({
      progression,
      protagonist: "燼星",
      chapterTitle: "統合測試",
      conflict: "有限資源下必須做出取捨",
      mode,
      seed: "unified-choice-seed",
    });
    assert.deepEqual(choices.map((choice) => choice.key), ["A", "B", "C"]);
    assert.deepEqual(new Set(choices.map((choice) => choice.approach)), new Set(["steady", "resource", "bold"]));
    assert.equal(new Set(choices.map((choice) => choice.id)).size, 3);
    assert.ok(choices.every((choice) => choice.costLabels.length > 0));
    return { mode, choices: choices.map(({ id, title }) => ({ id, title })) };
  });
  assert.equal(modeResults.length, 3);
  return modeResults;
});

await test("reroll variants and free actions create different verifiable candidates", () => {
  const progression = readRpgProgression({
    protagonistStats: { ...initialRpgStats("reroll"), "rpg.xp": 100 },
    resources: initialRpgResources(),
    money: 1_200,
    inventory: [],
    worldFlags: {},
  }, "reroll", "adventure");
  const input = {
    progression,
    protagonist: "燼星",
    chapterTitle: "城門",
    conflict: "日落前進城",
    mode: "adventure",
    seed: "reroll-seed",
  };
  const first = buildRpgChoices({ ...input, variant: 0 });
  const second = buildRpgChoices({ ...input, variant: 1 });
  assert.notDeepEqual(first.map((choice) => choice.id), second.map((choice) => choice.id));
  const custom = buildCustomRpgChoice({
    progression,
    action: "假裝撤退並觀察守衛換班",
    protagonist: "燼星",
    chapterTitle: "城門",
    conflict: "日落前進城",
  });
  assert.equal(custom.key, "custom");
  assert.ok(custom.successChance >= 5 && custom.successChance <= 95);
  assert.ok(custom.effect.statChanges["rpg.xp"] > 0);
  return {
    first: first.map((choice) => choice.id),
    rerolled: second.map((choice) => choice.id),
    custom: custom.id,
  };
});

await test("choice resolution is deterministic, graded and writes real continuation", () => {
  const progression = readRpgProgression({
    protagonistStats: { ...initialRpgStats("resolve"), "rpg.xp": 400 },
    resources: initialRpgResources(),
    money: 1_200,
    inventory: [],
    worldFlags: {},
  }, "resolve", "cultivation");
  const choice = buildRpgChoices({
    progression,
    protagonist: "墨衡",
    chapterTitle: "破境之夜",
    conflict: "心魔與疲勞同時逼近",
    mode: "cultivation",
    seed: "resolution-seed",
  })[2];
  const first = resolveRpgChoice(choice, { seed: "project-state", revision: 7 });
  const replay = resolveRpgChoice(choice, { seed: "project-state", revision: 7 });
  assert.deepEqual(first, replay);
  assert.match(first.acceptedText, /規則引擎判定/u);
  assert.match(first.acceptedText, /下一步|故事/u);
  assert.equal(first.effect.worldFlags["rpg.lastOutcome"], first.outcome);
  assert.ok(first.effect.resourceChanges["game.turn"] === 1);
  return { outcome: first.outcome, roll: first.roll, chance: first.successChance };
});

await test("inventory, equipment, currency and management formulas are actionable", () => {
  const resources = initialRpgResources();
  const storyState = {
    protagonistStats: { ...initialRpgStats("economy"), "rpg.xp": 900 },
    resources,
    money: 1_200,
    inventory: [],
    worldFlags: {
      "rpg.equipped.weapon": "iron-sword",
      "rpg.equipped.armor": "traveler-armor",
      "rpg.equipped.treasure": "contract-seal",
    },
  };
  const snapshot = readRpgProgression(storyState, "economy", "management");
  assert.ok(snapshot.inventory.length >= 6);
  assert.equal(snapshot.inventory.find((item) => item.itemId === "healing-potion")?.quantity, 3);
  assert.ok(Object.values(snapshot.equipmentBonuses).some((value) => value > 0));
  assert.equal(RPG_ITEM_CATALOG.find((item) => item.itemId === "contract-seal")?.value, 4_800);
  assert.ok(snapshot.management.employeeEfficiency >= 0 && snapshot.management.employeeEfficiency <= 100);
  assert.ok(Number.isFinite(snapshot.management.expectedNetProfit));
  const settlement = buildManagementSettlementEffect(snapshot);
  assert.equal(settlement.resourceChanges["management.lastRevenue"], snapshot.management.expectedRevenue);
  assert.equal(settlement.resourceChanges["game.day"], 1);
  return {
    items: snapshot.inventory.length,
    carryWeight: snapshot.carryWeight,
    employeeEfficiency: snapshot.management.employeeEfficiency,
    expectedNetProfit: snapshot.management.expectedNetProfit,
  };
});

await test("RPG state application clamps stats and accumulates progress", () => {
  const now = "2026-01-01T00:00:00.000Z";
  const baseState = {
    id: "state",
    projectId: "project",
    revision: 1,
    parentRevision: null,
    createdAt: now,
    updatedAt: now,
    provenance: { actor: "user", source: "user" },
    protagonistStats: { "rpg.courage": 99, "rpg.xp": 90 },
    resources: {},
    money: 0,
    inventory: [],
    relationships: { "rpg.partyTrust": 99 },
    reputation: null,
    factionStanding: {},
    worldFlags: {},
    questStates: { "rpg.mainArc": "95" },
    achievementStates: { "rpg.bold": "90" },
    timeState: null,
    locationState: null,
    riskState: null,
  };
  const next = applyStoryChoiceEffect(baseState, {
    statChanges: { "rpg.courage": 8, "rpg.xp": 30 },
    relationshipChanges: { "rpg.partyTrust": 8 },
    resourceChanges: {},
    moneyChange: 0,
    worldFlags: {},
    questProgress: { "rpg.mainArc": 10 },
    achievementProgress: { "rpg.bold": 20 },
    timelineEvents: [],
  });
  assert.equal(next.protagonistStats["rpg.courage"], 100);
  assert.equal(next.protagonistStats["rpg.xp"], 120);
  assert.equal(next.relationships["rpg.partyTrust"], 100);
  assert.equal(next.questStates["rpg.mainArc"], "100");
  assert.equal(next.achievementStates["rpg.bold"], "100");
  return {
    courage: next.protagonistStats["rpg.courage"],
    xp: next.protagonistStats["rpg.xp"],
    quest: next.questStates["rpg.mainArc"],
  };
});

await test("browser AI evaluates abilities, XP, task and achievement evidence", () => {
  const result = runPackagedBrowserTaskModel("game.stateEvaluation", [
    "【RPG StoryState｜正式狀態】",
    "rpg.courage: 54",
    "rpg.craft: 50",
    "rpg.empathy: 47",
    "rpg.insight: 55",
    "rpg.renown: 51",
    "rpg.resilience: 54",
    "rpg.xp: 33",
    "任務進度: 100",
    "成就進度: 100",
  ].join("\n"));
  assert.match(result.content, /已讀取 9 個數值欄位/u);
  assert.match(result.content, /沒有越界/u);
  assert.equal(result.externalRequest, false);
  assert.equal(result.dataLeftDevice, false);
  return {
    evidenceFields: 9,
    modelDigest: result.modelDigest,
    externalRequest: result.externalRequest,
  };
});

await test("character library rejects malformed rows and keeps reusable custom characters", () => {
  const custom = {
    ...BUILTIN_RPG_CHARACTERS[0],
    schemaVersion: RPG_CHARACTER_LIBRARY_SCHEMA,
    templateId: "custom-1",
    name: "我的角色",
    builtin: false,
  };
  const parsed = parseRpgCharacterLibrary(JSON.stringify([custom, { invalid: true }]));
  assert.equal(parsed.length, 1);
  const merged = mergeCharacterLibrary(parsed);
  assert.equal(merged.length, BUILTIN_RPG_CHARACTERS.length + 1);
  assert.equal(merged.at(-1)?.name, "我的角色");
  return { builtin: BUILTIN_RPG_CHARACTERS.length, custom: parsed.length };
});

await test("mature character vault contains ten women and ten men with valid RPG profiles", () => {
  const women = BUILTIN_MATURE_RPG_CHARACTERS.filter((character) => character.gender === "woman");
  const men = BUILTIN_MATURE_RPG_CHARACTERS.filter((character) => character.gender === "man");
  const ids = new Set(BUILTIN_MATURE_RPG_CHARACTERS.map((character) => character.templateId));
  assert.equal(BUILTIN_MATURE_RPG_CHARACTERS.length, 20);
  assert.equal(women.length, 10);
  assert.equal(men.length, 10);
  assert.equal(ids.size, 20);
  assert.ok(BUILTIN_MATURE_RPG_CHARACTERS.every((character) => character.matureTheme === true));
  assert.ok(BUILTIN_MATURE_RPG_CHARACTERS.every((character) => Number(character.age) >= 21));
  assert.ok(BUILTIN_MATURE_RPG_CHARACTERS.every((character) => Boolean(character.rpgArchetype)));
  assert.ok(BUILTIN_MATURE_RPG_CHARACTERS.every((character) => (character.relationshipHooks?.length ?? 0) >= 2));
  assert.ok(BUILTIN_MATURE_RPG_CHARACTERS.every((character) => (character.boundaries?.length ?? 0) >= 2));
  return {
    total: BUILTIN_MATURE_RPG_CHARACTERS.length,
    women: women.length,
    men: men.length,
    minimumAge: Math.min(...BUILTIN_MATURE_RPG_CHARACTERS.map((character) => Number(character.age))),
  };
});

await test("unified story navigation absorbs RPG and release caches cannot pin stale UI", async () => {
  const [navigation, globalCss, rpgRoute, conversationRpg, workspace, serviceWorker] = await Promise.all([
    readFile(new URL("../app/studio/project/[projectId]/project-navigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/rpg/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/rpg/rpg-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/studio-service-worker.js", import.meta.url), "utf8"),
  ]);
  assert.match(navigation, /\["chat", "ai", "rpg"\]\.includes\(active\)/u);
  assert.match(navigation, /故事工作台/u);
  assert.doesNotMatch(navigation, /\["rpg","RPG 養成"\]/u);
  assert.match(rpgRoute, /redirect\(`\/studio\/project\/\$\{encodeURIComponent\(projectId\)\}\/chat\?mode=play`\)/u);
  assert.match(conversationRpg, /buildRpgRuleChoicePlan/u);
  assert.match(conversationRpg, /planRpgChatChoices\(\{/u);
  assert.match(conversationRpg, /fallbackReason: "USER_REQUESTED_RULE_FALLBACK"/u);
  assert.match(conversationRpg, /最長等待 180 秒/u);
  assert.doesNotMatch(conversationRpg, /RPG_CHOICE_RULE_PLAN_IMMEDIATE/u);
  assert.match(globalCss, /\.p2ProjectNav\{display:grid/u);
  assert.match(globalCss, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/u);
  assert.match(workspace, /規則先結算 → 產生候選正文 → 你核准才原子寫入/u);
  assert.match(workspace, /data-testid="rpg-resolution-progress"/u);
  assert.match(
    workspace,
    /const RPG_TURN_TIMEOUT_MS = \(\s*RPG_CHAT_STORY_AI_TIMEOUT_MS\s*\+ RPG_CHAT_FALLBACK_REVIEW_TIMEOUT_MS\s*\+ RPG_CHAT_FALLBACK_REPAIR_RETRY_TIMEOUT_MS\s*\+ RPG_TURN_COMPLETION_GRACE_MS\s*\);/u,
  );
  assert.match(workspace, /signal: controller\.signal/u);
  assert.match(workspace, /data-testid="rpg-live-draft"/u);
  assert.match(workspace, /data-testid="rpg-cancel-turn"/u);
  assert.match(workspace, /數值、物品與貨幣均未結算/u);
  assert.doesNotMatch(workspace, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/u);
  assert.match(workspace, /我喜歡的人物庫/u);
  assert.match(serviceWorker, /NOVEL_RELEASE_IDENTITY/u);
  assert.match(serviceWorker, /identity\.appCommit[\s\S]*identity\.assetManifestDigest/u);
  assert.match(serviceWorker, /retainOnly\(cacheName\)/u);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/_next\/static\/"\)[\s\S]*cacheFirst\(request\)/u);
  return {
    navigation: "one story workbench with RPG mode and compatibility redirect",
    mobileMenu: "four-column non-overflow grid",
    approval: "explicit, cancellable, and mutation-free until completion",
    turnRuntime: "single streamed generation with a 180-second AI ceiling and bounded fallback finalization",
    updateStrategy: "commit-and-digest cache identity with content-addressed chunk reuse",
  };
});

const failed = results.filter((result) => result.status === "FAIL");
process.stdout.write(`${JSON.stringify({
  suite: "novel-super-agent-rpg",
  passed: results.length - failed.length,
  failed: failed.length,
  results,
}, null, 2)}\n`);
if (failed.length) process.exitCode = 1;
