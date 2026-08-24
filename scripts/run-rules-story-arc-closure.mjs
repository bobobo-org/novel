import assert from "node:assert/strict";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import {
  buildTopicWorldFamilyStageMatrix,
  serializeTopicWorldFamilyDraftSelection,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import {
  STORY_ENDING_CONTRACT_VERSION,
  STORY_POST_ENDING_ACTIONS,
  evaluateStoryEnding,
  readStoryEnding,
} from "../lib/novel-ai/game/story-ending-contract.ts";
import {
  approveRpgChatTurn,
  buildDeterministicRpgChatTurnCandidate,
  buildRpgReaderSafeCausalPayload,
  buildRpgRuleChoicePlan,
  buildRpgTurnCausalContract,
  loadRpgChatSnapshot,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import {
  buildRpgChoiceDirectorPrompt,
  buildRpgResolutionDirectorPrompt,
  parseRpgChoiceDirectorOutput,
  validateRpgStoryTurnContract,
} from "../lib/novel-ai/web/rpg-closed-ai-director.ts";

const scenarios = ["rpg", "romance", "management"];
const expectedPhases = ["setup", "escalation", "escalation", "reversal", "reversal", "climax", "climax", "resolution"];
const observations = [];
const INTERNAL_PROMPT_KEY_RE = /"(?:arcHorizon|arcPhase|arcStartTurn|arcLocalTurn|arcKey|arcResolved|arcResolutionKind|arcNextAction|persistentArc|readerDisclosure|endingReachable|endingOptionsRequired|mayRevealEndingConditions|mayRevealPresetHorizon|horizon|phase)"\s*:/iu;
const INTERNAL_PROMPT_VALUE_RE = /(?:internal[\s_-]*)?(?:arc[\s_-]*)?horizon|(?:arc[\s_-]*phase)|(?:結局|結案|完結|收束)(?:的)?(?:條件|門檻|判定|檢查|清單|觸發規則|證據要求)|(?:預設|上限|最晚|剩下)[^。！？\n]{0,12}(?:\d{1,3}|[一二三四五六七八九十百兩]+)\s*(?:個)?回合/iu;
function assertReaderSafePromptData(value, label) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, INTERNAL_PROMPT_KEY_RE, `${label} leaked an internal planning key`);
  assert.doesNotMatch(serialized, INTERNAL_PROMPT_VALUE_RE, `${label} leaked internal planning prose`);
}

assert.throws(
  () => parseRpgChoiceDirectorOutput(JSON.stringify({
    choices: [
      { key: "A", title: "沿著證詞追查密訊", description: "系統預設總共八回合，因此現在必須提前公開內部安排。", consequenceTeaser: "會直接暴露未公開的規劃" },
      { key: "B", title: "先保住證人的退路", description: "主角先確認出口與同伴立場，再決定如何承擔眼前代價。", consequenceTeaser: "可能保住信任但失去時間" },
      { key: "C", title: "冒險逼迫對手表態", description: "主角利用已知痕跡施壓，迫使藏在封鎖後的人留下反應。", consequenceTeaser: "可能取得證據也會暴露位置" },
    ],
  })),
  (error) => error?.message === "RPG_AI_INTERNAL_STORY_MECHANICS_LEAK",
);
assert.throws(
  () => validateRpgStoryTurnContract("The internal arc horizon is eight rounds, and the ending criteria become active afterward.", "en"),
  (error) => error?.message === "RPG_AI_INTERNAL_STORY_MECHANICS_LEAK",
);
assert.throws(
  () => validateRpgStoryTurnContract("只有符合結局門檻與系統判定，故事才可以結束。", "zh-TW"),
  (error) => error?.message === "RPG_AI_INTERNAL_STORY_MECHANICS_LEAK",
);
for (const leakedStory of [
  "The story is planned for eight turns before it can close.",
  "The arc is currently in escalation.",
  "These are the requirements for the ending.",
  "八回合後故事就會結案。",
  "故事弧目前進入反轉階段。",
]) {
  assert.throws(
    () => validateRpgStoryTurnContract(leakedStory, leakedStory.includes("。") ? "zh-TW" : "en"),
    (error) => error?.message === "RPG_AI_INTERNAL_STORY_MECHANICS_LEAK",
  );
}
for (const visibleEngineStory of [
  "核准規則：先鎖定狀態更新；本回合目標是守住資金。",
  "關係張力來自團隊分歧，結算結果會限制下一輪可用人力。",
]) {
  assert.throws(
    () => validateRpgStoryTurnContract(visibleEngineStory, "zh-TW"),
    (error) => error?.message === "RPG_AI_INTERNAL_STORY_MECHANICS_LEAK",
  );
}
const closureLedger = (snapshot) => Object.fromEntries([
  "story.arc.resolvedThread",
  "story.arc.resolvedTurn",
  "story.arc.resolutionKind",
  "story.arc.ledgerEntry",
  "story.ending.contractVersion",
  "story.ending.arcKey",
  "story.ending.answeredGoal",
  "story.ending.resolvedThread",
  "story.ending.resolutionKind",
  "story.ending.resolvedTurn",
  "story.ending.ledgerEntry",
].map((key) => [key, snapshot.storyState.worldFlags[key]]));

