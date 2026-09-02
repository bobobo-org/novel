import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  parseRpgLogicalTurnProviderTaskId,
  rpgLogicalTurnFallbackRepairTaskId,
  rpgLogicalTurnFallbackReviewTaskId,
  rpgLogicalTurnGenerationTaskId,
} from "../lib/novel-ai/conversation/rpg-logical-turn.ts";

import {
  extractLastCompleteNarrativeSentences,
  generateRpgChatTurnCandidate,
  approveRpgChatTurn,
  reviewDeterministicRpgFallbackDrafts,
  runRpgClosedAIUntilDeadline,
  selectRecentRpgContinuityTexts,
  verifyPostFallbackClosedReviewReceipt,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import {
  buildRpgChoices,
  readRpgProgression,
} from "../lib/novel-ai/game/progression/rpg-progression.ts";
import {
  validateRpgContinuationNovelty,
  validateRpgStoryTurnContract,
} from "../lib/novel-ai/web/rpg-closed-ai-director.ts";
import { evaluateNovelContinuityGate } from "../lib/novel-ai/web/story-output-quality.ts";
import {
  buildClosedAIModelPrompt,
  getClosedAIModelProfile,
} from "../lib/novel-ai/providers/closed/task-profile.ts";

const paragraphs = [
  "雨勢壓低屋簷，林澄沿泥痕走到廊下，發現封條已被換過。他沒有急著伸手，只讓蘇錦魚守住出口，自己逐一核對證人的說法與燈影位置。窗邊冷風捲起殘紙，對手終於承認搬運路線臨時改動，卻拒絕說出下令的人。",
  "林澄把海銅殘片收進證物袋，又封上一張新籤。他低聲說：「先守住出口，別讓任何人碰那本航簿。」老掌櫃看見缺口，想起凌晨有人借走剪鉗；他說話時一直摩挲袖口，顯然還藏著不肯明講的顧慮。門邊水珠仍沿舊痕落下，證明爭論期間沒有人重新開門。",
  "後院水缸旁留著半枚濕鞋印，方向卻朝向封死的牆。蘇錦魚蹲下比對泥色，發現鞋底沾的不是院土，而是河岸卸貨區才有的黑砂。她沒有聲張，只把東側窄巷交給可信的人盯住。",
  "顧行舟沒有否認夜航船曾靠岸，只把航簿翻到其中一頁。那裡的墨跡比前後兩頁新，數字筆鋒也不屬於值夜書記；眾人的爭論第一次落到可以追查的人手上。銅屑落下的輕響，使剛才互相指責的人同時閉嘴。",
  "屋裡藥香被冷風沖散，葉聞雪趁眾人掩鼻時抽走桌底薄紙。紙上沒有姓名，只有三次交貨的先後記號，最後一筆恰好越過原先不能碰的界線。她把黑砂包進紙角，留下時間和見證人的姓名。",
  "巷口傳來木輪壓過碎石的聲音，接應者卻比約定少了一人。林澄沒有催問去向，只先讓傷者換到內室；這個次序使門外監視者誤判證物所在。年輕信使袖口沾著藥粉，把空箱、傷者和夜航船連到同一條路上。",
  "巡察使敲門時語氣客氣，帶來的封條卻早已裁成合適長度。蘇錦魚故意問起另一宗舊案，對方回答得太快，反而證明他事前看過不該接觸的卷宗。她沒有追問，只記住他的目光先落向哪一隻抽屜。",
  "證人再次指向海銅殘片，確認缺角正是昨夜碰撞留下。她沒有要求眾人相信，只把手套翻過來，讓藏在縫線裡的同色銅屑落到白紙上。薄紙背面還有乾透藥汁，說明它曾在配藥桌旁停留。",
  "顧氏的人開始撤離東巷，卻留下最年輕的信使守著空箱。林澄從那個不合常理的安排看出，真正要被帶走的從來不是箱中物，而是能指認交接時刻的人。第一班晨車經過街口時，卷宗已分成兩份保存。",
  "天色泛白以前，眾人把三段彼此衝突的證詞排回同一條時間線。沒有人因此洗清嫌疑，但失竊、改簿與假封條終於不再是三件偶然。林澄把東巷的守衛撤回一半，帶著蘇錦魚沿新查出的搬運路追去。雨已經停了，屋簷下那串新鞋印仍清楚指向河岸，遠處第一艘渡船正要離岸。",
];
const validStory = ["〈雨夜封條〉", ...paragraphs].join("\n\n");
const digestStory = (story) => createHash("sha256").update(story.normalize("NFKC")).digest("hex");
const FALLBACK_SYNTHESIS_MARKER = "[RPG_FALLBACK_INDEPENDENT_SYNTHESIS_V1]";
const isFallbackSynthesisPrompt = (value) => (
  value.startsWith(FALLBACK_SYNTHESIS_MARKER)
  && value.endsWith("[/RPG_FALLBACK_INDEPENDENT_SYNTHESIS_V1]")
);
validateRpgStoryTurnContract(validStory, "zh-TW");

const simplifiedChineseGate = evaluateNovelContinuityGate({
  prose: [
    "雨水打在门外的石阶上，沈岚推开侧门，踏进黑暗的走廊。她听见窗边传来脚步声，潮湿纸页的气味贴在袖口。",
    "沈岚低声说：「先别碰封条。」随后打开抽屉，把失踪证词和冷掉的钥匙放在灯下。",
    "因为墨迹尚未干透，她转身封住后门，才发现墙边还有一道未解的鞋印。",
    "天亮前只剩一次选择：追上带走证物的人，还是留下保护证人？",
  ].join("\n\n"),
  language: "zh-CN",
  minimumHanCharacters: 100,
  minimumCharacters: 120,
  minimumParagraphs: 4,
  minimumDialogueCount: 1,
  activeCharacterNames: ["沈岚"],
});
assert.equal(
  simplifiedChineseGate.passed,
  true,
  `zh-CN prose gate regressed: ${simplifiedChineseGate.failures.join(",")}`,
);
const genericProtagonistGate = evaluateNovelContinuityGate({
  prose: simplifiedChineseGate.passed
    ? [
        "雨水打在门外的石阶上，主角推开侧门，踏进黑暗的走廊。她听见窗边传来脚步声，潮湿纸页的气味贴在袖口。",
        "主角低声说：「先别碰封条。」随后打开抽屉，把失踪证词和冷掉的钥匙放在灯下。",
        "因为墨迹尚未干透，她转身封住后门，才发现墙边还有一道未解的鞋印。",
        "天亮前只剩一次选择：追上带走证物的人，还是留下保护证人？",
      ].join("\n\n")
    : "",
  language: "zh-CN",
  minimumHanCharacters: 100,
  minimumCharacters: 120,
  minimumParagraphs: 4,
  minimumDialogueCount: 1,
  activeCharacterNames: ["沈岚"],
});
assert.ok(
  genericProtagonistGate.failures.includes("active_character"),
  "the generic 主角 label must never satisfy the named active-character gate",
);
const unattributedDialogueGate = evaluateNovelContinuityGate({
  prose: [
    "雨水打在门外的石阶上，沈岚推开侧门，踏进黑暗的走廊。她听见窗边传来脚步声，潮湿纸页的气味贴在袖口。",
    "沈岚站在窗边。「先别碰封条。」随后打开抽屉，把失踪证词和冷掉的钥匙放在灯下。",
    "因为墨迹尚未干透，她转身封住后门，才发现墙边还有一道未解的鞋印。",
    "天亮前只剩一次选择：追上带走证物的人，还是留下保护证人？",
  ].join("\n\n"),
  language: "zh-CN",
  minimumHanCharacters: 100,
  minimumCharacters: 120,
  minimumParagraphs: 4,
  minimumDialogueCount: 1,
  activeCharacterNames: ["沈岚"],
});
assert.ok(
  unattributedDialogueGate.failures.includes("dialogue_attribution"),
  "a nearby character name without a speech verb must not count as dialogue attribution",
);

const englishGate = evaluateNovelContinuityGate({
  prose: [
    "Mara opened the archive door and stepped into the dark hallway. Cold rain tapped the window, and she heard an echo behind the stairs.",
    "Mara whispered, \"Keep the lantern low.\" She pulled the missing ledger from beneath the table and placed its damp pages under lamplight.",
    "Because the seal was still warm, she turned toward the alley and followed the fresh mark before its owner could vanish.",
    "One clue remained unresolved: at dawn, Mara had to choose who would carry the truth outside.",
  ].join("\n\n"),
  language: "en",
  minimumHanCharacters: 0,
  minimumCharacters: 300,
  minimumParagraphs: 4,
  minimumDialogueCount: 1,
  activeCharacterNames: ["Mara"],
});
assert.equal(
  englishGate.passed,
  true,
  `English prose gate regressed: ${englishGate.failures.join(",")}`,
);

const contextTail = [
  "守門人把真正的出口畫在紙背，林澄決定先護送傷者離開。",
  "的籌碼。殷羽汀擋住去路，隊伍正在觀察主角是否願意承擔選擇後果。",
].join("");
const extracted = extractLastCompleteNarrativeSentences(contextTail, "備用局勢", 160);
assert.equal(extracted, "守門人把真正的出口畫在紙背，林澄決定先護送傷者離開。");
assert.doesNotMatch(extracted, /的籌碼|隊伍正在觀察/u);

const withFragment = validStory.replace(
  paragraphs[0],
  `${paragraphs[0]}「的籌碼。殷羽汀擋住去路。」`,
);
assert.throws(
  () => validateRpgStoryTurnContract(withFragment, "zh-TW"),
  /RPG_AI_CONTINUATION_FRAGMENT_VISIBLE/u,
);

for (const opening of [
  "的確，封條是在換班以前被人動過。",
  "前輩留下的墨痕，和航簿上的筆鋒不同。",
  "後來我才發現，東巷那只空箱一直沒有上鎖。",
  "了解，我會先護送傷者，再回來核對封泥。",
]) {
  const withValidDialogueOpening = validStory.replace(
    paragraphs[0],
    `${paragraphs[0]}林澄低聲說：「${opening}」`,
  );
  assert.doesNotThrow(
    () => validateRpgStoryTurnContract(withValidDialogueOpening, "zh-TW"),
    `a grammatical dialogue opening must not be mistaken for a truncated fragment: ${opening}`,
  );
}

const withUiLabel = validStory.replace(
  paragraphs[1],
  `${paragraphs[1]}主角說出「借勢參與護送靈貨・資源遷移・退路崩」後立刻動手。`,
);
assert.throws(
  () => validateRpgStoryTurnContract(withUiLabel, "zh-TW"),
  /RPG_AI_CONTINUATION_UI_LABEL_VISIBLE/u,
);

const withPolicyField = validStory.replace(
  paragraphs[2],
  `${paragraphs[2]}隊伍正在觀察主角是否願意承擔選擇後果。`,
);
assert.throws(
  () => validateRpgStoryTurnContract(withPolicyField, "zh-TW"),
  /RPG_AI_CONTINUATION_POLICY_FIELD_VISIBLE/u,
);

const withRoleTemplate = validStory.replace(
  paragraphs[3],
  `${paragraphs[3]}「我先去做能證明完成對失蹤同伴尚未兌現的承諾的那一步。」`,
);
assert.throws(
  () => validateRpgStoryTurnContract(withRoleTemplate, "zh-TW"),
  /RPG_AI_CONTINUATION_ROLE_TEMPLATE_VISIBLE/u,
);

assert.throws(
  () => validateRpgStoryTurnContract(`${validStory}\n\n${validStory}`, "zh-TW"),
  /RPG_AI_CONTINUATION_(?:WHOLE_SCENE_LOOP|INTERNAL_PARAGRAPH_LOOP)/u,
);
assert.throws(
  () => validateRpgContinuationNovelty(validStory, [validStory]),
  /RPG_AI_CONTINUATION_REPETITIVE/u,
);

let fakeNow = 0;
let attempts = 0;
let readinessProbes = 0;
const readinessSequence = ["loading", "unknown", "unavailable", "ready"];
const coordinated = await runRpgClosedAIUntilDeadline({
  deadlineMs: 180_000,
  execute: async (attempt) => {
    attempts = attempt;
    return "model-story";
  },
  dependencies: {
    now: () => fakeNow,
    wait: async (delayMs) => { fakeNow += delayMs; },
    probeAvailability: async () => {
      readinessProbes += 1;
      return readinessSequence[Math.min(readinessProbes - 1, readinessSequence.length - 1)];
    },
    retryBackoffMs: 1_000,
  },
});
assert.equal(coordinated.value, "model-story");
assert.equal(attempts, 1, "provider readiness polling must not manufacture a second generation task");
assert.equal(readinessProbes, 4, "all non-ready states must be polled without dispatching generation");
assert.equal(fakeNow, 7_000, "readiness probes must use bounded exponential polling backoff");
const readinessPollingMs = fakeNow;

let unavailableNow = 0;
let unavailableWaits = 0;
let unavailableExecutions = 0;
await assert.rejects(
  () => runRpgClosedAIUntilDeadline({
    deadlineMs: 180_000,
    execute: async () => {
      unavailableExecutions += 1;
      throw new Error("missing runtimes");
    },
    dependencies: {
      now: () => unavailableNow,
      wait: async (delayMs) => {
        unavailableWaits += 1;
        unavailableNow += delayMs;
      },
      probeAvailability: async () => "unavailable",
      retryBackoffMs: 60_000,
    },
  }),
  (error) => error?.code === "RPG_STORY_AI_TIMEOUT",
);
assert.equal(unavailableNow, 180_000, "temporary no-provider probes must still consume the complete story deadline");
assert.equal(unavailableWaits, 3, "large availability waits must cover the full window without 750ms task churn");
assert.equal(unavailableExecutions, 0, "an unavailable provider must never receive a generation request");

fakeNow = 0;
let failedReadyExecutions = 0;
let failedReadyProbes = 0;
let failedReadyWaits = 0;
const failedReadyError = Object.assign(new Error("terminal application rejection"), {
  code: "RPG_NOVEL_CONTINUITY_GATE_FAILED",
});
await assert.rejects(
  () => runRpgClosedAIUntilDeadline({
    deadlineMs: 3_000,
    execute: async () => {
      failedReadyExecutions += 1;
      throw failedReadyError;
    },
    dependencies: {
      now: () => fakeNow,
      wait: async (delayMs) => {
        failedReadyWaits += 1;
        fakeNow += delayMs;
      },
      probeAvailability: async () => {
        failedReadyProbes += 1;
        return "ready";
      },
      retryBackoffMs: 1_000,
    },
  }),
  (error) => error === failedReadyError,
);
assert.equal(fakeNow, 0, "a completed failed dispatch must preserve its original error without fake waiting");
assert.equal(failedReadyExecutions, 1, "a failed ready provider must not be resubmitted automatically");
assert.equal(failedReadyProbes, 1, "readiness is checked once before the single dispatch");
assert.equal(failedReadyWaits, 0, "post-dispatch readiness polling cannot recover an already failed request");

const boundedRepairError = Object.assign(new Error("RPG_AI_CONTINUATION_REPETITIVE"), {
  code: "RPG_AI_CONTINUATION_REPETITIVE",
});
const boundedRepairAttempts = [];
let boundedRepairProbes = 0;
const boundedRepair = await runRpgClosedAIUntilDeadline({
  deadlineMs: 3_000,
  startAttempt: 4,
  maximumDispatches: 2,
  retryAfterDispatch: ({ error }) => error === boundedRepairError,
  execute: async (attempt) => {
    boundedRepairAttempts.push(attempt);
    if (attempt === 4) throw boundedRepairError;
    return "strict-repetition-repair";
  },
  dependencies: {
    now: () => 0,
    wait: async () => undefined,
    probeAvailability: async () => {
      boundedRepairProbes += 1;
      return "ready";
    },
    retryBackoffMs: 1,
  },
});
assert.equal(boundedRepair.value, "strict-repetition-repair");
assert.equal(boundedRepair.attempts, 5, "the receipt must bind the repair attempt that succeeded");
assert.deepEqual(boundedRepairAttempts, [4, 5], "the opt-in repair retry must use a new deterministic attempt");
assert.equal(boundedRepairProbes, 2, "each authorized dispatch must receive a fresh readiness probe");

const exhaustedRepairErrors = [
  boundedRepairError,
  Object.assign(new Error("RPG_AI_CONTINUATION_REPETITIVE"), {
    code: "RPG_AI_CONTINUATION_REPETITIVE",
  }),
];
let exhaustedRepairDispatches = 0;
await assert.rejects(
  () => runRpgClosedAIUntilDeadline({
    deadlineMs: 3_000,
    maximumDispatches: 2,
    retryAfterDispatch: ({ error }) => error?.code === "RPG_AI_CONTINUATION_REPETITIVE",
    execute: async () => {
      const error = exhaustedRepairErrors[exhaustedRepairDispatches];
      exhaustedRepairDispatches += 1;
      throw error;
    },
    dependencies: {
      now: () => 0,
      wait: async () => undefined,
      probeAvailability: async () => "ready",
      retryBackoffMs: 1,
    },
  }),
  (error) => error === exhaustedRepairErrors[1],
  "a second strict repetition failure must remain fail-closed",
);
assert.equal(exhaustedRepairDispatches, 2, "the repair retry must be capped at two dispatches");

let nonRepetitionRepairDispatches = 0;
const nonRepetitionRepairError = Object.assign(new Error("RPG_CHAT_TURN_PROOF_MISSING"), {
  code: "RPG_CHAT_TURN_PROOF_MISSING",
});
await assert.rejects(
  () => runRpgClosedAIUntilDeadline({
    deadlineMs: 3_000,
    maximumDispatches: 2,
    retryAfterDispatch: ({ error }) => error?.code === "RPG_AI_CONTINUATION_REPETITIVE",
    execute: async () => {
      nonRepetitionRepairDispatches += 1;
      throw nonRepetitionRepairError;
    },
    dependencies: {
      now: () => 0,
      wait: async () => undefined,
      probeAvailability: async () => "ready",
      retryBackoffMs: 1,
    },
  }),
  (error) => error === nonRepetitionRepairError,
);
assert.equal(nonRepetitionRepairDispatches, 1, "proof and non-repetition errors must never be retried");

const hungExecutionStartedAt = Date.now();
let hungExecutionCalls = 0;
await assert.rejects(
  () => runRpgClosedAIUntilDeadline({
    deadlineMs: 30,
    execute: async () => {
      hungExecutionCalls += 1;
      return new Promise(() => undefined);
    },
    dependencies: {
      probeAvailability: async () => "ready",
      retryBackoffMs: 1,
    },
  }),
  (error) => error?.code === "RPG_STORY_AI_TIMEOUT",
);
assert.ok(Date.now() - hungExecutionStartedAt < 250, "a provider that ignores AbortSignal must not hold the project queue");
assert.equal(hungExecutionCalls, 1, "a hung ready provider must receive exactly one generation request");

const hungProbeStartedAt = Date.now();
let hungProbeExecutions = 0;
await assert.rejects(
  () => runRpgClosedAIUntilDeadline({
    deadlineMs: 30,
    execute: async () => {
      hungProbeExecutions += 1;
      throw new Error("runtime unavailable");
    },
    dependencies: {
      probeAvailability: async () => new Promise(() => undefined),
      retryBackoffMs: 1,
    },
  }),
  (error) => error?.code === "RPG_STORY_AI_TIMEOUT",
);
assert.ok(Date.now() - hungProbeStartedAt < 250, "a hung availability probe must share the same hard deadline");
assert.equal(hungProbeExecutions, 0, "a hung readiness probe must not leak a generation request");

const continuityFixture = selectRecentRpgContinuityTexts({
  chapter: { id: "chapter-12", order: 12, content: "最新章節尾聲。" },
  chapters: [12, 3, 11, 9, 10, 8].map((order) => ({
    id: `chapter-${order}`,
    order,
    content: `章節${order}尾聲。`,
  })),
  acceptedChoices: [12, 2, 10, 5, 11, 1, 7, 4, 9, 3, 8, 6].map((turn) => ({
    acceptedAt: `2026-08-${String(turn).padStart(2, "0")}T00:00:00.000Z`,
    acceptedText: `已接受回合${turn}`,
  })),
}, 8);
assert.deepEqual(
  continuityFixture.acceptedTexts,
  [5, 6, 7, 8, 9, 10, 11, 12].map((turn) => `已接受回合${turn}`),
  "more than eight turns must retain the latest eight in chronological order",
);
assert.equal(continuityFixture.chapterTails.at(-1), "最新章節尾聲。", "review context must end with the latest chapter tail");

const hiddenDraftStories = [
  validStory,
  validStory
    .replaceAll("林澄", "沈硯")
    .replaceAll("蘇錦魚", "顧晚")
    .replaceAll("顧行舟", "薛策")
    .replaceAll("葉聞雪", "唐青")
    .replaceAll("海銅", "青瓷")
    .replaceAll("黑砂", "鹽霜")
    .replaceAll("封條", "路引")
    .replaceAll("泥痕", "灰痕")
    .replaceAll("藥香", "檀香")
    .replaceAll("夜航船", "驛車")
    .replaceAll("渡船", "貨車")
    .replaceAll("河岸", "北門")
    .replaceAll("東巷", "西廊")
    .replace("〈雨夜路引〉", "〈北門前的空箱〉"),
  validStory
    .replaceAll("林澄", "孟秋白")
    .replaceAll("蘇錦魚", "聞人昭")
    .replaceAll("顧行舟", "賀蘭川")
    .replaceAll("葉聞雪", "宋知微")
    .replaceAll("海銅", "烏銀")
    .replaceAll("黑砂", "紅土")
    .replaceAll("封條", "密函")
    .replaceAll("鞋印", "車轍")
    .replaceAll("藥粉", "香灰")
    .replaceAll("夜航船", "山驛隊")
    .replaceAll("渡船", "馬車")
    .replaceAll("河岸", "南關")
    .replaceAll("東巷", "後街")
    .replace("〈雨夜密函〉", "〈南關未送出的密函〉"),
];
const hiddenDrafts = hiddenDraftStories.map((story, index) => ({
  key: `draft-${index + 1}`,
  story,
  digest: digestStory(story),
}));
const reviewedFixture = validStory
  .replaceAll("林澄", "裴照")
  .replaceAll("蘇錦魚", "祝遙")
  .replaceAll("顧行舟", "霍臨")
  .replaceAll("葉聞雪", "商音")
  .replaceAll("海銅", "玄鐵")
  .replaceAll("黑砂", "白堊")
  .replaceAll("封條", "關牒")
  .replaceAll("泥痕", "水痕")
  .replaceAll("藥粉", "松煙")
  .replaceAll("夜航船", "巡河艇")
  .replaceAll("渡船", "快艇")
  .replaceAll("河岸", "水門")
  .replaceAll("東巷", "石階")
  .replace("〈雨夜關牒〉", "〈水門將啟之前〉");
let helperReviewInputs = null;
const reviewedCandidate = await reviewDeterministicRpgFallbackDrafts({
    drafts: hiddenDrafts,
    recentAcceptedTexts: [],
    language: "zh-TW",
    reviewer: async (drafts) => {
      helperReviewInputs = drafts;
      return reviewedFixture;
    },
  });
assert.equal(reviewedCandidate, reviewedFixture, "only the closed-AI-reviewed candidate may leave the fallback gate");
assert.equal(helperReviewInputs?.length, 3, "the closed reviewer must receive exactly three hidden drafts");
assert.ok(hiddenDraftStories.every((draft) => reviewedCandidate !== draft), "the final story must not be any internal draft verbatim");

let nearDuplicateDraftReachedReviewer = false;
const nearDuplicateDraftStory = validStory.replace("第一艘渡船", "第二艘渡船");
const nearDuplicateDraftFailure = await reviewDeterministicRpgFallbackDrafts({
    drafts: [
      hiddenDrafts[0],
      { key: "draft-near-copy", story: nearDuplicateDraftStory, digest: digestStory(nearDuplicateDraftStory) },
      hiddenDrafts[2],
    ],
    recentAcceptedTexts: [],
    language: "zh-TW",
    reviewer: async () => {
      nearDuplicateDraftReachedReviewer = true;
      return reviewedFixture;
    },
  }).then(() => null, (error) => error);
assert.equal(nearDuplicateDraftFailure?.code, "RPG_FALLBACK_DRAFT_VARIANTS_INSUFFICIENT", "near-copy source drafts must be rejected before closed review");
assert.equal(nearDuplicateDraftReachedReviewer, false, "quality gates must run before a closed reviewer sees the source candidates");

const unchangedReviewFailure = await reviewDeterministicRpgFallbackDrafts({
    drafts: hiddenDrafts,
    recentAcceptedTexts: [],
    language: "zh-TW",
    reviewer: async () => hiddenDraftStories[1],
  }).then(() => null, (error) => error);
assert.equal(unchangedReviewFailure?.code, "RPG_FALLBACK_CLOSED_REVIEW_UNCHANGED", "the reviewer must materially rewrite instead of copying one draft");

const nearCopyReviewFailure = await reviewDeterministicRpgFallbackDrafts({
    drafts: hiddenDrafts,
    recentAcceptedTexts: [],
    language: "zh-TW",
    reviewer: async () => nearDuplicateDraftStory,
  }).then(() => null, (error) => error);
assert.equal(nearCopyReviewFailure?.code, "RPG_FALLBACK_CLOSED_REVIEW_UNCHANGED", "a lightly edited source draft must not pass as a closed rewrite");

const reviewFailure = await reviewDeterministicRpgFallbackDrafts({
    drafts: hiddenDrafts,
    recentAcceptedTexts: [],
    language: "zh-TW",
    reviewer: async () => "",
  }).then(() => null, (error) => error);
assert.equal(reviewFailure?.code, "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED", "an unreviewed deterministic draft must fail closed");
assert.equal(Object.hasOwn(reviewFailure ?? {}, "draft"), false, "failure details must never expose the hidden fallback draft");

const fullStoryState = {
  id: "story-state-fallback-review",
  projectId: "project-fallback-review",
  revision: 1,
  locationState: "雨夜藥鋪",
  protagonistStats: {},
  resources: {},
  relationships: {},
  worldFlags: { "rpg.runSeed": "fallback-review-seed" },
};
const fullProgression = readRpgProgression(fullStoryState, "fallback-review-seed", "adventure");
const fullChoices = buildRpgChoices({
  progression: fullProgression,
  protagonist: "林澄",
  chapterTitle: "封條失竊",
  conflict: "在天亮以前查明封條被誰換過",
  mode: "adventure",
  playMode: "rpg",
  seed: "fallback-review-seed",
  storyStateRevision: 1,
});
const fullChoice = fullChoices[0];
const fullSnapshot = {
  schemaVersion: "rpg-chat-turn-v1",
  project: { id: "project-fallback-review", genrePackId: "現代懸疑" },
  chapter: { id: "chapter-fallback-review", projectId: "project-fallback-review", title: "封條失竊", revision: 1, content: "" },
  chapters: [{ id: "chapter-fallback-review", projectId: "project-fallback-review", title: "封條失竊", revision: 1, content: "" }],
  storyState: fullStoryState,
  storyBible: { protagonistIds: ["hero"], unresolvedThreads: ["封條背後仍有一名內應"] },
  characters: [{ id: "hero", projectId: "project-fallback-review", name: "林澄" }],
  relationships: [],
  worldRules: [],
  lore: [],
  timeline: [],
  acceptedChoices: [],
  rpgTurnReceipts: [],
  playMode: "rpg",
  progressionMode: "adventure",
  language: "zh-TW",
  progression: fullProgression,
  conflict: "在天亮以前查明封條被誰換過",
  directorContext: {
    protagonist: { name: "林澄" },
    location: "雨夜藥鋪",
    conflict: "在天亮以前查明封條被誰換過",
  },
  causalKnowledge: {
    snapshotVersion: "approved-learning-context-snapshot-v1",
    snapshotDigest: "fallback-review-context",
    selectedRuleIds: [],
    instructions: [],
    causalSignals: [],
    maximumRules: 8,
    entireLibraryScanned: false,
  },
  baseChoices: fullChoices,
};
const fullReviewedStory = validStory
  .replace("林澄沿泥痕", `林澄決定${fullChoice.title}，沿泥痕`)
  .replace("雨已經停了", "失敗的換封伎倆雖已拆穿，眾人仍付出代價。雨已經停了");
let fullClock = 0;
let fullInvokerCalls = 0;
let fullReviewPayload = null;
let fullReviewRequest = null;
const fullGenerationTaskIds = [];
const reviewedModelDigest = "a".repeat(64);
const closedReviewResult = (request, candidateId, content = fullReviewedStory) => {
  const contentDigest = digestStory(content);
  return {
    taskId: request.taskId,
    candidateId,
    status: "awaiting_approval",
    provider: "local-ollama",
    model: "qwen-review-test",
    modelDigest: reviewedModelDigest,
    sourceChapterId: "chapter-fallback-review",
    sourceRevision: 1,
    content,
    contentDigest,
    actualExecutor: "local-ollama",
    executionReceipt: {
      taskId: request.taskId,
      backendId: "local-ollama",
      modelId: "qwen-review-test",
      modelDigest: reviewedModelDigest,
      contentDigest,
      attempt: 1,
      proofState: "verified",
      dataLeftDevice: false,
      externalRequest: false,
      actualExecutor: "local-ollama",
    },
    contextDigest: "closed-review-context-digest",
    contextSourceSummary: null,
    dataLeftDevice: false,
    externalRequest: false,
    warnings: [],
    toolExecutions: [],
    ledgerHeadHash: "closed-review-ledger",
    requestContractDigest: "f".repeat(64),
    applicationValidationBindingDigest:
      request.applicationValidationBindingDigest ?? null,
    canonicalMutationCount: 0,
    regeneration: null,
    cache: { candidateHit: false, planHit: false, bypassReason: null },
  };
};
const fullReviewedCandidate = await generateRpgChatTurnCandidate({
  snapshot: fullSnapshot,
  choice: fullChoice,
  logicalTurnId: "logical-turn-fallback-review",
  generationDeadlineMs: 200,
  fallbackReviewDeadlineMs: 200,
  coordinationDependencies: {
    now: () => fullClock,
    wait: async (delayMs) => { fullClock += delayMs; },
    probeAvailability: async () => "ready",
    retryBackoffMs: 1,
  },
  closedAIInvoker: async (request) => {
    fullInvokerCalls += 1;
    if (!isFallbackSynthesisPrompt(request.input)) {
      fullGenerationTaskIds.push(request.taskId);
      throw Object.assign(new Error("generation exceeded its explicit deadline"), { code: "OLLAMA_TIMEOUT" });
    }
    fullReviewRequest = request;
    fullReviewPayload = {
      prompt: request.input,
    };
    return {
      taskId: request.taskId,
      candidateId: "closed-review-candidate-1",
      status: "awaiting_approval",
      provider: "local-ollama",
      model: "qwen-review-test",
      modelDigest: reviewedModelDigest,
      sourceChapterId: "chapter-fallback-review",
      sourceRevision: 1,
      content: fullReviewedStory,
      contentDigest: "closed-review-content-digest",
      actualExecutor: "local-ollama",
      executionReceipt: {
        taskId: request.taskId,
        backendId: "local-ollama",
        modelId: "qwen-review-test",
        modelDigest: reviewedModelDigest,
        attempt: 1,
        proofState: "verified",
        dataLeftDevice: false,
        externalRequest: false,
        actualExecutor: "local-ollama",
      },
      contextDigest: "closed-review-context-digest",
      contextSourceSummary: null,
      dataLeftDevice: false,
      externalRequest: false,
      warnings: [],
      toolExecutions: [],
      ledgerHeadHash: "closed-review-ledger",
      requestContractDigest: "f".repeat(64),
      applicationValidationBindingDigest:
        request.applicationValidationBindingDigest ?? null,
      canonicalMutationCount: 0,
      regeneration: null,
      cache: { candidateHit: false, planHit: false, bypassReason: null },
    };
  },
});
assert.equal(fullReviewedCandidate.story, fullReviewedStory, "the full generator must return only the closed review output");
assert.equal(fullReviewedCandidate.candidateId, "closed-review-candidate-1");
assert.equal(fullReviewedCandidate.model, "qwen-review-test");
assert.equal(fullReviewedCandidate.actualExecutor, "local-ollama");
assert.equal(fullClock, 0, "an explicitly timed-out generation must enter fallback review without an extra empty deadline wait");
assert.equal(fullInvokerCalls, 2, "the flow must contain exactly one generation dispatch and one fallback-review dispatch");
assert.deepEqual(
  fullGenerationTaskIds,
  [await rpgLogicalTurnGenerationTaskId("logical-turn-fallback-review", 1)],
  "a timed-out generation request must never manufacture generation attempt-2",
);
assert.match(fullReviewPayload?.prompt ?? "", /RPG_FALLBACK_INDEPENDENT_SYNTHESIS_V1/u);
assert.match(fullReviewPayload?.prompt ?? "", /RPG_SCENE_CONTRACT_V2/u);
assert.ok((fullReviewPayload?.prompt.length ?? Infinity) <= 1_950, "the fallback synthesis objective must fit the substantive-scene budget");
assert.doesNotMatch(fullReviewPayload?.prompt ?? "", /internalDraftCandidates|"story"\s*:/u, "hidden draft prose must not enter the small-model prompt");
assert.equal(fullReviewRequest?.ephemeralPrompt, true, "hidden fallback drafts must use the non-persistent Closed Agent prompt path");
assert.equal(typeof fullReviewRequest?.validateBeforePersistence, "function", "the RPG application validator must run before OS persistence");
assert.equal(
  fullReviewRequest?.taskId,
  await rpgLogicalTurnFallbackReviewTaskId("logical-turn-fallback-review", 1),
  "the fallback review must have its own deterministic first-attempt provider identity",
);
assert.equal(fullReviewRequest?.applicationValidationBindingDigest?.length, 64);
assert.doesNotMatch(fullReviewPayload?.prompt ?? "", /draft-[1-3]=[a-f0-9]{64}/u, "lineage digests stay application-bound and must not consume the small-model prompt budget");
assert.match(fullReviewPayload.prompt, new RegExp(fullChoice.title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
assert.match(fullReviewPayload.prompt, /鎖定結果:/u);
assert.match(fullReviewPayload.prompt, /主角:林澄/u);
const localFallbackProfile = {
  ...getClosedAIModelProfile("chapter.continue", "local-ollama"),
  maxInputCharacters: 2_600,
};
const localFallbackModelPrompt = buildClosedAIModelPrompt({
  objective: fullReviewPayload.prompt,
  context: [],
  profile: localFallbackProfile,
  substantiveScene: true,
});
assert.ok(localFallbackModelPrompt.prompt.length <= 2_600, "the real local prompt builder must accept the bounded fallback synthesis contract");

let explicitRetryClock = 0;
const explicitRetryTaskIds = [];
const explicitRetryLogicalTurnId = "logical-turn-fallback-review-explicit-retry";
const explicitRetryCandidate = await generateRpgChatTurnCandidate({
  snapshot: fullSnapshot,
  choice: fullChoice,
  logicalTurnId: explicitRetryLogicalTurnId,
  resumeProviderTaskId: await rpgLogicalTurnGenerationTaskId(
    explicitRetryLogicalTurnId,
    3,
  ),
  generationDeadlineMs: 100,
  fallbackReviewDeadlineMs: 100,
  coordinationDependencies: {
    now: () => explicitRetryClock,
    wait: async (delayMs) => { explicitRetryClock += delayMs; },
    probeAvailability: async () => "ready",
    retryBackoffMs: 1,
  },
  closedAIInvoker: async (request) => {
    explicitRetryTaskIds.push(request.taskId);
    if (!isFallbackSynthesisPrompt(request.input)) {
      throw Object.assign(new Error("explicit retry generation exceeded its deadline"), {
        code: "OLLAMA_TIMEOUT",
      });
    }
    const result = closedReviewResult(request, "closed-review-candidate-attempt-3");
    result.executionReceipt.attempt = 5;
    return result;
  },
});
assert.deepEqual(explicitRetryTaskIds, [
  await rpgLogicalTurnGenerationTaskId(explicitRetryLogicalTurnId, 3),
  await rpgLogicalTurnFallbackReviewTaskId(explicitRetryLogicalTurnId, 5),
]);
assert.equal(
  explicitRetryCandidate.taskId,
  await rpgLogicalTurnFallbackReviewTaskId(explicitRetryLogicalTurnId, 5),
);
assert.equal(
  explicitRetryCandidate.executionReceipt.postFallbackClosedReview?.reviewAttempts,
  5,
);
assert.equal(
  explicitRetryCandidate.executionReceipt.postFallbackClosedReview?.selectionRewriteEvidence?.attempts,
  5,
);

const abstractNonSceneParagraphs = [
  "林澄低聲說：「名稱與分類可以反覆排列，排列本身不代表事情已經向前。」概念之間保持平行，人物只被當成名詞使用，所有句子都在解釋相近的抽象觀點。這一段具有完整標點與足夠長度，內容依舊缺少可辨認的當下事件。",
  "制度、秩序、責任、權限與價值各自佔有篇幅，敘述依序談論它們的定義、範圍、用途與一般性差異。任何具體人物都沒有採取可驗證的行為，時間也沒有產生前後變化，文字只是把相鄰概念換成另一組近義表達。",
  "許多名詞被描述成穩定、完整、清楚、合理、平衡與一致，相關句子逐項補充抽象特徵。讀者無從辨認事情發生在哪一刻，也無從辨認誰受到何種壓力；篇幅持續增加，敘述狀態依舊停在一般原則。",
  "群體、個體、傳統、責任、秩序與價值在這部分成為討論主題，每個主題都有數句形式完整的陳述。陳述彼此沒有推動關係，也沒有可追蹤的衝突轉折，只把同一層級的概念並排寫得很長。",
  "歷史觀、倫理觀、社會觀、文化觀與制度觀得到平均篇幅，各自附帶中性的性質描述。文字沒有具體時刻、可核對行為或人物反應，篇章雖然看似充實，內容始終停留在不會改變局勢的泛論。",
  "責任可以被理解成義務，義務可以被描述成秩序，秩序又能被說成共同認知。這些解釋保持文法完整，也刻意避開任何當下事件；沒有角色承受壓力，沒有關係發生位移，沒有事物獲得新的意義。",
  "價值被分成個人層面、群體層面、傳統層面與抽象層面，每一層都獲得相近份量的概述。敘述沒有建立目標與阻力，也沒有讓前一句成為後一句必須回應的原因，篇章只維持平坦的說明節奏。",
  "概念還能依照範圍、程度、形式、來源與用途重新組合，組合結果看似眾多，實際內容仍是靜態定義。人物姓名不再參與段落，任何具體行為也沒有進入敘述，文字與先前情境維持完全脫節。",
  "另一組抽象詞彙談論原則、標準、共識、權利、義務與邊界，每個詞都配上一段中性解釋。段落具備句號，也具有表面完整性，整體依舊沒有事件、壓力、行為、回應或關係改變。",
  "最後一部分繼續陳述穩定性、完整性、一致性、普遍性、相容性與可理解性。各項性質被平整地排在一起，敘述沒有建立值得追蹤的具體問題，也沒有留下任何需要人物立刻回應的局勢。",
  "知識領域還可分成理論、方法、慣例、共識與詮釋，每一類都具有不同名稱與相似說明。篇章詳述各類概念的普遍特性，沒有任何人取得資訊或失去事物，整體狀態維持靜止。",
  "語義範圍包含廣義、狹義、正式、非正式、共同與個別等層次，文字平均分配各層次的解釋份量。句子維持完整結構，人物之間沒有交流結果，外部條件也沒有改變。",
  "分類方式仍能增加來源、用途、程度、形式、範圍與性質等軸線，每條軸線都有一段中性概述。長篇陳述抵達末尾時依然只剩靜態定義，所有概念保持原來位置，整體內容到此結束。",
];
const longButNonNarrativeStory = [
  "〈抽象概念的排列〉",
  ...abstractNonSceneParagraphs,
].join("\n\n");
assert.ok(
  (longButNonNarrativeStory.match(/[\p{Script=Han}]/gu)?.length ?? 0) >= 900,
  "the regression sample must be long enough to defeat a length-only gate",
);

const continuityChapter = {
  ...fullSnapshot.chapter,
  content: "雨夜藥鋪的封條在暴雨中失竊，林澄沿泥痕追查換封者。",
};
const continuitySnapshot = {
  ...fullSnapshot,
  chapter: continuityChapter,
  chapters: [continuityChapter],
};
let continuityClock = 0;
let continuityAttempt = 0;
const continuityTaskIds = [];
let continuityProbes = 0;
let continuityWaits = 0;
let continuityRepairPrompt = null;
let invalidCandidatePersisted = false;
let continuityFailure = null;
const continuityCandidate = await generateRpgChatTurnCandidate({
  snapshot: continuitySnapshot,
  choice: fullChoice,
  logicalTurnId: "logical-turn-continuity-fallback-review",
  generationDeadlineMs: 100,
  coordinationDependencies: {
    now: () => continuityClock,
    wait: async (delayMs) => {
      continuityWaits += 1;
      continuityClock += delayMs;
    },
    probeAvailability: async () => {
      continuityProbes += 1;
      return "ready";
    },
    retryBackoffMs: 1,
  },
  closedAIInvoker: async (request) => {
    continuityAttempt += 1;
    continuityTaskIds.push(request.taskId);
    if (continuityAttempt === 2) continuityRepairPrompt = request.input;
    const content = continuityAttempt === 1
      ? longButNonNarrativeStory
      : fullReviewedStory;
    const contentDigest = digestStory(content);
    const result = {
      taskId: request.taskId,
      candidateId: `continuity-candidate-${continuityAttempt}`,
      status: "awaiting_approval",
      provider: "local-ollama",
      model: "qwen-continuity-test",
      modelDigest: reviewedModelDigest,
      sourceChapterId: continuityChapter.id,
      sourceRevision: continuityChapter.revision,
      content,
      contentDigest,
      actualExecutor: "local-ollama",
      executionReceipt: {
        taskId: request.taskId,
        backendId: "local-ollama",
        modelId: "qwen-continuity-test",
        modelDigest: reviewedModelDigest,
        contentDigest,
        attempt: 1,
        proofState: "verified",
        dataLeftDevice: false,
        externalRequest: false,
        actualExecutor: "local-ollama",
      },
      contextDigest: "continuity-test-context",
      contextSourceSummary: null,
      dataLeftDevice: false,
      externalRequest: false,
      warnings: [],
      toolExecutions: [],
      ledgerHeadHash: `continuity-ledger-${continuityAttempt}`,
      requestContractDigest: "e".repeat(64),
      applicationValidationBindingDigest:
        request.applicationValidationBindingDigest ?? null,
      canonicalMutationCount: 0,
      regeneration: null,
      cache: { candidateHit: false, planHit: false, bypassReason: null },
    };
    try {
      await request.validateBeforePersistence?.(result);
      if (continuityAttempt === 1) invalidCandidatePersisted = true;
    } catch (error) {
      if (continuityAttempt === 1) {
        continuityFailure = error;
        throw error;
      }
      throw error;
    }
    return result;
  },
});
assert.equal(invalidCandidatePersisted, false, "an invalid long candidate must be rejected before persistence");
assert.equal(continuityFailure?.code, "RPG_NOVEL_CONTINUITY_GATE_FAILED");
assert.ok(continuityFailure?.continuityFailures?.includes("continuity_anchor"));
assert.ok(continuityFailure?.continuityFailures?.includes("narrative_scene"));
assert.ok(continuityFailure?.continuityFailures?.includes("action_progression"));
assert.ok(continuityFailure?.continuityFailures?.includes("causality"));
assert.ok(continuityFailure?.qualityReasonCodes?.includes("QUALITY_CONTEXT_ANCHOR_MISSING"));
assert.ok(continuityFailure?.qualityReasonCodes?.includes("QUALITY_CONTINUITY_LOW"));
assert.equal(continuityAttempt, 2, "the flow must dispatch one continuity-rejected generation and one bounded hidden continuity repair");
assert.equal(continuityClock, 0, "a continuity rejection must enter independent repair without an empty deadline wait");
assert.equal(continuityWaits, 0, "neither dispatched stage may enter readiness polling after completion");
assert.equal(continuityProbes, 2, "generation and fallback repair each perform one pre-dispatch readiness check");
assert.deepEqual(
  continuityTaskIds,
  [
    await rpgLogicalTurnGenerationTaskId("logical-turn-continuity-fallback-review", 1),
    await rpgLogicalTurnFallbackRepairTaskId(
      "logical-turn-continuity-fallback-review",
      continuityFailure.continuityFailures,
      1,
    ),
  ],
  "a direct continuity rejection must route to its distinct repair stage without generation attempt-2",
);
assert.match(continuityRepairPrompt ?? "", /RPG_FALLBACK_CONTINUITY_REPAIR_V1/u);
assert.match(continuityRepairPrompt ?? "", /RPG_SCENE_CONTRACT_V2/u);
assert.match(continuityRepairPrompt ?? "", /本次必補:/u);
assert.match(continuityRepairPrompt ?? "", /正文第一段須自然且逐字放入「沿泥痕追查換封者」與「林澄」/u);
assert.match(continuityRepairPrompt ?? "", /場景詞含門外與火光/u);
assert.match(continuityRepairPrompt ?? "", /動作詞含推開、握住、轉身/u);
assert.match(continuityRepairPrompt ?? "", /正文明寫因此形成因果/u);
assert.match(continuityRepairPrompt ?? "", /末220字須自然寫出「門外突然傳來聲音」/u);
assert.ok((continuityRepairPrompt?.length ?? Infinity) <= 1_950);
assert.doesNotMatch(continuityRepairPrompt ?? "", /抽象概念的排列/u, "the rejected prose must never enter its repair prompt");
assert.equal(continuityCandidate.story, fullReviewedStory);
assert.equal(
  continuityCandidate.executionReceipt.postFallbackClosedReview?.passed,
  true,
  "only the closed-reviewed fallback may leave the continuity rejection path",
);
assert.equal(
  continuityCandidate.executionReceipt.postFallbackClosedReview?.reviewStage,
  "fallback-repair",
);

const repetitionLeafCases = [
  {
    leafCode: "RPG_AI_CONTINUATION_WHOLE_SCENE_LOOP",
    logicalTurnId: "logical-turn-whole-scene-loop-repair",
    invalidStory: validStory.replace(paragraphs[0], `${paragraphs[0]}${paragraphs[0]}`),
    validateInvalid: (story) => validateRpgStoryTurnContract(story, "zh-TW"),
  },
  {
    leafCode: "RPG_AI_CONTINUATION_INTERNAL_PARAGRAPH_LOOP",
    logicalTurnId: "logical-turn-internal-paragraph-loop-repair",
    invalidStory: validStory.replace(paragraphs[4], paragraphs[3]),
    validateInvalid: (story) => validateRpgStoryTurnContract(story, "zh-TW"),
  },
  {
    leafCode: "RPG_AI_CONTINUATION_REPETITIVE",
    logicalTurnId: "logical-turn-recent-canon-replay-repair",
    invalidStory: validStory,
    validateInvalid: (story) => validateRpgContinuationNovelty(story, [validStory]),
    forceLeafBeforeApplicationCallback: true,
    repetitionRepairFailuresBeforeSuccess: 1,
  },
];
const repetitionLeafRepairResults = [];
for (const repetitionCase of repetitionLeafCases) {
  let directValidationError = null;
  try {
    repetitionCase.validateInvalid(repetitionCase.invalidStory);
  } catch (error) {
    directValidationError = error;
  }
  assert.equal(
    directValidationError?.message,
    repetitionCase.leafCode,
    "the regression fixture must exercise the intended strict repetition validator",
  );

  const dispatchedTaskIds = [];
  let repairPrompt = null;
  let rejectedGenerationLeaf = null;
  const repairedCandidate = await generateRpgChatTurnCandidate({
    snapshot: fullSnapshot,
    choice: fullChoice,
    logicalTurnId: repetitionCase.logicalTurnId,
    generationDeadlineMs: 100,
    fallbackReviewDeadlineMs: 100,
    coordinationDependencies: {
      now: () => 0,
      wait: async () => undefined,
      probeAvailability: async () => "ready",
      retryBackoffMs: 1,
    },
    closedAIInvoker: async (request) => {
      dispatchedTaskIds.push(request.taskId);
      const firstDispatch = dispatchedTaskIds.length === 1;
      const content = firstDispatch ? repetitionCase.invalidStory : fullReviewedStory;
      const result = closedReviewResult(
        request,
        `${repetitionCase.leafCode.toLowerCase()}-${dispatchedTaskIds.length}`,
        content,
      );
      if (!firstDispatch) repairPrompt = request.input;
      try {
        const repairDispatch = dispatchedTaskIds.length - 1;
        if (
          (firstDispatch && repetitionCase.forceLeafBeforeApplicationCallback)
          || (
            !firstDispatch
            && repairDispatch <= (repetitionCase.repetitionRepairFailuresBeforeSuccess ?? 0)
          )
        ) {
          repetitionCase.validateInvalid(content);
        }
        await request.validateBeforePersistence?.(result);
      } catch (error) {
        rejectedGenerationLeaf = error;
        throw Object.assign(new Error("local provider rejected repeated prose"), {
          code: "LOCAL_PROVIDER_APPLICATION_VALIDATION_FAILED",
          cause: error,
        });
      }
      return result;
    },
  });

  assert.equal(rejectedGenerationLeaf?.message, repetitionCase.leafCode);
  const expectedTaskIds = [
    await rpgLogicalTurnGenerationTaskId(repetitionCase.logicalTurnId, 1),
    await rpgLogicalTurnFallbackRepairTaskId(
      repetitionCase.logicalTurnId,
      ["repetition"],
      1,
    ),
  ];
  if ((repetitionCase.repetitionRepairFailuresBeforeSuccess ?? 0) > 0) {
    expectedTaskIds.push(await rpgLogicalTurnFallbackRepairTaskId(
      repetitionCase.logicalTurnId,
      ["repetition"],
      2,
    ));
  }
  assert.deepEqual(dispatchedTaskIds, expectedTaskIds);
  assert.match(repairPrompt ?? "", /RPG_FALLBACK_CONTINUITY_REPAIR_V1/u);
  assert.match(repairPrompt ?? "", /本次必補:各段事件與句式不得重複/u);
  assert.doesNotMatch(
    repairPrompt ?? "",
    /海銅殘片收進證物袋/u,
    "rejected repeated prose must not enter the repair prompt",
  );
  assert.equal(repairedCandidate.story, fullReviewedStory);
  assert.equal(
    repairedCandidate.executionReceipt.postFallbackClosedReview?.reviewStage,
    "fallback-repair",
  );
  assert.equal(
    repairedCandidate.executionReceipt.postFallbackClosedReview?.passed,
    true,
  );
  assert.equal(
    repairedCandidate.executionReceipt.postFallbackClosedReview?.reviewAttempts,
    (repetitionCase.repetitionRepairFailuresBeforeSuccess ?? 0) + 1,
  );
  assert.equal(
    repairedCandidate.executionReceipt.postFallbackClosedReview
      ?.selectionRewriteEvidence?.taskId,
    dispatchedTaskIds.at(-1),
    "the sealed receipt must bind the repair task that actually succeeded",
  );
  assert.equal(
    repairedCandidate.executionReceipt.postFallbackClosedReview
      ?.selectionRewriteEvidence?.attempts,
    (repetitionCase.repetitionRepairFailuresBeforeSuccess ?? 0) + 1,
  );
  assert.ok(
    await verifyPostFallbackClosedReviewReceipt({ candidate: repairedCandidate }),
    "the final repetition-repair receipt must verify after an internal retry",
  );
  repetitionLeafRepairResults.push({
    leafCode: repetitionCase.leafCode,
    repairTaskId: dispatchedTaskIds.at(-1),
  });
}

for (const crossContentCase of [
  {
    name: "selected-action",
    leafCode: "RPG_AI_STORY_SELECTED_ACTION_MISSING",
  },
  {
    name: "continuation-length",
    leafCode: "RPG_AI_CONTINUATION_TOO_SHORT",
  },
]) {
  let crossGateRepairDispatches = 0;
  const crossGateRepairTaskIds = [];
  const logicalTurnId = `logical-turn-repetition-repair-cross-${crossContentCase.name}-gate`;
  const crossGateRepairCandidate = await generateRpgChatTurnCandidate({
    snapshot: fullSnapshot,
    choice: fullChoice,
    logicalTurnId,
    generationDeadlineMs: 100,
    fallbackReviewDeadlineMs: 100,
    coordinationDependencies: {
      now: () => 0,
      wait: async () => undefined,
      probeAvailability: async () => "ready",
      retryBackoffMs: 1,
    },
    closedAIInvoker: async (request) => {
      crossGateRepairDispatches += 1;
      crossGateRepairTaskIds.push(request.taskId);
      if (crossGateRepairDispatches === 1) {
        const repetitionError = Object.assign(new Error("RPG_AI_CONTINUATION_REPETITIVE"), {
          code: "RPG_AI_CONTINUATION_REPETITIVE",
        });
        throw Object.assign(new Error("local provider rejected repeated prose"), {
          code: "LOCAL_PROVIDER_APPLICATION_VALIDATION_FAILED",
          cause: repetitionError,
        });
      }
      if (crossGateRepairDispatches === 2) {
        const contentError = new Error(crossContentCase.leafCode);
        throw Object.assign(new Error("local provider rejected repair content"), {
          code: "LOCAL_PROVIDER_APPLICATION_VALIDATION_FAILED",
          cause: contentError,
        });
      }
      const result = closedReviewResult(
        request,
        `cross-${crossContentCase.name}-gate-repair-success`,
        fullReviewedStory,
      );
      await request.validateBeforePersistence?.(result);
      return result;
    },
  });
  assert.equal(
    crossGateRepairDispatches,
    3,
    `${crossContentCase.leafCode} receives one bounded repair retry`,
  );
  assert.deepEqual(crossGateRepairTaskIds, [
    await rpgLogicalTurnGenerationTaskId(logicalTurnId, 1),
    await rpgLogicalTurnFallbackRepairTaskId(logicalTurnId, ["repetition"], 1),
    await rpgLogicalTurnFallbackRepairTaskId(logicalTurnId, ["repetition"], 2),
  ]);
  assert.equal(crossGateRepairCandidate.story, fullReviewedStory);
  assert.equal(
    crossGateRepairCandidate.executionReceipt.postFallbackClosedReview?.reviewAttempts,
    2,
    "the receipt must bind the second closed repair dispatch",
  );
  assert.ok(
    await verifyPostFallbackClosedReviewReceipt({ candidate: crossGateRepairCandidate }),
    "the cross-content-gate repair receipt must verify",
  );
}

let nonRetryableRepairDispatches = 0;
const nonRetryableRepairFailure = await generateRpgChatTurnCandidate({
  snapshot: fullSnapshot,
  choice: fullChoice,
  logicalTurnId: "logical-turn-repetition-repair-proof-stops",
  generationDeadlineMs: 100,
  fallbackReviewDeadlineMs: 100,
  coordinationDependencies: {
    now: () => 0,
    wait: async () => undefined,
    probeAvailability: async () => "ready",
    retryBackoffMs: 1,
  },
  closedAIInvoker: async () => {
    nonRetryableRepairDispatches += 1;
    if (nonRetryableRepairDispatches === 1) {
      const repetitionError = Object.assign(new Error("RPG_AI_CONTINUATION_REPETITIVE"), {
        code: "RPG_AI_CONTINUATION_REPETITIVE",
      });
      throw Object.assign(new Error("local provider rejected repeated prose"), {
        code: "LOCAL_PROVIDER_APPLICATION_VALIDATION_FAILED",
        cause: repetitionError,
      });
    }
    throw Object.assign(new Error("closed review proof is missing"), {
      code: "RPG_FALLBACK_CLOSED_REVIEW_PROOF_MISSING",
    });
  },
}).then(() => null, (error) => error);
assert.equal(
  nonRetryableRepairDispatches,
  2,
  "proof failures must not consume the bounded content-repair retry",
);
assert.equal(nonRetryableRepairFailure?.code, "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED");
assert.equal(
  nonRetryableRepairFailure?.reviewFailureCode,
  "RPG_FALLBACK_CLOSED_REVIEW_PROOF_MISSING",
);

let leakageRepairDispatches = 0;
const leakageRepairFailure = await generateRpgChatTurnCandidate({
  snapshot: fullSnapshot,
  choice: fullChoice,
  logicalTurnId: "logical-turn-repetition-repair-leakage-stops",
  generationDeadlineMs: 100,
  fallbackReviewDeadlineMs: 100,
  coordinationDependencies: {
    now: () => 0,
    wait: async () => undefined,
    probeAvailability: async () => "ready",
    retryBackoffMs: 1,
  },
  closedAIInvoker: async () => {
    leakageRepairDispatches += 1;
    if (leakageRepairDispatches === 1) {
      const repetitionError = Object.assign(new Error("RPG_AI_CONTINUATION_REPETITIVE"), {
        code: "RPG_AI_CONTINUATION_REPETITIVE",
      });
      throw Object.assign(new Error("local provider rejected repeated prose"), {
        code: "LOCAL_PROVIDER_APPLICATION_VALIDATION_FAILED",
        cause: repetitionError,
      });
    }
    const leakageError = new Error("RPG_AI_CONTINUATION_ENGINE_LANGUAGE_VISIBLE");
    throw Object.assign(new Error("local provider rejected leaked engine language"), {
      code: "LOCAL_PROVIDER_APPLICATION_VALIDATION_FAILED",
      cause: leakageError,
    });
  },
}).then(() => null, (error) => error);
assert.equal(
  leakageRepairDispatches,
  2,
  "engine-language leakage must not consume the bounded content-repair retry",
);
assert.equal(leakageRepairFailure?.code, "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED");
assert.equal(
  leakageRepairFailure?.reviewFailureLeafCode,
  "RPG_AI_CONTINUATION_ENGINE_LANGUAGE_VISIBLE",
);

for (const blockerCase of [
  {
    name: "proof",
    outerCode: "RPG_FALLBACK_CLOSED_REVIEW_PROOF_MISSING",
    nestedCode: "RPG_AI_STORY_SELECTED_ACTION_MISSING",
  },
  {
    name: "timeout",
    outerCode: "RPG_STORY_AI_TIMEOUT",
    nestedCode: "RPG_AI_CONTINUATION_REPETITIVE",
  },
  {
    name: "adult-policy",
    outerCode: "RPG_ADULT_RUNTIME_POLICY_RECEIPT_INVALID",
    nestedCode: "RPG_AI_CONTINUATION_TOO_SHORT",
  },
  {
    name: "transport",
    outerCode: "OLLAMA_STREAM_INTERRUPTED",
    nestedCode: "RPG_AI_CONTINUATION_TOO_SHORT",
    outerMessage: "RPG_AI_CONTINUATION_TOO_SHORT",
  },
]) {
  let nestedBlockerDispatches = 0;
  const nestedBlockerFailure = await generateRpgChatTurnCandidate({
    snapshot: fullSnapshot,
    choice: fullChoice,
    logicalTurnId: `logical-turn-repetition-repair-${blockerCase.name}-cause-stops`,
    generationDeadlineMs: 100,
    fallbackReviewDeadlineMs: 100,
    coordinationDependencies: {
      now: () => 0,
      wait: async () => undefined,
      probeAvailability: async () => "ready",
      retryBackoffMs: 1,
    },
    closedAIInvoker: async () => {
      nestedBlockerDispatches += 1;
      if (nestedBlockerDispatches === 1) {
        const repetitionError = Object.assign(new Error("RPG_AI_CONTINUATION_REPETITIVE"), {
          code: "RPG_AI_CONTINUATION_REPETITIVE",
        });
        throw Object.assign(new Error("local provider rejected repeated prose"), {
          code: "LOCAL_PROVIDER_APPLICATION_VALIDATION_FAILED",
          cause: repetitionError,
        });
      }
      const nestedContentError = Object.assign(new Error(blockerCase.nestedCode), {
        code: blockerCase.nestedCode,
      });
      throw Object.assign(new Error(
        blockerCase.outerMessage ?? `${blockerCase.name} blocks repair retry`,
      ), {
        code: blockerCase.outerCode,
        cause: nestedContentError,
      });
    },
  }).then(() => null, (error) => error);
  assert.equal(
    nestedBlockerDispatches,
    2,
    `${blockerCase.name} must stop repair retry even when its cause is an allowlisted content leaf`,
  );
  assert.equal(nestedBlockerFailure?.code, "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED");
  assert.equal(nestedBlockerFailure?.reviewFailureCode, blockerCase.outerCode);
}

async function assertAmbiguousRepairFailureStops(name, repairError) {
  let dispatches = 0;
  await generateRpgChatTurnCandidate({
    snapshot: fullSnapshot,
    choice: fullChoice,
    logicalTurnId: `logical-turn-repetition-repair-${name}-stops`,
    generationDeadlineMs: 100,
    fallbackReviewDeadlineMs: 100,
    coordinationDependencies: {
      now: () => 0,
      wait: async () => undefined,
      probeAvailability: async () => "ready",
      retryBackoffMs: 1,
    },
    closedAIInvoker: async () => {
      dispatches += 1;
      if (dispatches === 1) {
        const repetitionError = Object.assign(new Error("RPG_AI_CONTINUATION_REPETITIVE"), {
          code: "RPG_AI_CONTINUATION_REPETITIVE",
        });
        throw Object.assign(new Error("local provider rejected repeated prose"), {
          code: "LOCAL_PROVIDER_APPLICATION_VALIDATION_FAILED",
          cause: repetitionError,
        });
      }
      throw repairError;
    },
  }).then(() => null, (error) => error);
  assert.equal(dispatches, 2, `${name} must not dispatch repair attempt 2`);
}

await assertAmbiguousRepairFailureStops(
  "transport-code-message-spoof",
  Object.assign(new Error("RPG_AI_CONTINUATION_TOO_SHORT"), {
    code: "OLLAMA_STREAM_INTERRUPTED",
  }),
);
await assertAmbiguousRepairFailureStops(
  "conflicting-rpg-code-message",
  Object.assign(new Error("RPG_AI_STORY_SELECTED_ACTION_MISSING"), {
    code: "RPG_AI_CONTINUATION_TOO_SHORT",
  }),
);
await assertAmbiguousRepairFailureStops(
  "content-leaf-with-proof-cause",
  Object.assign(new Error("local provider rejected repair content"), {
    code: "LOCAL_PROVIDER_APPLICATION_VALIDATION_FAILED",
    cause: Object.assign(new Error("RPG_AI_CONTINUATION_TOO_SHORT"), {
      code: "RPG_AI_CONTINUATION_TOO_SHORT",
      cause: Object.assign(new Error("closed review proof is missing"), {
        code: "RPG_FALLBACK_CLOSED_REVIEW_PROOF_MISSING",
      }),
    }),
  }),
);

let changedLeafDispatches = 0;
const changedLeafFailure = await generateRpgChatTurnCandidate({
  snapshot: fullSnapshot,
  choice: fullChoice,
  logicalTurnId: "logical-turn-repetition-repair-proof-failure",
  generationDeadlineMs: 100,
  fallbackReviewDeadlineMs: 100,
  coordinationDependencies: {
    now: () => 0,
    wait: async () => undefined,
    probeAvailability: async () => "ready",
    retryBackoffMs: 1,
  },
  closedAIInvoker: async () => {
    changedLeafDispatches += 1;
    if (changedLeafDispatches <= 2) {
      const repetitionError = Object.assign(new Error("RPG_AI_CONTINUATION_REPETITIVE"), {
        code: "RPG_AI_CONTINUATION_REPETITIVE",
      });
      throw Object.assign(new Error("local provider rejected repeated prose"), {
        code: "LOCAL_PROVIDER_APPLICATION_VALIDATION_FAILED",
        cause: repetitionError,
      });
    }
    throw Object.assign(new Error("closed review proof is missing"), {
      code: "RPG_FALLBACK_CLOSED_REVIEW_PROOF_MISSING",
    });
  },
}).then(() => null, (error) => error);
assert.equal(changedLeafDispatches, 3, "only one repetition repair retry may be dispatched");
assert.equal(changedLeafFailure?.code, "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED");
assert.equal(
  changedLeafFailure?.reviewFailureCode,
  "RPG_FALLBACK_CLOSED_REVIEW_PROOF_MISSING",
  "the final repair failure must replace the previous attempt's diagnostic",
);
assert.deepEqual(
  changedLeafFailure?.reviewContinuityFailures,
  [],
  "a later proof failure must not be misreported as the first repair's repetition leaf",
);
assert.deepEqual(changedLeafFailure?.generationContinuityFailures, ["repetition"]);

let retryReadinessNow = 0;
let retryReadinessProbes = 0;
let retryReadinessDispatches = 0;
const retryReadinessFailure = await generateRpgChatTurnCandidate({
  snapshot: fullSnapshot,
  choice: fullChoice,
  logicalTurnId: "logical-turn-repetition-repair-readiness-timeout",
  generationDeadlineMs: 20,
  fallbackReviewDeadlineMs: 20,
  coordinationDependencies: {
    now: () => retryReadinessNow,
    wait: async (delayMs) => { retryReadinessNow += delayMs; },
    probeAvailability: async () => {
      retryReadinessProbes += 1;
      return retryReadinessProbes <= 2 ? "ready" : "unavailable";
    },
    retryBackoffMs: 20,
  },
  closedAIInvoker: async (request) => {
    retryReadinessDispatches += 1;
    if (retryReadinessDispatches === 1) {
      const repetitionError = Object.assign(new Error("RPG_AI_CONTINUATION_REPETITIVE"), {
        code: "RPG_AI_CONTINUATION_REPETITIVE",
      });
      throw Object.assign(new Error("local provider rejected repeated prose"), {
        code: "LOCAL_PROVIDER_APPLICATION_VALIDATION_FAILED",
        cause: repetitionError,
      });
    }
    const repeatedReview = closedReviewResult(
      request,
      "closed-review-candidate-before-readiness-timeout",
      `${fullReviewedStory}\n\n${fullReviewedStory}`,
    );
    try {
      await request.validateBeforePersistence?.(repeatedReview);
    } catch (error) {
      throw Object.assign(new Error("local provider rejected repeated repair prose"), {
        code: "LOCAL_PROVIDER_APPLICATION_VALIDATION_FAILED",
        cause: error,
      });
    }
    throw new Error("expected repeated repair prose to fail validation");
  },
}).then(() => null, (error) => error);
assert.equal(retryReadinessDispatches, 2, "unavailable retry readiness must not create a third provider request");
assert.equal(retryReadinessFailure?.code, "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED");
assert.equal(retryReadinessFailure?.reviewFailureCode, "RPG_STORY_AI_TIMEOUT");
assert.notEqual(
  retryReadinessFailure?.reviewFailureLeafCode,
  "RPG_AI_CONTINUATION_REPETITIVE",
  "a later readiness timeout must not reuse the rejected prose leaf",
);
assert.deepEqual(
  retryReadinessFailure?.reviewContinuityFailures,
  [],
  "readiness timeout before the second repair dispatch has no continuity result",
);
assert.deepEqual(retryReadinessFailure?.generationContinuityFailures, ["repetition"]);

const evenRepairResumeLogicalTurnId = "logical-turn-even-repetition-repair-resume";
const evenRepairResumeTaskId = await rpgLogicalTurnFallbackRepairTaskId(
  evenRepairResumeLogicalTurnId,
  ["repetition"],
  2,
);
const evenRepairResumeTaskIds = [];
const evenRepairResumeFailure = await generateRpgChatTurnCandidate({
  snapshot: fullSnapshot,
  choice: fullChoice,
  logicalTurnId: evenRepairResumeLogicalTurnId,
  resumeProviderTaskId: evenRepairResumeTaskId,
  generationDeadlineMs: 100,
  fallbackReviewDeadlineMs: 100,
  coordinationDependencies: {
    now: () => 0,
    wait: async () => undefined,
    probeAvailability: async () => "ready",
    retryBackoffMs: 1,
  },
  closedAIInvoker: async (request) => {
    evenRepairResumeTaskIds.push(request.taskId);
    const repetitionError = Object.assign(new Error("RPG_AI_CONTINUATION_REPETITIVE"), {
      code: "RPG_AI_CONTINUATION_REPETITIVE",
    });
    throw Object.assign(new Error("resumed bounded repair remained repetitive"), {
      code: "LOCAL_PROVIDER_APPLICATION_VALIDATION_FAILED",
      cause: repetitionError,
    });
  },
}).then(() => null, (error) => error);
assert.deepEqual(
  evenRepairResumeTaskIds,
  [evenRepairResumeTaskId],
  "resuming an occupied even repair slot must never consume the next author's odd slot",
);
assert.equal(evenRepairResumeFailure?.code, "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED");
assert.deepEqual(evenRepairResumeFailure?.reviewContinuityFailures, ["repetition"]);

const nextAuthorRepairLogicalTurnId = "logical-turn-next-author-repetition-repair";
const nextAuthorRepairTaskIds = [];
const nextAuthorRepairCandidate = await generateRpgChatTurnCandidate({
  snapshot: fullSnapshot,
  choice: fullChoice,
  logicalTurnId: nextAuthorRepairLogicalTurnId,
  resumeProviderTaskId: await rpgLogicalTurnGenerationTaskId(
    nextAuthorRepairLogicalTurnId,
    2,
  ),
  generationDeadlineMs: 100,
  fallbackReviewDeadlineMs: 100,
  coordinationDependencies: {
    now: () => 0,
    wait: async () => undefined,
    probeAvailability: async () => "ready",
    retryBackoffMs: 1,
  },
  closedAIInvoker: async (request) => {
    nextAuthorRepairTaskIds.push(request.taskId);
    if (nextAuthorRepairTaskIds.length <= 2) {
      const repetitionError = Object.assign(new Error("RPG_AI_CONTINUATION_REPETITIVE"), {
        code: "RPG_AI_CONTINUATION_REPETITIVE",
      });
      throw Object.assign(new Error("author retry prose remained repetitive"), {
        code: "LOCAL_PROVIDER_APPLICATION_VALIDATION_FAILED",
        cause: repetitionError,
      });
    }
    const result = closedReviewResult(
      request,
      "closed-review-candidate-author-attempt-2-repair-2",
    );
    await request.validateBeforePersistence?.(result);
    return result;
  },
});
assert.deepEqual(nextAuthorRepairTaskIds, [
  await rpgLogicalTurnGenerationTaskId(nextAuthorRepairLogicalTurnId, 2),
  await rpgLogicalTurnFallbackRepairTaskId(
    nextAuthorRepairLogicalTurnId,
    ["repetition"],
    3,
  ),
  await rpgLogicalTurnFallbackRepairTaskId(
    nextAuthorRepairLogicalTurnId,
    ["repetition"],
    4,
  ),
]);
assert.equal(nextAuthorRepairCandidate.taskId, nextAuthorRepairTaskIds[2]);
assert.equal(
  nextAuthorRepairCandidate.executionReceipt.postFallbackClosedReview?.reviewAttempts,
  4,
);
assert.ok(await verifyPostFallbackClosedReviewReceipt({
  candidate: nextAuthorRepairCandidate,
}));

const forbiddenRepairCases = [
  {
    logicalTurnId: "logical-turn-canon-item-claim-remains-closed",
    error: new Error("RPG_AI_STORY_UNAPPROVED_FORMAL_ITEM"),
    expectedCode: "RPG_AI_STORY_UNAPPROVED_FORMAL_ITEM",
  },
  {
    logicalTurnId: "logical-turn-prose-gate-remains-closed",
    error: Object.assign(new Error("STORY_PROSE_OUTPUT_INVALID"), {
      code: "STORY_PROSE_OUTPUT_INVALID",
      proseFailures: ["sentence_fragment"],
    }),
    expectedCode: "STORY_PROSE_OUTPUT_INVALID",
  },
];
for (const forbiddenCase of forbiddenRepairCases) {
  let dispatches = 0;
  await assert.rejects(
    () => generateRpgChatTurnCandidate({
      snapshot: fullSnapshot,
      choice: fullChoice,
      logicalTurnId: forbiddenCase.logicalTurnId,
      generationDeadlineMs: 100,
      fallbackReviewDeadlineMs: 100,
      coordinationDependencies: {
        now: () => 0,
        wait: async () => undefined,
        probeAvailability: async () => "ready",
        retryBackoffMs: 1,
      },
      closedAIInvoker: async () => {
        dispatches += 1;
        throw forbiddenCase.error;
      },
    }),
    (error) => (error?.code ?? error?.message) === forbiddenCase.expectedCode,
    `${forbiddenCase.expectedCode} must remain fail-closed`,
  );
  assert.equal(dispatches, 1, `${forbiddenCase.expectedCode} must not dispatch hidden prose repair`);
}

let missingProofDispatches = 0;
await assert.rejects(
  () => generateRpgChatTurnCandidate({
    snapshot: fullSnapshot,
    choice: fullChoice,
    logicalTurnId: "logical-turn-proof-missing-remains-closed",
    generationDeadlineMs: 100,
    fallbackReviewDeadlineMs: 100,
    coordinationDependencies: {
      now: () => 0,
      wait: async () => undefined,
      probeAvailability: async () => "ready",
      retryBackoffMs: 1,
    },
    closedAIInvoker: async (request) => {
      missingProofDispatches += 1;
      const result = closedReviewResult(request, null, fullReviewedStory);
      await request.validateBeforePersistence?.(result);
      return result;
    },
  }),
  (error) => error?.code === "RPG_CHAT_TURN_PROOF_MISSING",
  "missing execution proof must remain fail-closed instead of entering prose repair",
);
assert.equal(missingProofDispatches, 1, "a proof failure must never dispatch hidden prose repair");

const fullReviewReceipt = fullReviewedCandidate.executionReceipt.postFallbackClosedReview;
assert.equal(fullReviewReceipt?.passed, true);
assert.equal(fullReviewReceipt?.draftCount, 3);
assert.equal(fullReviewReceipt?.draftDigests?.length, 3);
assert.equal(new Set(fullReviewReceipt?.draftDigests ?? []).size, 3);
assert.equal(fullReviewReceipt?.lockedOutcome, fullReviewedCandidate.resolution.outcome);
assert.equal(typeof fullReviewReceipt?.lockedEffectDigest, "string");
assert.equal(fullReviewReceipt?.lockedEffectDigest?.length, 64);
assert.equal(fullReviewReceipt?.reviewAttempts, 1);
assert.equal(fullReviewReceipt?.selectionRewriteEvidence?.taskId, fullReviewRequest.taskId);
assert.equal(fullReviewReceipt?.selectionRewriteEvidence?.candidateId, "closed-review-candidate-1");
assert.equal(fullReviewReceipt?.selectionRewriteEvidence?.provider, "local-ollama");
assert.equal(fullReviewReceipt?.selectionRewriteEvidence?.model, "qwen-review-test");
assert.equal(fullReviewReceipt?.selectionRewriteEvidence?.modelDigest, reviewedModelDigest);
assert.equal(fullReviewReceipt?.selectionRewriteEvidence?.actualExecutor, "local-ollama");
assert.equal(fullReviewReceipt?.selectionRewriteEvidence?.attempts, 1);
assert.equal(fullReviewReceipt?.selectionRewriteEvidence?.requestContractDigest, "f".repeat(64));
assert.equal(fullReviewReceipt?.selectionRewriteEvidence?.upstreamExecutionReceiptDigest?.length, 64);
assert.equal(fullReviewReceipt?.reviewRequestDigest?.length, 64);
assert.equal(fullReviewReceipt?.applicationValidationBindingDigest?.length, 64);
assert.equal(fullReviewReceipt?.receiptDigest?.length, 64);
assert.ok(await verifyPostFallbackClosedReviewReceipt({ candidate: fullReviewedCandidate }));

const parsedSuccessfulReviewIdentity = await parseRpgLogicalTurnProviderTaskId(
  "logical-turn-fallback-review",
  fullReviewedCandidate.taskId,
);
assert.deepEqual(
  parsedSuccessfulReviewIdentity && {
    stage: parsedSuccessfulReviewIdentity.stage,
    attempt: parsedSuccessfulReviewIdentity.attempt,
  },
  { stage: "fallback-review", attempt: 1 },
  "the reader-facing receipt must bind the provider attempt that actually succeeded",
);

let nonTimeoutInvokerCalls = 0;
await assert.rejects(
  () => generateRpgChatTurnCandidate({
    snapshot: fullSnapshot,
    choice: fullChoice,
    logicalTurnId: "logical-turn-non-timeout-fail-closed",
    generationDeadlineMs: 200,
    coordinationDependencies: {
      now: () => 0,
      wait: async () => undefined,
      probeAvailability: async () => "ready",
      retryBackoffMs: 1,
    },
    closedAIInvoker: async () => {
      nonTimeoutInvokerCalls += 1;
      throw Object.assign(new Error("generation backend still loading"), { code: "MODEL_LOADING" });
    },
  }),
  (error) => error?.code === "MODEL_LOADING",
  "an ordinary provider failure must remain fail-closed instead of opening rules fallback",
);
assert.equal(nonTimeoutInvokerCalls, 1, "a non-timeout provider failure must not dispatch a fallback review");

let convergenceClock = 0;
const convergenceTaskIds = [];
const reviewedAfterInvalidAttempt = await generateRpgChatTurnCandidate({
  snapshot: fullSnapshot,
  choice: fullChoice,
  logicalTurnId: "logical-turn-invalid-first-attempt",
  generationDeadlineMs: 200,
  coordinationDependencies: {
    now: () => convergenceClock,
    wait: async (delayMs) => { convergenceClock += delayMs; },
    probeAvailability: async () => "ready",
    retryBackoffMs: 1,
  },
  closedAIInvoker: async (request) => {
    convergenceTaskIds.push(request.taskId);
    if (convergenceTaskIds.length === 1) {
      throw Object.assign(new Error("first generation exceeded its explicit deadline"), {
        code: "OLLAMA_TIMEOUT",
      });
    }
    const content = fullReviewedStory;
    const contentDigest = digestStory(content);
    return {
      taskId: request.taskId,
      candidateId: `closed-generation-candidate-${convergenceTaskIds.length}`,
      status: "awaiting_approval",
      provider: "local-ollama",
      model: "qwen-generation-test",
      modelDigest: reviewedModelDigest,
      sourceChapterId: "chapter-fallback-review",
      sourceRevision: 1,
      content,
      contentDigest,
      actualExecutor: "local-ollama",
      executionReceipt: {
        taskId: request.taskId,
        backendId: "local-ollama",
        modelId: "qwen-generation-test",
        modelDigest: reviewedModelDigest,
        contentDigest,
        attempt: 1,
        proofState: "verified",
        dataLeftDevice: false,
        externalRequest: false,
        actualExecutor: "local-ollama",
      },
      contextDigest: "closed-generation-context-digest",
      contextSourceSummary: null,
      dataLeftDevice: false,
      externalRequest: false,
      warnings: [],
      toolExecutions: [],
      ledgerHeadHash: "closed-generation-ledger",
      requestContractDigest: "e".repeat(64),
      applicationValidationBindingDigest:
        request.applicationValidationBindingDigest ?? null,
      canonicalMutationCount: 0,
      regeneration: null,
      cache: { candidateHit: false, planHit: false, bypassReason: null },
    };
  },
});
assert.equal(reviewedAfterInvalidAttempt.story, fullReviewedStory);
assert.deepEqual(convergenceTaskIds, [
  await rpgLogicalTurnGenerationTaskId("logical-turn-invalid-first-attempt", 1),
  await rpgLogicalTurnFallbackReviewTaskId("logical-turn-invalid-first-attempt", 1),
]);
assert.equal(
  reviewedAfterInvalidAttempt.taskId,
  convergenceTaskIds[1],
  "an explicitly timed-out first OS task must route to the single hidden-review request instead of generation attempt-2",
);
assert.equal(
  reviewedAfterInvalidAttempt.executionReceipt.attempt,
  1,
  "the fallback-review receipt must retain its own stage attempt instead of the total invocation count",
);
assert.equal(reviewedAfterInvalidAttempt.executionReceipt.postFallbackClosedReview?.passed, true);

const tamperedReviewCandidate = structuredClone(fullReviewedCandidate);
tamperedReviewCandidate.executionReceipt.postFallbackClosedReview.reviewAttempts += 1;
await assert.rejects(
  () => verifyPostFallbackClosedReviewReceipt({ candidate: tamperedReviewCandidate }),
  (error) => error?.code === "RPG_FALLBACK_REVIEW_RECEIPT_INVALID",
  "approval-facing verifier must reject a tampered post-fallback receipt",
);
let tamperedApprovalRepositoryCalls = 0;
const noWriteRepository = new Proxy({}, {
  get() {
    return async () => {
      tamperedApprovalRepositoryCalls += 1;
      throw new Error("repository must not be reached for a tampered receipt");
    };
  },
});
await assert.rejects(
  () => approveRpgChatTurn({
    repository: noWriteRepository,
    snapshot: fullSnapshot,
    candidate: tamperedReviewCandidate,
  }),
  (error) => error?.code === "RPG_FALLBACK_REVIEW_RECEIPT_INVALID",
  "the real approval boundary must verify the sealed review receipt",
);
assert.equal(tamperedApprovalRepositoryCalls, 0, "tampered review evidence must fail before any repository write");
assert.equal(Object.hasOwn(fullReviewedCandidate, "draft"), false, "the full candidate must not expose the hidden draft");
assert.doesNotMatch(JSON.stringify(fullReviewedCandidate), /internalDraftCandidates|RPG_FALLBACK_INDEPENDENT_SYNTHESIS_V1/u, "the returned candidate and receipt must not persist the ephemeral fallback prompt");

let exhaustedGenerationClock = 0;
let reviewStartedAfterFullGenerationDeadline = false;
let exhaustedGenerationDispatches = 0;
const exhaustedGenerationCandidate = await generateRpgChatTurnCandidate({
  snapshot: fullSnapshot,
  choice: fullChoice,
  logicalTurnId: "logical-turn-true-180-second-exhaustion",
  generationDeadlineMs: 180_000,
  fallbackReviewDeadlineMs: 60_000,
  coordinationDependencies: {
    now: () => exhaustedGenerationClock,
    wait: async (delayMs) => { exhaustedGenerationClock += delayMs; },
    probeAvailability: async () => (
      exhaustedGenerationClock < 180_000 ? "unavailable" : "ready"
    ),
    retryBackoffMs: 60_000,
  },
  closedAIInvoker: async (request) => {
    if (!isFallbackSynthesisPrompt(request.input)) {
      exhaustedGenerationDispatches += 1;
      throw Object.assign(new Error("generation backend unavailable"), { code: "MODEL_UNAVAILABLE" });
    }
    reviewStartedAfterFullGenerationDeadline = exhaustedGenerationClock === 180_000;
    const result = closedReviewResult(request, "closed-review-after-180-seconds");
    await request.validateBeforePersistence?.(result);
    return result;
  },
});
assert.equal(
  reviewStartedAfterFullGenerationDeadline,
  true,
  "fallback review must start only after the full fake 180-second generation deadline is exhausted",
);
assert.equal(exhaustedGenerationDispatches, 0, "an unavailable generation provider must receive no prose request");
assert.equal(exhaustedGenerationClock, 180_000, "a successful review gets a fresh clock and does not consume generation time");
assert.equal(exhaustedGenerationCandidate.candidateId, "closed-review-after-180-seconds");
assert.equal(
  exhaustedGenerationCandidate.executionReceipt.postFallbackClosedReview?.passed,
  true,
);

const generationAbortController = new AbortController();
const generationAbortReason = Object.assign(new Error("user cancelled generation"), {
  code: "TEST_USER_ABORT_GENERATION",
});
let generationAbortReachedReview = false;
await assert.rejects(
  () => generateRpgChatTurnCandidate({
    snapshot: fullSnapshot,
    choice: fullChoice,
    logicalTurnId: "logical-turn-user-abort-generation",
    generationDeadlineMs: 180_000,
    fallbackReviewDeadlineMs: 60_000,
    signal: generationAbortController.signal,
    coordinationDependencies: {
      probeAvailability: async () => "ready",
      retryBackoffMs: 1,
    },
    closedAIInvoker: async (request) => {
      if (isFallbackSynthesisPrompt(request.input)) {
        generationAbortReachedReview = true;
      }
      generationAbortController.abort(generationAbortReason);
      throw generationAbortReason;
    },
  }),
  (error) => error?.code === "TEST_USER_ABORT_GENERATION",
  "a user cancellation during generation must escape before hidden fallback creation or review",
);
assert.equal(generationAbortReachedReview, false);

let reviewAbortClock = 0;
const reviewAbortController = new AbortController();
const reviewAbortReason = Object.assign(new Error("user cancelled hidden review"), {
  code: "TEST_USER_ABORT_REVIEW",
});
let reviewAbortReachedReview = false;
let reviewAbortGenerationDispatches = 0;
await assert.rejects(
  () => generateRpgChatTurnCandidate({
    snapshot: fullSnapshot,
    choice: fullChoice,
    logicalTurnId: "logical-turn-user-abort-review",
    generationDeadlineMs: 1,
    fallbackReviewDeadlineMs: 60_000,
    signal: reviewAbortController.signal,
    coordinationDependencies: {
      now: () => reviewAbortClock,
      wait: async (delayMs) => { reviewAbortClock += delayMs; },
      probeAvailability: async () => (
        reviewAbortClock < 1 ? "unavailable" : "ready"
      ),
      retryBackoffMs: 1,
    },
    closedAIInvoker: async (request) => {
      if (!isFallbackSynthesisPrompt(request.input)) {
        reviewAbortGenerationDispatches += 1;
        throw Object.assign(new Error("generation timed out"), { code: "MODEL_UNAVAILABLE" });
      }
      reviewAbortReachedReview = true;
      reviewAbortController.abort(reviewAbortReason);
      throw reviewAbortReason;
    },
  }),
  (error) => error?.code === "TEST_USER_ABORT_REVIEW",
  "the same caller signal must abort the independent hidden-review stage",
);
assert.equal(reviewAbortReachedReview, true);
assert.equal(reviewAbortGenerationDispatches, 0, "review-abort setup must not dispatch generation while unavailable");

let failedReviewClock = 0;
const failedReviewWaits = [];
let failedReviewDispatches = 0;
const failedFullReview = await generateRpgChatTurnCandidate({
  snapshot: fullSnapshot,
  choice: fullChoice,
  logicalTurnId: "logical-turn-independent-review-deadline",
  generationDeadlineMs: 20,
  fallbackReviewDeadlineMs: 30,
  coordinationDependencies: {
    now: () => failedReviewClock,
    wait: async (delayMs) => {
      failedReviewWaits.push(delayMs);
      failedReviewClock += delayMs;
    },
    probeAvailability: async () => (
      failedReviewClock < 20 ? "unavailable" : "ready"
    ),
    retryBackoffMs: 1,
  },
  closedAIInvoker: async () => {
    failedReviewDispatches += 1;
    throw Object.assign(new Error("no closed model completed"), { code: "MODEL_UNAVAILABLE" });
  },
}).then(() => null, (error) => error);
assert.equal(failedFullReview?.code, "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED");
assert.equal(
  failedReviewClock,
  20,
  `pre-dispatch unavailability must consume its explicit deadline, while a completed failed review dispatch returns immediately; waits=${JSON.stringify(failedReviewWaits)}`,
);
assert.equal(failedReviewDispatches, 1, "the failed hidden review must not be resubmitted during its own deadline");
assert.equal(failedFullReview?.reviewFailureCode, "MODEL_UNAVAILABLE");
assert.match(String(failedFullReview?.message), /沒有產生可顯示的正文.*請重試/u);
assert.equal(Object.hasOwn(failedFullReview ?? {}, "draft"), false);
assert.doesNotMatch(JSON.stringify(failedFullReview), /雨勢壓低屋簷|internalDraft|規則草稿/u, "review failure must not expose draft prose or its review prompt");
assert.equal(Object.hasOwn(failedFullReview ?? {}, "draftDigests"), false, "failed review must not expose internal draft evidence either");

console.log(JSON.stringify({
  status: "passed",
  contract: "rpg-fallback-quality-gates-v1",
  singleDispatchAttempt: attempts,
  readinessProbes,
  readinessPollingMs,
  failedReadyDeadlineMs: fakeNow,
  postFallbackClosedReview: "required",
  prePersistenceContinuityGate: {
    rejectedHanCharacters: longButNonNarrativeStory.match(/[\p{Script=Han}]/gu)?.length ?? 0,
    failures: continuityFailure?.continuityFailures,
    reviewedFallbackAfterDirectContinuityRejection:
      continuityAttempt === 2
      && !invalidCandidatePersisted
      && continuityCandidate.executionReceipt.postFallbackClosedReview?.passed === true,
    repetitionLeafRepairs: repetitionLeafRepairResults,
  },
  independentDeadlineContract: {
    generationDeadlineMs: 180_000,
    fallbackReviewDeadlineMs: 60_000,
    reviewStartedAfterGenerationExhaustion: reviewStartedAfterFullGenerationDeadline,
    reviewTimeoutFailClosed: failedFullReview?.reviewFailureCode === "RPG_STORY_AI_TIMEOUT",
    userAbortStages: ["generation", "fallback-review"],
  },
}));
