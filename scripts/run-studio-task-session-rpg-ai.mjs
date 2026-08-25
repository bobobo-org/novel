import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { makeRecord } from "../lib/novel-ai/domain/index.ts";
import { resolveStoryPlayMode } from "../lib/novel-ai/domain/play-mode.ts";
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
    destinationLabel: "故事工作台 RPG 回合",
    destinationHref: "/studio/project/novel-1/chat?mode=play",
    chapterId: "chapter-5",
    chapterTitle: "第五章",
  }, store);
  assert.equal(staged.chapterId, "chapter-5");
  assert.equal(readStudioTaskHandoff(store)?.destinationHref, "/studio/project/novel-1/chat?mode=play");
  assert.equal(studioHomeHref("novel-1"), "/professional?intent=library&projectId=novel-1");
  clearStudioTaskHandoff(store);
  assert.equal(readStudioTaskHandoff(store), null);
  assert.throws(() => makeStudioTaskHandoff({
    projectId: "novel-1",
    sourceLabel: "寫作",
    destinationLabel: "別的作品",
    destinationHref: "/studio/project/novel-2/chat?mode=play",
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

await test("legacy RPG, romance, and management projects retain their fixed play mode", async () => {
  for (const selectedPlayModeId of ["rpg", "romance", "management"]) {
    const repository = new MemoryNovelRepository();
    const initial = await ensureStudioCanonicalProject(repository, {
      id: `legacy-${selectedPlayModeId}`,
      title: `舊存檔 ${selectedPlayModeId}`,
      chapterTitle: "第一章",
      draft: "已存在的故事正文。",
      selectedPlayModeId,
    });
    assert.equal(resolveStoryPlayMode(initial.storyState), selectedPlayModeId);
    const reopened = await ensureStudioCanonicalProject(repository, {
      id: initial.project.id,
      title: initial.project.title,
      chapterId: initial.chapter.id,
      chapterTitle: initial.chapter.title,
      draft: initial.chapter.content,
      selectedPlayModeId,
    });
    assert.equal(resolveStoryPlayMode(reopened.storyState), selectedPlayModeId);
  }
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
    { key: "A", title: "先封山門再查暗線", description: "主角先封住殘破山門並核對巡使腳印，從仍在移動的香灰判斷真正入口。", consequenceTeaser: "會失去短暫先機，但能保留可靠退路。" },
    { key: "B", title: "借舊人情換取密報", description: "主角以舊日宗門人情接觸守庫人，用可追溯承諾交換巡查名冊與時限。", consequenceTeaser: "人情債會留下，盟友也將追問交換代價。" },
    { key: "C", title: "引巡使入陣奪先手", description: "主角故意暴露一段假路線，趁巡使分兵時強闖石門後的核心陣眼與退路。", consequenceTeaser: "成功可逼近核心，失敗會暴露倖存同伴。" },
  ] });
  const directed = parseRpgChoiceDirectorOutput(payload);
  const merged = mergeRpgChoiceDirection(baseChoices, directed);
  assert.deepEqual(merged.map((choice) => choice.key), ["A", "B", "C"]);
  assert.equal(new Set(merged.map((choice) => choice.title)).size, 3);
  assert.equal(merged[0].effect, baseChoices[0].effect);
  assert.match(merged[1].consequenceTeaser, /人情債/u);
  assert.deepEqual(merged[1].requirements, baseChoices[1].requirements);
});

await test("validated RPG JSON survives the Closed Agent boundary without losing display-only fields", () => {
  const payload = JSON.stringify({ choices: [
    { key: "A", title: "封住星橋裂縫查座標", description: "主角先封住星橋裂縫，再比對失蹤者留下的座標與雨夜星砂移動方向。", consequenceTeaser: "會消耗眼前時間，但能留下可靠退路。" },
    { key: "B", title: "以舊人情交換巡查密報", description: "主角以一筆可追溯的人情向守塔人換取禁區巡查紀錄與換防時限。", consequenceTeaser: "關係債將被記錄，也會暴露調查方向。" },
    { key: "C", title: "趁換防強闖星砂禁區", description: "主角趁警戒交替追蹤仍在移動的星砂痕跡，試圖在增援抵達前逼近真相。", consequenceTeaser: "成功可直達核心，失敗會暴露隊伍位置。" },
  ] });
  const normalized = normalizeAbcChoicesExecutionContent(payload);
  assert.equal(normalized.valid, true);
  assert.equal(normalized.sourceFormat, "json-object");
  assert.deepEqual(JSON.parse(normalized.content), JSON.parse(payload));
  const legacy = normalizeAbcChoicesExecutionContent("A. 穩住星橋\nB. 交換密報\nC. 闖入禁區");
  assert.equal(legacy.valid, true);
  assert.equal(legacy.content, "A. 穩住星橋\nB. 交換密報\nC. 闖入禁區");
});

