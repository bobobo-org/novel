import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { makeRecord } from "../lib/novel-ai/domain/index.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/index.ts";
import {
  CLOSED_AI_CACHE_LAYERS,
  ClosedAICache,
  MemoryClosedAICacheRepository,
} from "../lib/novel-ai/closed-ai-cache/index.ts";
import {
  ensureStudioCanonicalProject,
  saveStudioChapter,
} from "../lib/novel-ai/repository/studio-canonical.ts";
import {
  clearStudioTaskHandoff,
  makeStudioTaskHandoff,
  readStudioTaskHandoff,
  stageStudioTaskHandoff,
  studioHomeHref,
} from "../lib/novel-ai/web/studio-task-session.ts";
import {
  cleanRpgContinuation,
  mergeRpgChoiceDirection,
  parseRpgChoiceDirectorOutput,
  rpgTextSimilarity,
} from "../lib/novel-ai/web/rpg-closed-ai-director.ts";
import { normalizeAbcChoicesExecutionContent } from "../lib/novel-ai/closed-agent-os/structured-output.ts";
import {
  inspectRpgFoundation,
  RPG_FOUNDATION_MINIMUM_CONTEXT_CHARACTERS,
} from "../lib/novel-ai/web/rpg-foundation-gate.ts";
import {
  prewarmStudioProjectAICache,
  readPrewarmedStudioProjectContext,
} from "../lib/novel-ai/web/studio-project-ai-cache.ts";
import {
  readStudioWritingResume,
  writeStudioWritingResume,
} from "../lib/novel-ai/web/studio-writing-resume.ts";

const cases = [];
async function test(name, work) {
  try {
    await work();
    cases.push({ name, status: "PASS" });
  } catch (error) {
    cases.push({ name, status: "FAIL", error: error instanceof Error ? error.message : String(error) });
  }
}

