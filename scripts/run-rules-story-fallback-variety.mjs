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
  buildRpgReaderSafeCharacterContext,
  buildRpgTurnCausalContract,
  buildRpgOutcomeLines,
  readerSafeOrganizationLoreContent,
  validateRpgOutcomeNarrative,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import {
  PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
  proceduralCharacterTreasureScenarioAt,
} from "../lib/novel-ai/game/procedural-story-library.ts";
import {
  buildRpgResolutionDirectorPrompt,
  rpgTextSimilarity,
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

const quoteClassificationParagraph = "雨勢壓低屋簷，林澄沿著泥痕追到廊下，發現封條已被人換過。他沒有急著伸手，只讓同伴守住出口，自己逐一核對證人的說法與燈影位置。窗邊吹進來的冷風捲起殘紙，對手終於承認搬運路線曾臨時改動，卻拒絕說出下令的人。";
const continuityDetails = [
  "門邊水珠仍沿著舊痕往下爬，證明沒有人趁爭論時重新開門。",
  "掌櫃隨後交出剪鉗登記簿，讓那份遲疑第一次有了可以核對的去向。",
  "她把黑砂包進紙角，留下時間與見證人的姓名，才起身通知東巷接應。",
  "航簿被放回桌上時，顧行舟主動退開半步，讓原本沉默的書記看清那頁。",
  "薄紙背面還有乾透的藥汁，說明它曾在配藥桌旁停留，而非直接來自碼頭。",
  "內室傳來短促咳聲，林澄因此縮短查問，只留下最可能改變判斷的三個問題。",
  "巡察使伸手收封條前停了一瞬，蘇錦魚記住了他目光先落向哪一只抽屜。",
  "銅屑落下的聲音很輕，卻讓剛才還互相指責的人同時閉嘴，轉而看向同一處缺角。",
  "年輕信使的袖口沾著藥粉，這個細節把空箱、傷者與夜航船連到同一條路上。",
  "第一班晨車經過街口時，卷宗已分成兩份保存，任何一方都不能再單獨改寫。",
];
const properNounReuseStory = [
  quoteClassificationParagraph,
  "林澄把「海銅護證星盤殘片」收進證物袋，另外封上一張新籤。老掌櫃看見那道缺口，忽然想起凌晨曾有人借走剪鉗；他說話時一直摩挲袖口，顯然還藏著不肯明講的顧慮。",
  "後院水缸旁留著半枚濕鞋印，方向卻朝向封死的牆。蘇錦魚蹲下比對泥色，發現鞋底沾的不是院土，而是河岸卸貨區才有的黑砂，於是悄悄改守東側窄巷。",
  "顧行舟沒有否認夜航船曾靠岸，只把航簿翻到其中一頁。那裡的墨跡比前後兩頁新，數字筆鋒也不屬於值夜書記；眾人的爭論第一次落到可以追查的人手上。",
  "屋裡藥香被一陣冷風沖散，葉聞雪趁眾人掩鼻時抽走桌底薄紙。紙上沒有姓名，只有三次交貨的先後記號，而最後一筆恰好越過原先不能碰的界線。",
  "巷口傳來木輪壓過碎石的聲音，接應者卻比約定少了一人。林澄沒有催問去向，只先讓傷者換到內室；這個次序使躲在門外監視的人誤判了證物所在。",
  "巡察使敲門時語氣客氣，帶來的封條卻早已裁成合適長度。蘇錦魚故意問起另一宗舊案，對方回答得太快，反而證明他事前看過不該接觸的卷宗。",
  "證人再次指向「海銅護證星盤殘片」，確認缺角正是昨夜碰撞留下。她沒有要求眾人相信，只把自己的手套翻過來，讓藏在縫線裡的同色銅屑落到白紙上。",
  "顧氏的人開始撤離東巷，卻留下最年輕的信使守著空箱。林澄從那個不合常理的安排看出，真正要被帶走的從來不是箱中物，而是能指認交接時刻的人。",
  "天色泛白以前，眾人把三段彼此衝突的證詞排回同一條時間線。沒有人因此洗清嫌疑，但失竊、改簿與假封條終於不再是三件偶然；下一步該追的人已有了名字。",
].map((paragraph, index) => `${paragraph}${continuityDetails[index]}`).join("\n\n");
assert.doesNotThrow(
  () => validateRpgStoryTurnContract(properNounReuseStory, "zh-TW"),
  "repeated quoted proper nouns are not duplicated character dialogue",
);
const duplicatedDialogueStory = properNounReuseStory
  .replace("林澄把「海銅護證星盤殘片」收進證物袋，另外封上一張新籤。", "林澄沉聲說：「我已核對封條，現在誰也不能帶走證物！」")
  .replace("證人再次指向「海銅護證星盤殘片」，確認缺角正是昨夜碰撞留下。", "林澄再次警告：「我已核對封條，現在誰也不能帶走證物！」");
assert.throws(
  () => validateRpgStoryTurnContract(duplicatedDialogueStory, "zh-TW"),
  /RPG_AI_CONTINUATION_CHARACTER_VOICE_DUPLICATED/u,
  "identical full utterances still fail the duplicate-voice gate",
);
const duplicatedBareDialogueStory = properNounReuseStory
  .replace("林澄把「海銅護證星盤殘片」收進證物袋，另外封上一張新籤。", "「我不會把證物交給你」")
  .replace("證人再次指向「海銅護證星盤殘片」，確認缺角正是昨夜碰撞留下。", "「我不會把證物交給你」");
assert.throws(
  () => validateRpgStoryTurnContract(duplicatedBareDialogueStory, "zh-TW"),
  /RPG_AI_CONTINUATION_CHARACTER_VOICE_DUPLICATED/u,
  "terse repeated dialogue without punctuation remains protected",
);
const legacyTemplateStory = properNounReuseStory.replace(
  quoteClassificationParagraph,
  `${quoteClassificationParagraph}「我可以和你同行，但不是照單全收。」`,
);
assert.throws(
  () => validateRpgStoryTurnContract(legacyTemplateStory, "zh-TW"),
  /RPG_AI_CONTINUATION_LEGACY_TEMPLATE_VISIBLE/u,
  "the legacy generic companion line must never pass as novel prose",
);
const malformedQuoteStory = properNounReuseStory.replace(
  quoteClassificationParagraph,
  `${quoteClassificationParagraph}他依照「突破「傳承碑悟道」的計畫往前。`,
);
assert.throws(
  () => validateRpgStoryTurnContract(malformedQuoteStory, "zh-TW"),
  /RPG_AI_CONTINUATION_MALFORMED_DIALOGUE_QUOTES/u,
  "nested same-level Chinese quotation marks must be rejected",
);
for (const databaseFragment of [
  "修行 82/100",
  "體力 41/100",
  "五行相生 ×1.18",
  "屬性加成 ×1.31",
  "力量層級：宗師",
]) {
  const databaseDumpStory = properNounReuseStory.replace(
    quoteClassificationParagraph,
    `${quoteClassificationParagraph}${databaseFragment}。`,
  );
  assert.throws(
    () => validateRpgStoryTurnContract(databaseDumpStory, "zh-TW"),
    /RPG_AI_CONTINUATION_DATABASE_DUMP_VISIBLE/u,
    `${databaseFragment} must be rejected as a reader-visible character database field`,
  );
}
const readerSafeMastery = buildRpgReaderSafeCharacterContext({
  id: "safe-character",
  name: "顧明心",
  capabilities: [
    "力量層級：宗師",
    "修行 82/100",
    "會使用金行功法「流光劍訣」；時代 ancient；五行 金；熟練 82/100；實效 ×1.18",
  ],
  limitations: ["流光劍訣限制：受剋 ×0.72；體力 41/100"],
});
const serializedReaderSafeMastery = JSON.stringify(readerSafeMastery);
assert.doesNotMatch(serializedReaderSafeMastery, /82\s*\/\s*100|41\s*\/\s*100|[×x]\s*(?:1\.18|0\.72)|力量層級\s*[：:]/u);
assert.equal(readerSafeMastery.actionMastery?.era, "ancient");
assert.equal(readerSafeMastery.actionMastery?.element, "金");
assert.match(serializedReaderSafeMastery, /高度熟練|顯著助力/u);
const internalLoopStory = Array.from({ length: 10 }, () => quoteClassificationParagraph).join("\n\n");
assert.throws(
  () => validateRpgStoryTurnContract(internalLoopStory, "zh-TW"),
  /RPG_AI_CONTINUATION_INTERNAL_PARAGRAPH_LOOP/u,
  "near-identical filler paragraphs must fail before they can masquerade as a chapter",
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

const storySnapshot = {
    project: { id: "project-1" },
    chapter: { id: "chapter-1", title: "雨夜期限" },
    storyState: { locationState: "雨夜藥鋪", worldFlags: {} },
    storyBible: { protagonistIds: ["hero"], unresolvedThreads: ["青楓派巡察將封鎖通路"] },
    characters: [
      {
        id: "hero",
        name: "林澄",
        capabilities: ["會使用現代專業「精密資料分析・進階模組」；熟練 82/100；實效 ×1.31"],
        limitations: ["精密資料分析・進階模組限制：必須保留查核紀錄；代價：耗用時間與專業資源"],
      },
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
    lore: [{
      id: "雨港藥盟",
      kind: "faction",
      title: "企業｜雨港藥盟",
      content: [
        "雨港藥盟掌握夜間藥材調度。",
        "領域：雨港舊城",
        "公開目標：維持救命藥材供應",
        "組織關係網：",
        "- 資源依存｜對象：顧氏航運",
        "  起因：藥材夜航長期依賴對方船隊",
        "  歷史：雙方曾因一次延誤互相追責",
        "  現況：合作尚未中止，但每批貨都被加倍查驗",
        "  公開立場：仍維持契約，拒絕無條件讓步",
        "  幕後動機：等待對方先暴露改簿者",
        "  強度：76/100｜信任：-12/100｜公開",
      ].join("\n"),
    }],
    progression: { turn: 3, inventory: [{ name: "帳冊與備用藥材", quantity: 1 }] },
    language: "zh-TW",
    playMode: "management",
    conflict: "天亮前保住最後一批客戶",
    rpgTurnReceipts: [{ outcome: "failure" }, { outcome: "partial_success" }, { outcome: "failure" }],
};
const story = buildDeterministicRpgTurnStory({
  snapshot: storySnapshot,
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
  storyScenario.treasure.name,
]) {
  assert.ok(value && story.includes(value), `novel fallback prose did not render ${value}`);
}
assert.match(story, /「.+」/u, "supporting characters must speak in the novel scene");
assert.match(story, /精密資料分析・進階模組/u, "fallback must turn an approved mastery into a concrete action");
assert.doesNotMatch(story, /資源依存\s*[：|]|組織關係網\s*[：:]|公開立場\s*[：:]|幕後動機\s*[：:]/u, "fallback must not dump organization-card fields into prose");
assert.doesNotMatch(story, /82\s*\/\s*100|實效\s*×/u, "fallback must not dump mastery numbers");
for (const characterName of ["蘇錦魚", "顧行舟", "葉聞雪"]) {
  assert.match(
    story,
    new RegExp(`(?:「[^」]{2,80}」${characterName}|${characterName}[\\s\\S]{0,180}「[^」]{2,80}」)`, "u"),
    `${characterName} must act and speak without reciting a character-card field`,
  );
}
assert.doesNotMatch(
  story,
  /我願意一起處理|我先去做能證明|你可以(?:往前|試)，但別把|我只交出親眼核對過的部分/u,
  "three roles must not share a fixed policy-declaration skeleton",
);
assert.doesNotMatch(
  story,
  /核准規則|規則校準|規則故事後備|因果維度|因果鏈|本回合|下一回合|回合制|關係張力|狀態收益|狀態修訂|狀態更新|結算結果|下一輪可用|下一次行動|等待下一步|Story Bible|Canon/u,
  "reader-facing prose leaked internal engine or governance wording",
);
assert.doesNotMatch(
  story,
  /我可以和你同行，但不是照單全收|沒有置身事外|控制此物|此刻親自持有|持有人仍未現身|另有聲索|企業集團「|每個動作都能被看見，也因此無法假裝沒有做過|直到人聲稍歇|門外三聲叩響|新條件已送到門檻|必須決定先相信誰/u,
  "reader-facing prose leaked a data-table sentence or the retired fixed fallback skeleton",
);
validateRpgStoryTurnContract(story, "zh-TW");

const hiddenOrganizationLore = [
  "雨港藥盟掌握夜間藥材調度。",
  "組織關係網：",
  "- 祕密合作｜對象：灰橋協會",
  "  起因：交換未公開名冊",
  "  歷史：兩年前已開始暗中往來",
  "  現況：仍透過無名信使聯繫",
  "  公開立場：雙方公開否認往來",
  "  幕後動機：等待港務署失去警戒",
  "  強度：68/100｜信任：31/100｜未公開",
].join("\n");
const hiddenReaderLore = readerSafeOrganizationLoreContent(hiddenOrganizationLore);
assert.doesNotMatch(
  hiddenReaderLore,
  /祕密合作|灰橋協會|交換未公開名冊|暗中往來|無名信使|幕後動機|港務署失去警戒/u,
  "model-safe organization lore must remove the entire hidden relationship block",
);
const publicReaderLore = readerSafeOrganizationLoreContent(storySnapshot.lore[0].content);
assert.doesNotMatch(publicReaderLore, /幕後動機|76\s*\/\s*100|-12\s*\/\s*100/u);
const hiddenLoreWithStructure = readerSafeOrganizationLoreContent(`${hiddenOrganizationLore}\n階層、房系與資產：\nROOT 港務調度`);
assert.match(hiddenLoreWithStructure, /階層、房系與資產：[\s\S]*ROOT 港務調度/u, "hidden relationship removal must preserve later public structure");
const hiddenRelationSnapshot = structuredClone(storySnapshot);
hiddenRelationSnapshot.lore[0].content = hiddenOrganizationLore;
const hiddenRelationStory = buildDeterministicRpgTurnStory({
  snapshot: hiddenRelationSnapshot,
  choice: {
    key: "B",
    title: "借勢調度",
    description: "重新配置現有人力與資金",
    encounter,
  },
  resolution: { outcome: "failure" },
});
assert.doesNotMatch(
  hiddenRelationStory,
  /祕密合作|灰橋協會|交換未公開名冊|暗中往來|無名信使|幕後動機|港務署失去警戒/u,
  "fallback prose must not confirm or describe a hidden organization relationship",
);

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
assert.match(familyDirectorPrompt.instruction, /時代、所有權、前置條件、限制與代價/u);
assert.match(familyDirectorPrompt.instruction, /金木水火土/u);
assert.match(familyDirectorPrompt.instruction, /組織恩怨/u);
assert.match(familyDirectorPrompt.instruction, /不能替結果作保|不能推翻 lockedResolution/u);

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
const soloChoiceKeys = [];
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
  assert.doesNotMatch(
    soloStory,
    /我可以和你同行，但不是照單全收|沒有置身事外|控制此物|此刻親自持有|持有人仍未現身|另有聲索|企業集團「|每個動作都能被看見，也因此無法假裝沒有做過|直到人聲稍歇|門外三聲叩響|新條件已送到門檻|必須決定先相信誰/u,
  );
  soloStories.push(soloStory);
  soloChoiceKeys.push(soloChoice.key);
}
assert.ok(soloActors.size >= 6, "supporting cast did not rotate across the four-turn story sample");
assert.equal(new Set(soloStories).size, soloStories.length, "four turns repeated the same novel prose");
for (let turn = 1; turn < soloStories.length; turn += 1) {
  assert.notEqual(soloChoiceKeys[turn], soloChoiceKeys[turn - 1], "the sequential sample must exercise a different A/B/C action");
  assert.ok(
    rpgTextSimilarity(soloStories[turn - 1], soloStories[turn]) < 0.7,
    `turn ${turn - 1} and ${turn} remained too similar despite a new event and choice`,
  );
}

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
  assert.ok(output.story.length > 900, `fallback prose was only ${output.story.length} characters`);
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