const falseEndingSignals = evaluateStoryEnding({
  coreGoalDecisivelyAnswered: false,
  centralThreadResolved: false,
  canonicalConsequencesPersisted: false,
  completeNarrativePersisted: false,
  immutableLedgerPersisted: false,
  userApproved: false,
  sceneOrChapterEnded: true,
  temporaryOutcome: true,
  resourcesExhausted: true,
});
assert.equal(falseEndingSignals.isEnding, false);
assert.equal(falseEndingSignals.missingEvidence.length, 6);
assert.deepEqual(falseEndingSignals.ignoredNonEndingSignals, [
  "scene-or-chapter-ended",
  "temporary-outcome",
  "resources-exhausted",
]);

for (const playMode of scenarios) {
  const repository = new MemoryNovelRepository();
  const draft = createDraft("quick");
  draft.title = `八回合結案-${playMode}`;
  draft.genrePackId = "pack-6";
  draft.genreId = "classic-topic-009";
  draft.protagonist = optionalValue("林澄", "user_defined");
  draft.coreIdea = optionalValue("林澄必須在封鎖完成前查明密訊來源，並保住蘇錦魚的選擇權。", "user_defined");
  draft.answers.playMode = optionalValue(playMode, "user_defined");
  const stageMatrix = buildTopicWorldFamilyStageMatrix({
    seed: `novel-project:${draft.projectId}:procedural-v1`,
    topicId: draft.genreId,
    playMode,
  });
  draft.answers.stageFamily = optionalValue(
    serializeTopicWorldFamilyDraftSelection({
      matrix: stageMatrix,
      familyId: stageMatrix.stageFamilies[0].familyId,
    }),
    "user_defined",
  );
  const bundle = buildProjectBundle(draft);
  await repository.createProject(bundle, `arc-closure:${playMode}`);
  const chapter = await repository.put("chapters", {
    ...makeRecord(bundle.project.id),
    title: "天亮前的封鎖",
    order: 1,
    content: "青楓派巡察將在天亮封鎖通路；桌上的遲到密訊與蘇錦魚的證詞，是林澄僅有的線索。",
    summary: "封鎖逼近，密訊來源仍未查明。",
    status: "draft",
  });
  await repository.put("projects", { ...bundle.project, activeChapterId: chapter.id }, bundle.project.revision);
  const companion = await repository.put("characters", {
    ...makeRecord(bundle.project.id),
    name: "蘇錦魚",
    aliases: [],
    identity: optionalValue("持有關鍵證詞的同行者", "user_defined"),
    personality: optionalValue("審慎、尊重界線，也會追問責任", "user_defined"),
    goal: optionalValue("在天亮前保有說出真相的選擇權", "user_defined"),
    lifeStatus: "alive",
    locationId: null,
  });
  const thread = "查明遲到密訊的來源並解除青楓派封鎖";
  const remainingThread = playMode === "management"
    ? "處理尚未兌現的供應承諾與團隊交接"
    : null;
  const bible = await repository.get("storyBibles", bundle.storyBible.id);
  assert.ok(bible);
  await repository.put("storyBibles", {
    ...bible,
    characterIds: [...new Set([...bible.characterIds, companion.id])],
    unresolvedThreads: remainingThread ? [remainingThread, thread] : [thread],
    resolvedThreads: [],
  }, bible.revision);
  const initialState = await repository.get("storyStates", bundle.storyState.id);
  assert.ok(initialState);
  await repository.put("storyStates", {
    ...initialState,
    resources: { ...initialState.resources, "canon.sequelKeepsake": 7 },
    inventory: [...new Set([...initialState.inventory, "見證者信物"])],
    relationships: { ...initialState.relationships, "canon.sequelBond": 42 },
    timeState: "第八日黎明前",
    locationState: "雲汀郡封鎖線",
  }, initialState.revision);

  let arcKey = null;
  let closureStory = null;
  const phases = [];
  const signatures = [];
  const fallbackTimes = [];
  for (let index = 0; index < 8; index += 1) {
    const snapshot = await loadRpgChatSnapshot(repository, bundle.project.id);
    assert.equal(snapshot.progression.turn, index);
    assert.equal(snapshot.baseChoices.length, 3);
    assert.deepEqual(snapshot.baseChoices.map((choice) => choice.key), ["A", "B", "C"]);
    assert.equal(snapshot.baseChoices.some((choice) => choice.disabledReason), false);
    const choiceArcKeys = new Set(snapshot.baseChoices.map((choice) => choice.encounter.arcKey));
    assert.equal(choiceArcKeys.size, 1);
    arcKey ??= snapshot.baseChoices[0].encounter.arcKey;
    assert.equal(snapshot.baseChoices[0].encounter.arcKey, arcKey);
    assert.equal(snapshot.baseChoices[0].encounter.arcThread, thread);
    assert.equal(snapshot.baseChoices[0].encounter.arcLocalTurn, index + 1);
    assert.equal(snapshot.baseChoices[0].encounter.arcHorizon, 8);
    assert.equal(snapshot.baseChoices[0].encounter.arcPhase, expectedPhases[index]);
    assert.equal(readStoryEnding(snapshot.storyState).isEnding, false);
    phases.push(snapshot.baseChoices[0].encounter.arcPhase);
    signatures.push(snapshot.baseChoices.map((choice) => choice.encounter.signature));

    const causalContract = buildRpgTurnCausalContract({
      snapshot,
      choice: snapshot.baseChoices[0],
    });
    const readerSafeCausalPayload = buildRpgReaderSafeCausalPayload({
      snapshot,
      choice: snapshot.baseChoices[0],
    });
    assertReaderSafePromptData(readerSafeCausalPayload, `${playMode}/turn-${index + 1}/causal-payload`);
    const choicePrompt = JSON.parse(buildRpgChoiceDirectorPrompt({
      context: {
        ...snapshot.directorContext,
        arcHorizon: 8,
        internalPlan: "The story is planned for eight turns before its ending criteria activate.",
      },
      baseChoices: snapshot.baseChoices,
      language: snapshot.language,
      readerSafeCausalContracts: snapshot.baseChoices.map((choice) => ({
        key: choice.key,
        contract: buildRpgReaderSafeCausalPayload({ snapshot, choice }),
      })),
    }));
    const { instruction: choiceInstruction, ...choicePromptData } = choicePrompt;
    assert.match(choiceInstruction, /回合上限/u);
    assert.match(choiceInstruction, /結局條件/u);
    assertReaderSafePromptData(choicePromptData, `${playMode}/turn-${index + 1}/choice-prompt`);
    assert.ok(
      choicePrompt.immutableRuleChoices.every(
        (choice) => !("encounter" in choice) && choice.storySignals,
      ),
      `${playMode}/turn-${index + 1}/choice-prompt must serialize reader-safe story signals only`,
    );
    const visibleChoices = snapshot.baseChoices
      .map((choice) => `${choice.title} ${choice.description} ${choice.consequenceTeaser}`)
      .join("\n");

    if (index < 7) {
      assert.ok(snapshot.baseChoices.every((choice) => !choice.encounter.arcResolved));
      assert.ok(snapshot.baseChoices.every((choice) => !choice.encounter.arcResolutionKind));
      assert.equal(causalContract.persistentArc.readerDisclosure.stage, "in-progress");
      assert.equal(causalContract.persistentArc.readerDisclosure.mayRevealClosureChoices, false);
      assert.equal(causalContract.persistentArc.readerDisclosure.mayRevealPresetHorizon, false);
      assert.deepEqual(readerSafeCausalPayload.continuity.currentDirections, []);
      assert.doesNotMatch(
        causalContract.persistentArc.closureBeat,
        /第\s*8\s*回合|八回合|最晚|完成目標|承擔代價|帶著後果離場|閱讀尾聲|開啟續篇|封存結局/u,
      );
      assert.doesNotMatch(
        visibleChoices,
        /第\s*8\s*回合|八回合|結案|結局|完成目標|承擔代價|帶著後果離場|閱讀尾聲|開啟續篇|封存結局/u,
      );
    } else {
      assert.equal(causalContract.persistentArc.readerDisclosure.stage, "closure-now");
      assert.equal(causalContract.persistentArc.readerDisclosure.mayRevealClosureChoices, true);
      assert.equal(causalContract.persistentArc.readerDisclosure.mayRevealPostEndingActions, false);
      assert.deepEqual(
        readerSafeCausalPayload.continuity.currentDirections.map((choice) => choice.title),
        snapshot.baseChoices.map((choice) => choice.title),
      );
      assert.doesNotMatch(
        JSON.stringify(readerSafeCausalPayload),
        /閱讀尾聲|開啟續篇|封存結局/u,
      );
      assert.deepEqual(
        snapshot.baseChoices.map((choice) => choice.encounter.arcResolutionKind),
        ["complete", "accept-cost", "leave-consequence"],
      );
      assert.ok(snapshot.baseChoices.every((choice) => choice.encounter.arcResolved));
      assert.match(snapshot.baseChoices[0].title, /完成目標/u);
      assert.match(snapshot.baseChoices[1].title, /承擔代價/u);
      assert.match(snapshot.baseChoices[2].title, /帶著後果離場/u);
      assert.doesNotMatch(visibleChoices, /閱讀尾聲|開啟續篇|封存結局/u);
      assert.ok(snapshot.baseChoices.some((choice) => !choice.disabledReason));
    }

    const selected = index === 7
      ? snapshot.baseChoices[0]
      : snapshot.baseChoices.find((choice) => choice.approach === "steady") ?? snapshot.baseChoices[0];
    const candidate = await buildDeterministicRpgChatTurnCandidate({
      snapshot,
      choice: selected,
      failureReason: "ARC_CLOSURE_CONTRACT_TEST",
    });
    const resolutionPrompt = JSON.parse(buildRpgResolutionDirectorPrompt({
      context: snapshot.directorContext,
      choice: selected,
      language: snapshot.language,
      turnNumber: snapshot.progression.turn + 1,
      resolution: {
        outcomeLabel: candidate.resolution.outcomeLabel,
        roll: candidate.resolution.roll,
        successChance: candidate.resolution.successChance,
        settlement: [
          ...candidate.outcomeLines,
          "The narrative is designed for eight turns.",
        ],
      },
      readerSafeCausalContract: buildRpgReaderSafeCausalPayload({
        snapshot,
        choice: selected,
        outcome: candidate.resolution.outcome,
      }),
    }));
    const { instruction: resolutionInstruction, ...resolutionPromptData } = resolutionPrompt;
    assert.match(resolutionInstruction, /回合上限/u);
    assert.match(resolutionInstruction, /結局條件/u);
    assertReaderSafePromptData(resolutionPromptData, `${playMode}/turn-${index + 1}/resolution-prompt`);
    assert.equal("encounter" in resolutionPrompt.selectedChoice, false);
    assert.ok(resolutionPrompt.selectedChoice.storySignals);
    fallbackTimes.push(candidate.executionReceipt.fallbackGenerationMs);
    assert.ok(candidate.executionReceipt.fallbackGenerationMs < 1_000);
    if (index < 7) {
      assert.doesNotMatch(
        candidate.story,
        /第\s*8\s*回合|八回合|最晚第|完成目標|承擔代價|帶著後果離場|閱讀尾聲|開啟續篇|封存結局/u,
      );
    } else {
      closureStory = candidate.story;
      assert.match(candidate.story, /真正的終點|抵達.{0,8}終點|故事真正安靜/u);
      assert.doesNotMatch(
        candidate.story,
        /核准規則|規則校準|本回合|下一回合|回合制|關係張力|狀態更新|結算結果|下一輪可用|Story Bible|Canon/u,
      );
      assert.doesNotMatch(candidate.story, /等待下一步選擇|下一回合能追查/u);
    }
    await approveRpgChatTurn({ repository, snapshot, candidate });

    const persisted = await repository.get("storyStates", snapshot.storyState.id);
    assert.ok(persisted);
    assert.equal(persisted.worldFlags["story.arc.key"], arcKey);
    assert.equal(persisted.worldFlags["story.arc.goal"], snapshot.baseChoices[0].encounter.arcGoal);
    assert.equal(persisted.worldFlags["story.arc.thread"], thread);
    assert.equal(persisted.worldFlags["story.arc.startTurn"], 0);
    assert.equal(persisted.worldFlags["story.arc.localTurn"], index + 1);
    assert.equal(persisted.worldFlags["story.arc.horizon"], 8);
    assert.equal(persisted.worldFlags["story.arc.phase"], expectedPhases[index]);
    assert.equal(persisted.worldFlags["story.arc.resolved"], index === 7);
    const persistedEnding = readStoryEnding(persisted);
    assert.equal(persistedEnding.isEnding, index === 7);
    if (index === 7) {
      assert.equal(persistedEnding.evidenceSource, "explicit-v1");
      assert.equal(persistedEnding.missingEvidence.length, 0);
      assert.ok(Object.values(persistedEnding.evidence).every(Boolean));
    }
  }

  const closed = await loadRpgChatSnapshot(repository, bundle.project.id);
  assert.equal(closed.progression.turn, 8);
  assert.equal(closed.storyState.worldFlags["story.arc.resolved"], true);
  assert.equal(closed.storyState.worldFlags["story.arc.resolvedThread"], thread);
  assert.equal(closed.storyState.worldFlags["story.arc.resolutionKind"], "complete");
  assert.equal(typeof closed.storyState.worldFlags["story.arc.ledgerEntry"], "string");
  assert.equal(closed.storyState.worldFlags["story.ending.contractVersion"], STORY_ENDING_CONTRACT_VERSION);
  assert.equal(closed.storyState.worldFlags["story.ending.userApproved"], true);
  assert.equal(closed.storyState.worldFlags["story.ending.completeNarrativePersisted"], true);
  assert.equal(closed.storyState.worldFlags["story.ending.canonicalConsequencesPersisted"], true);
  assert.equal(closed.storyState.worldFlags["story.ending.immutableLedgerPersisted"], true);
  assert.equal(readStoryEnding(closed.storyState).isEnding, true);
  assert.ok(closureStory);
  assert.ok(closed.chapter.content.includes(closureStory));
  assert.ok(closed.storyBible.resolvedThreads.includes(thread));
  assert.ok(!closed.storyBible.unresolvedThreads.includes(thread));
  assert.deepEqual(
    closed.baseChoices.map((choice) => choice.encounter.arcNextAction),
    STORY_POST_ENDING_ACTIONS,
  );
  for (const choice of closed.baseChoices) {
    const postEndingContract = buildRpgTurnCausalContract({ snapshot: closed, choice });
    assert.equal(postEndingContract.persistentArc.readerDisclosure.stage, "post-ending");
    assert.equal(postEndingContract.persistentArc.readerDisclosure.mayRevealClosureChoices, false);
    assert.equal(postEndingContract.persistentArc.readerDisclosure.mayRevealPostEndingActions, true);
  }
  assert.equal(closed.baseChoices[0].encounter.arcResolved, true);
  assert.equal(closed.baseChoices[2].encounter.arcResolved, true);
  assert.equal(closed.baseChoices[1].encounter.arcResolved, false);
  assert.match(closed.baseChoices[1].title, /開啟續篇／下一卷/u);
  assert.ok(closed.baseChoices.every((choice) => !`${choice.title} ${choice.description}`.includes(thread)));
  assert.equal(new Set(signatures.flat()).size, signatures.flat().length);

  const immutableClosureLedger = closureLedger(closed);
  const closedExport = await repository.exportProject(bundle.project.id);
  const archiveRepository = new MemoryNovelRepository();
  const archiveProjectId = await archiveRepository.importProject(closedExport, "copy");

  const epilogueChoice = closed.baseChoices[0];
  const epilogueCandidate = await buildDeterministicRpgChatTurnCandidate({
    snapshot: closed,
    choice: epilogueChoice,
    failureReason: "ARC_EPILOGUE_CONTRACT_TEST",
  });
  fallbackTimes.push(epilogueCandidate.executionReceipt.fallbackGenerationMs);
  assert.match(epilogueCandidate.story, /沒有新的危機|完整的去向|旅程就停在此處/u);
  assert.doesNotMatch(
    epilogueCandidate.story,
    /核准規則|規則校準|本回合|下一回合|回合制|關係張力|狀態更新|結算結果|下一輪可用|Story Bible|Canon/u,
  );
  assert.doesNotMatch(epilogueCandidate.story, /下一回合能追查|新的三條|等待下一步選擇/u);
  await approveRpgChatTurn({ repository, snapshot: closed, candidate: epilogueCandidate });

  const afterEpilogue = await loadRpgChatSnapshot(repository, bundle.project.id);
  assert.equal(afterEpilogue.progression.turn, 9);
  assert.equal(afterEpilogue.storyState.worldFlags["story.arc.epilogueRead"], true);
  assert.deepEqual(closureLedger(afterEpilogue), immutableClosureLedger);
  assert.deepEqual(afterEpilogue.baseChoices.map((choice) => choice.key), ["A", "B", "C"]);
  assert.match(afterEpilogue.baseChoices[0].disabledReason ?? "", /尾聲已閱讀/u);
  assert.equal(afterEpilogue.baseChoices[1].disabledReason, null);
  assert.equal(afterEpilogue.baseChoices[2].disabledReason, null);

  const repeatBefore = {
    projectRevision: afterEpilogue.project.revision,
    chapterRevision: afterEpilogue.chapter.revision,
    accepted: afterEpilogue.acceptedChoices.length,
    receipts: afterEpilogue.rpgTurnReceipts.length,
  };
  await assert.rejects(
    () => buildDeterministicRpgChatTurnCandidate({
      snapshot: afterEpilogue,
      choice: afterEpilogue.baseChoices[0],
      failureReason: "ARC_EPILOGUE_REPEAT_TEST",
    }),
    (error) => error?.code === "STORY_ARC_EPILOGUE_ALREADY_READ",
  );
  const afterRejectedRepeat = await loadRpgChatSnapshot(repository, bundle.project.id);
  assert.deepEqual({
    projectRevision: afterRejectedRepeat.project.revision,
    chapterRevision: afterRejectedRepeat.chapter.revision,
    accepted: afterRejectedRepeat.acceptedChoices.length,
    receipts: afterRejectedRepeat.rpgTurnReceipts.length,
  }, repeatBefore);
  assert.deepEqual(closureLedger(afterRejectedRepeat), immutableClosureLedger);

  const continuationChoice = afterEpilogue.baseChoices[1];
  const nextArcKey = continuationChoice.encounter.arcKey;
  const nextThread = continuationChoice.encounter.arcThread;
  assert.notEqual(nextArcKey, arcKey);
  assert.notEqual(nextThread, thread);
  if (remainingThread) assert.equal(nextThread, remainingThread);
  else assert.equal(nextThread, "結案後果引發的新責任、新對手與下一個期限");
  assert.equal(continuationChoice.encounter.arcLocalTurn, 0);
  assert.equal(continuationChoice.encounter.arcPhase, "setup");
  assert.equal(continuationChoice.encounter.arcStartTurn, 10);
  const continuationCandidate = await buildDeterministicRpgChatTurnCandidate({
    snapshot: afterEpilogue,
    choice: continuationChoice,
    failureReason: "ARC_SEQUEL_CONTRACT_TEST",
  });
  assert.ok(continuationCandidate.executionReceipt.fallbackGenerationMs < 1_000);
  assert.match(continuationCandidate.story, /另一段故事由此開始|走向新地點/u);
  await approveRpgChatTurn({ repository, snapshot: afterEpilogue, candidate: continuationCandidate });
  const sequel = await loadRpgChatSnapshot(repository, bundle.project.id);
  assert.equal(sequel.progression.turn, 10);
  assert.deepEqual(sequel.baseChoices.map((choice) => choice.key), ["A", "B", "C"]);
  assert.equal(sequel.baseChoices.some((choice) => choice.disabledReason), false);
  assert.ok(sequel.baseChoices.every((choice) => choice.encounter.arcKey === nextArcKey));
  assert.ok(sequel.baseChoices.every((choice) => choice.encounter.arcThread === nextThread));
  assert.ok(sequel.baseChoices.every((choice) => choice.encounter.arcLocalTurn === 1));
  assert.ok(sequel.baseChoices.every((choice) => choice.encounter.arcPhase === "setup"));
  assert.ok(sequel.baseChoices.every((choice) => choice.encounter.arcResolved === false));
  assert.ok(sequel.storyBible.unresolvedThreads.includes(nextThread));
  assert.ok(!sequel.storyBible.unresolvedThreads.includes(thread));
  assert.ok(sequel.storyBible.resolvedThreads.includes(thread));
  assert.equal(sequel.storyState.resources["canon.sequelKeepsake"], 7);
  assert.equal(sequel.storyState.relationships["canon.sequelBond"], 42);
  assert.ok(sequel.storyState.inventory.includes("見證者信物"));
  assert.equal(sequel.storyState.timeState, "第八日黎明前");
  assert.equal(sequel.storyState.locationState, "雲汀郡封鎖線");
  assert.equal(sequel.characters.some((character) => character.id === companion.id), true);
  assert.equal(sequel.storyState.worldFlags["story.arc.resolved"], false);
  assert.equal(readStoryEnding(sequel.storyState).isEnding, false);
  assert.equal(sequel.storyState.worldFlags["story.arc.nextAction"], "new-arc");
  assert.equal(sequel.storyState.worldFlags["story.arc.key"], nextArcKey);
  assert.equal(sequel.storyState.worldFlags["story.arc.thread"], nextThread);
  assert.equal(sequel.storyState.worldFlags["story.arc.startTurn"], 10);
  assert.equal(sequel.rpgTurnReceipts.length, 10);
  assert.deepEqual(closureLedger(sequel), immutableClosureLedger);
  const sequelContract = buildRpgTurnCausalContract({
    snapshot: sequel,
    choice: sequel.baseChoices[0],
  });
  assert.equal(sequelContract.persistentArc.readerDisclosure.stage, "in-progress");
  assert.equal(sequelContract.persistentArc.readerDisclosure.mayRevealClosureChoices, false);
  assert.equal(sequelContract.persistentArc.readerDisclosure.mayRevealPostEndingActions, false);

  const archiveClosed = await loadRpgChatSnapshot(archiveRepository, archiveProjectId);
  assert.deepEqual(closureLedger(archiveClosed), immutableClosureLedger);
  const archiveChoice = archiveClosed.baseChoices[2];
  const archiveCandidate = await buildDeterministicRpgChatTurnCandidate({
    snapshot: archiveClosed,
    choice: archiveChoice,
    failureReason: "ARC_ARCHIVE_CONTRACT_TEST",
  });
  fallbackTimes.push(archiveCandidate.executionReceipt.fallbackGenerationMs);
  assert.match(archiveCandidate.story, /故事真正安靜|已結束的衝突|關上門/u);
  assert.doesNotMatch(
    archiveCandidate.story,
    /核准規則|規則校準|本回合|下一回合|回合制|關係張力|狀態更新|結算結果|下一輪可用|Story Bible|Canon/u,
  );
  assert.doesNotMatch(archiveCandidate.story, /下一回合能追查|新的三條|等待下一步選擇/u);
  await approveRpgChatTurn({
    repository: archiveRepository,
    snapshot: archiveClosed,
    candidate: archiveCandidate,
  });
  const archived = await loadRpgChatSnapshot(archiveRepository, archiveProjectId);
  assert.equal(archived.progression.turn, 9);
  assert.equal(archived.storyState.worldFlags["story.arc.archived"], true);
  assert.equal(archived.baseChoices.length, 0);
  assert.deepEqual(closureLedger(archived), immutableClosureLedger);
  assert.ok(archived.storyBible.resolvedThreads.includes(thread));
  assert.ok(!archived.storyBible.unresolvedThreads.includes(thread));
  const archivedPlan = await buildRpgRuleChoicePlan({
    snapshot: archived,
    fallbackReason: "ARC_ARCHIVED_TERMINAL_TEST",
  });
  assert.equal(archivedPlan.choices.length, 0);
  assert.equal(archivedPlan.executionReceipt.terminalArchive, true);
  const archiveBeforeRepeat = {
    projectRevision: archived.project.revision,
    chapterRevision: archived.chapter.revision,
    accepted: archived.acceptedChoices.length,
    receipts: archived.rpgTurnReceipts.length,
  };
  await assert.rejects(
    () => buildDeterministicRpgChatTurnCandidate({
      snapshot: archived,
      choice: archiveChoice,
      failureReason: "ARC_ARCHIVE_REPEAT_TEST",
    }),
    (error) => error?.code === "STORY_ARC_ARCHIVED",
  );
  const afterArchiveRepeat = await loadRpgChatSnapshot(archiveRepository, archiveProjectId);
  assert.deepEqual({
    projectRevision: afterArchiveRepeat.project.revision,
    chapterRevision: afterArchiveRepeat.chapter.revision,
    accepted: afterArchiveRepeat.acceptedChoices.length,
    receipts: afterArchiveRepeat.rpgTurnReceipts.length,
  }, archiveBeforeRepeat);

  observations.push({
    playMode,
    arcKey,
    phases,
    resolutionKinds: ["complete", "accept-cost", "leave-consequence"],
    postArcActions: closed.baseChoices.map((choice) => choice.encounter.arcNextAction),
    epilogueReadOnce: afterEpilogue.storyState.worldFlags["story.arc.epilogueRead"],
    archiveChoiceCount: archived.baseChoices.length,
    sequel: {
      nextArcKey,
      nextThread,
      firstPhase: sequel.baseChoices[0].encounter.arcPhase,
      firstLocalTurn: sequel.baseChoices[0].encounter.arcLocalTurn,
    },
    fallbackMaxMs: Math.max(...fallbackTimes),
  });
}

