import crypto from "crypto";
import { MemoryUpdateCandidateSchema, NovelMemorySchema, type MemoryUpdateCandidate, type NovelMemory, type StoryContext } from "./schemas";
import { AUTHOR_PREFERENCE_VERSION, getAuthorPreference } from "./preference";

type MemoryStore = { memories: Record<string, NovelMemory>; candidates: Record<string, MemoryUpdateCandidate> };
const globalMemory = globalThis as typeof globalThis & { __novelMemoryStore?: MemoryStore };

export const MEMORY_VERSION = "novel-memory-v2";
export const CONTEXT_BUILDER_VERSION = "context-builder-v5";
export const SCHEMA_VERSION = "novel-ai-schema-v4";

function db(): MemoryStore {
  if (!globalMemory.__novelMemoryStore) globalMemory.__novelMemoryStore = { memories: {}, candidates: {} };
  return globalMemory.__novelMemoryStore;
}

export function emptyMemory(projectId: string): NovelMemory {
  return NovelMemorySchema.parse({ projectId, version: 2, updatedAt: new Date().toISOString() });
}

export function getNovelMemory(projectId: string): NovelMemory {
  const existing = db().memories[projectId];
  return existing ? NovelMemorySchema.parse({ ...existing, version: 2 }) : emptyMemory(projectId);
}

export function saveNovelMemory(memory: NovelMemory): NovelMemory {
  const recent = memory.recentChapterSummaries || [];
  const all = memory.chapterSummaries?.length ? memory.chapterSummaries : recent;
  const clean = NovelMemorySchema.parse({
    ...memory,
    version: 2,
    recentChapterSummaries: recent.slice(0, 20),
    chapterSummaries: all.slice(0, 200),
    updatedAt: new Date().toISOString(),
  });
  db().memories[clean.projectId] = clean;
  return clean;
}

export function memoryStats() {
  const memories = Object.values(db().memories);
  return {
    projectsWithMemory: memories.length,
    chapterSummaries: memories.reduce((sum, x) => sum + x.chapterSummaries.length, 0),
    characterStates: memories.reduce((sum, x) => sum + x.characterStates.length, 0),
    unresolvedEvents: memories.reduce((sum, x) => sum + x.unresolvedEvents.filter((event) => event.status === "未處理" || event.status === "進行中").length, 0),
    secrets: memories.reduce((sum, x) => sum + x.secrets.length, 0),
    importantItems: memories.reduce((sum, x) => sum + x.importantItems.length, 0),
  };
}

function compact<T>(items: T[], limit: number): T[] {
  return items.slice(0, limit);
}

function contextLimits(task: "story_analysis" | "chapter_plan" | "continuity_review" | "memory_update") {
  if (task === "story_analysis") return { recentChapters: 8, chapterHistory: 18, recentText: 4200 };
  if (task === "chapter_plan") return { recentChapters: 5, chapterHistory: 10, recentText: 3200 };
  if (task === "memory_update") return { recentChapters: 4, chapterHistory: 8, recentText: 5000 };
  return { recentChapters: 6, chapterHistory: 10, recentText: 7000 };
}

