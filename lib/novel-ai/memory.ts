import crypto from "crypto";
import { MemoryUpdateCandidateSchema, NovelMemorySchema, type MemoryUpdateCandidate, type NovelMemory, type StoryContext } from "./schemas";

type MemoryStore = { memories: Record<string, NovelMemory>; candidates: Record<string, MemoryUpdateCandidate> };
const globalMemory = globalThis as typeof globalThis & { __novelMemoryStore?: MemoryStore };

export const MEMORY_VERSION = "novel-memory-v1";
export const CONTEXT_BUILDER_VERSION = "context-builder-v2";
export const SCHEMA_VERSION = "novel-ai-schema-v3";

function db(): MemoryStore {
  if (!globalMemory.__novelMemoryStore) globalMemory.__novelMemoryStore = { memories: {}, candidates: {} };
  return globalMemory.__novelMemoryStore;
}

export function emptyMemory(projectId: string): NovelMemory {
  return NovelMemorySchema.parse({ projectId, updatedAt: new Date().toISOString() });
}

export function getNovelMemory(projectId: string): NovelMemory {
  return db().memories[projectId] || emptyMemory(projectId);
}

export function saveNovelMemory(memory: NovelMemory): NovelMemory {
  const clean = NovelMemorySchema.parse({ ...memory, updatedAt: new Date().toISOString() });
  db().memories[clean.projectId] = clean;
  return clean;
}

function compact<T>(items: T[], limit: number): T[] {
  return items.slice(0, limit);
}

export function buildTaskContext(context: StoryContext, task: "story_analysis" | "chapter_plan" | "continuity_review"): StoryContext {
  const memory = getNovelMemory(context.projectId);
  const selected: string[] = [];
  const relevantEvents = memory.unresolvedEvents.filter((x) => x.status === "未處理" || x.status === "進行中").slice(0, 8);
  const hiddenSecrets = memory.secrets.filter((x) => !x.revealed).slice(0, 8);
  const items = memory.importantItems.slice(0, 8);
  const recentChapterLimit = task === "story_analysis" ? 5 : task === "chapter_plan" ? 3 : 4;
  const recentTextLimit = task === "continuity_review" ? 5000 : 3000;
  if (memory.globalSummary) selected.push("全書摘要");
  if (memory.recentChapterSummaries.length) selected.push("近期章節摘要");
  if (context.recentText) selected.push(`近期正文末段${Math.min(context.recentText.length, recentTextLimit)}字`);
  if (context.protagonist?.name) selected.push(`主角設定：${context.protagonist.name}`);
  if (context.mainConflict) selected.push("主要衝突");
  if (relevantEvents.length) selected.push("未解事件");
  if (hiddenSecrets.length) selected.push("未公開秘密");
  if (items.length) selected.push("重要道具");
  if (memory.worldState.currentLocation || memory.worldState.currentTime) selected.push("世界狀態");
  if (context.forbiddenChanges.length || memory.forbiddenChanges.length) selected.push("禁止變更");

  return {
    ...context,
    recentText: context.recentText.slice(-recentTextLimit),
    previousChapterSummary: context.previousChapterSummary || memory.recentChapterSummaries[0]?.summary || "",
    unresolvedEvents: [...new Set([...context.unresolvedEvents, ...relevantEvents.map((x) => `${x.title}：${x.description}`)])].slice(0, 12),
    unrevealedSecrets: [...new Set([...context.unrevealedSecrets, ...hiddenSecrets.map((x) => x.content)])].slice(0, 12),
    importantItems: [...context.importantItems, ...items.map((x) => ({ name: x.name, owner: x.owner, location: x.location, status: x.status }))].slice(0, 12),
    forbiddenChanges: [...new Set([...context.forbiddenChanges, ...memory.forbiddenChanges])].slice(0, 20),
    recentChoices: [...new Set([...context.recentChoices, ...memory.recentChoices.map((x) => `${x.choice} => ${x.consequence}`)])].slice(0, 8),
    novelMemory: {
      version: MEMORY_VERSION,
      globalSummary: memory.globalSummary,
      recentChapterSummaries: compact(memory.recentChapterSummaries, recentChapterLimit),
      characterStates: compact(memory.characterStates, 12),
      unresolvedEvents: relevantEvents,
      unrevealedSecrets: hiddenSecrets,
      importantItems: items,
      worldState: memory.worldState,
    },
    contextSelection: selected,
  };
}

