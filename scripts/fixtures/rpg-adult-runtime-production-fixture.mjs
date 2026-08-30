import { createHash } from "node:crypto";

import { createAdultExperienceProfile } from "../../lib/novel-data/adult-experience-profile.ts";
import {
  buildRpgChoices,
  readRpgProgression,
} from "../../lib/novel-ai/game/progression/rpg-progression.ts";

export const RPG_ADULT_RUNTIME_LOGICAL_TURN_ID = "logical-turn-adult-runtime-production";

const storyParagraphs = [
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

export function digestRpgAdultRuntimeStory(story) {
  return createHash("sha256").update(story.normalize("NFKC")).digest("hex");
}

export function createRpgAdultRuntimeProductionFixture() {
  const projectId = "project-adult-runtime-production";
  const chapterId = "chapter-adult-runtime-production";
  const storyState = {
    id: "story-state-adult-runtime-production",
    projectId,
    revision: 1,
    locationState: "雨夜藥鋪",
    protagonistStats: {},
    resources: {},
    relationships: {},
    worldFlags: { "rpg.runSeed": "adult-runtime-production-seed" },
  };
  const progression = readRpgProgression(
    storyState,
    "adult-runtime-production-seed",
    "adventure",
  );
  const choices = buildRpgChoices({
    progression,
    protagonist: "林澄",
    chapterTitle: "封條失竊",
    conflict: "在天亮以前查明封條被誰換過",
    mode: "adventure",
    playMode: "rpg",
    seed: "adult-runtime-production-seed",
    storyStateRevision: 1,
  });
  const choice = choices[0];
  const story = ["〈雨夜封條〉", ...storyParagraphs]
    .join("\n\n")
    .replace("林澄沿泥痕", `林澄決定${choice.title}，沿泥痕`)
    .replace("雨已經停了", "失敗的換封伎倆雖已拆穿，眾人仍付出代價。雨已經停了");
  const adultProfile = {
    ...createAdultExperienceProfile(),
    fictionalAdultsConfirmed: true,
  };
  const snapshot = {
    schemaVersion: "rpg-chat-turn-v1",
    project: {
      id: projectId,
      genrePackId: "現代懸疑",
      adultMode: true,
      adultExperienceProfile: adultProfile,
    },
    chapter: {
      id: chapterId,
      projectId,
      order: 1,
      title: "封條失竊",
      revision: 1,
      content: "",
    },
    chapters: [{
      id: chapterId,
      projectId,
      order: 1,
      title: "封條失竊",
      revision: 1,
      content: "",
    }],
    storyState,
    storyBible: {
      protagonistIds: ["character-adult-runtime-hero"],
      unresolvedThreads: ["封條背後仍有一名內應"],
    },
    characters: [
      {
        id: "character-adult-runtime-hero",
        projectId,
        name: "林澄",
        age: 601,
        ageVerified: true,
      },
      {
        id: "character-adult-runtime-counterpart",
        projectId,
        name: "蘇錦魚",
        age: 602,
        ageVerified: true,
      },
    ],
    relationships: [],
    worldRules: [],
    lore: [],
    timeline: [],
    acceptedChoices: [],
    rpgTurnReceipts: [],
    playMode: "rpg",
    progressionMode: "adventure",
    language: "zh-TW",
    progression,
    conflict: "在天亮以前查明封條被誰換過",
    directorContext: {
      protagonist: { name: "林澄" },
      supportingCharacters: [{ name: "蘇錦魚" }],
      location: "雨夜藥鋪",
      conflict: "在天亮以前查明封條被誰換過",
    },
    causalKnowledge: {
      snapshotVersion: "approved-learning-context-snapshot-v1",
      snapshotDigest: "adult-runtime-production-context",
      selectedRuleIds: [],
      instructions: [],
      causalSignals: [],
      maximumRules: 8,
      entireLibraryScanned: false,
    },
    baseChoices: choices,
  };

  const participantIds = snapshot.characters.map((character) => character.id);
  const consentEvidence = participantIds.map((participantId, index) => ({
    evidenceId: `consent-runtime-production-${index + 1}`,
    projectId,
    scopeId: RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
    participantId,
    state: "active",
    revocable: true,
    withdrawalState: "none",
    recordedAt: "2026-08-30T05:59:00.000Z",
    expiresAt: "2026-08-30T07:00:00.000Z",
  }));
  const safetyEvidence = {
    evidenceId: "safety-runtime-production-1",
    projectId,
    scopeId: RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
    participantIds: [...participantIds],
    recordedAt: "2026-08-30T05:59:00.000Z",
    assertions: {
      allParticipantsVerifiedAdults: true,
      activeRevocableConsent: true,
      participantsUnrelatedByBlood: true,
      noCoercion: true,
      noHiddenRecording: true,
      noExploitativePowerExchange: true,
      noRealCatalogCopying: true,
    },
  };
  const adultNarrativeRuntime = {
    participantIds,
    consentEvidence,
    safetyEvidence,
    request: {
      primaryEngine: "E8_world_heat",
      secondaryEngine: "E2_pretext",
      worldAdapter: "multiverse",
      parameters: {
        intensity: 2,
        consent_mode: "fade_to_black",
        ntr: false,
        climax_as_power: false,
        taboo_proximity: 0,
        aftercare: "required",
      },
      narrativeGoal: "A voluntary private decision changes two worlds' political alignment.",
      irreversibleEvent: "Both councils receive proof of the new alliance.",
      cost: "The pair lose access to their previously neutral refuge.",
    },
    evaluatedAt: "2026-08-30T06:00:00.000Z",
  };
  return {
    projectId,
    chapterId,
    snapshot,
    choice,
    story,
    adultNarrativeRuntime,
  };
}

export function createRpgAdultRuntimeClosedResult(request, fixture, {
  candidateId = "candidate-adult-runtime-production",
  story = fixture.story,
} = {}) {
  const contentDigest = digestRpgAdultRuntimeStory(story);
  const modelDigest = "a".repeat(64);
  return {
    taskId: request.taskId,
    candidateId,
    status: "awaiting_approval",
    provider: "local-ollama",
    model: "qwen-adult-runtime-test",
    modelDigest,
    sourceChapterId: fixture.chapterId,
    sourceRevision: 1,
    content: story,
    contentDigest,
    actualExecutor: "local-ollama",
    executionReceipt: {
      taskId: request.taskId,
      backendId: "local-ollama",
      modelId: "qwen-adult-runtime-test",
      modelDigest,
      contentDigest,
      attempt: 1,
      proofState: "verified",
      dataLeftDevice: false,
      externalRequest: false,
      actualExecutor: "local-ollama",
    },
    contextDigest: "adult-runtime-closed-context",
    contextSourceSummary: null,
    dataLeftDevice: false,
    externalRequest: false,
    warnings: [],
    toolExecutions: [],
    ledgerHeadHash: "adult-runtime-closed-ledger",
    requestContractDigest: "f".repeat(64),
    applicationValidationBindingDigest:
      request.applicationValidationBindingDigest ?? null,
    canonicalMutationCount: 0,
    regeneration: null,
    cache: { candidateHit: false, planHit: false, bypassReason: null },
  };
}

export function createRpgAdultRuntimeExternalResult(request, fixture) {
  const result = createRpgAdultRuntimeClosedResult(request, fixture, {
    candidateId: `candidate-external-${request.taskId}`,
  });
  return {
    ...result,
    provider: "gemini",
    actualExecutor: "gemini",
    externalRequest: true,
    dataLeftDevice: true,
    executionReceipt: {
      ...result.executionReceipt,
      backendId: "gemini",
      actualExecutor: "gemini",
      externalRequest: true,
      dataLeftDevice: true,
    },
  };
}