export function buildTaskContext(context: StoryContext, task: "story_analysis" | "chapter_plan" | "continuity_review" | "memory_update"): StoryContext {
  const memory = getNovelMemory(context.projectId);
  const preference = getAuthorPreference(context.projectId);
  const limits = contextLimits(task);
  const selected: string[] = [];

  const relevantEvents = memory.unresolvedEvents.filter((x) => x.status === "未處理" || x.status === "進行中").slice(0, 12);
  const hiddenSecrets = memory.secrets.filter((x) => !x.revealedToReader && !x.revealed).slice(0, 12);
  const revealedSecrets = memory.secrets.filter((x) => x.revealedToReader || x.revealed).slice(0, 8);
  const items = memory.importantItems.slice(0, 12);
  const characters = memory.characterStates.slice(0, 14);
  const worldRules = memory.worldState.activeRules.slice(0, 12);

  if (memory.globalSummary) selected.push("全書摘要");
  if (memory.recentChapterSummaries.length) selected.push("近期章節摘要");
  if (context.recentText) selected.push(`近期正文後 ${Math.min(context.recentText.length, limits.recentText)} 字`);
  if (context.protagonist?.name) selected.push(`主角設定：${context.protagonist.name}`);
  if (context.mainConflict) selected.push("主要衝突");
  if (characters.length) selected.push("角色狀態");
  if (relevantEvents.length) selected.push("未解事件");
  if (hiddenSecrets.length) selected.push("未公開秘密");
  if (revealedSecrets.length) selected.push("已公開秘密");
  if (items.length) selected.push("重要道具");
  if (memory.worldState.currentLocation || memory.worldState.currentTime || worldRules.length) selected.push("世界狀態");
  if (context.forbiddenChanges.length || memory.forbiddenChanges.length) selected.push("禁止變更");
  if (preference.preferredStrategyPatterns.length || preference.repeatedRejectionReasons.length) selected.push("作者偏好學習");

  return {
    ...context,
    recentText: context.recentText.slice(-limits.recentText),
    previousChapterSummary: context.previousChapterSummary || memory.recentChapterSummaries[0]?.summary || "",
    unresolvedEvents: [...new Set([...context.unresolvedEvents, ...relevantEvents.map((x) => `${x.title}：${x.description}`)])].slice(0, 16),
    revealedSecrets: [...new Set([...context.revealedSecrets, ...revealedSecrets.map((x) => x.content)])].slice(0, 12),
    unrevealedSecrets: [...new Set([...context.unrevealedSecrets, ...hiddenSecrets.map((x) => x.content)])].slice(0, 16),
    importantItems: [...context.importantItems, ...items.map((x) => ({ name: x.name, owner: x.owner, location: x.location, status: x.status }))].slice(0, 16),
    forbiddenChanges: [...new Set([...context.forbiddenChanges, ...memory.forbiddenChanges])].slice(0, 28),
    recentChoices: [...new Set([...context.recentChoices, ...memory.recentChoices.map((x) => `${x.choice} => ${x.consequence}`)])].slice(0, 12),
    novelMemory: {
      version: MEMORY_VERSION,
      globalSummary: memory.globalSummary,
      recentChapterSummaries: compact(memory.recentChapterSummaries, limits.recentChapters),
      chapterSummaries: compact(memory.chapterSummaries, limits.chapterHistory),
      characterStates: characters,
      unresolvedEvents: relevantEvents,
      revealedSecrets,
      unrevealedSecrets: hiddenSecrets,
      importantItems: items,
      worldState: memory.worldState,
      recentChoices: compact(memory.recentChoices, 12),
      forbiddenChanges: memory.forbiddenChanges,
    },
    authorPreference: {
      version: AUTHOR_PREFERENCE_VERSION,
      preferredStrategyPatterns: preference.preferredStrategyPatterns.slice(0, 14),
      rejectedStrategyPatterns: preference.rejectedStrategyPatterns.slice(0, 14),
      preferredPacing: preference.preferredPacing.slice(0, 14),
      dislikedPacing: preference.dislikedPacing.slice(0, 14),
      preferredCharacterBehaviors: preference.preferredCharacterBehaviors.slice(0, 12),
      forbiddenCharacterBehaviors: preference.forbiddenCharacterBehaviors.slice(0, 12),
      preferredEndingHooks: preference.preferredEndingHooks.slice(0, 12),
      repeatedRejectionReasons: preference.repeatedRejectionReasons.slice(0, 14),
    },
    contextSelection: selected,
  };
}

export function buildStoryAnalysisContext(context: StoryContext): StoryContext {
  return buildTaskContext(context, "story_analysis");
}

export function buildChapterPlanContext(context: StoryContext): StoryContext {
  return buildTaskContext(context, "chapter_plan");
}

export function buildContinuityContext(context: StoryContext): StoryContext {
  return buildTaskContext(context, "continuity_review");
}

export function buildMemoryUpdateContext(context: StoryContext): StoryContext {
  return buildTaskContext(context, "memory_update");
}

function extractSentences(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/[。！？!?；;\n]/).map((x) => x.trim()).filter(Boolean);
}

function detectLocation(text: string): string | undefined {
  const match = text.match(/(?:來到|抵達|回到|進入|站在|位於|留在)(.{2,18}?)(?:，|。|、|的|前|中|裡)/);
  return match?.[1]?.trim();
}