await test("duplicate ABC output and parrot-like continuation are rejected", async () => {
  const duplicate = JSON.stringify({ choices: ["A", "B", "C"].map((key) => ({
    key, title: "繼續前進並觀察周遭", description: "主角沿著原路繼續前進，同時觀察四周是否出現新的腳印、聲響與伏擊跡象。",
    consequenceTeaser: "可能遇到新的危險，也會付出額外代價。",
  })) });
  assert.throws(() => parseRpgChoiceDirectorOutput(duplicate), /NOT_DISTINCT/);
  const previous = "主角推開石門，冷風從地底湧出。他握緊手中長劍，示意同伴跟上，眾人沿著濕滑階梯向下走去。黑暗深處傳來鐵鏈拖地的聲音，一場新的危機正在等待他們。";
  const repeated = `${previous} ${previous}`;
  assert.ok(rpgTextSimilarity(previous, repeated) > 0.72);
  await assert.rejects(() => cleanRpgContinuation(repeated, [previous]), /REPETITIVE/);
  await assert.rejects(() => cleanRpgContinuation("他停下腳步。", []), /TOO_SHORT/);
});

await test("source contracts expose save-home-task gating and verified closed AI RPG execution", async () => {
  const [
    studio,
    navigation,
    writer,
    chatRpg,
    rpgController,
    rpgApproval,
    rpgRedirect,
    chatPage,
    playMode,
    bridge,
    taskProfile,
    edgeGate,
    backends,
    studioClosedAI,
    learningWorkspace,
    manualLearningFile,
    manualLearningValidation,
  ] = await Promise.all([
    readFile("app/studio/studio-client.tsx", "utf8"),
    readFile("app/studio/project/[projectId]/project-navigation.tsx", "utf8"),
    readFile("app/studio/project/[projectId]/write/write-workspace.tsx", "utf8"),
    readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts", "utf8"),
    readFile("lib/novel-ai/web/rpg-chat-turn.ts", "utf8"),
    readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-approval.ts", "utf8"),
    readFile("app/studio/project/[projectId]/rpg/page.tsx", "utf8"),
    readFile("app/studio/project/[projectId]/chat/page.tsx", "utf8"),
    readFile("lib/novel-ai/domain/play-mode.ts", "utf8"),
    readFile("local-ai/bridge/server.mjs", "utf8"),
    readFile("lib/novel-ai/providers/closed/task-profile.ts", "utf8"),
    readFile("scripts/run-p24b-rc3-1-manual-edge-gate.mjs", "utf8"),
    readFile("lib/novel-ai/closed-agent-os/backends.ts", "utf8"),
    readFile("lib/novel-ai/web/studio-closed-ai.ts", "utf8"),
    readFile("app/studio/project/[projectId]/learning/learning-workspace.tsx", "utf8"),
    readFile("lib/novel-ai/web/manual-learning-file.ts", "utf8"),
    readFile("lib/novel-ai/web/manual-learning-file-validation.ts", "utf8"),
  ]);
  assert.match(studio, /saveDraft\(chapterId: string, title: string, draft: string\)/);
  assert.match(studio, /window\.location\.assign\(`\/studio\/project\/\$\{encodeURIComponent\(id\)\}\/chat`\)/u);
  assert.doesNotMatch(studio, /commitScreen\("(?:create|write)"/u);
  assert.match(studio, /url\.searchParams\.delete\("projectId"\)/);
  assert.match(studio, /item\.activeChapterId === canonical\.chapter\.id/);
  assert.match(studio, /studio-task-handoff-continue/);
  assert.match(studio, /續寫、改寫、RPG 與 A／B／C 都從這裡開始/u);
  assert.match(studio, /screen === "home" && value === "choice" && project/);
  assert.match(studio, /if \(value === "write"\)[\s\S]*?encodeURIComponent\(project\.id\)[\s\S]*?\/chat[\s\S]*?: "\/studio\/create"/u);
  assert.match(studio, /if \(value === "choice"\) return `\$\{projectRoot\}\/chat\?mode=play`/u);
  assert.match(studio, /window\.location\.replace\(`\/studio\/project\/\$\{encodeURIComponent\(project\.id\)\}\/chat\?mode=play`\)/u);
  assert.doesNotMatch(studio, /\/studio\/project\/\$\{encodeURIComponent\(project\.id\)\}\/rpg/u);
  assert.match(studio, /prewarmStudioProjectAIState/);
  assert.match(studio, /closedAgentQualityReasonCodes\(error\)/);
  assert.match(studio, /STUDIO_EXPLICIT_REGENERATION_FAILED/);
  assert.match(navigation, /stageStudioTaskHandoff/);
  assert.match(navigation, /prefetch=\{false\}/);
  assert.match(navigation, /<span className="p2NavLabel">故事工作台<\/span>/u);
  assert.match(navigation, /<details className="p2ProjectTools"/u);
  assert.match(navigation, /故事創作與 RPG 請回故事工作台/u);
  assert.doesNotMatch(navigation, /href=\{`\/studio\/project\/\$\{projectId\}\/rpg`\}/u);
  assert.match(writer, /Saving content must never select a chapter/);
  assert.match(writer, /freshTarget/);
  assert.match(writer, /readStudioWritingResume/);
  assert.match(writer, /章節全文校訂（專業工具）/u);
  assert.match(writer, /前往唯一故事工作台：續寫、改寫、RPG 與 A／B／C/u);
  assert.match(writer, /commitStudioCandidateToChapter/u);
  assert.doesNotMatch(writer, /runInlineWritingAI|AI 承接脈絡續寫|比較 3 個故事方向|完整品質續寫|AI 整章改寫候選/u);
  assert.match(chatRpg, /plan = await planRpgChatChoices\(\{/u);
  assert.match(chatRpg, /const fallbackPlan = await buildRpgRuleChoicePlan\(\{/u);
  assert.match(chatRpg, /fallbackReason: "USER_REQUESTED_RULE_FALLBACK"/u);
  assert.match(chatRpg, /最長等待 180 秒/u);
  assert.doesNotMatch(chatRpg, /RPG_CHOICE_RULE_PLAN_IMMEDIATE/u);
  assert.match(chatRpg, /serializeRpgChoices\(envelope\)/u);
  assert.match(chatRpg, /generateRpgChatTurnCandidate\(/u);
  assert.match(chatRpg, /canonicalMutationCount: 0/u);
  assert.match(rpgApproval, /await approveRpgChatTurn\(\{/u);
  assert.match(rpgApproval, /conversation-rpg-approval/u);
  assert.match(rpgController, /buildRpgChoiceDirectorPrompt/);
  assert.match(rpgController, /buildRpgResolutionDirectorPrompt/);
  assert.match(edgeGate, /request\.failure\(\)\?\.errorText/);
  assert.match(edgeGate, /ERR_ABORTED/);
  assert.match(rpgController, /hasVerifiedExecutedStoryOutput/);
  assert.match(rpgController, /approveStudioClosedAgentCandidate/);
  assert.match(rpgController, /canonicalMutationCount !== 0/);
  assert.match(rpgController, /export const RPG_CHAT_CHOICE_AI_TIMEOUT_MS = 180_000/u);
  assert.match(rpgController, /enhancementController\.abort\("RPG_CHOICE_AI_ENHANCEMENT_TIMEOUT"\)/u);
  assert.match(rpgController, /signal: enhancementController\.signal/u);
  assert.match(rpgController, /choices\.length !== 3/u);
  assert.match(rpgController, /keys\.join\(""\) !== "ABC"/u);
  assert.match(rpgController, /qualityMode: "fast"/);
  assert.match(rpgController, /maxTokens: 520/);
  assert.match(rpgController, /targetLength: input\.snapshot\.language === "en" \? 1_700 : 1_600/);
  assert.match(rpgController, /maxTokens: 1_792/);
  assert.match(rpgController, /substantiveScene: true/);
  assert.match(chatRpg, /signal: input\.signal/u);
  assert.match(chatRpg, /已產生 \$\{generated\} 字/u);
  assert.match(chatRpg, /故事與數值均未寫入/u);
  assert.match(rpgRedirect, /redirect\(`\/studio\/project\/\$\{encodeURIComponent\(projectId\)\}\/chat\?mode=play`\)/u);
  assert.match(chatPage, /first\(query\.mode\) === "play"/u);
  assert.match(chatPage, /開始目前玩法的第一回合/u);
  assert.match(playMode, /const storyWorkspace = `\/studio\/project\/\$\{encodeURIComponent\(projectId\)\}\/chat`/u);
  assert.doesNotMatch(playMode, /\/rpg/u);
  assert.match(bridge, /body\.taskType === "chapter\.abcChoices"/);
  assert.match(bridge, /rpgChoiceDirectorFormat/);
  assert.match(taskProfile, /根層只能有 choices/);
  assert.match(backends, /bounded-local-quality-repair/);
  assert.match(backends, /LOCAL_BOUNDED_QUALITY_REPAIR_REASONS/);
  assert.match(backends, /fallbackPolicy: "none"/);
  assert.match(studioClosedAI, /BROWSER_TO_LOCAL_RETRY_CODES/);
  assert.match(studioClosedAI, /preferredBackend: "local-ollama"/);
  assert.match(studioClosedAI, /allowPreAuthorizedClosedEscalation: true/);
  assert.match(learningWorkspace, /extractManualLearningFile/);
  assert.match(learningWorkspace, /splitManualLearningDocument/);
  assert.match(learningWorkspace, /\.pdf,\.docx/);
  assert.match(manualLearningFile, /pdfjs-dist\/legacy\/build\/pdf\.mjs/);
  assert.match(manualLearningFile, /mammoth/);
  assert.match(manualLearningValidation, /單一檔案上限/);
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