class MemorySessionStore {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const emptyEffect = {
  statChanges: {}, relationshipChanges: {}, resourceChanges: {}, moneyChange: 0,
  worldFlags: {}, questProgress: {}, achievementProgress: {}, timelineEvents: [],
};
const baseChoices = [
  ["A", "steady", "rpg.intellect", "rpg.technique"],
  ["B", "resource", "rpg.charisma", "rpg.intellect"],
  ["C", "bold", "rpg.physique", "rpg.will"],
].map(([key, approach, primaryStat, secondaryStat], index) => ({
  id: `base-${key}`,
  key,
  title: `規則選項 ${key}`,
  approach,
  strategyLabel: String(approach),
  description: `規則描述 ${key}`,
  consequence: `規則後果 ${key}`,
  primaryStat,
  secondaryStat,
  risk: index + 1,
  successChance: 80 - index * 15,
  xpGain: 10 + index,
  actionCost: 1,
  costLabels: ["行動點 -1"],
  impactLabels: [`EXP +${10 + index}`],
  effect: { ...emptyEffect, statChanges: { [primaryStat]: index + 1 } },
  acceptedText: "",
  encounter: {
    signature: `encounter-${key}`,
    title: `事件 ${key}`,
    telegraph: `預兆 ${key}`,
    complication: `阻力 ${key}`,
    locationShift: `地點 ${key}`,
    worldAspect: `面向 ${key}`,
  },
}));

await test("task handoff requires a same-project destination and survives one home hop", () => {
  const store = new MemorySessionStore();
  const staged = stageStudioTaskHandoff({
    projectId: "novel-1",
    sourceLabel: "章節寫作",
    destinationLabel: "RPG 儀表板",
    destinationHref: "/studio/project/novel-1/rpg",
    chapterId: "chapter-5",
    chapterTitle: "第五章",
  }, store);
  assert.equal(staged.chapterId, "chapter-5");
  assert.equal(readStudioTaskHandoff(store)?.destinationHref, "/studio/project/novel-1/rpg");
  assert.equal(studioHomeHref("novel-1"), "/studio?screen=home&projectId=novel-1");
  clearStudioTaskHandoff(store);
  assert.equal(readStudioTaskHandoff(store), null);
  assert.throws(() => makeStudioTaskHandoff({
    projectId: "novel-1",
    sourceLabel: "寫作",
    destinationLabel: "別的作品",
    destinationHref: "/studio/project/novel-2/rpg",
  }), /OUT_OF_PROJECT/);
});

await test("editing chapter one while chapter five is active never changes chapter five or active identity", async () => {
  const repository = new MemoryNovelRepository();
  const seeded = await ensureStudioCanonicalProject(repository, {
    id: "five-chapter-project",
    title: "章節隔離",
    chapterTitle: "第一章",
    draft: "第一章原文",
  });
  let fifth = null;
  for (let order = 2; order <= 5; order += 1) {
    fifth = await repository.put("chapters", {
      ...makeRecord(seeded.project.id, "user"),
      title: `第${order}章`, order, content: `第${order}章原文`, summary: null, status: "draft",
    });
  }
  const project = await repository.get("projects", seeded.project.id);
  await repository.put("projects", { ...project, activeChapterId: fifth.id }, project.revision);
  await saveStudioChapter(repository, {
    id: seeded.project.id,
    title: seeded.project.title,
    chapterId: seeded.chapter.id,
    chapterTitle: "第一章（修訂）",
    draft: "只修改第一章",
  });
  assert.equal((await repository.get("chapters", seeded.chapter.id)).content, "只修改第一章");
  assert.equal((await repository.get("chapters", fifth.id)).content, "第5章原文");
  assert.equal((await repository.get("projects", seeded.project.id)).activeChapterId, fifth.id);
});

await test("saved chapter restores its exact editing position without storing duplicate prose", () => {
  const store = new MemorySessionStore();
  writeStudioWritingResume({
    projectId: "resume-project",
    chapterId: "chapter-5",
    selectionStart: 238,
    selectionEnd: 244,
    scrollTop: 920,
  }, store);
  const marker = readStudioWritingResume("resume-project", store);
  assert.equal(marker?.chapterId, "chapter-5");
  assert.equal(marker?.selectionStart, 238);
  assert.equal(marker?.selectionEnd, 244);
  assert.equal(marker?.scrollTop, 920);
  assert.doesNotMatch(JSON.stringify([...store.values.values()]), /第五章正文/);
});

await test("opening a saved project prewarms all six isolated AI cache layers", async () => {
  const repository = new MemoryNovelRepository();
  const seeded = await ensureStudioCanonicalProject(repository, {
    id: "resume-cache-project",
    title: "六層快取驗收",
    chapterTitle: "第五章",
    draft: "第五章末尾，主角在封印門前辨認出失蹤同伴留下的暗號。",
  });
  const cache = new ClosedAICache({ repository: new MemoryClosedAICacheRepository() });
  const warmed = await prewarmStudioProjectAICache({
    cache,
    repository,
    projectId: seeded.project.id,
    taskType: "chapter.continue",
    sourceChapterId: seeded.chapter.id,
    sourceRevision: seeded.chapter.revision,
  });
  assert.deepEqual(warmed?.warmedLayers, [...CLOSED_AI_CACHE_LAYERS]);
  const stats = await cache.stats();
  assert.deepEqual(stats.layerEntries, Object.fromEntries(CLOSED_AI_CACHE_LAYERS.map((layer) => [layer, 1])));
  assert.equal(stats.canonicalMutationCount, 0);
  assert.equal(stats.memoryMutationCount, 0);
  assert.equal(stats.learningMutationCount, 0);
  const context = await readPrewarmedStudioProjectContext({
    cache,
    repository,
    projectId: seeded.project.id,
    taskType: "chapter.continue",
    sourceChapterId: seeded.chapter.id,
    sourceRevision: seeded.chapter.revision,
  });
  assert.ok(context?.context.some((item) => item.text.includes("失蹤同伴留下的暗號")));
});

await test("interactive story performs zero inference until the story foundation is ready", () => {
  const empty = inspectRpgFoundation({});
  assert.equal(empty.ready, false);
  assert.deepEqual(empty.issues.map((issue) => issue.code), [
    "PROTAGONIST_REQUIRED",
    "STORY_PREMISE_REQUIRED",
    "STORY_CONTEXT_REQUIRED",
  ]);

  const missingContext = inspectRpgFoundation({
    protagonistName: "林昭",
    coreIdea: "在失落王城找回被抹去的盟約",
    chapterContent: "夜門剛剛打開。",
  });
  assert.equal(missingContext.ready, false);
  assert.deepEqual(missingContext.issues.map((issue) => issue.code), ["STORY_CONTEXT_REQUIRED"]);

  const readyFromChapter = inspectRpgFoundation({
    protagonistName: "林昭",
    theme: "信任與代價",
    chapterContent: "界".repeat(RPG_FOUNDATION_MINIMUM_CONTEXT_CHARACTERS),
  });
  assert.equal(readyFromChapter.ready, true);

  const readyFromConflict = inspectRpgFoundation({
    protagonistName: "林昭",
    coreIdea: "找出叛徒",
    chapterContent: "",
    unresolvedThreadCount: 1,
  });
  assert.equal(readyFromConflict.ready, true);
});

await test("an accepted creation conflict becomes the first canonical unresolved RPG thread", async () => {
  const repository = new MemoryNovelRepository();
  const conflict = "失落星港的航海記憶正在被人逐頁竄改，守書人必須在黎明前找出內應。";
  const seeded = await ensureStudioCanonicalProject(repository, {
    id: "guided-rpg-project",
    title: "失落星港",
    chapterTitle: "第一章",
    draft: "",
    coreIdea: "守住城市最後一份真實記憶",
    protagonist: "黎安",
    world: "以記憶作為航標的漂浮星港",
    conflict,
  });
  assert.deepEqual(seeded.storyBible.unresolvedThreads, [conflict]);
  assert.equal(inspectRpgFoundation({
    protagonistName: "黎安",
    coreIdea: seeded.project.coreIdea.value,
    chapterContent: seeded.chapter.content,
    unresolvedThreadCount: seeded.storyBible.unresolvedThreads.length,
  }).ready, true);
});

await test("AI director requires three distinct contextual strategies while preserving formula effects", () => {
  const payload = JSON.stringify({ choices: [
    { key: "A", title: "查驗密道回聲", description: "主角先比對牆後腳步與舊地圖，避開正在換防的巡守。", consequence: "時機可能縮短，但可找出安全退路。", continuityReason: "承接上一段提到的牆後回聲與失蹤地圖。" },
    { key: "B", title: "說服守庫人倒戈", description: "主角拿出剛取得的契約證據，交換守庫人掌握的內部名冊。", consequence: "會欠下一份人情，並讓同伴質疑交易代價。", continuityReason: "承接守庫人的猶豫、隊伍信任與契約伏筆。" },
    { key: "C", title: "引爆假警報奪門", description: "主角冒險製造禁區失火假象，趁敵方分兵時強行穿越正門。", consequence: "成功可直接逼近核心，失敗會暴露整隊位置。", continuityReason: "承接禁區封鎖、敵方增援與時間壓力。" },
  ] });
  const directed = parseRpgChoiceDirectorOutput(payload);
  const merged = mergeRpgChoiceDirection(baseChoices, directed);
  assert.deepEqual(merged.map((choice) => choice.key), ["A", "B", "C"]);
  assert.equal(new Set(merged.map((choice) => choice.title)).size, 3);
  assert.equal(merged[0].effect, baseChoices[0].effect);
  assert.match(merged[1].aiContinuityReason, /契約伏筆/);
});

await test("validated RPG JSON survives the Closed Agent boundary without losing consequence fields", () => {
  const payload = JSON.stringify({ choices: [
    { key: "A", title: "穩住星橋", description: "主角先封住裂縫並確認失蹤者留下的座標。", consequence: "耗費靈力但取得可靠線索。", continuityReason: "承接上一章星橋崩裂與失蹤伏筆。" },
    { key: "B", title: "交換密報", description: "主角以人情向守塔人換取禁區內部的巡查紀錄。", consequence: "增加關係債並暴露調查方向。", continuityReason: "承接守塔人先前隱瞞的異常反應。" },
    { key: "C", title: "闖入禁區", description: "主角趁警戒交替直接追蹤仍在移動的星砂痕跡。", consequence: "風險最高但可能立刻接觸真相。", continuityReason: "承接星砂只在雨夜出現的世界規則。" },
  ] });
  const normalized = normalizeAbcChoicesExecutionContent(payload);
  assert.equal(normalized.valid, true);
  assert.equal(normalized.sourceFormat, "json-object");
  assert.deepEqual(JSON.parse(normalized.content), JSON.parse(payload));
  const legacy = normalizeAbcChoicesExecutionContent("A. 穩住星橋\nB. 交換密報\nC. 闖入禁區");
  assert.equal(legacy.valid, true);
  assert.equal(legacy.content, "A. 穩住星橋\nB. 交換密報\nC. 闖入禁區");
});

await test("duplicate ABC output and parrot-like continuation are rejected", () => {
  const duplicate = JSON.stringify({ choices: ["A", "B", "C"].map((key) => ({
    key, title: "繼續前進", description: "主角繼續前進並且觀察四周是否出現新的變化。",
    consequence: "可能遇到新的危險與額外代價。", continuityReason: "承接目前故事內容與尚未處理的問題。",
  })) });
  assert.throws(() => parseRpgChoiceDirectorOutput(duplicate), /NOT_DISTINCT/);
  const previous = "主角推開石門，冷風從地底湧出。他握緊手中長劍，示意同伴跟上，眾人沿著濕滑階梯向下走去。黑暗深處傳來鐵鏈拖地的聲音，一場新的危機正在等待他們。";
  const repeated = `${previous} ${previous}`;
  assert.ok(rpgTextSimilarity(previous, repeated) > 0.72);
  assert.throws(() => cleanRpgContinuation(repeated, [previous]), /REPETITIVE/);
  assert.throws(() => cleanRpgContinuation("他停下腳步。", []), /TOO_SHORT/);
});

await test("source contracts expose save-home-task gating and verified closed AI RPG execution", async () => {
  const [studio, navigation, writer, rpg, bridge, taskProfile] = await Promise.all([
    readFile("app/studio/studio-client.tsx", "utf8"),
    readFile("app/studio/project/[projectId]/project-navigation.tsx", "utf8"),
    readFile("app/studio/project/[projectId]/write/write-workspace.tsx", "utf8"),
    readFile("app/studio/project/[projectId]/rpg/rpg-workspace.tsx", "utf8"),
    readFile("local-ai/bridge/server.mjs", "utf8"),
    readFile("lib/novel-ai/providers/closed/task-profile.ts", "utf8"),
  ]);
  assert.match(studio, /saveDraft\(chapterId: string, title: string, draft: string\)/);
  assert.match(studio, /commitScreen\("write", false, id\)/);
  assert.match(studio, /url\.searchParams\.delete\("projectId"\)/);
  assert.match(studio, /item\.activeChapterId === canonical\.chapter\.id/);
  assert.match(studio, /studio-task-handoff-continue/);
  assert.match(studio, /studio-open-rpg-dashboard/);
  assert.match(studio, /screen === "home" && value === "choice" && project/);
  assert.match(studio, /window\.location\.replace\(`\/studio\/project\/\$\{encodeURIComponent\(project\.id\)\}\/rpg`\)/);
  assert.match(studio, /prewarmStudioProjectAIState/);
  assert.match(navigation, /stageStudioTaskHandoff/);
  assert.match(writer, /Saving content must never select a chapter/);
  assert.match(writer, /freshTarget/);
  assert.match(writer, /readStudioWritingResume/);
  assert.match(writer, /六層 AI Cache 已就緒/);
  assert.match(rpg, /buildRpgChoiceDirectorPrompt/);
  assert.match(rpg, /buildRpgResolutionDirectorPrompt/);
  assert.match(rpg, /data-testid="rpg-foundation-gate"/);
  assert.match(rpg, /inspectRpgFoundation/);
  assert.match(rpg, /!rpgFoundationReady/);
  assert.match(rpg, /RPG_AI_CHOICES_REPEAT_RECENT_ROUND/);
  assert.match(rpg, /rpgTextSimilarity\(previous, regeneratedSignature\) >= 0\.82/);
  assert.match(rpg, /hasVerifiedExecutedStoryOutput/);
  assert.match(rpg, /approveStudioClosedAgentCandidate/);
  assert.match(rpg, /canonicalMutationCount !== 0/);
  assert.match(rpg, /qualityMode: "fast" as const/);
  assert.match(rpg, /maxTokens: 420/);
  assert.match(rpg, /closedAIErrorCode\(error\) !== "ABC_CHOICES_INVALID_STRUCTURE"/);
  assert.match(rpg, /結構修復重試/);
  assert.match(rpg, /seed: \(planningSeed \+ 104_729\) >>> 0/);
  assert.match(rpg, /targetLength: 240/);
  assert.match(rpg, /maxTokens: 288/);
  assert.match(rpg, /data-testid="rpg-operation-status"/);
  assert.match(rpg, /RPG_CLOSED_AI_RESOLUTION_FAILED/);
  assert.match(rpg, /已產生 \$\{generated\} 字/);
  assert.match(bridge, /body\.taskType === "chapter\.abcChoices"/);
  assert.match(bridge, /rpgChoiceDirectorFormat/);
  assert.match(taskProfile, /根層只能有 choices/);
});

await test("consumer home presents a compact luxury world dashboard with truthful project facts", async () => {
  const [studio, styles] = await Promise.all([
    readFile("app/studio/studio-client.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);
  assert.match(studio, /studioRealmObservatory/);
  assert.match(studio, /studioWorldLedger/);
  assert.match(studio, /studioRecentFacts/);
  assert.match(studio, /studioHomeCompass/);
  assert.match(studio, /projectWordCount = project \? words\(project\.draft\) : 0/);
  assert.match(studio, /projectVersionCount = project\?\.versions\.length \?\? 0/);
  assert.match(studio, /formatTime\(project\.updatedAt\)/);
  assert.match(styles, /\.studioHomeLower\{display:grid/);
  assert.match(styles, /\.studioHomeCompass\{position:relative/);
  assert.match(styles, /\.studioRecentFacts\{display:grid/);
  assert.match(styles, /\.studioRail\{display:flex;height:100dvh;flex-direction:column;overflow:hidden\}/);
  assert.match(styles, /\.studioRail>nav\{flex:1 1 auto;min-height:0;[^}]*overflow-y:auto/);
  assert.match(styles, /\.studioRail>\.studioLocalAI,\.studioRail>\.studioProfessional\{position:static;[^}]*width:100%\}/);
  assert.match(styles, /\.studioRail>nav button\{overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/);
});

const failed = cases.filter((entry) => entry.status === "FAIL");
console.log(JSON.stringify({
  schemaVersion: "studio-task-session-rpg-ai-v2",
  status: failed.length ? "FAIL" : "PASS",
  pass: cases.length - failed.length,
  fail: failed.length,
  cases,
}, null, 2));
if (failed.length) process.exitCode = 1;