function detectTime(text: string): string | undefined {
  const match = text.match(/(清晨|早晨|上午|午後|黃昏|深夜|午夜|三日後|隔天|翌日|同一晚|此刻)/);
  return match?.[1];
}

function detectItem(text: string): string | undefined {
  const match = text.match(/(帳冊|證據|密信|玉佩|鑰匙|卷宗|令牌|藥瓶|契約|錄音|照片|資料)/);
  return match?.[1];
}

export function proposeMemoryUpdate(input: {
  projectId: string;
  chapterId?: string;
  chapterTitle?: string;
  chapterText?: string;
  chapterPlan?: unknown;
  abcChoice?: string;
}): MemoryUpdateCandidate {
  const memory = getNovelMemory(input.projectId);
  const text = (input.chapterText || "").replace(/\s+/g, " ").slice(0, 5000);
  const sentences = extractSentences(text);
  const summary = sentences.slice(0, 3).join("。") || "本章推進了目前局勢，並留下下一步需要處理的問題。";
  const hook = sentences.slice(-1)[0] || "下一章仍有新的變化等待處理。";
  const protagonist = memory.characterStates[0]?.name || "主角";
  const chapterId = input.chapterId || `chapter-${memory.recentChapterSummaries.length + 1}`;
  const location = detectLocation(text);
  const time = detectTime(text);
  const item = detectItem(text);
  const secretDetected = /秘密|真相|身份|身分|隱瞞|藏著|調包|背叛|不可能存在/.test(text);
  const revealed = /揭露|公開|說出|看見|發現|承認/.test(text);

  const candidate = MemoryUpdateCandidateSchema.parse({
    projectId: input.projectId,
    chapterId,
    chapterSummary: summary,
    chapterResult: sentences.slice(-2).join("。") || summary,
    endingHook: hook,
    timelinePosition: `第${memory.recentChapterSummaries.length + 1}章後`,
    characterUpdates: [{
      characterName: protagonist,
      changedFields: {
        lastAppearedChapterId: chapterId,
        currentGoal: "承接本章結果，處理下一步衝突",
        currentLocation: location || memory.worldState.currentLocation,
        knownInformation: secretDetected ? ["本章出現新的秘密或異常線索"] : [],
      },
      evidence: summary,
    }],
    newUnresolvedEvents: hook ? [{
      title: "下一章待處理懸念",
      description: hook,
      importance: secretDetected ? "高" : "中",
      relatedCharacters: [protagonist],
    }] : [],
    updatedUnresolvedEvents: [],
    resolvedEventIds: [],
    newSecrets: secretDetected ? [{
      content: "本章出現可能影響後續判斷的新秘密或真相線索。",
      knownBy: [protagonist],
      revealedToReader: revealed,
    }] : [],
    revealedSecretIds: [],
    itemUpdates: item ? [{
      itemName: item,
      owner: protagonist,
      location: location || "",
      status: "本章出現，後續需要追蹤用途與持有人",
      evidence: summary,
    }] : [],
    worldStateUpdates: {
      currentLocation: location,
      currentTime: time,
      majorEvents: [summary].filter(Boolean),
    },
    continuityWarnings: [],
    originalCandidate: { chapterTitle: input.chapterTitle, chapterPlan: input.chapterPlan, abcChoice: input.abcChoice },
  });
  const id = crypto.randomUUID();
  db().candidates[id] = candidate;
  return { ...candidate, originalCandidate: { ...(candidate.originalCandidate as object), candidateId: id } };
}