function extractSentences(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/[。！？!?；;]/).map((x) => x.trim()).filter(Boolean);
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
  const text = (input.chapterText || "").replace(/\s+/g, " ").slice(0, 3000);
  const sentences = extractSentences(text);
  const summary = sentences.slice(0, 3).join("。") || "本章已完成一段新的情節推進，但正文資訊不足，需要作者補充摘要。";
  const hook = sentences.slice(-1)[0] || "下一章仍有尚未解開的懸念。";
  const protagonist = memory.characterStates[0]?.name || "主角";
  const candidate = MemoryUpdateCandidateSchema.parse({
    projectId: input.projectId,
    chapterId: input.chapterId,
    chapterSummary: summary,
    chapterResult: sentences.slice(-2).join("。") || summary,
    endingHook: hook,
    characterUpdates: [{
      characterName: protagonist,
      changedFields: { lastAppearedChapterId: input.chapterId || "", currentGoal: "承接本章結果，處理下一個衝突。" },
      evidence: summary,
    }],
    newUnresolvedEvents: hook ? [{ title: "下一章懸念", description: hook, importance: "中" }] : [],
    resolvedEventIds: [],
    newSecrets: /秘密|真相|隱瞞|身分|身份/.test(text) ? [{ content: "本章提到一項可能影響後續的秘密或真相。", knownBy: [protagonist] }] : [],
    revealedSecretIds: [],
    itemUpdates: [],
    worldStateUpdates: {},
    continuityWarnings: [],
    originalCandidate: { chapterPlan: input.chapterPlan, abcChoice: input.abcChoice },
  });
  const id = crypto.randomUUID();
  db().candidates[id] = candidate;
  return { ...candidate, originalCandidate: { ...(candidate.originalCandidate as object), candidateId: id } };
}

export function confirmMemoryUpdate(candidate: MemoryUpdateCandidate): NovelMemory {
  const memory = getNovelMemory(candidate.projectId);
  const chapterId = candidate.chapterId || `chapter-${memory.recentChapterSummaries.length + 1}`;
  memory.recentChapterSummaries.unshift({
    chapterId,
    chapterTitle: `第${memory.recentChapterSummaries.length + 1}章`,
    summary: candidate.chapterSummary,
    chapterResult: candidate.chapterResult,
    endingHook: candidate.endingHook,
    createdAt: new Date().toISOString(),
  });
  memory.recentChapterSummaries = memory.recentChapterSummaries.slice(0, 20);

  for (const event of candidate.newUnresolvedEvents.filter((x) => x.decision !== "ignore")) {
    memory.unresolvedEvents.unshift({
      id: crypto.randomUUID(),
      title: event.title,
      description: event.description,
      importance: event.importance,
      introducedChapterId: chapterId,
      status: "未處理",
    });
  }
  for (const secret of candidate.newSecrets.filter((x) => x.decision !== "ignore")) {
    memory.secrets.unshift({ id: crypto.randomUUID(), content: secret.content, knownBy: secret.knownBy, revealed: false });
  }
  if (candidate.worldStateUpdates.currentLocation) memory.worldState.currentLocation = candidate.worldStateUpdates.currentLocation;
  if (candidate.worldStateUpdates.currentTime) memory.worldState.currentTime = candidate.worldStateUpdates.currentTime;
  if (candidate.worldStateUpdates.majorEvents) memory.worldState.majorEvents.unshift(...candidate.worldStateUpdates.majorEvents);
  memory.globalSummary = [candidate.chapterSummary, memory.globalSummary].filter(Boolean).join("\n").slice(0, 3000);
  return saveNovelMemory(memory);
}