console.log(JSON.stringify({
  suite: "rules-story-arc-closure",
  status: "PASS",
  horizon: 8,
  observations,
  assertions: [
    "scene-or-chapter-end-temporary-outcome-and-resource-exhaustion-are-not-endings",
    "choice-and-resolution-prompts-serialize-only-reader-safe-context-choices-and-causal-payloads",
    "choice-parser-and-story-validator-reject-horizon-phase-ending-criteria-and-preset-round-leaks",
    "pre-closure-reader-contract-does-not-reveal-ending-conditions-horizon-or-future-options",
    "closure-round-reveals-only-the-three-current-ending-directions",
    "arc-identity-goal-thread-and-phase-persist-through-eight-approved-turns",
    "ending-exists-only-after-user-approval-commits-goal-thread-canon-prose-and-immutable-ledger",
    "resolution-exposes-exactly-three-distinct-closure-capabilities",
    "closure-approval-atomically-resolves-story-state-and-story-bible-thread",
    "resolution-prose-is-full-ending-and-does-not-promise-an-infinite-next-turn",
    "post-resolution-only-offers-epilogue-new-arc-or-archive",
    "approved-ending-disclosure-switches-to-post-ending-for-all-three-actions",
    "epilogue-is-single-use-and-does-not-rewrite-the-closure-ledger",
    "archive-is-terminal-and-produces-no-new-choice-plan",
    "epilogue-then-new-arc-starts-at-the-real-progression-turn-and-local-turn-one",
    "approving-new-arc-creates-a-distinct-sequel-while-preserving-canon-state-and-closure-ledger",
    "sequel-disclosure-returns-to-in-progress-without-revealing-ending-options",
    "rules-fallback-generation-stays-under-one-second",
  ],
}, null, 2));