export function confirmMemoryUpdate(candidate: MemoryUpdateCandidate): NovelMemory {
  const memory = getNovelMemory(candidate.projectId);
  const chapterId = candidate.chapterId || `chapter-${memory.recentChapterSummaries.length + 1}`;
  const chapterTitle = candidate.originalCandidate && typeof candidate.originalCandidate === "object" && "chapterTitle" in candidate.originalCandidate
    ? String((candidate.originalCandidate as { chapterTitle?: unknown }).chapterTitle || `第${memory.recentChapterSummaries.length + 1}章`)
    : `第${memory.recentChapterSummaries.length + 1}章`;
  const chapterSummary = {
    chapterId,
    chapterTitle,
    summary: candidate.chapterSummary,
    chapterResult: candidate.chapterResult,
    endingHook: candidate.endingHook,
    timelinePosition: candidate.timelinePosition || `第${memory.recentChapterSummaries.length + 1}章後`,
    createdAt: new Date().toISOString(),
  };
  memory.recentChapterSummaries.unshift(chapterSummary);
  memory.recentChapterSummaries = memory.recentChapterSummaries.slice(0, 20);
  memory.chapterSummaries.unshift(chapterSummary);
  memory.chapterSummaries = memory.chapterSummaries.slice(0, 200);

  for (const update of candidate.characterUpdates.filter((x) => x.decision !== "ignore")) {
    const existing = update.characterId ? memory.characterStates.find((x) => x.characterId === update.characterId) : memory.characterStates.find((x) => x.name === update.characterName);
    if (existing) {
      Object.assign(existing, update.changedFields);
      existing.lastAppearedChapterId = chapterId;
    } else {
      memory.characterStates.unshift({
        characterId: crypto.randomUUID(),
        name: update.characterName,
        role: update.characterName === "主角" ? "主角" : "",
        archetype: "",
        currentGoal: String(update.changedFields.currentGoal || ""),
        currentEmotion: String(update.changedFields.currentEmotion || ""),
        currentLocation: String(update.changedFields.currentLocation || ""),
        physicalCondition: String(update.changedFields.physicalCondition || ""),
        alive: true,
        knownInformation: Array.isArray(update.changedFields.knownInformation) ? update.changedFields.knownInformation.map(String) : [],
        unknownInformation: [],
        relationships: [],
        relationshipChanges: [],
        lastAppearedChapterId: chapterId,
      });
    }
  }

  for (const event of candidate.newUnresolvedEvents.filter((x) => x.decision !== "ignore")) {
    memory.unresolvedEvents.unshift({
      id: crypto.randomUUID(),
      title: event.title,
      description: event.description,
      importance: event.importance,
      relatedCharacters: event.relatedCharacters,
      introducedChapterId: chapterId,
      status: "未處理",
    });
  }
  for (const update of candidate.updatedUnresolvedEvents.filter((x) => x.decision !== "ignore")) {
    const event = memory.unresolvedEvents.find((x) => x.id === update.eventId);
    if (event) event.status = update.newStatus;
  }
  for (const eventId of candidate.resolvedEventIds) {
    const event = memory.unresolvedEvents.find((x) => x.id === eventId);
    if (event) event.status = "已解決";
  }
  for (const secret of candidate.newSecrets.filter((x) => x.decision !== "ignore")) {
    memory.secrets.unshift({
      id: crypto.randomUUID(),
      content: secret.content,
      knownBy: secret.knownBy,
      revealed: secret.revealedToReader,
      revealedToReader: secret.revealedToReader,
      revealedChapterId: secret.revealedToReader ? chapterId : undefined,
    });
  }
  for (const secretId of candidate.revealedSecretIds) {
    const secret = memory.secrets.find((x) => x.id === secretId);
    if (secret) {
      secret.revealed = true;
      secret.revealedToReader = true;
      secret.revealedChapterId = chapterId;
    }
  }
  for (const item of candidate.itemUpdates.filter((x) => x.decision !== "ignore")) {
    const existing = item.itemId ? memory.importantItems.find((x) => x.id === item.itemId) : memory.importantItems.find((x) => x.name === item.itemName);
    if (existing) {
      if (item.owner) existing.owner = item.owner;
      if (item.location) existing.location = item.location;
      if (item.status) existing.status = item.status;
      existing.lastSeenChapterId = chapterId;
    } else {
      memory.importantItems.unshift({
        id: crypto.randomUUID(),
        name: item.itemName,
        owner: item.owner || "",
        location: item.location || "",
        status: item.status || "",
        lastSeenChapterId: chapterId,
      });
    }
  }
  if (candidate.worldStateUpdates.currentLocation) memory.worldState.currentLocation = candidate.worldStateUpdates.currentLocation;
  if (candidate.worldStateUpdates.currentTime) memory.worldState.currentTime = candidate.worldStateUpdates.currentTime;
  if (candidate.worldStateUpdates.majorEvents) memory.worldState.majorEvents.unshift(...candidate.worldStateUpdates.majorEvents);
  memory.globalSummary = [candidate.chapterSummary, memory.globalSummary].filter(Boolean).join("\n").slice(0, 3000);
  return saveNovelMemory(memory);
}
